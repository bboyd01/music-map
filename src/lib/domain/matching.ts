import { normalizeArtistName, normalizeTitle } from './normalize';

/**
 * Title used for matching against MusicBrainz: drops a "Composer:" prefix, catalogue numbers
 * (BWV 988, Op. 3, K. 525 …), recording-year notes and a leading "the".
 */
export function matchTitle(title: string): string {
	return normalizeTitle(
		title
			.replace(/^[^:]{2,40}:\s+(?=\S)/, '')
			.replace(/\b(?:BWV|HWV|RV|KV|K|Op|D|WoO|Hob\.?\s*[IVX]+:?)\.?\s*\d+[a-z]?(?:\s*,?\s*No\.?\s*\d+)?/gi, '')
			.replace(/\(\s*\d{4}\s+recordings?\s*\)|\(\s*recorded\s+\d{4}\s*\)/gi, '')
			.replace(/\(\s*\d{4}\s+(?:&|and)\s+\d{4}\s+recordings?\s*\)/gi, '')
	).replace(/^the /, '');
}

function tokens(s: string): Set<string> {
	return new Set(s.split(' ').filter(Boolean));
}

/** Jaccard similarity of word sets, 0–1. */
export function similarity(a: string, b: string): number {
	const ta = tokens(a);
	const tb = tokens(b);
	if (!ta.size || !tb.size) return 0;
	let shared = 0;
	for (const t of ta) if (tb.has(t)) shared++;
	return shared / (ta.size + tb.size - shared);
}

/** "Itzhak Perlman, London Philharmonic Orchestra & Israel PO" → normalized individual names. */
export function splitArtists(credit: string): string[] {
	return credit
		.split(/\s*(?:,|&|\band\b|;|\/|\bfeat\.?|\bwith\b)\s*/i)
		.map(normalizeArtistName)
		.filter(Boolean);
}

export interface Candidate {
	id: string;
	title: string;
	artists: string[];
	year?: number;
	/** MusicBrainz' own search score, 0–100. */
	score: number;
}

export interface Wanted {
	title: string;
	artist: string;
	year?: number;
}

/** Confidence that a MusicBrainz candidate is the item we have, 0–1 (0 = reject). */
export function matchConfidence(wanted: Wanted, c: Candidate): number {
	const ours = splitArtists(wanted.artist);
	const theirs = c.artists.flatMap(splitArtists);
	const artistOk = ours.some((a) => theirs.includes(a)) || normalizeArtistName(wanted.artist) === theirs.join(' and ');
	if (!artistOk) return 0;

	const wt = matchTitle(wanted.title);
	const ct = matchTitle(c.title);
	const titleScore = wt === ct ? 1 : similarity(wt, ct);
	if (titleScore < 0.6) return 0;

	let yearFactor = 1;
	if (wanted.year !== undefined && c.year !== undefined) {
		const gap = Math.abs(wanted.year - c.year);
		yearFactor = gap === 0 ? 1 : gap <= 1 ? 0.95 : gap <= 3 ? 0.85 : 0.75;
	}
	return titleScore * yearFactor * (0.7 + 0.3 * (c.score / 100));
}

export const MATCH_THRESHOLD = 0.7;

/** Best candidate above the threshold, or undefined (left unmatched for manual re-match). */
export function bestMatch(wanted: Wanted, candidates: Candidate[]): { candidate: Candidate; confidence: number } | undefined {
	let best: { candidate: Candidate; confidence: number } | undefined;
	for (const c of candidates) {
		const confidence = matchConfidence(wanted, c);
		if (confidence >= MATCH_THRESHOLD && (!best || confidence > best.confidence)) best = { candidate: c, confidence };
	}
	return best;
}
