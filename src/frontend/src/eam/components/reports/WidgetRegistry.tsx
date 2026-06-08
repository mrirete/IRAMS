import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, Legend,
} from 'recharts';
import { Wrench, CheckCircle2, Clock, Gauge, Activity, AlertTriangle, DollarSign, Package } from 'lucide-react';
import { ReportKPICard } from './ReportKPICard';

// ── Color Palette (mirrors Reports.tsx) ─────────────────
const COLORS = {
  blue: '#3b82f6', cyan: '#06b6d4', emerald: '#10b981', amber: '#f59e0b',
  red: '#ef4444', purple: '#8b5cf6', pink: '#ec4899', slate: '#64748b',
};
const PIE_COLORS = [COLORS.emerald, COLORS.blue, COLORS.amber, COLORS.red, COLORS.purple, COLORS.cyan];

// ── Custom Tooltip (shared) ─────────────────────────────
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-xl">
      <p className="text-xs font-semibold text-slate-500 mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="text-xs font-bold" style={{ color: p.color }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toLocaleString() : p.value}
        </p>
      ))}
    </div>
  );
};

// ── Widget Definition ───────────────────────────────────
export interface WidgetDef {
  key: string;
  type: 'chart' | 'kpi';
  label: string;
  category: 'Overview' | 'Work Orders' | 'Asset Health' | 'Cost & Parts';
  defaultW: number;
  defaultH: number;
  render: (data: WidgetData) => React.ReactNode;
}

// Data passed to every widget's render function
export interface WidgetData {
  woTrend: any[];
  backlogAging: any[];
  woByType: any[];
  woByPriority: any[];
  pmCompliance: any[];
  costData: any[];
  downtimeByAsset: any[];
  mtbfMttrByAsset: any[];
  downtimeReasons: any[];
  // Scalars
  totalWOs: number;
  completedWOs: number;
  pmRatio: number;
  onTimeRate: number;
  overdueWOs: number;
  totalCost: number;
  avgCostPerWO: number;
  totalDowntimeHrs: number;
  badActorCount: number;
  // Objects
  kpis: { avg_mttr_hrs: number; availability_pct: number; total_cost: number };
  oeeData: { availability: number; performance: number; quality: number; oee: number };
}

