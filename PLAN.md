# Music Map — Development Plan

Single-user, self-hosted web app (installable PWA) for (1) mapping relationships between artists, albums, and tracks, and (2) tracking a listening list, like Letterboxd for music.

Read `CLAUDE.md` first for standing rules. Build milestone by milestone (section 11). Each milestone ends with an acceptance checklist. Don't start the next one until the current one passes. If a decision here turns out to be wrong in practice, stop and flag it instead of working around it silently.

---

## 1. Product summary

**Listening list** (primary tab, built first)
- Paste an Apple Music or Spotify link, or type a plain-text search, to add a track or album.
- Metadata and artwork are pulled in automatically; the item lands in **To Listen**.
- Items move to **Listened** with a rating (0–5 stars), a review, and Inspired / Inspired by / Similar links.
- Genre, time period, and instrumentation are auto-filled on a best-effort basis and are editable.
- Think Letterboxd, but for a single user, and for music basically.

**Map** (second tab)
- Graph of artists, albums, and tracks connected by: **Inspired / Inspired by**, **Similar**, **Genre**, **Time period**, **Instrumentation**.
- Toggle the graph between Artist, Album, and Track views.
- Edges are created manually, and the app also *suggests* edges from external sources. Suggestions are accepted or rejected.

**Also:** plain-text search-to-add, JSON export/import, basic password auth (the URL is public), mobile-first PWA.

---

## 2. Decisions locked in

| Topic | Decision |
|---|---|
| Hosting | Own server, one Docker image, one volume (`/data`) |
| Client | Responsive, **mobile-first** PWA (installable, no native app) |
| Auth | Single shared password, because the app is publicly reachable |
| Primary source | Apple Music (via iTunes Lookup/Search API, no key). Spotify links also supported. |
| Enrichment | MusicBrainz (+ Cover Art Archive, Wikidata) layered on top of both |
| Stubs | Map nodes may exist without a listening entry ("stubs") and can be promoted to the list |
| Ratings/reviews | Per listening item, where an item is a **track or album** (artists are map-only) |
| Classical | No special model. Composer = the artist, plus an optional free-text `credit` field for performer/ensemble. |
| Inheritance | See section 6 |
| Export | Full JSON export and import. SQLite file is also directly backup-able. |

---

## 3. Tech stack (lean)

| Layer | Choice | Notes |
|---|---|---|
| Framework | **SvelteKit + TypeScript**, `adapter-node` | UI and API routes in one codebase, no separate backend |
| DB | **SQLite** via `better-sqlite3` + **Drizzle ORM** + drizzle-kit migrations | Migrations run automatically on startup |
| Graph | **Cytoscape.js** + `cytoscape-fcose` layout | Touch-friendly, supports typed edges and filtering |
| PWA | `@vite-pwa/sveltekit` (or hand-written manifest + minimal service worker) | App-shell cache + artwork cache |
| Validation | `zod` | Provider responses, API inputs, import files |
| Tests | `vitest` | Unit tests only (see section 13) |
| Styling | Plain CSS with variables (or Tailwind if preferred), no component library | Keep dependencies down |
| Image handling | Download artwork once, store on disk; `sharp` only if resizing proves necessary | Request ~600px from the source instead where possible |
| Runtime image | `node:22-slim` multi-stage build | Avoids musl/native-module headaches with `better-sqlite3` |

No Redis, no queue service, no Postgres, no graph DB. Background work uses a SQLite-backed job table and an in-process worker loop (section 7.4).

Password hashing uses Node's built-in `crypto.scrypt`, so no extra dependency.

---

## 4. Project structure

