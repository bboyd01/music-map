import { self } from '$app/service-worker';
import { immutable, assets } from '$app/manifest';
import { version } from '$app/env';

// App-shell cache: built JS/CSS and static files (icons, manifest). Never caches API or artwork
// responses yet; offline reads of the list come in a later milestone.
const CACHE = `shell-${version}`;
const PRECACHE = [...immutable, ...assets].map((f) => f.path);
const precached = new Set(PRECACHE);

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(PRECACHE))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);
	if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
	if (!precached.has(url.pathname)) return;
	event.respondWith(
		caches.match(url.pathname).then((hit) => hit ?? fetch(event.request))
	);
});
