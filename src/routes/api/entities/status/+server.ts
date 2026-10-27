import { json } from '@sveltejs/kit';
import { and, inArray } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.ts';
import { entities } from '#lib/server/db/schema.ts';
import type { RequestHandler } from './$types';

/** `?ids=1,2,3` → which of them are still being enriched. Cheap enough to poll. */
export const GET: RequestHandler = ({ url }) => {
	const ids = (url.searchParams.get('ids') ?? '')
		.split(',')
		.map(Number)
		.filter((n) => Number.isSafeInteger(n) && n > 0)
		.slice(0, 500);
	if (!ids.length) return json({ pending: [] });
	const rows = getDb()
		.select({ id: entities.id })
		.from(entities)
		.where(and(inArray(entities.id, ids), inArray(entities.enrichStatus, ['pending', 'running'])))
		.all();
	return json({ pending: rows.map((r) => r.id) });
};
