import React from 'react';
import { FileWarning, HelpCircle, BarChart3 } from 'lucide-react';
import { AlertQueue } from './AlertQueue';
import { HistoryTrend } from './HistoryTrend';
import { seriesSpread, type HistoryPoint } from '../../lib/predict/healthTrend';
import { WeibullChart } from './WeibullChart';
import type { RULEstimate, PredictionAlert, AlertOutcome } from '../../types/intelligence';
import type { GroundedRul } from '../../lib/predict/groundedFit';

interface FeedbackStats {
    actionable: number;
    falseAlarm: number;
    precision: number;
}

interface RULReliabilityTabProps {
    /** Alert lifecycle (0391) — see AlertQueue. */
    canCloseAlert: boolean;
    onAcknowledgeAlert: (a: PredictionAlert) => Promise<{ ok: boolean; message?: string }>;
    onRaiseWork: (a: PredictionAlert) => void;
    onRequestReading?: (a: PredictionAlert) => void;
    onCloseAlert: (a: PredictionAlert, outcome: AlertOutcome, notes: string) => Promise<{ ok: boolean; message?: string }>;
    rulEstimate: RULEstimate | null;
    /** Saved RUL history (0392), oldest first. */
    rulHistory?: HistoryPoint[];
    assetAlerts: PredictionAlert[];
    /** Grounded censored-Weibull fit (Phase 1) — drives the survival curve & method note. */
    groundedFit?: GroundedRul | null;
    /** Feedback stats for the current asset — drives precision display */
    feedbackStats?: FeedbackStats | null;
}

