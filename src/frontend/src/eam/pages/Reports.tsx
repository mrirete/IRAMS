import React, { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, Legend, ComposedChart, Line
} from 'recharts';
import {
  FileBarChart, Download, Activity, Gauge, Clock, AlertTriangle,
  Loader2, Target, Wrench, DollarSign, Package, Users,
  CheckCircle2, Timer, Layers, Zap
} from 'lucide-react';
import { exportXLSX } from '../utils/reportExport';
import { ReportKPICard } from '../components/reports/ReportKPICard';
import { ReportChartCard } from '../components/reports/ReportChartCard';
import { ReportDataTable, TableColumn } from '../components/reports/ReportDataTable';
import { ReportFilterPanel, ReportFilters, EMPTY_FILTERS } from '../components/reports/ReportFilterPanel';
import { DateRangePicker, DateRange, getDateRange } from '../components/reports/DateRangePicker';
import { CustomDashboardTab } from '../components/reports/CustomDashboardTab';
import { useDashboardStore } from '../stores/DashboardStore';
import { WidgetData } from '../components/reports/WidgetRegistry';
import { DictionaryEntry } from '../types';
import { OEEDashboard } from '../components/reports/OEEDashboard';
import { TroubleMakersCard, SystemHotspotsCard } from '../components/reports/TroubleMakers';
import { SystemViewSection } from '../components/reports/SystemView';
import { isOpenWo, isDoneWo } from '../../lib/woState';
import { computeMtbfMttr, computePmCompliance, computePmRatio } from '../../lib/reliabilityKpis';

// ─── Color Palette ──────────────────────────────────────
const COLORS = {
  blue: '#3b82f6', cyan: '#06b6d4', emerald: '#10b981', amber: '#f59e0b',
  red: '#ef4444', purple: '#8b5cf6', pink: '#ec4899', slate: '#64748b',
  indigo: '#6366f1', teal: '#14b8a6',
};
const PIE_COLORS = [COLORS.emerald, COLORS.blue, COLORS.amber, COLORS.red, COLORS.purple, COLORS.cyan];

// ─── Tab Definitions ────────────────────────────────────
type ReportTab = 'overview' | 'workOrders' | 'assetHealth' | 'costParts' | 'details' | 'customDash';
const TABS: { key: ReportTab; label: string; icon: React.ReactNode }[] = [
  { key: 'overview', label: 'Overview', icon: <Layers size={14} /> },
  { key: 'workOrders', label: 'Work Orders', icon: <Wrench size={14} /> },
  { key: 'assetHealth', label: 'Asset Health', icon: <Activity size={14} /> },
  { key: 'costParts', label: 'Cost & Parts', icon: <DollarSign size={14} /> },
  { key: 'details', label: 'Report Details', icon: <FileBarChart size={14} /> },
  { key: 'customDash', label: 'Custom Dashboards', icon: <Target size={14} /> },
];

// ─── Custom Tooltip ─────────────────────────────────────
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

// ─── Main Reports Component ─────────────────────────────
/**
 * Cost of a work order, read from the columns that exist.
 *
 * This page summed `w.estimated_cost` in three places. There is no
 * `estimated_cost` column on work_orders (schema.ts declares one; the table
 * does not have it), so every one of those totals was structurally zero --
 * including the "Total Cost" card on the Costs & Parts tab, which sat at $0
 * next to an overview card reading the RPC's real $773,500.
 *
 * Labour and material are frozen at closure; the aggregate columns are the
 * fallback for rows costed in one lump.
 */
const woLabor = (w: any) => Number(w.frozen_labor_cost) || 0;
const woParts = (w: any) => Number(w.frozen_material_cost) || 0;
const woCost = (w: any) =>
    (woLabor(w) + woParts(w)) || Number(w.frozen_total_cost) || Number(w.total_actual_cost) || 0;

// ─── Row caps ───────────────────────────────────────────
// These queries used to run select('*') with no .limit(): past PostgREST's
// max-rows they silently truncated and every KPI on the page was quietly
// wrong. The caps below are explicit, and when a result comes back exactly
// at its cap the page says so instead of pretending the numbers are exact.
const ROW_CAP_TXN = 10000;   // work_orders, service_requests, recurring_work
const ROW_CAP_REF = 5000;    // assets, sem_asset_reliability

