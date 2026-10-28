import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { composerPeriod, decadeForYear, isClassical } from '../../domain/eras';
import { bestMatch, matchTitle, splitArtists } from '../../domain/matching';
import { normalizeArtistName, normalizeTitle, normKey, releaseYear } from '../../domain/normalize';
import { byFrequency, instrumentName, providerGenres, topGenres } from '../../domain/tags';
import { downloadArtwork, downloadThumb, findThumb, smallArtworkUrl } from '../artwork';
import type { DB as Db, DbOrTx as DB } from '../db/client';
import { entities, entityArtists, externalIds, kv, type Entity } from '../db/schema';
import { ensureEntity, findByExternalId, findByNormKey } from '../library/entities';
import { mergeEntities } from '../library/merge';
import { listedSql } from '../library/relations';
import type { FetchFn } from '../providers/http';
import type { MbArtist, MbRecording, MusicBrainzClient } from '../providers/musicbrainz';
import type { Providers } from '../providers/resolve';
import { ProviderError } from '../providers/types';
import type { SuggestPayload } from './suggestions';
import { addAutoTags, effectiveFor, hasManual, setAutoTags, tagsFor } from './tags';

export interface EnrichPayload {
	entityId: number;
	/** Genre strings from the provider the item was added from. */
	providerGenres?: string[];
	isrc?: string;
	upc?: string;
	/** Provider artwork to retry if the download during add failed. */
	artworkUrl?: string;
}

export interface EnrichDeps {
	db: DB;
	/** null when MB_USER_AGENT isn't configured: MusicBrainz steps are skipped. */
	mb: MusicBrainzClient | null;
	providers: Providers;
	artworkDir: string;
	fetchImpl?: FetchFn;
	enqueue: (payload: EnrichPayload) => void;
	/** Queues edge suggestions for an artist once it's enriched. */
	suggest?: (payload: SuggestPayload) => void;
	log?: (msg: string) => void;
}

const MB_URL = 'https://musicbrainz.org';

function load(db: DB, id: number | null | undefined): Entity | undefined {
	return id == null ? undefined : db.select().from(entities).where(eq(entities.id, id)).get();
}

function externalId(db: DB, entityId: number, provider: 'musicbrainz' | 'spotify' | 'apple'): string | undefined {
	return db
		.select({ id: externalIds.externalId })
		.from(externalIds)
		.where(and(eq(externalIds.entityId, entityId), eq(externalIds.provider, provider)))
		.get()?.id;
}

function attachMbid(db: DB, entityId: number, mbid: string, path: string) {
	db.insert(externalIds)
		.values({ entityId, provider: 'musicbrainz', externalId: mbid, url: `${MB_URL}/${path}/${mbid}` })
		.onConflictDoNothing()
		.run();
}

function setStatus(db: DB, id: number, status: Entity['enrichStatus']) {
	db.update(entities).set({ enrichStatus: status, updatedAt: new Date().toISOString() }).where(eq(entities.id, id)).run();
}

/** MusicBrainz artist data is cached in kv so era recomputation doesn't need the network. */
function cacheArtist(db: DB, a: MbArtist) {
	const value = JSON.stringify({ type: a.type, begin: a.begin, end: a.end });
	db.insert(kv).values({ key: `mb:artist:${a.id}`, value }).onConflictDoUpdate({ target: kv.key, set: { value } }).run();
}

function cachedArtist(db: DB, mbid: string | undefined): { type?: string; begin?: string; end?: string } | undefined {
	if (!mbid) return undefined;
	const row = db.select().from(kv).where(eq(kv.key, `mb:artist:${mbid}`)).get();
	return row ? JSON.parse(row.value) : undefined;
}

/** Remembers which MusicBrainz artists are credited as composers of works we've seen. */
function markComposers(db: DB, mbids: string[]) {
	for (const id of mbids) db.insert(kv).values({ key: `mb:composer:${id}`, value: '1' }).onConflictDoNothing().run();
}

function isKnownComposer(db: DB, mbid: string | undefined): boolean {
	return !!mbid && !!db.select().from(kv).where(eq(kv.key, `mb:composer:${mbid}`)).get();
}

