import { error } from '@sveltejs/kit';

/** Parses a numeric route id, 404ing on anything else. */
export function idParam(raw: string): number {
	const id = Number(raw);
	if (!Number.isSafeInteger(id) || id <= 0) error(404, 'Not found');
	return id;
}
