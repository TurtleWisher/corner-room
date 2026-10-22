<#
.SYNOPSIS
  A private, isolated staging copy of Corner Room on this PC, for the audio pilot (AUDIO Phase 9).

.DESCRIPTION
  Staging runs with APP_ENV=staging: no development shortcuts ("Verify now", self-confirmed sandbox
  payments, dev mailbox). It has its own database (cornerroom_staging), its own Redis database (so
  its job queue never mixes with development), its own storage folder and port, so the pilot never
  touches development or demo data. Secrets are generated once into var/staging/staging.env
  (var/ is gitignored) and never printed.

  Requires Docker Desktop running with this project's postgres and redis services up
  (docker compose up -d postgres redis).

.EXAMPLE
  .\scripts\staging.ps1 setup     # create the database, write staging.env, migrate
  .\scripts\staging.ps1 api       # start the API on http://localhost:8010 (log: var/staging/api.log)
  .\scripts\staging.ps1 worker    # start the worker (log: var/staging/worker.log)
  .\scripts\staging.ps1 web-build # build the web app for staging into apps/web/.next-staging
  .\scripts\staging.ps1 web       # start it on http://localhost:3010 (log: var/staging/web.log)
  .\scripts\staging.ps1 pilot     # run the end-to-end audio pilot against it
  .\scripts\staging.ps1 stop      # stop the staging API and worker (development keeps running)
  .\scripts\staging.ps1 reset     # drop the staging database and storage (asks first)
#>
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet("setup", "api", "worker", "web-build", "web", "pilot", "stop", "reset")]
    [string]$Action
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$api = Join-Path $root "apps\api"
$py = Join-Path $api ".venv\Scripts\python.exe"
$stage = Join-Path $root "var\staging"
$envFile = Join-Path $stage "staging.env"
$port = 8010
$webPort = 3010
$web = Join-Path $root "apps\web"
$dbName = "cornerroom_staging"
$container = "cornerroom-postgres-1"

function Get-DevUrl([string]$key) {
    $line = Get-Content (Join-Path $root ".env") | Where-Object { $_ -match "^$key=" } | Select-Object -First 1
    if (-not $line) { throw "$key is missing from .env" }
    return $line.Substring($key.Length + 1).Trim()
}

function New-Secret([int]$bytes = 36) {
    $buffer = New-Object byte[] $bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
    return ([Convert]::ToBase64String($buffer) -replace '[+/=]', '')
}