```
/
├─ CLAUDE.md
├─ PLAN.md
├─ Dockerfile
├─ docker-compose.example.yml
├─ drizzle/                    # generated migrations
├─ scripts/hash-password.ts    # prints a hash for APP_PASSWORD_HASH
├─ src/
│  ├─ hooks.server.ts          # auth gate, rate limit, startup (migrate + worker)
│  ├─ lib/
│  │  ├─ server/
│  │  │  ├─ db/ (schema.ts, index.ts, queries/)
│  │  │  ├─ auth/ (session.ts, password.ts, ratelimit.ts)
│  │  │  ├─ providers/
│  │  │  │  ├─ types.ts       # MusicProvider interface + normalized types
│  │  │  │  ├─ link.ts        # URL → {provider, kind, id}
│  │  │  │  ├─ apple.ts       # iTunes Lookup/Search
│  │  │  │  ├─ spotify.ts     # client-credentials
│  │  │  │  ├─ musicbrainz.ts # rate-limited client
│  │  │  │  ├─ coverart.ts
│  │  │  │  └─ wikidata.ts
│  │  │  ├─ enrich/ (pipeline.ts, tags.ts, eras.ts, suggestions.ts)
│  │  │  ├─ jobs/ (queue.ts, worker.ts)
│  │  │  └─ artwork.ts
│  │  ├─ domain/ (inheritance.ts, edges.ts, eras.ts, normalize.ts)   # pure functions, unit-tested
│  │  └─ components/
│  └─ routes/
│     ├─ login/
│     ├─ (app)/
│     │  ├─ +layout.svelte    # bottom tab bar
│     │  ├─ list/             # Listening list (To Listen / Listened)
│     │  ├─ map/
│     │  ├─ e/[id]/           # entity detail
│     │  ├─ add/              # link/search add flow
│     │  ├─ suggestions/
│     │  └─ settings/         # export/import, stats, password-change instructions
│     └─ api/ (see section 9)
└─ static/ (icons, manifest)
```

Keep `domain/` free of I/O so it's trivially testable.

---

## 5. Data model (Drizzle / SQLite)

Use one `entities` table with a `kind`, instead of three tables. Edges, tags, and listening data then work uniformly across artist/album/track.

```
entities
  id            integer pk
  kind          text  'artist' | 'album' | 'track'
  name          text
  artist_id     integer null → entities.id   (album/track → its artist)
  album_id      integer null → entities.id   (track → its album)
  credit        text null                    (e.g. performer/ensemble for classical)
  release_date  text null                    (ISO, may be partial: 'YYYY' or 'YYYY-MM')
  duration_ms   integer null                 (tracks)
  artwork_path  text null                    (relative to /data/artwork)
  norm_key      text                         (normalized "artist|title|kind" for dedupe)
  enrich_status text  'pending'|'running'|'done'|'failed'
  created_at, updated_at

external_ids
  entity_id → entities.id
  provider      text 'apple'|'spotify'|'musicbrainz'|'wikidata'
  external_id   text
  url           text null
  unique(provider, external_id)

listen_items                       -- exists only for album/track entities
  entity_id     integer pk → entities.id
  status        text 'to_listen'|'listened'
  rating        integer null      -- 0–10 = half-stars; null = unrated (UI shows 0–5 stars, half steps)
  review        text null
  added_at      text
  listened_at   text null

tags
  id, facet text 'genre'|'era'|'instrument', name text, slug text
  unique(facet, slug)

entity_tags
  entity_id → entities.id, tag_id → tags.id
  source text 'auto'|'manual'
  primary key(entity_id, tag_id)

edges                              -- ONLY relationship types that can't be derived
  id
  type          text 'inspired'|'similar'
  from_id       integer → entities.id   -- inspired: from = the influence, to = the one influenced
  to_id         integer → entities.id   -- similar: store with from_id < to_id (canonical order)
  status        text 'accepted'|'suggested'|'rejected'
  source        text 'manual'|'musicbrainz'|'wikidata'|'lastfm'
  note          text null
  created_at
  unique(type, from_id, to_id)

jobs
  id, type text, payload json, status 'queued'|'running'|'done'|'failed',
  attempts int, run_after text, last_error text, created_at

sessions
  id_hash text pk, created_at, expires_at, last_seen_at

kv  (key text pk, value text)      -- e.g. cached Spotify token, schema/export version
```

Indexes: `entities(norm_key)`, `entities(kind, artist_id)`, `edges(from_id)`, `edges(to_id)`, `entity_tags(tag_id)`, `listen_items(status)`.

Design notes
- **Genre, time period, and instrumentation links are derived** from shared tags at query time and are not stored as edges. Only `inspired` and `similar` live in `edges`.
- `rejected` edges are kept so the suggestion engine never re-proposes them.
- An entity with no `listen_items` row is a **stub**. "Promote" = create the row with `to_listen`.
- Cross-provider dedupe: when adding, look up by `external_ids` first, then by `norm_key`, and finally by MBID once enrichment has resolved it. A Spotify link to something already added via Apple Music must attach to the existing entity, not duplicate it. Provide a manual "merge into…" action as a safety net.

---

## 6. Domain rules

