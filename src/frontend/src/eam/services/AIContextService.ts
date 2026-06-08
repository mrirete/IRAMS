/**
 * AIContextService — Builds rich contextual prompts from live EAM data
 * 
 * Each builder gathers relevant data from DatabaseService / FinOpsService
 * and assembles a structured text block for Relantern AI consumption.
 * 
 * HITL: This service ONLY reads data. It never writes or modifies.
 */

import { DatabaseService } from './DatabaseService';

export class AIContextService {
    private static instance: AIContextService;
    private db: DatabaseService;

    private constructor() {
        this.db = DatabaseService.getInstance();
    }

    static getInstance(): AIContextService {
        if (!AIContextService.instance) {
            AIContextService.instance = new AIContextService();
        }
        return AIContextService.instance;
    }

    // ─── Asset Context ─────────────────────────────────────
    async buildAssetContext(assetId: string): Promise<string> {
        try {
            const [assets, workOrders] = await Promise.all([
                this.db.getAssets(),
                this.db.getWorkOrders(),
            ]);

            const asset = assets.find(a => a.id === assetId);
            if (!asset) return 'Asset not found.';

            const assetWOs = workOrders.filter(wo => wo.assetId === assetId);
            const closedWOs = assetWOs.filter(wo => wo.status === 'CLOSED' || wo.status === 'TECO');
            const openWOs = assetWOs.filter(wo => wo.status !== 'CLOSED' && wo.status !== 'CANC');
            const correctiveWOs = assetWOs.filter(wo => wo.type === 'CM');
            const preventiveWOs = assetWOs.filter(wo => wo.type === 'PM');

            const totalCost = closedWOs.reduce((sum, wo) => {
                const laborCost = (wo.labor || []).reduce((s, l) => s + ((l.actualDuration || l.estDuration || 0) * (l.actualRate || l.estRate || 0)), 0);
                const partsCost = (wo.inventory || []).reduce((s, p) => s + ((p.actualQty || p.estQty || 0) * (p.actualUnitCost || p.estUnitCost || 0)), 0);
                return sum + laborCost + partsCost;
            }, 0);

            const totalDowntime = closedWOs.reduce((sum, wo) => sum + (wo.actualDowntime || wo.estDowntime || 0), 0);
            const failures = correctiveWOs.length;
            const totalRunHours = 8760; // Approximate annual hours
            const mtbf = failures > 0 ? Math.round(totalRunHours / failures) : 'N/A (no failures recorded)';

            return `═══ ASSET CONTEXT ═══
Asset: ${asset.tag} — ${asset.name}
Type: ${asset.assetType || 'N/A'} | Category: ${asset.assetCategory || 'N/A'} | Class: ${asset.assetClass || 'N/A'}
Criticality: ${asset.criticality || 'N/A'} | Health Score: ${asset.healthScore || 'N/A'}/100
Status: ${asset.status} | Location: ${asset.location || 'N/A'}
Manufacturer: ${asset.manufacturer || 'N/A'} | Model: ${asset.model || 'N/A'}
Cost Center: ${asset.costCenter || 'N/A'}
Purchase Price: $${asset.purchasePrice?.toLocaleString() || 'N/A'}
Install Date: ${asset.installationDate || 'N/A'} | Useful Life: ${asset.usefulLifeYears || 'N/A'} years

▸ WORK HISTORY SUMMARY:
Total Work Orders: ${assetWOs.length} | Open: ${openWOs.length} | Closed: ${closedWOs.length}
Corrective (CM): ${correctiveWOs.length} | Preventive (PM): ${preventiveWOs.length}
PM:CM Ratio: ${preventiveWOs.length > 0 ? Math.round((preventiveWOs.length / (preventiveWOs.length + correctiveWOs.length)) * 100) : 0}%
Estimated MTBF: ${mtbf} hours
Total Downtime: ${totalDowntime} hours
Total Maintenance Cost: $${totalCost.toLocaleString()}

▸ BOM (Bill of Materials):
${(asset.bomItems || []).map(b => `  - ${b.description} (${b.inventoryCode}) × ${b.quantity} ${b.uom} ${b.critical ? '⚠️ CRITICAL' : ''}`).join('\n') || '  No BOM items'}
`;
        } catch (error) {
            console.error('[AIContextService] buildAssetContext error:', error);
            return 'Error loading asset context.';
        }
    }

