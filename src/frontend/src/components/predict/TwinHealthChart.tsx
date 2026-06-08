import React from 'react';
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
import type { TwinState } from '../../types/intelligence';

interface Props {
    twinState: TwinState | null;
}

export const TwinHealthChart: React.FC<Props> = ({ twinState }) => {
    if (!twinState) return null;

    // Format data for Recharts
    const data = twinState.health_projection.map(p => {
        // Create dates from "days ahead"
        const date = new Date();
        date.setDate(date.getDate() + p.days_ahead);

        return {
            date: date.toISOString().split('T')[0],
            daysAhead: p.days_ahead,
            health_index: p.health_index,
            range: [p.confidence_lower, p.confidence_upper]
        };
    });

    // Dynamic Y-axis domain — computed from actual data
    const allValues = data.flatMap(d => [d.health_index, d.range[0], d.range[1]]);
    const dataMin = Math.min(...allValues);
    const yMin = Math.max(0, Math.floor((dataMin - 10) / 10) * 10); // round down to nearest 10, min 0

    const CustomTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload;
            return (
                <div className="bg-slate-50 border border-slate-300 p-3 rounded-lg shadow-xl">
                    <p className="text-slate-600 text-xs mb-2 font-medium">{data.date} (Day +{data.daysAhead})</p>
                    <div className="space-y-1">
                        <p className="text-accent-cyan text-sm font-bold flex justify-between gap-4">
                            <span>Predicted Health:</span>
                            <span>{data.health_index.toFixed(1)}</span>
                        </p>
                        <p className="text-slate-500 text-xs flex justify-between gap-4">
                            <span>95% Confidence:</span>
                            <span>{data.range[0].toFixed(1)} - {data.range[1].toFixed(1)}</span>
                        </p>
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="w-full">
            <ResponsiveContainer width="100%" height={300}>
                <AreaChart
                    data={data}
                    margin={{ top: 20, right: 20, left: -20, bottom: 0 }}
                >
                    <defs>
                        <linearGradient id="colorHealth" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="colorRange" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05} />
                        </linearGradient>
                    </defs>

                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.4} vertical={false} />

                    <XAxis
                        dataKey="date"
                        stroke="#64748b"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={30}
                        tickFormatter={(val) => {
                            const d = new Date(val);
                            return `${d.toLocaleString('default', { month: 'short' })} ${d.getDate()}`;
                        }}
                    />

                    <YAxis
                        domain={[yMin, 100]}
                        stroke="#64748b"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(val) => `${val}`}
                    />

                    <Tooltip content={<CustomTooltip />} />

                    {/* Critical Failure Threshold Line */}
                    <ReferenceLine y={60} stroke="#ef4444" strokeDasharray="3 3" opacity={0.5} label={{ position: 'insideTopLeft', value: 'Failure Threshold (60)', fill: '#ef4444', fontSize: 10 }} />

                    {/* Confidence Area (range) */}
                    <Area
                        type="monotone"
                        dataKey="range"
                        stroke="none"
                        fill="url(#colorRange)"
                        isAnimationActive={true}
                    />

                    {/* Main Prediction Line */}
                    <Area
                        type="monotone"
                        dataKey="health_index"
                        stroke="#06b6d4"
                        strokeWidth={3}
                        fill="url(#colorHealth)"
                        isAnimationActive={true}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
};
