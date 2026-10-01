/**
 * FinOpsService - Financial Operations & Lifecycle Management
 * The "Financial Digital Twin" of physical assets
 * 
 * Integrates with: Assets, Work Orders, Inventory, Purchase Orders, Vendors
 * External-Ready: Uses standard interfaces for future ERP integration
 */

import { supabase } from '../lib/supabase';
import { mustWrite } from '../lib/supabaseWrite';
import { monthlyExpense, projectAnnual } from '../../lib/depreciation';
import { currentFiscalYear, currentFiscalPeriod, fiscalYearOf, fiscalYearStart, money, currencyCode } from '../../lib/fiscal';

// =====================================================
// TYPES
// =====================================================

export interface CostCenter {
    id: string;
    code: string;
    name: string;
    description?: string;
    parentId?: string;
    companyCode: string;
    controllingArea: string;
    profitCenter?: string;
    costCenterType: string;
    responsiblePersonId?: string;
    validFrom: string;
    validTo?: string;
    active: boolean;
    updated_at?: string;
}

export interface Budget {
    id: string;
    costCenterId?: string;
    wbsElementId?: string;
    fiscalYear: number;
    period: string;
    opexBudget: number;
    capexBudget: number;
    committed: number;
    actual: number;
    currency?: string;
    remaining?: number;
    status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
    monthlyData?: Record<string, { opex: number, capex: number }>;
}

export interface BudgetCheckResult {
    allowed: boolean;
    canProceed?: boolean;
    status?: string;
    blockType?: 'HARD' | 'SOFT' | 'WARN';
    message: string;
    availableBudget: number;
    requestedAmount: number;
    utilizationPct: number;
    overrideRequired: boolean;
    overrideRole?: string;
}

export interface MaintenanceForecast {
    id: string;
    code: string;
    title: string;
    assetId: string;
    annualFrequency: number;
    costPerEvent: number;
    annualEstimatedSpend: number;
    nextDueDate: string;
}

export interface AssetFinancial {
    id: string;
    assetId: string;
    assetClass?: string;
    acquisitionCost: number;                // Gross Asset Value (original + subsequent)
    originalAcquisitionCost: number;        // Immutable original purchase price
    subsequentCapitalizations: number;      // Sum of all capital events (IAS 16)
    acquisitionDate: string;
    capitalizationDate?: string;
    residualValue: number;
    usefulLifeMonths: number;
    replacementValue?: number;
    costCenterId?: string;
    downtimeCostPerHour?: number; // $/hr for downtime costing calculations
    warrantyStartDate?: string;
    warrantyEndDate?: string;
}

export interface DepreciationBook {
    id: string;
    assetFinancialId: string;
    bookType: 'CORPORATE' | 'TAX' | 'TECHNICAL' | 'IFRS';
    depreciationMethod: 'STRAIGHT_LINE' | 'DECLINING_BALANCE' | 'UNITS_OF_PRODUCTION' | 'SUM_OF_YEARS_DIGITS';
    currentValue: number;
    accumulatedDepreciation: number;
    startDate: string;
    usageBased: boolean;
    designedHours?: number; // Total estimated usage life
    currentHours?: number;  // Current usage to date
    /** last posted run (ISO); the projection continues from the month after it */
    lastDepreciationDate?: string | null;
    /** joined from the financial record by getAllDepreciationBooks */
    acquisitionCost?: number;
    residualValue?: number;
    usefulLifeMonths?: number;
    assetTag?: string;
    assetName?: string;
}

export interface DepreciationScheduleItem {
    period: number; // Year number (1, 2, 3...)
    fiscalYear: number;
    /** months depreciated in that fiscal year — 3 for an October start */
    months?: number;
    openingBookValue: number;
    depreciationExpense: number;
    accumulatedDepreciation: number;
    closingBookValue: number;
}

export interface Warranty {
    id: string;
    assetId: string;
    warrantyNumber?: string;
    /** The OEM standing behind an OEM warranty (0395). */
    manufacturerId?: string | null;
    /** The party a claim is filed with (distributor / EPC / service company). Required for EXTENDED and SERVICE_CONTRACT. */
    vendorId?: string | null;
    /** Display: vendor name, else manufacturer name (joined on read). */
    providerName?: string;
    manufacturerName?: string;
    vendorName?: string;
    warrantyType: 'OEM' | 'EXTENDED' | 'SERVICE_CONTRACT';
    coverageScope?: string;
    exclusions?: string | null;
    startDate: string;
    endDate?: string | null;
    maxHours?: number | null;
    currentHours: number;
    deductible?: number;
    warrantyValue?: number | null;
    reminderDays?: number;
    status: 'ACTIVE' | 'EXPIRED' | 'CLAIMED' | 'VOIDED';
}

export interface WarrantyCheckResult {
    underWarranty: boolean;
    warranty?: Warranty;
    allWarranties?: Warranty[];  // G8: All active warranties for multi-selection
    coverageType?: string;
    daysRemaining?: number;
    hoursRemaining?: number;
    recommendation: 'PURCHASE' | 'CLAIM' | 'REVIEW';
    message: string;
}

export interface WarrantyClaim {
    id: string;
    claimNumber: string;
    warrantyId: string;
    workOrderId?: string;
    claimDate: string;
    failureDescription: string;
    claimType: 'REPAIR' | 'REPLACEMENT' | 'CREDIT';
    // Cost breakdown
    partsClaimed?: { partId: string; partName: string; qty: number; cost: number }[];
    laborClaimed: number;
    totalClaimAmount: number;
    // Vendor response
    vendorReference?: string;
    vendorResponseDate?: string;
    approvedAmount?: number;
    rejectionReason?: string;
    // Status workflow
    status: 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'CREDITED';
    submittedBy?: string;
    submittedAt?: string;
    approvedBy?: string;
    approvedAt?: string;
    createdAt?: string;
    updatedAt?: string;
}

export interface AssetInsurance {
    id: string;
    assetId: string;
    policyNumber: string;
    provider: string;
    coverageType?: 'ALL_RISK' | 'FIRE' | 'THEFT' | 'LIABILITY';
    startDate: string;
    endDate: string;
    premiumAmount: number;
    insuredValue: number;
    deductible: number;
    /** days before coverage_end the nightly sweep raises INSURANCE_RENEWAL (0395) */
    renewalReminderDays?: number;
    status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
}

export interface InsuranceIncident {
    id: string;
    incidentNumber: string;
    assetId: string;
    insurancePolicyId?: string;
    workOrderId?: string;
    incidentDate: string;
    incidentType: 'BREAKDOWN' | 'FIRE' | 'ACCIDENT';
    description?: string;
    estimatedDamage: number;
    laborCost: number;
    materialCost: number;
    thirdPartyCost: number;
    totalCost: number;
    claimStatus: 'OPEN' | 'SUBMITTED' | 'SETTLED' | 'CLOSED';
    claimReference?: string | null;
    claimSubmittedDate?: string | null;
    claimAmount?: number | null;
    settlementAmount?: number | null;
    settlementDate?: string | null;
}

export interface CostAllocation {
    id: string;
    workOrderId: string;
    assetId?: string;
    /** invoice / PO / GRN reference — the only free text the ledger row keeps */
    documentNumber?: string;
    costCenterId?: string;
    wbsElementId?: string;
    costType: 'LABOR' | 'MATERIAL' | 'SERVICE' | 'OVERHEAD';
    amount: number;
    quantity?: number;
    unit?: string;
    postingDate: string;
    /** Who posted it (0244). Settlement only ever nets against WO_SETTLEMENT rows. */
    source?: 'MANUAL' | 'WO_SETTLEMENT' | 'WARRANTY_CREDIT' | 'ERP_INBOUND';
}

/**
 * FI-1 — where an order's actual cost has got to on its way to the books.
 * `unsettledVariance` is the money confirmed on the order that the ledger has
 * not yet been told about; on a finished order it is the finance backlog.
 */
export interface WorkOrderSettlement {
    workOrderId: string;
    woNumber?: string;
    woState: 'open' | 'done' | 'void' | 'unknown';
    actualCost: number;
    settledCost: number;
    unsettledVariance: number;
    lastSettledAt?: string;
}

export interface ThreeWayMatchResult {
    matched: boolean;
    status: 'MATCHED' | 'VARIANCE' | 'BLOCKED';
    poAmount: number;
    grnAmount: number;
    invoiceAmount: number;
    variance: number;
    variancePct: number;
    withinTolerance: boolean;
    blockReason?: string;
}

/** A PO row in the three-way match queue. Null amount = nothing received/invoiced yet. */
export interface SupplyChainMatch {
    id: string;
    poNumber: string;
    vendor: string;
    poAmount: number;
    grnAmount: number | null;
    invoiceAmount: number | null;
    status: 'MATCHED' | 'VARIANCE' | 'BLOCKED' | 'PENDING';
}

export interface CostAnomalyResult {
    isAnomaly: boolean;
    severity: 'LOW' | 'MEDIUM' | 'HIGH';
    historicalAvg: number;
    currentEstimate: number;
    variancePct: number;
    message: string;
}

export type CapitalEventType = 'MAJOR_OVERHAUL' | 'COMPONENT_REPLACEMENT' | 'UPGRADE' | 'LIFE_EXTENSION';

export interface AssetCapitalEvent {
    id?: string;
    assetFinancialId: string;
    assetId: string;
    eventType: CapitalEventType;
    capitalAmount: number;
    previousCarryingAmount: number;
    newCarryingAmount: number;
    previousUsefulLifeMonths: number;
    newUsefulLifeMonths: number;
    previousSalvageValue: number;
    newSalvageValue: number;
    effectiveDate: string;
    workOrderId?: string;
    workOrderNumber?: string;
    description: string;
    approvedBy?: string;
    createdAt?: string;
}

export interface RecapitalizationInput {
    assetId: string;
    eventType: CapitalEventType;
    capitalAmount: number;
    lifeExtensionMonths?: number; // Additional months to add to remaining life
    newSalvageValue?: number;     // Optional revised salvage
    effectiveDate: string;
    workOrderId?: string;
    workOrderNumber?: string;
    description: string;
    approvedBy?: string;
}

export interface RecapitalizationResult {
    success: boolean;
    message: string;
    event?: AssetCapitalEvent;
    updatedFinancial?: AssetFinancial;
    booksRecalculated: number;
}

// =====================================================
// FINOPS SERVICE
// =====================================================

class FinOpsServiceClass {
    private static instance: FinOpsServiceClass;

    private constructor() { }

    public static getInstance(): FinOpsServiceClass {
        if (!FinOpsServiceClass.instance) {
            FinOpsServiceClass.instance = new FinOpsServiceClass();
        }
        return FinOpsServiceClass.instance;
    }

    // =====================================================
    // 0. AGGREGATES & DASHBOARD
    // =====================================================

    async getDashboardMetrics(): Promise<any> {
        // In a real app, this would use efficiently crafted SQL views or RPCs
        const { count: warrantyCount } = await supabase.from('warranties').select('*', { count: 'exact', head: true }).eq('status', 'ACTIVE');
        const { count: claimsCount } = await supabase.from('warranty_claims').select('*', { count: 'exact', head: true }).eq('status', 'SUBMITTED');

        // Calculate Budget Utilization — THIS fiscal year, rejected budgets
        // excluded. The unfiltered version summed every year and every draft,
        // so the tile disagreed with the Budget Overview panel beside it.
        const fy = currentFiscalYear(); // tenant fiscal year (0396)
        const { data: budgets } = await supabase
            .from('budgets')
            .select('opex_budget, capex_budget, actual, committed, status')
            .eq('fiscal_year', fy)
            .neq('status', 'REJECTED');
        let totalBudget = 0;
        let totalUsed = 0;
        if (budgets) {
            budgets.forEach(b => {
                totalBudget += (Number(b.opex_budget) || 0) + (Number(b.capex_budget) || 0);
                totalUsed += (Number(b.actual) || 0) + (Number(b.committed) || 0);
            });
        }
        const budgetUtilization = totalBudget > 0 ? (totalUsed / totalBudget) * 100 : 0;

        // Warranties ending in the next 30 days — the landing's "needs attention"
        // line used to be the literal text "12 Warranties Expiring".
        const in30 = new Date(); in30.setDate(in30.getDate() + 30);
        const { count: expiringCount } = await supabase
            .from('warranties')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'ACTIVE')
            .gte('end_date', new Date().toISOString().split('T')[0])
            .lte('end_date', in30.toISOString().split('T')[0]);

        // Calculate Insurance Coverage
        const { data: policies } = await supabase.from('asset_insurance').select('insured_value').eq('status', 'ACTIVE');
        const insuranceCoverage = policies?.reduce((sum, p) => sum + (p.insured_value || 0), 0) || 0;

        // Depreciation MTD = schedule rows posted for the current fiscal period
        // (launch review B5 — this tile was a hard-coded zero). Fiscal period since 0396.
        const { data: mtdRows } = await supabase
            .from('depreciation_schedules')
            .select('depreciation_amount')
            .eq('fiscal_year', currentFiscalYear())
            .eq('period', currentFiscalPeriod());
        const depreciationMTD = (mtdRows || []).reduce((s, r: any) => s + (Number(r.depreciation_amount) || 0), 0);