/** Entry point for `enrich` jobs. Throws on transient failures so the worker retries. */
export async function enrichEntity(deps: EnrichDeps, payload: EnrichPayload) {
	const entity = load(deps.db, payload.entityId);
	if (!entity) return; // deleted since it was queued
	setStatus(deps.db, entity.id, 'running');
	try {
		if (entity.kind === 'artist') await enrichArtist(deps, entity);
		else await enrichRelease(deps, entity, payload);
		setStatus(deps.db, entity.id, 'done');
	} catch (err) {
		setStatus(deps.db, entity.id, 'pending');
		throw err;
	}
}

/**
 * Queues already-enriched library items again (not unaccepted suggestion stubs), releases before
 * artists so artists can pick up MusicBrainz ids from their credits. Returns how many were queued.
 */
export function requeueEnriched(db: DB, enqueue: EnrichDeps['enqueue'], { missingMusicBrainz = false } = {}): number {
	const rows = db
		.select({ id: entities.id })
		.from(entities)
		.where(
			and(
				inArray(entities.enrichStatus, ['done', 'failed']),
				or(listedSql, sql`exists (select 1 from edges where (from_id = ${entities.id} or to_id = ${entities.id}) and status = 'accepted')`),
				missingMusicBrainz
					? sql`not exists (select 1 from external_ids where entity_id = ${entities.id} and provider = 'musicbrainz')`
					: undefined
			)
		)
		.orderBy(sql`${entities.kind} = 'artist'`, entities.id)
		.all();
	for (const { id } of rows) {
		setStatus(db, id, 'pending');
		enqueue({ entityId: id });
	}
	return rows.length;
}

/** Marks an entity as permanently failed (called by the worker after the last attempt). */
export function markEnrichFailed(db: DB, entityId: number) {
	setStatus(db, entityId, 'failed');
}

interface ReleaseFacts {
	genres: string[];
	albumInstruments: string[];
	trackInstruments?: string[];
	artistInstruments: string[];
	composer?: MbArtist;
	rgMbid?: string;
	coverRelease?: string;
	credits: MbCredit[];
}

type MbCredit = { id: string; name: string; credited: string };

async function enrichRelease(deps: EnrichDeps, entity: Entity, payload: EnrichPayload) {
	const { db } = deps;
	const album = entity.kind === 'album' ? entity : load(db, entity.albumId);
	let artist = load(db, entity.artistId);
	// Release-level facts (genre, decade, composer era) live on the album when there is one;
	// tracks inherit them (section 6.1). Tracks only get their own instruments.
	const release = album ?? entity;

	// Local facts first, so a MusicBrainz failure still leaves useful tags behind.
	const local = providerGenres(payload.providerGenres ?? []);
	const decade = decadeForYear(releaseYear(release.releaseDate));
	if (local.length) setAutoTags(db, release.id, 'genre', local);
	if (decade) setAutoTags(db, release.id, 'era', [decade]);

	const facts = deps.mb && artist ? await musicBrainzFacts(deps, entity, album, artist, payload) : undefined;
	if (facts && artist) artist = applyCredits(deps, artist, [...new Set([entity.id, album?.id ?? entity.id])], facts.credits);

	const genres = [...new Set([...local, ...(facts?.genres ?? [])])];
	if (genres.length) setAutoTags(db, release.id, 'genre', genres);

	// Eras: decade of the release, plus the composer's period for classical music.
	const eras: string[] = [];
	const effectiveGenres = [
		...genres,
		...(effectiveFor(db, [release.id]).get(release.id)?.genre.tags.map((t) => t.name) ?? [])
	];
	if (facts?.composer && isClassical(effectiveGenres)) {
		const period = composerPeriod(facts.composer.begin, facts.composer.end);
		if (period) eras.push(period);
	}
	if (decade) eras.push(decade);
	if (eras.length) setAutoTags(db, release.id, 'era', eras);

	if (facts?.albumInstruments.length && album) setAutoTags(db, album.id, 'instrument', facts.albumInstruments);
	if (facts?.trackInstruments?.length && entity.kind === 'track') setAutoTags(db, entity.id, 'instrument', facts.trackInstruments);
	if (facts?.artistInstruments.length && artist) addAutoTags(db, artist.id, 'instrument', facts.artistInstruments);

	await artworkFallback(deps, entity, album, payload, facts);
	await ensureThumb(deps, entity.id).catch((err) => deps.log?.(`thumbnail for ${entity.id} failed: ${err}`));

	if (artist) {
		if (artist.enrichStatus === 'pending') deps.enqueue({ entityId: artist.id });
		else recomputeArtistEras(db, artist.id);
	}
}

