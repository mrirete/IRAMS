# Apply migrations 0373 (admin audit coverage) and 0374 (collector key expiry)
# to production hacrebcfvyqdnjvilhqc with the tenant runner, which keeps the
# schema_migrations ledger and wraps each file in a transaction, so a failing
# file rolls back instead of half-applying.
#
# Run from any PowerShell window:
#   & 'C:\Users\Cainergy\.gemini\antigravity\scratch\ERS\apply-0373.ps1'
#
# The runner applies EVERY pending migration, and other work-in-progress files
# can be sitting in the migrations folder. This script therefore refuses to run
# when anything other than 0373 / 0374 is pending. Pass -IncludeOthers only
# when you have read those files and want them applied as well.
#
# HEADS UP (checked 2026-09-19): 0371_full_loop_closeout and
# 0372_role_matrix_finance are ALSO still pending on production — they were
# committed but never applied. So this script WILL stop on its guard the first
# time you run it, and it is right to: those two belong to the full-loop
# assurance work, not to this one, and applying them is a separate decision.
# Read them, then either re-run with -IncludeOthers to apply all four in order,
# or move them aside and put them back afterwards. The dry run prints the list
# either way and writes nothing.
#
# AFTER THIS SCRIPT: redeploy ingest-readings and ingest-work-orders. They
# already send `or=(expires_at.is.null,expires_at.gt.<now>)` in the key lookup,
# and that filter names a column that does not exist until 0374 lands — so the
# order is migration first, deploy second. Until the deploy, key expiry is
# recorded but not enforced.
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
$expected = @('0373_admin_audit_coverage.sql', '0374_collector_key_expiry.sql')
$unexpected = $pending | Where-Object { $expected -notcontains $_ }

if (-not $pending) { Write-Host "`nNothing pending — 0373 and 0374 are already applied." -ForegroundColor Green; exit 0 }
if ($unexpected -and -not $IncludeOthers) {
    Write-Host "`nSTOP — migrations from other work are also pending:" -ForegroundColor Red
    $unexpected | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    Write-Host @"

The runner applies every pending migration; it cannot apply only 0373 and 0374.
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
SELECT 'admin audit triggers' AS what, count(*)::text AS detail
  FROM pg_trigger WHERE tgname LIKE 'audit\_%\_admin'
UNION ALL SELECT 'audited tables', string_agg(c.relname, ', ' ORDER BY c.relname)
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE t.tgname LIKE 'audit\_%\_admin'
UNION ALL SELECT 'log_admin_audit_event is SECURITY DEFINER', prosecdef::text
  FROM pg_proc WHERE proname = 'log_admin_audit_event' AND pronamespace = 'public'::regnamespace
UNION ALL SELECT 'anon can execute the audit function',
  has_function_privilege('anon', 'public.log_admin_audit_event()', 'EXECUTE')::text
UNION ALL SELECT 'ers_collector_keys.expires_at exists', count(*)::text
  FROM information_schema.columns WHERE table_name = 'ers_collector_keys' AND column_name = 'expires_at'
UNION ALL SELECT 'keys by usability', coalesce(string_agg(usability || '=' || n, ', '), 'no keys')
  FROM (SELECT usability, count(*)::text n FROM public.ers_collector_keys_status GROUP BY usability) s
UNION ALL SELECT 'status view is security_invoker',
  (SELECT coalesce((reloptions::text LIKE '%security_invoker=true%')::text, 'false')
     FROM pg_class WHERE relname = 'ers_collector_keys_status' AND relnamespace = 'public'::regnamespace);
"@ } | ConvertTo-Json))
$res = Invoke-RestMethod -Method Post -Uri 'https://api.supabase.com/v1/projects/hacrebcfvyqdnjvilhqc/database/query' -Headers @{ Authorization = "Bearer $tok" } -ContentType 'application/json; charset=utf-8' -Body $body
$res | Format-Table -AutoSize
Write-Host @"
Expected: 8 admin audit triggers (companies, connectors, ers_collector_keys,
hierarchy_config, numbering_config, role_permissions, users, work_centers);
SECURITY DEFINER true; anon EXECUTE false; expires_at exists = 1; every existing
key 'active' (none re-issued); status view security_invoker true.

NEXT: redeploy the two ingest functions, or key expiry is stored but not enforced:
    npx supabase functions deploy ingest-readings   --project-ref hacrebcfvyqdnjvilhqc
    npx supabase functions deploy ingest-work-orders --project-ref hacrebcfvyqdnjvilhqc
"@ -ForegroundColor Green
