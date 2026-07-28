/**
 * BriefingCharts — the briefing's illustrations, computed live (lib/
 * briefingCharts), never parsed from the agent's prose.
 *
 * Dataviz method applied deliberately:
 *  - magnitude of ONE measure → single hue (primary-500 #3E6BEF, validated
 *    ≥3:1 vs the light surface) — no rainbow, identity carried by text labels;
 *  - one axis only — the Pareto's cumulative % rides as muted direct labels,
 *    never a second scale;
 *  - rounded data-ends anchored to the baseline, recessive dashed grid,
 *    hover tooltip on every mark, text in text tokens (never series color).
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip, Cell, LabelList,
} from 'recharts';
import type { BriefingAnalytics, MonthPoint, ParetoRow } from '../../lib/briefingCharts';

const HUE = '#3E6BEF';        // primary-500 — the one data hue
const HUE_SOFT = '#9FBAFC';   // primary-300 — non-focus months
const INK_MUTED = '#94a3b8';  // slate-400 — axis ticks, direct labels
const GRID = '#f1f5f9';       // slate-100 — recessive

const TooltipCard: React.FC<{ title: string; value: string; sub?: string }> = ({ title, value, sub }) => (
    <div className="rounded-lg border border-slate-200 bg-white shadow-md px-2.5 py-1.5">
        <div className="text-[10.5px] font-medium text-slate-500">{title}</div>
        <div className="text-[12.5px] font-semibold text-slate-800 tabular-nums">{value}</div>
        {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
);

/** Maintenance spend by month, trailing 12 — current month emphasised. */
export const SpendTrendChart: React.FC<{
    monthly: MonthPoint[];
    formatCurrency: (n: number) => string;
}> = ({ monthly, formatCurrency }) => (
    <div className="mt-3">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-slate-400 mb-1.5">
            Maintenance spend · trailing 12 months
        </div>
        <ResponsiveContainer width="100%" height={110}>
            <BarChart data={monthly} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap="28%">
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="label" tickLine={false} axisLine={false}
                    tick={{ fill: INK_MUTED, fontSize: 9.5 }} interval={1} />
                <YAxis hide />
                <Tooltip
                    cursor={{ fill: 'rgba(148,163,184,0.08)' }}
                    content={({ active, payload }) => active && payload?.length
                        ? <TooltipCard title={String((payload[0].payload as MonthPoint).label)} value={formatCurrency(Number(payload[0].value) || 0)} />
                        : null}
                />
                <Bar dataKey="cost" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false}>
                    {monthly.map((m, i) => (
                        <Cell key={m.key} fill={i === monthly.length - 1 ? HUE : HUE_SOFT} />
                    ))}
                </Bar>
            </BarChart>
        </ResponsiveContainer>
    </div>
);

/** Top cost drivers, 12-month window; cumulative % as muted direct labels. */
export const ParetoChart: React.FC<{
    pareto: ParetoRow[];
    formatCurrency: (n: number) => string;
}> = ({ pareto, formatCurrency }) => {
    const navigate = useNavigate();
    return (
        <div className="mt-3">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-slate-400 mb-1.5">
                Cost concentration · top {pareto.length} assets, 12 months
            </div>
            <ResponsiveContainer width="100%" height={pareto.length * 34 + 8}>
                <BarChart data={pareto} layout="vertical" margin={{ top: 0, right: 44, bottom: 0, left: 0 }} barCategoryGap="26%">
                    <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke={GRID} />
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="tag" width={62} tickLine={false} axisLine={false}
                        tick={{ fill: '#475569', fontSize: 10.5, fontFamily: 'ui-monospace, monospace', fontWeight: 600 }} />
                    <Tooltip
                        cursor={{ fill: 'rgba(148,163,184,0.08)' }}
                        content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const p = payload[0].payload as ParetoRow;
                            return <TooltipCard title={`${p.tag} · ${p.name}`} value={formatCurrency(p.cost)} sub={`${p.cumPct}% of spend, cumulative · click to open`} />;
                        }}
                    />
                    <Bar dataKey="cost" fill={HUE} radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false}
                        cursor="pointer" onClick={(d: unknown) => {
                            const row = d as { assetId?: string };
                            if (row?.assetId) navigate(`/assets?id=${row.assetId}`);
                        }}>
                        <LabelList dataKey="cumPct" position="right"
                            formatter={(v: React.ReactNode) => `${v}%`}
                            style={{ fill: INK_MUTED, fontSize: 9.5, fontVariantNumeric: 'tabular-nums' }} />
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
            <div className="text-[10px] text-slate-400 mt-0.5">Right-hand figure = cumulative share of 12-month spend. Click a bar to open the asset.</div>
        </div>
    );
};

/** Charts slotted under a briefing section, keyed by section kind. */
export const SectionCharts: React.FC<{
    sectionKey: string;
    analytics: BriefingAnalytics | null;
    formatCurrency: (n: number) => string;
}> = ({ sectionKey, analytics, formatCurrency }) => {
    if (!analytics) return null;
    if (sectionKey === 'load' && analytics.monthly.some((m) => m.cost > 0)) {
        return <SpendTrendChart monthly={analytics.monthly} formatCurrency={formatCurrency} />;
    }
    if (sectionKey === 'badActors' && analytics.pareto.length >= 2) {
        return <ParetoChart pareto={analytics.pareto} formatCurrency={formatCurrency} />;
    }
    return null;
};

export default SectionCharts;
