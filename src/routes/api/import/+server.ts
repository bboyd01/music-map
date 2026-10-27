import { json } from '@sveltejs/kit';
import { artworkDir, getDb } from '#lib/server/db/index.ts';
import { importLibrary, parseExport } from '#lib/server/library/backup.ts';
import type { RequestHandler } from './$types';

/** Merges an export file (JSON body) into the library. Safe to run more than once. */
export const POST: RequestHandler = async ({ request }) => {
	const raw = await request.json().catch(() => undefined);
	if (raw === undefined) return json({ error: 'Expected a JSON export file.' }, { status: 400 });
	const parsed = parseExport(raw);
	if (!parsed.ok) return json({ error: parsed.message }, { status: 422 });
	return json(importLibrary(getDb(), parsed.data, artworkDir));
};
