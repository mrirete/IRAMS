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

// ─────────────────────────────────────────────────────────
//  Weibull PDF/CDF Generator
// ─────────────────────────────────────────────────────────

function generateWeibullCurve(rul: RULEstimate) {
    // Estimate Weibull parameters from RUL and confidence bands
    const eta = rul.rul_days * 1.15;   // characteristic life (scale)
    const beta = 2.5;                  // shape parameter (wear-out mode)

    const points = [];
    const maxDays = Math.ceil(eta * 1.8);
    const step = Math.max(1, Math.floor(maxDays / 80));

    for (let t = 0; t <= maxDays; t += step) {
        const x = t / eta;
        // Weibull PDF: (beta/eta) * (t/eta)^(beta-1) * exp(-(t/eta)^beta)
        const pdf = t === 0
            ? 0
            : (beta / eta) * Math.pow(x, beta - 1) * Math.exp(-Math.pow(x, beta));

        // Weibull CDF: 1 - exp(-(t/eta)^beta)
        const cdf = 1 - Math.exp(-Math.pow(x, beta));

        // Reliability = 1 - CDF
        const reliability = 1 - cdf;

        points.push({
            days: t,
            pdf: pdf * 1000, // Scale for visibility
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
}

export const WeibullChart: React.FC<Props> = ({ rulEstimate }) => {
    const data = useMemo(() => {
        if (!rulEstimate) return [];
        return generateWeibullCurve(rulEstimate);
    }, [rulEstimate]);

    if (!rulEstimate || data.length === 0) return null;

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
                        <p className="text-purple-400 text-xs flex justify-between gap-4">
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
            <p className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-3">Weibull Survival Curve</p>
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