function Import-StagingEnv {
    if (-not (Test-Path $envFile)) { throw "Run '.\scripts\staging.ps1 setup' first." }
    # staging.env first (its values win), then .env for anything staging does not set. Loaded into
    # this process, which the API and worker inherit. (Not "python -m dotenv run": on Windows it
    # starts the program as a separate process and exits, which loses the logs and orphans it.)
    $seen = @{}
    foreach ($file in @($envFile, (Join-Path $root ".env"))) {
        foreach ($line in Get-Content $file) {
            if ($line -match '^\s*#' -or $line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') { continue }
            $key = $Matches[1]
            $value = $Matches[2].Trim()
            if ($value.Length -ge 2 -and (($value[0] -eq '"' -and $value[-1] -eq '"') -or ($value[0] -eq "'" -and $value[-1] -eq "'"))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            if ($seen.ContainsKey($key)) { continue }
            $seen[$key] = $true
            Set-Item -Path "Env:$key" -Value $value
        }
    }
    # Logs must reach the files as they happen, not in buffered blocks.
    $env:PYTHONUNBUFFERED = "1"
    Set-Location $api
}

function Start-StagingProcess([string]$name, [string]$exe, [string]$arguments, [string]$workdir = $api) {
    Import-StagingEnv
    $pidFile = Join-Path $stage "$name.pid"
    if (Test-Path $pidFile) {
        $old = Get-Content $pidFile
        if (Get-Process -Id $old -ErrorAction SilentlyContinue) { throw "Staging $name is already running (pid $old). Run stop first." }
    }
    $log = Join-Path $stage "$name.log"
    # cmd redirects at the operating-system level, so every line lands in the log as written.
    $command = "/c `"`"$exe`" $arguments >> `"$log`" 2>&1`""
    $proc = Start-Process -FilePath "cmd.exe" -ArgumentList $command -WorkingDirectory $workdir -WindowStyle Hidden -PassThru
    Set-Content -Path $pidFile -Value $proc.Id
    Write-Host "Staging $name started (pid $($proc.Id)); log: $log"
}

switch ($Action) {
    "setup" {
        New-Item -ItemType Directory -Force -Path (Join-Path $stage "storage") | Out-Null
        $devAsync = Get-DevUrl "DATABASE_URL"
        $devSync = Get-DevUrl "DATABASE_URL_SYNC"
        if ($devAsync -notmatch '/cornerroom$') { throw "Unexpected development DATABASE_URL; refusing to derive a staging URL." }
        $user = ([regex]::Match($devAsync, '://([^:]+):')).Groups[1].Value
        $exists = docker exec $container psql -U $user -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$dbName'"
        if ($exists -ne "1") {
            docker exec $container psql -U $user -d postgres -c "CREATE DATABASE $dbName" | Out-Null
            Write-Host "Created database $dbName"
        }
        if (-not (Test-Path $envFile)) {
            $storage = (Join-Path $stage "storage") -replace '\\', '/'
            @(
                "# Generated by scripts/staging.ps1. Private; never commit (var/ is gitignored).",
                "APP_ENV=staging",
                "DATABASE_URL=$($devAsync -replace '/cornerroom$', "/$dbName")",
                "DATABASE_URL_SYNC=$($devSync -replace '/cornerroom$', "/$dbName")",
                "REDIS_URL=redis://localhost:6379/1",
                "REDIS_KEY_PREFIX=crstaging",
                "STORAGE_BACKEND=local",
                "STORAGE_LOCAL_PATH=$storage",
                "JWT_SECRET=$(New-Secret 48)",
                "SANDBOX_PAYMENT_SECRET=$(New-Secret 36)",
                "TICKET_SIGNING_SECRET=$(New-Secret 48)",
                "MEDIA_TOKEN_SECRET=$(New-Secret 48)",
                "BOOTSTRAP_ADMIN_EMAIL=pilot-admin@example.com",
                "BOOTSTRAP_ADMIN_PASSWORD=Pilot-$(New-Secret 18)",
                "CORS_ORIGINS=http://localhost:3010",
                "WEB_BASE_URL=http://localhost:3010",
                "COOKIE_SECURE=false",
                "LOG_LEVEL=INFO",
                "GOOGLE_CLIENT_ID=",
                "GOOGLE_CLIENT_SECRET="
            ) | Set-Content -Encoding utf8 $envFile
            Write-Host "Wrote $envFile (secrets generated, not shown)"
        }
        Import-StagingEnv
        & (Join-Path $api ".venv\Scripts\alembic.exe") upgrade head
        Write-Host "Staging is migrated. Next: .\scripts\staging.ps1 api   and   .\scripts\staging.ps1 worker"
    }
    "api" {
        Start-StagingProcess "api" (Join-Path $api ".venv\Scripts\uvicorn.exe") "cornerroom.main:app --app-dir src --port $port"
    }
    "worker" {
        Start-StagingProcess "worker" (Join-Path $api ".venv\Scripts\arq.exe") "cornerroom.worker.WorkerSettings"
    }
    "web-build" {
        # The API address is built into the page code, so staging gets its own build folder.
        Set-Location $web
        $env:NEXT_PUBLIC_API_URL = "http://localhost:$port"
        $env:NEXT_DIST_DIR = ".next-staging"
        $env:NODE_OPTIONS = "--max-old-space-size=4096"
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "staging web build failed" }
    }
    "web" {
        $env:NEXT_DIST_DIR = ".next-staging"
        $node = (Get-Command node).Source
        $nextBin = Join-Path $web "node_modules\next\dist\bin\next"
        Start-StagingProcess "web" $node "`"$nextBin`" start --port $webPort" $web
    }
    "pilot" {
        Import-StagingEnv
        & $py (Join-Path $root "scripts\pilot\audio_pilot.py") --api "http://localhost:$port" --out $stage
        exit $LASTEXITCODE
    }
    "stop" {
        # Only the processes this script started (pid files); development keeps running.
        foreach ($name in @("api", "worker", "web")) {
            $pidFile = Join-Path $stage "$name.pid"
            if (-not (Test-Path $pidFile)) { continue }
            $id = Get-Content $pidFile
            if (Get-Process -Id $id -ErrorAction SilentlyContinue) {
                taskkill /T /F /PID $id | Out-Null
                Write-Host "Stopped staging $name (pid $id)."
            }
            Remove-Item $pidFile
        }
    }
    "reset" {
        $answer = Read-Host "Drop database $dbName and delete var\staging (development is not touched)? Type yes"
        if ($answer -ne "yes") { Write-Host "Nothing changed."; break }
        & $PSCommandPath stop
        $user = ([regex]::Match((Get-DevUrl "DATABASE_URL"), '://([^:]+):')).Groups[1].Value
        docker exec $container psql -U $user -d postgres -c "DROP DATABASE IF EXISTS $dbName" | Out-Null
        Remove-Item -Recurse -Force $stage
        Write-Host "Staging removed."
    }
}
