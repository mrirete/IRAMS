/**
 * IntakeQuickAnalysis.ts — Instant directional maturity analysis from Step 1 intake
 *
 * The intake (AuditIntake.tsx) collects ~16 ordinal "current state" selections
 * across organizational context (ISO 55001 §4–6) and the ISO 55000:2024 companion
 * series (55010/55011/55012/55013). Every one of those dropdowns is an ordered
 * best→worst scale, so we can score them instantly — no document review, 6M
 * deep-dive, or scored findings required.
 *
 * This powers the FREE, lead-magnet "Preliminary Maturity Snapshot": a high-level
 * directional read + prioritized quick wins that points the client in the right
 * direction and creates the reason to proceed to the full assessment.
 *
 * IMPORTANT: this is self-reported and directional by design. The full 5-step
 * wizard produces the evidence-based, defensible scoring.
 */

import { ISO_ALIGNMENT_OPTIONS, type AuditIntakeData } from './AuditTypes';
import { MATURITY_LEVELS } from '../../types/audit';

// ── Dimensions (aligned to ISO 55000 series) ──────────────────────
export type IntakeDimensionKey = 'governance' | 'financial' | 'regulatory' | 'people' | 'data';

export interface IntakeDimension {
    key: IntakeDimensionKey;
    label: string;
    isoBadge: string;
    color: string;
}

export const INTAKE_DIMENSIONS: IntakeDimension[] = [
    { key: 'governance', label: 'Governance & Strategy', isoBadge: 'ISO 55001 §4–6', color: '#8b5cf6' },
    { key: 'financial',  label: 'Financial Alignment',   isoBadge: 'ISO 55010',       color: '#b45309' },
    { key: 'regulatory', label: 'Regulatory & Policy',   isoBadge: 'ISO 55011',       color: '#0369a1' },
    { key: 'people',     label: 'People & Competence',   isoBadge: 'ISO 55012',       color: '#059669' },
    { key: 'data',       label: 'Data Governance',       isoBadge: 'ISO 55013',       color: '#7c3aed' },
];

// ── Field catalog: ordered best→worst value scales + a quick-win action ──
interface FieldDef {
    id: string;
    dimension: IntakeDimensionKey;
    label: string;
    isoRef: string;
    /** Ordered list of selectable values, BEST first → WORST last. */
    scale: string[];
    get: (i: AuditIntakeData) => string;
    /** Actionable remediation surfaced when this field scores low. */
    quickWin: string;
}

// Organizational-context scales mirror the inline <select> options in
// AuditIntake.tsx (Section C). Keep these value strings in sync with that form.
const ORG_AM_POLICY = [
    'Formal AM policy exists, endorsed by leadership',
    'Policy exists but not actively communicated',
    'Informal / undocumented',
    'No AM policy exists',
];
const ORG_SAMP = [
    'SAMP exists, aligned to strategy, reviewed annually',
    'SAMP exists but outdated or not linked to strategy',
    'Informal maintenance plans only',
    'No SAMP exists',
];
const ORG_ROLES = [
    'RACI defined for all AM functions',
    'Roles defined but not consistently applied',
    'Informal role assignments',
    'No formal RACI or role definitions',
];
const ORG_RISK = [
    'Risk framework integrated into AM decision-making',
    'Risk assessments done but not linked to AM',
    'Ad-hoc risk assessments',
    'No structured risk framework',
];
const ORG_BUDGET = [
    'Budget explicitly linked to criticality ranking',
    'Budget considers criticality informally',
    'Budget is flat / historical-based',
    'Budget is reactive / unplanned',
];

const isoScale = (k: keyof typeof ISO_ALIGNMENT_OPTIONS): string[] =>
    ISO_ALIGNMENT_OPTIONS[k].map(o => o.value);

