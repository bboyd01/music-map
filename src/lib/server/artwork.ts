import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FetchFn } from './providers/http';
import { ProviderError } from './providers/types';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_HOPS = 4;
const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const ARTWORK_FILE = /^[a-f0-9]{32}(-s)?\.(jpg|png|webp)$/;
export const ARTWORK_MIME: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** Only fetch artwork from known image CDNs (Apple, Spotify, Cover Art Archive → archive.org). */
function isAllowedArtworkHost(url: URL): boolean {
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

/** Base name of a cover's small copy (~200px, for lists and the map): `<hash>-s.<ext>`. */
export const thumbName = (file: string) => `${file.replace(/\.\w+$/, '')}-s`;

/** The small copy of a cover, if it has been downloaded. */
export async function findThumb(dir: string, file: string): Promise<string | undefined> {
	const base = thumbName(file);
	for (const ext of Object.values(TYPES)) {
		const name = `${base}.${ext}`;
		if (await fs.access(path.join(dir, name)).then(() => true, () => false)) return name;
	}
}

/** A ~200px version of a provider image URL, where the URL itself picks the size. */
export function smallArtworkUrl(url: string | undefined): string | undefined {
	if (!url) return undefined;
	if (/\.mzstatic\.com\//.test(url)) return url.replace(/\/\d+x\d+(bb|cc|sr)?\.(jpg|jpeg|png|webp)$/i, '/200x200bb.jpg');
	if (/^https:\/\/coverartarchive\.org\/.*\/front-\d+$/.test(url)) return url.replace(/front-\d+$/, 'front-250');
	return undefined;
}

const fail = (msg: string) => new ProviderError(`artwork: ${msg}`, 'artwork');

/**
 * Downloads an image once and stores it in `dir`, named by a hash of its source URL (or `name`).
 * Returns the file name (relative to `dir`), reusing an existing download if present.
 */
export async function downloadArtwork(
	sourceUrl: string,
	dir: string,
	{ fetchImpl = fetch, timeoutMs = 10_000, name }: { fetchImpl?: FetchFn; timeoutMs?: number; name?: string } = {}
): Promise<string> {
	const base = name ?? createHash('sha256').update(sourceUrl).digest('hex').slice(0, 32);
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

/** Downloads the small copy of `file` from `sourceUrl`, unless it's already there. */
export async function downloadThumb(sourceUrl: string, file: string, dir: string, opts: { fetchImpl?: FetchFn } = {}): Promise<string> {
	return (await findThumb(dir, file)) ?? downloadArtwork(sourceUrl, dir, { ...opts, name: thumbName(file) });
}
