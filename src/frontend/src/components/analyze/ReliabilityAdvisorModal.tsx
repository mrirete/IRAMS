/**
 * ReliabilityAdvisorModal (R-6) — the flagship reliability agent, end to end.
 *
 * Given a bad actor, it runs the deterministic chain: pull WO failure history →
 * fit a censored Weibull (R-1) → read the pattern from β → recommend a PM
 * interval when age-based PM actually helps → cost-justify it, with every
 * number cited. Nothing is created until a human approves — Approve opens the
 * existing Create-PM-from-Weibull flow pre-filled with the proposal.
 *
 * "Agents orchestrate, tools compute": the math is recommendPM/fitWeibull; this
 * component only orchestrates and presents.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { X, Sparkles, Loader2, TrendingUp, AlertTriangle, CheckCircle2, Wrench, Clock } from 'lucide-react';
import { supabase } from '../../eam/lib/supabase';
import { failureIntervalsHours, isFailure, FAILURE_QUERY_COLUMNS } from '../../eam/services/reliabilityMetrics';
import { recommendPM, groundedRulFromHistory, type PMRecommendation } from '../../lib/pmRecommendation';
import { weibullBLife } from '../../eam/utils/weibull';
import { CreatePMFromWeibullModal, type WeibullPMData } from './CreatePMFromWeibullModal';

interface Props {
    asset: { id: string; tag: string; name: string };
    onClose: () => void;
    onCreated?: (pmId?: string, pmTitle?: string) => void;
}

const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

export const ReliabilityAdvisorModal: React.FC<Props> = ({ asset, onClose, onCreated }) => {
    const [loading, setLoading] = useState(true);
    const [intervals, setIntervals] = useState<number[]>([]);
    const [suspensions, setSuspensions] = useState<number[]>([]);
    const [costPerFailure, setCostPerFailure] = useState(10000);
    const [pmCost, setPmCost] = useState(1500);
    const [showCreate, setShowCreate] = useState(false);

    useEffect(() => {
        let active = true;
        (async () => {
            const { data: wos } = await supabase.from('work_orders')
                .select(FAILURE_QUERY_COLUMNS)
                .eq('asset_id', asset.id)
                .order('created_at');
            if (!active) return;
            const rows = wos || [];
            setIntervals(failureIntervalsHours(rows));
            // Running time since the last failure is a right-censored unit (R-1).
            const lastFail = rows.filter(isFailure)
                .map((w: any) => new Date(w.closed_at || w.created_at).getTime())
                .sort((a, b) => b - a)[0];
            if (lastFail) {
                const h = Math.floor((Date.now() - lastFail) / 3600000);
                if (h > 0) setSuspensions([h]);
            }
            setLoading(false);
        })();
        return () => { active = false; };
    }, [asset.id]);

    const rec: PMRecommendation = useMemo(
        () => recommendPM(intervals, suspensions, { costPerFailure, pmCost }),
        [intervals, suspensions, costPerFailure, pmCost],
    );
    // Data-grounded RUL (conditional mean residual life) — the real replacement
    // for the heuristic RUL on the Predict page.
    const grounded = useMemo(() => groundedRulFromHistory(intervals, suspensions), [intervals, suspensions]);

    const pmData: WeibullPMData | null = rec.fit && rec.recommendedIntervalHours ? {
        asset,
        beta: rec.fit.beta,
        eta: rec.fit.eta,
        r2: rec.fit.r2,
        b10: Math.round(weibullBLife(rec.fit.beta, rec.fit.eta, 10)),
        pmInterval: rec.recommendedIntervalHours,
        dataPoints: rec.fit.nFailures,
    } : null;

    const patternTone = rec.pattern === 'wear-out' ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
        : rec.pattern === 'random' ? 'text-amber-600 bg-amber-50 border-amber-200'
        : rec.pattern === 'infant-mortality' ? 'text-red-600 bg-red-50 border-red-200'
        : 'text-slate-500 bg-slate-50 border-slate-200';

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]">
                <div className="px-5 py-3 flex items-center gap-2 bg-gradient-to-r from-primary-600 to-primary-500 text-white flex-shrink-0">
                    <Sparkles size={18} />
                    <div className="min-w-0">
                        <h3 className="font-bold text-sm leading-tight">Reliability Advisor</h3>
                        <p className="text-[11px] text-white/80 truncate">{asset.tag} · {asset.name}</p>
                    </div>
                    <button onClick={onClose} className="ml-auto text-white/80 hover:text-white"><X size={18} /></button>
                </div>

                <div className="p-5 space-y-4 overflow-y-auto">
                    {loading ? (
                        <div className="flex items-center gap-2 text-slate-400 py-8 justify-center"><Loader2 size={16} className="animate-spin" /> Analysing failure history…</div>
                    ) : (
                        <>
                            {/* Pattern verdict */}
                            <div className={`rounded-lg border p-3 ${patternTone}`}>
                                <div className="flex items-center gap-2 text-sm font-bold">
                                    {rec.pattern === 'wear-out' ? <TrendingUp size={15} /> : rec.pattern === 'insufficient' ? <AlertTriangle size={15} /> : <AlertTriangle size={15} />}
                                    {rec.pattern === 'wear-out' ? 'Wear-out — PM recommended'
                                        : rec.pattern === 'random' ? 'Random failures — PM won’t help'
                                        : rec.pattern === 'infant-mortality' ? 'Infant mortality — investigate install'
                                        : 'Insufficient data'}
                                </div>
                                <p className="text-xs mt-1 text-slate-600 leading-relaxed">{rec.rationale}</p>
                            </div>

                            {/* Data-grounded RUL (conditional mean residual life) — the real RUL */}
                            {grounded.method === 'weibull-mrl' && grounded.rulDays != null && (
                                <div className="flex items-center justify-between border border-slate-200 rounded-lg p-3">
                                    <div>
                                        <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wide">Remaining useful life · data-grounded</div>
                                        <div className="text-2xl font-bold text-slate-800">{grounded.rulDays} <span className="text-sm font-medium">days</span></div>
                                        <div className="text-[10px] text-slate-400">Weibull mean residual life at {grounded.ageDays}d since last failure (not the heuristic HI estimate)</div>
                                    </div>
                                    <Clock size={26} className="text-slate-300" />
                                </div>
                            )}

                            {/* Recommended interval */}
                            {rec.pmAdvised && rec.recommendedIntervalDays && (
                                <div className="flex items-center justify-between bg-primary-50 border border-primary-200 rounded-lg p-3">
                                    <div>
                                        <div className="text-[10px] uppercase font-bold text-primary-700 tracking-wide">Recommended PM interval</div>
                                        <div className="text-2xl font-bold text-primary-700">{rec.recommendedIntervalDays} <span className="text-sm font-medium">days</span></div>
                                    </div>
                                    <Wrench size={28} className="text-primary-300" />
                                </div>
                            )}

                            {/* Cost justification */}
                            {rec.cost && (
                                <div className="border border-slate-200 rounded-lg p-3 space-y-2">
                                    <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wide">Cost justification (annual)</div>
                                    <div className="grid grid-cols-3 gap-2 text-center">
                                        <div><div className="text-[10px] text-slate-400">Run-to-fail</div><div className="text-sm font-bold text-red-600">{money(rec.cost.currentAnnualCost)}</div></div>
                                        <div><div className="text-[10px] text-slate-400">With PM</div><div className="text-sm font-bold text-slate-700">{money(rec.cost.projectedAnnualCost)}</div></div>
                                        <div><div className="text-[10px] text-slate-400">Net saving</div><div className={`text-sm font-bold ${rec.cost.netAnnualSavings >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{money(rec.cost.netAnnualSavings)}</div></div>
                                    </div>
                                    <div className="flex items-center gap-3 text-[11px] text-slate-500 pt-1 border-t border-slate-100">
                                        <label className="flex items-center gap-1">Cost/failure <input type="number" value={costPerFailure} onChange={e => setCostPerFailure(Number(e.target.value) || 0)} className="w-20 border border-slate-200 rounded px-1 py-0.5 text-right" /></label>
                                        <label className="flex items-center gap-1">Cost/PM <input type="number" value={pmCost} onChange={e => setPmCost(Number(e.target.value) || 0)} className="w-16 border border-slate-200 rounded px-1 py-0.5 text-right" /></label>
                                    </div>
                                    <p className="text-[10px] text-slate-400">{rec.cost.assumption}</p>
                                </div>
                            )}

                            {/* Citations */}
                            <div>
                                <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wide mb-1">Evidence</div>
                                <ul className="text-[11px] text-slate-500 space-y-0.5 list-disc pl-4">
                                    {rec.citations.map((c, i) => <li key={i}>{c}</li>)}
                                    {rec.confidenceNote && <li className="text-slate-400">{rec.confidenceNote}</li>}
                                </ul>
                            </div>
                        </>
                    )}
                </div>

                <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-2 flex-shrink-0">
                    <button onClick={onClose} className="text-sm font-semibold text-slate-500 hover:bg-slate-50 px-3 py-2 rounded-lg">Close</button>
                    <button
                        onClick={() => setShowCreate(true)}
                        disabled={loading || !pmData}
                        title={!pmData ? 'A PM is only proposed for a wear-out pattern' : ''}
                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-500 disabled:opacity-50 px-3 py-2 rounded-lg"
                    >
                        <CheckCircle2 size={15} /> Approve &amp; create PM
                    </button>
                </div>
            </div>

            {showCreate && pmData && (
                <CreatePMFromWeibullModal
                    isOpen={showCreate}
                    onClose={() => setShowCreate(false)}
                    data={pmData}
                    onSuccess={(id, title) => { setShowCreate(false); onCreated?.(id, title); onClose(); }}
                />
            )}
        </div>
    );
};
