import { describe, expect, it } from 'vitest';
import { composerPeriod, composerYear, decadeForYear, eraVocabulary, isClassical, periodForYear } from './eras';

describe('eras', () => {
	it('maps years to periods at the boundaries', () => {
		expect(periodForYear(1300)).toBe('Medieval');
		expect(periodForYear(1400)).toBe('Renaissance');
		expect(periodForYear(1600)).toBe('Baroque');
		expect(periodForYear(1749)).toBe('Baroque');
		expect(periodForYear(1750)).toBe('Classical');
		expect(periodForYear(1820)).toBe('Romantic');
		expect(periodForYear(1900)).toBe('20th Century');
		expect(periodForYear(1975)).toBe('Contemporary');
	});

	it('derives decade tags from 1920 on', () => {
		expect(decadeForYear(1959)).toBe('1950s');
		expect(decadeForYear(2020)).toBe('2020s');
		expect(decadeForYear(1920)).toBe('1920s');
		expect(decadeForYear(1919)).toBeUndefined();
		expect(decadeForYear(undefined)).toBeUndefined();
	});

	it('assigns composers the period of their working life', () => {
		expect(composerPeriod('1685-03-31', '1750-07-28')).toBe('Baroque'); // Bach
		expect(composerPeriod('1678-03-04', '1741-07-28')).toBe('Baroque'); // Vivaldi
		expect(composerPeriod('1756-01-27', '1791-12-05')).toBe('Classical'); // Mozart
		expect(composerPeriod('1810-03-01', '1849-10-17')).toBe('Romantic'); // Chopin
		expect(composerPeriod('1525', '1594')).toBe('Renaissance'); // Palestrina
		expect(composerPeriod('1882', '1971')).toBe('20th Century'); // Stravinsky
		expect(composerPeriod('1935-09-11', null, 2026)).toBe('Contemporary'); // Pärt (living)
		expect(composerYear('1990', null, 2026)).toBe(2026);
		expect(composerPeriod(null, '1750')).toBeUndefined();
	});

	it('detects classical genres', () => {
		expect(isClassical(['Classical'])).toBe(true);
		expect(isClassical(['jazz', 'baroque'])).toBe(true);
		expect(isClassical(['Opera'])).toBe(true);
		expect(isClassical(['modern classical'])).toBe(true);
		expect(isClassical(['jazz', 'cool jazz'])).toBe(false);
		expect(isClassical(['soap opera soundtrack'])).toBe(false);
	});

	it('seeds the vocabulary', () => {
		expect(eraVocabulary(2026)).toEqual([
			'Medieval', 'Renaissance', 'Baroque', 'Classical', 'Romantic', '20th Century', 'Contemporary',
			'1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'
		]);
	});
});
