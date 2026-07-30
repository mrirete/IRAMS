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
    Layers, FolderPlus, Check, Route, SendHorizonal, Users, PackageSearch, Footprints,
    FileSpreadsheet, Maximize2,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useSettings } from '../../contexts/SettingsContext';
import { runAssessmentNarrator } from '../../eam/services/agentRunClient';
import { computeAssessment, type Assessment, type WeibullFinding } from '../../eam/services/assessmentEngine';
import { diffStrategyVerdicts, type StrategyVerdict, type StrategyRegime } from '../../lib/strategySelect';
import { predictionService } from '../../eam/services/PredictionService';
import OperatorCarePlannerModal from '../../components/specialist/OperatorCarePlannerModal';
import {
    getLatestSnapshot, saveSnapshot, shouldSaveSnapshot, type AssessmentSnapshot,
} from '../../eam/services/assessmentSnapshotService';
import { analyzeService } from '../../eam/services/AnalyzeService';
import BriefingReport, { type BriefingAsset } from '../../components/specialist/BriefingReport';
import PmOptimizationModal from '../../components/specialist/PmOptimizationModal';
import AreaAssessmentModal from '../../components/specialist/AreaAssessmentModal';
import ReportModal from '../../components/specialist/ReportModal';
import {
    ScoreRing, MetricBars, MagnitudeBars, StatusSplit, BetaStrip, NoData, scoreTone,
} from '../../components/specialist/AssessmentCharts';
import { ParetoChart } from '../../components/specialist/BriefingCharts';
import { exportAssessmentWorkbook } from '../../lib/assessmentExport';

/** Enum → words. Charts are read by people, not by the database. */
const REGIME_LABEL: Record<string, string> = {
    run_to_failure: 'Run to failure',
    fixed_interval: 'Fixed interval',
    condition_based: 'Condition based',
    defect_elimination: 'Defect elimination',
    rcm_study: 'RCM study',
};
const PM_VERDICT_LABEL: Record<string, string> = {
    redundant: 'Redundant',
    over_maintenance: 'Too frequent',
    under_maintenance: 'Not frequent enough',
    ineffective: 'Not preventing failures',
};

const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <p className="text-sm text-slate-400 italic">{children}</p>
);

/**
 * A report section: illustration first, then the detail.
 *
 * The figure goes above the table because a reader deciding whether this
 * section concerns them should not have to parse rows to find out. `detail`
 * opens the same content in a wide overlay — the useful move for the long
 * tables, which are cramped inside a 4xl column.
 *
 * Declared at module scope on purpose: as a nested component it was a fresh
 * type on every render, remounting each section (and resetting its state).
 */
