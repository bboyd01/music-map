import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.ts';
import { EdgeInput, addEdge } from '#lib/server/library/relations.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const body = EdgeInput.safeParse(await request.json().catch(() => null));
	if (!body.success) return json({ error: 'Expected { type, from, to, note? }' }, { status: 400 });
	const result = addEdge(getDb(), body.data);
	if (!result.ok) return json({ error: result.message }, { status: result.status });
	return json({ edge: result.edge }, { status: result.created ? 201 : 200 });
};
