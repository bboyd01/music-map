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
