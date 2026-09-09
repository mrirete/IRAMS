/**
 * My Work — the technician's home.
 *
 * Two halves, one control. OPEN: my assigned work, today, in priority order,
 * one tap to execute — card-first (mobile), grouped by urgency (Overdue /
 * Today / This Week / Later), with a last-synced offline copy so the list still
 * opens in a dead zone. DONE: what I have finished, month by month, with the
 * hours I booked — the job history a person could never see before.
 *
 * Every card carries a status sentence ("In progress since Tue", "Scheduled ·
 * assigned yesterday by J. Supervisor") read from the system journal in one
 * batched query (lib/woTimeline.ts). Technician roles land here by default
 * (see RoleLanding in App.tsx).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ClipboardList, ChevronRight, MapPin, RefreshCw, WifiOff, CheckCircle2, Clock, History,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { DatabaseService } from '../services/DatabaseService';
import { WorkOrderRecord } from '../schema';
import { StatusPill, PriorityPill, Button } from '../components/ui';
import { statusSentence, groupByMonth, completionDateOf, formatWhen, statusLabel, type JournalLike } from '../lib/woTimeline';
import { isVoidWo } from '../../lib/woState';

type MyWO = WorkOrderRecord & { assets?: { name?: string } | null };
type DoneWO = MyWO & { my_hours: number; via: 'assigned' | 'labour' | 'completed' };
type Segment = 'open' | 'done';

const CACHE_PREFIX = 'ers_mywork_cache_';

interface CachedList { savedAt: string; rows: MyWO[]; }

const readCache = (contactId: string): CachedList | null => {
    try {
        const raw = localStorage.getItem(CACHE_PREFIX + contactId);
        return raw ? (JSON.parse(raw) as CachedList) : null;
    } catch { return null; }
};
const writeCache = (contactId: string, rows: MyWO[]): void => {
    try { localStorage.setItem(CACHE_PREFIX + contactId, JSON.stringify({ savedAt: new Date().toISOString(), rows })); } catch { /* quota */ }
};

// ── Date bucketing ──────────────────────────────────────────────────────────
type Bucket = 'overdue' | 'today' | 'week' | 'later';

const BUCKET_META: Record<Bucket, { label: string; accent: string }> = {
    overdue: { label: 'Overdue', accent: 'text-red-600' },
    today: { label: 'Due today', accent: 'text-amber-600' },
    week: { label: 'This week', accent: 'text-slate-700' },
    later: { label: 'Later / unscheduled', accent: 'text-slate-500' },
};

function bucketOf(due?: string): Bucket {
    if (!due) return 'later';
    const d = new Date(due);
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
    const endOfWeek = new Date(startOfToday); endOfWeek.setDate(endOfWeek.getDate() + 7);
    if (d < startOfToday) return 'overdue';
    if (d <= endOfToday) return 'today';
    if (d <= endOfWeek) return 'week';
    return 'later';
}

function dueLabel(due?: string): { text: string; cls: string } {
    if (!due) return { text: 'No due date', cls: 'text-slate-400' };
    const d = new Date(due);
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const dayMs = 86_400_000;
    const diffDays = Math.floor((d.getTime() - startOfToday.getTime()) / dayMs);
    if (diffDays < 0) return { text: `Overdue ${-diffDays}d`, cls: 'text-red-600 font-semibold' };
    if (diffDays === 0) return { text: 'Due today', cls: 'text-amber-600 font-semibold' };
    if (diffDays === 1) return { text: 'Due tomorrow', cls: 'text-slate-600' };
    return { text: `Due ${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`, cls: 'text-slate-600' };
}

// Within a bucket: emergencies first, then by due date.
const PRIORITY_RANK: Record<string, number> = { EMERGENCY: 0, CRITICAL: 0, URGENT: 1, HIGH: 2, MEDIUM: 3, LOW: 4 };
const rankOf = (p?: string) => PRIORITY_RANK[(p || '').toUpperCase()] ?? 5;

const fmtHours = (h: number) => (h >= 10 ? Math.round(h).toString() : (Math.round(h * 10) / 10).toString());

