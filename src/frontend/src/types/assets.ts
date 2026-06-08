// ═══════════════════════════════════════════════════════════════════════
//  Asset Types — ISO 14224 Taxonomy & EAM Asset Register
// ═══════════════════════════════════════════════════════════════════════

/** ISO 14224 hierarchy levels (L1–L7) */
export type TaxonomyLevel = 'enterprise' | 'site' | 'unit' | 'system' | 'equipment' | 'subunit' | 'component';

/** Criticality ranking — 5-tier (ISO 14224 / API 580) */
export type CriticalityRank = 'A' | 'B' | 'C' | 'D' | 'E';

/** Asset operational status */
export type AssetStatus = 'operating' | 'standby' | 'under_maintenance' | 'decommissioned' | 'mothballed';

/** Equipment class (ISO 14224 typical) */
export type EquipmentClass =
    | 'rotating' | 'static_pressure' | 'electrical' | 'instrument'
    | 'piping' | 'structural' | 'safety' | 'control' | 'other';

/** ISO 14224 Table A.1 — Equipment Type (top-level classification) */
export type EquipmentType =
    | 'mechanical' | 'electrical' | 'instrument' | 'structural'
    | 'piping' | 'safety_system' | 'subsea';

/** Maintenance strategy basis (RCM / ISO 55000) */
export type MaintenanceStrategy =
    | 'rcm' | 'rbi' | 'pm_optimization' | 'run_to_failure'
    | 'condition_based' | 'predictive' | 'not_assigned';

/** Risk Priority Number auto-calculated */
export interface RiskPriority {
    rpn: number;
    consequence: number; // 1-5
    probability: number; // 1-5
    detectability: number; // 1-5
}

/** Condition rating */
export type ConditionRating = 1 | 2 | 3 | 4 | 5;

/** ISO 14224 §7.3 — Design/Nameplate data (optional) */
export interface DesignData {
    rated_power_kw?: number;
    design_pressure_bar?: number;
    design_temperature_c?: number;
    material_class?: string;        // e.g. "CS", "SS316", "Duplex"
    weight_kg?: number;
}

/** ISO 14224 §7.4 — Operating context (optional) */
export interface OperatingContext {
    service_medium?: string;        // e.g. "Natural Gas", "Crude Oil", "Seawater"
    operating_mode?: 'continuous' | 'intermittent' | 'standby' | 'seasonal';
    environment?: 'onshore' | 'offshore' | 'subsea' | 'desert' | 'arctic';
}

/** A hierarchy node in the ISO 14224 functional location tree */
export interface HierarchyNode {
    id: string;
    name: string;
    code: string;       // Short code, e.g. "ALPHA", "GAS-PROC"
    level: TaxonomyLevel;
    parent_id: string | null;
    description: string;
    children_count: number;
}

/** An asset in the register */
export interface Asset {
    id: string;
    tag: string;               // e.g. "K-601"
    name: string;              // e.g. "Gas Compressor K-601"
    description: string;
    taxonomy_level: TaxonomyLevel;
    parent_id: string | null;

    // Location & hierarchy
    site: string;
    unit: string;
    system: string;
    functional_location: string;   // e.g. "SITE-A > GAS PROCESSING > COMPRESSION"

    // Classification — ISO 14224 Table A.1 (G1, G2)
    equipment_type: EquipmentType;
    equipment_class: EquipmentClass;
    equipment_category: string;    // e.g. "centrifugal_compressor", "shell_and_tube"
    criticality: CriticalityRank;
    criticality_method: 'manual' | 'calculated';  // G5
    status: AssetStatus;
    maintenance_strategy: MaintenanceStrategy;     // G6

    // Design & Operating data — ISO 14224 §7.3/§7.4 (G3, G4)
    design_data?: DesignData;
    operating_context?: OperatingContext;

    // Dates
    install_date: string;
    warranty_expiry: string | null;
    last_overhaul: string | null;

    // Condition & Performance
    condition_rating: ConditionRating;
    health_index: number;         // 0–100
    rul_days: number | null;
    risk_priority: RiskPriority;

