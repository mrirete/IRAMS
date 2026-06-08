-- =====================================================
-- FinOps Core Module - Database Schema
-- The Financial Digital Twin of Physical Assets
-- =====================================================
-- Integrates with: Assets, Work Orders, Inventory, POs, Vendors
-- SAP-Ready: Uses standard SAP field naming conventions where applicable

-- =====================================================
-- 1. COST CENTER & BUDGET CONTROL (The "Wallet")
-- =====================================================

-- Cost Centers (SAP: CSKS)
CREATE TABLE IF NOT EXISTS cost_centers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) NOT NULL UNIQUE,  -- SAP: KOSTL
    name VARCHAR(100) NOT NULL,
    description TEXT,
    parent_id UUID REFERENCES cost_centers(id) ON DELETE SET NULL,
    company_code VARCHAR(4) DEFAULT '1000',  -- SAP: BUKRS
    controlling_area VARCHAR(4) DEFAULT 'A000',  -- SAP: KOKRS
    profit_center VARCHAR(10),  -- SAP: PRCTR
    cost_center_type VARCHAR(20) DEFAULT 'MAINTENANCE',  -- MAINTENANCE, PROJECT, OVERHEAD
    responsible_person_id UUID,  -- Soft FK to contacts/users
    valid_from DATE DEFAULT CURRENT_DATE,
    valid_to DATE,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- WBS Elements (Work Breakdown Structure) - For project costing (SAP: PRPS)
CREATE TABLE IF NOT EXISTS wbs_elements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(24) NOT NULL UNIQUE,  -- SAP: POSID
    name VARCHAR(100) NOT NULL,
    description TEXT,
    parent_id UUID REFERENCES wbs_elements(id) ON DELETE SET NULL,
    project_id VARCHAR(24),  -- SAP: PSPID
    cost_center_id UUID REFERENCES cost_centers(id),
    wbs_type VARCHAR(20) DEFAULT 'CAPEX',  -- CAPEX, OPEX, OVERHEAD
    budget_profile VARCHAR(10),
    status VARCHAR(20) DEFAULT 'ACTIVE',  -- ACTIVE, CLOSED, LOCKED
    start_date DATE,
    end_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Budgets (Annual/Periodic)
CREATE TABLE IF NOT EXISTS budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cost_center_id UUID REFERENCES cost_centers(id),
    wbs_element_id UUID REFERENCES wbs_elements(id),
    fiscal_year INTEGER NOT NULL,
    period VARCHAR(10) DEFAULT 'ANNUAL',  -- ANNUAL, Q1, Q2, Q3, Q4, M01-M12
    opex_budget DECIMAL(15,2) DEFAULT 0,
    capex_budget DECIMAL(15,2) DEFAULT 0,
    committed DECIMAL(15,2) DEFAULT 0,  -- POs issued but not received
    actual DECIMAL(15,2) DEFAULT 0,  -- Actually spent
    currency VARCHAR(3) DEFAULT 'USD',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_budget_entity CHECK (cost_center_id IS NOT NULL OR wbs_element_id IS NOT NULL)
);

-- Budget Availability Control (SAP: AVC)
CREATE TABLE IF NOT EXISTS budget_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    budget_id UUID REFERENCES budgets(id) ON DELETE CASCADE,
    block_type VARCHAR(10) NOT NULL,  -- HARD, SOFT, WARN
    threshold_pct DECIMAL(5,2) NOT NULL,  -- e.g., 80%, 100%, 110%
    action VARCHAR(20) DEFAULT 'BLOCK',  -- BLOCK, WARN, NOTIFY
    requires_override_role VARCHAR(50),  -- Role required to override
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cost Allocations (Links WOs to Cost Centers)
CREATE TABLE IF NOT EXISTS cost_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID,  -- Soft FK to work_orders
    cost_center_id UUID REFERENCES cost_centers(id),
    wbs_element_id UUID REFERENCES wbs_elements(id),
    cost_type VARCHAR(20) NOT NULL,  -- LABOR, MATERIAL, SERVICE, OVERHEAD
    amount DECIMAL(15,2) NOT NULL,
    quantity DECIMAL(10,3),
    unit VARCHAR(10),
    posting_date DATE DEFAULT CURRENT_DATE,
    document_number VARCHAR(20),  -- For SAP integration
    reversal_id UUID REFERENCES cost_allocations(id),  -- For reversals
    created_by UUID,  -- Soft FK to auth.users
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 2. ASSET ACCOUNTING & DYNAMIC DEPRECIATION
-- =====================================================

