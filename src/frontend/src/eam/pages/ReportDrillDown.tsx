import React, { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, PieChart, Pie, Cell
} from 'recharts';
import {
  ArrowLeft, Download, FileSpreadsheet, Clock, Activity, Gauge, AlertTriangle,
  Wrench, TrendingUp, CalendarCheck, List, ChevronRight
} from 'lucide-react';
import { ReportDataTable, TableColumn } from '../components/reports/ReportDataTable';
import { exportXLSX, exportCSV } from '../utils/reportExport';
import { isOpenWo } from '../../lib/woState';
import { isPreventiveWoType } from '../lib/workOrder';
import { fetchDowntimeRates, unreliabilityCost, fmtMoney, type DowntimeRates } from '../../lib/downtimeCost';

const COLORS = {
  blue: '#3b82f6', cyan: '#06b6d4', emerald: '#10b981', amber: '#f59e0b',
  red: '#ef4444', purple: '#8b5cf6', pink: '#ec4899', slate: '#64748b',
  indigo: '#6366f1', teal: '#14b8a6',
};

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

type DrillType = 'downtime' | 'mtbf-mttr' | 'availability' | 'downtime-by-asset' | 'downtime-by-reason' | 'oee' | 'backlog' | 'pm-compliance';

const DRILL_CONFIG: Record<DrillType, { title: string; description: string; icon: React.ReactNode }> = {
  'downtime':          { title: 'Total Downtime Analysis',       description: 'Planned vs Unplanned downtime over time with detailed asset-level breakdown',     icon: <Clock size={20} /> },
  'mtbf-mttr':         { title: 'MTBF & MTTR Trend Analysis',    description: 'Mean Time Between Failures and Mean Time To Repair trends over time',              icon: <TrendingUp size={20} /> },
  'availability':      { title: 'Availability Over Time',         description: 'Asset availability percentage trend with target threshold',                         icon: <Gauge size={20} /> },
  'downtime-by-asset': { title: 'Downtime by Asset',              description: 'Planned vs Unplanned downtime per asset — identify your worst performers',          icon: <AlertTriangle size={20} /> },
  'downtime-by-reason':{ title: 'Downtime by Reason',             description: 'Root cause categorization of downtime events',                                     icon: <Wrench size={20} /> },
  'oee':               { title: 'OEE Breakdown',                  description: 'Overall Equipment Effectiveness — Availability × Performance × Quality',            icon: <Activity size={20} /> },
  'backlog':           { title: 'Backlog Aging Analysis',         description: 'Open work orders grouped by age bucket with detailed breakdown',                    icon: <List size={20} /> },
  'pm-compliance':     { title: 'PM Plan Compliance',             description: 'Scheduled vs Executed preventive maintenance by month',                            icon: <CalendarCheck size={20} /> },
};

