# Music Map

A single-user, self-hosted PWA for mapping relationships between artists, albums, and tracks, and
for keeping a Letterboxd-style listening list. See `PLAN.md` for the full spec.

SvelteKit + TypeScript (`adapter-node`), SQLite (`better-sqlite3` + Drizzle). One Docker image,
one `/data` volume.

## Configuration

| Variable | Required | Description |
|---|---|---|
| `ORIGIN` | yes in production | Public URL, e.g. `https://music.example.com`. Every request is pinned to this origin for CSRF checks. If it's `https://`, session cookies are `Secure` and HSTS is sent. |
| `APP_PASSWORD_HASH` | yes | Output of `scripts/hash-password.ts` (see below). |
| `SESSION_SECRET` | yes | Random string, 32+ chars (`openssl rand -hex 32`). Keys the stored session-token hashes. |
| `DATA_DIR` | no | Where the DB and artwork live. Default `./data`, `/data` in Docker. |
| `TRUST_PROXY` | no | `true` when behind a reverse proxy (the compose default), so login rate limiting uses the client IP from `X-Forwarded-For`. Set `false` if the app is directly reachable, or clients can spoof their IP. |
| `MB_USER_AGENT` | for enrichment | Sent with every MusicBrainz request, e.g. `MusicMap/1.0 (you@example.com)`. MusicBrainz requires contact info. Without it, items only get the provider's genre and a decade tag. |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | no | Enables Spotify links and search. |
| `LASTFM_API_KEY` | no | Enables Last.fm "similar" suggestions. |
| `PORT` | no | Default `3000`. |
| `BODY_SIZE_LIMIT` | no | Max request size (adapter-node). The Docker image sets `25M` so large JSON imports fit. |

The app refuses to start if `APP_PASSWORD_HASH` or `SESSION_SECRET` is missing or invalid.

### Generating the password hash

```sh
# With Docker (no Node needed on the host); prompts twice, input hidden:
docker compose run --rm -it music-map node --experimental-strip-types scripts/hash-password.ts

# From a checkout with Node 22+:
npx tsx scripts/hash-password.ts
echo -n 'my password' | npx tsx scripts/hash-password.ts
```

The hash looks like `scrypt:32768:8:1:<salt>:<hash>`. It has no `$`, so it can go straight into
`.env` or a compose file. To change the password, set a new hash, restart, then use
**Settings → Log out everywhere**.

## Running with Docker

`docker-compose.yml` is ready to use. All settings come from `.env`, so the compose file itself
doesn't need editing.

```sh
git clone https://github.com/bboyd01/music-map.git && cd music-map
cp .env.example .env
docker compose build

# Fill in .env:
docker compose run --rm -it music-map node --experimental-strip-types scripts/hash-password.ts   # → APP_PASSWORD_HASH
openssl rand -hex 32                                                                             # → SESSION_SECRET
# …and set ORIGIN and MB_USER_AGENT.

docker compose up -d
```

If `APP_PASSWORD_HASH` or `SESSION_SECRET` is missing or invalid, the app exits at startup and
`docker compose logs music-map` says which. The DB (`music-map.db`) and `artwork/` live in the `music-map-data` volume at `/data`, so
they survive container recreation. The container runs as the non-root `node` user and has a
`HEALTHCHECK` on `/healthz`. Migrations run automatically on startup.

### HTTPS

**Option A: bundled Caddy.** Point your domain's DNS at the server, open ports 80 and 443, set
`ORIGIN=https://your.domain` in `.env`, then:

```sh
docker compose --profile caddy up -d
```

Caddy gets and renews the certificate automatically and proxies to the app.

**Option B: your own reverse proxy** (Traefik, nginx, Coolify, Cloudflare Tunnel, …). Without the
profile, the app listens on `127.0.0.1:3000` only (`HOST_PORT` changes the port). Point the proxy at
it, keep `TRUST_PROXY=true`, and set `ORIGIN` to the public https URL. The proxy must append the
client address to `X-Forwarded-For`; Caddy, Traefik and nginx (`proxy_add_x_forwarded_for`) all do.

