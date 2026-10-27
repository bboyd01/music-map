import type { DB } from '../db/client';
import { enqueue } from '../jobs/queue';
import { Worker } from '../jobs/worker';
import { enrichEntity, markEnrichFailed, type EnrichDeps, type EnrichPayload } from './pipeline';
import { generateSuggestions, type SuggestDeps, type SuggestPayload } from './suggestions';

/** Builds the job worker with enrich/suggest handlers; the returned queue functions also wake it. */
export function createEnrichment(
	deps: Omit<EnrichDeps, 'enqueue' | 'suggest'> & Partial<Pick<SuggestDeps, 'wikidata' | 'lastfm'>> & { db: DB }
) {
	let worker: Worker;
	const suggestDeps: SuggestDeps = { db: deps.db, wikidata: deps.wikidata ?? null, lastfm: deps.lastfm ?? null, log: deps.log };
	const queue = (payload: EnrichPayload) => {
		enqueue(deps.db, 'enrich', { ...payload });
		worker?.notify();
	};
	const suggest = (payload: SuggestPayload) => {
		enqueue(deps.db, 'suggest', { ...payload });
		worker?.notify();
	};
	const full: EnrichDeps = { ...deps, enqueue: queue, suggest };
	worker = new Worker(
		deps.db,
		{
			enrich: (job) => enrichEntity(full, job.payload as unknown as EnrichPayload),
			suggest: async (job) => void (await generateSuggestions(suggestDeps, job.payload as unknown as SuggestPayload))
		},
		{
			log: deps.log,
			onFailed: (job) => {
				const id = (job.payload as { entityId?: number }).entityId;
				if (job.type === 'enrich' && id !== undefined) markEnrichFailed(deps.db, id);
			}
		}
	);
	return { worker, enqueue: queue, suggest, deps: full };
}
