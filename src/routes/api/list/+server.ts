import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.ts';
import { ListQuery, getList } from '#lib/server/library/list.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => {
	const query = ListQuery.safeParse(Object.fromEntries(url.searchParams));
	if (!query.success) return json({ error: 'Invalid list query' }, { status: 400 });
	return json({ items: getList(getDb(), query.data) });
};
