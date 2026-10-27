import { json, redirect } from '@sveltejs/kit';
import { logout } from '#lib/server/auth/index.ts';
import type { RequestHandler } from './$types';

/** JSON `{ everywhere?: boolean }`, or a form post with an `everywhere` field (redirects to /login). */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const type = request.headers.get('content-type') ?? '';
	if (type.includes('application/json')) {
		const body = await request.json().catch(() => ({}));
		logout(cookies, body?.everywhere === true);
		return json({ ok: true });
	}
	const form = await request.formData().catch(() => null);
	logout(cookies, form?.get('everywhere') === 'true');
	redirect(303, '/login');
};
