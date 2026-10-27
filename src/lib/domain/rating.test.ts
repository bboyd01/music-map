import { describe, expect, it } from 'vitest';
import { clampRating, formatStars, starFills } from './rating';

describe('rating helpers', () => {
	it('clamps and rounds input', () => {
		expect(clampRating(7)).toBe(7);
		expect(clampRating('3')).toBe(3);
		expect(clampRating(11)).toBe(10);
		expect(clampRating(-1)).toBe(0);
		expect(clampRating(6.6)).toBe(7);
		expect(clampRating(null)).toBeNull();
		expect(clampRating('')).toBeNull();
		expect(clampRating('x')).toBeNull();
	});

	it('formats half stars', () => {
		expect(formatStars(7)).toBe('3½');
		expect(formatStars(1)).toBe('½');
		expect(formatStars(10)).toBe('5');
		expect(formatStars(0)).toBe('0');
		expect(formatStars(null)).toBe('');
	});

	it('computes star fills', () => {
		expect(starFills(7)).toEqual(['full', 'full', 'full', 'half', 'empty']);
		expect(starFills(null)).toEqual(['empty', 'empty', 'empty', 'empty', 'empty']);
		expect(starFills(10)).toEqual(['full', 'full', 'full', 'full', 'full']);
	});
});
