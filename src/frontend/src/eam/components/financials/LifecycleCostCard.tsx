/**
 * LifecycleCostCard — "what has this asset truly cost, trending how"
 * (RF-01 item 5 — the asset manager's native unit of thought, ISO 55000
 * lifecycle principle). Reads sem_asset_lifecycle_cost; downtime is
 * monetized with the asset→company rate fallback and labelled with the
 * rate used — no rate, no invented currency.
 */
import React, { useEffect, useState } from 'react';
import { Landmark, Loader2, TrendingUp, TrendingDown } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { fmtMoney } from '../../../lib/downtimeCost';

interface LcRow {
    maint_cost_lifetime: number; maint_cost_12mo: number; maint_cost_prior12: number;
    unplanned_downtime_hrs_12mo: number; unplanned_downtime_hrs_lifetime: number;
    wo_count_lifetime: number; first_event_at: string | null;
    acquisition_cost: number | null; replacement_value: number | null;
    asset_downtime_rate: number | null;
}

export const LifecycleCostCard: React.FC<{ assetId: string }> = ({ assetId }) => {
    const [row, setRow] = useState<LcRow | null | 'loading'>('loading');
    const [companyRate, setCompanyRate] = useState<number | null>(null);

    useEffect(() => {
        let active = true;
        (async () => {
            const [lcQ, coQ] = await Promise.all([
                supabase.from('sem_asset_lifecycle_cost').select('*').eq('asset_id', assetId).maybeSingle(),
                supabase.from('companies').select('downtime_cost_per_hour').limit(1),
            ]);
            if (!active) return;
            setRow((lcQ.data as LcRow) ?? null);
            const r = Number(coQ.data?.[0]?.downtime_cost_per_hour);
            setCompanyRate(Number.isFinite(r) && r > 0 ? r : null);
        })();
        return () => { active = false; };
    }, [assetId]);

    if (row === 'loading') {
        return <div className="flex items-center gap-2 text-slate-400 text-sm p-4"><Loader2 size={14} className="animate-spin" /> Lifecycle cost…</div>;
    }
    if (!row || row.wo_count_lifetime === 0) return null; // no history — say nothing rather than zeros

    const rate = (Number(row.asset_downtime_rate) > 0 ? Number(row.asset_downtime_rate) : null) ?? companyRate;
    const dt12 = rate != null ? row.unplanned_downtime_hrs_12mo * rate : null;
    const total12 = row.maint_cost_12mo + (dt12 ?? 0);
    const trendUp = row.maint_cost_prior12 > 0 && row.maint_cost_12mo > row.maint_cost_prior12 * 1.1;
    const trendDown = row.maint_cost_prior12 > 0 && row.maint_cost_12mo < row.maint_cost_prior12 * 0.9;
    const basis = (Number(row.replacement_value) > 0 ? Number(row.replacement_value) : null)
        ?? (Number(row.acquisition_cost) > 0 ? Number(row.acquisition_cost) : null);

    return (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
                <Landmark size={15} className="text-primary-600" />
                <h4 className="text-sm font-bold text-slate-800 m-0">Lifecycle cost</h4>
                <span className="text-[10px] text-slate-400">since {row.first_event_at ? new Date(row.first_event_at).getFullYear() : '—'} · {row.wo_count_lifetime} work orders</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                    <div className="text-lg font-bold text-slate-800 tabular-nums">{fmtMoney(row.maint_cost_lifetime)}</div>
                    <div className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">Lifetime maintenance</div>
                </div>
                <div>
                    <div className="text-lg font-bold text-slate-800 tabular-nums flex items-center gap-1">
                        {fmtMoney(row.maint_cost_12mo)}
                        {trendUp && <TrendingUp size={13} className="text-red-500" />}
                        {trendDown && <TrendingDown size={13} className="text-emerald-500" />}
                    </div>
                    <div className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">Last 12 mo{row.maint_cost_prior12 > 0 ? ` (prior: ${fmtMoney(row.maint_cost_prior12)})` : ''}</div>
                </div>
                <div>
                    <div className="text-lg font-bold text-slate-800 tabular-nums">
                        {dt12 != null ? fmtMoney(dt12) : `${Math.round(row.unplanned_downtime_hrs_12mo)} h`}
                    </div>
                    <div className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">
                        {dt12 != null ? `Downtime est. @ ${fmtMoney(rate!)}/hr` : 'Unplanned downtime (set a rate to price it)'}
                    </div>
                </div>
                <div>
                    <div className="text-lg font-bold text-slate-800 tabular-nums">
                        {basis != null && total12 > 0 ? `${Math.round((total12 / basis) * 100)}%` : '—'}
                    </div>
                    <div className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">
                        {basis != null ? `12-mo upkeep vs ${Number(row.replacement_value) > 0 ? 'replacement value' : 'acquisition cost'}` : 'Add acquisition data to see intensity'}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LifecycleCostCard;
