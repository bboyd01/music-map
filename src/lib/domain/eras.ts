import { slugify } from './tags';

/** Seeded period vocabulary (section 6.3). `to` is exclusive. */
export const PERIODS = [
	{ name: 'Medieval', from: -Infinity, to: 1400 },
	{ name: 'Renaissance', from: 1400, to: 1600 },
	{ name: 'Baroque', from: 1600, to: 1750 },
	{ name: 'Classical', from: 1750, to: 1820 },
	{ name: 'Romantic', from: 1820, to: 1900 },
	{ name: '20th Century', from: 1900, to: 1975 },
	{ name: 'Contemporary', from: 1975, to: Infinity }
] as const;

export const FIRST_DECADE = 1920;

export function decades(until = new Date().getFullYear()): string[] {
	const out: string[] = [];
	for (let d = FIRST_DECADE; d <= until; d += 10) out.push(`${d}s`);
	return out;
}

/** All era names to seed: periods, then decades. */
export function eraVocabulary(until?: number): string[] {
	return [...PERIODS.map((p) => p.name), ...decades(until)];
}

export function periodForYear(year: number): string {
	return PERIODS.find((p) => year >= p.from && year < p.to)!.name;
}

/** "1959" → "1950s"; nothing before the 1920s (the vocabulary starts there). */
export function decadeForYear(year: number | undefined): string | undefined {
	if (year === undefined || !Number.isInteger(year) || year < FIRST_DECADE) return undefined;
	return `${Math.floor(year / 10) * 10}s`;
}

const year = (date: string | null | undefined) => {
	const y = date ? Number(date.slice(0, 4)) : NaN;
	return Number.isInteger(y) ? y : undefined;
};

/**
 * The year that best represents a composer's output: the middle of their working life
 * (from age 20 to death), or age 40 for living composers.
 * Bach (1685–1750) → 1727, Mozart (1756–1791) → 1783, Chopin (1810–1849) → 1839.
 */
export function composerYear(begin: string | null | undefined, end: string | null | undefined, now = new Date().getFullYear()) {
	const born = year(begin);
	if (born === undefined) return undefined;
	const died = year(end);
	if (died === undefined) return Math.min(born + 40, now);
	const start = Math.min(born + 20, died);
	return Math.round((start + died) / 2);
}

export function composerPeriod(begin: string | null | undefined, end: string | null | undefined, now?: number) {
	const y = composerYear(begin, end, now);
	return y === undefined ? undefined : periodForYear(y);
}

const CLASSICAL_SLUGS = new Set([
	'classical',
	'baroque',
	'opera',
	'early-music',
	'chamber-music',
	'choral',
	'orchestral',
	'symphony',
	'concerto',
	'oratorio',
	'art-song',
	'lied',
	'romanticism',
	'renaissance',
	'medieval',
	'impressionism',
	'neoclassicism',
	'minimalism',
	'contemporary-classical',
	'modern-classical',
	'avant-garde-classical'
]);

/** Whether a set of genre names marks the music as classical (for composer-based eras). */
export function isClassical(genres: string[]): boolean {
	return genres.some((g) => {
		const s = slugify(g);
		return CLASSICAL_SLUGS.has(s) || s.includes('classical') || s.includes('baroque') || s.endsWith('opera');
	});
}
