/**
 * RenewalQueue — which assets are EARNING replacement (RF-01 item 5).
 *
 * The capital-planning input owners ask their asset manager for: the fleet
 * ranked by repair-vs-replace pressure (lib/renewal.ts — deterministic,
 * reasons attached, rules of thumb named). Explicitly a SCREEN: a candidate
 * earns a What-If study in Predict; nothing here is a verdict.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Replace, Loader2, AlertTriangle, ChevronRight, Info } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { computeRenewalQueue, type RenewalCandidate, type LifecycleRow } from '../../../lib/renewal';
import { fmtMoney } from '../../../lib/downtimeCost';

export const RenewalQueue: React.FC = () => {
    const navigate = useNavigate();
    const [queue, setQueue] = useState<RenewalCandidate[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const [lcQ, coQ] = await Promise.all([
                    supabase.from('sem_asset_lifecycle_cost').select('*').gt('wo_count_lifetime', 0).limit(5000),
                    supabase.from('companies').select('downtime_cost_per_hour').limit(1),
                ]);
                if (lcQ.error) throw lcQ.error;
                const rate = Number(coQ.data?.[0]?.downtime_cost_per_hour);
                const q = computeRenewalQueue(
                    (lcQ.data ?? []) as LifecycleRow[],
                    Number.isFinite(rate) && rate > 0 ? rate : null,
                );
                if (active) setQueue(q);
            } catch (e) {
                if (active) setError(`Renewal screening unavailable: ${e instanceof Error ? e.message : String(e)} (migration 0301 applied?)`);
            }
        })();
        return () => { active = false; };
    }, []);

    return (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
                <Replace size={15} className="text-primary-600" />
                <h3 className="text-sm font-bold text-slate-800 m-0">Renewal candidates — repair vs replace</h3>
                <span className="text-[11px] text-slate-400">
                    {queue == null ? '' : `${queue.length} asset(s) earning a study`}
                </span>
                <span className="ml-auto text-[10px] text-slate-400 flex items-center gap-1">
                    <Info size={10} /> screening, not verdicts — candidates earn a What-If study
                </span>
            </div>

            {error ? (
                <div className="m-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {error}
                </div>
            ) : queue == null ? (
                <div className="flex items-center justify-center gap-2 py-10 text-slate-400 text-sm"><Loader2 size={16} className="animate-spin" /> Screening the fleet…</div>
            ) : queue.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-slate-400 m-0">
                    Nothing is earning replacement right now. Candidates appear when 12-month upkeep approaches asset value,
                    spend trends up sharply, or assets run past their planned life — set acquisition data on the asset's
                    Financials tab to sharpen this screen.
                </p>
            ) : (
                <div className="divide-y divide-slate-50">
                    {queue.slice(0, 8).map((c, i) => (
                        <div key={c.assetId} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2">
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <span className={`w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${i === 0 ? 'bg-red-100 text-red-700' : i === 1 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{i + 1}</span>
                                    <span className="text-sm font-semibold text-slate-800 truncate">{c.tag} · {c.name}</span>
                                    {c.criticality && <span className="text-[9px] font-bold bg-slate-100 text-slate-500 rounded px-1 py-0.5 shrink-0">{c.criticality}</span>}
                                    <span className="text-[11px] font-mono text-slate-400 shrink-0" title="Screening score (0–100)">score {c.score}</span>
                                </div>
                                <ul className="mt-1 ml-8 text-[11.5px] text-slate-500 list-disc list-inside space-y-0.5">
                                    {c.reasons.map((r, j) => <li key={j}>{r}</li>)}
                                </ul>
                            </div>
                            <div className="flex items-center gap-3 shrink-0 sm:text-right ml-8 sm:ml-0">
                                <div>
                                    <div className="text-sm font-bold text-slate-800 tabular-nums">{fmtMoney(c.annualCost12mo)}<span className="text-[10px] font-normal text-slate-400">/yr</span></div>
                                    <div className="text-[10px] text-slate-400">
                                        {c.downtimeCost12mo != null ? 'maint + downtime est.' : 'maintenance only'}
                                    </div>
                                </div>
                                <button onClick={() => navigate('/predict')}
                                    title="Open Predict and pick this asset to run the What-If economics"
                                    className="flex items-center gap-1 rounded-lg border border-primary-200 bg-primary-50 hover:bg-primary-100 text-primary-700 text-[11px] font-semibold px-2.5 py-1.5">
                                    What-If <ChevronRight size={11} />
                                </button>
                            </div>
                        </div>
                    ))}
                    {queue.length > 8 && (
                        <p className="px-4 py-2 text-[11px] text-slate-400 m-0">+ {queue.length - 8} more candidate(s) below the fold — the top of this list is where capital conversations start.</p>
                    )}
                </div>
            )}
        </div>
    );
};

export default RenewalQueue;
