import { z } from 'zod';
import { normalizeReleaseDate } from '../../domain/normalize';
import { TtlCache, fetchJson, type FetchFn } from './http';
import { ProviderError, type ListKind, type MusicProvider, type NormalizedItem, type SearchResult } from './types';

const API = 'https://api.spotify.com/v1';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const ID = /^[0-9A-Za-z]{22}$/;

// Spotify has been trimming fields for new apps (e.g. genres, popularity), so anything not
// strictly needed is optional and parsing never depends on it.
const Image = z.object({ url: z.string(), width: z.number().nullish(), height: z.number().nullish() });
const Urls = z.object({ spotify: z.string().optional() }).optional();
const SimpleArtist = z.object({ id: z.string().nullish(), name: z.string(), external_urls: Urls });
const SimpleAlbum = z.object({
	id: z.string(),
	name: z.string(),
	album_type: z.string().optional(),
	artists: z.array(SimpleArtist).default([]),
	images: z.array(Image).default([]),
	release_date: z.string().nullish(),
	total_tracks: z.number().optional(),
	external_urls: Urls
});
const Album = SimpleAlbum.extend({
	genres: z.array(z.string()).optional(),
	external_ids: z.object({ upc: z.string().optional() }).partial().optional()
});
const Track = z.object({
	id: z.string(),
	name: z.string(),
	artists: z.array(SimpleArtist).default([]),
	album: SimpleAlbum.optional(),
	duration_ms: z.number().optional(),
	track_number: z.number().optional(),
	disc_number: z.number().optional(),
	external_ids: z.object({ isrc: z.string().optional() }).partial().optional(),
	external_urls: Urls
});
const Artist = z.object({
	id: z.string(),
	name: z.string(),
	genres: z.array(z.string()).optional(),
	images: z.array(Image).optional(),
	external_urls: Urls
});
const Page = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item.nullable()) });
const Search = z.object({ albums: Page(SimpleAlbum).optional(), tracks: Page(Track).optional() });
const Token = z.object({ access_token: z.string(), expires_in: z.number() });

