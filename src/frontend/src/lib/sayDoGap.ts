/**
 * sayDoGap — reconcile SELF-REPORTED maturity (assessment intake, IntakeQuickAnalysis)
 * with what the plant's own DATA shows (audit-first wiring, RF-01/AU item B).
 *
 * The assessment says where the organisation believes it is; the operating
 * record says what actually happens. The delta between them is the most
 * credible conversation an assessment can open: "you rated asset information
 * 4; your failure-coding coverage says otherwise."
 *
 * Dimensions are the six ISO 55001 / GFMAM groups (MaturityQuestionBank), the
 * same vector the intake, the checklist, org_context and the agents read.
 *
 * Pure verdict logic (tested). HONESTY RULES baked in:
 *  - a group with no measured proxy is 'unmeasured', never guessed;
 *  - proxies are named with their real meaning — no fake conversion of a
 *    coverage % into a 0–5 "measured maturity";
 *  - verdicts are coarse on purpose (supports / questions / unmeasured):
 *    this is a screen for a conversation, not a scoring system.
 */
import type { IntakeAnalysis } from '../eam/services/IntakeQuickAnalysis';
import { MATURITY_DIMENSIONS, type MaturityDimensionKey } from '../eam/services/MaturityQuestionBank';

/** Measured signals from live data — fetched by the caller, computed here. */
export interface MeasuredSignals {
    /** failures (canonical isFailure) carrying a coded failure mode, % */
    failureCodingPct: number | null;
    /** failures carrying recorded downtime hours, % */
    downtimeCapturePct: number | null;
    /** closed WOs carrying any cost, % */
    costCoveragePct: number | null;
    /** preventive/predictive share of all WOs, % (proxy for planned delivery) */
    preventiveSharePct: number | null;
    /** open WOs with an assignee, % */
    assignmentCoveragePct: number | null;
    /** is a production-loss rate configured anywhere? */
    downtimeRateConfigured: boolean;
}

export interface ProxyReading { label: string; display: string; pct: number | null; }

export type GapVerdict = 'supports' | 'questions' | 'unmeasured';

export interface DimensionGap {
    key: MaturityDimensionKey;
    label: string;
    /** self-reported 0–5 from the intake; null = unanswered */
    selfScore: number | null;
    proxies: ProxyReading[];
    verdict: GapVerdict;
    /** one plain sentence for the card */
    note: string;
}

const pctDisplay = (v: number | null, suffix = ''): string => (v == null ? '—' : `${Math.round(v)}%${suffix}`);

/**
 * Verdict rule (deterministic, coarse): average the group's available proxy
 * percentages; a self-score of s (0–5) "claims" roughly s/5 of practice.
 * The data QUESTIONS the claim when measured practice runs at less than half
 * of what the claim implies (and the claim is at least "developing", ≥2.5).
 * Anything else — including modest claims with modest data — is SUPPORTED.
 */
export function verdictFor(selfScore: number | null, proxyPcts: number[]): GapVerdict {
    if (proxyPcts.length === 0) return 'unmeasured';
    if (selfScore == null) return 'unmeasured';
    const measured = proxyPcts.reduce((a, b) => a + b, 0) / proxyPcts.length;
    const claimed = (selfScore / 5) * 100;
    if (selfScore >= 2.5 && measured < claimed / 2) return 'questions';
    return 'supports';
}

export function computeSayDoGap(analysis: IntakeAnalysis, m: MeasuredSignals): DimensionGap[] {
    const dimScore = (k: MaturityDimensionKey): { score: number | null; label: string } => {
        const d = analysis.dimensions.find(x => x.key === k);
        const label = d?.label ?? MATURITY_DIMENSIONS.find(x => x.key === k)?.label ?? k;
        return { score: d?.score ?? null, label };
    };

    const build = (
        key: MaturityDimensionKey,
        proxies: ProxyReading[],
        questionNote: string,
        supportNote: string,
    ): DimensionGap => {
        const { score, label } = dimScore(key);
        const pcts = proxies.map(p => p.pct).filter((v): v is number => v != null);
        const verdict = verdictFor(score, pcts);
        return {
            key, label, selfScore: score, proxies, verdict,
            note: verdict === 'unmeasured'
                ? (score == null && proxies.length > 0
                    ? 'Not yet self-assessed — run the maturity intake.'
                    : 'No measured proxy for this group yet — the full assessment covers it.')
                : verdict === 'questions' ? questionNote : supportNote,
        };
    };

    return [
        build('strategy', [], '', ''),
        build('decisions',
            [
                { label: 'Cost captured on closed work', display: pctDisplay(m.costCoveragePct), pct: m.costCoveragePct },
                { label: 'Production-loss rate configured', display: m.downtimeRateConfigured ? 'yes' : 'no', pct: m.downtimeRateConfigured ? 100 : 0 },
            ],
            'Money data lags the claimed decision-making maturity — cost capture at close-out and a downtime rate would make every ranking real.',
            'Cost capture supports the claimed decision-making maturity.'),
        build('lifecycle',
            [{ label: 'Preventive share of work', display: pctDisplay(m.preventiveSharePct), pct: m.preventiveSharePct }],
            'The work mix is more reactive than the claimed delivery maturity implies — the PM programme is where the say-do gap closes.',
            'The planned-work share is consistent with the claimed delivery maturity.'),
        build('information',
            [
                { label: 'Failure coding coverage', display: pctDisplay(m.failureCodingPct), pct: m.failureCodingPct },
                { label: 'Downtime capture on failures', display: pctDisplay(m.downtimeCapturePct), pct: m.downtimeCapturePct },
            ],
            'The operating record runs well behind the self-assessment — coding discipline at close-out is the gap to work first (the Failure Review queue is built for exactly this).',
            'The operating record backs the self-assessment — coding and downtime capture are holding up.'),
        build('people',
            [{ label: 'Open work with an assignee', display: pctDisplay(m.assignmentCoveragePct), pct: m.assignmentCoveragePct }],
            'Much open work has no owner — assignment discipline is the first people-group win.',
            'Assignment coverage supports the claimed people maturity.'),
        build('risk', [], '', ''),
    ];
}
