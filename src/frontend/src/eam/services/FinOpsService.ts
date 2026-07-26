/**
 * FinOpsService - Financial Operations & Lifecycle Management
 * The "Financial Digital Twin" of physical assets
 * 
 * Integrates with: Assets, Work Orders, Inventory, Purchase Orders, Vendors
 * External-Ready: Uses standard interfaces for future ERP integration
 */

import { supabase } from '../lib/supabase';

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
}

export interface DepreciationScheduleItem {
    period: number; // Year number (1, 2, 3...)
    fiscalYear: number;
    openingBookValue: number;
    depreciationExpense: number;
    accumulatedDepreciation: number;
    closingBookValue: number;
}

export interface Warranty {
    id: string;
    assetId: string;
    vendorId?: string;
    warrantyType: 'OEM' | 'EXTENDED' | 'SERVICE_CONTRACT';
    coverageScope?: string;
    startDate: string;
    endDate?: string;
    maxHours?: number;
    currentHours: number;
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
    status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CREDITED';
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
}

export interface CostAllocation {
    id: string;
    workOrderId: string;
    costCenterId?: string;
    wbsElementId?: string;
    costType: 'LABOR' | 'MATERIAL' | 'SERVICE' | 'OVERHEAD';
    amount: number;
    quantity?: number;
    unit?: string;
    postingDate: string;
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

        // Calculate Budget Utilization
        const { data: budgets } = await supabase.from('budgets').select('opex_budget, capex_budget, actual, committed');
        let totalBudget = 0;
        let totalUsed = 0;
        if (budgets) {
            budgets.forEach(b => {
                totalBudget += (b.opex_budget || 0) + (b.capex_budget || 0);
                totalUsed += (b.actual || 0) + (b.committed || 0);
            });
        }
        const budgetUtilization = totalBudget > 0 ? (totalUsed / totalBudget) * 100 : 0;

        // Calculate Insurance Coverage
        const { data: policies } = await supabase.from('asset_insurance').select('insured_value').eq('status', 'ACTIVE');
        const insuranceCoverage = policies?.reduce((sum, p) => sum + (p.insured_value || 0), 0) || 0;

        // Mock Depreciation MTD (would need complex query on schedules)
        // Mock Depreciation MTD (would need complex query on schedules)
        // For now, let's uses a placeholder as the column doesn't exist in the current schema
        const depreciationMTD = 0;

        return {
            activeWarranties: warrantyCount || 0,
            pendingClaims: claimsCount || 0,
            budgetUtilization: budgetUtilization,
            depreciationMTD: depreciationMTD,
            invoiceVariance: 1.2, // Mock average variance
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
    async getCostCenters(): Promise<CostCenter[]> {
        const { data, error } = await supabase
            .from('cost_centers')
            .select('*')
            // .eq('active', true) // Show all for admin management, filter in UI if needed
            .order('code');

        if (error) throw error;

        return (data || []).map(this.mapCostCenter);
    }

    /**
     * Get all budgets for a fiscal year with cost center details
     */
    async getAllBudgets(fiscalYear?: number): Promise<(Budget & { costCenterName: string; costCenterCode: string })[]> {
        const year = fiscalYear || new Date().getFullYear();

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
        const year = fiscalYear || new Date().getFullYear();

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
                    currency: 'USD'
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

        const totalBudget = costType === 'OPEX' ? budget.opexBudget : budget.capexBudget;
        const used = budget.committed + budget.actual;
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
                work_order_id: allocation.workOrderId,
                cost_center_id: allocation.costCenterId,
                wbs_element_id: allocation.wbsElementId,
                cost_type: allocation.costType,
                amount: allocation.amount,
                quantity: allocation.quantity,
                unit: allocation.unit,
                posting_date: allocation.postingDate || new Date().toISOString().split('T')[0]
            })
            .select()
            .single();

        if (error) throw error;

        // Update budget actuals
        if (allocation.costCenterId) {
            await this.updateBudgetActuals(allocation.costCenterId, allocation.amount);
        }

