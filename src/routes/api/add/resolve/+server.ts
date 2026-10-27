import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { libraryDeps } from '#lib/server/library/index.ts';
import { resolveForAdd } from '#lib/server/library/service.ts';
import type { RequestHandler } from './$types';

const Body = z.object({
	input: z.string().max(2000),
	kind: z.enum(['album', 'track']).default('album')
});

export const POST: RequestHandler = async ({ request }) => {
	const body = Body.safeParse(await request.json().catch(() => null));
	if (!body.success) return json({ type: 'error', message: 'Expected { input, kind? }' }, { status: 400 });
	const result = await resolveForAdd(libraryDeps(), body.data.input, body.data.kind);
	return json(result, { status: result.type === 'error' ? 422 : 200 });
};
