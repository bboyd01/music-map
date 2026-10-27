import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getDb } from '#lib/server/db/index.ts';
import { enrichment } from '#lib/server/enrich/index.ts';
import { reviewSuggestion } from '#lib/server/enrich/suggestions.ts';
import { removeEdge } from '#lib/server/library/relations.ts';
import { idParam } from '#lib/server/params.ts';
import type { RequestHandler } from './$types';

const Body = z.object({ status: z.enum(['accepted', 'rejected']), addToList: z.boolean().optional() });

/** Accept or reject a suggested edge (`addToList` also puts album/track ends on the list). */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const body = Body.safeParse(await request.json().catch(() => null));
	if (!body.success) return json({ error: 'Expected { status, addToList? }' }, { status: 400 });
	const action = body.data.status === 'accepted' ? 'accept' : 'reject';
	const result = reviewSuggestion(getDb(), idParam(params.id), action, { addToList: body.data.addToList });
	if (!result.ok) return json({ error: 'Not found' }, { status: 404 });
	for (const id of result.toEnrich) enrichment().enqueue({ entityId: id });
	return json(result);
};

export const DELETE: RequestHandler = ({ params }) => {
	const result = removeEdge(getDb(), idParam(params.id));
	if (!result.removed) return json({ error: 'Not found' }, { status: 404 });
	return json(result);
};
