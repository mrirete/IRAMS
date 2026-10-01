import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    Plus, Search, X, SlidersHorizontal, LayoutGrid, List as ListIcon, ChevronDown, ChevronRight,
    UserCheck, Clock, Siren, AlertOctagon, Copy, UserPen, Inbox,
} from 'lucide-react';
import { RequestStatus, type Asset, type ServiceRequest } from '../types';
import { DatabaseService } from '../services/DatabaseService';
import { DataMapper } from '../services/DataMapper';
import { NotificationService } from '../services/NotificationService';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { AskRelanternButton } from '../components/AskRelanternButton';
import { ReportRequestForm } from '../components/ReportRequestForm';
import { DataList, Modal, PriorityPill, EmptyState, SkeletonRows, cn, type DataColumn } from '../components/ui';
import { RequestCard, DueLabel, OutcomeLabel } from '../components/requests/RequestCard';
import { RequestDetailDrawer, type RequestEdits } from '../components/requests/RequestDetailDrawer';
import { RequestFiltersModal, type ClosedWindow } from '../components/requests/RequestFiltersModal';
import { RPN_FOR_PRIORITY } from '../lib/requestPriority';
import {
    EMPTY_FILTERS, STATUS_LABEL, activeFilterCount, ageLabel, duplicateCounts, isClosed, matchesChip,
    matchesFilters, plantOf, sortRequests,
    type FilterContext, type QuickChip, type RaisedWithin, type RequestFilters, type SortKey,
} from '../lib/requestBoard';

type View = 'board' | 'list';

const COLUMNS: { key: string; title: string; statuses: RequestStatus[]; tone: string; closed?: boolean }[] = [
    { key: 'NEW', title: 'New', statuses: [RequestStatus.NEW], tone: 'bg-slate-100' },
    { key: 'REVIEW', title: 'Under review', statuses: [RequestStatus.REVIEW], tone: 'bg-blue-50' },
    { key: 'AUTHORIZED', title: 'Authorized', statuses: [RequestStatus.AUTHORIZED], tone: 'bg-blue-50' },
    { key: 'CLOSED', title: 'Closed', statuses: [RequestStatus.APPROVED, RequestStatus.CONVERTED, RequestStatus.REJECTED], tone: 'bg-slate-50', closed: true },
];

const CHIPS: { key: QuickChip; label: string; icon: React.ReactNode; tone: string }[] = [
    { key: 'MINE', label: 'Needs my action', icon: <UserCheck size={13} />, tone: 'primary' },
    { key: 'OVERDUE', label: 'Overdue', icon: <Clock size={13} />, tone: 'red' },
    { key: 'EMERGENCY', label: 'Emergency', icon: <Siren size={13} />, tone: 'red' },
    { key: 'BREAKDOWN', label: 'Equipment stopped', icon: <AlertOctagon size={13} />, tone: 'red' },
    { key: 'DUPES', label: 'Possible duplicates', icon: <Copy size={13} />, tone: 'amber' },
    { key: 'RAISED_BY_ME', label: 'Raised by me', icon: <UserPen size={13} />, tone: 'slate' },
];

const SORT_LABEL: Record<SortKey, string> = { date: 'Newest', priority: 'Priority', sla: 'Time left', type: 'Equipment type' };
const PAGE = 20;
const LIST_PAGE = 100;
const VIEW_KEY = 'ireams.requests.view';
const REFRESH_MS = 60_000;

const readView = (): View => {
    try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'board'; } catch { return 'board'; }
};
const csv = (v: string | null) => (v ? v.split(',').filter(Boolean) : []);

