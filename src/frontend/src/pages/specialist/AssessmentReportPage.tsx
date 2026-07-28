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
    Layers, FolderPlus, Check,
} from 'lucide-react';
import { supabase } from '../../eam/lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useSettings } from '../../contexts/SettingsContext';
import { fitWeibull, weibullBLife } from '../../eam/utils/weibull';
import { runAssessmentNarrator } from '../../eam/services/agentRunClient';
import { computeRegisterQuality, type RegisterQuality } from '../../lib/registerQuality';
import {
    getLatestSnapshot, saveSnapshot, shouldSaveSnapshot, type AssessmentSnapshot,
} from '../../eam/services/assessmentSnapshotService';
import { analyzeService } from '../../eam/services/AnalyzeService';
import BriefingReport, { type BriefingAsset } from '../../components/specialist/BriefingReport';
import PmOptimizationModal from '../../components/specialist/PmOptimizationModal';

// ── row shapes (only the columns we query) ────────────────────────────────
interface WoRow {
    id: string; asset_id: string; type: string | null; status: string | null;
    created_at: string; closed_at: string | null;
    frozen_labor_cost: number | null; frozen_material_cost: number | null;
    total_actual_cost: number | null; actual_downtime_hrs: number | null;
}
interface AssetRow {
    id: string; tag: string; name: string; criticality: string | null;
    parent_id: string | null; manufacturer: string | null; model: string | null;
}

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
    assetId: string; tag: string; name: string; nFailures: number; nSuspensions: number;
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
    register: RegisterQuality;
    /** id/tag/name/criticality for entity-linking the narrative's asset tags. */
    assetIndex: { id: string; tag: string; name: string; criticality: string | null }[];
    dataFrom: string | null;
    dataTo: string | null;
}

