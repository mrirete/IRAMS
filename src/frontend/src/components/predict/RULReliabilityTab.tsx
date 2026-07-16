import React, { useState } from 'react';
import { FileWarning, ShieldCheck, HelpCircle, CheckCircle2, XCircle, Wrench, BarChart3, Loader2 } from 'lucide-react';
import { WeibullChart } from './WeibullChart';
import type { RULEstimate, PredictionAlert } from '../../types/intelligence';
import type { GroundedRul } from '../../lib/predict/groundedFit';

interface FeedbackStats {
    actionable: number;
    falseAlarm: number;
    precision: number;
}

interface RULReliabilityTabProps {
    rulEstimate: RULEstimate | null;
    assetAlerts: PredictionAlert[];
    /** Grounded censored-Weibull fit (Phase 1) — drives the survival curve & method note. */
    groundedFit?: GroundedRul | null;
    /** Feedback stats for the current asset — drives precision display */
    feedbackStats?: FeedbackStats | null;
    /** Called when user marks an alert as Actionable or False Alarm */
    onAlertFeedback?: (alertId: string, type: 'actionable' | 'false_alarm') => Promise<void>;
    /** Called when user wants to draft a Work Order from an alert */
    onCreateWorkOrder?: (alert: PredictionAlert) => Promise<void>;
    /** Map of alert_id → feedback_status for visual state */
    alertFeedbackMap?: Record<string, 'actionable' | 'false_alarm'>;
}

