/** Ratings are stored as 0–10 half-stars (null = unrated) and shown as 0–5 stars. */
export type Rating = number | null;

export function clampRating(value: unknown): Rating {
	if (value === null || value === undefined || value === '') return null;
	const n = Number(value);
	if (!Number.isFinite(n)) return null;
	return Math.min(10, Math.max(0, Math.round(n)));
}

/** "3½", "4", "0"; empty for unrated. */
export function formatStars(rating: Rating): string {
	if (rating === null) return '';
	const whole = Math.floor(rating / 2);
	return rating % 2 ? `${whole === 0 ? '' : whole}½` : String(whole);
}

/** Fill state for each of the five stars. */
export function starFills(rating: Rating): ('full' | 'half' | 'empty')[] {
	const r = rating ?? 0;
	return [0, 1, 2, 3, 4].map((i) => (r >= i * 2 + 2 ? 'full' : r === i * 2 + 1 ? 'half' : 'empty'));
}
