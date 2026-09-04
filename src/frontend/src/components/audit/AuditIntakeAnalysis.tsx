/**
 * AuditIntakeAnalysis.tsx — Preliminary Maturity Snapshot (post-intake interstitial)
 *
 * Shown immediately after Step 1 intake. Turns the ordinal intake selections into
 * an instant, directional maturity read + prioritized quick wins — the free,
 * lead-magnet "first-line assessment". Creates the reason to proceed into the full
 * 5-step wizard (which produces the evidence-based report that showcases IREAMS).
 *
 * No backend call: scoring is a pure function over the intake data already in state.
 */

import React, { useMemo } from 'react';
import {
    ArrowRight, ArrowLeft, Sparkles, CheckCircle2, Zap, TrendingUp, ShieldAlert, Info,
} from 'lucide-react';
import type { AuditIntakeData } from '../../eam/services/AuditTypes';
import { computeIntakeAnalysis, type IntakeAnalysis } from '../../eam/services/IntakeQuickAnalysis';

interface Props {
    intake: AuditIntakeData;
    /** Continue into the full assessment (Step 2). */
    onContinue: () => void;
    /** Go back to refine intake answers. */
    onRefine: () => void;
}

const dimColor = (score: number | null): string => {
    if (score == null) return '#cbd5e1';
    if (score < 1.5) return '#ef4444';
    if (score < 2.5) return '#f59e0b';
    if (score < 3.5) return '#22c55e';
    return '#3b82f6';
};