async function musicBrainzFacts(
	deps: EnrichDeps,
	entity: Entity,
	album: Entity | undefined,
	artist: Entity,
	payload: EnrichPayload
): Promise<ReleaseFacts | undefined> {
	const { db } = deps;
	const mb = deps.mb!;
	const albumEntity = album ?? (entity.kind === 'album' ? entity : undefined);
	if (!albumEntity) return undefined; // standalone track without an album: nothing reliable to match

	let rgMbid = externalId(db, albumEntity.id, 'musicbrainz');
	if (!rgMbid) {
		const wanted = { title: albumEntity.name, artist: artist.name, year: releaseYear(albumEntity.releaseDate) };
		const candidates = await mb.searchReleaseGroups(matchTitle(albumEntity.name) || normalizeTitle(albumEntity.name), splitArtists(artist.name)[0] ?? artist.name);
		const match = bestMatch(
			wanted,
			candidates
				.filter((c) => !c.primaryType || c.primaryType === 'Album' || c.primaryType === 'EP' || c.primaryType === 'Single')
				.map((c) => ({ id: c.id, title: c.title, artists: c.artists.map((a) => a.name), year: releaseYear(c.firstReleaseDate), score: c.score }))
		);
		if (!match) {
			deps.log?.(`no confident MusicBrainz match for "${albumEntity.name}"`);
			return undefined;
		}
		rgMbid = match.candidate.id;
		attachMbid(db, albumEntity.id, rgMbid, 'release-group');
	}

	const rg = await mb.getReleaseGroup(rgMbid);
	if (!rg) return undefined;

	// Link the artist to MusicBrainz via the release group's credit.
	const ourArtists = splitArtists(artist.name);
	const creditedArtist = rg.artists.find((a) => ourArtists.includes(normalizeArtistName(a.name)) || ourArtists.includes(normalizeArtistName(a.credited)));
	if (creditedArtist && !externalId(db, artist.id, 'musicbrainz')) attachMbid(db, artist.id, creditedArtist.id, 'artist');
	const artistMbid = externalId(db, artist.id, 'musicbrainz');

	// Pick one concrete release for credits: official, earliest, preferring a full track list.
	const releases = [...rg.releases].sort(
		(a, b) =>
			Number(b.status === 'Official') - Number(a.status === 'Official') ||
			(a.date ?? '9999').localeCompare(b.date ?? '9999')
	);
	const chosen = releases[0];
	const release = chosen ? await mb.getRelease(chosen.id) : null;
	const recordings = release?.recordings ?? [];

	let trackRecording: MbRecording | undefined;
	if (entity.kind === 'track') {
		trackRecording =
			(payload.isrc && recordings.find((r) => r.isrcs.includes(payload.isrc!))) ||
			recordings.find((r) => normalizeTitle(r.title) === normalizeTitle(entity.name));
		if (trackRecording && !externalId(db, entity.id, 'musicbrainz')) attachMbid(db, entity.id, trackRecording.id, 'recording');
	}

	const instrumentsOf = (rs: MbRecording[]) => rs.flatMap((r) => r.performers.flatMap((p) => p.instruments.map(instrumentName)));
	const artistInstruments = artistMbid
		? recordings.flatMap((r) => r.performers.filter((p) => p.artistId === artistMbid).flatMap((p) => p.instruments.map(instrumentName)))
		: [];

	// Composer: most credited across the release's works.
	const composerIds = recordings.flatMap((r) => r.composers.map((c) => c.id));
	markComposers(db, [...new Set(composerIds)]);
	const composerCounts = byFrequency(composerIds, 1);
	let composer: MbArtist | undefined;
	if (composerCounts[0]) {
		composer = (await mb.getArtist(composerCounts[0])) ?? undefined;
		if (composer) cacheArtist(db, composer);
	}

	return {
		genres: topGenres(rg.genres),
		albumInstruments: byFrequency(instrumentsOf(recordings), 10),
		trackInstruments: trackRecording ? byFrequency(instrumentsOf([trackRecording]), 10) : undefined,
		artistInstruments: byFrequency(artistInstruments, 6),
		composer,
		rgMbid,
		coverRelease: release?.hasFrontCover ? release.id : undefined,
		credits: rg.artists
	};
}

