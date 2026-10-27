import { error } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.ts';
import { listSuggestions } from '#lib/server/enrich/suggestions.ts';
import { getEntityDetail } from '#lib/server/library/entity.ts';
import { idParam } from '#lib/server/params.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, depends }) => {
	depends('app:entity', 'app:suggestions');
	const id = idParam(params.id);
	const entity = getEntityDetail(getDb(), id);
	if (!entity) error(404, 'Not found');
	return { entity, suggestions: listSuggestions(getDb(), id) };
};
