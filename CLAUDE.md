# CLAUDE.md: Corner Room

Permanent instructions for every Claude session in this repository. Current state of work lives in `HANDOFF.md` (local only, gitignored because this repo is public); read it at the start of each session if it exists.

## What this is

Corner Room is a Bangladesh-first "unified entertainment operating system": live events and ticketing, a record label with artist and band management, a music catalog, streaming, purchases and subscriptions, a royalty engine, finance and settlement (double-entry ledger, payouts), marketing campaigns, plus notifications, search, analytics, admin and audit. The MVP is ticketing-first. Default currency is BDT (schema is multi-currency); languages are English and Bangla. It is one product, not separate sites.

## Rules that override everything else

1. **Read the docs before you design anything.** The architecture of record is in `docs/`. Authority order (from `docs/SOURCE_OF_TRUTH.md`):
   1. `docs/prompts/00_CURSOR_OPERATING_SYSTEM.md` (agent constitution)
   2. `docs/10_DECISION_LOG.md` (decided defaults, OPEN questions, phase status)
   3. `docs/00_` to `docs/09_` numbered architecture (`00_PRODUCT_VISION.md` is narrative only)
   4. `docs/modules/<module>.md`
   5. The single phase or stage prompt being executed
   6. Reports in `docs/phases/`
   7. Code

   Unnumbered root docs (`SYSTEM_ARCHITECTURE.md`, `DECISION_LOG.md`, `domain/`, `system/`, `platform/`, `delivery/`, root `PHASE_1x_*.md`) are redirect stubs. Never edit them as a second source.
2. **If two documents conflict, STOP.** Cite both and wait for the product owner. Don't silently redesign.
3. **Never invent business rules:** royalty %, ticket fees, refund rules, tax, contract terms, rate-limit numbers, cloud region, PSP or email vendors, HMAC skew windows. Questions marked OPEN (`Q-P*`, `OD-*`) stay open. Fail-closed code is not an answer to them.
4. **Don't auto-advance.** Work one phase, gate or stage at a time, then stop and report.
5. **Never run git commit, push, tag or reset without explicit instruction.**
6. **`/docs/` and `/.cursor/` are gitignored on purpose (D-P16-02).** They exist only on this PC. Don't add them to git, and remind the owner to back them up.

## Architecture

- **Modular monolith.** `apps/api` (Python FastAPI) owns all domain, money, permission and royalty logic. `apps/web` (Next.js) is **UI only**: no finance, royalty, inventory, entitlement or permission decisions in the browser or in Server Actions.
- **Data:** PostgreSQL 16 (one schema per module, e.g. `identity.*`, `finance.*`, `events.*`), Redis (cache, rate limit, arq queue), object storage (local stub `var/storage`, S3 optional).
- **Async work:** the transactional outbox (`infra/outbox.py`) is written in the same transaction as the domain change. The arq worker (`cornerroom/worker.py`) drains it to consumers (notifications, search indexer, analytics, finance handlers).
- **Auth:** short-lived JWT access token (kept **in memory only** in the browser, never localStorage) plus an opaque httpOnly refresh cookie, rotated with replay detection. Passwords use Argon2id. **Continue with Google** is a server-side OIDC code flow (PKCE) run by the API; Google only proves identity and `identity.external_identities` links a Google `sub` to a User. No Google tokens are stored and the session is the normal Corner Room one (`docs/security/GOOGLE_AUTHENTICATION.md`).
- **Authorization:** deny by default (`kernel/authorize.py`, `modules/authorization`). Domain services re-check permission and org, owner or resource before any mutation. Cross-org reads return **404, not 403**. Workspace comes from the session (`sessions.active_organization_id`); the client never asserts an org.

### Backend layout (`apps/api/src/cornerroom/`)

