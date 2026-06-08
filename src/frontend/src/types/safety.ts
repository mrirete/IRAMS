// ═══════════════════════════════════════════════════════════════════════
//  Process Safety & HSE Types
// ═══════════════════════════════════════════════════════════════════════

// ── LOTO ──
export type IsolationType = 'electrical' | 'mechanical' | 'process' | 'pneumatic' | 'hydraulic';
export type LOTOStatus = 'draft' | 'issued' | 'active' | 'cleared';

export interface PadlockAssignment {
    padlock_id: string;
    assigned_to: string;
    locked_date: string | null;
    unlocked_date: string | null;
}

export interface LOTOPermit {
    id: string;
    permit_number: string;
    asset_id: string;
    asset_name: string;
    isolation_type: IsolationType;
    status: LOTOStatus;
    blind_list: string[];
    padlocks: PadlockAssignment[];
    authorized_by: string;
    issued_date: string;
    cleared_date: string | null;
    work_description: string;
}

// ── PSM (OSHA 1910.119) ──
export interface PSMElement {
    id: string;
    element_name: string;
    osha_reference: string;
    compliance_pct: number;
    last_review_date: string;
    next_review_due: string;
    open_findings: number;
    owner: string;
}

// ── Audits ──
export type AuditType = 'routine' | 'turnaround' | 'regulatory' | 'incident' | 'management';
export type AuditStatus = 'planned' | 'in_progress' | 'completed' | 'closed';
export type FindingType = 'observation' | 'recommendation' | 'non_conformance' | 'critical';
export type CAStatus = 'open' | 'in_progress' | 'completed' | 'verified' | 'overdue';
export type CAPriority = 'immediate' | 'high' | 'medium' | 'low';

export interface AuditFinding {
    id: string;
    finding_type: FindingType;
    description: string;
    ca_priority: CAPriority;
    ca_status: CAStatus;
    due_date: string;
    assigned_to: string;
}

export interface Audit {
    id: string;
    audit_number: string;
    audit_type: AuditType;
    status: AuditStatus;
    scheduled_date: string;
    lead_auditor: string;
    scope: string;
    findings: AuditFinding[];
}

// ── Regulatory ──
export type ComplianceStatus = 'compliant' | 'partially_compliant' | 'non_compliant' | 'under_review';

export interface RegulatoryRequirement {
    id: string;
    regulation_name: string;
    authority: string;
    applicable_sites: string[];
    compliance_status: ComplianceStatus;
    next_submission: string;
    owner: string;
}

export interface ReadinessScore {
    id: string;
    regulatory_area: string;
    score_pct: number;
    gap_count: number;
    last_assessed: string;
}

// ── KPI Summary ──
export interface SafetySummary {
    active_loto_permits: number;
    pending_clearance: number;
    psm_overall_pct: number;
    moc_open: number;
    total_audits: number;
    open_findings: number;
    critical_findings: number;
    overdue_cas: number;
    ca_closure_rate_pct: number;
    total_requirements: number;
    compliant_count: number;
    non_compliant_count: number;
    overall_readiness_pct: number;
    critical_gaps: number;
}

// ═══════════════════════════════════════════════════════════════════════
//  PSM Analytical Tools (IEC 61882, IEC 61511, IEC 61508, ISO 31000)
// ═══════════════════════════════════════════════════════════════════════

export type PSMStudyType = 'pha' | 'hazop' | 'lopa' | 'bowtie' | 'fta' | 'eta' | 'sil' | 'pssr';
export type PSMStudyStatus = 'draft' | 'in_progress' | 'review' | 'approved' | 'closed';
export type ActionStatus = 'open' | 'in_progress' | 'completed' | 'verified' | 'cancelled';

export interface PSMStudyTeamMember {
    name: string;
    role: string;
    company?: string;
}

// ── Study Container ──
export interface PSMStudy {
    id: string;
    study_type: PSMStudyType;
    title: string;
    asset_id: string | null;
    asset_tag: string;
    asset_name: string;
    unit_id: string | null;
    status: PSMStudyStatus;
    facilitator: string;
    team_members: PSMStudyTeamMember[];
    methodology: string;
    standard_ref: string;
    scope_description: string;
    study_date: string | null;
    next_review: string | null;
    metadata: Record<string, any>;
    created_by: string;
    created_at: string;
    updated_at: string;
}

// ── HAZOP (IEC 61882) ──
export interface HAZOPNode {
    id: string;
    study_id: string;
    node_name: string;
    design_intent: string;
    drawing_ref: string;
    sort_order: number;
    created_at: string;
}

export type HAZOPGuideWord = 'NO' | 'MORE' | 'LESS' | 'REVERSE' | 'PART OF' | 'AS WELL AS' | 'OTHER THAN' | 'EARLY' | 'LATE' | 'BEFORE' | 'AFTER';
export type HAZOPParameter = 'Flow' | 'Pressure' | 'Temperature' | 'Level' | 'Composition' | 'Phase' | 'Speed' | 'Viscosity' | 'Reaction' | 'Time' | 'Sequence' | 'Signal';

