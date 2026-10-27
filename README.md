# Music Map

A single-user, self-hosted PWA for mapping relationships between artists, albums, and tracks, and
for keeping a Letterboxd-style listening list. See `PLAN.md` for the full spec.

SvelteKit + TypeScript (`adapter-node`), SQLite (`better-sqlite3` + Drizzle). One Docker image,
one `/data` volume.

## Configuration

| Variable | Required | Description |
|---|---|---|
| `ORIGIN` | yes in production | Public URL, e.g. `https://music.example.com`. Every request is pinned to this origin for CSRF checks. If it's `https://`, session cookies are `Secure` and HSTS is sent. |
| `APP_PASSWORD_HASH` | yes | Output of `npx tsx scripts/hash-password.ts`. |
| `SESSION_SECRET` | yes | Random string, 32+ chars (`openssl rand -hex 32`). Keys the stored session-token hashes. |
| `DATA_DIR` | no | Where the DB and artwork live. Default `./data`, `/data` in Docker. |
| `TRUST_PROXY` | no | `true` when behind a reverse proxy, so login rate limiting uses the client IP from `X-Forwarded-For`. Leave it off if the app is directly reachable, or clients can spoof their IP. |
| `MB_USER_AGENT` | for enrichment | Sent to MusicBrainz, e.g. `MusicMap/1.0 (you@example.com)`. |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | no | Enables Spotify links and search. |
| `LASTFM_API_KEY` | no | Enables Last.fm "similar" suggestions. |
| `PORT` | no | Default `3000`. |

The app refuses to start if `APP_PASSWORD_HASH` or `SESSION_SECRET` is missing or invalid.

### Generating the password hash

```sh
npx tsx scripts/hash-password.ts             # prompts twice, input hidden
echo -n 'my password' | npx tsx scripts/hash-password.ts
```

The hash looks like `scrypt:32768:8:1:<salt>:<hash>`. It has no `$`, so it can go straight into
`.env` or a compose file. To change the password, set a new hash, restart, then use
**Settings → Log out everywhere**.

## Running with Docker

```sh
cp docker-compose.example.yml docker-compose.yml
cp .env.example .env        # fill in the values
docker compose up -d --build
```

The DB (`music-map.db`) and `artwork/` are stored in the `music-map-data` volume at `/data`, so
they survive container recreation. The container runs as the non-root `node` user and has a
`HEALTHCHECK` on `/healthz`. Migrations run automatically on startup.

### Reverse proxy and TLS

TLS is the reverse proxy's job (Caddy, Traefik, Coolify, Cloudflare Tunnel, …). The compose
example binds to `127.0.0.1:3000` only. Point the proxy at it, set `ORIGIN` to the public https
URL, and set `TRUST_PROXY=true`. Caddy example:

```
music.example.com {
	reverse_proxy 127.0.0.1:3000
}
```

The proxy must append the client address to `X-Forwarded-For`. Caddy, Traefik and nginx
(`proxy_add_x_forwarded_for`) all do this.

### Backups

SQLite runs in WAL mode, so don't copy a live `music-map.db` file on its own. Either:

- stop the container and copy the whole `/data` volume, or
- run `sqlite3 /data/music-map.db ".backup /data/backup.db"` while it runs.

JSON export/import comes in a later milestone.

## Development

```sh
npm install
cp .env.example .env         # set APP_PASSWORD_HASH and SESSION_SECRET; DATA_DIR=./data
npm run dev                  # dev server on http://localhost:5173
npm run test                 # vitest
npm run check                # svelte-check / TypeScript
npm run build && npm start   # production build (node server.js)
npm run db:generate          # generate a Drizzle migration after editing schema.ts
```

In dev, `ORIGIN` can be left unset.

### Provider scripts

```sh
# Live check: resolve a link (or search text) and print the normalized metadata
npx tsx scripts/resolve-link.ts 'https://music.apple.com/us/album/kind-of-blue/268443092'
npx tsx scripts/resolve-link.ts --track 'so what miles davis'

# Re-record test fixtures from the live APIs (tests themselves never call live APIs)
npx tsx scripts/record-fixtures.ts apple
SPOTIFY_CLIENT_ID=… SPOTIFY_CLIENT_SECRET=… npx tsx scripts/record-fixtures.ts spotify
```

The Spotify fixtures are currently hand-written from the API reference (each entry has a `note`
saying so). Re-record them once you have credentials.

## Security notes

- Everything except `/login`, `/healthz`, and static PWA assets (manifest, icons, service worker,
  built JS/CSS) needs a session. Unauthenticated page requests redirect to `/login`, and
  `/api/*` and `/artwork/*` return `401`.
- Sessions are random 256-bit tokens in an `HttpOnly; SameSite=Lax` cookie (`Secure` over https).
  Only an HMAC of the token is stored. They last 30 days, sliding.
- Login is rate-limited to 5 attempts per IP per 15 minutes, plus a small global delay after
  repeated failures.
- A CSP (with nonces), `X-Content-Type-Options`, `Referrer-Policy` and `frame-ancestors 'none'`
  are set on every response.