/**
 * Uses the MusicBrainz credit to split a combined artist ("Cory Wong, Metropole Orkest") into
 * separate artists: ours becomes the credited artist it names, the others are co-credited on the
 * release. Returns the release's primary artist afterwards.
 */
function applyCredits(deps: EnrichDeps, artist: Entity, releaseIds: number[], credits: MbCredit[]): Entity {
	const unique = credits.filter((c, i) => credits.findIndex((x) => x.id === c.id) === i);
	if (unique.length < 2) return artist;
	const { db } = deps;
	const names = (c: MbCredit) => [normalizeArtistName(c.name), normalizeArtistName(c.credited)];
	const own = normalizeArtistName(artist.name);
	let mine = unique.find((c) => names(c).includes(own));
	let primary = artist;
	if (!mine) {
		const parts = splitArtists(artist.name);
		mine = unique.find((c) => names(c).some((n) => parts.includes(n)));
		if (!mine) return artist; // the credit doesn't look like ours: leave it alone
		const key = normKey('artist', { name: mine.name });
		const other = [findByExternalId(db, 'musicbrainz', mine.id), findByNormKey(db, 'artist', key)].find((e) => e && e.id !== artist.id);
		if (other) {
			mergeEntities(db as Db, artist.id, other.id);
			primary = other;
		} else {
			db.update(entities).set({ name: mine.name, normKey: key, updatedAt: new Date().toISOString() }).where(eq(entities.id, artist.id)).run();
			attachMbid(db, artist.id, mine.id, 'artist');
		}
		primary = load(db, primary.id)!;
	}
	for (const c of unique) {
		if (c === mine) continue;
		const { entity, created } = ensureEntity(db, {
			kind: 'artist',
			name: c.name,
			normKey: normKey('artist', { name: c.name }),
			external: { provider: 'musicbrainz', id: c.id, url: `${MB_URL}/artist/${c.id}` }
		});
		if (entity.id === primary.id) continue;
		if (created) deps.enqueue({ entityId: entity.id });
		for (const id of releaseIds) db.insert(entityArtists).values({ entityId: id, artistId: entity.id }).onConflictDoNothing().run();
	}
	return primary;
}

async function artworkFallback(deps: EnrichDeps, entity: Entity, album: Entity | undefined, payload: EnrichPayload, facts?: ReleaseFacts) {
	const targets = [entity, album].filter((e): e is Entity => !!e && !e.artworkPath);
	if (!targets.length) return;
	const sources = [
		payload.artworkUrl,
		facts?.coverRelease && `https://coverartarchive.org/release/${facts.coverRelease}/front-500`,
		facts?.rgMbid && `https://coverartarchive.org/release-group/${facts.rgMbid}/front-500`
	].filter((s): s is string => !!s);
	for (const url of sources) {
		try {
			const file = await downloadArtwork(url, deps.artworkDir, { fetchImpl: deps.fetchImpl });
			deps.db.update(entities).set({ artworkPath: file }).where(inArray(entities.id, targets.map((t) => t.id))).run();
			const small = smallArtworkUrl(url);
			if (small) await downloadThumb(small, file, deps.artworkDir, { fetchImpl: deps.fetchImpl }).catch(() => {});
			return;
		} catch (err) {
			deps.log?.(`artwork fallback ${url} failed: ${err}`);
		}
	}
}

/**
 * Downloads the small copy of an entity's cover from wherever it can be found again: Apple or
 * Spotify by id, or the Cover Art Archive by release group. For covers saved before small copies
 * existed.
 */
