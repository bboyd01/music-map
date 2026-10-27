import { getDb } from '#lib/server/db/index.ts';
import { exportLibrary } from '#lib/server/library/backup.ts';
import type { RequestHandler } from './$types';

/** Full library as a JSON download. */
export const GET: RequestHandler = () => {
	const date = new Date().toISOString().slice(0, 10);
	return new Response(JSON.stringify(exportLibrary(getDb())), {
		headers: {
			'content-type': 'application/json',
			'content-disposition': `attachment; filename="music-map-${date}.json"`,
			'cache-control': 'no-store'
		}
	});
};
