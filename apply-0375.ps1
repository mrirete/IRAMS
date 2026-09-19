# Apply migration 0375 (transactional import rollback: rollback_import_batch)
# to production hacrebcfvyqdnjvilhqc with the tenant runner, which keeps the
# schema_migrations ledger and wraps each file in a transaction, so a failing
# file rolls back instead of half-applying.
#
# Run from any PowerShell window:
#   & 'C:\Users\Cainergy\.gemini\antigravity\scratch\ERS\apply-0375.ps1'
#
# The runner applies EVERY pending migration, and other work-in-progress files
# can be sitting in the migrations folder. This script therefore refuses to run
# when anything other than 0375 is pending. Pass -IncludeOthers only
# when you have read those files and want them applied as well.
param([switch]$IncludeOthers)

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
$expected = @('0375_rollback_import_batch.sql')
$unexpected = $pending | Where-Object { $expected -notcontains $_ }

if (-not $pending) { Write-Host "`nNothing pending — 0375 is already applied." -ForegroundColor Green; exit 0 }
if ($unexpected -and -not $IncludeOthers) {
    Write-Host "`nSTOP — migrations from other work are also pending:" -ForegroundColor Red
    $unexpected | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    Write-Host @"

The runner applies every pending migration; it cannot apply only 0375.
Either review and accept those files too, and re-run this script with
-IncludeOthers, or move them out of src\frontend\supabase\migrations first and
put them back afterwards. Nothing has been applied.
"@ -ForegroundColor Yellow
    exit 1
}

Write-Host "`nWill apply:" -ForegroundColor Cyan
$pending | ForEach-Object { Write-Host "    $_" }
$answer = Read-Host "`nApply the migrations above to PRODUCTION? (yes/no)"
if ($answer -notin @('yes', 'y')) { Write-Host 'Aborted — nothing applied.'; exit 0 }

Write-Host "`n=== Applying ===" -ForegroundColor Cyan
node (Join-Path $repo 'scripts\provision\apply-migrations.mjs') --project-ref hacrebcfvyqdnjvilhqc --apply
if ($LASTEXITCODE -ne 0) { throw "apply failed with exit $LASTEXITCODE" }

Write-Host "`n=== Verify ===" -ForegroundColor Cyan
$body = [Text.Encoding]::UTF8.GetBytes((@{ query = @"
SELECT 'rollback_import_batch exists' AS what, count(*)::text AS detail FROM pg_proc WHERE proname = 'rollback_import_batch'
UNION ALL SELECT 'is SECURITY DEFINER / search_path', (SELECT prosecdef::text || ' / ' || coalesce(array_to_string(proconfig, ','), '(none)') FROM pg_proc WHERE proname = 'rollback_import_batch')
UNION ALL SELECT 'anon can execute', has_function_privilege('anon', 'public.rollback_import_batch(uuid,boolean)', 'EXECUTE')::text
UNION ALL SELECT 'authenticated can execute', has_function_privilege('authenticated', 'public.rollback_import_batch(uuid,boolean)', 'EXECUTE')::text
UNION ALL SELECT 'batches that could be rolled back', count(*)::text FROM import_batches WHERE status = 'committed';
"@ } | ConvertTo-Json))
$res = Invoke-RestMethod -Method Post -Uri 'https://api.supabase.com/v1/projects/hacrebcfvyqdnjvilhqc/database/query' -Headers @{ Authorization = "Bearer $tok" } -ContentType 'application/json; charset=utf-8' -Body $body
$res | Format-Table -AutoSize
Write-Host @"
Expected: exists = 1; SECURITY DEFINER true with search_path=public,pg_catalog; anon false; authenticated true.

Then, in the app: Admin > Migration Center > Import history > Roll back. The click now
dry-runs first and names any blockers and any cascading work before you confirm.
"@ -ForegroundColor Green
