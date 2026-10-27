import { eq, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { LASTFM_API_KEY, MB_USER_AGENT } from '$app/env/private';
import { splitArtists } from '../../domain/matching.ts';
import { artworkDir, getDb } from '../db/index.ts';
import { entities, kv } from '../db/schema.ts';
import { LastfmClient } from '../providers/lastfm.ts';
import { MusicBrainzClient } from '../providers/musicbrainz.ts';
import { WikidataClient } from '../providers/wikidata.ts';
import { getProviders } from '../providers/index.ts';
import { requeueEnriched } from './pipeline.ts';
import { createEnrichment } from './runner.ts';
import { seedEras } from './tags.ts';

let instance: ReturnType<typeof createEnrichment> | undefined;

/** The app's enrichment worker (created lazily, started from hooks.server.ts `init`). */
export function enrichment() {
	if (!instance) {
		const log = (msg: string) => console.warn(`[enrich] ${msg}`);
		if (!MB_USER_AGENT) log('MB_USER_AGENT is not set: MusicBrainz enrichment is disabled');
		instance = createEnrichment({
			db: getDb(),
			mb: MB_USER_AGENT ? new MusicBrainzClient({ userAgent: MB_USER_AGENT }) : null,
			// Wikimedia also asks for a descriptive User-Agent with contact info.
			wikidata: MB_USER_AGENT ? new WikidataClient({ userAgent: MB_USER_AGENT }) : null,
			lastfm: LASTFM_API_KEY ? new LastfmClient({ apiKey: LASTFM_API_KEY }) : null,
			providers: getProviders(),
			artworkDir,
			log
		});
	}
	return instance;
}

export function startEnrichment() {
	const db = getDb();
	seedEras(db);
	if (MB_USER_AGENT) {
		once('backfill:credits', () => backfillCredits());
		// Items enriched before MusicBrainz was configured only got provider genres and a decade.
		once('backfill:musicbrainz', () => requeueEnriched(db, enrichment().enqueue, { missingMusicBrainz: true }));
	}
	enrichment().worker.start();
}

function once(key: string, run: () => void) {
	const db = getDb();
	if (db.select().from(kv).where(eq(kv.key, key)).get()) return;
	run();
	db.insert(kv).values({ key, value: new Date().toISOString() }).run();
}

/** Re-enriches releases credited to combined artists so they get split into separate ones. */
function backfillCredits() {
	const artist = alias(entities, 'artist');
	const rows = getDb()
		.select({ id: entities.id, artistName: artist.name })
		.from(entities)
		.innerJoin(artist, eq(artist.id, entities.artistId))
		.where(ne(entities.kind, 'artist'))
		.all();
	for (const r of rows) if (splitArtists(r.artistName).length > 1) enrichment().enqueue({ entityId: r.id });
}
