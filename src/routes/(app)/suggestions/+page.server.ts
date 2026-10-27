import { getDb } from '#lib/server/db/index.ts';
import { listSuggestions } from '#lib/server/enrich/suggestions.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ depends }) => {
	depends('app:suggestions');
	return { suggestions: listSuggestions(getDb()) };
};