export interface HAZOPDeviation {
    id: string;
    node_id: string;
    guide_word: string;
    parameter: string;
    deviation: string;
    causes: string;
    consequences: string;
    safeguards: string;
    severity: number | null;
    likelihood: number | null;
    risk_ranking: string;
    recommendations: string;
    action_owner: string;
    action_due_date: string | null;
    action_status: ActionStatus;
    sort_order: number;
    created_at: string;
}

// ── LOPA (IEC 61511) ──
export interface IPL {
    name: string;
    type: 'bpcs' | 'alarm' | 'sis' | 'relief' | 'dike' | 'human' | 'other';
    pfd: number;    // probability of failure on demand
    credit: number; // risk reduction factor (reciprocal of PFD)
    description: string;
}

export interface LOPAConditionalModifiers {
    p_ignition?: number;
    p_occupancy?: number;
    p_direction?: number;
    p_weather?: number;
}

export interface LOPAScenario {
    id: string;
    study_id: string;
    scenario_number: string;
    description: string;
    consequence_desc: string;
    severity_category: string;
    initiating_event: string;
    ie_frequency: number | null;
    ipls: IPL[];
    conditional_modifiers: LOPAConditionalModifiers;
    mitigated_frequency: number | null;
    target_frequency: number | null;
    risk_gap: number | null;
    sil_required: number | null;
    recommendations: string;
    sort_order: number;
    created_at: string;
}

// ── Bow-Tie (CCPS / Shell) ──
export type BowTieElementType =
    | 'top_event' | 'threat' | 'consequence'
    | 'prevention_barrier' | 'mitigation_barrier'
    | 'escalation_factor' | 'escalation_barrier';

export type BarrierType = 'hardware' | 'procedural' | 'human';

export interface BowTieElement {
    id: string;
    study_id: string;
    element_type: BowTieElementType;
    label: string;
    description: string;
    parent_id: string | null;
    barrier_type: BarrierType | null;
    pfd: number | null;
    degradation: Record<string, any>;
    position_x: number;
    position_y: number;
    sort_order: number;
    created_at: string;
}

// ── Event Tree (IEC 62502) ──
export interface EventTreeHeader {
    name: string;
    success_prob: number;
}

export interface EventTreeOutcome {
    path: boolean[];  // true = success at each header
    outcome: string;
    frequency: number;
}

export interface EventTreeBranch {
    id: string;
    study_id: string;
    initiating_event: string;
    ie_frequency: number | null;
    headers: EventTreeHeader[];
    branches: EventTreeOutcome[];
    created_at: string;
}

// ── SIL Assessment (IEC 61508 / IEC 61511) ──
export type SILDemandMode = 'low' | 'high' | 'continuous';

export interface SILAssessment {
    id: string;
    study_id: string;
    sif_tag: string;
    sif_description: string;
    demand_mode: SILDemandMode;
    target_sil: number | null;
    achieved_pfd: number | null;
    architecture: string;
    proof_test_interval_months: number | null;
    common_cause_beta: number | null;
    verified: boolean;
    verification_date: string | null;
    sort_order: number;
    created_at: string;
}

// ── Risk Register (ISO 31000) ──
export type RiskCategory = 'safety' | 'environmental' | 'financial' | 'operational' | 'reputational';
export type RiskStatus = 'open' | 'mitigated' | 'accepted' | 'closed' | 'escalated';

export interface RiskRegisterEntry {
    id: string;
    risk_id_code: string;
    category: RiskCategory;
    asset_id: string | null;
    description: string;
    cause: string;
    consequence: string;
    pre_severity: number | null;
    pre_likelihood: number | null;
    pre_risk_score: number | null;
    controls: string;
    post_severity: number | null;
    post_likelihood: number | null;
    post_risk_score: number | null;
    risk_owner: string;
    review_date: string | null;
    status: RiskStatus;
    linked_study_id: string | null;
    created_by: string;
    created_at: string;
    updated_at: string;
}

// ── PSSR (OSHA 1910.119(i)) ──
export type PSSRItemStatus = 'not_checked' | 'pass' | 'fail' | 'na';

export interface PSSRCheckItem {
    id: string;
    study_id: string;
    category: string;
    checklist_item: string;
    status: PSSRItemStatus;
    comments: string;
    checked_by: string;
    checked_date: string | null;
    sort_order: number;
    created_at: string;
}

// ── PHA (OSHA 1910.119(e)) ──
export type PHAItemType = 'what_if' | 'checklist';

export interface PHAItem {
    id: string;
    study_id: string;
    item_type: PHAItemType;
    question: string;
    hazard: string;
    consequence: string;
    safeguards: string;
    severity: number | null;
    likelihood: number | null;
    risk_ranking: string;
    recommendation: string;
    action_owner: string;
    action_status: ActionStatus;
    sort_order: number;
    created_at: string;
}
