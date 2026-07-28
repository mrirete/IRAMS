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
    Layers, FolderPlus, Check, Route, SendHorizonal,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useSettings } from '../../contexts/SettingsContext';
import { runAssessmentNarrator } from '../../eam/services/agentRunClient';
import { computeAssessment, type Assessment, type WeibullFinding } from '../../eam/services/assessmentEngine';
import type { StrategyVerdict, StrategyRegime } from '../../lib/strategySelect';
import { predictionService } from '../../eam/services/PredictionService';
import {
    getLatestSnapshot, saveSnapshot, shouldSaveSnapshot, type AssessmentSnapshot,
} from '../../eam/services/assessmentSnapshotService';
import { analyzeService } from '../../eam/services/AnalyzeService';
import BriefingReport, { type BriefingAsset } from '../../components/specialist/BriefingReport';
import PmOptimizationModal from '../../components/specialist/PmOptimizationModal';
import AreaAssessmentModal from '../../components/specialist/AreaAssessmentModal';

// ── page (engine lives in eam/services/assessmentEngine) ──────────────────────────────────────────────────────────────────
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
    // Area assessment (Phase B2) — same engine, one subtree, saved as a study.
    const [areaOpen, setAreaOpen] = useState(false);
    // Strategy gaps → proposals queue (Phase D1)
    const [draftingStrategy, setDraftingStrategy] = useState<string | null>(null);
    const [draftedStrategies, setDraftedStrategies] = useState<Set<string>>(new Set());

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
                    strategy: {
                        critical_coverage_pct: a.strategy.coveragePct,
                        criticals_covered: `${a.strategy.criticalCovered}/${a.strategy.criticalTotal}`,
                        top_gaps: a.strategy.gaps.slice(0, 3).map((g) => ({
                            tag: g.tag, criticality: g.criticality, recommended: g.recommended,
                        })),
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
                    strategy_coverage_pct: a.strategy.coveragePct,
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

    /** A strategy gap becomes a governed proposal (same loop as everything). */
    const draftStrategyProposal = async (v: StrategyVerdict) => {
        setDraftingStrategy(v.assetId);
        try {
            const isDe = v.recommended === 'defect_elimination';
            const created = await predictionService.createAgentAction({
                agent_type: 'strategy_engine' as never,
                trigger_id: 'assessment',
                asset_id: v.assetId,
                action_type: (isDe ? 'draft_de_task' : 'draft_pm_interval') as never,
                status: 'pending_review' as never,
                draft_payload: isDe
                    ? {
                        asset_id: v.assetId, asset_tag: v.tag,
                        title: `Defect elimination — ${v.tag} (infant-mortality pattern)`,
                        root_cause_summary: v.basis,
                        proposed_solution: 'Review recent installation/maintenance quality on this asset before adding any PM frequency.',
                        annual_cost: v.cmCost12mo, estimated_savings: 0,
                        priority: v.criticality === 'A' ? 'HIGH' : 'MEDIUM',
                        created_by: 'strategy_engine',
                    }
                    : {
                        asset_id: v.assetId, asset_tag: v.tag,
                        recommendation_type: v.recommended === 'fixed_interval' ? 'set_interval' : 'condition_monitoring',
                        recommended_interval_days: v.recommendedIntervalDays,
                        basis: v.basis,
                        current_pm_code: null,
                        created_by: 'strategy_engine',
                    },
            });
            if (created) setDraftedStrategies((s) => new Set(s).add(v.assetId));
        } finally {
            setDraftingStrategy(null);
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
                    <button onClick={() => setAreaOpen(true)} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-medium px-3 py-2">
                        <Layers size={13} /> Assess an area
                    </button>
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

                {/* Maintenance strategy (Phase D1/D2) */}
                <Section icon={<Route size={15} className="text-violet-600" />} title="Maintenance strategy — every asset a deliberate regime">
                    {(() => {
                        const st = a.strategy;
                        const REGIME_META: Record<StrategyRegime, { label: string; cls: string }> = {
                            run_to_failure: { label: 'RTF', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
                            fixed_interval: { label: 'age-based PM', cls: 'bg-primary-50 text-primary-700 border-primary-200' },
                            condition_based: { label: 'CBM', cls: 'bg-sky-50 text-sky-600 border-sky-200' },
                            defect_elimination: { label: 'DE first', cls: 'bg-rose-50 text-rose-600 border-rose-200' },
                            rcm_study: { label: 'RCM study', cls: 'bg-violet-50 text-violet-600 border-violet-200' },
                        };
                        const dist = st.verdicts.reduce<Record<string, number>>((acc, v) => {
                            acc[v.recommended] = (acc[v.recommended] ?? 0) + 1; return acc;
                        }, {});
                        return (
                            <>
                                <div className="flex flex-col sm:flex-row gap-3 mb-4">
                                    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 text-center sm:w-44 shrink-0 flex flex-col justify-center">
                                        <div className={`text-3xl font-bold ${st.coveragePct >= 95 ? 'text-emerald-600' : st.coveragePct >= 60 ? 'text-amber-500' : 'text-rose-500'}`}>
                                            {st.coveragePct}%
                                        </div>
                                        <div className="text-[11px] text-slate-500 mt-1">critical assets covered</div>
                                        <div className="text-[10px] text-slate-400 mt-0.5">{st.criticalCovered}/{st.criticalTotal} A/B assets · world-class ≥95%</div>
                                        {previous?.strategy_coverage_pct != null && (
                                            <div className="text-[10px] mt-1 tabular-nums">{deltaChip(st.coveragePct, previous.strategy_coverage_pct, (n) => `${n} pts`)}</div>
                                        )}
                                    </div>
                                    <div className="flex-1">
                                        <div className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-slate-400 mb-1.5">Recommended regimes across {st.verdicts.length} assets</div>
                                        <div className="flex flex-wrap gap-1.5">
                                            {(Object.keys(REGIME_META) as StrategyRegime[]).filter((k) => dist[k]).map((k) => (
                                                <span key={k} className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold ${REGIME_META[k].cls}`}>
                                                    {REGIME_META[k].label} <span className="tabular-nums font-bold">{dist[k]}</span>
                                                </span>
                                            ))}
                                        </div>
                                        <p className="text-xs text-slate-500 mt-2.5 leading-relaxed">
                                            Each asset's regime is derived from criticality × failure behaviour (censored Weibull where ≥3 events) × monitorability.
                                            Deliberate run-to-failure counts as a strategy once recorded — a decision, not a gap.
                                        </p>
                                    </div>
                                </div>
                                {st.gaps.length === 0 ? (
                                    <Empty>No misaligned critical assets — every A/B asset's current state matches its recommended regime.</Empty>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <div className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-slate-400 mb-1.5">Strategy gaps on critical assets — worst first</div>
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-200">
                                                    <th className="py-2 pr-3">Asset</th><th className="py-2 pr-3">Crit.</th>
                                                    <th className="py-2 pr-3">Today</th><th className="py-2 pr-3">Recommended</th>
                                                    <th className="py-2 pr-3">Why</th><th className="py-2 no-print" />
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {st.gaps.slice(0, 8).map((v) => {
                                                    const meta = REGIME_META[v.recommended];
                                                    const draftable = v.recommended === 'fixed_interval' || v.recommended === 'condition_based' || v.recommended === 'defect_elimination';
                                                    return (
                                                        <tr key={v.assetId} className="border-b border-slate-100 align-top">
                                                            <td className="py-2 pr-3"><span className="font-mono font-semibold text-slate-800">{v.tag}</span></td>
                                                            <td className="py-2 pr-3">{v.criticality ?? '—'}</td>
                                                            <td className="py-2 pr-3 text-[11px] text-slate-500 whitespace-nowrap">
                                                                {v.hasActivePm ? 'PM ✓' : 'no PM'} · {v.isMonitored ? 'monitored ✓' : 'no monitoring'}
                                                            </td>
                                                            <td className="py-2 pr-3">
                                                                <span className={`inline-block rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase ${meta.cls}`}>
                                                                    {meta.label}{v.recommendedIntervalDays ? ` ${v.recommendedIntervalDays}d` : ''}
                                                                </span>
                                                            </td>
                                                            <td className="py-2 pr-3 text-[11.5px] text-slate-500 leading-relaxed max-w-md">{v.basis}</td>
                                                            <td className="py-2 no-print">
                                                                {draftable && (draftedStrategies.has(v.assetId) ? (
                                                                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700"><Check size={12} /> Queued</span>
                                                                ) : (
                                                                    <button onClick={() => void draftStrategyProposal(v)} disabled={draftingStrategy !== null}
                                                                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white hover:border-primary-300 hover:text-primary-700 text-slate-500 text-[11px] font-semibold px-2 h-7 disabled:opacity-45 transition-colors">
                                                                        {draftingStrategy === v.assetId ? <Loader2 size={12} className="animate-spin" /> : <SendHorizonal size={12} />} Draft
                                                                    </button>
                                                                ))}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </>
                        );
                    })()}
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
                <AreaAssessmentModal open={areaOpen} onClose={() => setAreaOpen(false)} />

                <p className="text-[10px] text-slate-400 text-center flex items-center justify-center gap-1.5">
                    <ShieldCheck size={11} /> Methodology: Pareto on frozen WO costs · median-rank regression Weibull with Johnson-adjusted ranks and right-censoring · PM effectiveness vs corrective history · warranty windows vs completed WOs · register hygiene scored on hierarchy, criticality spread, nameplate, tag collisions and history linkage. Advisory only — a human approves every action.
                </p>
            </div>
        </>
    );
};

export default AssessmentReportPage;
