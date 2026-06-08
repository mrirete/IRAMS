/**
 * AssessmentService — CRUD for 7-Step Integrated Audit Assessments
 * 
 * Provides full save/load/update/delete/list for the complete AuditAssessmentState.
 * Persists to Supabase `audit_assessments` table (migrations 0133 + 0135).
 * 
 * All 7 steps are persisted:
 *   Step 1: Intake & Scope (assessor, risks, opportunities, org context, ISO alignment)
 *   Step 2: Document Review (JSONB)
 *   Step 3: Site Verification (JSONB)
 *   Step 4: Interviews (JSONB)
 *   Step 5: 6M Dimension Results (JSONB)
 *   Step 6: Scored Findings (JSONB)
 *   Step 7: Report & Roadmap (JSONB)
 */

import { supabase } from '../lib/supabase';
import type { AuditRegistration, DimensionResult, AuditReport, ImprovementRoadmap } from './AuditAssessor';
import type { AuditAssessmentState, AuditIntakeData, DocumentReviewItem, SiteVerificationItem, InterviewRecord, ScoredFinding } from './AuditTypes';
import { auditPeopleBridge } from './AuditPeopleBridge';

// ─── DB Row Type ──────────────────────────────────────────────────

export interface AssessmentRecord {
    id: string;
    assessment_number: string;
    assessor_name: string;
    assessor_username: string | null;
    assessor_job_title: string | null;
    assessor_company: string;
    assessor_email: string;
    assessor_mobile: string | null;
    assessor_mobile_country_code: string | null;
    assessor_site: string | null;
    industry_sector: string;
    asset_class: string | null;
    audit_objective: string | null;
    reporting_line: string | null;
    key_risks: string | null;           // Legacy TEXT column
    key_risks_arr: string[];            // New JSONB array
    key_opportunities: string[];        // New JSONB array
    org_vision: string | null;
    org_mission: string | null;
    org_strategic_objectives: string | null;
    org_am_policy: string | null;
    org_samp: string | null;
    org_roles_authorities: string | null;
    org_risk_framework: string | null;
    org_budget_alignment: string | null;
    iso_series_alignment: Record<string, string> | null;
    document_review: DocumentReviewItem[];
    site_verification: SiteVerificationItem[];
    interview_register: InterviewRecord[];
    dimension_results: DimensionResult[];
    dimensions_completed: number;
    total_dimensions: number;
    scored_findings: ScoredFinding[];
    current_step: number;
    status: 'in_progress' | 'completed' | 'archived' | 'deleted';
    overall_maturity: number | null;
    overall_percentage: number | null;
    maturity_level: string | null;
    report_data: AuditReport | null;
    roadmap_data: ImprovementRoadmap | null;
    notes: string | null;
    created_by: string | null;
    updated_by: string | null;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
    archived_at: string | null;
}

export interface AssessmentListItem {
    id: string;
    assessment_number: string;
    assessor_name: string;
    assessor_company: string;
    assessor_site: string | null;
    industry_sector: string;
    status: string;
    current_step: number;
    dimensions_completed: number;
    overall_maturity: number | null;
    maturity_level: string | null;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
}

export interface AssessmentSummary {
    total: number;
    in_progress: number;
    completed: number;
    archived: number;
    avg_maturity: number | null;
}

// ─── Hydration: DB Row → App State ───────────────────────────────

