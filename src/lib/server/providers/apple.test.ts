import { describe, expect, it } from 'vitest';
import { AppleProvider, appleArtworkUrl } from './apple';
import { fixtureFetch, loadFixtures } from './fixtures';
import { SlidingWindowLimiter } from './http';

function setup() {
	const fetchImpl = fixtureFetch(loadFixtures('apple.json'));
	const apple = new AppleProvider({ fetchImpl, limiter: new SlidingWindowLimiter(100, 1) });
	return { apple, fetchImpl };
}

describe('AppleProvider.lookup (recorded fixtures)', () => {
	it('normalizes an album', async () => {
		const { apple } = setup();
		expect(await apple.lookup({ kind: 'album', id: '268443092', country: 'us' })).toEqual({
			provider: 'apple',
			kind: 'album',
			id: '268443092',
			name: 'Kind of Blue',
			url: 'https://music.apple.com/us/album/kind-of-blue/268443092',
			genres: ['Jazz'],
			artworkUrl: expect.stringMatching(/^https:\/\/is1-ssl\.mzstatic\.com\/.+\/600x600bb\.jpg$/),
			artist: { id: '44984', name: 'Miles Davis' },
			releaseDate: '1959-08-17',
			trackCount: 5
		});
	});

	it('normalizes a track', async () => {
		const { apple } = setup();
		expect(await apple.lookup({ kind: 'track', id: '268443097', country: 'us' })).toEqual({
			provider: 'apple',
			kind: 'track',
			id: '268443097',
			name: 'So What',
			url: 'https://music.apple.com/us/album/so-what/268443092?i=268443097',
			genres: ['Jazz'],
			artworkUrl: expect.stringMatching(/\/600x600bb\.jpg$/),
			artist: { id: '44984', name: 'Miles Davis' },
			album: { id: '268443092', name: 'Kind of Blue' },
			releaseDate: '1959-08-17',
			durationMs: 547983,
			trackNumber: 1,
			discNumber: 1
		});
	});

	it('normalizes an artist', async () => {
		const { apple } = setup();
		expect(await apple.lookup({ kind: 'artist', id: '44984', country: 'us' })).toEqual({
			provider: 'apple',
			kind: 'artist',
			id: '44984',
			name: 'Miles Davis',
			url: 'https://music.apple.com/us/artist/miles-davis/44984',
			genres: ['Jazz']
		});
	});

	it('passes the storefront through as country', async () => {
		const { apple, fetchImpl } = setup();
		const album = await apple.lookup({ kind: 'album', id: '1440833098', country: 'gb' });
		expect(album).toMatchObject({ name: '1', artist: { name: 'The Beatles' } });
		expect(fetchImpl.calls[0].url).toContain('country=gb');
	});

	it('returns null for unknown ids and kind mismatches, without calling for bad ids', async () => {
		const { apple, fetchImpl } = setup();
		expect(await apple.lookup({ kind: 'album', id: '1', country: 'us' })).toBeNull();
		expect(await apple.lookup({ kind: 'track', id: '268443092', country: 'us' })).toBeNull();
		expect(await apple.lookup({ kind: 'album', id: '../x' })).toBeNull();
		expect(fetchImpl.calls).toHaveLength(2);
	});

	it('caches repeated lookups', async () => {
		const { apple, fetchImpl } = setup();
		await apple.lookup({ kind: 'album', id: '268443092', country: 'us' });
		await apple.lookup({ kind: 'album', id: '268443092', country: 'us' });
		expect(fetchImpl.calls).toHaveLength(1);
	});
});

describe('AppleProvider.search (recorded fixtures)', () => {
	it('finds Kind of Blue as an album', async () => {
		const { apple } = setup();
		const results = await apple.search('kind of blue', 'album');
		expect(results.length).toBeGreaterThan(0);
		expect(results.every((r) => r.kind === 'album' && r.provider === 'apple')).toBe(true);
		expect(results).toContainEqual(
			expect.objectContaining({ id: '268443092', name: 'Kind of Blue', artistName: 'Miles Davis', releaseDate: '1959-08-17' })
		);
	});

	it('returns songs with their album', async () => {
		const { apple } = setup();
		const results = await apple.search('kind of blue', 'track');
		expect(results.length).toBeGreaterThan(0);
		for (const r of results) {
			expect(r.kind).toBe('track');
			expect(r.artistName).toBeTruthy();
			expect(r.artworkUrl).toMatch(/600x600bb\.jpg$/);
		}
		expect(results.some((r) => r.albumName)).toBe(true);
	});
});

describe('appleArtworkUrl', () => {
	it('requests 600px', () => {
		expect(appleArtworkUrl('https://x/a.jpg/100x100bb.jpg')).toBe('https://x/a.jpg/600x600bb.jpg');
		expect(appleArtworkUrl('https://x/a.png/60x60bb.png', 300)).toBe('https://x/a.png/300x300bb.jpg');
		expect(appleArtworkUrl(undefined)).toBeUndefined();
	});
});
