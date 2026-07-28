/**
 * briefingCharts — the deterministic data behind the briefing's illustrations.
 *
 * The prose is the agent's voice; the charts are NOT derived from it. They are
 * computed from the same live rows the assessment reads, so a chart can never
 * illustrate a number the data doesn't support. Pure functions, tested.
 */

export interface ChartWoRow {
    asset_id: string | null;
    type: string | null;
    status: string | null;
    created_at: string;
    cost: number;
}

export interface ChartAssetRow {
    id: string;
    tag: string;
    name: string;
}

export interface MonthPoint {
    /** yyyy-mm sort key */
    key: string;
    /** short display label, e.g. "Aug" (January carries the year: "Jan 26") */
    label: string;
    cost: number;
}

export interface ParetoRow {
    assetId: string;
    tag: string;
    name: string;
    cost: number;
    /** running share of the 12-month total, 1 dp */
    cumPct: number;
}

export interface BriefingAnalytics {
    monthly: MonthPoint[];
    pareto: ParetoRow[];
    spend12mo: number;
    openTotal: number;
    openCm: number;
}

const DAY_MS = 86_400_000;
const OPEN_EXCLUDED = new Set(['CLOSED', 'TECO', 'CANCELLED', 'CANCELED', 'COMPLETED']);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function computeBriefingAnalytics(
    wos: ChartWoRow[],
    assets: ChartAssetRow[],
    nowMs: number,
): BriefingAnalytics {
    const assetById = new Map(assets.map((a) => [a.id, a]));
    const cutoff12 = nowMs - 365 * DAY_MS;

    // Last 12 calendar months, oldest → newest, present even when empty so the
    // axis is honest about quiet months.
    const now = new Date(nowMs);
    const monthly: MonthPoint[] = [];
    const monthIndex = new Map<string, number>();
    for (let i = 11; i >= 0; i--) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        const label = d.getUTCMonth() === 0
            ? `${MONTHS[0]} ${String(d.getUTCFullYear() % 100).padStart(2, '0')}`
            : MONTHS[d.getUTCMonth()];
        monthIndex.set(key, monthly.length);
        monthly.push({ key, label, cost: 0 });
    }

    const costByAsset = new Map<string, number>();
    let spend12mo = 0;
    let openTotal = 0;
    let openCm = 0;

    for (const w of wos) {
        const status = String(w.status ?? '').toUpperCase();
        if (status && !OPEN_EXCLUDED.has(status)) {
            openTotal += 1;
            if (String(w.type ?? '').toUpperCase() === 'CM') openCm += 1;
        }
        const t = new Date(w.created_at).getTime();
        if (!Number.isFinite(t) || t < cutoff12 || t > nowMs) continue;
        const cost = Number(w.cost) || 0;
        spend12mo += cost;
        const d = new Date(t);
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        const idx = monthIndex.get(key);
        if (idx !== undefined) monthly[idx].cost += cost;
        if (w.asset_id && cost > 0) costByAsset.set(w.asset_id, (costByAsset.get(w.asset_id) ?? 0) + cost);
    }

    const grand = [...costByAsset.values()].reduce((s, v) => s + v, 0);
    let cum = 0;
    const pareto: ParetoRow[] = [...costByAsset.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([assetId, cost]) => {
            cum += cost;
            const a = assetById.get(assetId);
            return {
                assetId,
                tag: a?.tag ?? '(unknown)',
                name: a?.name ?? '',
                cost: Math.round(cost),
                cumPct: grand ? Math.round((cum / grand) * 1000) / 10 : 0,
            };
        });

    for (const m of monthly) m.cost = Math.round(m.cost);

    return { monthly, pareto, spend12mo: Math.round(spend12mo), openTotal, openCm };
}
