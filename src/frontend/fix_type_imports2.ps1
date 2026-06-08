$eamDir = "C:\Users\Cainergy\.gemini\antigravity\scratch\ERS\src\frontend\src\eam"
$files = Get-ChildItem -Path $eamDir -Recurse -Include "*.ts", "*.tsx"
$count = 0

foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    $changed = $false

    # Fix 1: import { ... } from '../../types' -> import type { ... } from '../../types'
    if ($content -match "import \{[^}]+\} from '\.\./\.\./types'" -and $content -notmatch "import type \{[^}]+\} from '\.\./\.\./types'") {
        $content = $content -replace "import \{([^}]+)\} from '\.\./\.\./types'", "import type {`$1} from '../../types'"
        $changed = $true
    }

    # Fix 2: import { ConfirmationModal, ConfirmationType } -> import { ConfirmationModal, type ConfirmationType }
    if ($content -match "import \{([^}]*),\s*ConfirmationType\s*\} from") {
        $content = $content -replace "import \{([^}]*),\s*ConfirmationType\s*\} from", "import {`$1, type ConfirmationType } from"
        $changed = $true
    }

    # Fix 3: FinOpsService mixed imports — CostAllocation, AssetFinancial, WarrantyCheckResult, CostAnomalyResult are interfaces
    if ($content -match "import \{.*FinOpsService.*CostAllocation") {
        $content = $content -replace "\bCostAllocation\b", "type CostAllocation"
        $content = $content -replace "\bAssetFinancial\b", "type AssetFinancial"
        $content = $content -replace "\bWarrantyCheckResult\b", "type WarrantyCheckResult"
        $content = $content -replace "\bCostAnomalyResult\b", "type CostAnomalyResult"
        # Clean up any double "type type"
        $content = $content -replace "type type ", "type "
        $changed = $true
    }

    # Fix 4: InventoryItemRecord from schema is an interface
    if ($content -match "import \{ InventoryItemRecord \} from '\.\./schema'") {
        $content = $content -replace "import \{ InventoryItemRecord \} from '\.\./schema'", "import type { InventoryItemRecord } from '../schema'"
        $changed = $true
    }

    if ($changed) {
        Set-Content -Path $file.FullName -Value $content -NoNewline
        $count++
        Write-Host "Fixed: $($file.FullName)"
    }
}

Write-Host "`nTotal files fixed: $count"
