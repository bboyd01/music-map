import { LASTFM_API_KEY, MB_USER_AGENT } from '$app/env/private';
import { artworkDir, getDb } from '../db/index.ts';
import { LastfmClient } from '../providers/lastfm.ts';
import { MusicBrainzClient } from '../providers/musicbrainz.ts';
import { WikidataClient } from '../providers/wikidata.ts';
import { getProviders } from '../providers/index.ts';
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
	seedEras(getDb());
	enrichment().worker.start();
}
