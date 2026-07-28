/**
 * strategySelect — per-asset maintenance-strategy selection (Phase D1,
 * docs/Specialist-150k-Replacement-Plan.md).
 *
 * The reliability engineer's signature deliverable: for each asset, a
 * deliberate, defensible decision about HOW it will be maintained —
 * criticality × failure behaviour (censored Weibull where the history
 * supports it) × monitorability → one recommended regime, with the evidence
 * chain. Distinct from lib/maintenanceStrategy (SAP cycle packages: the
 * "when", once a regime exists) and from lib/pmOptimization (tuning PMs that
 * already exist): this decides what SHOULD exist.
 *
 * Regimes:
 *  - run_to_failure       deliberate RTF for low-consequence assets
 *  - fixed_interval       wear-out behaviour (β≥1.5) — age-based PM at B10
 *  - condition_based      random-in-time failures (β≈1) — monitor, don't calendar
 *  - defect_elimination   infant mortality (β<0.85) — fix quality, not frequency
 *  - rcm_study            high-criticality with not enough evidence to decide
 *
 * Coverage (D2): % of A/B-criticality assets that HAVE a strategy in place
 * (an active programme or condition monitoring). A deliberate-RTF register
 * needs a decision record to count — that honesty is stated, not hidden.
 */
import { fitWeibull, weibullBLife } from '../eam/utils/weibull';

export interface StrategyAssetRow {
    id: string;
    tag: string;
    name: string;
    criticality: string | null;
}

export interface StrategyInputs {
    assets: StrategyAssetRow[];
    /** CM event timestamps (ms) per asset, full history. */
    cmTimesByAsset: Map<string, number[]>;
    /** 12-month CM cost per asset. */
    cmCost12ByAsset: Map<string, number>;
    /** Assets with ≥1 ACTIVE recurring programme. */
    activePmAssets: Set<string>;
    /** Assets with ≥1 reading definition (condition monitoring exists). */
    monitoredAssets: Set<string>;
    /** Top SMEA success mode per asset (PSC E3) — what to SUSTAIN, ranked by
     *  SPN = Value × Sustainability × Monitorability. Optional. */
    smeaTopByAsset?: Map<string, { mode: string; spn: number }>;
}

export type StrategyRegime = 'run_to_failure' | 'fixed_interval' | 'condition_based' | 'defect_elimination' | 'rcm_study';

export interface StrategyVerdict {
    assetId: string;
    tag: string;
    name: string;
    criticality: string | null;
    recommended: StrategyRegime;
    basis: string;
    /** Age-based interval where the regime is fixed_interval. */
    recommendedIntervalDays: number | null;
    weibull: { beta: number; eta: number; b10Days: number; r2: number; nFailures: number } | null;
    cmCost12mo: number;
    hasActivePm: boolean;
    isMonitored: boolean;
    /** Current state already matches the recommendation. */
    aligned: boolean;
    /** The asset's highest-SPN success mode, when a SMEA exists (E3). */
    smeaTop: { mode: string; spn: number } | null;
}

export interface StrategyReview {
    verdicts: StrategyVerdict[];
    /** A/B assets only — the ones a plan must cover. */
    criticalTotal: number;
    criticalCovered: number;
    /** % of A/B assets with an active PM or monitoring in place. */
    coveragePct: number;
    /** Misaligned or uncovered A/B assets, worst first — the work list. */
    gaps: StrategyVerdict[];
}

const DAY_MS = 86_400_000;

function fitFor(times: number[] | undefined, nowMs: number) {
    if (!times || times.length < 3) return null;
    const sorted = [...times].sort((a, b) => a - b);
    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
        const d = (sorted[i] - sorted[i - 1]) / DAY_MS;
        if (d > 0.25) intervals.push(d);
    }
    const sinceLast = (nowMs - sorted[sorted.length - 1]) / DAY_MS;
    const fit = fitWeibull(intervals, sinceLast > 1 ? [sinceLast] : []);
    if (!fit) return null;
    return {
        beta: Math.round(fit.beta * 100) / 100,
        eta: Math.round(fit.eta),
        b10Days: Math.round(weibullBLife(fit.beta, fit.eta, 10)),
        r2: Math.round(fit.r2 * 100) / 100,
        nFailures: fit.nFailures,
    };
}