function hydrateState(record: AssessmentRecord): AuditAssessmentState {
    return {
        id: record.id,
        assessmentNumber: record.assessment_number,
        currentStep: record.current_step || 1,
        status: record.status,
        intake: {
            firstName: (record.assessor_name || '').split(' ')[0] || '',
            lastName: (record.assessor_name || '').split(' ').slice(1).join(' ') || '',
            fullName: record.assessor_name || '',
            username: record.assessor_username || '',
            autoUsername: true,
            jobTitle: record.assessor_job_title || '',
            company: record.assessor_company || '',
            email: record.assessor_email || '',
            mobile: record.assessor_mobile || '',
            mobileCountryCode: record.assessor_mobile_country_code || '',
            siteName: record.assessor_site || '',
            industrySector: record.industry_sector || 'Oil & Gas (Upstream)',
            assetClass: record.asset_class || 'Mixed / All Classes',
            auditDate: record.created_at || '',
            auditObjective: record.audit_objective || '',
            reportingLine: record.reporting_line || '',
            keyRisks: record.key_risks_arr || [],
            keyOpportunities: record.key_opportunities || [],
            orgVision: record.org_vision || '',
            orgMission: record.org_mission || '',
            orgStrategicObjectives: record.org_strategic_objectives || '',
            orgAMPolicy: record.org_am_policy || '',
            orgSAMP: record.org_samp || '',
            orgRolesAuthorities: record.org_roles_authorities || '',
            orgRiskFramework: record.org_risk_framework || '',
            orgBudgetAlignment: record.org_budget_alignment || '',
            isoAlignment: record.iso_series_alignment as AuditIntakeData['isoAlignment'] || {
                iso55010_financial_alignment: '', iso55010_register_alignment: '', iso55010_capex_integration: '',
                iso55011_regulatory_mapping: '', iso55011_policy_engagement: '',
                iso55012_competence_framework: '', iso55012_cultural_factors: '', iso55012_outsourced_competence: '',
                iso55013_data_governance: '', iso55013_data_quality: '', iso55013_data_asset_distinction: '',
            },
        },
        documentReview: record.document_review || [],
        siteVerification: record.site_verification || [],
        interviews: record.interview_register || [],
        sixmChecklistAnswers: record.sixm_checklist_answers || [],
        sixmDimensionNotes: record.sixm_dimension_notes || {},
        dimensionResults: record.dimension_results || [],
        dimensionsCompleted: record.dimensions_completed || 0,
        scoredFindings: record.scored_findings || [],
        overallMaturity: record.overall_maturity,
        overallPercentage: record.overall_percentage,
        maturityLevel: record.maturity_level,
        reportData: record.report_data,
        roadmapData: record.roadmap_data,
        notes: record.notes || '',
    };
}

// ─── Dehydration: App State → DB Payload ─────────────────────────

function dehydrateState(state: AuditAssessmentState): Record<string, any> {
    const intake = state.intake;
    const isComplete = state.dimensionResults.length >= 6 && state.reportData != null;

    return {
        // Step 1: Assessor (empty-string fallbacks for auto-save before form completion)
        assessor_name: `${intake.firstName} ${intake.lastName}`.trim() || intake.fullName || '',
        assessor_username: intake.username || null,
        assessor_job_title: intake.jobTitle || null,
        assessor_company: intake.company || '',
        assessor_email: intake.email || '',
        assessor_mobile: intake.mobile || null,
        assessor_mobile_country_code: intake.mobileCountryCode || null,
        assessor_site: intake.siteName || null,
        industry_sector: intake.industrySector || 'Oil & Gas (Upstream)',
        asset_class: intake.assetClass || null,

        // Step 1: Scope (ISO 55001 §6.1)
        audit_objective: intake.auditObjective || null,
        reporting_line: intake.reportingLine || null,
        key_risks_arr: intake.keyRisks || [],
        key_opportunities: intake.keyOpportunities || [],

        // Step 1: Organizational Context (§4)
        org_vision: intake.orgVision || null,
        org_mission: intake.orgMission || null,
        org_strategic_objectives: intake.orgStrategicObjectives || null,
        org_am_policy: intake.orgAMPolicy || null,
        org_samp: intake.orgSAMP || null,
        org_roles_authorities: intake.orgRolesAuthorities || null,
        org_risk_framework: intake.orgRiskFramework || null,
        org_budget_alignment: intake.orgBudgetAlignment || null,

        // Step 1: ISO Series Alignment
        iso_series_alignment: intake.isoAlignment || {},

        // Step 2-4: JSONB arrays
        document_review: state.documentReview || [],
        site_verification: state.siteVerification || [],
        interview_register: state.interviews || [],

        // 6M Guided Checklist (assessment flow)
        sixm_checklist_answers: state.sixmChecklistAnswers || [],
        sixm_dimension_notes: state.sixmDimensionNotes || {},

        // Step 5: 6M Assessment (legacy/template)
        dimension_results: state.dimensionResults || [],
        dimensions_completed: state.dimensionsCompleted || state.dimensionResults?.length || 0,

        // Step 6: Scored Findings
        scored_findings: state.scoredFindings || [],

        // Step 7: Report
        overall_maturity: state.overallMaturity || (state.reportData as any)?.overallScore || null,
        overall_percentage: state.overallPercentage || (state.reportData as any)?.overallPercentage || null,
        maturity_level: state.maturityLevel || (state.reportData as any)?.maturityLevel || null,
        report_data: state.reportData || null,
        roadmap_data: state.roadmapData || null,

        // Workflow
        current_step: state.currentStep,
        status: isComplete ? 'completed' : (state.status || 'in_progress'),
        notes: state.notes || null,
        completed_at: isComplete ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
    };
}

// ─── Service Class ────────────────────────────────────────────────

export class AssessmentService {
    private static instance: AssessmentService;

    static getInstance(): AssessmentService {
        if (!AssessmentService.instance) AssessmentService.instance = new AssessmentService();
        return AssessmentService.instance;
    }

