import { describe, expect, it } from 'vitest';
import { normalizeReleaseDate, releaseYear } from './normalize';

describe('normalizeReleaseDate', () => {
	it.each([
		['1959-08-17T07:00:00Z', '1959-08-17'],
		['2000-11-13T08:00:00Z', '2000-11-13'],
		['1959-08-17', '1959-08-17'],
		['1959-08', '1959-08'],
		['1959', '1959'],
		[' 1959 ', '1959'],
		['1959-13-01', '1959'],
		['1959-08-00', '1959-08'],
		['0000', undefined],
		['', undefined],
		[null, undefined],
		['August 1959', undefined]
	])('%s → %s', (input, expected) => {
		expect(normalizeReleaseDate(input)).toBe(expected);
	});

	it('extracts the year', () => {
		expect(releaseYear('1959-08-17')).toBe(1959);
		expect(releaseYear(undefined)).toBeUndefined();
	});
});

import { normKey, normalizeArtistName, normalizeTitle } from './normalize';

describe('normalizeTitle', () => {
	it.each([
		['Kind of Blue', 'kind of blue'],
		['Kind Of Blue', 'kind of blue'],
		['Kind of Blue (Legacy Edition)', 'kind of blue'],
		['Abbey Road (Remastered 2009)', 'abbey road'],
		['Abbey Road [2019 Mix] [Deluxe Edition]', 'abbey road 2019 mix'],
		['Here Comes the Sun - Remastered 2009', 'here comes the sun'],
		['Help! - 2011 Remaster', 'help'],
		['Get Lucky (feat. Pharrell Williams)', 'get lucky'],
		['Get Lucky feat. Pharrell Williams', 'get lucky'],
		['Blinding Lights - Single', 'blinding lights'],
		['Some EP - EP', 'some ep'],
		['Sigur Rós: Ágætis byrjun', 'sigur ros agaetis byrjun'],
		['Rock & Roll', 'rock and roll'],
		['Røyksopp: Melody A.M.', 'royksopp melody a m'],
		['(Deluxe)', 'deluxe'],
		['Live at Leeds (Live)', 'live at leeds live'],
		['Re-Mastered Hits', 're mastered hits']
	])('%s → %s', (input, expected) => {
		expect(normalizeTitle(input)).toBe(expected);
	});
});

describe('normalizeArtistName', () => {
	it('drops a leading "the" and folds case/accents/punctuation', () => {
		expect(normalizeArtistName('The Beatles')).toBe(normalizeArtistName('Beatles'));
		expect(normalizeArtistName('Beyoncé')).toBe('beyonce');
		expect(normalizeArtistName('AC/DC')).toBe('ac dc');
		expect(normalizeArtistName('The The')).toBe('the');
	});
});

describe('normKey', () => {
	it('matches the same album across providers', () => {
		expect(normKey('album', { name: 'Kind of Blue', artistName: 'Miles Davis' })).toBe(
			normKey('album', { name: 'Kind Of Blue', artistName: 'Miles Davis' })
		);
		expect(normKey('album', { name: 'Kind of Blue', artistName: 'Miles Davis' })).toBe('album|miles davis|kind of blue');
	});

	it('keeps kinds, artists and albums apart', () => {
		const album = normKey('album', { name: 'Blue', artistName: 'Joni Mitchell' });
		expect(normKey('track', { name: 'Blue', artistName: 'Joni Mitchell', albumName: 'Blue' })).not.toBe(album);
		expect(normKey('album', { name: 'Blue', artistName: 'Weezer' })).not.toBe(album);
		expect(normKey('track', { name: 'So What', artistName: 'Miles Davis', albumName: 'Kind of Blue' })).not.toBe(
			normKey('track', { name: 'So What', artistName: 'Miles Davis', albumName: 'Live in Stockholm' })
		);
	});

	it('matches remastered and featuring variants of a track', () => {
		expect(normKey('track', { name: 'Here Comes the Sun - Remastered 2009', artistName: 'The Beatles', albumName: 'Abbey Road (Remastered)' })).toBe(
			normKey('track', { name: 'Here Comes The Sun', artistName: 'Beatles', albumName: 'Abbey Road' })
		);
	});
});