    // Operational
    running_hours: number;
    mtbf_days: number | null;
    mttr_hours: number | null;
    failure_count_ytd: number;
    wo_count_ytd: number;
    cost_ytd: number;

    // Metadata
    manufacturer: string;
    model: string;
    serial_number: string;

    // Children count (for hierarchy)
    children_count: number;
}

/** Summary metrics for the register */
export interface AssetRegisterSummary {
    total_assets: number;
    operating_count: number;
    maintenance_count: number;
    crit_a_count: number;
    crit_b_count: number;
    crit_c_count: number;
    crit_d_count: number;
    crit_e_count: number;
    avg_health: number;
    overdue_pm_count: number;
    total_replacement_value: number;
}

/** Hierarchy tree node */
export interface AssetTreeNode {
    id: string;
    tag: string;
    name: string;
    taxonomy_level: TaxonomyLevel;
    criticality: CriticalityRank;
    status: AssetStatus;
    health_index: number;
    children: AssetTreeNode[];
    expanded?: boolean;
}

/** Form for registering a new asset */
export interface NewAssetForm {
    tag: string;
    name: string;
    description: string;
    site: string;
    unit: string;
    system: string;
    parent_id: string;
    // ISO 14224 classification (G1, G2)
    equipment_type: EquipmentType;
    equipment_class: EquipmentClass;
    equipment_category: string;
    criticality: CriticalityRank;
    maintenance_strategy: MaintenanceStrategy;  // G6
    // Nameplate
    manufacturer: string;
    model: string;
    serial_number: string;
    install_date: string;
    // Optional advanced data (G3, G4)
    design_data?: DesignData;
    operating_context?: OperatingContext;
}

// ═══════════════════════════════════════════════════════════════════════
//  Label maps for UI rendering
// ═══════════════════════════════════════════════════════════════════════

export const CRITICALITY_LABELS: Record<CriticalityRank, string> = {
    A: 'Safety Critical',
    B: 'Production Significant',
    C: 'Standard',
    D: 'Low Impact',
    E: 'Run-to-Failure',
};

export const EQUIPMENT_TYPE_LABELS: Record<EquipmentType, string> = {
    mechanical: 'Mechanical',
    electrical: 'Electrical',
    instrument: 'Instrument',
    structural: 'Structural',
    piping: 'Piping',
    safety_system: 'Safety System',
    subsea: 'Subsea',
};

export const MAINTENANCE_STRATEGY_LABELS: Record<MaintenanceStrategy, string> = {
    rcm: 'RCM (Reliability Centered)',
    rbi: 'RBI (Risk-Based Inspection)',
    pm_optimization: 'PM Optimization',
    run_to_failure: 'Run-to-Failure',
    condition_based: 'Condition-Based',
    predictive: 'Predictive',
    not_assigned: 'Not Assigned',
};

export const OPERATING_MODE_LABELS: Record<NonNullable<OperatingContext['operating_mode']>, string> = {
    continuous: 'Continuous',
    intermittent: 'Intermittent',
    standby: 'Standby',
    seasonal: 'Seasonal',
};

export const ENVIRONMENT_LABELS: Record<NonNullable<OperatingContext['environment']>, string> = {
    onshore: 'Onshore',
    offshore: 'Offshore',
    subsea: 'Subsea',
    desert: 'Desert',
    arctic: 'Arctic',
};

// ═══════════════════════════════════════════════════════════════════════
//  Criticality auto-suggest from RPN (G5 — HITL advisor)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Maps a Risk Priority Number to a suggested CriticalityRank.
 * Thresholds based on API 580 / industry practice:
 *   RPN 80–125 → A (Safety Critical)
 *   RPN 50–79  → B (Production Significant)
 *   RPN 25–49  → C (Standard)
 *   RPN 10–24  → D (Low Impact)
 *   RPN  1–9   → E (Run-to-Failure)
 */
export function suggestCriticalityFromRPN(rpn: number): CriticalityRank {
    if (rpn >= 80) return 'A';
    if (rpn >= 50) return 'B';
    if (rpn >= 25) return 'C';
    if (rpn >= 10) return 'D';
    return 'E';
}

