import { error, json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.ts';
import { EntityPatch, getEntityView, updateEntity } from '#lib/server/library/entity.ts';
import type { RequestHandler } from './$types';

function entityId(raw: string) {
	const id = Number(raw);
	if (!Number.isSafeInteger(id) || id <= 0) error(404, 'Not found');
	return id;
}

export const GET: RequestHandler = ({ params }) => {
	const entity = getEntityView(getDb(), entityId(params.id));
	if (!entity) return json({ error: 'Not found' }, { status: 404 });
	return json({ entity });
};

/** Edit name / credit / release date / tags (`tags: { genre: [...] }` replaces that facet, as manual). */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const patch = EntityPatch.safeParse(await request.json().catch(() => null));
	if (!patch.success) return json({ error: 'Invalid update' }, { status: 400 });
	const result = updateEntity(getDb(), entityId(params.id), patch.data);
	if (result === 'invalid_date') return json({ error: 'Release date must be YYYY, YYYY-MM or YYYY-MM-DD' }, { status: 400 });
	if (!result) return json({ error: 'Not found' }, { status: 404 });
	return json({ entity: result });
};
