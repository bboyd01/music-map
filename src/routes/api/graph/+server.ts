import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.ts';
import { GraphQuery, getGraph } from '#lib/server/library/graph.ts';
import type { RequestHandler } from './$types';

/** `?kind=artist|album|track&layers=inspired,similar,genre,era,instrument&focus=&depth=&tag=genre:jazz&suggested=1` */
export const GET: RequestHandler = ({ url }) => {
	const query = GraphQuery.safeParse(Object.fromEntries(url.searchParams));
	if (!query.success) return json({ error: 'Invalid graph query' }, { status: 400 });
	return json(getGraph(getDb(), query.data));
};