| Path | Role |
|---|---|
| `main.py` | `create_app`; registers about 25 routers under `/api/v1` plus `/health` |
| `worker.py` | arq `WorkerSettings` (outbox drain, jobs) |
| `api/v1/*.py` | Thin HTTP routers, one per area. `api/deps.py` handles auth context and permissions |
| `kernel/` | Pure shared primitives: `money`, `ids`, `clock`, `authorize`, `pagination`, `result`, `ports`, `payment`, `payout` |
| `infra/` | DB session, settings (pydantic-settings, reads `.env`), outbox, idempotency, redis, storage, security, logging, middleware, `seed.py`, `models.py` (registers all ORM models for Alembic) |
| `modules/<name>/domain/` | SQLAlchemy models, `lifecycle.py` state machines, pure rules |
| `modules/<name>/application/` | Services (use cases), consumers |

Modules: identity, authorization, audit, documents, events (with venues), ticketing, artists (with bands), music, streaming, commerce, entitlements, subscriptions, royalties, finance, campaigns, notifications, search, analytics, administration.

Migrations: `apps/api/alembic/versions/0001` to `0028`, a linear chain with head `0028_event_cover` (0017 to 0022 are the audio platform; 0023 artist join links; 0024 per-ticket refunds; 0025 delivery addresses; 0026 Bangla QR staff verification; 0027 order lines record their product; 0028 event posters). Additive only: **never rewrite an existing revision**, and never use `create_all` on a migrated database.

### Frontend layout (`apps/web/`)

- Next.js 15.5, React 19, Tailwind 4, TypeScript strict, App Router. About 58 pages, mostly client components.
- **Route groups** (Stage 5; URLs unchanged): `app/(public)` (home), `app/(public)/(legacy)` (public pages not yet rebuilt), `(listen)` (Sky), `(account)`, `(artist)`, `(staff)` (side nav plus workspace chip). Each group's `layout.tsx` draws its shell from `components/shell/`. Pages not yet rebuilt render inside `LegacyMain`, outside `.cr-scope`, so their bodies stay as they were. `/theme-kit` sits outside the groups.
- `components/app-shell.tsx` only provides `auth-provider`, `workspace-provider` and `notifications-provider`.
- **API client:** `lib/api/client.ts` (apiFetch, ApiError, token handling) plus `features/<domain>/api.ts` per domain. `lib/api.ts` is a compatibility barrel; new code imports from the domain module.
- Navigation lives in `lib/nav-view.ts` (tested). Visibility is UX only.
- Shell details and the URL changes awaiting approval (URL-01 to URL-04): `docs/frontend/APP_SHELL.md`. **Don't change URLs without approval.**
- `lib/*-view.ts`: pure view-model helpers, each with a `.test.ts`. **Keep this pattern.**
- **Artist Studio (D-THEME-02):** signed-in artist pages (`app/(artist)`, including `/studio/sign-in` and `/studio/join`) use the green/mint `artist-studio` world and `components/shell/studio-shell.tsx`, following `docs/frontend/ARTIST_STUDIO_DESIGN_GUIDE.md`. `/artists/apply` is for fans and lives in `(account)` (Ember). Public artist profiles stay Ember.
- Design system (Phase 16): tokens in `app/styles/tokens.css`, fonts in `app/brand-fonts.ts` (the single place to swap the display face), primitives in `components/ds/`, brand pieces in `components/brand/` (including the `cube-logo/` letter cube), formatting in `lib/format/` (money, date, status), contrast-tested palette in `lib/theme/`. Developer pages: `/theme-kit`, `/theme-kit/modules`, `/theme-kit/cube` (enabled with `CR_THEME_KIT=1`).
- `components/ui/` holds the legacy shadcn primitives. Legacy pages still use them and must stay pixel-identical until their module stage.

## Commands

Quickest local start (Windows): `.\scripts\dev-stack.ps1` (add `-Seed` once to load demo data). It builds and serves the web app in production mode (fast clicks); add `-Dev` for live reload while editing (every page compiles on demand, so clicks take seconds). After web changes in production mode, rebuild (`npm run build`) and restart `npm run start`. Demo accounts and secrets live in the gitignored `.env.seed.local`; the email validator rejects `.test` domains, so demo users use `example.com`.

Requires Docker Desktop, Python 3.12+ (the local venv is 3.11.9, which pyproject allows) and Node 22+.