/** Picks the smallest image at least `target` px wide, else the largest. */
export function pickImage(images: z.infer<typeof Image>[] | undefined, target = 600): string | undefined {
	if (!images?.length) return undefined;
	const sorted = [...images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
	return [...sorted].reverse().find((i) => (i.width ?? 0) >= target)?.url ?? sorted[0].url;
}

const artistRef = (artists: z.infer<typeof SimpleArtist>[]) => ({
	id: artists[0]?.id ?? undefined,
	name: artists[0]?.name ?? 'Unknown artist'
});

export interface TokenStore {
	get(): { token: string; expiresAt: number } | null;
	set(value: { token: string; expiresAt: number }): void;
}

export function memoryTokenStore(): TokenStore {
	let value: { token: string; expiresAt: number } | null = null;
	return { get: () => value, set: (v) => void (value = v) };
}

interface SpotifyOptions {
	clientId: string;
	clientSecret: string;
	tokenStore?: TokenStore;
	fetchImpl?: FetchFn;
	now?: () => number;
}

/** Spotify Web API via client credentials. Only uses /tracks, /albums, /artists and /search. */
export class SpotifyProvider implements MusicProvider {
	readonly name = 'spotify' as const;
	private fetchImpl: FetchFn;
	private tokens: TokenStore;
	private now: () => number;
	private cache = new TtlCache<unknown>(10 * 60 * 1000);

	constructor(private opts: SpotifyOptions) {
		this.fetchImpl = opts.fetchImpl ?? fetch;
		this.tokens = opts.tokenStore ?? memoryTokenStore();
		this.now = opts.now ?? Date.now;
	}

	private async token(force = false): Promise<string> {
		const cached = this.tokens.get();
		if (!force && cached && cached.expiresAt - 60_000 > this.now()) return cached.token;
		const basic = Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString('base64');
		const data = await fetchJson('spotify', TOKEN_URL, Token, {
			fetchImpl: this.fetchImpl,
			init: {
				method: 'POST',
				headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
				body: 'grant_type=client_credentials'
			}
		});
		if (!data) throw new ProviderError('spotify: token endpoint not found', 'spotify');
		this.tokens.set({ token: data.access_token, expiresAt: this.now() + data.expires_in * 1000 });
		return data.access_token;
	}

	private async get<T extends z.ZodType>(path: string, schema: T): Promise<z.infer<T> | null> {
		const url = `${API}${path}`;
		const hit = this.cache.get(url);
		if (hit !== undefined) return hit as z.infer<T> | null;
		const call = async (force: boolean) =>
			fetchJson('spotify', url, schema, {
				fetchImpl: this.fetchImpl,
				init: { headers: { authorization: `Bearer ${await this.token(force)}` } }
			});
		let data: z.infer<T> | null;
		try {
			data = await call(false);
		} catch (err) {
			// Token revoked or expired early: refresh once.
			if (!(err instanceof ProviderError && err.status === 401)) throw err;
			data = await call(true);
		}
		this.cache.set(url, data);
		return data;
	}

	async lookup({ kind, id }: { kind: NormalizedItem['kind']; id: string }): Promise<NormalizedItem | null> {
		if (!ID.test(id)) return null;
		if (kind === 'album') {
			const a = await this.get(`/albums/${id}`, Album);
			if (!a) return null;
			return {
				provider: 'spotify',
				kind: 'album',
				id: a.id,
				name: a.name,
				url: a.external_urls?.spotify,
				genres: a.genres ?? [],
				artworkUrl: pickImage(a.images),
				thumbUrl: pickImage(a.images, 200),
				artist: artistRef(a.artists),
				releaseDate: normalizeReleaseDate(a.release_date),
				trackCount: a.total_tracks,
				upc: a.external_ids?.upc
			};
		}
		if (kind === 'track') {
			const t = await this.get(`/tracks/${id}`, Track);
			if (!t) return null;
			return {
				provider: 'spotify',
				kind: 'track',
				id: t.id,
				name: t.name,
				url: t.external_urls?.spotify,
				genres: [],
				artworkUrl: pickImage(t.album?.images),
				thumbUrl: pickImage(t.album?.images, 200),
				artist: artistRef(t.artists),
				album: t.album ? { id: t.album.id, name: t.album.name } : undefined,
				releaseDate: normalizeReleaseDate(t.album?.release_date),
				durationMs: t.duration_ms,
				trackNumber: t.track_number,
				discNumber: t.disc_number,
				isrc: t.external_ids?.isrc
			};
		}
		const a = await this.get(`/artists/${id}`, Artist);
		if (!a) return null;
		return {
			provider: 'spotify',
			kind: 'artist',
			id: a.id,
			name: a.name,
			url: a.external_urls?.spotify,
			genres: a.genres ?? [],
			artworkUrl: pickImage(a.images),
			thumbUrl: pickImage(a.images, 200)
		};
	}

	async search(query: string, kind: ListKind, opts: { limit?: number } = {}): Promise<SearchResult[]> {
		const params = new URLSearchParams({ q: query, type: kind, limit: String(Math.min(opts.limit ?? 10, 10)) });
		const data = await this.get(`/search?${params}`, Search);
		if (kind === 'album') {
			return (data?.albums?.items ?? []).filter((a) => a !== null).map((a) => ({
				provider: 'spotify' as const,
				kind: 'album' as const,
				id: a.id,
				name: a.name,
				artistName: artistRef(a.artists).name,
				releaseDate: normalizeReleaseDate(a.release_date),
				artworkUrl: pickImage(a.images),
				url: a.external_urls?.spotify
			}));
		}
		return (data?.tracks?.items ?? []).filter((t) => t !== null).map((t) => ({
			provider: 'spotify' as const,
			kind: 'track' as const,
			id: t.id,
			name: t.name,
			artistName: artistRef(t.artists).name,
			albumName: t.album?.name,
			releaseDate: normalizeReleaseDate(t.album?.release_date),
			artworkUrl: pickImage(t.album?.images),
			url: t.external_urls?.spotify
		}));
	}
}
