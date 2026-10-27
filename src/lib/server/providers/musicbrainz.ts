import { z } from 'zod';
import { SlidingWindowLimiter, TtlCache, fetchJson, type FetchFn } from './http';
import { ProviderError } from './types';

const BASE = 'https://musicbrainz.org/ws/2';

/** MusicBrainz allows 1 request/second per client. One limiter for the whole process. */
export const mbLimiter = new SlidingWindowLimiter(1, 1000);

const ArtistCredit = z.array(
	z.object({ name: z.string(), artist: z.object({ id: z.string(), name: z.string(), type: z.string().nullish() }) })
);
const Genre = z.object({ name: z.string(), count: z.number().default(0) });
const LifeSpan = z.object({ begin: z.string().nullish(), end: z.string().nullish() }).partial();

const RgSearch = z.object({
	'release-groups': z.array(
		z.object({
			id: z.string(),
			score: z.number().default(0),
			title: z.string(),
			'first-release-date': z.string().nullish(),
			'primary-type': z.string().nullish(),
			'secondary-types': z.array(z.string()).nullish(),
			'artist-credit': ArtistCredit.default([])
		})
	)
});

const ReleaseGroup = z.object({
	id: z.string(),
	title: z.string(),
	'first-release-date': z.string().nullish(),
	genres: z.array(Genre).default([]),
	'artist-credit': ArtistCredit.default([]),
	releases: z
		.array(
			z.object({
				id: z.string(),
				date: z.string().nullish(),
				status: z.string().nullish(),
				media: z.array(z.object({ 'track-count': z.number().nullish() })).default([])
			})
		)
		.default([])
});

const Relation = z.object({
	type: z.string(),
	'target-type': z.string().nullish(),
	attributes: z.array(z.string()).default([]),
	artist: z.object({ id: z.string(), name: z.string() }).nullish(),
	work: z
		.object({
			id: z.string(),
			title: z.string(),
			relations: z.array(z.lazy((): z.ZodType => Relation)).default([])
		})
		.nullish()
});
type Relation = z.infer<typeof Relation>;

const Release = z.object({
	id: z.string(),
	title: z.string(),
	'cover-art-archive': z.object({ front: z.boolean().default(false) }).partial().nullish(),
	'artist-credit': ArtistCredit.default([]),
	media: z
		.array(
			z.object({
				tracks: z
					.array(
						z.object({
							title: z.string(),
							position: z.number().nullish(),
							recording: z.object({
								id: z.string(),
								title: z.string(),
								length: z.number().nullish(),
								isrcs: z.array(z.string()).default([]),
								relations: z.array(Relation).default([])
							})
						})
					)
					.default([])
			})
		)
		.default([])
});

const Artist = z.object({
	id: z.string(),
	name: z.string(),
	type: z.string().nullish(),
	'life-span': LifeSpan.nullish(),
	genres: z.array(Genre).default([])
});

const ArtistSearch = z.object({
	artists: z.array(z.object({ id: z.string(), name: z.string(), score: z.number().default(0), type: z.string().nullish() }))
});

export interface MbPerformer {
	artistId: string;
	name: string;
	instruments: string[];
}

export interface MbRecording {
	id: string;
	title: string;
	lengthMs?: number;
	isrcs: string[];
	performers: MbPerformer[];
	composers: { id: string; name: string }[];
}

export interface MbArtist {
	id: string;
	name: string;
	type?: string;
	begin?: string;
	end?: string;
	genres: { name: string; count: number }[];
}

const credit = (c: z.infer<typeof ArtistCredit>) => c.map((a) => ({ id: a.artist.id, name: a.artist.name, credited: a.name }));