**Trying it locally over plain http:** set `ORIGIN=http://localhost:3000` and open that URL.

### Backups

Two complementary options:

- **The `/data` volume** (DB + artwork) is the complete backup. SQLite runs in WAL mode, so don't
  copy a live `music-map.db` on its own: either stop the container and copy the whole volume, or
  take a consistent snapshot while it runs:
  ```sh
  docker compose exec music-map node -e "new (require('better-sqlite3'))('/data/music-map.db').backup('/data/backup.db').then(()=>console.log('ok'))"
  ```
  then copy `/data/backup.db` and `/data/artwork/` off the server.
- **JSON export** (Settings → Export JSON, or `GET /api/export`): list, ratings, reviews, tags,
  links and remembered rejections in one portable file with a `schemaVersion`. It doesn't
  contain artwork images; those are re-used if present in `/data/artwork`, otherwise items just
  show placeholders until you hit "Refresh details".

### Restore

- **From a volume copy:** stop the container, put `music-map.db` (and `artwork/`) back into the
  volume, start it again. Remove any leftover `music-map.db-wal`/`-shm` files from the old copy.
- **From JSON:** Settings → Import JSON (or `POST /api/import` with the file as the body). Import
  merges: items are matched by Apple/Spotify/MusicBrainz ids or title, existing values win, and
  running the same import twice changes nothing. Files with an unknown `schemaVersion` are
  rejected with a clear message. Large libraries: the image sets `BODY_SIZE_LIMIT=25M` for this.

### Upgrading

```sh
git pull
docker compose up -d --build
```

Database migrations run automatically on startup. Take a backup first (see above); downgrading
after a migration isn't supported.

## Offline

The app is an installable PWA. The app shell, viewed artwork and the last-loaded pages are kept
by the service worker, so your list can be read offline (a banner says you're offline). Adding,
rating and editing need a connection. Cached pages and artwork are cleared when you log out or
your session expires.

## Development## Development

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
npx tsx scripts/record-fixtures.ts enrich      # full add + MusicBrainz enrichment flow
SPOTIFY_CLIENT_ID=… SPOTIFY_CLIENT_SECRET=… npx tsx scripts/record-fixtures.ts spotify
```

The Spotify fixtures are currently hand-written from the API reference (each entry has a `note`
saying so). Re-record them once you have credentials.

## Enrichment

Adding an item returns right away; a background job (SQLite `jobs` table, one in-process worker)
then fills in details:

- **MusicBrainz match** (1 request/second, always with `MB_USER_AGENT`): the album's release
  group, matched conservatively by title, artist and year. Below the confidence threshold it stays
  unmatched rather than guessing.
- **Genres** from MusicBrainz votes plus the provider's genre; **decade** from the release date;
  for classical music, also the **composer's period** (e.g. Baroque) from their lifespan.
- **Instruments** from MusicBrainz performer credits (track → album → artist). Coverage is sparse.
- **Artwork fallback** from the Cover Art Archive.

Tags are inherited: a track without its own genre shows its album's, then its artist's. Editing a
tag facet makes it yours; re-enrichment never touches it. Jobs retry up to 3 times with backoff and
resume after a restart; a failed enrichment never affects the item itself.

## Suggestions

After an artist is enriched, a background job proposes links:

- **Wikidata** "influenced by" (P737), reached through the artist's MusicBrainz → Wikidata link.
  Only influences that have a MusicBrainz artist id are kept (up to 10 per artist). Coverage is
  uneven: good for classical and well-known acts, thin elsewhere.
- **MusicBrainz** teacher/student relationships (read as "inspired").
- **Last.fm** similar artists, if `LASTFM_API_KEY` is set (top 5 with a match of 0.5 or more).

Suggested artists are added as stubs but not enriched until you accept, so suggestions don't
snowball. Review them in **Suggestions** (or on an item's page): accepted ones become normal
links, rejected ones are remembered and never proposed again, and stubs nothing else uses are
removed. Suggested links show on the map (dotted) with the **Suggested** toggle.

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