const Section: React.FC<{
    icon: React.ReactNode;
    title: string;
    /** Rendered above the body, and repeated at the top of the detail overlay. */
    chart?: React.ReactNode;
    /** Offers a wide overlay of this same section. Omit where it fits as-is. */
    expand?: { label: string; subtitle?: string };
    children: React.ReactNode;
}> = ({ icon, title, chart, expand, children }) => {
    const [open, setOpen] = useState(false);
    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 print:border-0 print:p-0 print:mb-6 break-inside-avoid">
            <div className="flex items-start justify-between gap-3 mb-4">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800 uppercase tracking-wide">{icon}{title}</h2>
                {expand && (
                    <button
                        onClick={() => setOpen(true)}
                        title={expand.label}
                        className="no-print shrink-0 inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 h-6 text-[10.5px] font-semibold text-slate-500 transition-colors hover:border-primary-300 hover:text-primary-700"
                    >
                        <Maximize2 size={10} /> {expand.label}
                    </button>
                )}
            </div>
            {chart && <div className="mb-4">{chart}</div>}
            {children}
            {/* The overlay renders the same children — one source of truth for
                the content, and the wide column is the only difference. */}
            {expand && open && (
                <ReportModal open onClose={() => setOpen(false)} title={title}
                    subtitle={expand.subtitle} icon={icon} width="xl">
                    {chart && <div className="mb-5">{chart}</div>}
                    {children}
                </ReportModal>
            )}
        </section>
    );
};

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
    // Operator-care route planner (Phase F1)
    const [careOpen, setCareOpen] = useState(false);
    const [exporting, setExporting] = useState(false);

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
                    success_layer_psc: a.success.assetsMeasured > 0 ? {
                        fleet_success_rate_pct: a.success.fleetSuccessRate,
                        target: a.success.targets.srTarget,
                        world_class: a.success.targets.srWorldClass,
                        assets_measured: a.success.assetsMeasured,
                        in_golden_spot_now: a.success.zoneCounts.inSpot,
                        in_drift_now: a.success.zoneCounts.drift,
                        in_critical_departure_now: a.success.zoneCounts.critical,
                    } : null,
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
                    success_rate_pct: a.success.fleetSuccessRate,
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

    // ── Illustration series, all from figures the engine already computed ──
    const idByTag = new Map(a.assetIndex.map((x) => [x.tag, x.id]));
    const badActorPareto = a.badActors.slice(0, 6).map((b) => ({
        assetId: idByTag.get(b.tag) ?? '', tag: b.tag, name: b.name,
        cost: Math.round(b.cost12mo), cumPct: b.cumulativePct,
    }));
    const countBy = <T,>(rows: T[], key: (r: T) => string) => {
        const m = new Map<string, number>();
        for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
        return [...m.entries()].sort((x, y) => y[1] - x[1]);
    };
    const regimeRows = countBy(a.strategy.verdicts, (v) => v.recommended)
        .map(([k, count]) => ({ label: REGIME_LABEL[k] ?? k, value: count }));
    const pmVerdictRows = countBy(a.pmWaste, (w) => w.category)
        .map(([k, count]) => ({ label: PM_VERDICT_LABEL[k] ?? k.replace(/_/g, ' '), value: count }));
    const warrantyRows = a.warranty.items.slice(0, 6)
        .map((w) => ({ label: w.tag, value: Math.round(w.recoverable), sub: `WO ${w.woNumber} · ${w.date?.slice(0, 10) ?? ''}` }));
    const spareRows = [
        { label: 'No stock at all', tone: 'bad' as const, count: a.spares.exposures.filter((x) => x.severity === 'stockout').length, hint: 'Consumed by a critical asset and nothing on hand' },
        { label: 'Below minimum', tone: 'warn' as const, count: a.spares.exposures.filter((x) => x.severity === 'below_min').length, hint: 'On hand but under the reorder level' },
        { label: 'Stock unknown', tone: 'idle' as const, count: a.spares.exposures.filter((x) => x.severity === 'unknown_stock').length, hint: 'Part is not in the stock records at all' },
    ];
    const skillRows = [
        { label: 'Capabilities covered', tone: 'good' as const, count: a.skills.areas.filter((x) => !x.gap).length },
        { label: 'Capability gaps', tone: 'bad' as const, count: a.skills.areas.filter((x) => x.gap).length, hint: 'The strategy needs this skill and nobody holds it' },
    ];

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
                    {/* Two channels on purpose: print carries the narrative,
                        the workbook carries the rows behind every figure so a
                        reviewer can audit them. */}
                    <button
                        onClick={() => { setExporting(true); void exportAssessmentWorkbook(a).finally(() => setExporting(false)); }}
                        aria-disabled={exporting}
                        title="Every figure in this report as a multi-sheet workbook — summary, bad actors, Weibull fits, strategy, PM programme, Golden Spot, spares, workforce, register quality"
                        className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-medium px-3 py-2"
                    >
                        {exporting ? <Loader2 size={13} className="animate-spin" /> : <FileSpreadsheet size={13} />} Export data
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
                <Section icon={<TrendingDown size={15} className="text-rose-500" />} title="Where the money is going — bad actors (12 months)"
                    chart={badActorPareto.length >= 2
                        ? <ParetoChart pareto={badActorPareto} formatCurrency={formatCurrency} />
                        : null}
                    expand={{ label: 'Full table', subtitle: 'Ranked by 12-month cost. The right-hand figure is the cumulative share of spend — where it reaches 80%, the rest of the fleet is noise by comparison.' }}>
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
                <Section icon={<Activity size={15} className="text-indigo-500" />} title="Failure behaviour — Weibull analysis (censored, full history)"
                    chart={<BetaStrip rows={a.weibull.map((w) => ({ tag: w.tag, beta: w.beta, interpretation: w.interpretation }))} />}>
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
                <Section icon={<BadgeDollarSign size={15} className="text-emerald-600" />} title="Money on the table — warranty recovery"
                    chart={warrantyRows.length
                        ? <MagnitudeBars rows={warrantyRows} format={formatCurrency} mono />
                        : null}>
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
                <Section icon={<Wrench size={15} className="text-amber-500" />} title="PM programme health"
                    chart={pmVerdictRows.length
                        ? <MagnitudeBars rows={pmVerdictRows} />
                        : <NoData>Every active PM programme matches its asset's failure history.</NoData>}
                    expand={{ label: 'Full list', subtitle: 'Programmes whose frequency does not match what the asset actually does.' }}>
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
                <Section icon={<Route size={15} className="text-violet-600" />} title="Maintenance strategy — every asset a deliberate regime"
                    chart={<div className="grid gap-5 md:grid-cols-[auto_1fr] md:items-center">
                        <ScoreRing pct={a.strategy.coveragePct} label="Critical coverage"
                            caption={`${a.strategy.criticalCovered} of ${a.strategy.criticalTotal} A/B assets carry a live PM or monitoring`} />
                        {regimeRows.length
                            ? <MagnitudeBars rows={regimeRows} format={(v) => `${v} assets`} />
                            : <NoData>No assets scored yet.</NoData>}
                    </div>}
                    expand={{ label: 'Full list', subtitle: 'The recommended regime for every asset, and whether what is deployed today already matches it.' }}>
                    {(() => {
                        const st = a.strategy;
                        // D4 — living strategies: verdicts that CHANGED since the
                        // previous snapshot (the evidence moved; re-decide).
                        const prevVerdicts = ((previous?.findings as Record<string, unknown> | undefined)?.strategy as
                            { verdicts?: Pick<StrategyVerdict, 'assetId' | 'tag' | 'recommended'>[] } | undefined)?.verdicts;
                        const changes = diffStrategyVerdicts(prevVerdicts, st.verdicts);
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
                                        <div className="no-print mt-2.5">
                                            <button onClick={() => setCareOpen(true)}
                                                className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 hover:bg-sky-100 text-sky-700 text-[12px] font-semibold px-3 py-1.5 transition-colors">
                                                <Footprints size={13} /> Plan operator-care routes from these verdicts
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                {changes.length > 0 && (
                                    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                        <strong>The evidence moved since the last assessment</strong> — {changes.length} regime{changes.length === 1 ? '' : 's'} changed:
                                        {' '}{changes.slice(0, 4).map((c) => `${c.tag} ${c.from.replaceAll('_', ' ')} → ${c.to.replaceAll('_', ' ')}`).join('; ')}
                                        {changes.length > 4 ? ` (+${changes.length - 4} more)` : ''}. Re-decide these in the room, don't let them drift silently.
                                    </div>
                                )}
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

                {/* Workforce readiness (Phase F5) */}
                <Section icon={<Users size={15} className="text-teal-600" />} title="Workforce readiness — can this roster execute the strategy?"
                    chart={<StatusSplit segments={skillRows} unitLabel="capability areas" />}>
                    {a.skills.totalQualifications === 0 ? (
                        <Empty>
                            No qualifications are recorded yet — the strategy above needs {a.skills.areas.filter((x) => x.demand > 0).length} capability
                            area{a.skills.areas.filter((x) => x.demand > 0).length === 1 ? '' : 's'} staffed. Record certifications and training under
                            People &amp; Org and this section becomes the skills-vs-strategy matrix.
                        </Empty>
                    ) : (
                        <>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                                {a.skills.areas.map((ar) => (
                                    <div key={ar.key} className={`rounded-xl border p-3 ${ar.gap ? 'border-rose-200 bg-rose-50/50' : 'border-slate-100 bg-slate-50/60'}`}>
                                        <div className="flex items-baseline gap-1.5">
                                            <span className={`text-xl font-bold tabular-nums ${ar.gap ? 'text-rose-600' : 'text-slate-800'}`}>{ar.qualifiedPeople}</span>
                                            <span className="text-[11px] text-slate-400">qualified vs {ar.demand} asset{ar.demand === 1 ? '' : 's'} needing it</span>
                                        </div>
                                        <div className="text-[11px] text-slate-600 mt-1 font-medium">{ar.label}</div>
                                        {ar.gap && <div className="text-[10px] text-rose-600 font-semibold mt-0.5">no one qualified — hire, train or contract</div>}
                                        {ar.exampleQuals.length > 0 && <div className="text-[10px] text-slate-400 mt-0.5 truncate">{ar.exampleQuals.join(' · ')}</div>}
                                    </div>
                                ))}
                            </div>
                            <p className="text-xs text-slate-500">
                                {a.skills.totalQualifications} active qualification{a.skills.totalQualifications === 1 ? '' : 's'} on the roster
                                {a.skills.expiringSoon > 0 ? ` · ${a.skills.expiringSoon} expiring within 90 days — renew before the capability lapses.` : '.'}
                                {' '}A strategy no one can execute is a document, not a plan.
                            </p>
                        </>
                    )}
                </Section>

                {/* Success layer — PSC / Golden Spot (Phase E1) */}
                <Section icon={<Activity size={15} className="text-emerald-600" />} title="Success layer — Golden-Spot residency (PSC)"
                    chart={<div className="grid gap-5 md:grid-cols-[auto_1fr] md:items-center">
                        <ScoreRing pct={a.success.fleetSuccessRate} label="Fleet success rate"
                            tone={a.success.fleetSuccessRate == null ? 'idle' : scoreTone(a.success.fleetSuccessRate, a.success.targets.srTarget)}
                            caption={`Target ${a.success.targets.srTarget}% · world class ${a.success.targets.srWorldClass}%`} />
                        <StatusSplit
                            segments={[
                                { label: 'in the Golden Spot', tone: 'good', count: a.success.zoneCounts.inSpot },
                                { label: 'drifting', tone: 'warn', count: a.success.zoneCounts.drift, hint: 'Still inside the band but heading out' },
                                { label: 'in critical departure', tone: 'bad', count: a.success.zoneCounts.critical },
                                { label: 'not yet measurable', tone: 'idle', count: a.success.zoneCounts.unknown, hint: 'No banded measurement points on the asset' },
                            ]} />
                    </div>}>
                    {a.success.assetsWithBands === 0 ? (
                        <Empty>
                            No measurement points carry warning bands yet — set bands on reading points (Condition Data) and the
                            Specialist starts measuring time-in-optimal, not just time-to-failure. This is the PSC framework's
                            success-side lens (Olorunfemi 2026); IRAMS is its reference implementation.
                        </Empty>
                    ) : (
                        <>
                            <div className="flex flex-col sm:flex-row gap-3 mb-3">
                                <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 text-center sm:w-44 shrink-0 flex flex-col justify-center">
                                    <div className={`text-3xl font-bold ${a.success.fleetSuccessRate == null ? 'text-slate-300'
                                        : a.success.fleetSuccessRate >= a.success.targets.srWorldClass ? 'text-emerald-600'
                                            : a.success.fleetSuccessRate >= a.success.targets.srTarget ? 'text-emerald-500'
                                                : 'text-amber-500'}`}>
                                        {a.success.fleetSuccessRate == null ? '—' : `${a.success.fleetSuccessRate}%`}
                                    </div>
                                    <div className="text-[11px] text-slate-500 mt-1">fleet Success Rate</div>
                                    <div className="text-[10px] text-slate-400 mt-0.5">SR = MTOP/(MTOP+MTTRg) · target ≥{a.success.targets.srTarget} · world-class ≥{a.success.targets.srWorldClass}</div>
                                    {previous?.success_rate_pct != null && a.success.fleetSuccessRate != null && (
                                        <div className="text-[10px] mt-1 tabular-nums">{deltaChip(a.success.fleetSuccessRate, Number(previous.success_rate_pct), (n) => `${Math.round(n * 10) / 10} pts`)}</div>
                                    )}
                                </div>
                                <div className="flex-1">
                                    <div className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-slate-400 mb-1.5">
                                        Where the {a.success.assetsMeasured} measured asset{a.success.assetsMeasured === 1 ? ' sits' : 's sit'} right now
                                    </div>
                                    <div className="flex flex-wrap gap-1.5 mb-2.5">
                                        <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 px-2 py-1 text-[11px] font-semibold">In Golden Spot <span className="font-bold tabular-nums">{a.success.zoneCounts.inSpot}</span></span>
                                        <span className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 text-amber-600 px-2 py-1 text-[11px] font-semibold">Sub-optimal drift <span className="font-bold tabular-nums">{a.success.zoneCounts.drift}</span></span>
                                        <span className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 text-rose-600 px-2 py-1 text-[11px] font-semibold">Critical departure <span className="font-bold tabular-nums">{a.success.zoneCounts.critical}</span></span>
                                        {a.success.zoneCounts.unknown > 0 && (
                                            <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 text-slate-500 px-2 py-1 text-[11px] font-semibold">No recent data <span className="font-bold tabular-nums">{a.success.zoneCounts.unknown}</span></span>
                                        )}
                                    </div>
                                    <p className="text-xs text-slate-500 leading-relaxed">
                                        Mean time in the optimal envelope: <strong className="text-slate-700">{a.success.meanTimeInSpotPct ?? '—'}%</strong> over 90 days,
                                        across {a.success.assetsWithBands} banded asset{a.success.assetsWithBands === 1 ? '' : 's'}. The Specialist defends the
                                        optimum — drift is acted on before it becomes departure.
                                    </p>
                                </div>
                            </div>
                            {a.success.worst.length > 0 && (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-200">
                                                <th className="py-2 pr-3">Asset</th><th className="py-2 pr-3">Zone now</th>
                                                <th className="py-2 pr-3 text-right">Time in spot</th><th className="py-2 pr-3 text-right">SR</th>
                                                <th className="py-2 pr-3 text-right">MTOP</th><th className="py-2 text-right">MTTRg</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {a.success.worst.map((r) => (
                                                <tr key={r.assetId} className="border-b border-slate-100">
                                                    <td className="py-2 pr-3"><span className="font-mono font-semibold text-slate-800">{r.tag}</span> <span className="text-slate-400 text-xs">{r.name}</span></td>
                                                    <td className="py-2 pr-3">
                                                        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full ${r.zoneNow === 'GOLDEN_SPOT' ? 'bg-emerald-50 text-emerald-600'
                                                            : r.zoneNow === 'SUB_OPTIMAL_DRIFT' ? 'bg-amber-50 text-amber-600'
                                                                : r.zoneNow === 'CRITICAL_DEPARTURE' ? 'bg-rose-50 text-rose-600' : 'bg-slate-50 text-slate-500'}`}>
                                                            {r.zoneNow.replaceAll('_', ' ').toLowerCase()}
                                                        </span>
                                                        {r.currentDepartureHours != null && <span className="ml-1.5 text-[10px] text-slate-400 tabular-nums">{r.currentDepartureHours}h out</span>}
                                                    </td>
                                                    <td className="py-2 pr-3 text-right font-mono">{r.percentTimeInSpot ?? '—'}%</td>
                                                    <td className="py-2 pr-3 text-right font-mono">{r.successRate == null ? '—' : `${r.successRate}%`}</td>
                                                    <td className="py-2 pr-3 text-right font-mono">{r.mtopHours == null ? '—' : `${r.mtopHours}h`}</td>
                                                    <td className="py-2 text-right font-mono">{r.mttrgHours == null ? '—' : `${r.mttrgHours}h`}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    <p className="text-[10.5px] text-slate-400 mt-2">
                                        MTOP = mean time in the Golden Spot; MTTRg = mean time to restore it; SR per PSC Eq.3. Success-side mirror of MTBF/MTTR — the plant is managed to stay at its optimum, not just to avoid failure.
                                    </p>
                                </div>
                            )}
                            {/* E5 — front of life (D-I-S-G S-phase) */}
                            {a.frontOfLife.length > 0 && (
                                <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                                    <div className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-slate-400 mb-1.5">
                                        Front of life — D-I-S-G S-phase (first 180 days observed)
                                    </div>
                                    <ul className="space-y-1">
                                        {a.frontOfLife.slice(0, 5).map((f) => (
                                            <li key={f.assetId} className="text-[12px] text-slate-600">
                                                <span className="font-mono font-semibold text-slate-700">{f.tag}</span>
                                                <span className="text-slate-400"> · observed {f.observedDays}d · </span>
                                                {f.reachedSpot
                                                    ? <span className="text-emerald-700">reached Success in {f.timeToSuccessHours}h</span>
                                                    : <span className="text-rose-600 font-semibold">has never entered its Golden Spot — S-phase red flag: review installation/commissioning quality, not PM frequency</span>}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </>
                    )}
                </Section>

                {/* Spares exposure (Phase B4) */}
                <Section icon={<PackageSearch size={15} className="text-orange-500" />} title="Spares exposure — parts the criticals already needed once"
                    chart={<StatusSplit segments={spareRows} unitLabel="parts" />}
                    expand={{ label: 'Full list', subtitle: 'Parts consumed by critical assets in the window, and what is on the shelf today.' }}>
                    {a.spares.criticalPartsTracked === 0 ? (
                        <Empty>
                            No parts consumption is recorded against A/B-criticality assets yet
                            {a.spares.stockRowsSeen === 0 ? ' (and no stock records exist)' : ''} — book parts to work orders and
                            this section becomes the criticality-driven stock-risk list.
                        </Empty>
                    ) : a.spares.exposures.length === 0 ? (
                        <Empty>Every part consumed on a critical asset in the last 12 months is held adequately — no exposure.</Empty>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-200">
                                        <th className="py-2 pr-3">Part</th><th className="py-2 pr-3">Risk</th>
                                        <th className="py-2 pr-3 text-right">Used (12 mo)</th><th className="py-2 pr-3 text-right">On hand</th>
                                        <th className="py-2">Critical assets served</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {a.spares.exposures.slice(0, 8).map((e, i) => (
                                        <tr key={e.itemId ?? `d${i}`} className="border-b border-slate-100">
                                            <td className="py-2 pr-3 font-medium text-slate-700">{e.label}</td>
                                            <td className="py-2 pr-3">
                                                <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full ${e.severity === 'stockout' ? 'bg-rose-50 text-rose-600'
                                                    : e.severity === 'below_min' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'}`}>
                                                    {e.severity.replaceAll('_', ' ')}
                                                </span>
                                            </td>
                                            <td className="py-2 pr-3 text-right font-mono">{e.consumedQty12mo} ({e.uses}×)</td>
                                            <td className="py-2 pr-3 text-right font-mono">{e.onHand ?? '?'}{e.minLevel != null ? ` / min ${e.minLevel}` : ''}</td>
                                            <td className="py-2 font-mono text-[12px] text-slate-600">{e.assets.join(', ')}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <p className="text-[10.5px] text-slate-400 mt-2">
                                Exposure = a part consumed on an A/B asset in the last 12 months that is now stocked out, below minimum, or not traceable to a stock record.
                                The failure that needed it once can need it again tomorrow.
                            </p>
                        </div>
                    )}
                </Section>

                {/* Asset register quality (Phase A2) */}
                <Section icon={<Layers size={15} className="text-sky-600" />} title="Asset register quality — the foundation layer"
                    chart={<div className="grid gap-5 md:grid-cols-[auto_1fr] md:items-center">
                        <ScoreRing pct={a.register.healthPct} label="Register health"
                            caption="ISO 14224 composite of the measures beside it" />
                        <MetricBars rows={[
                            { label: 'Sits under a parent (hierarchy)', pct: a.register.structuredPct, hint: 'A flat list cannot be rolled up, scoped or costed by unit' },
                            { label: 'Criticality actually varied', pct: a.register.criticalitySpreadPct, target: 40, hint: 'One class for everything means criticality was never assessed' },
                            { label: 'Nameplate (make and model)', pct: a.register.nameplatePct, target: 60, hint: 'No nameplate, no benchmark and no parts interchangeability' },
                            { label: 'Work orders resolve to an asset', pct: a.register.woLinkedPct, target: 95, hint: 'Unlinked work cannot be attributed to anything' },
                        ]} />
                    </div>}>
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
                <Section icon={<Database size={15} className="text-slate-500" />} title="Data quality — what this assessment rests on"
                    chart={<MetricBars rows={[
                        { label: 'Work orders carrying a cost', pct: a.coverage.cost_pct, target: 90 },
                        { label: 'Corrective work with a coded failure mode', pct: a.coverage.failure_code_pct, target: 80, hint: 'Without codes there is no Pareto by cause and no RCM evidence' },
                        { label: 'Corrective work with a downtime figure', pct: a.coverage.downtime_pct, target: 80, hint: 'MTTR and availability rest on this denominator' },
                    ]} />}>
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
                <OperatorCarePlannerModal open={careOpen} onClose={() => setCareOpen(false)} assessment={assessment} />

                <p className="text-[10px] text-slate-400 text-center flex items-center justify-center gap-1.5">
                    <ShieldCheck size={11} /> Methodology: Pareto on frozen WO costs · median-rank regression Weibull with Johnson-adjusted ranks and right-censoring · PM effectiveness vs corrective history · warranty windows vs completed WOs · register hygiene scored on hierarchy, criticality spread, nameplate, tag collisions and history linkage. Advisory only — a human approves every action.
                </p>
            </div>
        </>
    );
};

export default AssessmentReportPage;
