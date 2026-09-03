/**
 * Dashboard role views — the "different hats" lenses.
 *
 * Every user can toggle through every view (pills are hidden only where the
 * permission matrix denies the underlying data, e.g. no cost visibility → no
 * Finance lens); the user's role merely picks the starting hat. Each view keeps
 * the dashboard's locked one-viewport skeleton — KPI band, centre feed, insights
 * rail — and swaps the contents, reusing the persona components the role-fit
 * work shipped (CrewBoard, ShiftHandoverModal, FailureReviewQueue, RenewalQueue,
 * downtimeCost). Persona data loads lazily: a view queries only while worn.
 */
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
    ChevronRight, ArrowRight, Wrench, Clock, Gauge, CheckCircle, Timer, Skull,
    Target, ClipboardCheck, Users, UserX, CalendarClock, Boxes, AlertTriangle,
    DollarSign, Recycle, Bell, RefreshCcw,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { DatabaseService } from '../../services/DatabaseService';
import { useAuth } from '../../contexts/AuthContext';
import { isOpenWo } from '../../../lib/woState';
import { fetchDowntimeRates, effectiveRate, fmtMoney } from '../../../lib/downtimeCost';
import { computeRenewalQueue, type LifecycleRow } from '../../../lib/renewal';
import { CrewBoard } from '../scheduling/CrewBoard';
import { ShiftHandoverModal } from '../scheduling/ShiftHandoverModal';
import { FailureReviewQueue } from '../../../components/analyze/FailureReviewQueue';
import { RenewalQueue } from '../finops/RenewalQueue';

// ── Contract with Dashboard.tsx ─────────────────────────────────────────────
export type DashboardView = 'overview' | 'reliability' | 'supervisor' | 'assets' | 'finance';
export type InsightKey = 'governance' | 'pm' | 'backlog' | 'badActors' | 'fleet';

export interface DashboardShared {
    wos: any[]; // full WO rows from the dashboard query (incl. actual_downtime_hrs)
    openWOs: number;
    overdueCount: number;
    governance: { proactive: number; reactive: number; total: number; proPct: number; reaPct: number; prevProPct: number | null };
    pmDue: number; pmOnTime: number; pmRatePct: number;
    badActors: any[];
    avgMTBF: number; avgMTTR: number; mtbfCount: number;
    agingBuckets: { label: string; count: number; color: string }[];
    openBacklogCount: number;
    deActive: number; deResolved: number; deSavings: number; deCritical: number;
    notificationsCount: number;
    assetsCount: number; criticalAssets: number;
}

interface ViewProps { shared: DashboardShared; openInsight: (k: InsightKey) => void }

// ── Small building blocks (match the overview's tile/strip look) ────────────
const Tile: React.FC<{
    icon: React.ReactNode; iconBg: string; label: string;
    value: React.ReactNode; valueClass?: string; sub?: string; onClick?: () => void;
}> = ({ icon, iconBg, label, value, valueClass = 'text-slate-900', sub, onClick }) => (
    <button onClick={onClick} disabled={!onClick}
        className="bg-white px-3 py-2.5 rounded-card shadow-card border border-slate-200 text-left group lg:flex-1 min-w-0 transition-all enabled:hover:shadow-raised enabled:hover:border-slate-300"
    >
        <div className="flex items-center gap-1.5 min-w-0">
            <span className={`p-1 rounded-md ${iconBg} flex-shrink-0`}>{icon}</span>
            <span className="text-[11px] font-medium text-slate-500 truncate">{label}</span>
            {onClick && <ChevronRight size={12} className="ml-auto text-slate-300 group-hover:text-primary-600 transition-colors flex-shrink-0 hidden sm:block" />}
        </div>
        <div className="flex items-end justify-between gap-2 mt-2">
            <span className={`text-xl font-bold leading-none ${valueClass}`}>{value}</span>
            {sub && <span className="text-[10px] text-slate-500 whitespace-nowrap">{sub}</span>}
        </div>
    </button>
);

