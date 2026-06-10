import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AskRelanternButton } from '../components/AskRelanternButton';
import { useAuth } from '../contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as ReTooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Area, AreaChart
} from 'recharts';
import {
  TrendingUp, TrendingDown, AlertCircle, CheckCircle, Clock, Activity,
  Wrench, Package, RefreshCw, Loader2, Plus, ArrowRight,
  AlertTriangle, BarChart3, Inbox, Bell, BellRing,
  Gauge, Timer, Skull, Target
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { DatabaseService } from '../services/DatabaseService';
import ersApi, { BadActorEntry } from '../services/ERSApiClient';

// ──────────────────────────────── Fetcher ────────────────────────────────
const fetchDashboardData = async (userId?: string, siteIds?: string[] | null) => {
  const now = new Date();
  const nowISO = now.toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();

  // ── Optimized: 7 parallel queries instead of 12 ──
  // Single WO query provides: status counts, overdue, recent, trend
  const [
    woResult, srResult, assetResult, inventoryResult,
    myWorkResult, notificationsResult, pmWoResult, assetMtbfResult,
    deTasksResult,
  ] = await Promise.all([
    // 1. ALL work orders (single query replaces 5 separate ones)
    supabase.from('work_orders')
      .select('id, wo_number, title, status, type, priority, created_at, closed_at, due_date, updated_at, asset_tag')
      .order('updated_at', { ascending: false }),
    // 2. Service requests — counts only
    supabase.from('service_requests').select('status'),
    // 3. Assets — core fields
    supabase.from('assets').select('id, tag, name, criticality, status_code, mtbf_days, mttr_hours'),
    // 4. Inventory — minimal fields for stock alerts
    supabase.from('inventory_items').select('id, stock_on_hand, min_level, is_critical'),
    // 5. My work (user-specific, limited)
    userId
      ? supabase.from('work_orders')
          .select('id, wo_number, title, status, type, due_date, priority, asset_tag')
          .not('status', 'in', '("CLOSED","TECO","CANCELLED")')
          .order('due_date', { ascending: true })
          .limit(10)
      : Promise.resolve({ data: [] }),
    // 6. Notifications (user-specific, limited)
    userId
      ? supabase.from('notifications')
          .select('id, title, message, severity, module, is_read, created_at, notification_type')
          .eq('recipient_id', userId)
          .eq('is_read', false)
          .order('created_at', { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [] }),
    // 7. PM work orders for compliance
    supabase.from('work_orders')
      .select('status, type, due_date, closed_at')
      .in('type', ['PM', 'Preventive', 'Preventative', 'SCHEDULED']),
    // 8. Asset MTBF for bad actors
    supabase.from('assets')
      .select('tag, name, mtbf_days, mttr_hours, criticality')
      .not('mtbf_days', 'is', null)
      .order('mtbf_days', { ascending: true })
      .limit(20),
    // 9. Defect elimination tasks
    supabase.from('ers_defect_elimination_tasks')
      .select('id, status, priority, annual_cost, estimated_savings, implementation_cost, created_at')
      .order('created_at', { ascending: false }),
  ]);

  // ── Error diagnostics: log any silent Supabase failures ──
  const results = [
    { name: 'work_orders', ...woResult },
    { name: 'service_requests', ...srResult },
    { name: 'assets', ...assetResult },
    { name: 'inventory', ...inventoryResult },
    { name: 'my_work', ...(myWorkResult as any) },
    { name: 'notifications', ...(notificationsResult as any) },
    { name: 'pm_work_orders', ...pmWoResult },
    { name: 'asset_mtbf', ...assetMtbfResult },
    { name: 'de_tasks', ...deTasksResult },
  ];
  results.forEach(r => {
    if (r.error) console.error(`[Dashboard] ❌ ${r.name} query failed:`, r.error);
  });
  console.log(`[Dashboard] ✓ Loaded: ${woResult.data?.length ?? 0} WOs, ${srResult.data?.length ?? 0} SRs, ${assetResult.data?.length ?? 0} Assets, ${inventoryResult.data?.length ?? 0} Inventory`);

  const allWOs = woResult.data || [];

  // ── Derive overdue, recent, and trend from single WO query ──
  const overdue = allWOs
    .filter((wo: any) => wo.due_date && wo.due_date < nowISO &&
      !['CLOSED', 'TECO', 'CANCELLED'].includes(wo.status))
    .sort((a: any, b: any) => a.due_date.localeCompare(b.due_date))
    .slice(0, 8);

  const recent = allWOs.slice(0, 6); // Already ordered by updated_at desc

  const woTrend = allWOs.filter((wo: any) => wo.created_at >= sevenDaysAgo);

  // ═══ Site Scope Filtering (ISO 55000 Data Boundary Enforcement) ═══
  const isGlobalScope = !siteIds || siteIds.length === 0 || siteIds.includes('*');

  let scopedAssetIds: Set<string> | null = null;
  let rawAssets = assetResult.data || [];
  let rawWos = allWOs;

  if (!isGlobalScope) {
    const fullAssets = await DatabaseService.getInstance().getAssets();
    const scopedAssets = DatabaseService.filterAssetsBySiteScope(fullAssets, siteIds);
    scopedAssetIds = new Set(scopedAssets.map(a => a.id));
    rawAssets = rawAssets.filter((a: any) => scopedAssetIds!.has(a.id));
  }

  let scopedAssetTags: Set<string> | null = null;
  if (scopedAssetIds) {
    scopedAssetTags = new Set(rawAssets.map((a: any) => a.tag));
  }
  const filterWOs = (wos: any[]) => {
    if (!scopedAssetTags) return wos;
    return wos.filter((wo: any) => !wo.asset_tag || scopedAssetTags!.has(wo.asset_tag));
  };

  return {
    wos: filterWOs(rawWos), srs: srResult.data || [],
    assets: rawAssets, inventory: inventoryResult.data || [],
    overdue: filterWOs(overdue), recent: filterWOs(recent),
    myWork: filterWOs(myWorkResult.data || []), notifications: notificationsResult.data || [],
    woTrend: filterWOs(woTrend), pmWos: filterWOs(pmWoResult.data || []),
    assetMtbf: scopedAssetIds
      ? (assetMtbfResult.data || []).filter((a: any) => scopedAssetIds!.has(a.id) || scopedAssetTags?.has(a.tag))
      : (assetMtbfResult.data || []),
    deTasks: deTasksResult.data || [],
  };
};

// ──────────────────────────────── Helpers ────────────────────────────────
const getGreeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

const STATUS_COLORS: Record<string, string> = {
  OPEN: '#3b82f6', PLAN: '#8b5cf6', SCHEDULED: '#6366f1', WIP: '#f59e0b',
  HOLD: '#ef4444', REVIEW: '#10b981', COMP: '#14b8a6', TECO: '#22c55e',
  CLOSED: '#64748b', CANCELLED: '#94a3b8',
};

const timeAgo = (date: string) => {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

const priorityColor = (p?: string) => {
  if (!p) return 'bg-slate-100 text-slate-600';
  const pl = p.toUpperCase();
  if (pl === 'EMERGENCY' || pl === '1') return 'bg-red-100 text-red-700';
  if (pl === 'URGENT' || pl === '2') return 'bg-amber-100 text-amber-700';
  if (pl === 'HIGH' || pl === '3') return 'bg-orange-100 text-orange-700';
  return 'bg-slate-100 text-slate-600';
};

const severityIcon = (s: string) => {
  if (s === 'critical') return <AlertCircle size={16} className="text-red-500" />;
  if (s === 'warning') return <AlertTriangle size={16} className="text-amber-500" />;
  return <Bell size={16} className="text-blue-500" />;
};

const severityBg = (s: string) => {
  if (s === 'critical') return 'border-l-red-500 bg-red-50/40';
  if (s === 'warning') return 'border-l-amber-500 bg-amber-50/40';
  return 'border-l-blue-500 bg-blue-50/30';
};

const SPARKLINE_COLORS = { created: '#3b82f6', closed: '#22c55e' };

// ──────────────────────────────── Dashboard ────────────────────────────────
export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user, profile, dataScope, role } = useAuth();
  const userName = (profile as any)?.fullName || (profile as any)?.username || 'Operator';
  const userRole = role || '';
  const [workTab, setWorkTab] = useState<'active' | 'recent'>('active');
  const [apiBadActors, setApiBadActors] = useState<BadActorEntry[] | null>(null);

  const { data, isLoading, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['dashboardStats', profile?.id, dataScope?.siteIds],
    queryFn: () => fetchDashboardData(profile?.id, dataScope?.siteIds),
    enabled: !!profile?.id, // Don't fire until auth is ready (prevents anon key hitting RLS)
    staleTime: 1000 * 30, // 30s — avoid re-fetch storms during auth state changes
    refetchInterval: 1000 * 60 * 2,
  });

  // ── Try API-driven Bad Actor report (Railway) → fallback to MTBF ──
  useEffect(() => {
    if (!ersApi.isConfigured) return;
    (async () => {
      try {
        const report = await ersApi.getLatestBadActorReport();
        if (report?.top_assets?.length > 0) {
          setApiBadActors(report.top_assets.slice(0, 5));
          console.log('[Dashboard] API-driven bad actors loaded:', report.top_assets.length);
        }
      } catch {
        // Silently fall back to Supabase MTBF-based bad actors
        console.log('[Dashboard] API bad actors unavailable, using MTBF fallback');
      }
    })();
  }, [data]); // Re-fetch when dashboard data refreshes

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        {/* Header skeleton */}
        <div className="flex justify-between items-end">
          <div>
            <div className="h-7 bg-slate-200 rounded-lg w-64 mb-2"></div>
            <div className="h-4 bg-slate-100 rounded w-40"></div>
          </div>
          <div className="flex gap-2">
            <div className="h-9 bg-slate-200 rounded-lg w-24"></div>
            <div className="h-9 bg-slate-200 rounded-lg w-20"></div>
          </div>
        </div>
        {/* Quick Actions skeleton */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1,2,3,4].map(i => <div key={i} className="h-12 bg-slate-200 rounded-xl"></div>)}
        </div>
        {/* KPI Cards skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => (
            <div key={i} className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
              <div className="flex justify-between items-start mb-3">
                <div className="w-9 h-9 bg-slate-100 rounded-lg"></div>
                <div className="h-5 bg-slate-100 rounded-full w-16"></div>
              </div>
              <div className="h-4 bg-slate-100 rounded w-28 mb-2"></div>
              <div className="h-8 bg-slate-200 rounded w-16"></div>
            </div>
          ))}
        </div>
        {/* Work panels skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 h-72"></div>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 h-72"></div>
        </div>
        {/* Analytics cards skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <div key={i} className="bg-white rounded-xl shadow-sm border border-slate-200 h-48"></div>)}
        </div>
      </div>
    );
  }
  if (error) {
    return <div className="p-8 text-red-500">Error loading dashboard: {(error as Error).message}</div>;
  }

  const { wos, srs, assets, inventory, overdue, recent, myWork, notifications, woTrend, pmWos, assetMtbf, deTasks } = data!;

  // ── Derived Metrics ──
  const statusMap: Record<string, number> = {};
  wos.forEach((wo: any) => { statusMap[wo.status] = (statusMap[wo.status] || 0) + 1; });

  const totalWOs = wos.length;
  const openWOs = (statusMap['OPEN'] || 0) + (statusMap['WIP'] || 0);
  const pendingSRs = srs.filter((sr: any) => sr.status !== 'CONVERTED' && sr.status !== 'REJECTED').length;
  const totalAssets = assets.length;
  const criticalAssets = assets.filter((a: any) => a.criticality === 'A').length;
  const lowStockItems = inventory.filter((i: any) =>
    i.stock_on_hand !== null && i.min_level !== null && i.stock_on_hand <= i.min_level
  ).length;
  const lastUpdate = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : '...';

  // ── PM Schedule Compliance ──
  const totalPM = pmWos.length;
  const pmClosed = pmWos.filter((w: any) => w.status === 'CLOSED' || w.status === 'TECO').length;
  const pmOnTime = pmWos.filter((w: any) => {
    if (w.status !== 'CLOSED' && w.status !== 'TECO') return false;
    if (!w.closed_at || !w.due_date) return false;
    return new Date(w.closed_at) <= new Date(w.due_date);
  }).length;
  const pmComplianceRate = totalPM > 0 ? Math.round((pmOnTime / totalPM) * 100) : 0;
  const pmComplianceData = [
    { name: 'On-Time', value: pmOnTime, color: '#22c55e' },
    { name: 'Late', value: pmClosed - pmOnTime, color: '#f59e0b' },
    { name: 'Open', value: totalPM - pmClosed, color: '#e2e8f0' },
  ].filter(d => d.value > 0);

  // ── Backlog Aging ──
  const openWOsList = wos.filter((w: any) => w.status !== 'CLOSED' && w.status !== 'TECO' && w.status !== 'CANCELLED');
  const now = Date.now();
  const agingBuckets = [
    { label: '0-7d', min: 0, max: 7, count: 0, color: '#3b82f6' },
    { label: '7-14d', min: 7, max: 14, count: 0, color: '#6366f1' },
    { label: '14-30d', min: 14, max: 30, count: 0, color: '#f59e0b' },
    { label: '30d+', min: 30, max: Infinity, count: 0, color: '#ef4444' },
  ];
  openWOsList.forEach((wo: any) => {
    const ageDays = Math.floor((now - new Date(wo.created_at).getTime()) / 86400000);
    const bucket = agingBuckets.find(b => ageDays >= b.min && ageDays < b.max);
    if (bucket) bucket.count++;
  });

  // ── Top 5 Bad Actors (prefer API → fallback to MTBF) ──
  const mtbfBadActors = assetMtbf
    .filter((a: any) => a.mtbf_days !== null && a.mtbf_days > 0)
    .sort((a: any, b: any) => a.mtbf_days - b.mtbf_days)
    .slice(0, 5);
  const badActors = apiBadActors && apiBadActors.length > 0
    ? apiBadActors.map(a => ({
        tag: a.asset_tag,
        name: a.asset_name,
        id: a.asset_id,
        mtbf_days: Math.round(a.total_downtime_hours / Math.max(a.wo_count, 1)),
        mttr_hours: a.total_downtime_hours,
        criticality: null,
        wo_count: a.wo_count,
        total_cost: a.total_cost,
      }))
    : mtbfBadActors;

  // ── Defect Elimination Metrics ──
  const activeDETasks = deTasks.filter((t: any) => t.status === 'identified' || t.status === 'in_progress');
  const resolvedDETasks = deTasks.filter((t: any) => t.status === 'resolved' || t.status === 'verified');
  const totalDESavings = resolvedDETasks.reduce((sum: number, t: any) => sum + (Number(t.estimated_savings) || 0), 0);
  const criticalDETasks = deTasks.filter((t: any) => t.priority === 'critical' && (t.status === 'identified' || t.status === 'in_progress')).length;

  // ── Fleet Reliability ──
  const mtbfValues = assets.filter((a: any) => a.mtbf_days && a.mtbf_days > 0).map((a: any) => a.mtbf_days);
  const mttrValues = assets.filter((a: any) => a.mttr_hours && a.mttr_hours > 0).map((a: any) => a.mttr_hours);
  const avgMTBF = mtbfValues.length > 0 ? Math.round(mtbfValues.reduce((s: number, v: number) => s + v, 0) / mtbfValues.length) : 0;
  const avgMTTR = mttrValues.length > 0 ? Number((mttrValues.reduce((s: number, v: number) => s + v, 0) / mttrValues.length).toFixed(1)) : 0;

  // ── Sparkline data (7-day WO trend) ──
  const sparkDays: { day: string; created: number; closed: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * 86400000);
    const dayStr = d.toLocaleDateString('en', { weekday: 'short' });
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const dayEnd = dayStart + 86400000;
    const created = woTrend.filter((w: any) => {
      const t = new Date(w.created_at).getTime();
      return t >= dayStart && t < dayEnd;
    }).length;
    const closed = woTrend.filter((w: any) => {
      if (!w.closed_at) return false;
      const t = new Date(w.closed_at).getTime();
      return t >= dayStart && t < dayEnd;
    }).length;
    sparkDays.push({ day: dayStr, created, closed });
  }

  // ── Quick Actions ──
  const quickActions = [
    { label: 'Create Work Order', icon: Wrench, color: 'bg-blue-600 hover:bg-blue-700', path: '/work-orders?action=create' },
    { label: 'Log Request', icon: Inbox, color: 'bg-emerald-600 hover:bg-emerald-700', path: '/requests?action=create' },
    { label: 'Add Asset', icon: Plus, color: 'bg-violet-600 hover:bg-violet-700', path: '/assets?action=create' },
    { label: 'View Reports', icon: BarChart3, color: 'bg-slate-700 hover:bg-slate-800', path: '/reports' },
  ];

  // ── KPI Cards (4 — removed WO Completion duplicate) ──
  const kpis = [
    {
      label: 'Open Work Orders', value: openWOs, sub: `${totalWOs} total`,
      icon: <Wrench size={18} />, bgIcon: 'bg-blue-50 text-blue-600',
      trend: openWOs > 5 ? 'up' as const : 'neutral' as const, path: '/work-orders',
    },
    {
      label: 'Pending Requests', value: pendingSRs, sub: `${srs.length} total`,
      icon: <Clock size={18} />, bgIcon: 'bg-amber-50 text-amber-600',
      trend: pendingSRs > 3 ? 'up' as const : 'neutral' as const, path: '/requests',
    },
    {
      label: 'Assets Managed', value: totalAssets, sub: `${criticalAssets} Critical-A`,
      icon: <Activity size={18} />, bgIcon: 'bg-emerald-50 text-emerald-600',
      trend: 'neutral' as const, path: '/assets',
    },
    {
      label: 'Low Stock Alerts', value: lowStockItems, sub: `of ${inventory.length} items`,
      icon: <Package size={18} />, bgIcon: 'bg-rose-50 text-rose-600',
      trend: lowStockItems > 0 ? 'down' as const : 'neutral' as const, path: '/inventory',
    },
  ];

  return (
    <div className="space-y-6">

      {/* ── Row 1: Header ── */}
      <div className="flex flex-wrap justify-between items-end gap-3">
        <div>
          <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-slate-900">{getGreeting()}, {userName}</h1>
          <p className="text-slate-500 text-xs sm:text-sm">
            {userRole && <span className="capitalize">{userRole} • </span>}
            Live data • Updated {lastUpdate}
          </p>
        </div>
        <div className="flex gap-1.5 sm:gap-2">
          <AskRelanternButton
            contextType="dashboard"
            contextSummary={`Dashboard: ${openWOs} Open WOs, ${pendingSRs} Pending SRs, ${totalAssets} Assets (${criticalAssets} Critical-A), ${lowStockItems} Low Stock, MTBF ${avgMTBF}d, MTTR ${avgMTTR}h.`}
          />
          <button onClick={() => refetch()} className="px-2.5 sm:px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs sm:text-sm font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 transition">
            <RefreshCw size={14} /> <span className="hidden xs:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* ── Quick Actions ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        {quickActions.map(qa => (
          <button key={qa.label} onClick={() => navigate(qa.path)}
            className={`${qa.color} text-white rounded-xl p-2.5 sm:p-3.5 flex flex-col sm:flex-row items-center gap-1.5 sm:gap-3 transition-all shadow-sm hover:shadow-md active:scale-[0.98] min-h-[52px]`}
          >
            <qa.icon size={18} className="flex-shrink-0" />
            <span className="text-[11px] sm:text-sm font-semibold text-center sm:text-left leading-tight">{qa.label}</span>
          </button>
        ))}
      </div>

      {/* ── Row 2: KPI Cards (4 cards) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi, idx) => (
          <button key={kpi.label} onClick={() => navigate(kpi.path)}
            className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 hover:shadow-md hover:border-slate-300 transition-all text-left group"
          >
            <div className="flex justify-between items-start mb-2">
              <div className={`p-2 rounded-lg ${kpi.bgIcon}`}>{kpi.icon}</div>
              {kpi.trend === 'up' ? (
                <span className="flex items-center gap-1 text-[10px] font-medium text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full">
                  <TrendingUp size={10} /> {kpi.sub}
                </span>
              ) : kpi.trend === 'down' ? (
                <span className="flex items-center gap-1 text-[10px] font-medium text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">
                  <TrendingDown size={10} /> {kpi.sub}
                </span>
              ) : (
                <span className="text-[10px] font-medium text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded-full">{kpi.sub}</span>
              )}
            </div>
            <h3 className="text-xs text-slate-500 font-medium">{kpi.label}</h3>
            <div className="flex items-end justify-between mt-1">
              <span className="text-2xl font-bold text-slate-900">{kpi.value}</span>
              <ArrowRight size={14} className="text-slate-300 group-hover:text-blue-500 group-hover:translate-x-1 transition-all" />
            </div>
            {idx === 0 && sparkDays.length > 0 && (
              <div className="h-8 mt-2 -mx-1">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={sparkDays}>
                    <Area type="monotone" dataKey="created" stroke={SPARKLINE_COLORS.created} fill={SPARKLINE_COLORS.created} fillOpacity={0.15} strokeWidth={1.5} dot={false} />
                    <Area type="monotone" dataKey="closed" stroke={SPARKLINE_COLORS.closed} fill={SPARKLINE_COLORS.closed} fillOpacity={0.1} strokeWidth={1.5} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </button>
        ))}
      </div>

      {/* ── Row 3: My Work & Activity  |  Notifications ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── My Work & Activity (merged panel) ── */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          {/* Overdue alert banner */}
          {overdue.length > 0 && (
            <button onClick={() => navigate('/work-orders?filter=overdue')}
              className="w-full px-5 py-2.5 bg-gradient-to-r from-red-50 to-amber-50 border-b border-red-100 flex items-center gap-2 hover:from-red-100 hover:to-amber-100 transition-all text-left"
            >
              <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
              <span className="text-xs font-semibold text-red-700">{overdue.length} Overdue Work Order{overdue.length !== 1 ? 's' : ''}</span>
              <span className="text-[10px] text-red-500 ml-auto">View All →</span>
            </button>
          )}

          {/* Tab header */}
          <div className="px-5 py-3 border-b border-slate-100 flex justify-between items-center">
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
              <button onClick={() => setWorkTab('active')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${workTab === 'active' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >Active ({myWork.length})</button>
              <button onClick={() => setWorkTab('recent')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${workTab === 'recent' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >Recent ({recent.length})</button>
            </div>
            <button onClick={() => navigate('/work-orders')} className="text-xs font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1 transition">
              View All <ArrowRight size={12} />
            </button>
          </div>

          {/* Tab content */}
          <div className="divide-y divide-slate-50 max-h-[320px] overflow-y-auto">
            {workTab === 'active' ? (
              myWork.length > 0 ? myWork.map((wo: any) => (
                <button key={wo.id} onClick={() => navigate(`/work-orders?id=${wo.id}`)}
                  className="w-full p-3 sm:p-3.5 flex items-start sm:items-center gap-2.5 sm:gap-3 hover:bg-blue-50/30 transition text-left min-h-[52px]"
                >
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5 sm:mt-0" style={{ backgroundColor: STATUS_COLORS[wo.status] || '#94a3b8' }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                      <span className="text-sm font-semibold text-slate-900">{wo.wo_number}</span>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{wo.status}</span>
                      {wo.priority && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${priorityColor(wo.priority)}`}>{wo.priority}</span>}
                    </div>
                    <p className="text-xs text-slate-600 truncate mt-0.5">{wo.title || 'Untitled'}</p>
                    {wo.due_date && (
                      <span className={`text-[10px] sm:hidden font-medium mt-1 inline-block ${new Date(wo.due_date) < new Date() ? 'text-red-500' : 'text-slate-400'}`}>
                        Due {new Date(wo.due_date).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  {wo.due_date && (
                    <span className={`text-xs font-medium flex-shrink-0 hidden sm:block ${new Date(wo.due_date) < new Date() ? 'text-red-500' : 'text-slate-400'}`}>
                      Due {new Date(wo.due_date).toLocaleDateString()}
                    </span>
                  )}  
                </button>
              )) : (
                <div className="p-8 text-center">
                  <CheckCircle size={24} className="text-green-400 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">No active work orders. All caught up!</p>
                </div>
              )
            ) : (
              recent.length > 0 ? recent.map((wo: any) => (
                <button key={wo.id} onClick={() => navigate(`/work-orders?id=${wo.id}`)}
                  className="w-full px-5 py-3 flex items-center gap-3 hover:bg-slate-50 transition text-left"
                >
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: STATUS_COLORS[wo.status] || '#94a3b8' }} />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-slate-900">{wo.wo_number}</span>
                    <span className="text-[10px] ml-1.5 px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">{wo.status}</span>
                    <p className="text-xs text-slate-500 truncate mt-0.5">{wo.title || 'No title'}</p>
                  </div>
                  <span className="text-[10px] text-slate-400 whitespace-nowrap flex-shrink-0">{timeAgo(wo.updated_at)}</span>
                </button>
              )) : (
                <div className="p-8 text-center">
                  <Activity size={24} className="text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-400">No recent activity yet</p>
                </div>
              )
            )}
          </div>
        </div>

        {/* ── Notifications ── */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-blue-50 to-white">
            <div className="flex items-center gap-2">
              <BellRing size={16} className="text-blue-600" />
              <h3 className="font-semibold text-slate-900 text-sm">Notifications</h3>
              {notifications.length > 0 && (
                <span className="text-xs font-bold bg-blue-600 text-white px-2 py-0.5 rounded-full">{notifications.length}</span>
              )}
            </div>
            <button onClick={() => navigate('/notifications')} className="text-xs font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1 transition">
              View All <ArrowRight size={12} />
            </button>
          </div>
          <div className="divide-y divide-slate-100 max-h-[360px] overflow-y-auto">
            {notifications.length > 0 ? notifications.map((n: any) => (
              <button key={n.id} onClick={() => navigate('/notifications')}
                className={`w-full p-3 flex items-start gap-3 hover:bg-slate-50 transition text-left border-l-4 ${severityBg(n.severity)}`}
              >
                <div className="mt-0.5 flex-shrink-0">{severityIcon(n.severity)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900 truncate">{n.title}</span>
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 flex-shrink-0">{n.module || n.notification_type}</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{n.message}</p>
                </div>
                <span className="text-[10px] text-slate-400 whitespace-nowrap flex-shrink-0 mt-1">{timeAgo(n.created_at)}</span>
              </button>
            )) : (
              <div className="p-8 text-center">
                <Bell size={24} className="text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-400">No new notifications</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Row 4: Analytical Cards (2×2 grid) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">

        {/* PM Schedule Compliance */}
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
          <div className="flex items-center gap-2 mb-3">
            <Gauge size={16} className="text-emerald-600" />
            <h4 className="text-sm font-semibold text-slate-900">PM Compliance</h4>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 relative">
              {pmComplianceData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pmComplianceData} dataKey="value" innerRadius={22} outerRadius={36} paddingAngle={2} startAngle={90} endAngle={-270}>
                      {pmComplianceData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-300 text-xs">N/A</div>
              )}
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-lg font-bold text-slate-900">{pmComplianceRate}%</span>
              </div>
            </div>
            <div className="flex-1 text-xs text-slate-500 space-y-1">
              <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500" /> On-Time: {pmOnTime}</div>
              <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500" /> Late: {pmClosed - pmOnTime}</div>
              <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-slate-200" /> Open: {totalPM - pmClosed}</div>
            </div>
          </div>
          <button onClick={() => navigate('/reports')} className="mt-3 text-[10px] font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1 transition">
            View in Reports <ArrowRight size={10} />
          </button>
        </div>

        {/* Backlog Aging */}
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
          <div className="flex items-center gap-2 mb-3">
            <Clock size={16} className="text-amber-600" />
            <h4 className="text-sm font-semibold text-slate-900">Backlog Aging</h4>
          </div>
          <div className="h-24">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={agingBuckets} barSize={28}>
                <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                <ReTooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                <Bar dataKey="count" name="WOs" radius={[4, 4, 0, 0]}>
                  {agingBuckets.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="text-xs text-slate-500 mt-1">{openWOsList.length} open WOs in backlog</div>
          <button onClick={() => navigate('/reports/drilldown/backlog')} className="mt-2 text-[10px] font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1 transition">
            View in Reports <ArrowRight size={10} />
          </button>
        </div>

        {/* Top 5 Bad Actors — Pareto (ISO 55000 Monthly Analysis) */}
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
          <div className="flex items-center gap-2 mb-3">
            <Skull size={16} className="text-red-600" />
            <h4 className="text-sm font-semibold text-slate-900">Top Bad Actors</h4>
            <span className="ml-auto text-[9px] font-medium text-slate-400 uppercase tracking-wide">Pareto</span>
          </div>
          <div className="space-y-2.5">
            {badActors.length > 0 ? (() => {
              const maxMTBF = Math.max(...badActors.map((a: any) => a.mtbf_days || 1));
              return badActors.map((a: any, i: number) => (
                <div key={a.tag} className="group">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                      i === 0 ? 'bg-red-100 text-red-700' : i === 1 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                    }`}>{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-xs font-semibold text-slate-800 truncate">{a.tag}</span>
                        {a.criticality && (
                          <span className={`text-[8px] font-bold px-1 py-0.5 rounded ${
                            a.criticality === 'A' ? 'bg-red-100 text-red-700' :
                            a.criticality === 'B' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
                          }`}>{a.criticality}</span>
                        )}
                      </div>
                      {/* Pareto bar */}
                      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            i === 0 ? 'bg-red-500' : i === 1 ? 'bg-amber-500' : 'bg-slate-400'
                          }`}
                          style={{ width: `${Math.max(10, 100 - ((a.mtbf_days / maxMTBF) * 80))}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="text-[10px] font-medium text-slate-500">{a.mtbf_days}d</span>
                      {/* Auto-draft DE Task */}
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            const { error } = await supabase.from('ers_defect_elimination_tasks').insert({
                              asset_id: a.id || null,
                              title: `DE: ${a.tag} — Bad Actor Elimination`,
                              description: `Auto-drafted by monthly Pareto analysis.\nAsset: ${a.tag} (${a.name || 'N/A'})\nCriticality: ${a.criticality || 'Unknown'}\nMTBF: ${a.mtbf_days} days\nMTTR: ${a.mttr_hours || 'N/A'} hours\n\nThis asset was identified as a Top 5 Bad Actor. Root cause investigation and defect elimination recommended per ISO 55000.`,
                              status: 'identified',
                              priority: a.criticality === 'A' ? 'critical' : 'high',
                              annual_cost: 0,
                              estimated_savings: 0,
                              implementation_cost: 0,
                              created_by: user?.id || 'system',
                            });
                            if (error) throw error;
                            alert(`✅ DE Task created for ${a.tag}. Navigate to Analyze → Defect Elimination to review.`);
                          } catch (err: any) {
                            alert(`Failed to create DE task: ${err.message}`);
                          }
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-indigo-50 text-indigo-500 hover:text-indigo-700"
                        title="Auto-draft Defect Elimination task"
                      >
                        <Target size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ));
            })() : (
              <div className="text-xs text-slate-400 italic">No MTBF data available</div>
            )}
          </div>
          <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-100">
            <button onClick={() => navigate('/reports')} className="text-[10px] font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1 transition">
              View in Reports <ArrowRight size={10} />
            </button>
            <button
              onClick={async () => {
                if (!confirm('Auto-draft DE tasks for all Top 5 Bad Actors?')) return;
                let created = 0;
                for (const a of badActors as any[]) {
                  try {
                    const { error } = await supabase.from('ers_defect_elimination_tasks').insert({
                      asset_id: a.id || null,
                      title: `DE: ${a.tag} — Bad Actor Elimination`,
                      description: `Auto-drafted by monthly Pareto analysis.\nAsset: ${a.tag}\nCriticality: ${a.criticality || '?'}\nMTBF: ${a.mtbf_days}d`,
                      status: 'identified',
                      priority: a.criticality === 'A' ? 'critical' : 'high',
                      annual_cost: 0,
                      estimated_savings: 0,
                      implementation_cost: 0,
                      created_by: user?.id || 'system',
                    });
                    if (!error) created++;
                  } catch { /* skip */ }
                }
                alert(`✅ ${created} DE task(s) created. Navigate to Analyze → Defect Elimination.`);
              }}
              className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 transition bg-indigo-50 px-2 py-1 rounded-md hover:bg-indigo-100"
            >
              <Target size={10} /> Draft All DE Tasks
            </button>
          </div>
        </div>

        {/* Defect Elimination Summary */}
        <button onClick={() => navigate('/analyze?division=defect_elimination')} className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 hover:shadow-md hover:border-indigo-200 transition-all text-left group">
          <div className="flex items-center gap-2 mb-3">
            <Target size={16} className="text-indigo-600" />
            <h4 className="text-sm font-semibold text-slate-900">Defect Elimination</h4>
            {criticalDETasks > 0 && (
              <span className="text-[9px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">{criticalDETasks} CRIT</span>
            )}
          </div>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Active Tasks</span>
              <span className="text-lg font-bold text-slate-900">{activeDETasks.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Resolved</span>
              <span className="text-sm font-semibold text-emerald-600">{resolvedDETasks.length}</span>
            </div>
            <div className="bg-emerald-50 rounded-lg p-2.5 mt-1">
              <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-wide">Realized Savings</div>
              <div className="text-lg font-bold text-slate-900 mt-0.5">${totalDESavings.toLocaleString()}</div>
            </div>
          </div>
          <div className="mt-3 text-[10px] font-medium text-indigo-600 group-hover:text-indigo-800 flex items-center gap-1 transition">
            Open DE Program <ArrowRight size={10} />
          </div>
        </button>

        {/* Fleet Reliability (MTBF/MTTR) */}
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
          <div className="flex items-center gap-2 mb-3">
            <Timer size={16} className="text-indigo-600" />
            <h4 className="text-sm font-semibold text-slate-900">Fleet Reliability</h4>
          </div>
          <div className="space-y-3">
            <div className="bg-indigo-50 rounded-lg p-3">
              <div className="text-[10px] font-bold text-indigo-600 uppercase tracking-wide">Avg MTBF</div>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="text-2xl font-bold text-slate-900">{avgMTBF}</span>
                <span className="text-xs text-slate-500">days</span>
              </div>
              <div className={`text-[10px] font-medium mt-0.5 ${avgMTBF >= 90 ? 'text-green-600' : avgMTBF >= 30 ? 'text-amber-600' : 'text-red-600'}`}>
                {avgMTBF >= 90 ? 'Good reliability' : avgMTBF >= 30 ? 'Moderate — review strategy' : 'Poor — escalate'}
              </div>
            </div>
            <div className="bg-emerald-50 rounded-lg p-3">
              <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-wide">Avg MTTR</div>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="text-2xl font-bold text-slate-900">{avgMTTR}</span>
                <span className="text-xs text-slate-500">hours</span>
              </div>
              <div className={`text-[10px] font-medium mt-0.5 ${avgMTTR <= 4 ? 'text-green-600' : avgMTTR <= 8 ? 'text-amber-600' : 'text-red-600'}`}>
                {avgMTTR <= 4 ? 'Fast repairs' : avgMTTR <= 8 ? 'Acceptable' : 'Slow — investigate'}
              </div>
            </div>
          </div>
          <button onClick={() => navigate('/reports/drilldown/mtbf-mttr')} className="mt-3 text-[10px] font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1 transition">
            View MTBF/MTTR Analysis <ArrowRight size={10} />
          </button>
        </div>
      </div>
    </div>
  );
};
