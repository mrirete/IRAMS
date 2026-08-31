/**
 * downtimeCost — the one place "downtime hours" become "estimated dollars"
 * (RF-01 item 2: owners think in money; surfaces said hours).
 *
 * Rate resolution: asset_financials.downtime_cost_per_hour (per-asset, edited
 * on the asset's Financials tab) → companies.downtime_cost_per_hour (tenant
 * default, 0300) → null. HONESTY CONTRACT for every consumer:
 *   - a figure is shown ONLY when a rate exists; no rate → show hours, never
 *     invented currency;
 *   - the rate used is always displayed alongside the figure ("@ $12k/hr");
 *   - it is labelled an estimate — production-loss rates are planning inputs,
 *     not measured financial actuals.
 */
import { supabase } from '../eam/lib/supabase';

export interface DowntimeRates {
    /** asset_id → per-asset rate (only entries with a positive rate) */
    byAsset: Map<string, number>;
    /** tenant default; null when unset */
    companyDefault: number | null;
}

export async function fetchDowntimeRates(): Promise<DowntimeRates> {
    const [finQ, coQ] = await Promise.all([
        supabase.from('asset_financials')
            .select('asset_id, downtime_cost_per_hour')
            .gt('downtime_cost_per_hour', 0)
            .limit(10000),
        // RLS scopes companies to the caller's tenant row(s).
        supabase.from('companies').select('downtime_cost_per_hour').limit(1),
    ]);
    const byAsset = new Map<string, number>();
    for (const r of finQ.data ?? []) {
        const v = Number(r.downtime_cost_per_hour);
        if (Number.isFinite(v) && v > 0 && r.asset_id) byAsset.set(r.asset_id, v);
    }
    const def = Number(coQ.data?.[0]?.downtime_cost_per_hour);
    return { byAsset, companyDefault: Number.isFinite(def) && def > 0 ? def : null };
}

/** Effective rate for an asset; null = no rate anywhere → show hours only. */
export function effectiveRate(rates: DowntimeRates, assetId: string | null | undefined): number | null {
    if (assetId && rates.byAsset.has(assetId)) return rates.byAsset.get(assetId)!;
    return rates.companyDefault;
}

/** Compact money formatting for cost-of-unreliability figures. */
export function fmtMoney(v: number): string {
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 10_000) return `$${Math.round(v / 1000)}k`;
    if (v >= 1_000) return `$${(v / 1000).toFixed(1)}k`;
    return `$${Math.round(v)}`;
}

/**
 * hours × rate, honestly packaged: null when no rate. `label` carries the
 * rate used so the consumer can show "est. @ $X/hr" next to the number.
 */
export function unreliabilityCost(
    rates: DowntimeRates,
    assetId: string | null | undefined,
    downtimeHours: number,
): { cost: number; rate: number; label: string } | null {
    const rate = effectiveRate(rates, assetId);
    if (rate == null || !(downtimeHours > 0)) return null;
    return { cost: downtimeHours * rate, rate, label: `est. @ ${fmtMoney(rate)}/hr` };
}
