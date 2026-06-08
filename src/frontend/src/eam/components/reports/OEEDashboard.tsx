import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, ComposedChart, Area
} from 'recharts';
import {
  Gauge, AlertTriangle, TrendingUp, Factory, Clock,
  CheckCircle2, Loader2, Plus
} from 'lucide-react';
import { ReportChartCard } from './ReportChartCard';
import { ReportKPICard } from './ReportKPICard';
import { ReportDataTable, TableColumn } from './ReportDataTable';
import { ProductionLogEntry } from './ProductionLogEntry';

const COLORS = {
  blue: '#3b82f6', cyan: '#06b6d4', emerald: '#10b981', amber: '#f59e0b',
  red: '#ef4444', purple: '#8b5cf6', pink: '#ec4899', slate: '#64748b',
  indigo: '#6366f1', teal: '#14b8a6',
};

const LOSS_COLORS: Record<string, string> = {
  planned_stop: COLORS.blue,
  unplanned_stop: COLORS.red,
  minor_stop: COLORS.amber,
  speed_loss: COLORS.purple,
  startup_reject: COLORS.pink,
  production_reject: COLORS.red,
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 shadow-xl">
      <p className="text-xs font-semibold text-slate-400 mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="text-xs font-bold" style={{ color: p.color }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}
          {p.name !== 'Output' ? '%' : ''}
        </p>
      ))}
    </div>
  );
};

interface OEEDashboardProps {
  dateRange?: { from: Date; to: Date };
  onNavigate?: (path: string) => void;
}

