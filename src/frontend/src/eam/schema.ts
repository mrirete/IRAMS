/**
 * DATABASE SCHEMA DEFINITION
 * 
 * This file represents the "Single Source of Truth" database schema.
 * All backend services must interact with these types, not the UI types directly.
 * 
 * Adherence to ISO 14224 and ISO 55000 Standards.
 */

// --- Enums (Mapped to Database Enums) ---

export type HierarchyLevel = 'SITE' | 'UNIT' | 'SYSTEM' | 'EQUIPMENT' | 'COMPONENT';
export type Criticality = 'A' | 'B' | 'C';
export type WorkOrderStatusDB = 'OPEN' | 'PLAN' | 'SCHED' | 'WIP' | 'WAIT' | 'TECO' | 'CLOSED' | 'CANC' | 'CANCELLED';
export type RequestStatusDB = 'NEW' | 'REVIEW' | 'AUTHORIZED' | 'APPROVED' | 'REJECTED' | 'CONVERTED';

// --- TABLE: users ---
export interface UserRecord {
    id: string; // UUID
    username: string;
    email: string;
    contact_id: string; // FK -> contacts.id
    status: 'active' | 'suspended';
    roles: string[]; // JSONB Array
    password?: string; // Mock password
    mfaEnabled?: boolean; // Added
    permissionOverrides?: any; // JSONB: Partial<Record<ModuleName, Partial<ModulePermissions>>>
    dataScopeOverrides?: any; // JSONB: Partial<DataScope>
    created_at: string;
    updated_at: string;
}

// --- TABLE: dictionaries (Governance) ---
export interface DictionaryRecord {
    id: string;
    type: string;
    code: string;
    description: string;
    is_locked: boolean; // Governance Lock
    active?: boolean; // UI Active Status

    // Extended properties (JSONB in SQL, Fields in NoSQL)
    permissions?: any;
    dataScope?: any;
    hourlyRate?: number;
    isManufacturer?: boolean;
    categoryCode?: string;
    suppression?: number;
    category_ref?: string; // Classification hierarchy reference
    categoryRef?: string; // Mapped for UI (CamelCase)
    locked?: boolean;

    updated_at: string;
}

// --- TABLE: assets (ISO 14224) ---
export interface AssetRecord {
    id: string;
    tag: string;
    name: string;
    parent_id: string | null; // Adjacency List for Hierarchy
    hierarchy_level: HierarchyLevel;
    criticality: Criticality;
    status_code: string; // FK -> dictionaries.code
    asset_type_code?: string; // FK -> dictionaries.code (ASSET_TYPE)
    asset_category?: string; // FK -> dictionaries.code (ASSET_CATEGORY)
    asset_class?: string; // FK -> dictionaries.code (ASSET_CLASS)
    location_id?: string;

    cost_center_id?: string;

    // Internal Equipment Number (SAP PM parity)
    equipment_number?: string;      // Auto-generated: EQ-NNNNNN
    equipment_generation?: number;  // Replacement counter (1 = original, 2+ = replacement)

    // Physical Specs
    manufacturer?: string;
    model?: string;
    serial_number?: string;

    properties?: any; // JSONB for BOM, Specs, etc.

    created_at: string;
    updated_at: string;
}

// --- TABLE: service_requests ---
export interface ServiceRequestRecord {
    id: string; // UUID
    request_number: string; // Sequence
    status: RequestStatusDB;
    description: string;

    // Foreign Keys
    asset_id: string;
    requester_id: string; // User ID
    functional_failure_id: string; // FK -> dictionaries (ISO 14224)

    // AI / Risk
    risk_score: number;

    rejection_reason?: string; // Reason for rejection
    is_breakdown?: boolean;
    category?: string; // SAP QMKAT — Notification Category (Mechanical, Electrical, etc.)

    // Authorization stamps (GAP-7: governance evidence)
    authorized_by?: string; // UUID of authorizing user
    authorized_at?: string; // Timestamp of authorization

    work_center_id?: string | null; // 0178 — responsible work group (SAP Main Work Center)

    created_at: string;
    updated_at: string;
}

// --- TABLE: work_orders ---
export interface WorkOrderRecord {
    id: string; // UUID
    wo_number: string; // Human Readable
    title: string;
    description: string;
    status: WorkOrderStatusDB;
    type: string; // 'CM', 'PM'
    priority_code: string; // FK -> dictionaries
    cost_center_id?: string; // FK -> cost_centers
    properties?: any; // JSONB for flexible flags

    // Relationships
    asset_id: string;
    request_id?: string; // One-to-One (Origin)
    parent_wo_id?: string;
    recurring_work_id?: string; // Source PM that generated this WO

    // Financial Locking (The "Freeze")
    cost_frozen: boolean;
    frozen_labor_cost: number | null; // Snapshot
    frozen_material_cost: number | null; // Snapshot

