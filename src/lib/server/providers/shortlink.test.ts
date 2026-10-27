import { describe, expect, it } from 'vitest';
import { fixtureFetch, type Fixture } from './fixtures';
import { resolveSpotifyShortLink } from './shortlink';

const ID = '4vLYewWIvqHfKtJDk8c8tq';
const redirect = (url: string, location: string): Fixture => ({
	request: { url },
	status: 307,
	headers: { location },
	body: ''
});

describe('resolveSpotifyShortLink', () => {
	it('follows redirects to open.spotify.com', async () => {
		const fetchImpl = fixtureFetch([
			redirect('https://spotify.link/abc', `https://open.spotify.com/track/${ID}?si=x`)
		]);
		expect(await resolveSpotifyShortLink('https://spotify.link/abc', { fetchImpl })).toEqual({
			type: 'item',
			provider: 'spotify',
			kind: 'track',
			id: ID
		});
		expect(fetchImpl.calls[0].init?.redirect).toBe('manual');
	});

	it('reads the target from a Branch landing page', async () => {
		const fetchImpl = fixtureFetch([
			redirect('https://spotify.link/abc', 'https://spotify.app.link/abc?_p=1'),
			{
				request: { url: 'https://spotify.app.link/abc?_p=1' },
				status: 200,
				headers: { 'content-type': 'text/html' },
				body: `<html><meta property="og:url" content="https://open.spotify.com/album/${ID}"></html>`
			}
		]);
		expect(await resolveSpotifyShortLink('https://spotify.link/abc', { fetchImpl })).toMatchObject({
			kind: 'album',
			id: ID
		});
	});

	it('refuses to follow redirects off Spotify hosts', async () => {
		const fetchImpl = fixtureFetch([redirect('https://spotify.link/abc', 'http://169.254.169.254/latest/meta-data')]);
		expect((await resolveSpotifyShortLink('https://spotify.link/abc', { fetchImpl })).type).toBe('unsupported');
		expect(fetchImpl.calls).toHaveLength(1);
	});

	it('gives up after too many hops', async () => {
		const fetchImpl = fixtureFetch([
			redirect('https://spotify.link/a', 'https://spotify.link/b'),
			redirect('https://spotify.link/b', 'https://spotify.link/a')
		]);
		expect((await resolveSpotifyShortLink('https://spotify.link/a', { fetchImpl })).type).toBe('unsupported');
		expect(fetchImpl.calls.length).toBeLessThanOrEqual(6);
	});

	it('rejects non-short-link input', async () => {
		const fetchImpl = fixtureFetch([]);
		expect((await resolveSpotifyShortLink('https://evil.com/x', { fetchImpl })).type).toBe('unsupported');
		expect(fetchImpl.calls).toHaveLength(0);
	});
});
