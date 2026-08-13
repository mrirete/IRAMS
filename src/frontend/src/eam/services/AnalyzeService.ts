/**
 * AnalyzeService — Supabase CRUD for ERS Analyze + Vision + Sustain domains
 *
 * Tables: ers_fmea_worksheets, ers_fmea_items, ers_rca_investigations,
 *         ers_rca_nodes, ers_bad_actor_snapshots, ers_vision_results,
 *         ers_drone_surveys, ers_carbon_metrics, ers_climate_risks
 */
import { supabase } from '../lib/supabase';
import { notifyError } from '../lib/notify';

// Canonical WO cost: frozen labor + material (locked at closure), falling back
// to total_actual_cost. Same definition as sem_work_history and the agent tools.
// work_orders has NO total_cost column — selecting it 400s the whole query.
const woCost = (wo: { frozen_labor_cost?: unknown; frozen_material_cost?: unknown; total_actual_cost?: unknown }): number => {
    const frozen = (Number(wo.frozen_labor_cost) || 0) + (Number(wo.frozen_material_cost) || 0);
    return frozen || Number(wo.total_actual_cost) || 0;
};

// ─── Types ───────────────────────────────────────────────────

// SMEA (Success Mode & Effects Analysis — PSC framework, 0188)
export interface SMEAWorksheet {
    id: string;
    asset_id: string | null;
    title: string;
    status: 'draft' | 'active' | 'review' | 'closed';
    description: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}
export interface SMEAItem {
    id: string;
    worksheet_id: string;
    success_mode: string;
    success_condition: string | null;
    value_impact: number;
    sustainability: number;
    monitorability: number;
    /** generated in the DB: value_impact × sustainability × monitorability */
    spn: number;
    priority_action: string | null;
    status: 'open' | 'monitored' | 'sustained' | 'dropped';
    created_at: string;
}

// FMEA
export interface FMEAWorksheet {
    id: string;
    asset_id: string;
    title: string;
    fmea_type: 'equipment' | 'process' | 'design' | 'system' | null;
    status: 'draft' | 'active' | 'review' | 'closed' | null;
    max_rpn: number;
    avg_rpn: number;
    high_risk_count: number;
    created_at: string;
    updated_at: string;
}

export interface FMEAItem {
    id: string;
    worksheet_id: string;
    component: string;
    function: string;
    failure_mode: string;
    failure_effect: string | null;
    failure_cause: string | null;
    severity: number | null;
    occurrence: number | null;
    detection: number | null;
    rpn: number | null; // computed column
    current_controls: string | null;
    recommended_action: string | null;
    action_status: 'open' | 'in_progress' | 'closed' | 'deferred' | null;
    created_at: string;
}

// RCA — Full 6-step model (ISO 55000, SAE JA1011, PROACT, Apollo)
export interface RCAInvestigation {
    id: string;
    asset_id: string;
    title: string;
    /** The committed analysis method. One investigation, one method, one editor. */
    method: RCAMethod | null;
    /** Advisory only — captured at step 1, pre-selects the step-3 gate. Never binds. */
    proposed_method: RCAMethod | null;
    /** Set when the investigator commits at step 3. Changing method after this is confirmed. */
    method_locked_at: string | null;
    status: 'draft' | 'in_progress' | 'review' | 'closed' | null;
    problem_statement: string | null;
    root_cause_summary: string | null;
    // RCA categorization
    rca_category: 'safety' | 'production' | 'process' | 'asset_failure' | null;
    investigation_type: 'reactive' | 'proactive';
    // Trigger metadata
    trigger_type: 'cost' | 'recurrence' | 'criticality' | 'safety' | 'pareto' | 'downtime' | 'near_miss' | 'manual' | null;
    trigger_reference_id: string | null;
    // 3W2H — Event context
    event_date: string | null;
    event_location: string | null;
    event_what: string | null;
    event_how: string | null;
    event_how_much: { cost?: number; downtime_hrs?: number; safety_tier?: string | null; env_impact?: string | null } | null;
    // Linkages
    work_order_id: string | null;
    lead_investigator: string | null;
    // Step tracker (1-6)
    current_step: number;
    // Closure & effectiveness
    closed_at: string | null;
    effectiveness_due: string | null;
    effectiveness_status: 'pending' | 'effective' | 'ineffective' | 'recurred';
    // Re-occurrence
    previous_rca_id: string | null;
    // Collaboration
    collaborators?: StudyCollaborator[];
    created_at: string;
    updated_at: string;
}

export interface RCANode {
    id: string;
    investigation_id: string;
    parent_id: string | null;
    node_type: 'problem' | 'why' | 'category' | 'root_cause' | 'contributing_factor';
    description: string;
    depth: number;
    is_root_cause: boolean;
    // PROACT 3-layer categorization
    cause_category: 'physical' | 'human' | 'latent' | null;
    // ISO 14224 taxonomy code
    cause_code: string | null;
    evidence_notes: string | null;
    // Fault-tree AND/OR gate (0217). Lived in evidence_notes before that,
    // which poisoned the one field meant for evidence backing.
    gate_type: 'AND' | 'OR' | null;
    // Which analysis method authored this node (0196). Every editor reads only its
    // own nodes — otherwise a fishbone's 6M category rows resurface as fault-tree
    // gate events and as phantom "WHY" steps. Stamped by DB trigger if omitted.
    method: RCAMethod | null;
    created_at: string;
}

// ─── RCA method catalog — the single source of truth ──────────
// Label/colour tables for these used to be duplicated in RCATab, RCAInvestigationPage
// and the step guide, and had already drifted apart.

export type RCAMethod = 'five_why' | 'fishbone' | 'fault_tree' | 'logic_tree' | 'taproot' | 'apollo';

export interface RCAMethodDef {
    value: RCAMethod;
    label: string;
    color: string;
    bestFor: string;
    why: string;
}

/** The methods with a working editor — the only ones offered at the step-3 gate. */
export const RCA_METHODS: RCAMethodDef[] = [
    {
        value: 'five_why', label: '5-Why', color: '#0891b2',
        bestFor: 'Simple / single-cause',
        why: 'A linear cause chain. Fast for straightforward failures with one obvious thread to pull.',
    },
    {
        value: 'fishbone', label: 'Fishbone (Ishikawa)', color: '#d97706',
        bestFor: 'Many candidate causes',
        why: 'Category-based brainstorming (6Ms / 4Ps) when you need to widen the net before narrowing it.',
    },
    {
        value: 'fault_tree', label: 'Fault Tree (FTA)', color: '#e11d48',
        bestFor: 'Safety-critical / quantitative',
        why: 'Boolean AND/OR gates with probabilities. The right tool for SIL and PSM work.',
    },
    {
        value: 'logic_tree', label: 'Logic Tree (LTA)', color: '#7c3aed',
        bestFor: 'Chronic / recurring',
        why: 'Physical → Human → Latent ladder. The RCFA workhorse when the root is systemic.',
    },
];

/** Legacy methods kept valid in the DB but no longer offered — they have no editor. */
const LEGACY_METHOD_LABELS: Record<string, string> = { taproot: 'TapRooT®', apollo: 'Apollo' };

export const rcaMethodDef = (method: string | null | undefined): RCAMethodDef | null =>
    RCA_METHODS.find(m => m.value === method) ?? null;

export const rcaMethodLabel = (method: string | null | undefined): string =>
    rcaMethodDef(method)?.label ?? LEGACY_METHOD_LABELS[method ?? ''] ?? 'No method selected';

export const rcaMethodColor = (method: string | null | undefined): string =>
    rcaMethodDef(method)?.color ?? '#94a3b8';

/**
 * Nodes belonging to one method. Every step-3 editor MUST filter through this —
 * passing the raw investigation-wide array is what let the tools corrupt each other.
 * Nodes with no method (created by a client bundle older than 0196, before the DB
 * trigger backstop) are treated as belonging to the active method rather than
 * vanishing from the UI.
 */
export const scopeNodesToMethod = (nodes: RCANode[], method: string | null | undefined): RCANode[] =>
    nodes.filter(n => !n.method || n.method === method);

// Bad Actors
export interface BadActorSnapshot {
    id: string;
    report_period: string;
    criteria: 'cost' | 'downtime' | 'wo_frequency' | 'failure_rate';
    pareto_threshold_pct: number;
    total_assets_analyzed: number;
    generated_at: string;
    top_assets: BadActorEntry[];
}

export interface BadActorEntry {
    asset_id: string;
    asset_name: string;
    rank: number;
    metric_value: number;
    metric_unit: string;
    pct_of_total: number;
    cumulative_pct: number;
    trend: string;
    previous_rank: number;
}

// RCA Evidence (Step 2)
export interface RCAEvidence {
    id: string;
    investigation_id: string;
    evidence_type: 'photo' | 'document' | 'work_order' | 'fmea' | 'sensor_data' | 'note' | 'timeline_event' | 'interview';
    title: string;
    content: string | null;
    linked_entity_id: string | null;
    event_timestamp: string | null;
    uploaded_by: string | null;
    // Data-quality ladder band (0217). NULL = ungraded (legacy items).
    quality_grade: EvidenceQualityGrade | null;
    created_at: string;
}

// ─── Evidence quality ladder — the single source of truth ─────
// The classic cause-verification data-quality ladder (Facts → Fantasies),
// compressed to four bands a field user can pick under time pressure.
// rank: higher = stronger. Used to color node badges by their BEST support.

export type EvidenceQualityGrade = 'fact' | 'inference' | 'opinion' | 'hearsay';

export interface EvidenceGradeDef {
    value: EvidenceQualityGrade;
    label: string;
    caption: string;
    color: string;
    bg: string;
    rank: number;
}

export const EVIDENCE_GRADES: EvidenceGradeDef[] = [
    { value: 'fact',      label: 'Fact',               caption: 'Direct evidence — measurements, photos, logs',          color: '#15803d', bg: '#dcfce7', rank: 4 },
    { value: 'inference', label: 'Inference',          caption: 'Logical conclusion or testable hypothesis from facts',  color: '#a16207', bg: '#fef9c3', rank: 3 },
    { value: 'opinion',   label: 'Opinion / Belief',   caption: 'Expert judgment or assumption — verify with facts',     color: '#c2410c', bg: '#ffedd5', rank: 2 },
    { value: 'hearsay',   label: 'Hearsay / Guess',    caption: 'Distorted 2nd-hand info or guessing — weakest support', color: '#b91c1c', bg: '#fee2e2', rank: 1 },
];

export const evidenceGradeDef = (grade: string | null | undefined): EvidenceGradeDef | null =>
    EVIDENCE_GRADES.find(g => g.value === grade) ?? null;

/** Strongest grade among a set of evidence items (null when empty/all ungraded). */
export const bestEvidenceGrade = (items: { quality_grade: EvidenceQualityGrade | null }[]): EvidenceGradeDef | null =>
    items.reduce<EvidenceGradeDef | null>((best, it) => {
        const def = evidenceGradeDef(it.quality_grade);
        return def && (!best || def.rank > best.rank) ? def : best;
    }, null);

// Node ↔ evidence link (0217) — how a cause claim cites its support.
export interface RCANodeEvidenceLink {
    id: string;
    node_id: string;
    evidence_id: string;
    relation: 'supports' | 'refutes';
    created_at: string;
}

// ─── Root-cause confidence (0218) ──────────────────────────────
// One explainable number per root cause, derived from what it cites on the
// data-quality ladder. Deliberately coarse: base score from the BEST
// supporting grade, a small bonus for corroboration, a penalty per refuting
// item. Multiple root causes → the weakest link carries the verdict.

export interface RootCauseConfidence {
    score: number;                                              // 0–100
    band: 'verified' | 'probable' | 'tentative' | 'unverified';
    label: string;
    color: string;
    bg: string;
}

const CONFIDENCE_BANDS: Record<RootCauseConfidence['band'], { label: string; color: string; bg: string }> = {
    verified:   { label: 'Verified',   color: '#15803d', bg: '#dcfce7' },
    probable:   { label: 'Probable',   color: '#a16207', bg: '#fef9c3' },
    tentative:  { label: 'Tentative',  color: '#c2410c', bg: '#ffedd5' },
    unverified: { label: 'Unverified', color: '#b91c1c', bg: '#fee2e2' },
};