export const OEEDashboard: React.FC<OEEDashboardProps> = ({ dateRange, onNavigate }) => {
  const [showLogEntry, setShowLogEntry] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);

  const fromDate = dateRange?.from
    ? dateRange.from.toISOString().split('T')[0]
    : new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const toDate = dateRange?.to
    ? dateRange.to.toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0];

  // Plant-wide OEE
  const { data: plantOEE, isLoading: loadingPlant } = useQuery({
    queryKey: ['plant-oee', fromDate, toDate],
    queryFn: async () => {
      const { data } = await supabase.rpc('get_plant_oee', {
        p_from: fromDate,
        p_to: toDate,
      });
      return data?.[0] || null;
    },
  });

  // Per-asset OEE
  const { data: assetOEEs = [], isLoading: loadingAssets } = useQuery({
    queryKey: ['report-oee', fromDate, toDate],
    queryFn: async () => {
      const { data } = await supabase.rpc('compute_oee', {
        p_from: fromDate,
        p_to: toDate,
      });
      return data || [];
    },
  });

  // Six Big Losses
  const { data: losses = [] } = useQuery({
    queryKey: ['oee-losses', selectedAsset, fromDate, toDate],
    queryFn: async () => {
      const params: any = { p_from: fromDate, p_to: toDate };
      if (selectedAsset) params.p_asset_id = selectedAsset;
      const { data } = await supabase.rpc('get_oee_losses', params);
      return data || [];
    },
  });

  // Production log history
  const { data: recentLogs = [] } = useQuery({
    queryKey: ['production-logs', fromDate, toDate],
    queryFn: async () => {
      const { data } = await supabase
        .from('production_logs')
        .select('*, assets!inner(tag, name)')
        .gte('shift_date', fromDate)
        .lte('shift_date', toDate)
        .order('shift_date', { ascending: false })
        .limit(50);
      return data || [];
    },
  });

  // OEE trend (daily aggregate)
  const oeeTrend = useMemo(() => {
    if (!recentLogs.length) return [];
    const byDate: Record<string, { planned: number; actual: number; total: number; good: number }> = {};
    recentLogs.forEach((l: any) => {
      const d = l.shift_date;
      if (!byDate[d]) byDate[d] = { planned: 0, actual: 0, total: 0, good: 0 };
      byDate[d].planned += Number(l.planned_run_time_min) || 0;
      byDate[d].actual += Number(l.actual_run_time_min) || 0;
      byDate[d].total += Number(l.total_output) || 0;
      byDate[d].good += Number(l.good_output) || 0;
    });
    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => {
        const avail = v.planned > 0 ? (v.actual / v.planned) * 100 : 0;
        const quality = v.total > 0 ? (v.good / v.total) * 100 : 0;
        return {
          date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          Availability: Number(avail.toFixed(1)),
          Quality: Number(quality.toFixed(1)),
          Output: v.total,
        };
      });
  }, [recentLogs]);

  // A×P×Q breakdown for the donut chart
  const apqBreakdown = useMemo(() => {
    if (!plantOEE) return [];
    return [
      { name: 'Availability', value: Number(plantOEE.availability_pct) || 0, color: COLORS.emerald },
      { name: 'Performance', value: Number(plantOEE.performance_pct) || 0, color: COLORS.blue },
      { name: 'Quality', value: Number(plantOEE.quality_pct) || 0, color: COLORS.cyan },
    ];
  }, [plantOEE]);

  // Losses waterfall data
  const lossWaterfall = useMemo(() => {
    return losses.map((l: any) => ({
      name: l.loss_label || l.loss_category,
      minutes: Number(l.total_minutes) || 0,
      events: Number(l.event_count) || 0,
      fill: LOSS_COLORS[l.loss_category] || COLORS.slate,
    }));
  }, [losses]);

  // Asset OEE table columns
  const oeeColumns: TableColumn[] = [
    { key: 'asset_tag', label: 'Asset Tag', width: '100px' },
    { key: 'asset_name', label: 'Asset Name' },
    { key: 'availability_pct', label: 'Avail %', format: 'percent', dataBar: true,
      ragThresholds: { green: 90, amber: 75 } },
    { key: 'performance_pct', label: 'Perf %', format: 'percent', dataBar: true,
      ragThresholds: { green: 85, amber: 65 } },
    { key: 'quality_pct', label: 'Quality %', format: 'percent', dataBar: true,
      ragThresholds: { green: 95, amber: 85 } },
    { key: 'oee_pct', label: 'OEE %', format: 'percent', dataBar: true,
      ragThresholds: { green: 85, amber: 65 } },
    { key: 'total_output', label: 'Output', format: 'number' },
    { key: 'defect_count', label: 'Defects', format: 'number' },
  ];

  const getOEERag = (val: number) => val >= 85 ? 'green' : val >= 65 ? 'amber' : 'red';

  const isLoading = loadingPlant || loadingAssets;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-cyan-400" size={32} />
        <span className="ml-3 text-slate-400 text-sm">Loading OEE data...</span>
      </div>
    );
  }

  const hasData = assetOEEs.length > 0 && plantOEE;

  return (
    <div className="space-y-6">
      {/* OEE Dashboard Header */}
      <div className="bg-slate-800 border border-slate-600 border-l-4 border-l-cyan-400 rounded-xl px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-cyan-500 rounded-lg flex items-center justify-center shadow-md">
            <Gauge size={22} className="text-white" />
          </div>
          <div>
            <h3 className="text-lg font-extrabold text-white tracking-tight">OEE Dashboard</h3>
            <p className="text-xs text-slate-400 mt-0.5 font-medium">
              ISO 22400-2 · <span className="text-white font-semibold">{fromDate}</span> → <span className="text-white font-semibold">{toDate}</span>
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowLogEntry(!showLogEntry)}
          className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400
            rounded-lg text-sm text-white font-bold shadow-lg shadow-amber-500/25 transition flex items-center gap-2"
        >
          <Plus size={16} /> Log Production
        </button>
      </div>

      {showLogEntry && (
        <ProductionLogEntry
          onSuccess={() => setShowLogEntry(false)}
          onCancel={() => setShowLogEntry(false)}
        />
      )}

      {!hasData ? (
        <div className="text-center py-12 bg-slate-900/40 border border-slate-700/50 rounded-xl">
          <Factory size={48} className="mx-auto text-slate-600 mb-4" />
          <h4 className="text-lg font-bold text-slate-400 mb-2">No Production Data Yet</h4>
          <p className="text-sm text-slate-500 max-w-md mx-auto mb-4">
            OEE requires production log data. Click "Log Production" above to start recording
            shift-level output, quality, and downtime data for your assets.
          </p>
          <button
            onClick={() => setShowLogEntry(true)}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm text-white font-semibold transition"
          >
            <Plus size={14} className="inline mr-1" />
            Create First Production Log
          </button>
        </div>
      ) : (
        <>
          {/* KPI Row */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <ReportKPICard
              title="Plant OEE"
              value={Number(plantOEE.oee_pct) || 0}
              format="percent"
              target={85}
              targetLabel="World-class: 85%"
              icon={<Gauge size={14} />}
              ragStatus={getOEERag(Number(plantOEE.oee_pct))}
            />
            <ReportKPICard
              title="Availability"
              value={Number(plantOEE.availability_pct) || 0}
              format="percent"
              icon={<Clock size={14} />}
              ragStatus={Number(plantOEE.availability_pct) >= 90 ? 'green' : Number(plantOEE.availability_pct) >= 75 ? 'amber' : 'red'}
            />
            <ReportKPICard
              title="Performance"
              value={Number(plantOEE.performance_pct) || 0}
              format="percent"
              icon={<TrendingUp size={14} />}
              ragStatus={Number(plantOEE.performance_pct) >= 85 ? 'green' : Number(plantOEE.performance_pct) >= 65 ? 'amber' : 'red'}
            />
            <ReportKPICard
              title="Quality"
              value={Number(plantOEE.quality_pct) || 0}
              format="percent"
              icon={<CheckCircle2 size={14} />}
              ragStatus={Number(plantOEE.quality_pct) >= 95 ? 'green' : Number(plantOEE.quality_pct) >= 85 ? 'amber' : 'red'}
            />
            <ReportKPICard
              title="Total Output"
              value={Number(plantOEE.total_output) || 0}
              format="number"
              icon={<Factory size={14} />}
              ragStatus="neutral"
            />
            <ReportKPICard
              title="Defects"
              value={Number(plantOEE.defect_count) || 0}
              format="number"
              icon={<AlertTriangle size={14} />}
              ragStatus={Number(plantOEE.defect_count) <= 5 ? 'green' : Number(plantOEE.defect_count) <= 20 ? 'amber' : 'red'}
            />
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* A × P × Q Breakdown Donut */}
            <ReportChartCard title="A × P × Q Breakdown" subtitle="Availability × Performance × Quality">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={apqBreakdown}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}%`}
                  >
                    {apqBreakdown.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </ReportChartCard>

            {/* OEE Trend */}
            <ReportChartCard title="OEE Trend" subtitle="Daily Availability, Quality & Output">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={oeeTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} />
                  <YAxis yAxisId="pct" domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 10 }} />
                  <YAxis yAxisId="output" orientation="right" tick={{ fill: '#64748b', fontSize: 10 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area yAxisId="pct" type="monotone" dataKey="Availability" stroke={COLORS.emerald} fill={COLORS.emerald} fillOpacity={0.15} />
                  <Area yAxisId="pct" type="monotone" dataKey="Quality" stroke={COLORS.cyan} fill={COLORS.cyan} fillOpacity={0.15} />
                  <Bar yAxisId="output" dataKey="Output" fill={COLORS.blue} fillOpacity={0.4} radius={[2, 2, 0, 0]} />
                </ComposedChart>
              </ResponsiveContainer>
            </ReportChartCard>
          </div>

          {/* Six Big Losses Waterfall */}
          {lossWaterfall.length > 0 && (
            <ReportChartCard title="Six Big Losses" subtitle="TPM Loss Classification (minutes)">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={lossWaterfall} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} />
                  <YAxis dataKey="name" type="category" width={160} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 shadow-xl">
                          <p className="text-xs font-bold text-white">{d.name}</p>
                          <p className="text-xs text-slate-400">{d.minutes} min · {d.events} events</p>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="minutes" radius={[0, 4, 4, 0]}>
                    {lossWaterfall.map((entry: any, i: number) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ReportChartCard>
          )}

          {/* Per-Asset OEE Table */}
          <ReportDataTable
            title="OEE by Asset"
            columns={oeeColumns}
            data={assetOEEs}
            exportFilename="ERS_OEE_Report.csv"
            onRowClick={(row: any) => {
              setSelectedAsset(row.asset_id);
              onNavigate?.(`/assets?id=${row.asset_id}`);
            }}
          />
        </>
      )}
    </div>
  );
};

export default OEEDashboard;
