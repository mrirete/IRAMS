import React from 'react';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';
import { DollarSign } from 'lucide-react';

// ─────────────────────────────────────────────────────────
//  Mock Data — 6-month cost trend
// ─────────────────────────────────────────────────────────

interface MonthData {
    month: string;
    actual: number;
    budget: number;
}

const COST_DATA: MonthData[] = [
    { month: 'Sep', actual: 380000, budget: 420000 },
    { month: 'Oct', actual: 415000, budget: 420000 },
    { month: 'Nov', actual: 395000, budget: 420000 },
    { month: 'Dec', actual: 462000, budget: 420000 },
    { month: 'Jan', actual: 438000, budget: 420000 },
    { month: 'Feb', actual: 410000, budget: 420000 },
];

// ─────────────────────────────────────────────────────────
//  Component
// ─────────────────────────────────────────────────────────

export const CostTrendChart: React.FC = () => {
    const ytdTotal = COST_DATA.reduce((s, m) => s + m.actual, 0);
    const ytdBudget = COST_DATA.reduce((s, m) => s + m.budget, 0);
    const variance = ytdBudget - ytdTotal;
    const variancePct = ((variance / ytdBudget) * 100);
    const isUnderBudget = variance >= 0;

    const CustomTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            const d = payload[0].payload as MonthData;
            const diff = d.budget - d.actual;
            return (
                <div className="bg-slate-50 border border-slate-200 p-3 rounded-lg shadow-xl min-w-[180px]">
                    <p className="text-slate-700 text-sm font-medium mb-2 border-b border-slate-200 pb-1">{d.month} 2026</p>
                    <div className="space-y-1 text-xs">
                        <div className="flex justify-between"><span className="text-slate-500">Actual:</span><span className="text-accent-cyan font-bold">USD ${(d.actual / 1000).toFixed(0)}k</span></div>
                        <div className="flex justify-between"><span className="text-slate-500">Budget:</span><span className="text-slate-600 font-bold">USD ${(d.budget / 1000).toFixed(0)}k</span></div>
                        <div className="flex justify-between border-t border-slate-200 pt-1">
                            <span className="text-slate-500">Variance:</span>
                            <span className={`font-bold ${diff >= 0 ? 'text-accent-safe' : 'text-red-400'}`}>{diff >= 0 ? '+' : ''}${(diff / 1000).toFixed(0)}k</span>
                        </div>
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-accent-safe/10 rounded-lg text-accent-safe">
                        <DollarSign size={20} />
                    </div>
                    <div>
                        <h3 className="text-base font-semibold text-slate-800">Maintenance Cost Trend</h3>
                        <p className="text-xs text-slate-400">6-month rolling · Actual vs Budget</p>
                    </div>
                </div>
                <div className="flex items-center gap-3 text-xs">
                    <div className="text-right">
                        <p className="text-[10px] text-slate-400 uppercase">YTD Spend</p>
                        <p className="text-slate-800 font-bold font-mono">${(ytdTotal / 1000000).toFixed(2)}M</p>
                    </div>
                    <div className={`text-right px-2 py-1 rounded-lg border ${isUnderBudget ? 'bg-accent-safe/10 border-accent-safe/30' : 'bg-red-500/10 border-red-500/30'}`}>
                        <p className="text-[10px] text-slate-400 uppercase">Variance</p>
                        <p className={`font-bold font-mono ${isUnderBudget ? 'text-accent-safe' : 'text-red-400'}`}>
                            {isUnderBudget ? '▼' : '▲'} ${(Math.abs(variance) / 1000).toFixed(0)}k ({variancePct.toFixed(1)}%)
                        </p>
                    </div>
                </div>
            </div>

            <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={COST_DATA} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                        <defs>
                            <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                            </linearGradient>
                        </defs>

                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} vertical={false} />

                        <XAxis dataKey="month" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                        <YAxis
                            stroke="#64748b" fontSize={10} tickLine={false} axisLine={false}
                            tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                        />

                        <Tooltip content={<CustomTooltip />} />

                        {/* Budget line */}
                        <Area
                            type="monotone"
                            dataKey="budget"
                            stroke="#64748b"
                            strokeWidth={1.5}
                            strokeDasharray="5 3"
                            fill="none"
                            isAnimationActive={true}
                        />

                        {/* Actual spend */}
                        <Area
                            type="monotone"
                            dataKey="actual"
                            stroke="#06b6d4"
                            strokeWidth={2.5}
                            fill="url(#costGradient)"
                            isAnimationActive={true}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 mt-2 text-[10px] text-slate-400">
                <span className="flex items-center gap-1"><div className="w-4 h-0.5 bg-accent-cyan rounded" /> Actual Spend</span>
                <span className="flex items-center gap-1"><div className="w-4 h-0.5 bg-brand-500 rounded" style={{ borderTop: '1px dashed #64748b' }} /> Budget Ceiling</span>
            </div>
        </div>
    );
};