### 6.1 Tag inheritance (genre, era, instrument)
- Tags are stored at the level they were sourced from (Spotify genres are artist-level, iTunes genre is album-level, MusicBrainz credits may be track-level).
- **Effective tags for a facet = the entity's own tags in that facet if it has any; otherwise the nearest ancestor's** (track → album → artist). More specific levels override.
- UI shows inherited tags in a muted style with an "override" action that creates own tags.
- Implement as pure functions in `domain/inheritance.ts`, with tests.

### 6.2 Inspired / Similar
- `inspired` is directed. The UI renders it as "Inspired" or "Inspired by" depending on which end you're viewing from, and one row serves both.
- `similar` is symmetric: always store `(min_id, max_id)` and reject duplicates.
- Edges connect entities of any kind. In practice they are mostly same-kind, but allow cross-kind (e.g. an album inspired by an artist).

### 6.3 Eras / time period
- Vocabulary (seeded): **Medieval** (<1400), **Renaissance** (1400–1600), **Baroque** (1600–1750), **Classical** (1750–1820), **Romantic** (1820–1900), **20th Century** (1900–1975), **Contemporary** (1975+), plus decades **1920s … 2020s**.
- **Non-classical albums/tracks:** auto-assign the decade tag from `release_date`.
- **Classical (effective genre includes classical/baroque/opera/etc.):** assign the era from the *composer's* dates (MusicBrainz lifespan or Wikidata), using the mapping above. Also keep the recording-date decade tag. The two are independent tags.
- **Artists:** era = union of the eras of their entities in the DB (recomputed when children change), unless manually set. Composers get era from lifespan.
- Everything is editable, and a manual tag is never overwritten by re-enrichment.

### 6.4 Genre and instrumentation
- Genre: normalize to lowercase slugs. Prefer MusicBrainz genres (curated list) over free-form tags, take the top few by votes, and merge with Apple/Spotify genre strings.
- Instrumentation: **best-effort.** Source is MusicBrainz recording/release performer relationships with instrument attributes, aggregated upward to album and artist. Streaming APIs don't expose it. Expect many items to have none, so manual tagging with autocomplete must be fast.

---

## 7. Providers & enrichment

### 7.1 Link parsing (`providers/link.ts`) — pure and heavily tested
- Apple Music: `music.apple.com/{storefront}/(album|song|artist)/{slug}/{id}`. An album URL with `?i={trackId}` is a **track**. Keep the storefront and pass it as `country=` to lookup.
- Spotify: `open.spotify.com/(intl-xx/)?(track|album|artist)/{id}` with or without `?si=`, the `spotify:track:{id}` URI form, and `spotify.link/...` short links (follow the redirect, with a timeout and host check).
- Anything else returns a clear "unsupported link" error.

### 7.2 Providers (all behind one `MusicProvider` interface returning normalized types)
- **Apple (iTunes):** `GET https://itunes.apple.com/lookup?id=…&country=…&entity=…` and `/search`. No key. Artwork URL template: swap the `100x100bb` size segment for `600x600bb`. Be polite about rate limits (roughly 20 requests/minute is the commonly cited figure, so add a small limiter and cache).
- **Spotify:** client-credentials flow (`SPOTIFY_CLIENT_ID/SECRET`), token cached in `kv` until expiry. Use `/tracks`, `/albums`, `/artists`, `/search`. Spotify has been restricting endpoints for new apps (audio features, related artists, recommendations), so **do not depend on those**, and verify current terms and which fields (e.g. artist genres) are still returned before relying on them. Spotify must be optional: if env vars are missing, hide Spotify features and say so on unsupported links.
- **MusicBrainz:** hard limit of 1 request/second, and a descriptive `User-Agent` with contact info is **required** (`MB_USER_AGENT`). Implement a single global limiter. Use ISRC (tracks) and barcode/UPC (albums) lookups when the source provides them, otherwise search by artist + title and accept only high-confidence matches. Below the threshold, leave it unmatched and let the user pick on the detail page.
- **Cover Art Archive:** fallback artwork by release/release-group MBID.
- **Wikidata:** resolved through the MusicBrainz URL relationship to Wikidata. Used for "influenced by" (P737) suggestions and composer dates. Keep SPARQL/entity calls minimal and cached.
- **Last.fm (optional, off by default):** `artist.getSimilar` for "similar" suggestions if `LASTFM_API_KEY` is set. It's a good source for Similar since Spotify's related-artists is gone. Build behind the same suggestion interface.