    // Scheduling (New Fields)
    due_date?: string; // Scheduled Finish (ISO)
    date_due_start?: string; // Scheduled Start (ISO)
    est_duration?: number; // Elapsed hours
    assigned_to?: string; // FK -> contacts.id (Assigned Technician)

    created_by: string;
    created_at: string;
    updated_at: string;
    closed_at?: string;
}

// --- TABLE: wo_failure_data (Closing) ---
export interface WorkOrderFailureDataRecord {
    wo_id: string; // PK/FK
    failure_mode_code: string;
    failure_cause_code: string;
    remedy_code: string;
    comments?: string;
    local_impact?: string;      // Local failure effect (equipment level)
    plant_wide_impact?: string; // Plant-wide failure effect (production/safety/env)
}

// --- TABLE: inventory_items ---
export interface InventoryItemRecord {
    id: string;
    material_number: string; // MAT-NNNNNN (auto-generated)
    part_number: string;
    description: string;
    type: string; // e.g., 'SPARE', 'ASSET', 'CONSUMABLE'
    uom: string; // e.g., 'EA', 'KG'
    cost_center_id?: string; // FK -> cost_centers
    manufacturer?: string;
    model?: string;

    // Costing & Levels
    unit_cost: number; // Current Moving Average
    stock_on_hand: number;
    min_level: number;
    max_level: number;

    // Financials & Lifecycle (Added Migration 0045)
    default_warranty_months?: number;
    warranty_from_install?: boolean;
    is_capital_spare?: boolean;
    shelf_life_days?: number;
    depreciation_method?: string;
    salvage_value?: number;

    // Status
    is_active: boolean;
    is_critical: boolean;

    // Metadata
    image_url?: string;
    comments?: string;
    properties?: any; // JSONB for custom fields
}

// --- TABLE: asset_bom --- (BOM Junction: Asset ↔ Material Master)
export interface AssetBomRecord {
    id: string;
    asset_id: string;
    inventory_item_id?: string;  // NULL = Text BOM (real component, not individually purchased)
    part_number?: string;
    description: string;
    quantity: number;
    uom: string;
    is_critical: boolean;
    estimated_cost: number;
    replacement_interval_days?: number;
    notes?: string;
    created_at: string;
    updated_at: string;
}

// --- TABLE: inventory_transactions (Audit) ---
export interface InventoryTransactionRecord {
    id: string;
    item_id: string;
    transaction_type: 'ISSUE' | 'RECEIPT' | 'ADJUST' | 'RETURN';
    quantity: number;
    cost_at_time: number; // Snapshot of unit_cost
    wo_id?: string;
    po_id?: string;
    performed_by: string;
    timestamp: string;
}

// --- TABLE: reading_definitions ---
export interface ReadingDefinitionRecord {
    id: string;
    asset_id: string; // FK -> assets.id
    reading_type_code: string; // FK -> dictionaries.code
    name: string;
    unit?: string;
    category: 'METER' | 'CONDITION';

    min_critical?: number;
    min_warning?: number;
    max_warning?: number;
    max_critical?: number;

    is_active: boolean;
    created_at: string;
    updated_at: string;
}

// --- TABLE: reading_logs ---
export interface ReadingLogRecord {
    id: string;
    definition_id: string; // FK -> reading_definitions.id
    asset_id: string;
    reading_type_code: string;
    reading_date: string;
    reading_time: string;
    reading_value: number; // NOTE: SQL uses 'reading_value', UI uses 'value'. Check setup_readings.sql
    delta?: number;
    entered_by: string;
    is_active: boolean;
    is_alarm: boolean;
    comments?: string;
}

// --- TABLE: purchase_orders ---
export interface PurchaseOrderRecord {
    id: string;
    po_code: string;
    status: string;
    supplier_id: string;
    date_created: string;
    date_required: string;
    tax_inclusive: boolean;
    currency: string;
    created_by: string;
    items: any[]; // JSONB
    date_finished?: string;
    supplier_contact_name?: string;
    delivery_contact_id?: string;
    invoice_contact_id?: string;
    reference?: string;
    comments?: string;
    authorized_by_id?: string;
}

// --- TABLE: recurring_work ---
export interface RecurringWorkRecord {
    id: string;
    title: string;
    asset_id: string;
    frequency_type: 'DAYS' | 'WEEKS' | 'MONTHS' | 'HOURS';
    interval: number;
    next_due_date: string;
    assigned_to?: string;
    description?: string;
    priority_code?: string;
    job_type_code?: string;
    active: boolean;
    // Canonical recurring_work columns (the DB requires schedule_type/frequency_interval/
    // frequency_unit/job_type NOT NULL). frequency_type/interval/job_type_code above are
    // legacy aliases readers still tolerate via `|| frequency_unit`; writers MUST set these.
    code?: string;
    status?: string;
    schedule_type?: string; // 'TIME' | 'READING'
    frequency_interval?: number;
    frequency_unit?: string;
    lead_time_days?: number;
    job_type?: string;
    est_duration?: number;
    est_downtime?: number;
    created_by?: string;
    // Multi-asset ("route" / class) PM — one program applied across several assets.
    assigned_assets?: { assetId: string; lastCompletedDate?: string; lastReadingValue?: number }[];
    templates?: {
        tasks: any[];
        jsa: any;
        labor: any[];
        inventory: any[];
    };
    // Failure Effects (ISO 14224 §B.2.5)
    local_impact?: string;
    plant_wide_impact?: string;
}