export async function ensureThumb(deps: EnrichDeps, entityId: number) {
	const { db } = deps;
	const entity = load(db, entityId);
	if (!entity?.artworkPath || entity.kind === 'artist' || (await findThumb(deps.artworkDir, entity.artworkPath))) return;
	const album = entity.kind === 'track' ? load(db, entity.albumId) : undefined;
	const sources: (() => Promise<string | undefined>)[] = [];
	for (const e of [entity, album]) {
		if (!e) continue;
		const kind = e.kind as 'album' | 'track';
		const apple = externalId(db, e.id, 'apple');
		if (apple && deps.providers.apple) sources.push(async () => smallArtworkUrl((await deps.providers.apple!.lookup({ kind, id: apple }))?.artworkUrl));
		const spotify = externalId(db, e.id, 'spotify');
		if (spotify && deps.providers.spotify) sources.push(async () => (await deps.providers.spotify!.lookup({ kind, id: spotify }))?.thumbUrl);
		const rg = e.kind === 'album' ? externalId(db, e.id, 'musicbrainz') : undefined;
		if (rg) sources.push(async () => `https://coverartarchive.org/release-group/${rg}/front-250`);
	}
	let error: unknown;
	for (const source of sources) {
		try {
			const url = await source();
			if (url) return void (await downloadThumb(url, entity.artworkPath, deps.artworkDir, { fetchImpl: deps.fetchImpl }));
		} catch (err) {
			error ??= err;
		}
	}
	// Retry only lookups that failed (e.g. rate limited), not covers a source doesn't have.
	if (error instanceof ProviderError && error.provider !== 'artwork') throw error;
}

async function enrichArtist(deps: EnrichDeps, artist: Entity) {
	const { db } = deps;
	let mbid = externalId(db, artist.id, 'musicbrainz');
	if (!mbid && deps.mb) {
		// Only accept an unambiguous exact-name match.
		const hits = (await deps.mb.searchArtists(artist.name)).filter(
			(a) => a.score >= 95 && normalizeArtistName(a.name) === normalizeArtistName(artist.name)
		);
		if (hits.length === 1) {
			mbid = hits[0].id;
			attachMbid(db, artist.id, mbid, 'artist');
		}
	}

	const genres: string[] = [];
	const suggest: SuggestPayload = { entityId: artist.id };
	if (mbid && deps.mb) {
		const data = await deps.mb.getArtist(mbid, { relations: true });
		if (data) {
			cacheArtist(db, data);
			genres.push(...topGenres(data.genres));
			if (data.wikidata) {
				db.insert(externalIds)
					.values({ entityId: artist.id, provider: 'wikidata', externalId: data.wikidata, url: `https://www.wikidata.org/wiki/${data.wikidata}` })
					.onConflictDoNothing()
					.run();
			}
			Object.assign(suggest, { wikidata: data.wikidata, teachers: data.teachers, students: data.students });
		}
	}
	const spotifyId = externalId(db, artist.id, 'spotify');
	if (spotifyId && deps.providers.spotify) {
		try {
			const sp = await deps.providers.spotify.lookup({ kind: 'artist', id: spotifyId });
			genres.push(...providerGenres(sp?.genres ?? []));
		} catch (err) {
			deps.log?.(`spotify artist genres failed: ${err}`);
		}
	}
	if (genres.length) setAutoTags(db, artist.id, 'genre', [...new Set(genres)]);
	recomputeArtistEras(db, artist.id);
	deps.suggest?.(suggest);
}

/**
 * Artist eras (section 6.3): classical composers (credited as composer on works we've seen) get
 * the period of their lifespan; everyone else gets the
 * union of their albums'/tracks' effective eras. Manual era tags are left alone.
 */
export function recomputeArtistEras(db: DB, artistId: number) {
	if (hasManual(db, artistId, 'era')) return;
	const own = tagsFor(db, [artistId]).get(artistId) ?? [];
	const mbid = externalId(db, artistId, 'musicbrainz');
	const cached = cachedArtist(db, mbid);
	const ownGenres = own.filter((t) => t.facet === 'genre').map((t) => t.name);
	// Performers (e.g. Glenn Gould) fall through to the union of their releases' eras.
	if (cached?.type === 'Person' && cached.begin && isKnownComposer(db, mbid) && isClassical(ownGenres)) {
		const period = composerPeriod(cached.begin, cached.end);
		if (period) {
			setAutoTags(db, artistId, 'era', [period]);
			return;
		}
	}
	const children = db
		.select({ id: entities.id })
		.from(entities)
		.where(and(eq(entities.artistId, artistId), or(eq(entities.kind, 'album'), eq(entities.kind, 'track'))))
		.all()
		.map((c) => c.id);
	const eff = effectiveFor(db, children);
	const eras = new Set<string>();
	for (const id of children) {
		const era = eff.get(id)?.era;
		// Only eras the child has itself or from its album, not ones inherited from this artist.
		if (era && era.inheritedFrom?.entityId !== artistId) for (const t of era.tags) eras.add(t.name);
	}
	setAutoTags(db, artistId, 'era', [...eras]);
}
