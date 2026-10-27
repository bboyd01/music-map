import { describe, expect, it } from 'vitest';
import { parseLink } from './link';

const SP = '4aawyAB9vmqN3uQ7FjRGTy';

describe('parseLink: Apple Music', () => {
	it.each([
		['https://music.apple.com/us/album/kind-of-blue/268443092', 'album', '268443092', 'us'],
		['https://music.apple.com/gb/album/kind-of-blue/268443092?l=en', 'album', '268443092', 'gb'],
		['https://music.apple.com/us/album/so-what/268443092?i=268443097', 'track', '268443097', 'us'],
		['https://music.apple.com/us/album/so-what/268443092?i=268443097&uo=4', 'track', '268443097', 'us'],
		['https://music.apple.com/us/song/so-what/268443097', 'track', '268443097', 'us'],
		['https://music.apple.com/us/artist/miles-davis/44984', 'artist', '44984', 'us'],
		['https://music.apple.com/us/artist/44984', 'artist', '44984', 'us'],
		['https://music.apple.com/album/kind-of-blue/268443092', 'album', '268443092', undefined],
		['https://geo.music.apple.com/us/album/kind-of-blue/268443092', 'album', '268443092', 'us'],
		['https://embed.music.apple.com/de/album/kind-of-blue/268443092', 'album', '268443092', 'de'],
		['https://itunes.apple.com/us/album/kind-of-blue/id268443092', 'album', '268443092', 'us'],
		['https://music.apple.com/JP/album/%E3%81%82/268443092', 'album', '268443092', 'jp'],
		['music.apple.com/us/album/kind-of-blue/268443092', 'album', '268443092', 'us'],
		['  https://music.apple.com/us/album/kind-of-blue/268443092  ', 'album', '268443092', 'us'],
		['Listen: https://music.apple.com/us/album/kind-of-blue/268443092.', 'album', '268443092', 'us']
	])('%s', (input, kind, id, country) => {
		expect(parseLink(input)).toEqual({ type: 'item', provider: 'apple', kind, id, country });
	});

	it.each([
		'https://music.apple.com/us/playlist/jazz-essentials/pl.123',
		'https://music.apple.com/us/music-video/x/123',
		'https://music.apple.com/us/station/x/ra.123',
		'https://music.apple.com/us/album/kind-of-blue',
		'https://music.apple.com/us/album/x/268443092?i=abc',
		'https://music.apple.com/us/browse'
	])('rejects %s', (input) => {
		expect(parseLink(input).type).toBe('unsupported');
	});
});

describe('parseLink: Spotify', () => {
	it.each([
		[`https://open.spotify.com/track/${SP}`, 'track'],
		[`https://open.spotify.com/track/${SP}?si=abc123`, 'track'],
		[`https://open.spotify.com/album/${SP}?si=x&nd=1`, 'album'],
		[`https://open.spotify.com/artist/${SP}`, 'artist'],
		[`https://open.spotify.com/intl-de/track/${SP}?si=x`, 'track'],
		[`https://open.spotify.com/intl-pt-br/album/${SP}`, 'album'],
		[`https://open.spotify.com/embed/track/${SP}`, 'track'],
		[`https://play.spotify.com/album/${SP}`, 'album'],
		[`open.spotify.com/track/${SP}`, 'track'],
		[`spotify:track:${SP}`, 'track'],
		[`spotify:album:${SP}`, 'album'],
		[`spotify:artist:${SP}`, 'artist']
	])('%s', (input, kind) => {
		expect(parseLink(input)).toEqual({ type: 'item', provider: 'spotify', kind, id: SP });
	});

	it('recognises short links for later resolution', () => {
		expect(parseLink('https://spotify.link/AbCdEf123')).toEqual({
			type: 'shortlink',
			provider: 'spotify',
			url: 'https://spotify.link/AbCdEf123'
		});
		expect(parseLink('https://spotify.app.link/xyz?_p=1').type).toBe('shortlink');
		expect(parseLink('https://spotify.link/').type).toBe('unsupported');
	});

	it.each([
		`https://open.spotify.com/playlist/${SP}`,
		`https://open.spotify.com/episode/${SP}`,
		'https://open.spotify.com/track/tooShort',
		`https://open.spotify.com/track/${SP}xyz`,
		`spotify:playlist:${SP}`,
		'spotify:track:bad'
	])('rejects %s', (input) => {
		expect(parseLink(input).type).toBe('unsupported');
	});
});

describe('parseLink: other input', () => {
	it('treats plain text as a search query', () => {
		expect(parseLink('  kind of blue ')).toEqual({ type: 'text', query: 'kind of blue' });
		expect(parseLink('AC/DC back in black')).toEqual({ type: 'text', query: 'AC/DC back in black' });
	});

	it.each([
		'https://www.youtube.com/watch?v=abc',
		'https://evil.com/music.apple.com/us/album/x/1',
		'https://music.apple.com.evil.com/us/album/x/1',
		'https://tidal.com/browse/album/1',
		'http://[::1',
		'ftp://music.apple.com/us/album/x/1'
	])('rejects %s', (input) => {
		const result = parseLink(input);
		expect(result.type === 'unsupported' || result.type === 'text').toBe(true);
		expect(result.type).not.toBe('item');
	});
});
