import React, { useState } from 'react';
import {
    ComposedChart,
    Bar,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Cell,
    ReferenceLine,
    Scatter,
} from 'recharts';
import type { ParetoResult } from '../../eam/services/AnalyzeService';

// ── Props ───────────────────────────────────────────────────
interface Props {
    data: ParetoResult[];
    criteria: string;
    threshold?: number | null;
    onBarClick?: (asset: ParetoResult) => void;
}

// ── Criticality badge colors ────────────────────────────────
const CRIT_COLORS: Record<string, string> = {
    A: '#ef4444', // red — Safety Critical
    B: '#f59e0b', // amber — Production Critical
    C: '#22c55e', // green — General
};

// ── Component ───────────────────────────────────────────────
export const ParetoChart: React.FC<Props> = ({ data, criteria, threshold, onBarClick }) => {
    const [activeIndex, setActiveIndex] = useState<number | null>(null);

    if (!data || data.length === 0) return (
        <div className="flex flex-col items-center justify-center p-12 text-slate-400 text-sm">
            <svg className="w-12 h-12 mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <p className="font-medium text-slate-500">No Pareto data available</p>
            <p className="text-xs text-slate-400 mt-1">Close some Work Orders to generate analysis data</p>
        </div>
    );

    const maxEventCount = Math.max(...data.map(d => d.event_count), 1);

    const handleBarClick = (_: any, index: number) => {
        const asset = data[index];
        if (onBarClick && asset) onBarClick(asset);
    };

    const metricLabel = criteria === 'cost' ? 'Cost ($)' : criteria === 'downtime' ? 'Downtime (hrs)' : 'WO Count';
    const formatMetric = (val: number) => {
        if (criteria === 'cost') return val >= 1000 ? `$${(val / 1000).toFixed(0)}k` : `$${val}`;
        if (val >= 1000) return `${(val / 1000).toFixed(0)}k`;
        return `${val}`;
    };

    // ── Custom Tooltip ──────────────────────────────────────
    const CustomTooltip = ({ active, payload }: any) => {
        if (!active || !payload?.length) return null;
        const d = payload[0].payload as ParetoResult;
        return (
            <div className="bg-slate-50 border border-slate-300 p-3 rounded-lg shadow-xl min-w-[220px] max-w-[280px]">
                {/* Header */}
                <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-200">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: CRIT_COLORS[d.criticality] || '#64748b' }} />
                    <span className="text-slate-700 text-sm font-semibold">#{d.rank} — {d.asset_tag}</span>
                </div>
                <p className="text-xs text-slate-500 mb-2 truncate">{d.asset_name}</p>
                {/* Metrics */}
                <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                        <span className="text-slate-500">{metricLabel}:</span>
                        <span className="text-accent-cyan font-bold">
                            {d.metric_unit === '$' ? '$' : ''}{d.metric_value.toLocaleString()}{d.metric_unit !== '$' ? ` ${d.metric_unit}` : ''}
                        </span>
                    </div>
                    <div className="flex justify-between text-xs">
                        <span className="text-slate-500">Work Orders:</span>
                        <span className="text-slate-600 font-medium">{d.event_count}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                        <span className="text-slate-500">% of Total:</span>
                        <span className="text-slate-600">{d.pct_of_total.toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between text-xs">
                        <span className="text-slate-500">Cumulative:</span>
                        <span className="text-amber-400 font-bold">{d.cumulative_pct.toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between text-xs pt-1 border-t border-slate-200">
                        <span className="text-slate-500">Level:</span>
                        <span className="text-slate-600 capitalize">{d.hierarchy_level.toLowerCase()}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                        <span className="text-slate-500">Criticality:</span>
                        <span className="font-bold" style={{ color: CRIT_COLORS[d.criticality] || '#94a3b8' }}>
                            {d.criticality === 'A' ? '🔴 Safety' : d.criticality === 'B' ? '🟡 Production' : '🟢 General'}
                        </span>
                    </div>
                </div>
                {onBarClick && (
                    <p className="text-[10px] text-accent-cyan text-center mt-2 pt-2 border-t border-slate-200">
                        Click bar to drill down into Work Orders
                    </p>
                )}
            </div>
        );
    };

    // ── Custom X-axis tick with criticality dot ─────────────
    const CustomXTick = ({ x, y, payload }: any) => {
        const asset = data.find(d => d.asset_tag === payload.value);
        const critColor = asset ? CRIT_COLORS[asset.criticality] || '#64748b' : '#64748b';
        return (
            <g transform={`translate(${x},${y})`}>
                <circle cx={0} cy={8} r={3} fill={critColor} />
                <text
                    x={0}
                    y={20}
                    textAnchor="end"
                    fill="#64748b"
                    fontSize={10}
                    transform="rotate(-30)"
                >
                    {payload.value}
                </text>
            </g>
        );
    };

    return (
        <div className="w-full h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                    data={data}
                    margin={{ top: 20, right: 50, left: 0, bottom: 40 }}
                >
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} vertical={false} />

                    {/* X-Axis: Asset Tags with criticality dots */}
                    <XAxis
                        dataKey="asset_tag"
                        tick={<CustomXTick />}
                        tickLine={false}
                        axisLine={false}
                        height={70}
                        interval={0}
                    />

                    {/* Left Y-Axis: Primary metric (cost, downtime, frequency) */}
                    <YAxis
                        yAxisId="left"
                        stroke="#64748b"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={formatMetric}
                        label={{
                            value: metricLabel,
                            angle: -90,
                            position: 'insideLeft',
                            offset: 10,
                            style: { fill: '#94a3b8', fontSize: 10 },
                        }}
                    />

                    {/* Right Y-Axis: Cumulative percentage */}
                    <YAxis
                        yAxisId="right"
                        orientation="right"
                        domain={[0, 100]}
                        stroke="#64748b"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(val) => `${val}%`}
                        label={{
                            value: 'Cumulative %',
                            angle: 90,
                            position: 'insideRight',
                            offset: 10,
                            style: { fill: '#94a3b8', fontSize: 10 },
                        }}
                    />

                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(51, 65, 85, 0.15)' }} />

                    {/* 80% Pareto threshold reference line */}
                    <ReferenceLine
                        yAxisId="right"
                        y={80}
                        stroke="#f59e0b"
                        strokeDasharray="8 4"
                        strokeWidth={1.5}
                        label={{
                            value: '80% Pareto',
                            position: 'right',
                            fill: '#f59e0b',
                            fontSize: 10,
                        }}
                    />

                    {/* User-defined threshold line (e.g., 11 hours from Figure 11.15) */}
                    {threshold != null && threshold > 0 && (
                        <ReferenceLine
                            yAxisId="left"
                            y={threshold}
                            stroke="#60a5fa"
                            strokeDasharray="6 3"
                            strokeWidth={1.5}
                            label={{
                                value: `Threshold: ${formatMetric(threshold)}`,
                                position: 'left',
                                fill: '#60a5fa',
                                fontSize: 10,
                            }}
                        />
                    )}

                    {/* ── Bars: Primary Metric ─────────────────── */}
                    <Bar
                        yAxisId="left"
                        dataKey="metric_value"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={45}
                        isAnimationActive={true}
                        animationDuration={600}
                        onClick={handleBarClick}
                        style={{ cursor: onBarClick ? 'pointer' : 'default' }}
                    >
                        {data.map((entry, index) => (
                            <Cell
                                key={`cell-${index}`}
                                fill={
                                    activeIndex === index
                                        ? '#22d3ee'           // hover highlight
                                        : entry.cumulative_pct <= 80
                                            ? '#06b6d4'       // vital few (cyan)
                                            : '#334155'       // useful many (slate)
                                }
                                onMouseEnter={() => setActiveIndex(index)}
                                onMouseLeave={() => setActiveIndex(null)}
                            />
                        ))}
                    </Bar>

                    {/* ── Line: Cumulative Percentage ──────────── */}
                    <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="cumulative_pct"
                        stroke="#fbbf24"
                        strokeWidth={2}
                        dot={{ r: 4, fill: '#fbbf24', strokeWidth: 0 }}
                        activeDot={{ r: 6, fill: '#f59e0b', strokeWidth: 0 }}
                        isAnimationActive={true}
                    />

                    {/* ── Scatter: Event Count (WO count dots) ── */}
                    <Scatter
                        yAxisId="left"
                        dataKey="event_count"
                        fill="#818cf8"
                        shape={(props: any) => {
                            const { cx, cy } = props;
                            if (!cx || !cy) return null;
                            return (
                                <circle
                                    cx={cx}
                                    cy={cy}
                                    r={5}
                                    fill="#818cf8"
                                    stroke="#312e81"
                                    strokeWidth={1.5}
                                    opacity={0.85}
                                />
                            );
                        }}
                    />
                </ComposedChart>
            </ResponsiveContainer>

            {/* Legend */}
            <div className="flex items-center justify-center gap-6 mt-2 text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm bg-cyan-500" /> Vital Few (≤80%)
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm bg-slate-700" /> Useful Many
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> Cumulative %
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-400" /> WO Count
                </span>
            </div>
        </div>
    );
};
