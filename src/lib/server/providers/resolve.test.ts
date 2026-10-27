import { describe, expect, it } from 'vitest';
import { AppleProvider } from './apple';
import { fixtureFetch, loadFixtures, type Fixture } from './fixtures';
import { SlidingWindowLimiter } from './http';
import { SPOTIFY_DISABLED, resolveInput } from './resolve';
import { SpotifyProvider } from './spotify';

function providers({ spotify = true, extra = [] as Fixture[] } = {}) {
	const fetchImpl = fixtureFetch([...extra, ...loadFixtures('apple.json', 'spotify.json')]);
	return {
		fetchImpl,
		providers: {
			apple: new AppleProvider({ fetchImpl, limiter: new SlidingWindowLimiter(100, 1) }),
			spotify: spotify ? new SpotifyProvider({ clientId: 'a', clientSecret: 'b', fetchImpl }) : null
		}
	};
}

describe('resolveInput', () => {
	it('resolves an Apple track link with its storefront', async () => {
		const { providers: p } = providers();
		const r = await resolveInput('https://music.apple.com/us/album/so-what/268443092?i=268443097', p);
		expect(r).toMatchObject({
			type: 'item',
			ref: { provider: 'apple', kind: 'track', id: '268443097', country: 'us' },
			item: { name: 'So What', artist: { name: 'Miles Davis' } }
		});
	});

	it('resolves Spotify links when configured', async () => {
		const { providers: p } = providers();
		const r = await resolveInput('https://open.spotify.com/album/1weenld61qoidwYuZ1GESA?si=1', p);
		expect(r).toMatchObject({ type: 'item', item: { kind: 'album', name: 'Kind Of Blue' } });
	});

	it('resolves Spotify short links', async () => {
		const { providers: p, fetchImpl } = providers({
			extra: [
				{
					request: { url: 'https://spotify.link/xyz' },
					status: 302,
					headers: { location: 'https://open.spotify.com/track/4vLYewWIvqHfKtJDk8c8tq' },
					body: ''
				}
			]
		});
		expect(await resolveInput('https://spotify.link/xyz', p, { fetchImpl })).toMatchObject({
			type: 'item',
			item: { name: 'So What' }
		});
	});

	it('explains that Spotify is disabled, without any network calls', async () => {
		const { providers: p, fetchImpl } = providers({ spotify: false });
		for (const link of ['https://open.spotify.com/track/4vLYewWIvqHfKtJDk8c8tq', 'spotify:album:1weenld61qoidwYuZ1GESA', 'https://spotify.link/xyz']) {
			expect(await resolveInput(link, p)).toEqual({ type: 'error', message: SPOTIFY_DISABLED });
		}
		expect(fetchImpl.calls).toHaveLength(0);
	});

	it('passes plain text through as a search query', async () => {
		const { providers: p } = providers();
		expect(await resolveInput(' kind of blue ', p)).toEqual({ type: 'text', query: 'kind of blue' });
		expect((await resolveInput('   ', p)).type).toBe('error');
	});

	it('reports unsupported links, unknown items and provider failures clearly', async () => {
		const { providers: p } = providers({
			extra: [{ request: { url: 'https://itunes.apple.com/lookup?id=999&country=us' }, status: 503, body: '' }]
		});
		expect(await resolveInput('https://www.youtube.com/watch?v=1', p)).toMatchObject({ type: 'error', message: expect.stringMatching(/Unsupported link/) });
		expect(await resolveInput('https://music.apple.com/us/album/x/1', p)).toEqual({
			type: 'error',
			message: "Couldn't find that album on Apple Music."
		});
		expect(await resolveInput('https://music.apple.com/us/album/x/999', p)).toEqual({
			type: 'error',
			message: "Apple Music didn't respond. Try again in a moment."
		});
	});
});
