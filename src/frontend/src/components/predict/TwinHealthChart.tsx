import React from 'react';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    ReferenceLine,
    ReferenceArea
} from 'recharts';
import type { TwinState } from '../../types/intelligence';
import { HEALTH_FAILURE_THRESHOLD } from '../../config/predict';

/**
 * The fitted life model's expected failure, drawn on the health chart so the
 * two views of the asset — condition and history — share one picture. Only
 * within the chart's horizon; the caller states it in words otherwise.
 */
export interface LifeMarker {
    daysAhead: number;
    label: string;
    /** 50 % band, days ahead — shaded so the marker reads as a range, not a date. */
    band?: { from: number; to: number } | null;
}

interface Props {
    twinState: TwinState | null;
    lifeMarker?: LifeMarker | null;
}

export const TwinHealthChart: React.FC<Props> = ({ twinState, lifeMarker }) => {
    if (!twinState) return null;
    const dateAt = (daysAhead: number) => {
        const d = new Date();
        d.setDate(d.getDate() + daysAhead);
        return d.toISOString().split('T')[0];
    };
    const horizon = Math.max(...twinState.health_projection.map(p => p.days_ahead), 0);
    const marker = lifeMarker && lifeMarker.daysAhead >= 1 && lifeMarker.daysAhead <= horizon ? lifeMarker : null;
    const clampDay = (d: number) => Math.min(horizon, Math.max(1, Math.round(d)));

    // Format data for Recharts
    const data = twinState.health_projection.map(p => {
        return {
            date: dateAt(p.days_ahead),
            daysAhead: p.days_ahead,
            health_index: p.health_index,
            range: [p.confidence_lower, p.confidence_upper]
        };
    });

    // Dynamic Y-axis domain — computed from actual data, but always showing
    // the failure threshold so a healthy asset reads as "far above it", not
    // as a line with no reference.
    const allValues = data.flatMap(d => [d.health_index, d.range[0], d.range[1]]);
    const dataMin = Math.min(...allValues, HEALTH_FAILURE_THRESHOLD);
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
                            <span>Spread (directional):</span>
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
                    <ReferenceLine y={HEALTH_FAILURE_THRESHOLD} stroke="#ef4444" strokeDasharray="3 3" opacity={0.5} label={{ position: 'insideTopLeft', value: `Failure Threshold (${HEALTH_FAILURE_THRESHOLD})`, fill: '#ef4444', fontSize: 10 }} />

                    {/* Fitted life model: expected failure, with its 50 % band */}
                    {marker?.band && (
                        <ReferenceArea x1={dateAt(clampDay(marker.band.from))} x2={dateAt(clampDay(marker.band.to))} fill="#f59e0b" fillOpacity={0.08} stroke="none" />
                    )}
                    {marker && (
                        <ReferenceLine x={dateAt(Math.round(marker.daysAhead))} stroke="#d97706" strokeWidth={2} strokeDasharray="4 3"
                            label={{ position: 'insideTopRight', value: marker.label, fill: '#b45309', fontSize: 10, fontWeight: 600 }} />
                    )}

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
