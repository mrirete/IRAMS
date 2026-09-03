/**
 * OrgContextService — the audit becomes the agents' brain (migration 0308).
 *
 * Maintains ONE org_context row per company from the newest saved assessment:
 * industry, stated objectives, key risks, ISO 55001 governance status, the
 * self-reported intake maturity vector (IntakeQuickAnalysis) and the 6M
 * checklist maturity vector (sixmScoring). The server-side agents read this
 * row (agent-run/orgContext.ts) before advising.
 *
 * Fire-and-forget from AssessmentService.saveState — a failure here must
 * never block the wizard's own save.
 */

import { supabase } from '../lib/supabase';
import type { AuditAssessmentState } from './AuditTypes';
import { computeIntakeAnalysis } from './IntakeQuickAnalysis';
import { computeSixMResults, scoreSummary } from './sixmScoring';

export interface OrgContextPayload {
    company_id: string;
    industry_sector: string | null;
    asset_class: string | null;
    site_name: string | null;
    vision: string | null;
    mission: string | null;
    strategic_objectives: string | null;
    assessment_objective: string | null;
    key_risks: string[];
    key_opportunities: string[];
    am_policy_status: string | null;
    samp_status: string | null;
    roles_status: string | null;
    risk_framework_status: string | null;
    budget_alignment_status: string | null;
    intake_overall: number | null;
    intake_level: string | null;
    intake_by_dimension: Record<string, number | null>;
    weakest_dimension: string | null;
    quick_wins: Array<{ label: string; isoRef: string; action: string; dimension: string; score: number }>;
    sixm_overall: number | null;
    sixm_level: string | null;
    sixm_by_dimension: Record<string, number>;
    sixm_gap_count: number | null;
    source_assessment_id: string | null;
    source_assessment_number: string | null;
    assessed_at: string;
    updated_at: string;
}

const nz = (s: string | undefined | null) => (s && s.trim() ? s.trim() : null);

/** Pure: build the row from wizard state. Exported for tests. */
export function buildOrgContextPayload(state: AuditAssessmentState, companyId: string): OrgContextPayload {
    const intake = state.intake;
    const analysis = computeIntakeAnalysis(intake);
    const intakeDims: Record<string, number | null> = {};
    for (const d of analysis.dimensions) intakeDims[d.key] = d.score;
    const weakest = analysis.dimensions
        .filter(d => d.score != null)
        .sort((a, b) => (a.score as number) - (b.score as number))[0];

    const results = state.dimensionResults?.length
        ? state.dimensionResults
        : computeSixMResults(state.sixmChecklistAnswers as any, state.sixmDimensionNotes);
    const six = scoreSummary(results);
    const sixDims: Record<string, number> = {};
    for (const r of results) sixDims[r.dimensionKey] = r.averageScore;

    const now = new Date().toISOString();
    return {
        company_id: companyId,
        industry_sector: nz(intake.industrySector),
        asset_class: nz(intake.assetClass),
        site_name: nz(intake.siteName),
        vision: nz(intake.orgVision),
        mission: nz(intake.orgMission),
        strategic_objectives: nz(intake.orgStrategicObjectives),
        assessment_objective: nz(intake.auditObjective),
        key_risks: intake.keyRisks || [],
        key_opportunities: intake.keyOpportunities || [],
        am_policy_status: nz(intake.orgAMPolicy),
        samp_status: nz(intake.orgSAMP),
        roles_status: nz(intake.orgRolesAuthorities),
        risk_framework_status: nz(intake.orgRiskFramework),
        budget_alignment_status: nz(intake.orgBudgetAlignment),
        intake_overall: analysis.overall,
        intake_level: analysis.band?.label ?? null,
        intake_by_dimension: intakeDims,
        weakest_dimension: weakest?.key ?? null,
        quick_wins: analysis.quickWins.slice(0, 5),
        sixm_overall: results.length ? six.overallScore : null,
        sixm_level: results.length ? six.maturityLevel : null,
        sixm_by_dimension: sixDims,
        sixm_gap_count: results.length ? results.reduce((s, r) => s + r.keyGaps.length, 0) : null,
        source_assessment_id: state.id ?? null,
        source_assessment_number: state.assessmentNumber ?? null,
        assessed_at: now,
        updated_at: now,
    };
}

export class OrgContextService {
    private static instance: OrgContextService;
    private companyId: string | null = null;

    static getInstance(): OrgContextService {
        if (!OrgContextService.instance) OrgContextService.instance = new OrgContextService();
        return OrgContextService.instance;
    }

    /** Since 0273 the caller can only see their own company row, so `limit 1` IS the tenant. */
    private async resolveCompanyId(): Promise<string | null> {
        if (this.companyId) return this.companyId;
        const { data, error } = await supabase.from('companies').select('id').limit(1);
        if (error || !data?.length) return null;
        this.companyId = data[0].id as string;
        return this.companyId;
    }

    async syncFromAssessment(state: AuditAssessmentState): Promise<boolean> {
        if (!state.intake?.firstName && !state.intake?.company) return false; // nothing meaningful yet
        const companyId = await this.resolveCompanyId();
        if (!companyId) return false;
        const payload = buildOrgContextPayload(state, companyId);
        const { error } = await supabase
            .from('org_context')
            .upsert(payload, { onConflict: 'company_id' });
        if (error) {
            // 42P01 = migration 0308 not applied yet: degrade silently like the people bridge.
            if ((error as any).code !== '42P01') console.warn('[OrgContextService] upsert failed:', error.message);
            return false;
        }
        return true;
    }

    async get(): Promise<Record<string, unknown> | null> {
        const { data, error } = await supabase.from('org_context').select('*').limit(1);
        if (error || !data?.length) return null;
        return data[0] as Record<string, unknown>;
    }
}

export const orgContextService = OrgContextService.getInstance();