export function selectStrategies(inp: StrategyInputs, nowMs: number): StrategyReview {
    const verdicts: StrategyVerdict[] = [];

    for (const a of inp.assets) {
        const crit = (a.criticality ?? '').toUpperCase();
        const isCritical = crit === 'A' || crit === 'B';
        const hasActivePm = inp.activePmAssets.has(a.id);
        const isMonitored = inp.monitoredAssets.has(a.id);
        const cost12 = Math.round(inp.cmCost12ByAsset.get(a.id) ?? 0);
        const fit = fitFor(inp.cmTimesByAsset.get(a.id), nowMs);
        const failuresEver = (inp.cmTimesByAsset.get(a.id)?.length ?? 0) > 0;

        let recommended: StrategyRegime;
        let basis: string;
        let interval: number | null = null;

        if (fit && fit.beta < 0.85 && fit.r2 >= 0.5) {
            recommended = 'defect_elimination';
            basis = `Infant-mortality signature (β=${fit.beta}, R²=${fit.r2}) — failures cluster early after work. More PM makes this worse; fix installation/maintenance quality.`;
        } else if (fit && fit.beta >= 1.5 && fit.r2 >= 0.5) {
            recommended = 'fixed_interval';
            interval = fit.b10Days;
            basis = `Wear-out behaviour (β=${fit.beta}, R²=${fit.r2}) — age-based PM at the B10 life (${fit.b10Days}d) is statistically defensible.`;
        } else if (fit && fit.beta >= 0.85 && fit.beta < 1.5) {
            recommended = 'condition_based';
            basis = `Failures are random in time (β=${fit.beta}) — a calendar interval cannot intercept them; condition monitoring can.${isMonitored ? '' : ' No monitoring points exist yet on this asset.'}`;
        } else if (isCritical) {
            // High consequence, not enough failure evidence to fit — engineer it.
            recommended = failuresEver || hasActivePm ? 'condition_based' : 'rcm_study';
            basis = failuresEver || hasActivePm
                ? `Criticality ${crit} with sparse failure history — default to condition monitoring while evidence accumulates.`
                : `Criticality ${crit} with no failure history and no programme — too high-stakes to guess; a focused RCM/FMEA pass should set the strategy.`;
        } else {
            recommended = 'run_to_failure';
            basis = `Criticality ${crit || '—'} and ${cost12 > 0 ? `only ${cost12} of` : 'no'} corrective cost in 12 months — deliberate run-to-failure is the economic choice; record the decision so it reads as a choice, not a gap.`;
        }

        // E3: a SMEA on the asset names what success looks like — the strategy
        // must sustain it, so the top-SPN mode rides along in the basis.
        const smeaTop = inp.smeaTopByAsset?.get(a.id) ?? null;
        if (smeaTop) {
            basis += ` SMEA: sustain "${smeaTop.mode}" (SPN ${smeaTop.spn}).`;
        }

        const aligned =
            (recommended === 'fixed_interval' && hasActivePm) ||
            (recommended === 'condition_based' && isMonitored) ||
            (recommended === 'run_to_failure' && !hasActivePm) ||
            (recommended === 'defect_elimination' && false) || // DE is always an action, never a steady state
            (recommended === 'rcm_study' && false);

        verdicts.push({
            assetId: a.id, tag: a.tag, name: a.name, criticality: a.criticality,
            recommended, basis, recommendedIntervalDays: interval,
            weibull: fit, cmCost12mo: cost12, hasActivePm, isMonitored, aligned,
            smeaTop,
        });
    }

    const criticals = verdicts.filter((v) => ['A', 'B'].includes((v.criticality ?? '').toUpperCase()));
    const covered = criticals.filter((v) => v.hasActivePm || v.isMonitored);
    const gaps = criticals
        .filter((v) => !v.aligned)
        .sort((a, b) =>
            ((a.criticality === 'A' ? 0 : 1) - (b.criticality === 'A' ? 0 : 1)) || b.cmCost12mo - a.cmCost12mo);

    return {
        verdicts,
        criticalTotal: criticals.length,
        criticalCovered: covered.length,
        coveragePct: criticals.length ? Math.round((covered.length / criticals.length) * 100) : 100,
        gaps,
    };
}
