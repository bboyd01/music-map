import { getDb } from '#lib/server/db/index.ts';
import { GraphQuery, getGraph } from '#lib/server/library/graph.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	const parsed = GraphQuery.safeParse(Object.fromEntries(url.searchParams));
	const query = parsed.success ? parsed.data : GraphQuery.parse({});
	return { query, graph: getGraph(getDb(), query) };
};
