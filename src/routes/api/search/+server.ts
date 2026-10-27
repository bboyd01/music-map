import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getDb } from '#lib/server/db/index.ts';
import { searchEntities } from '#lib/server/library/relations.ts';
import type { RequestHandler } from './$types';

const Query = z.object({ q: z.string().max(200).default(''), kind: z.enum(['artist', 'album', 'track']).optional() });

/** Search over your own entities (list items and stubs). */
export const GET: RequestHandler = ({ url }) => {
	const query = Query.safeParse(Object.fromEntries(url.searchParams));
	if (!query.success) return json({ error: 'Invalid search' }, { status: 400 });
	return json({ results: searchEntities(getDb(), query.data.q, query.data.kind) });
};