const GRADE_BASE_SCORE: Record<EvidenceQualityGrade, number> = {
    fact: 90, inference: 70, opinion: 45, hearsay: 25,
};

/** Map a stored 0–100 score back to its display band (also used by the DE board). */
export function confidenceFromScore(score: number): RootCauseConfidence {
    const band: RootCauseConfidence['band'] =
        score >= 80 ? 'verified' : score >= 60 ? 'probable' : score >= 35 ? 'tentative' : 'unverified';
    return { score, band, ...CONFIDENCE_BANDS[band] };
}

/** Confidence for ONE cause node from its citations. */
export function nodeConfidence(
    nodeId: string,
    evidence: { id: string; quality_grade: EvidenceQualityGrade | null }[],
    links: { node_id: string; evidence_id: string; relation: 'supports' | 'refutes' }[],
): RootCauseConfidence {
    const byId = new Map(evidence.map(e => [e.id, e]));
    const own = links.filter(l => l.node_id === nodeId);
    const supports = own.filter(l => l.relation === 'supports').map(l => byId.get(l.evidence_id)).filter(Boolean) as typeof evidence;
    const refuteCount = own.filter(l => l.relation === 'refutes').length;

    if (supports.length === 0) return confidenceFromScore(10);
    // Ungraded counts as a middling 55 — unknown, not zero.
    const base = Math.max(...supports.map(e => e.quality_grade ? GRADE_BASE_SCORE[e.quality_grade] : 55));
    const corroboration = Math.min((supports.length - 1) * 5, 10);
    const score = Math.min(95, Math.max(5, base + corroboration - refuteCount * 15));
    return confidenceFromScore(score);
}

/** Confidence for a SET of root-cause nodes: the weakest link carries it. */
export function rootCauseConfidence(
    nodeIds: string[],
    evidence: { id: string; quality_grade: EvidenceQualityGrade | null }[],
    links: { node_id: string; evidence_id: string; relation: 'supports' | 'refutes' }[],
): RootCauseConfidence | null {
    if (nodeIds.length === 0) return null;
    const scores = nodeIds.map(id => nodeConfidence(id, evidence, links));
    return scores.reduce((worst, c) => (c.score < worst.score ? c : worst));
}

// RCA Corrective Actions (Step 4)
export interface RCACorrectiveAction {
    id: string;
    investigation_id: string;
    cause_node_id: string | null;
    cause_category: 'physical' | 'human' | 'latent' | null;
    action_description: string;
    action_type: 'immediate' | 'short_term' | 'long_term';
    assigned_to: string | null;
    due_date: string | null;
    status: 'open' | 'in_progress' | 'completed' | 'overdue' | 'cancelled';
    requires_moc: boolean;
    completion_date: string | null;
    completion_notes: string | null;
    risk_of_not_acting: string | null;
    work_order_id: string | null;
    created_at: string;
}

// RCA Barriers — Defense-in-Depth (Step 3)
export interface RCABarrier {
    id: string;
    investigation_id: string;
    barrier_type: 'preventive' | 'mitigative';
    barrier_class: 'technical' | 'human' | 'organizational';
    description: string;
    assessment: 'effective' | 'failed' | 'not_used' | 'non_existent';
    failure_reason: string | null;
    corrective_action_id: string | null;
    created_at: string;
}

// RCA Team Members
export interface RCATeamMember {
    id: string;
    investigation_id: string;
    contact_id: string | null;
    member_name: string;
    role: 'lead' | 'investigator' | 'sme' | 'approver' | 'observer';
    added_at: string;
}

// RCA Audit Log (immutable)
export interface RCAAuditLog {
    id: string;
    investigation_id: string;
    action: string;
    changed_by: string;
    details: Record<string, unknown>;
    created_at: string;
}

// ISO 14224 Cause Taxonomy
export interface RCACauseTaxonomy {
    code: string;
    category: 'design' | 'fabrication' | 'operations' | 'maintenance' | 'management' | 'external';
    description: string;
    examples: string | null;
}

// Criticality Assessment (ISO 14224 / ISO 31000)
export interface CriticalityAssessment {
    id: string;
    asset_id: string;
    asset_tag: string;
    asset_name: string;
    hierarchy_level: string;
    current_criticality: 'A' | 'B' | 'C';
    consequence_safety: number;
    consequence_environment: number;
    consequence_production: number;
    consequence_cost: number;
    consequence_reputation: number;
    probability: number;
    risk_score: number;
    overall_criticality: 'A' | 'B' | 'C';
    notes: string | null;
    assessed_by: string | null;
    assessed_at: string;
}

// Pareto Analysis (Live RPC)
export interface ParetoParams {
    parentAssetId?: string | null;
    hierarchyLevel?: 'SITE' | 'UNIT' | 'SYSTEM' | 'EQUIPMENT' | 'COMPONENT';
    criteria?: 'cost' | 'downtime' | 'wo_frequency';
    dateFrom?: string;
    dateTo?: string;
    woTypes?: string[];
    limit?: number;
}

export interface ParetoResult {
    asset_id: string;
    asset_tag: string;
    asset_name: string;
    hierarchy_level: string;
    criticality: string;
    metric_value: number;
    metric_unit: string;
    event_count: number;
    pct_of_total: number;
    cumulative_pct: number;
    rank: number;
}

// Vision
export interface VisionResult {
    id: string;
    asset_id: string | null;
    image_name: string;
    analysis_type: 'corrosion' | 'thermal' | 'condition' | 'tagging' | 'crack_detection' | null;
    detected_items: number;
    max_severity: 'minor' | 'moderate' | 'severe' | 'critical' | null;
    reviewed: boolean;
    reviewed_by: string | null;
    timestamp: string;
    created_at: string;
}

export interface DroneSurvey {
    id: string;
    survey_name: string;
    date: string;
    area_covered_sqm: number | null;
    anomalies_found: number;
    reviewed: boolean;
    created_at: string;
}

// Sustain
export interface CarbonMetric {
    id: string;
    asset_id: string;
    asset_name: string | null;
    scope1_tco2: number;
    scope2_tco2: number;
    total_tco2: number; // computed column
    reporting_period: string | null;
    created_at: string;
}

export interface ClimateRisk {
    id: string;
    asset_id: string;
    asset_name: string | null;
    risk_level: 'low' | 'moderate' | 'high' | 'extreme' | null;
    risk_factors: string[];
    vulnerability_score: number | null;
    created_at: string;
    updated_at: string;
}