// ── Registry ────────────────────────────────────────────
export const WIDGET_REGISTRY: WidgetDef[] = [
  // ── Overview Charts ──
  {
    key: 'wo-trend', type: 'chart', label: 'Work Order Trend', category: 'Overview',
    defaultW: 6, defaultH: 1,
    render: (d) => (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={d.woTrend}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11 }} />
          <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Area type="monotone" dataKey="Preventive" stackId="1" stroke={COLORS.emerald} fill={COLORS.emerald} fillOpacity={0.3} />
          <Area type="monotone" dataKey="Corrective" stackId="1" stroke={COLORS.red} fill={COLORS.red} fillOpacity={0.3} />
        </AreaChart>
      </ResponsiveContainer>
    ),
  },
  {
    key: 'backlog-aging', type: 'chart', label: 'Backlog Aging', category: 'Overview',
    defaultW: 6, defaultH: 1,
    render: (d) => (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={d.backlogAging} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis type="number" tick={{ fill: '#64748b', fontSize: 11 }} />
          <YAxis dataKey="age" type="category" tick={{ fill: '#64748b', fontSize: 11 }} width={60} />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="count" name="Open WOs" radius={[0, 4, 4, 0]}>
            {d.backlogAging.map((_: any, i: number) => (
              <Cell key={i} fill={[COLORS.emerald, COLORS.amber, COLORS.red, '#dc2626'][i]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    ),
  },

  // ── Work Order Charts ──
  {
    key: 'pm-vs-cm', type: 'chart', label: 'PM vs CM Ratio', category: 'Work Orders',
    defaultW: 6, defaultH: 1,
    render: (d) => (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={[
              { name: 'Preventive', value: Math.round(d.totalWOs * d.pmRatio / 100) },
              { name: 'Corrective', value: Math.round(d.totalWOs * (100 - d.pmRatio) / 100) },
            ]}
            cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={3} dataKey="value"
            label={({ name, percent = 0 }) => `${name} ${(percent * 100).toFixed(0)}%`}
          >
            <Cell fill={COLORS.emerald} /><Cell fill={COLORS.red} />
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>
    ),
  },
  {
    key: 'wo-by-type', type: 'chart', label: 'WOs by Type', category: 'Work Orders',
    defaultW: 6, defaultH: 1,
    render: (d) => (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={d.woByType} cx="50%" cy="50%" outerRadius={90} dataKey="value"
            label={({ name, percent = 0 }) => `${name} ${(percent * 100).toFixed(0)}%`}>
            {d.woByType.map((_: any, i: number) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>
    ),
  },
  {
    key: 'pm-compliance', type: 'chart', label: 'PM Plan Compliance', category: 'Work Orders',
    defaultW: 6, defaultH: 1,
    render: (d) => (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={d.pmCompliance}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11 }} />
          <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="Scheduled" fill={COLORS.blue} radius={[4, 4, 0, 0]} />
          <Bar dataKey="Executed" fill={COLORS.emerald} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    ),
  },

  // ── Asset Health Charts ──
  {
    key: 'downtime-by-asset', type: 'chart', label: 'Downtime by Asset', category: 'Asset Health',
    defaultW: 12, defaultH: 1,
    render: (d) => (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={d.downtimeByAsset} layout="vertical" margin={{ left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis type="number" tick={{ fill: '#64748b', fontSize: 11 }} />
          <YAxis dataKey="asset" type="category" tick={{ fill: '#64748b', fontSize: 11 }} width={90} />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="Unplanned" stackId="a" fill={COLORS.red} fillOpacity={0.8} />
          <Bar dataKey="Planned" stackId="a" fill={COLORS.blue} fillOpacity={0.4} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    ),
  },
  {
    key: 'mtbf-mttr', type: 'chart', label: 'MTBF vs MTTR', category: 'Asset Health',
    defaultW: 6, defaultH: 1,
    render: (d) => (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={d.mtbfMttrByAsset}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="asset" tick={{ fill: '#64748b', fontSize: 10 }} />
          <YAxis yAxisId="left" tick={{ fill: '#64748b', fontSize: 11 }} />
          <YAxis yAxisId="right" orientation="right" tick={{ fill: '#64748b', fontSize: 11 }} />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar yAxisId="left" dataKey="MTBF" name="MTBF (days)" fill={COLORS.blue} radius={[4, 4, 0, 0]} />
          <Bar yAxisId="right" dataKey="MTTR" name="MTTR (hrs)" fill={COLORS.amber} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    ),
  },
  {
    key: 'downtime-by-reason', type: 'chart', label: 'Downtime by Reason', category: 'Asset Health',
    defaultW: 6, defaultH: 1,
    render: (d) => (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={d.downtimeReasons} cx="50%" cy="50%" innerRadius={45} outerRadius={90} paddingAngle={3}
            dataKey="hours" nameKey="reason"
            label={({ name, percent = 0 }: any) => `${String(name).slice(0, 12)} ${(percent * 100).toFixed(0)}%`}>
            {d.downtimeReasons.map((r: any, i: number) => <Cell key={i} fill={r.color || PIE_COLORS[i % PIE_COLORS.length]} />)}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>
    ),
  },

  // ── Cost & Parts Charts ──
  {
    key: 'cost-trend', type: 'chart', label: 'Cost Trend', category: 'Cost & Parts',
    defaultW: 6, defaultH: 1,
    render: (d) => (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={d.costData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11 }} />
          <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Area type="monotone" dataKey="Labor" stackId="1" stroke={COLORS.blue} fill={COLORS.blue} fillOpacity={0.3} />
          <Area type="monotone" dataKey="Parts" stackId="1" stroke={COLORS.amber} fill={COLORS.amber} fillOpacity={0.3} />
        </AreaChart>
      </ResponsiveContainer>
    ),
  },

  // ── KPI Widgets ──
  {
    key: 'total-wos-kpi', type: 'kpi', label: 'Total WOs', category: 'Overview',
    defaultW: 3, defaultH: 1,
    render: (d) => <ReportKPICard title="Total WOs" value={d.totalWOs} format="number" icon={<Wrench size={14} />} ragStatus="neutral" />,
  },
  {
    key: 'pm-compliance-kpi', type: 'kpi', label: 'PM Compliance', category: 'Overview',
    defaultW: 3, defaultH: 1,
    render: (d) => <ReportKPICard title="PM Compliance" value={d.pmRatio} format="percent" target={Math.round(d.pmRatio)} targetLabel="Target: 80%" icon={<CheckCircle2 size={14} />} ragStatus={d.pmRatio >= 80 ? 'green' : d.pmRatio >= 60 ? 'amber' : 'red'} />,
  },
  {
    key: 'mttr-kpi', type: 'kpi', label: 'MTTR', category: 'Overview',
    defaultW: 3, defaultH: 1,
    render: (d) => <ReportKPICard title="MTTR" value={d.kpis.avg_mttr_hrs || 0} format="hours" icon={<Clock size={14} />} ragStatus={d.kpis.avg_mttr_hrs <= 4 ? 'green' : d.kpis.avg_mttr_hrs <= 8 ? 'amber' : 'red'} />,
  },
  {
    key: 'availability-kpi', type: 'kpi', label: 'Availability', category: 'Overview',
    defaultW: 3, defaultH: 1,
    render: (d) => <ReportKPICard title="Availability" value={d.kpis.availability_pct || 0} format="percent" target={Math.round(d.kpis.availability_pct || 0)} targetLabel="Target: 95%" icon={<Gauge size={14} />} ragStatus={(d.kpis.availability_pct || 0) >= 95 ? 'green' : (d.kpis.availability_pct || 0) >= 85 ? 'amber' : 'red'} />,
  },
  {
    key: 'oee-kpi', type: 'kpi', label: 'OEE', category: 'Asset Health',
    defaultW: 3, defaultH: 1,
    render: (d) => <ReportKPICard title="OEE" value={Number((d.oeeData.oee * 100).toFixed(1))} format="percent" target={Math.round(d.oeeData.oee * 100)} targetLabel="Target: 85%" icon={<Activity size={14} />} ragStatus={d.oeeData.oee >= 0.85 ? 'green' : d.oeeData.oee >= 0.65 ? 'amber' : 'red'} />,
  },
  {
    key: 'downtime-kpi', type: 'kpi', label: 'Total Downtime', category: 'Asset Health',
    defaultW: 3, defaultH: 1,
    render: (d) => <ReportKPICard title="Total Downtime" value={d.totalDowntimeHrs} format="hours" icon={<AlertTriangle size={14} />} ragStatus={d.totalDowntimeHrs <= 200 ? 'green' : d.totalDowntimeHrs <= 500 ? 'amber' : 'red'} />,
  },
  {
    key: 'total-cost-kpi', type: 'kpi', label: 'Total Cost', category: 'Cost & Parts',
    defaultW: 3, defaultH: 1,
    render: (d) => <ReportKPICard title="Total Cost" value={d.totalCost} format="currency" icon={<DollarSign size={14} />} ragStatus="neutral" />,
  },
  {
    key: 'bad-actors-kpi', type: 'kpi', label: 'Bad Actors', category: 'Asset Health',
    defaultW: 3, defaultH: 1,
    render: (d) => <ReportKPICard title="Bad Actors" value={d.badActorCount} format="number" icon={<Package size={14} />} ragStatus={d.badActorCount <= 3 ? 'green' : d.badActorCount <= 7 ? 'amber' : 'red'} />,
  },
];

export const getWidgetByKey = (key: string): WidgetDef | undefined =>
  WIDGET_REGISTRY.find(w => w.key === key);

export const getWidgetsByCategory = () => {
  const grouped: Record<string, WidgetDef[]> = {};
  WIDGET_REGISTRY.forEach(w => {
    if (!grouped[w.category]) grouped[w.category] = [];
    grouped[w.category].push(w);
  });
  return grouped;
};
