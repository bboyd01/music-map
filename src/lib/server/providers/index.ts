import { eq } from 'drizzle-orm';
import { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } from '$app/env/private';
import { getDb } from '../db/index.ts';
import { kv } from '../db/schema.ts';
import { AppleProvider } from './apple';
import { resolveInput, type Providers } from './resolve';
import { SpotifyProvider, type TokenStore } from './spotify';

export const spotifyEnabled = Boolean(SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET);

const TOKEN_KEY = 'spotify_token';

/** Keeps the Spotify access token in `kv` so restarts don't fetch a new one. */
function kvTokenStore(): TokenStore {
	return {
		get() {
			const row = getDb().select().from(kv).where(eq(kv.key, TOKEN_KEY)).get();
			if (!row) return null;
			try {
				return JSON.parse(row.value);
			} catch {
				return null;
			}
		},
		set(value) {
			getDb()
				.insert(kv)
				.values({ key: TOKEN_KEY, value: JSON.stringify(value) })
				.onConflictDoUpdate({ target: kv.key, set: { value: JSON.stringify(value) } })
				.run();
		}
	};
}

let instance: Providers | undefined;

export function getProviders(): Providers {
	instance ??= {
		apple: new AppleProvider(),
		spotify: spotifyEnabled
			? new SpotifyProvider({
					clientId: SPOTIFY_CLIENT_ID!,
					clientSecret: SPOTIFY_CLIENT_SECRET!,
					tokenStore: kvTokenStore()
				})
			: null
	};
	return instance;
}

export const resolve = (input: string) => resolveInput(input, getProviders());
