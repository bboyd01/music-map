import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FetchFn } from './providers/http';
import { ProviderError } from './providers/types';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_HOPS = 4;
const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const ARTWORK_FILE = /^[a-f0-9]{32}\.(jpg|png|webp)$/;
export const ARTWORK_MIME: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** Only fetch artwork from known image CDNs (Apple, Spotify, Cover Art Archive → archive.org). */
export function isAllowedArtworkHost(url: URL): boolean {
	if (url.protocol !== 'https:') return false;
	const h = url.hostname.toLowerCase();
	return (
		h.endsWith('.mzstatic.com') ||
		h === 'i.scdn.co' ||
		h.endsWith('.spotifycdn.com') ||
		h === 'coverartarchive.org' ||
		h === 'archive.org' ||
		h.endsWith('.archive.org')
	);
}

const fail = (msg: string) => new ProviderError(`artwork: ${msg}`, 'artwork');

/**
 * Downloads an image once and stores it in `dir`, named by a hash of its source URL.
 * Returns the file name (relative to `dir`), reusing an existing download if present.
 */
export async function downloadArtwork(
	sourceUrl: string,
	dir: string,
	{ fetchImpl = fetch, timeoutMs = 10_000 }: { fetchImpl?: FetchFn; timeoutMs?: number } = {}
): Promise<string> {
	const base = createHash('sha256').update(sourceUrl).digest('hex').slice(0, 32);
	await fs.mkdir(dir, { recursive: true });
	const existing = (await fs.readdir(dir)).find((f) => f.startsWith(base + '.') && ARTWORK_FILE.test(f));
	if (existing) return existing;

	const signal = AbortSignal.timeout(timeoutMs);
	let url = new URL(sourceUrl);
	let res: Response | undefined;
	for (let hop = 0; hop <= MAX_HOPS; hop++) {
		if (!isAllowedArtworkHost(url)) throw fail(`host not allowed (${url.hostname})`);
		try {
			res = await fetchImpl(url.href, { redirect: 'manual', signal });
		} catch {
			throw fail('download failed');
		}
		const location = res.headers.get('location');
		if (res.status >= 300 && res.status < 400 && location) {
			url = new URL(location, url);
			res = undefined;
			continue;
		}
		break;
	}
	if (!res) throw fail('too many redirects');
	if (!res.ok) throw fail(`HTTP ${res.status}`);

	const ext = TYPES[(res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()];
	if (!ext) throw fail('not an image');
	if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) throw fail('too large');

	const chunks: Uint8Array[] = [];
	let size = 0;
	const reader = res.body?.getReader();
	if (!reader) throw fail('empty body');
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > MAX_BYTES) {
			await reader.cancel().catch(() => {});
			throw fail('too large');
		}
		chunks.push(value);
	}
	if (size === 0) throw fail('empty body');

	const file = `${base}.${ext}`;
	const tmp = path.join(dir, `.${file}.${randomBytes(4).toString('hex')}.tmp`);
	await fs.writeFile(tmp, Buffer.concat(chunks));
	await fs.rename(tmp, path.join(dir, file));
	return file;
}