export const MyWork: React.FC = () => {
    const { profile } = useAuth();
    const navigate = useNavigate();
    // Work can be recorded against either id: assigned_to holds the contact,
    // task assignees hold the user (see woInvolvesPerson in lib/workOrder.ts).
    const contactId = profile?.contactId || '';
    const userId = profile?.id || '';
    // Names the status-change journal may carry for this person (author_name
    // = username || email at write time) -> "jobs you completed".
    const authorKeys = useMemo(() => [profile?.username, profile?.email].filter((x): x is string => !!x), [profile?.username, profile?.email]);
    const canHaveHistory = !!contactId || authorKeys.length > 0;

    const [segment, setSegment] = useState<Segment>('open');
    // Quick filter chips (Overdue / Due today / In progress): one at a time,
    // click again to clear. Replaces the three big number tiles.
    type Quick = 'overdue' | 'today' | 'wip' | null;
    const [quick, setQuick] = useState<Quick>(null);
    const [doneMonthOnly, setDoneMonthOnly] = useState(false);
    const [rows, setRows] = useState<MyWO[]>([]);
    const [loading, setLoading] = useState(true);
    const [offlineCopy, setOfflineCopy] = useState<string | null>(null); // savedAt when serving cache
    const [error, setError] = useState<string | null>(null);
    // System journals per WO id — the status sentence source. Best-effort:
    // a card with no journal still renders, it just says less.
    const [journals, setJournals] = useState<Record<string, JournalLike[]>>({});

    const [done, setDone] = useState<DoneWO[] | null>(null); // null = not loaded yet
    const [doneLoading, setDoneLoading] = useState(false);
    const [doneError, setDoneError] = useState<string | null>(null);

    const loadJournals = useCallback(async (ids: string[]) => {
        if (ids.length === 0) return;
        try {
            const j = await DatabaseService.getInstance().getWoStatusJournals(ids);
            setJournals(prev => ({ ...prev, ...j }));
        } catch (e) {
            console.warn('[MyWork] status journals unavailable:', e);
        }
    }, []);

    const load = useCallback(async () => {
        if (!contactId && !userId) { setLoading(false); return; }
        try {
            const data = await DatabaseService.getInstance().getMyWorkOrders(contactId, userId);
            setRows(data);
            setOfflineCopy(null);
            setError(null);
            writeCache(contactId || userId, data);
            loadJournals(data.map(r => r.id));
        } catch (e) {
            const cached = readCache(contactId || userId);
            if (cached) {
                setRows(cached.rows);
                setOfflineCopy(cached.savedAt);
                setError(null);
            } else {
                setError('Could not load your work. Check your connection and pull to refresh.');
            }
            console.warn('[MyWork] load failed:', e);
        } finally {
            setLoading(false);
        }
    }, [contactId, userId, loadJournals]);

    const loadDone = useCallback(async () => {
        if (!canHaveHistory) return;
        setDoneLoading(true);
        try {
            const data = await DatabaseService.getInstance().getMyWorkHistory(contactId, userId, authorKeys);
            setDone(data);
            setDoneError(null);
            loadJournals(data.map(r => r.id));
        } catch (e) {
            setDoneError('Could not load your job history right now.');
            console.warn('[MyWork] history load failed:', e);
        } finally {
            setDoneLoading(false);
        }
    }, [contactId, userId, authorKeys, canHaveHistory, loadJournals]);

    useEffect(() => { load(); }, [load]);
    // History is fetched the first time the segment is opened, then refreshed
    // with the rest of the page.
    useEffect(() => { if (segment === 'done' && done === null && !doneLoading) loadDone(); }, [segment, done, doneLoading, loadDone]);

    // Assignments land while the tab is backgrounded — refresh silently
    // whenever the window regains focus (data fetched only on mount before).
    // 'ers-refresh' is the shell-level pull-to-refresh broadcast (AppLayout
    // owns the gesture now — this page's own wrapper is retired).
    useEffect(() => {
        const onFocus = () => { load(); if (done !== null) loadDone(); };
        window.addEventListener('focus', onFocus);
        window.addEventListener('ers-refresh', onFocus);
        return () => {
            window.removeEventListener('focus', onFocus);
            window.removeEventListener('ers-refresh', onFocus);
        };
    }, [load, loadDone, done]);

    const grouped = useMemo(() => {
        const g: Record<Bucket, MyWO[]> = { overdue: [], today: [], week: [], later: [] };
        rows.forEach(r => g[bucketOf(r.due_date)].push(r));
        (Object.keys(g) as Bucket[]).forEach(b =>
            g[b].sort((a, x) => rankOf(a.priority_code) - rankOf(x.priority_code)
                || new Date(a.due_date || '2999-01-01').getTime() - new Date(x.due_date || '2999-01-01').getTime()));
        return g;
    }, [rows]);

    const counts = useMemo(() => ({
        overdue: grouped.overdue.length,
        today: grouped.today.length,
        inProgress: rows.filter(r => r.status === 'WIP').length,
    }), [grouped, rows]);

    // What the list shows under the active chip.
    const shown = useMemo(() => {
        if (!quick) return grouped;
        const empty: Record<Bucket, MyWO[]> = { overdue: [], today: [], week: [], later: [] };
        if (quick === 'overdue') return { ...empty, overdue: grouped.overdue };
        if (quick === 'today') return { ...empty, today: grouped.today };
        return (Object.keys(grouped) as Bucket[]).reduce((acc, b) => { acc[b] = grouped[b].filter(r => r.status === 'WIP'); return acc; }, { ...empty });
    }, [grouped, quick]);
    const shownCount = (Object.keys(shown) as Bucket[]).reduce((n, b) => n + shown[b].length, 0);

    const Chip = ({ id, n, label, tone }: { id: Quick; n: number; label: string; tone: 'red' | 'amber' | 'blue' }) => {
        const active = quick === id;
        const tones = {
            red: active ? 'bg-red-600 text-white border-red-600' : n ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100' : 'bg-white text-slate-500 border-slate-200',
            amber: active ? 'bg-amber-500 text-white border-amber-500' : n ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' : 'bg-white text-slate-500 border-slate-200',
            blue: active ? 'bg-primary-600 text-white border-primary-600' : n ? 'bg-primary-50 text-primary-700 border-primary-200 hover:bg-primary-100' : 'bg-white text-slate-500 border-slate-200',
        };
        return (
            <button
                type="button"
                aria-pressed={active}
                onClick={() => setQuick(active ? null : id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${tones[tone]}`}
                title={active ? 'Show all' : `Show only ${label.toLowerCase()}`}
            >
                <span className="tabular-nums text-sm">{n}</span>
                <span className="uppercase tracking-wide text-[10px]">{label}</span>
            </button>
        );
    };

    // Finished work: dated at completion, newest first, by month.
    const doneDated = useMemo(() => (done || []).map(wo => ({ wo, at: completionDateOf(wo, journals[wo.id]) }))
        .sort((a, b) => Date.parse(b.at || '1970') - Date.parse(a.at || '1970')), [done, journals]);
    const doneGroups = useMemo(() => {
        const now = new Date();
        const rowsToGroup = doneMonthOnly
            ? doneDated.filter(d => d.at && new Date(d.at).getFullYear() === now.getFullYear() && new Date(d.at).getMonth() === now.getMonth())
            : doneDated;
        return groupByMonth(rowsToGroup, d => d.at);
    }, [doneDated, doneMonthOnly]);
    const doneStats = useMemo(() => {
        const now = new Date();
        const thisMonth = doneDated.filter(d => {
            if (!d.at || isVoidWo(d.wo.status)) return false;
            const t = new Date(d.at);
            return t.getFullYear() === now.getFullYear() && t.getMonth() === now.getMonth();
        });
        return {
            completedMonth: thisMonth.length,
            hoursMonth: thisMonth.reduce((s, d) => s + (d.wo.my_hours || 0), 0),
            completedAll: doneDated.filter(d => !isVoidWo(d.wo.status)).length,
        };
    }, [doneDated]);

    const openWO = (id: string) => navigate(`/work-orders/${id}`);

    const sentenceFor = (wo: MyWO) => statusSentence(
        { status: wo.status, createdAt: wo.created_at, closedAt: wo.closed_at, waitReason: (wo as any).wait_reason, actualStartAt: (wo as any).actual_start_at, actualFinishAt: (wo as any).actual_finish_at },
        journals[wo.id],
    );

    const Card = ({ wo }: { wo: MyWO }) => {
        const due = dueLabel(wo.due_date);
        return (
            <button
                onClick={() => openWO(wo.id)}
                className="w-full text-left bg-white border border-slate-200 rounded-card shadow-card hover:shadow-raised active:scale-[0.995] transition-all p-4 flex flex-col gap-2"
            >
                <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-xs text-slate-500 flex-shrink-0">{wo.wo_number}</span>
                    <span className="text-[10px] uppercase font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded flex-shrink-0">{wo.type}</span>
                    <span className="flex-1" />
                    <PriorityPill priority={wo.priority_code} />
                </div>
                <div className="font-semibold text-slate-800 leading-snug line-clamp-2">{wo.title}</div>
                <div className="flex items-center gap-3 text-sm min-w-0">
                    {wo.assets?.name && (
                        <span className="flex items-center gap-1 text-slate-500 truncate min-w-0">
                            <MapPin size={13} className="flex-shrink-0" /><span className="truncate">{wo.assets.name}</span>
                        </span>
                    )}
                    <span className={`flex-shrink-0 ${due.cls}`}>{due.text}</span>
                    <span className="flex-1" />
                    <StatusPill status={wo.status} />
                    <ChevronRight size={16} className="text-slate-300 flex-shrink-0" />
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-500 min-w-0">
                    <Clock size={12} className="flex-shrink-0 text-slate-400" />
                    <span className="truncate">{sentenceFor(wo)}</span>
                </div>
            </button>
        );
    };

    const DoneCard = ({ wo, at }: { wo: DoneWO; at?: string }) => {
        const cancelled = isVoidWo(wo.status);
        return (
            <button
                onClick={() => openWO(wo.id)}
                className="w-full text-left bg-white border border-slate-200 rounded-card shadow-card hover:shadow-raised active:scale-[0.995] transition-all p-4 flex flex-col gap-1.5"
            >
                <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-xs text-slate-500 flex-shrink-0">{wo.wo_number}</span>
                    <span className="text-[10px] uppercase font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded flex-shrink-0">{wo.type}</span>
                    {wo.via === 'labour' && (
                        <span className="text-[10px] font-semibold text-slate-500 border border-slate-200 px-1.5 py-0.5 rounded flex-shrink-0" title="You booked hours on this job without being the named assignee">
                            hours booked
                        </span>
                    )}
                    {wo.via === 'completed' && (
                        <span className="text-[10px] font-semibold text-slate-500 border border-slate-200 px-1.5 py-0.5 rounded flex-shrink-0" title="You completed this job without being the named assignee">
                            you completed
                        </span>
                    )}
                    <span className="flex-1" />
                    <StatusPill status={wo.status} />
                </div>
                <div className={`font-semibold leading-snug line-clamp-2 ${cancelled ? 'text-slate-500' : 'text-slate-800'}`}>{wo.title}</div>
                <div className="flex items-center gap-3 text-xs text-slate-500 min-w-0">
                    {wo.assets?.name && (
                        <span className="flex items-center gap-1 truncate min-w-0">
                            <MapPin size={12} className="flex-shrink-0" /><span className="truncate">{wo.assets.name}</span>
                        </span>
                    )}
                    <span className="flex-shrink-0">{statusLabel(wo.status)}{at ? ` ${formatWhen(at)}` : ''}</span>
                    {wo.my_hours > 0 && <span className="flex-shrink-0 tabular-nums">{fmtHours(wo.my_hours)} h</span>}
                    <span className="flex-1" />
                    <ChevronRight size={16} className="text-slate-300 flex-shrink-0" />
                </div>
            </button>
        );
    };

    const subtitle = segment === 'open'
        ? (rows.length === 0 && !loading ? 'Nothing assigned to you right now' : `${rows.length} open ${rows.length === 1 ? 'job' : 'jobs'} assigned to you`)
        : (done === null || doneLoading ? 'Your finished jobs' : `${doneStats.completedAll} finished ${doneStats.completedAll === 1 ? 'job' : 'jobs'} on record`);

    const noPerson = (
        <div className="bg-white border border-slate-200 rounded-card p-8 text-center flex flex-col items-center gap-3">
            <ClipboardList size={36} className="text-slate-400" />
            <div className="font-semibold text-slate-800">Your account isn't linked to a person record</div>
            <p className="text-sm text-slate-500 m-0">Work is assigned to people. Ask your administrator to link your login to a person in People &amp; Org, and your assignments will appear here.</p>
            <Button variant="secondary" size="sm" onClick={() => navigate('/work-orders')} leftIcon={<ClipboardList size={14} />}>
                Browse all work orders
            </Button>
        </div>
    );

    const content = (
        <div className="ers-page-narrow flex flex-col gap-5 pb-8">
            {/* ── Header ── */}
            <div className="flex items-center gap-3">
                <div>
                    <h1 className="text-xl md:text-2xl font-bold text-slate-800">My Work</h1>
                    <p className="text-sm text-slate-500">{subtitle}</p>
                </div>
                <span className="flex-1" />
                <Button variant="secondary" size="sm" onClick={() => { setLoading(true); load(); if (done !== null) loadDone(); }} leftIcon={<RefreshCw size={14} />} className="hidden md:inline-flex">
                    Refresh
                </Button>
            </div>

            {/* ── Open / Done ── */}
            <div className="flex bg-slate-100 p-0.5 rounded-lg self-start" role="tablist" aria-label="My work">
                <button
                    role="tab"
                    aria-selected={segment === 'open'}
                    onClick={() => setSegment('open')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${segment === 'open' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    <ClipboardList size={13} /> Open{rows.length > 0 && <span className="tabular-nums text-slate-400">{rows.length}</span>}
                </button>
                <button
                    role="tab"
                    aria-selected={segment === 'done'}
                    onClick={() => setSegment('done')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${segment === 'done' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    <History size={13} /> Done{done && done.length > 0 && <span className="tabular-nums text-slate-400">{done.length}</span>}
                </button>
            </div>

            {segment === 'open' && (
                <>
                    {/* ── Offline notice ── */}
                    {offlineCopy && (
                        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-3 py-2">
                            <WifiOff size={15} className="flex-shrink-0" />
                            Showing your last synced list ({new Date(offlineCopy).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}). Pull to refresh when back online.
                        </div>
                    )}

                    {/* ── Quick filters ── */}
                    {rows.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2">
                            <Chip id="overdue" n={counts.overdue} label="Overdue" tone="red" />
                            <Chip id="today" n={counts.today} label="Due today" tone="amber" />
                            <Chip id="wip" n={counts.inProgress} label="In progress" tone="blue" />
                            {quick && <button type="button" onClick={() => setQuick(null)} className="text-xs text-slate-500 hover:text-slate-800 underline underline-offset-2">Show all</button>}
                        </div>
                    )}
                    {!loading && !error && rows.length > 0 && quick && shownCount === 0 && (
                        <div className="bg-white border border-slate-200 rounded-card p-6 text-center text-sm text-slate-500">
                            {quick === 'overdue' ? 'Nothing overdue.' : quick === 'today' ? 'Nothing due today.' : 'Nothing in progress.'}
                        </div>
                    )}

                    {/* ── Loading / error / empty ── */}
                    {loading && (
                        <div className="flex flex-col gap-3">
                            {[0, 1, 2].map(i => <div key={i} className="h-24 bg-slate-100 rounded-card animate-pulse" />)}
                        </div>
                    )}
                    {!loading && error && (
                        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-card p-4">{error}</div>
                    )}
                    {!loading && !error && rows.length === 0 && !contactId && !userId && noPerson}
                    {!loading && !error && rows.length === 0 && (contactId || userId) && (
                        <div className="bg-white border border-slate-200 rounded-card p-8 text-center flex flex-col items-center gap-3">
                            <CheckCircle2 size={36} className="text-emerald-500" />
                            <div className="font-semibold text-slate-800">You're all caught up</div>
                            <p className="text-sm text-slate-500 m-0">No open work is assigned to you. New assignments will appear here.</p>
                            <div className="flex gap-2">
                                <Button variant="secondary" size="sm" onClick={() => setSegment('done')} leftIcon={<History size={14} />}>
                                    See what you've finished
                                </Button>
                                <Button variant="secondary" size="sm" onClick={() => navigate('/work-orders')} leftIcon={<ClipboardList size={14} />}>
                                    Browse all work orders
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* ── Buckets ── */}
                    {(Object.keys(BUCKET_META) as Bucket[]).map(b => shown[b].length > 0 && (
                        <div key={b} className="flex flex-col gap-2">
                            <div className="flex items-baseline gap-2 mt-1">
                                <h2 className={`text-[12px] uppercase font-bold tracking-wider ${BUCKET_META[b].accent}`}>{BUCKET_META[b].label}</h2>
                                <span className="text-[12px] text-slate-400 tabular-nums">{shown[b].length}</span>
                            </div>
                            {shown[b].map(wo => <Card key={wo.id} wo={wo} />)}
                        </div>
                    ))}
                </>
            )}

            {segment === 'done' && (
                <>
                    {!canHaveHistory && noPerson}

                    {done !== null && done.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                            <button type="button" aria-pressed={doneMonthOnly} onClick={() => setDoneMonthOnly(v => !v)} title={doneMonthOnly ? 'Show all months' : 'Show this month only'} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-semibold transition-colors ${doneMonthOnly ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'}`}><span className="tabular-nums text-sm">{doneStats.completedMonth}</span><span className="uppercase tracking-wide text-[10px]">Done this month</span></button>
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-700"><span className="tabular-nums text-sm">{fmtHours(doneStats.hoursMonth)} h</span><span className="uppercase tracking-wide text-[10px] text-slate-500">this month</span></span>
                            <button type="button" onClick={() => setSegment('open')} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-700 hover:bg-slate-50" title="Back to open work"><span className="tabular-nums text-sm">{rows.length}</span><span className="uppercase tracking-wide text-[10px] text-slate-500">Open now</span></button>
                        </div>
                    )}

                    {canHaveHistory && (doneLoading || done === null) && !doneError && (
                        <div className="flex flex-col gap-3">
                            {[0, 1, 2].map(i => <div key={i} className="h-20 bg-slate-100 rounded-card animate-pulse" />)}
                        </div>
                    )}
                    {doneError && (
                        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-card p-4">{doneError}</div>
                    )}
                    {!doneLoading && !doneError && done !== null && done.length === 0 && (
                        <div className="bg-white border border-slate-200 rounded-card p-8 text-center flex flex-col items-center gap-3">
                            <History size={36} className="text-slate-400" />
                            <div className="font-semibold text-slate-800">No finished jobs yet</div>
                            <p className="text-sm text-slate-500 m-0">Jobs assigned to you, jobs you complete, and jobs you book hours on will build your history here.</p>
                        </div>
                    )}

                    {!doneLoading && done !== null && doneGroups.map(g => (
                        <div key={g.key} className="flex flex-col gap-2">
                            <div className="flex items-baseline gap-2 mt-1">
                                <h2 className="text-[12px] uppercase font-bold tracking-wider text-slate-700">{g.label}</h2>
                                <span className="text-[12px] text-slate-400 tabular-nums">{g.rows.length}</span>
                            </div>
                            {g.rows.map(d => <DoneCard key={d.wo.id} wo={d.wo} at={d.at} />)}
                        </div>
                    ))}
                </>
            )}
        </div>
    );

    return content;
};