    // ═══════════════════════════════════════════════════════════════
    //  LIST
    // ═══════════════════════════════════════════════════════════════

    async listAssessments(filters?: {
        status?: string;
        industry?: string;
        search?: string;
        limit?: number;
        offset?: number;
    }): Promise<AssessmentListItem[]> {
        let query = supabase
            .from('audit_assessments')
            .select('id, assessment_number, assessor_name, assessor_company, assessor_site, industry_sector, status, current_step, dimensions_completed, overall_maturity, maturity_level, created_at, updated_at, completed_at')
            .neq('status', 'deleted')
            .order('updated_at', { ascending: false });

        if (filters?.status) query = query.eq('status', filters.status);
        if (filters?.industry) query = query.eq('industry_sector', filters.industry);
        if (filters?.search) {
            query = query.or(`assessor_name.ilike.%${filters.search}%,assessor_company.ilike.%${filters.search}%,assessment_number.ilike.%${filters.search}%`);
        }
        if (filters?.limit) query = query.limit(filters.limit);
        if (filters?.offset) query = query.range(filters.offset, filters.offset + (filters.limit || 50) - 1);

        const { data, error } = await query;
        if (error) { console.error('[AssessmentService] listAssessments:', error); return []; }
        return (data || []) as AssessmentListItem[];
    }

    async getSummary(): Promise<AssessmentSummary> {
        const { data, error } = await supabase
            .from('audit_assessments')
            .select('status, overall_maturity')
            .neq('status', 'deleted');

        if (error || !data) return { total: 0, in_progress: 0, completed: 0, archived: 0, avg_maturity: null };

        const total = data.length;
        const in_progress = data.filter(r => r.status === 'in_progress').length;
        const completed = data.filter(r => r.status === 'completed').length;
        const archived = data.filter(r => r.status === 'archived').length;
        const scores = data.filter(r => r.overall_maturity != null).map(r => r.overall_maturity as number);
        const avg_maturity = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

        return { total, in_progress, completed, archived, avg_maturity };
    }

    // ═══════════════════════════════════════════════════════════════
    //  GET (returns full record)
    // ═══════════════════════════════════════════════════════════════

    async getAssessment(id: string): Promise<AssessmentRecord | null> {
        const { data, error } = await supabase
            .from('audit_assessments')
            .select('*')
            .eq('id', id)
            .single();
        if (error) { console.error('[AssessmentService] getAssessment:', error); return null; }
        return data as AssessmentRecord;
    }

    /**
     * Load a record and hydrate it into the full AuditAssessmentState
     * for resuming in the AuditWizard.
     */
    async loadState(id: string): Promise<AuditAssessmentState | null> {
        const record = await this.getAssessment(id);
        if (!record) return null;
        return hydrateState(record);
    }

    // ═══════════════════════════════════════════════════════════════
    //  CREATE — Full state persistence
    // ═══════════════════════════════════════════════════════════════

    async createAssessment(
        state: AuditAssessmentState
    ): Promise<AssessmentRecord | null>;
    /** Legacy overload for backward compatibility */
    async createAssessment(
        registration: AuditRegistration,
        dimensionResults: DimensionResult[],
        report?: AuditReport,
        roadmap?: ImprovementRoadmap
    ): Promise<AssessmentRecord | null>;
    async createAssessment(
        stateOrRegistration: AuditAssessmentState | AuditRegistration,
        dimensionResults?: DimensionResult[],
        report?: AuditReport,
        roadmap?: ImprovementRoadmap
    ): Promise<AssessmentRecord | null> {
        let payload: Record<string, any>;

        // Detect if called with full state or legacy registration
        if ('intake' in stateOrRegistration && 'currentStep' in stateOrRegistration) {
            // Full state mode
            payload = dehydrateState(stateOrRegistration);
        } else {
            // Legacy registration mode
            const reg = stateOrRegistration as AuditRegistration;
            const isComplete = (dimensionResults?.length || 0) >= 6 && report != null;
            payload = {
                assessor_name: reg.fullName,
                assessor_job_title: reg.jobTitle || null,
                assessor_company: reg.company,
                assessor_email: reg.email,
                assessor_mobile: reg.mobile || null,
                assessor_site: reg.siteName || null,
                industry_sector: reg.industrySector,
                status: isComplete ? 'completed' : 'in_progress',
                dimensions_completed: dimensionResults?.length || 0,
                overall_maturity: report?.overallScore || null,
                overall_percentage: report?.overallPercentage || null,
                maturity_level: report?.maturityLevel || null,
                dimension_results: dimensionResults || [],
                report_data: report || null,
                roadmap_data: roadmap || null,
                completed_at: isComplete ? new Date().toISOString() : null,
            };
        }

        const { data, error } = await supabase
            .from('audit_assessments')
            .insert(payload)
            .select('*')
            .single();

        if (error) { console.error('[AssessmentService] createAssessment:', error); return null; }
        return data as AssessmentRecord;
    }