    // ─── Work Order Context ────────────────────────────────
    async buildWorkOrderContext(woId: string): Promise<string> {
        try {
            const [workOrders, assets] = await Promise.all([
                this.db.getWorkOrders(),
                this.db.getAssets(),
            ]);

            const wo = workOrders.find(w => w.id === woId);
            if (!wo) return 'Work order not found.';

            const asset = assets.find(a => a.id === wo.assetId);

            const laborCost = (wo.labor || []).reduce((s, l) => s + ((l.estDuration || 0) * (l.estRate || 0)), 0);
            const partsCost = (wo.inventory || []).reduce((s, p) => s + ((p.estQty || 0) * (p.estUnitCost || 0)), 0);
            const downtimeCost = (wo.estDowntime || 0) * 500; // Assume $500/hr downtime cost

            return `═══ WORK ORDER CONTEXT ═══
WO: ${wo.woNumber || wo.id} — ${wo.title}
Type: ${wo.type} | Priority: ${wo.priority} | Status: ${wo.status} | Scope: ${wo.scope || 'Standard'}
Description: ${wo.description || 'N/A'}

▸ ASSET:
${asset ? `${asset.tag} — ${asset.name} | Criticality: ${asset.criticality || 'N/A'} | Type: ${asset.assetType || 'N/A'}` : 'No asset linked'}

▸ FAILURE CODING:
Functional Failure: ${wo.functionalFailure || 'Not coded'}
Failure Mode: ${wo.failureMode || 'Not coded'}
Failure Cause: ${wo.failureCause || 'Not coded'}
Remedy: ${wo.remedy || 'Not coded'}

▸ TASKS (${(wo.tasks || []).length}):
${(wo.tasks || []).map(t => `  ${t.sequence}. ${t.description} — Est: ${t.estHours}h — Status: ${t.status}`).join('\n') || '  No tasks'}

▸ COST ESTIMATE:
Labor: $${laborCost.toLocaleString()} | Materials: $${partsCost.toLocaleString()} | Downtime: $${downtimeCost.toLocaleString()}
Total Estimated: $${(laborCost + partsCost + downtimeCost).toLocaleString()}

▸ SCHEDULE:
Created: ${wo.dateCreated || 'N/A'} | Due Start: ${wo.dateDueStart || 'N/A'} | Due End: ${wo.dueDate || 'N/A'}
Est Duration: ${wo.estDuration || 0}h | Est Downtime: ${wo.estDowntime || 0}h
`;
        } catch (error) {
            console.error('[AIContextService] buildWorkOrderContext error:', error);
            return 'Error loading work order context.';
        }
    }

