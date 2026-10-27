import { getDb } from '#lib/server/db/index.ts';
import { ListQuery, getList, listCounts } from '#lib/server/library/list.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url, depends }) => {
	depends('app:list');
	const parsed = ListQuery.safeParse(Object.fromEntries(url.searchParams));
	const query = parsed.success ? parsed.data : ListQuery.parse({});
	const db = getDb();
	return { query, items: getList(db, query), counts: listCounts(db) };
};
