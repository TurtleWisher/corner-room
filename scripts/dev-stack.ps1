# Corner Room local stack: database and Redis in Docker, API, worker and web app on this machine.
#
#   .\scripts\dev-stack.ps1          start everything
#   .\scripts\dev-stack.ps1 -Seed    also load the demo data (events, releases, store, demo users)
#   .\scripts\dev-stack.ps1 -Dev     web app in development mode (live reload while editing code)
#
# By default the web app is built and served in production mode: pages open at once. Development
# mode compiles every page on demand, so each click can take several seconds (2026-10-22).
#
# Needs Docker Desktop, the API venv (apps\api\.venv) and node_modules in apps\web.
# Env comes from .env, plus .env.seed.local for the local demo accounts (gitignored; see the
# header of apps\api\scripts\dev_seed.py). Opens the API, worker and web app in their own windows.
param([switch]$Seed, [switch]$Dev)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$api = Join-Path $root "apps\api"
$web = Join-Path $root "apps\web"
$py = Join-Path $api ".venv\Scripts\python.exe"

if (-not (Test-Path (Join-Path $root ".env"))) { throw "Missing .env. Copy .env.example to .env first." }
$envFiles = @("-f", (Join-Path $root ".env"))
$seedEnv = Join-Path $root ".env.seed.local"
if (Test-Path $seedEnv) { $envFiles = @("-f", $seedEnv, "run", "--no-override", "--", $py, "-m", "dotenv") + $envFiles }
function Invoke-WithEnv([string[]]$command) {
  # Alembic and the seed log to stderr; under "Stop", Windows PowerShell 5.1 would abort on the
  # first INFO line. Print everything and fail only on a non-zero exit code.
  $ErrorActionPreference = "Continue"
  & $py -m dotenv @envFiles run --no-override -- @command 2>&1 | ForEach-Object { Write-Host "$_" }
  if ($LASTEXITCODE -ne 0) { throw "Command failed: $($command -join ' ')" }
}

Write-Host "Starting PostgreSQL and Redis..." -ForegroundColor Yellow
# Docker prints its progress ("Container ... Running") on stderr. Windows PowerShell 5.1 turns
# that into a terminating error under "Stop", so judge Docker by its exit code instead.
$ErrorActionPreference = "Continue"
docker compose -f (Join-Path $root "docker-compose.yml") up -d postgres redis 2>&1 | Out-Null
$composeExit = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($composeExit -ne 0) { throw "docker compose could not start PostgreSQL and Redis (exit $composeExit). Is Docker Desktop running?" }

Write-Host "Applying migrations..." -ForegroundColor Yellow
Push-Location $api
try {
  Invoke-WithEnv @((Join-Path $api ".venv\Scripts\alembic.exe"), "upgrade", "head")
  if ($Seed) {
    Write-Host "Loading demo data..." -ForegroundColor Yellow
    Invoke-WithEnv @($py, "scripts\dev_seed.py")
  }
} finally { Pop-Location }

$dotenv = "& '$py' -m dotenv $($envFiles -join ' ') run --no-override --"
Start-Process powershell -WorkingDirectory $api -ArgumentList "-NoExit", "-Command", "$dotenv '$api\.venv\Scripts\uvicorn.exe' cornerroom.main:app --app-dir src --port 8000 --reload"
Start-Process powershell -WorkingDirectory $api -ArgumentList "-NoExit", "-Command", "$dotenv '$api\.venv\Scripts\arq.exe' cornerroom.worker.WorkerSettings"
$webCommand = if ($Dev) { "npm run dev" } else { "npm run build; if (`$LASTEXITCODE -eq 0) { npm run start }" }
Start-Process powershell -WorkingDirectory $web -ArgumentList "-NoExit", "-Command", $webCommand

Write-Host ""
Write-Host "Corner Room is starting:" -ForegroundColor Green
Write-Host "  Web  http://localhost:3000$(if ($Dev) { ' (development mode)' } else { ' (production build; ready after the build finishes, about 2 to 4 minutes)' })"
Write-Host "  API  http://localhost:8000/docs"
if (Test-Path $seedEnv) { Write-Host "  Demo sign-ins: ops.demo@example.com (staff), fan.demo@example.com (fan); passwords in .env.seed.local" }
