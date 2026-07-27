/**
 * valueRealization — measured (not estimated) value from approved
 * Specialist actions (Phase A3, docs/Specialist-150k-Replacement-Plan.md §4).
 *
 * The $150k-replacement claim lives or dies on this number being defensible,
 * so the method is deliberately boring:
 *
 *   before rate = CM cost on the asset, 365 days pre-approval ÷ 365
 *   after rate  = CM cost on the asset since approval ÷ elapsed days
 *   measured    = (before − after) × elapsed days   — reported NET
 *
 * One asset counts once (earliest approval wins) no matter how many actions
 * touched it, and nothing is measured before a 30-day maturity window.
 * Negative deltas are surfaced as "no measurable change yet", never hidden.
 * This is run-rate attribution, not causal proof — the assessment snapshots
 * carry the plant-level corroboration.
 */

export interface ApprovedActionRef {
    asset_id: string | null;
    /** reviewed_at (approval stamp); falls back to created_at upstream. */
    approved_at: string | null;
}

export interface RealizationWoRow {
    asset_id: string | null;
    type: string | null;
    created_at: string;
    cost: number;
}

export interface AssetRealization {
    assetId: string;
    approvedAt: string;
    elapsedDays: number;
    beforeAnnualRate: number;
    afterAnnualRate: number;
    /** (before − after) daily-rate delta × elapsed days. Negative = worse. */
    measuredToDate: number;
}

export interface RealizationSummary {
    /** Net measured $ across matured assets (can be ≤ 0). */
    measuredToDate: number;
    /** Assets past the maturity window and therefore measured. */
    assetsMeasured: number;
    /** Assets with approved actions still inside the maturity window. */
    assetsMaturing: number;
    perAsset: AssetRealization[];
}

export const REALIZATION_MATURITY_DAYS = 30;
const DAY_MS = 86_400_000;

const isCorrective = (t: string | null) => String(t ?? '').toUpperCase() === 'CM';

export function computeRealization(
    actions: ApprovedActionRef[],
    wos: RealizationWoRow[],
    nowMs: number,
): RealizationSummary {
    // Earliest approval per asset — one measurement per physical asset.
    const firstApproval = new Map<string, number>();
    for (const a of actions) {
        if (!a.asset_id || !a.approved_at) continue;
        const t = new Date(a.approved_at).getTime();
        if (!Number.isFinite(t)) continue;
        const prev = firstApproval.get(a.asset_id);
        if (prev === undefined || t < prev) firstApproval.set(a.asset_id, t);
    }

    const cmByAsset = new Map<string, { t: number; cost: number }[]>();
    for (const w of wos) {
        if (!w.asset_id || !isCorrective(w.type)) continue;
        const arr = cmByAsset.get(w.asset_id) ?? [];
        arr.push({ t: new Date(w.created_at).getTime(), cost: Number(w.cost) || 0 });
        cmByAsset.set(w.asset_id, arr);
    }

    const perAsset: AssetRealization[] = [];
    let maturing = 0;
    for (const [assetId, approvedMs] of firstApproval) {
        const elapsedDays = (nowMs - approvedMs) / DAY_MS;
        if (elapsedDays < REALIZATION_MATURITY_DAYS) { maturing += 1; continue; }
        const rows = cmByAsset.get(assetId) ?? [];
        const beforeStart = approvedMs - 365 * DAY_MS;
        let beforeCost = 0, afterCost = 0;
        for (const r of rows) {
            if (r.t >= beforeStart && r.t < approvedMs) beforeCost += r.cost;
            else if (r.t >= approvedMs && r.t <= nowMs) afterCost += r.cost;
        }
        const beforeDaily = beforeCost / 365;
        const afterDaily = afterCost / elapsedDays;
        perAsset.push({
            assetId,
            approvedAt: new Date(approvedMs).toISOString(),
            elapsedDays: Math.round(elapsedDays),
            beforeAnnualRate: Math.round(beforeDaily * 365),
            afterAnnualRate: Math.round(afterDaily * 365),
            measuredToDate: Math.round((beforeDaily - afterDaily) * elapsedDays),
        });
    }
    perAsset.sort((a, b) => b.measuredToDate - a.measuredToDate);

    return {
        measuredToDate: perAsset.reduce((s, p) => s + p.measuredToDate, 0),
        assetsMeasured: perAsset.length,
        assetsMaturing: maturing,
        perAsset,
    };
}