export const ReportDrillDown: React.FC = () => {
  const navigate = useNavigate();
  const { reportType } = useParams<{ reportType: string }>();
  const type = (reportType || 'downtime') as DrillType;
  const config = DRILL_CONFIG[type] || DRILL_CONFIG['downtime'];

  // Production-loss rates (RF-01): per-asset from asset_financials, tenant
  // default from companies — lets downtime views speak the owner's language.
  const { data: rates } = useQuery<DowntimeRates>({
    queryKey: ['drilldown-downtime-rates'],
    queryFn: fetchDowntimeRates,
  });

  const { data: assets = [] } = useQuery({
    queryKey: ['drilldown-assets'],
    queryFn: async () => {
      const { data } = await supabase.from('assets').select('*');
      return data || [];
    },
  });

  // Canonical per-asset reliability (0234) — computed from 12 months of
  // corrective work, the same definition Reports and the agents use.
  const { data: assetReliability = [] } = useQuery({
    queryKey: ['drilldown-asset-reliability'],
    queryFn: async () => {
      const { data } = await supabase
        .from('sem_asset_reliability')
        .select('asset_id, asset_tag, criticality, failures_12mo, mtbf_days, mttr_hours, availability_pct, downtime_coverage_pct, failures_total, mtbf_hours_lifetime, mttr_hours_lifetime, last_failure_at');
      return data || [];
    },
  });

  // Fetch work orders for expandable row traceability
  const { data: workOrders = [] } = useQuery({
    queryKey: ['drilldown-work-orders'],
    queryFn: async () => {
      const { data } = await supabase
        .from('work_orders')
        .select('id, wo_number, asset_id, created_at, closed_at, due_date, type, title, failure_mode, actual_downtime_hrs, frozen_labor_cost, frozen_material_cost, status, priority_code')
        .neq('status', 'CANCELLED')
        .order('created_at', { ascending: false });
      return data || [];
    },
  });

  // Derive downtime data from assets
  // Planned vs unplanned downtime from the work orders themselves —
  // corrective is unplanned, preventive is planned. Previously the total was
  // synthesised from frozen columns and split 65/35 by decree.
  const downtimeByAsset = useMemo(() => {
    const byAsset = new Map<string, { name: string; tag: string; unplanned: number; planned: number }>();
    for (const w of workOrders as any[]) {
      const hrs = Number(w.actual_downtime_hrs) || 0;
      if (hrs <= 0 || !w.asset_id) continue;
      const a = (assets as any[]).find((x: any) => x.id === w.asset_id);
      const key = w.asset_id;
      const cur = byAsset.get(key) ?? { name: a?.name ?? key, tag: a?.tag ?? key, unplanned: 0, planned: 0 };
      if (String(w.type ?? '').toUpperCase() === 'CM') cur.unplanned += hrs; else cur.planned += hrs;
      byAsset.set(key, cur);
    }
    return [...byAsset.entries()]
      .map(([assetId, r]) => {
        // Unplanned hours in the owner's language (RF-01): rate-labelled
        // estimate when a rate exists; an honest em-dash when none does.
        const loss = rates ? unreliabilityCost(rates, assetId, r.unplanned) : null;
        return {
          asset: r.tag, name: r.name,
          Unplanned: Math.round(r.unplanned), Planned: Math.round(r.planned),
          Total: Math.round(r.unplanned + r.planned),
          est_loss: loss ? Math.round(loss.cost) : null,
          est_loss_fmt: loss ? `${fmtMoney(loss.cost)} (${loss.label})` : '—',
        };
      })
      .sort((x, y) => y.Total - x.Total)
      .slice(0, 12);
  }, [assets, workOrders, rates]);

  // MTBF/MTTR grid — canonical computed values (sem_asset_reliability).
  // This used to PREFER assets.mtbf_days, a one-off backfill that migration
  // 0108 froze and nothing recomputes, so the grid disagreed with Reports.
  // Lifetime fallback (0298): an asset quiet in the trailing year but with
  // imported/older history shows its lifetime basis instead of vanishing —
  // the `window` column says which basis each row is on.
  const mtbfMttrData = useMemo(() => {
    const nameById = new Map<string, any>((assets as any[]).map((a: any) => [a.id, a]));
    return (assetReliability as any[])
      .filter((r: any) => r.mtbf_days != null || r.mttr_hours != null || Number(r.failures_total) > 0)
      .map((r: any) => {
        const a = nameById.get(r.asset_id);
        const lifetimeBasis = r.mtbf_days == null && r.mtbf_hours_lifetime != null;
        const mtbfDays = r.mtbf_days ?? (r.mtbf_hours_lifetime != null ? Math.round(Number(r.mtbf_hours_lifetime) / 24) : 0);
        const mttrHours = r.mttr_hours ?? r.mttr_hours_lifetime ?? 0;
        return {
          asset_tag: r.asset_tag ?? a?.tag,
          asset_name: a?.name ?? r.asset_tag,
          criticality: r.criticality ?? a?.criticality,
          mtbf_days: mtbfDays,
          mttr_hours: mttrHours,
          running_hours: a?.running_hours || 0,
          failure_count_ytd: r.failures_12mo ?? 0,
          failures_total: r.failures_total ?? 0,
          window: lifetimeBasis ? 'lifetime' : '12 mo',
          availability: r.availability_pct != null ? `${r.availability_pct}%` : '—',
        };
      })
      .sort((a: any, b: any) => (a.mtbf_days || Infinity) - (b.mtbf_days || Infinity));
  }, [assets, assetReliability]);

  // Downtime by reason — from ACTUAL failure coding on the work orders.
  // This block previously multiplied total downtime by hard-coded shares
  // (35% mechanical, 20% electrical, …) and charted the result as analysis.
  const downtimeReasons = useMemo(() => {
    const palette = [COLORS.red, COLORS.amber, COLORS.blue, COLORS.cyan, COLORS.purple, COLORS.pink];
    const byReason = new Map<string, number>();
    for (const w of workOrders as any[]) {
      const hrs = Number(w.actual_downtime_hrs) || 0;
      if (hrs <= 0) continue;
      const coded = String(w.failure_mode ?? '').trim();
      const key = coded || (String(w.type ?? '').toUpperCase() === 'CM' ? 'Uncoded — unplanned' : 'Uncoded — planned');
      byReason.set(key, (byReason.get(key) ?? 0) + hrs);
    }
    return [...byReason.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([reason, hours], i) => ({ reason, hours: Math.round(hours), color: palette[i % palette.length] }));
  }, [workOrders]);

  // OEE data
  const oeeData = useMemo(() => {
    // Placeholder factors, flagged as such: real OEE needs production rate
    // and quality counts (production_logs → get_plant_oee). Anything shown
    // from here is labelled an estimate rather than passed off as measured.
    const availability = (assets.length > 0
      ? assets.reduce((s: number, a: any) => s + (a.health_index || 90), 0) / assets.length / 100
      : 0.92);
    const performance = 0.88;
    const quality = 0.96;
    return { availability, performance, quality, oee: availability * performance * quality, isEstimate: true };
  }, [assets]);

  // Per-asset availability — from the canonical sem_asset_reliability view
  // (this drill type was declared and linked from Reports but had no render
  // case at all: it fell through to "Report type not found").
  const availabilityData = useMemo(() => {
    const nameById = new Map<string, any>((assets as any[]).map((a: any) => [a.id, a]));
    return (assetReliability as any[])
      .filter((r: any) => r.availability_pct != null)
      .map((r: any) => ({
        asset_tag: r.asset_tag ?? nameById.get(r.asset_id)?.tag ?? r.asset_id,
        asset_name: nameById.get(r.asset_id)?.name ?? r.asset_tag,
        criticality: r.criticality ?? nameById.get(r.asset_id)?.criticality ?? '—',
        availability_pct: Number(r.availability_pct),
        mtbf_days: r.mtbf_days ?? 0,
        mttr_hours: r.mttr_hours ?? 0,
        failures_12mo: r.failures_12mo ?? 0,
      }))
      .sort((a, b) => a.availability_pct - b.availability_pct);
  }, [assets, assetReliability]);

  // Backlog aging over OPEN WORK ORDERS (canonical isOpenWo). The previous
  // implementation bucketed the assets table and charted asset counts as
  // "Open WOs".
  const backlogBuckets = useMemo(() => {
    const now = Date.now();
    const buckets = [
      { age: '0-7d', count: 0, color: COLORS.emerald },
      { age: '8-14d', count: 0, color: COLORS.amber },
      { age: '15-30d', count: 0, color: COLORS.red },
      { age: '30d+', count: 0, color: '#dc2626' },
    ];
    (workOrders as any[]).filter(w => isOpenWo(w.status) && w.created_at).forEach((wo: any) => {
      const days = Math.floor((now - new Date(wo.created_at).getTime()) / 86400000);
      const idx = days <= 7 ? 0 : days <= 14 ? 1 : days <= 30 ? 2 : 3;
      buckets[idx].count++;
    });
    return buckets;
  }, [workOrders]);

  // PM compliance from the actual work orders: PM-type WOs bucketed by due
  // month over the last 12 months; "executed on time" = closed on/before due
  // date. Replaces a Math.sin/Math.cos synthetic series that charted invented
  // numbers as compliance.
  const pmComplianceData = useMemo(() => {
    const now = new Date();
    const months: { key: string; label: string; Scheduled: number; Executed: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
        Scheduled: 0,
        Executed: 0,
      });
    }
    const byKey = new Map(months.map(m => [m.key, m]));
    for (const w of workOrders as any[]) {
      if (!isPreventiveWoType(w.type) || !w.due_date) continue;
      const due = new Date(w.due_date);
      const m = byKey.get(`${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}`);
      if (!m) continue;
      m.Scheduled++;
      if (w.closed_at && new Date(w.closed_at).getTime() <= due.getTime() + 86400000 - 1) m.Executed++;
    }
    return months.map(m => ({
      month: m.label,
      Scheduled: m.Scheduled,
      Executed: m.Executed,
      Compliance: m.Scheduled > 0 ? Math.round((m.Executed / m.Scheduled) * 100) : null,
    }));
  }, [workOrders]);

  const handleExport = (data: any[], columns: { key: string; label: string }[], filename: string) => {
    exportXLSX(data, columns, filename);
  };

  const renderContent = () => {
    switch (type) {
      case 'downtime':
      case 'downtime-by-asset': {
        const dtCols: TableColumn[] = [
          { key: 'asset', label: 'Asset Tag', width: '100px' },
          { key: 'name', label: 'Asset Name' },
          { key: 'Planned', label: 'Planned (hrs)', format: 'hours', dataBar: true },
          { key: 'Unplanned', label: 'Unplanned (hrs)', format: 'hours', dataBar: true },
          { key: 'Total', label: 'Total (hrs)', format: 'hours', dataBar: true },
          { key: 'est_loss_fmt', label: 'Est. production loss' },
        ];
        const totalLoss = downtimeByAsset.reduce((s, r: any) => s + (r.est_loss ?? 0), 0);
        const ratedCount = downtimeByAsset.filter((r: any) => r.est_loss != null).length;
        return (
          <div className="space-y-6">
            {totalLoss > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-lg font-bold text-amber-800">{fmtMoney(totalLoss)}</span>
                <span className="text-xs text-amber-700">
                  estimated production loss from unplanned downtime across the {ratedCount} listed asset(s) with a rate —
                  rates come from each asset's Financials tab (company default applies where unset). An estimate, not a financial actual.
                </span>
              </div>
            )}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5" style={{ height: 450 }}>
              <h3 className="text-sm font-bold text-slate-800 mb-4">Unplanned vs Planned Downtime by Asset</h3>
              <ResponsiveContainer width="100%" height="90%">
                <BarChart data={downtimeByAsset} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" tick={{ fill: '#64748b', fontSize: 11 }} label={{ value: 'Hours', position: 'insideBottom', offset: -5, fill: '#94a3b8', fontSize: 11 }} />
                  <YAxis dataKey="asset" type="category" tick={{ fill: '#64748b', fontSize: 11 }} width={100} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Unplanned" stackId="a" fill={COLORS.red} fillOpacity={0.8} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Planned" stackId="a" fill={COLORS.blue} fillOpacity={0.4} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ReportDataTable title="Downtime Detail" columns={dtCols} data={downtimeByAsset} exportFilename="ERS_Downtime_by_Asset.csv" />
          </div>
        );
      }

      case 'mtbf-mttr': {
        const mtCols: TableColumn[] = [
          { key: 'asset_tag', label: 'Tag', width: '90px' },
          { key: 'asset_name', label: 'Name' },
          { key: 'criticality', label: 'Crit.' },
          { key: 'mtbf_days', label: 'MTBF (days)', format: 'number', dataBar: true },
          { key: 'mttr_hours', label: 'MTTR (hrs)', format: 'hours', dataBar: true },
          { key: 'running_hours', label: 'Run Hours', format: 'number' },
          { key: 'failure_count_ytd', label: 'Failures (12mo)', format: 'number' },
          { key: 'failures_total', label: 'Lifetime', format: 'number' },
          { key: 'window', label: 'Basis' },
          { key: 'availability', label: 'Availability' },
        ];

        const renderMtbfExpandedRow = (row: any) => {
          const asset = assets.find((a: any) => a.tag === row.asset_tag);
          const assetWOs = workOrders.filter((wo: any) => asset && wo.asset_id === asset.id);
          if (assetWOs.length === 0) {
            return <div className="text-xs text-slate-500 italic py-2">No work orders found for this asset.</div>;
          }
          return (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Wrench size={14} className="text-slate-500" />
                  <span className="text-xs font-bold text-slate-700">Contributing Work Orders ({assetWOs.length})</span>
                </div>
                <span className="text-[10px] text-slate-400 italic">Click a WO # to open full detail</span>
              </div>
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80">
                    <th className="px-3 py-1.5 text-left font-semibold text-slate-500 uppercase">WO #</th>
                    <th className="px-3 py-1.5 text-left font-semibold text-slate-500 uppercase">Date</th>
                    <th className="px-3 py-1.5 text-left font-semibold text-slate-500 uppercase">Type</th>
                    <th className="px-3 py-1.5 text-left font-semibold text-slate-500 uppercase">Failure Mode</th>
                    <th className="px-3 py-1.5 text-left font-semibold text-slate-500 uppercase">Downtime (hrs)</th>
                    <th className="px-3 py-1.5 text-left font-semibold text-slate-500 uppercase">Cost</th>
                    <th className="px-3 py-1.5 text-left font-semibold text-slate-500 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {assetWOs.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map((wo: any, i: number) => {
                    const totalCost = (Number(wo.frozen_labor_cost) || 0) + (Number(wo.frozen_material_cost) || 0);
                    return (
                    <tr key={wo.id || i} className={`border-b border-slate-100 hover:bg-blue-50/30 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'}`}>
                      <td className="px-3 py-1.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); navigate(`/work-orders/${wo.id}`); }}
                          className="font-mono text-blue-600 font-medium hover:text-blue-800 hover:underline transition-colors"
                        >
                          {wo.wo_number || wo.id?.slice(0, 8)}
                        </button>
                      </td>
                      <td className="px-3 py-1.5 text-slate-600">{wo.created_at ? new Date(wo.created_at).toLocaleDateString() : '—'}</td>
                      <td className="px-3 py-1.5 text-slate-600">{wo.type || '—'}</td>
                      <td className="px-3 py-1.5 text-slate-600">{wo.failure_mode || '—'}</td>
                      <td className="px-3 py-1.5 text-slate-700 font-medium">{wo.actual_downtime_hrs ? `${Number(wo.actual_downtime_hrs).toFixed(1)}h` : '—'}</td>
                      <td className="px-3 py-1.5 text-slate-600">{totalCost > 0 ? `$${totalCost.toLocaleString()}` : '—'}</td>
                      <td className="px-3 py-1.5">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          wo.status === 'CLOSED' || wo.status === 'TECO' ? 'bg-emerald-50 text-emerald-600' :
                          wo.status === 'OPEN' ? 'bg-blue-50 text-blue-600' :
                          wo.status === 'WIP' ? 'bg-amber-50 text-amber-600' :
                          'bg-slate-100 text-slate-600'
                        }`}>
                          {wo.status || '—'}
                        </span>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              {/* View all WOs for this asset in the Work module */}
              <div className="flex justify-end mt-3 pt-2 border-t border-slate-100">
                <button
                  onClick={(e) => { e.stopPropagation(); navigate(`/work-orders?asset=${row.asset_tag}`); }}
                  className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors"
                >
                  View all Work Orders for {row.asset_tag}
                  <ArrowLeft size={12} className="rotate-180" />
                </button>
              </div>
            </div>
          );
        };

        return (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5" style={{ height: 350 }}>
                <h3 className="text-sm font-bold text-slate-800 mb-4">MTBF by Asset (days)</h3>
                <ResponsiveContainer width="100%" height="90%">
                  <BarChart data={mtbfMttrData.filter(a => a.mtbf_days > 0).slice(0, 10)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="asset_tag" tick={{ fill: '#64748b', fontSize: 10 }} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="mtbf_days" name="MTBF (days)" fill={COLORS.blue} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5" style={{ height: 350 }}>
                <h3 className="text-sm font-bold text-slate-800 mb-4">MTTR by Asset (hours)</h3>
                <ResponsiveContainer width="100%" height="90%">
                  <BarChart data={mtbfMttrData.filter(a => a.mttr_hours > 0).sort((a, b) => b.mttr_hours - a.mttr_hours).slice(0, 10)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="asset_tag" tick={{ fill: '#64748b', fontSize: 10 }} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="mttr_hours" name="MTTR (hrs)" fill={COLORS.amber} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-xs text-amber-800 font-medium flex items-center gap-2">
              <ChevronRight size={14} className="text-amber-500" />
              Click any row to expand and view the contributing work orders
            </div>
            <ReportDataTable
              title="MTBF / MTTR Details"
              columns={mtCols}
              data={mtbfMttrData}
              exportFilename="ERS_MTBF_MTTR_Report.csv"
              rowKey="asset_tag"
              renderExpandedRow={renderMtbfExpandedRow}
            />
          </div>
        );
      }

      case 'downtime-by-reason':
        return (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5" style={{ height: 400 }}>
                <h3 className="text-sm font-bold text-slate-800 mb-4">Downtime by Reason (hours)</h3>
                <ResponsiveContainer width="100%" height="90%">
                  <BarChart data={downtimeReasons} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" tick={{ fill: '#64748b', fontSize: 11 }} />
                    <YAxis dataKey="reason" type="category" tick={{ fill: '#64748b', fontSize: 10 }} width={130} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="hours" name="Hours" radius={[0, 4, 4, 0]}>
                      {downtimeReasons.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5" style={{ height: 400 }}>
                <h3 className="text-sm font-bold text-slate-800 mb-4">Reason Distribution</h3>
                <ResponsiveContainer width="100%" height="90%">
                  <PieChart>
                    <Pie data={downtimeReasons} cx="50%" cy="50%" innerRadius={60} outerRadius={110} paddingAngle={3} dataKey="hours"
                      label={({ name, percent = 0 }: any) => `${String(name).slice(0, 12)} ${(percent * 100).toFixed(0)}%`}>
                      {downtimeReasons.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
            <ReportDataTable
              title="Downtime Reason Details"
              columns={[
                { key: 'reason', label: 'Reason' },
                { key: 'hours', label: 'Hours', format: 'hours', dataBar: true },
              ]}
              data={downtimeReasons}
              exportFilename="ERS_Downtime_Reasons.csv"
            />
          </div>
        );

      case 'oee': {
        const oeeGaugeData = [
          { name: 'Availability', value: Math.round(oeeData.availability * 100), target: 95, color: COLORS.emerald },
          { name: 'Performance', value: Math.round(oeeData.performance * 100), target: 90, color: COLORS.blue },
          { name: 'Quality', value: Math.round(oeeData.quality * 100), target: 98, color: COLORS.purple },
        ];
        return (
          <div className="space-y-6">
            {/* Honesty banner — these factors are placeholders, not measurements.
                The isEstimate flag existed but was never rendered, so estimates
                were presented as fact. */}
            {oeeData.isEstimate && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-xs text-amber-800 flex items-start gap-2">
                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                <span>
                  <strong>Estimated figures.</strong> Availability is derived from asset health indices; Performance and Quality
                  are placeholder factors until production data is recorded. For measured OEE, use the OEE dashboard on the
                  Reports → Asset Health tab (production logs → <code>get_plant_oee</code>).
                </span>
              </div>
            )}
            {/* OEE Summary */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
              <div className="text-center mb-6">
                <div className="text-4xl font-bold text-slate-900">
                  {(oeeData.oee * 100).toFixed(1)}%
                  {oeeData.isEstimate && <span className="ml-2 align-middle text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Est.</span>}
                </div>
                <div className="text-sm text-slate-500 font-medium mt-1">Overall Equipment Effectiveness</div>
                <div className="text-xs text-slate-400 mt-1">
                  {(oeeData.availability * 100).toFixed(0)}% × {(oeeData.performance * 100).toFixed(0)}% × {(oeeData.quality * 100).toFixed(0)}%
                </div>
              </div>
              <div className="grid grid-cols-3 gap-6">
                {oeeGaugeData.map(g => (
                  <div key={g.name} className="text-center">
                    <svg viewBox="0 0 80 80" className="w-20 h-20 mx-auto -rotate-90">
                      <circle cx="40" cy="40" r="36" fill="none" stroke="#e2e8f0" strokeWidth="6" />
                      <circle cx="40" cy="40" r="36" fill="none" stroke={g.value >= g.target ? g.color : COLORS.amber}
                        strokeWidth="6" strokeDasharray={`${2 * Math.PI * 36}`}
                        strokeDashoffset={`${2 * Math.PI * 36 * (1 - g.value / 100)}`} strokeLinecap="round"
                        style={{ transition: 'stroke-dashoffset 1s ease' }} />
                    </svg>
                    <p className="text-lg font-bold text-slate-900 mt-2">{g.value}%</p>
                    <p className="text-xs text-slate-500 font-medium">{g.name}</p>
                    <p className="text-[10px] text-slate-400">Target: {g.target}%</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      }

      case 'backlog': {
        const blCols: TableColumn[] = [
          { key: 'age', label: 'Age Bucket' },
          { key: 'count', label: 'Open WOs', format: 'number', dataBar: true },
        ];

        return (
          <div className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5" style={{ height: 400 }}>
              <h3 className="text-sm font-bold text-slate-800 mb-4">Backlog by Age Bucket</h3>
              <ResponsiveContainer width="100%" height="90%">
                <BarChart data={backlogBuckets}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="age" tick={{ fill: '#64748b', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="count" name="Open WOs" radius={[4, 4, 0, 0]}>
                    {backlogBuckets.map((b, i) => <Cell key={i} fill={b.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ReportDataTable title="Backlog Detail" columns={blCols} data={backlogBuckets} exportFilename="ERS_Backlog_Aging.csv" />
          </div>
        );
      }

      case 'pm-compliance': {
        const pmCols: TableColumn[] = [
          { key: 'month', label: 'Month' },
          { key: 'Scheduled', label: 'Scheduled', format: 'number' },
          { key: 'Executed', label: 'Executed On Time', format: 'number' },
          { key: 'Compliance', label: 'Compliance %', format: 'percent' },
        ];
        const hasAnyPm = pmComplianceData.some(m => m.Scheduled > 0);

        if (!hasAnyPm) {
          return (
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-10 text-center text-slate-500 text-sm">
              <CalendarCheck size={28} className="mx-auto mb-3 text-slate-300" />
              No PM work orders with due dates in the last 12 months — nothing to measure compliance against yet.
            </div>
          );
        }

        return (
          <div className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5" style={{ height: 400 }}>
              <h3 className="text-sm font-bold text-slate-800 mb-1">PM Scheduled vs Executed On Time (12 months)</h3>
              <p className="text-[11px] text-slate-400 mb-3">Scheduled = PM work orders due in the month · Executed = closed on or before their due date</p>
              <ResponsiveContainer width="100%" height="85%">
                <BarChart data={pmComplianceData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} allowDecimals={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Scheduled" fill={COLORS.blue} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Executed" fill={COLORS.emerald} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ReportDataTable title="PM Compliance Detail" columns={pmCols} data={pmComplianceData} exportFilename="ERS_PM_Compliance.csv" />
          </div>
        );
      }

      case 'availability': {
        const avCols: TableColumn[] = [
          { key: 'asset_tag', label: 'Tag', width: '90px' },
          { key: 'asset_name', label: 'Name' },
          { key: 'criticality', label: 'Crit.' },
          { key: 'availability_pct', label: 'Availability %', format: 'percent', dataBar: true },
          { key: 'mtbf_days', label: 'MTBF (days)', format: 'number' },
          { key: 'mttr_hours', label: 'MTTR (hrs)', format: 'hours' },
          { key: 'failures_12mo', label: 'Failures (12mo)', format: 'number' },
        ];
        if (availabilityData.length === 0) {
          return (
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-10 text-center text-slate-500 text-sm">
              <Gauge size={28} className="mx-auto mb-3 text-slate-300" />
              No availability data yet — it needs at least two coded failures per asset (sem_asset_reliability).
            </div>
          );
        }
        return (
          <div className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5" style={{ height: 400 }}>
              <h3 className="text-sm font-bold text-slate-800 mb-1">Availability by Asset (worst first)</h3>
              <p className="text-[11px] text-slate-400 mb-3">Inherent availability = MTBF / (MTBF + MTTR), from 12 months of corrective work (sem_asset_reliability)</p>
              <ResponsiveContainer width="100%" height="85%">
                <BarChart data={availabilityData.slice(0, 12)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="asset_tag" tick={{ fill: '#64748b', fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="availability_pct" name="Availability %" fill={COLORS.teal} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ReportDataTable title="Availability Detail" columns={avCols} data={availabilityData} exportFilename="ERS_Availability.csv" />
          </div>
        );
      }

      default:
        return <div className="text-center py-16 text-slate-500">Report type not found</div>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumb Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/reports')}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-400 font-medium mb-1">
              <button onClick={() => navigate('/reports')} className="hover:text-blue-600 transition-colors">Reports</button>
              <span>/</span>
              <span className="text-slate-600">{config.title}</span>
            </div>
            <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <span className="text-blue-600">{config.icon}</span>
              {config.title}
            </h1>
            <p className="text-sm text-slate-500 font-medium mt-0.5">{config.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(() => {
            // One dataset resolver for both buttons; covers every drill type
            // (backlog / pm-compliance / availability previously exported nothing).
            const exportDataFor = (): any[] =>
              type === 'downtime' || type === 'downtime-by-asset' ? downtimeByAsset
                : type === 'mtbf-mttr' ? mtbfMttrData
                : type === 'downtime-by-reason' ? downtimeReasons
                : type === 'backlog' ? backlogBuckets.map(({ age, count }) => ({ age, count }))
                : type === 'pm-compliance' ? pmComplianceData
                : type === 'availability' ? availabilityData
                : [];
            const colsFor = (data: any[]) =>
              Object.keys(data[0] || {}).map(k => ({ key: k, label: k.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) }));
            return (
              <>
                <button
                  onClick={() => {
                    const data = exportDataFor();
                    exportCSV(data, colsFor(data), `ERS_${type}_Report.csv`);
                  }}
                  className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-700 font-medium hover:bg-slate-50 transition-colors shadow-sm"
                >
                  <Download size={14} /> CSV
                </button>
                <button
                  onClick={() => {
                    const data = exportDataFor();
                    handleExport(data, colsFor(data), `ERS_${type}_Report.xlsx`);
                  }}
                  className="flex items-center gap-2 px-3 py-2 bg-blue-600 rounded-lg text-sm text-white font-medium hover:bg-blue-500 transition-colors shadow-sm"
                >
                  <FileSpreadsheet size={14} /> Export XLSX
                </button>
              </>
            );
          })()}
        </div>
      </div>

      {/* Content */}
      {renderContent()}
    </div>
  );
};
