# Corner Room local stack: database and Redis in Docker, API, worker and web app on this machine.
#
#   .\scripts\dev-stack.ps1          start everything
#   .\scripts\dev-stack.ps1 -Seed    also load the demo data (events, releases, store, demo users)
#
# Needs Docker Desktop, the API venv (apps\api\.venv) and node_modules in apps\web.
# Env comes from .env, plus .env.seed.local for the local demo accounts (gitignored; see the
# header of apps\api\scripts\dev_seed.py). Opens the API, worker and web app in their own windows.
param([switch]$Seed)

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
  & $py -m dotenv @envFiles run --no-override -- @command
  if ($LASTEXITCODE -ne 0) { throw "Command failed: $($command -join ' ')" }
}

Write-Host "Starting PostgreSQL and Redis..." -ForegroundColor Yellow
docker compose -f (Join-Path $root "docker-compose.yml") up -d postgres redis | Out-Null

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
Start-Process powershell -WorkingDirectory $web -ArgumentList "-NoExit", "-Command", "npm run dev"

Write-Host ""
Write-Host "Corner Room is starting:" -ForegroundColor Green
Write-Host "  Web  http://localhost:3000"
Write-Host "  API  http://localhost:8000/docs"
if (Test-Path $seedEnv) { Write-Host "  Demo sign-ins: ops.demo@example.com (staff), fan.demo@example.com (fan); passwords in .env.seed.local" }
