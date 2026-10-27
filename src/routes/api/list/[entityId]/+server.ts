import { error, json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.ts';
import { ListPatch, promoteToList, removeFromList, updateListItem } from '#lib/server/library/list.ts';
import type { RequestHandler } from './$types';

function entityId(raw: string) {
	const id = Number(raw);
	if (!Number.isSafeInteger(id) || id <= 0) error(404, 'Not found');
	return id;
}

/** Update status / rating / review / listened date. */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const patch = ListPatch.safeParse(await request.json().catch(() => null));
	if (!patch.success) return json({ error: 'Invalid update' }, { status: 400 });
	const item = updateListItem(getDb(), entityId(params.entityId), patch.data);
	if (!item) return json({ error: 'Not in your list' }, { status: 404 });
	return json({ item });
};

/** Promote an existing album/track entity (e.g. a stub) to To Listen. */
export const POST: RequestHandler = ({ params }) => {
	const outcome = promoteToList(getDb(), entityId(params.entityId));
	if (outcome === 'not_found') return json({ error: 'Not found' }, { status: 404 });
	if (outcome === 'not_listable') return json({ error: 'Artists can’t go on the list' }, { status: 400 });
	return json({ outcome }, { status: outcome === 'promoted' ? 201 : 200 });
};

export const DELETE: RequestHandler = ({ params }) => {
	const result = removeFromList(getDb(), entityId(params.entityId));
	if (!result.removed) return json({ error: 'Not in your list' }, { status: 404 });
	return json(result);
};
