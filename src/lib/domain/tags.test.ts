import { describe, expect, it } from 'vitest';
import { byFrequency, instrumentName, providerGenres, slugify, topGenres } from './tags';

describe('tags', () => {
	it('slugifies', () => {
		expect(slugify('Hip Hop')).toBe(slugify('hip-hop'));
		expect(slugify('R&B')).toBe('r-and-b');
		expect(slugify('Música Popular Brasileira')).toBe('musica-popular-brasileira');
		expect(slugify('20th Century')).toBe('20th-century');
	});

	it('splits and cleans provider genres', () => {
		expect(providerGenres(['Hip-Hop/Rap'])).toEqual(['hip-hop', 'rap']);
		expect(providerGenres(['Jazz', 'jazz', 'Music'])).toEqual(['jazz']);
		expect(providerGenres(['R&B/Soul', 'cool jazz'])).toEqual(['r&b', 'soul', 'cool jazz']);
	});

	it('takes the top MusicBrainz genres by votes', () => {
		const g = [
			{ name: 'jazz', count: 28 },
			{ name: 'cool jazz', count: 7 },
			{ name: 'modal jazz', count: 4 },
			{ name: 'hard bop', count: 3 },
			{ name: 'post-bop', count: 2 },
			{ name: 'zero', count: 0 }
		];
		expect(topGenres(g)).toEqual(['jazz', 'cool jazz']);
		expect(topGenres([{ name: 'a', count: 1 }, { name: 'b', count: 1 }])).toEqual(['a', 'b']);
		expect(topGenres([])).toEqual([]);
	});

	it('normalizes instrument names', () => {
		expect(instrumentName('drums (drum set)')).toBe('drums');
		expect(instrumentName('Tenor Saxophone')).toBe('tenor saxophone');
		expect(instrumentName('lead vocals')).toBe('vocals');
		expect(instrumentName('vocal')).toBe('vocals');
	});

	it('orders by frequency', () => {
		expect(byFrequency(['piano', 'trumpet', 'piano', 'bass', 'trumpet', 'piano'], 2)).toEqual(['piano', 'trumpet']);
	});
});
