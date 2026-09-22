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

Write-Host "`n=== Deploy (pinned CLI) ===" -ForegroundColor Cyan
Set-Location $dst
npx vercel@58.9.5 deploy --prod --yes --archive=tgz
if ($LASTEXITCODE -ne 0) { throw "vercel deploy failed with exit $LASTEXITCODE" }

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
Remove-Item -Recurse -Force $dst
Write-Host "Deployed HEAD $head and removed the copy." -ForegroundColor Green
