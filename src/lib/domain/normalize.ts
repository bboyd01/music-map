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

const EDITION_WORDS =
	'remaster|remastered|deluxe|expanded|anniversary|edition|version|mono|stereo|bonus|reissue';
/** "(Remastered 2009)", "[Deluxe Edition]", "(Legacy Edition)" … */
const EDITION_PARENS = new RegExp(`\\s*[([][^)\\]]*\\b(?:${EDITION_WORDS})\\b[^)\\]]*[)\\]]`, 'gi');
/** "- Remastered 2009", "- 2011 Remaster", "- Mono Version" at the end. */
const EDITION_DASH = new RegExp(`\\s+[-–—]\\s+[^-–—]*\\b(?:${EDITION_WORDS})\\b[^-–—]*$`, 'i');
/** Apple appends these to single/EP album names. */
const RELEASE_TYPE = /\s+-\s+(?:single|ep)$/i;
const FEATURING = /\s*[([]\s*(?:feat\.?|ft\.?|featuring)\s[^)\]]*[)\]]|\s+(?:feat\.?|ft\.?|featuring)\s.*$/gi;

/** Letters NFKD doesn't decompose. */
const LETTERS: Record<string, string> = { æ: 'ae', ø: 'o', œ: 'oe', ß: 'ss', ð: 'd', þ: 'th', ł: 'l', đ: 'd', ı: 'i' };

function fold(s: string): string {
	return s
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[æøœßðþłđı]/g, (c) => LETTERS[c])
		.replace(/&/g, ' and ')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
}

export function normalizeArtistName(name: string): string {
	return fold(name).replace(/^the /, '');
}

/** Folds a release/track title so that editions, remasters and feat. credits compare equal. */
export function normalizeTitle(title: string): string {
	const stripped = title
		.replace(FEATURING, '')
		.replace(EDITION_PARENS, '')
		.replace(EDITION_DASH, '')
		.replace(RELEASE_TYPE, '');
	// Never fold a title down to nothing (e.g. an album literally called "(Deluxe)").
	return fold(stripped) || fold(title);
}

/**
 * Dedupe key used to match the same artist/album/track across providers. Tracks include their
 * album so the same song on different releases stays distinct.
 */
export function normKey(
	kind: 'artist' | 'album' | 'track',
	parts: { name: string; artistName?: string; albumName?: string }
): string {
	if (kind === 'artist') return `artist|${normalizeArtistName(parts.name)}`;
	const artist = normalizeArtistName(parts.artistName ?? '');
	if (kind === 'album') return `album|${artist}|${normalizeTitle(parts.name)}`;
	return `track|${artist}|${normalizeTitle(parts.albumName ?? '')}|${normalizeTitle(parts.name)}`;
}
