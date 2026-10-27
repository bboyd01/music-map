import { defineEnvVars } from '@sveltejs/kit/env';
import { building } from '$app/env';

const optional = (value: string | undefined) => value || undefined;

export const variables = defineEnvVars({
	APP_PASSWORD_HASH: {
		description: 'scrypt hash of the app password, from `npx tsx scripts/hash-password.ts`',
		schema: (value) => {
			if (!building && !value?.startsWith('scrypt:')) {
				throw new Error('APP_PASSWORD_HASH must be set (generate it with scripts/hash-password.ts)');
			}
			return value ?? '';
		}
	},
	SESSION_SECRET: {
		description: 'Random secret (32+ chars) used to key session token hashes',
		schema: (value) => {
			if (!building && (!value || value.length < 32)) throw new Error('SESSION_SECRET must be at least 32 characters');
			return value ?? '';
		}
	},
	ORIGIN: {
		description: 'Public URL of the app, e.g. https://music.example.com',
		schema: optional
	},
	DATA_DIR: {
		description: 'Directory holding the SQLite DB and artwork',
		schema: (value) => value || './data'
	},
	TRUST_PROXY: {
		description: 'Trust X-Forwarded-For from the reverse proxy for client IPs',
		schema: (value) => value === 'true' || value === '1'
	},
	MB_USER_AGENT: {
		description: 'User-Agent sent to MusicBrainz, with contact info',
		schema: optional
	},
	SPOTIFY_CLIENT_ID: { schema: optional },
	SPOTIFY_CLIENT_SECRET: { schema: optional },
	LASTFM_API_KEY: { schema: optional }
});
