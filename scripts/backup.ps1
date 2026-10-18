<#
.SYNOPSIS
  Back up and restore Corner Room's database and media storage, and prove a backup restores.

.DESCRIPTION
  backup   Dumps the database (pg_dump custom format, from this project's postgres container) and
           archives the storage folder (masters, playback and download copies, covers) into
           var/backups/<env>-<time>/, with manifest.json: migration head, row counts of key tables,
           and the SHA-256 of every file.
  restore  Restores a backup into a NEW database and folder (never over a running one) and checks
           it: same migration head, same row counts, and every media file's bytes match the
           SHA-256 the restored database itself records for it.
  Media files and dumps contain unreleased masters and personal data: keep backups private, off
  any shared drive, and delete old ones under the retention the owner sets (not decided yet).

.EXAMPLE
  .\scripts\backup.ps1 backup -Env staging
  .\scripts\backup.ps1 restore -From var\backups\staging-20261017-0915 -Into cornerroom_restore_check
  .\scripts\backup.ps1 drop -Into cornerroom_restore_check     # remove a restore check
#>
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet("backup", "restore", "drop")]
    [string]$Action,
    [ValidateSet("dev", "staging")]
    [string]$Env = "staging",
    [string]$From,
    [string]$Into = "cornerroom_restore_check"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$container = "cornerroom-postgres-1"
$protected = @("cornerroom", "cornerroom_staging", "postgres", "template0", "template1")
$keyTables = @(
    "identity.users", "artists.artists", "music.releases", "music.tracks", "music.track_versions",
    "music.track_renditions", "documents.media_assets", "commerce.orders", "commerce.entitlements",
    "commerce.offers", "streaming.library_items", "audit.audit_log", "infra.outbox_events"
)

function Get-DbUser {
    $line = Get-Content (Join-Path $root ".env") | Where-Object { $_ -match "^DATABASE_URL=" } | Select-Object -First 1
    return ([regex]::Match($line, '://([^:]+):')).Groups[1].Value
}

function Get-Source([string]$name) {
    if ($name -eq "dev") { return @{ Db = "cornerroom"; Storage = (Join-Path $root "apps\api\var\storage") } }
    return @{ Db = "cornerroom_staging"; Storage = (Join-Path $root "var\staging\storage") }
}

function Invoke-Sql([string]$db, [string]$sql) {
    $out = docker exec $container psql -U (Get-DbUser) -d $db -tAc $sql
    if ($LASTEXITCODE -ne 0) { throw "psql failed on $db" }
    return $out
}

function Get-Facts([string]$db) {
    $counts = [ordered]@{}
    foreach ($t in $keyTables) {
        $exists = Invoke-Sql $db "SELECT to_regclass('$t') IS NOT NULL"
        $counts[$t] = if ($exists -eq "t") { [int](Invoke-Sql $db "SELECT count(*) FROM $t") } else { $null }
    }
    return [ordered]@{ head = (Invoke-Sql $db "SELECT version_num FROM infra.alembic_version"); counts = $counts }
}