const FIELDS: FieldDef[] = [
    // ── Governance & Strategy ──
    { id: 'amPolicy', dimension: 'governance', label: 'Asset Management Policy', isoRef: 'ISO 55001 §5.2',
      scale: ORG_AM_POLICY, get: i => i.orgAMPolicy,
      quickWin: 'Draft a one-page Asset Management Policy and have leadership formally endorse it — the anchor ISO 55001 §5.2 requires, and a fast, high-visibility win.' },
    { id: 'samp', dimension: 'governance', label: 'Strategic AM Plan (SAMP)', isoRef: 'ISO 55001 §6.2.1',
      scale: ORG_SAMP, get: i => i.orgSAMP,
      quickWin: 'Establish a lightweight SAMP that draws a clear line of sight from business objectives to asset plans (ISO 55001 §6.2.1).' },
    { id: 'roles', dimension: 'governance', label: 'Roles & Authorities', isoRef: 'ISO 55001 §5.3',
      scale: ORG_ROLES, get: i => i.orgRolesAuthorities,
      quickWin: 'Define a simple RACI for core asset-management functions so accountability is unambiguous (ISO 55001 §5.3).' },
    { id: 'risk', dimension: 'governance', label: 'Risk-Based Decision Making', isoRef: 'ISO 55001 §6.1',
      scale: ORG_RISK, get: i => i.orgRiskFramework,
      quickWin: 'Adopt a consistent risk matrix and embed it in maintenance and replacement decisions (ISO 55001 §6.1, ISO 31000).' },
    { id: 'budget', dimension: 'governance', label: 'Budget vs. Criticality', isoRef: 'ISO 55001 §6.2',
      scale: ORG_BUDGET, get: i => i.orgBudgetAlignment,
      quickWin: 'Prioritize the next budget cycle by asset criticality rather than history — a quick reallocation of spend to the assets that matter most.' },

    // ── Financial Alignment (ISO 55010) ──
    { id: 'fin_align', dimension: 'financial', label: 'Finance–Engineering Alignment', isoRef: 'ISO 55010',
      scale: isoScale('iso55010_financial_alignment'), get: i => i.isoAlignment.iso55010_financial_alignment,
      quickWin: 'Run a joint finance–engineering workshop to agree a shared definition of asset value and a common register basis (ISO 55010).' },
    { id: 'fin_register', dimension: 'financial', label: 'Technical vs. Financial Register', isoRef: 'ISO 55010',
      scale: isoScale('iso55010_register_alignment'), get: i => i.isoAlignment.iso55010_register_alignment,
      quickWin: 'Reconcile the technical asset register against the fixed-asset register to close ghost/zombie asset gaps (ISO 55010).' },
    { id: 'fin_capex', dimension: 'financial', label: 'CAPEX–Lifecycle Integration', isoRef: 'ISO 55010',
      scale: isoScale('iso55010_capex_integration'), get: i => i.isoAlignment.iso55010_capex_integration,
      quickWin: 'Tie CAPEX cases to whole-life cost and criticality, not just failure or urgency (ISO 55010).' },

    // ── Regulatory & Policy (ISO 55011) ──
    { id: 'reg_mapping', dimension: 'regulatory', label: 'Regulatory Obligation Mapping', isoRef: 'ISO 55011',
      scale: isoScale('iso55011_regulatory_mapping'), get: i => i.isoAlignment.iso55011_regulatory_mapping,
      quickWin: 'Build a single regulatory-obligations register mapping each requirement to an owner and its evidence (ISO 55011).' },
    { id: 'reg_engagement', dimension: 'regulatory', label: 'Standards / Policy Engagement', isoRef: 'ISO 55011',
      scale: isoScale('iso55011_policy_engagement'), get: i => i.isoAlignment.iso55011_policy_engagement,
      quickWin: 'Assign an owner to monitor and engage with the industry standards bodies most relevant to your assets (ISO 55011).' },

    // ── People & Competence (ISO 55012) ──
    { id: 'ppl_framework', dimension: 'people', label: 'Competence Framework', isoRef: 'ISO 55012',
      scale: isoScale('iso55012_competence_framework'), get: i => i.isoAlignment.iso55012_competence_framework,
      quickWin: 'Create an AM-specific competence matrix aligned to your SAMP roles (ISO 55012).' },
    { id: 'ppl_culture', dimension: 'people', label: 'Human & Cultural Factors', isoRef: 'ISO 55012',
      scale: isoScale('iso55012_cultural_factors'), get: i => i.isoAlignment.iso55012_cultural_factors,
      quickWin: 'Run a short reliability-culture pulse survey to surface human and cultural barriers to AM effectiveness (ISO 55012).' },
    { id: 'ppl_contractor', dimension: 'people', label: 'Contractor Competence', isoRef: 'ISO 55012',
      scale: isoScale('iso55012_outsourced_competence'), get: i => i.isoAlignment.iso55012_outsourced_competence,
      quickWin: 'Extend competence verification to contractors performing asset-critical work (ISO 55012).' },

    // ── Data Governance (ISO 55013) ──
    { id: 'data_gov', dimension: 'data', label: 'Data Governance Structure', isoRef: 'ISO 55013',
      scale: isoScale('iso55013_data_governance'), get: i => i.isoAlignment.iso55013_data_governance,
      quickWin: 'Appoint data stewards and adopt a basic EDM data-governance model for asset data (ISO 55013).' },
    { id: 'data_quality', dimension: 'data', label: 'Data Quality Management', isoRef: 'ISO 55013',
      scale: isoScale('iso55013_data_quality'), get: i => i.isoAlignment.iso55013_data_quality,
      quickWin: 'Stand up data-quality metrics (completeness, accuracy) and a cleansing routine for the asset register (ISO 55013).' },
    { id: 'data_asset', dimension: 'data', label: 'Data-as-Asset Distinction', isoRef: 'ISO 55013',
      scale: isoScale('iso55013_data_asset_distinction'), get: i => i.isoAlignment.iso55013_data_asset_distinction,
      quickWin: 'Recognize asset data as a strategic asset with its own lifecycle and ownership (ISO 55013).' },
];

// ── Output shapes ──────────────────────────────────────────────────
export interface ScoredField {
    id: string;
    dimension: IntakeDimensionKey;
    label: string;
    isoRef: string;
    /** 0–5 IAM maturity score, or null if unanswered. */
    score: number | null;
    quickWin: string;
}

