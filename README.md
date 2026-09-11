# Corner Room

Unified entertainment operating system.

**How to work with Cursor:** do not paste 25 prompts at once.

1. Read [`docs/prompts/00_CURSOR_OPERATING_SYSTEM.md`](docs/prompts/00_CURSOR_OPERATING_SYSTEM.md).
2. Confirm architecture in [`docs/README.md`](docs/README.md). Do not implement yet.
3. Run **one** phase prompt (`PHASE N`) + matching `docs/modules/*.md`.
4. Inside a phase: Design → DB → Domain → API → Frontend → QA — each **STOP**. See [`docs/prompts/MODULE_MASTER_TEMPLATE.md`](docs/prompts/MODULE_MASTER_TEMPLATE.md) and [`docs/prompts/README.md`](docs/prompts/README.md).

**Phase numbering:** Phase 0 = architecture docs (expanded pack in `docs/`; summary [`docs/PHASE_00_SUMMARY.md`](docs/PHASE_00_SUMMARY.md)). Phase 1 = platform foundation code (may already be in `apps/`). Do not auto-advance. Do not start Events/Ticketing/Music from a foundation chat.

Backend is a **Python FastAPI** modular monolith. Next.js is UI only — no domain, finance, or royalty logic in Server Actions.

Architecture of record: [`docs/README.md`](docs/README.md).

## Stack

| Layer | Choice |
|---|---|
| API / workers | Python 3.12+ FastAPI, SQLAlchemy 2, Alembic, Pydantic v2, arq |
| UI | Next.js, TypeScript, Tailwind CSS, shadcn/ui |
| Data | PostgreSQL, Redis, S3-compatible (local stub in Phase 1) |

## Local run (Docker)

Requires Docker Desktop.

```powershell
copy .env.example .env
docker compose up --build
```

- API: http://localhost:8000/docs
- Health: http://localhost:8000/health
- Web: http://localhost:3000

Optional bootstrap admin (add to `.env` before `up`):

```
BOOTSTRAP_ADMIN_EMAIL=admin@example.com
BOOTSTRAP_ADMIN_PASSWORD=change-me
```

## Local run (native venv + Node)

PostgreSQL 16 and Redis must be running and match `.env`.

```powershell
copy .env.example .env
```

### API

```powershell
cd apps\api
python -m venv .venv
.\.venv\Scripts\activate
python -m pip install -e ".[dev]"
alembic upgrade head
uvicorn cornerroom.main:app --reload --app-dir src --port 8000
```

Worker (second terminal, same venv):

```powershell
cd apps\api
.\.venv\Scripts\activate
arq cornerroom.worker.WorkerSettings
```

### Web

```powershell
cd apps\web
npm install
npm run dev
```

Open http://localhost:3000. The shell calls `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`).

## Tests

From `apps/api` with the venv activated:

```powershell
python -m pytest
```

Unit tests (authz decisions, JWT, password, residency, `/health/live`, problem JSON) run without Docker.

Integration tests (`auth`, `rbac`, `org`, `audit`, `outbox`) need PostgreSQL:

```powershell
$env:TEST_DATABASE_URL = "postgresql+asyncpg://cornerroom:cornerroom@localhost:5432/cornerroom"
python -m pytest
```

If Docker is available, tests will try Testcontainers Postgres automatically.

## What Phase 1 is not

Events, ticketing, music, streaming, royalties, campaigns, and payments are not in scope for foundation. Do not add them from a Phase 1 prompt. Full 15-phase map: [`docs/DEVELOPMENT_ROADMAP.md`](docs/DEVELOPMENT_ROADMAP.md).

## Secrets

Copy `.env.example` to `.env`. Never commit `.env` or JWT/storage credentials.