```powershell
# Whole stack in Docker (API :8000/docs, web :3000)
copy .env.example .env
docker compose up --build

# API (native)
cd apps\api
python -m venv .venv; .\.venv\Scripts\activate
python -m pip install -e ".[dev]"
alembic upgrade head
uvicorn cornerroom.main:app --reload --app-dir src --port 8000
arq cornerroom.worker.WorkerSettings          # worker, second terminal

# API tests
python -m pytest -m "not postgres"           # unit tests, no DB
python -m pytest                             # all; needs Postgres via TEST_DATABASE_URL or Testcontainers (Docker)
ruff check src tests

# Web
cd apps\web
npm install
npm run dev                                  # :3000, calls NEXT_PUBLIC_API_URL (default http://localhost:8000)
npm test                                     # vitest
npm run lint                                 # tsc --noEmit && eslint .
npm run build
npx playwright install chromium; npm run test:e2e   # browser checks on the theme kit, port 3100
```

## Conventions

- **Money:** always `{ amount_minor: int, currency_code: str }`. Never use floats. Never compute money in the UI; format it only, through `lib/format/money.ts`. Lakh grouping applies for `en-BD` and `bn`. Consumer views may drop `.00`; tables and finance views always show the full minor units (D-P16-03).
- **Shares** are `share_bps` stored as data, never as constants in code.
- **Status changes** go through `POST /{resource}/{id}/transition` (or `/lifecycle`). Never `PATCH status`. The UI renders whatever status string the API returns and never hard-codes transition lists (the state-machine docs disagree in places).
- **Domain events** use past-tense names. Each is written to the outbox in the same transaction as the audit row.
- **Terms:** `User` (logged-in person), `Organization`, `Artist` (not a User), `Track` / `TrackVersion`. See `docs/GLOSSARY.md`.
- **Analytics honesty:** show `NOT_AVAILABLE` and `ATTRIBUTION_UNDEFINED` as words, never as 0. No money in analytics tiles. Unknown values render as "Not available".
- **Errors:** problem+json envelope (`infra/errors.py`, `docs/ERROR_HANDLING.md`).
- **Python:** ruff (line length 100, rules E4/E7/E9/F), async SQLAlchemy 2, Pydantic v2, services take an auth context `ctx`.
- **Tests:** backend files are named `test_phaseNN_*.py` per phase, and DB-backed tests are marked `@pytest.mark.postgres`. Frontend tests sit beside the code as `*.test.ts(x)`; DOM tests are `*.dom.test.tsx`.
- **Brand (frontend):** read `docs/frontend/BRAND_GUIDELINE.md` and `tooling/agent-skills/corner-room-brand/SKILL.md` before any visual work. Never redraw or recolour the logo (`brand/logo/`); there are seven official variants, the seventh being the artist mint colourway for the Artist Studio only (D-THEME-02, owner 2026-10-22). Sikat is for display words only, never numerals. Archivo is for UI and numbers. Anek Bangla is for Bangla and ৳. Danger is crimson (`#FF6B81` text, `#C81E4F` fill), never Signal Red, and always comes with an icon and a label.

## Gotchas and things not to break

- Phase 15 security boundaries (CSP, CSRF, cookies, token handling) are frozen for frontend work.
- `tests/conftest.py` falls back to `DATABASE_URL` if `TEST_DATABASE_URL` is unset. Point tests at a **separate** test database, never the dev database.
- The payment webhook HMAC needs `SANDBOX_PAYMENT_SECRET` and no longer falls back to `JWT_SECRET` (Phase 15 Gate 3).
- Database-level security decisions are tracked in the decision log (Q-P14-12, Q-P15-01). Don't change DB roles or policies without the owner.
- Rate-limit and TTL env values of `0` mean "control disabled". That's intentional until the numbers are decided.
- Q-P0-12: production masters and ID documents are blocked until a residency region is named (`RESIDENCY_REGION`).
- Other projects' Docker containers may run on the dev machine. Only touch this project's compose services.
- This repo is public. Never commit `.env`, `docs/`, `.cursor/`, `brand/`, `tooling/`, `.claude/`, `.mcp.json`, `HANDOFF.md`, `Claude outputs/` or security audit findings. These all exist only on the owner's PC (back them up separately). The web app's own copies of logos and fonts live in `apps/web/public/brand/` and `apps/web/app/fonts/`, and those are tracked.
- `docs/## Research Objective.txt` is an unrelated note (YOLOv8 weed detection). Ignore it.
- Agent tooling in `tooling/` (brand skill, design skills, Playwright and 21st.dev MCP) is not active for Claude Code until it's copied into `.claude/skills/` and `.mcp.json` (see `tooling/README.md`).