export const RULReliabilityTab: React.FC<RULReliabilityTabProps> = ({
    rulEstimate, rulHistory = [], assetAlerts, groundedFit, feedbackStats, canCloseAlert, onAcknowledgeAlert, onRaiseWork, onRequestReading, onCloseAlert,
}) => {
    const rulMove = seriesSpread(rulHistory);
    const totalFeedback = (feedbackStats?.actionable || 0) + (feedbackStats?.falseAlarm || 0);

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* RUL Estimate Card — takes 2/3 width */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
                        <h3 className="text-base font-semibold text-slate-800 mb-2 flex items-center justify-between flex-wrap gap-2">
                            Remaining useful life
                            {/* No live fit → heuristic, whatever a legacy row's label claims */}
                            <span className={`text-xs font-normal px-2 py-1 rounded ${groundedFit ? 'text-primary-700 bg-primary-50 border border-primary-100' : 'text-amber-700 bg-amber-50 border border-amber-200'}`}>
                                {groundedFit ? 'WEIBULL MRL · FITTED' : 'HEURISTIC · DIRECTIONAL'}
                            </span>
                        </h3>
                        <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                            {groundedFit
                                ? groundedFit.note
                                : 'An estimate from the health trend, not a fitted model. It becomes a fitted Weibull once the asset has 2 recorded failures.'}
                        </p>

                        <div className="flex items-baseline justify-center gap-1 my-6">
                            <span className={`text-5xl font-bold ${(rulEstimate?.rul_days || 0) < 90 ? 'text-red-400' : 'text-slate-800'}`}>
                                {rulEstimate?.rul_days.toFixed(1)}
                            </span>
                            <span className="text-slate-400 font-medium">Days</span>
                        </div>

                        <div className="space-y-3">
                            <div className="text-xs text-slate-500 flex justify-between">
                                <span>Model Confidence:</span>
                                <span className="text-accent-cyan font-bold">{((rulEstimate?.confidence || 0) * 100).toFixed(0)}%</span>
                            </div>
                            <div className="text-xs text-slate-500 flex justify-between">
                                <span>Data Quality Impact:</span>
                                <span className="text-yellow-500 font-medium">-{((rulEstimate?.dqs_impact || 0) * 100).toFixed(0)}% penalty</span>
                            </div>
                        </div>

                        <div className="mt-6 pt-4 border-t border-slate-200">
                            <p className="text-xs font-medium text-brand-300 mb-3">Confidence Bands</p>
                            {rulEstimate?.confidence_bands.map(band => {
                                const maxDays = Math.max(...(rulEstimate?.confidence_bands.map(b => b.upper_days) || [250]));
                                return (
                                    <div key={band.percentile} className="mb-2">
                                        <div className="flex justify-between text-[11px] text-slate-500 mb-1">
                                            <span>{band.percentile}% Certainty</span>
                                            <span>{band.lower_days} – {band.upper_days} days</span>
                                        </div>
                                        <div className="w-full bg-slate-50 rounded-full h-1.5 flex items-center relative">
                                            <div
                                                className={`absolute h-1.5 rounded-full ${band.percentile === 50 ? 'bg-blue-400' : band.percentile === 80 ? 'bg-blue-500' : 'bg-primary-600'}`}
                                                style={{ left: `${(band.lower_days / maxDays) * 100}%`, width: `${((band.upper_days - band.lower_days) / maxDays) * 100}%` }}
                                            />
                                            <div className="absolute w-2 h-3 bg-white rounded shadow" style={{ left: `calc(${(band.median_days / maxDays) * 100}% - 4px)` }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* How the estimate changed — saved RUL history (0392) */}
                        <div className="border-t border-slate-100 pt-4 mt-4 mb-4">
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">How this estimate changed</p>
                            <p className="text-[11px] text-slate-400 mb-1">
                                {rulMove
                                    ? `From ${Math.round(rulMove.first)} to ${Math.round(rulMove.last)} days over ${rulMove.n} updates (range ${Math.round(rulMove.min)}–${Math.round(rulMove.max)}). A steady line means a stable estimate.`
                                    : 'Each update saves the estimate, so you can see whether it holds steady or jumps.'}
                            </p>
                            <HistoryTrend points={rulHistory} unit=" d" color="#6366f1" height={100} />
                        </div>

                        {/* Weibull Survival Curve — plotted only from the grounded fit */}
                        <WeibullChart rulEstimate={rulEstimate} groundedFit={groundedFit} />
                    </div>
                </div>

                {/* Alerts Timeline — takes 1/3 width */}
                <div className="lg:col-span-1 space-y-6">
                    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
                        <h3 className="text-base font-semibold text-slate-800 mb-2 flex items-center gap-2">
                            <FileWarning size={18} className="text-red-400" />
                            Alerts
                            <span className="text-xs font-normal text-slate-400 ml-auto">This asset</span>
                        </h3>
                        <p className="text-xs text-slate-400 mb-4 leading-relaxed">Warnings when readings near their limits or drift. Each one ends with a recorded outcome.</p>

                        {/* ── Alert Precision Banner ── */}
                        {totalFeedback > 0 && (
                            <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-gradient-to-r from-blue-50 to-blue-50 border border-blue-100">
                                <BarChart3 size={14} className="text-blue-500 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-[11px] font-semibold text-blue-700">
                                        Alert Precision: {((feedbackStats?.precision || 0) * 100).toFixed(0)}%
                                    </p>
                                    <p className="text-[10px] text-blue-400">
                                        {feedbackStats?.actionable} confirmed · {feedbackStats?.falseAlarm} dismissed · {totalFeedback} total
                                    </p>
                                </div>
                                <div className="w-10 h-10 relative">
                                    <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                                        <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                            fill="none" stroke="#e0e7ff" strokeWidth="3" />
                                        <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                            fill="none" stroke="#6366f1" strokeWidth="3"
                                            strokeDasharray={`${(feedbackStats?.precision || 0) * 100}, 100`}
                                            strokeLinecap="round" />
                                    </svg>
                                </div>
                            </div>
                        )}

                        <AlertQueue
                            alerts={assetAlerts}
                            canClose={canCloseAlert}
                            onAcknowledge={onAcknowledgeAlert}
                            onRaiseWork={onRaiseWork}
                            onRequestReading={onRequestReading}
                            onClose={onCloseAlert}
                            renderDetail={(alert) => (
                                <>
                                    {/* Probable causes — diagnosis layer (0215), ranked with evidence */}
                                    {(alert.diagnosis?.hypotheses?.length ?? 0) > 0 && (
                                        <div className="mb-2 bg-slate-50 border border-slate-200 rounded-lg p-2">
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Probable causes</p>
                                            <div className="space-y-1.5">
                                                {alert.diagnosis!.hypotheses.slice(0, 3).map(h => (
                                                    <div key={h.failure_mode_code}>
                                                        <div className="flex items-center gap-1.5 text-[11px]">
                                                            <span className="font-mono font-bold text-slate-600">{h.failure_mode_code}</span>
                                                            <span className="text-slate-600 truncate">{h.failure_mode_label}</span>
                                                            <span className={`px-1 py-0.5 rounded border text-[8px] font-bold shrink-0 ${h.basis === 'deterministic-rule' ? 'bg-sky-50 border-sky-200 text-sky-700' : 'bg-slate-100 border-slate-200 text-slate-500'}`}
                                                                title={h.basis === 'deterministic-rule' ? 'Specific signature matched a rule' : 'Coarse association — screening only'}>
                                                                {h.basis === 'deterministic-rule' ? 'RULE' : 'SCREEN'}
                                                            </span>
                                                            <span className="ml-auto font-bold tabular-nums text-slate-500 shrink-0">{Math.round(h.confidence * 100)}%</span>
                                                        </div>
                                                        {h.evidence.slice(0, 2).map((e, j) => (
                                                            <p key={j} className="text-[10px] text-slate-400 pl-1 leading-snug">· {e.summary}</p>
                                                        ))}
                                                    </div>
                                                ))}
                                            </div>
                                            <p className="text-[9px] text-slate-300 mt-1.5">diagnosis-rules-v1 · deterministic — confirm before intervening</p>
                                        </div>
                                    )}

                                    {/* Metadata badges */}
                                    <div className="flex flex-wrap gap-1.5 text-[10px] font-medium mb-2">
                                        <span className="bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded text-brand-300">
                                            AI Conf: {(alert.confidence * 100).toFixed(0)}%
                                        </span>
                                        <span className="bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded text-slate-500 font-mono">
                                            T{alert.governance_tier}
                                        </span>
                                        {alert.dqs_impact > 0 && (
                                            <span className="bg-slate-50 border border-yellow-500/30 px-1.5 py-0.5 rounded text-yellow-600">
                                                DQS: -{(alert.dqs_impact * 100).toFixed(0)}%
                                            </span>
                                        )}
                                    </div>
                                </>
                            )}
                        />
                    </div>
                </div>
            </div>

            {/* Disclaimer */}
            <div className="flex items-start gap-3 bg-slate-50 border border-slate-200/50 rounded-lg p-4">
                <HelpCircle size={16} className="text-slate-400 mt-0.5 shrink-0" />
                <p className="text-xs text-slate-500 leading-relaxed">
                    <strong>ISO 55000 governance · Tier {rulEstimate?.governance_tier}.</strong> These predictions are advisory. They support engineering judgment; they don't replace it. Confidence is reduced where sensor data quality is poor.
                </p>
            </div>
        </div>
    );
};
