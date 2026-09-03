/**
 * MaturityGapCard — the audit becomes the system's brain (RF-01/AU, items A+B).
 *
 * Reads the newest audit intake's self-reported maturity (five ISO 55000-series
 * dimensions) and holds it against what the plant's OWN records show
 * (lib/sayDoGap): failure-coding coverage, downtime capture, cost capture,
 * preventive share, assignment discipline. Verdicts are coarse on purpose —
 * supports / questions / unmeasured — a conversation-opener, not a score.
 * Quick wins from the intake deep-link into the module that closes each gap.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Compass, Loader2, ArrowRight, CheckCircle2, AlertTriangle, CircleDashed } from 'lucide-react';
import { supabase } from '../../eam/lib/supabase';
import { assessmentService } from '../../eam/services/AssessmentService';
import type { MaturitySnapshot } from '../../eam/services/AssessmentService';
import type { IntakeDimensionKey } from '../../eam/services/IntakeQuickAnalysis';
import { computeSayDoGap, type DimensionGap, type MeasuredSignals } from '../../lib/sayDoGap';
import { isOpenWo, isDoneWo } from '../../lib/woState';

const PREVENTIVE_RE = /PREVENT|PREDICT|INSPECT|SCHEDUL|\bPM\b|\bPDM\b/;
const CORRECTIVE_RE = /CORRECT|BREAK|EMERG|REPAIR|\bCM\b|\bEM\b/;

/** Where each dimension's gap gets worked. */
const DIMENSION_PATHS: Record<IntakeDimensionKey, { path: string; label: string }> = {
    data: { path: '/reliability-metrics', label: 'Failure Review' },
    financial: { path: '/finops', label: 'FinOps' },
    governance: { path: '/recurring-work', label: 'PM programmes' },
    people: { path: '/contacts', label: 'People & Org' },
    regulatory: { path: '/audits', label: 'Audits' },
};

async function fetchMeasuredSignals(): Promise<MeasuredSignals> {
    const [woQ, coQ, rateQ] = await Promise.all([
        supabase.from('work_orders')
            .select('type, status, breakdown, actual_downtime_hrs, total_actual_cost, frozen_labor_cost, frozen_material_cost, assigned_to, wo_failure_data!wo_id(failure_mode_code)')
            .order('created_at', { ascending: false })
            .limit(5000),
        supabase.from('companies').select('downtime_cost_per_hour').limit(1),
        supabase.from('asset_financials').select('id', { count: 'exact', head: true }).gt('downtime_cost_per_hour', 0),
    ]);
    const rows = (woQ.data ?? []) as any[];
    const pct = (num: number, den: number): number | null => (den > 0 ? (num / den) * 100 : null);

    // Mirrors the canonical isFailure precedence (breakdown → type → coded mode).
    const modeOf = (w: any): string | null => {
        const fd = Array.isArray(w.wo_failure_data) ? w.wo_failure_data[0] : w.wo_failure_data;
        const m = fd?.failure_mode_code ?? null;
        return m && String(m).toUpperCase() !== 'UNKNOWN' ? m : null;
    };
    const isFailureRow = (w: any): boolean => {
        if (w.breakdown === true) return true;
        if (w.breakdown === false) return false;
        const t = String(w.type ?? '').toUpperCase();
        if (PREVENTIVE_RE.test(t)) return false;
        return CORRECTIVE_RE.test(t) || modeOf(w) != null;
    };

    const failures = rows.filter(isFailureRow);
    const closed = rows.filter(w => isDoneWo(w.status));
    const open = rows.filter(w => isOpenWo(w.status));
    const cost = (w: any) => (Number(w.frozen_labor_cost) || 0) + (Number(w.frozen_material_cost) || 0) || Number(w.total_actual_cost) || 0;

    const companyRate = Number(coQ.data?.[0]?.downtime_cost_per_hour);
    return {
        failureCodingPct: pct(failures.filter(w => modeOf(w) != null).length, failures.length),
        downtimeCapturePct: pct(failures.filter(w => Number(w.actual_downtime_hrs) > 0).length, failures.length),
        costCoveragePct: pct(closed.filter(w => cost(w) > 0).length, closed.length),
        preventiveSharePct: pct(rows.filter(w => PREVENTIVE_RE.test(String(w.type ?? '').toUpperCase())).length, rows.length),
        assignmentCoveragePct: pct(open.filter(w => !!w.assigned_to).length, open.length),
        downtimeRateConfigured: (Number.isFinite(companyRate) && companyRate > 0) || (rateQ.count ?? 0) > 0,
    };
}

const VerdictChip: React.FC<{ v: DimensionGap['verdict'] }> = ({ v }) => (
    v === 'supports'
        ? <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide bg-emerald-50 text-emerald-600 border border-emerald-100 rounded-full px-2 py-0.5"><CheckCircle2 size={10} /> data supports</span>
        : v === 'questions'
            ? <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide bg-amber-50 text-amber-600 border border-amber-200 rounded-full px-2 py-0.5"><AlertTriangle size={10} /> data questions</span>
            : <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide bg-slate-50 text-slate-400 border border-slate-200 rounded-full px-2 py-0.5"><CircleDashed size={10} /> unmeasured</span>
);

