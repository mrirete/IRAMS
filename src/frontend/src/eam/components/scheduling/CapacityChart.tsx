import React, { useMemo, useState } from 'react';
import { BarChart2, Activity, Calendar } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────

interface CapacityChartProps {
    demand: Record<string, Record<string, number>>; // craftCode -> date -> hours
    resources: {
        craftTypes: string[];
        dailyCapacityHours: number;
        workingDays: string[];
        name: string;
    }[];
    dateRange: { start: string; end: string };
    loading?: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────

const CRAFT_PALETTE = [
    { bg: '#3b82f6', bgLight: 'rgba(59,130,246,0.15)', label: 'Blue' },
    { bg: '#8b5cf6', bgLight: 'rgba(139,92,246,0.15)', label: 'Violet' },
    { bg: '#06b6d4', bgLight: 'rgba(6,182,212,0.15)', label: 'Cyan' },
    { bg: '#f59e0b', bgLight: 'rgba(245,158,11,0.15)', label: 'Amber' },
    { bg: '#ec4899', bgLight: 'rgba(236,72,153,0.15)', label: 'Pink' },
    { bg: '#10b981', bgLight: 'rgba(16,185,129,0.15)', label: 'Emerald' },
    { bg: '#f97316', bgLight: 'rgba(249,115,22,0.15)', label: 'Orange' },
    { bg: '#6366f1', bgLight: 'rgba(99,102,241,0.15)', label: 'Indigo' },
    { bg: '#14b8a6', bgLight: 'rgba(20,184,166,0.15)', label: 'Teal' },
    { bg: '#e11d48', bgLight: 'rgba(225,29,72,0.15)', label: 'Rose' },
];

const BAR_WIDTH = 48;
const CHART_HEIGHT = 260;
const Y_AXIS_WIDTH = 48;
const TOOLTIP_OFFSET = 8;

// ── Helpers ───────────────────────────────────────────────────────────

/** Generate an inclusive array of ISO date strings between start and end. */
const generateDateRange = (start: string, end: string): string[] => {
    const dates: string[] = [];
    const current = new Date(start);
    const endDate = new Date(end);
    while (current <= endDate) {
        dates.push(current.toISOString().split('T')[0]);
        current.setDate(current.getDate() + 1);
    }
    return dates;
};

/** Short display label: "Mon 26" */
const formatDayLabel = (dateStr: string): string => {
    try {
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
    } catch {
        return dateStr;
    }
};

/** Full display label: "Mon, 26 May 2026" */
const formatDateFull = (dateStr: string): string => {
    try {
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-GB', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        });
    } catch {
        return dateStr;
    }
};

/** Check if a date falls on a weekend (Sat/Sun). */
const isWeekend = (dateStr: string): boolean => {
    const d = new Date(dateStr);
    return d.getDay() === 0 || d.getDay() === 6;
};

/** Get utilization color based on ratio of demand to capacity. */
const getUtilizationColor = (demand: number, capacity: number): string => {
    if (capacity <= 0) return demand > 0 ? '#ef4444' : '#94a3b8';
    const ratio = demand / capacity;
    if (ratio > 1) return '#ef4444';      // Red — over capacity
    if (ratio >= 0.8) return '#f59e0b';   // Amber — 80-100%
    return '#22c55e';                      // Green — under 80%
};

// ── Component ─────────────────────────────────────────────────────────

export const CapacityChart: React.FC<CapacityChartProps> = ({
    demand,
    resources,
    dateRange,
    loading = false,
}) => {
    const [hoveredBar, setHoveredBar] = useState<{
        date: string;
        x: number;
        y: number;
    } | null>(null);

    // All dates in the range
    const dates = useMemo(
        () => generateDateRange(dateRange.start, dateRange.end),
        [dateRange.start, dateRange.end]
    );

    // Distinct craft codes extracted from demand keys
    const craftCodes = useMemo(() => Object.keys(demand).sort(), [demand]);

    // Craft → palette color mapping
    const craftColorMap = useMemo(() => {
        const map: Record<string, (typeof CRAFT_PALETTE)[0]> = {};
        craftCodes.forEach((code, i) => {
            map[code] = CRAFT_PALETTE[i % CRAFT_PALETTE.length];
        });
        return map;
    }, [craftCodes]);

    // Per-day capacity: sum dailyCapacityHours for resources whose workingDays include that date
    const dailyCapacity = useMemo(() => {
        const map: Record<string, number> = {};
        dates.forEach((date) => {
            let total = 0;
            resources.forEach((r) => {
                if (r.workingDays.includes(date)) {
                    total += r.dailyCapacityHours;
                }
            });
            map[date] = total;
        });
        return map;
    }, [dates, resources]);

    // Per-day total demand
    const dailyDemand = useMemo(() => {
        const map: Record<string, number> = {};
        dates.forEach((date) => {
            let total = 0;
            craftCodes.forEach((craft) => {
                total += demand[craft]?.[date] ?? 0;
            });
            map[date] = total;
        });
        return map;
    }, [dates, craftCodes, demand]);

    // Auto-scale Y-axis: find max of demand or capacity, round up nicely
    const yMax = useMemo(() => {
        let max = 0;
        dates.forEach((date) => {
            max = Math.max(max, dailyDemand[date] ?? 0, dailyCapacity[date] ?? 0);
        });
        if (max === 0) return 8;
        // Round up to a nice interval
        const step = max <= 8 ? 1 : max <= 24 ? 2 : max <= 50 ? 5 : 10;
        return Math.ceil(max / step) * step + step;
    }, [dates, dailyDemand, dailyCapacity]);

    // Y-axis tick values
    const yTicks = useMemo(() => {
        const ticks: number[] = [];
        const step = yMax <= 10 ? 2 : yMax <= 30 ? 4 : yMax <= 60 ? 8 : Math.ceil(yMax / 6);
        for (let v = 0; v <= yMax; v += step) {
            ticks.push(v);
        }
        return ticks;
    }, [yMax]);

    // ── Skeleton ──────────────────────────────────────────────────────

    if (loading) {
        return (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                {/* Title skeleton */}
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-lg bg-slate-100 animate-pulse" />
                    <div>
                        <div className="h-4 w-48 bg-slate-100 rounded animate-pulse" />
                        <div className="h-3 w-32 bg-slate-50 rounded animate-pulse mt-1.5" />
                    </div>
                </div>
                {/* Chart skeleton */}
                <div className="flex items-end gap-3 h-[200px]">
                    {Array.from({ length: 7 }).map((_, i) => (
                        <div key={i} className="flex-1 flex flex-col items-center gap-1">
                            <div
                                className="w-full bg-slate-100 rounded-t animate-pulse"
                                style={{
                                    height: `${40 + Math.random() * 120}px`,
                                    animationDelay: `${i * 100}ms`,
                                }}
                            />
                            <div className="h-3 w-8 bg-slate-100 rounded animate-pulse" />
                        </div>
                    ))}
                </div>
                {/* Legend skeleton */}
                <div className="flex gap-4 mt-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded bg-slate-100 animate-pulse" />
                            <div className="h-3 w-16 bg-slate-100 rounded animate-pulse" />
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // ── Tooltip data ──────────────────────────────────────────────────

    const tooltipData = hoveredBar
        ? {
              date: hoveredBar.date,
              crafts: craftCodes.map((craft) => ({
                  code: craft,
                  hours: demand[craft]?.[hoveredBar.date] ?? 0,
                  color: craftColorMap[craft]?.bg ?? '#94a3b8',
              })),
              totalDemand: dailyDemand[hoveredBar.date] ?? 0,
              capacity: dailyCapacity[hoveredBar.date] ?? 0,
          }
        : null;

    const chartContentWidth = Math.max(dates.length * (BAR_WIDTH + 12) + 24, 300);

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {/* ── Header ── */}
            <div className="px-6 pt-5 pb-4">
                <div className="flex items-center gap-3">
                    <div className="flex-shrink-0 p-2.5 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 shadow-md shadow-blue-500/20">
                        <BarChart2 className="text-white" size={20} />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-slate-900">
                            Craft Capacity vs Demand
                        </h3>
                        <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1">
                            <Calendar size={10} />
                            {formatDateFull(dateRange.start)} — {formatDateFull(dateRange.end)}
                        </p>
                    </div>
                </div>
            </div>

            {/* ── Chart Area ── */}
            <div className="px-6 pb-2 overflow-x-auto">
                <div
                    className="relative"
                    style={{
                        minWidth: `${chartContentWidth + Y_AXIS_WIDTH}px`,
                        height: `${CHART_HEIGHT + 52}px`,
                    }}
                >
                    {/* Y-axis labels */}
                    <div
                        className="absolute left-0 top-0 flex flex-col justify-between"
                        style={{ width: Y_AXIS_WIDTH, height: CHART_HEIGHT }}
                    >
                        {yTicks
                            .slice()
                            .reverse()
                            .map((tick) => (
                                <div
                                    key={tick}
                                    className="text-[10px] text-slate-400 text-right pr-2 font-mono leading-none"
                                    style={{
                                        position: 'absolute',
                                        bottom: `${(tick / yMax) * CHART_HEIGHT - 6}px`,
                                        right: 0,
                                    }}
                                >
                                    {tick}h
                                </div>
                            ))}
                    </div>

                    {/* Grid lines */}
                    <div
                        className="absolute"
                        style={{
                            left: Y_AXIS_WIDTH,
                            top: 0,
                            right: 0,
                            height: CHART_HEIGHT,
                        }}
                    >
                        {yTicks.map((tick) => (
                            <div
                                key={tick}
                                className="absolute w-full border-t border-slate-100"
                                style={{
                                    bottom: `${(tick / yMax) * CHART_HEIGHT}px`,
                                }}
                            />
                        ))}
                    </div>

                    {/* Bars + Capacity Lines */}
                    <div
                        className="absolute flex items-end gap-3"
                        style={{
                            left: Y_AXIS_WIDTH,
                            bottom: 40,
                            height: CHART_HEIGHT,
                        }}
                    >
                        {dates.map((date) => {
                            const totalDmd = dailyDemand[date] ?? 0;
                            const cap = dailyCapacity[date] ?? 0;
                            const isWknd = isWeekend(date);
                            const utilizationColor = getUtilizationColor(totalDmd, cap);

                            return (
                                <div
                                    key={date}
                                    className="relative flex flex-col items-center"
                                    style={{ width: BAR_WIDTH }}
                                    onMouseEnter={(e) => {
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        setHoveredBar({
                                            date,
                                            x: rect.left + rect.width / 2,
                                            y: rect.top,
                                        });
                                    }}
                                    onMouseLeave={() => setHoveredBar(null)}
                                >
                                    {/* Capacity line indicator */}
                                    {cap > 0 && (
                                        <div
                                            className="absolute w-full z-10 pointer-events-none"
                                            style={{
                                                bottom: `${(cap / yMax) * CHART_HEIGHT}px`,
                                            }}
                                        >
                                            <div
                                                className="w-full border-t-2 border-dashed"
                                                style={{
                                                    borderColor: '#64748b',
                                                }}
                                            />
                                            {/* Small capacity pip */}
                                            <div
                                                className="absolute -top-[3px] -right-1 w-1.5 h-1.5 rounded-full"
                                                style={{ backgroundColor: '#64748b' }}
                                            />
                                        </div>
                                    )}

                                    {/* Stacked bar */}
                                    <div
                                        className="w-full rounded-t-md overflow-hidden transition-all duration-300 ease-out cursor-pointer relative group"
                                        style={{
                                            height: `${
                                                totalDmd > 0
                                                    ? Math.max(
                                                          (totalDmd / yMax) * CHART_HEIGHT,
                                                          4
                                                      )
                                                    : 0
                                            }px`,
                                        }}
                                    >
                                        {/* Utilization glow effect on hover */}
                                        <div
                                            className="absolute inset-0 opacity-0 group-hover:opacity-20 transition-opacity rounded-t-md"
                                            style={{ backgroundColor: utilizationColor }}
                                        />

                                        {/* Stacked segments (bottom to top) */}
                                        {craftCodes.map((craft) => {
                                            const hours = demand[craft]?.[date] ?? 0;
                                            if (hours <= 0) return null;
                                            const pct = totalDmd > 0 ? (hours / totalDmd) * 100 : 0;
                                            return (
                                                <div
                                                    key={craft}
                                                    className="w-full transition-all duration-300"
                                                    style={{
                                                        height: `${pct}%`,
                                                        backgroundColor: craftColorMap[craft]?.bg ?? '#94a3b8',
                                                        opacity: 0.85,
                                                    }}
                                                />
                                            );
                                        })}

                                        {/* Utilization border highlight */}
                                        <div
                                            className="absolute inset-0 rounded-t-md border-2 pointer-events-none"
                                            style={{
                                                borderColor: utilizationColor,
                                                opacity: 0.5,
                                            }}
                                        />
                                    </div>

                                    {/* Date label */}
                                    <div className="mt-2 text-center">
                                        <div
                                            className={`text-[10px] font-medium leading-tight ${
                                                isWknd ? 'text-slate-300' : 'text-slate-500'
                                            }`}
                                        >
                                            {formatDayLabel(date)}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* ── Tooltip ── */}
                    {tooltipData && hoveredBar && (
                        <div
                            className="fixed z-[200] bg-slate-900 text-white rounded-lg shadow-xl px-4 py-3 pointer-events-none"
                            style={{
                                left: `${hoveredBar.x}px`,
                                top: `${hoveredBar.y - TOOLTIP_OFFSET}px`,
                                transform: 'translate(-50%, -100%)',
                                minWidth: 200,
                            }}
                        >
                            {/* Tooltip arrow */}
                            <div className="absolute left-1/2 -translate-x-1/2 -bottom-1.5 w-3 h-3 bg-slate-900 rotate-45" />

                            <div className="text-xs font-bold text-white/90 mb-2 flex items-center gap-1.5">
                                <Calendar size={11} />
                                {formatDateFull(tooltipData.date)}
                            </div>

                            {/* Craft breakdown */}
                            <div className="space-y-1.5">
                                {tooltipData.crafts
                                    .filter((c) => c.hours > 0)
                                    .map((c) => (
                                        <div key={c.code} className="flex items-center justify-between gap-4">
                                            <div className="flex items-center gap-2">
                                                <div
                                                    className="w-2.5 h-2.5 rounded-sm shrink-0"
                                                    style={{ backgroundColor: c.color }}
                                                />
                                                <span className="text-[11px] text-white/80">{c.code}</span>
                                            </div>
                                            <span className="text-[11px] font-mono font-semibold text-white">
                                                {c.hours.toFixed(1)}h
                                            </span>
                                        </div>
                                    ))}
                            </div>

                            {/* Totals */}
                            <div className="mt-2 pt-2 border-t border-white/20 space-y-1">
                                <div className="flex items-center justify-between text-[11px]">
                                    <span className="text-white/60">Total Demand</span>
                                    <span className="font-mono font-bold text-white">
                                        {tooltipData.totalDemand.toFixed(1)}h
                                    </span>
                                </div>
                                <div className="flex items-center justify-between text-[11px]">
                                    <span className="text-white/60">Capacity</span>
                                    <span className="font-mono font-bold text-white">
                                        {tooltipData.capacity.toFixed(1)}h
                                    </span>
                                </div>
                                <div className="flex items-center justify-between text-[11px]">
                                    <span className="text-white/60">Utilization</span>
                                    <span
                                        className="font-mono font-bold"
                                        style={{
                                            color: getUtilizationColor(
                                                tooltipData.totalDemand,
                                                tooltipData.capacity
                                            ),
                                        }}
                                    >
                                        {tooltipData.capacity > 0
                                            ? `${((tooltipData.totalDemand / tooltipData.capacity) * 100).toFixed(0)}%`
                                            : '—'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* ── Legend ── */}
            <div className="px-6 pb-5 pt-2">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                    {/* Craft colors */}
                    {craftCodes.map((craft) => (
                        <div key={craft} className="flex items-center gap-2">
                            <div
                                className="w-3 h-3 rounded-sm shadow-sm"
                                style={{ backgroundColor: craftColorMap[craft]?.bg ?? '#94a3b8' }}
                            />
                            <span className="text-[11px] font-medium text-slate-600">{craft}</span>
                        </div>
                    ))}

                    {/* Capacity line legend */}
                    <div className="flex items-center gap-2 ml-auto">
                        <div className="w-5 border-t-2 border-dashed border-slate-500" />
                        <span className="text-[11px] font-medium text-slate-500">Capacity</span>
                    </div>

                    {/* Utilization color key */}
                    <div className="flex items-center gap-3 pl-3 border-l border-slate-200">
                        <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                            <span className="text-[10px] text-slate-400">&lt;80%</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                            <span className="text-[10px] text-slate-400">80-100%</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                            <span className="text-[10px] text-slate-400">&gt;100%</span>
                        </div>
                    </div>
                </div>

                {/* Summary stats */}
                {dates.length > 0 && (
                    <div className="flex items-center gap-4 mt-3 pt-3 border-t border-slate-100">
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                            <Activity size={11} />
                            <span>
                                {dates.length} day{dates.length !== 1 ? 's' : ''}
                            </span>
                        </div>
                        <div className="text-[11px] text-slate-400">
                            Avg demand:{' '}
                            <span className="font-semibold text-slate-600 font-mono">
                                {(
                                    Object.values(dailyDemand).reduce((a, b) => a + b, 0) /
                                    dates.length
                                ).toFixed(1)}
                                h/day
                            </span>
                        </div>
                        <div className="text-[11px] text-slate-400">
                            Peak:{' '}
                            <span className="font-semibold text-slate-600 font-mono">
                                {Math.max(...Object.values(dailyDemand), 0).toFixed(1)}h
                            </span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