const Strip: React.FC<{
    icon: React.ReactNode; title: string; right?: React.ReactNode;
    onClick: () => void; chevron?: 'chevron' | 'arrow'; children?: React.ReactNode;
}> = ({ icon, title, right, onClick, chevron = 'chevron', children }) => (
    <button onClick={onClick}
        className="w-full bg-white rounded-card shadow-card border border-slate-200 px-3.5 py-2.5 text-left hover:shadow-raised hover:border-slate-300 transition-all group flex-none"
    >
        <div className="flex items-center gap-2">
            {icon}
            <span className="text-xs font-semibold text-slate-900">{title}</span>
            {right && <span className="ml-auto text-[10px] text-slate-500">{right}</span>}
            {chevron === 'arrow'
                ? <ArrowRight size={13} className={`${right ? '' : 'ml-auto '}text-slate-300 group-hover:text-primary-600 group-hover:translate-x-0.5 transition-all flex-shrink-0`} />
                : <ChevronRight size={13} className={`${right ? '' : 'ml-auto '}text-slate-300 group-hover:text-primary-600 transition-colors flex-shrink-0`} />}
        </div>
        {children && <div className="mt-2">{children}</div>}
    </button>
);

const Band: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 md:gap-3 lg:flex flex-none">{children}</div>
);

const MainGrid: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)] gap-3 md:gap-4 flex-1 min-h-0">{children}</div>
);

const FeedPanel: React.FC<{ icon: React.ReactNode; title: string; badge?: number; action?: React.ReactNode; flush?: boolean; children: React.ReactNode }> =
    ({ icon, title, badge, action, flush = false, children }) => (
        <div className="bg-white rounded-card shadow-card border border-slate-200 overflow-hidden flex flex-col min-h-0">
            <div className="px-4 sm:px-5 py-3 border-b border-slate-100 flex items-center gap-2 flex-none">
                {icon}
                <h3 className="font-semibold text-slate-900 text-sm">{title}</h3>
                {badge !== undefined && badge > 0 && (
                    <span className="text-[10px] font-bold bg-blue-600 text-white px-1.5 py-0.5 rounded-full leading-none">{badge}</span>
                )}
                <div className="ml-auto">{action}</div>
            </div>
            <div className={`flex-1 min-h-0 overflow-y-auto ${flush ? '' : 'p-3 md:p-4'} bg-slate-50/50`}>{children}</div>
        </div>
    );

const Rail: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="flex flex-col gap-2.5 md:gap-3 min-h-0 lg:overflow-y-auto">{children}</div>
);

