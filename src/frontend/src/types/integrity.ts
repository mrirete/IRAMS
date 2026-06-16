// ═══════════════════════════════════════════════════════════════════════
//  Mechanical Integrity Types — ers-comply schema mirror
// ═══════════════════════════════════════════════════════════════════════

// ── Enums ──

export type GoverningCode = 'API 510' | 'API 570' | 'API 653' | 'ASME B31.3';
export type ComponentType = 'shell' | 'head' | 'nozzle' | 'piping_elbow' | 'piping_straight' | 'piping_tee' | 'weld' | 'tank_shell_course' | 'tank_floor' | 'tank_roof';
export type UTMethod = 'ut_contact' | 'ut_compression' | 'paut' | 'scan';
export type CorrosionRateType = 'general' | 'localized' | 'pitting';
export type DamageMechStatusType = 'active' | 'susceptible' | 'latent' | 'not_applicable';
export type DamageMechSourceType = 'ai_suggested' | 'engineer_confirmed' | 'historical';
export type FFSLevel = 'Level 1' | 'Level 2' | 'Level 3';
export type FFSPart = 'Part 4 — General Metal Loss' | 'Part 5 — Local Metal Loss' | 'Part 6 — Pitting';
export type FFSStatusType = 'in_progress' | 'passed' | 'failed' | 'remediation_required' | 'monitoring';
export type IOWType = 'critical' | 'standard' | 'informational';
export type IOWBreachStatus = 'normal' | 'alert' | 'breach';
export type InspectionType = 'UT' | 'MFL' | 'RT' | 'PT' | 'MT' | 'VT' | 'PAUT';
export type InspectionEventStatus = 'scheduled' | 'in_progress' | 'completed' | 'overdue' | 'deferred' | 'cancelled';
export type InspectionApprovalMode = 'simple' | 'two_step';
export type FindingSeverity = 'critical' | 'major' | 'moderate' | 'minor' | 'observation';
export type FindingStatus = 'open' | 'actioned' | 'deferred' | 'closed';
export type InspectionTeamRole = 'lead_inspector' | 'nde_technician' | 'engineer' | 'observer';
export type InspectionNoteType = 'observation' | 'safety' | 'environmental' | 'general';
export type AuditType = 'routine' | 'turnaround' | 'regulatory' | 'incident' | 'management';
export type AuditStatusType = 'planned' | 'in_progress' | 'completed' | 'closed';
export type FindingType = 'observation' | 'recommendation' | 'non_conformance' | 'critical';
export type CAPriority = 'immediate' | 'high' | 'medium' | 'low';
export type CAStatus = 'open' | 'in_progress' | 'completed' | 'verified' | 'overdue';

// ── Core Entities ──

/** Condition Monitoring Location */
export interface CML {
    id: string;
    asset_id: string;
    cml_number: string;
    component_type: ComponentType;
    nominal_thickness_mm: number;
    tmin_mm: number;
    orientation: string; // e.g. "12 o'clock"
}

/** Ultrasonic Thickness Reading */
export interface ThicknessReading {
    id: string;
    cml_id: string;
    reading_date: string;
    measured_thickness_mm: number;
    ut_method: UTMethod;
    technician: string;
}

/** Calculated Corrosion Rate for a CML */
export interface CorrosionRate {
    cml_id: string;
    asset_id: string;
    short_term_rate_mmpy: number; // mm per year
    long_term_rate_mmpy: number;
    rate_type: CorrosionRateType;
    is_accelerating: boolean;
    last_reading_date: string;
}

/** Risk-Based Inspection Assessment */
export interface RBIAssessment {
    id: string;
    asset_id: string;
    governing_code: GoverningCode;
    pof_score: number; // 1-5
    cof_score: string; // A-E
    risk_rank: 'Low' | 'Medium' | 'Medium-High' | 'High' | 'Very High';
    next_inspection_interval_months: number;
    next_inspection_due: string;
    assessor: string;
    assessed_date: string;
}

/** API 571 Damage Mechanism */
export interface DamageMechanism {
    id: string;
    api_571_code: string;
    mechanism_name: string;
    description: string;
    status: DamageMechStatusType;
    source: DamageMechSourceType;
    affected_asset_ids: string[];
}

/** API 579 Fitness-for-Service Assessment */
export interface FFSAssessment {
    id: string;
    asset_id: string;
    api_579_part: FFSPart;
    level: FFSLevel;
    status: FFSStatusType;
    rsf: number; // Remaining Strength Factor (0-1)
    remaining_life_years: number | null;
    assessor: string;
    assessed_date: string;
    recommended_action: string;
}

/** Integrity Operating Window Parameter */
export interface IOWParameter {
    id: string;
    asset_id: string;
    parameter_name: string;
    iow_type: IOWType;
    unit: string;
    low_limit: number | null;
    high_limit: number | null;
    current_value: number;
    breach_status: IOWBreachStatus;
    last_breach_date: string | null;
}

