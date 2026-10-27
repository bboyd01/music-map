import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { attemptLogin } from '#lib/server/auth/index.ts';
import type { RequestHandler } from './$types';

const Body = z.object({ password: z.string().max(1024) });

export const POST: RequestHandler = async (event) => {
	const body = Body.safeParse(await event.request.json().catch(() => null));
	if (!body.success) return json({ error: 'Expected { password }' }, { status: 400 });
	const result = await attemptLogin(event, body.data.password);
	if (!result.ok) return json({ error: result.message }, { status: result.status });
	return json({ ok: true });
};
