$f = "c:\Users\Cainergy\.gemini\antigravity\scratch\ERS\src\frontend\src\components\analyze\RCATab.tsx"
$lines = Get-Content $f
Write-Host "Original line count: $($lines.Length)"

# Keep lines 1-1035 (index 0-1034) and lines 1694+ (index 1693+)
$before = $lines[0..1034]
$after = $lines[1691..($lines.Length-1)]
$comment = "            {/* New Investigation Form is now at /analyze/rca/new */}"

$result = $before + $comment + "" + $after
$result | Set-Content $f -Encoding UTF8
Write-Host "New line count: $($result.Length)"
Write-Host "Removed $($lines.Length - $result.Length) lines"
