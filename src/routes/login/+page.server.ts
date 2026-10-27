import { fail, redirect } from '@sveltejs/kit';
import { attemptLogin } from '#lib/server/auth/index.ts';
import { safeNext } from '#lib/server/auth/access.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.authenticated) redirect(303, safeNext(url.searchParams.get('next')));
};

export const actions: Actions = {
	default: async (event) => {
		const form = await event.request.formData();
		const password = String(form.get('password') ?? '').slice(0, 1024);
		const result = await attemptLogin(event, password);
		if (!result.ok) return fail(result.status, { message: result.message });
		redirect(303, safeNext(event.url.searchParams.get('next')));
	}
};
