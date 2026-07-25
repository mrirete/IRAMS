/**
 * AssessmentReportPage — the deliverable of the assessment-led sale
 * (Specialist Phase 1, strategy §5.4). Every number is computed
 * DETERMINISTICALLY here (Pareto, censored Weibull via eam/utils/weibull,
 * PM waste, warranty recovery, data quality); the assessment_narrator agent
 * writes prose over those numbers — never the reverse. Print-ready via the
 * RCAReport pattern (no-print toolbar + @media print).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ArrowLeft, Printer, Sparkles, Loader2, AlertTriangle, TrendingDown,
    BadgeDollarSign, Activity, Wrench, ShieldCheck, Database, RefreshCw,
} from 'lucide-react';
import { supabase } from '../../eam/lib/supabase';
import { useSettings } from '../../contexts/SettingsContext';
import { fitWeibull, weibullBLife } from '../../eam/utils/weibull';
import { runAssessmentNarrator } from '../../eam/services/agentRunClient';

// ── row shapes (only the columns we query) ────────────────────────────────
interface WoRow {
    id: string; asset_id: string; type: string | null; status: string | null;
    created_at: string; closed_at: string | null;
    frozen_labor_cost: number | null; frozen_material_cost: number | null;
    total_actual_cost: number | null; actual_downtime_hrs: number | null;
}
interface AssetRow { id: string; tag: string; name: string; criticality: string | null; }

const woCost = (w: WoRow): number => {
    const frozen = (Number(w.frozen_labor_cost) || 0) + (Number(w.frozen_material_cost) || 0);
    return frozen || Number(w.total_actual_cost) || 0;
};
const isCorrective = (w: WoRow) => String(w.type ?? '').toUpperCase() === 'CM';
const DAY_MS = 86400_000;

// ── computed section shapes ───────────────────────────────────────────────
interface BadActor {
    tag: string; name: string; criticality: string | null;
    cost12mo: number; woCount12mo: number; cmCount12mo: number;
    downtime12mo: number; cumulativePct: number;
}
interface WeibullFinding {
    tag: string; name: string; nFailures: number; nSuspensions: number;
    beta: number; eta: number; b10Days: number; r2: number; interpretation: string;
}
interface WarrantyFind { woNumber: string; tag: string; date: string; recoverable: number; }
interface PmWasteFind { code: string; title: string; tag: string; category: string; annualEvents: number | null; failures12mo: number; }

interface Assessment {
    windowMonths: number;
    totalSpend12mo: number;
    woCount12mo: number;
    assetCount: number;
    badActors: BadActor[];
    paretoShare: { topN: number; pct: number } | null;
    weibull: WeibullFinding[];
    warranty: { total: number; items: WarrantyFind[] };
    pmWaste: PmWasteFind[];
    coverage: { cost_pct: number; failure_code_pct: number; downtime_pct: number };
    dataFrom: string | null;
    dataTo: string | null;
}

async function computeAssessment(): Promise<Assessment> {
    const cutoff12 = new Date(Date.now() - 365 * DAY_MS).toISOString();

    const [woQ, assetQ, pmQ, warrQ, failQ] = await Promise.all([
        supabase.from('work_orders')
            .select('id, asset_id, type, status, created_at, closed_at, frozen_labor_cost, frozen_material_cost, total_actual_cost, actual_downtime_hrs')
            .order('created_at', { ascending: false }).limit(20000),
        supabase.from('assets').select('id, tag, name, criticality').limit(10000),
        supabase.from('recurring_work')
            .select('id, code, title, asset_id, frequency_interval, frequency_unit, job_type, active')
            .eq('active', true).limit(3000),
        supabase.from('warranties')
            .select('id, asset_id, warranty_type, start_date, end_date, deductible, status')
            .eq('status', 'ACTIVE').limit(5000),
        supabase.from('wo_failure_data').select('wo_id').limit(20000),
    ]);

    const wos: WoRow[] = (woQ.data ?? []) as WoRow[];
    const assets: AssetRow[] = (assetQ.data ?? []) as AssetRow[];
    const assetById = new Map(assets.map((a) => [a.id, a]));
    const codedWoIds = new Set((failQ.data ?? []).map((f: { wo_id: string }) => f.wo_id));

    const wos12 = wos.filter((w) => w.created_at >= cutoff12);
    const totalSpend12mo = wos12.reduce((s, w) => s + woCost(w), 0);

    // Bad actors (12-month window, cost-ranked, Pareto)
    const agg = new Map<string, { cost: number; count: number; cm: number; down: number }>();
    for (const w of wos12) {
        if (!w.asset_id) continue;
        const cur = agg.get(w.asset_id) ?? { cost: 0, count: 0, cm: 0, down: 0 };
        cur.cost += woCost(w); cur.count += 1;
        if (isCorrective(w)) cur.cm += 1;
        cur.down += Number(w.actual_downtime_hrs) || 0;
        agg.set(w.asset_id, cur);
    }
    const grand = [...agg.values()].reduce((s, v) => s + v.cost, 0) || 1;
    let cum = 0;
    const badActors: BadActor[] = [...agg.entries()]
        .sort((a, b) => b[1].cost - a[1].cost)
        .slice(0, 10)
        .map(([id, v]) => {
            cum += v.cost;
            const a = assetById.get(id);
            return {
                tag: a?.tag ?? '(unknown)', name: a?.name ?? '(unknown asset)',
                criticality: a?.criticality ?? null,
                cost12mo: Math.round(v.cost), woCount12mo: v.count, cmCount12mo: v.cm,
                downtime12mo: Math.round(v.down), cumulativePct: Math.round((cum / grand) * 1000) / 10,
            };
        });
    const topAt80 = badActors.findIndex((b) => b.cumulativePct >= 80);
    const paretoShare = badActors.length >= 3
        ? { topN: topAt80 >= 0 ? topAt80 + 1 : badActors.length, pct: topAt80 >= 0 ? badActors[topAt80].cumulativePct : badActors[badActors.length - 1].cumulativePct }
        : null;

    // Weibull on the worst corrective-failure assets (full history, censored)
    const failureDatesByAsset = new Map<string, number[]>();
    for (const w of wos) {
        if (!w.asset_id || !isCorrective(w)) continue;
        const arr = failureDatesByAsset.get(w.asset_id) ?? [];
        arr.push(new Date(w.created_at).getTime());
        failureDatesByAsset.set(w.asset_id, arr);
    }
    const weibull: WeibullFinding[] = [];
    const candidates = [...failureDatesByAsset.entries()]
        .filter(([, d]) => d.length >= 3)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 5);
    for (const [assetId, timesMs] of candidates) {
        const sorted = [...timesMs].sort((a, b) => a - b);
        const intervals: number[] = [];
        for (let i = 1; i < sorted.length; i++) {
            const days = (sorted[i] - sorted[i - 1]) / DAY_MS;
            if (days > 0.25) intervals.push(days); // ignore same-day duplicates
        }
        const sinceLast = (Date.now() - sorted[sorted.length - 1]) / DAY_MS;
        const suspensions = sinceLast > 1 ? [sinceLast] : [];
        const fit = fitWeibull(intervals, suspensions);
        if (!fit) continue;
        const a = assetById.get(assetId);
        const b10 = weibullBLife(fit.beta, fit.eta, 10);
        weibull.push({
            tag: a?.tag ?? '(unknown)', name: a?.name ?? '(unknown asset)',
            nFailures: fit.nFailures, nSuspensions: fit.nSuspensions,
            beta: Math.round(fit.beta * 100) / 100, eta: Math.round(fit.eta),
            b10Days: Math.round(b10), r2: Math.round(fit.r2 * 100) / 100,
            interpretation: fit.beta > 1.5 ? 'wear-out — age-based PM is justified'
                : fit.beta > 0.95 ? 'random failures — condition monitoring beats fixed-interval PM'
                    : 'infant mortality — look at installation/maintenance quality, not more PM',
        });
    }

    // Warranty recovery (mirrors the scan_warranty_recovery tool)
    const today = new Date().toISOString().slice(0, 10);
    const warrantiesByAsset = new Map<string, Record<string, unknown>[]>();
    for (const w of (warrQ.data ?? []) as Record<string, unknown>[]) {
        if (w.end_date && String(w.end_date) < today) continue;
        const arr = warrantiesByAsset.get(String(w.asset_id)) ?? [];
        arr.push(w); warrantiesByAsset.set(String(w.asset_id), arr);
    }
    const warrantyItems: WarrantyFind[] = [];
    for (const w of wos) {
        if (!['CLOSED', 'TECO'].includes(String(w.status ?? '').toUpperCase())) continue;
        const cost = woCost(w);
        if (cost <= 0) continue;
        const day = w.created_at.slice(0, 10);
        const cover = (warrantiesByAsset.get(w.asset_id) ?? []).find(
            (c) => day >= String(c.start_date) && (!c.end_date || day <= String(c.end_date)),
        );
        if (!cover) continue;
        const net = Math.max(0, cost - (Number(cover.deductible) || 0));
        if (net <= 0) continue;
        warrantyItems.push({
            woNumber: w.id, tag: assetById.get(w.asset_id)?.tag ?? '(unknown)',
            date: day, recoverable: Math.round(net),
        });
    }
    warrantyItems.sort((a, b) => b.recoverable - a.recoverable);
    const warrantyTotal = warrantyItems.reduce((s, i) => s + i.recoverable, 0);

    // PM waste (mirrors analyze_pm_effectiveness, asset-level)
    const annualEvents = (interval: number, unit: string): number | null => {
        if (!interval || interval <= 0) return null;
        const u = (unit || '').toLowerCase();
        if (u.startsWith('day')) return 365 / interval;
        if (u.startsWith('week')) return 52 / interval;
        if (u.startsWith('month')) return 12 / interval;
        if (u.startsWith('year')) return 1 / interval;
        return null;
    };
    const cmByAsset = new Map<string, number>();
    for (const w of wos12) if (w.asset_id && isCorrective(w)) cmByAsset.set(w.asset_id, (cmByAsset.get(w.asset_id) ?? 0) + 1);
    const pmsByAssetType = new Map<string, number>();
    const pms = (pmQ.data ?? []) as Record<string, unknown>[];
    for (const p of pms) {
        const k = `${p.asset_id}|${p.job_type}`;
        pmsByAssetType.set(k, (pmsByAssetType.get(k) ?? 0) + 1);
    }
    const pmWaste: PmWasteFind[] = pms.map((p) => {
        const annual = annualEvents(Number(p.frequency_interval), String(p.frequency_unit ?? ''));
        const failures = cmByAsset.get(String(p.asset_id)) ?? 0;
        const redundant = (pmsByAssetType.get(`${p.asset_id}|${p.job_type}`) ?? 1) > 1;
        let category = 'ok';
        if (redundant) category = 'redundant';
        else if (failures >= 3) category = 'ineffective';
        else if (annual !== null && annual >= 6 && failures === 0) category = 'over-maintenance';
        const asset = assetById.get(String(p.asset_id));
        return {
            code: String(p.code ?? ''), title: String(p.title ?? ''),
            tag: asset?.tag ?? String(p.asset_id ?? ''), category,
            annualEvents: annual === null ? null : Math.round(annual * 10) / 10,
            failures12mo: failures,
        };
    }).filter((o) => o.category !== 'ok').slice(0, 10);

    // Coverage + data window
    const n12 = wos12.length || 1;
    let from: string | null = null, to: string | null = null;
    for (const w of wos) {
        if (!from || w.created_at < from) from = w.created_at;
        if (!to || w.created_at > to) to = w.created_at;
    }
    const windowMonths = from && to ? Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / (30.44 * DAY_MS))) : 0;

    return {
        windowMonths,
        totalSpend12mo: Math.round(totalSpend12mo),
        woCount12mo: wos12.length,
        assetCount: assets.length,
        badActors,
        paretoShare,
        weibull,
        warranty: { total: warrantyTotal, items: warrantyItems.slice(0, 8) },
        pmWaste,
        coverage: {
            cost_pct: Math.round((wos12.filter((w) => woCost(w) > 0).length / n12) * 100),
            failure_code_pct: Math.round((wos12.filter((w) => codedWoIds.has(w.id)).length / n12) * 100),
            downtime_pct: Math.round((wos12.filter((w) => Number(w.actual_downtime_hrs) > 0).length / n12) * 100),
        },
        dataFrom: from ? from.slice(0, 10) : null,
        dataTo: to ? to.slice(0, 10) : null,
    };
}

// ── page ──────────────────────────────────────────────────────────────────
export const AssessmentReportPage: React.FC = () => {
    const navigate = useNavigate();
    const { formatCurrency } = useSettings();
    const [assessment, setAssessment] = useState<Assessment | null>(null);
    const [narrative, setNarrative] = useState<string>('');
    const [narrating, setNarrating] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = async () => {
        setLoading(true); setError(null);
        try {
            const a = await computeAssessment();
            setAssessment(a);
            setLoading(false);
            // Narrative is additive — the numbers stand alone if the LLM is unavailable.
            setNarrating(true);
            try {
                const res = await runAssessmentNarrator({
                    window_months: a.windowMonths,
                    total_spend_12mo: a.totalSpend12mo,
                    wo_count_12mo: a.woCount12mo,
                    asset_count: a.assetCount,
                    pareto: a.paretoShare,
                    bad_actors: a.badActors.slice(0, 5),
                    weibull_findings: a.weibull,
                    warranty_recoverable_total: a.warranty.total,
                    warranty_top_items: a.warranty.items.slice(0, 3),
                    pm_waste: a.pmWaste.slice(0, 5),
                    data_coverage: a.coverage,
                });
                setNarrative(res.answer);
            } catch {
                setNarrative('');
            } finally {
                setNarrating(false);
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setLoading(false);
        }
    };
    useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

    const totalOpportunity = useMemo(() => (assessment ? assessment.warranty.total : 0), [assessment]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-32 gap-3 text-slate-500">
                <Loader2 size={28} className="animate-spin text-violet-500" />
                <p className="text-sm">Your Specialist is running the assessment — Pareto, Weibull, PM and warranty analysis…</p>
            </div>
        );
    }
    if (error || !assessment) {
        return (
            <div className="max-w-xl mx-auto mt-20 rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-800 text-sm flex gap-2">
                <AlertTriangle size={18} className="shrink-0" /> {error ?? 'No data available for an assessment yet.'}
            </div>
        );
    }
    const a = assessment;

    const Section: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 print:border-0 print:p-0 print:mb-6 break-inside-avoid">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800 uppercase tracking-wide mb-4">{icon}{title}</h2>
            {children}
        </section>
    );
    const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
        <p className="text-sm text-slate-400 italic">{children}</p>
    );

    return (
        <>
            <style>{`
                @media print {
                    body { background: #fff !important; }
                    .no-print { display: none !important; }
                    aside, nav, header.app-header { display: none !important; }
                }
            `}</style>

            <div className="no-print flex items-center justify-between mb-5">
                <button onClick={() => navigate('/specialist')} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
                    <ArrowLeft size={15} /> Specialist workspace
                </button>
                <div className="flex items-center gap-2">
                    <button onClick={() => void load()} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-medium px-3 py-2">
                        <RefreshCw size={13} /> Recompute
                    </button>
                    <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold px-4 py-2">
                        <Printer size={13} /> Print / PDF
                    </button>
                </div>
            </div>

            <div className="max-w-4xl mx-auto space-y-5 pb-24">
                {/* Cover */}
                <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-600 to-indigo-700 text-white p-8 print:rounded-none">
                    <p className="text-violet-200 text-xs font-bold uppercase tracking-widest">Reliability Assessment</p>
                    <h1 className="text-2xl md:text-3xl font-bold mt-1">Your Reliability Specialist's findings</h1>
                    <p className="text-violet-100 text-sm mt-2">
                        {a.dataFrom && a.dataTo ? <>Based on {a.woCount12mo.toLocaleString()} work orders (trailing 12 months) across {a.assetCount.toLocaleString()} assets · full history {a.dataFrom} → {a.dataTo}</> : 'No work-order history found.'}
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                        {[
                            { label: 'Maintenance spend (12 mo)', value: formatCurrency(a.totalSpend12mo) },
                            { label: 'Work orders (12 mo)', value: a.woCount12mo.toLocaleString() },
                            { label: a.paretoShare ? `Top ${a.paretoShare.topN} assets drive` : 'Cost concentration', value: a.paretoShare ? `${a.paretoShare.pct}%` : '—' },
                            { label: 'Recoverable found', value: totalOpportunity > 0 ? formatCurrency(totalOpportunity) : '—' },
                        ].map((s) => (
                            <div key={s.label}>
                                <div className="text-xl md:text-2xl font-bold">{s.value}</div>
                                <div className="text-[11px] text-violet-200 mt-0.5">{s.label}</div>
                            </div>
                        ))}
                    </div>
                    <p className="text-[10px] text-violet-300 mt-5">
                        IRAMS · Reliability Specialist by Relantern — every figure computed deterministically from your records; nothing estimated by AI.
                    </p>
                </div>

                {/* Executive summary */}
                <Section icon={<Sparkles size={15} className="text-violet-600" />} title="Executive summary">
                    {narrating
                        ? <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" /> The Specialist is writing the summary…</p>
                        : narrative
                            ? <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{narrative}</div>
                            : <Empty>Narrative unavailable — the findings below stand on their own.</Empty>}
                </Section>

                {/* Bad actors */}
                <Section icon={<TrendingDown size={15} className="text-rose-500" />} title="Where the money is going — bad actors (12 months)">
                    {a.badActors.length === 0 ? <Empty>No costed work-order history in the last 12 months.</Empty> : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-200">
                                        <th className="py-2 pr-3">#</th><th className="py-2 pr-3">Asset</th><th className="py-2 pr-3">Crit.</th>
                                        <th className="py-2 pr-3 text-right">Cost</th><th className="py-2 pr-3 text-right">WOs</th>
                                        <th className="py-2 pr-3 text-right">Failures</th><th className="py-2 pr-3 text-right">Downtime (h)</th>
                                        <th className="py-2 text-right">Cum. %</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {a.badActors.map((b, i) => (
                                        <tr key={b.tag} className="border-b border-slate-100">
                                            <td className="py-2 pr-3 text-slate-400">{i + 1}</td>
                                            <td className="py-2 pr-3"><span className="font-semibold text-slate-800">{b.tag}</span> <span className="text-slate-400 text-xs">{b.name}</span></td>
                                            <td className="py-2 pr-3">{b.criticality ?? '—'}</td>
                                            <td className="py-2 pr-3 text-right font-mono font-semibold text-slate-800">{formatCurrency(b.cost12mo)}</td>
                                            <td className="py-2 pr-3 text-right">{b.woCount12mo}</td>
                                            <td className="py-2 pr-3 text-right">{b.cmCount12mo}</td>
                                            <td className="py-2 pr-3 text-right">{b.downtime12mo || '—'}</td>
                                            <td className="py-2 text-right text-slate-500">{b.cumulativePct}%</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Section>

                {/* Weibull */}
                <Section icon={<Activity size={15} className="text-indigo-500" />} title="Failure behaviour — Weibull analysis (censored, full history)">
                    {a.weibull.length === 0 ? <Empty>Not enough repeated corrective failures on any single asset for a statistically meaningful fit (needs ≥3). This unlocks as history accumulates.</Empty> : (
                        <div className="space-y-3">
                            {a.weibull.map((w) => (
                                <div key={w.tag} className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3">
                                    <div className="min-w-[10rem]">
                                        <div className="font-semibold text-slate-800 text-sm">{w.tag}</div>
                                        <div className="text-xs text-slate-400">{w.nFailures} failures · {w.nSuspensions ? 'censored' : 'uncensored'} · R²={w.r2}</div>
                                    </div>
                                    <div className="text-xs text-slate-600">β <span className="font-mono font-bold text-slate-800">{w.beta}</span></div>
                                    <div className="text-xs text-slate-600">η <span className="font-mono font-bold text-slate-800">{w.eta}d</span></div>
                                    <div className="text-xs text-slate-600">B10 <span className="font-mono font-bold text-slate-800">{w.b10Days}d</span></div>
                                    <div className="text-xs text-slate-500 italic flex-1 min-w-[14rem]">{w.interpretation}</div>
                                </div>
                            ))}
                            <p className="text-[11px] text-slate-400">β&gt;1: failure probability grows with age (PM helps). β≈1: random (monitor, don't over-PM). β&lt;1: early-life failures (fix quality, not frequency). B10 = age by which 10% of units fail — a defensible PM-interval basis.</p>
                        </div>
                    )}
                </Section>

                {/* Warranty */}
                <Section icon={<BadgeDollarSign size={15} className="text-emerald-600" />} title="Money on the table — warranty recovery">
                    {a.warranty.total === 0 ? <Empty>No completed work fell inside an active warranty window (or no warranty records exist in the data provided).</Empty> : (
                        <div className="space-y-2">
                            <p className="text-sm text-slate-700">
                                <span className="font-bold text-emerald-700 text-lg">{formatCurrency(a.warranty.total)}</span> of completed maintenance was performed while equipment was under active warranty — candidate OEM/vendor claims.
                            </p>
                            <div className="flex flex-wrap gap-2">
                                {a.warranty.items.map((i) => (
                                    <span key={i.woNumber} className="text-xs bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-2 py-1">
                                        {i.tag} · {i.date} · <span className="font-mono font-semibold">{formatCurrency(i.recoverable)}</span>
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </Section>

                {/* PM waste */}
                <Section icon={<Wrench size={15} className="text-amber-500" />} title="PM programme health">
                    {a.pmWaste.length === 0 ? <Empty>No active PM programmes flagged (or no PM programme data in scope — imported histories usually arrive without PM definitions; connect or rebuild the PM plan to unlock this).</Empty> : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-200">
                                        <th className="py-2 pr-3">PM</th><th className="py-2 pr-3">Asset</th>
                                        <th className="py-2 pr-3">Finding</th><th className="py-2 pr-3 text-right">PMs/yr</th><th className="py-2 text-right">Failures 12 mo</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {a.pmWaste.map((p) => (
                                        <tr key={p.code + p.tag} className="border-b border-slate-100">
                                            <td className="py-2 pr-3"><span className="font-semibold text-slate-700">{p.code}</span> <span className="text-slate-400 text-xs">{p.title}</span></td>
                                            <td className="py-2 pr-3">{p.tag}</td>
                                            <td className="py-2 pr-3"><span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full ${p.category === 'ineffective' ? 'bg-rose-50 text-rose-600' : p.category === 'redundant' ? 'bg-indigo-50 text-indigo-600' : 'bg-amber-50 text-amber-600'}`}>{p.category}</span></td>
                                            <td className="py-2 pr-3 text-right font-mono">{p.annualEvents ?? '—'}</td>
                                            <td className="py-2 text-right font-mono">{p.failures12mo}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Section>

                {/* Data quality */}
                <Section icon={<Database size={15} className="text-slate-500" />} title="Data quality — what this assessment rests on">
                    <div className="grid grid-cols-3 gap-3 mb-3">
                        {[
                            { label: 'WOs with cost data', pct: a.coverage.cost_pct },
                            { label: 'With failure coding', pct: a.coverage.failure_code_pct },
                            { label: 'With downtime hours', pct: a.coverage.downtime_pct },
                        ].map((c) => (
                            <div key={c.label} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-center">
                                <div className={`text-xl font-bold ${c.pct >= 60 ? 'text-emerald-600' : c.pct >= 30 ? 'text-amber-500' : 'text-rose-500'}`}>{c.pct}%</div>
                                <div className="text-[11px] text-slate-500 mt-0.5">{c.label}</div>
                            </div>
                        ))}
                    </div>
                    <p className="text-xs text-slate-500">
                        Higher coverage sharpens every finding above. The fastest upgrades, in order of value: cost data on work orders (money-ranks everything), failure coding (unlocks failure-mode analysis and RCM), downtime hours (converts availability into money).
                    </p>
                </Section>

                <p className="text-[10px] text-slate-400 text-center flex items-center justify-center gap-1.5">
                    <ShieldCheck size={11} /> Methodology: Pareto on frozen WO costs · median-rank regression Weibull with Johnson-adjusted ranks and right-censoring · PM effectiveness vs corrective history · warranty windows vs completed WOs. Advisory only — a human approves every action.
                </p>
            </div>
        </>
    );
};

export default AssessmentReportPage;