        return {
            activeWarranties: warrantyCount || 0,
            pendingClaims: claimsCount || 0,
            budgetUtilization: budgetUtilization,
            depreciationMTD: depreciationMTD,
            expiringWarranties30: expiringCount || 0,
            insuranceCoverage: insuranceCoverage
        };
    }

    // =====================================================
    // 1. COST CENTER & BUDGET CONTROL
    // =====================================================

    /**
     * Create a new cost center
     */
    async createCostCenter(costCenter: Omit<CostCenter, 'id'>): Promise<CostCenter> {
        const { data, error } = await supabase
            .from('cost_centers')
            .insert({
                code: costCenter.code,
                name: costCenter.name,
                description: costCenter.description,
                parent_id: costCenter.parentId,
                company_code: costCenter.companyCode,
                controlling_area: costCenter.controllingArea,
                profit_center: costCenter.profitCenter,
                cost_center_type: costCenter.costCenterType,
                responsible_person_id: costCenter.responsiblePersonId,
                valid_from: costCenter.validFrom || new Date().toISOString(),
                valid_to: costCenter.validTo,
                active: costCenter.active
            })
            .select()
            .single();

        if (error) throw error;
        return this.mapCostCenter(data);
    }

    /**
     * Update an existing cost center
     */
    async updateCostCenter(id: string, updates: Partial<CostCenter>): Promise<CostCenter> {
        const dbUpdates: any = {};
        if (updates.code) dbUpdates.code = updates.code;
        if (updates.name) dbUpdates.name = updates.name;
        if (updates.description) dbUpdates.description = updates.description;
        if (updates.parentId) dbUpdates.parent_id = updates.parentId;
        if (updates.companyCode) dbUpdates.company_code = updates.companyCode;
        if (updates.controllingArea) dbUpdates.controlling_area = updates.controllingArea;
        if (updates.profitCenter) dbUpdates.profit_center = updates.profitCenter;
        if (updates.costCenterType) dbUpdates.cost_center_type = updates.costCenterType;
        if (updates.responsiblePersonId) dbUpdates.responsible_person_id = updates.responsiblePersonId;
        if (updates.validFrom) dbUpdates.valid_from = updates.validFrom;
        if (updates.validTo) dbUpdates.valid_to = updates.validTo;
        if (updates.active !== undefined) dbUpdates.active = updates.active;

        const { data, error } = await supabase
            .from('cost_centers')
            .update(dbUpdates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        return this.mapCostCenter(data);
    }

    /**
     * Delete (or soft delete) a cost center
     */
    async deleteCostCenter(id: string): Promise<void> {
        // Soft delete preferring active=false
        const { error } = await supabase
            .from('cost_centers')
            .update({ active: false })
            .eq('id', id);

        if (error) throw error;
    }

    /**
     * Get all cost centers (hierarchical)
     */
    async getCostCenters(includeInactive = false): Promise<CostCenter[]> {
        // Delete is a soft delete (active=false); without this filter a
        // deleted centre stayed in the grid and in every picker.
        let q = supabase.from('cost_centers').select('*').order('code');
        if (!includeInactive) q = q.eq('active', true);
        const { data, error } = await q;

        if (error) throw error;

        return (data || []).map(this.mapCostCenter);
    }

    /**
     * Get all budgets for a fiscal year with cost center details
     */
    async getAllBudgets(fiscalYear?: number): Promise<(Budget & { costCenterName: string; costCenterCode: string })[]> {
        const year = fiscalYear || currentFiscalYear();

        const { data, error } = await supabase
            .from('budgets')
            .select('*, cost_centers(name, code)')
            .eq('fiscal_year', year)
            .order('cost_center_id'); // Order by cost center roughly

        if (error) throw error;

        return (data || []).map(row => ({
            ...this.mapBudget(row),
            costCenterName: row.cost_centers?.name || 'Unknown',
            costCenterCode: row.cost_centers?.code || '???'
        }));
    }

    /**
     * Get recent financial transactions (allocations)
     */
    async getRecentTransactions(limit = 10): Promise<(CostAllocation & { workOrderCode?: string; description?: string })[]> {
        const { data, error } = await supabase
            .from('cost_allocations')
            .select('*, work_orders(wo_number, description)')
            .order('posting_date', { ascending: false })
            .limit(limit);

        if (error) throw error;

        return (data || []).map(row => ({
            ...this.mapCostAllocation(row),
            workOrderCode: row.work_orders?.wo_number,
            description: row.work_orders?.description
        }));
    }

    /**
     * Get budget for a cost center or WBS element
     */
    async getBudget(costCenterId?: string, wbsElementId?: string, fiscalYear?: number): Promise<Budget | null> {
        const year = fiscalYear || currentFiscalYear();

        let query = supabase.from('budgets').select('*').eq('fiscal_year', year);

        if (costCenterId) {
            query = query.eq('cost_center_id', costCenterId);
        } else if (wbsElementId) {
            query = query.eq('wbs_element_id', wbsElementId);
        }

        const { data, error } = await query.single();
        if (error && error.code !== 'PGRST116') throw error;

        return data ? this.mapBudget(data) : null;
    }

    /**
     * Set or update budget for a cost center
     */
    async upsertBudget(budgetData: {
        costCenterId: string;
        fiscalYear: number;
        opexBudget: number;
        capexBudget: number;
        status?: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
        monthlyData?: Record<string, { opex: number, capex: number }>;
    }): Promise<Budget> {
        // Check if exists
        const { data: existing } = await supabase
            .from('budgets')
            .select('id')
            .eq('cost_center_id', budgetData.costCenterId)
            .eq('fiscal_year', budgetData.fiscalYear)
            .single();

        if (existing) {
            const { data, error } = await supabase
                .from('budgets')
                .update({
                    opex_budget: budgetData.opexBudget,
                    capex_budget: budgetData.capexBudget,
                    ...(budgetData.status ? { status: budgetData.status } : {}),
                    ...(budgetData.monthlyData ? { monthly_data: budgetData.monthlyData } : {})
                })
                .eq('id', existing.id)
                .select()
                .single();

            if (error) throw error;
            return this.mapBudget(data);
        } else {
            const { data, error } = await supabase
                .from('budgets')
                .insert({
                    cost_center_id: budgetData.costCenterId,
                    fiscal_year: budgetData.fiscalYear,
                    period: 'YEAR', // Default to annual budget
                    opex_budget: budgetData.opexBudget,
                    capex_budget: budgetData.capexBudget,
                    status: budgetData.status || 'DRAFT',
                    monthly_data: budgetData.monthlyData || {},
                    committed: 0,
                    actual: 0,
                    currency: currencyCode() // the tenant's (Admin › Settings), was always USD
                })
                .select()
                .single();

            if (error) throw error;
            return this.mapBudget(data);
        }
    }

    /**
     * Update budget status (workflow transition)
     */
    async updateBudgetStatus(id: string, status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED'): Promise<void> {
        const { error } = await supabase
            .from('budgets')
            .update({ status })
            .eq('id', id);

        if (error) throw error;
    }

    /**
     * Check Budget Availability Control (AVC)
     * Returns whether the transaction can proceed
     */
    async checkBudgetAvailability(
        costCenterId: string,
        amount: number,
        costType: 'OPEX' | 'CAPEX' = 'OPEX'
    ): Promise<BudgetCheckResult> {
        const budget = await this.getBudget(costCenterId);

        if (!budget) {
            return {
                allowed: true,
                message: 'No budget defined - transaction allowed',
                availableBudget: 0,
                requestedAmount: amount,
                utilizationPct: 0,
                overrideRequired: false
            };
        }

        // Like for like: budgets.actual and .committed are TOTALS (the ledger
        // does not split OPEX from CAPEX), so they are measured against the
        // total plan. Comparing them to the OPEX line alone made CAPEX spend
        // eat OPEX headroom. costType is kept for callers; it no longer picks
        // a single line.
        void costType;
        const totalBudget = (budget.opexBudget || 0) + (budget.capexBudget || 0);
        const used = Math.max(0, (budget.committed || 0) + (budget.actual || 0));
        const available = totalBudget - used;
        const utilizationPct = totalBudget > 0 ? ((used + amount) / totalBudget) * 100 : 0;

        // Get budget blocks
        const { data: blocks } = await supabase
            .from('budget_blocks')
            .select('*')
            .eq('budget_id', budget.id)
            .eq('active', true)
            .order('threshold_pct', { ascending: false });

        // Check against thresholds
        for (const block of blocks || []) {
            if (utilizationPct >= block.threshold_pct) {
                if (block.block_type === 'HARD') {
                    return {
                        allowed: false,
                        blockType: 'HARD',
                        message: `BLOCKED: Budget would exceed ${block.threshold_pct}% threshold. Override required.`,
                        availableBudget: available,
                        requestedAmount: amount,
                        utilizationPct,
                        overrideRequired: true,
                        overrideRole: block.requires_override_role
                    };
                } else if (block.block_type === 'SOFT') {
                    return {
                        allowed: true,
                        blockType: 'SOFT',
                        message: `WARNING: Budget at ${utilizationPct.toFixed(1)}%. Approval recommended.`,
                        availableBudget: available,
                        requestedAmount: amount,
                        utilizationPct,
                        overrideRequired: false
                    };
                }
            }
        }

        return {
            allowed: true,
            message: `Budget available. Utilization: ${utilizationPct.toFixed(1)}%`,
            availableBudget: available,
            requestedAmount: amount,
            utilizationPct,
            overrideRequired: false
        };
    }

    /**
     * Allocate costs from a Work Order to a Cost Center
     */
    async allocateCost(allocation: Omit<CostAllocation, 'id'>): Promise<CostAllocation> {
        const { data, error } = await supabase
            .from('cost_allocations')
            .insert({
                work_order_id: allocation.workOrderId || null, // ad-hoc posting: '' is not a uuid
                cost_center_id: allocation.costCenterId,
                wbs_element_id: allocation.wbsElementId,
                cost_type: allocation.costType,
                amount: allocation.amount,
                quantity: allocation.quantity,
                unit: allocation.unit,
                posting_date: allocation.postingDate || new Date().toISOString().split('T')[0],
                document_number: allocation.documentNumber?.trim() || null,
                // Hand-typed. Settlement nets only against its own postings, so
                // this can never be mistaken for cost the ledger already has.
                source: 'MANUAL'
            })
            .select()
            .single();

        if (error) throw error;

        // Update budget actuals for the year the posting lands in — a
        // back-dated posting used to refresh only the current year.
        if (allocation.costCenterId) {
            // the FISCAL year the posting lands in (0396), not its calendar year
            const fy = allocation.postingDate ? fiscalYearOf(allocation.postingDate) : undefined;
            await this.updateBudgetActuals(allocation.costCenterId, fy);
        }

        return this.mapCostAllocation(data);
    }

    /**
     * FI-1 — post an order's actual cost to the ledger (SAP KO88).
     *
     * Normally the work_orders trigger does this the moment an order reaches a
     * finished state; this is the manual re-run for costs confirmed afterwards.
     * Posting is a delta, so calling it twice on unchanged actuals posts nothing.
     * Returns the postings it made — empty means "already settled".
     */
    async settleWorkOrder(workOrderId: string): Promise<{ costType: string; costCenterId?: string; amount: number }[]> {
        const { data, error } = await supabase.rpc('ers_settle_work_order', { p_wo_id: workOrderId });
        if (error) throw error;
        return (data || []).map((row: any) => ({
            costType: row.cost_type,
            costCenterId: row.cost_center_id || undefined,
            amount: parseFloat(row.delta_amount) || 0,
        }));
    }

    /**
     * Actual vs settled for one order. Null when 0244 has not been applied yet,
     * so callers can degrade to the plain cost roll-up instead of erroring.
     */
    async getWorkOrderSettlement(workOrderId: string): Promise<WorkOrderSettlement | null> {
        const { data, error } = await supabase
            .from('sem_wo_settlement')
            .select('*')
            .eq('work_order_id', workOrderId)
            .maybeSingle();

        if (error) {
            console.warn('[finops] settlement read failed (0244 applied?):', error.message);
            return null;
        }
        if (!data) return null;

        return {
            workOrderId: data.work_order_id,
            woNumber: data.wo_number || undefined,
            woState: data.wo_state,
            actualCost: parseFloat(data.actual_cost) || 0,
            settledCost: parseFloat(data.settled_cost) || 0,
            unsettledVariance: parseFloat(data.unsettled_variance) || 0,
            lastSettledAt: data.last_settled_at || undefined,
        };
    }

    /**
     * Get allocations for a specific work order
     */
    async getCostAllocations(workOrderId: string): Promise<CostAllocation[]> {
        const { data, error } = await supabase
            .from('cost_allocations')
            .select('*')
            .eq('work_order_id', workOrderId);

        if (error) throw error;
        return (data || []).map(this.mapCostAllocation);
    }

    /**
     * Get Maintenance Spend Forecast (from View)
     */
    async getMaintenanceForecasts(): Promise<MaintenanceForecast[]> {
        const { data, error } = await supabase
            .from('maintenance_forecasts')
            .select('*')
            .order('annual_estimated_spend', { ascending: false });

        if (error) throw error;

        return (data || []).map(row => ({
            id: row.id,
            code: row.code,
            title: row.title,
            assetId: row.asset_id,
            annualFrequency: parseFloat(row.annual_frequency),
            costPerEvent: parseFloat(row.cost_per_event),
            annualEstimatedSpend: parseFloat(row.annual_estimated_spend),
            nextDueDate: row.next_due_date
        }));
    }

    /**
     * AI Feature: Detect cost anomalies (Cost Drift)
     */
    async detectCostAnomaly(
        assetId: string,
        workType: string,
        estimatedCost: number
    ): Promise<CostAnomalyResult> {
        // Get historical costs for similar work on this asset
        const { data: historicalWOs } = await supabase
            .from('work_orders')
            .select('id, total_actual_cost')
            .eq('asset_id', assetId)
            .eq('type', workType)
            .eq('status', 'CLOSED')
            .not('total_actual_cost', 'is', null)
            .order('closed_at', { ascending: false })
            .limit(10);

        if (!historicalWOs || historicalWOs.length < 3) {
            return {
                isAnomaly: false,
                severity: 'LOW',
                historicalAvg: 0,
                currentEstimate: estimatedCost,
                variancePct: 0,
                message: 'Insufficient historical data for anomaly detection'
            };
        }

        const costs = historicalWOs.map(wo => Number(wo.total_actual_cost) || 0);
        const avg = costs.reduce((a, b) => a + b, 0) / costs.length;
        const variance = ((estimatedCost - avg) / avg) * 100;

        let severity: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
        let isAnomaly = false;

        if (Math.abs(variance) > 100) {
            severity = 'HIGH';
            isAnomaly = true;
        } else if (Math.abs(variance) > 50) {
            severity = 'MEDIUM';
            isAnomaly = true;
        }

        return {
            isAnomaly,
            severity,
            historicalAvg: avg,
            currentEstimate: estimatedCost,
            variancePct: variance,
            message: isAnomaly
                ? `ALERT: Estimated cost ${money(estimatedCost, { decimals: 2 })} is ${variance > 0 ? 'above' : 'below'} historical average (${money(avg, { decimals: 2 })}) by ${Math.abs(variance).toFixed(0)}%`
                : `Cost estimate within normal range (Avg: ${money(avg, { decimals: 2 })})`
        };
    }

    // =====================================================
    // 2. ASSET ACCOUNTING & DEPRECIATION
    // =====================================================

    /**
     * Get all depreciation books for summary
     */
    async getAllDepreciationBooks(): Promise<DepreciationBook[]> {
        // With the financial record, so the page can project a real month's
        // expense (it used to show currentValue × 2 % and call it an estimate).
        const { data, error } = await supabase
            .from('depreciation_books')
            .select('*, asset_financials(acquisition_cost, residual_value, useful_life_months, assets(tag, name))')
            .range(0, 1999);

        if (error) throw error;
        return (data || []).map((row: any) => ({
            ...this.mapDepreciationBook(row),
            acquisitionCost: Number(row.asset_financials?.acquisition_cost) || 0,
            residualValue: Number(row.asset_financials?.residual_value) || 0,
            usefulLifeMonths: Number(row.asset_financials?.useful_life_months) || 0,
            assetTag: row.asset_financials?.assets?.tag,
            assetName: row.asset_financials?.assets?.name,
        }));
    }

    /**
     * Get asset financial record
     */
    async getAssetFinancial(assetId: string): Promise<AssetFinancial | null> {
        const { data, error } = await supabase
            .from('asset_financials')
            .select('*')
            .eq('asset_id', assetId)
            .maybeSingle();

        if (error) throw error;
        return data ? this.mapAssetFinancial(data) : null;
    }

    /**
     * Get asset financial record by ID
     */
    async getAssetFinancialById(id: string): Promise<AssetFinancial | null> {
        const { data, error } = await supabase
            .from('asset_financials')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (error) throw error;
        return data ? this.mapAssetFinancial(data) : null;
    }

    /**
     * Update asset financial record
     */
    async updateAssetFinancial(assetFinancialId: string, updates: Partial<AssetFinancial>): Promise<AssetFinancial> {
        const dbUpdates: Record<string, any> = {};

        if (updates.downtimeCostPerHour !== undefined) {
            dbUpdates.downtime_cost_per_hour = updates.downtimeCostPerHour;
        }
        if (updates.acquisitionCost !== undefined) {
            dbUpdates.acquisition_cost = updates.acquisitionCost;
        }
        if (updates.residualValue !== undefined) {
            dbUpdates.residual_value = updates.residualValue;
        }
        if (updates.usefulLifeMonths !== undefined) {
            dbUpdates.useful_life_months = updates.usefulLifeMonths;
        }
        if (updates.replacementValue !== undefined) {
            dbUpdates.replacement_value = updates.replacementValue;
        }
        if (updates.warrantyStartDate !== undefined) {
            dbUpdates.warranty_start_date = updates.warrantyStartDate;
        }
        if (updates.warrantyEndDate !== undefined) {
            dbUpdates.warranty_end_date = updates.warrantyEndDate;
        }

        dbUpdates.updated_at = new Date().toISOString();

        const { data, error } = await supabase
            .from('asset_financials')
            .update(dbUpdates)
            .eq('id', assetFinancialId)
            .select()
            .single();

        if (error) throw error;
        return this.mapAssetFinancial(data);
    }

    /**
     * Create asset financial record if it doesn't exist
     */
    async createAssetFinancial(assetId: string, financialData: Partial<AssetFinancial>): Promise<AssetFinancial> {
        const acqCost = financialData.acquisitionCost || 0;
        const { data, error } = await supabase
            .from('asset_financials')
            .insert({
                asset_id: assetId,
                acquisition_cost: acqCost,
                original_acquisition_cost: acqCost,  // Lock in original on first creation
                subsequent_capitalizations: 0,
                acquisition_date: financialData.acquisitionDate || new Date().toISOString().split('T')[0],
                // Was never written — Overview showed "N/A" for every asset.
                capitalization_date: financialData.capitalizationDate || financialData.acquisitionDate || new Date().toISOString().split('T')[0],
                residual_value: financialData.residualValue || 0,
                useful_life_months: financialData.usefulLifeMonths || 120,
                downtime_cost_per_hour: financialData.downtimeCostPerHour || 0,
                replacement_value: financialData.replacementValue,
                warranty_start_date: financialData.warrantyStartDate,
                warranty_end_date: financialData.warrantyEndDate
            })
            .select()
            .single();

        if (error) throw error;
        return this.mapAssetFinancial(data);
    }

    /**
     * Delete asset financial record (decapitalize / reset)
     * This will cascade-delete related depreciation books via FK constraints.
     */
    async deleteAssetFinancial(assetFinancialId: string): Promise<void> {
        // Delete depreciation books first (in case no FK cascade)
        const { error: booksError } = await supabase
            .from('depreciation_books')
            .delete()
            .eq('asset_financial_id', assetFinancialId);
        if (booksError) console.warn('Error clearing depreciation books:', booksError);

        // Delete the financial record
        const { error } = await supabase
            .from('asset_financials')
            .delete()
            .eq('id', assetFinancialId);
        if (error) throw error;
    }

    /**
     * Get depreciation books for an asset
     */
    async getDepreciationBooks(assetFinancialId: string): Promise<DepreciationBook[]> {
        const { data, error } = await supabase
            .from('depreciation_books')
            .select('*')
            .eq('asset_financial_id', assetFinancialId);

        if (error) throw error;
        return (data || []).map(this.mapDepreciationBook);
    }

    /**
     * Create depreciation book
     */
    async createDepreciationBook(bookData: Partial<DepreciationBook>): Promise<DepreciationBook> {
        // 1. Create the Book
        const { data: book, error } = await supabase
            .from('depreciation_books')
            .insert({
                asset_financial_id: bookData.assetFinancialId,
                book_type: bookData.bookType,
                depreciation_method: bookData.depreciationMethod,
                current_value: bookData.currentValue,
                accumulated_depreciation: bookData.accumulatedDepreciation || 0,
                start_date: bookData.startDate,
                usage_based: bookData.usageBased || false,
                designed_hours: bookData.designedHours,
                current_hours: bookData.currentHours || 0
            })
            .select()
            .single();

        if (error) throw error;
        // The projected schedule is NOT persisted: depreciation_schedules holds
        // posted monthly runs (unique per book/year/period since 0394) and the
        // annual projection is pure — calculateDepreciationSchedule() renders
        // it from the book on demand. The old insert here named a column the
        // table never had and failed on every book.
        return this.mapDepreciationBook(book);
    }

    /**
     * Re-derive a book's accumulated depreciation and carrying value from its
     * POSTED schedule rows. The ledger is the source of truth; the book is a
     * cache of it. (The previous "increment" write assigned a query builder to
     * the column and never moved it — 0394 backfilled every book this way.)
     */
    async refreshBookFromLedger(bookId: string): Promise<{ accumulated: number; currentValue: number }> {
        const { data: book, error: bookErr } = await supabase
            .from('depreciation_books')
            .select('id, asset_financials(acquisition_cost, residual_value)')
            .eq('id', bookId)
            .single();
        if (bookErr) throw bookErr;
        const fin: any = book?.asset_financials;

        const { data: rows, error: rowsErr } = await supabase
            .from('depreciation_schedules')
            .select('depreciation_amount, run_date, created_at')
            .eq('book_id', bookId)
            .eq('posted', true);
        if (rowsErr) throw rowsErr;

        const accumulated = (rows || []).reduce((s, r: any) => s + (parseFloat(r.depreciation_amount) || 0), 0);
        const cost = parseFloat(fin?.acquisition_cost || 0);
        const residual = parseFloat(fin?.residual_value || 0);
        const currentValue = Math.max(cost - accumulated, residual);
        const lastRun = (rows || []).reduce<string | null>((m, r: any) => {
            const d = r.run_date || r.created_at;
            return d && (!m || d > m) ? d : m;
        }, null);

        await mustWrite(
            supabase.from('depreciation_books').update({
                accumulated_depreciation: accumulated,
                current_value: currentValue,
                last_depreciation_date: lastRun,
                updated_at: new Date().toISOString(),
            }).eq('id', bookId),
            `Depreciation book ${bookId} carrying value`,
        );
        return { accumulated, currentValue };
    }

    /**
     * Update depreciation book
     */
    async updateDepreciationBook(bookId: string, updates: Partial<DepreciationBook>): Promise<DepreciationBook> {
        const dbUpdates: Record<string, any> = {};

        if (updates.currentValue !== undefined) {
            dbUpdates.current_value = updates.currentValue;
        }
        // Add other fields as needed

        dbUpdates.last_depreciation_date = new Date().toISOString();

        const { data, error } = await supabase
            .from('depreciation_books')
            .update(dbUpdates)
            .eq('id', bookId)
            .select()
            .single();

        if (error) throw error;
        return this.mapDepreciationBook(data);
    }

    /**
     * Delete a depreciation book (and its schedules via CASCADE)
     */
    async deleteDepreciationBook(bookId: string): Promise<void> {
        // Delete schedule entries first (in case CASCADE isn't set up in all envs)
        await supabase
            .from('depreciation_schedules')
            .delete()
            .eq('book_id', bookId);

        const { error } = await supabase
            .from('depreciation_books')
            .delete()
            .eq('id', bookId);

        if (error) throw error;
    }

    /**
     * Calculate depreciation for a period
     */
    async calculateDepreciation(bookId: string): Promise<{ amount: number; newValue: number }> {
        const { data: book } = await supabase
            .from('depreciation_books')
            .select('*, asset_financials(*)')
            .eq('id', bookId)
            .single();

        if (!book) throw new Error('Depreciation book not found');

        const financial = book.asset_financials;

        // One engine for posting and projection (lib/depreciation): the month's
        // expense from the CURRENT carrying value over the REMAINING life. That
        // is what makes a capital event spread over the life left, and what
        // makes double-declining reach salvage instead of repeating the same
        // amount forever (the old code never updated current_value, so it did).
        const { count } = await supabase
            .from('depreciation_schedules')
            .select('id', { count: 'exact', head: true })
            .eq('book_id', bookId)
            .eq('posted', true);
        const postedMonths = count || 0;
        const lifeMonths = Math.max(1, parseInt(financial.useful_life_months) || 1);
        const remainingMonths = Math.max(0, lifeMonths - postedMonths);
        const bookValue = parseFloat(book.current_value) || 0;
        const salvage = parseFloat(financial.residual_value) || 0;

        const amount = monthlyExpense({
            method: book.depreciation_method,
            bookValue,
            salvage,
            lifeMonths,
            remainingMonths,
        });
        const newValue = Math.round((bookValue - amount) * 100) / 100;

        return { amount, newValue };
    }

    /**
     * Run depreciation for all books of a specific type
     */
    async runMonthlyDepreciation(bookType: string, fiscalYear: number, period: number): Promise<{ posted: number; skipped: number }> {
        const { data: books } = await supabase
            .from('depreciation_books')
            .select('id')
            .eq('book_type', bookType);

        // Idempotent per book/period: a second click must not post twice. The
        // unique index (0394) is the real guard; this read keeps the count honest.
        const ids = (books || []).map(b => b.id);
        const { data: done } = ids.length
            ? await supabase.from('depreciation_schedules').select('book_id').in('book_id', ids).eq('fiscal_year', fiscalYear).eq('period', period)
            : { data: [] as any[] };
        const alreadyPosted = new Set((done || []).map((d: any) => d.book_id));

        let processedCount = 0;
        let skipped = 0;

        for (const book of books || []) {
            if (alreadyPosted.has(book.id)) { skipped++; continue; }
            const { amount, newValue } = await this.calculateDepreciation(book.id);

            // Insert schedule entry. processedCount is reported to the user as
            // "N books depreciated", so an unchecked write here would count a
            // book that gained no schedule row and no new carrying value.
            await mustWrite(
                supabase.from('depreciation_schedules').insert({
                    book_id: book.id,
                    fiscal_year: fiscalYear,
                    period: period,
                    depreciation_amount: amount,
                    opening_value: newValue + amount,
                    closing_value: newValue,
                    posted: true,
                    run_date: new Date().toISOString(),
                }),
                `Depreciation schedule for book ${book.id} (${fiscalYear}/${period})`,
            );

            // The book follows its ledger: accumulated = Σ posted rows, carrying
            // value = cost − accumulated (floored at residual). Checked write.
            await this.refreshBookFromLedger(book.id);

            processedCount++;
        }

        return { posted: processedCount, skipped };
    }

    // =====================================================
    // CAPITAL EVENT / RECAPITALIZATION (IAS 16)
    // =====================================================

    /**
     * Record a capital event (overhaul, component replacement, upgrade) that extends asset life.
     * IAS 16 Treatment: Subsequent expenditure is capitalized when it increases the asset's
     * future economic benefits beyond its previously assessed standard of performance.
     *
     * Steps:
     * 1. Update asset_financials: new carrying amount, extended useful life
     * 2. Regenerate depreciation schedules for ALL books on this asset
     * 3. Log the capital event for audit trail
     */
    async recapitalizeAsset(input: RecapitalizationInput): Promise<RecapitalizationResult> {
        try {
            // 1. Get current financial record
            const financial = await this.getAssetFinancial(input.assetId);
            if (!financial) {
                return { success: false, message: 'Asset has no financial record. Capitalize the asset first.', booksRecalculated: 0 };
            }

            if (input.capitalAmount <= 0) {
                return { success: false, message: 'Capital amount must be greater than zero.', booksRecalculated: 0 };
            }

            // 2. Calculate new values (IAS 16: preserve original, track subsequent separately)
            const previousCarrying = financial.acquisitionCost; // Current GAV
            const newSubsequent = (financial.subsequentCapitalizations || 0) + input.capitalAmount;
            const newGAV = financial.originalAcquisitionCost + newSubsequent;
            const newLifeMonths = input.lifeExtensionMonths
                ? financial.usefulLifeMonths + input.lifeExtensionMonths
                : financial.usefulLifeMonths;
            const newSalvage = input.newSalvageValue !== undefined
                ? input.newSalvageValue
                : financial.residualValue;

            // 3. Update asset_financials record (original_acquisition_cost remains immutable)
            const { data: updatedFin, error: finError } = await supabase
                .from('asset_financials')
                .update({
                    acquisition_cost: newGAV,                       // GAV = original + all subsequent
                    subsequent_capitalizations: newSubsequent,       // Running total of capitalizations
                    useful_life_months: newLifeMonths,
                    residual_value: newSalvage,
                    updated_at: new Date().toISOString()
                })
                .eq('id', financial.id)
                .select()
                .single();

            if (finError) throw finError;

            const updatedFinancial = this.mapAssetFinancial(updatedFin);

            // 4. Log the capital event
            const capitalEvent: Omit<AssetCapitalEvent, 'id' | 'createdAt'> = {
                assetFinancialId: financial.id,
                assetId: input.assetId,
                eventType: input.eventType,
                capitalAmount: input.capitalAmount,
                previousCarryingAmount: previousCarrying,
                newCarryingAmount: newGAV,
                previousUsefulLifeMonths: financial.usefulLifeMonths,
                newUsefulLifeMonths: newLifeMonths,
                previousSalvageValue: financial.residualValue,
                newSalvageValue: newSalvage,
                effectiveDate: input.effectiveDate,
                workOrderId: input.workOrderId,
                workOrderNumber: input.workOrderNumber,
                description: input.description,
                approvedBy: input.approvedBy
            };

            // The capital event IS the audit record of this change: a failed
            // insert is a failed recapitalisation, not a warning.
            {
                const { error: evErr } = await supabase.from('capital_events').insert({
                    asset_financial_id: capitalEvent.assetFinancialId,
                    asset_id: capitalEvent.assetId,
                    event_type: capitalEvent.eventType,
                    capital_amount: capitalEvent.capitalAmount,
                    previous_carrying_amount: capitalEvent.previousCarryingAmount,
                    new_carrying_amount: capitalEvent.newCarryingAmount,
                    previous_useful_life_months: capitalEvent.previousUsefulLifeMonths,
                    new_useful_life_months: capitalEvent.newUsefulLifeMonths,
                    previous_salvage_value: capitalEvent.previousSalvageValue,
                    new_salvage_value: capitalEvent.newSalvageValue,
                    effective_date: capitalEvent.effectiveDate,
                    work_order_id: capitalEvent.workOrderId,
                    work_order_number: capitalEvent.workOrderNumber,
                    description: capitalEvent.description,
                    approved_by: capitalEvent.approvedBy
                });
                if (evErr) throw evErr;
            }

            // 5. Every book's carrying value follows the new gross value minus the
            // depreciation actually POSTED so far (re-derived from the ledger, not
            // read off the book). Posted history is never touched: the previous
            // version deleted every schedule row here, then failed to write the
            // projection back, and reported success — a capital event wiped the
            // asset's depreciation history. Projections are not stored at all now.
            const books = await this.getDepreciationBooks(financial.id);
            let booksRecalculated = 0;
            const failures: string[] = [];

            for (const book of books) {
                try {
                    await this.refreshBookFromLedger(book.id);
                    booksRecalculated++;
                } catch (bookErr: any) {
                    console.error(`Failed to re-derive book ${book.id}:`, bookErr);
                    failures.push(`${book.bookType}: ${bookErr?.message || bookErr}`);
                }
            }

            if (failures.length) {
                return {
                    success: false,
                    message: `Capital event recorded, but ${failures.length} depreciation book(s) could not be re-derived — ${failures.join('; ')}`,
                    booksRecalculated,
                    updatedFinancial,
                    event: capitalEvent as AssetCapitalEvent,
                };
            }

            return {
                success: true,
                message: `Capital event recorded. Carrying amount: ${money(previousCarrying)} → ${money(newGAV)}. ` +
                    `Life: ${financial.usefulLifeMonths}mo → ${newLifeMonths}mo. ${booksRecalculated} depreciation book(s) recalculated.`,
                event: capitalEvent as AssetCapitalEvent,
                updatedFinancial,
                booksRecalculated
            };
        } catch (err: any) {
            console.error('[FinOpsService.recapitalizeAsset] Failed:', err);
            return { success: false, message: err.message || 'Recapitalization failed', booksRecalculated: 0 };
        }
    }

    /**
     * Get capital events history for an asset
     */
    async getCapitalEvents(assetId: string): Promise<AssetCapitalEvent[]> {
        try {
            const { data, error } = await supabase
                .from('capital_events')
                .select('*')
                .eq('asset_id', assetId)
                .order('effective_date', { ascending: false });

            if (error) throw error;
            return (data || []).map((row: any) => ({
                id: row.id,
                assetFinancialId: row.asset_financial_id,
                assetId: row.asset_id,
                eventType: row.event_type,
                capitalAmount: row.capital_amount,
                previousCarryingAmount: row.previous_carrying_amount,
                newCarryingAmount: row.new_carrying_amount,
                previousUsefulLifeMonths: row.previous_useful_life_months,
                newUsefulLifeMonths: row.new_useful_life_months,
                previousSalvageValue: row.previous_salvage_value,
                newSalvageValue: row.new_salvage_value,
                effectiveDate: row.effective_date,
                workOrderId: row.work_order_id,
                workOrderNumber: row.work_order_number,
                description: row.description,
                approvedBy: row.approved_by,
                createdAt: row.created_at
            }));
        } catch (err) {
            console.warn('Capital events not available:', err);
            return [];
        }
    }

    /**
     * Get fleet depreciation summary aggregated by Cost Center
     */
    async getFleetDepreciationSummary(fiscalYear: number): Promise<any[]> {
        // Deep join to get Cost Center from Asset
        const { data, error } = await supabase
            .from('depreciation_schedules')
            .select(`
                period,
                depreciation_amount,
                depreciation_books!inner (
                    book_type,
                    asset_financials!inner (
                        asset_id,
                        assets!inner (
                            cost_center_id,
                            cost_centers ( code, name )
                        )
                    )
                )
            `)
            .eq('fiscal_year', fiscalYear)
            .eq('depreciation_books.book_type', 'CORPORATE'); // Only summarise Corporate book for FinOps

        if (error) throw error;

        // Aggregate in JS, keyed by cost-centre ID (the page looked the row up
        // by id while this keyed by NAME, so the code line was always blank).
        const resultMap = new Map<string, any>();

        data.forEach((row: any) => {
            const assetRow = row.depreciation_books?.asset_financials?.assets;
            const key = assetRow?.cost_center_id || 'unassigned';
            const costCenter = assetRow?.cost_centers?.name || 'Unassigned';
            const code = assetRow?.cost_centers?.code || '';
            const period = row.period;
            const amount = Number(row.depreciation_amount) || 0;

            if (!resultMap.has(key)) {
                resultMap.set(key, {
                    costCenterId: key,
                    costCenter,
                    code,
                    total: 0,
                    monthly: {}
                });
            }

            const entry = resultMap.get(key);
            entry.monthly[period] = (entry.monthly[period] || 0) + amount;
            entry.total += amount;
        });

        return Array.from(resultMap.values()).sort((a, b) => b.total - a.total);
    }

    /**
     * Get depreciation schedule for reporting
     */
    async getDepreciationSchedule(fiscalYear: number): Promise<any[]> {
        const { data, error } = await supabase
            .from('depreciation_schedules')
            .select('*, depreciation_books(book_type, asset_financials(asset_id))')
            .eq('fiscal_year', fiscalYear)
            .order('period', { ascending: true });

        if (error) throw error;

        // This query might be heavy, in real app consider pagination or filtering by book
        return (data || []).map(row => ({
            id: row.id,
            bookId: row.book_id,
            fiscalYear: row.fiscal_year,
            period: row.period,
            amount: parseFloat(row.depreciation_amount),
            openingValue: parseFloat(row.opening_value),
            closingValue: parseFloat(row.closing_value),
            posted: row.posted === true,
            bookType: row.depreciation_books?.book_type
        }));
    }

    // =====================================================
    // 3. WARRANTY & CLAIMS INTELLIGENCE
    // =====================================================

    /**
     * Get all active warranties for the dashboard list
     */
    async getAllWarranties(): Promise<Warranty[]> {
        const { data, error } = await supabase
            .from('warranties')
            .select('*, assets(name, tag), vendors(name), manufacturers(name)') // Join for display info
            .eq('status', 'ACTIVE')
            .order('end_date', { ascending: true });

        if (error) throw error;
        // Map and enrich
        return (data || []).map(row => ({
            ...this.mapWarranty(row),
            assetName: row.assets?.name,
            assetTag: row.assets?.tag
        }));
    }

    async getAllClaims(): Promise<WarrantyClaim[]> {
        const { data, error } = await supabase
            .from('warranty_claims')
            .select('*, work_orders(asset_id, asset:assets(name)), warranties(assets(name))')
            .order('claim_date', { ascending: false })
            .range(0, 1999);

        if (error) throw error;
        return (data || []).map(row => ({
            ...this.mapWarrantyClaim(row),
            // a manual claim has no WO — fall back through the warranty's asset
            assetName: row.work_orders?.asset?.name || row.warranties?.assets?.name
        }));
    }

    async getAllInsurancePolicies(): Promise<any[]> {
        const { data, error } = await supabase
            .from('asset_insurance')
            .select('*, assets(name, tag)')
            .eq('status', 'ACTIVE');

        if (error) throw error;
        return (data || []).map(row => ({
            ...row,
            assetName: row.assets?.name
        }));
    }

    /**
     * Get warranties for an asset
     */
    async getWarranties(assetId: string): Promise<Warranty[]> {
        const { data, error } = await supabase
            .from('warranties')
            .select('*, vendors(name), manufacturers(name)')
            .eq('asset_id', assetId)
            .order('end_date', { ascending: false });

        if (error) throw error;
        return (data || []).map(r => this.mapWarranty(r));
    }

    async addWarranty(warranty: Omit<Warranty, 'id'>): Promise<Warranty> {
        const { data, error } = await supabase
            .from('warranties')
            .insert({
                asset_id: warranty.assetId,
                warranty_number: warranty.warrantyNumber?.trim() || null,
                manufacturer_id: warranty.manufacturerId || null,
                vendor_id: warranty.vendorId || null, // Convert "" to null
                warranty_type: warranty.warrantyType,
                coverage_scope: warranty.coverageScope || null,
                exclusions: warranty.exclusions || null,
                start_date: warranty.startDate,
                end_date: warranty.endDate || null,
                max_hours: warranty.maxHours ?? null,
                current_hours: warranty.currentHours || 0,
                deductible: warranty.deductible ?? 0,
                warranty_value: warranty.warrantyValue ?? null,
                reminder_days: warranty.reminderDays ?? 30,
                status: warranty.status || 'ACTIVE'
            })
            .select()
            .single();

        if (error) throw error;
        return this.mapWarranty(data);
    }

    /**
     * Update warranty
     */
    async updateWarranty(id: string, updates: Partial<Warranty>): Promise<Warranty> {
        // Presence, not truthiness: a field the caller SENDS as empty is being
        // cleared. The truthy checks here meant a coverage scope, end date or
        // hour limit could never be removed once set.
        const has = (k: keyof Warranty) => Object.prototype.hasOwnProperty.call(updates, k);
        const dbUpdates: any = {};
        if (updates.assetId) dbUpdates.asset_id = updates.assetId;
        if (has('vendorId')) dbUpdates.vendor_id = updates.vendorId || null;
        if (has('manufacturerId')) dbUpdates.manufacturer_id = updates.manufacturerId || null;
        if (has('warrantyNumber')) dbUpdates.warranty_number = updates.warrantyNumber?.trim() || null;
        if (updates.warrantyType) dbUpdates.warranty_type = updates.warrantyType;
        if (has('coverageScope')) dbUpdates.coverage_scope = updates.coverageScope || null;
        if (has('exclusions')) dbUpdates.exclusions = updates.exclusions || null;
        if (updates.startDate) dbUpdates.start_date = updates.startDate;
        if (has('endDate')) dbUpdates.end_date = updates.endDate || null;
        if (has('maxHours')) dbUpdates.max_hours = updates.maxHours ?? null;
        if (has('currentHours') && updates.currentHours !== undefined) dbUpdates.current_hours = updates.currentHours;
        if (has('deductible')) dbUpdates.deductible = updates.deductible ?? 0;
        if (has('warrantyValue')) dbUpdates.warranty_value = updates.warrantyValue ?? null;
        if (has('reminderDays')) dbUpdates.reminder_days = updates.reminderDays ?? 30;
        if (updates.status) dbUpdates.status = updates.status;
        if (dbUpdates.start_date && dbUpdates.end_date && dbUpdates.end_date < dbUpdates.start_date) {
            throw new Error('End date is before the start date.');
        }
        dbUpdates.updated_at = new Date().toISOString();

        const { data, error } = await supabase
            .from('warranties')
            .update(dbUpdates)
            .eq('id', id)
            .select('*, vendors(name), manufacturers(name)')
            .single();

        if (error) throw error;
        return this.mapWarranty(data);
    }

    /**
     * Delete a warranty
     */
    async deleteWarranty(warrantyId: string): Promise<void> {
        const { error } = await supabase
            .from('warranties')
            .delete()
            .eq('id', warrantyId);

        if (error) throw error;
    }

    /**
     * Alias: create warranty with split args
     */
    async createWarranty(assetId: string, warrantyData: Partial<Warranty>): Promise<Warranty> {
        // The date is NOT NULL in the table and the modal now requires it;
        // defaulting silently to today was how backdated warranties got the
        // wrong start.
        if (!warrantyData.startDate) throw new Error('Start date is required.');
        if (warrantyData.endDate && warrantyData.endDate < warrantyData.startDate) throw new Error('End date is before the start date.');
        const type = warrantyData.warrantyType || 'OEM';
        if (type !== 'OEM' && !warrantyData.vendorId) throw new Error(`${type === 'EXTENDED' ? 'An extended warranty' : 'A service contract'} needs the vendor it is with.`);
        return this.addWarranty({
            ...warrantyData,
            assetId,
            warrantyType: type,
            startDate: warrantyData.startDate,
            currentHours: warrantyData.currentHours || 0,
            status: warrantyData.status || 'ACTIVE'
        } as Omit<Warranty, 'id'>);
    }

    /**
     * Alias: get warranties scoped to a single asset
     */
    async getWarrantiesForAsset(assetId: string): Promise<Warranty[]> {
        return this.getWarranties(assetId);
    }

    /**
     * Get light-weight asset list for picker
     */
    async getAssetsForPicker(): Promise<{ id: string; name: string; tag: string; manufacturerId?: string | null; manufacturer?: string | null }[]> {
        const { data, error } = await supabase
            .from('assets')
            .select('id, name, tag, manufacturer_id, manufacturer')
            .order('name');

        if (error) throw error;
        return (data || []).map((a: any) => ({ id: a.id, name: a.name, tag: a.tag, manufacturerId: a.manufacturer_id ?? null, manufacturer: a.manufacturer ?? null }));
    }

    /** Manufacturer master for the warranty picker (name-sorted, active only). */
    async getManufacturersForPicker(): Promise<{ id: string; name: string }[]> {
        const { data, error } = await supabase
            .from('manufacturers')
            .select('id, name')
            .eq('active', true)
            .order('name');
        if (error) { console.warn('Could not fetch manufacturers:', error.message); return []; }
        return data || [];
    }


    /**
     * Get vendor list for picker
     */
    async getVendorsForPicker(): Promise<{ id: string; name: string }[]> {
        // vendors table might not exist in all environments yet, handle gracefully
        try {
            const { data, error } = await supabase
                .from('vendors')
                .select('id, name')
                .eq('active', true)
                .order('name');

            if (error) {
                // Return empty if table doesn't exist or other error
                console.warn('Could not fetch vendors:', error.message);
                return [];
            }
            return data || [];
        } catch (e) {
            return [];
        }
    }


    // =====================================================
    // DEPRECIATION ENGINE
    // =====================================================

    /**
     * Calculates the full depreciation schedule for an asset based on its financial record and chosen method.
     * @param book The depreciation book configuration
     * @param financial The asset financial details (cost, salvage, life)
     * @returns Array of schedule items (one per year)
     */
    calculateDepreciationSchedule(book: DepreciationBook, financial: AssetFinancial): DepreciationScheduleItem[] {
        // Monthly engine aggregated per fiscal year (lib/depreciation): the first
        // year is pro-rata from the in-service month, a 30-month life is 30
        // months, double-declining reaches salvage, and once anything has been
        // posted the projection continues from the carrying value over the
        // remaining life — after a capital event that is the whole point.
        const posted = book.accumulatedDepreciation > 0 && book.lastDepreciationDate
            ? (() => {
                const d = new Date(book.lastDepreciationDate!);
                return { bookValue: book.currentValue, accumulated: book.accumulatedDepreciation, lastFiscalYear: d.getFullYear(), lastPeriod: d.getMonth() + 1 };
            })()
            : null;
        return projectAnnual({
            method: book.depreciationMethod,
            cost: financial.acquisitionCost,
            salvage: financial.residualValue,
            lifeMonths: financial.usefulLifeMonths,
            startDate: book.startDate,
            posted,
            fiscalStart: fiscalYearStart(),
        }).map(r => ({
            period: r.period,
            fiscalYear: r.fiscalYear,
            months: r.months,
            openingBookValue: r.openingBookValue,
            depreciationExpense: r.depreciationExpense,
            accumulatedDepreciation: r.accumulatedDepreciation,
            closingBookValue: r.closingBookValue,
        }));
    }

    /**
     * Check if asset is under warranty (AI-triggered on breakdown WO)
     */
    async checkWarrantyStatus(assetId: string): Promise<WarrantyCheckResult> {
        const today = new Date().toISOString().split('T')[0];

        const { data: warranties } = await supabase
            .from('warranties')
            .select('*')
            .eq('asset_id', assetId)
            .eq('status', 'ACTIVE')
            .gte('end_date', today)
            .order('end_date', { ascending: true });

        if (!warranties || warranties.length === 0) {
            return {
                underWarranty: false,
                allWarranties: [],
                recommendation: 'PURCHASE',
                message: 'Asset is not under warranty. Proceed with standard procurement.'
            };
        }

        // G8: Map all warranties for multi-selection in the UI
        const allMapped = warranties
            .filter(w => {
                // Exclude performance-based warranties that are exhausted
                if (w.max_hours && w.current_hours >= w.max_hours) return false;
                return true;
            })
            .map(w => this.mapWarranty(w));

        if (allMapped.length === 0) {
            return {
                underWarranty: false,
                allWarranties: [],
                recommendation: 'PURCHASE',
                message: 'All warranties for this asset have expired or been exhausted.'
            };
        }

        // G8: Intelligent primary selection — OEM > EXTENDED > SERVICE_CONTRACT, then by longest remaining
        const typePriority: Record<string, number> = { OEM: 1, EXTENDED: 2, SERVICE_CONTRACT: 3, THIRD_PARTY: 4 };
        const sorted = [...allMapped].sort((a, b) => {
            const pa = typePriority[a.warrantyType] ?? 99;
            const pb = typePriority[b.warrantyType] ?? 99;
            if (pa !== pb) return pa - pb;
            // Within same type, pick longest remaining
            return new Date(b.endDate || 0).getTime() - new Date(a.endDate || 0).getTime();
        });

        const primary = sorted[0];
        const endDate = new Date(primary.endDate || new Date());
        const daysRemaining = Math.ceil((endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

        // Find raw warranty for hours check
        const rawPrimary = warranties.find(w => w.id === primary.id);
        const hoursRemaining = rawPrimary?.max_hours ? rawPrimary.max_hours - (rawPrimary.current_hours || 0) : undefined;

        const multiNote = allMapped.length > 1
            ? ` (${allMapped.length} warranties found — selected ${primary.warrantyType} as primary)`
            : '';

        return {
            underWarranty: true,
            warranty: primary,
            allWarranties: allMapped,
            coverageType: primary.warrantyType,
            daysRemaining,
            hoursRemaining,
            recommendation: 'CLAIM',
            message: `ASSET UNDER WARRANTY! ${daysRemaining} days remaining. File warranty claim instead of purchasing replacement.${multiNote}`
        };
    }


    /**
     * Generate a warranty claim from a Work Order
     */
    async generateWarrantyClaim(
        warrantyId: string,
        workOrderId: string | null,
        failureDescription: string,
        claimType: 'REPAIR' | 'REPLACEMENT' | 'CREDIT',
        amount: number
    ): Promise<WarrantyClaim> {
        if (!(amount > 0)) throw new Error('Claim amount must be greater than zero.');
        const claimNumber = `WC-${Date.now().toString(36).toUpperCase()}`;

        const { data, error } = await supabase
            .from('warranty_claims')
            .insert({
                claim_number: claimNumber,
                warranty_id: warrantyId,
                work_order_id: workOrderId || null, // '' is not a uuid — a manual claim has no WO
                failure_description: failureDescription,
                claim_type: claimType,
                total_claim_amount: amount,
                status: 'DRAFT'
            })
            .select()
            .single();

        if (error) throw error;
        return this.mapWarrantyClaim(data);
    }

    /**
     * Auto-generate a warranty claim from a Work Order on TECO (G2, G7)
     * Pulls labor + parts costs, applies deductible, creates DRAFT claim
     */
    async autoGenerateWarrantyClaimFromWO(
        workOrderId: string,
        warrantyId: string
    ): Promise<WarrantyClaim | null> {
        // 1. Get warranty details (for deductible)
        const { data: warranty } = await supabase
            .from('warranties')
            .select('*')
            .eq('id', warrantyId)
            .single();

        if (!warranty) return null;

        // 2. Get WO labor costs
        const { data: laborRows } = await supabase
            .from('work_order_labor')
            .select('act_hours, est_rate')
            .eq('wo_id', workOrderId);

        const laborTotal = (laborRows || []).reduce((sum, row) => {
            return sum + (parseFloat(row.act_hours || 0) * parseFloat(row.est_rate || 0));
        }, 0);

        // 3. Get WO parts costs
        const { data: partsRows } = await supabase
            .from('work_order_parts')
            .select('description, quantity_act, unit_cost')
            .eq('wo_id', workOrderId);

        const partsClaimed = (partsRows || []).map(row => ({
            partId: (row as any).item_id || '',
            partName: row.description || 'Unknown Part',
            qty: parseFloat(row.quantity_act || 0),
            cost: parseFloat(row.unit_cost || 0) * parseFloat(row.quantity_act || 0)
        }));
        const partsTotal = partsClaimed.reduce((sum, p) => sum + p.cost, 0);

        // 4. Get failure description from wo_failure_data
        const { data: failureData } = await supabase
            .from('wo_failure_data')
            .select('failure_mode_code, failure_cause_code, remedy_code, comments')
            .eq('wo_id', workOrderId)
            .single();

        const failureDescription = failureData
            ? `Failure Mode: ${failureData.failure_mode_code} | Cause: ${failureData.failure_cause_code} | Remedy: ${failureData.remedy_code}${failureData.comments ? ' | ' + failureData.comments : ''}`
            : 'Failure details pending';

        // 5. Calculate claim amount (G7: subtract deductible)
        const deductible = parseFloat(warranty.deductible || 0);
        const grossAmount = laborTotal + partsTotal;
        const claimAmount = Math.max(0, grossAmount - deductible);

        if (claimAmount <= 0) return null; // Nothing to claim after deductible

        // 6. Determine claim type
        const claimType = partsTotal > laborTotal ? 'REPLACEMENT' : 'REPAIR';

        // 7. Create the claim
        const claimNumber = `WC-${Date.now().toString(36).toUpperCase()}`;
        const { data, error } = await supabase
            .from('warranty_claims')
            .insert({
                claim_number: claimNumber,
                warranty_id: warrantyId,
                work_order_id: workOrderId,
                failure_description: failureDescription,
                claim_type: claimType,
                parts_claimed: partsClaimed,
                labor_claimed: laborTotal,
                total_claim_amount: claimAmount,
                status: 'DRAFT'
            })
            .select()
            .single();

        if (error) throw error;

        // 8. Link claim back to work order
        await supabase
            .from('work_orders')
            .update({ warranty_claim_id: data.id })
            .eq('id', workOrderId);

        return this.mapWarrantyClaim(data);
    }

    /**
     * Update warranty claim status (G3 — lifecycle transitions)
     */
    async updateClaimStatus(
        claimId: string,
        newStatus: WarrantyClaim['status'],
        details?: {
            vendorReference?: string;
            approvedAmount?: number;
            rejectionReason?: string;
            actorId?: string;
        }
    ): Promise<WarrantyClaim> {
        // The claim's current state decides what may happen next. Without this
        // an APPROVED claim could be approved again (and credited again).
        const { data: current, error: curErr } = await supabase
            .from('warranty_claims')
            .select('id, status, total_claim_amount, approved_amount')
            .eq('id', claimId)
            .single();
        if (curErr) throw curErr;
        const allowed: Record<string, WarrantyClaim['status'][]> = {
            DRAFT: ['SUBMITTED'],
            SUBMITTED: ['APPROVED', 'REJECTED'],
            UNDER_REVIEW: ['APPROVED', 'REJECTED'],
            APPROVED: ['CREDITED'],
            REJECTED: ['SUBMITTED'],
            CREDITED: [],
        };
        if (!(allowed[current.status] || []).includes(newStatus)) {
            throw new Error(`A ${current.status} claim cannot move to ${newStatus}.`);
        }

        const total = parseFloat(current.total_claim_amount || 0);
        const update: any = { status: newStatus };

        if (newStatus === 'SUBMITTED') {
            update.submitted_at = new Date().toISOString();
            update.submitted_by = details?.actorId || null;
            update.rejection_reason = null;
        }
        if (newStatus === 'APPROVED') {
            const approved = details?.approvedAmount ?? total;
            if (!(approved > 0)) throw new Error('Approved amount must be greater than zero.');
            if (approved > total) throw new Error(`Approved amount cannot exceed the claimed ${money(total, { decimals: 2 })}.`);
            update.approved_at = new Date().toISOString();
            update.approved_by = details?.actorId || null;
            update.approved_amount = approved;
            if (details?.vendorReference) update.vendor_reference = details.vendorReference;
            update.vendor_response_date = new Date().toISOString().split('T')[0];

            // The credit posts FIRST: if it cannot reach the ledger, the claim
            // stays SUBMITTED and the user sees why, instead of a "Recovered"
            // figure that never reached a budget.
            await this.postWarrantyCostCredit(claimId, approved);
        }
        if (newStatus === 'REJECTED') {
            if (!details?.rejectionReason?.trim()) throw new Error('A rejection needs a reason.');
            update.vendor_response_date = new Date().toISOString().split('T')[0];
            update.rejection_reason = details.rejectionReason.trim();
            if (details?.vendorReference) update.vendor_reference = details.vendorReference;
        }

        const { data, error } = await supabase
            .from('warranty_claims')
            .update(update)
            .eq('id', claimId)
            .eq('status', current.status) // optimistic: a concurrent change loses
            .select()
            .single();

        if (error) throw error;
        return this.mapWarrantyClaim(data);
    }

    /**
     * Get claims for a set of warranty IDs (for per-asset claims view)
     */
    async getClaimsForWarranties(warrantyIds: string[]): Promise<WarrantyClaim[]> {
        if (warrantyIds.length === 0) return [];
        const { data, error } = await supabase
            .from('warranty_claims')
            .select('*')
            .in('warranty_id', warrantyIds)
            .order('claim_date', { ascending: false });

        if (error) throw error;
        return (data || []).map(row => this.mapWarrantyClaim(row));
    }

    // =====================================================
    // PHASE 5: COST CREDIT RECONCILIATION (G4)
    // =====================================================

    /**
     * Post a cost credit when a warranty claim is approved.
     * Creates a negative cost_allocation entry against the WO's cost center,
     * ensuring recovered costs flow back into financial reporting.
     */
    async postWarrantyCostCredit(
        claimId: string,
        approvedAmount: number
    ): Promise<void> {
        // Idempotent: one credit per claim. document_number carries the claim
        // number and source marks it, so a retried approval cannot double-credit.
        const { data: claim, error: claimErr } = await supabase
            .from('warranty_claims')
            .select('work_order_id, warranty_id, claim_number, warranties(asset_id)')
            .eq('id', claimId)
            .single();
        if (claimErr) throw claimErr;

        const { data: existing } = await supabase
            .from('cost_allocations')
            .select('id')
            .eq('source', 'WARRANTY_CREDIT')
            .eq('document_number', claim.claim_number)
            .limit(1);
        if (existing && existing.length) return;

        // Receiver: the WO's cost centre, else the asset's (a manual claim has no
        // WO — the warranty's asset is the receiver then).
        let costCenterId: string | null = null;
        let assetId: string | null = (claim as any).warranties?.asset_id ?? null;
        let woNumber: string | null = null;
        if (claim.work_order_id) {
            const { data: wo } = await supabase
                .from('work_orders')
                .select('cost_center_id, wo_number, asset_id')
                .eq('id', claim.work_order_id)
                .maybeSingle();
            costCenterId = wo?.cost_center_id ?? null;
            woNumber = wo?.wo_number ?? null;
            assetId = wo?.asset_id ?? assetId;
        }
        if (!costCenterId && assetId) {
            const { data: asset } = await supabase
                .from('assets')
                .select('cost_center_id')
                .eq('id', assetId)
                .maybeSingle();
            costCenterId = asset?.cost_center_id ?? null;
        }
        if (!costCenterId) {
            throw new Error(`Claim ${claim.claim_number} has no cost centre to credit — set one on the work order or the asset first.`);
        }

        // Real columns only (the previous version named six that do not exist
        // and omitted NOT NULL cost_type, so this insert had never succeeded).
        await mustWrite(
            supabase.from('cost_allocations').insert({
                work_order_id: claim.work_order_id || null,
                asset_id: assetId,
                cost_center_id: costCenterId,
                cost_type: 'CREDIT',
                amount: -Math.abs(approvedAmount), // negative = credit
                posting_date: new Date().toISOString().split('T')[0],
                document_number: claim.claim_number,
                source: 'WARRANTY_CREDIT',
            }),
            `Warranty credit for claim ${claim.claim_number}${woNumber ? ` (WO ${woNumber})` : ''}`,
        );

        // The budget actual is recomputed from the ledger; without this the
        // credit sits in cost_allocations and the budget never sees it.
        await this.updateBudgetActuals(costCenterId);
    }

    // =====================================================
    // PHASE 6: PROACTIVE WARRANTY CONTROLS (G11, G14)
    // =====================================================

    /**
     * Update warranty counters when a WO is completed (G14).
     * Increments current_hours by the WO's actual labor hours.
     * Returns threshold alerts if approaching max_hours.
     */
    async updateWarrantyCounters(
        warrantyId: string,
        actualHours: number
    ): Promise<{ warning?: string; exceeded?: boolean }> {
        // 1. Get current warranty state
        const { data: warranty } = await supabase
            .from('warranties')
            .select('current_hours, max_hours, warranty_number')
            .eq('id', warrantyId)
            .single();

        if (!warranty) return {};

        const currentHours = parseFloat(warranty.current_hours || 0);
        const maxHours = parseFloat(warranty.max_hours || 0);
        const newHours = currentHours + actualHours;

        // 2. Update counter
        const { error } = await supabase
            .from('warranties')
            .update({
                current_hours: newHours,
                updated_at: new Date().toISOString()
            })
            .eq('id', warrantyId);

        if (error) {
            console.error('[FinOps] Warranty counter update failed:', error);
            return {};
        }

        console.log(`[FinOps] Warranty ${warranty.warranty_number} hours: ${currentHours} → ${newHours} / ${maxHours}`);

        // 3. Check thresholds (80%, 90%, 100%)
        if (maxHours > 0) {
            const pct = (newHours / maxHours) * 100;
            if (pct >= 100) {
                return {
                    warning: `⚠ WARRANTY HOURS EXCEEDED: ${warranty.warranty_number} at ${Math.round(pct)}% (${newHours}/${maxHours} hrs)`,
                    exceeded: true
                };
            } else if (pct >= 90) {
                return {
                    warning: `⚠ WARRANTY 90% THRESHOLD: ${warranty.warranty_number} at ${Math.round(pct)}% (${newHours}/${maxHours} hrs)`
                };
            } else if (pct >= 80) {
                return {
                    warning: `WARRANTY 80% ADVISORY: ${warranty.warranty_number} at ${Math.round(pct)}% (${newHours}/${maxHours} hrs)`
                };
            }
        }

        return {};
    }

    /**
     * Get warranties expiring within N days (G11 — Expiry Alerting).
     * Used by notification engine or dashboard to surface upcoming expirations.
     */
    async getExpiringWarranties(daysAhead: number = 90): Promise<Array<{
        id: string;
        warrantyNumber: string;
        assetId: string;
        vendorName: string;
        endDate: string;
        daysRemaining: number;
        reminderDays: number;
    }>> {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() + daysAhead);

        const { data, error } = await supabase
            .from('warranties')
            .select('id, warranty_number, asset_id, end_date, reminder_days, vendors(name)')
            .eq('status', 'ACTIVE')
            .lte('end_date', cutoffDate.toISOString().split('T')[0])
            .gte('end_date', new Date().toISOString().split('T')[0])
            .order('end_date', { ascending: true });

        if (error) {
            console.error('[FinOps] getExpiringWarranties error:', error);
            return [];
        }

        return (data || []).map((w: any) => {
            const endDate = new Date(w.end_date);
            const today = new Date();
            const daysRemaining = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            return {
                id: w.id,
                warrantyNumber: w.warranty_number,
                assetId: w.asset_id,
                vendorName: w.vendors?.name || 'Unknown',
                endDate: w.end_date,
                daysRemaining,
                reminderDays: w.reminder_days || 30
            };
        });
    }

    // =====================================================
    // PHASE 7: VENDOR INTELLIGENCE (G12)
    // =====================================================

    /**
     * Calculate per-vendor warranty performance KPIs:
     * - Average response time (days from submission to vendor response)
     * - Approval rate (approved / total non-draft claims)
     * - Average settlement ratio (approved_amount / total_claim_amount)
     */
    async getVendorWarrantyKPIs(): Promise<Array<{
        vendorId: string;
        vendorName: string;
        totalClaims: number;
        approvedClaims: number;
        rejectedClaims: number;
        approvalRate: number;
        avgResponseDays: number;
        avgSettlementRatio: number;
        totalClaimed: number;
        totalRecovered: number;
    }>> {
        // Fetch all non-draft claims with warranty + vendor info
        const { data: claims, error } = await supabase
            .from('warranty_claims')
            .select('*, warranties(vendor_id, vendors(id, name))')
            .not('status', 'eq', 'DRAFT')
            .order('claim_date', { ascending: false });

        if (error || !claims) return [];

        // Group by vendor
        const vendorMap = new Map<string, any>();

        for (const claim of claims) {
            const vendorId = claim.warranties?.vendor_id || 'unknown';
            const vendorName = claim.warranties?.vendors?.name || 'Unknown Vendor';

            if (!vendorMap.has(vendorId)) {
                vendorMap.set(vendorId, {
                    vendorId,
                    vendorName,
                    totalClaims: 0,
                    approvedClaims: 0,
                    rejectedClaims: 0,
                    totalResponseDays: 0,
                    responseCount: 0,
                    totalClaimed: 0,
                    totalRecovered: 0
                });
            }

            const v = vendorMap.get(vendorId)!;
            v.totalClaims++;
            v.totalClaimed += parseFloat(claim.total_claim_amount || 0);

            if (claim.status === 'APPROVED' || claim.status === 'CREDITED') {
                v.approvedClaims++;
                v.totalRecovered += parseFloat(claim.approved_amount || claim.total_claim_amount || 0);
            }
            if (claim.status === 'REJECTED') {
                v.rejectedClaims++;
            }

            // Response time calculation
            if (claim.submitted_at && claim.vendor_response_date) {
                const submitted = new Date(claim.submitted_at);
                const responded = new Date(claim.vendor_response_date);
                const days = Math.ceil((responded.getTime() - submitted.getTime()) / (1000 * 60 * 60 * 24));
                if (days >= 0) {
                    v.totalResponseDays += days;
                    v.responseCount++;
                }
            }
        }

        return Array.from(vendorMap.values()).map(v => ({
            vendorId: v.vendorId,
            vendorName: v.vendorName,
            totalClaims: v.totalClaims,
            approvedClaims: v.approvedClaims,
            rejectedClaims: v.rejectedClaims,
            approvalRate: v.totalClaims > 0 ? Math.round((v.approvedClaims / v.totalClaims) * 100) : 0,
            avgResponseDays: v.responseCount > 0 ? Math.round(v.totalResponseDays / v.responseCount) : 0,
            avgSettlementRatio: v.totalClaimed > 0 ? Math.round((v.totalRecovered / v.totalClaimed) * 100) : 0,
            totalClaimed: v.totalClaimed,
            totalRecovered: v.totalRecovered
        }));
    }

    // =====================================================
    // 4. SUPPLY CHAIN FINANCE
    // =====================================================

    async getSupplyChainOverview(): Promise<SupplyChainMatch[]> {
        const { data, error } = await supabase
            .from('purchase_orders')
            .select('*, vendors(name)')
            .order('date_created', { ascending: false })
            // 20 made the Supply Chain tiles a statement about the twenty newest
            // POs presented as the match rate. 500 is still a window — the page
            // says so — but it is the working set, not a sample.
            .limit(500);

        if (error) throw error;

        // The three legs come off purchase_order_lines (0248). They used to be
        // read out of the `items` JSONB on the header, which is now frozen —
        // reading it here would show every order as empty.
        const poIds = (data || []).map((po: any) => po.id);
        const { data: lineRows } = poIds.length === 0
            ? { data: [] as any[] }
            : await supabase
                .from('purchase_order_lines')
                .select('po_id, qty_ordered, qty_received, unit_cost, line_total, invoice_matched')
                .in('po_id', poIds);

        const linesByPo = new Map<string, any[]>();
        for (const l of lineRows || []) {
            const list = linesByPo.get(l.po_id) || [];
            list.push(l);
            linesByPo.set(l.po_id, list);
        }

        // The invoice leg comes from real invoices since 0255, not from a
        // boolean on the line. A blocked invoice must show its amount — that
        // is the variance the queue exists to surface.
        const { data: invoiceRows } = poIds.length === 0
            ? { data: [] as any[] }
            : await supabase
                .from('sem_invoice_matches')
                .select('po_id, invoice_amount, match_status, payment_block')
                .in('po_id', poIds);

        const invoicesByPo = new Map<string, any[]>();
        for (const inv of invoiceRows || []) {
            const list = invoicesByPo.get(inv.po_id) || [];
            list.push(inv);
            invoicesByPo.set(inv.po_id, list);
        }

        return (data || []).map(po => {
            const items: any[] = linesByPo.get(po.id) || [];
            const received = items.filter(i => Number(i.qty_received || 0) > 0);
            const invoices: any[] = invoicesByPo.get(po.id) || [];

            const poAmount = items.reduce((sum, i) => sum + Number(i.line_total || 0), 0);
            // null (not 0) when nothing has been received/invoiced yet — the UI shows
            // that as "—" so missing paperwork never reads as a zero-value variance.
            const grnAmount = received.length === 0 ? null
                : received.reduce((sum, i) => sum + Number(i.qty_received || 0) * Number(i.unit_cost || 0), 0);
            const invoiceAmount = invoices.length === 0 ? null
                : invoices.reduce((sum, i) => sum + Number(i.invoice_amount || 0), 0);

            return {
                id: po.id,
                poNumber: po.po_code,
                vendor: po.vendors?.name || 'Unknown',
                poAmount,
                grnAmount,
                invoiceAmount,
                // The database has already scored each invoice line by line
                // (0255). Only fall back to comparing totals when no invoice
                // has been entered — a header comparison can net a price error
                // against a quantity error, which is what the line-level match
                // exists to prevent.
                status: invoices.length > 0
                    ? (invoices.some(i => i.match_status === 'BLOCKED') ? 'BLOCKED'
                        : invoices.every(i => i.match_status === 'MATCHED') ? 'MATCHED' : 'VARIANCE')
                    : this.deriveMatchStatus(poAmount, grnAmount, invoiceAmount)
            };
        });
    }

    /**
     * Three-way match verdict for a PO. Nothing is scored until an invoice exists —
     * a part-received open PO is in progress, not a variance.
     */
    private deriveMatchStatus(
        poAmount: number,
        grnAmount: number | null,
        invoiceAmount: number | null,
        tolerance = 1.00
    ): 'MATCHED' | 'VARIANCE' | 'BLOCKED' | 'PENDING' {
        if (invoiceAmount === null) return 'PENDING';
        if (invoiceAmount - poAmount > tolerance) return 'BLOCKED';
        if (grnAmount === null) return 'VARIANCE'; // invoiced, nothing received

        const maxVariance = Math.max(
            Math.abs(grnAmount - poAmount),
            Math.abs(invoiceAmount - poAmount),
            Math.abs(invoiceAmount - grnAmount)
        );
        return maxVariance > tolerance ? 'VARIANCE' : 'MATCHED';
    }

    /**
     * Get Purchase Orders linking to a specific Asset
     * Usually via line items, but for MVP we might link PO directly or search description
     */
    async getAssetPurchaseOrders(assetId: string): Promise<any[]> {
        // Scoped to THIS asset through its work orders: PO line → work order →
        // asset (0248). The previous version ignored assetId and returned the
        // company's five newest POs on every asset, with an amount read from a
        // column that does not exist.
        const { data: wos, error: woErr } = await supabase
            .from('work_orders')
            .select('id, wo_number')
            .eq('asset_id', assetId);
        if (woErr) throw woErr;
        const woIds = (wos || []).map((w: any) => w.id);
        if (woIds.length === 0) return [];

        const { data: lines, error: lineErr } = await supabase
            .from('purchase_order_lines')
            .select('po_id, work_order_id, line_total, qty_ordered, unit_cost')
            .in('work_order_id', woIds);
        if (lineErr) throw lineErr;
        if (!lines || lines.length === 0) return [];

        const perPo = new Map<string, { amount: number; woIds: Set<string> }>();
        for (const l of lines as any[]) {
            const amt = Number(l.line_total) || (Number(l.qty_ordered) || 0) * (Number(l.unit_cost) || 0);
            const e = perPo.get(l.po_id) || { amount: 0, woIds: new Set<string>() };
            e.amount += amt; e.woIds.add(l.work_order_id);
            perPo.set(l.po_id, e);
        }

        const { data: pos, error: poErr } = await supabase
            .from('purchase_orders')
            .select('id, po_code, status, date_created, supplier_id')
            .in('id', Array.from(perPo.keys()))
            .order('date_created', { ascending: false });
        if (poErr) throw poErr;

        const supplierIds = Array.from(new Set((pos || []).map((p: any) => p.supplier_id).filter(Boolean)));
        const vendorName = new Map<string, string>();
        if (supplierIds.length) {
            const { data: vendors } = await supabase.from('vendors').select('id, name').in('id', supplierIds);
            (vendors || []).forEach((v: any) => vendorName.set(v.id, v.name));
        }
        const woNumber = new Map((wos || []).map((w: any) => [w.id, w.wo_number]));

        return (pos || []).map((po: any) => ({
            id: po.id,
            poNumber: po.po_code,
            vendor: vendorName.get(po.supplier_id) || '—',
            date: po.date_created,
            /** this asset's lines only — a PO can serve several assets */
            amount: Math.round((perPo.get(po.id)?.amount || 0) * 100) / 100,
            status: po.status,
            workOrders: Array.from(perPo.get(po.id)?.woIds || []).map(id => woNumber.get(id)).filter(Boolean),
        }));
    }

    /**
     * Move an insurance incident's claim one step (0397):
     *   OPEN → SUBMITTED (claim amount, reference, date) → SETTLED (amount paid,
     *   date) → CLOSED; OPEN or SUBMITTED may also CLOSE (no claim / declined).
     * The database trigger is the rule; this sends the step and surfaces its
     * message. A settlement is RECORDED only — not posted to the cost ledger
     * (an insurance payout is income, not a maintenance-cost reduction).
     */
    async advanceIncidentClaim(
        incidentId: string,
        to: 'SUBMITTED' | 'SETTLED' | 'CLOSED',
        details: { claimAmount?: number; claimReference?: string; submittedDate?: string; settlementAmount?: number; settlementDate?: string } = {},
    ): Promise<InsuranceIncident> {
        const { data: current, error: curErr } = await supabase
            .from('insurance_incidents')
            .select('id, claim_status')
            .eq('id', incidentId)
            .single();
        if (curErr) throw curErr;

        const update: Record<string, any> = { claim_status: to };
        if (to === 'SUBMITTED') {
            if (!(details.claimAmount && details.claimAmount > 0)) throw new Error('Enter the amount being claimed.');
            update.claim_amount = details.claimAmount;
            update.claim_reference = details.claimReference?.trim() || null;
            update.claim_submitted_date = details.submittedDate || null; // trigger defaults to today
        }
        if (to === 'SETTLED') {
            if (details.settlementAmount === undefined || !Number.isFinite(details.settlementAmount) || details.settlementAmount < 0) {
                throw new Error('Enter what the insurer paid (0 if nothing).');
            }
            update.settlement_amount = details.settlementAmount;
            update.settlement_date = details.settlementDate || null;
        }

        const { data, error } = await supabase
            .from('insurance_incidents')
            .update(update)
            .eq('id', incidentId)
            .eq('claim_status', current.claim_status) // a concurrent change loses
            .select()
            .single();
        if (error) throw new Error(error.message);
        return this.mapInsuranceIncident(data);
    }

    /** Every insurance incident in the tenant, newest first, with its asset. */
    async getAllInsuranceIncidents(): Promise<(InsuranceIncident & { assetName?: string; assetTag?: string })[]> {
        // Two queries, not an embed: insurance_incidents.asset_id has no foreign
        // key (0034 created the table before 0044's FK-bearing version, which
        // became a no-op), so PostgREST cannot resolve `assets(…)` and the whole
        // read failed — the Insurance tab showed no incidents in production.
        const { data, error } = await supabase
            .from('insurance_incidents')
            .select('*')
            .order('incident_date', { ascending: false })
            .range(0, 499);
        if (error) throw error;
        const ids = Array.from(new Set((data || []).map((r: any) => r.asset_id).filter(Boolean)));
        const assetById = new Map<string, { name?: string; tag?: string }>();
        if (ids.length) {
            const { data: assets } = await supabase.from('assets').select('id, name, tag').in('id', ids);
            (assets || []).forEach((a: any) => assetById.set(a.id, { name: a.name, tag: a.tag }));
        }
        return (data || []).map((row: any) => ({
            ...this.mapInsuranceIncident(row),
            assetName: assetById.get(row.asset_id)?.name,
            assetTag: assetById.get(row.asset_id)?.tag,
        }));
    }

    /**
     * Enter a vendor invoice against a PO and three-way match it (0255).
     *
     * Lines default to what is still outstanding on each PO line at the PO
     * price, because that is what a correct invoice looks like — the clerk
     * then changes only what the vendor actually disputed, so a discrepancy
     * has to be typed in rather than accepted by default.
     *
     * The duplicate-invoice constraint surfaces as a plain message: paying the
     * same invoice twice is the most common loss in accounts payable.
     */
    async createInvoice(params: {
        poId: string;
        vendorId?: string;
        invoiceNumber: string;
        invoiceDate: string;
        invoiceAmount: number;
        currency?: string;
        lines?: { poLineId: string; quantity: number; unitPrice: number }[];
    }): Promise<{ invoiceId: string; status: string; block?: string; variance: number }> {
        let lines = params.lines;
        if (!lines || lines.length === 0) {
            const { data: poLines } = await supabase
                .from('purchase_order_lines')
                .select('id, qty_ordered, qty_received, unit_cost')
                .eq('po_id', params.poId);
            lines = (poLines || [])
                .map((l: any) => ({
                    poLineId: l.id,
                    // Invoice what has been receipted; nothing has been proven
                    // to have arrived beyond that.
                    quantity: Number(l.qty_received) || 0,
                    unitPrice: Number(l.unit_cost) || 0,
                }))
                .filter(l => l.quantity > 0);
        }

        const { data: invoice, error } = await supabase
            .from('invoice_matches')
            .insert({
                po_id: params.poId,
                vendor_id: params.vendorId || null,
                invoice_number: params.invoiceNumber,
                invoice_date: params.invoiceDate,
                invoice_amount: params.invoiceAmount,
                currency: params.currency || 'USD',
            })
            .select('id')
            .single();

        if (error) {
            if (error.code === '23505') {
                throw new Error(`Invoice ${params.invoiceNumber} has already been entered for this vendor.`);
            }
            throw error;
        }

        if (lines.length > 0) {
            const { error: lineErr } = await supabase.from('invoice_match_lines').insert(
                lines.map(l => ({
                    invoice_id: invoice.id,
                    po_line_id: l.poLineId,
                    quantity: l.quantity,
                    unit_price: l.unitPrice,
                })),
            );
            if (lineErr) throw new Error(`Invoice saved but its lines did not: ${lineErr.message}`);
        }

        const verdict = await this.matchInvoice(invoice.id);
        return { invoiceId: invoice.id, ...verdict };
    }

    /**
     * Re-run the three-way match. Idempotent, and worth re-running after a late
     * goods receipt — an invoice blocked for quantity clears itself once the
     * delivery it was ahead of actually arrives.
     */
    async matchInvoice(invoiceId: string): Promise<{ status: string; block?: string; variance: number }> {
        const { data, error } = await supabase.rpc('ers_match_invoice', { p_invoice_id: invoiceId });
        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        return {
            status: row?.match_status || 'PENDING',
            block: row?.payment_block || undefined,
            variance: parseFloat(row?.variance_amount) || 0,
        };
    }

    /** Invoices raised against one PO, with their verdicts. */
    async getInvoicesForPO(poId: string): Promise<any[]> {
        const { data, error } = await supabase
            .from('sem_invoice_matches')
            .select('*')
            .eq('po_id', poId)
            .order('invoice_date', { ascending: false });
        if (error) {
            console.warn('[finops] invoice read failed (0255 applied?):', error.message);
            return [];
        }
        return data || [];
    }

    /**
     * Three-way match verdict for one invoice, read back from the ledger.
     *
     * This used to compute a verdict in TypeScript from `purchase_orders.
     * total_amount` — a column that does not exist — and nothing called it,
     * which is the only reason it never crashed a second screen. The match now
     * happens in one place, the database, so the invoice queue and this call
     * cannot disagree.
     */
    async performThreeWayMatch(invoiceId: string): Promise<ThreeWayMatchResult> {
        const { data, error } = await supabase
            .from('sem_invoice_matches')
            .select('*')
            .eq('invoice_id', invoiceId)
            .single();
        if (error) throw error;

        const poAmount = parseFloat(data.po_amount) || 0;
        const grnAmount = parseFloat(data.grn_amount) || 0;
        const invoiceAmount = parseFloat(data.invoice_amount) || 0;
        const variance = parseFloat(data.variance_amount) || 0;
        const matched = data.match_status === 'MATCHED';

        return {
            matched,
            status: data.match_status === 'BLOCKED' ? 'BLOCKED' : matched ? 'MATCHED' : 'VARIANCE',
            poAmount,
            grnAmount,
            invoiceAmount,
            variance,
            variancePct: poAmount > 0 ? (variance / poAmount) * 100 : 0,
            withinTolerance: matched,
            blockReason: data.payment_block || undefined,
        };
    }

    /**
     * Calculate Weighted Average Cost for inventory item
     */
    async calculateInventoryWAC(inventoryId: string): Promise<number> {
        const { data: valuations } = await supabase
            .from('inventory_valuations')
            .select('quantity_on_hand, unit_cost, total_value')
            .eq('inventory_id', inventoryId)
            .order('valuation_date', { ascending: false })
            .limit(1);

        if (!valuations || valuations.length === 0) {
            return 0;
        }

        return valuations[0].unit_cost;
    }

    /**
     * Update inventory valuation after receipt or issue
     */
    async updateInventoryValuation(
        inventoryId: string,
        transactionType: 'RECEIPT' | 'ISSUE',
        quantity: number,
        unitCost: number,
        transactionRef?: string
    ): Promise<void> {
        // Get current valuation
        const currentWAC = await this.calculateInventoryWAC(inventoryId);

        // Get current stock
        const { data: inventory } = await supabase
            .from('inventory')
            .select('quantity')
            .eq('id', inventoryId)
            .single();

        const currentQty = inventory?.quantity || 0;

        let newQty: number;
        let newWAC: number;

        if (transactionType === 'RECEIPT') {
            // WAC = (Current Value + New Value) / (Current Qty + New Qty)
            const currentValue = currentQty * currentWAC;
            const newValue = quantity * unitCost;
            newQty = currentQty + quantity;
            newWAC = newQty > 0 ? (currentValue + newValue) / newQty : unitCost;
        } else {
            // Issue uses current WAC
            newQty = currentQty - quantity;
            newWAC = currentWAC;
        }

        await supabase.from('inventory_valuations').insert({
            inventory_id: inventoryId,
            valuation_date: new Date().toISOString().split('T')[0],
            valuation_method: 'WAC',
            quantity_on_hand: newQty,
            unit_cost: newWAC,
            total_value: newQty * newWAC,
            transaction_type: transactionType,
            transaction_ref: transactionRef
        });
    }

    // =====================================================
    // 5. INSURANCE & RISK MANAGEMENT
    // =====================================================

    /**
     * Get insurance policies for an asset
     */
    async getAssetInsurance(assetId: string): Promise<AssetInsurance[]> {
        const { data, error } = await supabase
            .from('asset_insurance')
            .select('*')
            .eq('asset_id', assetId)
            //.eq('status', 'ACTIVE') // Allow seeing history
            .order('coverage_end', { ascending: false });

        if (error) throw error;
        return (data || []).map(this.mapAssetInsurance);
    }

    /**
     * Create new insurance policy
     */
    async createAssetInsurance(policy: Omit<AssetInsurance, 'id'>): Promise<AssetInsurance> {
        const { data, error } = await supabase
            .from('asset_insurance')
            .insert({
                asset_id: policy.assetId,
                policy_number: policy.policyNumber,
                insurer_name: policy.provider, // Mapped
                coverage_type: policy.coverageType,
                coverage_start: policy.startDate, // Mapped
                coverage_end: policy.endDate, // Mapped
                premium_annual: policy.premiumAmount, // Mapped
                insured_value: policy.insuredValue,
                replacement_value: policy.insuredValue, // Required by DB, default to insured value
                deductible: policy.deductible,
                renewal_reminder_days: policy.renewalReminderDays ?? 30,
                status: policy.status || 'ACTIVE'
            })
            .select()
            .single();

        if (error) throw error;
        return this.mapAssetInsurance(data);
    }

    /**
     * Alias: create insurance with split args. Validates what the table
     * requires (insurer, policy number, dates) — previously '' and today's
     * date were substituted silently, so a policy could start and end today.
     */
    async createInsurance(assetId: string, insuranceData: Partial<AssetInsurance>): Promise<AssetInsurance> {
        const provider = insuranceData.provider?.trim();
        const policyNumber = insuranceData.policyNumber?.trim();
        if (!provider) throw new Error('Insurer is required.');
        if (!policyNumber) throw new Error('Policy number is required.');
        if (!insuranceData.startDate) throw new Error('Coverage start date is required.');
        if (!insuranceData.endDate) throw new Error('Coverage end date is required.');
        if (insuranceData.endDate < insuranceData.startDate) throw new Error('Coverage ends before it starts.');
        const nn = (v: number | undefined) => (Number.isFinite(v as number) && (v as number) >= 0 ? (v as number) : 0);
        return this.createAssetInsurance({
            assetId,
            policyNumber,
            provider,
            coverageType: insuranceData.coverageType || 'ALL_RISK',
            startDate: insuranceData.startDate,
            endDate: insuranceData.endDate,
            premiumAmount: nn(insuranceData.premiumAmount),
            insuredValue: nn(insuranceData.insuredValue),
            deductible: nn(insuranceData.deductible),
            renewalReminderDays: insuranceData.renewalReminderDays ?? 30,
            status: insuranceData.status || 'ACTIVE'
        } as Omit<AssetInsurance, 'id'>);
    }

    /**
     * Delete an insurance policy
     */
    async deleteAssetInsurance(insuranceId: string): Promise<void> {
        const { error } = await supabase
            .from('asset_insurance')
            .delete()
            .eq('id', insuranceId);

        if (error) throw error;
    }

    /**
     * Update an existing insurance policy
     */
    async updateAssetInsurance(insuranceId: string, updates: Partial<AssetInsurance>): Promise<AssetInsurance> {
        const dbUpdates: Record<string, any> = {};

        if (updates.provider !== undefined) dbUpdates.insurer_name = updates.provider;
        if (updates.policyNumber !== undefined) dbUpdates.policy_number = updates.policyNumber;
        if (updates.coverageType !== undefined) dbUpdates.coverage_type = updates.coverageType;
        if (updates.startDate !== undefined) dbUpdates.coverage_start = updates.startDate;
        if (updates.endDate !== undefined) dbUpdates.coverage_end = updates.endDate;
        if (updates.premiumAmount !== undefined) dbUpdates.premium_annual = updates.premiumAmount;
        if (updates.insuredValue !== undefined) {
            dbUpdates.insured_value = updates.insuredValue;
            dbUpdates.replacement_value = updates.insuredValue;
        }
        if (updates.deductible !== undefined) dbUpdates.deductible = updates.deductible;
        if (updates.renewalReminderDays !== undefined) dbUpdates.renewal_reminder_days = updates.renewalReminderDays;
        if (updates.status !== undefined) dbUpdates.status = updates.status;
        if (dbUpdates.coverage_start && dbUpdates.coverage_end && dbUpdates.coverage_end < dbUpdates.coverage_start) {
            throw new Error('Coverage ends before it starts.');
        }

        dbUpdates.updated_at = new Date().toISOString();

        const { data, error } = await supabase
            .from('asset_insurance')
            .update(dbUpdates)
            .eq('id', insuranceId)
            .select()
            .single();

        if (error) throw error;
        return this.mapAssetInsurance(data);
    }

    /**
     * Get insurance incidents for an asset
     */
    async getInsuranceIncidents(assetId: string): Promise<InsuranceIncident[]> {
        const { data, error } = await supabase
            .from('insurance_incidents')
            .select('*')
            .eq('asset_id', assetId)
            .order('incident_date', { ascending: false });

        if (error) throw error;
        return (data || []).map(this.mapInsuranceIncident);
    }

    /**
     * Track an insurance incident and ring-fence costs
     */
    async trackInsuranceIncident(
        assetId: string,
        workOrderId: string | null,
        incidentType: string,
        description: string,
        estimatedDamage: number,
        incidentDate?: string
    ): Promise<any> {
        const incidentNumber = `INS-${Date.now().toString(36).toUpperCase()}`;
        const when = incidentDate || new Date().toISOString().split('T')[0];

        // The policy that actually covered the incident date, not whichever
        // row happens to sort first.
        const policies = await this.getAssetInsurance(assetId);
        const covering = policies.find(p => p.status === 'ACTIVE' && p.startDate <= when && (!p.endDate || p.endDate >= when))
            || policies.find(p => p.status === 'ACTIVE');
        const policyId = covering ? covering.id : null;

        const { data, error } = await supabase
            .from('insurance_incidents')
            .insert({
                incident_number: incidentNumber,
                asset_id: assetId,
                insurance_policy_id: policyId,
                work_order_id: workOrderId || null, // '' is not a uuid
                incident_date: when,
                incident_type: incidentType,
                description: description,
                estimated_damage: estimatedDamage,
                claim_status: 'OPEN'
            })
            .select()
            .single();

        if (error) throw error;
        return data;
    }

    /**
     * Update incident costs from Work Order
     */
    async updateIncidentCosts(incidentId: string, laborCost: number, materialCost: number, thirdPartyCost: number): Promise<void> {
        const totalCost = laborCost + materialCost + thirdPartyCost;

        await supabase
            .from('insurance_incidents')
            .update({
                labor_cost: laborCost,
                material_cost: materialCost,
                third_party_cost: thirdPartyCost,
                total_cost: totalCost
            })
            .eq('id', incidentId);
    }

    // =====================================================
    // MAPPERS (DB -> UI)
    // =====================================================

    private mapCostCenter(row: any): CostCenter {
        return {
            id: row.id,
            code: row.code,
            name: row.name,
            description: row.description,
            parentId: row.parent_id,
            companyCode: row.company_code,
            controllingArea: row.controlling_area,
            profitCenter: row.profit_center,
            costCenterType: row.cost_center_type,
            responsiblePersonId: row.responsible_person_id,
            validFrom: row.valid_from,
            validTo: row.valid_to,
            active: row.active
        };
    }

    private mapBudget(row: any): Budget {
        return {
            id: row.id,
            costCenterId: row.cost_center_id,
            wbsElementId: row.wbs_element_id,
            fiscalYear: row.fiscal_year,
            period: row.period,
            opexBudget: parseFloat(row.opex_budget),
            capexBudget: parseFloat(row.capex_budget),
            committed: parseFloat(row.committed),
            actual: parseFloat(row.actual),
            currency: row.currency,
            status: row.status || 'DRAFT',
            monthlyData: row.monthly_data || {}
        };
    }

    private mapCostAllocation(row: any): CostAllocation {
        return {
            id: row.id,
            workOrderId: row.work_order_id,
            assetId: row.asset_id || undefined,
            costCenterId: row.cost_center_id,
            wbsElementId: row.wbs_element_id,
            costType: row.cost_type,
            amount: parseFloat(row.amount),
            // A material posting has no meaningful quantity (mixed units), so
            // the column is null — parseFloat(null) is NaN, which renders as
            // "NaN" on screen. Undefined is the honest answer.
            quantity: row.quantity == null ? undefined : parseFloat(row.quantity),
            unit: row.unit || undefined,
            postingDate: row.posting_date,
            documentNumber: row.document_number || undefined,
            source: row.source || undefined
        };
    }

    private mapAssetInsurance(row: any): AssetInsurance {
        return {
            id: row.id,
            assetId: row.asset_id,
            policyNumber: row.policy_number,
            provider: row.insurer_name, // Mapped
            coverageType: row.coverage_type,
            startDate: row.coverage_start, // Mapped
            endDate: row.coverage_end, // Mapped
            // parseFloat(null) is NaN and `??` does not catch it — "Premium: $NaN"
            premiumAmount: Number.isFinite(parseFloat(row.premium_annual)) ? parseFloat(row.premium_annual) : 0,
            insuredValue: Number.isFinite(parseFloat(row.insured_value)) ? parseFloat(row.insured_value) : 0,
            deductible: Number.isFinite(parseFloat(row.deductible)) ? parseFloat(row.deductible) : 0,
            renewalReminderDays: Number.isFinite(parseInt(row.renewal_reminder_days)) ? parseInt(row.renewal_reminder_days) : 30,
            status: row.status
        };
    }

    private mapInsuranceIncident(row: any): InsuranceIncident {
        return {
            id: row.id,
            incidentNumber: row.incident_number,
            assetId: row.asset_id,
            insurancePolicyId: row.insurance_policy_id,
            workOrderId: row.work_order_id,
            incidentDate: row.incident_date,
            incidentType: row.incident_type,
            description: row.description,
            estimatedDamage: parseFloat(row.estimated_damage),
            laborCost: parseFloat(row.labor_cost),
            materialCost: parseFloat(row.material_cost),
            thirdPartyCost: parseFloat(row.third_party_cost) || 0,
            totalCost: parseFloat(row.total_cost) || 0,
            claimStatus: row.claim_status,
            claimReference: row.claim_reference ?? null,
            claimSubmittedDate: row.claim_submitted_date ?? null,
            claimAmount: row.claim_amount != null ? parseFloat(row.claim_amount) : null,
            settlementAmount: row.settlement_amount != null ? parseFloat(row.settlement_amount) : null,
            settlementDate: row.settlement_date ?? null,
        };
    }

    private mapWarranty(row: any): Warranty {
        const num = (v: any): number | undefined => (v === null || v === undefined || v === '' ? undefined : (Number.isFinite(parseFloat(v)) ? parseFloat(v) : undefined));
        const vendorName: string | undefined = row.vendors?.name || undefined;
        const manufacturerName: string | undefined = row.manufacturers?.name || undefined;
        return {
            id: row.id,
            assetId: row.asset_id,
            warrantyNumber: row.warranty_number || undefined,
            manufacturerId: row.manufacturer_id ?? null,
            vendorId: row.vendor_id ?? null,
            vendorName,
            manufacturerName,
            // What the user reads as "who backs this": the OEM for an OEM warranty,
            // the vendor otherwise; either falls back to the other.
            providerName: row.warranty_type === 'OEM' ? (manufacturerName || vendorName) : (vendorName || manufacturerName),
            warrantyType: row.warranty_type,
            coverageScope: row.coverage_scope,
            exclusions: row.exclusions ?? null,
            startDate: row.start_date,
            endDate: row.end_date ?? null,
            maxHours: num(row.max_hours) ?? null,
            currentHours: num(row.current_hours) ?? 0,
            deductible: num(row.deductible) ?? 0,
            warrantyValue: num(row.warranty_value) ?? null,
            reminderDays: num(row.reminder_days) ?? 30,
            status: row.status
        };
    }

    private mapWarrantyClaim(row: any): WarrantyClaim {
        return {
            id: row.id,
            claimNumber: row.claim_number,
            warrantyId: row.warranty_id,
            workOrderId: row.work_order_id,
            claimDate: row.claim_date,
            failureDescription: row.failure_description,
            claimType: row.claim_type,
            partsClaimed: row.parts_claimed || [],
            laborClaimed: parseFloat(row.labor_claimed || 0),
            totalClaimAmount: parseFloat(row.total_claim_amount || 0),
            vendorReference: row.vendor_reference,
            vendorResponseDate: row.vendor_response_date,
            approvedAmount: row.approved_amount ? parseFloat(row.approved_amount) : undefined,
            rejectionReason: row.rejection_reason,
            status: row.status,
            submittedBy: row.submitted_by,
            submittedAt: row.submitted_at,
            approvedBy: row.approved_by,
            approvedAt: row.approved_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
    private mapAssetFinancial(row: any): AssetFinancial {
        const acqCost = parseFloat(row.acquisition_cost);
        return {
            id: row.id,
            assetId: row.asset_id,
            assetClass: row.asset_class,
            acquisitionCost: acqCost,
            originalAcquisitionCost: row.original_acquisition_cost ? parseFloat(row.original_acquisition_cost) : acqCost,
            subsequentCapitalizations: row.subsequent_capitalizations ? parseFloat(row.subsequent_capitalizations) : 0,
            acquisitionDate: row.acquisition_date,
            capitalizationDate: row.capitalization_date,
            residualValue: parseFloat(row.residual_value),
            usefulLifeMonths: row.useful_life_months,
            replacementValue: row.replacement_value ? parseFloat(row.replacement_value) : undefined,
            costCenterId: row.cost_center_id,
            downtimeCostPerHour: row.downtime_cost_per_hour ? parseFloat(row.downtime_cost_per_hour) : undefined,
            warrantyStartDate: row.warranty_start_date,
            warrantyEndDate: row.warranty_end_date
        };
    }

    private mapDepreciationBook(row: any): DepreciationBook {
        return {
            id: row.id,
            assetFinancialId: row.asset_financial_id,
            bookType: row.book_type,
            depreciationMethod: row.depreciation_method,
            currentValue: parseFloat(row.current_value),
            accumulatedDepreciation: parseFloat(row.accumulated_depreciation),
            startDate: row.start_date,
            usageBased: row.usage_based,
            designedHours: row.designed_hours,
            currentHours: row.current_hours,
            lastDepreciationDate: row.last_depreciation_date ?? null
        };
    }

    /**
     * Bring a cost center's budget actual back in line with the ledger.
     *
     * This used to read `actual: supabase.rpc('increment_budget_actual', …)`,
     * which assigned a query builder to a numeric column against an RPC that
     * exists in no migration — budget actuals never moved. 0244 replaces the
     * increment with a recompute: the answer is always whatever
     * cost_allocations says, so a missed or repeated call cannot drift it.
     */
    private async updateBudgetActuals(costCenterId: string, fiscalYear?: number): Promise<void> {
        const { error } = await supabase.rpc('ers_refresh_budget_actual', {
            p_cost_center_id: costCenterId,
            p_fiscal_year: fiscalYear ?? null,
        });
        // Advisory: a stale budget actual must not fail the posting that
        // caused it — the next settlement or refresh corrects it.
        if (error) console.warn('[finops] budget actual refresh failed (0244 applied?):', error.message);
    }

    /**
     * Seed Demo Data for FinOps
     * Bypasses local migration issues by inserting via authenticated client
     */
    async seedDemoData(): Promise<void> {
        console.log('Starting seed...');

        // 1. Assets
        const { error: assetErr } = await supabase.from('assets').upsert([
            { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', name: 'Atlas Copco Compressor', tag: 'AC-2024-01', status_code: 'OPERATIONAL', criticality: 'A', hierarchy_level: 'EQUIPMENT' },
            { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', name: 'Cat Generator 3516', tag: 'GEN-01', status_code: 'OPERATIONAL', criticality: 'A', hierarchy_level: 'EQUIPMENT' }
        ], { onConflict: 'id' });
        if (assetErr) console.error('Asset seed error:', assetErr);

        // 2. Cost Centers
        // Conflict target is (company_id, code) since 0265 — cost centre codes are
        // the customer's, so two tenants may both use CC-MNT-01. company_id is not
        // in the payload; the column default supplies it. The conflict target names
        // the INDEX, not the insert columns, so it must list company_id regardless.
        const { error: ccErr } = await supabase.from('cost_centers').upsert([
            { id: 'c0cc4738-9c0b-4ef8-bb6d-6bb9bd380c01', code: 'CC-MNT-01', name: 'Plant Maintenance', cost_center_type: 'MAINTENANCE', description: 'Core maintenance team budget', active: true },
            { id: 'c0cc4738-9c0b-4ef8-bb6d-6bb9bd380c02', code: 'CC-OPS-01', name: 'Plant Operations', cost_center_type: 'OPERATIONS', description: 'Production usage and consumables', active: true },
            { id: 'c0cc4738-9c0b-4ef8-bb6d-6bb9bd380c03', code: 'CC-ADM-01', name: 'Corporate Admin', cost_center_type: 'ADMINISTRATION', description: 'HQ Overhead and IT', active: true }
        ], { onConflict: 'company_id,code' });
        if (ccErr) console.error('Cost Center seed error:', ccErr);

        // 3. Budgets
        const { error: budErr } = await supabase.from('budgets').upsert([
            { id: 'b0d9e338-9c0b-4ef8-bb6d-6bb9bd380b01', cost_center_id: 'c0cc4738-9c0b-4ef8-bb6d-6bb9bd380c01', fiscal_year: 2024, opex_budget: 750000.00, capex_budget: 150000.00 },
            { id: 'b0d9e338-9c0b-4ef8-bb6d-6bb9bd380b02', cost_center_id: 'c0cc4738-9c0b-4ef8-bb6d-6bb9bd380c02', fiscal_year: 2024, opex_budget: 1200000.00, capex_budget: 50000.00 }
        ], { onConflict: 'id' });
        if (budErr) console.error('Budget seed error:', budErr);

        // 4. Warranties
        const { error: warrErr } = await supabase.from('warranties').upsert([
            { id: '40a77a99-9c0b-4ef8-bb6d-6bb9bd380001', asset_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', warranty_type: 'OEM', coverage_scope: 'Full bumper-to-bumper', start_date: new Date().toISOString(), status: 'ACTIVE' },
            { id: '40a77a99-9c0b-4ef8-bb6d-6bb9bd380002', asset_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', warranty_type: 'EXTENDED', coverage_scope: 'Powertrain only', start_date: new Date().toISOString(), status: 'ACTIVE' }
        ], { onConflict: 'id' });
        if (warrErr) console.error('Warranty seed error:', warrErr);

        // 5. Insurance
        const { error: insErr } = await supabase.from('asset_insurance').upsert([
            {
                id: '10550728-9c0b-4ef8-bb6d-6bb9bd380101',
                asset_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
                policy_number: 'POL-998877',
                provider: 'Allianz Industrial',
                coverage_type: 'ALL_RISK',
                start_date: '2024-01-01',
                end_date: '2024-12-31',
                premium_amount: 45000.00,
                insured_value: 5000000.00,
                deductible: 5000.00,
                status: 'ACTIVE'
            }
        ], { onConflict: 'id' });
        if (insErr) console.error('Insurance seed error:', insErr);
    }
}

export const FinOpsService = FinOpsServiceClass.getInstance();
