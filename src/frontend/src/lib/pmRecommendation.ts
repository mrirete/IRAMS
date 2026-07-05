/**
 * recommendPM — the flagship reliability agent's deterministic core (R-6).
 *
 * "Agents orchestrate, tools compute." This is the tool: from an asset's
 * failure history it fits a censored Weibull (R-1), reads the failure pattern
 * from β, recommends a PM interval when age-based PM actually helps, and
 * cost-justifies it — every number traceable to the data (citations). The LLM
 * (if any) only narrates this; it never does the math. Human approves before
 * anything is created.
 */
import { fitWeibull, weibullBLife, type WeibullFitResult } from '../eam/utils/weibull';

export type FailurePattern = 'wear-out' | 'random' | 'infant-mortality' | 'insufficient';

export interface PMCostParams {
    /** cost of one unplanned failure (repair + downtime), currency units */
    costPerFailure: number;
    /** cost of one planned PM service */
    pmCost: number;
    /** target fraction failing before the PM is due (default 0.10 = B10) */
    targetFailureFraction?: number;
}

export interface PMCostCase {
    currentAnnualCost: number;
    projectedAnnualCost: number;
    netAnnualSavings: number;
    pmsPerYear: number;
    failuresPerYearNow: number;
    residualFailuresPerYear: number;
    assumption: string;
}

export interface PMRecommendation {
    pattern: FailurePattern;
    fit: WeibullFitResult | null;
    mtbfHours: number | null;
    recommendedIntervalHours: number | null;
    recommendedIntervalDays: number | null;
    /** true when age-based PM is the right strategy (β meaningfully > 1) */
    pmAdvised: boolean;
    rationale: string;
    cost: PMCostCase | null;
    citations: string[];
    confidenceNote?: string;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

export function recommendPM(
    failureIntervalsHours: number[],
    suspensionsHours: number[],
    costs: PMCostParams,
): PMRecommendation {
    const intervals = (failureIntervalsHours || []).filter(t => t > 0);
    const citations: string[] = [];

    if (intervals.length < 2) {
        return {
            pattern: 'insufficient', fit: null, mtbfHours: null,
            recommendedIntervalHours: null, recommendedIntervalDays: null, pmAdvised: false,
            rationale: 'Not enough failure history to model a life distribution (need ≥ 2 inter-arrival intervals). Keep collecting failure data, or set a conservative time-based interval from OEM guidance.',
            cost: null,
            citations: [`${intervals.length} usable failure interval(s) on record`],
        };
    }

    const fit = fitWeibull(intervals, suspensionsHours || []);
    if (!fit) {
        return {
            pattern: 'insufficient', fit: null, mtbfHours: null,
            recommendedIntervalHours: null, recommendedIntervalDays: null, pmAdvised: false,
            rationale: 'The failure times could not be fit to a Weibull (degenerate data — e.g. all identical).',
            cost: null, citations: [`${intervals.length} failure intervals`],
        };
    }

    const mtbfHours = mean(intervals);
    citations.push(`${fit.nFailures} failures${fit.nSuspensions ? ` + ${fit.nSuspensions} suspensions` : ''} (Johnson adjusted ranks)`);
    citations.push(`Weibull β=${fit.beta}, η=${fit.eta}h, R²=${fit.r2}`);
    citations.push(`Empirical MTBF ${Math.round(mtbfHours)}h (${Math.round(mtbfHours / 24)}d)`);
    const confidenceNote = fit.confidence
        ? `90% bounds: β ${fit.confidence.betaLower.toFixed(2)}–${fit.confidence.betaUpper.toFixed(2)}, η ${Math.round(fit.confidence.etaLower)}–${Math.round(fit.confidence.etaUpper)}h`
        : 'Confidence bounds unavailable (< 3 failures) — treat the point estimate cautiously.';

    // Pattern from the shape parameter.
    let pattern: FailurePattern;
    if (fit.beta < 0.85) pattern = 'infant-mortality';
    else if (fit.beta <= 1.15) pattern = 'random';
    else pattern = 'wear-out';

    // Age-based PM only helps a wear-out (increasing hazard) pattern.
    if (pattern !== 'wear-out') {
        const rationale = pattern === 'random'
            ? `β≈1 (random failures): the hazard rate is roughly constant, so a time-based PM does NOT reduce failures — condition-based monitoring or a design/defect fix is the effective route (RCM). Scheduling a fixed PM here is over-maintenance.`
            : `β<1 (infant mortality): failures cluster early — burn-in, installation quality, or commissioning defects. Age-based PM makes it worse; investigate the install/defect (RCA) rather than schedule a cycle.`;
        return {
            pattern, fit, mtbfHours,
            recommendedIntervalHours: null, recommendedIntervalDays: null, pmAdvised: false,
            rationale, cost: null, citations, confidenceNote,
        };
    }

    // Wear-out → recommend a PM at the target reliability (B10 by default).
    const targetFrac = costs.targetFailureFraction ?? 0.10;
    const T = weibullBLife(fit.beta, fit.eta, targetFrac * 100);
    const recommendedIntervalDays = Math.max(1, Math.round(T / 24));

    // Cost justification (labelled estimate).
    const failuresPerYearNow = mtbfHours > 0 ? 8760 / mtbfHours : 0;
    const currentAnnualCost = failuresPerYearNow * costs.costPerFailure;
    const pmsPerYear = 8760 / T;
    const residualFailuresPerYear = failuresPerYearNow * targetFrac; // ~targetFrac fail before the PM
    const projectedAnnualCost = pmsPerYear * costs.pmCost + residualFailuresPerYear * costs.costPerFailure;
    const netAnnualSavings = currentAnnualCost - projectedAnnualCost;

    const rationale = `β=${fit.beta} (> 1) indicates a wear-out pattern — failures become more likely with age, so a scheduled PM is effective. Recommended interval = B${Math.round(targetFrac * 100)} life (${recommendedIntervalDays}d), the age by which ${Math.round(targetFrac * 100)}% would fail; renewing before then keeps most units out of the failure tail.`;

    return {
        pattern, fit, mtbfHours,
        recommendedIntervalHours: Math.round(T), recommendedIntervalDays, pmAdvised: true,
        rationale,
        cost: {
            currentAnnualCost: Math.round(currentAnnualCost),
            projectedAnnualCost: Math.round(projectedAnnualCost),
            netAnnualSavings: Math.round(netAnnualSavings),
            pmsPerYear: Math.round(pmsPerYear * 10) / 10,
            failuresPerYearNow: Math.round(failuresPerYearNow * 10) / 10,
            residualFailuresPerYear: Math.round(residualFailuresPerYear * 10) / 10,
            assumption: `Estimate: run-to-failure at ~${failuresPerYearNow.toFixed(1)} failures/yr × ${costs.costPerFailure.toLocaleString()} vs ${(pmsPerYear).toFixed(1)} PMs/yr × ${costs.pmCost.toLocaleString()} + ~${targetFrac * 100}% residual failures.`,
        },
        citations, confidenceNote,
    };
}