async function computeAssessment(): Promise<Assessment> {
    const cutoff12 = new Date(Date.now() - 365 * DAY_MS).toISOString();

    const [woQ, assetQ, pmQ, warrQ, failQ] = await Promise.all([
        supabase.from('work_orders')
            .select('id, asset_id, type, status, created_at, closed_at, frozen_labor_cost, frozen_material_cost, total_actual_cost, actual_downtime_hrs')
            .order('created_at', { ascending: false }).limit(20000),
        supabase.from('assets').select('id, tag, name, criticality, parent_id, manufacturer, model').limit(10000),
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
            assetId, tag: a?.tag ?? '(unknown)', name: a?.name ?? '(unknown asset)',
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

    // Asset-register quality (Phase A2) — the foundation layer a human RE
    // audits first; computed from rows already fetched above.
    const register = computeRegisterQuality(
        assets,
        wos12.map((w) => ({ asset_id: w.asset_id })),
        new Set(assetById.keys()),
    );

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
        register,
        assetIndex: assets.map((x) => ({ id: x.id, tag: x.tag, name: x.name, criticality: x.criticality })),
        dataFrom: from ? from.slice(0, 10) : null,
        dataTo: to ? to.slice(0, 10) : null,
    };
}

// ── page ──────────────────────────────────────────────────────────────────
export const AssessmentReportPage: React.FC = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { formatCurrency } = useSettings();
    const [assessment, setAssessment] = useState<Assessment | null>(null);
    const [narrative, setNarrative] = useState<string>('');
    const [narrating, setNarrating] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    // Trend record (Phase A1): the previous snapshot this run is compared against.
    const [previous, setPrevious] = useState<AssessmentSnapshot | null>(null);
    const [snapshotSaved, setSnapshotSaved] = useState(false);
    // Findings → studies (Phase A4)
    const [savingStudy, setSavingStudy] = useState<string | null>(null);
    const [savedStudies, setSavedStudies] = useState<Set<string>>(new Set());
    // Fleet-wide PM optimization (Phase B3) — process lives in the popup.
    const [pmOptOpen, setPmOptOpen] = useState(false);

    const load = async () => {
        setLoading(true); setError(null); setSnapshotSaved(false);
        try {
            const [a, prev] = await Promise.all([computeAssessment(), getLatestSnapshot()]);
            setAssessment(a);
            setPrevious(prev);
            setLoading(false);
            // Narrative is additive — the numbers stand alone if the LLM is unavailable.
            setNarrating(true);
            let prose = '';
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
                    register_quality: {
                        health_pct: a.register.healthPct,
                        structured_pct: a.register.structuredPct,
                        criticality_spread_pct: a.register.criticalitySpreadPct,
                        nameplate_pct: a.register.nameplatePct,
                        tag_collisions: a.register.tagCollisionCount,
                    },
                });
                prose = res.answer;
                setNarrative(prose);
            } catch {
                setNarrative('');
            } finally {
                setNarrating(false);
            }
            // Persist the run (append-only, ≤ one per 12h) so a trend record
            // exists — the before/after story the whole sale rests on.
            if ((a.woCount12mo > 0 || a.assetCount > 0) && shouldSaveSnapshot(prev, Date.now())) {
                const saved = await saveSnapshot({
                    created_by: user?.username ?? user?.id ?? null,
                    total_spend_12mo: a.totalSpend12mo,
                    wo_count_12mo: a.woCount12mo,
                    asset_count: a.assetCount,
                    warranty_recoverable: a.warranty.total,
                    pm_flag_count: a.pmWaste.length,
                    coverage_cost_pct: a.coverage.cost_pct,
                    coverage_failure_pct: a.coverage.failure_code_pct,
                    coverage_downtime_pct: a.coverage.downtime_pct,
                    register_health_pct: a.register.healthPct,
                    findings: a as unknown as Record<string, unknown>,
                    narrative: prose || null,
                });
                setSnapshotSaved(saved !== null);
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setLoading(false);
        }
    };
    useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

    /** One click: an assessment Weibull finding becomes a governed study +
     *  versioned analysis in the reliability tier (Phase A4). */
    const saveAsStudy = async (w: WeibullFinding) => {
        setSavingStudy(w.tag);
        try {
            const today = new Date().toISOString().slice(0, 10);
            const study = await analyzeService.createReliabilityStudy({
                name: `Weibull — ${w.tag} (assessment ${today})`,
                asset_id: w.assetId, asset_tag: w.tag, asset_name: w.name,
                description: `Opened from the Specialist assessment of ${today}: ${w.interpretation}`,
                created_by: user?.username ?? user?.id ?? null,
            });
            if (!study) return;
            await analyzeService.saveReliabilityAnalysis({
                study_id: study.id, asset_id: w.assetId, asset_tag: w.tag, asset_name: w.name,
                analysis_type: 'weibull',
                title: `Censored Weibull fit — ${w.tag}`,
                inputs: { source: 'specialist_assessment', n_failures: w.nFailures, n_suspensions: w.nSuspensions },
                results: { beta: w.beta, eta_days: w.eta, b10_days: w.b10Days, r2: w.r2, interpretation: w.interpretation },
                notes: 'Fit computed deterministically by the Reliability Specialist assessment (median-rank regression, right-censored).',
                created_by: user?.username ?? user?.id ?? null,
            });
            setSavedStudies((s) => new Set(s).add(w.tag));
        } finally {
            setSavingStudy(null);
        }
    };

    const totalOpportunity = useMemo(() => (assessment ? assessment.warranty.total : 0), [assessment]);

    /** Register tags → entity chips inside the executive summary. */
    const assetsByTag = useMemo(() => new Map<string, BriefingAsset>(
        (assessment?.assetIndex ?? []).map((x) => [x.tag.toLowerCase(), x]),
    ), [assessment]);

    /** Run-over-run delta chip. `goodWhenDown` colours direction (spend); others stay neutral. */
    const deltaChip = (cur: number, prev: number | null | undefined, fmt: (n: number) => string, goodWhenDown = false) => {
        if (prev == null) return null;
        const d = cur - Number(prev);
        if (d === 0) return <span className="text-slate-300">— unchanged</span>;
        const up = d > 0;
        const colour = goodWhenDown ? (up ? 'text-rose-500' : 'text-emerald-600') : 'text-slate-400';
        return <span className={`${colour} font-medium`}>{up ? '▲' : '▼'} {fmt(Math.abs(d))}</span>;
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-32 gap-3 text-slate-500">
                <Loader2 size={28} className="animate-spin text-primary-600" />
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
                    <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold px-4 py-2">
                        <Printer size={13} /> Print / PDF
                    </button>
                </div>
            </div>

            <div className="max-w-4xl mx-auto space-y-5 pb-24">
                {/* Cover */}
                {/* Cover — white and ink-light so it prints like a consulting
                    report rather than a brochure; the blue rule does the branding. */}
                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden print:rounded-none print:border-0">
                    <div className="h-1 bg-primary-600 print:hidden" />
                    <div className="p-6 sm:p-8">
                        <p className="text-primary-700 text-[11px] font-bold uppercase tracking-[0.12em]">Reliability Assessment</p>
                        <h1 className="text-xl sm:text-2xl md:text-3xl font-semibold text-slate-900 tracking-tight mt-1.5">
                            Your Reliability Specialist's findings
                        </h1>
                        <p className="text-[13px] text-slate-500 mt-2 leading-relaxed">
                            {a.dataFrom && a.dataTo ? <>Based on {a.woCount12mo.toLocaleString()} work orders (trailing 12 months) across {a.assetCount.toLocaleString()} assets · full history {a.dataFrom} → {a.dataTo}</> : 'No work-order history found.'}
                        </p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-px mt-6 bg-slate-200 border border-slate-200 rounded-lg overflow-hidden">
                            {[
                                {
                                    label: 'Maintenance spend (12 mo)', value: formatCurrency(a.totalSpend12mo),
                                    delta: deltaChip(a.totalSpend12mo, previous?.total_spend_12mo, formatCurrency, true),
                                },
                                {
                                    label: 'Work orders (12 mo)', value: a.woCount12mo.toLocaleString(),
                                    delta: deltaChip(a.woCount12mo, previous?.wo_count_12mo, (n) => n.toLocaleString()),
                                },
                                { label: a.paretoShare ? `Top ${a.paretoShare.topN} assets drive` : 'Cost concentration', value: a.paretoShare ? `${a.paretoShare.pct}%` : '—', delta: null },
                                {
                                    label: 'Recoverable found', value: totalOpportunity > 0 ? formatCurrency(totalOpportunity) : '—',
                                    delta: deltaChip(totalOpportunity, previous?.warranty_recoverable, formatCurrency),
                                },
                            ].map((s) => (
                                <div key={s.label} className="bg-white p-3.5">
                                    <div className="text-lg md:text-2xl font-semibold text-slate-900 tabular-nums tracking-tight">{s.value}</div>
                                    <div className="text-[10.5px] text-slate-400 mt-1 leading-tight">{s.label}</div>
                                    {s.delta && <div className="text-[10px] mt-1 tabular-nums">{s.delta}</div>}
                                </div>
                            ))}
                        </div>
                        <p className="text-[10.5px] text-slate-400 mt-5 leading-relaxed">
                            IRAMS · Reliability Specialist by Relantern — every figure computed deterministically from your records; nothing estimated by AI.
                            {previous && <> Deltas compare with the assessment of {new Date(previous.created_at).toLocaleDateString()}.</>}
                            {snapshotSaved && <> This run has been added to the trend record.</>}
                        </p>
                    </div>
                </div>

                {/* Executive summary — same interactive treatment as the briefing:
                    sections, asset-tag chips, "Act this month" as guided missions. */}
                <Section icon={<Sparkles size={15} className="text-primary-600" />} title="Executive summary">
                    {narrating
                        ? <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" /> The Specialist is writing the summary…</p>
                        : narrative
                            ? <BriefingReport
                                text={narrative}
                                briefingKey={`assessment:${a.dataTo ?? 'na'}`}
                                assetsByTag={assetsByTag}
                            />
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
                                    <div className="no-print shrink-0">
                                        {savedStudies.has(w.tag) ? (
                                            <button onClick={() => navigate('/analyze')}
                                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-800">
                                                <Check size={12} /> In studies
                                            </button>
                                        ) : (
                                            <button onClick={() => void saveAsStudy(w)} disabled={savingStudy !== null}
                                                title="Persist this fit as a governed reliability study (Analyze › Reliability Modelling)"
                                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-[11px] font-semibold px-2 py-1 disabled:opacity-50">
                                                {savingStudy === w.tag ? <Loader2 size={12} className="animate-spin" /> : <FolderPlus size={12} />} Save as study
                                            </button>
                                        )}
                                    </div>
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
                    <div className="no-print mb-3">
                        <button onClick={() => setPmOptOpen(true)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-700 text-[12px] font-semibold px-3 py-1.5 transition-colors">
                            <Wrench size={13} /> Optimize the whole fleet — every active PM vs its failure history
                        </button>
                    </div>
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

                {/* Asset register quality (Phase A2) */}
                <Section icon={<Layers size={15} className="text-sky-600" />} title="Asset register quality — the foundation layer">
                    <div className="flex flex-col sm:flex-row gap-3 mb-3">
                        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 text-center sm:w-40 shrink-0 flex flex-col justify-center">
                            <div className={`text-3xl font-bold ${a.register.healthPct >= 70 ? 'text-emerald-600' : a.register.healthPct >= 40 ? 'text-amber-500' : 'text-rose-500'}`}>
                                {a.register.healthPct}%
                            </div>
                            <div className="text-[11px] text-slate-500 mt-1">register health</div>
                            {previous?.register_health_pct != null && (
                                <div className="text-[10px] mt-1 tabular-nums">
                                    {deltaChip(a.register.healthPct, previous.register_health_pct, (n) => `${n} pts`)}
                                </div>
                            )}
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-1">
                            {[
                                { label: 'Hierarchy structured', pct: a.register.structuredPct, hint: 'assets under a parent' },
                                { label: 'Criticality spread', pct: a.register.criticalitySpreadPct, hint: a.register.dominantCriticality ? `${a.register.dominantCriticality.pct}% sit in class ${a.register.dominantCriticality.value}` : '' },
                                { label: 'Nameplate complete', pct: a.register.nameplatePct, hint: 'manufacturer + model' },
                                { label: 'History linked', pct: a.register.woLinkedPct, hint: `${a.register.woUnlinkedCount} WOs unlinked` },
                            ].map((c) => (
                                <div key={c.label} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-center">
                                    <div className={`text-xl font-bold ${c.pct >= 60 ? 'text-emerald-600' : c.pct >= 30 ? 'text-amber-500' : 'text-rose-500'}`}>{c.pct}%</div>
                                    <div className="text-[11px] text-slate-500 mt-0.5">{c.label}</div>
                                    {c.hint && <div className="text-[10px] text-slate-400 mt-0.5">{c.hint}</div>}
                                </div>
                            ))}
                        </div>
                    </div>
                    {a.register.tagCollisionCount > 0 && (
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
                            {a.register.tagCollisionCount} tag collision{a.register.tagCollisionCount === 1 ? '' : 's'} — one physical asset's history split across rows
                            (e.g. {a.register.tagCollisionExamples[0]?.join(' / ')}). Merging these sharpens every per-asset figure above.
                        </p>
                    )}
                    <p className="text-xs text-slate-500">
                        A register that is flat, uniformly ranked or missing nameplates degrades every analysis downstream — it is the first
                        thing a reliability engineer fixes on arrival. Fix order: hierarchy (Migration Center asset template), criticality
                        ranking (a uniform class usually means imported defaults, not an assessment), then nameplate data for parts and warranty work.
                    </p>
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

                <PmOptimizationModal open={pmOptOpen} onClose={() => setPmOptOpen(false)} />

                <p className="text-[10px] text-slate-400 text-center flex items-center justify-center gap-1.5">
                    <ShieldCheck size={11} /> Methodology: Pareto on frozen WO costs · median-rank regression Weibull with Johnson-adjusted ranks and right-censoring · PM effectiveness vs corrective history · warranty windows vs completed WOs · register hygiene scored on hierarchy, criticality spread, nameplate, tag collisions and history linkage. Advisory only — a human approves every action.
                </p>
            </div>
        </>
    );
};

export default AssessmentReportPage;
