import { self } from '$app/service-worker';
import { immutable, assets } from '$app/manifest';
import { version } from '$app/env';

const SHELL = `shell-${version}`;
/** Last-loaded pages and their data, for offline reading. Cleared on login/logout. */
const PAGES = 'pages';
/** Downloaded artwork; files are content-addressed, so entries never go stale. */
const ARTWORK = 'artwork';

const PRECACHE = [...immutable, ...assets].map((f) => f.path);
const precached = new Set(PRECACHE);

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(SHELL)
			.then((cache) => cache.addAll(PRECACHE))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL).map((k) => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

async function cacheFirst(request: Request, cacheName: string) {
	const hit = await caches.match(request);
	if (hit) return hit;
	const res = await fetch(request);
	if (res.ok) (await caches.open(cacheName)).put(request, res.clone());
	return res;
}

/** Network first; successful page/data responses are saved and served when offline. */
async function networkFirst(request: Request) {
	try {
		const res = await fetch(request);
		// Redirects (e.g. to /login) are never cached.
		if (res.ok && !res.redirected) (await caches.open(PAGES)).put(request, res.clone());
		return res;
	} catch {
		const hit = await caches.match(request, { ignoreVary: true });
		if (hit) return hit;
		return new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } });
	}
}

self.addEventListener('fetch', (event) => {
	const { request } = event;
	const url = new URL(request.url);
	if (request.method !== 'GET' || url.origin !== self.location.origin) return;
	if (precached.has(url.pathname)) return event.respondWith(caches.match(url.pathname).then((hit) => hit ?? fetch(request)));
	if (url.pathname.startsWith('/artwork/')) return event.respondWith(cacheFirst(request, ARTWORK));
	if (url.pathname.startsWith('/api/') || url.pathname === '/login' || url.pathname === '/healthz') return;
	// Page navigations and SvelteKit's __data.json loads.
	if (request.mode === 'navigate' || url.pathname.endsWith('/__data.json')) event.respondWith(networkFirst(request));
});
