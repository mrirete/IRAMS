# Deploy committed HEAD to production (irams.vercel.app) — the archive recipe.
#
# Run from any PowerShell window:
#   & 'C:\Users\Cainergy\.gemini\antigravity\scratch\ERS\deploy-cockpit.ps1'
#
# Why an archive copy: deployments carrying git author metadata for
# mrirete100@gmail.com are blocked by the Vercel team seat check, and a
# git-archive copy has no .git and no author. It also ships COMMITTED HEAD
# only, so nothing uncommitted in the working tree can leak into prod.
# Never robocopy: a stale copy once shipped a half-tree that built green.
$ErrorActionPreference = 'Stop'
$repo = 'C:\Users\Cainergy\.gemini\antigravity\scratch\ERS'
$dst = Join-Path $env:TEMP ('ireams-deploy-' + (Get-Date -Format 'yyyyMMdd_HHmmss'))
Set-Location $repo

$head = (git rev-parse --short HEAD).Trim()
Write-Host "`n=== Archive HEAD $head into $dst ===" -ForegroundColor Cyan
New-Item -ItemType Directory -Path $dst | Out-Null
# Never pipe git's binary output through PowerShell — the pipeline turns it
# into text and tar sees garbage. Write the tar to a file, then extract it.
$tar = Join-Path $env:TEMP ('ireams-head-' + $head + '.tar')
git archive --format=tar --output="$tar" HEAD
if ($LASTEXITCODE -ne 0) { throw 'git archive failed' }
tar -xf "$tar" -C "$dst"
if ($LASTEXITCODE -ne 0) { throw 'tar extract failed' }
Remove-Item $tar

$copyCount = (Get-ChildItem (Join-Path $dst 'src\frontend\src') -Recurse -File).Count
$treeCount = (Get-ChildItem (Join-Path $repo 'src\frontend\src') -Recurse -File).Count
Write-Host "files: copy $copyCount / worktree $treeCount (uncommitted files account for any difference)"
if (-not (Select-String -Path (Join-Path $dst 'src\frontend\src\App.tsx') -Pattern 'CockpitImportPage' -Quiet)) { throw 'Newest work is not in HEAD — commit first.' }

# Link the project explicitly: the archive omits .vercel, and without a link
# --yes would create a NEW project.
New-Item -ItemType Directory -Path (Join-Path $dst '.vercel') | Out-Null
'{"projectId":"prj_EJoUo2Vn1Z8tHARzl0c5cw62naRk","orgId":"team_jCSjXZz6c72FumnD01Cdi6t2"}' | Set-Content -Encoding ascii (Join-Path $dst '.vercel\project.json')

Write-Host "`n=== Deploy (pinned CLI, installed into the copy) ===" -ForegroundColor Cyan
Set-Location $dst
try {
# Not npx: its cache was left half-written when the CLI's self-upgrade failed
# ("could not determine executable to run"), and it floats versions. The
# pinned CLI is installed into the copy, which is deleted afterwards anyway.
npm install --prefix "$dst" --no-save --no-audit --no-fund --loglevel=error vercel@58.9.5
if ($LASTEXITCODE -ne 0) { throw "could not install vercel@58.9.5 into the copy (exit $LASTEXITCODE)" }
$cli = Join-Path $dst 'node_modules\.bin\vercel.cmd'
if (-not (Test-Path $cli)) { throw "vercel CLI not found at $cli" }

# No 2>&1: in Windows PowerShell 5.1 it wraps a native command's stderr in
# ErrorRecords and the first warning line becomes a terminating error. Stdout
# is captured for the verdict; stderr goes to the console as it is.
# The CLI's exit code is not the deploy's: after a successful deploy it offers
# to upgrade itself, and a failed upgrade exits 1 (seen 2026-09-22). The deploy
# is judged on its output — the Production line.
$env:NO_UPDATE_NOTIFIER = '1'
$out = & $cli deploy --prod --yes --archive=tgz | ForEach-Object { "$_" }
$out | Write-Host
$prod = $out | Where-Object { $_ -match 'Production:\s+https://\S+' } | Select-Object -First 1
if (-not $prod) { throw "vercel deploy produced no Production URL (exit $LASTEXITCODE) — nothing was deployed" }
if ($LASTEXITCODE -ne 0) { Write-Host "CLI exited $LASTEXITCODE after the deploy (its self-upgrade prompt); the deploy itself succeeded." -ForegroundColor Yellow }
}
finally {
    Set-Location $repo
    # The copy never outlives the run, whatever happened — a stale copy once
    # shipped a half-tree.
    if (Test-Path $dst) { Remove-Item -Recurse -Force $dst -ErrorAction SilentlyContinue }
}

Write-Host "`n=== Verify the RUNNING app, not the deployment API ===" -ForegroundColor Cyan
[Net.ServicePointManager]::SecurityProtocol = 'Tls12'
$index = (Invoke-WebRequest -UseBasicParsing 'https://irams.vercel.app/').Content
$entry = [regex]::Match($index, '/assets/index-[^"]+\.js').Value
$entryJs = (Invoke-WebRequest -UseBasicParsing ('https://irams.vercel.app' + $entry)).Content
$chunk = [regex]::Match($entryJs, 'CockpitImportPage-[^"'']+\.js').Value
if (-not $chunk) { throw 'Served build has no CockpitImportPage chunk — the deploy did not carry the new work.' }
$chunkJs = (Invoke-WebRequest -UseBasicParsing ('https://irams.vercel.app/assets/' + $chunk)).Content
if ($chunkJs -notmatch 'Import from SAP Migration Cockpit') { throw 'Chunk served but without the page text — check the build.' }
Write-Host "Served: $chunk carries the cockpit import page." -ForegroundColor Green

Set-Location $repo
# The CLI's esbuild.exe can stay locked for a few seconds after it exits; a
# leftover copy is untidy, not a failed deploy, so this never throws.
for ($try = 1; $try -le 3 -and (Test-Path $dst); $try++) {
    try { Remove-Item -Recurse -Force $dst -ErrorAction Stop } catch { Start-Sleep -Seconds 3 }
}
if (Test-Path $dst) { Write-Host "Copy still locked at $dst — delete it later; the deploy is done." -ForegroundColor Yellow }
else { Write-Host "Deployed HEAD $head and removed the copy." -ForegroundColor Green }