### 7.3 Add flow
1. Input accepts a link **or** text. Text runs a parallel search (Apple always, Spotify if configured, MusicBrainz as a tie-breaker) and shows a results list with artwork, a kind selector (track/album), and the source.
2. Selecting a result (or resolving a link) **immediately** creates the artist/album/track entities plus `external_ids` and a `listen_items` row (`to_listen`), downloads artwork, and returns, so the UI is fast.
3. It enqueues an `enrich` job. The UI shows an "enriching…" state that resolves without a refresh (polling or SSE, polling is fine).
4. Duplicate detection runs before creation. If the item exists, navigate to it with a "already in your list" message and attach the new `external_id` if it's a new provider.

### 7.4 Jobs
- SQLite `jobs` table plus an in-process worker started from `hooks.server.ts`. Single worker, sequential, retry with backoff (max 3 attempts), recoverable after restart (reset `running` → `queued` on boot).
- Job types: `enrich` (MBID match → genres, instruments, eras, artwork fallback), `suggest` (generate edge suggestions for an entity), `artwork`.
- Failures must never block the add flow. The item stays usable with whatever metadata was fetched.

### 7.5 Suggestions
- Generators: Wikidata `influenced by` → `inspired` edges, MusicBrainz artist relationships where applicable, and optional Last.fm → `similar`.
- Suggested targets that don't exist yet are created as **stub entities** so they can be linked. If every suggestion pointing at an auto-created stub is rejected and it has no listen item or accepted edges, garbage-collect it.
- Review UI: per-entity "Suggestions" section plus a global inbox (`/suggestions`). Accept, reject (persisted), or accept-and-add-to-list.

---

## 8. Auth & security (the URL is public)