    // ─── Dashboard / Fleet Context ─────────────────────────
    async buildDashboardContext(): Promise<string> {
        try {
            const [assets, workOrders] = await Promise.all([
                this.db.getAssets(),
                this.db.getWorkOrders(),
            ]);

            const totalAssets = assets.length;
            const critAAssets = assets.filter(a => a.criticality === 'A').length;
            const critBAssets = assets.filter(a => a.criticality === 'B').length;
            const avgHealth = totalAssets > 0
                ? Math.round(assets.reduce((s, a) => s + (a.healthScore || 0), 0) / totalAssets)
                : 0;

            const openWOs = workOrders.filter(wo => wo.status !== 'CLOSED' && wo.status !== 'CANC');
            const overdueWOs = openWOs.filter(wo => wo.dueDate && new Date(wo.dueDate) < new Date());
            const cmWOs = workOrders.filter(wo => wo.type === 'CM');
            const pmWOs = workOrders.filter(wo => wo.type === 'PM');

            // Bad actors — assets with most WOs
            const assetWOCount = new Map<string, number>();
            workOrders.forEach(wo => {
                if (wo.assetId) assetWOCount.set(wo.assetId, (assetWOCount.get(wo.assetId) || 0) + 1);
            });
            const badActors = [...assetWOCount.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([id, count]) => {
                    const a = assets.find(x => x.id === id);
                    return `  - ${a?.tag || id}: ${count} WOs (Criticality ${a?.criticality || '?'})`;
                });

            return `═══ DASHBOARD / FLEET CONTEXT ═══
Total Assets: ${totalAssets} | Criticality A: ${critAAssets} | Criticality B: ${critBAssets}
Average Fleet Health: ${avgHealth}/100

▸ WORK ORDER SUMMARY:
Open WOs: ${openWOs.length} | Overdue: ${overdueWOs.length}
CM (Reactive): ${cmWOs.length} | PM (Planned): ${pmWOs.length}
PM:CM Ratio: ${pmWOs.length > 0 ? Math.round((pmWOs.length / (pmWOs.length + cmWOs.length)) * 100) : 0}%

▸ TOP 5 BAD ACTORS (by WO count):
${badActors.join('\n') || '  No data available'}
`;
        } catch (error) {
            console.error('[AIContextService] buildDashboardContext error:', error);
            return 'Error loading dashboard context.';
        }
    }

    // ─── Inventory Context ─────────────────────────────────
    async buildInventoryContext(itemId?: string): Promise<string> {
        try {
            const items = await this.db.getInventoryItems();

            if (itemId) {
                const item = items.find(i => i.id === itemId);
                if (!item) return 'Inventory item not found.';

                return `═══ INVENTORY ITEM CONTEXT ═══
Code: ${item.code} — ${item.description}
Type: ${item.type} | UOM: ${item.uom} | Critical: ${item.isCritical ? 'YES ⚠️' : 'No'}
Unit Cost: $${item.itemCost?.toFixed(2) || '0.00'}
On Hand: ${item.totalQtyOnHand} | On Order: ${item.totalQtyOnOrder}
Min Level: ${item.minLevel || 0} | Max Level: ${item.maxLevel || 0}
${(item.totalQtyOnHand || 0) <= (item.minLevel || 0) ? '🔴 BELOW MINIMUM — Reorder needed' : ''}
${(item.totalQtyOnHand || 0) === 0 ? '🚨 STOCKOUT' : ''}
Manufacturer: ${item.manufacturer || 'N/A'}
Holding Cost (est): $${((item.itemCost || 0) * (item.totalQtyOnHand || 0) * 0.25).toFixed(2)}/year (at 25% carrying cost)

▸ STOCK LOCATIONS:
${(item.stockLocations || []).map(l => `  - ${l.storeName}: ${l.qtyOnHand} units in ${l.binLocation}`).join('\n') || '  No location data'}

▸ RECENT TRANSACTIONS:
${(item.transactions || []).slice(0, 5).map(t => `  - ${t.date}: ${t.type} ${t.qtyChange > 0 ? '+' : ''}${t.qtyChange} → Balance: ${t.newBalance} (${t.reference || 'N/A'})`).join('\n') || '  No transactions'}
`;
            }

            // Fleet-level inventory summary
            const criticalItems = items.filter(i => i.isCritical);
            const belowMin = items.filter(i => (i.totalQtyOnHand || 0) <= (i.minLevel || 0));
            const stockouts = items.filter(i => (i.totalQtyOnHand || 0) === 0 && i.isActive);
            const totalValue = items.reduce((s, i) => s + (i.itemCost || 0) * (i.totalQtyOnHand || 0), 0);

            return `═══ INVENTORY FLEET CONTEXT ═══
Total SKUs: ${items.length} | Active: ${items.filter(i => i.isActive).length}
Critical Items: ${criticalItems.length}
Below Min Level: ${belowMin.length} ⚠️
Stockouts: ${stockouts.length} 🚨
Total Inventory Value: $${totalValue.toLocaleString()}
Est Annual Holding Cost: $${(totalValue * 0.25).toLocaleString()} (at 25% carrying cost)
`;
        } catch (error) {
            console.error('[AIContextService] buildInventoryContext error:', error);
            return 'Error loading inventory context.';
        }
    }

