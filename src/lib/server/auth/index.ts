import type { Cookies, RequestEvent } from '@sveltejs/kit';
import { APP_PASSWORD_HASH, ORIGIN, SESSION_SECRET, TRUST_PROXY } from '$app/env/private';
import { getDb } from '../db';
import { clientIp } from './access';
import { verifyPassword } from './password';
import { LoginRateLimiter } from './ratelimit';
import {
	SESSION_COOKIE,
	createSession,
	deleteAllSessions,
	deleteSession,
	validateSession
} from './session';

const limiter = new LoginRateLimiter();
const secureCookies = ORIGIN?.startsWith('https://') ?? false;

const cookieOptions = { path: '/', httpOnly: true, secure: secureCookies, sameSite: 'lax' } as const;

function setSessionCookie(cookies: Cookies, token: string, expires: Date) {
	cookies.set(SESSION_COOKIE, token, { ...cookieOptions, expires });
}

/** Checks the session cookie, extends the sliding expiry, and clears stale cookies. */
export function authenticate(cookies: Cookies): boolean {
	const token = cookies.get(SESSION_COOKIE);
	if (!token) return false;
	const session = validateSession(getDb(), SESSION_SECRET, token);
	if (!session) {
		cookies.delete(SESSION_COOKIE, cookieOptions);
		return false;
	}
	if (session.refreshed) setSessionCookie(cookies, token, session.expiresAt);
	return true;
}

type LoginResult = { ok: true } | { ok: false; status: 401 | 429; message: string };

export async function attemptLogin(event: RequestEvent, password: string): Promise<LoginResult> {
	const ip = clientIp(event.request.headers, () => event.getClientAddress(), TRUST_PROXY);
	const retryAfter = limiter.retryAfter(ip);
	if (retryAfter > 0) {
		const minutes = Math.ceil(retryAfter / 60);
		return { ok: false, status: 429, message: `Too many attempts. Try again in ${minutes} min.` };
	}
	const delay = limiter.globalDelayMs();
	if (delay > 0) await new Promise((r) => setTimeout(r, delay));

	if (!password || !(await verifyPassword(password, APP_PASSWORD_HASH))) {
		limiter.recordFailure(ip);
		return { ok: false, status: 401, message: 'Wrong password.' };
	}
	limiter.recordSuccess(ip);
	const { token, expiresAt } = createSession(getDb(), SESSION_SECRET);
	setSessionCookie(event.cookies, token, expiresAt);
	return { ok: true };
}

export function logout(cookies: Cookies, everywhere = false) {
	const token = cookies.get(SESSION_COOKIE);
	if (everywhere) deleteAllSessions(getDb());
	else if (token) deleteSession(getDb(), SESSION_SECRET, token);
	cookies.delete(SESSION_COOKIE, cookieOptions);
}
