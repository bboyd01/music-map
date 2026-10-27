import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getDb } from '#lib/server/db/index.ts';
import { mergeEntities } from '#lib/server/library/merge.ts';
import { idParam } from '#lib/server/params.ts';
import type { RequestHandler } from './$types';

const Body = z.object({ into: z.number().int().positive() });

/** Merges this entity into `into` and deletes it. */
export const POST: RequestHandler = async ({ params, request }) => {
	const body = Body.safeParse(await request.json().catch(() => null));
	if (!body.success) return json({ error: 'Expected { into }' }, { status: 400 });
	const result = mergeEntities(getDb(), idParam(params.id), body.data.into);
	if (!result.ok) return json({ error: result.message }, { status: result.status });
	return json({ id: result.id });
};
