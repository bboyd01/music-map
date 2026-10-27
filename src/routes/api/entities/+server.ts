import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.ts';
import { enrichment } from '#lib/server/enrich/index.ts';
import { StubInput, createStub } from '#lib/server/library/relations.ts';
import type { RequestHandler } from './$types';

/** Creates a stub entity for linking (or returns the existing one). */
export const POST: RequestHandler = async ({ request }) => {
	const body = StubInput.safeParse(await request.json().catch(() => null));
	if (!body.success) return json({ error: 'Expected { kind, name, artistName? }' }, { status: 400 });
	const { entity, created } = createStub(getDb(), body.data);
	if (created) enrichment().enqueue({ entityId: entity.id });
	return json({ entity: { id: entity.id, kind: entity.kind, name: entity.name }, created }, { status: created ? 201 : 200 });
};
