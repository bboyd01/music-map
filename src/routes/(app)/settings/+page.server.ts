import { spotifyEnabled } from '#lib/server/providers/index.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({ spotifyEnabled });
