/**
 * SmrpScorecard — Guideline 8.0 "Getting Started with Metrics" made concrete.
 *
 * Every KPI the Reliability Metrics page computes is placed on the SMRP 7th
 * Edition map: metric number, best-in-class target, leading/lagging, and the
 * roles the standard recommends it to. The role pills
 * show each role its recommended set — including metrics IREAMS does not yet
 * compute, greyed and named, because a role list with holes hidden is not the
 * list the standard publishes. The culture check (IREAMS' own questions, in
 * the spirit of Guideline 8.0) places the organisation on the Reactive →
 * Excellence scale and highlights the metrics that stage should focus on.
 *
 * Metric numbers and targets are cited from SMRP Best Practices, 7th Edition
 * (© SMRP) as facts about the standard; the document is not reproduced.
 * IREAMS is not affiliated with, certified by, or endorsed by SMRP.
 */
import React, { useMemo, useState } from 'react';
import { BookOpen, ClipboardList, Star, Users, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import type { ReliabilityKpi } from '../../eam/services/reliabilityMetrics';
import {
    SMRP_METRICS, SMRP_ROLE_LABELS, SMRP_ROLE_METRICS, SMRP_STARTER_SET, SMRP_CULTURE_QUESTIONS,
    CULTURE_LABELS, scoreCulture, metricsForStage, type SmrpRole, type CultureStage,
} from '../../lib/smrpCatalog';

/** 'SMRP 3.5.1' → '3.5.1', 'SMRP G6.0 Ai' → 'G6.0-Ai'. */
export const smrpIdOf = (ref?: string): string | undefined =>
    ref ? ref.replace(/^SMRP\s+/, '').replace(/^(G\d+\.\d+)\s+/, '$1-') : undefined;

const CULTURE_STORE_KEY = 'ers_smrp_culture_v1';

/** App role code → the SMRP role whose list opens first. */
export const smrpRoleForAppRole = (role: string | null | undefined): SmrpRole => {
    const r = (role || '').toUpperCase();
    if (r === 'RELIABILITY_ENG') return 'reliability-engineer';
    if (r === 'SUPERVISOR' || r === 'TECHNICIAN') return 'crew-leader';
    if (r === 'PLANNER') return 'planner';
    if (r === 'EXECUTIVE') return 'leadership';
    if (r === 'MANAGER' || r === 'ASSET_MANAGER') return 'maintenance-manager';
    return 'reliability-engineer';
};

const CULTURE_STYLE: Record<CultureStage, string> = {
    R: 'bg-red-50 text-red-700 border-red-200',
    M: 'bg-amber-50 text-amber-700 border-amber-200',
    P: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    E: 'bg-primary-50 text-primary-700 border-primary-200',
};

interface Props {
    kpis: ReliabilityKpi[];
    deltas?: Record<string, number | null>;
    defaultRole: SmrpRole;
    windowLabel: string;
}

export const SmrpScorecard: React.FC<Props> = ({ kpis, deltas = {}, defaultRole, windowLabel }) => {
    const [role, setRole] = useState<SmrpRole | 'all'>(defaultRole);
    const [starterOnly, setStarterOnly] = useState(false);
    const [showAssessment, setShowAssessment] = useState(false);

    // Computed KPI by SMRP id — one KPI per metric; the first wins.
    const byId = useMemo(() => {
        const m = new Map<string, ReliabilityKpi>();
        for (const k of kpis) { const id = smrpIdOf(k.smrpRef); if (id && !m.has(id)) m.set(id, k); }
        return m;
    }, [kpis]);

    // Rows: the role's published list (or every catalogued metric), starter
    // filter applied, computed ones first within the published order.
    const rows = useMemo(() => {
        const ids = role === 'all'
            ? Object.keys(SMRP_METRICS)
            : SMRP_ROLE_METRICS[role];
        const list = ids.filter(id => !starterOnly || SMRP_STARTER_SET.includes(id));
        // 'all' also lists the two Guideline 6.0 availabilities and anything
        // computed that the role lists omit — nothing computed is hidden.
        if (role !== 'all') for (const id of byId.keys()) if (!list.includes(id) && (!starterOnly || SMRP_STARTER_SET.includes(id))) list.push(id);
        return list.map(id => ({ id, def: SMRP_METRICS[id], kpi: byId.get(id) })).filter(r => r.def);
    }, [role, starterOnly, byId]);

    // ── Culture check — remembered on this device ──
    const [answers, setAnswers] = useState<Record<string, number | undefined>>(() => {
        try { return JSON.parse(localStorage.getItem(CULTURE_STORE_KEY) || '{}'); } catch { return {}; }
    });
    const setAnswer = (id: string, i: number) => {
        const next = { ...answers, [id]: i };
        setAnswers(next);
        try { localStorage.setItem(CULTURE_STORE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    };
    const resetAnswers = () => { setAnswers({}); try { localStorage.removeItem(CULTURE_STORE_KEY); } catch { /* ignore */ } };
    const culture = useMemo(() => scoreCulture(answers), [answers]);
    const focus = useMemo(() => culture.answered ? metricsForStage(culture.stage).filter(m => byId.has(m.id)) : [], [culture, byId]);

    const computedCount = rows.filter(r => r.kpi).length;

    return (
        <div className="space-y-4">
            {/* Header + role pills */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
                    <BookOpen size={15} className="text-primary-600" />
                    <h3 className="text-sm font-bold text-slate-800">SMRP Scorecard</h3>
                    <span className="text-[11px] text-slate-400">Best Practices 7th Edition · Guideline 8.0 metrics by role · {windowLabel}</span>
                    <label className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 cursor-pointer select-none">
                        <input type="checkbox" checked={starterOnly} onChange={e => setStarterOnly(e.target.checked)} className="rounded border-slate-300" />
                        <Star size={11} className="text-amber-500" /> Starter set only
                    </label>
                </div>
                <div className="px-4 py-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <Users size={12} className="text-slate-400" />
                    {(['all', ...Object.keys(SMRP_ROLE_LABELS)] as (SmrpRole | 'all')[]).map(r => (
                        <button key={r} onClick={() => setRole(r)}
                            className={`px-2.5 py-1 rounded-full font-semibold border transition-colors ${role === r ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                            {r === 'all' ? 'All metrics' : SMRP_ROLE_LABELS[r]}
                        </button>
                    ))}
                    <span className="ml-auto text-slate-400">{computedCount} of {rows.length} computed</span>
                </div>

                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400">
                            <tr>
                                <th className="text-left font-bold px-4 py-2 w-16">Metric</th>
                                <th className="text-left font-bold px-4 py-2">Name</th>
                                <th className="text-right font-bold px-4 py-2">Value</th>
                                <th className="text-left font-bold px-4 py-2">Best-in-class</th>
                                <th className="text-left font-bold px-4 py-2">Type</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {rows.map(({ id, def, kpi }) => {
                                const dv = kpi ? deltas[kpi.key] : null;
                                const better = kpi && dv != null && dv !== 0 ? (kpi.direction === 'higher-better' ? dv > 0 : dv < 0) : null;
                                return (
                                    <tr key={id} className={`hover:bg-slate-50 ${kpi ? '' : 'text-slate-400'}`} title={def.formula}>
                                        <td className="px-4 py-2 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                                            {id.replace('-', ' ')}
                                            {SMRP_STARTER_SET.includes(id) && <Star size={10} className="inline ml-1 -mt-0.5 text-amber-500" aria-label="starter set" />}
                                        </td>
                                        <td className="px-4 py-2">
                                            <div className={`font-semibold ${kpi ? 'text-slate-800' : 'text-slate-400'}`}>{def.name}</div>
                                            <div className="text-[10px] text-slate-400 truncate max-w-[360px]">{kpi ? kpi.definition : `${def.formula} — not computed in IREAMS yet`}</div>
                                        </td>
                                        <td className="px-4 py-2 text-right whitespace-nowrap">
                                            {kpi ? (
                                                <>
                                                    <span className={`font-bold ${kpi.value == null ? 'text-slate-400' : 'text-slate-800'}`}>{kpi.display}</span>
                                                    {better != null && (
                                                        <span className={`ml-1.5 text-[10px] font-semibold ${better ? 'text-emerald-600' : 'text-red-500'}`}>
                                                            {dv! > 0 ? '▲' : '▼'} {Math.abs(dv!)}{kpi.unit === '%' ? 'pp' : ''}
                                                        </span>
                                                    )}
                                                </>
                                            ) : <span className="text-slate-300">—</span>}
                                        </td>
                                        <td className="px-4 py-2 text-[11px] text-slate-500 max-w-[220px]">{def.target || 'trend — no published target'}</td>
                                        <td className="px-4 py-2 text-[11px] text-slate-500 capitalize">{def.indicator}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                <div className="px-4 py-2 text-[10px] text-slate-400 border-t border-slate-100">
                    ★ = starter set for organisations new to metrics. Metric numbering and best-in-class values reference SMRP Best Practices, 7th Edition, © Society for Maintenance &amp; Reliability Professionals. IREAMS is not affiliated with or endorsed by SMRP.
                </div>
            </div>

            {/* Cultural self-assessment */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <button onClick={() => setShowAssessment(v => !v)} className="w-full px-4 py-3 flex items-center gap-2 text-left">
                    <ClipboardList size={15} className="text-primary-600" />
                    <h3 className="text-sm font-bold text-slate-800">Culture Check</h3>
                    <span className="text-[11px] text-slate-400">in the spirit of SMRP Guideline 8.0 · {culture.answered}/{SMRP_CULTURE_QUESTIONS.length} answered</span>
                    {culture.answered > 0 && (
                        <span className={`ml-2 px-2 py-0.5 rounded-full border text-[10px] font-bold ${CULTURE_STYLE[culture.stage]}`}>{CULTURE_LABELS[culture.stage]}</span>
                    )}
                    <span className="ml-auto text-slate-400">{showAssessment ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
                </button>
                {showAssessment && (
                    <div className="border-t border-slate-100">
                        <div className="px-4 py-3 text-[11px] text-slate-500 bg-slate-50/60 flex flex-wrap items-center gap-2">
                            <span>Pick the option that most closely describes this site. Scores: R {culture.counts.R} · M {culture.counts.M} · P {culture.counts.P}. {culture.narrative}</span>
                            {culture.answered > 0 && (
                                <button onClick={resetAnswers} className="ml-auto inline-flex items-center gap-1 font-semibold text-slate-500 hover:text-slate-700"><RotateCcw size={11} /> Reset</button>
                            )}
                        </div>
                        <div className="divide-y divide-slate-100">
                            {SMRP_CULTURE_QUESTIONS.map((q, i) => {
                                const first = i === 0 || SMRP_CULTURE_QUESTIONS[i - 1].group !== q.group;
                                return (
                                    <div key={q.id} className="px-4 py-2.5">
                                        {first && <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">{q.group}</div>}
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-xs text-slate-700 flex-1 min-w-[240px]">{q.text}</span>
                                            <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
                                                {q.options.map((o, oi) => (
                                                    <button key={oi} onClick={() => setAnswer(q.id, oi)}
                                                        className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${answers[q.id] === oi ? 'bg-primary-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                                                        {o.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        {focus.length > 0 && (
                            <div className="px-4 py-3 border-t border-slate-100 text-[11px] text-slate-600">
                                <span className="font-bold text-slate-700">Focus metrics for this stage (already computed here): </span>
                                {focus.map(m => `${m.id} ${m.name}`).join(' · ')}
                            </div>
                        )}
                        <div className="px-4 py-2 text-[10px] text-slate-400 border-t border-slate-100">IREAMS' own questions, not SMRP's questionnaire. Answers are remembered on this device only.</div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SmrpScorecard;
