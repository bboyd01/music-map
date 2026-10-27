export type Facet = 'genre' | 'era' | 'instrument';
export const FACETS: Facet[] = ['genre', 'era', 'instrument'];

/** URL-safe identity of a tag within its facet: "Hip Hop" and "hip-hop" are the same tag. */
export function slugify(name: string): string {
	return name
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/&/g, ' and ')
		.replace(/[^\p{L}\p{N}]+/gu, '-')
		.replace(/^-+|-+$/g, '');
}

/** Display form for genres and instruments: lowercase, single spaces (eras keep their casing). */
export function cleanTagName(facet: Facet, name: string): string {
	const trimmed = name.replace(/\s+/g, ' ').trim();
	return facet === 'era' ? trimmed : trimmed.toLowerCase();
}

/** Provider genre strings that carry no information. */
const IGNORED_GENRES = new Set(['music', 'other', 'unknown', 'misc', 'genre']);

/** "Hip-Hop/Rap" → ["hip-hop", "rap"]; drops filler like "Music". Deduped by slug. */
export function providerGenres(raw: string[]): string[] {
	const out = new Map<string, string>();
	for (const g of raw) {
		for (const part of g.split('/')) {
			const name = cleanTagName('genre', part);
			const slug = slugify(name);
			if (slug && !IGNORED_GENRES.has(slug) && !out.has(slug)) out.set(slug, name);
		}
	}
	return [...out.values()];
}

/** Top MusicBrainz genres by vote count: at most `max`, and at least a quarter of the top count. */
export function topGenres(genres: { name: string; count: number }[], max = 5): string[] {
	const sorted = genres.filter((g) => g.count > 0).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
	if (!sorted.length) return [];
	const floor = Math.max(1, sorted[0].count / 4);
	return sorted
		.filter((g) => g.count >= floor)
		.slice(0, max)
		.map((g) => cleanTagName('genre', g.name));
}

/** MusicBrainz instrument attributes → tag names: "drums (drum set)" → "drums", vocal rels → "vocals". */
export function instrumentName(attribute: string): string {
	const name = cleanTagName('instrument', attribute.replace(/\s*\([^)]*\)/g, ''));
	if (/^(lead |background |backing |choir |other )?vocals?$/.test(name)) return 'vocals';
	return name;
}

/** Most frequent first, ties alphabetical, capped. */
export function byFrequency(values: string[], max = 12): string[] {
	const counts = new Map<string, number>();
	for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, max)
		.map(([v]) => v);
}
