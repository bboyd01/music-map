import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.ts';
import { enrichment } from '#lib/server/enrich/index.ts';
import { requeueEnriched } from '#lib/server/enrich/pipeline.ts';
import type { RequestHandler } from './$types';

/** Re-runs enrichment for the whole library (manual tags and edges are kept). */
export const POST: RequestHandler = () => {
	const queued = requeueEnriched(getDb(), enrichment().enqueue);
	return json({ queued }, { status: 202 });
};