// ═══════════════════════════════════════════════════════════════════════
//  Physical Inspection Execution Types
// ═══════════════════════════════════════════════════════════════════════

/** Team member assigned to an inspection */
export interface InspectionTeamMember {
    id: string;
    user_id: string;
    name: string;
    role: InspectionTeamRole;
    certification?: string;           // e.g. "API 510", "ASNT Level II UT"
    department?: string;
    email?: string;
    added_at: string;
}

/** Individual finding / observation documented during an inspection */
export interface InspectionFinding {
    id: string;
    inspection_id: string;
    sequence: number;                 // finding #1, #2, etc.
    description: string;              // factual observation
    severity: FindingSeverity;
    status: FindingStatus;
    damage_mechanism_id?: string;     // link to API 571 damage mechanism
    damage_mechanism_name?: string;   // denormalized
    cml_id?: string;                  // link to specific CML
    cml_number?: string;              // denormalized
    measurement_value?: number;       // thickness reading if applicable
    measurement_unit?: string;        // mm, mils
    nde_method?: InspectionType;      // what NDE method found this
    recommendation?: string;          // technical recommendation
    action_required?: boolean;        // triggers WR drafting
    work_request_id?: string;         // link to generated WR
    media_urls: string[];             // attached photos/videos
    created_by: string;
    created_at: string;
}

/** Timestamped field note */
export interface InspectionNote {
    id: string;
    inspection_id: string;
    content: string;                  // rich text note
    note_type: InspectionNoteType;
    created_by: string;
    created_at: string;
    media_url?: string;               // optional attached image
}

/**
 * Full Inspection Event — enhanced for field execution.
 * Status flow (simple): Scheduled → In Progress → Completed
 * Status flow (2-step): Scheduled → In Progress → Pending Review → Completed
 */
export interface InspectionEvent {
    id: string;
    asset_id: string;
    asset_name?: string;              // denormalized for display
    inspection_type: InspectionType;
    governing_code?: GoverningCode;   // API 510, API 570, etc.
    scheduled_date: string;
    started_date?: string;            // when execution began
    completed_date?: string;          // when marked complete
    status: InspectionEventStatus;
    approval_mode: InspectionApprovalMode; // simple or two_step
    reviewer?: string;                // reviewer for 2-step approval
    reviewed_date?: string;
    findings_count: number;
    inspector: string;                // lead inspector
    report_url?: string;
    description?: string;             // scope/purpose of this inspection
    location_description?: string;    // "V-205 Shell Course 3, 12 o'clock"
    circuit_id?: string;              // link to inspection circuit
    work_order_id?: string;           // link to parent WO
    weather_conditions?: string;      // outdoor inspections
    team: InspectionTeamMember[];     // collaborators
    findings: InspectionFinding[];    // detailed observations
    notes: InspectionNote[];          // timestamped field notes
    checklist_responses?: Record<string, string | number | boolean>; // template field responses
    created_at?: string;
    updated_at?: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  Inspection Form Templates (Configurable per Governing Code)
// ═══════════════════════════════════════════════════════════════════════

export type TemplateFieldType = 'text' | 'number' | 'select' | 'checkbox' | 'textarea' | 'measurement' | 'photo' | 'date';

export interface TemplateField {
    id: string;
    label: string;
    field_type: TemplateFieldType;
    required: boolean;
    placeholder?: string;
    options?: string[];               // for select fields
    unit?: string;                    // for measurement fields (mm, °C, barg)
    min_value?: number;
    max_value?: number;
    help_text?: string;               // tooltip guidance for the inspector
    condition?: {                     // conditional visibility
        depends_on: string;           // field_id
        equals: string | boolean;
    };
}

export interface TemplateSection {
    id: string;
    title: string;
    description?: string;
    icon?: string;                    // lucide icon name
    fields: TemplateField[];
    required: boolean;                // must complete before finishing
}

export interface InspectionFormTemplate {
    id: string;
    name: string;                     // "API 510 Pressure Vessel Inspection"
    governing_code: GoverningCode;
    inspection_types: InspectionType[]; // which NDE methods this template supports
    description: string;
    version: string;
    sections: TemplateSection[];
}

// ── KPI Summaries ──

export interface IntegritySummary {
    total_cmls: number;
    cmls_below_tmin: number;
    avg_corrosion_rate: number;
    accelerating_count: number;
    /** Min remaining life across all assessed CMLs (years); null when none assessed */
    min_remaining_life_years: number | null;
    /** How many CMLs had enough readings to compute a rate */
    cmls_assessed: number;
    rbi_high_risk_count: number;
    active_damage_mechs: number;
    ai_suggested_pending: number;
    ffs_total: number;
    ffs_passed: number;
    ffs_failed: number;
    iow_total: number;
    iow_breach_count: number;
    inspections_scheduled: number;
    inspections_overdue: number;
    inspections_completed_ytd: number;
}
