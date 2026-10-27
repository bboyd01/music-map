import { artworkDir, getDb } from '../db/index.ts';
import { getProviders } from '../providers/index.ts';
import type { LibraryDeps } from './service';

export function libraryDeps(): LibraryDeps {
	return {
		db: getDb(),
		providers: getProviders(),
		artworkDir,
		log: (msg) => console.warn(`[library] ${msg}`)
	};
}