    // ═══════════════════════════════════════════════════════════════
    //  SAVE — Smart create-or-update from wizard state
    // ═══════════════════════════════════════════════════════════════

    /**
     * Upsert the full wizard state. If the state has an `id`, updates
     * the existing record. Otherwise, creates a new one.
     * Returns the record ID.
     */
    async saveState(state: AuditAssessmentState): Promise<string | null> {
        let recordId: string | null = null;

        if (state.id) {
            const ok = await this.updateFullState(state.id, state);
            recordId = ok ? state.id : null;
        } else {
            const record = await this.createAssessment(state);
            recordId = record?.id || null;
        }

        // Bridge: Sync assessor into People module (non-blocking)
        if (recordId && state.intake?.username) {
            auditPeopleBridge.syncAssessor(state.intake, state.assessmentNumber)
                .then(result => {
                    if (result.success) {
                        console.log(`[AssessmentService] People bridge: ${result.action} — ${result.message}`);
                    } else {
                        console.warn(`[AssessmentService] People bridge failed: ${result.error}`);
                    }
                })
                .catch(err => console.warn('[AssessmentService] People bridge error:', err));
        }

        return recordId;
    }

    // ═══════════════════════════════════════════════════════════════
    //  UPDATE — Full state update
    // ═══════════════════════════════════════════════════════════════

    /**
     * Full state update — persists ALL 7 steps worth of data.
     */
    async updateFullState(id: string, state: AuditAssessmentState): Promise<boolean> {
        const payload = dehydrateState(state);

        const { error } = await supabase
            .from('audit_assessments')
            .update(payload)
            .eq('id', id);

        if (error) { console.error('[AssessmentService] updateFullState:', error); return false; }
        return true;
    }

    /**
     * Partial update — backward compatible for selective field updates.
     */
    async updateAssessment(
        id: string,
        updates: {
            dimensionResults?: DimensionResult[];
            report?: AuditReport;
            roadmap?: ImprovementRoadmap;
            notes?: string;
            status?: 'in_progress' | 'completed' | 'archived';
        }
    ): Promise<boolean> {
        const payload: Record<string, any> = {
            updated_at: new Date().toISOString(),
        };

        if (updates.dimensionResults) {
            payload.dimension_results = updates.dimensionResults;
            payload.dimensions_completed = updates.dimensionResults.length;
        }
        if (updates.report) {
            payload.report_data = updates.report;
            payload.overall_maturity = updates.report.overallScore;
            payload.overall_percentage = updates.report.overallPercentage;
            payload.maturity_level = updates.report.maturityLevel;
        }
        if (updates.roadmap) payload.roadmap_data = updates.roadmap;
        if (updates.notes !== undefined) payload.notes = updates.notes;
        if (updates.status) {
            payload.status = updates.status;
            if (updates.status === 'completed') payload.completed_at = new Date().toISOString();
            if (updates.status === 'archived') payload.archived_at = new Date().toISOString();
        }

        const { error } = await supabase
            .from('audit_assessments')
            .update(payload)
            .eq('id', id);

        if (error) { console.error('[AssessmentService] updateAssessment:', error); return false; }
        return true;
    }

    // ═══════════════════════════════════════════════════════════════
    //  DELETE (soft-delete: sets status to 'deleted')
    // ═══════════════════════════════════════════════════════════════

    async deleteAssessment(id: string): Promise<boolean> {
        const { error } = await supabase
            .from('audit_assessments')
            .update({ status: 'deleted', updated_at: new Date().toISOString() })
            .eq('id', id);

        if (error) { console.error('[AssessmentService] deleteAssessment:', error); return false; }
        return true;
    }

    async hardDeleteAssessment(id: string): Promise<boolean> {
        const { error } = await supabase
            .from('audit_assessments')
            .delete()
            .eq('id', id);

        if (error) { console.error('[AssessmentService] hardDeleteAssessment:', error); return false; }
        return true;
    }

    // ═══════════════════════════════════════════════════════════════
    //  ARCHIVE / RESTORE
    // ═══════════════════════════════════════════════════════════════

    async archiveAssessment(id: string): Promise<boolean> {
        return this.updateAssessment(id, { status: 'archived' });
    }

    async restoreAssessment(id: string): Promise<boolean> {
        return this.updateAssessment(id, { status: 'completed' });
    }
}

export const assessmentService = AssessmentService.getInstance();
