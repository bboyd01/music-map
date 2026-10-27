import type { EntityKind } from './types';

export type ParsedLink =
	| { type: 'item'; provider: 'apple'; kind: EntityKind; id: string; country?: string }
	| { type: 'item'; provider: 'spotify'; kind: EntityKind; id: string }
	/** spotify.link short URL; must be resolved over the network (see shortlink.ts). */
	| { type: 'shortlink'; provider: 'spotify'; url: string }
	| { type: 'unsupported'; error: string }
	/** Input has no URL in it: treat it as a search query. */
	| { type: 'text'; query: string };

const APPLE_HOSTS = new Set(['music.apple.com', 'geo.music.apple.com', 'embed.music.apple.com', 'itunes.apple.com']);
const SPOTIFY_HOSTS = new Set(['open.spotify.com', 'play.spotify.com']);
export const SPOTIFY_SHORT_HOSTS = new Set(['spotify.link', 'spotify.app.link']);

const SPOTIFY_ID = /^[0-9A-Za-z]{22}$/;
const SPOTIFY_URI = /^spotify:(track|album|artist):([0-9A-Za-z]{22})$/;
const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/i;
const BARE_HOST = /^(?:[a-z0-9-]+\.)*(?:apple\.com|spotify\.com|spotify\.link|spotify\.app\.link)\//i;

const unsupported = (error: string): ParsedLink => ({ type: 'unsupported', error });
const UNSUPPORTED_GENERIC =
	'Unsupported link. Paste an Apple Music or Spotify link to a song, album, or artist.';

/** Turns pasted input into a provider reference, a search query, or a clear error. Pure. */
export function parseLink(input: string): ParsedLink {
	const text = input.trim();
	const uri = SPOTIFY_URI.exec(text);
	if (uri) return { type: 'item', provider: 'spotify', kind: uri[1] as EntityKind, id: uri[2] };
	if (/^spotify:/i.test(text)) return unsupported('Unsupported Spotify URI. Use a track, album, or artist.');

	const found = URL_IN_TEXT.exec(text)?.[0] ?? (BARE_HOST.test(text) ? `https://${text.split(/\s/)[0]}` : null);
	if (!found) return { type: 'text', query: text };

	let url: URL;
	try {
		url = new URL(found.replace(/[).,!?]+$/, ''));
	} catch {
		return unsupported(UNSUPPORTED_GENERIC);
	}
	const host = url.hostname.toLowerCase().replace(/^www\./, '');
	if (APPLE_HOSTS.has(host)) return parseApple(url);
	if (SPOTIFY_HOSTS.has(host)) return parseSpotify(url);
	if (SPOTIFY_SHORT_HOSTS.has(host) && url.pathname.length > 1) {
		return { type: 'shortlink', provider: 'spotify', url: url.href };
	}
	return unsupported(UNSUPPORTED_GENERIC);
}

function parseApple(url: URL): ParsedLink {
	const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
	let country: string | undefined;
	if (parts[0] && /^[a-z]{2}$/i.test(parts[0])) country = parts.shift()!.toLowerCase();

	const type = parts.shift();
	const idMatch = /^(?:id)?(\d+)$/.exec(parts.at(-1) ?? '');
	const kindByType: Record<string, EntityKind> = { album: 'album', song: 'track', artist: 'artist' };
	if (!type || !(type in kindByType)) {
		const what = type ? type.replace(/-/g, ' ') : 'this page';
		return unsupported(`Apple Music ${what} links aren't supported. Use a song, album, or artist link.`);
	}
	if (!idMatch) return unsupported('That Apple Music link is missing its ID.');

	const trackId = url.searchParams.get('i');
	if (type === 'album' && trackId) {
		if (!/^\d+$/.test(trackId)) return unsupported('That Apple Music link has an invalid track ID.');
		return { type: 'item', provider: 'apple', kind: 'track', id: trackId, country };
	}
	return { type: 'item', provider: 'apple', kind: kindByType[type], id: idMatch[1], country };
}

function parseSpotify(url: URL): ParsedLink {
	const parts = url.pathname.split('/').filter(Boolean);
	while (parts[0] && (/^intl-[a-z]{2}(?:-[a-z]{2})?$/i.test(parts[0]) || parts[0] === 'embed')) parts.shift();
	const [type, id] = parts;
	if (type !== 'track' && type !== 'album' && type !== 'artist') {
		const what = type ? `${type} ` : '';
		return unsupported(`Spotify ${what}links aren't supported. Use a track, album, or artist link.`);
	}
	if (!id || !SPOTIFY_ID.test(id)) return unsupported('That Spotify link has an invalid ID.');
	return { type: 'item', provider: 'spotify', kind: type, id };
}