export const MaturityGapCard: React.FC = () => {
    const navigate = useNavigate();
    const [state, setState] = useState<
        | { kind: 'loading' }
        | { kind: 'none' }
        | { kind: 'ready'; gaps: DimensionGap[]; quickWins: { label: string; action: string; dimension: IntakeDimensionKey }[]; assessmentNumber: string; createdAt: string; headline: string | null; wizardMaturity: { score: number; level: string | null } | null }
    >({ kind: 'loading' });
    // 0309: maturity over time (oldest first); only rows with a 6M score.
    const [trend, setTrend] = useState<MaturitySnapshot[]>([]);
    useEffect(() => {
        let active = true;
        assessmentService.getMaturityTrend(12)
            .then(rows => { if (active) setTrend(rows.filter(r => r.sixm_overall != null)); })
            .catch(() => undefined);
        return () => { active = false; };
    }, []);

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const latest = await assessmentService.getLatestIntakeAnalysis();
                if (!latest || latest.analysis.answeredCount === 0) { if (active) setState({ kind: 'none' }); return; }
                const signals = await fetchMeasuredSignals();
                if (!active) return;
                setState({
                    kind: 'ready',
                    gaps: computeSayDoGap(latest.analysis, signals),
                    quickWins: latest.analysis.quickWins.slice(0, 3).map(q => ({ label: q.label, action: q.action, dimension: q.dimension })),
                    assessmentNumber: latest.assessmentNumber,
                    createdAt: latest.createdAt,
                    headline: latest.analysis.headline || null,
                    // Evidence-based overall (the full 7-step wizard, when completed)
                    // outranks the directional intake — show it when it exists.
                    wizardMaturity: latest.overallMaturity != null
                        ? { score: latest.overallMaturity, level: latest.maturityLevel }
                        : null,
                });
            } catch {
                if (active) setState({ kind: 'none' });
            }
        })();
        return () => { active = false; };
    }, []);

    if (state.kind === 'loading') {
        return <div className="flex items-center gap-2 text-slate-400 text-sm bg-white border border-slate-200 rounded-card p-4"><Loader2 size={14} className="animate-spin" /> Reading your operating context…</div>;
    }

    if (state.kind === 'none') {
        return (
            <div className="bg-white border border-primary-100 rounded-card p-4 flex flex-wrap items-center gap-3">
                <span className="w-8 h-8 rounded-lg bg-primary-50 text-primary-600 border border-primary-100 flex items-center justify-center shrink-0"><Compass size={16} /></span>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800 m-0">Tell the system where you are</p>
                    <p className="text-xs text-slate-500 m-0">Run the maturity intake (10 minutes, ISO 55000-aligned) — the Specialist and the Migration Center shape their guidance around your gaps.</p>
                </div>
                <button onClick={() => navigate('/audits')}
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold px-3.5 py-2 transition-colors">
                    Start the intake <ArrowRight size={13} />
                </button>
            </div>
        );
    }

    return (
        <div className="bg-white border border-slate-200 rounded-card overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
                <Compass size={15} className="text-primary-600" />
                <h3 className="text-sm font-bold text-slate-800 m-0">Operating context — what you said vs what the data shows</h3>
                {state.wizardMaturity && (
                    <span className="text-[10px] font-bold bg-primary-50 text-primary-700 border border-primary-100 rounded-full px-2 py-0.5"
                        title="From the completed 6M checklist assessment (30 scored questions), not the directional intake">
                        6M maturity {state.wizardMaturity.score}/5{state.wizardMaturity.level ? ` · ${state.wizardMaturity.level}` : ''}
                    </span>
                )}
                {trend.length >= 2 && (() => {
                    const first = Number(trend[0].sixm_overall), last = Number(trend[trend.length - 1].sixm_overall);
                    const d = Math.round((last - first) * 10) / 10;
                    return (
                        <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 border ${d > 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : d < 0 ? 'bg-red-50 text-red-600 border-red-100' : 'bg-slate-50 text-slate-500 border-slate-200'}`}
                            title={`${trend.length} assessments since ${new Date(trend[0].created_at).toLocaleDateString()}`}>
                            {first.toFixed(1)} → {last.toFixed(1)} over {trend.length} assessments
                        </span>
                    );
                })()}
                <span className="ml-auto text-[10px] text-slate-400">
                    self-reported intake {state.assessmentNumber} · {new Date(state.createdAt).toLocaleDateString()} · measured from your live records
                </span>
            </div>
            <div className="divide-y divide-slate-50">
                {state.gaps.map(g => (
                    <div key={g.key} className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2">
                        <div className="flex items-center gap-2 w-44 shrink-0">
                            <span className="text-sm font-semibold text-slate-700 capitalize">{g.label}</span>
                            <span className="text-[11px] font-mono text-slate-400">{g.selfScore != null ? `${g.selfScore}/5` : '—'}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 flex-1 min-w-0">
                            {g.proxies.map(p => (
                                <span key={p.label} className="text-[11px] text-slate-500">{p.label}: <b className="text-slate-700">{p.display}</b></span>
                            ))}
                            {g.proxies.length === 0 && <span className="text-[11px] text-slate-400 italic">covered by the evidence-based assessment</span>}
                        </div>
                        <div className="shrink-0 flex items-center gap-2">
                            <VerdictChip v={g.verdict} />
                            {g.verdict === 'questions' && (
                                <button onClick={() => navigate(DIMENSION_PATHS[g.key].path)}
                                    className="text-[11px] font-semibold text-primary-600 hover:text-primary-800 inline-flex items-center gap-0.5">
                                    {DIMENSION_PATHS[g.key].label} <ArrowRight size={10} />
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
            {state.quickWins.length > 0 && (
                <div className="px-4 py-2.5 bg-slate-50/60 border-t border-slate-100 flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Quick wins from your intake</span>
                    {state.quickWins.map((q, i) => (
                        <button key={i} onClick={() => navigate(DIMENSION_PATHS[q.dimension].path)}
                            title={q.action}
                            className="text-[11px] font-medium bg-white border border-slate-200 hover:border-primary-200 hover:text-primary-700 text-slate-600 rounded-full px-2.5 py-1 transition-colors">
                            {q.label} <ArrowRight size={9} className="inline" />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default MaturityGapCard;
