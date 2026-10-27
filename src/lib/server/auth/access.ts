/** Paths reachable without a session. Static PWA assets are served before hooks run in production. */
const PUBLIC_EXACT = new Set([
	'/login',
	'/healthz',
	'/api/auth/login',
	'/manifest.webmanifest',
	'/service-worker.js',
	'/favicon.svg',
	'/favicon.ico',
	'/apple-touch-icon.png',
	'/robots.txt'
]);
const PUBLIC_PREFIXES = ['/icons/', '/_app/'];

export function isPublicPath(pathname: string): boolean {
	return PUBLIC_EXACT.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

/** Requests that should get a 401 rather than a redirect to the login page. */
export function isApiLike(pathname: string): boolean {
	return pathname.startsWith('/api/') || pathname.startsWith('/artwork/');
}

/** Only allow same-site relative paths as post-login destinations (no open redirects). */
export function safeNext(next: string | null | undefined): string {
	if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
	return next;
}

/**
 * Client IP for rate limiting. Behind a trusted reverse proxy, the rightmost X-Forwarded-For
 * entry is the one our proxy appended; anything left of it is client-controlled.
 */
export function clientIp(headers: Headers, fallback: () => string, trustProxy: boolean): string {
	if (trustProxy) {
		const xff = headers.get('x-forwarded-for');
		const last = xff?.split(',').map((s) => s.trim()).filter(Boolean).at(-1);
		if (last) return last;
	}
	try {
		return fallback();
	} catch {
		return 'unknown';
	}
}
