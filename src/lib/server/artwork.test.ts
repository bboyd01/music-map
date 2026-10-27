import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ARTWORK_FILE, downloadArtwork } from './artwork';
import { fixtureFetch, type Fixture } from './providers/fixtures';

const JPEG = 'https://is1-ssl.mzstatic.com/image/thumb/x.jpg/600x600bb.jpg';
const image = (url: string, type = 'image/jpeg', body = 'fake-image-bytes'): Fixture => ({
	request: { url },
	status: 200,
	headers: { 'content-type': type },
	body
});

let dir: string;
beforeEach(async () => (dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artwork-'))));
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

describe('downloadArtwork', () => {
	it('stores the image once, named by URL hash', async () => {
		const fetchImpl = fixtureFetch([image(JPEG)]);
		const file = await downloadArtwork(JPEG, dir, { fetchImpl });
		expect(file).toMatch(ARTWORK_FILE);
		expect(await fs.readFile(path.join(dir, file), 'utf8')).toBe('fake-image-bytes');
		expect(await downloadArtwork(JPEG, dir, { fetchImpl })).toBe(file);
		expect(fetchImpl.calls).toHaveLength(1);
		expect((await fs.readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
	});

	it('follows Cover Art Archive redirects to archive.org', async () => {
		const caa = 'https://coverartarchive.org/release-group/abc/front-500';
		const ia = 'https://ia800100.us.archive.org/x/front-500.png';
		const fetchImpl = fixtureFetch([
			{ request: { url: caa }, status: 307, headers: { location: ia }, body: '' },
			image(ia, 'image/png')
		]);
		expect(await downloadArtwork(caa, dir, { fetchImpl })).toMatch(/\.png$/);
	});

	it.each([
		['http://is1-ssl.mzstatic.com/x.jpg', /not allowed/],
		['https://evil.com/x.jpg', /not allowed/],
		['https://mzstatic.com.evil.com/x.jpg', /not allowed/]
	])('rejects %s', async (url, error) => {
		await expect(downloadArtwork(url, dir, { fetchImpl: fixtureFetch([]) })).rejects.toThrow(error);
	});

	it('rejects redirects off the allowlist, non-images, and empty bodies', async () => {
		const fetchImpl = fixtureFetch([
			{ request: { url: JPEG }, status: 302, headers: { location: 'http://127.0.0.1/admin' }, body: '' },
			image('https://i.scdn.co/image/html', 'text/html', '<html>'),
			image('https://i.scdn.co/image/empty', 'image/jpeg', '')
		]);
		await expect(downloadArtwork(JPEG, dir, { fetchImpl })).rejects.toThrow(/not allowed/);
		await expect(downloadArtwork('https://i.scdn.co/image/html', dir, { fetchImpl })).rejects.toThrow(/not an image/);
		await expect(downloadArtwork('https://i.scdn.co/image/empty', dir, { fetchImpl })).rejects.toThrow(/empty/);
		expect(await fs.readdir(dir)).toEqual([]);
	});

	it('rejects oversized images', async () => {
		const big = 'x'.repeat(5 * 1024 * 1024 + 1);
		const fetchImpl = fixtureFetch([image('https://i.scdn.co/image/big', 'image/jpeg', big)]);
		await expect(downloadArtwork('https://i.scdn.co/image/big', dir, { fetchImpl })).rejects.toThrow(/too large/);
	});
});
