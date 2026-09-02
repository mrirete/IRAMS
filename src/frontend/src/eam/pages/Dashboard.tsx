import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { GettingStarted } from '../components/GettingStarted';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useQuery } from '@tanstack/react-query';
import { isOpenWo } from '../../lib/woState';
import { computePmCompliance } from '../../lib/reliabilityKpis';
import { isFailure } from '../services/reliabilityMetrics';
import { useUnreadNotifications } from '../../hooks/useUnreadNotifications';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as ReTooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Area, AreaChart
} from 'recharts';
import {
  AlertCircle, CheckCircle, Clock, Activity,
  Wrench, Package, Plus, ArrowRight,
  AlertTriangle, BarChart3, Inbox, Bell, BellRing,
  Gauge, Timer, Skull, Target, ChevronRight, Home
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { DatabaseService } from '../services/DatabaseService';
import { classifyWork } from '../services/workReadiness';
import ersApi, { BadActorEntry } from '../services/ERSApiClient';
import { Modal } from '../components/ui';
import {
  ReliabilityView, SupervisorView, AssetsView, FinanceView,
  type DashboardView, type DashboardShared, type InsightKey,
} from '../components/dashboard/roleViews';

// ──────────────────────────────── Fetcher ────────────────────────────────
// Exported so Login can prefetch dashboard data before navigating
export const DASHBOARD_QUERY_KEY = 'dashboardStats';
export const fetchDashboardData = async (userId?: string, siteIds?: string[] | null) => {
  const now = new Date();
  const nowISO = now.toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
  // Governance fetches TWO windows (current + prior 90d) so the tile can show
  // motion, not just level.
  const oneEightyDaysAgo = new Date(now.getTime() - 180 * 86400000).toISOString();

  // ── Optimized: 7 parallel queries instead of 12 ──
  // Single WO query provides: status counts, overdue, recent, trend
  const [
    woResult, srResult, assetResult, inventoryResult,
    myWorkResult, notificationsResult, assetMtbfResult,
    deTasksResult, governanceResult,
  ] = await Promise.all([
    // 1. ALL work orders (single query replaces 5 separate ones)
    supabase.from('work_orders')
      .select('id, wo_number, title, status, type, priority_code, created_at, closed_at, due_date, updated_at, asset_id, actual_downtime_hrs, breakdown, assigned_to, wo_failure_data!wo_id(failure_mode_code, reviewed_at)')
      .order('updated_at', { ascending: false }),
    // 2. Service requests — counts only
    supabase.from('service_requests').select('status'),
    // 3. Assets — core fields. (mtbf_days/mttr_hours deliberately NOT selected:
    //    those are the frozen 0108 backfill; sem_asset_reliability is canonical.)
    supabase.from('assets').select('id, tag, name, criticality, status_code'),
    // 4. Inventory — minimal fields for stock alerts
    supabase.from('inventory_items').select('id, stock_on_hand, min_level, is_critical'),
    // 5. My work (user-specific, limited)
    userId
      ? supabase.from('work_orders')
          .select('id, wo_number, title, status, type, due_date, priority_code, asset_id')
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
    // (The separate PM-compliance query is gone: query 1 already carries
    //  status/type/due_date/closed_at for every WO, and computePmCompliance
    //  filters by the ONE exported PM_WORK_TYPES list — a DB-side type filter
    //  here was a second, subtly different definition.)
    // 7. Per-asset reliability for bad actors — the CANONICAL computed view
    //    (0234), not assets.mtbf_days, which migration 0108 froze in place
    //    and nothing has recomputed since.
    // Lifetime fallback (0298): mtbf_days is 12-month-windowed; assets whose
    // (often imported) failures are older than a year would drop off the bad-
    // actor list entirely. Rows with only lifetime history fall back to
    // mtbf_hours_lifetime/24, marked window:'lifetime' for honest display.
    supabase.from('sem_asset_reliability')
      .select('asset_id, asset_tag, criticality, mtbf_days, mttr_hours, failures_12mo, failures_total, mtbf_hours_lifetime, mttr_hours_lifetime')
      .or('mtbf_days.not.is.null,mtbf_hours_lifetime.not.is.null')
      .limit(40),
    // 9. Defect elimination tasks
    supabase.from('ers_defect_elimination_tasks')
      .select('id, status, priority, annual_cost, estimated_savings, implementation_cost, created_at')
      .order('created_at', { ascending: false }),
    // 10. Governance — Planned vs Reactive, current 90d + the 90d before
    //     (trend). Needs the task/labour signals (joined) so the ratio
    //     matches the Work Orders list.
    supabase.from('work_orders')
      .select('id, type, status, est_duration, asset_id, created_at, job_tasks(description, instructions), work_order_labor(id)')
      .gte('created_at', oneEightyDaysAgo),
  ]);

  // ── Error diagnostics: log any silent Supabase failures ──
  const results = [
    { name: 'work_orders', ...woResult },
    { name: 'service_requests', ...srResult },
    { name: 'assets', ...assetResult },
    { name: 'inventory', ...inventoryResult },
    { name: 'my_work', ...(myWorkResult as any) },
    { name: 'notifications', ...(notificationsResult as any) },
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
  const rawWos = allWOs;

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
    return wos.filter((wo: any) => !wo.asset_id || scopedAssetTags!.has(wo.asset_id));
  };

  // ── Work Governance: Planned vs Reactive, current vs prior 90 days ──
  // Map each record to the shape classifyWork expects, so the ratio is identical
  // to the Work Orders list (preventive OR steps+estimate+labour = proactive).
  const govRaw = filterWOs(governanceResult.data || []);
  const govWindowStart = now.getTime() - 90 * 86400000;
  const govTally = (rows: any[]) => {
    let pro = 0, rea = 0;
    for (const r of rows) {
      const woLike = {
        type: r.type, status: r.status, estDuration: r.est_duration,
        tasks: (r.job_tasks || []).map((t: any) => ({ description: t.description, instructions: t.instructions || [], estHours: 0 })),
        labor: r.work_order_labor || [],
      };
      const c = classifyWork(woLike as any);
      if (c === 'PROACTIVE') pro++;
      else if (c === 'REACTIVE') rea++;
    }
    return { pro, rea };
  };
  const govCur = govTally((govRaw as any[]).filter(r => new Date(r.created_at).getTime() >= govWindowStart));
  const govPrev = govTally((govRaw as any[]).filter(r => new Date(r.created_at).getTime() < govWindowStart));
  const govPct = (p: number, r: number) => (p + r ? Math.round((p / (p + r)) * 100) : null);
  const govTotal = govCur.pro + govCur.rea;
  const govProPct = govPct(govCur.pro, govCur.rea) ?? 0;
  const governance = {
    proactive: govCur.pro, reactive: govCur.rea, total: govTotal,
    proPct: govProPct, reaPct: govTotal ? 100 - govProPct : 0,
    prevProPct: govPct(govPrev.pro, govPrev.rea),
  };

  return {
    wos: filterWOs(rawWos), srs: srResult.data || [],
    assets: rawAssets, inventory: inventoryResult.data || [],
    overdue: filterWOs(overdue), recent: filterWOs(recent),
    myWork: filterWOs(myWorkResult.data || []), notifications: notificationsResult.data || [],
    woTrend: filterWOs(woTrend),
    assetMtbf: ((rows: any[]) => rows
      // Lifetime fallback (0298): windowed values win; quiet-year assets fall
      // back to lifetime, flagged so the list can say which basis it's on.
      .map((r: any) => ({
        ...r,
        mtbf_days: r.mtbf_days ?? (r.mtbf_hours_lifetime != null ? Math.round(Number(r.mtbf_hours_lifetime) / 24) : null),
        mttr_hours: r.mttr_hours ?? r.mttr_hours_lifetime ?? null,
        window: r.mtbf_days == null && r.mtbf_hours_lifetime != null ? 'lifetime' : '12 mo',
      }))
      .sort((a: any, b: any) => (a.mtbf_days ?? Infinity) - (b.mtbf_days ?? Infinity))
      .slice(0, 20)
    )(scopedAssetIds
      ? (assetMtbfResult.data || []).filter((a: any) => scopedAssetIds!.has(a.id) || scopedAssetTags?.has(a.tag))
      : (assetMtbfResult.data || [])),
    deTasks: deTasksResult.data || [],
    governance,
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
  OPEN: '#1E4FDB', PLAN: '#8b5cf6', SCHEDULED: '#6366f1', WIP: '#f59e0b',
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

const SPARKLINE_COLORS = { created: '#1E4FDB', closed: '#22c55e' };

// "Different hats": every view is available to every user (pills hide only when
// the permission matrix denies the underlying data); the role just picks the
// starting hat. The chosen hat is remembered per browser.
const VIEW_STORE_KEY = 'ers_dashboard_view_v1';
const VIEW_PILLS: { id: DashboardView; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'reliability', label: 'Reliability' },
  { id: 'supervisor', label: 'Supervisor' },
  { id: 'assets', label: 'Assets' },
  { id: 'finance', label: 'Finance' },
];
const defaultViewForRole = (role: string | null | undefined): DashboardView => {
  const r = (role || '').toUpperCase();
  if (r === 'RELIABILITY_ENG') return 'reliability';
  if (r === 'SUPERVISOR') return 'supervisor';
  if (r === 'ASSET_MANAGER' || r === 'MANAGER') return 'assets';
  if (r === 'EXECUTIVE') return 'finance';
  return 'overview';
};

// ──────────────────────────────── Dashboard ────────────────────────────────
export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user, profile, dataScope, role, permissions } = useAuth();
  const { showToast } = useToast();
  const userName = (profile as any)?.fullName || (profile as any)?.username || 'Operator';
  const userRole = role || '';
  const [workTab, setWorkTab] = useState<'active' | 'recent' | 'notifications'>('active');
  const [apiBadActors, setApiBadActors] = useState<BadActorEntry[] | null>(null);
  const [insight, setInsight] = useState<InsightKey | null>(null);

  // View ("hat") selection: stored choice wins; otherwise the role's default.
  const [view, setView] = useState<DashboardView>(() => {
    try {
      const stored = localStorage.getItem(VIEW_STORE_KEY) as DashboardView | null;
      if (stored && VIEW_PILLS.some(v => v.id === stored)) return stored;
    } catch { /* ignore */ }
    return defaultViewForRole(role);
  });
  // Role can resolve after mount — adopt its default until the user has chosen.
  useEffect(() => {
    try { if (!localStorage.getItem(VIEW_STORE_KEY)) setView(defaultViewForRole(role)); } catch { /* ignore */ }
  }, [role]);
  const pickView = (v: DashboardView) => {
    setView(v);
    try { localStorage.setItem(VIEW_STORE_KEY, v); } catch { /* ignore */ }
  };
  // Permission gates: a hat is offered only when its data is actually visible.
  const canWear: Record<DashboardView, boolean> = {
    overview: true,
    reliability: permissions?.reliability?.view === true || permissions?.analytics?.view === true,
    supervisor: permissions?.workOrders?.view === true,
    assets: permissions?.assets?.view === true,
    finance: permissions?.analytics?.viewCosts === true || permissions?.finops?.view === true || permissions?.dashboard?.viewCosts === true,
  };
  const activeView: DashboardView = canWear[view] ? view : 'overview';

  // TRUE unread count (the feed list is capped at 8 rows; badging its length
  // would report min(unread, 8) — a number wearing the wrong definition).
  const { unreadCount } = useUnreadNotifications(user?.id);

  const { data, isLoading, error, dataUpdatedAt } = useQuery({
    queryKey: [DASHBOARD_QUERY_KEY, profile?.id, dataScope?.siteIds],
    queryFn: () => fetchDashboardData(profile?.id, dataScope?.siteIds),
    enabled: !!profile?.id, // Don't fire until auth is ready (prevents anon key hitting RLS)
    staleTime: 1000 * 60 * 2, // 2 min — show cached data instantly on revisit
    gcTime: 1000 * 60 * 10,   // 10 min — keep cache alive across navigation
    refetchInterval: 1000 * 60 * 2,
    placeholderData: (prev) => prev, // Show previous data while refetching (no skeleton flash)
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
      <div className="flex flex-col gap-3 md:gap-4 animate-pulse">
        {/* Header + quick actions skeleton */}
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <div className="h-6 bg-slate-200 rounded-lg w-56 mb-2"></div>
            <div className="h-3 bg-slate-100 rounded w-36"></div>
          </div>
          <div className="flex gap-2">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-9 bg-slate-200 rounded-lg w-20"></div>)}
          </div>
        </div>
        {/* KPI band skeleton */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 md:gap-3">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="bg-white px-3 py-2.5 rounded-card shadow-card border border-slate-200">
              <div className="h-3 bg-slate-100 rounded w-20 mb-2.5"></div>
              <div className="h-6 bg-slate-200 rounded w-12"></div>
            </div>
          ))}
        </div>
        {/* Panels skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 md:gap-4">
          {[1, 2, 3].map(i => <div key={i} className="bg-white rounded-card shadow-card border border-slate-200 h-80 lg:h-[28rem]"></div>)}
        </div>
      </div>
    );
  }
  if (error) {
    return <div className="p-8 text-red-500">Error loading dashboard: {(error as Error).message}</div>;
  }

  const { wos, srs, assets, inventory, overdue, recent, myWork, notifications, woTrend, assetMtbf, deTasks, governance } = data!;

  // ── Derived Metrics ──
  const statusMap: Record<string, number> = {};
  wos.forEach((wo: any) => { statusMap[wo.status] = (statusMap[wo.status] || 0) + 1; });

  const totalWOs = wos.length;
  // Canonical backlog (lib/woState) — the same rule the reports, the
  // reliability digest and the mission engine use, so the number a manager
  // reads here matches the one the Specialist quotes.
  const openWOs = wos.filter((wo: any) => isOpenWo(wo.status)).length;
  const pendingSRs = srs.filter((sr: any) => sr.status !== 'CONVERTED' && sr.status !== 'REJECTED').length;
  const totalAssets = assets.length;
  const criticalAssets = assets.filter((a: any) => a.criticality === 'A').length;
  const lowStockItems = inventory.filter((i: any) =>
    i.stock_on_hand !== null && i.min_level !== null && i.stock_on_hand <= i.min_level
  ).length;
  const lastUpdate = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : '...';

  // ── PM Schedule Compliance ──
  // CANONICAL definition (lib/reliabilityKpis.computePmCompliance): PMs DUE in
  // the window, on-time = closed on/before due date. The old computation used
  // all PM WOs ever as the denominator — a third, all-time definition that
  // disagreed with both Reports and Scheduling.
  const pmWindowMs = 90 * 86400000;
  // Filters by the exported PM_WORK_TYPES itself — the WO query already has
  // every field it needs, so no separate DB-side type filter can drift.
  const pmc = computePmCompliance(wos as any[], Date.now() - pmWindowMs, Date.now());
  // Prior equal window, for the delta chip (motion, not just level).
  const pmcPrev = computePmCompliance(wos as any[], Date.now() - 2 * pmWindowMs, Date.now() - pmWindowMs);
  const pmDelta = pmc.compliancePct != null && pmcPrev.compliancePct != null
    ? Math.round(pmc.compliancePct - pmcPrev.compliancePct) : null;
  const govDelta = governance.prevProPct != null && governance.total > 0
    ? governance.proPct - governance.prevProPct : null;

  // ── Hat-pill signals — the pills carry information scent, not just navigation ──
  // FRACAS backlog (canonical isFailure + unreviewed) and unassigned open work.
  const fracasCount = wos.filter((w: any) => {
    if (!isFailure(w)) return false;
    const fd = Array.isArray(w.wo_failure_data) ? w.wo_failure_data[0] : w.wo_failure_data;
    return !fd?.reviewed_at;
  }).length;
  const unassignedCount = wos.filter((w: any) => isOpenWo(w.status) && !w.assigned_to).length;
  const pillBadges: Partial<Record<DashboardView, number>> = {
    reliability: fracasCount,
    supervisor: unassignedCount,
  };
  const pmOnTime = pmc.onTime;
  const pmMissed = pmc.due - pmc.onTime;
  const pmComplianceRate = pmc.compliancePct != null ? Math.round(pmc.compliancePct) : 0;
  const pmComplianceData = [
    { name: 'On-Time', value: pmOnTime, color: '#22c55e' },
    { name: 'Late / Missed', value: pmMissed, color: '#f59e0b' },
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
  // Canonical per-asset reliability, keyed for the bad-actor list below.
  const relByAsset = new Map<string, any>((assetMtbf as any[]).map((r: any) => [r.asset_id, r]));
  const mtbfBadActors = (assetMtbf as any[])
    .filter((a: any) => a.mtbf_days !== null && a.mtbf_days > 0)
    .sort((a: any, b: any) => a.mtbf_days - b.mtbf_days)
    .slice(0, 5)
    .map((a: any) => ({
      tag: a.asset_tag, name: a.asset_tag, id: a.asset_id,
      mtbf_days: a.mtbf_days, mttr_hours: a.mttr_hours, criticality: a.criticality,
      window: a.window,
    }));
  const badActors = apiBadActors && apiBadActors.length > 0
    ? apiBadActors.map(a => {
        // MTBF/MTTR come from the canonical view. The previous code derived
        // them here as total_downtime/wo_count and total_downtime — average
        // downtime per job labelled MTBF, and TOTAL downtime labelled MTTR.
        const rel = relByAsset.get(a.asset_id);
        return {
          tag: a.asset_tag,
          name: a.asset_name,
          id: a.asset_id,
          mtbf_days: rel?.mtbf_days ?? null,
          mttr_hours: rel?.mttr_hours ?? null,
          criticality: rel?.criticality ?? null,
          wo_count: a.wo_count,
          total_cost: a.total_cost,
        };
      })
    : mtbfBadActors;

  // ── Defect Elimination Metrics ──
  const activeDETasks = deTasks.filter((t: any) => t.status === 'identified' || t.status === 'in_progress');
  const resolvedDETasks = deTasks.filter((t: any) => t.status === 'resolved' || t.status === 'verified');
  const totalDESavings = resolvedDETasks.reduce((sum: number, t: any) => sum + (Number(t.estimated_savings) || 0), 0);
  const criticalDETasks = deTasks.filter((t: any) => t.priority === 'critical' && (t.status === 'identified' || t.status === 'in_progress')).length;

  // ── Fleet Reliability ──
  // Averaged over the computed view (0234), not assets.mtbf_days/mttr_hours —
  // those are the frozen 0108 backfill, and this average was also being pasted
  // into the AI context summary below, so the agent quoted it back as fact.
  const mtbfValues = (assetMtbf as any[]).filter((a: any) => a.mtbf_days && a.mtbf_days > 0).map((a: any) => Number(a.mtbf_days));
  const mttrValues = (assetMtbf as any[]).filter((a: any) => a.mttr_hours && a.mttr_hours > 0).map((a: any) => Number(a.mttr_hours));
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
  // Net backlog motion this week — exact from the same 7-day trend the
  // sparkline draws (created minus closed), no point-in-time reconstruction.
  const woNet7 = sparkDays.reduce((s, d) => s + d.created - d.closed, 0);

  // ── Quick Actions ──
  // Desktop-only: on phones these all live in the bottom tab bar (+ FAB,
  // Assets, Reports), so repeating them at the top would spend the most
  // valuable screen row on duplicates — LinkedIn keeps its mobile top for
  // identity and puts actions in the bar; we follow.
  const quickActions = [
    { label: 'Create Work Order', icon: Wrench, color: 'bg-primary-600 hover:bg-primary-500', path: '/work-orders?action=create' },
    { label: 'Log Request', icon: Inbox, color: 'bg-emerald-600 hover:bg-emerald-700', path: '/requests?action=create' },
    { label: 'Add Asset', icon: Plus, color: 'bg-primary-600 hover:bg-primary-500', path: '/assets?action=create' },
    { label: 'View Reports', icon: BarChart3, color: 'bg-slate-700 hover:bg-slate-800', path: '/reports' },
  ];

  // ── KPI Cards (4 — removed WO Completion duplicate) ──
  const kpis = [
    {
      label: 'Open Work Orders', value: openWOs, sub: `${totalWOs} total`,
      icon: <Wrench size={16} />, bgIcon: 'bg-blue-50 text-blue-600',
      trend: openWOs > 5 ? 'up' as const : 'neutral' as const, path: '/work-orders',
    },
    {
      label: 'Pending Requests', value: pendingSRs, sub: `${srs.length} total`,
      icon: <Clock size={16} />, bgIcon: 'bg-amber-50 text-amber-600',
      trend: pendingSRs > 3 ? 'up' as const : 'neutral' as const, path: '/requests',
    },
    {
      label: 'Assets Managed', value: totalAssets, sub: `${criticalAssets} Critical-A`,
      icon: <Activity size={16} />, bgIcon: 'bg-emerald-50 text-emerald-600',
      trend: 'neutral' as const, path: '/assets',
    },
    // Inventory is gated on inventory.view (0257). Without it the query returns
    // zero rows, and this tile would read "0 Low Stock Alerts" — a confident
    // wrong number, which is worse than not showing it. Drop the tile instead.
    ...(permissions?.inventory?.view === true ? [{
      label: 'Low Stock Alerts', value: lowStockItems, sub: `of ${inventory.length} items`,
      icon: <Package size={16} />, bgIcon: 'bg-rose-50 text-rose-600',
      trend: lowStockItems > 0 ? 'down' as const : 'neutral' as const, path: '/inventory',
    }] : []),
  ];

  // Everything the persona views need that the dashboard already computed.
  const shared: DashboardShared = {
    wos, openWOs, overdueCount: overdue.length,
    governance,
    pmDue: pmc.due, pmOnTime, pmRatePct: pmComplianceRate,
    badActors, avgMTBF, avgMTTR, mtbfCount: mtbfValues.length,
    agingBuckets, openBacklogCount: openWOsList.length,
    deActive: activeDETasks.length, deResolved: resolvedDETasks.length,
    deSavings: totalDESavings, deCritical: criticalDETasks,
    notificationsCount: unreadCount,
    assetsCount: totalAssets, criticalAssets,
  };

  return (
    // Calm-screens: on desktop the page locks to the viewport — everything is
    // visible at once and drill-down happens in popups. Below lg it stacks and
    // scrolls naturally (phones can't show a wall-to-wall grid anyway).
    <div className="ers-page-wide w-full flex flex-col gap-3 md:gap-4 pb-20 md:pb-0 lg:h-[calc(100vh-7rem)] lg:overflow-hidden">

      {/* ── Row 1: Header. Phones: identity + the signature CTA only — the
             actions live in the bottom tab bar. Desktop (no bottom bar):
             the quick-action buttons ride inline. ── */}
      <div className="flex flex-wrap items-center gap-2 md:gap-3 flex-none">
        <div className="min-w-0 mr-auto order-1">
          <h1 className="text-lg md:text-xl font-bold text-slate-900 leading-tight">{getGreeting()}, {userName}</h1>
          <p className="text-slate-500 text-[11px] sm:text-xs">
            {userRole && <span className="capitalize">{userRole} • </span>}
            Live data • Updated {lastUpdate}
          </p>
        </div>
        <div className="hidden md:flex md:items-center gap-1.5 sm:gap-2 order-3 md:order-2">
          {quickActions.map(qa => (
            <button key={qa.label} onClick={() => navigate(qa.path)} title={qa.label}
              className={`${qa.color} text-white rounded-lg px-3 h-9 inline-flex items-center gap-1.5 text-xs font-semibold shadow-sm transition-all active:scale-[0.98]`}
            >
              <qa.icon size={15} className="flex-shrink-0" />
              <span className="whitespace-nowrap">{qa.label}</span>
            </button>
          ))}
        </div>
        {/* Mobile: Reports beside the greeting (Inventory holds the bottom-bar
            slot). No Ask Specialist here — the TopBar's Specialist button is
            the one CTA (was duplicated); no Refresh — data auto-refetches
            every 2 min and on focus, and the "Updated" stamp shows freshness. */}
        <button onClick={() => navigate('/reports')}
          className="md:hidden order-2 bg-slate-700 hover:bg-slate-800 text-white rounded-lg px-3 h-9 inline-flex items-center gap-1.5 text-xs font-semibold shadow-sm transition-all active:scale-[0.98]"
        >
          <BarChart3 size={15} className="flex-shrink-0" /> Reports
        </button>
      </div>

      {/* ── Getting-started: one-line strip; the checklist opens in a popup ── */}
      <GettingStarted compact />

      {/* ── View pills — wear a different hat; every lens open to every user
             (hidden only where permissions deny the data). LinkedIn-style.
             Compact on phones so all five sit on ONE line at 393px (wrap stays
             as the graceful fallback — never a horizontal scroll). ── */}
      <div className="flex flex-wrap items-center gap-1 sm:gap-1.5 flex-none">
        {VIEW_PILLS.filter(v => canWear[v.id]).map(v => {
          const badge = pillBadges[v.id] ?? 0;
          return (
            <button key={v.id} onClick={() => pickView(v.id)} aria-label={v.label}
              className={`px-2 sm:px-3.5 py-2 md:py-1.5 rounded-full text-[11px] sm:text-xs font-semibold whitespace-nowrap border transition-colors inline-flex items-center gap-1 ${
                activeView === v.id
                  ? 'bg-primary-600 text-white border-primary-600'
                  : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400 hover:text-slate-800'
              }`}
            >
              {/* Overview is the "home hat" — on phones a house glyph carries it
                  so the four specialist hats + badges fit one line. */}
              {v.id === 'overview' ? (<>
                <Home size={13} className="sm:hidden" />
                <span className="hidden sm:inline">{v.label}</span>
              </>) : v.label}
              {badge > 0 && (
                <span className={`text-[9px] font-bold px-1 py-0.5 rounded-full leading-none ${
                  activeView === v.id ? 'bg-white/25 text-white' : 'bg-blue-100 text-blue-700'
                }`}>{badge > 99 ? '99+' : badge}</span>
              )}
            </button>
          );
        })}
      </div>

      {activeView === 'reliability' && <ReliabilityView shared={shared} openInsight={setInsight} />}
      {activeView === 'supervisor' && <SupervisorView shared={shared} openInsight={setInsight} />}
      {activeView === 'assets' && <AssetsView shared={shared} openInsight={setInsight} />}
      {activeView === 'finance' && <FinanceView shared={shared} openInsight={setInsight} />}

      {activeView === 'overview' && (<>
      {/* ── Row 2: KPI band — every headline number in one row on desktop.
             Governance and PM compliance live here as compact tiles; their full
             charts open in popups. ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 md:gap-3 lg:flex flex-none">
        {kpis.map((kpi, idx) => (
          <button key={kpi.label} onClick={() => navigate(kpi.path)}
            className="bg-white px-3 py-2.5 rounded-card shadow-card border border-slate-200 hover:shadow-raised hover:border-slate-300 transition-all text-left group lg:flex-1 min-w-0"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <span className={`p-1 rounded-md ${kpi.bgIcon} flex-shrink-0`}>{kpi.icon}</span>
              <span className="text-[11px] font-medium text-slate-500 truncate">{kpi.label}</span>
              <ArrowRight size={12} className="ml-auto text-slate-300 group-hover:text-primary-600 group-hover:translate-x-0.5 transition-all flex-shrink-0 hidden sm:block" />
            </div>
            <div className="flex items-end justify-between gap-2 mt-2">
              <span className="inline-flex items-end gap-1.5">
                <span className="text-xl font-bold text-slate-900 leading-none">{kpi.value}</span>
                {idx === 0 && woNet7 !== 0 && (
                  <span className={`text-[10px] font-semibold leading-none ${woNet7 > 0 ? 'text-red-500' : 'text-emerald-600'}`}
                    title="Net backlog change over the last 7 days (created minus closed)">
                    {woNet7 > 0 ? '▲' : '▼'}{Math.abs(woNet7)} wk
                  </span>
                )}
              </span>
              {idx === 0 && sparkDays.length > 0 ? (
                <div className="h-7 w-20 -my-1">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={sparkDays}>
                      <Area type="monotone" dataKey="created" stroke={SPARKLINE_COLORS.created} fill={SPARKLINE_COLORS.created} fillOpacity={0.15} strokeWidth={1.5} dot={false} />
                      <Area type="monotone" dataKey="closed" stroke={SPARKLINE_COLORS.closed} fill={SPARKLINE_COLORS.closed} fillOpacity={0.1} strokeWidth={1.5} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <span className="text-[10px] text-slate-400 whitespace-nowrap">{kpi.sub}</span>
              )}
            </div>
          </button>
        ))}

        {/* Work Governance — compact tile; the full breakdown is a popup */}
        {governance && governance.total > 0 && (
          <button onClick={() => setInsight('governance')}
            className="bg-white px-3 py-2.5 rounded-card shadow-card border border-slate-200 hover:shadow-raised hover:border-slate-300 transition-all text-left group lg:flex-1 min-w-0"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="p-1 rounded-md bg-emerald-50 text-emerald-600 flex-shrink-0"><Gauge size={16} /></span>
              <span className="text-[11px] font-medium text-slate-500 truncate">Governance · 90d</span>
              <ChevronRight size={12} className="ml-auto text-slate-300 group-hover:text-primary-600 transition-colors flex-shrink-0 hidden sm:block" />
            </div>
            <div className="flex items-end justify-between gap-2 mt-2">
              <span className="inline-flex items-end gap-1.5">
                <span className={`text-xl font-bold leading-none ${governance.proPct >= 80 ? 'text-emerald-600' : governance.proPct >= 60 ? 'text-amber-500' : 'text-red-500'}`}>{governance.proPct}%</span>
                {govDelta != null && govDelta !== 0 && (
                  <span className={`text-[10px] font-semibold leading-none ${govDelta > 0 ? 'text-emerald-600' : 'text-red-500'}`} title="vs the prior 90 days">
                    {govDelta > 0 ? '▲' : '▼'}{Math.abs(govDelta)}pp
                  </span>
                )}
              </span>
              <span className="text-[10px] text-slate-400 whitespace-nowrap">proactive</span>
            </div>
            <div className="flex h-1.5 rounded-full overflow-hidden bg-slate-100 mt-1.5">
              <div className="bg-emerald-500 h-full" style={{ width: `${governance.proPct}%` }} />
              <div className="bg-red-500 h-full" style={{ width: `${governance.reaPct}%` }} />
            </div>
          </button>
        )}

        {/* PM Compliance — compact tile; donut + counts in a popup.
            Calm rule: no PMs due in the window → no tile (a confident 0% would lie). */}
        {pmc.due > 0 && (
          <button onClick={() => setInsight('pm')}
            className="bg-white px-3 py-2.5 rounded-card shadow-card border border-slate-200 hover:shadow-raised hover:border-slate-300 transition-all text-left group lg:flex-1 min-w-0"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="p-1 rounded-md bg-green-50 text-green-600 flex-shrink-0"><CheckCircle size={16} /></span>
              <span className="text-[11px] font-medium text-slate-500 truncate">PM Compliance · 90d</span>
              <ChevronRight size={12} className="ml-auto text-slate-300 group-hover:text-primary-600 transition-colors flex-shrink-0 hidden sm:block" />
            </div>
            <div className="flex items-end justify-between gap-2 mt-2">
              <span className="inline-flex items-end gap-1.5">
                <span className={`text-xl font-bold leading-none ${pmComplianceRate >= 90 ? 'text-emerald-600' : pmComplianceRate >= 70 ? 'text-amber-500' : 'text-red-500'}`}>{pmComplianceRate}%</span>
                {pmDelta != null && pmDelta !== 0 && (
                  <span className={`text-[10px] font-semibold leading-none ${pmDelta > 0 ? 'text-emerald-600' : 'text-red-500'}`} title="vs the prior 90 days">
                    {pmDelta > 0 ? '▲' : '▼'}{Math.abs(pmDelta)}pp
                  </span>
                )}
              </span>
              <span className="text-[10px] text-slate-400 whitespace-nowrap">{pmOnTime}/{pmc.due} on-time</span>
            </div>
            <div className="flex h-1.5 rounded-full overflow-hidden bg-slate-100 mt-1.5">
              <div className="bg-green-500 h-full" style={{ width: `${pmComplianceRate}%` }} />
              <div className="bg-amber-400 h-full" style={{ width: `${100 - pmComplianceRate}%` }} />
            </div>
          </button>
        )}
      </div>

      {/* ── Row 3: one tabbed centre feed + insights rail — fills the rest of the screen ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)] gap-3 md:gap-4 flex-1 min-h-0">

        {/* ── Centre feed — pill tabs swap this ONE panel's content (LinkedIn pattern) ── */}
        <div className="bg-white rounded-card shadow-card border border-slate-200 overflow-hidden flex flex-col min-h-0">
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

          {/* Feed switcher — pills control what the single feed below shows */}
          <div className="px-3 sm:px-5 py-3 border-b border-slate-100 flex justify-between items-center gap-2">
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
              <button onClick={() => setWorkTab('active')}
                className={`px-3 py-1.5 min-h-[36px] md:min-h-0 rounded-md text-xs font-semibold transition-all ${workTab === 'active' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >Active ({myWork.length})</button>
              <button onClick={() => setWorkTab('recent')}
                className={`px-3 py-1.5 min-h-[36px] md:min-h-0 rounded-md text-xs font-semibold transition-all ${workTab === 'recent' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >Recent ({recent.length})</button>
              <button onClick={() => setWorkTab('notifications')}
                className={`px-3 py-1.5 min-h-[36px] md:min-h-0 rounded-md text-xs font-semibold transition-all inline-flex items-center gap-1.5 ${workTab === 'notifications' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <BellRing size={13} className={workTab === 'notifications' ? 'text-blue-600' : ''} />
                <span className="hidden xs:inline">Notifications</span>
                {unreadCount > 0 && (
                  <span className="text-[10px] font-bold bg-blue-600 text-white px-1.5 py-0.5 rounded-full leading-none">{unreadCount > 99 ? '99+' : unreadCount}</span>
                )}
              </button>
            </div>
            <button onClick={() => navigate(workTab === 'notifications' ? '/notifications' : '/work-orders')} className="text-xs font-medium text-blue-600 hover:text-blue-800 inline-flex items-center gap-1 min-h-[32px] md:min-h-0 transition whitespace-nowrap">
              View All <ArrowRight size={12} />
            </button>
          </div>

          {/* Tab content */}
          <div className="divide-y divide-slate-50 max-h-[320px] lg:max-h-none lg:flex-1 min-h-0 overflow-y-auto">
            {workTab === 'active' ? (
              myWork.length > 0 ? myWork.map((wo: any) => (
                <button key={wo.id} onClick={() => navigate(`/work-orders/${wo.id}`)}
                  className="w-full p-3 sm:p-3.5 flex items-start sm:items-center gap-2.5 sm:gap-3 hover:bg-blue-50/30 transition text-left min-h-[52px]"
                >
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5 sm:mt-0" style={{ backgroundColor: STATUS_COLORS[wo.status] || '#94a3b8' }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                      <span className="text-sm font-semibold text-slate-900">{wo.wo_number}</span>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{wo.status}</span>
                      {wo.priority_code && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${priorityColor(wo.priority_code)}`}>{wo.priority_code}</span>}
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
            ) : workTab === 'recent' ? (
              recent.length > 0 ? recent.map((wo: any) => (
                <button key={wo.id} onClick={() => navigate(`/work-orders/${wo.id}`)}
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
            ) : (
              notifications.length > 0 ? notifications.map((n: any) => (
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
              )
            )}
          </div>
        </div>

        {/* ── Insights rail — calm strips; each opens its full analysis in a popup ── */}
        <div className="flex flex-col gap-2.5 md:gap-3 min-h-0 lg:overflow-y-auto">

          {/* Backlog Aging strip */}
          <button onClick={() => setInsight('backlog')}
            className="w-full bg-white rounded-card shadow-card border border-slate-200 px-3.5 py-2.5 text-left hover:shadow-raised hover:border-slate-300 transition-all group flex-none"
          >
            <div className="flex items-center gap-2">
              <Clock size={14} className="text-amber-600 flex-shrink-0" />
              <span className="text-xs font-semibold text-slate-900">Backlog Aging</span>
              <span className="ml-auto text-[10px] text-slate-400">{openWOsList.length} open</span>
              <ChevronRight size={13} className="text-slate-300 group-hover:text-primary-600 transition-colors flex-shrink-0" />
            </div>
            <div className="flex h-2 rounded-full overflow-hidden bg-slate-100 mt-2">
              {agingBuckets.map(b => b.count > 0 && (
                <div key={b.label} style={{ width: `${(b.count / Math.max(1, openWOsList.length)) * 100}%`, backgroundColor: b.color }} />
              ))}
            </div>
            <div className="flex justify-between mt-1.5 text-[10px] text-slate-400">
              {agingBuckets.map(b => (
                <span key={b.label}>{b.label} <span className="font-semibold text-slate-600">{b.count}</span></span>
              ))}
            </div>
          </button>

          {/* Top Bad Actors strip — top 3 visible, full Pareto in the popup */}
          {badActors.length > 0 && (
            <button onClick={() => setInsight('badActors')}
              className="w-full bg-white rounded-card shadow-card border border-slate-200 px-3.5 py-2.5 text-left hover:shadow-raised hover:border-slate-300 transition-all group flex-none"
            >
              <div className="flex items-center gap-2">
                <Skull size={14} className="text-red-600 flex-shrink-0" />
                <span className="text-xs font-semibold text-slate-900">Top Bad Actors</span>
                <span className="ml-auto text-[9px] font-medium text-slate-400 uppercase tracking-wide">Pareto</span>
                <ChevronRight size={13} className="text-slate-300 group-hover:text-primary-600 transition-colors flex-shrink-0" />
              </div>
              <div className="mt-2 space-y-1.5">
                {badActors.slice(0, 3).map((a: any, i: number) => (
                  <div key={a.tag} className="flex items-center gap-2 text-[11px]">
                    <span className={`text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${
                      i === 0 ? 'bg-red-100 text-red-700' : i === 1 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                    }`}>{i + 1}</span>
                    <span className="font-semibold text-slate-700 truncate flex-1 min-w-0">{a.tag}</span>
                    <span className="text-slate-500 flex-shrink-0">{a.mtbf_days != null ? `${a.mtbf_days}d MTBF` : '—'}</span>
                  </div>
                ))}
              </div>
            </button>
          )}

          {/* Fleet Reliability strip */}
          {mtbfValues.length > 0 && (
            <button onClick={() => setInsight('fleet')}
              className="w-full bg-white rounded-card shadow-card border border-slate-200 px-3.5 py-2.5 text-left hover:shadow-raised hover:border-slate-300 transition-all group flex-none"
            >
              <div className="flex items-center gap-2">
                <Timer size={14} className="text-blue-600 flex-shrink-0" />
                <span className="text-xs font-semibold text-slate-900">Fleet Reliability</span>
                <span className="ml-auto text-[10px] text-slate-400">{mtbfValues.length} assets</span>
                <ChevronRight size={13} className="text-slate-300 group-hover:text-primary-600 transition-colors flex-shrink-0" />
              </div>
              <div className="flex gap-2 mt-2">
                <div className="flex-1 bg-blue-50 rounded-lg px-2.5 py-1.5">
                  <div className="text-[9px] font-bold text-blue-600 uppercase tracking-wide">Avg MTBF</div>
                  <div className="text-sm font-bold text-slate-900">{avgMTBF} <span className="text-[10px] font-normal text-slate-500">days</span></div>
                </div>
                <div className="flex-1 bg-emerald-50 rounded-lg px-2.5 py-1.5">
                  <div className="text-[9px] font-bold text-emerald-600 uppercase tracking-wide">Avg MTTR</div>
                  <div className="text-sm font-bold text-slate-900">{avgMTTR} <span className="text-[10px] font-normal text-slate-500">hours</span></div>
                </div>
              </div>
            </button>
          )}

          {/* Defect Elimination strip — the program page is the destination */}
          <button onClick={() => navigate('/analyze?division=defect_elimination')}
            className="w-full bg-white rounded-card shadow-card border border-slate-200 px-3.5 py-2.5 text-left hover:shadow-raised hover:border-slate-300 transition-all group flex-none"
          >
            <div className="flex items-center gap-2">
              <Target size={14} className="text-blue-600 flex-shrink-0" />
              <span className="text-xs font-semibold text-slate-900">Defect Elimination</span>
              {criticalDETasks > 0 && (
                <span className="text-[9px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">{criticalDETasks} CRIT</span>
              )}
              <ArrowRight size={13} className="ml-auto text-slate-300 group-hover:text-primary-600 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
            </div>
            <div className="flex items-center justify-between mt-2 text-[11px] text-slate-500">
              <span>Active <span className="font-bold text-slate-900">{activeDETasks.length}</span></span>
              <span>Resolved <span className="font-bold text-emerald-600">{resolvedDETasks.length}</span></span>
              <span>Savings <span className="font-bold text-slate-900">${totalDESavings.toLocaleString()}</span></span>
            </div>
          </button>
        </div>
      </div>
      </>)}

      {/* ── Drill-down popups (calm-screens: process lives in the popup, the page stays a report).
             Mounted for every view so the persona rails share the same popups. ── */}

      {/* PM Schedule Compliance popup */}
      <Modal open={insight === 'pm'} onClose={() => setInsight(null)} title="PM Compliance" size="sm">
        <div>
          <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-3">PMs due in the last 90 days + any still-open overdue PM · on-time = closed by the due date</div>
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
              <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500" /> Late / Missed: {pmMissed}</div>
              <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-slate-200" /> Due in window: {pmc.due}</div>
            </div>
          </div>
          <button onClick={() => navigate('/reports')} className="mt-3 text-xs font-medium text-blue-600 hover:text-blue-800 inline-flex items-center gap-1 transition">
            View in Reports <ArrowRight size={12} />
          </button>
        </div>
      </Modal>

      {/* Backlog Aging popup */}
      <Modal open={insight === 'backlog'} onClose={() => setInsight(null)} title="Backlog Aging" size="sm">
        <div>
          <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-3">Age of open work orders since creation</div>
          <div className="h-40">
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
          <div className="text-xs text-slate-500 mt-2">{openWOsList.length} open WOs in backlog</div>
          <button onClick={() => navigate('/reports/drilldown/backlog')} className="mt-2 text-xs font-medium text-blue-600 hover:text-blue-800 inline-flex items-center gap-1 transition">
            View in Reports <ArrowRight size={12} />
          </button>
        </div>
      </Modal>

      {/* Top 5 Bad Actors popup — Pareto (ISO 55000 Monthly Analysis) */}
      <Modal open={insight === 'badActors'} onClose={() => setInsight(null)} title="Top Bad Actors — Pareto" size="md">
        <div>
          <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-3">ISO 55000 monthly analysis · lowest MTBF first</div>
          <div className="space-y-2.5">
            {badActors.length > 0 ? (() => {
              const maxMTBF = Math.max(1, ...badActors.map((a: any) => a.mtbf_days || 1));
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
                          style={{ width: `${Math.max(10, 100 - (((a.mtbf_days ?? maxMTBF) / maxMTBF) * 80))}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="text-[10px] font-medium text-slate-500"
                        title={a.window === 'lifetime'
                          ? 'Mean time between failures — no failures in the last 12 months; computed over the asset\'s full recorded history (0298 lifetime basis)'
                          : 'Mean time between failures — computed from the last 12 months of corrective work'}>
                        {a.mtbf_days != null ? `${a.mtbf_days}d` : '—'}{a.window === 'lifetime' ? <span className="text-slate-400"> · life</span> : null}
                      </span>
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
                            showToast(`DE Task created for ${a.tag}. Navigate to Analyze → Defect Elimination to review.`, 'success');
                          } catch (err: any) {
                            showToast(`Failed to create DE task: ${err.message}`, 'error');
                          }
                        }}
                        className="relative p-1 rounded hover:bg-blue-50 text-blue-500 hover:text-blue-700 before:absolute before:-inset-2.5 before:content-[''] md:before:hidden"
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
            <button onClick={() => navigate('/reports')} className="text-[10px] font-medium text-blue-600 hover:text-blue-800 inline-flex items-center gap-1 min-h-[32px] md:min-h-0 transition">
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
                showToast(`${created} DE task(s) created. Navigate to Analyze → Defect Elimination.`, 'success');
              }}
              className="text-[10px] font-bold text-blue-600 hover:text-blue-800 inline-flex items-center gap-1 min-h-[36px] md:min-h-0 transition bg-blue-50 px-2.5 py-1 rounded-md hover:bg-blue-100"
            >
              <Target size={10} /> Draft All DE Tasks
            </button>
          </div>
        </div>
      </Modal>

      {/* Fleet Reliability popup (MTBF/MTTR) */}
      <Modal open={insight === 'fleet'} onClose={() => setInsight(null)} title="Fleet Reliability" size="sm">
        <div>
          {/* Per-asset means. Reports shows a POOLED fleet figure over its date
              range, which is a different (also correct) aggregation — both are
              labelled so the two pages cannot look like they disagree. */}
          <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-3">Mean of {mtbfValues.length} assets with recorded failures</div>
          <div className="space-y-3">
            <div className="bg-blue-50 rounded-lg p-3">
              <div className="text-[10px] font-bold text-blue-600 uppercase tracking-wide">Avg MTBF</div>
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
          <button onClick={() => navigate('/reports/drilldown/mtbf-mttr')} className="mt-3 text-xs font-medium text-blue-600 hover:text-blue-800 inline-flex items-center gap-1 transition">
            View MTBF/MTTR Analysis <ArrowRight size={12} />
          </button>
        </div>
      </Modal>

      {/* Work Governance popup — Planned vs Reactive (last 90 days) */}
      <Modal open={insight === 'governance'} onClose={() => setInsight(null)} title="Work Governance" size="sm">
        <div>
          <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-3">Planned vs Reactive · last 90 days · {governance.total} jobs</div>
          <div className="flex items-end justify-between">
            <div>
              <div className={`text-3xl font-extrabold leading-none ${governance.proPct >= 80 ? 'text-emerald-600' : governance.proPct >= 60 ? 'text-amber-500' : 'text-red-500'}`}>{governance.proPct}%</div>
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mt-1">Proactive</div>
            </div>
          </div>
          <div className="flex h-3 rounded-full overflow-hidden bg-slate-100 border border-slate-200 mt-3">
            <div className="bg-emerald-500 h-full" style={{ width: `${governance.proPct}%` }} />
            <div className="bg-red-500 h-full" style={{ width: `${governance.reaPct}%` }} />
          </div>
          <div className="flex items-center justify-between mt-2 text-[11px]">
            <span className="font-semibold text-emerald-700 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> {governance.proactive} proactive</span>
            <span className="font-semibold text-red-700 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> {governance.reactive} reactive</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-3">World-class benchmark ≥ 80% proactive.</p>
          <button onClick={() => navigate('/reliability-metrics')} className="mt-2 text-xs font-medium text-blue-600 hover:text-blue-800 inline-flex items-center gap-1 transition">
            Full reliability metrics <ArrowRight size={12} />
          </button>
        </div>
      </Modal>
    </div>
  );
};
