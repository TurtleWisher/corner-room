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

Migrations: `apps/api/alembic/versions/0001` to `0016`, a linear chain with head `0016_external_identities`. Additive only: **never rewrite an existing revision**, and never use `create_all` on a migrated database.

### Frontend layout (`apps/web/`)

- Next.js 15.5, React 19, Tailwind 4, TypeScript strict, App Router. About 58 pages, mostly client components.
- **Route groups** (Stage 5; URLs unchanged): `app/(public)` (home), `app/(public)/(legacy)` (public pages not yet rebuilt), `(listen)` (Sky), `(account)`, `(artist)`, `(staff)` (side nav plus workspace chip). Each group's `layout.tsx` draws its shell from `components/shell/`. Pages not yet rebuilt render inside `LegacyMain`, outside `.cr-scope`, so their bodies stay as they were. `/theme-kit` sits outside the groups.
- `components/app-shell.tsx` only provides `auth-provider`, `workspace-provider` and `notifications-provider`.
- **API client:** `lib/api/client.ts` (apiFetch, ApiError, token handling) plus `features/<domain>/api.ts` per domain. `lib/api.ts` is a compatibility barrel; new code imports from the domain module.
- Navigation lives in `lib/nav-view.ts` (tested). Visibility is UX only.
- Shell details and the URL changes awaiting approval (URL-01 to URL-04): `docs/frontend/APP_SHELL.md`. **Don't change URLs without approval.**
- `lib/*-view.ts`: pure view-model helpers, each with a `.test.ts`. **Keep this pattern.**
- Design system (Phase 16): tokens in `app/styles/tokens.css`, fonts in `app/brand-fonts.ts` (the single place to swap the display face), primitives in `components/ds/`, brand pieces in `components/brand/` (including the `cube-logo/` letter cube), formatting in `lib/format/` (money, date, status), contrast-tested palette in `lib/theme/`. Developer pages: `/theme-kit`, `/theme-kit/modules`, `/theme-kit/cube` (enabled with `CR_THEME_KIT=1`).
- `components/ui/` holds the legacy shadcn primitives. Legacy pages still use them and must stay pixel-identical until their module stage.

## Commands

Quickest local start (Windows): `.\scripts\dev-stack.ps1` (add `-Seed` once to load demo data). Demo accounts and secrets live in the gitignored `.env.seed.local`; the email validator rejects `.test` domains, so demo users use `example.com`.

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
- **Brand (frontend):** read `docs/frontend/BRAND_GUIDELINE.md` and `tooling/agent-skills/corner-room-brand/SKILL.md` before any visual work. Never redraw or recolour the logo (`brand/logo/`). Sikat is for display words only, never numerals. Archivo is for UI and numbers. Anek Bangla is for Bangla and ৳. Danger is crimson (`#FF6B81` text, `#C81E4F` fill), never Signal Red, and always comes with an icon and a label.

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
