import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SlidingWindowLimiter, TtlCache, fetchJson } from './http';
import { ProviderError } from './types';

describe('SlidingWindowLimiter', () => {
	it('never exceeds max per window and keeps order', async () => {
		let now = 0;
		const sleeps: number[] = [];
		const limiter = new SlidingWindowLimiter(1, 1000, () => now, async (ms) => {
			sleeps.push(ms);
			now += ms;
		});
		const order: number[] = [];
		const times: number[] = [];
		await Promise.all([1, 2, 3, 4].map((i) => limiter.acquire().then(() => (order.push(i), times.push(now)))));
		expect(order).toEqual([1, 2, 3, 4]);
		expect(times).toEqual([0, 1000, 2000, 3000]);
		for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(1000);
	});

	it('allows bursts up to max', async () => {
		let now = 0;
		const limiter = new SlidingWindowLimiter(3, 60_000, () => now, async (ms) => void (now += ms));
		const times: number[] = [];
		for (let i = 0; i < 4; i++) await limiter.acquire().then(() => times.push(now));
		expect(times).toEqual([0, 0, 0, 60_000]);
	});
});

describe('TtlCache', () => {
	it('expires and evicts', async () => {
		let now = 0;
		const cache = new TtlCache<number>(100, 2, () => now);
		cache.set('a', 1);
		cache.set('b', 2);
		cache.set('c', 3);
		expect(cache.get('a')).toBeUndefined();
		expect(cache.get('b')).toBe(2);
		now = 100;
		expect(cache.get('b')).toBeUndefined();
		let loads = 0;
		const load = async () => ++loads;
		await cache.getOrSet('x', load);
		await cache.getOrSet('x', load);
		expect(loads).toBe(1);
	});
});

describe('fetchJson', () => {
	const schema = z.object({ a: z.number() });
	const respond = (status: number, body: string) => (async () => new Response(body, { status })) as typeof fetch;

	it('validates the body', async () => {
		expect(await fetchJson('apple', 'u', schema, { fetchImpl: respond(200, '{"a":1}') })).toEqual({ a: 1 });
		await expect(fetchJson('apple', 'u', schema, { fetchImpl: respond(200, '{"a":"x"}') })).rejects.toThrow(ProviderError);
		await expect(fetchJson('apple', 'u', schema, { fetchImpl: respond(200, 'nope') })).rejects.toThrow(/invalid JSON/);
	});

	it('maps 404 to null and other errors to ProviderError with status', async () => {
		expect(await fetchJson('apple', 'u', schema, { fetchImpl: respond(404, '') })).toBeNull();
		await expect(fetchJson('apple', 'u', schema, { fetchImpl: respond(429, '') })).rejects.toMatchObject({ status: 429 });
		const boom = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
		await expect(fetchJson('apple', 'u', schema, { fetchImpl: boom })).rejects.toThrow(/network error/);
	});
});
