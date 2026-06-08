$eamDir = "C:\Users\Cainergy\.gemini\antigravity\scratch\ERS\src\frontend\src\eam"
$files = Get-ChildItem -Path $eamDir -Recurse -Include "*.ts","*.tsx"
foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    if ($content -match '\.\./src/lib/supabase') {
        $content = $content -replace '\.\./src/lib/supabase', '../lib/supabase'
        Set-Content -Path $file.FullName -Value $content -NoNewline
        Write-Host "Fixed: $($file.Name)"
    }
}
Write-Host "Done!"
