import { json, redirect } from '@sveltejs/kit';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { ORIGIN } from '$app/env/private';
import { getDb } from '#lib/server/db/index.ts';
import { authenticate } from '#lib/server/auth/index.ts';
import { isApiLike, isPublicPath } from '#lib/server/auth/access.ts';
import { deleteExpiredSessions } from '#lib/server/auth/session.ts';
import { startEnrichment } from '#lib/server/enrich/index.ts';

export const init: ServerInit = () => {
	// Opening the DB runs pending migrations.
	deleteExpiredSessions(getDb());
	startEnrichment();
};

const SECURITY_HEADERS: Record<string, string> = {
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'same-origin',
	'X-Frame-Options': 'DENY',
	'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};
if (ORIGIN?.startsWith('https://')) {
	SECURITY_HEADERS['Strict-Transport-Security'] = 'max-age=31536000';
}

export const handle: Handle = async ({ event, resolve }) => {
	const { pathname, search } = event.url;
	event.locals.authenticated = authenticate(event.cookies);

	if (!event.locals.authenticated && !isPublicPath(pathname)) {
		if (isApiLike(pathname)) return json({ error: 'Unauthorized' }, { status: 401 });
		redirect(303, `/login?next=${encodeURIComponent(pathname + search)}`);
	}

	const response = await resolve(event);
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		if (!response.headers.has(name)) response.headers.set(name, value);
	}
	return response;
};
