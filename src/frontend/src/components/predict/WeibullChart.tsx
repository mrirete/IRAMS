import React, { useMemo } from 'react';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    ReferenceLine
} from 'recharts';
import type { RULEstimate } from '../../types/intelligence';
import type { GroundedRul } from '../../lib/predict/groundedFit';
import { conditionalRemainingQuantileHours } from '../../eam/utils/weibull';

// ─────────────────────────────────────────────────────────
//  Conditional survival curve from the GROUNDED fit (R-1) —
//  R(d) = R(age+d)/R(age) over remaining days d, using the
//  fitted β/η. No fit → no curve (never a fabricated β).
// ─────────────────────────────────────────────────────────

function generateConditionalCurve(fit: GroundedRul) {
    const beta = fit.beta!;
    const etaDays = fit.eta! / 24;      // fit is in hours; chart in days
    const ageDays = fit.ageDays;

    const R = (t: number) => Math.exp(-Math.pow(Math.max(0, t) / etaDays, beta));
    const RAge = R(ageDays);
    if (RAge <= 1e-12) return [];

    // Plot out to where the conditional failure probability reaches ~98%.
    const maxDays = Math.max(10, Math.ceil(conditionalRemainingQuantileHours(beta, fit.eta!, ageDays * 24, 0.98) / 24));
    const step = Math.max(1, Math.floor(maxDays / 80));

    const points = [];
    for (let d = 0; d <= maxDays; d += step) {
        const reliability = R(ageDays + d) / RAge;          // conditional survival
        const cdf = 1 - reliability;                         // conditional P(failure)
        const t = ageDays + d;
        // Conditional density f(d) = h(age+d)·Rcond(d), h(t) = (β/η)(t/η)^(β−1)
        const hazard = t > 0 ? (beta / etaDays) * Math.pow(t / etaDays, beta - 1) : 0;
        points.push({
            days: d,
            pdf: hazard * reliability * 1000, // scaled for visibility
            cdf: cdf * 100,
            reliability: reliability * 100,
        });
    }
    return points;
}

// ─────────────────────────────────────────────────────────
//  Component
// ─────────────────────────────────────────────────────────

interface Props {
    rulEstimate: RULEstimate | null;
    /** Grounded censored-Weibull fit — the ONLY source of a plotted curve. */
    groundedFit?: GroundedRul | null;
}

export const WeibullChart: React.FC<Props> = ({ rulEstimate, groundedFit }) => {
    const hasFit = !!groundedFit && !!groundedFit.beta && !!groundedFit.eta;
    const data = useMemo(() => {
        if (!hasFit || !groundedFit) return [];
        return generateConditionalCurve(groundedFit);
    }, [hasFit, groundedFit]);

    // Honest empty state: without life data there is no distribution to draw.
    if (!hasFit || data.length === 0) {
        return (
            <div className="mt-4 pt-4 border-t border-slate-200">
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-3">Weibull Survival Curve</p>
                <div className="border border-dashed border-slate-300 rounded-lg p-6 text-center">
                    <p className="text-sm font-medium text-slate-500">No fitted curve yet</p>
                    <p className="text-xs text-slate-400 mt-1.5 max-w-md mx-auto leading-relaxed">
                        A survival curve needs a fitted life distribution — at least 2 recorded failures on this
                        asset's work-order history. It appears automatically once corrective work orders exist.
                        For manual life-data studies, use Reliability Modelling.
                    </p>
                </div>
            </div>
        );
    }
    if (!rulEstimate) return null;

    const CustomTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            const d = payload[0].payload;
            return (
                <div className="bg-slate-50 border border-slate-300 p-3 rounded-lg shadow-xl">
                    <p className="text-slate-600 text-xs mb-2 font-medium">Day {d.days}</p>
                    <div className="space-y-1">
                        <p className="text-blue-400 text-xs flex justify-between gap-4">
                            <span>Reliability:</span>
                            <span className="font-bold">{d.reliability.toFixed(1)}%</span>
                        </p>
                        <p className="text-red-400 text-xs flex justify-between gap-4">
                            <span>P(Failure):</span>
                            <span className="font-bold">{d.cdf.toFixed(1)}%</span>
                        </p>
                        <p className="text-blue-400 text-xs flex justify-between gap-4">
                            <span>Failure Rate:</span>
                            <span className="font-bold">{d.pdf.toFixed(2)}</span>
                        </p>
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="mt-4 pt-4 border-t border-slate-200">
            <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Weibull Survival Curve</p>
                <span className="text-[10px] font-mono text-slate-400">
                    fitted β={groundedFit!.beta} · η={Math.round(groundedFit!.eta! / 24)}d · conditional on {groundedFit!.ageDays}d age
                </span>
            </div>
            <div className="w-full">
                <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                            <linearGradient id="colorReliability" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="colorFailure" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                            </linearGradient>
                        </defs>

                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} vertical={false} />

                        <XAxis
                            dataKey="days"
                            stroke="#64748b"
                            fontSize={10}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(val) => `${val}d`}
                        />

                        <YAxis
                            domain={[0, 100]}
                            stroke="#64748b"
                            fontSize={10}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(val) => `${val}%`}
                        />

                        <Tooltip content={<CustomTooltip />} />

                        {/* Predicted RUL marker */}
                        <ReferenceLine
                            x={rulEstimate.rul_days}
                            stroke="#06b6d4"
                            strokeDasharray="5 3"
                            strokeWidth={2}
                            label={{
                                position: 'insideTopRight',
                                value: `RUL: ${rulEstimate.rul_days.toFixed(0)}d`,
                                fill: '#06b6d4',
                                fontSize: 10,
                                fontWeight: 700,
                            }}
                        />

                        {/* Reliability Curve (blue) */}
                        <Area
                            type="monotone"
                            dataKey="reliability"
                            stroke="#3b82f6"
                            strokeWidth={2}
                            fill="url(#colorReliability)"
                            isAnimationActive={true}
                        />

                        {/* Failure Probability Curve (red) */}
                        <Area
                            type="monotone"
                            dataKey="cdf"
                            stroke="#ef4444"
                            strokeWidth={1.5}
                            fill="url(#colorFailure)"
                            isAnimationActive={true}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
            {/* Legend */}
            <div className="flex items-center gap-4 mt-2 text-[10px] text-slate-400">
                <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-500" /> Reliability R(t)</span>
                <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-500" /> P(Failure)</span>
                <span className="flex items-center gap-1"><div className="w-2 h-0.5 bg-accent-cyan" style={{ borderTop: '2px dashed #06b6d4' }} /> Predicted RUL</span>
            </div>
        </div>
    );
};
