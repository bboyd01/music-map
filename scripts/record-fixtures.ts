/**
 * Records live provider responses into src/lib/server/providers/__fixtures__ for tests.
 * Only run manually (tests never hit live APIs):
 *   npx tsx scripts/record-fixtures.ts apple
 *   SPOTIFY_CLIENT_ID=… SPOTIFY_CLIENT_SECRET=… npx tsx scripts/record-fixtures.ts spotify
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openDb } from '../src/lib/server/db/client.ts';
import { createEnrichment } from '../src/lib/server/enrich/runner.ts';
import { commitAdd } from '../src/lib/server/library/service.ts';
import { AppleProvider } from '../src/lib/server/providers/apple.ts';
import { FIXTURE_DIR, recordingFetch, type Fixture } from '../src/lib/server/providers/fixtures.ts';
import { MusicBrainzClient } from '../src/lib/server/providers/musicbrainz.ts';

export const ENRICH_ADDS = [
	{ provider: 'apple', kind: 'album', id: '268443092', country: 'us' }, // Kind of Blue
	{ provider: 'apple', kind: 'track', id: '268443097', country: 'us' }, // So What
	{ provider: 'apple', kind: 'album', id: '476935391', country: 'us' } // Gould: Goldberg Variations (1981)
] as const;
export const MB_USER_AGENT = 'MusicMap/0.1 (https://github.com/bboyd01/music-map)';

/** Runs the real add + enrichment flow and records every request it makes. */
async function recordEnrichment() {
	const fetchImpl = recordingFetch();
	const db = openDb(':memory:');
	const artworkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-record-'));
	const providers = { apple: new AppleProvider({ fetchImpl }), spotify: null };
	const mb = new MusicBrainzClient({ userAgent: MB_USER_AGENT, fetchImpl });
	const { worker, enqueue } = createEnrichment({ db, mb, providers, artworkDir, fetchImpl, log: console.log });
	for (const ref of ENRICH_ADDS) {
		console.log(await commitAdd({ db, providers, artworkDir, fetchImpl, enqueueEnrich: enqueue }, ref));
		console.log('jobs run:', await worker.drain());
	}
	fs.writeFileSync(path.join(FIXTURE_DIR, 'enrich.json'), JSON.stringify(fetchImpl.recorded, null, '\t') + '\n');
	console.log(`recorded ${fetchImpl.recorded.length} exchanges`);
}

const APPLE = 'https://itunes.apple.com';
const SPOTIFY = 'https://api.spotify.com/v1';

const sets: Record<string, () => Promise<Record<string, string[]>>> = {
	apple: async () => ({
		'apple.json': [
			`${APPLE}/lookup?id=268443092&country=us`, // Kind of Blue (album)
			`${APPLE}/lookup?id=268443097&country=us`, // So What (track)
			`${APPLE}/lookup?id=44984&country=us`, // Miles Davis (artist)
			`${APPLE}/lookup?id=1440833098&country=gb`, // The Beatles – 1 (album, gb storefront)
			`${APPLE}/lookup?id=1&country=us`, // nothing
			`${APPLE}/search?term=kind+of+blue&media=music&entity=album&limit=15&country=us`,
			`${APPLE}/search?term=kind+of+blue&media=music&entity=song&limit=15&country=us`
		]
	}),
	spotify: async () => ({
		'spotify.json': [
			`${SPOTIFY}/albums/1weenld61qoidwYuZ1GESA`, // Kind of Blue
			`${SPOTIFY}/tracks/4vLYewWIvqHfKtJDk8c8tq`, // So What
			`${SPOTIFY}/artists/0kbYTNQb4Pb1rPbbaF0pT4`, // Miles Davis
			`${SPOTIFY}/search?q=kind+of+blue&type=album&limit=10`,
			`${SPOTIFY}/search?q=kind+of+blue&type=track&limit=10`
		]
	})
};

async function spotifyToken() {
	const id = process.env.SPOTIFY_CLIENT_ID;
	const secret = process.env.SPOTIFY_CLIENT_SECRET;
	if (!id || !secret) throw new Error('Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET');
	const res = await fetch('https://accounts.spotify.com/api/token', {
		method: 'POST',
		headers: {
			authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
			'content-type': 'application/x-www-form-urlencoded'
		},
		body: 'grant_type=client_credentials'
	});
	if (!res.ok) throw new Error(`Spotify token: HTTP ${res.status}`);
	return ((await res.json()) as { access_token: string }).access_token;
}

const which = process.argv[2];
if (which === 'enrich') {
	await recordEnrichment();
	process.exit(0);
}
if (!which || !(which in sets)) {
	console.error(`Usage: record-fixtures.ts <${Object.keys(sets).join('|')}|enrich>`);
	process.exit(1);
}
const headers: Record<string, string> = which === 'spotify' ? { authorization: `Bearer ${await spotifyToken()}` } : {};

for (const [file, urls] of Object.entries(await sets[which]())) {
	const fixtures: Fixture[] = [];
	for (const url of urls) {
		const res = await fetch(url, { headers });
		const text = await res.text();
		let body: unknown = text;
		try {
			body = JSON.parse(text);
		} catch {}
		console.log(res.status, url);
		fixtures.push({ request: { url }, status: res.status, body });
		await new Promise((r) => setTimeout(r, 3500)); // stay well under Apple's ~20/min
	}
	fs.writeFileSync(path.join(FIXTURE_DIR, file), JSON.stringify(fixtures, null, '\t') + '\n');
}
