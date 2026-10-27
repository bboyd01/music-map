import fs from 'node:fs';
import path from 'node:path';
import type { FetchFn } from './http';

/** A recorded HTTP exchange. Fixture files hold an array of these. */
export interface Fixture {
	request: { method?: string; url: string };
	status: number;
	headers?: Record<string, string>;
	body: unknown;
	/** Present on fixtures that were written by hand rather than recorded. */
	note?: string;
}

export const FIXTURE_DIR = path.join(import.meta.dirname, '__fixtures__');

export function loadFixtures(...files: string[]): Fixture[] {
	return files.flatMap((f) => JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, f), 'utf8')) as Fixture[]);
}

/**
 * A fetch that only answers from fixtures and fails loudly on anything else, so tests can never
 * reach a live API. Records every call for assertions.
 */
export function fixtureFetch(fixtures: Fixture[]) {
	const calls: { url: string; init?: RequestInit }[] = [];
	const fn: FetchFn = async (input, init) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		const method = (init?.method ?? 'GET').toUpperCase();
		calls.push({ url, init });
		const hit = fixtures.find((f) => f.request.url === url && (f.request.method ?? 'GET') === method);
		if (!hit) throw new Error(`No fixture for ${method} ${url}`);
		const body = typeof hit.body === 'string' ? hit.body : JSON.stringify(hit.body);
		return new Response(hit.status === 204 || hit.status === 304 ? null : body, {
			status: hit.status,
			headers: hit.headers
		});
	};
	return Object.assign(fn, { calls });
}

/**
 * Wraps a real fetch and records every exchange as a Fixture (for scripts/record-fixtures.ts).
 * Image bodies are replaced with a placeholder; tests only need the status and content type.
 */
export function recordingFetch(real: FetchFn = fetch) {
	const recorded: Fixture[] = [];
	const fn: FetchFn = async (input, init) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		const method = (init?.method ?? 'GET').toUpperCase();
		const res = await real(input, init);
		const type = res.headers.get('content-type') ?? '';
		const headers: Record<string, string> = {};
		if (type) headers['content-type'] = type;
		const location = res.headers.get('location');
		if (location) headers.location = location;
		const buf = Buffer.from(await res.arrayBuffer());
		let body: unknown = buf.toString('utf8');
		if (type.startsWith('image/')) body = '<image>';
		else if (type.includes('json')) {
			try {
				body = JSON.parse(buf.toString('utf8'));
			} catch {}
		}
		// Keep the latest response per request, so a retried 503 is recorded as its eventual success.
		const entry: Fixture = { request: method === 'GET' ? { url } : { url, method }, status: res.status, headers, body };
		const i = recorded.findIndex((f) => f.request.url === url && (f.request.method ?? 'GET') === method);
		if (i >= 0) recorded[i] = entry;
		else recorded.push(entry);
		return new Response(res.status === 204 || res.status === 304 || (res.status >= 300 && res.status < 400) ? null : buf, {
			status: res.status,
			headers: res.headers
		});
	};
	return Object.assign(fn, { recorded });
}
