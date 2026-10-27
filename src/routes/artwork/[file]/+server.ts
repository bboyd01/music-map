import fs from 'node:fs/promises';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import { ARTWORK_FILE, ARTWORK_MIME } from '#lib/server/artwork.ts';
import { artworkDir } from '#lib/server/db/index.ts';
import type { RequestHandler } from './$types';

/** Authenticated (via hooks) serving of downloaded artwork. Files are content-addressed, so cache hard. */
export const GET: RequestHandler = async ({ params }) => {
	if (!ARTWORK_FILE.test(params.file)) error(404);
	let data: Buffer;
	try {
		data = await fs.readFile(path.join(artworkDir, params.file));
	} catch {
		error(404);
	}
	return new Response(new Uint8Array(data), {
		headers: {
			'content-type': ARTWORK_MIME[params.file.split('.').pop()!],
			'cache-control': 'private, max-age=31536000, immutable'
		}
	});
};
