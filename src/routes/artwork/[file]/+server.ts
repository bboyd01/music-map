import fs from 'node:fs/promises';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import { ARTWORK_FILE, ARTWORK_MIME, findThumb } from '#lib/server/artwork.ts';
import { artworkDir } from '#lib/server/db/index.ts';
import type { RequestHandler } from './$types';

/**
 * Authenticated (via hooks) serving of downloaded artwork. Files are content-addressed, so cache
 * hard. `?small` serves the ~200px copy; until it exists, the full cover is served briefly cached.
 */
export const GET: RequestHandler = async ({ params, url }) => {
	if (!ARTWORK_FILE.test(params.file)) error(404);
	const thumb = url.searchParams.has('small') ? await findThumb(artworkDir, params.file) : undefined;
	const file = thumb ?? params.file;
	let data: Buffer;
	try {
		data = await fs.readFile(path.join(artworkDir, file));
	} catch {
		error(404);
	}
	const fallback = url.searchParams.has('small') && !thumb;
	return new Response(new Uint8Array(data), {
		headers: {
			'content-type': ARTWORK_MIME[file.split('.').pop()!],
			'cache-control': fallback ? 'private, max-age=300' : 'private, max-age=31536000, immutable'
		}
	});
};
