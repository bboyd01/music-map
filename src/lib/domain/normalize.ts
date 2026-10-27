/**
 * Normalizes provider dates to ISO, possibly partial: 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD'.
 * Accepts full timestamps ('1959-08-17T07:00:00Z' → '1959-08-17'; the date part is kept as-is
 * because Apple encodes the release day in the UTC timestamp). Returns undefined if unparseable.
 */
export function normalizeReleaseDate(value: string | null | undefined): string | undefined {
	if (!value) return undefined;
	const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?:[T ].*)?$/.exec(value.trim());
	if (!m) return undefined;
	const [, y, mo, d] = m;
	if (y === '0000') return undefined;
	if (mo && (+mo < 1 || +mo > 12)) return y;
	if (d && (+d < 1 || +d > 31)) return `${y}-${mo}`;
	return [y, mo, d].filter(Boolean).join('-');
}

/** Year of a normalized release date, or undefined. */
export function releaseYear(value: string | null | undefined): number | undefined {
	const y = value ? Number(value.slice(0, 4)) : NaN;
	return Number.isInteger(y) ? y : undefined;
}
