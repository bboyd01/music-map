import { describe, expect, it } from 'vitest';
import { fixtureFetch, loadFixtures, type Fixture } from './fixtures';
import { SpotifyProvider, memoryTokenStore, pickImage } from './spotify';

// NOTE: spotify.json is hand-written from the API reference, not recorded (see its `note`).
function setup(extra: Fixture[] = [], now = () => 0) {
	const fetchImpl = fixtureFetch([...extra, ...loadFixtures('spotify.json')]);
	const tokenStore = memoryTokenStore();
	const spotify = new SpotifyProvider({ clientId: 'id', clientSecret: 'secret', fetchImpl, tokenStore, now });
	return { spotify, fetchImpl, tokenStore };
}

describe('SpotifyProvider.lookup', () => {
	it('normalizes an album', async () => {
		const { spotify } = setup();
		expect(await spotify.lookup({ kind: 'album', id: '1weenld61qoidwYuZ1GESA' })).toEqual({
			provider: 'spotify',
			kind: 'album',
			id: '1weenld61qoidwYuZ1GESA',
			name: 'Kind Of Blue',
			url: 'https://open.spotify.com/album/1weenld61qoidwYuZ1GESA',
			genres: [],
			artworkUrl: expect.stringContaining('ab67616d0000b273'),
			thumbUrl: expect.stringContaining('ab67616d00001e02'),
			artist: { id: '0kbYTNQb4Pb1rPbbaF0pT4', name: 'Miles Davis' },
			releaseDate: '1959-08-17',
			trackCount: 5,
			upc: '074646493520'
		});
	});

	it('normalizes a track', async () => {
		const { spotify } = setup();
		expect(await spotify.lookup({ kind: 'track', id: '4vLYewWIvqHfKtJDk8c8tq' })).toMatchObject({
			kind: 'track',
			name: 'So What',
			artist: { name: 'Miles Davis' },
			album: { id: '1weenld61qoidwYuZ1GESA', name: 'Kind Of Blue' },
			releaseDate: '1959-08-17',
			durationMs: 562640,
			isrc: 'USSM15900113',
			trackNumber: 1
		});
	});

	it('normalizes an artist with genres and image', async () => {
		const { spotify } = setup();
		expect(await spotify.lookup({ kind: 'artist', id: '0kbYTNQb4Pb1rPbbaF0pT4' })).toMatchObject({
			kind: 'artist',
			name: 'Miles Davis',
			genres: ['bebop', 'cool jazz', 'hard bop', 'jazz', 'jazz fusion'],
			artworkUrl: expect.stringContaining('ab6761610000e5eb')
		});
	});

	it('returns null for missing or malformed ids', async () => {
		const { spotify, fetchImpl } = setup();
		expect(await spotify.lookup({ kind: 'album', id: '0000000000000000000000' })).toBeNull();
		expect(await spotify.lookup({ kind: 'album', id: 'bad' })).toBeNull();
		expect(fetchImpl.calls.filter((c) => c.url.includes('/albums/'))).toHaveLength(1);
	});

	it('authenticates with client credentials and reuses the token until near expiry', async () => {
		let now = 0;
		const { spotify, fetchImpl, tokenStore } = setup([], () => now);
		await spotify.lookup({ kind: 'album', id: '1weenld61qoidwYuZ1GESA' });
		await spotify.lookup({ kind: 'track', id: '4vLYewWIvqHfKtJDk8c8tq' });
		const tokenCalls = () => fetchImpl.calls.filter((c) => c.url.includes('accounts.spotify.com'));
		expect(tokenCalls()).toHaveLength(1);
		const auth = new Headers(tokenCalls()[0].init?.headers).get('authorization');
		expect(auth).toBe(`Basic ${Buffer.from('id:secret').toString('base64')}`);
		expect(new Headers(fetchImpl.calls[1].init?.headers).get('authorization')).toBe('Bearer BQ-test-token');
		expect(tokenStore.get()).toEqual({ token: 'BQ-test-token', expiresAt: 3_600_000 });

		now = 3_600_000 - 30_000; // inside the refresh margin
		await spotify.lookup({ kind: 'artist', id: '0kbYTNQb4Pb1rPbbaF0pT4' });
		expect(tokenCalls()).toHaveLength(2);
	});
});

describe('SpotifyProvider.search', () => {
	it('returns albums, skipping null items', async () => {
		const { spotify } = setup();
		const results = await spotify.search('kind of blue', 'album');
		expect(results.map((r) => [r.name, r.releaseDate])).toEqual([
			['Kind Of Blue', '1959-08-17'],
			['Kind Of Blue (Legacy Edition)', '1959']
		]);
		expect(results[0]).toMatchObject({ provider: 'spotify', kind: 'album', artistName: 'Miles Davis' });
	});

	it('returns tracks with album names', async () => {
		const { spotify } = setup();
		expect(await spotify.search('kind of blue', 'track')).toEqual([
			expect.objectContaining({ kind: 'track', name: 'So What', albumName: 'Kind Of Blue', artistName: 'Miles Davis' })
		]);
	});
});

describe('pickImage', () => {
	const img = (width: number) => ({ url: `u${width}`, width, height: width });
	it('prefers the smallest image ≥ 600px, else the largest', () => {
		expect(pickImage([img(64), img(640), img(300)])).toBe('u640');
		expect(pickImage([img(1000), img(640)])).toBe('u640');
		expect(pickImage([img(64), img(300)])).toBe('u300');
		expect(pickImage([])).toBeUndefined();
	});
});
