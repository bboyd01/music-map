import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getDb } from '#lib/server/db/index.ts';
import { searchTags } from '#lib/server/enrich/tags.ts';
import type { RequestHandler } from './$types';

const Query = z.object({ facet: z.enum(['genre', 'era', 'instrument']), q: z.string().trim().max(60).default('') });

/** Autocomplete for tag editing. */
export const GET: RequestHandler = ({ url }) => {
	const query = Query.safeParse(Object.fromEntries(url.searchParams));
	if (!query.success) return json({ error: 'Expected ?facet=genre|era|instrument&q=' }, { status: 400 });
	return json({ tags: searchTags(getDb(), query.data.facet, query.data.q) });
};
