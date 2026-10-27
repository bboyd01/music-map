# Music Map — standing rules for Claude Code

Single-user, self-hosted music relationship map + listening tracker. Full spec: `PLAN.md` (read it before starting; work one milestone at a time).

## Stack
SvelteKit + TypeScript (`adapter-node`), SQLite via `better-sqlite3` + Drizzle, Cytoscape.js, vitest. One Docker image, one `/data` volume. No extra services.

## Rules
- Keep it lean: don't add dependencies, services, or abstractions the plan doesn't call for. Ask first if you think one is needed.
- Mobile-first. Check layouts at 390px before wider screens.
- All routes except `/login`, `/healthz`, and static PWA assets require a session. Never expose artwork or API routes unauthenticated.
- Secrets only from env vars, server-side only.
- Only `inspired` and `similar` are stored as edges. Genre / era / instrument links are derived from tags.
- Tag inheritance: own tags in a facet win, otherwise nearest ancestor (track → album → artist).
- Never overwrite `manual` tags or edges during re-enrichment.
- MusicBrainz: max 1 req/sec, always send `MB_USER_AGENT`.
- Don't call live provider APIs in tests. Use recorded fixtures.
- Pure logic goes in `src/lib/domain/` with unit tests. Keep I/O out of it.
- Failures in enrichment must never break the add flow.

## Commands
- `npm run dev` — dev server
- `npm run test` — vitest
- `npm run db:generate` — generate Drizzle migration
- `npx tsx scripts/hash-password.ts` — generate `APP_PASSWORD_HASH`

## Definition of done (per milestone)
Every acceptance checkbox for that milestone in `PLAN.md` passes, tests are green, and the Docker build runs.