export const ServiceRequests: React.FC = () => {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const { user, profile, permissions } = useAuth();
    const { showToast } = useToast();
    const perms = permissions?.requests;
    const canEdit = perms?.edit === true;

    const [records, setRecords] = useState<ServiceRequest[]>([]);
    const [pinned, setPinned] = useState<ServiceRequest[]>([]); // deep-linked requests outside the closed window
    const [assets, setAssets] = useState<Asset[]>([]);
    const [dictionaries, setDictionaries] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [filtersOpen, setFiltersOpen] = useState(false);

    // Search / filter / sort / view — seeded from the URL so a view can be shared.
    const [filters, setFilters] = useState<RequestFilters>(() => ({
        q: searchParams.get('q') || '',
        chip: (searchParams.get('chip') as QuickChip) || null,
        priorities: csv(searchParams.get('pri')),
        statuses: csv(searchParams.get('st')) as RequestStatus[],
        plant: searchParams.get('plant') || 'ALL',
        type: searchParams.get('type') || 'ALL',
        requester: searchParams.get('by') || 'ALL',
        raised: (searchParams.get('raised') as RaisedWithin) || 'ANY',
    }));
    const [sortBy, setSortBy] = useState<SortKey>(() => (searchParams.get('sort') as SortKey) || 'date');
    const [view, setView] = useState<View>(() => (searchParams.get('view') as View) || readView());
    const [closedWindow, setClosedWindow] = useState<ClosedWindow>(() => {
        const c = searchParams.get('closed');
        return c === 'all' ? null : c === '7' ? 7 : c === '90' ? 90 : 30;
    });

    // Drawer: the open request, and the queue it steps through (frozen when the
    // drawer opens, so a request that leaves the filter after Review does not
    // knock the reviewer out of their run).
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [queue, setQueue] = useState<string[]>([]);

    // List-view bulk selection.
    const [checked, setChecked] = useState<Set<string>>(new Set());
    const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
    const [bulkReason, setBulkReason] = useState('');
    const [bulkBusy, setBulkBusy] = useState(false);
    const [listLimit, setListLimit] = useState(LIST_PAGE);

    // ── Data ────────────────────────────────────────────────────────────────
    const lookups = useRef<{ assets: Asset[]; users: any[] }>({ assets: [], users: [] });
    const toUI = useCallback((rec: any) => DataMapper.toUIRequest(rec, lookups.current.assets, lookups.current.users), []);

    const loadRequests = useCallback(async () => {
        const recs = await DatabaseService.getInstance().getRequestBoard(closedWindow);
        setRecords(recs.map(toUI));
    }, [closedWindow, toUI]);

    // Assets / users / dictionaries once; requests on every refresh.
    useEffect(() => {
        let alive = true;
        (async () => {
            const db = DatabaseService.getInstance();
            try {
                const [a, u, d] = await Promise.all([db.getAssets(), db.getUsers(), db.getDictionaries()]);
                if (!alive) return;
                lookups.current = { assets: a, users: u };
                setAssets(a); setDictionaries(d);
                await loadRequests();
            } catch (e: any) {
                showToast('Could not load requests: ' + (e?.message || e), 'error');
            } finally {
                if (alive) setLoading(false);
            }
        })();
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // The closed window is a fetch, not a filter.
    const firstWindow = useRef(true);
    useEffect(() => {
        if (firstWindow.current) { firstWindow.current = false; return; }
        loadRequests().catch(e => showToast('Could not load requests: ' + e.message, 'error'));
    }, [closedWindow]); // eslint-disable-line react-hooks/exhaustive-deps

    // Keep two triagers in step: refresh every minute while visible, and on return to the tab.
    useEffect(() => {
        let last = Date.now();
        const tick = () => {
            if (document.visibilityState !== 'visible' || Date.now() - last < 10_000) return;
            last = Date.now();
            loadRequests().catch(() => { /* next tick retries */ });
        };
        const id = window.setInterval(tick, REFRESH_MS);
        document.addEventListener('visibilitychange', tick);
        window.addEventListener('focus', tick);
        return () => {
            window.clearInterval(id);
            document.removeEventListener('visibilitychange', tick);
            window.removeEventListener('focus', tick);
        };
    }, [loadRequests]);

    const requests = useMemo(() => {
        if (!pinned.length) return records;
        const have = new Set(records.map(r => r.id));
        return [...records, ...pinned.filter(p => !have.has(p.id))];
    }, [records, pinned]);

    // ── Lookups for filtering ───────────────────────────────────────────────
    const typeLabels = useMemo(() => {
        const m = new Map<string, string>();
        for (const t of ['ASSET_CLASS', 'ASSET_TYPE', 'ASSET_CATEGORY']) {
            for (const d of dictionaries) {
                if (d.type === t && d.active !== false && !m.has(d.code)) m.set(d.code, d.description || d.code);
            }
        }
        return m;
    }, [dictionaries]);

    const assetMeta = useMemo(() => {
        const map = new Map<string, { equipmentType: string; classCode?: string }>();
        for (const a of assets) {
            const code = a.assetClass || a.assetType || a.category || '';
            map.set(a.id, { equipmentType: (code && (typeLabels.get(code) || code)) || 'Uncategorized', classCode: a.assetClass });
        }
        return map;
    }, [assets, typeLabels]);

    const typeOf = useCallback(
        (r: ServiceRequest) => (r.assetId && assetMeta.get(r.assetId)?.equipmentType) || 'Uncategorized',
        [assetMeta],
    );

    const myIds = useMemo(
        () => [user?.id, profile?.id, profile?.contactId].filter(Boolean) as string[],
        [user?.id, profile?.id, profile?.contactId],
    );
    const dupes = useMemo(() => duplicateCounts(requests), [requests]);
    const ctx: FilterContext = useMemo(() => ({ perms, userIds: myIds, dupes, typeOf }), [perms, myIds, dupes, typeOf]);

    const facets = useMemo(() => {
        const plants = new Set<string>(), types = new Set<string>(), people = new Map<string, string>();
        for (const r of requests) {
            plants.add(plantOf(r)); types.add(typeOf(r));
            if (r.requesterId) people.set(r.requesterId, r.requesterName);
        }
        return {
            plants: [...plants].sort(),
            types: [...types].sort(),
            requesters: [...people].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
        };
    }, [requests, typeOf]);

    const filtered = useMemo(() => requests.filter(r => matchesFilters(r, filters, ctx)), [requests, filters, ctx]);
    const chipCounts = useMemo(() => {
        const c = {} as Record<QuickChip, number>;
        for (const chip of CHIPS) c[chip.key] = filtered.filter(r => matchesChip(r, chip.key, ctx)).length;
        return c;
    }, [filtered, ctx]);
    const visible = useMemo(() => {
        const list = filters.chip ? filtered.filter(r => matchesChip(r, filters.chip!, ctx)) : filtered;
        return sortRequests(list, sortBy, typeOf);
    }, [filtered, filters.chip, ctx, sortBy, typeOf]);

    const nFilters = activeFilterCount(filters);
    const anyNarrowing = nFilters > 0 || !!filters.chip || filters.q.trim() !== '';
    const clearAll = () => setFilters(EMPTY_FILTERS);

    // ── URL sync ────────────────────────────────────────────────────────────
    useEffect(() => {
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            const put = (k: string, v: string, def = '') => (v && v !== def ? next.set(k, v) : next.delete(k));
            put('q', filters.q.trim());
            put('chip', filters.chip || '');
            put('pri', filters.priorities.join(','));
            put('st', filters.statuses.join(','));
            put('plant', filters.plant, 'ALL');
            put('type', filters.type, 'ALL');
            put('by', filters.requester, 'ALL');
            put('raised', filters.raised, 'ANY');
            put('sort', sortBy, 'date');
            put('view', view, 'board');
            put('closed', closedWindow == null ? 'all' : String(closedWindow), '30');
            return next;
        }, { replace: true });
    }, [filters, sortBy, view, closedWindow, setSearchParams]);

    useEffect(() => { try { localStorage.setItem(VIEW_KEY, view); } catch { /* private window */ } }, [view]);
    useEffect(() => { setListLimit(LIST_PAGE); setChecked(new Set()); }, [filters, sortBy, view]);

    // ?action=create (Dashboard quick action)
    useEffect(() => {
        if (searchParams.get('action') !== 'create') return;
        setIsCreating(true);
        setSearchParams(prev => { const n = new URLSearchParams(prev); n.delete('action'); return n; }, { replace: true });
    }, [searchParams, setSearchParams]);

    // ── Board order + drawer queue ──────────────────────────────────────────
    const columns = useMemo(
        () => COLUMNS.map(c => ({ ...c, items: visible.filter(r => c.statuses.includes(r.status)) })),
        [visible],
    );
    const displayOrder = useCallback(
        () => (view === 'board' ? columns.flatMap(c => c.items) : visible).map(r => r.id),
        [view, columns, visible],
    );

    const openRequest = useCallback((r: ServiceRequest) => {
        setQueue(displayOrder());
        setSelectedId(r.id);
    }, [displayOrder]);

    // Deep link from a notification: /requests?id=<request_id>. A closed request
    // older than the window is fetched on its own and pinned.
    useEffect(() => {
        const target = searchParams.get('id');
        if (!target || loading) return;
        setSearchParams(prev => { const n = new URLSearchParams(prev); n.delete('id'); return n; }, { replace: true });
        const hit = requests.find(r => r.id === target);
        if (hit) { openRequest(hit); return; }
        DatabaseService.getInstance().getRequest(target).then(rec => {
            if (!rec) { showToast('That request no longer exists or is not visible to you.', 'warning'); return; }
            const ui = toUI(rec);
            setPinned(p => [...p.filter(x => x.id !== ui.id), ui]);
            setQueue([ui.id]);
            setSelectedId(ui.id);
        }).catch(e => showToast('Could not open the request: ' + e.message, 'error'));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams, loading]);

    const selected = useMemo(() => requests.find(r => r.id === selectedId) || null, [requests, selectedId]);
    useEffect(() => { if (selectedId && !loading && !selected) setSelectedId(null); }, [selected, selectedId, loading]);

    const liveQueue = useMemo(() => {
        const have = new Set(requests.map(r => r.id));
        return queue.filter(id => have.has(id));
    }, [queue, requests]);
    const position = selectedId && liveQueue.includes(selectedId)
        ? { index: liveQueue.indexOf(selectedId), total: liveQueue.length }
        : null;
    const step = (delta: 1 | -1) => {
        if (!position) return;
        const next = liveQueue[position.index + delta];
        if (next) setSelectedId(next);
    };

    // ── Writes ──────────────────────────────────────────────────────────────
    const actor = user?.id || 'unknown';

    /** Move one request on, then tell the requester. Returns the WO number on conversion. */
    const transition = async (id: string, to: RequestStatus, extra: Record<string, unknown> = {}): Promise<string | undefined> => {
        const db = DatabaseService.getInstance();
        let woNumber: string | undefined;
        if (to === RequestStatus.CONVERTED) {
            const wo = await db.approveRequestAndConvert(id, actor);
            woNumber = wo?.wo_number;
        } else {
            await db.updateRequest(id, { status: to, ...extra } as any, actor);
        }
        try {
            const fresh = await db.getRequest(id);
            if (fresh) {
                const ui = toUI(fresh);
                await NotificationService.checkRules('requests', 'SR_STATUS_CHANGE', ui, { currentUserId: user?.id });
                // No rule covers Review / Authorize — the requester heard nothing
                // between raising and conversion. Tell them directly.
                if (ui.requesterId && ui.requesterId !== user?.id && (to === RequestStatus.REVIEW || to === RequestStatus.AUTHORIZED)) {
                    const num = ui.requestNumber || 'Your request';
                    NotificationService.notify({
                        recipientId: ui.requesterId,
                        title: to === RequestStatus.REVIEW ? `${num} is being reviewed` : `${num} has been authorized`,
                        message: to === RequestStatus.REVIEW
                            ? 'A supervisor has picked up your request and is reviewing it.'
                            : 'Your request was authorized and is with planning to become a work order.',
                        severity: 'INFO',
                        notificationType: 'STATUS_CHANGE',
                        module: 'requests',
                        entityId: id,
                        entityType: 'WORK_REQUEST',
                        entityNumber: num,
                        actionLink: `/requests?id=${id}`,
                        actionRequired: false,
                        createdBy: user?.id || 'SYSTEM',
                    }).catch(console.error);
                }
            }
        } catch (e) {
            console.error('Request moved; notifying the requester failed:', e);
        }
        return woNumber;
    };

    const onTransition = async (id: string, to: RequestStatus, extra?: Record<string, unknown>) => {
        const wo = await transition(id, to, extra);
        await loadRequests();
        return wo;
    };

    const onSave = async (r: ServiceRequest, edits: RequestEdits) => {
        await DatabaseService.getInstance().updateRequest(r.id, {
            description: edits.description.trim(),
            is_breakdown: edits.isBreakdown,
            functional_failure_id: (edits.functionalFailureType || null) as any,
            ...(edits.priority !== r.priority ? { risk_score: RPN_FOR_PRIORITY[edits.priority] } : {}),
        }, actor);
        await loadRequests();
    };

    const onDelete = async (id: string) => {
        await DatabaseService.getInstance().deleteRequest(id);
        setSelectedId(null);
        await loadRequests();
        showToast('Request deleted.', 'success');
    };

    const openWO = (woId: string) => navigate(`/work-orders/${woId}`);
    const showDuplicates = (r: ServiceRequest) => {
        setSelectedId(null);
        setFilters({ ...EMPTY_FILTERS, q: r.assetName || '', statuses: [RequestStatus.NEW, RequestStatus.REVIEW, RequestStatus.AUTHORIZED] });
    };

    // Bulk (list view)
    const checkedRows = visible.filter(r => checked.has(r.id));
    const bulkReviewable = canEdit ? checkedRows.filter(r => r.status === RequestStatus.NEW) : [];
    const bulkRejectable = canEdit ? checkedRows.filter(r => r.status === RequestStatus.REVIEW || r.status === RequestStatus.AUTHORIZED) : [];

    const runBulk = async (rows: ServiceRequest[], to: RequestStatus, extra?: Record<string, unknown>) => {
        setBulkBusy(true);
        let ok = 0;
        const failed: string[] = [];
        for (const r of rows) {
            try { await transition(r.id, to, extra); ok++; } catch { failed.push(r.requestNumber); }
        }
        await loadRequests().catch(() => { /* shown on next tick */ });
        setChecked(new Set());
        setBulkBusy(false);
        const verb = to === RequestStatus.REVIEW ? 'moved to review' : 'rejected';
        if (failed.length) showToast(`${ok} ${verb}; failed: ${failed.join(', ')}`, 'warning');
        else showToast(`${ok} request${ok === 1 ? '' : 's'} ${verb}.`, 'success');
    };

    // ── Render ──────────────────────────────────────────────────────────────
    const openCount = requests.filter(r => !isClosed(r) && r.status !== RequestStatus.APPROVED).length;
    const statusCount = (s: RequestStatus) => requests.filter(r => r.status === s).length;
    // Header totals are the whole queue, not the filtered view.
    const all = (chip: QuickChip) => requests.filter(r => matchesChip(r, chip, ctx)).length;
    const overdueAll = all('OVERDUE');
    const hasPerms = !!(perms?.edit || perms?.authorize || perms?.approve);
    const chips = CHIPS.filter(c => c.key !== 'MINE' || hasPerms);

    const filterPills: { label: string; clear: () => void }[] = [];
    if (filters.priorities.length) filterPills.push({ label: `Priority: ${filters.priorities.map(p => p.charAt(0) + p.slice(1).toLowerCase()).join(', ')}`, clear: () => setFilters({ ...filters, priorities: [] }) });
    if (filters.statuses.length) filterPills.push({ label: `Status: ${filters.statuses.map(s => STATUS_LABEL[s]).join(', ')}`, clear: () => setFilters({ ...filters, statuses: [] }) });
    if (filters.plant !== 'ALL') filterPills.push({ label: `Plant: ${filters.plant}`, clear: () => setFilters({ ...filters, plant: 'ALL' }) });
    if (filters.type !== 'ALL') filterPills.push({ label: `Type: ${filters.type}`, clear: () => setFilters({ ...filters, type: 'ALL' }) });
    if (filters.requester !== 'ALL') filterPills.push({ label: `Raised by: ${facets.requesters.find(p => p.id === filters.requester)?.name || 'someone'}`, clear: () => setFilters({ ...filters, requester: 'ALL' }) });
    if (filters.raised !== 'ANY') filterPills.push({ label: `Raised within ${{ '24H': '24 h', '7D': '7 days', '30D': '30 days' }[filters.raised]}`, clear: () => setFilters({ ...filters, raised: 'ANY' }) });

    const closedTitle = `Closed · ${closedWindow == null ? 'all' : `last ${closedWindow} days`}`;

    return (
        <div className="flex flex-col h-[calc(100vh-6rem)] min-h-0">
            {/* Header */}
            <div className="mb-3 flex flex-wrap justify-between items-center gap-3">
                <div className="hidden sm:block">
                    <h1 className="text-lg md:text-2xl font-bold text-slate-900">Maintenance Requests</h1>
                    <p className="text-xs sm:text-sm text-slate-500">
                        {loading ? 'Triage and convert issues to work orders.' : `${openCount} open · ${overdueAll} overdue`}
                    </p>
                </div>
                <div className="flex items-center gap-2 ml-auto">
                    <AskRelanternButton
                        contextType="serviceRequest"
                        contextSummary={`Maintenance request triage: ${openCount} open (${statusCount(RequestStatus.NEW)} new, ${statusCount(RequestStatus.REVIEW)} under review, ${statusCount(RequestStatus.AUTHORIZED)} authorized), ${overdueAll} overdue, ${all('EMERGENCY')} emergency, ${all('DUPES')} possible duplicates. Ask about triage prioritization, duplicates, or converting requests to work orders.`}
                        compact
                    />
                    <button
                        onClick={() => setIsCreating(true)}
                        className="bg-primary-600 hover:bg-primary-500 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 shadow-sm"
                    >
                        <Plus size={18} /> New Request
                    </button>
                </div>
            </div>

            {/* Toolbar: search · filters · sort · view */}
            <div className="flex flex-wrap items-center gap-2 mb-2">
                <div className="relative flex-1 min-w-[220px]">
                    <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                    <input
                        type="text"
                        value={filters.q}
                        onChange={e => setFilters({ ...filters, q: e.target.value })}
                        placeholder="Search #, asset, plant, person or WO…"
                        className="w-full pl-9 pr-8 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-1 focus:ring-primary-500 focus:outline-none"
                    />
                    {filters.q && (
                        <button onClick={() => setFilters({ ...filters, q: '' })} className="absolute right-2 top-2 text-slate-400 hover:text-slate-600" aria-label="Clear search">
                            <X size={16} />
                        </button>
                    )}
                </div>
                <button
                    onClick={() => setFiltersOpen(true)}
                    className={cn(
                        'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm bg-white',
                        nFilters ? 'border-primary-400 text-primary-700 font-medium' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                    )}
                >
                    <SlidersHorizontal size={15} /> Filters{nFilters ? ` (${nFilters})` : ''}
                </button>
                <div className="relative">
                    <select
                        value={sortBy}
                        onChange={e => setSortBy(e.target.value as SortKey)}
                        className="appearance-none pl-3 pr-8 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-600 focus:ring-1 focus:ring-primary-500 focus:outline-none"
                        aria-label="Sort"
                    >
                        {(Object.keys(SORT_LABEL) as SortKey[]).map(k => <option key={k} value={k}>Sort: {SORT_LABEL[k]}</option>)}
                    </select>
                    <ChevronDown size={14} className="absolute right-2.5 top-3 text-slate-400 pointer-events-none" />
                </div>
                <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5" role="group" aria-label="View">
                    {([['board', LayoutGrid, 'Board'], ['list', ListIcon, 'List']] as const).map(([v, Icon, label]) => (
                        <button
                            key={v}
                            onClick={() => setView(v)}
                            aria-pressed={view === v}
                            title={`${label} view`}
                            className={cn('px-2.5 py-1.5 rounded-md text-sm inline-flex items-center gap-1.5', view === v ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100')}
                        >
                            <Icon size={15} /> <span className="hidden md:inline">{label}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Quick chips — one tap to the slice that matters */}
            <div className="flex items-center gap-2 mb-2 overflow-x-auto pb-1 -mx-1 px-1">
                {chips.map(c => {
                    const on = filters.chip === c.key;
                    const n = chipCounts[c.key] ?? 0;
                    const hot = n > 0 && (c.tone === 'red' || c.tone === 'amber');
                    return (
                        <button
                            key={c.key}
                            onClick={() => setFilters({ ...filters, chip: on ? null : c.key })}
                            aria-pressed={on}
                            className={cn(
                                'flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition whitespace-nowrap',
                                on ? 'bg-slate-800 border-slate-800 text-white'
                                    : n === 0 ? 'bg-white border-slate-200 text-slate-400'
                                        : hot ? (c.tone === 'red' ? 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100' : 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100')
                                            : c.tone === 'primary' ? 'bg-primary-50 border-primary-200 text-primary-700 hover:bg-primary-100'
                                                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                            )}
                        >
                            {c.icon} {c.label}
                            <span className={cn('tabular-nums font-bold', on ? 'text-white' : '')}>{n}</span>
                        </button>
                    );
                })}
            </div>

            {(filterPills.length > 0 || anyNarrowing) && (
                <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
                    {filterPills.map(p => (
                        <span key={p.label} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-primary-50 text-primary-800 border border-primary-200">
                            {p.label}
                            <button onClick={p.clear} className="p-0.5 rounded-full hover:bg-primary-100" aria-label={`Remove ${p.label}`}><X size={12} /></button>
                        </span>
                    ))}
                    {anyNarrowing && (
                        <button onClick={clearAll} className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800">
                            <X size={12} /> Clear all · {visible.length} shown
                        </button>
                    )}
                </div>
            )}

            {/* Body */}
            <div className="flex-1 min-h-0">
                {loading ? (
                    <SkeletonRows rows={8} />
                ) : requests.length === 0 ? (
                    <EmptyState
                        title="No requests yet"
                        description="Requests raised from the floor, the mobile Report button or condition alerts land here for triage."
                    />
                ) : view === 'list' ? (
                    <ListView
                        rows={visible.slice(0, listLimit)}
                        total={visible.length}
                        onMore={() => setListLimit(l => l + LIST_PAGE)}
                        dupes={dupes}
                        selectedId={selectedId}
                        onOpen={openRequest}
                        onOpenWO={openWO}
                        onShowDuplicates={showDuplicates}
                        sortBy={sortBy}
                        onSort={setSortBy}
                        checked={checked}
                        setChecked={setChecked}
                        bulk={canEdit ? {
                            reviewable: bulkReviewable.length,
                            rejectable: bulkRejectable.length,
                            busy: bulkBusy,
                            onReview: () => runBulk(bulkReviewable, RequestStatus.REVIEW),
                            onReject: () => setBulkRejectOpen(true),
                        } : null}
                    />
                ) : (
                    <>
                        {/* Phone: stacked groups */}
                        <div className="sm:hidden h-full overflow-y-auto space-y-2 pb-4">
                            {columns.map(c => (
                                <MobileGroup
                                    key={c.key}
                                    title={c.closed ? closedTitle : c.title}
                                    items={c.items}
                                    tone={c.tone}
                                    defaultOpen={!c.closed}
                                    dupes={dupes}
                                    onOpen={openRequest}
                                    onOpenWO={openWO}
                                    onShowDuplicates={showDuplicates}
                                />
                            ))}
                        </div>
                        {/* Desktop: board */}
                        <div className="hidden sm:flex h-full gap-3 overflow-x-auto pb-2">
                            {columns.map(c => (
                                <BoardColumn
                                    key={c.key}
                                    title={c.closed ? closedTitle : c.title}
                                    items={c.items}
                                    tone={c.tone}
                                    closed={!!c.closed}
                                    dupes={dupes}
                                    selectedId={selectedId}
                                    onOpen={openRequest}
                                    onOpenWO={openWO}
                                    onShowDuplicates={showDuplicates}
                                    onSeeAll={c.closed ? () => { setView('list'); setFilters({ ...filters, statuses: [RequestStatus.CONVERTED, RequestStatus.REJECTED] }); } : undefined}
                                />
                            ))}
                        </div>
                    </>
                )}
            </div>

            <RequestDetailDrawer
                request={selected}
                dupCount={selected ? dupes.get(selected.id) || 0 : 0}
                position={position}
                assetClassCode={selected?.assetId ? assetMeta.get(selected.assetId)?.classCode : undefined}
                onClose={() => setSelectedId(null)}
                onStep={step}
                onTransition={onTransition}
                onSave={onSave}
                onDelete={onDelete}
                onOpenWO={openWO}
                onShowDuplicates={showDuplicates}
            />

            <RequestFiltersModal
                open={filtersOpen}
                onClose={() => setFiltersOpen(false)}
                filters={filters}
                onChange={setFilters}
                plants={facets.plants}
                types={facets.types}
                requesters={facets.requesters}
                closedWindow={closedWindow}
                onClosedWindow={setClosedWindow}
            />

            <Modal
                open={bulkRejectOpen}
                onClose={() => { setBulkRejectOpen(false); setBulkReason(''); }}
                title={`Reject ${bulkRejectable.length} request${bulkRejectable.length === 1 ? '' : 's'}`}
                footer={
                    <>
                        <button onClick={() => { setBulkRejectOpen(false); setBulkReason(''); }} className="px-4 py-2 text-sm border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50">Cancel</button>
                        <button
                            onClick={async () => {
                                const reason = bulkReason.trim();
                                setBulkRejectOpen(false); setBulkReason('');
                                await runBulk(bulkRejectable, RequestStatus.REJECTED, { rejection_reason: reason });
                            }}
                            disabled={!bulkReason.trim() || bulkBusy}
                            className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                        >
                            Reject
                        </button>
                    </>
                }
            >
                <p className="text-sm text-slate-600 mb-3">One reason for all of them — each requester sees it.</p>
                <div className="mb-3 flex flex-wrap gap-1.5">
                    {bulkRejectable.slice(0, 12).map(r => <span key={r.id} className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{r.requestNumber}</span>)}
                    {bulkRejectable.length > 12 && <span className="text-[11px] text-slate-500">+{bulkRejectable.length - 12} more</span>}
                </div>
                <textarea
                    value={bulkReason}
                    onChange={e => setBulkReason(e.target.value)}
                    autoFocus
                    rows={3}
                    placeholder="e.g. Duplicate — handled under REQ-2026-459238"
                    className="w-full p-3 border border-slate-300 rounded-lg text-sm resize-none focus:ring-2 focus:ring-red-500 focus:border-red-500 focus:outline-none"
                />
            </Modal>

            <ReportRequestForm open={isCreating} onClose={() => setIsCreating(false)} onCreated={() => { loadRequests(); }} />
        </div>
    );
};

// ── Board column ─────────────────────────────────────────────────────────────

interface CardHandlers {
    dupes: Map<string, number>;
    onOpen: (r: ServiceRequest) => void;
    onOpenWO: (woId: string) => void;
    onShowDuplicates: (r: ServiceRequest) => void;
}

const BoardColumn: React.FC<CardHandlers & {
    title: string;
    items: ServiceRequest[];
    tone: string;
    closed: boolean;
    selectedId: string | null;
    onSeeAll?: () => void;
}> = ({ title, items, tone, closed, selectedId, onSeeAll, dupes, onOpen, onOpenWO, onShowDuplicates }) => {
    const [limit, setLimit] = useState(PAGE);

    // An empty open column folds to a strip instead of holding a quarter of the screen.
    if (!closed && items.length === 0) {
        return (
            <div className={cn('flex-none w-12 rounded-xl flex flex-col items-center py-3 gap-2', tone)} title={`${title}: none`}>
                <span className="text-[11px] font-bold text-slate-400 tabular-nums">0</span>
                <span className="text-xs font-semibold text-slate-500 [writing-mode:vertical-rl] rotate-180">{title}</span>
            </div>
        );
    }

    const shown = items.slice(0, limit);
    return (
        <div className={cn('rounded-xl flex flex-col min-h-0', tone, closed ? 'flex-none w-72' : 'flex-1 min-w-[260px]')}>
            <div className="px-3 pt-3 pb-2 flex justify-between items-center gap-2">
                <span className={cn('font-semibold truncate', closed ? 'text-sm text-slate-500' : 'text-slate-700')}>{title}</span>
                <span className="bg-white/70 px-2 py-0.5 rounded text-xs font-semibold text-slate-600 tabular-nums">{items.length}</span>
            </div>
            <div className="px-2 pb-2 flex-1 overflow-y-auto space-y-2">
                {shown.map(r => (
                    <RequestCard
                        key={r.id}
                        request={r}
                        dupCount={dupes.get(r.id)}
                        selected={selectedId === r.id}
                        onSelect={onOpen}
                        onOpenWO={onOpenWO}
                        onShowDuplicates={onShowDuplicates}
                    />
                ))}
                {items.length === 0 && <div className="text-center py-6 text-xs text-slate-400">Nothing closed in this window</div>}
                {items.length > limit && (
                    <button onClick={() => setLimit(l => l + PAGE)} className="w-full py-2 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-white/60 rounded-lg">
                        Show {Math.min(PAGE, items.length - limit)} more · {items.length - limit} left
                    </button>
                )}
                {closed && onSeeAll && items.length > 0 && (
                    <button onClick={onSeeAll} className="w-full py-2 text-xs font-medium text-primary-700 hover:underline">
                        See closed requests in the list
                    </button>
                )}
            </div>
        </div>
    );
};

// ── Phone group ──────────────────────────────────────────────────────────────

const MobileGroup: React.FC<CardHandlers & {
    title: string;
    items: ServiceRequest[];
    tone: string;
    defaultOpen: boolean;
}> = ({ title, items, tone, defaultOpen, dupes, onOpen, onOpenWO, onShowDuplicates }) => {
    const [open, setOpen] = useState(defaultOpen);
    const [limit, setLimit] = useState(PAGE);
    return (
        <div className={cn('rounded-xl overflow-hidden', tone)}>
            <button onClick={() => setOpen(!open)} className="w-full p-3 flex items-center justify-between touch-target-mobile">
                <span className="flex items-center gap-2">
                    {open ? <ChevronDown size={16} className="text-slate-500" /> : <ChevronRight size={16} className="text-slate-500" />}
                    <span className="font-semibold text-sm text-slate-700">{title}</span>
                </span>
                <span className="bg-white/70 px-2.5 py-0.5 rounded-full text-xs font-bold text-slate-600 min-w-[24px] text-center">{items.length}</span>
            </button>
            {open && (
                <div className="px-2 pb-2 space-y-2">
                    {items.length === 0 ? (
                        <div className="text-center py-4 text-xs text-slate-400">No requests</div>
                    ) : items.slice(0, limit).map(r => (
                        <RequestCard key={r.id} request={r} dupCount={dupes.get(r.id)} onSelect={onOpen} onOpenWO={onOpenWO} onShowDuplicates={onShowDuplicates} />
                    ))}
                    {items.length > limit && (
                        <button onClick={() => setLimit(l => l + PAGE)} className="w-full py-2.5 text-xs font-medium text-slate-600">
                            Show more · {items.length - limit} left
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

// ── List view ────────────────────────────────────────────────────────────────

const ListView: React.FC<CardHandlers & {
    rows: ServiceRequest[];
    total: number;
    onMore: () => void;
    selectedId: string | null;
    sortBy: SortKey;
    onSort: (s: SortKey) => void;
    checked: Set<string>;
    setChecked: (s: Set<string>) => void;
    bulk: null | { reviewable: number; rejectable: number; busy: boolean; onReview: () => void; onReject: () => void };
}> = ({ rows, total, onMore, selectedId, sortBy, onSort, checked, setChecked, bulk, dupes, onOpen, onOpenWO, onShowDuplicates }) => {
    const allOn = rows.length > 0 && rows.every(r => checked.has(r.id));
    const toggle = (id: string) => {
        const n = new Set(checked);
        if (n.has(id)) n.delete(id); else n.add(id);
        setChecked(n);
    };
    const sortHead = (label: string, key: SortKey) => (
        <button onClick={() => onSort(key)} className={cn('uppercase tracking-wide inline-flex items-center gap-0.5', sortBy === key ? 'text-slate-900' : 'hover:text-slate-700')}>
            {label}{sortBy === key && <ChevronDown size={11} />}
        </button>
    );

    const columns: DataColumn<ServiceRequest>[] = [
        ...(bulk ? [{
            id: 'pick',
            header: '',
            headerCell: (
                <input type="checkbox" checked={allOn} aria-label="Select all shown"
                    onChange={() => setChecked(allOn ? new Set() : new Set(rows.map(r => r.id)))}
                    className="w-4 h-4 rounded border-slate-300 text-primary-600" />
            ),
            render: (r: ServiceRequest) => (
                <input type="checkbox" checked={checked.has(r.id)} aria-label={`Select ${r.requestNumber}`}
                    onClick={e => e.stopPropagation()} onChange={() => toggle(r.id)}
                    className="w-4 h-4 rounded border-slate-300 text-primary-600" />
            ),
            widthClass: 'w-10',
            hideOnCard: true,
        }] : []),
        {
            id: 'request',
            header: 'Request',
            headerCell: sortHead('Request', 'date'),
            cardTitle: true,
            render: r => (
                <div className="min-w-0 py-1">
                    <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[11px] text-slate-500">{r.requestNumber}</span>
                        {r.isBreakdown && !isClosed(r) && <AlertOctagon size={12} className="text-red-600" aria-label="Equipment stopped" />}
                        {(dupes.get(r.id) || 0) > 0 && !isClosed(r) && (
                            <button onClick={e => { e.stopPropagation(); onShowDuplicates(r); }} className="text-[10px] font-semibold text-amber-700 hover:underline">
                                +{dupes.get(r.id)} on asset
                            </button>
                        )}
                    </div>
                    <div className="text-sm text-slate-900 truncate">{r.description}</div>
                </div>
            ),
        },
        { id: 'priority', header: 'Priority', headerCell: sortHead('Priority', 'priority'), widthClass: 'w-32', render: r => (isClosed(r) ? <span className="text-xs text-slate-400">—</span> : <PriorityPill priority={r.priority} />) },
        { id: 'status', header: 'Status', widthClass: 'w-28', render: r => <span className="text-xs text-slate-600">{STATUS_LABEL[r.status]}</span> },
        {
            id: 'asset', header: 'Asset', headerCell: sortHead('Asset', 'type'), hideBelow: 'lg', widthClass: 'w-48',
            render: r => (
                <div className="min-w-0 text-xs">
                    <div className="font-medium text-slate-700 truncate">{r.assetName || '—'}</div>
                    <div className="text-slate-400 truncate">{plantOf(r)}</div>
                </div>
            ),
        },
        { id: 'by', header: 'Raised by', hideBelow: 'xl', widthClass: 'w-32', render: r => <span className="text-xs text-slate-600 truncate">{r.requesterName}</span> },
        { id: 'age', header: 'Age', widthClass: 'w-16', render: r => <span className="text-xs text-slate-500 tabular-nums" title={new Date(r.createdAt).toLocaleString()}>{ageLabel(r.createdAt)}</span> },
        {
            id: 'due', header: 'Due / outcome', headerCell: sortHead('Due / outcome', 'sla'), widthClass: 'w-60',
            render: r => <span className="text-xs">{isClosed(r) || r.status === RequestStatus.APPROVED ? <OutcomeLabel request={r} onOpenWO={onOpenWO} /> : <DueLabel request={r} />}</span>,
        },
    ];

    const nChecked = rows.filter(r => checked.has(r.id)).length;

    return (
        <div className="h-full flex flex-col min-h-0 bg-white rounded-xl border border-slate-200 overflow-hidden">
            {bulk && nChecked > 0 && (
                <div className="hidden md:flex items-center gap-2 px-3 py-2 border-b border-slate-200 bg-slate-50 text-sm">
                    <span className="font-medium text-slate-700">{nChecked} selected</span>
                    <span className="flex-1" />
                    <button onClick={bulk.onReview} disabled={!bulk.reviewable || bulk.busy}
                        className="px-3 py-1.5 rounded-lg bg-slate-700 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-40"
                        title="Moves the selected New requests to Under review">
                        Start review{bulk.reviewable ? ` (${bulk.reviewable})` : ''}
                    </button>
                    <button onClick={bulk.onReject} disabled={!bulk.rejectable || bulk.busy}
                        className="px-3 py-1.5 rounded-lg border border-red-300 text-red-700 text-xs font-semibold hover:bg-red-50 disabled:opacity-40"
                        title="Rejects the selected requests that are under review or authorized">
                        Reject{bulk.rejectable ? ` (${bulk.rejectable})` : ''}
                    </button>
                    <button onClick={() => setChecked(new Set())} className="px-2 py-1.5 text-xs text-slate-500 hover:text-slate-800">Clear</button>
                </div>
            )}
            <div className="flex-1 min-h-0 flex flex-col">
                <DataList
                    columns={columns}
                    data={rows}
                    getRowId={r => r.id}
                    onRowClick={onOpen}
                    selectedId={selectedId}
                    renderCard={r => <RequestCard request={r} dupCount={dupes.get(r.id)} onOpenWO={onOpenWO} onShowDuplicates={onShowDuplicates} bare />}
                    empty={<EmptyState icon={<Inbox size={28} />} title="Nothing matches" description="Try clearing a filter or the quick chip." />}
                />
            </div>
            {total > rows.length && (
                <button onClick={onMore} className="py-2.5 text-xs font-medium text-slate-600 border-t border-slate-200 hover:bg-slate-50">
                    Show more · {total - rows.length} left
                </button>
            )}
        </div>
    );
};
