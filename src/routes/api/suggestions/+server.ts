import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.ts';
import { listSuggestions } from '#lib/server/enrich/suggestions.ts';
import type { RequestHandler } from './$types';

/** Pending suggestions, optionally for one entity (`?entityId=`). */
export const GET: RequestHandler = ({ url }) => {
	const raw = url.searchParams.get('entityId');
	const entityId = raw === null ? undefined : Number(raw);
	if (entityId !== undefined && !(Number.isSafeInteger(entityId) && entityId > 0)) return json({ error: 'Invalid entityId' }, { status: 400 });
	return json({ suggestions: listSuggestions(getDb(), entityId) });
};