export interface DimensionResult {
    key: IntakeDimensionKey;
    label: string;
    isoBadge: string;
    color: string;
    /** 0–5 average across answered fields, or null. */
    score: number | null;
    answeredCount: number;
    totalCount: number;
}

export interface QuickWin {
    label: string;
    isoRef: string;
    action: string;
    dimension: IntakeDimensionKey;
    score: number;
}

export interface MaturityBand {
    value: number;
    label: string;
    description: string;
    color: string;
}

export interface IntakeAnalysis {
    /** 0–5 overall maturity, or null when no scoreable answers given. */
    overall: number | null;
    /** As a percentage of 5, rounded. */
    overallPercentage: number | null;
    band: MaturityBand | null;
    dimensions: DimensionResult[];
    strengths: ScoredField[];
    quickWins: QuickWin[];
    /** Fraction (0–1) of scoreable fields the user answered. */
    coverage: number;
    answeredCount: number;
    totalScoreable: number;
    headline: string;
    /** Industry-tailored framing pulled from the intake. */
    industrySector: string;
    keyRiskCount: number;
}

// ── Helpers ──
const round1 = (n: number) => Math.round(n * 10) / 10;
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Convert an ordinal selection into a 0–5 IAM score (best=5, worst=0). */
function scoreField(value: string, scale: string[]): number | null {
    const idx = scale.indexOf(value);
    if (!value || idx < 0) return null;
    if (scale.length === 1) return 5;
    return round1(5 * (1 - idx / (scale.length - 1)));
}

function bandFor(score: number): MaturityBand {
    const lvl = MATURITY_LEVELS[clamp(Math.round(score), 0, 5)];
    return { value: lvl.value, label: lvl.label, description: lvl.description, color: lvl.color };
}

function buildHeadline(overall: number | null, band: MaturityBand | null, quickWinCount: number, sector: string, coverage: number): string {
    if (overall == null) {
        return `Answer the organizational context and ISO 55000 series questions in your intake to generate a directional maturity snapshot for your ${sector} operation.`;
    }
    const lowData = coverage < 0.5 ? ' Based on a partial set of responses — completing the remaining context questions will sharpen this read.' : '';
    const winLine = quickWinCount > 0
        ? ` We've surfaced ${quickWinCount} priority quick win${quickWinCount === 1 ? '' : 's'} you can act on immediately.`
        : ' Your foundations look solid — the full assessment will pressure-test them against evidence.';
    return `Your preliminary asset-management maturity sits at the "${band!.label}" level for this ${sector} operation.${winLine}${lowData}`;
}

/**
 * Compute the instant directional analysis from intake data.
 * Pure function — safe to call on every render.
 */
export function computeIntakeAnalysis(intake: AuditIntakeData): IntakeAnalysis {
    const scored: ScoredField[] = FIELDS.map(f => ({
        id: f.id,
        dimension: f.dimension,
        label: f.label,
        isoRef: f.isoRef,
        score: scoreField(f.get(intake), f.scale),
        quickWin: f.quickWin,
    }));

    const answered = scored.filter(s => s.score != null) as (ScoredField & { score: number })[];
    const overall = answered.length ? round1(avg(answered.map(s => s.score))) : null;
    const overallPercentage = overall == null ? null : Math.round((overall / 5) * 100);
    const band = overall == null ? null : bandFor(overall);

    const dimensions: DimensionResult[] = INTAKE_DIMENSIONS.map(d => {
        const all = FIELDS.filter(f => f.dimension === d.key);
        const ans = answered.filter(s => s.dimension === d.key);
        return {
            key: d.key,
            label: d.label,
            isoBadge: d.isoBadge,
            color: d.color,
            score: ans.length ? round1(avg(ans.map(s => s.score))) : null,
            answeredCount: ans.length,
            totalCount: all.length,
        };
    });

    // Quick wins: anything not yet "Competent" (< 3 on the IAM 0–5 scale) is an
    // improvement opportunity. Worst first, capped at 5 so the list stays actionable.
    const quickWins: QuickWin[] = answered
        .filter(s => s.score < 3)
        .sort((a, b) => a.score - b.score)
        .slice(0, 5)
        .map(s => ({ label: s.label, isoRef: s.isoRef, action: s.quickWin, dimension: s.dimension, score: s.score }));

    // Strengths: "Competent" or better (>= 3.3 captures the strong tier of every
    // scale length), best first.
    const strengths = answered
        .filter(s => s.score >= 3.3)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4);

    const coverage = scored.length ? answered.length / scored.length : 0;
    const sector = intake.industrySector || 'industrial';
    const headline = buildHeadline(overall, band, quickWins.length, sector, coverage);

    return {
        overall,
        overallPercentage,
        band,
        dimensions,
        strengths,
        quickWins,
        coverage,
        answeredCount: answered.length,
        totalScoreable: scored.length,
        headline,
        industrySector: sector,
        keyRiskCount: intake.keyRisks?.length || 0,
    };
}