const railStripsShared = (shared: DashboardShared, openInsight: (k: InsightKey) => void) => ({
    backlog: (
        <Strip key="backlog" icon={<Clock size={14} className="text-amber-600 flex-shrink-0" />} title="Backlog Aging"
            right={`${shared.openBacklogCount} open`} onClick={() => openInsight('backlog')}
        >
            <div className="flex h-2 rounded-full overflow-hidden bg-slate-100">
                {shared.agingBuckets.map(b => b.count > 0 && (
                    <div key={b.label} style={{ width: `${(b.count / Math.max(1, shared.openBacklogCount)) * 100}%`, backgroundColor: b.color }} />
                ))}
            </div>
        </Strip>
    ),
    badActors: shared.badActors.length > 0 && (
        <Strip key="bad" icon={<Skull size={14} className="text-red-600 flex-shrink-0" />} title="Top Bad Actors"
            right="Pareto" onClick={() => openInsight('badActors')}
        >
            <div className="space-y-1.5">
                {shared.badActors.slice(0, 3).map((a: any, i: number) => (
                    <div key={a.tag} className="flex items-center gap-2 text-[11px]">
                        <span className={`text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${i === 0 ? 'bg-red-100 text-red-700' : i === 1 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{i + 1}</span>
                        <span className="font-semibold text-slate-700 truncate flex-1 min-w-0">{a.tag}</span>
                        <span className="text-slate-500 flex-shrink-0">{a.mtbf_days != null ? `${a.mtbf_days}d MTBF` : '—'}</span>
                    </div>
                ))}
            </div>
        </Strip>
    ),
    fleet: shared.mtbfCount > 0 && (
        <Strip key="fleet" icon={<Timer size={14} className="text-blue-600 flex-shrink-0" />} title="Fleet Reliability"
            right={`${shared.mtbfCount} assets`} onClick={() => openInsight('fleet')}
        >
            <div className="flex gap-2">
                <div className="flex-1 bg-blue-50 rounded-lg px-2.5 py-1.5">
                    <div className="text-[9px] font-bold text-blue-600 uppercase tracking-wide">Avg MTBF</div>
                    <div className="text-sm font-bold text-slate-900">{shared.avgMTBF} <span className="text-[10px] font-normal text-slate-500">days</span></div>
                </div>
                <div className="flex-1 bg-emerald-50 rounded-lg px-2.5 py-1.5">
                    <div className="text-[9px] font-bold text-emerald-600 uppercase tracking-wide">Avg MTTR</div>
                    <div className="text-sm font-bold text-slate-900">{shared.avgMTTR} <span className="text-[10px] font-normal text-slate-500">hours</span></div>
                </div>
            </div>
        </Strip>
    ),
});

// ── 12-month unplanned downtime, priced where a rate exists ─────────────────
// Follows the drill-down convention: type CM = unplanned. Honesty contract from
// lib/downtimeCost: no rate anywhere → show hours, never invent currency.
function useDowntime12mo(wos: any[], enabled: boolean) {
    const { data: rates } = useQuery({ queryKey: ['downtime-rates'], queryFn: fetchDowntimeRates, staleTime: 300000, enabled });
    return useMemo(() => {
        const cutoff = Date.now() - 365 * 86400000;
        const byAsset = new Map<string, number>();
        let hours = 0;
        for (const w of wos) {
            const h = Number(w.actual_downtime_hrs) || 0;
            if (h <= 0 || w.type !== 'CM' || new Date(w.created_at).getTime() < cutoff) continue;
            hours += h;
            if (w.asset_id) byAsset.set(w.asset_id, (byAsset.get(w.asset_id) || 0) + h);
        }
        if (!rates) return { hours: Math.round(hours * 10) / 10, cost: null as number | null };
        let cost = 0; let priced = false;
        for (const [assetId, h] of byAsset) {
            const rate = effectiveRate(rates, assetId);
            if (rate != null) { cost += rate * h; priced = true; }
        }
        return { hours: Math.round(hours * 10) / 10, cost: priced ? cost : null };
    }, [wos, rates]);
}

// ── Reliability Engineer view ───────────────────────────────────────────────
export const ReliabilityView: React.FC<ViewProps> = ({ shared, openInsight }) => {
    const navigate = useNavigate();
    const { user, profile } = useAuth() as any;
    const [reviewCount, setReviewCount] = useState(0);
    const downtime = useDowntime12mo(shared.wos, true);
    const strips = railStripsShared(shared, openInsight);
    return (<>
        <Band>
            <Tile icon={<AlertTriangle size={16} />} iconBg="bg-red-50 text-red-600" label="Unplanned Downtime · 12mo"
                value={downtime.cost != null ? fmtMoney(downtime.cost) : `${downtime.hours}h`}
                valueClass={downtime.cost != null ? 'text-red-600' : 'text-slate-900'}
                sub={downtime.cost != null ? `${downtime.hours}h · est. @ rate` : 'no $/hr rate set'}
                onClick={() => navigate('/reports/drilldown/downtime')} />
            {shared.governance.total > 0 && (
                <Tile icon={<Gauge size={16} />} iconBg="bg-emerald-50 text-emerald-600" label="Governance · 90d"
                    value={`${shared.governance.proPct}%`}
                    valueClass={shared.governance.proPct >= 80 ? 'text-emerald-600' : shared.governance.proPct >= 60 ? 'text-amber-500' : 'text-red-500'}
                    sub="proactive" onClick={() => openInsight('governance')} />
            )}
            {shared.pmDue > 0 && (
                <Tile icon={<CheckCircle size={16} />} iconBg="bg-green-50 text-green-600" label="PM Compliance · 90d"
                    value={`${shared.pmRatePct}%`}
                    valueClass={shared.pmRatePct >= 90 ? 'text-emerald-600' : shared.pmRatePct >= 70 ? 'text-amber-500' : 'text-red-500'}
                    sub={`${shared.pmOnTime}/${shared.pmDue} on-time`} onClick={() => openInsight('pm')} />
            )}
            <Tile icon={<ClipboardCheck size={16} />} iconBg="bg-blue-50 text-blue-600" label="Unreviewed Failures"
                value={reviewCount} sub="FRACAS queue" />
            <Tile icon={<Wrench size={16} />} iconBg="bg-slate-100 text-slate-600" label="Open Work Orders"
                value={shared.openWOs} onClick={() => navigate('/work-orders')} />
        </Band>
        <MainGrid>
            <FeedPanel icon={<ClipboardCheck size={16} className="text-blue-600" />} title="Failure Review — FRACAS" badge={reviewCount}
                action={<button onClick={() => navigate('/failure-review')} className="text-xs font-medium text-blue-600 hover:text-blue-800 inline-flex items-center gap-1">Open full page <ArrowRight size={12} /></button>}
            >
                <FailureReviewQueue currentUser={user?.username || profile?.username || user?.email || 'engineer'} onCountChange={setReviewCount} />
            </FeedPanel>
            <Rail>
                {strips.badActors}
                {strips.fleet}
                {strips.backlog}
                <Strip icon={<Gauge size={14} className="text-primary-600 flex-shrink-0" />} title="Reliability Metrics"
                    right="KPIs · SMRP" chevron="arrow"
                    onClick={() => navigate('/reliability-metrics')} />
                <Strip icon={<Target size={14} className="text-blue-600 flex-shrink-0" />} title="Defect Elimination"
                    right={`${shared.deActive} active`} chevron="arrow"
                    onClick={() => navigate('/analyze?division=defect_elimination')} />
            </Rail>
        </MainGrid>
    </>);
};

// ── Supervisor view ─────────────────────────────────────────────────────────
export const SupervisorView: React.FC<ViewProps> = ({ shared, openInsight }) => {
    const navigate = useNavigate();
    const { user } = useAuth() as any;
    const [handoverOpen, setHandoverOpen] = useState(false);
    const { data } = useQuery({
        queryKey: ['dash-crew'],
        queryFn: async () => {
            const db = DatabaseService.getInstance();
            const [jobs, contacts] = await Promise.all([db.getWorkOrders().catch(() => []), db.getContacts().catch(() => [])]);
            return { jobs, contacts };
        },
        staleTime: 120000,
    });
    const jobs = data?.jobs || [];
    // Same crew roster rule as Scheduling, so the two boards agree.
    const crew = useMemo(() => (data?.contacts || []).filter((c: any) =>
        c.active && (c.flags?.isLabour || c.types?.some((t: string) => ['TECHNICIAN', 'ELECTRICIAN', 'MECHANIC', 'INSTRUMENT', 'OPERATOR', 'SUPERVISOR'].includes(t.toUpperCase())))
    ), [data?.contacts]);
    const { dueToday, unassigned } = useMemo(() => {
        const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
        let dueToday = 0, unassigned = 0;
        for (const j of jobs as any[]) {
            if (!isOpenWo(j.status)) continue;
            const due = j.dueDate || j.due_date;
            if (due && new Date(due) <= todayEnd) dueToday++;
            if (!j.assignedTo && !j.assigned_to) unassigned++;
        }
        return { dueToday, unassigned };
    }, [jobs]);
    const strips = railStripsShared(shared, openInsight);
    return (<>
        <Band>
            <Tile icon={<AlertTriangle size={16} />} iconBg="bg-red-50 text-red-600" label="Overdue"
                value={shared.overdueCount} valueClass={shared.overdueCount > 0 ? 'text-red-600' : 'text-slate-900'}
                onClick={() => navigate('/work-orders?filter=overdue')} />
            <Tile icon={<CalendarClock size={16} />} iconBg="bg-amber-50 text-amber-600" label="Due by Today"
                value={dueToday} onClick={() => navigate('/scheduling')} />
            <Tile icon={<UserX size={16} />} iconBg="bg-orange-50 text-orange-600" label="Unassigned"
                value={unassigned} valueClass={unassigned > 0 ? 'text-amber-600' : 'text-slate-900'}
                sub="assign in Scheduling" onClick={() => navigate('/scheduling')} />
            <Tile icon={<Wrench size={16} />} iconBg="bg-blue-50 text-blue-600" label="Open Work Orders"
                value={shared.openWOs} onClick={() => navigate('/work-orders')} />
            <Tile icon={<Users size={16} />} iconBg="bg-emerald-50 text-emerald-600" label="Crew"
                value={crew.length} sub="active people" onClick={() => navigate('/contacts')} />
        </Band>
        <MainGrid>
            <FeedPanel icon={<Users size={16} className="text-emerald-600" />} title="Crew Board"
                action={<button onClick={() => navigate('/scheduling')} className="text-xs font-medium text-blue-600 hover:text-blue-800 inline-flex items-center gap-1">Open Scheduling <ArrowRight size={12} /></button>}
            >
                <CrewBoard jobs={jobs} contacts={crew} />
            </FeedPanel>
            <Rail>
                <Strip icon={<RefreshCcw size={14} className="text-primary-600 flex-shrink-0" />} title="Shift Handover"
                    right="write / acknowledge" onClick={() => setHandoverOpen(true)}
                >
                    <p className="text-[11px] text-slate-500">Freeze the shift snapshot — completions, new breakdowns, open criticals — and pass the baton.</p>
                </Strip>
                {strips.backlog}
                <Strip icon={<Bell size={14} className="text-blue-600 flex-shrink-0" />} title="Notifications"
                    right={shared.notificationsCount > 0 ? `${shared.notificationsCount} unread` : 'all clear'} chevron="arrow"
                    onClick={() => navigate('/notifications')} />
            </Rail>
        </MainGrid>
        <ShiftHandoverModal open={handoverOpen} onClose={() => setHandoverOpen(false)} currentUser={user?.username || user?.email || 'supervisor'} />
    </>);
};

// ── Fleet lifecycle rows (shared by Assets + Finance; react-query dedupes) ──
function useLifecycleFleet(enabled: boolean) {
    return useQuery({
        queryKey: ['sem-lifecycle-fleet'],
        queryFn: async () => {
            const { data, error } = await supabase.from('sem_asset_lifecycle_cost').select('*').gt('wo_count_lifetime', 0).limit(5000);
            if (error) throw error;
            return (data || []) as LifecycleRow[];
        },
        staleTime: 300000,
        enabled,
    });
}

// ── Asset Manager view ──────────────────────────────────────────────────────
export const AssetsView: React.FC<ViewProps> = ({ shared, openInsight }) => {
    const navigate = useNavigate();
    const { data: rows = [] } = useLifecycleFleet(true);
    const { data: rates } = useQuery({ queryKey: ['downtime-rates'], queryFn: fetchDowntimeRates, staleTime: 300000 });
    const maint12 = useMemo(() => rows.reduce((s, r) => s + (Number(r.maint_cost_12mo) || 0), 0), [rows]);
    const renewals = useMemo(() => computeRenewalQueue(rows, rates?.companyDefault ?? null), [rows, rates]);
    const topCost = useMemo(() => [...rows].sort((a, b) => (Number(b.maint_cost_12mo) || 0) - (Number(a.maint_cost_12mo) || 0)).slice(0, 3), [rows]);
    const strips = railStripsShared(shared, openInsight);
    return (<>
        <Band>
            <Tile icon={<Boxes size={16} />} iconBg="bg-emerald-50 text-emerald-600" label="Assets Managed"
                value={shared.assetsCount} sub={`${shared.criticalAssets} Critical-A`} onClick={() => navigate('/assets')} />
            <Tile icon={<DollarSign size={16} />} iconBg="bg-blue-50 text-blue-600" label="Maintenance Cost · 12mo"
                value={maint12 > 0 ? fmtMoney(maint12) : '—'} sub="actual WO cost" onClick={() => navigate('/reports')} />
            <Tile icon={<Recycle size={16} />} iconBg="bg-amber-50 text-amber-600" label="Renewal Candidates"
                value={renewals.length} valueClass={renewals.length > 0 ? 'text-amber-600' : 'text-slate-900'}
                sub="repair vs replace" onClick={() => navigate('/finops')} />
            <Tile icon={<Target size={16} />} iconBg="bg-emerald-50 text-emerald-600" label="DE Savings"
                value={shared.deSavings > 0 ? fmtMoney(shared.deSavings) : '—'} sub={`${shared.deResolved} resolved`}
                onClick={() => navigate('/analyze?division=defect_elimination')} />
        </Band>
        <MainGrid>
            <div className="min-h-0 overflow-y-auto">
                <RenewalQueue />
            </div>
            <Rail>
                {topCost.length > 0 && (
                    <Strip icon={<DollarSign size={14} className="text-blue-600 flex-shrink-0" />} title="Top Lifecycle Cost"
                        right="12mo" chevron="arrow" onClick={() => navigate('/assets')}
                    >
                        <div className="space-y-1.5">
                            {topCost.map((r: any) => (
                                <div key={r.asset_id} className="flex items-center gap-2 text-[11px]">
                                    <span className="font-semibold text-slate-700 truncate flex-1 min-w-0">{r.asset_tag || r.asset_name}</span>
                                    <span className="text-slate-500 flex-shrink-0">{fmtMoney(Number(r.maint_cost_12mo) || 0)}</span>
                                </div>
                            ))}
                        </div>
                    </Strip>
                )}
                {strips.badActors}
                {strips.fleet}
                <Strip icon={<Gauge size={14} className="text-primary-600 flex-shrink-0" />} title="Register Health"
                    right="data quality" chevron="arrow" onClick={() => navigate('/reliability-metrics')} />
            </Rail>
        </MainGrid>
    </>);
};

// ── Finance / Executive view ────────────────────────────────────────────────
export const FinanceView: React.FC<ViewProps> = ({ shared, openInsight }) => {
    const navigate = useNavigate();
    const { data: rows = [] } = useLifecycleFleet(true);
    const downtime = useDowntime12mo(shared.wos, true);
    const { data: rav = 0 } = useQuery({
        queryKey: ['dash-rav'],
        queryFn: async () => {
            const { data } = await supabase.from('asset_financials').select('replacement_value');
            return (data || []).reduce((s: number, r: any) => s + (Number(r.replacement_value) || 0), 0);
        },
        staleTime: 300000,
    });
    const maint12 = useMemo(() => rows.reduce((s, r) => s + (Number(r.maint_cost_12mo) || 0), 0), [rows]);
    const pctRav = rav > 0 && maint12 > 0 ? Math.round((maint12 / rav) * 1000) / 10 : null;
    const topCost = useMemo(() => [...rows].sort((a, b) => (Number(b.maint_cost_12mo) || 0) - (Number(a.maint_cost_12mo) || 0)).slice(0, 10), [rows]);
    return (<>
        <Band>
            <Tile icon={<DollarSign size={16} />} iconBg="bg-blue-50 text-blue-600" label="Maintenance Cost · 12mo"
                value={maint12 > 0 ? fmtMoney(maint12) : '—'} sub="actual WO cost" onClick={() => navigate('/finops')} />
            <Tile icon={<Gauge size={16} />} iconBg="bg-emerald-50 text-emerald-600" label="Cost % of RAV"
                value={pctRav != null ? `${pctRav}%` : '—'}
                valueClass={pctRav == null ? 'text-slate-900' : pctRav <= 3 ? 'text-emerald-600' : pctRav <= 5 ? 'text-amber-500' : 'text-red-500'}
                sub={rav > 0 ? `RAV ${fmtMoney(rav)} · target ≤ 2–3%` : 'RAV not captured'}
                onClick={() => navigate('/reliability-metrics')} />
            <Tile icon={<AlertTriangle size={16} />} iconBg="bg-red-50 text-red-600" label="Unplanned Downtime · 12mo"
                value={downtime.cost != null ? fmtMoney(downtime.cost) : `${downtime.hours}h`}
                valueClass={downtime.cost != null ? 'text-red-600' : 'text-slate-900'}
                sub={downtime.cost != null ? 'est. @ rate' : 'no $/hr rate set'}
                onClick={() => navigate('/reports/drilldown/downtime')} />
            <Tile icon={<Target size={16} />} iconBg="bg-emerald-50 text-emerald-600" label="DE Savings"
                value={shared.deSavings > 0 ? fmtMoney(shared.deSavings) : '—'} sub={`${shared.deResolved} resolved`}
                onClick={() => navigate('/analyze?division=defect_elimination')} />
        </Band>
        <MainGrid>
            <FeedPanel icon={<DollarSign size={16} className="text-blue-600" />} title="Where the Money Goes" flush
                action={<button onClick={() => navigate('/finops')} className="text-xs font-medium text-blue-600 hover:text-blue-800 inline-flex items-center gap-1">Open FinOps <ArrowRight size={12} /></button>}
            >
                {topCost.length === 0 ? (
                    <div className="p-8 text-center text-sm text-slate-500">No maintenance cost captured in the last 12 months yet.</div>
                ) : (
                    <div className="divide-y divide-slate-100 bg-white">
                        {topCost.map((r: any, i: number) => (
                            <button key={r.asset_id} onClick={() => navigate(`/assets?id=${r.asset_id}`)}
                                className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50 transition text-left"
                            >
                                <span className="text-[10px] font-bold w-5 h-5 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center flex-shrink-0">{i + 1}</span>
                                <div className="flex-1 min-w-0">
                                    <span className="text-sm font-semibold text-slate-800">{r.asset_tag || r.asset_name}</span>
                                    {r.criticality && <span className="text-[9px] font-bold ml-1.5 px-1 py-0.5 rounded bg-slate-100 text-slate-500">{r.criticality}</span>}
                                    <p className="text-xs text-slate-500 truncate">{r.asset_name}</p>
                                </div>
                                <div className="text-right flex-shrink-0">
                                    <div className="text-sm font-bold text-slate-900">{fmtMoney(Number(r.maint_cost_12mo) || 0)}</div>
                                    <div className="text-[10px] text-slate-500">12-mo maint.</div>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </FeedPanel>
            <Rail>
                {shared.governance.total > 0 && (
                    <Strip icon={<Gauge size={14} className="text-emerald-600 flex-shrink-0" />} title="Work Governance"
                        right={`${shared.governance.proPct}% proactive`} onClick={() => openInsight('governance')}
                    >
                        <div className="flex h-2 rounded-full overflow-hidden bg-slate-100">
                            <div className="bg-emerald-500 h-full" style={{ width: `${shared.governance.proPct}%` }} />
                            <div className="bg-red-500 h-full" style={{ width: `${shared.governance.reaPct}%` }} />
                        </div>
                    </Strip>
                )}
                <Strip icon={<Recycle size={14} className="text-amber-600 flex-shrink-0" />} title="Renewal Forecast"
                    right="repair vs replace" chevron="arrow" onClick={() => navigate('/finops')} />
                <Strip icon={<Target size={14} className="text-blue-600 flex-shrink-0" />} title="Defect Elimination"
                    right={`${shared.deActive} active · ${fmtMoney(shared.deSavings)} saved`} chevron="arrow"
                    onClick={() => navigate('/analyze?division=defect_elimination')} />
            </Rail>
        </MainGrid>
    </>);
};
