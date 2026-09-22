# Apply migration 0382 (reading POINT source identity) to production
# hacrebcfvyqdnjvilhqc with the tenant runner, which keeps the schema_migrations
# ledger and wraps each file in a transaction.
#
# Run from any PowerShell window:
#   & 'C:\Users\Cainergy\.gemini\antigravity\scratch\ERS\apply-0382.ps1'
#
# Same shape as 0381, on reading_definitions: two nullable columns and a unique
# index over (company_id, source_system, source_ref). Both columns are new, so
# the index cannot fail on existing rows. It is what lets the export back to
# SAP name a point by SAP's own number instead of creating it a second time.
param([switch]$IncludeOthers, [switch]$HoldOthers)

$ErrorActionPreference = 'Stop'
$repo = 'C:\Users\Cainergy\.gemini\antigravity\scratch\ERS'
Set-Location $repo

$tok = ((Get-Content (Join-Path $repo '.env.local') -Encoding UTF8 | Where-Object { $_ -match 'SUPABASE_ACCESS_TOKEN' } | Select-Object -First 1) -split '=', 2)[1].Trim()
if (-not $tok) { throw 'SUPABASE_ACCESS_TOKEN not found in .env.local' }
$env:SUPABASE_ACCESS_TOKEN = $tok

Write-Host "`n=== Dry run (nothing is written) ===" -ForegroundColor Cyan
$dry = node (Join-Path $repo 'scripts\provision\apply-migrations.mjs') --project-ref hacrebcfvyqdnjvilhqc --dry-run
if ($LASTEXITCODE -ne 0) { throw "dry-run failed with exit $LASTEXITCODE" }
$dry | Write-Host

$pending = @()
$inList = $false
foreach ($line in $dry) {
    $t = "$line"
    if ($t -match 'Would apply, in order:') { $inList = $true; continue }
    if ($inList) {
        if ($t -match '^\s*([0-9A-Za-z_][^\s]*\.sql)\s') { $pending += $Matches[1] }
        elseif ($t -match '\S' -and $t -notmatch '^\s') { break }
    }
}
$expected = @('0382_reading_point_source_identity.sql')
$unexpected = $pending | Where-Object { $expected -notcontains $_ }

if (-not $pending) { Write-Host "`nNothing pending — 0382 is already applied." -ForegroundColor Green; exit 0 }

$migDir = Join-Path $repo 'src\frontend\supabase\migrations'
$hold = $null
if ($unexpected -and -not $IncludeOthers) {
    Write-Host "`nMigrations from other work are also pending:" -ForegroundColor Yellow
    $unexpected | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
    if (-not $HoldOthers) {
        Write-Host 'Re-run with -HoldOthers to set those aside for the duration, or -IncludeOthers to apply them too. Nothing applied.' -ForegroundColor Yellow
        exit 1
    }
    $hold = Join-Path $repo ('src\frontend\supabase\_migrations_hold_' + (Get-Date -Format 'yyyyMMdd_HHmmss'))
    New-Item -ItemType Directory -Path $hold | Out-Null
    foreach ($f in $unexpected) { Move-Item (Join-Path $migDir $f) (Join-Path $hold $f) }
    Write-Host "Set aside in $hold (restored when this script ends)." -ForegroundColor Cyan
    $pending = $pending | Where-Object { $expected -contains $_ }
}

try {

Write-Host "`nWill apply:" -ForegroundColor Cyan
$pending | ForEach-Object { Write-Host "    $_" }
$answer = Read-Host "`nApply the migrations above to PRODUCTION? (yes/no)"
if ($answer -notin @('yes', 'y')) { Write-Host 'Aborted — nothing applied.'; exit 0 }

Write-Host "`n=== Applying ===" -ForegroundColor Cyan
node (Join-Path $repo 'scripts\provision\apply-migrations.mjs') --project-ref hacrebcfvyqdnjvilhqc --apply
if ($LASTEXITCODE -ne 0) { throw "apply failed with exit $LASTEXITCODE" }

Write-Host "`n=== Verify 0382 ===" -ForegroundColor Cyan
$sql = @'
SELECT 'columns' AS what,
       coalesce(string_agg(column_name || ' ' || data_type, ', ' ORDER BY column_name), '(none)') AS detail
  FROM information_schema.columns
 WHERE table_name = 'reading_definitions' AND column_name IN ('source_system','source_ref')
UNION ALL
SELECT 'unique index', coalesce(max(indexdef), '(missing)')
  FROM pg_indexes WHERE indexname = 'reading_definitions_source_uq'
'@
$body = [Text.Encoding]::UTF8.GetBytes((@{ query = $sql } | ConvertTo-Json))
$res = Invoke-RestMethod -Method Post -Uri 'https://api.supabase.com/v1/projects/hacrebcfvyqdnjvilhqc/database/query' -Headers @{ Authorization = "Bearer $tok" } -ContentType 'application/json; charset=utf-8' -Body $body
$res | Format-Table -AutoSize
Write-Host "Expected: both columns text; a UNIQUE INDEX on (company_id, source_system, source_ref)." -ForegroundColor Green

}
finally {
    if ($hold -and (Test-Path $hold)) {
        Get-ChildItem $hold -Filter *.sql | ForEach-Object { Move-Item $_.FullName (Join-Path $migDir $_.Name) -Force }
        if (-not (Get-ChildItem $hold)) { Remove-Item $hold }
        Write-Host "Put the other session's migrations back in $migDir." -ForegroundColor Cyan
    }
}
