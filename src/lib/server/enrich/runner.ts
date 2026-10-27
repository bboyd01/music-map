import type { DB } from '../db/client';
import { enqueue } from '../jobs/queue';
import { Worker } from '../jobs/worker';
import { enrichEntity, markEnrichFailed, type EnrichDeps, type EnrichPayload } from './pipeline';

/** Builds the job worker with enrichment handlers; `enqueue` here also wakes the worker. */
export function createEnrichment(deps: Omit<EnrichDeps, 'enqueue'> & { db: DB }) {
	let worker: Worker;
	const queue = (payload: EnrichPayload) => {
		enqueue(deps.db, 'enrich', { ...payload });
		worker?.notify();
	};
	const full: EnrichDeps = { ...deps, enqueue: queue };
	worker = new Worker(
		deps.db,
		{ enrich: (job) => enrichEntity(full, job.payload as unknown as EnrichPayload) },
		{
			log: deps.log,
			onFailed: (job) => {
				const id = (job.payload as { entityId?: number }).entityId;
				if (id !== undefined) markEnrichFailed(deps.db, id);
			}
		}
	);
	return { worker, enqueue: queue, deps: full };
}