export const Reports: React.FC = () => {
  const navigate = useNavigate();
  const { pinToActiveDashboard } = useDashboardStore();
  const [activeTab, setActiveTab] = useState<ReportTab>('overview');
  const [dateRange, setDateRange] = useState<DateRange>(getDateRange('12mo'));
  const [filters, setFilters] = useState<ReportFilters>(EMPTY_FILTERS);
  const [filterPanelOpen, setFilterPanelOpen] = useState(true);
  const [groupBy, setGroupBy] = useState<'none' | 'unit' | 'system' | 'criticality' | 'assetType' | 'assetClass'>('none');
  const [paretoMetric, setParetoMetric] = useState<'wo_count' | 'total_cost' | 'downtime_hours'>('wo_count');
  // Reserved for cross-filter feature (Phase 3)
  const [_crossFilter, _setCrossFilter] = useState<{ key: string; value: string } | null>(null);
  const [savedViews, setSavedViews] = useState<{ name: string; filters: ReportFilters; tab: ReportTab; datePreset: string }[]>(() => {
    try { return JSON.parse(localStorage.getItem('ers_report_views') || '[]'); } catch { return []; }
  });

  // ── Data Queries ────────────────────────────────────────
  const { data: dictionaries = [] } = useQuery<DictionaryEntry[]>({
    queryKey: ['report-dictionaries'],
    queryFn: async () => {
      const { data } = await supabase.from('reference_codes_effective').select('*').eq('active', true);
      return (data || []).map((d: any) => ({
        id: d.id, type: d.category, code: d.code, description: d.description,
        active: d.active, colorCode: d.color_code, sequence: d.sort_order,
      }));
    },
  });

  const { data: workOrders = [], isLoading: woLoading } = useQuery({
    queryKey: ['report-work-orders', dateRange.start.toISOString(), dateRange.end.toISOString()],
    queryFn: async () => {
      const { data } = await supabase.from('work_orders').select('*')
        .gte('created_at', dateRange.start.toISOString())
        .lte('created_at', dateRange.end.toISOString())
        .order('created_at', { ascending: false })
        .limit(ROW_CAP_TXN);
      return data || [];
    },
  });

  const { data: assets = [] } = useQuery({
    queryKey: ['report-assets'],
    queryFn: async () => {
      const { data } = await supabase.from('assets').select('*').limit(ROW_CAP_REF);
      return data || [];
    },
  });

  const { data: reliabilityKPIs } = useQuery({
    queryKey: ['report-reliability-kpis'],
    queryFn: async () => {
      const { data } = await supabase.rpc('get_reliability_kpis');
      return data?.[0] || null;
    },
  });

  const { data: badActors = [] } = useQuery({
    queryKey: ['report-bad-actors'],
    queryFn: async () => {
      const { data } = await supabase.rpc('get_bad_actors', { p_limit: 10 });
      return data || [];
    },
  });

  // MTBF/MTTR per asset (for bar chart)
  const { data: assetMtbfMttr = [] } = useQuery({
    queryKey: ['report-asset-mtbf-mttr'],
    queryFn: async () => {
      // sem_asset_reliability (0234) — the same source as the drill-down and
      // the agents. The get_asset_mtbf_mttr RPC this replaced counted EVERY
      // work order as a failure (K-601: 15 "failures" against 5 corrective
      // events) and averaged MTTR over PMs too, reading 29.6 days where the
      // canonical figure is 71.5.
      const { data } = await supabase
        .from('sem_asset_reliability')
        .select('asset_id, asset_tag, mtbf_days, mttr_hours, failures_12mo, downtime_hrs_12mo, availability_pct')
        .gt('failures_12mo', 0)
        .order('mtbf_days', { ascending: true })
        .limit(ROW_CAP_REF);
      return data || [];
    },
  });

  // Downtime by failure mode (for pie chart)
  const { data: downtimeByFailureMode = [] } = useQuery({
    queryKey: ['report-downtime-by-failure-mode'],
    queryFn: async () => {
      const { data } = await supabase.rpc('get_downtime_by_failure_mode');
      return data || [];
    },
  });

  const { data: serviceRequests = [] } = useQuery({
    queryKey: ['report-service-requests', dateRange.start.toISOString(), dateRange.end.toISOString()],
    queryFn: async () => {
      const { data } = await supabase.from('service_requests').select('*')
        .gte('created_at', dateRange.start.toISOString())
        .lte('created_at', dateRange.end.toISOString())
        .limit(ROW_CAP_TXN);
      return data || [];
    },
  });

  const { data: recurringWork = [] } = useQuery({
    queryKey: ['report-recurring-work'],
    queryFn: async () => {
      const { data } = await supabase.from('recurring_work').select('*').limit(ROW_CAP_TXN);
      return data || [];
    },
  });

  // ── Row-cap honesty ─────────────────────────────────────
  // A result that comes back exactly at its cap almost certainly hit it, so
  // the aggregates below are computed from a truncated set. One banner, up
  // top, says so — rather than every KPI being quietly wrong.
  const dataTruncated =
    workOrders.length >= ROW_CAP_TXN ||
    serviceRequests.length >= ROW_CAP_TXN ||
    recurringWork.length >= ROW_CAP_TXN ||
    assets.length >= ROW_CAP_REF ||
    assetMtbfMttr.length >= ROW_CAP_REF;

  // ── Dictionary Helper ───────────────────────────────────
  const getDictDesc = useCallback((category: string, code: string | null | undefined, fallback: string = 'Other') => {
    if (!code) return fallback;
    const entry = dictionaries.find(d => d.type === category && d.code === code);
    return entry ? entry.description : code;
  }, [dictionaries]);

  // ── Derived Data ────────────────────────────────────────
  // Filter assets by hierarchy tree selection + dictionary filters
  const filteredAssets = useMemo(() => {
    let fa = assets;
    // Hierarchy tree filtering (selectedAssetIds includes self + all descendants)
    if (filters.selectedAssetIds.length) {
      const selectedSet = new Set(filters.selectedAssetIds);
      fa = fa.filter((a: any) => selectedSet.has(a.id));
    }
    if (filters.criticalities.length) fa = fa.filter((a: any) => filters.criticalities.includes(a.criticality));
    // Asset type/class/category filtering
    if (filters.assetTypes.length) fa = fa.filter((a: any) => filters.assetTypes.includes(a.asset_type));
    if (filters.assetClasses.length) fa = fa.filter((a: any) => filters.assetClasses.includes(a.asset_class));
    if (filters.assetCategories.length) fa = fa.filter((a: any) => filters.assetCategories.includes(a.asset_category));
    return fa;
  }, [assets, filters]);

  const filteredAssetIds = useMemo(() => new Set(filteredAssets.map((a: any) => a.id)), [filteredAssets]);

  const filteredWOs = useMemo(() => {
    let wos = workOrders;
    if (filters.departments.length) wos = wos.filter((w: any) => filters.departments.includes(w.department));
    // work_orders has `type` (PM/CM/PROJ) -- there is no work_type column, so
    // this filter previously matched nothing and silently emptied the page.
    if (filters.workTypes.length) wos = wos.filter((w: any) => filters.workTypes.includes(w.type));
    if (filters.priorities.length) wos = wos.filter((w: any) => filters.priorities.includes(w.priority));
    if (filters.statuses.length) wos = wos.filter((w: any) => filters.statuses.includes(w.status));
    if (filters.criticalities.length) {
      wos = wos.filter((w: any) => filteredAssetIds.has(w.asset_id));
    }
    // Hierarchy tree filtering: only show WOs for filtered assets
    if (filters.selectedAssetIds.length) {
      wos = wos.filter((w: any) => filteredAssetIds.has(w.asset_id));
    }
    return wos;
  }, [workOrders, filters, filteredAssetIds]);

  const totalWOs = filteredWOs.length;
  // Canonical lifecycle buckets (lib/woState) — shared with the dashboard,
  // the reliability digest and the mission engine.
  const completedWOs = filteredWOs.filter((w: any) => isDoneWo(w.status)).length;
  // Preventive/corrective counts and the PM ratio come from the canonical lib
  // below (computePmRatio) -- see pmRatioCanonical. They used to be counted here
  // off w.work_type, a column that does not exist, so both were always 0.
  const overdueWOs = filteredWOs.filter((w: any) => {
    // Only open work can be overdue — cancelled work is not a debt.
    if (!w.due_date || !isOpenWo(w.status)) return false;
    return new Date(w.due_date) < new Date();
  }).length;
  const onTimeRate = totalWOs > 0 ? ((totalWOs - overdueWOs) / totalWOs) * 100 : 100;

  // Monthly WO Trend
  const woTrend = useMemo(() => {
    const months: Record<string, { pm: number; cm: number; total: number }> = {};
    filteredWOs.forEach((w: any) => {
      const m = new Date(w.created_at).toISOString().slice(0, 7);
      if (!months[m]) months[m] = { pm: 0, cm: 0, total: 0 };
      months[m].total++;
      if (['PM', 'PREVENTIVE'].includes(w.type?.toUpperCase())) months[m].pm++;
      else months[m].cm++;
    });
    return Object.entries(months).sort().slice(-12).map(([month, d]) => ({
      month: new Date(month + '-01').toLocaleDateString('en', { month: 'short', year: '2-digit' }),
      Preventive: d.pm, Corrective: d.cm, Total: d.total,
    }));
  }, [filteredWOs]);

  // WO by Priority
  const woByPriority = useMemo(() => {
    const pMap: Record<string, { onTime: number; overdue: number }> = {};
    filteredWOs.forEach((w: any) => {
      const p = getDictDesc('PRIORITY', w.priority, 'Unset');
      if (!pMap[p]) pMap[p] = { onTime: 0, overdue: 0 };
      const isOverdue = w.due_date && new Date(w.due_date) < new Date() && !['COMP', 'TECO', 'CLOSED'].includes(w.status?.toUpperCase());
      if (isOverdue) pMap[p].overdue++; else pMap[p].onTime++;
    });
    return Object.entries(pMap).map(([priority, d]) => ({ priority, ...d }));
  }, [filteredWOs, getDictDesc]);

  // WO by Type (pie)
  const woByType = useMemo(() => {
    const tMap: Record<string, number> = {};
    filteredWOs.forEach((w: any) => { 
      const t = getDictDesc('WORK_TYPE', w.type, 'Other'); 
      tMap[t] = (tMap[t] || 0) + 1; 
    });
    return Object.entries(tMap).map(([name, value]) => ({ name, value }));
  }, [filteredWOs, getDictDesc]);

  // Backlog Aging
  const backlogAging = useMemo(() => {
    const now = new Date();
    const buckets = { '0-7d': 0, '8-14d': 0, '15-30d': 0, '30d+': 0 };
    filteredWOs.filter((w: any) => !['COMP', 'TECO', 'CLOSED'].includes(w.status?.toUpperCase())).forEach((w: any) => {
      const age = (now.getTime() - new Date(w.created_at).getTime()) / 86400000;
      if (age <= 7) buckets['0-7d']++;
      else if (age <= 14) buckets['8-14d']++;
      else if (age <= 30) buckets['15-30d']++;
      else buckets['30d+']++;
    });
    return Object.entries(buckets).map(([age, count]) => ({ age, count }));
  }, [filteredWOs]);

  // WO sparkline
  const woSparkline = useMemo(() => woTrend.map(t => ({ v: t.Total })), [woTrend]);

  const kpis = reliabilityKPIs || { total_wos: 0, avg_mttr_hrs: 0, availability_pct: 0, total_cost: 0 };

  // ── Canonical reliability KPIs (lib/reliabilityKpis) ──────────────────
  // Computed from the SAME rows the rest of this page shows, so the cards
  // honour the date range and hierarchy slicers. The old cards came from an
  // all-time RPC (ignoring both) and "MTBF" was `(8760 − MTTR×12)/12` — an
  // algebraic artifact that assumed 12 failures a year for every plant.
  const windowDays = Math.max(1, Math.round((dateRange.end.getTime() - dateRange.start.getTime()) / 86_400_000));
  const reliability = useMemo(
    () => computeMtbfMttr(filteredWOs as any, windowDays, filteredAssets.length || 1),
    [filteredWOs, windowDays, filteredAssets.length],
  );
  const pmComplianceKpi = useMemo(
    () => computePmCompliance(filteredWOs as any, dateRange.start.getTime(), dateRange.end.getTime()),
    [filteredWOs, dateRange],
  );
  const pmRatioCanonical = useMemo(() => computePmRatio(filteredWOs as any), [filteredWOs]);
  const preventiveWOs = pmRatioCanonical.preventive;
  const correctiveWOs = pmRatioCanonical.corrective;
  const pmRatio = pmRatioCanonical.ratioPct ?? 0;

  // ── OEE (data-driven via production_logs, fallback to proxy) ──
  const { data: plantOEEData } = useQuery({
    queryKey: ['plant-oee', dateRange.start.toISOString().split('T')[0], dateRange.end.toISOString().split('T')[0]],
    queryFn: async () => {
      const { data } = await supabase.rpc('get_plant_oee', {
        p_from: dateRange.start.toISOString().split('T')[0],
        p_to: dateRange.end.toISOString().split('T')[0],
      });
      return data?.[0] || null;
    },
  });

  const oeeData = useMemo(() => {
    // Use real production data if available
    if (plantOEEData && Number(plantOEEData.oee_pct) > 0) {
      return {
        availability: Number(plantOEEData.availability_pct) / 100,
        performance: Number(plantOEEData.performance_pct) / 100,
        quality: Number(plantOEEData.quality_pct) / 100,
        oee: Number(plantOEEData.oee_pct) / 100,
        isReal: true,
        assetCount: Number(plantOEEData.asset_count) || 0,
      };
    }
    // Fallback: proxy from asset health_index (legacy behavior)
    const availability = filteredAssets.length > 0
      ? filteredAssets.reduce((s: number, a: any) => s + (a.health_index || 90), 0) / filteredAssets.length / 100
      : 0.92;
    const performance = 0.88;
    const quality = 0.96;
    return { availability, performance, quality, oee: availability * performance * quality, isReal: false, assetCount: 0 };
  }, [plantOEEData, filteredAssets]);

  // Recorded downtime, summed. Was mttr_hours × failure_count_ytd — a
  // product of two frozen columns, not a measurement.
  const totalDowntimeHrs = useMemo(() =>
    Math.round((filteredWOs as any[]).reduce((s: number, w: any) => s + (Number(w.actual_downtime_hrs) || 0), 0)),
  [filteredWOs]);

  // Downtime by asset / Top 5 Bad Actors (Pareto) - Rule: Monthly Pareto Analysis
  // Derived from the get_bad_actors RPC data, filtered by slicer selections
  const hasHierarchyOrLocationFilter = filters.selectedAssetIds.length > 0 || filters.criticalities.length > 0 ||
    filters.assetTypes.length > 0 || filters.assetClasses.length > 0 || filters.assetCategories.length > 0;

  const filteredBadActors = useMemo(() => {
    if (!hasHierarchyOrLocationFilter) return badActors;
    return badActors.filter((a: any) => filteredAssetIds.has(a.asset_id));
  }, [badActors, filteredAssetIds, hasHierarchyOrLocationFilter]);

  const top5BadActors = useMemo(() => {
    if (!filteredBadActors.length) return [];
    // Sort by the selected Pareto metric (descending)
    const sorted = [...filteredBadActors].sort((a: any, b: any) => {
      return (Number(b[paretoMetric]) || 0) - (Number(a[paretoMetric]) || 0);
    });
    const top5 = sorted.slice(0, 5);
    const total = top5.reduce((s: number, a: any) => s + (Number(a[paretoMetric]) || 0), 0);
    let cumulative = 0;
    
    return top5.map((a: any) => {
      const val = Number(a[paretoMetric]) || 0;
      cumulative += val;
      const cumulativePct = total > 0 ? (cumulative / total) * 100 : 0;
      return { 
        asset: a.asset_tag || a.asset_name, 
        name: a.asset_name, 
        Value: val, 
        CumulativePct: Math.round(cumulativePct)
      };
    });
  }, [filteredBadActors, paretoMetric]);

  const paretoLabels: Record<string, { label: string; yAxis: string; subtitle: string }> = {
    wo_count: { label: 'WO Count', yAxis: 'WO Count', subtitle: 'Ranked by Work Order count' },
    total_cost: { label: 'Total Cost ($)', yAxis: 'Cost ($)', subtitle: 'Ranked by Total Cost' },
    downtime_hours: { label: 'Downtime (hrs)', yAxis: 'Downtime (hrs)', subtitle: 'Ranked by Downtime hours' },
  };

  // Maintain existing fallback for older charts if needed, or point to new bad actors
  const downtimeByAsset = useMemo(() => {
    return filteredAssets
      .map((a: any) => {
        // REAL downtime, split by what the work actually was: corrective =
        // unplanned, preventive = planned. This used to synthesise the total
        // as mttr_hours × failure_count_ytd (both frozen columns) and then
        // split it 65/35 by decree.
        const rows = (filteredWOs as any[]).filter((w: any) => w.asset_id === a.id);
        let unplanned = 0, planned = 0;
        for (const w of rows) {
          const hrs = Number(w.actual_downtime_hrs) || 0;
          if (hrs <= 0) continue;
          if (String(w.type ?? '').toUpperCase() === 'CM') unplanned += hrs; else planned += hrs;
        }
        return {
          asset: a.tag || a.name, name: a.name,
          Unplanned: Math.round(unplanned), Planned: Math.round(planned),
          Total: Math.round(unplanned + planned),
        };
      })
      .filter((r: any) => r.Total > 0)
      .sort((x: any, y: any) => y.Total - x.Total)
      .slice(0, 12);
  }, [filteredAssets, filteredWOs]);

  // ── Group By helper: get group label for an asset ──
  const getGroupLabel = useCallback((assetId: string): string => {
    const asset = assets.find((a: any) => a.id === assetId);
    if (!asset) return 'Unknown';
    switch (groupBy) {
      case 'unit': {
        // Walk up to find UNIT ancestor
        let cur = asset;
        while (cur) {
          if (cur.hierarchy_level === 'UNIT') return cur.tag || cur.name;
          cur = assets.find((a: any) => a.id === cur.parent_id);
        }
        return 'No Unit';
      }
      case 'system': {
        let cur = asset;
        while (cur) {
          if (cur.hierarchy_level === 'SYSTEM') return cur.tag || cur.name;
          cur = assets.find((a: any) => a.id === cur.parent_id);
        }
        return 'No System';
      }
      case 'criticality': return getDictDesc('CRITICALITY', asset.criticality, 'Unclassified');
      case 'assetType': return getDictDesc('ASSET_TYPE', asset.asset_type, 'Unclassified');
      case 'assetClass': return getDictDesc('ASSET_CLASS', asset.asset_class, 'Unclassified');
      default: return asset.tag || asset.name;
    }
  }, [groupBy, assets, getDictDesc]);

  // MTBF/MTTR by asset — derived from get_asset_mtbf_mttr RPC, filtered by slicers
  const mtbfMttrByAsset = useMemo(() => {
    let data = assetMtbfMttr;
    if (hasHierarchyOrLocationFilter) {
      data = data.filter((a: any) => filteredAssetIds.has(a.asset_id));
    }
    if (groupBy !== 'none') {
      // Aggregate by group
      const groups: Record<string, { mtbfSum: number; mttrSum: number; count: number }> = {};
      data.forEach((a: any) => {
        const label = getGroupLabel(a.asset_id);
        if (!groups[label]) groups[label] = { mtbfSum: 0, mttrSum: 0, count: 0 };
        groups[label].mtbfSum += Number(a.mtbf_days) || 0;
        groups[label].mttrSum += Number(a.mttr_hours) || 0;
        groups[label].count++;
      });
      return Object.entries(groups).map(([label, g]) => ({
        asset: label,
        MTBF: Math.round(g.mtbfSum / g.count),
        MTTR: Math.round((g.mttrSum / g.count) * 10) / 10,
      }));
    }
    return data.slice(0, 12).map((a: any) => ({
      asset: a.asset_tag || a.asset_id,
      MTBF: Number(a.mtbf_days) || 0,
      MTTR: Number(a.mttr_hours) || 0,
    }));
  }, [assetMtbfMttr, filteredAssetIds, hasHierarchyOrLocationFilter, groupBy, getGroupLabel]);

  // Average of per-asset MTBF, from the computed view. The card below used to
  // average assets.mtbf_days — the one-off 2026 backfill that migration 0234
  // catalogued "do not quote" (frozen mean 47.3 days vs a computed 205.7).
  const avgAssetMtbf = useMemo(() => {
    const rows = (assetMtbfMttr as any[])
      .filter((a) => Number(a.mtbf_days) > 0)
      .filter((a) => !hasHierarchyOrLocationFilter || filteredAssetIds.has(a.asset_id));
    if (!rows.length) return null;
    const days = rows.reduce((t, a) => t + Number(a.mtbf_days), 0) / rows.length;
    return { days: Math.round(days * 10) / 10, n: rows.length };
  }, [assetMtbfMttr, hasHierarchyOrLocationFilter, filteredAssetIds]);

  // Downtime reasons — derived from get_downtime_by_failure_mode RPC
  const REASON_COLORS = [COLORS.red, COLORS.amber, COLORS.blue, COLORS.purple, COLORS.pink, COLORS.slate, COLORS.emerald, COLORS.indigo, COLORS.teal, COLORS.cyan];
  const downtimeReasons = useMemo(() => {
    return downtimeByFailureMode.map((d: any, i: number) => ({
      reason: d.failure_mode || 'Unknown',
      hours: Number(d.total_hours) || 0,
      color: REASON_COLORS[i % REASON_COLORS.length],
    }));
  }, [downtimeByFailureMode]);

  // ── Cost Data (hoisted from renderCostParts to fix hooks rule) ──
  const costData = useMemo(() => {
    const months: Record<string, { labor: number; parts: number; total: number }> = {};
    filteredWOs.forEach((w: any) => {
      const m = new Date(w.created_at).toISOString().slice(0, 7);
      if (!months[m]) months[m] = { labor: 0, parts: 0, total: 0 };
      // Real split: frozen labour and material are captured at closure.
      // This used to bill 60/40 against ESTIMATED cost — an invented ratio
      // over the wrong basis.
      const labor = Number(w.frozen_labor_cost) || 0;
      const parts = Number(w.frozen_material_cost) || 0;
      const cost = (labor + parts) || Number(w.total_actual_cost) || 0;
      months[m].total += cost;
      months[m].labor += labor;
      months[m].parts += parts;
    });
    return Object.entries(months).sort().slice(-12).map(([month, d]) => ({
      month: new Date(month + '-01').toLocaleDateString('en', { month: 'short', year: '2-digit' }),
      Labor: Math.round(d.labor), Parts: Math.round(d.parts), Total: Math.round(d.total),
    }));
  }, [filteredWOs]);

  // ── Maintenance cost by asset (Asset Health tab) ──
  // Client-side aggregation over the same filtered WOs the rest of the page
  // shows, on the same frozen-cost basis as woCost (labour + material frozen
  // at closure, falling back to the aggregate columns). Hoisted here — not
  // inside renderAssetHealth — for the hooks rule, like costData above.
  const costByAsset = useMemo(() => {
    const byId: Record<string, { wo_count: number; total_cost: number }> = {};
    filteredWOs.forEach((w: any) => {
      if (!w.asset_id) return;
      if (!byId[w.asset_id]) byId[w.asset_id] = { wo_count: 0, total_cost: 0 };
      byId[w.asset_id].wo_count++;
      byId[w.asset_id].total_cost += woCost(w);
    });
    const assetById = new Map<string, any>(assets.map((a: any) => [a.id, a]));
    return Object.entries(byId)
      .map(([assetId, d]) => {
        const asset = assetById.get(assetId);
        return {
          asset_id: assetId,
          asset_tag: asset?.tag || asset?.name || 'Unknown',
          asset_name: asset?.name || 'Unknown asset',
          criticality: asset?.criticality || '—',
          wo_count: d.wo_count,
          total_cost: Math.round(d.total_cost),
          avg_cost_per_wo: d.wo_count > 0 ? Math.round(d.total_cost / d.wo_count) : 0,
        };
      })
      .sort((a, b) => b.total_cost - a.total_cost);
  }, [filteredWOs, assets]);

  const costByAssetTop12 = useMemo(
    () => costByAsset.filter(r => r.total_cost > 0).slice(0, 12)
      .map(r => ({ asset: r.asset_tag, name: r.asset_name, 'Total Cost': r.total_cost })),
    [costByAsset],
  );

  const totalCost = useMemo(() => filteredWOs.reduce((s: number, w: any) => s + woCost(w), 0), [filteredWOs]);
  const laborCostTotal = useMemo(() => filteredWOs.reduce((s: number, w: any) => s + woLabor(w), 0), [filteredWOs]);
  const partsCostTotal = useMemo(() => filteredWOs.reduce((s: number, w: any) => s + woParts(w), 0), [filteredWOs]);
  const avgCostPerWO = totalWOs > 0 ? totalCost / totalWOs : 0;

  // ── Notification Aging ──
  const notificationAging = useMemo(() => {
    const now = new Date();
    const buckets = { '0-24h': 0, '1-3d': 0, '3-7d': 0, '7d+': 0 };
    filteredWOs.filter((w: any) => w.type?.toUpperCase() === 'REQUEST' || w.status?.toUpperCase() === 'REQUESTED')
      .forEach((w: any) => {
        const age = (now.getTime() - new Date(w.created_at).getTime()) / 3600000;
        if (age <= 24) buckets['0-24h']++;
        else if (age <= 72) buckets['1-3d']++;
        else if (age <= 168) buckets['3-7d']++;
        else buckets['7d+']++;
      });
    return Object.entries(buckets).map(([age, count]) => ({ age, count }));
  }, [filteredWOs]);

  // ── PM Plan Compliance ──
  const pmCompliance = useMemo(() => {
    const byMonth: Record<string, { scheduled: number; executed: number }> = {};
    filteredWOs.forEach((w: any) => {
      if (!['PM', 'PREVENTIVE'].includes(w.type?.toUpperCase())) return;
      const m = new Date(w.created_at).toISOString().slice(0, 7);
      if (!byMonth[m]) byMonth[m] = { scheduled: 0, executed: 0 };
      byMonth[m].scheduled++;
      if (isDoneWo(w.status)) byMonth[m].executed++;   // canonical rule, not another private list
    });
    return Object.entries(byMonth).sort().slice(-6).map(([month, d]) => ({
      month: new Date(month + '-01').toLocaleDateString('en', { month: 'short', year: '2-digit' }),
      Scheduled: d.scheduled, Executed: d.executed,
    }));
  }, [filteredWOs]);

  // ── NEW: Service Requests Derived Data ──
  const requestsByStatus = useMemo(() => {
    const statusMap: Record<string, number> = {};
    serviceRequests.forEach((req: any) => {
      const status = getDictDesc('STATUS_CODE', req.status, 'Unknown');
      statusMap[status] = (statusMap[status] || 0) + 1;
    });
    return Object.entries(statusMap).map(([name, value]) => ({ name, value }));
  }, [serviceRequests, getDictDesc]);

  // Rule: Risk Priority Number (RPN) = Asset Criticality (numeric mapped) x Severity
  const requestsByRPN = useMemo(() => {
    const buckets = { 'High Risk (>15)': 0, 'Medium Risk (8-15)': 0, 'Low Risk (<8)': 0 };
    serviceRequests.forEach((req: any) => {
      // Find associated asset criticality
      const asset = filteredAssets.find((a: any) => a.id === req.asset_id);
      let critScore = 2; // Default Medium
      if (asset?.criticality === 'A') critScore = 5;
      if (asset?.criticality === 'B') critScore = 4;
      if (asset?.criticality === 'C') critScore = 3;

      // Assume random severity 1-5 for now if not present, in robust system from dict
      // Let's use priority text length as a fake severity proxy for visuals since DB lacks it
      const severityScore = req.priority === 'High' ? 5 : req.priority === 'Medium' ? 3 : 1;
      
      const rpn = critScore * severityScore;
      if (rpn > 15) buckets['High Risk (>15)']++;
      else if (rpn >= 8) buckets['Medium Risk (8-15)']++;
      else buckets['Low Risk (<8)']++;
    });
    return Object.entries(buckets).map(([name, value]) => ({ name, value }));
  }, [serviceRequests, filteredAssets]);

  // ── NEW: Recurring Work Derived Data ──
  const pmByScheduleType = useMemo(() => {
    const map: Record<string, number> = {};
    recurringWork.forEach((rw: any) => {
      const t = getDictDesc('ScheduleType', rw.schedule_type, 'Calendar');
      map[t] = (map[t] || 0) + 1;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [recurringWork, getDictDesc]);

  // ── NEW: ISO 14224 Derived Data ──
  const assetCriticalityDist = useMemo(() => {
    const map: Record<string, number> = {};
    filteredAssets.forEach((a: any) => {
      const crit = getDictDesc('CRITICALITY', a.criticality, 'Unassigned');
      map[crit] = (map[crit] || 0) + 1;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [filteredAssets, getDictDesc]);

  const costsByHierarchy = useMemo(() => {
    // ISO 14224 Hierarchy: Enterprise -> Site -> Unit -> System -> Equipment
    const hierarchyCosts: Record<string, number> = {};
    filteredWOs.forEach((w: any) => {
      const asset = filteredAssets.find((a: any) => a.id === w.asset_id);
      const site = asset?.site ? getDictDesc('Site', asset.site, asset.site) : 'Unknown Site';
      const unit = asset?.functional_location ? getDictDesc('Location', asset.functional_location, asset.functional_location) : 'Unknown Unit';
      const key = `${site} / ${unit}`;
      hierarchyCosts[key] = (hierarchyCosts[key] || 0) + woCost(w);
    });
    return Object.entries(hierarchyCosts)
      .sort((a, b) => b[1] - a[1]) // Sort desc
      .slice(0, 10) // Top 10 costly units
      .map(([name, value]) => ({ name, value }));
  }, [filteredWOs, filteredAssets, getDictDesc]);

  // ── Saved View Helpers (Phase 3) ──
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const saveCurrentView = useCallback((name: string) => {
    const view = { name, filters, tab: activeTab, datePreset: dateRange.preset };
    const updated = [...savedViews.filter(v => v.name !== name), view];
    setSavedViews(updated);
    localStorage.setItem('ers_report_views', JSON.stringify(updated));
  }, [filters, activeTab, dateRange, savedViews]);

  // ── Pin Handler (sends widget to Custom Dashboard) ──
  const pinWidget = useCallback((widgetKey: string, type: 'chart' | 'kpi', label: string, defaultW = 6, defaultH = 1) => {
    pinToActiveDashboard({ type, widgetKey, title: label, w: defaultW, h: defaultH });
  }, [pinToActiveDashboard]);

  // ── Widget Data (passed to Custom Dashboard Tab) ──
  const widgetData: WidgetData = useMemo(() => ({
    woTrend, backlogAging, woByType, woByPriority, pmCompliance, costData,
    downtimeByAsset, mtbfMttrByAsset, downtimeReasons, top5BadActors, assetCriticalityDist, costsByHierarchy,
    totalWOs, completedWOs, pmRatio, onTimeRate, overdueWOs,
    totalCost, avgCostPerWO, totalDowntimeHrs, badActorCount: badActors.length,
    // Canonical, not the RPC -- a pinned widget must not contradict the page
    // it was pinned from.
    kpis: { avg_mttr_hrs: reliability.mttrHours, availability_pct: reliability.availabilityPct, total_cost: totalCost },
    reliability, pmCompliancePct: pmComplianceKpi.compliancePct,
    oeeData,
    requestsByStatus, requestsByRPN, pmByScheduleType,
  }), [
    woTrend, backlogAging, woByType, woByPriority, pmCompliance, costData, downtimeByAsset, mtbfMttrByAsset, 
    downtimeReasons, top5BadActors, assetCriticalityDist, costsByHierarchy, totalWOs, completedWOs, pmRatio, 
    onTimeRate, overdueWOs, totalCost, avgCostPerWO, totalDowntimeHrs, badActors.length, reliability,
    pmComplianceKpi, oeeData, 
    requestsByStatus, requestsByRPN, pmByScheduleType
  ]);

  // ── Drill-through handler ──
  const handleDrillThrough = useCallback((row: any) => {
    if (row.asset_id) navigate(`/assets?id=${row.asset_id}`);
    else if (row.job_number) navigate(`/work-orders/${row.job_number}`);
    else if (row.asset_tag) navigate(`/assets?tag=${row.asset_tag}`);
  }, [navigate]);

  // ── Render Helpers ──────────────────────────────────────
  const renderOverview = () => (
    <div className="space-y-6">
      {/* KPI Cards — Row 1 */}
      <div className="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
        <ReportKPICard title="Total WOs" value={totalWOs} format="number" sparkData={woSparkline} sparkColor={COLORS.blue} icon={<Wrench size={14} />} ragStatus="neutral" onClick={() => navigate('/work-orders')} clickLabel="View all Work Orders" />
        <ReportKPICard title="Requests" value={serviceRequests.length} format="number" icon={<Layers size={14} />} ragStatus="neutral" onClick={() => navigate('/requests')} clickLabel="View Work Requests" />
        <ReportKPICard title="Total PMs" value={recurringWork.length} format="number" icon={<Clock size={14} />} ragStatus="neutral" onClick={() => navigate('/recurring-work')} clickLabel="View Recurring Work" />
        {/* Two DIFFERENT KPIs that used to share one name: proactive share
            (SMRP ≈80% target) vs schedule adherence (PMs done by due date). */}
        <ReportKPICard title="PM Ratio" value={pmRatioCanonical.ratioPct ?? '—'} format={pmRatioCanonical.ratioPct == null ? undefined : 'percent'} subtitle="preventive share of all work" target={80} targetLabel="Target: 80%" icon={<CheckCircle2 size={14} />} ragStatus={pmRatioCanonical.ratioPct == null ? 'neutral' : pmRatioCanonical.ratioPct >= 80 ? 'green' : pmRatioCanonical.ratioPct >= 60 ? 'amber' : 'red'} onClick={() => navigate('/reports/drilldown/pm-compliance')} clickLabel="View PM details" />
        <ReportKPICard title="PM Compliance" value={pmComplianceKpi.compliancePct ?? '—'} format={pmComplianceKpi.compliancePct == null ? undefined : 'percent'} subtitle={pmComplianceKpi.compliancePct == null ? 'no PMs due in range' : `${pmComplianceKpi.onTime}/${pmComplianceKpi.due} done by due date`} target={90} targetLabel="Target: 90%" icon={<CheckCircle2 size={14} />} ragStatus={pmComplianceKpi.compliancePct == null ? 'neutral' : pmComplianceKpi.compliancePct >= 90 ? 'green' : pmComplianceKpi.compliancePct >= 70 ? 'amber' : 'red'} onClick={() => navigate('/reports/drilldown/pm-compliance')} clickLabel="View PM Compliance details" />
        <ReportKPICard title="Fleet MTBF" value={reliability.mtbfHours ?? '—'} subtitle={reliability.mtbfHours == null ? 'no failures in range' : `hours · ${reliability.failures} failures across ${filteredAssets.length} assets`} icon={<Timer size={14} />} ragStatus="neutral" onClick={() => navigate('/reports/drilldown/mtbf-mttr')} clickLabel="View MTBF/MTTR analysis" />
        <ReportKPICard title="MTTR" value={reliability.mttrHours ?? '—'} format={reliability.mttrHours == null ? undefined : 'hours'} subtitle={reliability.mttrHours == null ? 'no timed repairs' : `${reliability.downtimeCoveragePct}% of failures timed`} icon={<Clock size={14} />} ragStatus={reliability.mttrHours == null ? 'neutral' : reliability.mttrHours <= 4 ? 'green' : reliability.mttrHours <= 8 ? 'amber' : 'red'} onClick={() => navigate('/reports/drilldown/mtbf-mttr')} clickLabel="View MTBF/MTTR analysis" />
        <ReportKPICard title="Availability" value={reliability.availabilityPct ?? '—'} format={reliability.availabilityPct == null ? undefined : 'percent'} subtitle={reliability.availabilityPct == null ? 'needs failures + downtime' : 'inherent — MTBF/(MTBF+MTTR)'} target={95} targetLabel="Target: 95%" icon={<Gauge size={14} />} ragStatus={reliability.availabilityPct == null ? 'neutral' : reliability.availabilityPct >= 95 ? 'green' : reliability.availabilityPct >= 85 ? 'amber' : 'red'} onClick={() => navigate('/reports/drilldown/availability')} clickLabel="View Availability trend" />
        {/* OEE needs production data. The fallback path invents performance
            (0.88) and quality (0.96); `isReal` existed but was never read, so
            a fabricated OEE rendered as fact. Now it says so. */}
        <ReportKPICard title="OEE" value={oeeData.isReal ? Number((oeeData.oee * 100).toFixed(1)) : '—'} format={oeeData.isReal ? 'percent' : undefined} subtitle={oeeData.isReal ? `from ${oeeData.assetCount} asset(s) logging production` : 'needs production data (rate & quality)'} target={85} targetLabel="Target: 85%" icon={<Activity size={14} />} ragStatus={!oeeData.isReal ? 'neutral' : oeeData.oee >= 0.85 ? 'green' : oeeData.oee >= 0.65 ? 'amber' : 'red'} onClick={() => navigate('/reports/drilldown/oee')} clickLabel="View OEE breakdown" />
        <ReportKPICard title="Total Downtime" value={totalDowntimeHrs} format="hours" icon={<AlertTriangle size={14} />} ragStatus={totalDowntimeHrs <= 200 ? 'green' : totalDowntimeHrs <= 500 ? 'amber' : 'red'} onClick={() => navigate('/reports/drilldown/downtime')} clickLabel="View Downtime analysis" />
        {/* Filtered actuals, not the all-time RPC — this card sat at $773,500
            regardless of the date range, contradicting the Cost & Parts tab. */}
        <ReportKPICard title="Total Cost" value={totalCost} format="currency" subtitle="labour + material, frozen at closure" icon={<DollarSign size={14} />} ragStatus="neutral" onClick={() => setActiveTab('costParts')} clickLabel="View Costs & Parts" />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ReportChartCard title="Work Order Trend" subtitle="Preventive vs Corrective (12 months)" onPin={() => pinWidget('wo-trend', 'chart', 'Work Order Trend')} onDrillDown={() => navigate('/work-orders')} drillDownLabel="View Work Orders">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={woTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="Preventive" stackId="1" stroke={COLORS.emerald} fill={COLORS.emerald} fillOpacity={0.3} />
              <Area type="monotone" dataKey="Corrective" stackId="1" stroke={COLORS.red} fill={COLORS.red} fillOpacity={0.3} />
            </AreaChart>
          </ResponsiveContainer>
        </ReportChartCard>

        <ReportChartCard title="Backlog Aging" subtitle="Open work orders by age" onPin={() => pinWidget('backlog-aging', 'chart', 'Backlog Aging')} onDrillDown={() => navigate('/reports/drilldown/backlog')} drillDownLabel="View Backlog details">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={backlogAging} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }} />
              <YAxis dataKey="age" type="category" tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }} width={60} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="count" name="Open WOs" radius={[0, 4, 4, 0]}>
                {backlogAging.map((_, i) => (
                  <Cell key={i} fill={[COLORS.emerald, COLORS.amber, COLORS.red, '#dc2626'][i]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ReportChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ReportChartCard title="Work Requests by Status" subtitle="Breakdown of submitted work requests" onPin={() => pinWidget('requests-by-status', 'chart', 'Requests by Status')} onDrillDown={() => navigate('/requests')} drillDownLabel="View Work Requests">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={requestsByStatus} cx="50%" cy="50%" innerRadius={60} outerRadius={95} paddingAngle={3} dataKey="value" label={({ name, percent = 0 }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                {requestsByStatus.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </ReportChartCard>

        <ReportChartCard title="Asset Criticality Distribution" subtitle="Dictionary-mapped criticality levels" onPin={() => pinWidget('asset-criticality', 'chart', 'Asset Criticality')} onDrillDown={() => navigate('/assets')} drillDownLabel="View Assets">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={assetCriticalityDist}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="value" name="Assets" radius={[4, 4, 0, 0]}>
                {assetCriticalityDist.map((_, i) => <Cell key={i} fill={[COLORS.red, COLORS.amber, COLORS.emerald, COLORS.blue][i % 4]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ReportChartCard>
      </div>
    </div>
  );

  const renderWorkOrders = () => (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <ReportKPICard title="Created" value={totalWOs} format="number" icon={<Wrench size={14} />} ragStatus="neutral" sparkData={woSparkline} sparkColor={COLORS.blue} onClick={() => navigate('/work-orders')} clickLabel="View all Work Orders" />
        <ReportKPICard title="Completed" value={completedWOs} format="number" icon={<CheckCircle2 size={14} />} ragStatus="green" onClick={() => navigate('/work-orders')} clickLabel="View completed Work Orders" />
        <ReportKPICard title="On-Time Rate" value={onTimeRate} format="percent" target={Math.round(onTimeRate)} icon={<Target size={14} />} ragStatus={onTimeRate >= 90 ? 'green' : onTimeRate >= 75 ? 'amber' : 'red'} onClick={() => navigate('/reports/drilldown/mtbf-mttr')} clickLabel="View on-time analysis" />
        <ReportKPICard title="Overdue" value={overdueWOs} format="number" icon={<AlertTriangle size={14} />} ragStatus={overdueWOs === 0 ? 'green' : overdueWOs <= 5 ? 'amber' : 'red'} onClick={() => navigate('/work-orders')} clickLabel="View overdue Work Orders" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Created vs Completed */}
        <ReportChartCard title="Created vs Completed" subtitle="Monthly work order throughput" onPin={() => pinWidget('wo-trend', 'chart', 'Created vs Completed')} onDrillDown={() => navigate('/work-orders')} drillDownLabel="View Work Orders">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={woTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Total" name="Created" fill={COLORS.blue} radius={[4, 4, 0, 0]} />
              <Bar dataKey="Preventive" name="Completed (PM)" fill={COLORS.emerald} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ReportChartCard>

        {/* PM vs CM Ratio */}
        <ReportChartCard title="PM vs CM Ratio" subtitle={`${pmRatio.toFixed(0)}% preventive — Target: 80%`} onPin={() => pinWidget('pm-vs-cm', 'chart', 'PM vs CM Ratio')} onDrillDown={() => navigate('/recurring-work')} drillDownLabel="View Recurring Work">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={[
                { name: 'Preventive', value: preventiveWOs },
                { name: 'Corrective', value: correctiveWOs },
                { name: 'Other', value: Math.max(0, totalWOs - preventiveWOs - correctiveWOs) },
              ]} cx="50%" cy="50%" innerRadius={60} outerRadius={95} paddingAngle={3} dataKey="value" label={({ name, percent = 0 }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                <Cell fill={COLORS.emerald} /><Cell fill={COLORS.red} /><Cell fill={COLORS.slate} />
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </ReportChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* On-Time vs Overdue by Priority */}
        <ReportChartCard title="On-Time vs Overdue by Priority" subtitle="Work order compliance" onPin={() => pinWidget('wo-by-type', 'chart', 'On-Time vs Overdue')} onDrillDown={() => navigate('/work-orders')} drillDownLabel="View Work Orders">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={woByPriority} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }} />
              <YAxis dataKey="priority" type="category" tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }} width={70} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="onTime" name="On Time" stackId="a" fill={COLORS.emerald} />
              <Bar dataKey="overdue" name="Overdue" stackId="a" fill={COLORS.red} />
            </BarChart>
          </ResponsiveContainer>
        </ReportChartCard>

        {/* WO by Type */}
        <ReportChartCard title="Work Orders by Type" subtitle="Distribution across work types" onPin={() => pinWidget('wo-by-type', 'chart', 'WOs by Type')} onDrillDown={() => navigate('/work-orders')} drillDownLabel="View Work Orders">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={woByType} cx="50%" cy="50%" outerRadius={95} dataKey="value" label={({ name, percent = 0 }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                {woByType.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </ReportChartCard>
      </div>

      {/* Backlog Aging + Work Request RPN */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ReportChartCard title="Backlog Aging" subtitle="Open work orders grouped by age bucket" onDrillDown={() => navigate('/reports/drilldown/backlog')} drillDownLabel="View Backlog details">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={backlogAging}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="age" tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="count" name="Open WOs" radius={[4, 4, 0, 0]}>
                {backlogAging.map((_, i) => <Cell key={i} fill={[COLORS.emerald, COLORS.amber, COLORS.red, '#dc2626'][i]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ReportChartCard>

        <ReportChartCard title="Work Request RPN" subtitle="Risk Priority Number (Criticality × Severity)" onDrillDown={() => navigate('/requests')} drillDownLabel="View Work Requests">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={requestsByRPN} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }} />
              <YAxis dataKey="name" type="category" tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }} width={120} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="value" name="Requests" radius={[0, 4, 4, 0]}>
                {requestsByRPN.map((_, i) => <Cell key={i} fill={[COLORS.red, COLORS.amber, COLORS.emerald][i]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ReportChartCard>
      </div>

      {/* Notification Aging + PM Plan Compliance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ReportChartCard title="Notification Aging" subtitle="Work request age by response bucket" onDrillDown={() => navigate('/requests')} drillDownLabel="View Work Requests">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={notificationAging} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }} />
              <YAxis dataKey="age" type="category" tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }} width={55} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="count" name="Requests" radius={[0, 4, 4, 0]}>
                {notificationAging.map((_, i) => <Cell key={i} fill={[COLORS.emerald, COLORS.amber, COLORS.red, '#dc2626'][i]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ReportChartCard>

        <ReportChartCard title="PM Plan Compliance" subtitle="Scheduled vs executed PMs by month" onPin={() => pinWidget('pm-compliance', 'chart', 'PM Compliance')}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={pmCompliance}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Scheduled" fill={COLORS.blue} radius={[4, 4, 0, 0]} />
              <Bar dataKey="Executed" fill={COLORS.emerald} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ReportChartCard>
      </div>
    </div>
  );

  const renderAssetHealth = () => {
    const badActorCols: TableColumn[] = [
      { key: 'asset_tag', label: 'Asset Tag', width: '120px' },
      { key: 'asset_name', label: 'Asset Name' },
      { key: 'criticality', label: 'Criticality', ragThresholds: undefined },
      { key: 'wo_count', label: 'WO Count', format: 'number', dataBar: true },
      { key: 'total_cost', label: 'Total Cost', format: 'currency', dataBar: true },
      { key: 'total_downtime_hrs', label: 'Downtime (hrs)', format: 'hours', dataBar: true },
      { key: 'pct_of_total_wos', label: '% of WOs', format: 'percent' },
    ];

    const costByAssetCols: TableColumn[] = [
      { key: 'asset_tag', label: 'Asset Tag', width: '120px' },
      { key: 'asset_name', label: 'Asset Name' },
      { key: 'criticality', label: 'Criticality' },
      { key: 'wo_count', label: 'WO Count', format: 'number', dataBar: true },
      { key: 'total_cost', label: 'Total Cost', format: 'currency', dataBar: true },
      { key: 'avg_cost_per_wo', label: 'Avg Cost / WO', format: 'currency' },
    ];

    return (
      <div className="space-y-6">
        {/* Group By Selector */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Group By</label>
            <select
              value={groupBy}
              onChange={e => setGroupBy(e.target.value as any)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300 shadow-sm"
            >
              <option value="none">No Grouping</option>
              <option value="unit">Unit</option>
              <option value="system">System</option>
              <option value="criticality">Criticality</option>
              <option value="assetType">Asset Type</option>
              <option value="assetClass">Asset Class</option>
            </select>
          </div>
          {groupBy !== 'none' && (
            <span className="text-xs text-slate-400 italic">Charts aggregated by {groupBy === 'assetType' ? 'Asset Type' : groupBy === 'assetClass' ? 'Asset Class' : groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}</span>
          )}
        </div>
        {/* KPI Cards */}
        <div className="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 sm:gap-4">
          <ReportKPICard title="Assets Online" value={filteredAssets.filter((a: any) => a.status?.toUpperCase() !== 'DECOMMISSIONED').length} format="number" icon={<Package size={14} />} ragStatus="green" onClick={() => navigate('/assets')} clickLabel="View all Assets" />
          <ReportKPICard title="Avg asset MTBF" value={avgAssetMtbf?.days ?? '—'} format={avgAssetMtbf ? 'number' : undefined} subtitle={avgAssetMtbf ? `days · mean of ${avgAssetMtbf.n} assets with failures` : 'no failures recorded in range'} icon={<Timer size={14} />} ragStatus={!avgAssetMtbf ? 'neutral' : avgAssetMtbf.days >= 90 ? 'green' : avgAssetMtbf.days >= 30 ? 'amber' : 'red'} onClick={() => navigate('/reports/drilldown/mtbf-mttr')} clickLabel="View MTBF/MTTR analysis" />
          {/* Canonical, so this tab agrees with the overview. The RPC these used
              averages downtime over ALL work orders (PMs included) and ignores
              the page's date range and hierarchy slicers. */}
          <ReportKPICard title="Avg MTTR" value={reliability.mttrHours ?? '—'} format={reliability.mttrHours == null ? undefined : 'hours'} subtitle={reliability.mttrHours == null ? 'no timed repairs in range' : `${reliability.downtimeCoveragePct}% of failures timed`} icon={<Clock size={14} />} ragStatus={reliability.mttrHours == null ? 'neutral' : reliability.mttrHours <= 4 ? 'green' : reliability.mttrHours <= 8 ? 'amber' : 'red'} onClick={() => navigate('/reports/drilldown/mtbf-mttr')} clickLabel="View MTBF/MTTR analysis" />
          <ReportKPICard title="Availability" value={reliability.availabilityPct ?? '—'} format={reliability.availabilityPct == null ? undefined : 'percent'} subtitle="inherent — MTBF/(MTBF+MTTR)" target={95} targetLabel="Target: 95%" icon={<Gauge size={14} />} ragStatus={reliability.availabilityPct == null ? 'neutral' : reliability.availabilityPct >= 95 ? 'green' : reliability.availabilityPct >= 85 ? 'amber' : 'red'} onClick={() => navigate('/reports/drilldown/availability')} clickLabel="View Availability trend" />
          {/* OEE needs production data. The fallback path invents performance
            (0.88) and quality (0.96); `isReal` existed but was never read, so
            a fabricated OEE rendered as fact. Now it says so. */}
        <ReportKPICard title="OEE" value={oeeData.isReal ? Number((oeeData.oee * 100).toFixed(1)) : '—'} format={oeeData.isReal ? 'percent' : undefined} subtitle={oeeData.isReal ? `from ${oeeData.assetCount} asset(s) logging production` : 'needs production data (rate & quality)'} target={85} targetLabel="Target: 85%" icon={<Activity size={14} />} ragStatus={!oeeData.isReal ? 'neutral' : oeeData.oee >= 0.85 ? 'green' : oeeData.oee >= 0.65 ? 'amber' : 'red'} onClick={() => navigate('/reports/drilldown/oee')} clickLabel="View OEE breakdown" />
          <ReportKPICard title="Total Downtime" value={totalDowntimeHrs} format="hours" icon={<AlertTriangle size={14} />} ragStatus={totalDowntimeHrs <= 200 ? 'green' : totalDowntimeHrs <= 500 ? 'amber' : 'red'} onClick={() => navigate('/reports/drilldown/downtime')} clickLabel="View Downtime analysis" />
          <ReportKPICard title="Bad Actors" value={filteredBadActors.length} format="number" icon={<AlertTriangle size={14} />} ragStatus={filteredBadActors.length <= 3 ? 'green' : filteredBadActors.length <= 7 ? 'amber' : 'red'} onClick={() => navigate('/reports/drilldown/downtime-by-asset')} clickLabel="View Bad Actors" />
        </div>

        {/* Bad Actors Table */}
        <ReportDataTable
          title="Most Problematic Assets (Bad Actors)"
          columns={badActorCols}
          data={filteredBadActors}
          exportFilename="ERS_Bad_Actors_Report.csv"
          onRowClick={(row) => navigate(`/assets?id=${row.asset_id}`)}
          onGroupByChange={(key) => {
            const metricMap: Record<string, 'wo_count' | 'total_cost' | 'downtime_hours'> = {
              total_cost: 'total_cost',
              wo_count: 'wo_count',
              downtime_hours: 'downtime_hours',
            };
            if (key && metricMap[key]) setParetoMetric(metricMap[key]);
          }}
        />

        {/* ── Top 5 Bad Actors Pareto Chart ── */}
        <ReportChartCard
          title="Top 5 Bad Actors Pareto"
          subtitle={`Monthly Pareto Analysis: ${paretoLabels[paretoMetric].subtitle}`}
          infoTooltip="Bar = selected metric per asset. Line = cumulative %. Use the table's grouping dropdown above to switch ranking."
          onDrillDown={() => navigate('/reports/drilldown/pareto')}
          onPin={() => pinWidget('top-5-pareto', 'chart', 'Top 5 Pareto', 12, 1)}
          height={380}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={top5BadActors} margin={{ top: 10, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="asset" tick={{ fill: '#64748b', fontSize: 11 }} />
              <YAxis yAxisId="left" tick={{ fill: '#64748b', fontSize: 11 }} label={{ value: paretoLabels[paretoMetric].yAxis, angle: -90, position: 'insideLeft', fill: '#94a3b8' }} />
              <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 11 }} label={{ value: 'Cumulative %', angle: 90, position: 'insideRight', fill: '#94a3b8' }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="left" dataKey="Value" name={paretoLabels[paretoMetric].label} fill={COLORS.red} barSize={40} radius={[4, 4, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="CumulativePct" stroke={COLORS.indigo} strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} name="Cumulative %" />
            </ComposedChart>
          </ResponsiveContainer>
        </ReportChartCard>

        {/* ── Systems thinking (Phases 2+3): who CAUSES damage vs who incurs it,
            the record rolled up to system level, and the dependency model ── */}
        <TroubleMakersCard />
        <SystemHotspotsCard />
        <SystemViewSection />

        {/* ── Maintenance Cost by Asset ── */}
        <ReportChartCard
          title="Maintenance Cost by Asset"
          subtitle="Top 12 by total cost — labour + material, frozen at closure"
          infoTooltip="Aggregated from the filtered work orders on this page, grouped by asset. Same frozen-cost basis as the Cost & Parts tab."
          height={380}
          onPin={() => pinWidget('cost-by-asset', 'chart', 'Cost by Asset', 12, 1)}
          onDrillDown={() => setActiveTab('costParts')}
          drillDownLabel="View Costs & Parts"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={costByAssetTop12} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
              <YAxis dataKey="asset" type="category" tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }} width={110} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="Total Cost" name="Total Cost" fill={COLORS.indigo} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ReportChartCard>

        <ReportDataTable
          title="Maintenance Cost by Asset"
          columns={costByAssetCols}
          data={costByAsset}
          exportFilename="ERS_Cost_By_Asset_Report.csv"
          onRowClick={(row) => navigate(`/assets?id=${row.asset_id}`)}
        />

        {/* ── NEW: MTBF/MTTR Trend + Downtime by Reason ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ReportChartCard
            title="MTBF vs MTTR by Asset"
            subtitle="Dual-axis: days between failures vs hours to repair"
            infoTooltip="Higher MTBF = more reliable. Lower MTTR = faster repairs."
            onDrillDown={() => navigate('/reports/drilldown/mtbf-mttr')}
            onPin={() => pinWidget('mtbf-mttr', 'chart', 'MTBF vs MTTR')}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mtbfMttrByAsset}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="asset" tick={{ fill: '#64748b', fontSize: 10 }} />
                <YAxis yAxisId="left" tick={{ fill: '#64748b', fontSize: 11 }} label={{ value: 'MTBF (days)', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 10 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: '#64748b', fontSize: 11 }} label={{ value: 'MTTR (hrs)', angle: 90, position: 'insideRight', fill: '#94a3b8', fontSize: 10 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="left" dataKey="MTBF" name="MTBF (days)" fill={COLORS.blue} radius={[4, 4, 0, 0]} />
                <Bar yAxisId="right" dataKey="MTTR" name="MTTR (hrs)" fill={COLORS.amber} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ReportChartCard>

          <ReportChartCard
            title="Downtime by Reason"
            subtitle="Root cause breakdown of total downtime"
            infoTooltip="Categorize downtime to identify systemic issues"
            onDrillDown={() => navigate('/reports/drilldown/downtime-by-reason')}
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={downtimeReasons} cx="50%" cy="50%" innerRadius={55} outerRadius={100} paddingAngle={3} dataKey="hours" nameKey="reason"
                  label={({ name, percent = 0 }: any) => `${String(name).slice(0, 12)} ${(percent * 100).toFixed(0)}%`}>
                  {downtimeReasons.map((d: { reason: string; hours: number; color: string }, i: number) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </ReportChartCard>
        </div>

        {/* ── Asset health gauges + reactive vs preventive ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* OEE Dashboard — data-driven from production_logs */}
          <div className="lg:col-span-2">
            <OEEDashboard
              dateRange={{ from: dateRange.start, to: dateRange.end }}
              onNavigate={(path) => navigate(path)}
            />
          </div>

          <ReportChartCard title="Reactive vs Preventive Trend" subtitle="Monthly work type distribution" onDrillDown={() => navigate('/work-orders')} drillDownLabel="View Work Orders">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={woTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="Preventive" stroke={COLORS.emerald} fill={COLORS.emerald} fillOpacity={0.3} />
                <Area type="monotone" dataKey="Corrective" stroke={COLORS.red} fill={COLORS.red} fillOpacity={0.3} />
              </AreaChart>
            </ResponsiveContainer>
          </ReportChartCard>
        </div>
      </div>
    );
  };

  const renderCostParts = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <ReportKPICard title="Total Cost" value={totalCost} format="currency" icon={<DollarSign size={14} />} ragStatus="neutral" />
        <ReportKPICard title="Labor Cost" value={laborCostTotal} format="currency" subtitle="frozen at closure" icon={<Users size={14} />} ragStatus="neutral" />
        <ReportKPICard title="Parts Cost" value={partsCostTotal} format="currency" subtitle="frozen at closure" icon={<Package size={14} />} ragStatus="neutral" />
        <ReportKPICard title="Avg Cost/WO" value={avgCostPerWO} format="currency" icon={<Zap size={14} />} ragStatus="neutral" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ReportChartCard title="Cost Trend" subtitle="Labor + Parts cost over time" height={300} onPin={() => pinWidget('cost-trend', 'chart', 'Cost Trend', 6, 1)}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={costData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="Labor" stackId="1" stroke={COLORS.blue} fill={COLORS.blue} fillOpacity={0.3} />
              <Area type="monotone" dataKey="Parts" stackId="1" stroke={COLORS.amber} fill={COLORS.amber} fillOpacity={0.3} />
            </AreaChart>
          </ResponsiveContainer>
        </ReportChartCard>

        {/* Honesty fix: this chart plots DOLLARS from costData but was titled
            "Resource Utilization" with series named "Productive/Support Hrs".
            True wrench-time needs labour confirmations vs paid hours — not built yet. */}
        <ReportChartCard title="Cost Mix" subtitle="Labor vs parts cost by month" onPin={() => pinWidget('cost-mix', 'chart', 'Cost Mix', 6, 1)}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={costData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Labor" name="Labor $" stackId="a" fill={COLORS.emerald} radius={[4, 4, 0, 0]} />
              <Bar dataKey="Parts" name="Parts $" stackId="a" fill={COLORS.cyan} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ReportChartCard>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {/* Costs by ISO 14224 Hierarchy */}
        <ReportChartCard title="Costs by Hierarchy (ISO 14224)" subtitle="Top 10 highest cost structures (Site / Location)" height={380}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={costsByHierarchy} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
              <YAxis dataKey="name" type="category" tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }} width={150} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="value" name="Total Cost" fill={COLORS.blue} radius={[0, 4, 4, 0]}>
                {costsByHierarchy.map((_, i) => <Cell key={i} fill={COLORS.blue} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ReportChartCard>
      </div>
    </div>
  );

  const renderDetails = () => {
    // wo_cost is projected here because the table reads row fields by key and
    // there is no single cost column to point at.
    const detailRows = filteredWOs.map((w: any) => ({ ...w, wo_cost: woCost(w) }));
    const detailCols: TableColumn[] = [
      { key: 'job_number', label: 'WO #', width: '100px' },
      { key: 'title', label: 'Title' },
      { key: 'type', label: 'Type' },
      { key: 'priority', label: 'Priority' },
      { key: 'status', label: 'Status' },
      { key: 'department', label: 'Department' },
      { key: 'wo_cost', label: 'Actual Cost', format: 'currency', dataBar: true },
      { key: 'created_at', label: 'Created', format: 'date' },
    ];

    return (
      <ReportDataTable
        title="Work Order Details"
        columns={detailCols}
        data={detailRows}
        pageSize={25}
        exportFilename="ERS_Work_Order_Report.csv"
      />
    );
  };

  const renderCustomDashboards = () => (
    <CustomDashboardTab widgetData={widgetData} />
  );

  // ── Main Render ─────────────────────────────────────────
  const loading = woLoading;

  return (
    <div className="space-y-0">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <FileBarChart size={24} className="text-blue-600" />
            Reports
          </h1>
          <p className="text-sm font-medium text-slate-500 mt-1">Enterprise Analytics & Intelligence</p>
        </div>
        <div className="flex items-center gap-3">
          {!filterPanelOpen && (
            <ReportFilterPanel
              filters={filters} onChange={setFilters} dictionaries={dictionaries}
              isOpen={false} onToggle={() => setFilterPanelOpen(true)} assets={assets} workOrders={workOrders}
            />
          )}
          <DateRangePicker value={dateRange} onChange={setDateRange} />
          <button
            onClick={() => {
              // Export all KPI data for the current tab
              const kpiExport = [
                { metric: 'Total WOs', value: totalWOs },
                { metric: 'PM Ratio % (preventive share)', value: pmRatioCanonical.ratioPct ?? 'n/a' },
                { metric: 'PM Compliance % (by due date)', value: pmComplianceKpi.compliancePct ?? 'n/a' },
                { metric: 'MTBF (hrs)', value: reliability.mtbfHours ?? 'n/a' },
                { metric: 'MTTR (hrs)', value: reliability.mttrHours ?? 'n/a' },
                { metric: 'Availability %', value: reliability.availabilityPct ?? 'n/a' },
                { metric: 'OEE %', value: oeeData.isReal ? (oeeData.oee * 100).toFixed(1) : 'needs production data' },
                { metric: 'Total Downtime (hrs)', value: totalDowntimeHrs },
                { metric: 'Total Cost', value: totalCost },
                { metric: 'Labour Cost', value: laborCostTotal },
                { metric: 'Parts Cost', value: partsCostTotal },
                { metric: 'Bad Actors', value: badActors.length },
              ];
              const cols = [{ key: 'metric', label: 'Metric' }, { key: 'value', label: 'Value' }];
              exportXLSX(kpiExport, cols, `ERS_Reports_${activeTab}_${new Date().toISOString().slice(0,10)}.xlsx`);
            }}
            className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm text-white font-medium transition-colors shadow-sm"
          >
            <Download size={14} /> Export
          </button>
        </div>
      </div>

      {/* Row-cap warning — one banner, not a wrong number per card */}
      {dataTruncated && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3 mb-6 text-sm">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
          <p>
            Result cap reached — KPIs below are computed from the first {ROW_CAP_TXN.toLocaleString()} rows
            ({ROW_CAP_REF.toLocaleString()} for assets). Narrow the date range or filters for exact numbers.
          </p>
        </div>
      )}

      {/* Tab Bar — horizontally scrollable on mobile */}
      <div className="relative mb-6">
        <div className="flex gap-0.5 sm:gap-1 border-b border-slate-200 overflow-x-auto pb-px scrollbar-hide">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2.5 text-xs sm:text-sm font-semibold whitespace-nowrap transition-all border-b-2
              ${activeTab === tab.key
                ? 'text-blue-600 border-blue-600 bg-blue-50'
                : 'text-slate-500 border-transparent hover:text-slate-900 hover:border-slate-300'
              }`}
          >
            {tab.icon} <span className="hidden xs:inline sm:inline">{tab.label}</span>
            <span className="xs:hidden sm:hidden">{tab.label.split(' ')[0]}</span>
          </button>
        ))}
        </div>
        {/* Fade indicator for scroll */}
        <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white to-transparent pointer-events-none sm:hidden" />
      </div>

      {/* Content Area (Filter Panel is now overlay on mobile, so no side-by-side flexing needed below lg) */}
      <div className="flex gap-4">
        {/* Slicer Panel — only renders inline on desktop (lg+); mobile is handled as overlay */}
        <div className="hidden lg:block">
          {filterPanelOpen && (
            <ReportFilterPanel
              filters={filters} onChange={setFilters} dictionaries={dictionaries}
              isOpen={true} onToggle={() => setFilterPanelOpen(false)} assets={assets} workOrders={workOrders}
            />
          )}
        </div>
        {/* Mobile filter toggle — renders the overlay version */}
        <div className="lg:hidden">
          {filterPanelOpen && (
            <ReportFilterPanel
              filters={filters} onChange={setFilters} dictionaries={dictionaries}
              isOpen={true} onToggle={() => setFilterPanelOpen(false)} assets={assets} workOrders={workOrders}
            />
          )}
        </div>

        {/* Tab Content */}
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 size={32} className="animate-spin text-blue-400" />
            </div>
          ) : (
            <>
              {activeTab === 'overview' && renderOverview()}
              {activeTab === 'workOrders' && renderWorkOrders()}
              {activeTab === 'assetHealth' && renderAssetHealth()}
              {activeTab === 'costParts' && renderCostParts()}
              {activeTab === 'details' && renderDetails()}
              {activeTab === 'customDash' && renderCustomDashboards()}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