- `APP_PASSWORD_HASH` (scrypt, generated with `scripts/hash-password.ts`). Compare with `crypto.timingSafeEqual`.
- Session: random 256-bit token in an `HttpOnly; Secure; SameSite=Lax` cookie. Only a hash of it is stored in `sessions`. 30-day sliding expiry, with logout and "log out everywhere".
- **Everything** requires a session except `/login`, `/healthz`, and static PWA assets (manifest, icons, service worker). Artwork and API routes are protected.
- Login rate limiting: per-IP (5 attempts / 15 min) plus a small global delay after repeated failures. Make client-IP resolution configurable via `TRUST_PROXY` since the app runs behind a reverse proxy.
- SvelteKit's built-in CSRF origin check stays on. Set `ORIGIN` correctly in production.
- Security headers (CSP, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'`) set in `hooks.server.ts`.
- Provider secrets live in env vars only and never reach the client. Server-side fetches of user-supplied URLs (short-link redirects) must be restricted to known hosts to avoid SSRF.
- TLS is the reverse proxy's job (Caddy / Traefik / Coolify / Cloudflare Tunnel). Document this in the README and make the cookie `Secure` flag depend on `ORIGIN` being https.

---

## 9. API surface (SvelteKit `+server.ts`, JSON, all authenticated)

```
POST /api/auth/login | /api/auth/logout
GET  /healthz                              (public)

POST /api/add/resolve     { input }        → link resolved, or search results
POST /api/add/commit      { provider, id, kind }   → entity + listen item, enqueues enrich
GET  /api/entities/:id
PATCH /api/entities/:id                    (name, credit, release_date, tags)
POST /api/entities/:id/merge  { into }
GET  /api/list?status=&kind=&q=&sort=      listening list
PATCH /api/list/:entityId                  (status, rating, review, listened_at)
POST /api/list/:entityId  /  DELETE        promote stub / remove from list

GET  /api/tags?facet=&q=                   autocomplete
POST /api/edges  { type, from, to, note }  DELETE /api/edges/:id
PATCH /api/edges/:id { status }            accept / reject suggestion
GET  /api/suggestions?entityId=

GET  /api/graph?kind=artist|album|track&layers=inspired,similar,genre,era,instrument
                &focus=:id&depth=2&tag=
GET  /api/search?q=                        local search over your own entities

GET  /api/export                           full JSON download
POST /api/import                           JSON upload (merge mode)
GET  /artwork/:file                        authenticated static serving
```

`/api/graph` returns `{ nodes, edges, tagHubs }` with edge `type`, `status`, and `directed` flags. Derived facet connections are computed server-side from effective tags (section 6.1).

---

## 10. UI

**Mobile-first.** Design for ~390px width first, then scale up. Bottom tab bar (**List · Map · Add · Suggestions · Settings**) on mobile, a side rail on wide screens. Minimum 44px touch targets. Respect safe-area insets (iOS PWA).

- **List:** To Listen / Listened segmented control. Cards show artwork, title, artist, year, rating. Filters: kind, genre, era, rating. Sort: added, listened, rating, year. One-tap "mark listened" opens a bottom sheet with stars, review, and link pickers.
- **Add:** a single input (paste link or type). A "Paste from clipboard" button is shown because the Web Share Target API isn't available for installed PWAs on iOS. Results list with artwork and a track/album toggle.
- **Entity detail (`/e/[id]`):** artwork, metadata, external links (Apple / Spotify / MusicBrainz), effective tags with inherited ones muted, relationships grouped (Inspired by / Inspired / Similar) with an entity picker that supports "create stub", the suggestions section, and the listening controls.
- **Map:** full-screen Cytoscape canvas.
  - Top bar: kind switch (Artist / Album / Track), layer toggles (Inspired, Similar, Genre, Era, Instrument), and a tag filter.
  - Inspired = directed arrows, Similar = undirected, stubs = dashed outline, suggested edges = faint dotted (toggleable).
  - **Facet layers** (genre / era / instrument) render as **hub nodes** that entities connect to, so shared tags become visible clusters.
  - Tap a node → bottom sheet preview → "Open" / "Focus here". Default is the full graph when under ~300 nodes, otherwise a **focused ego-graph** (depth 2), with a depth control.
  - Switching kind shows only nodes of that kind and the edges directly between them. Roll-up (e.g. aggregating track-level edges to their artists) is a later enhancement (section 14).
- **Theme:** respect `prefers-color-scheme`. Keep the visual design restrained. Artwork is the main color source.
- **Offline (PWA):** app shell and viewed artwork are cached. Reads of the last-loaded list are fine offline, while writes require connectivity (show a clear offline state). No background sync in v1.

---

## 11. Milestones

### M0 — Scaffold, deploy, auth
- SvelteKit + TS + Drizzle + SQLite, migrations on startup, `/data` volume (DB + artwork).
- Auth (section 8), login page, `/healthz`, security headers.
- PWA manifest, icons, installable shell with the bottom tab bar (placeholder pages).
- Dockerfile (multi-stage), `docker-compose.example.yml`, README with env vars and reverse-proxy notes.

**Accept:**
- [ ] `docker compose up` yields a working app and the DB persists across container recreation.
- [ ] All routes except login/health/static assets redirect to login when unauthenticated, including `/api/*` and `/artwork/*`.
- [ ] Wrong password is rate-limited. The cookie is HttpOnly + Secure (when https) + SameSite.
- [ ] Installs to the home screen on a phone, with correct icon and standalone display.

### M1 — Providers & link parsing
- `MusicProvider` interface, normalized types, `link.ts`, Apple + Spotify clients, zod-validated responses, recorded fixtures for tests.
- Artwork download/storage helper.

**Accept:**
- [ ] Unit tests cover every Apple/Spotify URL variant in section 7.1, plus rejection of garbage.
- [ ] Given a real Apple Music track, album, and artist link, the normalized metadata is correct. Same for Spotify when credentials are present.
- [ ] Spotify disabled cleanly when unconfigured.

### M2 — Add flow & Listening list (first usable version)
- Schema live for entities / external_ids / listen_items. Add flow (link + text search), dedupe, artwork saved.
- List UI with To Listen / Listened, rating (half-star steps), review, filters, sort.

**Accept:**
- [ ] Pasting an Apple link adds the item with artwork in under ~3 seconds on a phone.
- [ ] Pasting the Spotify link for the same album attaches to the existing entity instead of duplicating.
- [ ] Text search "kind of blue" returns usable results and can be added.
- [ ] Marking listened, rating, and writing a review all persist after reload.
- [ ] Layout is usable at 360–430px width with no horizontal scroll.

### M3 — Enrichment (MusicBrainz) & tags
- Job queue and worker. MBID matching, genre / instrument / era tagging, artwork fallback, inheritance rules, tag editing with autocomplete.

**Accept:**
- [ ] Newly added items show "enriching…" then gain genre + decade tags without a reload.
- [ ] MusicBrainz requests never exceed 1/sec and carry the configured User-Agent.
- [ ] A manual tag survives re-enrichment. Inherited tags display muted and are overridable.
- [ ] A classical album gets the composer's era (e.g. Baroque), not just the recording decade.
- [ ] A restart mid-job doesn't lose or duplicate work. Failure leaves the item fully usable.
- [ ] Unit tests cover inheritance and era derivation.

### M4 — Relationships & entity detail
- Entity detail page. Inspired / Inspired by / Similar create and delete, with stub creation from the picker and stub → list promotion. Merge action.

**Accept:**
- [ ] Linking A "inspired" B shows "Inspired" on A and "Inspired by" on B from the one edge row.
- [ ] A `similar` edge is symmetric and can't be duplicated by adding it from the other side.
- [ ] A stub can be created inline, appears as a dashed node later, and can be promoted to To Listen.
- [ ] Deleting a list item doesn't delete the entity if it has edges.

### M5 — Map
- `/api/graph`, Cytoscape view, kind switch, layer toggles, tag hubs, focus/ego-graph, node bottom sheet.

**Accept:**
- [ ] Artist / Album / Track switch works and shows the right nodes.
- [ ] Each of the five relationship types can be toggled on and off independently.
- [ ] Genre layer visibly clusters entities sharing a genre via hub nodes, using inherited tags.
- [ ] Smooth pan/zoom/tap on a phone with ~500 nodes (focused mode kicks in above ~300).
- [ ] Tapping a node opens its preview and links to its detail page.

### M6 — Suggestions
- Wikidata / MusicBrainz generators (Last.fm optional), suggestion inbox, accept / reject / accept-and-add, stub GC.

**Accept:**
- [ ] Adding an artist with a Wikidata "influenced by" entry produces suggested edges within a minute.
- [ ] Rejected suggestions never come back. Accepted ones become normal edges on the map.
- [ ] Suggested edges are visually distinct and toggleable on the map.

### M7 — Export/import, polish, hardening
- JSON export/import, local search polish, empty/error/offline states, PWA caching polish, README finalization.

**Accept:**
- [ ] Export → fresh DB → import reproduces the library, ratings, reviews, tags, and edges. Import is idempotent (running it twice creates no duplicates).
- [ ] Export file includes `schemaVersion`, and import rejects unknown versions clearly.
- [ ] Lighthouse PWA check passes. Offline mode shows the cached list with a clear banner.
- [ ] README documents env vars, backup (copy `/data`), restore, upgrading, and reverse-proxy setup.

---

## 12. Environment & deployment

```
ORIGIN=https://music.example.com        # required for CSRF + Secure cookies
APP_PASSWORD_HASH=...                   # from scripts/hash-password.ts
SESSION_SECRET=...                      # random 32+ bytes
DATA_DIR=/data
MB_USER_AGENT=MusicMap/1.0 (you@example.com)
SPOTIFY_CLIENT_ID= / SPOTIFY_CLIENT_SECRET=     # optional
LASTFM_API_KEY=                                 # optional
TRUST_PROXY=true
PORT=3000
```

- One image, one volume at `/data` (`music-map.db`, `artwork/`). Run as a non-root user. Include a `HEALTHCHECK` hitting `/healthz`.
- Backups: SQLite WAL mode is on, so use `sqlite3 .backup` or the JSON export, and don't copy a live DB file naively. Document this.

---

## 13. Testing

Keep it light. Unit tests (vitest) for the logic that's easy to get subtly wrong:
- link parsing (all variants), `norm_key` normalization, dedupe
- tag inheritance, era derivation (including classical), edge canonicalization
- export → import round trip on an in-memory DB

Provider clients are tested against **recorded fixtures**, never live APIs in CI. UI is verified manually against each milestone's checklist.

---

## 14. Out of scope for v1 (possible later)

- Roll-up map view (aggregating track/album edges onto artists)
- Bulk text import ("Artist – Album" per line) with a review screen
- Authenticated `POST /api/add` token endpoint for an iOS Shortcut ("share to Music Map"), as iOS PWAs can't be Web Share Targets
- Multi-user accounts, public/shareable profiles
- Playback, listening-history sync, Apple Music/Spotify account login
- Official Apple Music API (needs a paid developer account, and iTunes lookup covers the need)
- Tag synonym merging UI

---

## 15. Known risks / open items

- **Spotify API limits for new apps** may change. Keep Spotify behind the provider interface and optional.
- **Instrumentation coverage will be sparse.** That's expected, so manual tagging UX is the mitigation.
- **MusicBrainz matching errors** are the main data-quality risk. Use a high confidence threshold, and allow manual re-match from the detail page.
- **Rating granularity:** stored as 0–10 half-stars. If whole stars are preferred, only the UI changes.
- Wikidata "influenced by" coverage is uneven (good for classical and well-known acts, thin elsewhere), so expect most edges to be manual.
