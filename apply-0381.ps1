# Apply migration 0381 (reading source identity — the duplicate-import guard)
# to production hacrebcfvyqdnjvilhqc with the tenant runner, which keeps the
# schema_migrations ledger and wraps each file in a transaction, so a failing
# file rolls back instead of half-applying.
#
# Run from any PowerShell window:
#   & 'C:\Users\Cainergy\.gemini\antigravity\scratch\ERS\apply-0381.ps1'
#
# 0381 adds two nullable columns to reading_logs and a unique index over
# (company_id, source_system, source_ref). Both columns are new, so the index
# is built over rows that are all NULL and cannot collide: it cannot fail on
# existing data, and nothing needs cleaning up first. Readings typed into
# IREAMS leave both columns NULL and stay unconstrained (NULLS DISTINCT);
# only readings imported from another system are keyed, on that system's own
# id, so the same export can never be imported twice.
#
# The runner applies EVERY pending migration, and other work-in-progress files
# can be sitting in the migrations folder. This script therefore refuses to run
# when anything other than 0381 is pending.
#   -HoldOthers     set those files aside for the duration and put them back
#                   afterwards (they are never applied, never edited)
#   -IncludeOthers  apply them too — only when you have read them
param([switch]$IncludeOthers, [switch]$HoldOthers)

$ErrorActionPreference = 'Stop'
$repo = 'C:\Users\Cainergy\.gemini\antigravity\scratch\ERS'
Set-Location $repo

# .env.local has a UTF-8 BOM — read it with -Encoding UTF8 and match, don't anchor.
$tok = ((Get-Content (Join-Path $repo '.env.local') -Encoding UTF8 | Where-Object { $_ -match 'SUPABASE_ACCESS_TOKEN' } | Select-Object -First 1) -split '=', 2)[1].Trim()
if (-not $tok) { throw 'SUPABASE_ACCESS_TOKEN not found in .env.local' }
$env:SUPABASE_ACCESS_TOKEN = $tok

Write-Host "`n=== Dry run (nothing is written) ===" -ForegroundColor Cyan
# No 2>&1 here: in Windows PowerShell 5.1 redirecting a native command's stderr
# wraps every line in an ErrorRecord, which trips $ErrorActionPreference='Stop'.
$dry = node (Join-Path $repo 'scripts\provision\apply-migrations.mjs') --project-ref hacrebcfvyqdnjvilhqc --dry-run
if ($LASTEXITCODE -ne 0) { throw "dry-run failed with exit $LASTEXITCODE" }
$dry | Write-Host

# What the runner would actually apply, taken from the "Would apply, in order:" list.
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
$expected = @('0381_reading_source_identity.sql')
$unexpected = $pending | Where-Object { $expected -notcontains $_ }

if (-not $pending) { Write-Host "`nNothing pending — 0381 is already applied." -ForegroundColor Green; exit 0 }

$migDir = Join-Path $repo 'src\frontend\supabase\migrations'
$hold = $null
if ($unexpected -and -not $IncludeOthers) {
    Write-Host "`nMigrations from other work are also pending:" -ForegroundColor Yellow
    $unexpected | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
    if (-not $HoldOthers) {
        Write-Host ''
        Write-Host 'The runner applies every pending migration; it cannot apply only 0381.' -ForegroundColor Yellow
        Write-Host 'Re-run with -HoldOthers to set those files aside for the duration and put them' -ForegroundColor Yellow
        Write-Host 'back afterwards, or with -IncludeOthers to apply them as well. Nothing applied.' -ForegroundColor Yellow
        exit 1
    }
    # Set aside, and always put back — the restore lives in the finally below.
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

Write-Host "`n=== Verify 0381 ===" -ForegroundColor Cyan
$sql = @'
SELECT 'columns' AS what,
       coalesce(string_agg(column_name || ' ' || data_type, ', ' ORDER BY column_name), '(none)') AS detail
  FROM information_schema.columns
 WHERE table_name = 'reading_logs' AND column_name IN ('source_system','source_ref')
UNION ALL
SELECT 'unique index', coalesce(max(indexdef), '(missing)')
  FROM pg_indexes WHERE indexname = 'reading_logs_source_uq'
UNION ALL
SELECT 'readings already keyed', count(*)::text
  FROM reading_logs WHERE source_ref IS NOT NULL
'@
$body = [Text.Encoding]::UTF8.GetBytes((@{ query = $sql } | ConvertTo-Json))
$res = Invoke-RestMethod -Method Post -Uri 'https://api.supabase.com/v1/projects/hacrebcfvyqdnjvilhqc/database/query' -Headers @{ Authorization = "Bearer $tok" } -ContentType 'application/json; charset=utf-8' -Body $body
$res | Format-Table -AutoSize
Write-Host "Expected: both columns text; a UNIQUE INDEX on (company_id, source_system, source_ref); 0 readings keyed so far." -ForegroundColor Green

}
finally {
    # Files set aside above always come back, whatever happened in between.
    if ($hold -and (Test-Path $hold)) {
        Get-ChildItem $hold -Filter *.sql | ForEach-Object { Move-Item $_.FullName (Join-Path $migDir $_.Name) -Force }
        if (-not (Get-ChildItem $hold)) { Remove-Item $hold }
        Write-Host "Put the other session's migrations back in $migDir." -ForegroundColor Cyan
    }
}
