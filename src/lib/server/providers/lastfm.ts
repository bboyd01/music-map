import { z } from 'zod';
import { SlidingWindowLimiter, fetchJson, type FetchFn } from './http';

const Similar = z.object({
	similarartists: z
		.object({
			artist: z
				.array(z.object({ name: z.string(), mbid: z.string().nullish(), match: z.coerce.number().default(0) }))
				.default([])
		})
		.optional()
});

/** Optional Last.fm client: `artist.getSimilar` only. */
export class LastfmClient {
	private fetchImpl: FetchFn;
	private limiter = new SlidingWindowLimiter(5, 1000);

	constructor(private opts: { apiKey: string; fetchImpl?: FetchFn }) {
		this.fetchImpl = opts.fetchImpl ?? fetch;
	}

	async similarArtists(name: string, mbid?: string, { limit = 5, minMatch = 0.5 } = {}) {
		const params = new URLSearchParams({ method: 'artist.getsimilar', api_key: this.opts.apiKey, format: 'json', limit: '20' });
		if (mbid) params.set('mbid', mbid);
		else params.set('artist', name);
		await this.limiter.acquire();
		const data = await fetchJson('lastfm', `https://ws.audioscrobbler.com/2.0/?${params}`, Similar, { fetchImpl: this.fetchImpl });
		return (data?.similarartists?.artist ?? [])
			.filter((a) => a.match >= minMatch)
			.slice(0, limit)
			.map((a) => ({ name: a.name, mbid: a.mbid || undefined, match: a.match }));
	}
}