    // ─── People / Workforce Context ────────────────────────
    async buildPeopleContext(): Promise<string> {
        try {
            const contacts = await this.db.getContacts();
            const personnel = contacts.filter(c => c.contactType !== 'VENDOR' && c.contactType !== 'MANUFACTURER');
            const technicians = personnel.filter(c => c.contactType === 'TECHNICIAN');
            const planners = personnel.filter(c => c.contactType === 'PLANNER');
            const supervisors = personnel.filter(c => c.contactType === 'SUPERVISOR');
            const engineers = personnel.filter(c => c.contactType === 'RELIABILITY_ENG');

            return `═══ WORKFORCE CONTEXT ═══
Total Personnel: ${personnel.length}
Technicians: ${technicians.length} | Planners: ${planners.length}
Supervisors: ${supervisors.length} | Reliability Engineers: ${engineers.length}

▸ ROLE DISTRIBUTION:
${['TECHNICIAN', 'PLANNER', 'SUPERVISOR', 'RELIABILITY_ENG', 'INTERNAL']
                    .map(role => {
                        const count = personnel.filter(c => c.contactType === role).length;
                        return count > 0 ? `  - ${role}: ${count}` : null;
                    })
                    .filter(Boolean)
                    .join('\n')}
`;
        } catch (error) {
            console.error('[AIContextService] buildPeopleContext error:', error);
            return 'Error loading workforce context.';
        }
    }

    // ─── Service Request Context ───────────────────────────
    async buildServiceRequestContext(srId: string): Promise<string> {
        try {
            const [requests, assets] = await Promise.all([
                this.db.getServiceRequests(),
                this.db.getAssets(),
            ]);

            const sr = requests.find(r => r.id === srId);
            if (!sr) return 'Service request not found.';

            const asset = assets.find(a => a.id === sr.assetId);

            return `═══ SERVICE REQUEST CONTEXT ═══
SR: ${sr.requestNumber || sr.id} — ${sr.title}
Description: ${sr.description || 'N/A'}
Priority: ${sr.priority} | Status: ${sr.status} | Category: ${sr.category || 'N/A'}
Requester: ${sr.requesterName || sr.requesterId}
Created: ${sr.createdAt} | SLA Deadline: ${sr.slaDeadline || 'N/A'}

▸ LINKED ASSET:
${asset ? `${asset.tag} — ${asset.name} | Criticality: ${asset.criticality || 'N/A'} | Health: ${asset.healthScore || 'N/A'}/100` : 'No asset linked'}
`;
        } catch (error) {
            console.error('[AIContextService] buildServiceRequestContext error:', error);
            return 'Error loading service request context.';
        }
    }

    // ─── Readings / Condition Data Context ─────────────────
    async buildReadingsContext(assetId: string): Promise<string> {
        try {
            const assets = await this.db.getAssets();
            const asset = assets.find(a => a.id === assetId);

            // Note: Reading data would come from the readings store
            return `═══ CONDITION DATA CONTEXT ═══
Asset: ${asset?.tag || assetId} — ${asset?.name || 'Unknown'}
Criticality: ${asset?.criticality || 'N/A'} | Type: ${asset?.assetType || 'N/A'}

(Note: Detailed sensor readings and trend data should be loaded from the Condition Data module for full P-F curve analysis.)
Analyze available condition monitoring data for anomalies, trend deviations, and remaining useful life estimation.
`;
        } catch (error) {
            console.error('[AIContextService] buildReadingsContext error:', error);
            return 'Error loading readings context.';
        }
    }

