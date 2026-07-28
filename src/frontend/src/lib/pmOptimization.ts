/**
 * pmOptimization — the fleet-wide PM review a $150k engineer does annually,
 * as a deterministic engine (Phase B3, docs/Specialist-150k-Replacement-Plan.md).
 *
 * Every ACTIVE PM programme is judged against its asset's actual failure
 * behaviour: censored Weibull where the history supports it (≥3 corrective
 * events), simple effectiveness rules where it doesn't. Verdicts carry the
 * evidence and a recommended interval, and are meant to be DRAFTED into the
 * proposals queue — the human approves, delivery writes back, the value
 * ledger measures. No LLM anywhere in this file.
 *
 * Verdict semantics (stated so the report can defend them):
 *  - redundant:        >1 active PM of the same type on one asset — consolidate.
 *  - over_maintenance: wear-out fit says the interval is far tighter than B10
 *                      (interval < 0.5×B10), or high-frequency PM with zero
 *                      failures ever — stretch.
 *  - under_maintenance:wear-out fit says the interval is far looser than B10
 *                      (interval > 1.5×B10) and failures keep arriving — tighten.
 *  - ineffective:      random-failure pattern (β≈1) with repeated failures —
 *                      fixed-interval PM cannot help; shift to condition
 *                      monitoring.
 *  - ok:               nothing defensible to change.
 */
import { fitWeibull, weibullBLife } from '../eam/utils/weibull';

export interface PmProgramRow {
    id: string;
    code: string;
    title: string;
    asset_id: string | null;
    job_type: string | null;
    frequency_interval: number | null;
    frequency_unit: string | null;
}

export interface CmEventRow {
    asset_id: string | null;
    created_at: string;
}

export interface PmAssetRow {
    id: string;
    tag: string;
    name: string;
    criticality: string | null;
}

export type PmVerdictKind = 'redundant' | 'over_maintenance' | 'under_maintenance' | 'ineffective' | 'ok';

export interface PmVerdict {
    pmId: string;
    code: string;
    title: string;
    assetId: string | null;
    tag: string;
    criticality: string | null;
    verdict: Exclude<PmVerdictKind, 'ok'>;
    reason: string;
    annualEvents: number | null;
    currentIntervalDays: number | null;
    recommendedIntervalDays: number | null;
    /** PM events per year freed by following the recommendation (0 = tighten adds events). */
    eventsSavedPerYear: number;
    failures12mo: number;
    weibull: { beta: number; eta: number; b10Days: number; r2: number; nFailures: number } | null;
}

export interface PmOptimizationResult {
    verdicts: PmVerdict[];
    scanned: number;
    counts: Record<Exclude<PmVerdictKind, 'ok'>, number>;
    eventsSavedPerYear: number;
}

const DAY_MS = 86_400_000;

const intervalDays = (interval: number | null, unit: string | null): number | null => {
    if (!interval || interval <= 0) return null;
    const u = (unit ?? '').toLowerCase();
    if (u.startsWith('hour')) return interval / 24;
    if (u.startsWith('day')) return interval;
    if (u.startsWith('week')) return interval * 7;
    if (u.startsWith('month')) return interval * 30.44;
    if (u.startsWith('year')) return interval * 365.25;
    return null;
};

