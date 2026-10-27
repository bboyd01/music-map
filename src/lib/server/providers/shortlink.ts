import type { FetchFn } from './http';
import { parseLink, SPOTIFY_SHORT_HOSTS, type ParsedLink } from './link';
import { ProviderError } from './types';

const ALLOWED_HOSTS = new Set([...SPOTIFY_SHORT_HOSTS, 'open.spotify.com']);
const MAX_HOPS = 5;
const MAX_BODY = 256 * 1024;
const OPEN_URL = /https:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:track|album|artist)\/[0-9A-Za-z]{22}/;

function allowed(url: URL) {
	return url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname.toLowerCase());
}

async function readCapped(res: Response): Promise<string> {
	const reader = res.body?.getReader();
	if (!reader) return '';
	const decoder = new TextDecoder();
	let text = '';
	while (text.length < MAX_BODY) {
		const { done, value } = await reader.read();
		if (done) break;
		text += decoder.decode(value, { stream: true });
	}
	await reader.cancel().catch(() => {});
	return text;
}

/**
 * Follows a spotify.link short URL to the open.spotify.com item it points at. Every hop must stay
 * on Spotify's hosts (no SSRF), and the whole thing is bounded by a timeout. Branch landing pages
 * that redirect via HTML are handled by scanning the page for the open.spotify.com URL.
 */
export async function resolveSpotifyShortLink(
	shortUrl: string,
	{ fetchImpl = fetch, timeoutMs = 5000 }: { fetchImpl?: FetchFn; timeoutMs?: number } = {}
): Promise<ParsedLink> {
	const signal = AbortSignal.timeout(timeoutMs);
	let url = new URL(shortUrl);
	for (let hop = 0; hop <= MAX_HOPS; hop++) {
		if (!allowed(url)) break;
		if (url.hostname === 'open.spotify.com') return parseLink(url.href);

		let res: Response;
		try {
			res = await fetchImpl(url.href, { redirect: 'manual', signal, headers: { accept: 'text/html' } });
		} catch {
			throw new ProviderError('spotify: could not resolve short link', 'spotify');
		}
		const location = res.headers.get('location');
		if (res.status >= 300 && res.status < 400 && location) {
			url = new URL(location, url);
			continue;
		}
		if (res.ok) {
			const found = OPEN_URL.exec(await readCapped(res));
			if (found) return parseLink(found[0]);
		}
		break;
	}
	return { type: 'unsupported', error: "Couldn't resolve that Spotify short link. Try the full open.spotify.com link." };
}