/** Lucene-escapes a value for a MusicBrainz search query. */
export function luceneEscape(s: string): string {
	return s.replace(/([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g, '\\$1');
}

function performersOf(relations: Relation[]): MbPerformer[] {
	const byArtist = new Map<string, MbPerformer>();
	for (const r of relations) {
		if (r['target-type'] !== 'artist' || !r.artist) continue;
		const instruments = r.type === 'instrument' ? r.attributes : r.type === 'vocal' ? ['vocals'] : [];
		if (!instruments.length) continue;
		const p = byArtist.get(r.artist.id) ?? { artistId: r.artist.id, name: r.artist.name, instruments: [] };
		p.instruments.push(...instruments);
		byArtist.set(r.artist.id, p);
	}
	return [...byArtist.values()];
}

function composersOf(relations: Relation[]) {
	const out: { id: string; name: string }[] = [];
	for (const r of relations) {
		if (r['target-type'] !== 'work' || !r.work) continue;
		for (const w of r.work.relations as Relation[]) {
			if (w.type === 'composer' && w.artist && !out.some((c) => c.id === w.artist!.id)) out.push(w.artist);
		}
	}
	return out;
}

export interface MusicBrainzOptions {
	userAgent: string;
	fetchImpl?: FetchFn;
	limiter?: SlidingWindowLimiter;
	/** Wait before the single retry after a 503 (MusicBrainz' rate-limit response). */
	retryDelayMs?: number;
}

export class MusicBrainzClient {
	private fetchImpl: FetchFn;
	private limiter: SlidingWindowLimiter;
	private cache = new TtlCache<unknown>(60 * 60 * 1000, 300);

	constructor(private opts: MusicBrainzOptions) {
		if (!opts.userAgent) throw new Error('MusicBrainz requires a User-Agent (MB_USER_AGENT)');
		this.fetchImpl = opts.fetchImpl ?? fetch;
		this.limiter = opts.limiter ?? mbLimiter;
	}

	private async get<T extends z.ZodType>(path: string, params: Record<string, string>, schema: T): Promise<z.infer<T> | null> {
		const url = `${BASE}/${path}?${new URLSearchParams({ ...params, fmt: 'json' })}`;
		const hit = this.cache.get(url);
		if (hit !== undefined) return hit as z.infer<T> | null;
		const init = { headers: { 'user-agent': this.opts.userAgent, accept: 'application/json' } };
		const call = async () => {
			await this.limiter.acquire();
			return fetchJson('musicbrainz', url, schema, { fetchImpl: this.fetchImpl, init, timeoutMs: 15_000 });
		};
		let data: z.infer<T> | null;
		try {
			data = await call();
		} catch (err) {
			if (!(err instanceof ProviderError && err.status === 503)) throw err;
			await new Promise((r) => setTimeout(r, this.opts.retryDelayMs ?? 2000));
			data = await call();
		}
		this.cache.set(url, data);
		return data;
	}

	async searchReleaseGroups(title: string, artist: string) {
		const query = `releasegroup:(${luceneEscape(title)}) AND artist:"${luceneEscape(artist)}"`;
		const data = await this.get('release-group/', { query, limit: '10' }, RgSearch);
		return (data?.['release-groups'] ?? []).map((g) => ({
			id: g.id,
			title: g.title,
			score: g.score,
			firstReleaseDate: g['first-release-date'] ?? undefined,
			primaryType: g['primary-type'] ?? undefined,
			secondaryTypes: g['secondary-types'] ?? [],
			artists: credit(g['artist-credit'])
		}));
	}

	async getReleaseGroup(id: string) {
		const g = await this.get(`release-group/${id}`, { inc: 'genres+artist-credits+releases+media' }, ReleaseGroup);
		if (!g) return null;
		return {
			id: g.id,
			title: g.title,
			firstReleaseDate: g['first-release-date'] ?? undefined,
			genres: g.genres,
			artists: credit(g['artist-credit']),
			releases: g.releases.map((r) => ({
				id: r.id,
				date: r.date ?? undefined,
				status: r.status ?? undefined,
				trackCount: r.media.reduce((n, m) => n + (m['track-count'] ?? 0), 0)
			}))
		};
	}

	async getRelease(id: string) {
		const r = await this.get(
			`release/${id}`,
			{ inc: 'artist-credits+recordings+isrcs+recording-level-rels+work-rels+work-level-rels+artist-rels' },
			Release
		);
		if (!r) return null;
		const recordings: MbRecording[] = r.media.flatMap((m) =>
			m.tracks.map((t) => ({
				id: t.recording.id,
				title: t.recording.title,
				lengthMs: t.recording.length ?? undefined,
				isrcs: t.recording.isrcs,
				performers: performersOf(t.recording.relations),
				composers: composersOf(t.recording.relations)
			}))
		);
		return { id: r.id, title: r.title, hasFrontCover: r['cover-art-archive']?.front ?? false, artists: credit(r['artist-credit']), recordings };
	}

	async getArtist(id: string): Promise<MbArtist | null> {
		const a = await this.get(`artist/${id}`, { inc: 'genres' }, Artist);
		if (!a) return null;
		return {
			id: a.id,
			name: a.name,
			type: a.type ?? undefined,
			begin: a['life-span']?.begin ?? undefined,
			end: a['life-span']?.end ?? undefined,
			genres: a.genres
		};
	}

	async searchArtists(name: string) {
		const data = await this.get('artist/', { query: `artist:"${luceneEscape(name)}"`, limit: '5' }, ArtistSearch);
		return data?.artists.map((a) => ({ id: a.id, name: a.name, score: a.score, type: a.type ?? undefined })) ?? [];
	}
}
