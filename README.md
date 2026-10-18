# Corner Room

Unified entertainment operating system.



Backend is a **Python FastAPI** modular monolith. Next.js is UI only — no domain, finance, or royalty logic in Server Actions.

Architecture of record: `docs/` (kept private, not in this public repo; ask the owner for access).

## Same setup as the owner's machine (Windows, recommended)

Needs Docker Desktop (running), Python 3.12+ (3.11 works), Node 22+, Git.

```powershell
copy .env.example .env                 # then set JWT_SECRET to a long random string
copy .env.seed.example .env.seed.local # then fill in the demo passwords and SANDBOX_PAYMENT_SECRET

cd apps\api
python -m venv .venv
.\.venv\Scripts\python -m pip install -e ".[dev]"
cd ..\web
npm install
cd ..\..

.\scripts\dev-stack.ps1 -Seed          # first time: Postgres + Redis in Docker, migrations, demo data,
                                       # then API (8000), worker and web (3000) in their own windows
.\scripts\dev-stack.ps1                # every time after that
```

After every `git pull`: run `pip install -e ".[dev]"` (apps/api) and `npm install` (apps/web) if
dependencies changed; `dev-stack.ps1` applies new database migrations by itself.

- Sign in: fans at `/login`, staff at `/staff/sign-in` (admin.demo@example.com), artists at
  `/studio/sign-in`. Demo passwords are the ones you put in `.env.seed.local`.
- Demo data is generated on your machine, so ids and dates differ from anyone else's; the features
  are the same. Uploaded audio lives in `var/storage` (gitignored) and is not shared.
- `APP_ENV=local` enables the test shortcuts ("Verify now" for sign-up, "Complete test payment").
  Never use it on a public server.

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

Integration tests need PostgreSQL. **Use a separate test database**: the tests drop and recreate
every table, so pointing them at your dev database (`cornerroom`) would erase it.

```powershell
docker exec cornerroom-postgres-1 psql -U cornerroom -d postgres -c "CREATE DATABASE cornerroom_test"
$env:TEST_DATABASE_URL = "postgresql+asyncpg://cornerroom:cornerroom@localhost:5432/cornerroom_test"
python -m pytest
```

If Docker is available, tests will try Testcontainers Postgres automatically.

