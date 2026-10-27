import { z } from 'zod';
import { normalizeReleaseDate } from '../../domain/normalize';
import { SlidingWindowLimiter, TtlCache, fetchJson, type FetchFn } from './http';
import type { ListKind, MusicProvider, NormalizedItem, SearchResult } from './types';

const BASE = 'https://itunes.apple.com';

const Result = z.object({
	wrapperType: z.string(),
	kind: z.string().optional(),
	collectionType: z.string().optional(),
	artistType: z.string().optional(),
	artistId: z.number().optional(),
	artistName: z.string().optional(),
	collectionId: z.number().optional(),
	collectionName: z.string().optional(),
	trackId: z.number().optional(),
	trackName: z.string().optional(),
	artistLinkUrl: z.string().optional(),
	artistViewUrl: z.string().optional(),
	collectionViewUrl: z.string().optional(),
	trackViewUrl: z.string().optional(),
	artworkUrl100: z.string().optional(),
	releaseDate: z.string().optional(),
	trackCount: z.number().optional(),
	trackNumber: z.number().optional(),
	discNumber: z.number().optional(),
	trackTimeMillis: z.number().optional(),
	primaryGenreName: z.string().optional()
});
type Result = z.infer<typeof Result>;

const Response = z.object({ resultCount: z.number(), results: z.array(Result) });

/** iTunes artwork URLs end in e.g. `/100x100bb.jpg`; any size can be requested. */
export function appleArtworkUrl(url: string | undefined, size = 600): string | undefined {
	if (!url) return undefined;
	return url.replace(/\/\d+x\d+(bb|cc|sr)?\.(jpg|jpeg|png|webp)$/i, `/${size}x${size}bb.jpg`);
}

/** Drops Apple's affiliate/tracking `uo` parameter from view URLs. */
function cleanUrl(url: string | undefined): string | undefined {
	if (!url) return undefined;
	try {
		const u = new URL(url);
		u.searchParams.delete('uo');
		return u.href;
	} catch {
		return url;
	}
}

const str = (n: number | undefined) => (n === undefined ? undefined : String(n));
const genres = (r: Result) => (r.primaryGenreName ? [r.primaryGenreName] : []);

function toItem(r: Result): NormalizedItem | null {
	if (r.wrapperType === 'artist' && r.artistId && r.artistName) {
		return {
			provider: 'apple',
			kind: 'artist',
			id: String(r.artistId),
			name: r.artistName,
			url: cleanUrl(r.artistLinkUrl ?? r.artistViewUrl),
			genres: genres(r)
		};
	}
	if (r.wrapperType === 'collection' && r.collectionId && r.collectionName) {
		return {
			provider: 'apple',
			kind: 'album',
			id: String(r.collectionId),
			name: r.collectionName,
			url: cleanUrl(r.collectionViewUrl),
			genres: genres(r),
			artworkUrl: appleArtworkUrl(r.artworkUrl100),
			artist: { id: str(r.artistId), name: r.artistName ?? 'Unknown artist' },
			releaseDate: normalizeReleaseDate(r.releaseDate),
			trackCount: r.trackCount
		};
	}
	if (r.wrapperType === 'track' && r.kind === 'song' && r.trackId && r.trackName) {
		return {
			provider: 'apple',
			kind: 'track',
			id: String(r.trackId),
			name: r.trackName,
			url: cleanUrl(r.trackViewUrl),
			genres: genres(r),
			artworkUrl: appleArtworkUrl(r.artworkUrl100),
			artist: { id: str(r.artistId), name: r.artistName ?? 'Unknown artist' },
			album: r.collectionName ? { id: str(r.collectionId), name: r.collectionName } : undefined,
			releaseDate: normalizeReleaseDate(r.releaseDate),
			durationMs: r.trackTimeMillis,
			trackNumber: r.trackNumber,
			discNumber: r.discNumber
		};
	}
	return null;
}

interface AppleOptions {
	fetchImpl?: FetchFn;
	/** Default storefront when a link doesn't carry one. */
	country?: string;
	limiter?: SlidingWindowLimiter;
}

/** iTunes Lookup/Search API. No key; ~20 req/min is the commonly cited limit. */
export class AppleProvider implements MusicProvider {
	readonly name = 'apple' as const;
	private fetchImpl: FetchFn;
	private country: string;
	private limiter: SlidingWindowLimiter;
	private cache = new TtlCache<z.infer<typeof Response> | null>(10 * 60 * 1000);

	constructor(opts: AppleOptions = {}) {
		this.fetchImpl = opts.fetchImpl ?? fetch;
		this.country = opts.country ?? 'us';
		this.limiter = opts.limiter ?? new SlidingWindowLimiter(20, 60_000);
	}

	private get(path: string, params: Record<string, string>) {
		const url = `${BASE}/${path}?${new URLSearchParams(params)}`;
		return this.cache.getOrSet(url, async () => {
			await this.limiter.acquire();
			return fetchJson('apple', url, Response, { fetchImpl: this.fetchImpl });
		});
	}

	async lookup({ kind, id, country }: { kind: NormalizedItem['kind']; id: string; country?: string }) {
		if (!/^\d+$/.test(id)) return null;
		const data = await this.get('lookup', { id, country: country ?? this.country });
		const item = data?.results.map(toItem).find((i) => i?.id === id);
		return item && item.kind === kind ? item : null;
	}

	async search(query: string, kind: ListKind, opts: { limit?: number; country?: string } = {}) {
		const data = await this.get('search', {
			term: query,
			media: 'music',
			entity: kind === 'album' ? 'album' : 'song',
			limit: String(opts.limit ?? 15),
			country: opts.country ?? this.country
		});
		const results: SearchResult[] = [];
		for (const r of data?.results ?? []) {
			const item = toItem(r);
			if (!item || item.kind !== kind) continue;
			results.push({
				provider: 'apple',
				kind,
				id: item.id,
				name: item.name,
				artistName: item.artist.name,
				albumName: item.kind === 'track' ? item.album?.name : undefined,
				releaseDate: item.releaseDate,
				artworkUrl: item.artworkUrl,
				url: item.url
			});
		}
		return results;
	}
}
