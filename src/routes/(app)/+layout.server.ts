import { getDb } from '#lib/server/db/index.ts';
import { countSuggestions } from '#lib/server/enrich/suggestions.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ depends }) => {
	depends('app:suggestions');
	return { suggestionCount: countSuggestions(getDb()) };
};
