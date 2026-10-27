import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getDb } from '#lib/server/db/index.ts';
import { removeEdge, setEdgeStatus } from '#lib/server/library/relations.ts';
import { idParam } from '#lib/server/params.ts';
import type { RequestHandler } from './$types';

const Body = z.object({ status: z.enum(['accepted', 'rejected']) });

/** Accept or reject a suggested edge. */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const body = Body.safeParse(await request.json().catch(() => null));
	if (!body.success) return json({ error: 'Expected { status }' }, { status: 400 });
	const edge = setEdgeStatus(getDb(), idParam(params.id), body.data.status);
	if (!edge) return json({ error: 'Not found' }, { status: 404 });
	return json({ edge });
};

export const DELETE: RequestHandler = ({ params }) => {
	const result = removeEdge(getDb(), idParam(params.id));
	if (!result.removed) return json({ error: 'Not found' }, { status: 404 });
	return json(result);
};