## Session start and graphify

Do this at the start of every session, in order:

1. Read `HANDOFF.md` if it exists (current state), then the docs named in rule 1 for whatever you are about to touch.
2. Graphify is the first stop for "where is X / how does A reach B" questions (see the `## graphify` section below). Check `graphify --version`. If it is missing: `uv tool install graphifyy`, `graphify install`, then in this folder `graphify install --project`, and confirm `.claude\skills\graphify\SKILL.md` exists. If `graphify-out/graph.json` does not exist, run `/graphify .` once from the repo root. After editing code, run `graphify update .`.
3. Git: `.claude/` is on the never-commit list above (this repo is public), so do not follow the installer's "git add .claude/" hint. Whether `graphify-out/` is committed or ignored is the owner's call; ask, and never run git commit, push or reset unprompted (rule 5).
4. Say what you will do and what you verified. Never claim a check you did not run (for example "measured, not listened to", "tests not run").
5. Keep this file and `HANDOFF.md` current: when a decision is made or a blocker closes, update them in the same session.

## Content rules for promo and marketing work

- Only product facts visible on the live site or in `docs/`. No invented testimonials, prices, user counts, press or ratings. If the site is silent (for example the problem statement or proof), write "not stated", not something plausible.
- Track, artist and event names in the local database are seeded demo data (Rumi, Kaal Bela, Night Bus, Low Tide). Never present them as launch data.
- The tagline and mission line are provisional (D-P16-07, OD-30, LB-02) and Sikat is not licensed for commercial use (D-P16-04, LB-01). Anything public needs both resolved first.
- Music rights: use no third-party recording, composition, lyrics, artwork or footage without cleared rights. Original generated audio is fine. For any licensed or label-artist track, clear both the master and the composition. Bangladeshi-law points are a lawyer's call, not final conclusions (see the owner's "Corner Room Music Launch Playbook" doc if available).
- Do not publish or send anything for the owner without an explicit yes. Never put the public Railway site into development mode (it would expose the fake "Test payment" and "Verify now" shortcuts); use a separate private test copy for demo data online.

## Intro film (`apps/web/components/promo/intro-video/`)

- A 40 s, 1920 x 1080, 30 fps film; every frame is a pure function of time `t`, so no real-time animation, `Date.now()` or randomness. Scenes: hero 0 to 6.4, events 6.4 to 13.2, hand-over 13.2 to 15.2, listening room 15.2 to 29.2 (longest on purpose; keep it in any cut), your room 29.2 to 33.6, store 33.6 to 36.8, end card 36.8 to 40.
- All on-screen text lives in `copy.ts` with its source page. Timing and curves live in `timeline.ts`. The listening-room numbers are copied from `app/styles/modules/listen.css` (OD-32); reuse them, do not invent new ones. Ember and Sky lights never overlap (D1).
- Render: `CR_THEME_KIT=1 npm run dev` in `apps/web`, then `node scripts/render-intro-video.mjs` (needs ffmpeg; `--silent`, `--from`, `--to` supported). Output goes to `var/promo/`. Do not use a CSS blur filter on the cover backdrop (renders time out); use the stretched 40 px canvas in `useStretchedCovers`.
- The score is synthesised in `scripts/build-intro-soundtrack.mjs` (no samples, nothing to license, -14 LUFS). Its `CUES` block mirrors `timeline.ts`; change both together, and update the film's `README.md` and `timeline.test.ts` in the same change.
- Not yet verified in the project: `npm run lint`, `npm test` for the film files, and the preview page in the real Next app. Run them before merging.

## Band logo work (MIZULS)

The owner's band logo is separate from Corner Room. When asked to change one part, change only that part and keep the rest pixel-identical; keep the transparent, 1080 x 1920 and print-PDF versions in step.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