        return this.mapCostAllocation(data);
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
                ? `ALERT: Estimated cost $${estimatedCost.toFixed(2)} is ${variance > 0 ? 'above' : 'below'} historical average ($${avg.toFixed(2)}) by ${Math.abs(variance).toFixed(0)}%`
                : `Cost estimate within normal range (Avg: $${avg.toFixed(2)})`
        };
    }

    // =====================================================
    // 2. ASSET ACCOUNTING & DEPRECIATION
    // =====================================================

    /**
     * Get all depreciation books for summary
     */
    async getAllDepreciationBooks(): Promise<DepreciationBook[]> {
        const { data, error } = await supabase
            .from('depreciation_books')
            .select('*');

        if (error) throw error;
        return (data || []).map(this.mapDepreciationBook);
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
        const newBook = this.mapDepreciationBook(book);

        // 2. Automatically Generate & Save Schedule
        try {
            const financial = await this.getAssetFinancialById(bookData.assetFinancialId!);
            // We need a getById or re-use getAssetFinancial but that takes assetId. 
            // We can fetch by ID directly since we have assetFinancialId.
            // Actually, getAssetFinancial takes assetId, not assetFinancialId. 
            // Let's just fetch it directly here for safety.

            const { data: finData } = await supabase
                .from('asset_financials')
                .select('*')
                .eq('id', bookData.assetFinancialId)
                .single();

            if (finData) {
                const financialRecord = this.mapAssetFinancial(finData);
                const schedule = this.calculateDepreciationSchedule(newBook, financialRecord);
                await this.saveDepreciationSchedule(newBook.id, schedule);
            }
        } catch (scheduleErr) {
            console.error("Failed to auto-generate schedule for new book", scheduleErr);
            // Don't fail the book creation, just log
        }

        return newBook;
    }

    /**
     * Save depreciation schedule to database
     */
    async saveDepreciationSchedule(bookId: string, schedule: DepreciationScheduleItem[]): Promise<void> {
        if (schedule.length === 0) return;

        const rows = schedule.map(item => ({
            book_id: bookId,
            fiscal_year: item.fiscalYear,
            period: item.period,
            depreciation_amount: item.depreciationExpense,
            opening_value: item.openingBookValue,
            closing_value: item.closingBookValue,
            accumulated_depreciation: item.accumulatedDepreciation
        }));

        const { error } = await supabase
            .from('depreciation_schedules')
            .insert(rows);

        if (error) throw error;
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
        let depreciationAmount = 0;

        switch (book.depreciation_method) {
            case 'STRAIGHT_LINE': {
                const monthlyDepreciation = (financial.acquisition_cost - financial.residual_value) / financial.useful_life_months;
                depreciationAmount = monthlyDepreciation;
                break;
            }

            case 'DECLINING_BALANCE': {
                const rate = 2 / financial.useful_life_months; // Double declining
                depreciationAmount = book.current_value * rate;
                break;
            }

            case 'UNITS_OF_PRODUCTION':
                if (book.designed_hours && book.current_hours) {
                    const hourlyRate = (financial.acquisition_cost - financial.residual_value) / book.designed_hours;
                    // Assume we get hours from IoT - for now use a placeholder
                    const hoursThisPeriod = 720; // Monthly average
                    depreciationAmount = hourlyRate * hoursThisPeriod;
                }
                break;
        }

        // Don't depreciate below residual value
        const newValue = Math.max(book.current_value - depreciationAmount, financial.residual_value);
        const actualDepreciation = book.current_value - newValue;

        return { amount: actualDepreciation, newValue };
    }

    /**
     * Run depreciation for all books of a specific type
     */
    async runMonthlyDepreciation(bookType: string, fiscalYear: number, period: number): Promise<number> {
        const { data: books } = await supabase
            .from('depreciation_books')
            .select('id')
            .eq('book_type', bookType);

        let processedCount = 0;

        for (const book of books || []) {
            const { amount, newValue } = await this.calculateDepreciation(book.id);

            // Insert schedule entry
            await supabase.from('depreciation_schedules').insert({
                book_id: book.id,
                fiscal_year: fiscalYear,
                period: period,
                depreciation_amount: amount,
                opening_value: newValue + amount,
                closing_value: newValue
            });

            // Update book
            await supabase.from('depreciation_books').update({
                current_value: newValue,
                accumulated_depreciation: supabase.rpc('increment', { x: amount }),
                last_depreciation_date: new Date().toISOString()
            }).eq('id', book.id);

            processedCount++;
        }

        return processedCount;
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

            // Try to insert into capital_events table (gracefully handle if table doesn't exist yet)
            try {
                await supabase.from('capital_events').insert({
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
            } catch (logErr) {
                console.warn('Capital events table may not exist yet — event logged to console only:', capitalEvent);
            }

            // 5. Regenerate depreciation schedules for ALL books on this asset
            const books = await this.getDepreciationBooks(financial.id);
            let booksRecalculated = 0;

            for (const book of books) {
                try {
                    // Delete old schedule entries for this book
                    await supabase
                        .from('depreciation_schedules')
                        .delete()
                        .eq('book_id', book.id);

                    // Update book's current value to reflect new carrying amount minus accumulated
                    const newBookValue = newGAV - book.accumulatedDepreciation;
                    await supabase
                        .from('depreciation_books')
                        .update({ current_value: Math.max(newBookValue, newSalvage) })
                        .eq('id', book.id);

                    // Regenerate schedule from the recapitalization effective date
                    const updatedBook: DepreciationBook = {
                        ...book,
                        currentValue: Math.max(newBookValue, newSalvage),
                        startDate: input.effectiveDate // Restart schedule from event date
                    };
                    const schedule = this.calculateDepreciationSchedule(updatedBook, updatedFinancial);
                    await this.saveDepreciationSchedule(book.id, schedule);
                    booksRecalculated++;
                } catch (bookErr) {
                    console.error(`Failed to recalculate schedule for book ${book.id}:`, bookErr);
                }
            }

            return {
                success: true,
                message: `Capital event recorded. Carrying amount: $${previousCarrying.toLocaleString()} → $${newGAV.toLocaleString()}. ` +
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

        // Aggregate in JS
        const resultMap = new Map<string, any>();

        data.forEach((row: any) => {
            const costCenter = row.depreciation_books?.asset_financials?.assets?.cost_centers?.name || 'Unassigned';
            const period = row.period;
            const amount = Number(row.depreciation_amount) || 0;

            if (!resultMap.has(costCenter)) {
                resultMap.set(costCenter, {
                    costCenter,
                    total: 0,
                    monthly: {}
                });
            }

            const entry = resultMap.get(costCenter);
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
            .select('*, assets(name, tag)') // Join for display info
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
            .select('*, work_orders(asset_id, asset:assets(name))')
            .order('claim_date', { ascending: false });

        if (error) throw error;
        return (data || []).map(row => ({
            ...this.mapWarrantyClaim(row),
            assetName: row.work_orders?.asset?.name
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
            .select('*')
            .eq('asset_id', assetId)
            .order('end_date', { ascending: false });

        if (error) throw error;
        return (data || []).map(this.mapWarranty);
    }

    async addWarranty(warranty: Omit<Warranty, 'id'>): Promise<Warranty> {
        const { data, error } = await supabase
            .from('warranties')
            .insert({
                asset_id: warranty.assetId,
                vendor_id: warranty.vendorId || null, // Convert "" to null
                warranty_type: warranty.warrantyType,
                coverage_scope: warranty.coverageScope,
                start_date: warranty.startDate,
                end_date: warranty.endDate,
                max_hours: warranty.maxHours,
                current_hours: warranty.currentHours || 0,
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
        const dbUpdates: any = {};
        if (updates.assetId) dbUpdates.asset_id = updates.assetId;
        if (updates.vendorId !== undefined) dbUpdates.vendor_id = updates.vendorId || null; // Convert "" to null
        if (updates.warrantyType) dbUpdates.warranty_type = updates.warrantyType;
        if (updates.coverageScope) dbUpdates.coverage_scope = updates.coverageScope;
        if (updates.startDate) dbUpdates.start_date = updates.startDate;
        if (updates.endDate) dbUpdates.end_date = updates.endDate;
        if (updates.maxHours !== undefined) dbUpdates.max_hours = updates.maxHours;
        if (updates.currentHours !== undefined) dbUpdates.current_hours = updates.currentHours;
        if (updates.status) dbUpdates.status = updates.status;

        const { data, error } = await supabase
            .from('warranties')
            .update(dbUpdates)
            .eq('id', id)
            .select()
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
        return this.addWarranty({
            assetId,
            vendorId: warrantyData.vendorId,
            warrantyType: warrantyData.warrantyType || 'OEM',
            coverageScope: warrantyData.coverageScope,
            startDate: warrantyData.startDate || new Date().toISOString().split('T')[0],
            endDate: warrantyData.endDate,
            maxHours: warrantyData.maxHours,
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
    async getAssetsForPicker(): Promise<{ id: string; name: string; tag: string }[]> {
        const { data, error } = await supabase
            .from('assets')
            .select('id, name, tag')
            .order('name');

        if (error) throw error;
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
        const cost = financial.acquisitionCost;
        const salvage = financial.residualValue;
        const usefulLifeYears = financial.usefulLifeMonths / 12;
        const startYear = new Date(book.startDate).getFullYear();

        const schedule: DepreciationScheduleItem[] = [];
        let currentBookValue = cost;
        let accumulatedDepr = 0;

        for (let year = 1; year <= Math.ceil(usefulLifeYears); year++) {
            let expense = 0;

            switch (book.depreciationMethod) {
                case 'STRAIGHT_LINE':
                    // (Cost - Salvage) / Life
                    expense = (cost - salvage) / usefulLifeYears;
                    break;

                case 'DECLINING_BALANCE': {
                    // Book Value * (2 / Life)  <-- Double Declining Balance usually
                    // Acceleration factor usually 2
                    const rate = 2 / usefulLifeYears;
                    expense = currentBookValue * rate;
                    // Don't depreciate below salvage
                    if (currentBookValue - expense < salvage) {
                        expense = currentBookValue - salvage;
                    }
                    break;
                }

                case 'SUM_OF_YEARS_DIGITS': {
                    // (Cost - Salvage) * (Remaining Life / Sum of Years)
                    // Sum of years = n(n+1)/2
                    const sumOfYears = (usefulLifeYears * (usefulLifeYears + 1)) / 2;
                    const remainingLife = usefulLifeYears - year + 1;
                    expense = (cost - salvage) * (remainingLife / sumOfYears);
                    break;
                }

                case 'UNITS_OF_PRODUCTION':
                    // (Cost - Salvage) * (Units Produced / Total Estimated Units)
                    // Note: This requires inputs for actual usage per year. 
                    // For a forecast schedule, we might assume linear usage or just show "Usage Based" placeholder.
                    // Here we will assume linear usage for the FORECAST, but in reality this updates dynamically.
                    if (book.designedHours && book.designedHours > 0) {
                        const estimatedAnnualUsage = book.designedHours / usefulLifeYears;
                        expense = (cost - salvage) * (estimatedAnnualUsage / book.designedHours);
                    } else {
                        expense = 0; // Cannot forecast without usage estimate
                    }
                    break;
            }

            // Adjustment for final year or if expense exceeds remaining depreciable amount
            if (accumulatedDepr + expense > (cost - salvage)) {
                expense = (cost - salvage) - accumulatedDepr;
            }

            // Allow for partial year in first/last year? 
            // For MVP simplicity, we assume full year convention or that 'usefulLife' is exact.
            // In real world, we'd calculate pro-rata for the first year based on month.

            // Ensure we don't go negative or below salvage
            if (expense < 0) expense = 0;

            accumulatedDepr += expense;
            currentBookValue -= expense;

            // Rounding to 2 decimals
            expense = Math.round(expense * 100) / 100;
            accumulatedDepr = Math.round(accumulatedDepr * 100) / 100;
            currentBookValue = Math.round(currentBookValue * 100) / 100;

            schedule.push({
                period: year,
                fiscalYear: startYear + year - 1,
                openingBookValue: currentBookValue + expense,
                depreciationExpense: expense,
                accumulatedDepreciation: accumulatedDepr,
                closingBookValue: currentBookValue
            });

            if (currentBookValue <= salvage) break;
        }

        return schedule;
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
        workOrderId: string,
        failureDescription: string,
        claimType: 'REPAIR' | 'REPLACEMENT' | 'CREDIT',
        amount: number
    ): Promise<WarrantyClaim> {
        const claimNumber = `WC-${Date.now().toString(36).toUpperCase()}`;

        const { data, error } = await supabase
            .from('warranty_claims')
            .insert({
                claim_number: claimNumber,
                warranty_id: warrantyId,
                work_order_id: workOrderId,
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
        const update: any = { status: newStatus };

        if (newStatus === 'SUBMITTED') {
            update.submitted_at = new Date().toISOString();
            update.submitted_by = details?.actorId;
        }
        if (newStatus === 'APPROVED' || newStatus === 'CREDITED') {
            update.approved_at = new Date().toISOString();
            update.approved_by = details?.actorId;
            if (details?.approvedAmount !== undefined) update.approved_amount = details.approvedAmount;
            if (details?.vendorReference) update.vendor_reference = details.vendorReference;
            update.vendor_response_date = new Date().toISOString().split('T')[0];
        }
        if (newStatus === 'REJECTED') {
            update.vendor_response_date = new Date().toISOString().split('T')[0];
            if (details?.rejectionReason) update.rejection_reason = details.rejectionReason;
            if (details?.vendorReference) update.vendor_reference = details.vendorReference;
        }

        const { data, error } = await supabase
            .from('warranty_claims')
            .update(update)
            .eq('id', claimId)
            .select()
            .single();

        if (error) throw error;

        // Phase 5 (G4): Auto-post cost credit on APPROVED
        if (newStatus === 'APPROVED') {
            const creditAmount = details?.approvedAmount ?? parseFloat(data.total_claim_amount || 0);
            if (creditAmount > 0) {
                await this.postWarrantyCostCredit(claimId, creditAmount);
            }
        }

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
        // 1. Get the claim to find the linked WO
        const { data: claim } = await supabase
            .from('warranty_claims')
            .select('work_order_id, warranty_id, claim_number')
            .eq('id', claimId)
            .single();

        if (!claim?.work_order_id) {
            console.warn('[FinOps] Cannot post cost credit — no linked WO for claim:', claimId);
            return;
        }

        // 2. Get the WO's cost center
        const { data: wo } = await supabase
            .from('work_orders')
            .select('cost_center_id, wo_number, asset_id')
            .eq('id', claim.work_order_id)
            .single();

        if (!wo) return;

        // 3. Determine cost center — use WO's, or fallback to asset's
        let costCenterId = wo.cost_center_id;
        if (!costCenterId && wo.asset_id) {
            const { data: asset } = await supabase
                .from('assets')
                .select('cost_center_id')
                .eq('id', wo.asset_id)
                .single();
            costCenterId = asset?.cost_center_id;
        }

        if (!costCenterId) {
            console.warn('[FinOps] Cannot post credit — no cost center found for WO:', wo.wo_number);
            return;
        }

        // 4. Post negative cost allocation (credit)
        const { error } = await supabase
            .from('cost_allocations')
            .insert({
                cost_center_id: costCenterId,
                amount: -approvedAmount, // Negative = credit
                description: `WARRANTY CREDIT: Claim ${claim.claim_number} approved for WO ${wo.wo_number}`,
                transaction_type: 'WARRANTY_CREDIT',
                reference_type: 'WARRANTY_CLAIM',
                reference_id: claimId,
                transaction_date: new Date().toISOString().split('T')[0],
                period: new Date().toISOString().slice(0, 7) // YYYY-MM
            });

        if (error) {
            console.error('[FinOps] Cost credit posting failed:', error);
            // Don't throw — credit failure shouldn't block claim approval
        } else {
            console.log(`[FinOps] ✅ Cost credit posted: -$${approvedAmount} to CC ${costCenterId} for claim ${claim.claim_number}`);
        }
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

    async getSupplyChainOverview(): Promise<any[]> {
        // Mocking this query as we don't have a dedicated 'matches' table yet, usually derived from PO/GRN/Invoice
        // We'll return empty or fetch POs for now
        const { data, error } = await supabase
            .from('purchase_orders')
            .select('*, vendors(name)')
            .order('date_created', { ascending: false })
            .limit(20);

        if (error) throw error;

        // Transform to "match" view format roughly
        return (data || []).map(po => ({
            id: po.id,
            poNumber: po.po_code,
            vendor: po.vendors?.name,
            poAmount: po.total_amount,
            status: po.status === 'CLOSED' ? 'MATCHED' : 'PENDING'
        }));
    }

    /**
     * Get Purchase Orders linking to a specific Asset
     * Usually via line items, but for MVP we might link PO directly or search description
     */
    async getAssetPurchaseOrders(assetId: string): Promise<any[]> {
        // Try with vendor join first, fall back to simple query if FK missing
        let data: any[] | null = null;
        try {
            const result = await supabase
                .from('purchase_orders')
                .select('*, vendors(name)')
                .order('date_created', { ascending: false })
                .limit(5);
            if (result.error) throw result.error;
            data = result.data;
        } catch {
            // Fallback: query without join
            const result = await supabase
                .from('purchase_orders')
                .select('*')
                .order('date_created', { ascending: false })
                .limit(5);
            if (result.error) throw result.error;
            data = result.data;
        }

        return (data || []).map(po => ({
            id: po.id,
            poNumber: po.po_code,
            vendor: po.vendors?.name || po.vendor_name || 'Unknown',
            date: po.date_created,
            amount: po.total_amount,
            status: po.status
        }));
    }

    /**
     * Perform three-way match (PO + GRN + Invoice)
     */
    async performThreeWayMatch(
        poId: string,
        grnId: string,
        invoiceAmount: number,
        toleranceAmount: number = 1.00
    ): Promise<ThreeWayMatchResult> {
        // Get PO total
        const { data: po } = await supabase
            .from('purchase_orders')
            .select('total_amount')
            .eq('id', poId)
            .single();

        // Get GRN total
        const { data: grn } = await supabase
            .from('goods_receipts')
            .select('total_cost')
            .eq('id', grnId)
            .single();

        const poAmount = po?.total_amount || 0;
        const grnAmount = grn?.total_cost || 0;

        const maxVariance = Math.max(
            Math.abs(invoiceAmount - poAmount),
            Math.abs(invoiceAmount - grnAmount),
            Math.abs(poAmount - grnAmount)
        );

        const variancePct = poAmount > 0 ? (maxVariance / poAmount) * 100 : 0;
        const withinTolerance = maxVariance <= toleranceAmount;

        let status: 'MATCHED' | 'VARIANCE' | 'BLOCKED' = 'MATCHED';
        let blockReason: string | undefined;

        if (!withinTolerance) {
            if (invoiceAmount > poAmount) {
                status = 'BLOCKED';
                blockReason = 'PRICE - Invoice exceeds PO amount';
            } else if (grnAmount !== poAmount) {
                status = 'VARIANCE';
                blockReason = 'QUANTITY - GRN does not match PO quantity';
            }
        }

        return {
            matched: withinTolerance,
            status,
            poAmount,
            grnAmount,
            invoiceAmount,
            variance: maxVariance,
            variancePct,
            withinTolerance,
            blockReason
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
                status: policy.status || 'ACTIVE'
            })
            .select()
            .single();

        if (error) throw error;
        return this.mapAssetInsurance(data);
    }

    /**
     * Alias: create insurance with split args
     */
    async createInsurance(assetId: string, insuranceData: Partial<AssetInsurance>): Promise<AssetInsurance> {
        return this.createAssetInsurance({
            assetId,
            policyNumber: insuranceData.policyNumber || '',
            provider: insuranceData.provider || '',
            coverageType: insuranceData.coverageType || 'ALL_RISK',
            startDate: insuranceData.startDate || new Date().toISOString().split('T')[0],
            endDate: insuranceData.endDate || new Date().toISOString().split('T')[0],
            premiumAmount: insuranceData.premiumAmount || 0,
            insuredValue: insuranceData.insuredValue || 0,
            deductible: insuranceData.deductible || 0,
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
        if (updates.status !== undefined) dbUpdates.status = updates.status;

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
        workOrderId: string,
        incidentType: string,
        description: string,
        estimatedDamage: number
    ): Promise<any> {
        const incidentNumber = `INS-${Date.now().toString(36).toUpperCase()}`;

        // Find active insurance policy
        const policies = await this.getAssetInsurance(assetId);
        const policyId = policies.length > 0 ? policies[0].id : null;

        const { data, error } = await supabase
            .from('insurance_incidents')
            .insert({
                incident_number: incidentNumber,
                asset_id: assetId,
                insurance_policy_id: policyId,
                work_order_id: workOrderId,
                incident_date: new Date().toISOString(),
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
            costCenterId: row.cost_center_id,
            wbsElementId: row.wbs_element_id,
            costType: row.cost_type,
            amount: parseFloat(row.amount),
            quantity: parseFloat(row.quantity),
            unit: row.unit,
            postingDate: row.posting_date
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
            premiumAmount: parseFloat(row.premium_annual), // Mapped
            insuredValue: parseFloat(row.insured_value),
            deductible: parseFloat(row.deductible),
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
            thirdPartyCost: parseFloat(row.third_party_cost),
            totalCost: parseFloat(row.total_cost),
            claimStatus: row.claim_status
        };
    }

    private mapWarranty(row: any): Warranty {
        return {
            id: row.id,
            assetId: row.asset_id,
            vendorId: row.vendor_id,
            warrantyType: row.warranty_type,
            coverageScope: row.coverage_scope,
            startDate: row.start_date,
            endDate: row.end_date,
            maxHours: row.max_hours ? parseFloat(row.max_hours) : undefined,
            currentHours: parseFloat(row.current_hours),
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
            currentHours: row.current_hours
        };
    }

    private async updateBudgetActuals(costCenterId: string, amount: number): Promise<void> {
        const year = new Date().getFullYear();

        await supabase
            .from('budgets')
            .update({ actual: supabase.rpc('increment_budget_actual', { amount }) })
            .eq('cost_center_id', costCenterId)
            .eq('fiscal_year', year);
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
        const { error: ccErr } = await supabase.from('cost_centers').upsert([
            { id: 'c0cc4738-9c0b-4ef8-bb6d-6bb9bd380c01', code: 'CC-MNT-01', name: 'Plant Maintenance', cost_center_type: 'MAINTENANCE', description: 'Core maintenance team budget', active: true },
            { id: 'c0cc4738-9c0b-4ef8-bb6d-6bb9bd380c02', code: 'CC-OPS-01', name: 'Plant Operations', cost_center_type: 'OPERATIONS', description: 'Production usage and consumables', active: true },
            { id: 'c0cc4738-9c0b-4ef8-bb6d-6bb9bd380c03', code: 'CC-ADM-01', name: 'Corporate Admin', cost_center_type: 'ADMINISTRATION', description: 'HQ Overhead and IT', active: true }
        ], { onConflict: 'code' });
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
