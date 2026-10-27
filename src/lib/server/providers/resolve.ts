import type { FetchFn } from './http';
import { parseLink } from './link';
import { resolveSpotifyShortLink } from './shortlink';
import { PROVIDER_LABEL as LABEL, ProviderError, type MusicProvider, type NormalizedItem, type ProviderRef } from './types';

export interface Providers {
	apple: MusicProvider;
	/** null when SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET aren't set. */
	spotify: MusicProvider | null;
}

type Resolved =
	| { type: 'item'; ref: ProviderRef; item: NormalizedItem }
	| { type: 'text'; query: string }
	| { type: 'error'; message: string };

export const SPOTIFY_DISABLED =
	"Spotify isn't set up on this server (SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET). Use an Apple Music link or search instead.";

/** Resolves pasted input to normalized metadata, a search query, or a user-facing error. */
export async function resolveInput(
	input: string,
	providers: Providers,
	{ fetchImpl }: { fetchImpl?: FetchFn } = {}
): Promise<Resolved> {
	let parsed = parseLink(input);
	if (parsed.type === 'text') {
		return parsed.query ? parsed : { type: 'error', message: 'Paste a link or type something to search.' };
	}
	if (parsed.type === 'unsupported') return { type: 'error', message: parsed.error };
	if (parsed.provider === 'spotify' && !providers.spotify) return { type: 'error', message: SPOTIFY_DISABLED };

	if (parsed.type === 'shortlink') {
		try {
			parsed = await resolveSpotifyShortLink(parsed.url, { fetchImpl });
		} catch {
			return { type: 'error', message: "Couldn't reach Spotify to resolve that short link. Try again in a moment." };
		}
		if (parsed.type !== 'item') {
			return { type: 'error', message: parsed.type === 'unsupported' ? parsed.error : 'Unsupported link.' };
		}
	}
	if (parsed.type !== 'item') return { type: 'error', message: 'Unsupported link.' };

	const provider = parsed.provider === 'apple' ? providers.apple : providers.spotify!;
	const ref: ProviderRef = {
		provider: parsed.provider,
		kind: parsed.kind,
		id: parsed.id,
		country: parsed.provider === 'apple' ? parsed.country : undefined
	};
	try {
		const item = await provider.lookup(ref);
		if (!item) return { type: 'error', message: `Couldn't find that ${parsed.kind} on ${LABEL[parsed.provider]}.` };
		return { type: 'item', ref, item };
	} catch (err) {
		if (!(err instanceof ProviderError)) throw err;
		const busy = err.status === 429 || err.status === 403;
		return {
			type: 'error',
			message: `${LABEL[parsed.provider]} ${busy ? 'is rate-limiting requests' : "didn't respond"}. Try again in a moment.`
		};
	}
}