// Defect Elimination Tasks
export interface DETask {
    id: string;
    asset_id: string | null;
    asset_name: string;
    title: string;
    status: 'identified' | 'in_progress' | 'resolved' | 'verified';
    priority: 'critical' | 'high' | 'medium' | 'low';
    annual_cost: number;
    estimated_savings: number;
    implementation_cost: number;
    payback_months: number;
    root_cause_summary: string;
    proposed_solution: string;
    rca_id: string | null;
    /** 0–100, from the RCA root cause's cited evidence grades (0218). NULL = unknown. */
    evidence_confidence?: number | null;
    collaborators?: StudyCollaborator[];  // Team members JSONB
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

// Reliability Analyses (calculator persistence)
export type ReliabilityAnalysisType = 'mtbf' | 'weibull' | 'availability' | 'spares' | 'maintainability' | 'montecarlo';

// Reliability Study — parent container grouping an asset's analyses.
// Lifecycle (0204): active → in_review → approved → archived, with a findings
// summary as the study's deliverable and approval stamps for governance.
export type ReliabilityStudyStatus = 'active' | 'in_review' | 'approved' | 'archived';

export interface ReliabilityStudy {
    id: string;
    name: string;
    asset_id: string | null;
    asset_tag: string | null;
    asset_name: string | null;
    description: string | null;
    status: ReliabilityStudyStatus;
    findings?: string | null;
    approved_by?: string | null;
    approved_at?: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface ReliabilityAnalysis {
    id: string;
    root_id: string | null;   // lineage id — all versions of a study share this
    version: number;          // 1-based snapshot number within the lineage
    study_id: string | null;  // parent study (null = ungrouped)
    asset_id: string | null;
    asset_tag: string | null;
    asset_name: string | null;
    analysis_type: ReliabilityAnalysisType;
    title: string;
    inputs: Record<string, any>;
    results: Record<string, any>;
    notes: string | null;
    linked_pm_id?: string | null;     // recurring_work id produced from this analysis
    linked_pm_title?: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

// RBD Models
// Study Collaborators (shared by RBD & P&ID)
export interface StudyCollaborator {
    id: string;
    type: 'contact' | 'org_unit';
    ref_id: string;
    name: string;
    role: 'owner' | 'editor' | 'reviewer' | 'viewer';
    department?: string;
    email?: string;
    added_at: string;
    added_by?: string;
}

export interface RBDModel {
    id: string;
    title: string;
    asset_id: string | null;
    blocks: unknown[];   // RBDBlock[] stored as JSONB
    groups: unknown[];   // RBDGroup[] stored as JSONB
    system_availability: number | null;
    collaborators?: StudyCollaborator[];  // Team members JSONB
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

// P&ID Configurations
export interface PIDConfig {
    id: string;
    title: string;
    asset_id: string | null;
    equipment: unknown[];    // PIDEquipment[] stored as JSONB
    connections: unknown[];  // PIDConnection[] stored as JSONB
    show_heat_map: boolean;
    collaborators?: StudyCollaborator[];  // Team members JSONB
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

// EAM Context Panel Types
export interface EAMWorkOrder {
    id: string;
    wo_number: string;
    title: string;
    type: string;
    status: string;
    description: string;
    failure_mode: string | null;
    failure_cause: string | null;
    remedy: string | null;
    failure_comments: string | null;
    total_cost: number;
    priority: string | null;
    created_at: string;
    closed_at: string | null;
    due_date: string | null;
}

export interface EAMAssetDetail {
    id: string;
    asset_tag: string;
    name: string;
    description: string;
    hierarchy_level: string;
    criticality: string;
    status: string;
    manufacturer: string | null;
    model: string | null;
    serial_number: string | null;
    equipment_type: string | null;
    location: string | null;
    install_date: string | null;
    parent_id: string | null;
    breadcrumb: { id: string; name: string; level: string }[];
}

export interface EAMFailureTrends {
    modes: { mode: string; count: number; totalCost: number; lastOccurrence: string }[];
    timeline: { date: string; wo_number: string; mode: string; cost: number; type: string }[];
    totalCM: number;
    totalPM: number;
    totalCost: number;
}

// Maintenance Data Source (Analysis Context)
export interface MaintenanceDataSummary {
    source: 'local' | 'connector' | 'manual';
    connectorId?: string;
    connectorName?: string;
    targetLevel: string;
    totalWorkOrders: number;
    failureWorkOrders: number;
    lastWODate: string | null;
    mtbfHours: number | null;
    mttrHours: number | null;
    topFailureModes: { mode: string; count: number }[];
    workOrderSamples: { wo_number: string; type: string; status: string; description: string; date: string }[];
    manualNotes?: string;
}

export interface AnalysisDataSourceRecord {
    id: string;
    analysis_id: string;
    analysis_type: 'rca' | 'fmea';
    source_mode: 'connected' | 'manual';
    connector_id: string | null;
    connector_name: string | null;
    target_level: string;
    total_work_orders: number;
    failure_work_orders: number;
    last_wo_date: string | null;
    mtbf_hours: number | null;
    mttr_hours: number | null;
    top_failure_modes: { mode: string; count: number }[];
    work_order_samples: { wo_number: string; type: string; status: string; description: string; date: string }[];
    manual_notes: string | null;
    created_at: string;
    updated_at: string;
}

// ─── Service ─────────────────────────────────────────────────
class AnalyzeService {
    private static instance: AnalyzeService;
    private constructor() { }

    static getInstance(): AnalyzeService {
        if (!AnalyzeService.instance) {
            AnalyzeService.instance = new AnalyzeService();
        }
        return AnalyzeService.instance;
    }

    // ══════════════════════════════════════════════════════════
    //  RELIABILITY ANALYSES (calculator persistence)
    // ══════════════════════════════════════════════════════════

    async getReliabilityAnalyses(assetId?: string, analysisType?: ReliabilityAnalysisType): Promise<ReliabilityAnalysis[]> {
        try {
            let query = supabase.from('ers_reliability_analyses').select('*').order('updated_at', { ascending: false });
            if (assetId) query = query.eq('asset_id', assetId);
            if (analysisType) query = query.eq('analysis_type', analysisType);
            const { data, error } = await query;
            if (error) { console.error('AnalyzeService.getReliabilityAnalyses:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return (data ?? []) as ReliabilityAnalysis[];
        } catch (e) {
            console.error('Error fetching reliability analyses:', e);
            return [];
        }
    }

    async saveReliabilityAnalysis(
        analysis: Omit<ReliabilityAnalysis, 'id' | 'root_id' | 'version' | 'created_at' | 'updated_at'>
    ): Promise<ReliabilityAnalysis | null> {
        try {
            // First version of a new lineage — the row is its own root.
            const id = crypto.randomUUID();
            const row = { ...analysis, id, root_id: id, version: 1 };
            const { data, error } = await supabase
                .from('ers_reliability_analyses')
                .insert(row)
                .select()
                .single();
            if (error) { console.error('AnalyzeService.saveReliabilityAnalysis:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as ReliabilityAnalysis;
        } catch (e) {
            console.error('Error saving reliability analysis:', e);
            return null;
        }
    }

    /**
     * Append a new immutable version (snapshot) to an existing study lineage.
     * Prior versions are preserved so results can be trended over time.
     */
    async saveReliabilityVersion(
        rootId: string,
        version: number,
        analysis: Omit<ReliabilityAnalysis, 'id' | 'root_id' | 'version' | 'created_at' | 'updated_at'>
    ): Promise<ReliabilityAnalysis | null> {
        try {
            const row = { ...analysis, id: crypto.randomUUID(), root_id: rootId, version };
            const { data, error } = await supabase
                .from('ers_reliability_analyses')
                .insert(row)
                .select()
                .single();
            if (error) { console.error('AnalyzeService.saveReliabilityVersion:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as ReliabilityAnalysis;
        } catch (e) {
            console.error('Error saving reliability version:', e);
            return null;
        }
    }

    async updateReliabilityAnalysis(
        id: string,
        updates: Partial<Pick<ReliabilityAnalysis, 'title' | 'inputs' | 'results' | 'notes'>>
    ): Promise<ReliabilityAnalysis | null> {
        try {
            const { data, error } = await supabase
                .from('ers_reliability_analyses')
                .update(updates)
                .eq('id', id)
                .select()
                .single();
            if (error) { console.error('AnalyzeService.updateReliabilityAnalysis:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as ReliabilityAnalysis;
        } catch (e) {
            console.error('Error updating reliability analysis:', e);
            return null;
        }
    }

    async deleteReliabilityAnalysis(id: string): Promise<boolean> {
        try {
            const { error } = await supabase
                .from('ers_reliability_analyses')
                .delete()
                .eq('id', id);
            if (error) { console.error('AnalyzeService.deleteReliabilityAnalysis:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return true;
        } catch (e) {
            console.error('Error deleting reliability analysis:', e);
            return false;
        }
    }

    /** Stamp the PM (recurring_work) produced from an analysis onto its record. */
    async linkPMToAnalysis(analysisId: string, pmId: string, pmTitle: string): Promise<ReliabilityAnalysis | null> {
        try {
            const { data, error } = await supabase
                .from('ers_reliability_analyses')
                .update({ linked_pm_id: pmId, linked_pm_title: pmTitle })
                .eq('id', analysisId)
                .select()
                .single();
            if (error) { console.error('AnalyzeService.linkPMToAnalysis:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as ReliabilityAnalysis;
        } catch (e) {
            console.error('Error linking PM to analysis:', e);
            return null;
        }
    }

    // ══════════════════════════════════════════════════════════
    //  RELIABILITY STUDIES (parent grouping)
    // ══════════════════════════════════════════════════════════

    async getReliabilityStudies(): Promise<ReliabilityStudy[]> {
        try {
            const { data, error } = await supabase
                .from('ers_reliability_studies')
                .select('*')
                .order('updated_at', { ascending: false });
            if (error) { console.error('AnalyzeService.getReliabilityStudies:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return (data ?? []) as ReliabilityStudy[];
        } catch (e) {
            console.error('Error fetching reliability studies:', e);
            return [];
        }
    }

    async createReliabilityStudy(
        study: Omit<ReliabilityStudy, 'id' | 'status' | 'created_at' | 'updated_at'> & { status?: ReliabilityStudyStatus }
    ): Promise<ReliabilityStudy | null> {
        try {
            const { data, error } = await supabase
                .from('ers_reliability_studies')
                .insert({ status: 'active', ...study })
                .select()
                .single();
            if (error) { console.error('AnalyzeService.createReliabilityStudy:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as ReliabilityStudy;
        } catch (e) {
            console.error('Error creating reliability study:', e);
            return null;
        }
    }

    async updateReliabilityStudy(
        id: string,
        updates: Partial<Pick<ReliabilityStudy, 'name' | 'description' | 'status' | 'findings' | 'approved_by' | 'approved_at'>>
    ): Promise<ReliabilityStudy | null> {
        try {
            const { data, error } = await supabase
                .from('ers_reliability_studies')
                .update(updates)
                .eq('id', id)
                .select()
                .single();
            if (error) { console.error('AnalyzeService.updateReliabilityStudy:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as ReliabilityStudy;
        } catch (e) {
            console.error('Error updating reliability study:', e);
            return null;
        }
    }

    async deleteReliabilityStudy(id: string): Promise<boolean> {
        try {
            // study_id FK is ON DELETE SET NULL, so member analyses become ungrouped.
            const { error } = await supabase
                .from('ers_reliability_studies')
                .delete()
                .eq('id', id);
            if (error) { console.error('AnalyzeService.deleteReliabilityStudy:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return true;
        } catch (e) {
            console.error('Error deleting reliability study:', e);
            return false;
        }
    }

    // ══════════════════════════════════════════════════════════
    //  SMEA — Success Mode & Effects Analysis (PSC framework)
    //  Value-centric complement to FMEA; SPN = V × S × M is a DB
    //  generated column, never computed client-side.
    // ══════════════════════════════════════════════════════════

    async getSMEAWorksheets(assetId?: string): Promise<SMEAWorksheet[]> {
        try {
            let query = supabase.from('ers_smea_worksheets').select('*');
            if (assetId) query = query.eq('asset_id', assetId);
            const { data, error } = await query.order('created_at', { ascending: false });
            if (error) { console.error('AnalyzeService.getSMEAWorksheets:', error); return []; } // table may predate 0188
            return (data || []) as SMEAWorksheet[];
        } catch (e) {
            console.error('Error fetching SMEA worksheets:', e);
            return [];
        }
    }

    async getSMEAItems(worksheetId: string): Promise<SMEAItem[]> {
        try {
            const { data, error } = await supabase
                .from('ers_smea_items').select('*')
                .eq('worksheet_id', worksheetId)
                .order('spn', { ascending: false });
            if (error) { console.error('AnalyzeService.getSMEAItems:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return (data || []) as SMEAItem[];
        } catch (e) {
            console.error('Error fetching SMEA items:', e);
            return [];
        }
    }

    async createSMEAWorksheet(ws: Omit<SMEAWorksheet, 'id' | 'created_at' | 'updated_at'>): Promise<SMEAWorksheet | null> {
        try {
            const { data, error } = await supabase.from('ers_smea_worksheets').insert(ws).select().single();
            if (error) { console.error('AnalyzeService.createSMEAWorksheet:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as SMEAWorksheet;
        } catch (e) {
            console.error('Error creating SMEA worksheet:', e);
            return null;
        }
    }

    async createSMEAItem(item: Omit<SMEAItem, 'id' | 'created_at' | 'spn'>): Promise<SMEAItem | null> {
        try {
            const { data, error } = await supabase.from('ers_smea_items').insert(item).select().single();
            if (error) { console.error('AnalyzeService.createSMEAItem:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as SMEAItem;
        } catch (e) {
            console.error('Error creating SMEA item:', e);
            return null;
        }
    }

    async updateSMEAItem(id: string, updates: Partial<Omit<SMEAItem, 'id' | 'created_at' | 'spn'>>): Promise<SMEAItem | null> {
        try {
            const { data, error } = await supabase.from('ers_smea_items').update(updates).eq('id', id).select().single();
            if (error) { console.error('AnalyzeService.updateSMEAItem:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as SMEAItem;
        } catch (e) {
            console.error('Error updating SMEA item:', e);
            return null;
        }
    }

    async deleteSMEAItem(id: string): Promise<boolean> {
        try {
            const { error } = await supabase.from('ers_smea_items').delete().eq('id', id);
            if (error) { console.error('AnalyzeService.deleteSMEAItem:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return true;
        } catch (e) {
            console.error('Error deleting SMEA item:', e);
            return false;
        }
    }

    async deleteSMEAWorksheet(id: string): Promise<boolean> {
        try {
            const { error } = await supabase.from('ers_smea_worksheets').delete().eq('id', id);
            if (error) { console.error('AnalyzeService.deleteSMEAWorksheet:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return true;
        } catch (e) {
            console.error('Error deleting SMEA worksheet:', e);
            return false;
        }
    }

    // ══════════════════════════════════════════════════════════
    //  FMEA
    // ══════════════════════════════════════════════════════════

    async getFMEAWorksheets(assetId?: string): Promise<FMEAWorksheet[]> {
        try {
            let query = supabase.from('ers_fmea_worksheets').select('*');
            if (assetId) query = query.eq('asset_id', assetId);
            const { data, error } = await query.order('created_at', { ascending: false });
            if (error) { console.error('AnalyzeService.getFMEAWorksheets:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return (data || []) as FMEAWorksheet[];
        } catch (e) {
            console.error('Error fetching FMEA worksheets:', e);
            return [];
        }
    }

    async getFMEAItems(worksheetId: string): Promise<FMEAItem[]> {
        try {
            const { data, error } = await supabase
                .from('ers_fmea_items')
                .select('*')
                .eq('worksheet_id', worksheetId)
                .order('created_at');
            if (error) { console.error('AnalyzeService.getFMEAItems:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return (data || []) as FMEAItem[];
        } catch (e) {
            console.error('Error fetching FMEA items:', e);
            return [];
        }
    }

    async createFMEAWorksheet(ws: Omit<FMEAWorksheet, 'id' | 'created_at' | 'updated_at'>): Promise<FMEAWorksheet | null> {
        try {
            const { data, error } = await supabase.from('ers_fmea_worksheets').insert(ws).select().single();
            if (error) { console.error('AnalyzeService.createFMEAWorksheet:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as FMEAWorksheet;
        } catch (e) {
            console.error('Error creating FMEA worksheet:', e);
            return null;
        }
    }

    async createFMEAItem(item: Omit<FMEAItem, 'id' | 'created_at' | 'rpn'>): Promise<FMEAItem | null> {
        try {
            const { data, error } = await supabase.from('ers_fmea_items').insert(item).select().single();
            if (error) { console.error('AnalyzeService.createFMEAItem:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as FMEAItem;
        } catch (e) {
            console.error('Error creating FMEA item:', e);
            return null;
        }
    }

    async updateFMEAItem(id: string, updates: Partial<FMEAItem>): Promise<FMEAItem | null> {
        try {
            // Remove computed 'rpn' field if present
            const { rpn, ...safeUpdates } = updates as any;
            const { data, error } = await supabase
                .from('ers_fmea_items')
                .update(safeUpdates)
                .eq('id', id)
                .select()
                .single();
            if (error) { console.error('AnalyzeService.updateFMEAItem:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as FMEAItem;
        } catch (e) {
            console.error('Error updating FMEA item:', e);
            return null;
        }
    }

    /** Update an FMEA worksheet's metadata (title, status, etc.) */
    async updateFMEAWorksheet(id: string, updates: Partial<FMEAWorksheet>): Promise<FMEAWorksheet | null> {
        try {
            const { data, error } = await supabase
                .from('ers_fmea_worksheets')
                .update({ ...updates, updated_at: new Date().toISOString() })
                .eq('id', id)
                .select()
                .single();
            if (error) { console.error('AnalyzeService.updateFMEAWorksheet:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as FMEAWorksheet;
        } catch (e) {
            console.error('Error updating FMEA worksheet:', e);
            return null;
        }
    }

    /** Delete an FMEA item by ID */
    async deleteFMEAItem(id: string): Promise<boolean> {
        try {
            const { error } = await supabase.from('ers_fmea_items').delete().eq('id', id);
            if (error) { console.error('AnalyzeService.deleteFMEAItem:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return true;
        } catch (e) {
            console.error('Error deleting FMEA item:', e);
            return false;
        }
    }

    /** Delete an FMEA worksheet and all its items */
    async deleteFMEAWorksheet(id: string): Promise<boolean> {
        try {
            // Delete child items first
            await supabase.from('ers_fmea_items').delete().eq('worksheet_id', id);
            const { error } = await supabase.from('ers_fmea_worksheets').delete().eq('id', id);
            if (error) { console.error('AnalyzeService.deleteFMEAWorksheet:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return true;
        } catch (e) {
            console.error('Error deleting FMEA worksheet:', e);
            return false;
        }
    }

    // ══════════════════════════════════════════════════════════
    //  RCA
    // ══════════════════════════════════════════════════════════

    async getRCAInvestigations(assetId?: string): Promise<RCAInvestigation[]> {
        try {
            let query = supabase.from('ers_rca_investigations').select('*');
            if (assetId) query = query.eq('asset_id', assetId);
            const { data, error } = await query.order('created_at', { ascending: false });
            if (error) { console.error('AnalyzeService.getRCAInvestigations:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return (data || []) as RCAInvestigation[];
        } catch (e) {
            console.error('Error fetching RCA investigations:', e);
            return [];
        }
    }

    async getRCANodes(investigationId: string): Promise<RCANode[]> {
        try {
            const { data, error } = await supabase
                .from('ers_rca_nodes')
                .select('*')
                .eq('investigation_id', investigationId)
                .order('depth')
                .order('created_at');
            if (error) { console.error('AnalyzeService.getRCANodes:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return (data || []) as RCANode[];
        } catch (e) {
            console.error('Error fetching RCA nodes:', e);
            return [];
        }
    }

    /** `proposed_method` (step-1 hint) and `method_locked_at` (step-3 commitment) are set later, not at creation. */
    async createRCAInvestigation(
        rca: Omit<RCAInvestigation, 'id' | 'created_at' | 'updated_at' | 'proposed_method' | 'method_locked_at'>
            & { proposed_method?: RCAMethod | null; method_locked_at?: string | null },
    ): Promise<RCAInvestigation | null> {
        try {
            // created_by is required on the row — without it the insert is rejected and
            // the investigation silently never appears in the list.
            const { data: { user } } = await supabase.auth.getUser();
            const payload = { ...rca, created_by: (rca as any).created_by || user?.id || '00000000-0000-0000-0000-000000000000' };
            const { data, error } = await supabase.from('ers_rca_investigations').insert(payload).select().single();
            if (error) { console.error('AnalyzeService.createRCAInvestigation:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as RCAInvestigation;
        } catch (e) {
            console.error('Error creating RCA investigation:', e);
            return null;
        }
    }

    /** `method` may be omitted — a DB trigger stamps it from the parent investigation. */
    async createRCANode(node: Omit<RCANode, 'id' | 'created_at' | 'method' | 'gate_type'> & { method?: RCAMethod | null; gate_type?: 'AND' | 'OR' | null }): Promise<RCANode | null> {
        try {
            const { data, error } = await supabase.from('ers_rca_nodes').insert(node).select().single();
            if (error) { console.error('AnalyzeService.createRCANode:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as RCANode;
        } catch (e) {
            console.error('Error creating RCA node:', e);
            return null;
        }
    }

    async updateRCAInvestigation(id: string, updates: Partial<RCAInvestigation>): Promise<RCAInvestigation | null> {
        try {
            const { data, error } = await supabase
                .from('ers_rca_investigations')
                .update({ ...updates, updated_at: new Date().toISOString() })
                .eq('id', id)
                .select()
                .single();
            if (error) { console.error('AnalyzeService.updateRCAInvestigation:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as RCAInvestigation;
        } catch (e) {
            console.error('Error updating RCA investigation:', e);
            return null;
        }
    }

    async updateRCANode(nodeId: string, updates: Partial<RCANode>): Promise<RCANode | null> {
        try {
            const { data, error } = await supabase
                .from('ers_rca_nodes')
                .update(updates)
                .eq('id', nodeId)
                .select()
                .single();
            if (error) { console.error('AnalyzeService.updateRCANode:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as RCANode;
        } catch (e) {
            console.error('Error updating RCA node:', e);
            return null;
        }
    }

    async deleteRCANode(nodeId: string): Promise<boolean> {
        try {
            const { error } = await supabase.from('ers_rca_nodes').delete().eq('id', nodeId);
            if (error) { console.error('AnalyzeService.deleteRCANode:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return true;
        } catch (e) {
            console.error('Error deleting RCA node:', e);
            return false;
        }
    }

    /** Delete an RCA investigation and all its children (nodes, evidence, team members) */
    async deleteRCAInvestigation(id: string): Promise<boolean> {
        try {
            // Delete child records first
            await supabase.from('ers_rca_evidence').delete().eq('investigation_id', id);
            await supabase.from('ers_rca_nodes').delete().eq('investigation_id', id);
            await supabase.from('ers_rca_team_members').delete().eq('investigation_id', id);
            const { error } = await supabase.from('ers_rca_investigations').delete().eq('id', id);
            if (error) { console.error('AnalyzeService.deleteRCAInvestigation:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return true;
        } catch (e) {
            console.error('Error deleting RCA investigation:', e);
            return false;
        }
    }

    // ── RCA Evidence ──────────────────────────────────────────

    async getRCAEvidence(investigationId: string): Promise<RCAEvidence[]> {
        try {
            const { data, error } = await supabase
                .from('ers_rca_evidence')
                .select('*')
                .eq('investigation_id', investigationId)
                .order('event_timestamp', { ascending: true, nullsFirst: false })
                .order('created_at', { ascending: true });
            if (error) { console.error('AnalyzeService.getRCAEvidence:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return (data || []) as RCAEvidence[];
        } catch (e) {
            console.error('Error fetching RCA evidence:', e);
            return [];
        }
    }

    async addRCAEvidence(evidence: Omit<RCAEvidence, 'id' | 'created_at' | 'quality_grade'> & { quality_grade?: EvidenceQualityGrade | null }): Promise<RCAEvidence | null> {
        try {
            const { data, error } = await supabase.from('ers_rca_evidence').insert(evidence).select().single();
            if (error) { console.error('AnalyzeService.addRCAEvidence:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as RCAEvidence;
        } catch (e) {
            console.error('Error adding RCA evidence:', e);
            return null;
        }
    }

    async deleteRCAEvidence(evidenceId: string): Promise<boolean> {
        try {
            const { error } = await supabase.from('ers_rca_evidence').delete().eq('id', evidenceId);
            if (error) { console.error('AnalyzeService.deleteRCAEvidence:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return true;
        } catch (e) {
            console.error('Error deleting RCA evidence:', e);
            return false;
        }
    }

    // ── RCA node ↔ evidence links (0217) ─────────────────────

    /** All links for one investigation in a single query (filtered through the node FK). */
    async getNodeEvidenceLinks(investigationId: string): Promise<RCANodeEvidenceLink[]> {
        try {
            const { data, error } = await supabase
                .from('ers_rca_node_evidence')
                .select('id, node_id, evidence_id, relation, created_at, node:ers_rca_nodes!inner(investigation_id)')
                .eq('node.investigation_id', investigationId);
            if (error) { console.error('AnalyzeService.getNodeEvidenceLinks:', error); throw error; }
            return (data || []).map(({ node: _node, ...link }: any) => link) as RCANodeEvidenceLink[];
        } catch (e) {
            console.error('Error fetching node-evidence links:', e);
            return [];
        }
    }

    async linkNodeEvidence(nodeId: string, evidenceId: string, relation: 'supports' | 'refutes' = 'supports'): Promise<RCANodeEvidenceLink | null> {
        try {
            const { data, error } = await supabase
                .from('ers_rca_node_evidence')
                .upsert({ node_id: nodeId, evidence_id: evidenceId, relation }, { onConflict: 'node_id,evidence_id' })
                .select('id, node_id, evidence_id, relation, created_at')
                .single();
            if (error) { console.error('AnalyzeService.linkNodeEvidence:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as RCANodeEvidenceLink;
        } catch (e) {
            console.error('Error linking evidence to node:', e);
            return null;
        }
    }

    async unlinkNodeEvidence(linkId: string): Promise<boolean> {
        try {
            const { error } = await supabase.from('ers_rca_node_evidence').delete().eq('id', linkId);
            if (error) { console.error('AnalyzeService.unlinkNodeEvidence:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return true;
        } catch (e) {
            console.error('Error unlinking evidence:', e);
            return false;
        }
    }

    // ── RCA Corrective Actions ────────────────────────────────

    async getRCACorrectiveActions(investigationId: string): Promise<RCACorrectiveAction[]> {
        try {
            const { data, error } = await supabase
                .from('ers_rca_corrective_actions')
                .select('*')
                .eq('investigation_id', investigationId)
                .order('created_at');
            if (error) { console.error('AnalyzeService.getRCACorrectiveActions:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return (data || []) as RCACorrectiveAction[];
        } catch (e) {
            console.error('Error fetching RCA corrective actions:', e);
            return [];
        }
    }

    async addRCACorrectiveAction(action: Omit<RCACorrectiveAction, 'id' | 'created_at'>): Promise<RCACorrectiveAction | null> {
        try {
            const { data, error } = await supabase.from('ers_rca_corrective_actions').insert(action).select().single();
            if (error) { console.error('AnalyzeService.addRCACorrectiveAction:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as RCACorrectiveAction;
        } catch (e) {
            console.error('Error adding RCA corrective action:', e);
            return null;
        }
    }

    async updateRCACorrectiveAction(id: string, updates: Partial<RCACorrectiveAction>): Promise<RCACorrectiveAction | null> {
        try {
            const { data, error } = await supabase
                .from('ers_rca_corrective_actions')
                .update(updates)
                .eq('id', id)
                .select()
                .single();
            if (error) { console.error('AnalyzeService.updateRCACorrectiveAction:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as RCACorrectiveAction;
        } catch (e) {
            console.error('Error updating RCA corrective action:', e);
            return null;
        }
    }

    async deleteRCACorrectiveAction(id: string): Promise<boolean> {
        try {
            const { error } = await supabase.from('ers_rca_corrective_actions').delete().eq('id', id);
            if (error) { console.error('AnalyzeService.deleteRCACorrectiveAction:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return true;
        } catch (e) {
            console.error('Error deleting RCA corrective action:', e);
            return false;
        }
    }

    // ── RCA Barriers ─────────────────────────────────────────

    async getRCABarriers(investigationId: string): Promise<RCABarrier[]> {
        try {
            const { data, error } = await supabase
                .from('ers_rca_barriers')
                .select('*')
                .eq('investigation_id', investigationId)
                .order('created_at');
            if (error) { console.error('AnalyzeService.getRCABarriers:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return (data || []) as RCABarrier[];
        } catch (e) {
            console.error('Error fetching RCA barriers:', e);
            return [];
        }
    }

    async addRCABarrier(barrier: Omit<RCABarrier, 'id' | 'created_at'>): Promise<RCABarrier | null> {
        try {
            const { data, error } = await supabase.from('ers_rca_barriers').insert(barrier).select().single();
            if (error) { console.error('AnalyzeService.addRCABarrier:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as RCABarrier;
        } catch (e) {
            console.error('Error adding RCA barrier:', e);
            return null;
        }
    }

    async updateRCABarrier(id: string, updates: Partial<RCABarrier>): Promise<RCABarrier | null> {
        try {
            const { data, error } = await supabase
                .from('ers_rca_barriers')
                .update(updates)
                .eq('id', id)
                .select()
                .single();
            if (error) { console.error('AnalyzeService.updateRCABarrier:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as RCABarrier;
        } catch (e) {
            console.error('Error updating RCA barrier:', e);
            return null;
        }
    }

    // ── RCA Team Members ─────────────────────────────────────

    async getRCATeamMembers(investigationId: string): Promise<RCATeamMember[]> {
        try {
            const { data, error } = await supabase
                .from('ers_rca_team_members')
                .select('*')
                .eq('investigation_id', investigationId)
                .order('added_at');
            if (error) { console.error('AnalyzeService.getRCATeamMembers:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return (data || []) as RCATeamMember[];
        } catch (e) {
            console.error('Error fetching RCA team members:', e);
            return [];
        }
    }

    async addRCATeamMember(member: Omit<RCATeamMember, 'id' | 'added_at'>): Promise<RCATeamMember | null> {
        try {
            const { data, error } = await supabase.from('ers_rca_team_members').insert(member).select().single();
            if (error) { console.error('AnalyzeService.addRCATeamMember:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as RCATeamMember;
        } catch (e) {
            console.error('Error adding RCA team member:', e);
            return null;
        }
    }

    async removeRCATeamMember(memberId: string): Promise<boolean> {
        try {
            const { error } = await supabase.from('ers_rca_team_members').delete().eq('id', memberId);
            if (error) { console.error('AnalyzeService.removeRCATeamMember:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return true;
        } catch (e) {
            console.error('Error removing RCA team member:', e);
            return false;
        }
    }

    // ── RCA Audit Log ────────────────────────────────────────

    async getRCAAuditLog(investigationId: string): Promise<RCAAuditLog[]> {
        try {
            const { data, error } = await supabase
                .from('ers_rca_audit_log')
                .select('*')
                .eq('investigation_id', investigationId)
                .order('created_at', { ascending: false });
            if (error) { console.error('AnalyzeService.getRCAAuditLog:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return (data || []) as RCAAuditLog[];
        } catch (e) {
            console.error('Error fetching RCA audit log:', e);
            return [];
        }
    }

    async logRCAAudit(entry: Omit<RCAAuditLog, 'id' | 'created_at'>): Promise<void> {
        try {
            await supabase.from('ers_rca_audit_log').insert(entry);
        } catch (e) {
            console.error('Error logging RCA audit:', e);
        }
    }

    // ── RCA Cause Taxonomy ───────────────────────────────────

    async getCauseTaxonomy(): Promise<RCACauseTaxonomy[]> {
        try {
            const { data, error } = await supabase
                .from('ers_rca_cause_taxonomy')
                .select('*')
                .order('code');
            if (error) { console.error('AnalyzeService.getCauseTaxonomy:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return (data || []) as RCACauseTaxonomy[];
        } catch (e) {
            console.error('Error fetching cause taxonomy:', e);
            return [];
        }
    }

    // ── RCA Step Advancement ─────────────────────────────────

    async advanceRCAStep(investigationId: string, targetStep: number, changedBy: string): Promise<RCAInvestigation | null> {
        const result = await this.updateRCAInvestigation(investigationId, {
            current_step: targetStep,
            status: targetStep >= 6 ? 'review' : 'in_progress',
        } as Partial<RCAInvestigation>);
        if (result) {
            await this.logRCAAudit({
                investigation_id: investigationId,
                action: 'step_advanced',
                changed_by: changedBy,
                details: { from_step: targetStep - 1, to_step: targetStep },
            });
        }
        return result;
    }

    // ── Related / Re-occurrence ──────────────────────────────

    async getRelatedRCAs(assetId: string): Promise<RCAInvestigation[]> {
        try {
            const { data, error } = await supabase
                .from('ers_rca_investigations')
                .select('*')
                .eq('asset_id', assetId)
                .order('created_at', { ascending: false });
            if (error) { console.error('AnalyzeService.getRelatedRCAs:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return (data || []) as RCAInvestigation[];
        } catch (e) {
            console.error('Error fetching related RCAs:', e);
            return [];
        }
    }

    // ══════════════════════════════════════════════════════════
    //  BAD ACTORS
    // ══════════════════════════════════════════════════════════

    async getBadActorSnapshots(criteria?: string, period?: string): Promise<BadActorSnapshot[]> {
        try {
            let query = supabase.from('ers_bad_actor_snapshots').select('*');
            if (criteria) query = query.eq('criteria', criteria);
            if (period) query = query.eq('report_period', period);
            const { data, error } = await query.order('generated_at', { ascending: false });
            if (error) { console.error('AnalyzeService.getBadActorSnapshots:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return (data || []) as BadActorSnapshot[];
        } catch (e) {
            console.error('Error fetching bad actor snapshots:', e);
            return [];
        }
    }

    async getLatestBadActors(criteria: string): Promise<BadActorSnapshot | null> {
        try {
            const { data, error } = await supabase
                .from('ers_bad_actor_snapshots')
                .select('*')
                .eq('criteria', criteria)
                .order('generated_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            if (error) { console.error('AnalyzeService.getLatestBadActors:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as BadActorSnapshot | null;
        } catch (e) {
            console.error('Error fetching latest bad actors:', e);
            return null;
        }
    }

    async createBadActorSnapshot(snapshot: Omit<BadActorSnapshot, 'id' | 'generated_at'>): Promise<BadActorSnapshot | null> {
        try {
            const { data, error } = await supabase.from('ers_bad_actor_snapshots').insert(snapshot).select().single();
            if (error) { console.error('AnalyzeService.createBadActorSnapshot:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as BadActorSnapshot;
        } catch (e) {
            console.error('Error creating bad actor snapshot:', e);
            return null;
        }
    }

    /**
     * Live Pareto Analysis — calls rpc_pareto_analysis with hierarchy roll-up.
     * Falls back to static snapshots if the RPC function is not yet deployed.
     */
    async getParetoAnalysis(params: ParetoParams = {}): Promise<ParetoResult[]> {
        try {
            const now = new Date();
            const yearAgo = new Date(now);
            yearAgo.setFullYear(yearAgo.getFullYear() - 1);

            const { data, error } = await supabase.rpc('rpc_pareto_analysis', {
                p_parent_asset_id: params.parentAssetId || null,
                p_hierarchy_level: params.hierarchyLevel || 'EQUIPMENT',
                p_criteria: params.criteria || 'cost',
                p_date_from: params.dateFrom || yearAgo.toISOString(),
                p_date_to: params.dateTo || now.toISOString(),
                // Default matches the reliability engine's failure lens (corrective
                // only) so unparameterized callers reconcile with the Metrics
                // scoreboard; pass woTypes explicitly to include PM cost.
                p_wo_types: params.woTypes || ['CM', 'EM'],
                p_limit: params.limit || 20,
            });

            if (error) {
                console.warn('AnalyzeService.getParetoAnalysis RPC error, falling back to snapshots:', error.message);
                // Fallback: convert static snapshot to ParetoResult[]
                const snapshot = await this.getLatestBadActors(params.criteria || 'cost');
                if (!snapshot) return [];
                return snapshot.top_assets.map(a => ({
                    asset_id: a.asset_id,
                    asset_tag: a.asset_name,
                    asset_name: a.asset_name,
                    hierarchy_level: 'EQUIPMENT',
                    criticality: 'B',
                    metric_value: a.metric_value,
                    metric_unit: a.metric_unit,
                    event_count: 0,
                    pct_of_total: a.pct_of_total,
                    cumulative_pct: a.cumulative_pct,
                    rank: a.rank,
                }));
            }

            return (data || []) as ParetoResult[];
        } catch (e) {
            console.error('Error in getParetoAnalysis:', e);
            return [];
        }
    }

    // ══════════════════════════════════════════════════════════
    //  ASSET WORK ORDERS (Drill-Down)
    // ══════════════════════════════════════════════════════════

    /**
     * Fetch work orders for a given asset to populate the drill-down drawer.
     * Returns a simplified projection suitable for table display.
     */
    async getAssetWorkOrders(assetId: string): Promise<EAMWorkOrder[]> {
        try {
            const { data, error } = await supabase
                .from('work_orders')
                // NOTE: there is no total_cost column — canonical cost is frozen labor
                // + material (falling back to total_actual_cost), same definition as
                // sem_work_history and the agent tools.
                .select('id, wo_number, title, type, status, description, failure_mode, failure_code, total_actual_cost, frozen_labor_cost, frozen_material_cost, created_at, closed_at, due_date, priority_code, wo_failure_data!wo_id(*)')
                .eq('asset_id', assetId)
                .order('created_at', { ascending: false })
                .limit(100);
            if (error) { console.error('AnalyzeService.getAssetWorkOrders:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return (data || []).map((wo: any) => {
                const fd = wo.wo_failure_data?.[0] || wo.wo_failure_data || null;
                return {
                    id: wo.id,
                    wo_number: wo.wo_number || '—',
                    title: wo.title || '',
                    type: wo.type || 'CM',
                    status: wo.status || 'OPEN',
                    description: wo.description || '',
                    failure_mode: fd?.failure_mode_code || wo.failure_mode || null,
                    failure_cause: fd?.failure_cause_code || null,
                    remedy: fd?.remedy_code || null,
                    failure_comments: fd?.comments || null,
                    total_cost: woCost(wo),
                    priority: wo.priority_code || null,
                    created_at: wo.created_at,
                    closed_at: wo.closed_at || null,
                    due_date: wo.due_date || null,
                };
            });
        } catch (e) {
            console.error('Error fetching asset work orders:', e);
            return [];
        }
    }

    // ══════════════════════════════════════════════════════════
    //  CAUSE TRENDS & TRIGGERS (Phase 4)
    // ══════════════════════════════════════════════════════════

    /**
     * Aggregate root-cause nodes across all RCAs by cause_category and month.
     * Returns data suitable for trend charting.
     */
    async getCauseTrends(months: number = 12): Promise<{ month: string; physical: number; human: number; latent: number }[]> {
        try {
            const { data, error } = await supabase
                .from('ers_rca_nodes')
                .select('created_at, cause_category')
                .eq('is_root_cause', true)
                .order('created_at', { ascending: true });
            if (error) { console.error('AnalyzeService.getCauseTrends:', error); return []; }

            const now = new Date();
            const cutoff = new Date(now.getFullYear(), now.getMonth() - months, 1);
            const buckets = new Map<string, { physical: number; human: number; latent: number }>();

            (data || []).forEach((row: any) => {
                const d = new Date(row.created_at);
                if (d < cutoff) return;
                const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                if (!buckets.has(key)) buckets.set(key, { physical: 0, human: 0, latent: 0 });
                const b = buckets.get(key)!;
                if (row.cause_category === 'physical') b.physical++;
                else if (row.cause_category === 'human') b.human++;
                else if (row.cause_category === 'latent') b.latent++;
            });

            return Array.from(buckets.entries())
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([month, counts]) => ({ month, ...counts }));
        } catch (e) {
            console.error('Error in getCauseTrends:', e);
            return [];
        }
    }

    /**
     * Check for automatic RCA / DE triggers based on asset failure patterns.
     * Returns a list of assets that meet trigger thresholds.
     */
    async checkTriggers(): Promise<{ asset_id: string; asset_name: string; trigger: string; value: number; threshold: number }[]> {
        try {
            const results: { asset_id: string; asset_name: string; trigger: string; value: number; threshold: number }[] = [];

            // Use Pareto to find high-cost assets
            const pareto = await this.getParetoAnalysis({ criteria: 'cost', limit: 10 });
            pareto.forEach(p => {
                // Cost trigger: > $50K annually
                if (p.metric_value > 50000) {
                    results.push({
                        asset_id: p.asset_id, asset_name: p.asset_name,
                        trigger: 'High Annual Cost', value: p.metric_value, threshold: 50000,
                    });
                }
                // Frequency trigger: > 5 events
                if (p.event_count > 5) {
                    results.push({
                        asset_id: p.asset_id, asset_name: p.asset_name,
                        trigger: 'Repeat Failure', value: p.event_count, threshold: 5,
                    });
                }
            });

            return results;
        } catch (e) {
            console.error('Error in checkTriggers:', e);
            return [];
        }
    }

    // ══════════════════════════════════════════════════════════
    //  VISION
    // ══════════════════════════════════════════════════════════

    async getVisionResults(assetId?: string): Promise<VisionResult[]> {
        try {
            let query = supabase.from('ers_vision_results').select('*');
            if (assetId) query = query.eq('asset_id', assetId);
            const { data, error } = await query.order('timestamp', { ascending: false });
            if (error) { console.error('AnalyzeService.getVisionResults:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return (data || []) as VisionResult[];
        } catch (e) {
            console.error('Error fetching vision results:', e);
            return [];
        }
    }

    async createVisionResult(result: Omit<VisionResult, 'id' | 'created_at'>): Promise<VisionResult | null> {
        try {
            const { data, error } = await supabase.from('ers_vision_results').insert(result).select().single();
            if (error) { console.error('AnalyzeService.createVisionResult:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as VisionResult;
        } catch (e) {
            console.error('Error creating vision result:', e);
            return null;
        }
    }

    async reviewVisionResult(id: string, userId: string): Promise<boolean> {
        try {
            const { error } = await supabase
                .from('ers_vision_results')
                .update({ reviewed: true, reviewed_by: userId })
                .eq('id', id);
            if (error) { console.error('AnalyzeService.reviewVisionResult:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return true;
        } catch (e) {
            console.error('Error reviewing vision result:', e);
            return false;
        }
    }

    async getDroneSurveys(): Promise<DroneSurvey[]> {
        try {
            const { data, error } = await supabase
                .from('ers_drone_surveys')
                .select('*')
                .order('date', { ascending: false });
            if (error) { console.error('AnalyzeService.getDroneSurveys:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return (data || []) as DroneSurvey[];
        } catch (e) {
            console.error('Error fetching drone surveys:', e);
            return [];
        }
    }

    // ══════════════════════════════════════════════════════════
    //  SUSTAIN (Carbon + Climate)
    // ══════════════════════════════════════════════════════════

    async getCarbonMetrics(assetId?: string): Promise<CarbonMetric[]> {
        try {
            let query = supabase.from('ers_carbon_metrics').select('*');
            if (assetId) query = query.eq('asset_id', assetId);
            const { data, error } = await query.order('reporting_period', { ascending: false });
            if (error) { console.error('AnalyzeService.getCarbonMetrics:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return (data || []) as CarbonMetric[];
        } catch (e) {
            console.error('Error fetching carbon metrics:', e);
            return [];
        }
    }

    async upsertCarbonMetric(metric: Partial<CarbonMetric> & { asset_id: string }): Promise<CarbonMetric | null> {
        try {
            // Remove computed 'total_tco2' field if present
            const { total_tco2, ...safeMetric } = metric as any;
            const { data, error } = await supabase
                .from('ers_carbon_metrics')
                .upsert(safeMetric)
                .select()
                .single();
            if (error) { console.error('AnalyzeService.upsertCarbonMetric:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as CarbonMetric;
        } catch (e) {
            console.error('Error upserting carbon metric:', e);
            return null;
        }
    }

    async getClimateRisks(assetId?: string): Promise<ClimateRisk[]> {
        try {
            let query = supabase.from('ers_climate_risks').select('*');
            if (assetId) query = query.eq('asset_id', assetId);
            const { data, error } = await query.order('vulnerability_score', { ascending: false });
            if (error) { console.error('AnalyzeService.getClimateRisks:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return (data || []) as ClimateRisk[];
        } catch (e) {
            console.error('Error fetching climate risks:', e);
            return [];
        }
    }

    async upsertClimateRisk(risk: Partial<ClimateRisk> & { asset_id: string }): Promise<ClimateRisk | null> {
        try {
            const { data, error } = await supabase
                .from('ers_climate_risks')
                .upsert({ ...risk, updated_at: new Date().toISOString() })
                .select()
                .single();
            if (error) { console.error('AnalyzeService.upsertClimateRisk:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as ClimateRisk;
        } catch (e) {
            console.error('Error upserting climate risk:', e);
            return null;
        }
    }

    // ═════════════════════════════════════════════════════════
    //  DEFECT ELIMINATION TASKS
    // ═════════════════════════════════════════════════════════

    async getDETasks(assetId?: string): Promise<DETask[]> {
        try {
            let query = supabase.from('ers_defect_elimination_tasks').select('*').order('created_at', { ascending: false });
            if (assetId) query = query.eq('asset_id', assetId);
            const { data, error } = await query;
            if (error) { console.error('AnalyzeService.getDETasks:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return (data ?? []) as DETask[];
        } catch (e) {
            console.error('Error fetching DE tasks:', e);
            return [];
        }
    }

    async createDETask(task: Omit<DETask, 'id' | 'created_at' | 'updated_at'>): Promise<DETask | null> {
        try {
            const { data, error } = await supabase.from('ers_defect_elimination_tasks').insert(task).select().single();
            if (error) { console.error('AnalyzeService.createDETask:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as DETask;
        } catch (e) {
            console.error('Error creating DE task:', e);
            return null;
        }
    }

    async updateDETask(id: string, updates: Partial<DETask>): Promise<DETask | null> {
        try {
            const { data, error } = await supabase.from('ers_defect_elimination_tasks').update(updates).eq('id', id).select().single();
            if (error) { console.error('AnalyzeService.updateDETask:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as DETask;
        } catch (e) {
            console.error('Error updating DE task:', e);
            return null;
        }
    }

    async deleteDETask(id: string): Promise<boolean> {
        try {
            const { error } = await supabase.from('ers_defect_elimination_tasks').delete().eq('id', id);
            if (error) { console.error('AnalyzeService.deleteDETask:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return true;
        } catch (e) {
            console.error('Error deleting DE task:', e);
            return false;
        }
    }

    // ── DE ↔ Work Orders (one DE → many WOs) ──────────────────

    /** Generate a Work Order from a DE task action item */
    async generateWOFromDE(deTaskId: string, woData: {
        title: string;
        description: string;
        type: string;
        priority_code: string;
        asset_id: string | null;
        created_by: string;
        due_date?: string;
    }): Promise<{ wo_id: string; wo_number: string } | null> {
        try {
            const woNumber = `WO-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
            const { data, error } = await supabase
                .from('work_orders')
                .insert({
                    wo_number: woNumber,
                    title: woData.title,
                    description: woData.description,
                    status: 'OPEN',
                    type: woData.type || 'CM',
                    priority_code: woData.priority_code || 'MEDIUM',
                    asset_id: woData.asset_id,
                    created_by: woData.created_by || '00000000-0000-0000-0000-000000000000',
                    cost_frozen: false,
                    properties: { de_task_id: deTaskId },
                    ...(woData.due_date ? { due_date: woData.due_date } : {}),
                })
                .select('id, wo_number')
                .single();
            if (error) { console.error('AnalyzeService.generateWOFromDE:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return { wo_id: data.id, wo_number: data.wo_number };
        } catch (e) {
            console.error('Error generating WO from DE task:', e);
            return null;
        }
    }

    /** Fetch all Work Orders linked to a DE task via properties.de_task_id */
    async getLinkedWOs(deTaskId: string): Promise<{ id: string; wo_number: string; title: string; status: string; type: string; priority_code: string | null; created_at: string }[]> {
        try {
            const { data, error } = await supabase
                .from('work_orders')
                .select('id, wo_number, title, status, type, priority_code, created_at')
                .contains('properties', { de_task_id: deTaskId })
                .order('created_at', { ascending: false });
            if (error) { console.error('AnalyzeService.getLinkedWOs:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data ?? [];
        } catch (e) {
            console.error('Error fetching linked WOs:', e);
            return [];
        }
    }

    /** Convenience: fetch DE tasks for a specific asset (for Asset Detail integration) */
    async getDETasksForAsset(assetId: string): Promise<DETask[]> {
        try {
            const { data, error } = await supabase
                .from('ers_defect_elimination_tasks')
                .select('*')
                .eq('asset_id', assetId)
                .order('created_at', { ascending: false });
            if (error) { console.error('AnalyzeService.getDETasksForAsset:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return (data ?? []) as DETask[];
        } catch (e) {
            console.error('Error fetching DE tasks for asset:', e);
            return [];
        }
    }

    /**
     * Auto-advance DE task status when all linked WOs are CLOSED/TECO.
     * Called after WO status transitions to ensure the DE lifecycle progresses.
     * Only advances tasks in 'identified' or 'in_progress' status.
     */
    async checkAndAdvanceDEStatus(deTaskId: string): Promise<boolean> {
        try {
            // 1. Verify DE task exists and is in a progressable state
            const { data: task, error: taskErr } = await supabase
                .from('ers_defect_elimination_tasks')
                .select('id, status')
                .eq('id', deTaskId)
                .single();
            if (taskErr || !task) return false;
            if (task.status !== 'identified' && task.status !== 'in_progress') return false;

            // 2. Fetch all linked WOs
            const linkedWOs = await this.getLinkedWOs(deTaskId);
            if (linkedWOs.length === 0) return false;

            // 3. Check if ALL linked WOs are terminal (CLOSED or TECO)
            const allClosed = linkedWOs.every(wo =>
                wo.status === 'CLOSED' || wo.status === 'TECO'
            );

            if (allClosed) {
                // Auto-advance to 'resolved'
                const { error: updateErr } = await supabase
                    .from('ers_defect_elimination_tasks')
                    .update({ status: 'resolved', updated_at: new Date().toISOString() })
                    .eq('id', deTaskId);
                if (updateErr) {
                    console.error('AnalyzeService.checkAndAdvanceDEStatus update error:', updateErr);
                    return false;
                }
                console.log(`[DE] Task ${deTaskId} auto-advanced to 'resolved' — all ${linkedWOs.length} WOs closed.`);
                return true;
            }

            // If at least one WO is in progress, advance DE to 'in_progress'
            if (task.status === 'identified') {
                const anyWIP = linkedWOs.some(wo =>
                    wo.status === 'WIP' || wo.status === 'SCHEDULED' || wo.status === 'PLAN'
                );
                if (anyWIP) {
                    await supabase
                        .from('ers_defect_elimination_tasks')
                        .update({ status: 'in_progress', updated_at: new Date().toISOString() })
                        .eq('id', deTaskId);
                    console.log(`[DE] Task ${deTaskId} auto-advanced to 'in_progress' — linked WOs active.`);
                    return true;
                }
            }

            return false;
        } catch (e) {
            console.error('Error in checkAndAdvanceDEStatus:', e);
            return false;
        }
    }

    /**
     * Create a PM (recurring_work) entry from a resolved DE task.
     * Closes the ISO 55000 improvement loop back into the maintenance strategy.
     */
    async createPMFromDE(deTaskId: string, pmData: {
        code: string;
        description: string;
        asset_id: string;
        schedule_type: string;
        frequency_interval: number;
        frequency_unit: string;
        work_type: string;
        estimated_hours?: number;
        created_by: string;
    }): Promise<{ pm_id: string } | null> {
        try {
            const { data, error } = await supabase
                .from('recurring_work')
                .insert({
                    code: pmData.code,
                    description: pmData.description,
                    asset_id: pmData.asset_id,
                    schedule_type: pmData.schedule_type,
                    frequency_interval: pmData.frequency_interval,
                    frequency_unit: pmData.frequency_unit,
                    work_type: pmData.work_type || 'PM',
                    estimated_hours: pmData.estimated_hours || 0,
                    status: 'active',
                    created_by: pmData.created_by,
                    properties: { de_task_id: deTaskId },
                })
                .select('id')
                .single();
            if (error) { console.error('AnalyzeService.createPMFromDE:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return { pm_id: data.id };
        } catch (e) {
            console.error('Error creating PM from DE task:', e);
            return null;
        }
    }

    // ═════════════════════════════════════════════════════════
    //  RBD MODELS
    // ═════════════════════════════════════════════════════════

    async getRBDModels(assetId?: string): Promise<RBDModel[]> {
        try {
            let query = supabase.from('ers_rbd_models').select('*').order('updated_at', { ascending: false });
            if (assetId) query = query.eq('asset_id', assetId);
            const { data, error } = await query;
            if (error) { console.error('AnalyzeService.getRBDModels:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return (data ?? []) as RBDModel[];
        } catch (e) {
            console.error('Error fetching RBD models:', e);
            return [];
        }
    }

    async saveRBDModel(model: Omit<RBDModel, 'id' | 'created_at' | 'updated_at'>): Promise<RBDModel | null> {
        try {
            const { data, error } = await supabase.from('ers_rbd_models').insert(model).select().single();
            if (error) { console.error('AnalyzeService.saveRBDModel:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as RBDModel;
        } catch (e) {
            console.error('Error saving RBD model:', e);
            return null;
        }
    }

    async updateRBDModel(id: string, updates: Partial<RBDModel>): Promise<RBDModel | null> {
        try {
            const { data, error } = await supabase.from('ers_rbd_models').update(updates).eq('id', id).select().single();
            if (error) { console.error('AnalyzeService.updateRBDModel:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as RBDModel;
        } catch (e) {
            console.error('Error updating RBD model:', e);
            return null;
        }
    }

    async deleteRBDModel(id: string): Promise<boolean> {
        try {
            const { error } = await supabase.from('ers_rbd_models').delete().eq('id', id);
            if (error) { console.error('AnalyzeService.deleteRBDModel:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return true;
        } catch (e) {
            console.error('Error deleting RBD model:', e);
            return false;
        }
    }

    // ═════════════════════════════════════════════════════════
    //  P&ID CONFIGURATIONS
    // ═════════════════════════════════════════════════════════

    async getPIDConfigs(assetId?: string): Promise<PIDConfig[]> {
        try {
            let query = supabase.from('ers_pid_configurations').select('*').order('updated_at', { ascending: false });
            if (assetId) query = query.eq('asset_id', assetId);
            const { data, error } = await query;
            if (error) { console.error('AnalyzeService.getPIDConfigs:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return (data ?? []) as PIDConfig[];
        } catch (e) {
            console.error('Error fetching PID configs:', e);
            return [];
        }
    }

    async savePIDConfig(config: Omit<PIDConfig, 'id' | 'created_at' | 'updated_at'>): Promise<PIDConfig | null> {
        try {
            const { data, error } = await supabase.from('ers_pid_configurations').insert(config).select().single();
            if (error) { console.error('AnalyzeService.savePIDConfig:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as PIDConfig;
        } catch (e) {
            console.error('Error saving PID config:', e);
            return null;
        }
    }

    async updatePIDConfig(id: string, updates: Partial<PIDConfig>): Promise<PIDConfig | null> {
        try {
            const { data, error } = await supabase.from('ers_pid_configurations').update(updates).eq('id', id).select().single();
            if (error) { console.error('AnalyzeService.updatePIDConfig:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as PIDConfig;
        } catch (e) {
            console.error('Error updating PID config:', e);
            return null;
        }
    }

    async deletePIDConfig(id: string): Promise<boolean> {
        try {
            const { error } = await supabase.from('ers_pid_configurations').delete().eq('id', id);
            if (error) { console.error('AnalyzeService.deletePIDConfig:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return true;
        } catch (e) {
            console.error('Error deleting PID config:', e);
            return false;
        }
    }

    // ─── Collaborator Search (People & Org Units) ─────────────

    async searchContacts(query: string, limit = 15): Promise<{ id: string; name: string; code: string; email: string; department?: string; image?: string; title?: string; roles?: string[] }[]> {
        try {
            let qb = supabase.from('contacts')
                .select('id, name, code, email, title, roles, image_url, organization_unit_id, is_active')
                .neq('is_active', false)  // Include active=true AND active=null
                .order('name')
                .limit(limit);

            // If query is provided, filter; otherwise return first N contacts (browse mode)
            if (query && query.length >= 2) {
                qb = qb.or(`name.ilike.%${query}%,code.ilike.%${query}%,email.ilike.%${query}%`);
            }

            const { data, error } = await qb;
            if (error) { console.error('[Collaborator] searchContacts error:', error); return []; }
            console.log(`[Collaborator] searchContacts("${query}") → ${(data || []).length} results`);
            return (data || []).map((row: any) => ({
                id: row.id,
                name: row.name || '',
                code: row.code || '',
                email: row.email || '',
                title: row.title || '',
                roles: row.roles || [],
                department: undefined,
                image: row.image_url || undefined,
            }));
        } catch (e) { console.error('[Collaborator] searchContacts exception:', e); return []; }
    }

    async searchOrgUnits(query: string, limit = 15): Promise<{ id: string; name: string; code: string; type: string; description?: string }[]> {
        try {
            let qb = supabase.from('organization_units')
                .select('*')
                .order('name')
                .limit(limit);

            if (query && query.length >= 2) {
                qb = qb.or(`name.ilike.%${query}%,code.ilike.%${query}%,type.ilike.%${query}%`);
            }

            const { data, error } = await qb;
            if (error) { console.error('[Collaborator] searchOrgUnits error:', error); return []; }
            console.log(`[Collaborator] searchOrgUnits("${query}") → ${(data || []).length} results`);
            return (data || []).map((row: any) => ({
                id: row.id,
                name: row.name || '',
                code: row.code || '',
                type: row.type || '',
                description: row.description || undefined,
            }));
        } catch (e) { console.error('[Collaborator] searchOrgUnits exception:', e); return []; }
    }

    // ─── Maintenance Data Source ────────────────────────────────

    /**
     * Pull maintenance data for an asset from local EAM or external connector.
     * For 'local': queries work_orders by asset_id (+ child assets for Systems/Units).
     * For 'connector': returns simulated external data (ready for real API).
     */
    async pullMaintenanceData(
        assetId: string,
        targetLevel: string,
        sourceType: 'local' | 'connector',
        connectorId?: string,
        connectorName?: string
    ): Promise<MaintenanceDataSummary> {
        if (sourceType === 'local') {
            try {
                // For Systems/Units, also pull WOs from child equipment
                let assetIds = [assetId];
                const upperLevel = targetLevel?.toUpperCase();
                if (upperLevel === 'SYSTEM' || upperLevel === 'UNIT' || upperLevel === 'SITE') {
                    const { data: children } = await supabase
                        .from('assets')
                        .select('id')
                        .eq('parent_id', assetId);
                    if (children && children.length > 0) {
                        const childIds = children.map(c => c.id);
                        assetIds = [...assetIds, ...childIds];
                        // Also get grandchildren (equipment under systems)
                        const { data: grandchildren } = await supabase
                            .from('assets')
                            .select('id')
                            .in('parent_id', childIds);
                        if (grandchildren && grandchildren.length > 0) {
                            assetIds = [...assetIds, ...grandchildren.map(g => g.id)];
                        }
                    }
                }

                // Pull work orders for this asset (and children) from local EAM
                const { data: wos, error } = await supabase
                    .from('work_orders')
                    .select('id, wo_number, type, status, description, created_at, closed_at, failure_code, failure_mode')
                    .in('asset_id', assetIds)
                    .order('created_at', { ascending: false })
                    .limit(100);

                if (error) {
                    console.warn('pullMaintenanceData: WO query error:', error);
                    return {
                        source: 'local', connectorName: 'Local EAM Database', targetLevel,
                        totalWorkOrders: 0, failureWorkOrders: 0, lastWODate: null,
                        mtbfHours: null, mttrHours: null, topFailureModes: [], workOrderSamples: [],
                    };
                }

                const woList = wos || [];
                if (woList.length === 0) {
                    return {
                        source: 'local', connectorName: 'Local EAM Database', targetLevel,
                        totalWorkOrders: 0, failureWorkOrders: 0, lastWODate: null,
                        mtbfHours: null, mttrHours: null, topFailureModes: [], workOrderSamples: [],
                    };
                }

                const failureWOs = woList.filter(w => w.failure_code || w.failure_mode || w.type === 'CM');

                // Build failure mode frequency
                const fmCounts: Record<string, number> = {};
                failureWOs.forEach(w => {
                    const mode = w.failure_mode || w.failure_code || 'Unspecified';
                    fmCounts[mode] = (fmCounts[mode] || 0) + 1;
                });
                const topFMs = Object.entries(fmCounts)
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 5)
                    .map(([mode, count]) => ({ mode, count }));

                // Calculate MTBF from failure WO dates
                const failureDates = failureWOs
                    .map(w => new Date(w.created_at).getTime())
                    .sort((a, b) => a - b);
                let mtbf: number | null = null;
                if (failureDates.length >= 2) {
                    const intervals = failureDates.slice(1).map((d, i) => d - failureDates[i]);
                    mtbf = Math.round(intervals.reduce((s, v) => s + v, 0) / intervals.length / 3600000);
                }

                // Calculate MTTR from closed WOs (closed_at - created_at)
                let mttr: number | null = null;
                const closedWOs = woList.filter(w => w.closed_at && w.created_at);
                if (closedWOs.length > 0) {
                    const repairHours = closedWOs.map(w => {
                        const start = new Date(w.created_at).getTime();
                        const end = new Date(w.closed_at).getTime();
                        return (end - start) / 3600000;
                    });
                    mttr = Math.round(repairHours.reduce((s, v) => s + v, 0) / repairHours.length);
                }

                return {
                    source: 'local',
                    connectorName: 'Local EAM Database',
                    targetLevel,
                    totalWorkOrders: woList.length,
                    failureWorkOrders: failureWOs.length,
                    lastWODate: woList.length > 0 ? woList[0].created_at : null,
                    mtbfHours: mtbf,
                    mttrHours: mttr,
                    topFailureModes: topFMs,
                    workOrderSamples: woList.slice(0, 10).map(w => ({
                        wo_number: w.wo_number || w.id.slice(0, 8),
                        type: w.type || 'N/A',
                        status: w.status || 'N/A',
                        description: w.description || '',
                        date: w.created_at,
                    })),
                };
            } catch (e) {
                console.error('pullMaintenanceData local error:', e);
                return {
                    source: 'local', connectorName: 'Local EAM Database', targetLevel,
                    totalWorkOrders: 0, failureWorkOrders: 0, lastWODate: null,
                    mtbfHours: null, mttrHours: null, topFailureModes: [], workOrderSamples: [],
                };
            }
        } else {
            // External connector — simulated data (ready for real connector API)
            return this.generateSimulatedData('connector', connectorName || 'External CMMS', targetLevel, connectorId);
        }
    }

    /** Generate realistic simulated maintenance data for demo/stub */
    private generateSimulatedData(
        source: 'local' | 'connector',
        name: string,
        targetLevel: string,
        connectorId?: string
    ): MaintenanceDataSummary {
        const modes = [
            'Bearing Failure', 'Seal Leakage', 'Vibration Excess', 'Overheating',
            'Corrosion', 'Fatigue Crack', 'Electrical Fault', 'Misalignment',
            'Lubrication Failure', 'Cavitation'
        ];
        const types = ['CM', 'PM', 'PDM', 'EM'];
        const statuses = ['CLOSED', 'TECO', 'IN_PROGRESS', 'APPROVED'];
        const totalWO = Math.floor(Math.random() * 40) + 10;
        const failureWO = Math.floor(totalWO * (0.3 + Math.random() * 0.4));
        const topCount = Math.min(5, Math.floor(Math.random() * 4) + 2);

        const shuffled = [...modes].sort(() => Math.random() - 0.5);
        const topFMs = shuffled.slice(0, topCount).map((mode, i) => ({
            mode,
            count: Math.max(1, failureWO - i * Math.floor(failureWO / (topCount + 1))),
        }));

        const samples = Array.from({ length: Math.min(10, totalWO) }, (_, i) => {
            const d = new Date();
            d.setDate(d.getDate() - Math.floor(Math.random() * 365));
            return {
                wo_number: `WO-${String(10000 + Math.floor(Math.random() * 90000))}`,
                type: types[Math.floor(Math.random() * types.length)],
                status: statuses[Math.floor(Math.random() * statuses.length)],
                description: `${shuffled[i % shuffled.length]} on equipment — ${name}`,
                date: d.toISOString(),
            };
        }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        return {
            source,
            connectorId,
            connectorName: name,
            targetLevel,
            totalWorkOrders: totalWO,
            failureWorkOrders: failureWO,
            lastWODate: samples[0]?.date || null,
            mtbfHours: Math.floor(Math.random() * 8000) + 1000,
            mttrHours: Math.floor(Math.random() * 48) + 4,
            topFailureModes: topFMs,
            workOrderSamples: samples,
        };
    }

    /** Persist analysis data source context to Supabase */
    async saveAnalysisDataSource(
        analysisId: string,
        analysisType: 'rca' | 'fmea',
        summary: MaintenanceDataSummary
    ): Promise<AnalysisDataSourceRecord | null> {
        try {
            const row = {
                analysis_id: analysisId,
                analysis_type: analysisType,
                source_mode: summary.source === 'manual' ? 'manual' : 'connected',
                connector_id: summary.connectorId || null,
                connector_name: summary.connectorName || null,
                target_level: summary.targetLevel,
                total_work_orders: summary.totalWorkOrders,
                failure_work_orders: summary.failureWorkOrders,
                last_wo_date: summary.lastWODate,
                mtbf_hours: summary.mtbfHours,
                mttr_hours: summary.mttrHours,
                top_failure_modes: summary.topFailureModes,
                work_order_samples: summary.workOrderSamples,
                manual_notes: summary.manualNotes || null,
            };
            const { data, error } = await supabase
                .from('ers_analysis_data_sources')
                .insert(row)
                .select()
                .single();
            if (error) { console.error('saveAnalysisDataSource:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as AnalysisDataSourceRecord;
        } catch (e) {
            console.error('Error saving analysis data source:', e);
            return null;
        }
    }

    /** Retrieve data source context for an analysis */
    async getAnalysisDataSource(analysisId: string): Promise<AnalysisDataSourceRecord | null> {
        try {
            const { data, error } = await supabase
                .from('ers_analysis_data_sources')
                .select('*')
                .eq('analysis_id', analysisId)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            if (error) { console.error('getAnalysisDataSource:', error); notifyError('Something went wrong — please retry (details in the console).'); throw error; }
            return data as AnalysisDataSourceRecord | null;
        } catch (e) {
            console.error('Error fetching analysis data source:', e);
            return null;
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  CRITICALITY ASSESSMENTS  (ISO 14224 / ISO 31000)
    // ═══════════════════════════════════════════════════════════

    /** Fetch all criticality assessments, joined with asset info */
    async getCriticalityAssessments(): Promise<CriticalityAssessment[]> {
        try {
            const { data, error } = await supabase
                .from('ers_criticality_assessments')
                .select('*, assets!inner(tag, name, hierarchy_level, criticality)')
                .order('risk_score', { ascending: false });
            if (error) throw error;
            return (data || []).map((row: any) => ({
                id: row.id,
                asset_id: row.asset_id,
                asset_tag: row.assets?.tag || '',
                asset_name: row.assets?.name || '',
                hierarchy_level: row.assets?.hierarchy_level || '',
                current_criticality: row.assets?.criticality || 'C',
                consequence_safety: row.consequence_safety,
                consequence_environment: row.consequence_environment,
                consequence_production: row.consequence_production,
                consequence_cost: row.consequence_cost,
                consequence_reputation: row.consequence_reputation,
                probability: row.probability,
                risk_score: row.risk_score,
                overall_criticality: row.overall_criticality,
                notes: row.notes,
                assessed_by: row.assessed_by,
                assessed_at: row.assessed_at,
            }));
        } catch (e) {
            console.error('[AnalyzeService] getCriticalityAssessments error:', e);
            return [];
        }
    }

    /** Upsert a criticality assessment for an asset (insert or update) */
    async saveCriticalityAssessment(
        assessment: Omit<CriticalityAssessment, 'id' | 'assessed_at' | 'risk_score' | 'asset_tag' | 'asset_name' | 'hierarchy_level' | 'current_criticality'>
    ): Promise<CriticalityAssessment | null> {
        try {
            // Calculate overall criticality from risk score
            const maxC = Math.max(
                assessment.consequence_safety,
                assessment.consequence_environment,
                assessment.consequence_production,
                assessment.consequence_cost,
                assessment.consequence_reputation,
            );
            const riskScore = maxC * assessment.probability;
            const overall: 'A' | 'B' | 'C' = riskScore >= 15 ? 'A' : riskScore >= 8 ? 'B' : 'C';

            const { data, error } = await supabase
                .from('ers_criticality_assessments')
                .upsert({
                    asset_id: assessment.asset_id,
                    consequence_safety: assessment.consequence_safety,
                    consequence_environment: assessment.consequence_environment,
                    consequence_production: assessment.consequence_production,
                    consequence_cost: assessment.consequence_cost,
                    consequence_reputation: assessment.consequence_reputation,
                    probability: assessment.probability,
                    overall_criticality: overall,
                    notes: assessment.notes || null,
                    assessed_by: assessment.assessed_by || null,
                    assessed_at: new Date().toISOString(),
                }, { onConflict: 'asset_id' })
                .select()
                .single();
            if (error) throw error;

            // Also update the asset's criticality column
            await supabase
                .from('assets')
                .update({ criticality: overall })
                .eq('id', assessment.asset_id);

            return data as CriticalityAssessment;
        } catch (e) {
            console.error('[AnalyzeService] saveCriticalityAssessment error:', e);
            return null;
        }
    }

    /** Batch-update criticality for multiple assets at once */
    async batchUpdateCriticality(
        assetIds: string[],
        overall: 'A' | 'B' | 'C'
    ): Promise<boolean> {
        try {
            // Update the asset table
            const { error: assetError } = await supabase
                .from('assets')
                .update({ criticality: overall })
                .in('id', assetIds);
            if (assetError) throw assetError;

            // Upsert assessment records with default consequence/probability
            const defaults = overall === 'A'
                ? { consequence_safety: 5, consequence_environment: 4, consequence_production: 4, consequence_cost: 3, consequence_reputation: 3, probability: 4 }
                : overall === 'B'
                    ? { consequence_safety: 3, consequence_environment: 2, consequence_production: 3, consequence_cost: 2, consequence_reputation: 2, probability: 3 }
                    : { consequence_safety: 1, consequence_environment: 1, consequence_production: 2, consequence_cost: 1, consequence_reputation: 1, probability: 2 };

            const rows = assetIds.map(id => ({
                asset_id: id,
                ...defaults,
                overall_criticality: overall,
                assessed_at: new Date().toISOString(),
            }));

            const { error: upsertError } = await supabase
                .from('ers_criticality_assessments')
                .upsert(rows, { onConflict: 'asset_id' });
            if (upsertError) throw upsertError;

            return true;
        } catch (e) {
            console.error('[AnalyzeService] batchUpdateCriticality error:', e);
            return false;
        }
    }

    // ══════════════════════════════════════════════════════════
    //  EAM CONTEXT PANEL — Asset & WO Integration
    // ══════════════════════════════════════════════════════════

    /** Fetch full asset detail with parent hierarchy breadcrumb */
    async getAssetDetail(assetId: string): Promise<EAMAssetDetail | null> {
        try {
            const { data, error } = await supabase
                .from('assets')
                .select('*')
                .eq('id', assetId)
                .single();
            if (error || !data) { console.warn('AnalyzeService.getAssetDetail: not found', error); return null; }
            // Build hierarchy breadcrumb by walking parent_id chain
            const breadcrumb: { id: string; name: string; level: string }[] = [];
            let current = data;
            // Walk up to 6 levels (ISO 14224 max depth)
            for (let i = 0; i < 6 && current.parent_id; i++) {
                const { data: parent } = await supabase.from('assets').select('id, name, hierarchy_level, parent_id').eq('id', current.parent_id).single();
                if (!parent) break;
                breadcrumb.unshift({ id: parent.id, name: parent.name, level: parent.hierarchy_level || '' });
                current = parent;
            }
            return {
                id: data.id,
                asset_tag: data.asset_tag || data.code || '',
                name: data.name || '',
                description: data.description || '',
                hierarchy_level: data.hierarchy_level || '',
                criticality: data.criticality || 'C',
                status: data.status || 'active',
                manufacturer: data.manufacturer || null,
                model: data.model || null,
                serial_number: data.serial_number || null,
                equipment_type: data.equipment_type || data.asset_type || null,
                location: data.location || null,
                install_date: data.install_date || data.commission_date || null,
                parent_id: data.parent_id || null,
                breadcrumb,
            };
        } catch (e) {
            console.error('Error fetching asset detail:', e);
            return null;
        }
    }

    /** Aggregate failure trends for an asset — modes, timeline, costs from last 12 months */
    async getFailureTrends(assetId: string): Promise<EAMFailureTrends> {
        try {
            const cutoff = new Date();
            cutoff.setMonth(cutoff.getMonth() - 12);
            const { data, error } = await supabase
                .from('work_orders')
                .select('id, wo_number, type, status, failure_mode, failure_code, total_actual_cost, frozen_labor_cost, frozen_material_cost, created_at, closed_at, wo_failure_data!wo_id(*)')
                .eq('asset_id', assetId)
                .gte('created_at', cutoff.toISOString())
                .order('created_at', { ascending: true });
            if (error) { console.error('AnalyzeService.getFailureTrends:', error); return { modes: [], timeline: [], totalCM: 0, totalPM: 0, totalCost: 0 }; }
            const rows = data || [];
            // Separate CM vs PM
            const cmRows = rows.filter(r => r.type === 'CM' || r.failure_mode || r.failure_code || r.type === 'BM' || r.type === 'EM');
            const pmRows = rows.filter(r => r.type === 'PM' || r.type === 'PREVENTIVE');
            // Failure mode frequency
            const modeMap = new Map<string, { count: number; totalCost: number; lastDate: string }>();
            for (const wo of cmRows) {
                const fd = (wo as any).wo_failure_data?.[0] || (wo as any).wo_failure_data;
                const mode = fd?.failure_mode_code || wo.failure_mode || 'Unspecified';
                const prev = modeMap.get(mode) || { count: 0, totalCost: 0, lastDate: '' };
                prev.count++;
                prev.totalCost += woCost(wo);
                if (wo.created_at > prev.lastDate) prev.lastDate = wo.created_at;
                modeMap.set(mode, prev);
            }
            const modes = Array.from(modeMap.entries())
                .map(([mode, d]) => ({ mode, count: d.count, totalCost: d.totalCost, lastOccurrence: d.lastDate }))
                .sort((a, b) => b.count - a.count);
            // Timeline
            const timeline = cmRows.map(wo => ({
                date: wo.created_at,
                wo_number: wo.wo_number || '—',
                mode: ((wo as any).wo_failure_data?.[0]?.failure_mode_code || wo.failure_mode || 'Unspecified'),
                cost: woCost(wo),
                type: wo.type || 'CM',
            }));
            const totalCost = rows.reduce((sum, wo) => sum + woCost(wo), 0);
            return { modes, timeline, totalCM: cmRows.length, totalPM: pmRows.length, totalCost };
        } catch (e) {
            console.error('Error fetching failure trends:', e);
            return { modes: [], timeline: [], totalCM: 0, totalPM: 0, totalCost: 0 };
        }
    }
}

export const analyzeService = AnalyzeService.getInstance();
export default analyzeService;
