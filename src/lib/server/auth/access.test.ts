import { describe, expect, it } from 'vitest';
import { clientIp, isApiLike, isPublicPath, safeNext } from './access';

describe('isPublicPath', () => {
	it('allows only login, health, auth endpoint and static PWA assets', () => {
		for (const p of ['/login', '/healthz', '/api/auth/login', '/manifest.webmanifest', '/service-worker.js', '/icons/icon-192.png', '/_app/immutable/x.js', '/favicon.svg', '/apple-touch-icon.png']) {
			expect(isPublicPath(p), p).toBe(true);
		}
		for (const p of ['/', '/list', '/settings', '/api/list', '/api/auth/logout', '/artwork/a.jpg', '/login/x', '/healthz/x', '/iconsx']) {
			expect(isPublicPath(p), p).toBe(false);
		}
	});

	it('treats API and artwork as API-like', () => {
		expect(isApiLike('/api/list')).toBe(true);
		expect(isApiLike('/artwork/1.jpg')).toBe(true);
		expect(isApiLike('/list')).toBe(false);
	});
});

describe('safeNext', () => {
	it('only allows same-site relative paths', () => {
		expect(safeNext('/map?x=1')).toBe('/map?x=1');
		for (const bad of [null, '', 'https://evil.com', '//evil.com', '/\\evil.com', 'list']) {
			expect(safeNext(bad)).toBe('/');
		}
	});
});

describe('clientIp', () => {
	const headers = (xff?: string) => new Headers(xff ? { 'x-forwarded-for': xff } : {});
	const socket = () => '10.0.0.1';

	it('ignores X-Forwarded-For unless the proxy is trusted', () => {
		expect(clientIp(headers('6.6.6.6'), socket, false)).toBe('10.0.0.1');
	});

	it('uses the rightmost (proxy-appended) entry when trusted', () => {
		expect(clientIp(headers('6.6.6.6, 203.0.113.9'), socket, true)).toBe('203.0.113.9');
		expect(clientIp(headers(), socket, true)).toBe('10.0.0.1');
	});
});