// --- TABLE: work_order_labor ---
export interface WorkOrderLaborRecord {
    id: string;
    wo_id: string;
    contact_id: string; // FK -> contacts/users
    contact_type_code: string; // FK -> dictionaries
    hours_worked: number;
    rate_per_hour: number;
    date_worked: string;
    headcount: number; // Number of people required for this craft role (ISO 14224 resource planning) — DEFAULT 1
    is_lead: boolean; // Lead craft designation — accountable for task quality and sign-off — DEFAULT FALSE
    created_at: string;
    cost_center_id?: string; // FK -> cost_centers
}

// --- TABLE: work_order_parts ---
export interface WorkOrderPartRecord {
    id: string;
    wo_id: string;
    item_id?: string; // FK -> inventory_items
    notes: string; // Fallback or override
    quantity: number;
    unit_cost: number;
    date_used: string;
    cost_center?: string;
}

// --- TABLE: work_order_files ---
export interface WorkOrderFileRecord {
    id: string;
    wo_id: string;
    name: string;
    url: string;
    type: string;
    uploaded_by: string;
    uploaded_at: string;
}

// --- TABLE: jsa_assessments ---
export interface JSARecord {
    id: string;
    wo_id: string;
    status: 'DRAFT' | 'REVIEW' | 'AUTHORIZED';
    created_by: string;
    authorized_by?: string;
    authorized_at?: string;
    updated_at: string;
    permits: string[]; // JSON Array
}

// --- TABLE: jsa_hazards ---
export interface JSAHazardRecord {
    id: string;
    jsa_id: string;
    hazard: string;
    risk_score: string;
    controls: string;
}

// --- TABLE: audit_logs ---
export interface AuditLogRecord {
    id: string;
    table_name: string;
    record_id: string;
    action: 'INSERT' | 'UPDATE' | 'DELETE';
    changed_by: string;
    timestamp: string;
    changes: string; // JSON String of {old, new}
}

// --- TABLE: notification_rules ---
export interface NotificationRuleRecord {
    id: string;
    name: string;
    description?: string;
    module: string;
    event_trigger: string;
    is_active: boolean;
    severity: 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL';
    filters: any[]; // JSONB
    recipients: any[]; // JSONB
    channels: string[]; // JSONB
    escalation_timeout_minutes: number;
    created_at: string;
    updated_at: string;
}

// --- TABLE: notification_channels ---
export interface NotificationChannelRecord {
    id: string;
    type: string;
    is_active: boolean;
    config_json: any;
    created_at: string;
    updated_at: string;
}

// --- TABLE: message_templates ---
export interface MessageTemplateRecord {
    id: string;
    name: string;
    trigger_event: string;
    channel_type: string;
    subject_template?: string;
    body_template?: string;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

// --- TABLE: notification_logs ---
export interface NotificationLogRecord {
    id: string;
    recipient_id?: string;
    channel: string;
    subject?: string;
    body?: string;
    status: string;
    error_message?: string;
    metadata?: any;
    created_at: string;
}

// --- TABLE: warranties ---
export interface WarrantyRecord {
    id: string;
    asset_id: string;
    vendor_id?: string;
    warranty_type: string;
    coverage_scope?: string;
    start_date: string;
    end_date?: string;
    max_hours?: number;
    current_hours: number;
    status: string;
    created_at: string;
    updated_at: string;
}

// --- TABLE: warranty_claims ---
export interface WarrantyClaimRecord {
    id: string;
    claim_number: string;
    warranty_id: string;
    work_order_id?: string;
    claim_date: string;
    failure_description?: string;
    claim_type: string;
    total_claim_amount: number;
    status: string;
    created_at: string;
    updated_at: string;
}

// --- TABLE: asset_insurance ---
export interface AssetInsuranceRecord {
    id: string;
    asset_id: string;
    policy_number: string;
    provider: string;
    coverage_type?: string;
    start_date: string;
    end_date: string;
    premium_amount: number;
    insured_value: number;
    deductible: number;
    status: string;
    created_at: string;
    updated_at: string;
}

// --- TABLE: insurance_incidents ---
export interface InsuranceIncidentRecord {
    id: string;
    incident_number: string;
    asset_id: string;
    insurance_policy_id?: string;
    work_order_id?: string;
    incident_date: string;
    incident_type: string;
    description?: string;
    estimated_damage: number;
    labor_cost: number;
    material_cost: number;
    third_party_cost: number;
    total_cost: number;
    claim_status: string;
    created_at: string;
    updated_at: string;
}
