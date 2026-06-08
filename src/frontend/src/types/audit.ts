// ═══════════════════════════════════════════════════════════════════════
//  Audit Management Types
//  Standards: ISO 55001:2024, GFMAM Landscape, OSHA 1910.119, API 580/581
// ═══════════════════════════════════════════════════════════════════════

// ── Enums ──
export type AuditDomain = 'AMS' | 'AIM' | 'PSM' | 'CUSTOM';
export type AuditMgmtStatus = 'planned' | 'in_progress' | 'completed' | 'closed' | 'cancelled';
export type AuditMgmtType = 'routine' | 'regulatory' | 'surveillance' | 'certification' | 'turnaround' | 'incident' | 'management' | 'self_assessment';
export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';
export type AuditFindingType = 'major_nc' | 'minor_nc' | 'observation' | 'opportunity' | 'positive_practice';
export type AuditCAStatus = 'open' | 'in_progress' | 'completed' | 'verified' | 'overdue' | 'cancelled';
export type ComplianceAnswer = 'YES' | 'NO' | 'PARTIAL' | 'N_A';
export type ParticipantRole = 'lead_auditor' | 'auditor' | 'auditee' | 'observer' | 'subject_matter_expert' | 'scribe' | 'sponsor';
export type CAType = 'corrective' | 'preventive' | 'improvement';

// ── Maturity Scale (IAM 0-5) ──
export const MATURITY_LEVELS = [
    { value: 0, label: 'Innocent', description: 'No evidence of the requirement', color: '#ef4444' },
    { value: 1, label: 'Aware', description: 'Intent recognized, no systematic approach', color: '#f97316' },
    { value: 2, label: 'Developing', description: 'Credible plans, partially implemented', color: '#eab308' },
    { value: 3, label: 'Competent', description: 'Systematic, consistent, ISO conformant', color: '#22c55e' },
    { value: 4, label: 'Professional', description: 'Optimized, integrated, continuous improvement', color: '#3b82f6' },
    { value: 5, label: 'Excellent', description: 'Predictive, AI-driven, strategic alignment', color: '#8b5cf6' },
] as const;

// ── Template Interfaces ──
export interface AuditTemplate {
    id: string;
    code: string;
    name: string;
    description: string;
    standard_reference: string;
    audit_domain: AuditDomain;
    industry: string;
    version: string;
    maturity_scale: string;
    total_sections: number;
    total_questions: number;
    is_active: boolean;
    sections?: AuditTemplateSection[];
}

export interface AuditTemplateSection {
    id: string;
    template_id: string;
    code: string;
    title: string;
    description?: string;
    sort_order: number;
    weight: number;
    standard_clause?: string;
    parent_section_id?: string | null;
    questions?: AuditTemplateQuestion[];
}

export interface AuditTemplateQuestion {
    id: string;
    section_id: string;
    code: string;
    question_text: string;
    guidance_notes?: string;
    evidence_expected?: string;
    question_type: 'maturity' | 'yes_no' | 'text' | 'numeric';
    is_mandatory: boolean;
    sort_order: number;
}

// ── Live Audit Interfaces ──
export interface AuditRecord {
    id: string;
    audit_number: string;
    template_id: string | null;
    audit_type: AuditMgmtType;
    audit_domain: AuditDomain;
    status: AuditMgmtStatus;
    scheduled_date: string | null;
    start_date: string | null;
    completion_date: string | null;
    scope: string;
    objectives?: string;
    criteria?: string;
    site_id?: string | null;
    site_name?: string;
    industry: string;
    overall_maturity: number | null;
    overall_compliance_pct: number | null;
    sections_completed: number;
    total_sections: number;
    total_findings: number;
    open_findings: number;
    critical_findings: number;
    lead_auditor_name?: string;
    approved_by?: string | null;
    approved_at?: string | null;
    closed_by?: string | null;
    closed_at?: string | null;
    ai_summary?: string;
    ai_recommendations?: AuditAIRecommendation[];
    created_by?: string;
    created_at: string;
    updated_at: string;
    // Joined data
    participants?: AuditParticipant[];
    findings?: AuditFindingRecord[];
    template?: AuditTemplate;
}

export interface AuditAIRecommendation {
    gap: string;
    clause: string;
    current_score: number;
    target_score: number;
    recommendation: string;
    service_offering?: string;
    priority: 'critical' | 'high' | 'medium' | 'low';
}

export interface AuditParticipant {
    id: string;
    audit_id: string;
    contact_id?: string | null;
    full_name: string;
    company?: string;
    email?: string;
    mobile?: string;
    job_title?: string;
    participant_role: ParticipantRole;
    certifications: string[];
    signed_off: boolean;
    signed_at?: string | null;
}

export interface AuditResponse {
    id: string;
    audit_id: string;
    question_id: string;
    section_id: string;
    maturity_score: number | null;
    compliance_answer: ComplianceAnswer | null;
    evidence_notes?: string;
    evidence_attachments: string[];
    assessor_comments?: string;
    assessed_by?: string;
    assessed_at?: string;
}

export interface AuditFindingRecord {
    id: string;
    audit_id: string;
    finding_number: string;
    response_id?: string | null;
    section_code?: string;
    finding_type: AuditFindingType;
    severity: FindingSeverity;
    description: string;
    standard_reference?: string;
    evidence?: string;
    root_cause?: string;
    risk_rating?: string;
    asset_id?: string | null;
    ca_count: number;
    ca_closed: number;
    status: string;
    raised_by?: string;
    raised_at: string;
    closed_at?: string | null;
    corrective_actions?: AuditCorrectiveAction[];
}

export interface AuditCorrectiveAction {
    id: string;
    finding_id: string;
    ca_number: string;
    action_type: CAType;
    description: string;
    assigned_to_contact_id?: string | null;
    assigned_to_name?: string;
    assigned_to_company?: string;
    due_date?: string | null;
    status: AuditCAStatus;
    completion_date?: string | null;
    completion_notes?: string;
    verified_by?: string | null;
    verified_at?: string | null;
    verification_notes?: string;
    wo_id?: string | null;
    wo_number?: string;
    escalated: boolean;
    escalation_reason?: string;
    created_at: string;
}

// ── Section Score (calculated) ──
export interface SectionScore {
    section_id: string;
    section_code: string;
    section_title: string;
    weight: number;
    average_maturity: number;
    questions_answered: number;
    total_questions: number;
    compliance_pct: number;
    findings_count: number;
}

// ── Audit Summary KPIs ──
export interface AuditModuleSummary {
    total_audits: number;
    planned: number;
    in_progress: number;
    completed: number;
    total_findings: number;
    open_findings: number;
    critical_findings: number;
    overdue_cas: number;
    ca_closure_rate_pct: number;
    avg_maturity: number | null;
}

// ── Certifications List ──
export const AUDITOR_CERTIFICATIONS = [
    'CAMA', 'CAMA2', 'API-510', 'API-570', 'API-653', 'API-580',
    'CWI', 'CMRP', 'CRL', 'CMRT', 'ISO-55001-LA',
    'NEBOSH', 'IOSH', 'CSP', 'CIH', 'PE'
] as const;

export const INDUSTRY_OPTIONS = [
    { value: 'OIL_GAS', label: 'Oil & Gas' },
    { value: 'MANUFACTURING', label: 'Manufacturing' },
    { value: 'MINING', label: 'Mining' },
    { value: 'POWER_GEN', label: 'Power Generation' },
    { value: 'WATER', label: 'Water & Wastewater' },
    { value: 'GENERAL', label: 'General' },
] as const;
