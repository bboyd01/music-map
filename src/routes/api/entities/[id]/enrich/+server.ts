import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.ts';
import { entities } from '#lib/server/db/schema.ts';
import { enrichment } from '#lib/server/enrich/index.ts';
import type { RequestHandler } from './$types';

/** Re-runs enrichment for one entity (manual tags are kept). */
export const POST: RequestHandler = ({ params }) => {
	const id = Number(params.id);
	if (!Number.isSafeInteger(id) || id <= 0) error(404, 'Not found');
	const db = getDb();
	const updated = db.update(entities).set({ enrichStatus: 'pending' }).where(eq(entities.id, id)).run();
	if (!updated.changes) return json({ error: 'Not found' }, { status: 404 });
	enrichment().enqueue({ entityId: id });
	return json({ queued: true }, { status: 202 });
};
