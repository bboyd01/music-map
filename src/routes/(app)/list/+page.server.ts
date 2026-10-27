import { getDb } from '#lib/server/db/index.ts';
import { ListQuery, getListWithOptions, listCounts } from '#lib/server/library/list.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url, depends }) => {
	depends('app:list');
	const parsed = ListQuery.safeParse(Object.fromEntries(url.searchParams));
	const query = parsed.success ? parsed.data : ListQuery.parse({});
	const db = getDb();
	const { items, options } = getListWithOptions(db, query);
	return { query, items, options, counts: listCounts(db) };
};
