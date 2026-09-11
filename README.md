# Corner Room

Unified entertainment operating system.



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

