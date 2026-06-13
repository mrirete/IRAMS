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

    // ─── Hierarchy Path Builder ──────────────────────────────
    private buildHierarchyPath(assetId: string, allAssets: any[]): string {
        const path: { tag: string; name: string }[] = [];
        let current = allAssets.find(a => a.id === assetId);
        let depth = 0;
        while (current && depth < 10) {
            path.unshift({ tag: current.tag, name: current.name });
            if (!current.parentId && !current.parent_id) break;
            current = allAssets.find(a => a.id === (current.parentId || current.parent_id));
            depth++;
        }
        if (path.length <= 1) return 'Root level (no parent hierarchy)';
        return path.map(p => `${p.tag} (${p.name})`).join(' → ');
    }

    // ─── OREDA Lookup ──────────────────────────────────────
    private getOREDABenchmark(assetType: string): { name: string; mtbf: number; lambda: number } | null {
        const benchmarks: Record<string, { name: string; mtbf: number; lambda: number }> = {
            'CENTRIFUGAL_PUMP': { name: 'Centrifugal Pump', mtbf: 8300, lambda: 120 },
            'PUMP': { name: 'Centrifugal Pump', mtbf: 8300, lambda: 120 },
            'RECIPROCATING_COMPRESSOR': { name: 'Reciprocating Compressor', mtbf: 2800, lambda: 360 },
            'COMPRESSOR': { name: 'Centrifugal Compressor', mtbf: 5600, lambda: 180 },
            'CENTRIFUGAL_COMPRESSOR': { name: 'Centrifugal Compressor', mtbf: 5600, lambda: 180 },
            'GAS_TURBINE': { name: 'Gas Turbine', mtbf: 2200, lambda: 450 },
            'STEAM_TURBINE': { name: 'Steam Turbine', mtbf: 4000, lambda: 250 },
            'ELECTRIC_MOTOR': { name: 'Electric Motor (>100kW)', mtbf: 28500, lambda: 35 },
            'MOTOR': { name: 'Electric Motor (>100kW)', mtbf: 28500, lambda: 35 },
            'HEAT_EXCHANGER': { name: 'Heat Exchanger (S&T)', mtbf: 45000, lambda: 22 },
            'CONDENSER': { name: 'Overhead Condenser (S&T)', mtbf: 45000, lambda: 22 },
            'GATE_VALVE': { name: 'Gate Valve', mtbf: 55000, lambda: 18 },
            'VALVE': { name: 'Gate Valve', mtbf: 55000, lambda: 18 },
            'CONTROL_VALVE': { name: 'Control Valve', mtbf: 18000, lambda: 55 },
            'PSV': { name: 'Pressure Safety Valve', mtbf: 125000, lambda: 8 },
            'DIESEL_ENGINE': { name: 'Diesel Engine', mtbf: 3500, lambda: 280 },
            'PRESSURE_VESSEL': { name: 'Pressure Vessel', mtbf: 100000, lambda: 10 },
            'SEPARATOR': { name: 'Separator', mtbf: 80000, lambda: 12 },
            'STORAGE_TANK': { name: 'Storage Tank', mtbf: 200000, lambda: 5 },
            'TRANSFORMER': { name: 'Power Transformer', mtbf: 100000, lambda: 10 },
            'AIR_COOLER': { name: 'Air-Cooled Exchanger', mtbf: 22000, lambda: 45 },
        };
        // Try exact match, then partial match
        const type = (assetType || '').toUpperCase().replace(/\s+/g, '_');
        if (benchmarks[type]) return benchmarks[type];
        // Try class match
        const classKey = (assetType || '').toUpperCase();
        for (const [key, val] of Object.entries(benchmarks)) {
            if (classKey.includes(key) || key.includes(classKey)) return val;
        }
        return null;
    }

    // ─── Asset Context (Expert Intelligence Brief) ─────────
    async buildAssetContext(assetId: string): Promise<string> {
        try {
            const [assets, workOrders] = await Promise.all([
                this.db.getAssets(),
                this.db.getWorkOrders() as Promise<any[]>,
            ]);

            const asset = assets.find(a => a.id === assetId);
            if (!asset) return 'Asset not found in the database.';

            return this._buildAssetIntelligenceBrief(asset, assets, workOrders);
        } catch (error) {
            console.error('[AIContextService] buildAssetContext error:', error);
            return 'Error loading asset context.';
        }
    }

    /**
     * Build asset context from pre-loaded data (avoids duplicate DB calls
     * when the Assets page already has assets & workOrders in state).
     */
    buildAssetContextFromData(asset: any, allAssets: any[], workOrders: any[]): string {
        try {
            return this._buildAssetIntelligenceBrief(asset, allAssets, workOrders);
        } catch (error) {
            console.error('[AIContextService] buildAssetContextFromData error:', error);
            return 'Error building asset context.';
        }
    }

    private _buildAssetIntelligenceBrief(asset: any, allAssets: any[], workOrders: any[]): string {
        // ── Hierarchy Path ──
        const hierarchyPath = this.buildHierarchyPath(asset.id, allAssets);

        // ── Work History ──
        const assetWOs = workOrders.filter(wo =>
            (wo.assetId === asset.id || wo.asset_id === asset.id)
        );
        const closedWOs = assetWOs.filter(wo => wo.status === 'CLOSED' || wo.status === 'TECO');
        const openWOs = assetWOs.filter(wo => wo.status !== 'CLOSED' && wo.status !== 'CANC');
        const correctiveWOs = assetWOs.filter(wo => wo.type === 'CM');
        const preventiveWOs = assetWOs.filter(wo => wo.type === 'PM');
        const inspectionWOs = assetWOs.filter(wo => wo.type === 'INSPECTION' || wo.type === 'INS');

        // ── Cost Calculation ──
        const totalCost = closedWOs.reduce((sum, wo) => {
            const laborCost = (wo.labor || []).reduce((s: any, l: any) =>
                s + ((l.actualDuration || l.estDuration || 0) * (l.actualRate || l.estRate || 0)), 0);
            const partsCost = (wo.inventory || []).reduce((s: any, p: any) =>
                s + ((p.actualQty || p.estQty || 0) * (p.actualUnitCost || p.estUnitCost || 0)), 0);
            return sum + laborCost + partsCost;
        }, 0);

        const totalDowntime = closedWOs.reduce((sum, wo) =>
            sum + (wo.actualDowntime || wo.estDowntime || 0), 0);

        // ── MTBF & OREDA Comparison ──
        const failures = correctiveWOs.length;
        const totalRunHours = 8760; // Approximate annual
        const actualMTBF = failures > 0 ? Math.round(totalRunHours / failures) : null;
        const oreda = this.getOREDABenchmark(
            asset.assetClass || asset.assetType || asset.asset_type || asset.category || ''
        );

        let oredaComparison = '';
        if (oreda && actualMTBF) {
            const ratio = (actualMTBF / oreda.mtbf).toFixed(2);
            const status = actualMTBF < oreda.mtbf * 0.67
                ? '🔴 BAD ACTOR — actual MTBF is significantly below OREDA benchmark'
                : actualMTBF < oreda.mtbf
                    ? '⚠️ Below benchmark — maintenance strategy review recommended'
                    : '✅ Performing at or above OREDA benchmark';
            oredaComparison = `OREDA Benchmark (${oreda.name}): MTBF=${oreda.mtbf.toLocaleString()}h | Actual: ${actualMTBF.toLocaleString()}h | Ratio: ${ratio}× | ${status}`;
        } else if (oreda) {
            oredaComparison = `OREDA Benchmark (${oreda.name}): MTBF=${oreda.mtbf.toLocaleString()}h | Actual: No failures recorded — performing well`;
        }

        // ── PM:CM Ratio ──
        const pmCmTotal = preventiveWOs.length + correctiveWOs.length;
        const pmCmRatio = pmCmTotal > 0
            ? Math.round((preventiveWOs.length / pmCmTotal) * 100)
            : 0;
        const pmCmStatus = pmCmRatio >= 80 ? '✅ Target met' :
            pmCmRatio >= 60 ? '⚠️ Below target (>80%)' : '🔴 Highly reactive — PM program review needed';

        // ── Asset Age ──
        const installDate = asset.installationDate || asset.installation_date;
        let ageStr = 'N/A';
        let ageYears = 0;
        let lifePctStr = '';
        if (installDate) {
            const install = new Date(installDate);
            ageYears = Math.round((Date.now() - install.getTime()) / (365.25 * 24 * 60 * 60 * 1000) * 10) / 10;
            ageStr = `${ageYears} years`;
            const usefulLife = asset.usefulLifeYears || asset.useful_life_years;
            if (usefulLife) {
                const pct = Math.round((ageYears / usefulLife) * 100);
                lifePctStr = ` | Life consumed: ${pct}% of ${usefulLife} years`;
            }
        }

        // ── Warranty Status ──
        const warrantyEnd = asset.warrantyEndDate || asset.warranty_end_date;
        let warrantyStatus = 'No warranty data';
        if (warrantyEnd) {
            const wEnd = new Date(warrantyEnd);
            warrantyStatus = wEnd > new Date()
                ? `✅ UNDER WARRANTY until ${wEnd.toLocaleDateString()}`
                : `Expired (${wEnd.toLocaleDateString()})`;
        }

        // ── Cost Analysis ──
        const annualizedCost = ageYears > 0 ? Math.round(totalCost / ageYears) : totalCost;
        const purchasePrice = asset.purchasePrice || asset.purchase_price || 0;
        const ravPct = purchasePrice > 0
            ? ((annualizedCost / purchasePrice) * 100).toFixed(1)
            : 'N/A';
        const ravStatus = purchasePrice > 0
            ? (annualizedCost / purchasePrice > 0.04 ? ' ⚠️ Above 4% benchmark' :
                annualizedCost / purchasePrice > 0.02 ? ' — Within benchmark (2-4%)' : ' ✅ Below 2%')
            : '';

        // ── Recent CM Detail (last 5) ──
        const recentCMs = correctiveWOs
            .sort((a, b) => new Date(b.dateCreated || b.date_created || 0).getTime() -
                new Date(a.dateCreated || a.date_created || 0).getTime())
            .slice(0, 5);

        const cmDetailLines = recentCMs.map(wo => {
            const woNum = wo.woNumber || wo.wo_number || wo.id;
            const title = wo.title || 'Untitled';
            const dt = wo.actualDowntime || wo.estDowntime || 0;
            const lCost = (wo.labor || []).reduce((s: any, l: any) =>
                s + ((l.actualDuration || l.estDuration || 0) * (l.actualRate || l.estRate || 0)), 0);
            const pCost = (wo.inventory || []).reduce((s: any, p: any) =>
                s + ((p.actualQty || p.estQty || 0) * (p.actualUnitCost || p.estUnitCost || 0)), 0);
            const cause = wo.failureCause || wo.failure_cause || 'Not coded';
            const mode = wo.failureMode || wo.failure_mode || 'Not coded';
            return `    ${woNum}: "${title}" — ${dt}h downtime, $${(lCost + pCost).toLocaleString()} | Mode: ${mode} | Cause: ${cause}`;
        });

        // ── BOM ──
        const bomItems = asset.bomItems || asset.bom_items || [];
        const bomLines = bomItems.length > 0
            ? bomItems.map((b: any) => {
                const stock = b.qtyOnHand ?? b.qty_on_hand;
                const stockAlert = stock !== undefined
                    ? (stock === 0 ? ' ⚠️ ZERO STOCK' : ` — Stock: ${stock}`)
                    : '';
                return `    ${b.inventoryCode || b.inventory_code || 'N/A'}: ${b.description} × ${b.quantity} ${b.uom} ${b.critical ? '⚠️ CRITICAL' : ''}${stockAlert}`;
            }).join('\n')
            : '    No BOM items registered';

        // ── Children & Siblings ──
        const children = allAssets.filter(a => (a.parentId || a.parent_id) === asset.id);
        const parent = allAssets.find(a => a.id === (asset.parentId || asset.parent_id));
        const siblings = parent
            ? allAssets.filter(a => (a.parentId || a.parent_id) === parent.id && a.id !== asset.id)
            : [];

        // ── Open WO Detail ──
        const openWOLines = openWOs.slice(0, 5).map(wo => {
            const woNum = wo.woNumber || wo.wo_number || wo.id;
            return `    ${woNum}: "${wo.title || 'Untitled'}" — ${wo.type} | ${wo.priority || 'N/A'} | Status: ${wo.status}`;
        });

        // ── Build the Intelligence Brief ──
        return `═══ ASSET INTELLIGENCE BRIEF ═══

▸ IDENTITY & LOCATION:
  Tag: ${asset.tag} | Name: ${asset.name}
  Hierarchy Path: ${hierarchyPath}
  Status: ${asset.status || 'N/A'} | Equipment #: ${asset.equipmentNumber || asset.equipment_number || 'N/A'}

▸ CLASSIFICATION (ISO 14224):
  Category: ${asset.assetCategory || asset.asset_category || 'N/A'}
  Class: ${asset.assetClass || asset.asset_class || 'N/A'}
  Type: ${asset.assetType || asset.asset_type || 'N/A'}
  Criticality: ${asset.criticality || 'N/A'}

▸ TECHNICAL DATA:
  Manufacturer: ${asset.manufacturer || 'N/A'} | Model: ${asset.model || 'N/A'}
  Serial: ${asset.serialNumber || asset.serial_number || 'N/A'}
  Install Date: ${installDate || 'N/A'} | Age: ${ageStr}${lifePctStr}
  Purchase Price (RAV): $${purchasePrice ? purchasePrice.toLocaleString() : 'N/A'}
  Warranty: ${warrantyStatus}
  Cost Center: ${asset.costCenter || asset.cost_center || 'N/A'}
  Department: ${asset.department || 'N/A'}

▸ WORK HISTORY SUMMARY:
  Total WOs: ${assetWOs.length} | Open: ${openWOs.length} | Completed: ${closedWOs.length}
  CM (Corrective): ${correctiveWOs.length} | PM (Preventive): ${preventiveWOs.length} | Inspection: ${inspectionWOs.length}
  PM:CM Ratio: ${pmCmRatio}% ${pmCmStatus}
  MTBF: ${actualMTBF ? actualMTBF.toLocaleString() + 'h' : 'No failures recorded'}
  ${oredaComparison}
  Total Downtime: ${totalDowntime}h
  Total Maintenance Cost: $${totalCost.toLocaleString()}
  Annualized Cost: $${annualizedCost.toLocaleString()}/yr
  Maintenance/RAV: ${ravPct}%${ravStatus}

▸ RECENT CORRECTIVE WORK (Last 5 CMs):
${cmDetailLines.length > 0 ? cmDetailLines.join('\n') : '    No corrective work orders recorded'}

▸ OPEN WORK:
${openWOLines.length > 0 ? openWOLines.join('\n') : '    No open work orders'}

▸ BOM (${bomItems.length} items):
${bomLines}

▸ HIERARCHY:
  Children: ${children.length} sub-assets${children.length > 0 ? ' (' + children.map((c: any) => c.tag).join(', ') + ')' : ''}
  Siblings: ${siblings.length} other items under ${parent?.tag || 'root'}${siblings.length > 0 ? ' (' + siblings.slice(0, 5).map((s: any) => s.tag).join(', ') + (siblings.length > 5 ? '...' : '') + ')' : ''}

▸ HEALTH & RELIABILITY:
  Health Score: ${asset.healthScore ?? asset.health_score ?? 'N/A'}/100

▸ FLEET SUMMARY:
  Total Assets in Registry: ${allAssets.length}
`;
    }

    // ─── Work Order Context ────────────────────────────────
    async buildWorkOrderContext(woId: string): Promise<string> {
        try {
            const [workOrders, assets] = await Promise.all([
                this.db.getWorkOrders() as Promise<any[]>,
                this.db.getAssets(),
            ]);

            const wo = workOrders.find(w => w.id === woId);
            if (!wo) return 'Work order not found.';

            const asset = assets.find(a => a.id === wo.assetId);

            const laborCost = (wo.labor || []).reduce((s: any, l: any) => s + ((l.estDuration || 0) * (l.estRate || 0)), 0);
            const partsCost = (wo.inventory || []).reduce((s: any, p: any) => s + ((p.estQty || 0) * (p.estUnitCost || 0)), 0);
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
${(wo.tasks || []).map((t: any) => `  ${t.sequence}. ${t.description} — Est: ${t.estHours}h — Status: ${t.status}`).join('\n') || '  No tasks'}

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
                this.db.getWorkOrders() as Promise<any[]>,
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
            const items = await (this.db as any).getInventoryItems?.() || await (this.db as any).getInventory?.() || [];

            if (itemId) {
                const item = items.find((i: any) => i.id === itemId);
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
${(item.stockLocations || []).map((l: any) => `  - ${l.storeName}: ${l.qtyOnHand} units in ${l.binLocation}`).join('\n') || '  No location data'}

▸ RECENT TRANSACTIONS:
${(item.transactions || []).slice(0, 5).map((t: any) => `  - ${t.date}: ${t.type} ${t.qtyChange > 0 ? '+' : ''}${t.qtyChange} → Balance: ${t.newBalance} (${t.reference || 'N/A'})`).join('\n') || '  No transactions'}
`;
            }

            // Fleet-level inventory summary
            const criticalItems = items.filter((i: any) => i.isCritical);
            const belowMin = items.filter((i: any) => (i.totalQtyOnHand || 0) <= (i.minLevel || 0));
            const stockouts = items.filter((i: any) => (i.totalQtyOnHand || 0) === 0 && i.isActive);
            const totalValue = items.reduce((s: any, i: any) => s + (i.itemCost || 0) * (i.totalQtyOnHand || 0), 0);

            return `═══ INVENTORY FLEET CONTEXT ═══
Total SKUs: ${items.length} | Active: ${items.filter((i: any) => i.isActive).length}
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
            const contacts = await this.db.getContacts() as any[];
            const personnel = contacts.filter((c: any) => c.contactType !== 'VENDOR' && c.contactType !== 'MANUFACTURER');
            const technicians = personnel.filter((c: any) => c.contactType === 'TECHNICIAN');
            const planners = personnel.filter((c: any) => c.contactType === 'PLANNER');
            const supervisors = personnel.filter((c: any) => c.contactType === 'SUPERVISOR');
            const engineers = personnel.filter((c: any) => c.contactType === 'RELIABILITY_ENG');

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
                (this.db as any).getServiceRequests?.() || [],
                this.db.getAssets(),
            ]);

            const sr = requests.find((r: any) => r.id === srId);
            if (!sr) return 'Service request not found.';

            const asset = assets.find((a: any) => a.id === sr.assetId);

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