-- Asset Financial Master (SAP: ANLA)
CREATE TABLE IF NOT EXISTS asset_financials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL,  -- Soft FK to assets
    asset_class VARCHAR(10),  -- SAP: ANLKL (e.g., 3000 = Machinery)
    acquisition_cost DECIMAL(15,2) NOT NULL,
    acquisition_date DATE NOT NULL,
    capitalization_date DATE,
    residual_value DECIMAL(15,2) DEFAULT 0,
    useful_life_months INTEGER NOT NULL,
    replacement_value DECIMAL(15,2),  -- For insurance
    last_revaluation_date DATE,
    deactivation_date DATE,
    deactivation_reason VARCHAR(50),  -- SOLD, SCRAPPED, TRANSFERRED
    company_code VARCHAR(4) DEFAULT '1000',
    cost_center_id UUID REFERENCES cost_centers(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Depreciation Books (Multi-book: Corporate, Tax, Technical)
CREATE TABLE IF NOT EXISTS depreciation_books (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_financial_id UUID NOT NULL REFERENCES asset_financials(id) ON DELETE CASCADE,
    book_type VARCHAR(20) NOT NULL,  -- CORPORATE, TAX, TECHNICAL, IFRS
    depreciation_method VARCHAR(20) NOT NULL,  -- STRAIGHT_LINE, DECLINING_BALANCE, UNITS_OF_PRODUCTION
    depreciation_key VARCHAR(10),  -- SAP: AFABE
    current_value DECIMAL(15,2) NOT NULL,
    accumulated_depreciation DECIMAL(15,2) DEFAULT 0,
    start_date DATE NOT NULL,
    last_depreciation_date DATE,
    -- For Technical Book (IoT-based)
    usage_based BOOLEAN DEFAULT false,
    designed_hours INTEGER,  -- e.g., 100,000 hours
    current_hours INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(asset_financial_id, book_type)
);

-- Depreciation Schedule (Monthly/Periodic runs)
CREATE TABLE IF NOT EXISTS depreciation_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id UUID NOT NULL REFERENCES depreciation_books(id) ON DELETE CASCADE,
    fiscal_year INTEGER NOT NULL,
    period INTEGER NOT NULL,  -- 1-12
    depreciation_amount DECIMAL(15,2) NOT NULL,
    opening_value DECIMAL(15,2) NOT NULL,
    closing_value DECIMAL(15,2) NOT NULL,
    run_date TIMESTAMPTZ DEFAULT NOW(),
    posted BOOLEAN DEFAULT false,
    posting_document VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 3. WARRANTY & CLAIMS INTELLIGENCE
-- =====================================================

-- Warranties (Hybrid: Time + Performance based)
CREATE TABLE IF NOT EXISTS warranties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL,  -- Soft FK to assets
    vendor_id UUID,  -- Soft FK to vendors table (if exists)
    warranty_type VARCHAR(20) NOT NULL,  -- OEM, EXTENDED, SERVICE_CONTRACT
    coverage_scope TEXT,  -- What's covered
    exclusions TEXT,  -- What's excluded
    -- Time-based coverage
    start_date DATE NOT NULL,
    end_date DATE,
    -- Performance-based coverage
    max_hours INTEGER,
    current_hours INTEGER DEFAULT 0,
    max_cycles INTEGER,
    current_cycles INTEGER DEFAULT 0,
    -- Financial
    warranty_value DECIMAL(15,2),
    deductible DECIMAL(15,2) DEFAULT 0,
    -- Status
    status VARCHAR(20) DEFAULT 'ACTIVE',  -- ACTIVE, EXPIRED, CLAIMED, VOIDED
    reminder_days INTEGER DEFAULT 30,  -- Days before expiry to notify
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Warranty Claims
CREATE TABLE IF NOT EXISTS warranty_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_number VARCHAR(20) NOT NULL UNIQUE,
    warranty_id UUID NOT NULL REFERENCES warranties(id),
    work_order_id UUID,  -- Soft FK to work_orders
    claim_date DATE DEFAULT CURRENT_DATE,
    failure_description TEXT NOT NULL,
    claim_type VARCHAR(20) NOT NULL,  -- REPAIR, REPLACEMENT, CREDIT
    -- Parts claimed
    parts_claimed JSONB,  -- [{partId, partName, qty, cost}]
    labor_claimed DECIMAL(10,2) DEFAULT 0,
    total_claim_amount DECIMAL(15,2) NOT NULL,
    -- Vendor response
    vendor_reference VARCHAR(50),
    vendor_response_date DATE,
    approved_amount DECIMAL(15,2),
    rejection_reason TEXT,
    -- Status workflow
    status VARCHAR(20) DEFAULT 'DRAFT',  -- DRAFT, SUBMITTED, APPROVED, REJECTED, CREDITED
    submitted_by UUID,  -- Soft FK to auth.users
    submitted_at TIMESTAMPTZ,
    approved_by UUID,  -- Soft FK to auth.users
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 4. SUPPLY CHAIN FINANCE & TAXATION
-- =====================================================

-- Goods Receipt Notes (SAP: EKBE)
CREATE TABLE IF NOT EXISTS goods_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_number VARCHAR(20) NOT NULL UNIQUE,
    po_id UUID,  -- Soft FK to purchase_orders table (if exists)
    po_line_item INTEGER,
    inventory_id UUID,  -- Soft FK to inventory_items
    received_date DATE DEFAULT CURRENT_DATE,
    received_by UUID,  -- Soft FK to auth.users
    quantity DECIMAL(10,3) NOT NULL,
    unit_cost DECIMAL(15,4) NOT NULL,
    total_cost DECIMAL(15,2) NOT NULL,
    storage_location VARCHAR(20),
    batch_number VARCHAR(20),
    -- Quality
    inspection_required BOOLEAN DEFAULT false,
    inspection_status VARCHAR(20),  -- PENDING, PASSED, FAILED
    -- Variance from PO
    variance_qty DECIMAL(10,3) DEFAULT 0,
    variance_cost DECIMAL(15,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Invoice Matching (Three-Way Match: PO + GRN + Invoice)
CREATE TABLE IF NOT EXISTS invoice_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number VARCHAR(50) NOT NULL,
    vendor_id UUID,  -- Soft FK to vendors table (if exists)
    invoice_date DATE NOT NULL,
    invoice_amount DECIMAL(15,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    -- Matching references
    po_id UUID,  -- Soft FK to purchase_orders table (if exists)
    grn_id UUID REFERENCES goods_receipts(id),
    -- Match result
    match_status VARCHAR(20) DEFAULT 'PENDING',  -- PENDING, MATCHED, VARIANCE, BLOCKED
    po_amount DECIMAL(15,2),
    grn_amount DECIMAL(15,2),
    variance_amount DECIMAL(15,2),
    tolerance_exceeded BOOLEAN DEFAULT false,
    -- Payment
    payment_block VARCHAR(20),  -- PRICE, QUALITY, QUANTITY
    payment_due_date DATE,
    payment_date DATE,
    payment_reference VARCHAR(50),
    -- Audit
    matched_by UUID,  -- Soft FK to auth.users
    matched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tax Codes
CREATE TABLE IF NOT EXISTS tax_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(10) NOT NULL UNIQUE,
    description VARCHAR(100) NOT NULL,
    tax_type VARCHAR(20) NOT NULL,  -- VAT, GST, SALES_TAX, WHT
    rate DECIMAL(5,2) NOT NULL,  -- Percentage
    jurisdiction VARCHAR(50),  -- Country/State
    applies_to VARCHAR(20),  -- MATERIALS, SERVICES, BOTH
    deductible BOOLEAN DEFAULT true,
    effective_from DATE DEFAULT CURRENT_DATE,
    effective_to DATE,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Inventory Valuation History (For WAC tracking)
CREATE TABLE IF NOT EXISTS inventory_valuations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inventory_id UUID NOT NULL,  -- Soft FK to inventory_items
    valuation_date DATE NOT NULL,
    valuation_method VARCHAR(20) DEFAULT 'WAC',  -- WAC, FIFO, LIFO, STANDARD
    quantity_on_hand DECIMAL(10,3) NOT NULL,
    unit_cost DECIMAL(15,4) NOT NULL,  -- Weighted Average Cost
    total_value DECIMAL(15,2) NOT NULL,
    transaction_type VARCHAR(20),  -- RECEIPT, ISSUE, ADJUSTMENT
    transaction_ref UUID,  -- GRN or WO ID
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 5. INSURANCE & RISK MANAGEMENT
-- =====================================================

-- Asset Insurance Policies
CREATE TABLE IF NOT EXISTS asset_insurance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL,  -- Soft FK to assets
    policy_number VARCHAR(50) NOT NULL,
    insurer_name VARCHAR(100) NOT NULL,
    coverage_type VARCHAR(50),  -- ALL_RISK, FIRE, MACHINERY_BREAKDOWN
    replacement_value DECIMAL(15,2) NOT NULL,
    insured_value DECIMAL(15,2) NOT NULL,
    deductible DECIMAL(15,2) DEFAULT 0,
    premium_annual DECIMAL(15,2),
    coverage_start DATE NOT NULL,
    coverage_end DATE NOT NULL,
    policy_document_url TEXT,
    status VARCHAR(20) DEFAULT 'ACTIVE',  -- ACTIVE, EXPIRED, CANCELLED
    renewal_reminder_days INTEGER DEFAULT 60,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insurance Incidents
CREATE TABLE IF NOT EXISTS insurance_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_number VARCHAR(20) NOT NULL UNIQUE,
    asset_id UUID NOT NULL,  -- Soft FK to assets
    insurance_policy_id UUID REFERENCES asset_insurance(id),
    work_order_id UUID,  -- Soft FK to work_orders
    incident_date TIMESTAMPTZ NOT NULL,
    incident_type VARCHAR(50) NOT NULL,  -- FIRE, FLOOD, COLLISION, BREAKDOWN, THEFT
    description TEXT NOT NULL,
    location TEXT,
    -- Financial ring-fencing
    estimated_damage DECIMAL(15,2),
    labor_cost DECIMAL(15,2) DEFAULT 0,
    material_cost DECIMAL(15,2) DEFAULT 0,
    third_party_cost DECIMAL(15,2) DEFAULT 0,
    total_cost DECIMAL(15,2) DEFAULT 0,
    -- Claim
    claim_reference VARCHAR(50),
    claim_submitted_date DATE,
    claim_amount DECIMAL(15,2),
    claim_status VARCHAR(20) DEFAULT 'OPEN',  -- OPEN, SUBMITTED, UNDER_REVIEW, APPROVED, REJECTED, PAID
    settlement_amount DECIMAL(15,2),
    settlement_date DATE,
    -- Documentation
    photos JSONB,  -- [{url, description}]
    witness_statements JSONB,
    police_report_ref VARCHAR(50),
    -- Audit
    reported_by UUID,  -- Soft FK to auth.users
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_cost_centers_parent ON cost_centers(parent_id);
CREATE INDEX IF NOT EXISTS idx_cost_centers_code ON cost_centers(code);
CREATE INDEX IF NOT EXISTS idx_budgets_cost_center ON budgets(cost_center_id, fiscal_year);
CREATE INDEX IF NOT EXISTS idx_cost_allocations_wo ON cost_allocations(work_order_id);
CREATE INDEX IF NOT EXISTS idx_cost_allocations_cc ON cost_allocations(cost_center_id);
CREATE INDEX IF NOT EXISTS idx_asset_financials_asset ON asset_financials(asset_id);
CREATE INDEX IF NOT EXISTS idx_depreciation_books_asset ON depreciation_books(asset_financial_id);
CREATE INDEX IF NOT EXISTS idx_warranties_asset ON warranties(asset_id);
CREATE INDEX IF NOT EXISTS idx_warranties_status ON warranties(status);
CREATE INDEX IF NOT EXISTS idx_warranty_claims_warranty ON warranty_claims(warranty_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_po ON goods_receipts(po_id);
CREATE INDEX IF NOT EXISTS idx_invoice_matches_po ON invoice_matches(po_id);
CREATE INDEX IF NOT EXISTS idx_asset_insurance_asset ON asset_insurance(asset_id);
CREATE INDEX IF NOT EXISTS idx_insurance_incidents_asset ON insurance_incidents(asset_id);

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE cost_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE wbs_elements ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_financials ENABLE ROW LEVEL SECURITY;
ALTER TABLE depreciation_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE depreciation_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE warranties ENABLE ROW LEVEL SECURITY;
ALTER TABLE warranty_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_valuations ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_insurance ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_incidents ENABLE ROW LEVEL SECURITY;

-- Read policies (authenticated users)
CREATE POLICY "Authenticated users can view cost_centers" ON cost_centers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can view wbs_elements" ON wbs_elements FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can view budgets" ON budgets FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can view warranties" ON warranties FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can view tax_codes" ON tax_codes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can view asset_insurance" ON asset_insurance FOR SELECT TO authenticated USING (true);

-- Write policies (authenticated users - to be refined with roles)
CREATE POLICY "Authenticated users can manage cost_centers" ON cost_centers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage wbs_elements" ON wbs_elements FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage budgets" ON budgets FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage budget_blocks" ON budget_blocks FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage cost_allocations" ON cost_allocations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage asset_financials" ON asset_financials FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage depreciation_books" ON depreciation_books FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage depreciation_schedules" ON depreciation_schedules FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage warranties" ON warranties FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage warranty_claims" ON warranty_claims FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage goods_receipts" ON goods_receipts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage invoice_matches" ON invoice_matches FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage tax_codes" ON tax_codes FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage inventory_valuations" ON inventory_valuations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage asset_insurance" ON asset_insurance FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage insurance_incidents" ON insurance_incidents FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =====================================================
-- SEED DATA: TAX CODES (Common examples)
-- =====================================================

INSERT INTO tax_codes (code, description, tax_type, rate, jurisdiction, applies_to) VALUES
('V0', 'Zero Rated VAT', 'VAT', 0.00, 'GLOBAL', 'BOTH'),
('V5', 'VAT 5%', 'VAT', 5.00, 'GLOBAL', 'BOTH'),
('V7.5', 'VAT 7.5%', 'VAT', 7.50, 'NG', 'BOTH'),
('V10', 'VAT 10%', 'VAT', 10.00, 'GLOBAL', 'BOTH'),
('V20', 'VAT 20%', 'VAT', 20.00, 'UK', 'BOTH'),
('WHT5', 'Withholding Tax 5%', 'WHT', 5.00, 'NG', 'SERVICES'),
('WHT10', 'Withholding Tax 10%', 'WHT', 10.00, 'NG', 'SERVICES'),
('GST10', 'GST 10%', 'GST', 10.00, 'AU', 'BOTH')
ON CONFLICT (code) DO NOTHING;

-- =====================================================
-- SEED DATA: SAMPLE COST CENTERS
-- =====================================================

INSERT INTO cost_centers (code, name, cost_center_type, description) VALUES
('1000-MAINT', 'General Maintenance', 'MAINTENANCE', 'Default maintenance cost center'),
('1000-PROD', 'Production Operations', 'MAINTENANCE', 'Production equipment maintenance'),
('1000-UTIL', 'Utilities', 'OVERHEAD', 'Utility systems maintenance'),
('2000-PROJ', 'Capital Projects', 'PROJECT', 'Capital expenditure projects')
ON CONFLICT (code) DO NOTHING;
