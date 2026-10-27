import { z } from 'zod';
import { SlidingWindowLimiter, fetchJson, type FetchFn } from './http';

const QID = /^Q\d+$/;

const Claim = z.object({
	mainsnak: z.object({ datavalue: z.object({ value: z.unknown() }).nullish() })
});
const EntityData = z.object({
	entities: z.record(
		z.string(),
		z.object({
			id: z.string(),
			labels: z.record(z.string(), z.object({ value: z.string() })).default({}),
			claims: z.record(z.string(), z.array(Claim)).default({})
		})
	)
});

export interface WikidataEntity {
	qid: string;
	label?: string;
	/** P434: MusicBrainz artist ID. */
	mbid?: string;
	/** P737: influenced by. */
	influencedBy: string[];
}

const values = (claims: z.infer<typeof Claim>[] | undefined) => (claims ?? []).map((c) => c.mainsnak.datavalue?.value);

/**
 * Minimal Wikidata client. Uses Special:EntityData (served from cache), one entity per call,
 * at most 1 request/second, always with the app's User-Agent.
 */
export class WikidataClient {
	private fetchImpl: FetchFn;
	private limiter: SlidingWindowLimiter;

	constructor(private opts: { userAgent: string; fetchImpl?: FetchFn; limiter?: SlidingWindowLimiter }) {
		this.fetchImpl = opts.fetchImpl ?? fetch;
		this.limiter = opts.limiter ?? new SlidingWindowLimiter(1, 1000);
	}

	async entity(qid: string): Promise<WikidataEntity | null> {
		if (!QID.test(qid)) return null;
		await this.limiter.acquire();
		const data = await fetchJson('wikidata', `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`, EntityData, {
			fetchImpl: this.fetchImpl,
			init: { headers: { 'user-agent': this.opts.userAgent, accept: 'application/json' } },
			timeoutMs: 15_000
		});
		// Redirected (merged) items come back under their new id.
		const e = data && Object.values(data.entities)[0];
		if (!e) return null;
		const mbid = values(e.claims.P434).find((v): v is string => typeof v === 'string');
		return {
			qid: e.id,
			label: e.labels.en?.value ?? Object.values(e.labels)[0]?.value,
			mbid,
			influencedBy: values(e.claims.P737)
				.map((v) => (v as { id?: string } | undefined)?.id)
				.filter((id): id is string => !!id && QID.test(id))
		};
	}

	/** Influences of an artist that are themselves musicians (have a MusicBrainz id). */
	async influencesOf(qid: string, max = 10): Promise<(WikidataEntity & { mbid: string; label: string })[]> {
		const artist = await this.entity(qid);
		const out: (WikidataEntity & { mbid: string; label: string })[] = [];
		for (const id of artist?.influencedBy.slice(0, max) ?? []) {
			const e = await this.entity(id);
			if (e?.mbid && e.label) out.push(e as WikidataEntity & { mbid: string; label: string });
		}
		return out;
	}
}