    // ─── FinOps / Financial Context ────────────────────────
    buildFinOpsContext(data: {
        totalBudget?: number; totalActual?: number; variance?: number;
        costCentres?: { name: string; budget: number; actual: number }[];
        rav?: number; maintenanceSpend?: number;
        topCostDrivers?: { assetTag: string; cost: number }[];
    }): string {
        const { totalBudget = 0, totalActual = 0, variance = 0, costCentres = [], rav = 0, maintenanceSpend = 0, topCostDrivers = [] } = data;
        const ravPct = rav > 0 ? ((maintenanceSpend / rav) * 100).toFixed(1) : 'N/A';

        return `═══ FINOPS CONTEXT ═══
Total Budget: $${totalBudget.toLocaleString()} | Actual Spend: $${totalActual.toLocaleString()}
Variance: $${variance.toLocaleString()} (${totalBudget > 0 ? ((variance / totalBudget) * 100).toFixed(1) : 0}%)
Replacement Asset Value (RAV): $${rav.toLocaleString()}
Maintenance / RAV: ${ravPct}% ${Number(ravPct) > 3 ? '⚠️ Above industry benchmark (2-3%)' : ''}

▸ COST CENTRES (${costCentres.length}):
${costCentres.slice(0, 10).map(cc => `  - ${cc.name}: Budget $${cc.budget.toLocaleString()} | Actual $${cc.actual.toLocaleString()} | ${cc.actual > cc.budget ? '🔴 OVER' : '✅ OK'}`).join('\n') || '  No cost centres'}

▸ TOP COST DRIVERS:
${topCostDrivers.slice(0, 5).map((d, i) => `  ${i + 1}. ${d.assetTag}: $${d.cost.toLocaleString()}`).join('\n') || '  No data'}
`;
    }

    // ─── Recurring Work / PM Context ──────────────────────
    buildRecurringWorkContext(data: {
        totalPMs?: number; activePMs?: number; suspendedPMs?: number;
        overdueCount?: number; complianceRate?: number;
        selectedPM?: {
            code: string; title: string; assetTag?: string; frequency?: string;
            lastExecuted?: string; nextDue?: string; executionCount?: number;
            avgCost?: number; failuresFound?: number;
        };
    }): string {
        const { totalPMs = 0, activePMs = 0, suspendedPMs = 0, overdueCount = 0, complianceRate = 0, selectedPM } = data;

        let pmDetail = '';
        if (selectedPM) {
            const valueRatio = selectedPM.executionCount && selectedPM.avgCost
                ? ((selectedPM.failuresFound || 0) / (selectedPM.executionCount * selectedPM.avgCost) * 10000).toFixed(2)
                : 'N/A';
            pmDetail = `
▸ SELECTED PM:
Code: ${selectedPM.code} — ${selectedPM.title}
Asset: ${selectedPM.assetTag || 'N/A'} | Frequency: ${selectedPM.frequency || 'N/A'}
Last Executed: ${selectedPM.lastExecuted || 'Never'} | Next Due: ${selectedPM.nextDue || 'N/A'}
Executions: ${selectedPM.executionCount || 0} | Avg Cost/Cycle: $${(selectedPM.avgCost || 0).toLocaleString()}
Failures Found: ${selectedPM.failuresFound || 0} | Value Ratio: ${valueRatio}
`;
        }

        return `═══ RECURRING WORK (PM) CONTEXT ═══
Total PMs: ${totalPMs} | Active: ${activePMs} | Suspended: ${suspendedPMs}
Overdue: ${overdueCount} ${overdueCount > 0 ? '⚠️' : ''} | Compliance Rate: ${complianceRate}%
${pmDetail}`;
    }

