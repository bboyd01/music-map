import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { libraryDeps } from '#lib/server/library/index.ts';
import { commitAdd } from '#lib/server/library/service.ts';
import type { RequestHandler } from './$types';

const Body = z.object({
	provider: z.enum(['apple', 'spotify']),
	kind: z.enum(['album', 'track']),
	id: z.string().regex(/^[0-9A-Za-z]{1,40}$/),
	country: z
		.string()
		.regex(/^[a-z]{2}$/)
		.optional()
});

export const POST: RequestHandler = async ({ request }) => {
	const body = Body.safeParse(await request.json().catch(() => null));
	if (!body.success) return json({ error: 'Expected { provider, kind, id, country? }' }, { status: 400 });
	const result = await commitAdd(libraryDeps(), body.data);
	if (!result.ok) return json({ error: result.message }, { status: result.status });
	return json(result, { status: result.outcome === 'existing' ? 200 : 201 });
};
