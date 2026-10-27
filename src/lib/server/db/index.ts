import path from 'node:path';
import { DATA_DIR } from '$app/env/private';
import { openDb, type DB } from './client';

const dataDir = path.resolve(DATA_DIR);
export const artworkDir = path.join(dataDir, 'artwork');

let instance: DB | undefined;

/** Lazily opened app DB, so nothing touches disk during `vite build` analysis. */
export function getDb(): DB {
	instance ??= openDb(path.join(dataDir, 'music-map.db'));
	return instance;
}
