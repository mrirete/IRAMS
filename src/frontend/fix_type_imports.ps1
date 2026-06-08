$eamDir = "C:\Users\Cainergy\.gemini\antigravity\scratch\ERS\src\frontend\src\eam"
$files = Get-ChildItem -Path $eamDir -Recurse -Include "*.ts", "*.tsx"
$count = 0
foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    # Replace: import { ... } from '../types'  ->  import type { ... } from '../types'
    # But NOT: import type { ... } from '../types' (already correct)
    if ($content -match "import \{[^}]+\} from '\.\./types'" -and $content -notmatch "import type \{") {
        $content = $content -replace "import \{([^}]+)\} from '\.\./types'", "import type {`$1} from '../types'"
        Set-Content -Path $file.FullName -Value $content -NoNewline
        $count++
        Write-Host "Fixed: $($file.Name)"
    }
}
Write-Host "Total files fixed: $count"
