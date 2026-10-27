/**
 * Live check: resolves a link (or searches text) against the real APIs and prints normalized JSON.
 *   npx tsx scripts/resolve-link.ts 'https://music.apple.com/us/album/kind-of-blue/268443092'
 *   npx tsx scripts/resolve-link.ts --album 'kind of blue'
 * Spotify is used when SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET are set.
 */
import { AppleProvider } from '../src/lib/server/providers/apple.ts';
import { resolveInput } from '../src/lib/server/providers/resolve.ts';
import { SpotifyProvider } from '../src/lib/server/providers/spotify.ts';

const args = process.argv.slice(2);
const kind = args.includes('--track') ? 'track' : 'album';
const input = args.filter((a) => !a.startsWith('--')).join(' ');
if (!input) {
	console.error('Usage: resolve-link.ts [--album|--track] <link or search text>');
	process.exit(1);
}

const { SPOTIFY_CLIENT_ID: clientId, SPOTIFY_CLIENT_SECRET: clientSecret } = process.env;
const providers = {
	apple: new AppleProvider(),
	spotify: clientId && clientSecret ? new SpotifyProvider({ clientId, clientSecret }) : null
};

const result = await resolveInput(input, providers);
if (result.type === 'text') {
	for (const p of [providers.apple, providers.spotify]) {
		if (p) console.log(p.name, JSON.stringify(await p.search(result.query, kind), null, 2));
	}
} else {
	console.log(JSON.stringify(result, null, 2));
}
