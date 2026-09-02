/**
 * My Work — the technician's home.
 *
 * One purpose: my assigned work, today, in priority order, one tap to execute.
 * Card-first (mobile), grouped by urgency (Overdue / Today / This Week / Later),
 * with a last-synced offline copy so the list still opens in a dead zone.
 * Technician roles land here by default (see RoleLanding in App.tsx).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ClipboardList, ChevronRight, MapPin, RefreshCw, WifiOff, CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { DatabaseService } from '../services/DatabaseService';
import { WorkOrderRecord } from '../schema';
import { StatusPill, PriorityPill, Button } from '../components/ui';

type MyWO = WorkOrderRecord & { assets?: { name?: string } | null };

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

export const MyWork: React.FC = () => {
    const { profile } = useAuth();
    const navigate = useNavigate();
    const contactId = profile?.contactId || '';

    const [rows, setRows] = useState<MyWO[]>([]);
    const [loading, setLoading] = useState(true);
    const [offlineCopy, setOfflineCopy] = useState<string | null>(null); // savedAt when serving cache
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!contactId) { setLoading(false); return; }
        try {
            const data = await DatabaseService.getInstance().getMyWorkOrders(contactId);
            setRows(data);
            setOfflineCopy(null);
            setError(null);
            writeCache(contactId, data);
        } catch (e) {
            const cached = readCache(contactId);
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
    }, [contactId]);

    useEffect(() => { load(); }, [load]);

    // Assignments land while the tab is backgrounded — refresh silently
    // whenever the window regains focus (data fetched only on mount before).
    // 'ers-refresh' is the shell-level pull-to-refresh broadcast (AppLayout
    // owns the gesture now — this page's own wrapper is retired).
    useEffect(() => {
        const onFocus = () => load();
        window.addEventListener('focus', onFocus);
        window.addEventListener('ers-refresh', onFocus);
        return () => {
            window.removeEventListener('focus', onFocus);
            window.removeEventListener('ers-refresh', onFocus);
        };
    }, [load]);

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

    const openWO = (id: string) => navigate(`/work-orders/${id}`);

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
            </button>
        );
    };

    const content = (
        <div className="ers-page-narrow flex flex-col gap-5 pb-8">
            {/* ── Header ── */}
            <div className="flex items-center gap-3">
                <div>
                    <h1 className="text-xl md:text-2xl font-bold text-slate-800">My Work</h1>
                    <p className="text-sm text-slate-500">
                        {rows.length === 0 && !loading ? 'Nothing assigned to you right now'
                            : `${rows.length} open ${rows.length === 1 ? 'job' : 'jobs'} assigned to you`}
                    </p>
                </div>
                <span className="flex-1" />
                <Button variant="secondary" size="sm" onClick={() => { setLoading(true); load(); }} leftIcon={<RefreshCw size={14} />} className="hidden md:inline-flex">
                    Refresh
                </Button>
            </div>

            {/* ── Offline notice ── */}
            {offlineCopy && (
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-3 py-2">
                    <WifiOff size={15} className="flex-shrink-0" />
                    Showing your last synced list ({new Date(offlineCopy).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}). Pull to refresh when back online.
                </div>
            )}

            {/* ── Summary strip ── */}
            {rows.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                    <div className={`rounded-card border p-3 text-center ${counts.overdue ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'}`}>
                        <div className={`text-2xl font-bold tabular-nums ${counts.overdue ? 'text-red-600' : 'text-slate-800'}`}>{counts.overdue}</div>
                        <div className="text-[11px] uppercase font-semibold tracking-wide text-slate-500">Overdue</div>
                    </div>
                    <div className="rounded-card border border-slate-200 bg-white p-3 text-center">
                        <div className="text-2xl font-bold tabular-nums text-slate-800">{counts.today}</div>
                        <div className="text-[11px] uppercase font-semibold tracking-wide text-slate-500">Due today</div>
                    </div>
                    <div className="rounded-card border border-slate-200 bg-white p-3 text-center">
                        <div className="text-2xl font-bold tabular-nums text-slate-800">{counts.inProgress}</div>
                        <div className="text-[11px] uppercase font-semibold tracking-wide text-slate-500">In progress</div>
                    </div>
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
            {!loading && !error && rows.length === 0 && !contactId && (
                <div className="bg-white border border-slate-200 rounded-card p-8 text-center flex flex-col items-center gap-3">
                    <ClipboardList size={36} className="text-slate-400" />
                    <div className="font-semibold text-slate-800">Your account isn't linked to a person record</div>
                    <p className="text-sm text-slate-500 m-0">Work is assigned to people. Ask your administrator to link your login to a person in People &amp; Org, and your assignments will appear here.</p>
                    <Button variant="secondary" size="sm" onClick={() => navigate('/work-orders')} leftIcon={<ClipboardList size={14} />}>
                        Browse all work orders
                    </Button>
                </div>
            )}
            {!loading && !error && rows.length === 0 && contactId && (
                <div className="bg-white border border-slate-200 rounded-card p-8 text-center flex flex-col items-center gap-3">
                    <CheckCircle2 size={36} className="text-emerald-500" />
                    <div className="font-semibold text-slate-800">You're all caught up</div>
                    <p className="text-sm text-slate-500 m-0">No open work is assigned to you. New assignments will appear here.</p>
                    <Button variant="secondary" size="sm" onClick={() => navigate('/work-orders')} leftIcon={<ClipboardList size={14} />}>
                        Browse all work orders
                    </Button>
                </div>
            )}

            {/* ── Buckets ── */}
            {(Object.keys(BUCKET_META) as Bucket[]).map(b => grouped[b].length > 0 && (
                <div key={b} className="flex flex-col gap-2">
                    <div className="flex items-baseline gap-2 mt-1">
                        <h2 className={`text-[12px] uppercase font-bold tracking-wider ${BUCKET_META[b].accent}`}>{BUCKET_META[b].label}</h2>
                        <span className="text-[12px] text-slate-400 tabular-nums">{grouped[b].length}</span>
                    </div>
                    {grouped[b].map(wo => <Card key={wo.id} wo={wo} />)}
                </div>
            ))}
        </div>
    );

    return content;
};
