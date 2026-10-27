import { getDb } from '#lib/server/db/index.ts';
import { ListQuery, getListWithOptions, listCounts } from '#lib/server/library/list.ts';
import { searchEntities } from '#lib/server/library/relations.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url, depends }) => {
	depends('app:list');
	const parsed = ListQuery.safeParse(Object.fromEntries(url.searchParams));
	const query = parsed.success ? parsed.data : ListQuery.parse({});
	const db = getDb();
	const { items, options } = getListWithOptions(db, query);
	// Searching also surfaces artists and stubs, which never appear as list items.
	const shown = new Set(items.map((i) => i.id));
	const elsewhere = query.q ? searchEntities(db, query.q, undefined, 30).filter((e) => !shown.has(e.id) && (e.kind === 'artist' || !e.listed)).slice(0, 8) : [];
	return { query, items, options, counts: listCounts(db), elsewhere };
};
