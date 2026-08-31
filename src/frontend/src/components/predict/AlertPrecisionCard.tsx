/**
 * AlertPrecisionCard — the measured false-alarm number (B6).
 *
 * Alert fatigue is the PdM category's chronic trust killer; vendors market
 * against it with claims. This card shows the MEASURED figure instead:
 * precision = actionable ÷ human-reviewed alerts, from ers_prediction_feedback
 * — and honestly says "not yet measured" until people have reviewed alerts,
 * rather than defaulting an empty record to 100%.
 */
import React, { useEffect, useState } from 'react';
import { Target, Loader2, ThumbsDown } from 'lucide-react';
import { predictionService } from '../../eam/services/PredictionService';

type Stats = Awaited<ReturnType<typeof predictionService.getFleetAlertPrecision>>;

const TYPE_LABELS: Record<string, string> = {
    trend_deviation: 'trend deviation',
    threshold_breach: 'threshold breach',
    anomaly: 'anomaly',
    rul_warning: 'RUL warning',
    pattern_detected: 'pattern',
};

const pct = (v: number | null): string => (v == null ? '—' : `${Math.round(v * 100)}%`);

export const AlertPrecisionCard: React.FC<{ refreshKey?: unknown }> = ({ refreshKey }) => {
    const [stats, setStats] = useState<Stats | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        setLoading(true);
        predictionService.getFleetAlertPrecision()
            .then((s) => { if (active) setStats(s); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [refreshKey]);

    return (
        <div className="bg-white border border-slate-200 rounded-card p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    <Target size={15} className="text-primary-600" /> Alert precision — measured, fleet-wide
                </h3>
                {loading && <Loader2 size={14} className="animate-spin text-slate-300" />}
            </div>

            {!loading && stats && stats.reviewed === 0 ? (
                <p className="text-xs text-slate-500 leading-relaxed">
                    Not yet measured — no alert has human feedback. Mark alerts <em>actionable</em> or{' '}
                    <em>false alarm</em> above and the fleet's real precision appears here. An unmeasured
                    precision is shown as unmeasured, never as 100%.
                </p>
            ) : stats && (
                <>
                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <div className="text-2xl font-bold text-slate-800 tabular-nums">{pct(stats.precision)}</div>
                            <div className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold mt-0.5">All time</div>
                            <div className="text-[11px] text-slate-500">{stats.actionable} of {stats.reviewed} reviewed actionable</div>
                        </div>
                        <div>
                            <div className="text-2xl font-bold text-slate-800 tabular-nums">{pct(stats.precision90)}</div>
                            <div className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold mt-0.5">Last 90 days</div>
                            <div className="text-[11px] text-slate-500">{stats.reviewed90} reviewed</div>
                        </div>
                        <div>
                            <div className="text-2xl font-bold text-slate-800 tabular-nums">{stats.coveragePct != null ? `${stats.coveragePct}%` : '—'}</div>
                            <div className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold mt-0.5">Review coverage</div>
                            <div className="text-[11px] text-slate-500">{stats.reviewed} of {stats.totalAlerts} alerts reviewed</div>
                        </div>
                    </div>
                    {stats.worstTypes.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2">
                            <span className="text-[11px] text-slate-500 flex items-center gap-1">
                                <ThumbsDown size={11} className="text-amber-500" /> Most false alarms:
                            </span>
                            {stats.worstTypes.map((t) => (
                                <span key={t.type} className="text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-100 rounded-full px-2 py-0.5">
                                    {TYPE_LABELS[t.type] ?? t.type} · {t.falseAlarms}
                                </span>
                            ))}
                            <span className="text-[10px] text-slate-400">— feed the threshold agent's band proposals</span>
                        </div>
                    )}
                    <p className="text-[10px] text-slate-400 mt-2">
                        Precision is computed from human verdicts on real alerts (latest verdict per alert) — never model self-scoring.
                    </p>
                </>
            )}
        </div>
    );
};

export default AlertPrecisionCard;