function Get-FileHashes([string]$dir) {
    $map = [ordered]@{}
    if (-not (Test-Path $dir)) { return $map }
    Get-ChildItem -Path $dir -Recurse -File | Sort-Object FullName | ForEach-Object {
        $rel = $_.FullName.Substring($dir.Length).TrimStart('\', '/') -replace '\\', '/'
        $map[$rel] = (Get-FileHash -Algorithm SHA256 $_.FullName).Hash.ToLower()
    }
    return $map
}

switch ($Action) {
    "backup" {
        $src = Get-Source $Env
        $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
        $dest = Join-Path $root "var\backups\$Env-$stamp"
        New-Item -ItemType Directory -Force -Path $dest | Out-Null
        $user = Get-DbUser
        docker exec $container pg_dump -U $user -d $src.Db -Fc -f "/tmp/cr-backup.dump"
        if ($LASTEXITCODE -ne 0) { throw "pg_dump failed" }
        docker cp "${container}:/tmp/cr-backup.dump" (Join-Path $dest "db.dump") | Out-Null
        docker exec $container rm -f /tmp/cr-backup.dump | Out-Null
        $files = Get-FileHashes $src.Storage
        if ($files.Count -gt 0) {
            Compress-Archive -Path (Join-Path $src.Storage "*") -DestinationPath (Join-Path $dest "storage.zip") -CompressionLevel Optimal
        }
        $manifest = [ordered]@{
            environment = $Env
            database = $src.Db
            created_at = (Get-Date).ToUniversalTime().ToString("o")
            facts = Get-Facts $src.Db
            dump_sha256 = (Get-FileHash -Algorithm SHA256 (Join-Path $dest "db.dump")).Hash.ToLower()
            files = $files
        }
        $manifest | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $dest "manifest.json")
        Write-Host "Backup written to $dest ($($files.Count) media file(s), head $($manifest.facts.head))."
    }
    "restore" {
        if (-not $From) { throw "Give -From <backup folder>." }
        if ($protected -contains $Into.ToLower()) { throw "Refusing to restore over '$Into'. Restore into a new database, check it, then switch deliberately." }
        $dir = Resolve-Path $From
        $manifest = Get-Content (Join-Path $dir "manifest.json") -Raw | ConvertFrom-Json
        $dumpHash = (Get-FileHash -Algorithm SHA256 (Join-Path $dir "db.dump")).Hash.ToLower()
        if ($dumpHash -ne $manifest.dump_sha256) { throw "The dump does not match its manifest; it is damaged." }
        $user = Get-DbUser
        $exists = Invoke-Sql "postgres" "SELECT 1 FROM pg_database WHERE datname='$Into'"
        if ($exists -eq "1") { throw "Database '$Into' already exists. Drop it first (.\scripts\backup.ps1 drop -Into $Into)." }
        Invoke-Sql "postgres" "CREATE DATABASE $Into" | Out-Null
        docker cp (Join-Path $dir "db.dump") "${container}:/tmp/cr-restore.dump" | Out-Null
        docker exec $container pg_restore -U $user -d $Into --no-owner --exit-on-error /tmp/cr-restore.dump
        $restoreExit = $LASTEXITCODE
        docker exec $container rm -f /tmp/cr-restore.dump | Out-Null
        if ($restoreExit -ne 0) { throw "pg_restore failed" }
        $storage = Join-Path $root "var\restore\$Into\storage"
        if (Test-Path (Join-Path $dir "storage.zip")) {
            New-Item -ItemType Directory -Force -Path $storage | Out-Null
            Expand-Archive -Path (Join-Path $dir "storage.zip") -DestinationPath $storage -Force
        }
        # Checks: schema head and counts as backed up; files as listed; bytes as the database records.
        $problems = @()
        $facts = Get-Facts $Into
        if ($facts.head -ne $manifest.facts.head) { $problems += "migration head $($facts.head) vs $($manifest.facts.head)" }
        foreach ($p in $manifest.facts.counts.PSObject.Properties) {
            if ($facts.counts[$p.Name] -ne $p.Value) { $problems += "$($p.Name): $($facts.counts[$p.Name]) vs $($p.Value)" }
        }
        $restored = Get-FileHashes $storage
        foreach ($p in $manifest.files.PSObject.Properties) {
            if ($restored[$p.Name] -ne $p.Value) { $problems += "file $($p.Name) differs or is missing" }
        }
        $assets = Invoke-Sql $Into "SELECT object_key || '|' || sha256 FROM documents.media_assets WHERE deleted_at IS NULL AND sha256 <> ''"
        $checked = 0
        foreach ($row in @($assets)) {
            if (-not $row) { continue }
            $key, $sha = $row -split '\|', 2
            if (-not $restored.Contains($key)) { continue }  # older demo rows may point outside storage
            $checked++
            if ($restored[$key] -ne $sha) { $problems += "media $key bytes do not match the database's SHA-256" }
        }
        if ($problems.Count -gt 0) {
            Write-Host "RESTORE CHECK FAILED:"
            $problems | ForEach-Object { Write-Host "  - $_" }
            exit 1
        }
        Write-Host "RESTORE CHECK PASSED into '$Into': head $($facts.head); $(@($manifest.facts.counts.PSObject.Properties).Count) table counts equal; $($restored.Count) file(s) identical; $checked media file(s) match the database's own SHA-256."
    }
    "drop" {
        if ($protected -contains $Into.ToLower()) { throw "Refusing to drop '$Into'." }
        Invoke-Sql "postgres" "DROP DATABASE IF EXISTS $Into" | Out-Null
        $storage = Join-Path $root "var\restore\$Into"
        if (Test-Path $storage) { Remove-Item -Recurse -Force $storage }
        Write-Host "Dropped restore check '$Into'."
    }
}
