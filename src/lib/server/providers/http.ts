import type { z } from 'zod';
import { ProviderError } from './types';

export type FetchFn = typeof fetch;
type Source = ProviderError['provider'];

/** GETs (or POSTs) JSON with a timeout and validates it. 404 → null. */
export async function fetchJson<T extends z.ZodType>(
	source: Source,
	url: string,
	schema: T,
	{ fetchImpl = fetch, init = {}, timeoutMs = 8000 }: { fetchImpl?: FetchFn; init?: RequestInit; timeoutMs?: number } = {}
): Promise<z.infer<T> | null> {
	let res: Response;
	try {
		res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
	} catch (err) {
		const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'network error';
		throw new ProviderError(`${source}: request ${reason}`, source);
	}
	if (res.status === 404) return null;
	if (!res.ok) throw new ProviderError(`${source}: HTTP ${res.status}`, source, res.status);
	let body: unknown;
	try {
		body = await res.json();
	} catch {
		throw new ProviderError(`${source}: invalid JSON`, source, res.status);
	}
	const parsed = schema.safeParse(body);
	if (!parsed.success) {
		throw new ProviderError(`${source}: unexpected response shape (${parsed.error.issues[0]?.path.join('.')})`, source);
	}
	return parsed.data;
}

/**
 * Allows at most `max` acquisitions per `windowMs`, queueing the rest in order.
 * MusicBrainz uses (1, 1000); Apple a looser (20, 60_000).
 */
export class SlidingWindowLimiter {
	private stamps: number[] = [];
	private chain: Promise<void> = Promise.resolve();

	constructor(
		private max: number,
		private windowMs: number,
		private now: () => number = Date.now,
		private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
	) {}

	acquire(): Promise<void> {
		const next = this.chain.then(async () => {
			for (;;) {
				const t = this.now();
				this.stamps = this.stamps.filter((s) => s > t - this.windowMs);
				if (this.stamps.length < this.max) {
					this.stamps.push(t);
					return;
				}
				await this.sleep(this.stamps[0] + this.windowMs - t);
			}
		});
		this.chain = next.catch(() => {});
		return next;
	}
}

/** Small in-memory cache with TTL and a size cap (oldest entries evicted first). */
export class TtlCache<V> {
	private map = new Map<string, { value: V; expires: number }>();

	constructor(
		private ttlMs: number,
		private maxEntries = 500,
		private now: () => number = Date.now
	) {}

	get(key: string): V | undefined {
		const hit = this.map.get(key);
		if (!hit) return undefined;
		if (hit.expires <= this.now()) {
			this.map.delete(key);
			return undefined;
		}
		return hit.value;
	}

	set(key: string, value: V) {
		this.map.delete(key);
		this.map.set(key, { value, expires: this.now() + this.ttlMs });
		while (this.map.size > this.maxEntries) this.map.delete(this.map.keys().next().value!);
	}

	async getOrSet(key: string, load: () => Promise<V>): Promise<V> {
		const hit = this.get(key);
		if (hit !== undefined) return hit;
		const value = await load();
		this.set(key, value);
		return value;
	}
}