export const AuditIntakeAnalysis: React.FC<Props> = ({ intake, onContinue, onRefine }) => {
    const analysis: IntakeAnalysis = useMemo(() => computeIntakeAnalysis(intake), [intake]);
    const { overall, overallPercentage, band, dimensions, strengths, quickWins } = analysis;

    // Score ring geometry
    const R = 54;
    const C = 2 * Math.PI * R;
    const pct = overallPercentage ?? 0;
    const dashOffset = C - (pct / 100) * C;
    const ringColor = band?.color || '#cbd5e1';

    const firstName = intake.firstName || 'there';

    return (
        <div className="ers-page-narrow py-8 px-4 space-y-6">

            {/* ─── Header ─────────────────────────────────────── */}
            <div className="text-center mb-2">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary-50 border border-primary-200 text-primary-700 text-[11px] font-bold mb-3">
                    <Sparkles size={12} /> Preliminary Maturity Snapshot
                </div>
                <h2 className="text-2xl font-black text-slate-800">
                    {firstName}, here's where {intake.company || 'your organization'} stands
                </h2>
                <p className="text-sm text-slate-500 mt-1 max-w-2xl mx-auto">
                    A directional read of your asset-management maturity, generated instantly from your intake responses.
                    Your full assessment refines this with evidence.
                </p>
            </div>

            {/* ─── Hero: Score + Headline ──────────────────────── */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                <div className="flex flex-col sm:flex-row items-center gap-6">
                    {/* Ring */}
                    <div className="relative shrink-0" style={{ width: 140, height: 140 }}>
                        <svg viewBox="0 0 120 120" width={140} height={140}>
                            <circle cx="60" cy="60" r={R} fill="none" stroke="#e2e8f0" strokeWidth="9" />
                            {overall != null && (
                                <circle
                                    cx="60" cy="60" r={R} fill="none" stroke={ringColor} strokeWidth="9"
                                    strokeLinecap="round" strokeDasharray={C} strokeDashoffset={dashOffset}
                                    transform="rotate(-90 60 60)"
                                    style={{ transition: 'stroke-dashoffset 1s ease-out' }}
                                />
                            )}
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-3xl font-black" style={{ color: ringColor }}>
                                {overall != null ? overall.toFixed(1) : '—'}
                            </span>
                            <span className="text-[10px] font-semibold text-slate-400">of 5.0</span>
                        </div>
                    </div>

                    {/* Headline + level */}
                    <div className="flex-1 text-center sm:text-left">
                        {band && (
                            <div className="inline-flex items-center gap-2 mb-2">
                                <span className="px-2.5 py-1 rounded-lg text-xs font-black text-white" style={{ backgroundColor: band.color }}>
                                    {band.label.toUpperCase()}
                                </span>
                                <span className="text-xs text-slate-400">{band.description}</span>
                            </div>
                        )}
                        <p className="text-sm text-slate-600 leading-relaxed">{analysis.headline}</p>
                        <p className="text-[11px] text-slate-400 mt-2">
                            Based on {analysis.answeredCount} of {analysis.totalScoreable} context indicators
                            {' · '}{intake.industrySector}
                            {analysis.keyRiskCount > 0 && ` · ${analysis.keyRiskCount} key risk${analysis.keyRiskCount === 1 ? '' : 's'} flagged`}
                        </p>
                    </div>
                </div>

                {/* Low-coverage nudge */}
                {analysis.coverage < 0.5 && (
                    <div className="mt-4 flex items-start gap-2.5 p-3 rounded-xl bg-blue-50 border border-blue-100">
                        <Info size={14} className="text-blue-500 shrink-0 mt-0.5" />
                        <p className="text-[11px] text-slate-600 leading-relaxed">
                            You answered some of the optional context questions. <button onClick={onRefine} className="text-blue-600 font-semibold underline underline-offset-2 hover:text-blue-800">Add the rest</button> for a sharper snapshot — it takes about a minute.
                        </p>
                    </div>
                )}
            </div>

            {/* ─── Dimension Breakdown ─────────────────────────── */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                <h3 className="text-sm font-black text-slate-800 flex items-center gap-2 mb-4">
                    <TrendingUp size={15} className="text-slate-400" /> Maturity by Dimension
                </h3>
                <div className="space-y-3.5">
                    {dimensions.map(d => {
                        const barPct = d.score != null ? (d.score / 5) * 100 : 0;
                        const color = dimColor(d.score);
                        return (
                            <div key={d.key}>
                                <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-bold text-slate-700">{d.label}</span>
                                        <span className="text-[9px] font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{d.isoBadge}</span>
                                    </div>
                                    <span className="text-xs font-black tabular-nums" style={{ color }}>
                                        {d.score != null ? `${d.score.toFixed(1)}/5` : 'Not assessed'}
                                    </span>
                                </div>
                                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                                    <div className="h-full rounded-full transition-all duration-700"
                                        style={{ width: `${barPct}%`, backgroundColor: color }} />
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ─── Strengths + Quick Wins ──────────────────────── */}
            <div className="grid md:grid-cols-2 gap-5">
                {/* Strengths */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                    <h3 className="text-sm font-black text-slate-800 flex items-center gap-2 mb-4">
                        <CheckCircle2 size={15} className="text-emerald-500" /> Where You're Strong
                    </h3>
                    {strengths.length > 0 ? (
                        <ul className="space-y-2.5">
                            {strengths.map(s => (
                                <li key={s.id} className="flex items-start gap-2.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                                    <div>
                                        <span className="text-xs font-semibold text-slate-700">{s.label}</span>
                                        <span className="text-[10px] text-slate-400 ml-1.5">{s.isoRef}</span>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-xs text-slate-400 leading-relaxed">
                            No standout strengths surfaced yet from your responses. The full assessment will validate practices that may already be working well in the field.
                        </p>
                    )}
                </div>

                {/* Quick Wins */}
                <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-6">
                    <h3 className="text-sm font-black text-slate-800 flex items-center gap-2 mb-4">
                        <Zap size={15} className="text-amber-500" /> Priority Quick Wins
                    </h3>
                    {quickWins.length > 0 ? (
                        <ol className="space-y-3">
                            {quickWins.map((w, i) => (
                                <li key={i} className="flex items-start gap-2.5">
                                    <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5">
                                        {i + 1}
                                    </span>
                                    <div>
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-xs font-bold text-slate-700">{w.label}</span>
                                            <span className="text-[9px] font-semibold text-slate-400">{w.isoRef}</span>
                                        </div>
                                        <p className="text-[11px] text-slate-500 leading-snug mt-0.5">{w.action}</p>
                                    </div>
                                </li>
                            ))}
                        </ol>
                    ) : (
                        <div className="flex items-start gap-2.5">
                            <ShieldAlert size={14} className="text-slate-400 shrink-0 mt-0.5" />
                            <p className="text-xs text-slate-400 leading-relaxed">
                                No critical quick wins from your intake — a good sign. Complete the full assessment to uncover deeper, evidence-based opportunities.
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* ─── Conversion CTA ──────────────────────────────── */}
            <div className="rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 p-6 text-center">
                <h3 className="text-lg font-black text-white">This is a directional snapshot — go deeper</h3>
                <p className="text-sm text-slate-300 mt-1 max-w-xl mx-auto">
                    The full assessment scores your operation against evidence across the six ISO 55001 / GFMAM groups and produces an
                    on-screen maturity report with a prioritized improvement roadmap and gap-by-gap recommendations.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-5">
                    <button
                        onClick={onContinue}
                        className="px-6 py-3 bg-gradient-to-r from-blue-500 to-primary-600 text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-all flex items-center gap-2 hover:scale-[1.02]"
                    >
                        Continue to Full Assessment <ArrowRight size={16} />
                    </button>
                    <button
                        onClick={onRefine}
                        className="px-5 py-3 text-slate-300 font-semibold rounded-xl border border-slate-600 hover:bg-slate-700/50 transition-colors flex items-center gap-2"
                    >
                        <ArrowLeft size={15} /> Refine My Answers
                    </button>
                </div>
                <p className="text-[11px] text-slate-400 mt-4">
                    Your responses are saved. A Relantern reliability specialist may follow up to walk you through your results.
                </p>
            </div>
        </div>
    );
};
