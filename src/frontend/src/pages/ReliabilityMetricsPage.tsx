/**
 * ReliabilityMetricsPage — the SMRP measurement layer for the Reliability Tier.
 *
 * Surfaces the vital-few reliability KPIs computed from the single reliabilityMetrics
 * spine (so people and the AI read the same numbers), each with its SMRP definition,
 * a bad-actor list, and one-click "Ask Specialist" advice grounded in the KPI results.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gauge, Loader2, Sparkles, AlertTriangle, TrendingUp, Repeat, ArrowRight } from 'lucide-react';
import { supabase } from '../eam/lib/supabase';
import { useRelantern } from '../eam/contexts/RelanternContext';
import { classifyWork } from '../eam/services/workReadiness';
import {
    computePMEffectiveness, pmEffectivenessKpi, computeAssetReliability,
    kpisToAIContext, type ReliabilityKpi, type AssetReliability,
} from '../eam/services/reliabilityMetrics';

interface AssetRow { id: string; tag: string; name: string; criticality?: string }
interface BadActor { id: string; rel: AssetReliability }

const ONE_YEAR = 365 * 86400000;
const NINETY_DAYS = 90 * 86400000;

export const ReliabilityMetricsPage: React.FC = () => {
    const { openRelantern } = useRelantern();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [wos, setWos] = useState<any[]>([]);
    const [assets, setAssets] = useState<AssetRow[]>([]);

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const since = new Date(Date.now() - ONE_YEAR).toISOString();
                const [woRes, aRes] = await Promise.all([
                    supabase.from('work_orders')
                        .select('id, type, status, est_duration, actual_downtime_hrs, asset_id, created_at, closed_at, parent_wo_id, recurring_work_id, job_tasks(description, instructions), work_order_labor(id), wo_failure_data(failure_mode_code)')
                        .gte('created_at', since),
                    supabase.from('assets').select('id, tag, name, criticality'),
                ]);
                if (!active) return;
                if (woRes.error) throw woRes.error;
                setWos(woRes.data || []);
                setAssets((aRes.data as AssetRow[]) || []);
            } catch (e: any) {
                if (active) setError(e?.message || 'Failed to load reliability data.');
            } finally {
                if (active) setLoading(false);
            }
        })();
        return () => { active = false; };
    }, []);

    const assetName = (id: string) => {
        const a = assets.find(x => x.id === id);
        return a ? `${a.tag || ''}${a.name ? ` — ${a.name}` : ''}`.trim() || id.slice(0, 8) : id.slice(0, 8);
    };

    const { kpis, badActors } = useMemo(() => {
        const mapClassify = (r: any) => ({
            type: r.type, status: r.status, estDuration: r.est_duration,
            tasks: (r.job_tasks || []).map((t: any) => ({ description: t.description, instructions: t.instructions || [], estHours: 0 })),
            labor: r.work_order_labor || [],
        });
        const mapPM = (r: any) => ({
            id: r.id, type: r.type, status: r.status, parentWoId: r.parent_wo_id, recurringWorkId: r.recurring_work_id,
            failureData: { failureMode: (Array.isArray(r.wo_failure_data) ? r.wo_failure_data[0] : r.wo_failure_data)?.failure_mode_code },
        });

        // % Proactive (last 90 days)
        const cutoff = Date.now() - NINETY_DAYS;
        let pro = 0, rea = 0;
        for (const r of wos) {
            if (new Date(r.created_at).getTime() < cutoff) continue;
            const c = classifyWork(mapClassify(r) as any);
            if (c === 'PROACTIVE') pro++; else if (c === 'REACTIVE') rea++;
        }
        const proPct = pro + rea ? Math.round((pro / (pro + rea)) * 100) : null;

        // PM & PdM Effectiveness
        const pmEff = computePMEffectiveness(wos.map(mapPM));

        // Per-asset reliability → fleet rollups + bad actors
        const byAsset: Record<string, any[]> = {};
        for (const r of wos) { if (r.asset_id) (byAsset[r.asset_id] = byAsset[r.asset_id] || []).push(r); }
        const assetRel = Object.entries(byAsset).map(([id, recs]) => ({ id, rel: computeAssetReliability(recs) }));
        const totalFailures12 = assetRel.reduce((s, a) => s + a.rel.failures12mo, 0);
        const mtbfs = assetRel.map(a => a.rel.mtbfDays).filter((v): v is number => v != null);
        const fleetMtbf = mtbfs.length ? Math.round(mtbfs.reduce((s, v) => s + v, 0) / mtbfs.length) : null;
        const mttrs = assetRel.map(a => a.rel.mttrHours).filter((v): v is number => v != null);
        const fleetMttr = mttrs.length ? Math.round((mttrs.reduce((s, v) => s + v, 0) / mttrs.length) * 10) / 10 : null;
        const fleetAvail = (fleetMtbf != null && fleetMttr != null && (fleetMtbf + fleetMttr / 24) > 0)
            ? Math.round((fleetMtbf / (fleetMtbf + fleetMttr / 24)) * 1000) / 10 : null;
        const bad = assetRel.filter(a => a.rel.failures12mo > 0).sort((a, b) => b.rel.failures12mo - a.rel.failures12mo).slice(0, 8);

        const list: ReliabilityKpi[] = [
            { key: 'pct_proactive', label: '% Proactive', value: proPct, display: proPct == null ? 'N/A' : `${proPct}%`, unit: '%', direction: 'higher-better', benchmark: '>= 80%', definition: 'Preventive or fully-planned work vs reactive (last 90 days). World-class >= 80%.' },
            pmEffectivenessKpi(pmEff),
            { key: 'availability', label: 'Availability', value: fleetAvail, display: fleetAvail == null ? 'N/A' : `${fleetAvail}%`, unit: '%', direction: 'higher-better', benchmark: '>= 90%', definition: 'Inherent availability Ai = MTBF / (MTBF + MTTR). Driven by repair downtime (MTTR). World-class >= 90%.' },
            { key: 'fleet_mtbf', label: 'Fleet MTBF', value: fleetMtbf, display: fleetMtbf == null ? 'N/A' : `${fleetMtbf}d`, unit: 'days', direction: 'higher-better', definition: 'Mean Time Between Failures, averaged across assets (equipment reliability).' },
            { key: 'fleet_mttr', label: 'Fleet MTTR', value: fleetMttr, display: fleetMttr == null ? 'N/A' : `${fleetMttr}h`, unit: 'hours', direction: 'lower-better', definition: 'Mean Time To Repair, averaged across assets.' },
            { key: 'failures_12mo', label: 'Failures (12mo)', value: totalFailures12, display: String(totalFailures12), direction: 'lower-better', definition: 'Total corrective failures across the fleet in the last 12 months.' },
        ];
        return { kpis: list, badActors: bad as BadActor[] };
    }, [wos]);

    const ragColor = (k: ReliabilityKpi): string => {
        if (k.value == null) return 'text-slate-400';
        if (k.key === 'pct_proactive') return k.value >= 80 ? 'text-emerald-600' : k.value >= 60 ? 'text-amber-500' : 'text-red-500';
        if (k.key === 'pm_pdm_effectiveness') return k.value >= 70 ? 'text-emerald-600' : k.value >= 40 ? 'text-amber-500' : 'text-red-500';
        if (k.key === 'availability') return k.value >= 90 ? 'text-emerald-600' : k.value >= 75 ? 'text-amber-500' : 'text-red-500';
        return 'text-slate-800';
    };

    const askSpecialist = () => {
        const ctx = [
            'RELIABILITY METRICS',
            kpisToAIContext(kpis),
            badActors.length ? `Top bad actors: ${badActors.slice(0, 6).map(a => `${assetName(a.id)} (${a.rel.failures12mo} failures/12mo${a.rel.mtbfDays != null ? `, MTBF ${a.rel.mtbfDays}d` : ''}${a.rel.recurringModes.length ? `, recurring: ${a.rel.recurringModes[0].mode}×${a.rel.recurringModes[0].count}` : ''})`).join('; ')}.` : '',
        ].filter(Boolean).join('\n');
        const prompt = `As a reliability engineer, review these fleet reliability KPIs against industry reliability best practice. Be specific:\n1. The 3 biggest risks or opportunities in these numbers.\n2. A prioritised action plan — which bad actors to take to RCA, which PMs to optimise, and how to lift the proactive ratio.\n3. Any KPI that looks unreliable due to thin data, and what to capture to fix it.`;
        openRelantern(ctx, 'reliability', prompt);
    };

    return (
        <div className="space-y-5 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-lg md:text-xl font-bold text-slate-900 flex items-center gap-2">
                        <Gauge size={20} className="text-primary-600" /> Reliability Metrics
                    </h1>
                    <p className="text-xs text-slate-500">Reliability-aligned KPIs — one source of truth for people and the Specialist AI.</p>
                </div>
                <button
                    onClick={askSpecialist}
                    disabled={loading}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 shadow-sm disabled:opacity-50"
                >
                    <Sparkles size={15} /> Ask Specialist
                </button>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-20 text-slate-400"><Loader2 size={24} className="animate-spin" /></div>
            ) : error ? (
                <div className="flex items-start gap-2 p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {error}
                </div>
            ) : (
                <>
                    {/* KPI cards */}
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                        {kpis.map(k => (
                            <div key={k.key} className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 md:p-4" title={`${k.smrpRef ? k.smrpRef + ' — ' : ''}${k.definition}`}>
                                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 flex items-center gap-1">
                                    {k.label}{k.smrpRef && <span className="text-slate-300">·{k.smrpRef.replace('SMRP ', '')}</span>}
                                </div>
                                <div className={`text-2xl md:text-3xl font-extrabold mt-1 ${ragColor(k)}`}>{k.display}</div>
                                {k.benchmark && <div className="text-[10px] text-slate-400 mt-0.5">benchmark {k.benchmark}</div>}
                            </div>
                        ))}
                    </div>

                    {/* Bad actors */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                            <TrendingUp size={15} className="text-red-500" />
                            <h3 className="text-sm font-bold text-slate-800">Bad Actors</h3>
                            <span className="text-[11px] text-slate-400">by failure count · last 12 months</span>
                            <button
                                onClick={() => navigate('/analyze')}
                                className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-primary-600 hover:text-primary-700"
                                title="Open the Analyze bad-actor Pareto for the cost & downtime lens and to start an RCA"
                            >
                                Cost &amp; downtime drill <ArrowRight size={12} />
                            </button>
                        </div>
                        {badActors.length === 0 ? (
                            <div className="p-8 text-center text-slate-400 text-sm">No corrective failures recorded in the last 12 months.</div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="min-w-full text-sm">
                                    <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400">
                                        <tr>
                                            <th className="text-left font-bold px-4 py-2">Asset</th>
                                            <th className="text-right font-bold px-4 py-2">Failures (12mo)</th>
                                            <th className="text-right font-bold px-4 py-2">MTBF</th>
                                            <th className="text-right font-bold px-4 py-2">MTTR</th>
                                            <th className="text-left font-bold px-4 py-2">Recurring mode</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {badActors.map(a => (
                                            <tr key={a.id} className="hover:bg-slate-50">
                                                <td className="px-4 py-2.5 font-semibold text-slate-800 truncate max-w-[280px]">{assetName(a.id)}</td>
                                                <td className="px-4 py-2.5 text-right font-bold text-red-600">{a.rel.failures12mo}</td>
                                                <td className="px-4 py-2.5 text-right text-slate-600">{a.rel.mtbfDays != null ? `${a.rel.mtbfDays}d` : '—'}</td>
                                                <td className="px-4 py-2.5 text-right text-slate-600">{a.rel.mttrHours != null ? `${a.rel.mttrHours}h` : '—'}</td>
                                                <td className="px-4 py-2.5">
                                                    {a.rel.recurringModes.length > 0
                                                        ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200"><Repeat size={10} /> {a.rel.recurringModes[0].mode} ×{a.rel.recurringModes[0].count}</span>
                                                        : <span className="text-slate-300">—</span>}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    <p className="text-[11px] text-slate-400">
                        Metrics computed from the last 12 months of work orders via the shared reliability engine.
                        Hover a KPI for its definition. New metrics (e.g. Availability) plug in here automatically.
                    </p>
                </>
            )}
        </div>
    );
};

export default ReliabilityMetricsPage;
