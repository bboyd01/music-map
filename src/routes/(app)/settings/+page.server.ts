import { LASTFM_API_KEY, MB_USER_AGENT } from '$app/env/private';
import { spotifyEnabled } from '#lib/server/providers/index.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({ spotifyEnabled, musicBrainzEnabled: !!MB_USER_AGENT, lastfmEnabled: !!LASTFM_API_KEY });