// ═══════════════════════════════════════════════════════════════════════
//  FAILURE EVENTS — ISO 14224 §9 Failure Data
// ═══════════════════════════════════════════════════════════════════════

/** Standardised failure modes per ISO 14224 Table A.4 */
export type FailureMode =
    | 'abnormal_vibration' | 'overheating' | 'leakage_external' | 'leakage_internal'
    | 'failure_to_start' | 'failure_to_stop' | 'low_output' | 'high_output'
    | 'erratic_output' | 'structural_deficiency' | 'abnormal_noise'
    | 'contamination' | 'corrosion_erosion' | 'fatigue_fracture' | 'other';

/** Standardised failure causes per ISO 14224 Table A.5 */
export type FailureCause =
    | 'wear' | 'corrosion' | 'erosion' | 'fatigue' | 'overload'
    | 'contamination' | 'incorrect_installation' | 'design_deficiency'
    | 'manufacturing_defect' | 'electrical_fault' | 'instrument_failure'
    | 'operator_error' | 'inadequate_maintenance' | 'unknown' | 'other';

/** Standardised remedies per ISO 14224 Table A.6 */
export type Remedy =
    | 'repair' | 'replace' | 'modify' | 'adjust' | 'reset'
    | 'clean' | 'overhaul' | 'no_action' | 'other';

/** Individual failure event record */
export interface FailureEvent {
    id: string;
    asset_id: string;
    wo_id?: string;                  // linked work order
    start_time: string;              // ISO datetime — failure start
    end_time: string;                // ISO datetime — asset restored
    downtime_hours: number;          // end - start
    failure_mode: FailureMode;
    failure_cause: FailureCause;
    remedy: Remedy;
    severity: 1 | 2 | 3 | 4 | 5;   // 1=minor, 5=catastrophic
    description: string;
    cost: number;
    detected_by: 'operator' | 'condition_monitoring' | 'inspection' | 'alarm' | 'other';
    is_planned: boolean;             // false = unplanned/breakdown
}

// ═══════════════════════════════════════════════════════════════════════
//  SMRP RELIABILITY KPIs — Calculated from FailureEvent data
// ═══════════════════════════════════════════════════════════════════════

export interface ReliabilityKPI {
    code: string;      // SMRP metric code (e.g. '5.1.2')
    name: string;
    value: number;
    target: number;
    unit: string;
    trend: 'up' | 'down' | 'flat';
    status: 'good' | 'warning' | 'critical';
}

/** Label maps for failure taxonomy */
export const FAILURE_MODE_LABELS: Record<FailureMode, string> = {
    abnormal_vibration: 'Abnormal Vibration', overheating: 'Overheating',
    leakage_external: 'External Leakage', leakage_internal: 'Internal Leakage',
    failure_to_start: 'Failure to Start', failure_to_stop: 'Failure to Stop',
    low_output: 'Low Output', high_output: 'High Output',
    erratic_output: 'Erratic Output', structural_deficiency: 'Structural Deficiency',
    abnormal_noise: 'Abnormal Noise', contamination: 'Contamination',
    corrosion_erosion: 'Corrosion/Erosion', fatigue_fracture: 'Fatigue/Fracture', other: 'Other',
};

export const FAILURE_CAUSE_LABELS: Record<FailureCause, string> = {
    wear: 'Wear', corrosion: 'Corrosion', erosion: 'Erosion', fatigue: 'Fatigue',
    overload: 'Overload', contamination: 'Contamination',
    incorrect_installation: 'Incorrect Installation', design_deficiency: 'Design Deficiency',
    manufacturing_defect: 'Manufacturing Defect', electrical_fault: 'Electrical Fault',
    instrument_failure: 'Instrument Failure', operator_error: 'Operator Error',
    inadequate_maintenance: 'Inadequate Maintenance', unknown: 'Unknown', other: 'Other',
};

export const REMEDY_LABELS: Record<Remedy, string> = {
    repair: 'Repair', replace: 'Replace', modify: 'Modify', adjust: 'Adjust',
    reset: 'Reset', clean: 'Clean', overhaul: 'Overhaul',
    no_action: 'No Action', other: 'Other',
};