export function computePmOptimization(
    pms: PmProgramRow[],
    cmEvents: CmEventRow[],
    assets: PmAssetRow[],
    nowMs: number,
): PmOptimizationResult {
    const assetById = new Map(assets.map((a) => [a.id, a]));
    const cutoff12 = nowMs - 365 * DAY_MS;

    // Failure timelines per asset (full history) + 12-month counts.
    const timesByAsset = new Map<string, number[]>();
    const failures12ByAsset = new Map<string, number>();
    for (const e of cmEvents) {
        if (!e.asset_id) continue;
        const t = new Date(e.created_at).getTime();
        if (!Number.isFinite(t)) continue;
        (timesByAsset.get(e.asset_id) ?? timesByAsset.set(e.asset_id, []).get(e.asset_id)!).push(t);
        if (t >= cutoff12) failures12ByAsset.set(e.asset_id, (failures12ByAsset.get(e.asset_id) ?? 0) + 1);
    }

    // One censored fit per asset with ≥3 corrective events.
    const fitByAsset = new Map<string, PmVerdict['weibull']>();
    for (const [assetId, times] of timesByAsset) {
        if (times.length < 3) continue;
        const sorted = [...times].sort((a, b) => a - b);
        const intervals: number[] = [];
        for (let i = 1; i < sorted.length; i++) {
            const d = (sorted[i] - sorted[i - 1]) / DAY_MS;
            if (d > 0.25) intervals.push(d);
        }
        const sinceLast = (nowMs - sorted[sorted.length - 1]) / DAY_MS;
        const fit = fitWeibull(intervals, sinceLast > 1 ? [sinceLast] : []);
        if (!fit) continue;
        fitByAsset.set(assetId, {
            beta: Math.round(fit.beta * 100) / 100,
            eta: Math.round(fit.eta),
            b10Days: Math.round(weibullBLife(fit.beta, fit.eta, 10)),
            r2: Math.round(fit.r2 * 100) / 100,
            nFailures: fit.nFailures,
        });
    }

    // Redundancy: >1 active PM of the same type on one asset.
    const byAssetType = new Map<string, PmProgramRow[]>();
    for (const p of pms) {
        if (!p.asset_id) continue;
        const k = `${p.asset_id}|${(p.job_type ?? '').toUpperCase()}`;
        (byAssetType.get(k) ?? byAssetType.set(k, []).get(k)!).push(p);
    }

    const verdicts: PmVerdict[] = [];
    for (const p of pms) {
        const asset = p.asset_id ? assetById.get(p.asset_id) : undefined;
        const days = intervalDays(p.frequency_interval, p.frequency_unit);
        const annual = days ? Math.round((365.25 / days) * 10) / 10 : null;
        const failures12 = p.asset_id ? failures12ByAsset.get(p.asset_id) ?? 0 : 0;
        const everFailed = p.asset_id ? (timesByAsset.get(p.asset_id)?.length ?? 0) > 0 : false;
        const fit = p.asset_id ? fitByAsset.get(p.asset_id) ?? null : null;
        const wearOut = fit && fit.beta >= 1.5 && fit.r2 >= 0.5;
        const randomish = fit && fit.beta > 0.85 && fit.beta < 1.5;

        const base = {
            pmId: p.id, code: p.code, title: p.title,
            assetId: p.asset_id, tag: asset?.tag ?? '(unassigned)',
            criticality: asset?.criticality ?? null,
            annualEvents: annual, currentIntervalDays: days ? Math.round(days) : null,
            failures12mo: failures12, weibull: fit,
        };

        const dupes = p.asset_id ? byAssetType.get(`${p.asset_id}|${(p.job_type ?? '').toUpperCase()}`) ?? [] : [];
        if (dupes.length > 1 && dupes[0].id !== p.id) {
            // Every duplicate after the first is the consolidation candidate.
            verdicts.push({
                ...base, verdict: 'redundant', recommendedIntervalDays: null,
                eventsSavedPerYear: annual ?? 0,
                reason: `${dupes.length} active ${p.job_type ?? 'PM'} programmes on ${asset?.tag ?? 'this asset'} — consolidate into ${dupes[0].code}.`,
            });
            continue;
        }

        if (wearOut && days && fit) {
            if (days < fit.b10Days * 0.5) {
                const saved = annual != null ? Math.max(0, annual - 365.25 / fit.b10Days) : 0;
                verdicts.push({
                    ...base, verdict: 'over_maintenance', recommendedIntervalDays: fit.b10Days,
                    eventsSavedPerYear: Math.round(saved * 10) / 10,
                    reason: `Wear-out fit (β=${fit.beta}, R²=${fit.r2}) puts B10 life at ${fit.b10Days}d — the current ${Math.round(days)}d interval services ${Math.round((fit.b10Days / days) * 10) / 10}× more often than the failure data justifies.`,
                });
                continue;
            }
            if (days > fit.b10Days * 1.5 && failures12 > 0) {
                verdicts.push({
                    ...base, verdict: 'under_maintenance', recommendedIntervalDays: fit.b10Days,
                    eventsSavedPerYear: 0,
                    reason: `Wear-out fit (β=${fit.beta}) puts B10 life at ${fit.b10Days}d but the PM runs every ${Math.round(days)}d — failures are arriving before the PM does (${failures12} in 12 months).`,
                });
                continue;
            }
        }

        if (randomish && failures12 >= 2 && fit) {
            verdicts.push({
                ...base, verdict: 'ineffective', recommendedIntervalDays: null,
                eventsSavedPerYear: annual ?? 0,
                reason: `Failures are random in time (β=${fit.beta}) — a calendar PM cannot intercept them (${failures12} failures in 12 months anyway). Shift to condition monitoring.`,
            });
            continue;
        }

        if (!everFailed && annual != null && annual >= 12) {
            verdicts.push({
                ...base, verdict: 'over_maintenance',
                recommendedIntervalDays: days ? Math.round(days * 2) : null,
                eventsSavedPerYear: Math.round((annual / 2) * 10) / 10,
                reason: `${annual} PM events/yr with zero recorded failures ever — start by doubling the interval and watching.`,
            });
        }
    }

    const counts: PmOptimizationResult['counts'] = { redundant: 0, over_maintenance: 0, under_maintenance: 0, ineffective: 0 };
    let saved = 0;
    for (const v of verdicts) { counts[v.verdict] += 1; saved += v.eventsSavedPerYear; }
    // High-stakes first: criticality A, then events saved.
    verdicts.sort((a, b) =>
        (a.criticality === 'A' ? 0 : 1) - (b.criticality === 'A' ? 0 : 1) || b.eventsSavedPerYear - a.eventsSavedPerYear);

    return { verdicts, scanned: pms.length, counts, eventsSavedPerYear: Math.round(saved * 10) / 10 };
}
