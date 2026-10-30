# Deploy files

The production stack, nginx sites, settings template and server scripts for Corner Room. How to
use them on the server is in the private runbook (`docs/operations/DEPLOYMENT_RUNBOOK.md` in the
private repository). Secrets never go in this repository.

| File | What it is |
|---|---|
| `compose.prod.yml` | The stack: Postgres, Redis, the API and web app in two colours (blue, green), the worker, and the edge proxy that owns the ports |
| `edge/edge.conf.template` | The edge proxy's config; `deploy.sh` fills in the live colour |
| `nginx/cornerroom.conf` | The public site on the host's nginx |
| `nginx/staging.conf` | The private, password-protected staging site |
| `env.production.example` | Settings template for `.env.production` |
| `scripts/deploy.sh` | Deploy a commit with no downtime; `--rollback` goes back to the previous release |
| `scripts/backup.sh`, `scripts/restore.sh` | Back up to R2; bring a backup back |
| `scripts/restore-rehearsal.sh` | Prove the newest backup restores, without touching the live database |
| `scripts/staging-setup.sh` | One-time setup of the staging copy (run with sudo) |

Deploys run from GitHub: merging to `main` runs CI, then `.github/workflows/deploy.yml` (approved in
the `production` environment). Rollback, staging deploys and restore rehearsals are under Actions >
Server jobs (`.github/workflows/ops.yml`).

Zero-downtime deploys: the new release starts in the idle colour next to the live one, is health
checked, and the edge proxy switches to it with a graceful reload; the old colour finishes its open
requests, then stops (kept for an instant rollback). A release that fails its checks never takes
traffic. Migrations are additive only, so both releases run on the same database during the switch.