    // ─── Scheduling Context ──────────────────────────────
    buildSchedulingContext(data: {
        scheduledWOs?: number; unscheduledWOs?: number;
        plannedHours?: number; availableHours?: number;
        resourceLoad?: { craft: string; planned: number; available: number }[];
        conflicts?: number;
    }): string {
        const { scheduledWOs = 0, unscheduledWOs = 0, plannedHours = 0, availableHours = 0, resourceLoad = [], conflicts = 0 } = data;
        const loadPct = availableHours > 0 ? ((plannedHours / availableHours) * 100).toFixed(0) : 'N/A';

        return `═══ SCHEDULING CONTEXT ═══
Scheduled WOs: ${scheduledWOs} | Unscheduled Backlog: ${unscheduledWOs}
Planned Hours: ${plannedHours}h | Available Hours: ${availableHours}h | Load: ${loadPct}%
Resource Conflicts: ${conflicts} ${conflicts > 0 ? '⚠️' : ''}

▸ RESOURCE LOAD BY CRAFT:
${resourceLoad.map(r => {
    const pct = r.available > 0 ? ((r.planned / r.available) * 100).toFixed(0) : '∞';
    return `  - ${r.craft}: ${r.planned}h / ${r.available}h (${pct}%) ${Number(pct) > 100 ? '🔴 OVERLOADED' : ''}`;
}).join('\n') || '  No resource data'}
`;
    }

    // ─── Vendor Context ──────────────────────────────────
    async buildVendorContext(vendorId?: string): Promise<string> {
        try {
            const vendors = await this.db.getVendors();

            if (vendorId) {
                const v = vendors.find(x => x.id === vendorId);
                if (!v) return 'Vendor not found.';

                return `═══ VENDOR CONTEXT ═══
Vendor: ${v.code || 'N/A'} — ${v.name}
Type: ${v.type || 'N/A'} | Active: ${v.active ? 'Yes' : 'No'}
Payment Terms: ${v.paymentTerms || 'N/A'} | Currency: ${v.currency || 'USD'}
Hourly Rate: $${v.hourlyRate || 0}/hr
Contact: ${v.primaryContactName || 'N/A'} | Email: ${v.email || 'N/A'} | Phone: ${v.phone || 'N/A'}
`;
            }

            // Fleet-level vendor summary
            const activeVendors = vendors.filter(v => v.active);
            return `═══ VENDOR FLEET CONTEXT ═══
Total Vendors: ${vendors.length} | Active: ${activeVendors.length}
Types: ${[...new Set(vendors.map(v => v.type).filter(Boolean))].join(', ') || 'N/A'}
`;
        } catch (error) {
            console.error('[AIContextService] buildVendorContext error:', error);
            return 'Error loading vendor context.';
        }
    }

    // ─── Management of Change Context ────────────────────
    buildMoCContext(data: {
        mocId?: string; title?: string; status?: string;
        changeType?: string; riskLevel?: string;
        initiator?: string; affectedAssets?: string[];
        description?: string;
    }): string {
        const { mocId, title, status, changeType, riskLevel, initiator, affectedAssets = [], description } = data;

        if (!mocId) {
            return `═══ MANAGEMENT OF CHANGE CONTEXT ═══
No specific MoC selected. Ask about change management best practices, risk assessment frameworks, or ISO 31000 compliance.
`;
        }

        return `═══ MANAGEMENT OF CHANGE CONTEXT ═══
MoC: ${mocId} — ${title || 'Untitled'}
Status: ${status || 'Draft'} | Change Type: ${changeType || 'N/A'} | Risk Level: ${riskLevel || 'N/A'}
Initiator: ${initiator || 'N/A'}
Description: ${description || 'N/A'}

▸ AFFECTED ASSETS (${affectedAssets.length}):
${affectedAssets.map(a => `  - ${a}`).join('\n') || '  None identified'}
`;
    }

    // ─── Notifications Context ───────────────────────────
    buildNotificationsContext(data: {
        unreadCount?: number; criticalCount?: number; warningCount?: number;
        topModules?: { module: string; count: number }[];
    }): string {
        const { unreadCount = 0, criticalCount = 0, warningCount = 0, topModules = [] } = data;

        return `═══ NOTIFICATIONS CONTEXT ═══
Unread: ${unreadCount} | Critical: ${criticalCount} ${criticalCount > 0 ? '🚨' : ''} | Warnings: ${warningCount} ${warningCount > 0 ? '⚠️' : ''}

▸ BY MODULE:
${topModules.map(m => `  - ${m.module}: ${m.count} unread`).join('\n') || '  No module breakdown'}
`;
    }
}

export const aiContextService = AIContextService.getInstance();