export const RULReliabilityTab: React.FC<RULReliabilityTabProps> = ({
    rulEstimate, assetAlerts, groundedFit, feedbackStats, onAlertFeedback, onCreateWorkOrder, alertFeedbackMap = {},
}) => {
    const [loadingFeedback, setLoadingFeedback] = useState<Record<string, boolean>>({});
    const [loadingWO, setLoadingWO] = useState<string | null>(null);

    const handleFeedback = async (alertId: string, type: 'actionable' | 'false_alarm') => {
        if (!onAlertFeedback) return;
        setLoadingFeedback(prev => ({ ...prev, [alertId]: true }));
        try { await onAlertFeedback(alertId, type); }
        finally { setLoadingFeedback(prev => ({ ...prev, [alertId]: false })); }
    };

    const handleCreateWO = async (alert: PredictionAlert) => {
        if (!onCreateWorkOrder) return;
        setLoadingWO(alert.alert_id);
        try { await onCreateWorkOrder(alert); }
        finally { setLoadingWO(null); }
    };

    const totalFeedback = (feedbackStats?.actionable || 0) + (feedbackStats?.falseAlarm || 0);

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* RUL Estimate Card — takes 2/3 width */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
                        <h3 className="text-base font-semibold text-slate-800 mb-2 flex items-center justify-between">
                            Remaining Useful Life
                            {/* No live fit → heuristic, whatever a legacy row's label claims */}
                            <span className={`text-xs font-normal px-2 py-1 rounded ${groundedFit ? 'text-primary-700 bg-primary-50 border border-primary-100' : 'text-amber-700 bg-amber-50 border border-amber-200'}`}>
                                {groundedFit ? 'WEIBULL MRL · FITTED' : 'HEURISTIC · DIRECTIONAL'}
                            </span>
                        </h3>
                        <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                            {groundedFit
                                ? groundedFit.note
                                : 'Directional estimate from the health-index trend — not a fitted life model. It becomes a fitted Weibull automatically once this asset has ≥2 recorded failures.'}
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

                        {/* Weibull Survival Curve — plotted only from the grounded fit */}
                        <WeibullChart rulEstimate={rulEstimate} groundedFit={groundedFit} />
                    </div>
                </div>

                {/* Alerts Timeline — takes 1/3 width */}
                <div className="lg:col-span-1 space-y-6">
                    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
                        <h3 className="text-base font-semibold text-slate-800 mb-2 flex items-center gap-2">
                            <FileWarning size={18} className="text-red-400" />
                            Prediction Alerts
                            <span className="text-xs font-normal text-slate-400 ml-auto">This Asset</span>
                        </h3>
                        <p className="text-xs text-slate-400 mb-4 leading-relaxed">AI-generated warnings when sensor readings approach alarm limits or show anomalous trends. Each alert includes confidence score and ISO 55000 governance tier.</p>

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

                        <div className="space-y-4">
                            {assetAlerts.length === 0 ? (
                                <div className="text-center py-6">
                                    <ShieldCheck size={28} className="mx-auto text-accent-safe/50 mb-2" />
                                    <p className="text-sm text-slate-400">No active alerts for this asset.</p>
                                </div>
                            ) : (
                                assetAlerts.map(alert => {
                                    const feedbackStatus = alertFeedbackMap[alert.alert_id];
                                    const isLoading = loadingFeedback[alert.alert_id];
                                    const isHighSeverity = alert.severity === 'high' || (alert.severity as string) === 'critical';

                                    return (
                                        <div key={alert.alert_id} className="relative pl-4 border-l-2 border-slate-200 pb-3 last:pb-0">
                                            <div className={`absolute -left-1.5 top-1.5 w-2.5 h-2.5 rounded-full ${alert.severity === 'high' || (alert.severity as string) === 'critical' ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]' : alert.severity === 'medium' ? 'bg-yellow-500' : 'bg-brand-400'}`} />
                                            <p className="text-xs text-slate-400 mb-0.5">
                                                {new Date(alert.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                            </p>
                                            <p className={`text-sm font-semibold ${alert.severity === 'high' || (alert.severity as string) === 'critical' ? 'text-red-400' : alert.severity === 'medium' ? 'text-yellow-500' : 'text-brand-300'}`}>
                                                {alert.title}
                                            </p>
                                            <p className="text-xs text-slate-500 mt-1 mb-2 leading-relaxed">{alert.description}</p>

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
                                                {/* Feedback status badge */}
                                                {feedbackStatus && (
                                                    <span className={`px-1.5 py-0.5 rounded font-semibold ${feedbackStatus === 'actionable'
                                                        ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                                                        : 'bg-orange-50 border border-orange-200 text-orange-600'
                                                    }`}>
                                                        {feedbackStatus === 'actionable' ? '✓ CONFIRMED' : '✕ DISMISSED'}
                                                    </span>
                                                )}
                                            </div>

                                            {/* ── Agentic Action Buttons ── */}
                                            {!feedbackStatus && onAlertFeedback && (
                                                <div className="flex flex-wrap gap-1.5 mt-1">
                                                    <button
                                                        onClick={() => handleFeedback(alert.alert_id, 'actionable')}
                                                        disabled={isLoading}
                                                        className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors disabled:opacity-50"
                                                    >
                                                        {isLoading ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle2 size={10} />}
                                                        Actionable
                                                    </button>
                                                    <button
                                                        onClick={() => handleFeedback(alert.alert_id, 'false_alarm')}
                                                        disabled={isLoading}
                                                        className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md bg-orange-50 text-orange-600 border border-orange-200 hover:bg-orange-100 transition-colors disabled:opacity-50"
                                                    >
                                                        {isLoading ? <Loader2 size={10} className="animate-spin" /> : <XCircle size={10} />}
                                                        False Alarm
                                                    </button>
                                                    {isHighSeverity && onCreateWorkOrder && (
                                                        <button
                                                            onClick={() => handleCreateWO(alert)}
                                                            disabled={loadingWO === alert.alert_id}
                                                            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors disabled:opacity-50"
                                                        >
                                                            {loadingWO === alert.alert_id ? <Loader2 size={10} className="animate-spin" /> : <Wrench size={10} />}
                                                            Create WO
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Disclaimer */}
            <div className="flex items-start gap-3 bg-slate-50 border border-slate-200/50 rounded-lg p-4">
                <HelpCircle size={16} className="text-slate-400 mt-0.5 shrink-0" />
                <p className="text-xs text-slate-500 leading-relaxed">
                    <strong>ISO 55000 Governance:</strong> These predictions are generated under <span className="font-mono bg-brand-800 px-1 rounded">Tier {rulEstimate?.governance_tier}</span> governance. They are advisory and should complement, not replace, engineering judgment. A Data Quality Score (DQS) impact penalty has been applied to confidence intervals where sensor reliability is degraded.
                </p>
            </div>
        </div>
    );
};
