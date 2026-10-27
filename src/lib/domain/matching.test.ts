import { describe, expect, it } from 'vitest';
import { bestMatch, matchConfidence, matchTitle, similarity, splitArtists } from './matching';

describe('matchTitle', () => {
	it.each([
		['Bach: Goldberg Variations, BWV 988 (1981 Recording)', 'goldberg variations'],
		['The Goldberg Variations', 'goldberg variations'],
		['Bach: The Goldberg Variations, BWV 988 (1981 Recording, Remastered)', 'goldberg variations'],
		['Vivaldi: The Four Seasons', 'four seasons'],
		['Mozart: Eine kleine Nachtmusik, K. 525', 'eine kleine nachtmusik'],
		['Chopin: Nocturnes, Op. 9 No. 2', 'nocturnes'],
		['Kind of Blue', 'kind of blue'],
		['AC/DC Live', 'ac dc live'],
		['Led Zeppelin II', 'led zeppelin ii']
	])('%s → %s', (input, expected) => {
		expect(matchTitle(input)).toBe(expected);
	});
});

describe('matching', () => {
	it('splits artist credits', () => {
		expect(splitArtists('Itzhak Perlman, London Philharmonic Orchestra & Israel Philharmonic Orchestra')).toEqual([
			'itzhak perlman',
			'london philharmonic orchestra',
			'israel philharmonic orchestra'
		]);
	});

	it('scores word overlap', () => {
		expect(similarity('kind of blue', 'kind of blue')).toBe(1);
		expect(similarity('a b', 'c d')).toBe(0);
	});

	it('accepts the original album over reissues and compilations', () => {
		const wanted = { title: 'Kind of Blue', artist: 'Miles Davis', year: 1959 };
		const result = bestMatch(wanted, [
			{ id: 'combo', title: 'Sketches of Spain / Kind of Blue / In a Silent Way', artists: ['Miles Davis'], year: 1997, score: 73 },
			{ id: 'kob', title: 'Kind of Blue', artists: ['Miles Davis'], year: 1959, score: 100 }
		]);
		expect(result?.candidate.id).toBe('kob');
	});

	it('matches classical albums credited to composer + performer, preferring the right year', () => {
		const wanted = { title: 'Bach: Goldberg Variations, BWV 988 (1981 Recording)', artist: 'Glenn Gould', year: 1982 };
		const result = bestMatch(wanted, [
			{ id: '1956', title: 'The Goldberg Variations', artists: ['Bach', 'Glenn Gould'], year: 1956, score: 100 },
			{ id: '1982', title: 'The Goldberg Variations', artists: ['Bach', 'Glenn Gould'], year: 1982, score: 100 },
			{ id: 'state', title: 'A State of Wonder: The Complete Goldberg Variations 1955 & 1981', artists: ['Glenn Gould'], year: 2002, score: 81 }
		]);
		expect(result?.candidate.id).toBe('1982');
	});

	it('rejects wrong artists and weak titles', () => {
		expect(matchConfidence({ title: 'Kind of Blue', artist: 'Hellberg' }, { id: 'x', title: 'Kind of Blue', artists: ['Miles Davis'], score: 100 })).toBe(0);
		expect(bestMatch({ title: 'Blue', artist: 'Joni Mitchell' }, [{ id: 'x', title: 'Blue Hour Sessions', artists: ['Joni Mitchell'], score: 90 }])).toBeUndefined();
	});
});
