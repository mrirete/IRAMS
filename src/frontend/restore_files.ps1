$backup = "C:\Users\Cainergy\Downloads\EAM Backup\project"
$target = "C:\Users\Cainergy\.gemini\antigravity\scratch\ERS\src\frontend\src\eam"

$files = @(
    "contexts\AuthContext.tsx",
    "components\DraggableUserList.tsx",
    "components\FinancialsTab.tsx",
    "components\InstructionBuilder.tsx",
    "components\NexusAI.tsx",
    "components\NotificationConfig.tsx",
    "components\OrgChart.tsx",
    "components\OrgUnitDetailsDrawer.tsx",
    "components\OrgUnitModal.tsx",
    "components\ProcedureBuilder.tsx",
    "components\ProcedureItemEditor.tsx",
    "components\ProcedureItemRenderer.tsx",
    "components\Sidebar.tsx",
    "pages\Admin.tsx",
    "pages\Assets.tsx",
    "pages\Contacts.tsx",
    "pages\ContactsTabs.tsx",
    "pages\Inventory.tsx",
    "pages\Login.tsx",
    "pages\PurchaseOrders.tsx",
    "pages\Readings.tsx",
    "pages\RecurringWork.tsx",
    "pages\Scheduling.tsx",
    "pages\ServiceRequests.tsx",
    "pages\Vendors.tsx",
    "services\DatabaseService.ts",
    "services\DataMapper.ts",
    "services\NotificationService.ts",
    "pages\admin\TaskLibrary.tsx",
    "components\modals\AddContactModal.tsx",
    "components\modals\AddMemberModal.tsx",
    "components\modals\CreatePMModal.tsx",
    "components\modals\CreateWorkOrderModal.tsx"
)

$count = 0
foreach ($f in $files) {
    $src = Join-Path $backup $f
    $dest = Join-Path $target $f
    if (Test-Path $src) {
        Copy-Item $src $dest -Force
        $count++
    }
    else {
        Write-Host "NOT FOUND: $src"
    }
}

Write-Host "Restored $count files from backup"
