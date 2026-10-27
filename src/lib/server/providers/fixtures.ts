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
