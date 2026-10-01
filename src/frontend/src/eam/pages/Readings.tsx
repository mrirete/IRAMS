
import React, { useState, useMemo, useEffect } from 'react';
import { isOpenWo } from '../../lib/woState';
import {
    Search, Filter, Plus, Activity, Zap, Check, AlertTriangle,
    BarChart2, Clock, Calendar, RefreshCcw, Save, Trash2, LineChart as LineChartIcon,
    AlertCircle, CheckCircle, XCircle, X, ChevronLeft, ChevronRight, ChevronDown, List, Network, Minus, Package, MapPin, FileWarning, Wrench
} from 'lucide-react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ComposedChart, Area
} from 'recharts';
import { Asset, ReadingDefinition, ReadingLogEntry, DictionaryRecord } from '../types';

type TabId = 'entry' | 'history' | 'definitions' | 'work';

import { DatabaseService } from '../services/DatabaseService';
import { NotificationService } from '../services/NotificationService';
import { AskRelanternButton } from '../components/AskRelanternButton';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Badge, Button, ScrollTabStrip, cn } from '../components/ui';
import { offlineQueue } from '../services/offlineQueue';
import { ConfirmationModal } from '../components/modals/ConfirmationModal';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { evaluateReading, type AlarmLevel } from '../../lib/readingAlarm';
import { recommendMonitoringCadence } from '../../lib/monitoringCadence';
import { evaluateMeterPMs, forecastMeterPM, isMeterSchedule, matchesReading, type MeterPM, type MeterReadingCtx, type MeterPMDue, type MeterPMForecast } from '../../lib/meterPM';
import { computeReadingDue, summariseDue, type DuePointResult } from '../../lib/readingDue';
import { RaiseWorkModal, type RaiseKind } from '../components/RaiseWorkModal';
import { VALUATION_CODES, valuationByCode, VALUATION_TONE_CLASSES } from '../../lib/valuationCodes';
import { AddReadingPointModal } from '../components/modals/AddReadingPointModal';
import { saveReadings, withLastReadings, type BreachInfo } from '../services/readingEntry';
import { suggestBandsFromReadings, MIN_BASELINE_READINGS } from '../../lib/predict/baselineLimits';
import { limitSourceLabel } from '../../lib/predict/limitLibrary';

// Structural hierarchy levels that never take readings — only maintainable items
// (equipment + sub-components) do. Used to keep the Condition Data asset list from
// showing the whole register (SAP PM: measuring points sit on equipment).
const NON_MAINTAINABLE_LEVELS = new Set(['ENTERPRISE', 'SITE', 'UNIT', 'SYSTEM', 'PLANT', 'LOCATION', 'FUNCTIONAL_LOCATION']);
const LIST_PAGE = 100;
const HISTORY_PAGE = 50;
const NO_DEFS: ReadingDefinition[] = [];

type AssetDue = { due: number; overdue: number; never: number };
// Same urgency order everywhere: overdue, then never read, then due today.
const dueScore = (x?: AssetDue) => x ? x.overdue * 100 + x.never * 10 + x.due : 0;

/** Small overdue / due / never-read pill for an asset (or null when nothing is due). */
const DueBadge: React.FC<{ due?: AssetDue; className?: string }> = ({ due, className }) => {
    if (!due) return null;
    if (due.overdue > 0) return <Badge tone="danger" className={className}>{due.overdue} overdue</Badge>;
    if (due.due > 0) return <Badge tone="warning" className={className}>{due.due} due</Badge>;
    if (due.never > 0) return <Badge tone="neutral" className={className}>{due.never} never read</Badge>;
    return null;
};

export const Readings: React.FC = () => {
    const { profile, permissions, dataScope } = useAuth();
    // ═══ RBAC Permission Extraction (ISO 27001 / NIST CSF) ═══
    const canCreate = permissions?.readings?.create === true;
    const canEdit = permissions?.readings?.edit === true;
    const canDelete = permissions?.readings?.delete === true;
    const { showToast } = useToast();
    // Local State simulating Database
    const [assets, setAssets] = useState<Asset[]>([]);
    const [definitions, setDefinitions] = useState<ReadingDefinition[]>([]);
    const [logs, setLogs] = useState<ReadingLogEntry[]>([]);
    const [readingTypes, setReadingTypes] = useState<DictionaryRecord[]>([]);
    const [faultTypes, setFaultTypes] = useState<{ id: string; code: string; description: string }[]>([]);
    const [raiseKind, setRaiseKind] = useState<RaiseKind | null>(null);
    const [raiseMenuOpen, setRaiseMenuOpen] = useState(false);

    // UI State
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<TabId>('entry');
    const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
    const [filterText, setFilterText] = useState('');
    const [dueOnly, setDueOnly] = useState(false); // rounds view: show only assets with readings due
    const [viewMode, setViewMode] = useState<'list' | 'tree'>('list'); // list = rounds, tree = hierarchy
    // Full-page batch entry sheet with its own in-sheet asset picker (the asset
    // list "moves into" the sheet — operators build their round right there).
    const [sheetOpen, setSheetOpen] = useState(true); // sheet-first: the asset list moved INTO the sheet
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    // R-4: condition-alarm → one-tap WO
    const [alarmBreaches, setAlarmBreaches] = useState<BreachInfo[]>([]);
    // Per-row loading: one shared flag spun every row's button at once.
    const [raisingBreaches, setRaisingBreaches] = useState<Set<BreachInfo>>(new Set());
    // Auto-raise a corrective WO on a CRITICAL breach (opt-in, persisted per browser).
    const [autoRaiseCritical, setAutoRaiseCritical] = useState<boolean>(() => {
        try { return localStorage.getItem('readings.autoRaiseCritical') === '1'; } catch { return false; }
    });
    const toggleAutoRaise = (v: boolean) => {
        setAutoRaiseCritical(v);
        try { localStorage.setItem('readings.autoRaiseCritical', v ? '1' : '0'); } catch { /* ignore */ }
    };
    // Meter-based PM triggers — recurring_work rows + due prompts on reading save
    const [pms, setPms] = useState<any[]>([]);
    const [pmDue, setPmDue] = useState<(MeterPMDue & { assetId: string; assetName: string })[]>([]);
    const [generatingPM, setGeneratingPM] = useState(false);
    // Confirm modal state
    const [meterChangeDefId, setMeterChangeDefId] = useState<string | null>(null);
    const [deleteDefId, setDeleteDefId] = useState<string | null>(null);
    // Reading-point editor (proper definition: name/category/unit/alarm bands)
    const [addPointAssetId, setAddPointAssetId] = useState<string | null>(null);

    useEffect(() => {
        loadReadings();
    }, [dataScope]); // Re-run when user's data scope changes

    // Deep link (?asset=<id>) — e.g. the Predict setup guide's "log daily rounds
    // here" hand-off lands with the asset already selected on the entry sheet.
    // `&point=<definition id>` (RCM Strategy "Open reading point", Evidence
    // "trend") lands on that point's trend instead of the entry sheet.
    const location = useLocation();
    const [deepLinkDefId, setDeepLinkDefId] = useState<string | null>(null);
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const q = params.get('asset');
        const point = params.get('point');
        if (q) { setSelectedAssetId(q); setActiveTab(point ? 'history' : 'entry'); }
        if (point) setDeepLinkDefId(point);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const loadReadings = async () => {
        try {
            const dbInstance = DatabaseService.getInstance();
            const [dbAssets, dbDefs, dbLogs, dbDicts, dbPMs] = await Promise.all([
                dbInstance.getAssets(),
                dbInstance.getReadingDefinitions(),
                dbInstance.getReadingLogs(),
                dbInstance.getDictionaries(),
                dbInstance.getPMs()
            ]);
            setPms(dbPMs || []);

            // ═══ Site Scope Filtering (ISO 55000 Data Boundary Enforcement) ═══
            const scopedAssets = DatabaseService.filterAssetsBySiteScope(dbAssets, dataScope?.siteIds);
            const scopedAssetIds = new Set(scopedAssets.map(a => a.id));
            setAssets(scopedAssets);

            // Only show reading definitions for in-scope assets. reading_definitions
            // carries no last-reading column, so stamp each point with its latest log
            // — otherwise every meter delta after a page load would be computed
            // against an undefined previous value (i.e. silently recorded as 0).
            const scopedDefs = dbDefs.filter(d => scopedAssetIds.has(d.assetId));
            setDefinitions(withLastReadings(scopedDefs, dbLogs));
            setLogs(dbLogs || []);

            // Filter dictionaries for Reading Types
            const types = dbDicts.filter(d => d.type === 'READING_TYPE' && d.active);
            setReadingTypes(types);
            // Fault types (ISO 14224 functional failures) for raising requests
            setFaultTypes(dbDicts.filter(d => d.type === 'FAULT_TYPE' && d.active).map(d => ({ id: d.id, code: d.code, description: d.description })));
        } catch (e) {
            console.error("Failed to load readings data", e);
            showToast('Failed to load readings data. See console.', 'error');
        }
    };

    // --- Derived Data ---

    // Only maintainable items take readings — equipment and their sub-components,
    // not the structural hierarchy (enterprise/site/unit/system). This mirrors SAP
    // PM (measuring points sit on equipment / maintainable items) and keeps the
    // list from being the whole asset register. Assets with points sort to the top
    // (the rounds list); the rest stay selectable so you can configure them.
    // ── Rounds engine: which reading points are due, from last reading + cadence ──
    const dueByDef = useMemo(() => {
        const lastByDef = new Map<string, string>();
        for (const l of logs) {
            if (l.isActive === false) continue;
            const prev = lastByDef.get(l.definitionId);
            if (!prev || l.date > prev) lastByDef.set(l.definitionId, l.date);
        }
        const critById = new Map(assets.map(a => [a.id, a.criticality]));
        const results = computeReadingDue(
            definitions.filter(d => d.isActive).map(d => ({
                definitionId: d.id, assetId: d.assetId,
                criticality: critById.get(d.assetId), lastReadingDate: lastByDef.get(d.id) || null,
                monitoringFrequencyDays: d.monitoringFrequencyDays ?? null,
                pfIntervalDays: d.pfIntervalDays ?? null,
            })),
        );
        return new Map(results.map(r => [r.definitionId, r]));
    }, [logs, definitions, assets]);

    const dueByAsset = useMemo(() => {
        const m = new Map<string, { due: number; overdue: number; never: number }>();
        for (const r of dueByDef.values()) {
            const cur = m.get(r.assetId) || { due: 0, overdue: 0, never: 0 };
            if (r.status === 'OVERDUE') cur.overdue++;
            else if (r.status === 'NEVER') cur.never++;
            else if (r.status === 'DUE') cur.due++;
            m.set(r.assetId, cur);
        }
        return m;
    }, [dueByDef]);

    const dueSummary = useMemo(() => summariseDue([...dueByDef.values()]), [dueByDef]);
    const assetIsDue = (id: string) => {
        const d = dueByAsset.get(id);
        return !!d && (d.due + d.overdue + d.never) > 0;
    };

    // One pass over the points, indexed by asset. The sidebar cards, the sort
    // comparator and the tree each re-filtered every definition per asset (and
    // the comparator did it per comparison) — quadratic on a real register.
    const { defsByAsset, countByAsset } = useMemo(() => {
        const byAsset = new Map<string, ReadingDefinition[]>();
        const count = new Map<string, number>();
        for (const d of definitions) {
            const arr = byAsset.get(d.assetId);
            if (arr) arr.push(d); else byAsset.set(d.assetId, [d]);
            if (d.isActive) count.set(d.assetId, (count.get(d.assetId) || 0) + 1);
        }
        return { defsByAsset: byAsset, countByAsset: count };
    }, [definitions]);

    const filteredAssets = useMemo(() => {
        const q = filterText.trim().toLowerCase();
        const hasPoints = (id: string) => (countByAsset.get(id) || 0) > 0;
        return assets
            // Default list = maintainable items only. But a search bypasses the
            // level filter and looks across the whole register, so an asset that's
            // mislabelled as a structural level (or untagged) is never unreachable —
            // search it by tag/name and you can still add reading points to it.
            .filter(a => q
                ? (a.name.toLowerCase().includes(q) || a.tag.toLowerCase().includes(q))
                : !NON_MAINTAINABLE_LEVELS.has((a.hierarchyLevel || '').toUpperCase()))
            .filter(a => !dueOnly || assetIsDue(a.id))
            .sort((a, b) => {
                // Rounds-first: overdue/never/due assets to the top, then by points, then tag.
                const byDue = dueScore(dueByAsset.get(b.id)) - dueScore(dueByAsset.get(a.id));
                if (byDue !== 0) return byDue;
                const byPoints = (hasPoints(b.id) ? 1 : 0) - (hasPoints(a.id) ? 1 : 0);
                if (byPoints !== 0) return byPoints;
                return (a.tag || a.name).localeCompare(b.tag || b.name);
            });
    }, [assets, countByAsset, filterText, dueOnly, dueByAsset]);

    // The list renders 100 cards at a time; the page resets whenever the filter
    // that produced the list changes (keyed, so no reset effect is needed).
    const listKey = `${filterText}|${dueOnly}`;
    const [listPage, setListPage] = useState({ key: '', n: LIST_PAGE });
    const listLimit = listPage.key === listKey ? listPage.n : LIST_PAGE;

    // The selected asset's points, stable between renders so the tabs below
    // don't see a fresh array every time.
    const selectedDefs = useMemo(
        () => (selectedAssetId ? defsByAsset.get(selectedAssetId) : undefined) || NO_DEFS,
        [defsByAsset, selectedAssetId],
    );

    // ── Hierarchy tree (from parentId) for the Tree view mode ──
    const tree = useMemo(() => {
        const q = filterText.trim().toLowerCase();
        const pool = assets.filter(a => !NON_MAINTAINABLE_LEVELS.has((a.hierarchyLevel || '').toUpperCase()));
        const ids = new Set(pool.map(a => a.id));
        const childrenOf = new Map<string, Asset[]>();
        const roots: Asset[] = [];
        for (const a of pool) {
            if (a.parentId && ids.has(a.parentId)) {
                const arr = childrenOf.get(a.parentId) || [];
                arr.push(a); childrenOf.set(a.parentId, arr);
            } else roots.push(a);
        }
        const cmp = (a: Asset, b: Asset) => (a.tag || a.name).localeCompare(b.tag || b.name);
        roots.sort(cmp);
        childrenOf.forEach(arr => arr.sort(cmp));

        const matches = (a: Asset) => {
            const okSearch = !q || a.name.toLowerCase().includes(q) || a.tag.toLowerCase().includes(q);
            const okDue = !dueOnly || (() => { const d = dueByAsset.get(a.id); return !!d && (d.due + d.overdue + d.never) > 0; })();
            return okSearch && okDue;
        };
        // A node is visible if it matches, or any descendant is visible.
        const visible = new Set<string>();
        const visit = (a: Asset): boolean => {
            let anyChild = false;
            for (const k of (childrenOf.get(a.id) || [])) if (visit(k)) anyChild = true;
            const vis = matches(a) || anyChild;
            if (vis) visible.add(a.id);
            return vis;
        };
        roots.forEach(visit);
        return { roots, childrenOf, visible };
    }, [assets, filterText, dueOnly, dueByAsset]);

    const toggleCollapse = (id: string) => setCollapsed(prev => {
        const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n;
    });

    const selectedAsset = assets.find(a => a.id === selectedAssetId);

    // --- Core Logic Handlers ---

    // Add New Definition
    const handleAddDefinition = async (assetId: string, typeCode: string) => {
        // ═══ RBAC Layer 2: Submit-level guard (ISO 27001 / NIST CSF) ═══
        if (!canCreate) {
            console.warn('[RBAC-AUDIT] BLOCKED: readings.addDefinition attempt by unauthorized user', profile?.username);
            showToast('Access Denied: You do not have permission to add reading definitions.', 'error');
            return;
        }
        const dictEntry = readingTypes.find(d => d.code === typeCode);
        if (!dictEntry) return;

        const newDefPayload = {
            assetId: assetId,
            readingTypeCode: dictEntry.code,
            name: dictEntry.description,
            unit: 'Unit', // TODO: Add unit to Dictionary extended properties
            category: dictEntry.categoryCode === 'Meter Reading' ? 'METER' : 'CONDITION',
            minCritical: 0,
            maxCritical: 100,
            active: true
        };

        try {
            const savedDef = await DatabaseService.getInstance().addReadingDefinition(newDefPayload);
            setDefinitions([...definitions, savedDef]);
        } catch (e: any) {
            showToast('Failed to add definition: ' + e.message, 'error');
        }
    };

    // Full reading-point creation from the editor — real unit + alarm bands, no
    // dependency on pre-seeded dictionary types (reading_type_code is a free slug).
    const handleCreateDefinition = async (payload: {
        assetId: string; name: string; category: 'METER' | 'CONDITION'; unit: string;
        minCritical?: number | null; minWarning?: number | null; maxWarning?: number | null; maxCritical?: number | null;
        monitoringFrequencyDays?: number | null; pfIntervalDays?: number | null;
        limitSource?: string | null;
        operatorAction?: string | null;
    }) => {
        if (!canCreate) {
            showToast('Access Denied: You do not have permission to add reading points.', 'error');
            return;
        }
        const slug = (payload.name || 'READING').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'READING';
        const code = `${slug}_${Date.now().toString(36).toUpperCase()}`;
        const defPayload = {
            assetId: payload.assetId,
            readingTypeCode: code,
            name: payload.name.trim(),
            unit: payload.unit.trim() || '—',
            category: payload.category,
            minCritical: payload.minCritical ?? null,
            minWarning: payload.minWarning ?? null,
            maxWarning: payload.maxWarning ?? null,
            maxCritical: payload.maxCritical ?? null,
            monitoringFrequencyDays: payload.monitoringFrequencyDays ?? null,
            pfIntervalDays: payload.pfIntervalDays ?? null,
            limitSource: payload.limitSource ?? null,
            operatorAction: payload.operatorAction ?? null,
            active: true,
        };
        try {
            const savedDef = await DatabaseService.getInstance().addReadingDefinition(defPayload);
            setDefinitions(prev => [...prev, savedDef]);
            setAddPointAssetId(null);
            showToast(`Reading point "${payload.name}" added.`, 'success');
        } catch (e: any) {
            showToast('Failed to add reading point: ' + e.message, 'error');
        }
    };
    // 3.2 Reading Entry (Batch or Single) — all the capture rules live in the
    // shared readingEntry engine, so the asset drawer's Readings tab behaves
    // identically. This function is now just RBAC + presentation.
    // Resolves with the definition ids that were NOT saved, so the entry sheet
    // keeps exactly those values (it used to clear everything before the save).
    const handleSaveReadings = async (newReadings: Partial<ReadingLogEntry>[]): Promise<string[]> => {
        // ═══ RBAC Layer 2: Submit-level guard (ISO 27001 / NIST CSF) ═══
        if (!canCreate) {
            console.warn('[RBAC-AUDIT] BLOCKED: readings.saveReadings attempt by unauthorized user', profile?.username);
            showToast('Access Denied: You do not have permission to enter readings.', 'error');
            return newReadings.map(r => r.definitionId).filter(Boolean) as string[];
        }

        const result = await saveReadings(
            newReadings
                .filter(r => r.definitionId != null && r.value != null)
                .map(r => ({
                    definitionId: r.definitionId as string,
                    value: r.value as number,
                    date: r.date,
                    time: r.time,
                    comments: r.comments,
                    valuationCode: r.valuationCode,
                })),
            {
                definitions, logs, assets, pms,
                actor: profile?.username || profile?.fullName || 'Unknown User',
                actorId: profile?.id || 'SYSTEM',
            },
        );

        setLogs(result.logs);
        setDefinitions(result.definitions);

        result.warnings.forEach(w => showToast(w, 'warning'));
        result.errors.forEach(e => showToast(e, 'error'));

        if (result.errors.length === 0) {
            showToast(
                result.queuedAny
                    ? 'Saved offline — readings will sync when you reconnect.'
                    : 'Readings saved successfully.',
                result.queuedAny ? 'info' : 'success',
            );
        }
        if (result.propagatedCount > 0) {
            showToast(`${result.propagatedCount} child meter reading${result.propagatedCount > 1 ? 's' : ''} advanced by the parent's delta.`, 'info');
        }

        // R-4: band breaches. If auto-raise is on, CRITICAL breaches become
        // corrective WOs immediately; the rest (warnings, or criticals when the
        // option is off) surface in the one-tap banner.
        if (result.breaches.length > 0) {
            const autoTargets = autoRaiseCritical ? result.breaches.filter(b => b.level === 'CRITICAL') : [];
            const toBanner = result.breaches.filter(b => !autoTargets.includes(b));
            if (autoTargets.length > 0) {
                const results = await Promise.allSettled(autoTargets.map(b => createRequestForBreach(b, true)));
                const ok = results.filter(r => r.status === 'fulfilled').length;
                if (ok > 0) showToast(`${ok} critical alarm${ok > 1 ? 's' : ''} auto-raised as maintenance request${ok > 1 ? 's' : ''}.`, 'success');
                // Say WHY, not just that it failed: the usual cause is a
                // Criticality A asset with no fault type available to assign.
                const rejected = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
                if (rejected.length > 0) {
                    showToast(`${rejected.length} auto-raise${rejected.length > 1 ? 's' : ''} failed — ${(rejected[0].reason as Error)?.message || 'unknown'}`, 'error');
                }
            }
            if (toBanner.length > 0) setAlarmBreaches(toBanner);
        }

        if (result.pmDue.length > 0) setPmDue(result.pmDue);
        return result.failedIds;
    };


    // Meter-based PM → one-tap generate the preventive work order. Passes the meter
    // value so the PM's per-asset baseline is stamped (next due = this + interval),
    // preventing a re-fire on the next reading.
    const generatePMWorkOrder = async (d: MeterPMDue & { assetId: string }) => {
        setGeneratingPM(true);
        try {
            const wo = await DatabaseService.getInstance().generateWOFromPM(d.pmId, d.assetId, false, d.current);
            showToast('Preventive work order generated from meter trigger.', 'success');
            setPmDue(prev => prev.filter(x => x.pmId !== d.pmId));
            // Keep in-memory PMs in sync with the stamped baseline so a further reading
            // this session doesn't re-prompt before a reload.
            setPms(prev => prev.map(p => {
                if (p.id !== d.pmId) return p;
                const existing: any[] = Array.isArray(p.assigned_assets) ? [...p.assigned_assets] : [];
                const i = existing.findIndex((a: any) => a.assetId === d.assetId);
                const stamp = { assetId: d.assetId, lastReadingValue: d.current, lastCompletedDate: new Date().toISOString().split('T')[0] };
                if (i >= 0) existing[i] = { ...existing[i], ...stamp }; else existing.push(stamp);
                return { ...p, assigned_assets: existing };
            }));
            const id = (wo as any)?.id;
            if (id) navigate(`/work-orders/${id}`);
        } catch (e: any) {
            showToast('Failed to generate PM work order: ' + (e?.message || 'unknown'), 'error');
        } finally { setGeneratingPM(false); }
    };

    /**
     * Raise a maintenance REQUEST from a condition breach (one-tap + auto).
     *
     * This used to create a work order directly. SAP splits the two — an
     * operator or a measurement document raises a Notification, a planner turns
     * it into an Order — and this codebase already models that as Request →
     * Work Order. Creating the order here skipped triage entirely and demanded
     * workOrders.create from technicians, which the matrix does not give them.
     * Closes gap X-4 ("threshold alarms → auto-notification").
     *
     * functional_failure_id falls back to the seeded COND_ALARM code (0249):
     * createRequest refuses a Criticality A asset without one, and a machine
     * has no way to know the failure mode. Once reading points carry their own
     * default fault type this picks that up instead — hence looking it up by
     * code rather than hard-coding an id.
     */
    const createRequestForBreach = (b: BreachInfo, auto: boolean) => {
        const now = new Date().toISOString();
        const actor = profile?.username || profile?.fullName || 'user';
        const fallbackFault = faultTypes.find(f => f.code === 'COND_ALARM')?.id
            || faultTypes[0]?.id
            || null;
        return DatabaseService.getInstance().createRequest({
            id: crypto.randomUUID(),
            request_number: `REQ-${Date.now().toString(36).toUpperCase()}`,
            status: 'NEW' as any,
            description: `Condition alarm on ${b.assetName}: ${b.defName} = ${b.value}${b.unit ? ' ' + b.unit : ''} (${b.detail}). ${auto ? 'Auto-raised on critical breach from condition monitoring.' : 'Raised from readings.'}`,
            asset_id: b.assetId,
            requester_id: profile?.id || actor,
            functional_failure_id: fallbackFault,
            risk_score: b.level === 'CRITICAL' ? 80 : 50,
            created_at: now,
            updated_at: now,
        } as any, actor);
    };

    // R-4: one-tap maintenance request from a condition alarm.
    // Raising one breach removes only that breach and stays here: it used to
    // clear every alarm and navigate away, so the other breaches in the same
    // round were never raised.
    const raiseWOFromAlarm = async (b: BreachInfo) => {
        setRaisingBreaches(prev => new Set(prev).add(b));
        try {
            const req = await createRequestForBreach(b, false);
            const num = (req as any)?.request_number;
            showToast(`Maintenance request${num ? ' ' + num : ''} raised for ${b.assetName} — ${b.defName}.`, 'success');
            setAlarmBreaches(prev => prev.filter(x => x !== b));
        } catch (e: any) {
            showToast('Failed to raise request: ' + (e?.message || 'unknown'), 'error');
        } finally {
            setRaisingBreaches(prev => { const n = new Set(prev); n.delete(b); return n; });
        }
    };

    // Meter Change logic
    const handleMeterChange = (defId: string) => {
        // ═══ RBAC Layer 2: Submit-level guard (ISO 27001 / NIST CSF) ═══
        if (!canEdit) {
            console.warn('[RBAC-AUDIT] BLOCKED: readings.meterChange attempt by unauthorized user', profile?.username);
            showToast('Access Denied: You do not have permission to reset meters.', 'error');
            return;
        }
        setMeterChangeDefId(defId);
    };

    // Toggle Active Logic
    const handleToggleActive = async (logId: string, currentStatus: boolean) => {
        // ═══ RBAC Layer 2: Submit-level guard (ISO 27001 / NIST CSF) ═══
        if (!canEdit) {
            console.warn('[RBAC-AUDIT] BLOCKED: readings.toggleActive attempt by unauthorized user', profile?.username);
            showToast('Access Denied: You do not have permission to modify reading status.', 'error');
            return;
        }
        const targetLog = logs.find(l => l.id === logId);
        if (!targetLog) return;

        // Get all logs for this definition, sorted by date ASC
        const defLogs = logs
            .filter(l => l.definitionId === targetLog.definitionId)
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        const targetIndex = defLogs.findIndex(l => l.id === logId);
        if (targetIndex === -1) return;

        let updatedLogs = [...logs];

        if (currentStatus === true) {
            // DEACTIVATING: Deactivate this AND all subsequent readings
            for (let i = targetIndex; i < defLogs.length; i++) {
                const logToUpdate = defLogs[i];
                updatedLogs = updatedLogs.map(l => l.id === logToUpdate.id ? { ...l, isActive: false } : l);
            }
        } else {
            // ACTIVATING: Activate this AND all prior readings back to the last active one
            for (let i = 0; i <= targetIndex; i++) {
                const logToUpdate = defLogs[i];
                updatedLogs = updatedLogs.map(l => l.id === logToUpdate.id ? { ...l, isActive: true } : l);
            }
        }

        // Saved first, then shown — it only changed the screen, so a deactivated
        // bad reading came back on refresh and kept skewing the averages.
        const changed = updatedLogs.filter(l => (logs.find(o => o.id === l.id)?.isActive !== false) !== (l.isActive !== false));
        if (changed.length === 0) return;
        const prev = logs;
        setLogs(updatedLogs);
        try {
            await DatabaseService.getInstance().setReadingLogsActive(changed.map(l => l.id), !currentStatus);
            showToast(`${changed.length} reading${changed.length > 1 ? 's' : ''} ${currentStatus ? 'excluded from' : 'restored to'} averages.`, 'success');
        } catch (e: any) {
            setLogs(prev);
            showToast('Not saved: ' + (e?.message || e), 'error');
        }
    };

    // Learned-baseline limits (1.5.2): propose μ+2σ / μ+3σ from this point's own
    // logged readings; the user approves before anything is written. Provenance
    // becomes 'learned'.
    const handleSuggestBands = async (def: ReadingDefinition) => {
        if (!canEdit) {
            showToast('Access Denied: You do not have permission to change alarm limits.', 'error');
            return;
        }
        const vals = logs
            .filter(l => l.definitionId === def.id && l.isActive !== false)
            .map(l => Number(l.value))
            .filter(v => Number.isFinite(v));
        const s = suggestBandsFromReadings(vals);
        if (!s) {
            showToast(`Needs at least ${MIN_BASELINE_READINGS} readings with some variation to learn limits (${vals.length} on record).`, 'warning');
            return;
        }
        const ok = window.confirm(
            `Suggested limits for "${def.name}" (${def.unit}):\n\n` +
            `  Warn above: ${s.maxWarning}\n  Alert above: ${s.maxCritical}\n\n` +
            `${s.rationale}\n\nApply these bands?`
        );
        if (!ok) return;
        try {
            await DatabaseService.getInstance().updateReadingDefinitionBands(def.id, {
                minCritical: def.minCritical ?? null,
                minWarning: def.minWarning ?? null,
                maxWarning: s.maxWarning,
                maxCritical: s.maxCritical,
                limitSource: 'learned',
            });
            setDefinitions(prev => prev.map(d => d.id === def.id
                ? { ...d, maxWarning: s.maxWarning, maxCritical: s.maxCritical, limitSource: 'learned' }
                : d));
            showToast(`Limits updated from ${s.n} readings — provenance: learned baseline.`, 'success');
        } catch (e: any) {
            showToast(`Could not update limits: ${e?.message || 'unknown error'}`, 'error');
        }
    };

    const handleDeleteDefinition = async (id: string) => {
        // ═══ RBAC Layer 2: Submit-level guard (ISO 27001 / NIST CSF) ═══
        if (!canDelete) {
            console.warn('[RBAC-AUDIT] BLOCKED: readings.deleteDefinition attempt by unauthorized user', profile?.username);
            showToast('Access Denied: You do not have permission to delete reading definitions.', 'error');
            return;
        }
        setDeleteDefId(id);
    };

    return (
        <div className="ers-page-wide w-full flex h-[calc(100vh-6rem)] gap-4 sm:gap-6">
            {/* Sidebar List */}
            <div className={`flex flex-col bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden transition-all duration-300 ${sheetOpen ? 'hidden' : selectedAssetId ? 'hidden sm:flex sm:w-1/3' : 'w-full sm:w-1/3'}`}>
                <div className="p-4 border-b border-slate-200 flex justify-between items-center gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        {/* Titled by purpose, not "Assets" — on mobile this pane fills the
                            screen and was being mistaken for the main Asset Register. */}
                        <div className="min-w-0">
                            <h2 className="font-bold text-slate-900 leading-tight truncate">Condition Data</h2>
                            <p className="text-[10px] text-slate-400 leading-tight truncate">pick an asset to record readings</p>
                        </div>
                        <div className="flex border border-slate-200 rounded-lg overflow-hidden">
                            <button onClick={() => setViewMode('list')} className={`p-1.5 transition-colors ${viewMode === 'list' ? 'bg-primary-50 text-primary-700' : 'bg-white text-slate-400 hover:text-slate-600'}`} title="Rounds list (due-sorted)"><List size={14} /></button>
                            <button onClick={() => setViewMode('tree')} className={`p-1.5 transition-colors ${viewMode === 'tree' ? 'bg-primary-50 text-primary-700' : 'bg-white text-slate-400 hover:text-slate-600'}`} title="Hierarchy (equipment → components)"><Network size={14} /></button>
                        </div>
                    </div>
                    <button
                        onClick={() => { setSelectedAssetId(null); setSheetOpen(true); }} // Full-page sheet with in-sheet asset picker
                        className="text-xs bg-primary-600 text-white px-3 py-1.5 rounded hover:bg-primary-500 font-medium flex-shrink-0"
                    >
                        New Entry Sheet
                    </button>
                </div>
                <div className="p-4 bg-slate-50 border-b border-slate-200">
                    <div className="relative">
                        <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                        <input
                            type="text"
                            placeholder="Search asset (any level)…"
                            value={filterText}
                            onChange={(e) => setFilterText(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm"
                            title="Type to search across the whole register — useful if equipment is mislabelled as a site/system"
                        />
                    </div>
                    {/* Where readings come from when nobody types them — the admin-only
                        feeds page had no path from the data it fills. */}
                    {permissions?.admin?.view && (
                        <Link to="/admin/connectors" state={{ to: '/readings', label: 'Condition Data' }} className="mt-2 inline-block text-[11px] text-slate-500 hover:text-primary-700">
                            Readings from a historian or sensors? <span className="font-semibold text-primary-700">Sensor &amp; Data Feeds →</span>
                        </Link>
                    )}
                </div>
                {/* Rounds bar — what's due to be read, criticality-driven cadence */}
                {(dueSummary.overdue + dueSummary.due + dueSummary.never) > 0 && (
                    <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-2 bg-white">
                        <div className="flex items-center gap-1.5 text-xs">
                            <Clock size={13} className="text-slate-400" />
                            {dueSummary.overdue > 0 && <span className="font-bold text-red-600">{dueSummary.overdue} overdue</span>}
                            {dueSummary.due > 0 && <span className="font-semibold text-amber-600">{dueSummary.due} due</span>}
                            {dueSummary.never > 0 && <span className="text-slate-500">{dueSummary.never} never read</span>}
                        </div>
                        <button
                            onClick={() => setDueOnly(v => !v)}
                            className={`text-[11px] font-semibold px-2 py-1 rounded-md border transition ${dueOnly ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
                            title="Show only assets with readings due (rounds worklist)"
                        >
                            {dueOnly ? 'Rounds: on' : 'Due only'}
                        </button>
                    </div>
                )}
                <div className="flex-1 overflow-y-auto">
                    {viewMode === 'tree' && (() => {
                        const visibleRoots = tree.roots.filter(r => tree.visible.has(r.id));
                        const force = !!filterText.trim() || dueOnly;
                        if (visibleRoots.length === 0) return (
                            <div className="p-8 text-center text-sm text-slate-400">{dueOnly ? 'No readings due right now — rounds are clear.' : 'No assets match.'}</div>
                        );
                        return (
                            <div className="py-1">
                                {visibleRoots.map((r, i) => (
                                    <AssetTreeNode
                                        key={r.id} asset={r} depth={0} isLast={i === visibleRoots.length - 1} ancestorLastFlags={[]}
                                        childrenOf={tree.childrenOf} visible={tree.visible}
                                        selectedId={selectedAssetId} forceExpand={force} collapsed={collapsed}
                                        onToggle={toggleCollapse} onSelect={(id) => { setSelectedAssetId(id); setActiveTab('entry'); }}
                                        dueOf={(id) => dueByAsset.get(id)} pointCountOf={(id) => countByAsset.get(id) || 0}
                                    />
                                ))}
                            </div>
                        );
                    })()}
                    {viewMode === 'list' && filteredAssets.length === 0 && (
                        <div className="p-8 text-center text-sm text-slate-400">
                            {dueOnly ? 'No readings due right now — rounds are clear.' : 'No assets match.'}
                        </div>
                    )}
                    {/* Cards carry a count, not every point as a chip — a 40-point
                        compressor drew 40 chips per card and the list stopped scrolling. */}
                    {viewMode === 'list' && filteredAssets.slice(0, listLimit).map(asset => {
                        const nPts = countByAsset.get(asset.id) || 0;
                        const due = dueByAsset.get(asset.id);
                        return (
                            <div
                                key={asset.id}
                                onClick={() => { setSelectedAssetId(asset.id); setActiveTab('entry'); }}
                                className={`mobile-card ${selectedAssetId === asset.id ? 'bg-blue-50 border-l-4 border-l-blue-600' : ''}`}
                            >
                                <div className="flex justify-between items-start gap-2">
                                    <span className="font-bold text-slate-900 text-sm truncate">{asset.tag}</span>
                                    <DueBadge due={due} className="flex-shrink-0" />
                                </div>
                                <div className="flex items-center justify-between gap-2 mt-0.5">
                                    <p className="text-xs text-slate-500 truncate">{asset.name}</p>
                                    {nPts > 0
                                        ? <span className="text-[10px] text-slate-500 font-semibold flex-shrink-0">{nPts} point{nPts === 1 ? '' : 's'}</span>
                                        : <span className="text-[10px] text-slate-400 italic flex-shrink-0">No readings configured</span>}
                                </div>
                            </div>
                        );
                    })}
                    {viewMode === 'list' && filteredAssets.length > listLimit && (
                        <button
                            onClick={() => setListPage({ key: listKey, n: listLimit + LIST_PAGE })}
                            className="w-full py-3 text-xs font-semibold text-primary-700 hover:bg-primary-50 border-t border-slate-100"
                        >
                            Show more ({filteredAssets.length - listLimit} more)
                        </button>
                    )}
                </div>
            </div>

            {/* Main Content */}
            <div className={`flex-1 bg-white rounded-xl shadow-lg border border-slate-200 flex flex-col overflow-hidden ${sheetOpen ? '' : !selectedAssetId ? 'hidden sm:flex' : ''}`}>
                {selectedAsset ? (
                    <>
                    {/* Mobile back button */}
                    <button
                        onClick={() => setSelectedAssetId(null)}
                        className="sm:hidden flex items-center gap-2 px-4 py-3 border-b border-slate-200 text-sm font-medium text-blue-600 hover:bg-blue-50 transition"
                    >
                        <ChevronLeft size={16} /> Back to Assets
                    </button>
                        {/* Header wraps instead of squeezing; the four views moved off the
                            button row into an underline tab strip so "Raise" is the only
                            filled button (it used to sit among four filled tab buttons). */}
                        <div className="px-4 pt-3 sm:px-5 sm:pt-4 border-b border-slate-200 bg-white">
                            <div className="flex flex-wrap justify-between items-start gap-x-4 gap-y-2">
                                <div className="min-w-0 flex-1">
                                    <h1 className="text-lg sm:text-xl font-bold text-slate-900 break-words">{selectedAsset.tag} - {selectedAsset.name}</h1>
                                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                        <p className="text-sm text-slate-500">{selectedAsset.category} • {selectedAsset.location}</p>
                                        {(() => {
                                            const cad = recommendMonitoringCadence({ criticality: selectedAsset.criticality });
                                            return (
                                                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 bg-slate-100 border border-slate-200 rounded px-2 py-0.5" title={cad.basis}>
                                                    <Clock size={11} /> Suggested cadence: {cad.label}
                                                    <span className="text-slate-400">· Crit {selectedAsset.criticality}</span>
                                                </span>
                                            );
                                        })()}
                                    </div>
                                </div>
                                <div className="flex gap-2 items-center flex-shrink-0">
                                    {/* Raise ▾ — Request / Work Order / PM from this asset */}
                                    <div className="relative">
                                        <button
                                            onClick={() => setRaiseMenuOpen(o => !o)}
                                            onBlur={() => setTimeout(() => setRaiseMenuOpen(false), 150)}
                                            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-relantern-500 hover:bg-relantern-600 rounded-lg transition-colors"
                                        >
                                            <Plus size={15} /> Raise <ChevronDown size={14} />
                                        </button>
                                        {raiseMenuOpen && (
                                            <div className="absolute right-0 mt-1 w-48 bg-white border border-slate-200 rounded-xl shadow-xl z-30 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                                                {[
                                                    { k: 'REQUEST' as RaiseKind, icon: <FileWarning size={14} />, l: 'Maintenance Request', s: 'For approval → WO' },
                                                    { k: 'WO' as RaiseKind, icon: <Wrench size={14} />, l: 'Work Order', s: 'Corrective, direct' },
                                                    { k: 'PM' as RaiseKind, icon: <Clock size={14} />, l: 'PM Strategy', s: 'Recurring' },
                                                ].map(item => (
                                                    <button key={item.k} onMouseDown={() => { setRaiseKind(item.k); setRaiseMenuOpen(false); }}
                                                        className="w-full flex items-start gap-2 px-3 py-2.5 text-left hover:bg-slate-50 transition">
                                                        <span className="text-relantern-600 mt-0.5">{item.icon}</span>
                                                        <span className="min-w-0"><span className="block text-sm font-semibold text-slate-800">{item.l}</span><span className="block text-[10px] text-slate-400">{item.s}</span></span>
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <AskRelanternButton
                                        contextType="readings"
                                        contextSummary={`Readings for ${selectedAsset.tag} (${selectedAsset.name}): ${selectedDefs.length} reading points configured. Categories: ${[...new Set(selectedDefs.map(d => d.category))].join(', ')}. ${logs.filter(l => l.assetId === selectedAsset.id && l.isAlarm).length} alarms triggered. Ask about trend analysis, predictive maintenance triggers, condition exceedances, or meter reading optimization.`}
                                        compact
                                    />
                                </div>
                            </div>
                            <ScrollTabStrip activeId={activeTab} className="flex gap-1 mt-2 -mb-px">
                                {([
                                    ['entry', 'Entry Sheet'],
                                    ['history', 'History & Analysis'],
                                    ['definitions', 'Definitions'],
                                    ['work', 'Related Work'],
                                ] as [TabId, string][]).map(([id, label]) => (
                                    <button
                                        key={id}
                                        data-active={activeTab === id ? 'true' : undefined}
                                        onClick={() => setActiveTab(id)}
                                        className={cn(
                                            'px-3 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors',
                                            activeTab === id ? 'border-primary-600 text-primary-700' : 'border-transparent text-slate-500 hover:text-slate-800',
                                        )}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </ScrollTabStrip>
                        </div>

                        <div className="flex-1 overflow-y-auto p-3 sm:p-5 bg-slate-50/50">
                            {activeTab === 'entry' && (
                                <SingleAssetEntry
                                    asset={selectedAsset}
                                    definitions={selectedDefs}
                                    onSave={handleSaveReadings}
                                    onAddDefinition={canCreate ? handleAddDefinition : undefined}
                                    onOpenAddPoint={canCreate ? setAddPointAssetId : undefined}
                                    readingTypes={readingTypes} // Pass it down
                                    canSave={canCreate}
                                    dueByDef={dueByDef}
                                />
                            )}
                            {activeTab === 'history' && (
                                <TrendAnalysis
                                    definitions={selectedDefs}
                                    logs={logs}
                                    onToggleActive={handleToggleActive}
                                    onMeterChange={handleMeterChange}
                                    initialDefId={deepLinkDefId}
                                    canEdit={canEdit}
                                />
                            )}
                            {activeTab === 'definitions' && (
                                <DefinitionsManager
                                    definitions={selectedDefs}
                                    assetId={selectedAsset.id}
                                    onAdd={handleAddDefinition}
                                    onMeterChange={handleMeterChange}
                                    onDelete={handleDeleteDefinition}
                                    onOpenAddPoint={setAddPointAssetId}
                                    onSuggestBands={handleSuggestBands}
                                    logCountByDef={logs.reduce<Record<string, number>>((m, l) => { if (l.isActive !== false) m[l.definitionId] = (m[l.definitionId] || 0) + 1; return m; }, {})}
                                    readingTypes={readingTypes}
                                    canCreate={canCreate}
                                    canEdit={canEdit}
                                    canDelete={canDelete}
                                />
                            )}
                            {activeTab === 'work' && (
                                <RelatedWork
                                    assetId={selectedAsset.id}
                                    pms={pms.filter(p => p.asset_id === selectedAsset.id || (Array.isArray(p.assigned_assets) && p.assigned_assets.some((a: any) => a.assetId === selectedAsset.id)))}
                                    definitions={selectedDefs}
                                    logs={logs}
                                    onOpenWO={(id) => navigate(`/work-orders/${id}`)}
                                />
                            )}
                        </div>
                    </>
                ) : sheetOpen ? (
                    /* Full-page entry sheet — assets are picked INSIDE the sheet */
                    /* The picker searches the whole (site-scoped) register, not the
                       sidebar's filtered list — a search typed in the hidden sidebar
                       used to silently narrow what the sheet could find. */
                    <BatchEntryView
                        allAssets={assets}
                        allDefinitions={definitions}
                        defsByAsset={defsByAsset}
                        onSave={handleSaveReadings}
                        readingTypes={readingTypes}
                        onAddDefinition={canCreate ? handleAddDefinition : undefined}
                        pickAssets
                        onBack={() => setSheetOpen(false)}
                        onOpenAddPoint={canCreate ? setAddPointAssetId : undefined}
                        onOpenAsset={(id) => { setSheetOpen(false); setSelectedAssetId(id); }}
                        canSave={canCreate}
                        dueByAsset={dueByAsset}
                        dueByDef={dueByDef}
                    />
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-slate-400">
                        <Activity size={40} className="mb-3 opacity-20" />
                        <p className="text-sm font-semibold text-slate-500">Select an asset to view its readings</p>
                        <p className="text-xs mt-1 max-w-xs">…or open a <strong>New Entry Sheet</strong> to record a round across several assets at once.</p>
                    </div>
                )}
            </div>

            {/* GAP-14/21: Meter Change Confirmation Modal */}
            <ConfirmationModal
                isOpen={!!meterChangeDefId}
                onClose={() => setMeterChangeDefId(null)}
                onConfirm={async () => {
                    if (!meterChangeDefId) return;
                    const defId = meterChangeDefId;
                    setMeterChangeDefId(null);
                    const ids = logs.filter(l => l.definitionId === defId && l.isActive !== false).map(l => l.id);
                    try {
                        // Persisted: the reset used to live only in this tab and undo itself on refresh.
                        await DatabaseService.getInstance().setReadingLogsActive(ids, false);
                        setLogs(prev => prev.map(l => l.definitionId === defId ? { ...l, isActive: false } : l));
                        setDefinitions(prev => prev.map(d => d.id === defId ? { ...d, lastReadingValue: 0 } : d));
                        showToast('Meter reset. Previous readings archived.', 'success');
                    } catch (e: any) {
                        showToast('Meter not reset: ' + (e?.message || e), 'error');
                    }
                }}
                title="Replace/Reset Meter?"
                message="This will deactivate previous reading history for averaging. Are you sure you want to proceed?"
                type="warning"
                confirmText="Reset Meter"
            />

            {/* GAP-14/21: Delete Definition Confirmation Modal */}
            <ConfirmationModal
                isOpen={!!deleteDefId}
                onClose={() => setDeleteDefId(null)}
                onConfirm={async () => {
                    if (deleteDefId) {
                        try {
                            await DatabaseService.getInstance().deleteReadingDefinition(deleteDefId);
                            setDefinitions(prev => prev.filter(d => d.id !== deleteDefId));
                            showToast('Reading point retired. Its history is kept.', 'success');
                        } catch (e: any) {
                            showToast('Failed to delete definition: ' + e.message, 'error');
                        }
                        setDeleteDefId(null);
                    }
                }}
                title="Retire Reading Point?"
                message="History will be kept but this reading point will be removed from future entry sheets."
                type="danger"
                confirmText="Retire Point"
            />

            {/* Raise ▾ — Request / Work Order / PM from the focused asset */}
            {raiseKind && selectedAsset && (
                <RaiseWorkModal
                    asset={selectedAsset}
                    kind={raiseKind}
                    actor={profile?.username || profile?.fullName || 'user'}
                    requesterId={profile?.id}
                    faultTypes={faultTypes}
                    contextNote={`Condition Data: ${selectedDefs.length} reading point(s), ${logs.filter(l => l.assetId === selectedAsset.id && l.isAlarm).length} in alarm.`}
                    onClose={() => setRaiseKind(null)}
                />
            )}

            {/* Reading-point editor — proper definition with real alarm bands */}
            {addPointAssetId && (
                <AddReadingPointModal
                    asset={assets.find(a => a.id === addPointAssetId) || null}
                    onClose={() => setAddPointAssetId(null)}
                    onCreate={handleCreateDefinition}
                />
            )}

            {/* Meter-based PM due → one-tap generate the preventive work order */}
            {pmDue.length > 0 && (
                <div className="fixed inset-0 z-[65] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                    <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
                        <div className="px-5 py-3 flex items-center gap-2 bg-primary-600 text-white">
                            <Clock size={18} />
                            <h3 className="font-bold text-sm">Preventive maintenance due{pmDue.length > 1 ? ` (${pmDue.length})` : ''}</h3>
                            <button onClick={() => setPmDue([])} className="ml-auto text-white/80 hover:text-white"><X size={18} /></button>
                        </div>
                        <div className="p-5 space-y-3 max-h-[60vh] overflow-y-auto">
                            <p className="text-xs text-slate-500">A meter reading crossed a service interval. Generate the preventive work order now (it inherits the PM's tasks and advances the schedule).</p>
                            {pmDue.map((d, i) => (
                                <div key={i} className="border border-slate-200 rounded-lg p-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="text-sm font-semibold text-slate-800 truncate">{d.pmTitle}</div>
                                            <div className="text-xs text-slate-500 truncate">{d.assetName} · {d.reading}</div>
                                            <div className="text-[11px] text-slate-400 mt-0.5">{d.basis}</div>
                                        </div>
                                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 flex-shrink-0">DUE</span>
                                    </div>
                                    <Button variant="primary" size="sm" fullWidth className="mt-2" loading={generatingPM} leftIcon={<Plus size={14} />} onClick={() => generatePMWorkOrder(d)}>
                                        Generate PM work order
                                    </Button>
                                </div>
                            ))}
                        </div>
                        <div className="px-5 py-3 border-t border-slate-100 flex justify-end">
                            <Button variant="secondary" size="sm" onClick={() => setPmDue([])}>Dismiss</Button>
                        </div>
                    </div>
                </div>
            )}

            {/* R-4: condition-alarm banner → one-tap corrective WO */}
            {alarmBreaches.length > 0 && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                    <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
                        <div className={`px-5 py-3 flex items-center gap-2 ${alarmBreaches.some(b => b.level === 'CRITICAL') ? 'bg-red-600' : 'bg-amber-500'} text-white`}>
                            <AlertTriangle size={18} />
                            <h3 className="font-bold text-sm">Condition alarm{alarmBreaches.length > 1 ? `s (${alarmBreaches.length})` : ''}</h3>
                            <button onClick={() => setAlarmBreaches([])} className="ml-auto text-white/80 hover:text-white"><X size={18} /></button>
                        </div>
                        <div className="p-5 space-y-3 max-h-[60vh] overflow-y-auto">
                            <p className="text-xs text-slate-500">A reading breached its alarm band. A notification has been raised — you can also create corrective work now.</p>
                            {alarmBreaches.map((b, i) => (
                                <div key={i} className="border border-slate-200 rounded-lg p-3">
                                    <div className="flex items-center justify-between">
                                        <div className="min-w-0">
                                            <div className="text-sm font-semibold text-slate-800 truncate">{b.assetName}</div>
                                            <div className="text-xs text-slate-500">{b.defName}: <span className="font-mono font-bold">{b.value}{b.unit ? ' ' + b.unit : ''}</span> — {b.detail}</div>
                                        </div>
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${b.level === 'CRITICAL' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{b.level}</span>
                                    </div>
                                    <Button variant="primary" size="sm" fullWidth className="mt-2" loading={raisingBreaches.has(b)} disabled={raisingBreaches.has(b)} leftIcon={<Plus size={14} />} onClick={() => raiseWOFromAlarm(b)}>
                                        Raise Request
                                    </Button>
                                </div>
                            ))}
                        </div>
                        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between gap-2">
                            <label className="flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer select-none" title="Automatically raise a maintenance request whenever a reading breaches its critical band. A planner triages it into a work order.">
                                <input type="checkbox" checked={autoRaiseCritical} onChange={e => toggleAutoRaise(e.target.checked)} className="rounded text-primary-600 focus:ring-primary-500 h-3.5 w-3.5" />
                                Auto-raise request on critical
                            </label>
                            <Button variant="secondary" size="sm" onClick={() => setAlarmBreaches([])}>Dismiss</Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// --- Sub-Components ---

const TrendAnalysis: React.FC<{
    definitions: ReadingDefinition[];
    logs: ReadingLogEntry[];
    onToggleActive: (id: string, currentStatus: boolean) => void;
    onMeterChange?: (defId: string) => void;
    /** Point to open first (deep link); ignored when it is not one of this asset's points. */
    initialDefId?: string | null;
    /** readings.edit — gates the Active checkboxes and Meter Replaced. */
    canEdit?: boolean;
}> = ({ definitions, logs, onToggleActive, onMeterChange, initialDefId, canEdit = true }) => {
    const [selectedDefId, setSelectedDefId] = useState<string>(
        (initialDefId && definitions.some(d => d.id === initialDefId)) ? initialDefId : (definitions[0]?.id || ''),
    );
    const selectedDef = definitions.find(d => d.id === selectedDefId);
    useEffect(() => {
        if (initialDefId && definitions.some(d => d.id === initialDefId)) setSelectedDefId(initialDefId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialDefId, definitions.length]);

    // Date-range filter for the chart + history (AMPRO/SAP graph filtering).
    // The preset is tracked so its button highlights — only "All" ever lit up.
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [preset, setPreset] = useState<string>('All');
    const applyPreset = (days: number | null, label: string) => {
        setPreset(label);
        if (days == null) { setFromDate(''); setToDate(''); return; }
        const d = new Date(); d.setDate(d.getDate() - days);
        setFromDate(d.toISOString().slice(0, 10)); setToDate('');
    };

    // Prepare Graph Data - Sorted Ascending for Line Chart (time breaks
    // same-day ties so several rounds a day keep their order).
    const graphData = useMemo(() => {
        if (!selectedDefId) return [];
        return logs
            .filter(l => l.definitionId === selectedDefId) // Show all, visually distinguish inactive
            .sort((a, b) => (new Date(a.date).getTime() - new Date(b.date).getTime()) || (a.time || '').localeCompare(b.time || ''))
            .map(l => ({
                id: l.id,
                date: l.date,
                time: l.time,
                value: l.value,
                delta: l.delta || 0,
                active: l.isActive,
                enteredBy: l.enteredBy,
                valuationCode: l.valuationCode,
                comment: l.comments
            }));
    }, [logs, selectedDefId]);

    // ISO dates compare lexicographically — no Date parsing needed.
    const filteredData = useMemo(() =>
        graphData.filter(d => (!fromDate || d.date >= fromDate) && (!toDate || d.date <= toDate)),
        [graphData, fromDate, toDate]);

    // History table: newest first, 50 rows at a time. The page resets when the
    // point or range changes (keyed, no reset effect).
    const historyRows = useMemo(() => filteredData.slice().reverse(), [filteredData]);
    const historyKey = `${selectedDefId}|${fromDate}|${toDate}`;
    const [historyPage, setHistoryPage] = useState({ key: '', n: HISTORY_PAGE });
    const historyLimit = historyPage.key === historyKey ? historyPage.n : HISTORY_PAGE;

    // Least-squares trend over the visible ACTIVE readings (x = date in ms).
    const trendFit = useMemo(() => {
        const pts = filteredData.filter(d => d.active);
        if (pts.length < 2) return null;
        const xs = pts.map(p => new Date(p.date).getTime());
        const ys = pts.map(p => p.value);
        const n = pts.length;
        const mx = xs.reduce((a, b) => a + b, 0) / n;
        const my = ys.reduce((a, b) => a + b, 0) / n;
        let num = 0, den = 0;
        for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
        if (den === 0) return null;
        const slope = num / den;
        return { slope, intercept: my - slope * mx, perDay: slope * 86400000 };
    }, [filteredData]);

    const chartData = useMemo(() =>
        trendFit
            ? filteredData.map(d => ({ ...d, trend: +(trendFit.intercept + trendFit.slope * new Date(d.date).getTime()).toFixed(2) }))
            : filteredData,
        [filteredData, trendFit]);

    // Meter usage rates — over the visible date range; lifetime cumulative
    // deliberately ignores the filter (it's a total, not a window stat).
    const meterStats = useMemo(() => {
        if (selectedDef?.category !== 'METER') return null;
        const activeData = filteredData.filter(d => d.active);
        // Lifetime cumulative — walks ALL history (inactive rows too) so the
        // total keeps counting through meter replacements (SAP counter
        // semantics): a value lower than its predecessor means the meter was
        // replaced, and the new meter's position counts as fresh usage.
        let cumulative = 0; let prev: number | null = null;
        for (const r of graphData) {
            if (prev != null) cumulative += r.value >= prev ? r.value - prev : r.value;
            prev = r.value;
        }
        // Averages restart at a meter change: they use the active span only,
        // and need at least two active readings.
        if (activeData.length < 2) return { daily: 0, weekly: 0, monthly: 0, yearly: 0, overall: cumulative };
        const first = activeData[0];
        const last = activeData[activeData.length - 1];
        const msDiff = new Date(last.date).getTime() - new Date(first.date).getTime();
        const daysDiff = Math.max(1, msDiff / (1000 * 3600 * 24));
        const daily = (last.value - first.value) / daysDiff;
        return { daily, weekly: daily * 7, monthly: daily * 30.4, yearly: daily * 365, overall: cumulative };
    }, [graphData, filteredData, selectedDef]);

    // Condition points (vibration, temperature…) aren't rates: the four
    // "Average (Daily/Weekly/Monthly/Yearly)" tiles all showed the same mean.
    // Latest / Average / Min / Max is what a condition trend is read by.
    const conditionStats = useMemo(() => {
        if (selectedDef?.category === 'METER') return null;
        // A log with no stored value is not a 0 reading.
        const vals = filteredData.filter(d => d.active && d.value != null && String(d.value).trim() !== '').map(d => Number(d.value)).filter(v => Number.isFinite(v));
        if (vals.length === 0) return null;
        return {
            latest: vals[vals.length - 1],
            avg: vals.reduce((a, b) => a + b, 0) / vals.length,
            min: Math.min(...vals),
            max: Math.max(...vals),
            n: vals.length,
        };
    }, [filteredData, selectedDef]);

    if (!selectedDef) return <div className="text-center p-8 text-slate-400">No reading definitions found for this asset.</div>;

    const unit = <span className="text-sm font-normal opacity-70">{selectedDef.unit}</span>;
    const fmt = (v: number | undefined) => v == null ? '—' : v.toFixed(2);

    return (
        <div className="space-y-6">
            {/* Toolbar */}
            <div className="flex gap-4 items-start bg-slate-50 p-4 rounded-xl border border-slate-200 flex-wrap">
                <div className="flex-1 min-w-[220px]">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Select Reading Type</label>
                    <div className="flex gap-2 flex-wrap">
                        {definitions.map(def => (
                            <button
                                key={def.id}
                                onClick={() => setSelectedDefId(def.id)}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${selectedDefId === def.id ? 'bg-primary-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'}`}
                            >
                                {def.category === 'METER' ? <Clock size={14} className="inline mr-1" /> : <Activity size={14} className="inline mr-1" />}
                                {def.name}
                            </button>
                        ))}
                    </div>
                </div>
                {/* Date range — presets + explicit from/to */}
                <div className="flex-shrink-0">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Date Range</label>
                    <div className="flex items-center gap-1.5 flex-wrap">
                        {([[7, '7d'], [30, '30d'], [90, '90d'], [365, '1y'], [null, 'All']] as [number | null, string][]).map(([days, label]) => (
                            <button key={label} onClick={() => applyPreset(days, label)}
                                className={`text-[11px] font-semibold px-2 py-1 rounded-md border transition ${preset === label ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'}`}>
                                {label}
                            </button>
                        ))}
                        <input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setPreset(''); }} title="From"
                            className="p-1.5 border border-slate-300 rounded-md text-xs bg-white" />
                        <span className="text-slate-400 text-xs">–</span>
                        <input type="date" value={toDate} onChange={e => { setToDate(e.target.value); setPreset(''); }} title="To"
                            className="p-1.5 border border-slate-300 rounded-md text-xs bg-white" />
                    </div>
                </div>
            </div>

            {/* Stats header — usage rates for meters, level stats for condition points */}
            {meterStats ? (
                <div className="bg-slate-800 text-white p-4 rounded-xl shadow-md grid grid-cols-2 md:grid-cols-5 gap-4">
                    {([['Average (Daily)', meterStats.daily], ['Average (Weekly)', meterStats.weekly], ['Average (Monthly)', meterStats.monthly], ['Average (Yearly)', meterStats.yearly]] as [string, number][]).map(([label, v]) => (
                        <div key={label} className="p-2 border-r border-slate-600 last:border-0">
                            <div className="text-[10px] uppercase opacity-70 mb-1">{label}</div>
                            <div className="text-xl font-bold">{v.toFixed(2)}</div>
                        </div>
                    ))}
                    <div className="p-2">
                        <div className="text-[10px] uppercase opacity-70 mb-1">Cumulative (Total)</div>
                        <div className="text-xl font-bold">{meterStats.overall.toFixed(2)} {unit}</div>
                    </div>
                </div>
            ) : (
                <div className="bg-slate-800 text-white p-4 rounded-xl shadow-md grid grid-cols-2 md:grid-cols-4 gap-4">
                    {([['Latest', conditionStats?.latest], [`Average${conditionStats ? ` (${conditionStats.n})` : ''}`, conditionStats?.avg], ['Min', conditionStats?.min], ['Max', conditionStats?.max]] as [string, number | undefined][]).map(([label, v]) => (
                        <div key={label} className="p-2">
                            <div className="text-[10px] uppercase opacity-70 mb-1">{label}</div>
                            <div className="text-xl font-bold">{fmt(v)} {v != null && unit}</div>
                        </div>
                    ))}
                </div>
            )}

            {/* Graph */}
            <div className="bg-white p-4 sm:p-6 rounded-xl border border-slate-200 shadow-sm h-80">
                <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
                    <LineChartIcon size={16} className="text-blue-600" /> Trend Analysis
                    {trendFit && (
                        <span className={`ml-auto text-[11px] font-semibold ${trendFit.perDay > 0 ? 'text-slate-500' : 'text-slate-400'}`} title="Least-squares trend over the visible active readings">
                            Trend {trendFit.perDay >= 0 ? '+' : ''}{trendFit.perDay.toFixed(2)} {selectedDef.unit}/day
                        </span>
                    )}
                </h3>
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                        <defs>
                            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1} />
                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="date" stroke="#64748b" tick={{ fontSize: 12 }} />
                        <YAxis stroke="#64748b" tick={{ fontSize: 12 }} domain={['auto', 'auto']} />
                        <Tooltip
                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        />
                        {/* All four bands, by != null: a truthiness check hid any limit of 0,
                            and the warning bands were never drawn. extendDomain keeps a band
                            visible when the readings sit well inside it. */}
                        {selectedDef.maxCritical != null && <ReferenceLine y={selectedDef.maxCritical} stroke="#dc2626" strokeDasharray="3 3" label="Crit High" ifOverflow="extendDomain" />}
                        {selectedDef.maxWarning != null && <ReferenceLine y={selectedDef.maxWarning} stroke="#f59e0b" strokeDasharray="3 3" label="Warn High" ifOverflow="extendDomain" />}
                        {selectedDef.minWarning != null && <ReferenceLine y={selectedDef.minWarning} stroke="#f59e0b" strokeDasharray="3 3" label="Warn Low" ifOverflow="extendDomain" />}
                        {selectedDef.minCritical != null && <ReferenceLine y={selectedDef.minCritical} stroke="#dc2626" strokeDasharray="3 3" label="Crit Low" ifOverflow="extendDomain" />}
                        <Area
                            type="monotone"
                            dataKey="value"
                            stroke="#2563eb"
                            strokeWidth={2}
                            fillOpacity={1}
                            fill="url(#colorValue)"
                            connectNulls
                        />
                        {trendFit && (
                            <Line type="linear" dataKey="trend" stroke="#64748b" strokeWidth={1.5} strokeDasharray="6 4" dot={false} activeDot={false} name="Trend" />
                        )}
                    </ComposedChart>
                </ResponsiveContainer>
            </div>

            {/* History Table */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
                <div className="p-4 bg-slate-50 border-b border-slate-200 font-bold text-slate-700 text-sm flex flex-wrap justify-between items-center gap-2">
                    <span>Reading History <span className="font-normal text-slate-400">· newest first</span></span>
                    {onMeterChange && selectedDef?.category === 'METER' && canEdit && (
                        <button
                            onClick={() => onMeterChange(selectedDef.id)}
                            className="text-xs bg-white border border-slate-300 px-3 py-1 rounded hover:bg-slate-100 flex items-center gap-1"
                        >
                            <RefreshCcw size={12} /> Meter Replaced?
                        </button>
                    )}
                    {!canEdit && <span className="text-[11px] font-normal text-slate-400">View only — excluding readings or replacing a meter needs edit rights on readings.</span>}
                </div>
                <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-white">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase">Date</th>
                            <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase">Time</th>
                            <th className="px-6 py-3 text-right text-xs font-bold text-slate-500 uppercase">Value ({selectedDef.unit})</th>
                            {selectedDef.category === 'METER' && <th className="px-6 py-3 text-right text-xs font-bold text-slate-500 uppercase">Delta</th>}
                            <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase">Finding</th>
                            <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase">Source</th>
                            <th className="px-6 py-3 text-center text-xs font-bold text-slate-500 uppercase">Active</th>
                            <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase">Comment</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                        {historyRows.length === 0 && (
                            <tr><td colSpan={selectedDef.category === 'METER' ? 8 : 7} className="p-8 text-center text-sm text-slate-400">No readings in this date range.</td></tr>
                        )}
                        {historyRows.slice(0, historyLimit).map(row => (
                            <tr key={row.id} className={`hover:bg-slate-50 ${!row.active ? 'opacity-50 bg-slate-50' : ''}`}>
                                <td className="px-6 py-3 text-sm text-slate-900">{row.date}</td>
                                <td className="px-6 py-3 text-sm text-slate-500">{selectedDef.category === 'METER' ? '—' : (row.time || '—')}</td>
                                <td className="px-6 py-3 text-sm text-right font-bold text-slate-900">{row.value}</td>
                                {selectedDef.category === 'METER' && <td className="px-6 py-3 text-sm text-right text-blue-600">{row.active ? `+${row.delta}` : '-'}</td>}
                                <td className="px-6 py-3">
                                    {(() => {
                                        const v = valuationByCode(row.valuationCode);
                                        return v
                                            ? <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${VALUATION_TONE_CLASSES[v.tone]}`}>{v.label}</span>
                                            : <span className="text-sm text-slate-300">—</span>;
                                    })()}
                                </td>
                                <td className="px-6 py-3 text-sm text-slate-500">{row.enteredBy || '—'}</td>
                                <td className="px-6 py-3 text-center">
                                    <input
                                        type="checkbox"
                                        checked={row.active}
                                        disabled={!canEdit}
                                        onChange={() => onToggleActive(row.id, row.active)}
                                        className={`rounded text-blue-600 focus:ring-primary-500 h-4 w-4 ${canEdit ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                                        title={!canEdit ? 'Needs edit rights on readings' : row.active ? "Click to Deactivate (will cascade)" : "Click to Activate (will restore chain)"}
                                    />
                                </td>
                                <td className="px-6 py-3 text-sm text-slate-500 italic">{row.comment}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {historyRows.length > historyLimit && (
                    <button
                        onClick={() => setHistoryPage({ key: historyKey, n: historyLimit + HISTORY_PAGE })}
                        className="w-full py-3 text-xs font-semibold text-primary-700 hover:bg-primary-50 border-t border-slate-100"
                    >
                        Show more ({historyRows.length - historyLimit} older)
                    </button>
                )}
            </div>
        </div>
    );
};

// --- Entry Components ---

const SingleAssetEntry: React.FC<{
    asset: Asset;
    definitions: ReadingDefinition[];
    readingTypes: DictionaryRecord[];
    onSave: (data: Partial<ReadingLogEntry>[]) => Promise<string[] | void> | void;
    onAddDefinition?: (assetId: string, typeCode: string) => void;
    onOpenAddPoint?: (assetId: string) => void;
    canSave?: boolean;
    dueByDef?: Map<string, DuePointResult>;
}> = ({ asset, definitions, readingTypes, onSave, onAddDefinition, onOpenAddPoint, canSave, dueByDef }) => {
    return (
        <BatchEntryView
            allAssets={[asset]}
            allDefinitions={definitions}
            onSave={onSave}
            onAddDefinition={onAddDefinition}
            onOpenAddPoint={onOpenAddPoint}
            titleOverride="Reading Entry Sheet"
            readingTypes={readingTypes}
            canSave={canSave}
            dueByDef={dueByDef}
        />
    );
};

/** Per-point due state from the rounds engine. */
const PointDueBadge: React.FC<{ r?: DuePointResult }> = ({ r }) => {
    if (!r) return null;
    if (r.status === 'OVERDUE') return <Badge tone="danger" className="flex-shrink-0">Overdue {r.daysOverdue}d</Badge>;
    if (r.status === 'DUE') return <Badge tone="warning" className="flex-shrink-0">Due today</Badge>;
    if (r.status === 'NEVER') return <Badge tone="neutral" className="flex-shrink-0">Never read</Badge>;
    return null;
};

/** '' → null, '1,5' → 1.5 (decimal-comma keypads), junk → NaN. */
const parseReading = (v: unknown): number | null => {
    const raw = String(v ?? '').trim();
    if (!raw) return null;
    // A comma is a decimal point ("12,5") but not a thousands separator:
    // "12,345" would otherwise save as 12.345 and read as a meter replacement.
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw)) return NaN;
    const t = raw.replace(',', '.');
    const n = Number(t);
    return Number.isFinite(n) ? n : NaN;
};

const PICKER_CAP = 50;

const BatchEntryView: React.FC<{
    allAssets: Asset[];
    allDefinitions: ReadingDefinition[];
    /** Points indexed by asset (parent's map) — saves re-filtering per asset. */
    defsByAsset?: Map<string, ReadingDefinition[]>;
    onSave: (data: Partial<ReadingLogEntry>[]) => Promise<string[] | void> | void;
    onAddDefinition?: (assetId: string, typeCode: string) => void;
    onOpenAddPoint?: (assetId: string) => void;
    titleOverride?: string;
    readingTypes?: DictionaryRecord[]; // Added prop
    /** In-sheet asset picker: the user builds their round by adding assets here. */
    pickAssets?: boolean;
    onBack?: () => void;
    /** Open the asset's detail view (history/analysis/config). */
    onOpenAsset?: (assetId: string) => void;
    /** readings.create — without it the sheet is view-only and says so up front. */
    canSave?: boolean;
    /** Rounds engine output from the parent, so the sheet can say what's due. */
    dueByAsset?: Map<string, AssetDue>;
    dueByDef?: Map<string, DuePointResult>;
}> = ({ allAssets, allDefinitions, defsByAsset, onSave, onAddDefinition, onOpenAddPoint, titleOverride, readingTypes = [], pickAssets = false, onBack, onOpenAsset, canSave = true, dueByAsset, dueByDef }) => {
    const [inputValues, setInputValues] = useState<Record<string, { value: number | string, date: string, time: string, comment: string, finding?: string }>>({});
    const [saving, setSaving] = useState(false);
    // Phone cards collapse date/time to "Now"; these are the ones opened for editing.
    const [editingWhen, setEditingWhen] = useState<Set<string>>(new Set());

    // Add New Reading State
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [selectedType, setSelectedType] = useState('');

    // In-sheet picker state (pickAssets mode)
    const [sheetAssetIds, setSheetAssetIds] = useState<string[]>([]);
    const [pickerText, setPickerText] = useState('');

    const defsIndex = useMemo(() => {
        if (defsByAsset) return defsByAsset;
        const m = new Map<string, ReadingDefinition[]>();
        for (const d of allDefinitions) {
            const arr = m.get(d.assetId);
            if (arr) arr.push(d); else m.set(d.assetId, [d]);
        }
        return m;
    }, [defsByAsset, allDefinitions]);
    const activeDefsOf = (assetId: string) => (defsIndex.get(assetId) || NO_DEFS).filter(d => d.isActive);
    const pointCount = (assetId: string) => (defsIndex.get(assetId) || NO_DEFS).reduce((n, d) => n + (d.isActive ? 1 : 0), 0);

    const assetById = useMemo(() => new Map(allAssets.map(a => [a.id, a])), [allAssets]);

    // Sheet order = the order assets were added, so "Add all due" stays
    // most-urgent-first (it used to follow the register's order).
    const sheetAssets = useMemo(
        () => pickAssets
            ? sheetAssetIds.map(id => assetById.get(id)).filter((a): a is Asset => !!a)
            : allAssets,
        [pickAssets, allAssets, assetById, sheetAssetIds],
    );

    // What's due and not yet on the sheet, most urgent first. The sheet used
    // to open on a blank search box that hid all of this.
    const dueAssets = useMemo(() => {
        if (!pickAssets || !dueByAsset) return [];
        const onSheet = new Set(sheetAssetIds);
        return allAssets
            .filter(a => !onSheet.has(a.id))
            .filter(a => { const d = dueByAsset.get(a.id); return !!d && (d.overdue + d.due) > 0; })
            .sort((a, b) => (dueScore(dueByAsset.get(b.id)) - dueScore(dueByAsset.get(a.id))) || (a.tag || a.name).localeCompare(b.tag || b.name));
    }, [pickAssets, dueByAsset, allAssets, sheetAssetIds]);
    const addAllDue = () => setSheetAssetIds(prev => [...prev, ...dueAssets.map(a => a.id)]);

    const pickerMatches = useMemo(() => {
        if (!pickAssets) return { list: [] as Asset[], more: 0 };
        const q = pickerText.trim().toLowerCase();
        if (!q) return { list: [] as Asset[], more: 0 };
        const onSheet = new Set(sheetAssetIds);
        const hits = allAssets
            .filter(a => !onSheet.has(a.id))
            .filter(a => a.tag?.toLowerCase().includes(q) || a.name?.toLowerCase().includes(q))
            .sort((a, b) => dueScore(dueByAsset?.get(b.id)) - dueScore(dueByAsset?.get(a.id)));
        return { list: hits.slice(0, PICKER_CAP), more: Math.max(0, hits.length - PICKER_CAP) };
    }, [pickAssets, allAssets, sheetAssetIds, pickerText, dueByAsset]);

    const pickerRow = (a: Asset, onPick: () => void) => {
        const nPts = pointCount(a.id);
        return (
            <button key={a.id} onClick={onPick}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-primary-50 text-sm">
                <span className="min-w-0 truncate">
                    <span className="font-bold text-slate-800">{a.tag}</span>
                    <span className="text-slate-500"> — {a.name}</span>
                </span>
                <span className="shrink-0 flex items-center gap-1.5">
                    <DueBadge due={dueByAsset?.get(a.id)} />
                    <span className={`text-[10px] font-semibold ${nPts ? 'text-slate-500' : 'text-amber-600'}`}>{nPts ? `${nPts} pts` : 'no points'}</span>
                </span>
            </button>
        );
    };

    // Shared results dropdown — the picker renders in two places (centered hero on
    // an empty sheet, compact top bar once assets are added) but is one search.
    // Searches the whole register; it stopped at 8 hits with no way to see more.
    const pickerDropdown = pickerText.trim() ? (
        pickerMatches.list.length > 0 ? (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-20 max-h-80 overflow-y-auto divide-y divide-slate-50">
                {pickerMatches.list.map(a => pickerRow(a, () => { setSheetAssetIds(prev => [...prev, a.id]); setPickerText(''); }))}
                {pickerMatches.more > 0 && (
                    <div className="px-3 py-2 text-[11px] text-slate-400">{pickerMatches.more} more — refine the search.</div>
                )}
            </div>
        ) : (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-20 px-3 py-2.5 text-xs text-slate-400">
                No matching assets — check the tag or name.
            </div>
        )
    ) : null;

    const rows = useMemo(() => {
        const result: { asset: Asset, def: ReadingDefinition }[] = [];
        sheetAssets.forEach(asset => {
            (defsIndex.get(asset.id) || NO_DEFS).forEach(def => {
                if (def.isActive) result.push({ asset, def });
            });
        });
        return result;
    }, [sheetAssets, defsIndex]);

    // Only values for points still on the sheet count and save — removing an
    // asset's chip used to leave its typed values in state, and Save All sent them.
    const filledIds = useMemo(() => rows
        .map(r => r.def.id)
        .filter(id => parseReading(inputValues[id]?.value) != null), [rows, inputValues]);
    const validIds = filledIds.filter(id => !Number.isNaN(parseReading(inputValues[id]?.value)));
    const filledCount = validIds.length;

    // Available Types for Add Modal (If single asset)
    const singleAsset = !pickAssets && allAssets.length === 1 ? allAssets[0] : null;

    // Filter from PASSED readingTypes prop, not MOCK
    const availableTypes = singleAsset ? readingTypes.filter(d =>
        d.type === 'READING_TYPE' &&
        // d.active && // Managed when passing prop
        !allDefinitions.some(def => def.assetId === singleAsset.id && def.readingTypeCode === d.code)
    ) : [];

    const handleInputChange = (defId: string, field: string, val: any) => {
        setInputValues(prev => ({
            ...prev,
            [defId]: {
                ...prev[defId],
                [field]: val
            }
        }));
    };

    const handleSaveBatch = async () => {
        if (!canSave || saving) return;
        const payload: Partial<ReadingLogEntry>[] = validIds.map(defId => {
            const entry = inputValues[defId];
            return {
                definitionId: defId,
                value: parseReading(entry.value) as number,
                date: entry.date || new Date().toISOString().split('T')[0],
                time: entry.time || new Date().toTimeString().split(' ')[0].substring(0, 5),
                comments: entry.comment,
                valuationCode: entry.finding || undefined
            };
        });
        if (payload.length === 0) return;
        setSaving(true);
        try {
            const failed = new Set((await onSave(payload)) || []);
            const saved = new Set(validIds.filter(id => !failed.has(id)));
            // Clear what saved; keep what didn't so nobody retypes a round.
            setInputValues(prev => Object.fromEntries(Object.entries(prev).filter(([defId]) => !saved.has(defId))));
            setEditingWhen(prev => new Set([...prev].filter(id => !saved.has(id))));
        } finally {
            setSaving(false);
        }
    };

    const handleAdd = () => {
        if (selectedType && singleAsset && onAddDefinition) {
            onAddDefinition(singleAsset.id, selectedType);
            setIsAddOpen(false);
            setSelectedType('');
        }
    };

    const saveLabel = `Save ${filledCount} reading${filledCount === 1 ? '' : 's'}`;
    const viewOnlyNote = 'View only — recording readings needs create rights on readings.';
    const invalid = (defId: string) => Number.isNaN(parseReading(inputValues[defId]?.value));

    const addAllDueButton = dueAssets.length > 0 && (
        <Button variant="secondary" size="sm" onClick={addAllDue} leftIcon={<Clock size={14} />}
            title="Add every asset with overdue or due points, most urgent first">
            Add all due ({dueAssets.length})
        </Button>
    );

    return (
        <div className="flex flex-col h-full relative">
            <div className="p-4 sm:p-6 border-b border-slate-200 bg-white flex flex-wrap justify-between items-center gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    {onBack && (
                        <button onClick={onBack} className="flex items-center gap-1 text-xs font-bold text-slate-600 hover:text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 hover:bg-slate-50" title="Back to the asset browser">
                            ← Assets
                        </button>
                    )}
                    <div className="min-w-0">
                        <h1 className="text-lg sm:text-xl font-bold text-slate-900">{titleOverride || 'Readings Entry Sheet'}</h1>
                        <p className="text-sm text-slate-500">{pickAssets ? `${sheetAssets.length} asset${sheetAssets.length === 1 ? '' : 's'} · ${rows.length} points` : `Record data for ${rows.length} points.`}</p>
                    </div>
                </div>
                <div className="flex gap-2 items-center">
                    {singleAsset && (onOpenAddPoint || onAddDefinition) && (
                        <Button
                            onClick={() => onOpenAddPoint ? onOpenAddPoint(singleAsset.id) : setIsAddOpen(true)}
                            variant="secondary"
                            leftIcon={<Plus size={16} />}
                        >
                            Add Reading Point
                        </Button>
                    )}
                    {/* Phones save from the sticky bar at the bottom instead. */}
                    <div className="hidden sm:block">
                        <Button
                            onClick={handleSaveBatch}
                            loading={saving}
                            disabled={!canSave || filledCount === 0}
                            leftIcon={<Save size={16} />}
                            title={!canSave ? viewOnlyNote : filledCount === 0 ? 'Type at least one value' : undefined}
                        >
                            Save All{filledCount > 0 ? ` (${filledCount})` : ''}
                        </Button>
                    </div>
                </div>
            </div>
            {!canSave && (
                <div className="px-4 sm:px-6 py-2 text-xs text-slate-500 bg-slate-50 border-b border-slate-200">{viewOnlyNote}</div>
            )}
            {/* In-sheet asset picker (compact bar) — once the sheet has assets. An
                empty sheet shows the centered hero picker below instead. */}
            {pickAssets && sheetAssets.length > 0 && (
                <div className="px-4 sm:px-6 py-3 border-b border-slate-200 bg-slate-50/60">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="relative flex-1 min-w-[220px] max-w-md">
                            <Search className="absolute left-3 top-2.5 text-slate-500" size={15} />
                            <input
                                value={pickerText}
                                onChange={e => setPickerText(e.target.value)}
                                placeholder="Add another asset — search tag or name…"
                                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                            />
                            {pickerDropdown}
                        </div>
                        {addAllDueButton}
                        {sheetAssets.map(a => (
                            <span key={a.id} className="flex items-center gap-0.5 pl-2.5 bg-white border border-primary-200 text-primary-700 rounded-full text-xs font-bold">
                                <button onClick={() => onOpenAsset?.(a.id)} className="hover:underline" title="Open asset detail (history & configuration)">{a.tag}</button>
                                <button onClick={() => setSheetAssetIds(prev => prev.filter(id => id !== a.id))}
                                    className="w-8 h-8 rounded-full hover:bg-primary-100 flex items-center justify-center" title="Remove from sheet" aria-label={`Remove ${a.tag} from sheet`}>
                                    <X size={14} />
                                </button>
                            </span>
                        ))}
                    </div>
                </div>
            )}
            <div className="flex-1 overflow-y-auto bg-slate-50/50">
                {/* Added assets with no reading points: configure them right here */}
                {pickAssets && sheetAssets.filter(a => pointCount(a.id) === 0).map(a => (
                    <div key={a.id} className="mx-4 sm:mx-6 mt-3 flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-relantern-50 border border-relantern-200 rounded-xl">
                        <span className="text-sm text-slate-700">
                            <strong>{a.tag}</strong> — {a.name}: <span className="text-slate-500">no reading points yet.</span>
                        </span>
                        {onOpenAddPoint ? (
                            <button onClick={() => onOpenAddPoint(a.id)}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-relantern-500 hover:bg-relantern-600 text-white">
                                <Plus size={12} /> Add reading point
                            </button>
                        ) : (
                            <span className="text-xs text-slate-500">Your role can't add reading points.</span>
                        )}
                    </div>
                ))}
                {/* Empty sheet → centered hero picker, with what's due right under it */}
                {pickAssets && sheetAssets.length === 0 && (
                    <div className="min-h-full flex flex-col items-center justify-center text-center p-6 sm:p-8">
                        <Activity size={36} className="mb-3 text-slate-300" />
                        <p className="text-lg font-bold text-slate-800">Find an asset · capture its readings</p>
                        <p className="text-xs mt-1.5 max-w-sm text-slate-500">Search the register and add assets to this sheet — their reading points stack below as one round. Assets marked <span className="text-amber-600 font-semibold">no points</span> need a reading point configured first.</p>
                        <div className="relative w-full max-w-lg mt-6 text-left">
                            <Search className="absolute left-4 top-3.5 text-slate-400" size={18} />
                            <input
                                autoFocus
                                value={pickerText}
                                onChange={e => setPickerText(e.target.value)}
                                placeholder="Find asset — search tag or name…"
                                className="w-full pl-11 pr-4 py-3 border border-slate-300 rounded-xl text-sm bg-white shadow-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                            />
                            {pickerDropdown}
                        </div>
                        {dueByAsset && (
                            dueAssets.length > 0 ? (
                                <div className="w-full max-w-lg mt-5 text-left">
                                    <div className="flex items-center justify-between gap-2 mb-2">
                                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Due now</span>
                                        <Button size="sm" onClick={addAllDue} leftIcon={<Clock size={14} />}>Add all due ({dueAssets.length})</Button>
                                    </div>
                                    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
                                        {dueAssets.slice(0, 6).map(a => pickerRow(a, () => setSheetAssetIds(prev => [...prev, a.id])))}
                                    </div>
                                    {dueAssets.length > 6 && <p className="text-[11px] text-slate-400 mt-1.5">+{dueAssets.length - 6} more in “Add all due”.</p>}
                                </div>
                            ) : (
                                <p className="text-xs text-slate-400 mt-5">Nothing overdue or due today — rounds are clear.</p>
                            )
                        )}
                    </div>
                )}
                {!pickAssets && rows.length === 0 && (
                    <div className="p-10 text-center text-sm text-slate-400">
                        {singleAsset && (onOpenAddPoint || onAddDefinition)
                            ? <>No reading points on this asset yet. Click <span className="font-semibold text-slate-500">Add Reading Point</span> to define one (e.g. Bearing Vibration, mm/s, with warning/critical limits).</>
                            : <>No reading points on this asset yet.</>}
                    </div>
                )}
                {/* fieldset: a view-only role sees the points but can't type into them.
                    min-w-0 overrides fieldset's min-content width, which defeats overflow-x. */}
                {rows.length > 0 && (
                    <fieldset disabled={!canSave} className="min-w-0">
                        {/* Phone: one card per point — a 7-column table needed sideways scrolling to reach Value. */}
                        <div className="sm:hidden p-3 space-y-4">
                            {sheetAssets.map(asset => {
                                const defs = activeDefsOf(asset.id);
                                if (defs.length === 0) return null;
                                return (
                                    <section key={asset.id}>
                                        {pickAssets && (
                                            <div className="flex items-center justify-between gap-2 px-1 mb-2">
                                                <div className="min-w-0">
                                                    <div className="font-bold text-sm text-slate-900 truncate">{asset.tag}</div>
                                                    <div className="text-xs text-slate-500 truncate">{asset.name}</div>
                                                </div>
                                                <DueBadge due={dueByAsset?.get(asset.id)} className="flex-shrink-0" />
                                            </div>
                                        )}
                                        <div className="space-y-2">
                                            {defs.map(def => {
                                                const cur = inputValues[def.id] || { value: '', date: '', time: '', comment: '' };
                                                const isMeter = def.category === 'METER';
                                                const editing = editingWhen.has(def.id);
                                                const whenLabel = (cur.date || cur.time) ? `${cur.date || 'Today'}${!isMeter && cur.time ? ' ' + cur.time : ''}` : 'Now';
                                                return (
                                                    <div key={def.id} className="bg-white border border-slate-200 rounded-xl p-3">
                                                        <div className="flex items-start justify-between gap-2">
                                                            <div className="min-w-0">
                                                                <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                                                                    {isMeter ? <Clock size={14} className="text-blue-500 flex-shrink-0" /> : <Activity size={14} className="text-blue-500 flex-shrink-0" />}
                                                                    <span className="truncate">{def.name}</span>
                                                                </div>
                                                                <div className="text-xs text-slate-500 mt-0.5">
                                                                    Last <span className="font-bold text-slate-700">{def.lastReadingValue ?? '—'}</span> {def.unit} · {def.lastReadingDate || 'never'}
                                                                </div>
                                                            </div>
                                                            <PointDueBadge r={dueByDef?.get(def.id)} />
                                                        </div>
                                                        <div className="mt-2.5 flex items-center gap-2">
                                                            <input
                                                                type="text"
                                                                inputMode="decimal"
                                                                enterKeyHint="next"
                                                                placeholder="Value"
                                                                aria-label={`${def.name} value`}
                                                                className={cn('flex-1 min-w-0 h-12 px-3 border rounded-lg text-lg font-bold text-right bg-white focus:ring-2 focus:ring-primary-500 outline-none', invalid(def.id) ? 'border-red-400' : 'border-slate-300')}
                                                                value={cur.value}
                                                                onChange={(e) => handleInputChange(def.id, 'value', e.target.value)}
                                                            />
                                                            {/* Decimal keypads have no minus key; condition values can be negative. */}
                                                            {!isMeter && (
                                                                <button type="button"
                                                                    onClick={() => { const v = String(cur.value ?? '').trim(); handleInputChange(def.id, 'value', v.startsWith('-') ? v.slice(1) : '-' + v); }}
                                                                    className="h-12 w-11 flex-shrink-0 border border-slate-300 rounded-lg text-lg font-bold text-slate-500 bg-white active:bg-slate-100"
                                                                    title="Switch sign" aria-label="Switch sign">±</button>
                                                            )}
                                                            <span className="w-12 flex-shrink-0 text-sm text-slate-500 truncate">{def.unit}</span>
                                                        </div>
                                                        <select
                                                            value={cur.finding || ''}
                                                            onChange={(e) => handleInputChange(def.id, 'finding', e.target.value)}
                                                            className={cn('mt-2 w-full h-11 px-2 border rounded-lg text-sm bg-white', cur.finding ? 'border-slate-300 text-slate-700 font-semibold' : 'border-slate-200 text-slate-400')}
                                                            aria-label="Finding"
                                                        >
                                                            <option value="">— finding (optional) —</option>
                                                            {VALUATION_CODES.map(v => <option key={v.code} value={v.code}>{v.label}</option>)}
                                                        </select>
                                                        {editing ? (
                                                            <div className="mt-2 flex items-center gap-2">
                                                                <input type="date" aria-label="Date"
                                                                    className="flex-1 min-w-0 h-11 px-2 border border-slate-300 rounded-lg text-sm bg-white"
                                                                    value={cur.date} onChange={(e) => handleInputChange(def.id, 'date', e.target.value)} />
                                                                {!isMeter && (
                                                                    <input type="time" aria-label="Time"
                                                                        className="w-28 h-11 px-2 border border-slate-300 rounded-lg text-sm bg-white"
                                                                        value={cur.time} onChange={(e) => handleInputChange(def.id, 'time', e.target.value)} />
                                                                )}
                                                                <button type="button"
                                                                    onClick={() => { handleInputChange(def.id, 'date', ''); handleInputChange(def.id, 'time', ''); setEditingWhen(prev => { const n = new Set(prev); n.delete(def.id); return n; }); }}
                                                                    className="h-11 px-2 text-xs font-semibold text-primary-700">Now</button>
                                                            </div>
                                                        ) : (
                                                            <button type="button"
                                                                onClick={() => setEditingWhen(prev => new Set(prev).add(def.id))}
                                                                className="mt-1.5 min-h-[32px] flex items-center gap-1.5 text-xs text-slate-500">
                                                                <Clock size={12} /> {whenLabel} <span className="font-semibold text-primary-700">· change</span>
                                                            </button>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </section>
                                );
                            })}
                        </div>

                        <div className="hidden sm:block overflow-x-auto">
                            <table className="min-w-full divide-y divide-slate-200 border-b border-slate-200">
                                <thead className="bg-slate-100 sticky top-0 z-10 shadow-sm">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-40">Asset</th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-28">Type</th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-20">Last</th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-auto">Date</th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Value</th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-40">Finding</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-slate-200">
                                    {rows.map(({ asset, def }) => {
                                        const currentInput = inputValues[def.id] || { value: '', date: '', time: '', comment: '' };
                                        return (
                                            <tr key={def.id} className="hover:bg-blue-50 transition-colors group">
                                                <td className="px-4 py-3">
                                                    <div className="font-bold text-sm text-slate-900">{asset.tag}</div>
                                                    <div className="text-xs text-slate-500 truncate max-w-[150px]">{asset.name}</div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-2">
                                                        {def.category === 'METER' ? <Clock size={14} className="text-blue-500" /> : <Activity size={14} className="text-blue-500" />}
                                                        <span className="text-sm font-medium text-slate-700 truncate max-w-[120px]">{def.name}</span>
                                                    </div>
                                                    <div className="text-[10px] text-slate-400 mt-0.5">{def.unit}</div>
                                                </td>
                                                <td className="px-4 py-3 bg-slate-50">
                                                    <div className="text-sm font-bold text-slate-700 whitespace-nowrap">{def.lastReadingValue ?? '-'} <span className="text-xs font-normal text-slate-500">{def.unit}</span></div>
                                                    <div className="text-xs text-slate-400 whitespace-nowrap">{def.lastReadingDate || 'Never'}</div>
                                                    <div className="mt-1"><PointDueBadge r={dueByDef?.get(def.id)} /></div>
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap">
                                                    <div className="flex flex-nowrap gap-2 items-center">
                                                        <input
                                                            type="date"
                                                            className="w-24 p-2 border border-slate-200 rounded text-xs focus:ring-2 focus:ring-primary-500 focus:border-blue-500 outline-none transition-all shadow-sm bg-white"
                                                            value={currentInput.date}
                                                            onChange={(e) => handleInputChange(def.id, 'date', e.target.value)}
                                                        />
                                                        {def.category !== 'METER' && (
                                                            <input
                                                                type="time"
                                                                className="w-16 p-2 border border-slate-200 rounded text-xs focus:ring-2 focus:ring-primary-500 focus:border-blue-500 outline-none transition-all shadow-sm bg-white"
                                                                value={currentInput.time}
                                                                onChange={(e) => handleInputChange(def.id, 'time', e.target.value)}
                                                            />
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap">
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        placeholder="0.00"
                                                        className={cn('w-24 p-2 border rounded text-sm font-bold text-right focus:ring-2 focus:ring-primary-500 focus:border-blue-500 outline-none transition-all shadow-sm bg-white', invalid(def.id) ? 'border-red-400' : 'border-slate-200')}
                                                        value={currentInput.value}
                                                        onChange={(e) => handleInputChange(def.id, 'value', e.target.value)}
                                                    />
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap">
                                                    {/* Coded finding (SAP valuation code) — what was observed, countable later */}
                                                    <select
                                                        value={currentInput.finding || ''}
                                                        onChange={(e) => handleInputChange(def.id, 'finding', e.target.value)}
                                                        className={`w-36 p-2 border rounded text-xs focus:ring-2 focus:ring-primary-500 outline-none transition-all shadow-sm bg-white ${currentInput.finding ? 'border-slate-300 text-slate-700 font-semibold' : 'border-slate-200 text-slate-400'}`}
                                                        title="Coded finding — what you observed while taking the reading"
                                                    >
                                                        <option value="">— finding —</option>
                                                        {VALUATION_CODES.map(v => <option key={v.code} value={v.code}>{v.label}</option>)}
                                                    </select>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </fieldset>
                )}
            </div>

            {/* Phone save bar — stays in reach at the bottom of a long round. */}
            {rows.length > 0 && (
                <div className="sm:hidden sticky bottom-0 z-20 border-t border-slate-200 bg-white px-3 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
                    {canSave ? (
                        <Button fullWidth size="lg" onClick={handleSaveBatch} loading={saving} disabled={filledCount === 0} leftIcon={<Save size={18} />}>
                            {filledCount === 0 ? 'Type a value to save' : saveLabel}
                        </Button>
                    ) : (
                        <p className="text-xs text-slate-500 text-center py-2">{viewOnlyNote}</p>
                    )}
                </div>
            )}

            {/* Inline Modal for adding readings */}
            {isAddOpen && (
                <div className="absolute top-20 right-4 left-4 sm:left-auto sm:w-96 bg-white rounded-xl shadow-2xl border border-slate-200 z-50 animate-in fade-in slide-in-from-top-4">
                    <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                        <h4 className="text-sm font-bold text-slate-900">Add New Reading Point</h4>
                        <button onClick={() => setIsAddOpen(false)}><X size={16} className="text-slate-400 hover:text-slate-600" /></button>
                    </div>
                    <div className="p-4">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Reading Type</label>
                        <select
                            className="w-full p-2 border border-slate-300 rounded-lg text-sm mb-4"
                            value={selectedType}
                            onChange={(e) => setSelectedType(e.target.value)}
                        >
                            <option value="">-- Select --</option>
                            {availableTypes.map(t => (
                                <option key={t.id} value={t.code}>{t.description} ({t.categoryCode})</option>
                            ))}
                        </select>
                        <Button
                            disabled={!selectedType}
                            onClick={handleAdd}
                            fullWidth
                        >
                            Add to Entry Sheet
                        </Button>
                        {availableTypes.length === 0 && <p className="text-xs text-blue-600 mt-2 text-center">All dictionary types are already added.</p>}
                    </div>
                </div>
            )}
        </div>
    );
};

const DefinitionsManager: React.FC<{
    definitions: ReadingDefinition[];
    assetId: string;
    readingTypes: DictionaryRecord[];
    onAdd: (assetId: string, typeCode: string) => void;
    onMeterChange: (id: string) => void;
    onDelete: (id: string) => void;
    onOpenAddPoint: (assetId: string) => void;
    /** learned-baseline suggestion (1.5.2) — proposes bands from the point's own logs */
    onSuggestBands?: (def: ReadingDefinition) => void;
    logCountByDef?: Record<string, number>;
    /** readings.create / edit / delete — controls a role can't use are hidden, with one line saying why. */
    canCreate?: boolean;
    canEdit?: boolean;
    canDelete?: boolean;
}> = ({ definitions, assetId, readingTypes, onAdd, onMeterChange, onDelete, onOpenAddPoint, onSuggestBands, logCountByDef = {}, canCreate = true, canEdit = true, canDelete = true }) => {
    const [isAddOpen, setIsAddOpen] = useState(false);
    const missing = [!canCreate && 'add', !canEdit && 'change', !canDelete && 'retire'].filter(Boolean) as string[];
    const [selectedType, setSelectedType] = useState('');

    const availableTypes = readingTypes.filter(d =>
        d.type === 'READING_TYPE' &&
        // d.active && // Handled upstream
        !definitions.some(def => def.readingTypeCode === d.code)
    );

    const handleAdd = () => {
        if (selectedType) {
            onAdd(assetId, selectedType);
            setIsAddOpen(false);
            setSelectedType('');
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-end gap-2">
                {/* Said up front: these used to show and then refuse after the click. */}
                {missing.length > 0 && (
                    <span className="mr-auto text-[11px] text-slate-400">Your role can't {missing.join(' / ')} reading points — those controls are hidden.</span>
                )}
                {canCreate && (
                    <button
                        onClick={() => onOpenAddPoint ? onOpenAddPoint(assetId) : setIsAddOpen(true)}
                        className="text-xs bg-primary-600 text-white px-3 py-1.5 rounded hover:bg-primary-500 flex items-center gap-1"
                    >
                        <Plus size={14} /> Add Point
                    </button>
                )}
            </div>

            {isAddOpen && (
                <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg animate-in fade-in slide-in-from-top-2">
                    <div className="flex justify-between items-center mb-2">
                        <h4 className="text-sm font-bold text-blue-900">Add New Reading Point</h4>
                        <button onClick={() => setIsAddOpen(false)}><X size={16} className="text-blue-400 hover:text-blue-600" /></button>
                    </div>
                    <div className="flex gap-2">
                        <select
                            className="flex-1 p-2 border border-blue-300 rounded text-sm"
                            value={selectedType}
                            onChange={(e) => setSelectedType(e.target.value)}
                        >
                            <option value="">-- Select Reading Type --</option>
                            {availableTypes.map(t => (
                                <option key={t.id} value={t.code}>{t.description} ({t.categoryCode})</option>
                            ))}
                        </select>
                        <button
                            disabled={!selectedType}
                            onClick={handleAdd}
                            className="bg-primary-600 text-white px-4 py-2 rounded text-sm font-bold hover:bg-primary-500 disabled:opacity-50"
                        >
                            Add
                        </button>
                    </div>
                    {availableTypes.length === 0 && <p className="text-xs text-blue-600 mt-2">No more reading types available in dictionary.</p>}
                </div>
            )}

            {definitions.map(def => {
                const hasBands = def.minCritical != null || def.minWarning != null || def.maxWarning != null || def.maxCritical != null;
                const src = limitSourceLabel(def.limitSource);
                const srcTone = src.tone === 'standard' ? 'bg-blue-50 text-blue-700 border-blue-200'
                    : src.tone === 'learned' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : src.tone === 'template' ? 'bg-slate-50 text-slate-600 border-slate-200'
                    : src.tone === 'manual' ? 'bg-slate-50 text-slate-500 border-slate-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200';
                const canSuggest = canEdit && def.category === 'CONDITION' && onSuggestBands && (logCountByDef[def.id] || 0) >= MIN_BASELINE_READINGS;
                return (
                <div key={def.id} className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex flex-wrap justify-between items-center gap-3">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-bold text-slate-900">{def.name}</h4>
                            {def.category === 'METER' ? <Clock size={14} className="text-blue-500" /> : <Activity size={14} className="text-blue-500" />}
                            {/* Band provenance (1.5.3): every limit cites its source */}
                            {hasBands && (
                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${srcTone}`} title="Where these alarm bands came from">
                                    {src.text}
                                </span>
                            )}
                        </div>
                        <div className="text-xs text-slate-500">
                            Unit: {def.unit} | Limits: {def.minCritical ?? '-'} <span className="text-amber-500">⚠{def.maxWarning ?? '-'}</span> / <span className="text-red-400">{def.maxCritical ?? '-'}</span>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                        <div className="text-right sm:mr-4">
                            <div className="text-xs text-slate-400 uppercase">Current</div>
                            <div className="font-bold text-slate-900">{def.lastReadingValue ?? '-'} {def.unit}</div>
                        </div>
                        {canSuggest && (
                            <button
                                onClick={() => onSuggestBands!(def)}
                                className="px-3 py-1.5 border border-emerald-300 bg-emerald-50 rounded text-xs font-medium hover:bg-emerald-100 text-emerald-700"
                                title={`Propose warning/critical limits from this point's ${logCountByDef[def.id]} logged readings (μ+2σ / μ+3σ) — you approve before anything changes`}
                            >
                                Suggest limits
                            </button>
                        )}
                        {def.category === 'METER' && canEdit && (
                            <button
                                onClick={() => onMeterChange(def.id)}
                                className="px-3 py-1.5 border border-slate-300 rounded text-xs font-medium hover:bg-slate-50 flex items-center gap-1 text-slate-700"
                                title="Reset meter or replace component"
                            >
                                <RefreshCcw size={12} /> Meter Change
                            </button>
                        )}
                        {canDelete && (
                            <button onClick={() => onDelete(def.id)} className="p-2 -m-2 text-slate-400 hover:text-red-600" title="Retire reading point (history is kept)" aria-label={`Retire ${def.name}`}><Trash2 size={16} /></button>
                        )}
                    </div>
                </div>
                );
            })}
            {definitions.length === 0 && !isAddOpen && (
                <div className="text-center py-8 text-slate-400 border border-dashed border-slate-200 rounded-lg">
                    No reading points defined for this asset. Add one to start tracking.
                </div>
            )}
        </div>
    );
};

// ── Related Work ─────────────────────────────────────────────────────────────
// Ties condition data to Work Management: the asset's open work orders and its
// maintenance strategies (PMs), so the reading context connects to the work.
const RelatedWork: React.FC<{
    assetId: string; pms: any[];
    definitions: ReadingDefinition[]; logs: ReadingLogEntry[];
    onOpenWO: (id: string) => void;
}> = ({ assetId, pms, definitions, logs, onOpenWO }) => {
    const [wos, setWos] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    // SAP-style due forecasting for meter PMs: latest meter value + observed
    // usage/day → projected due date, so the scheduler sees it weeks ahead
    // instead of only when the reading actually crosses the interval.
    const forecasts = useMemo(() => {
        const map = new Map<string, MeterPMForecast>();
        const meterDefs = definitions.filter(d => d.isActive && d.category === 'METER');
        for (const p of pms) {
            if (p.active === false || (p.status || '').toUpperCase() === 'INACTIVE') continue;
            const mp: MeterPM = {
                id: p.id,
                title: p.title || p.code || 'PM',
                scheduleType: p.schedule_type,
                frequencyType: p.frequency_type,
                interval: Number(p.frequency_interval ?? p.interval ?? 0),
                unit: p.frequency_unit || p.frequency_type || '',
                baseline: Array.isArray(p.assigned_assets)
                    ? (p.assigned_assets.find((a: any) => a.assetId === assetId)?.lastReadingValue ?? null)
                    : null,
            };
            if (!isMeterSchedule(mp) || !(mp.interval > 0)) continue;
            const def = meterDefs.find(d => matchesReading(mp, { defName: d.name, unit: d.unit, readingTypeCode: d.readingTypeCode, category: 'METER', newValue: 0 }));
            if (!def) continue;
            const defLogs = logs
                .filter(l => l.definitionId === def.id && l.isActive !== false)
                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
            if (defLogs.length === 0) continue;
            const last = defLogs[defLogs.length - 1];
            let dailyRate: number | null = null;
            if (defLogs.length >= 2) {
                const first = defLogs[0];
                const days = Math.max(1, (new Date(last.date).getTime() - new Date(first.date).getTime()) / 86400000);
                dailyRate = (last.value - first.value) / days;
            }
            const f = forecastMeterPM(mp, { value: last.value, date: last.date }, dailyRate);
            if (f) map.set(p.id, f);
        }
        return map;
    }, [pms, definitions, logs, assetId]);

    useEffect(() => {
        let active = true;
        (async () => {
            setLoading(true);
            try {
                const rows = await DatabaseService.getInstance().getWorkOrdersByAssetId(assetId);
                if (active) setWos(rows || []);
            } catch { if (active) setWos([]); }
            finally { if (active) setLoading(false); }
        })();
        return () => { active = false; };
    }, [assetId]);

    const openWos = wos.filter(w => isOpenWo(w.status));
    const activePMs = pms.filter(p => p.active !== false && (p.status || '').toUpperCase() !== 'INACTIVE');

    const statusTone = (s: string) => {
        const u = (s || '').toUpperCase();
        if (u === 'OPEN' || u === 'WIP') return 'bg-amber-100 text-amber-700';
        if (u.includes('HOLD')) return 'bg-slate-200 text-slate-600';
        return 'bg-blue-100 text-blue-700';
    };

    return (
        <div className="space-y-6">
            {/* Open work orders */}
            <div>
                <div className="flex items-center gap-2 mb-2">
                    <AlertCircle size={15} className="text-primary-600" />
                    <h3 className="text-sm font-bold text-slate-700">Open work orders</h3>
                    <span className="text-[11px] text-slate-400">{openWos.length}</span>
                </div>
                {loading ? (
                    <div className="text-sm text-slate-400 p-4">Loading…</div>
                ) : openWos.length === 0 ? (
                    <div className="text-sm text-slate-400 border border-dashed border-slate-200 rounded-lg p-4 text-center">No open work orders on this asset.</div>
                ) : (
                    <div className="space-y-2">
                        {openWos.map(w => (
                            <button key={w.id} onClick={() => onOpenWO(w.id)} className="w-full text-left bg-white border border-slate-200 rounded-lg p-3 hover:border-primary-300 hover:shadow-sm transition flex items-center gap-3">
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-semibold text-slate-800 truncate">{w.title || w.wo_number}</div>
                                    <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                                        <span className="font-mono">{String(w.wo_number || '').toUpperCase().startsWith('WO-') ? w.wo_number : `WO-${w.wo_number}`}</span>
                                        {w.type && <span>· {w.type}</span>}
                                        {w.due_date && <span>· due {String(w.due_date).slice(0, 10)}</span>}
                                    </div>
                                </div>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${statusTone(w.status)}`}>{(w.status || 'OPEN').toUpperCase()}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Maintenance strategies (PMs) */}
            <div>
                <div className="flex items-center gap-2 mb-2">
                    <RefreshCcw size={15} className="text-primary-600" />
                    <h3 className="text-sm font-bold text-slate-700">Maintenance strategies</h3>
                    <span className="text-[11px] text-slate-400">{activePMs.length}</span>
                </div>
                {activePMs.length === 0 ? (
                    <div className="text-sm text-slate-400 border border-dashed border-slate-200 rounded-lg p-4 text-center">No PM strategies cover this asset yet.</div>
                ) : (
                    <div className="space-y-2">
                        {activePMs.map(p => {
                            const meter = (p.schedule_type || '').toUpperCase() === 'READING';
                            const interval = p.frequency_interval ?? p.interval;
                            const unit = p.frequency_unit || p.frequency_type || '';
                            return (
                                <div key={p.id} className="bg-white border border-slate-200 rounded-lg p-3 flex items-center gap-3">
                                    {meter ? <Clock size={14} className="text-blue-500 flex-shrink-0" /> : <Calendar size={14} className="text-blue-500 flex-shrink-0" />}
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-semibold text-slate-800 truncate">{p.title || p.code}</div>
                                        <div className="text-[11px] text-slate-400">
                                            {interval ? `every ${interval} ${unit}` : unit}
                                            {!meter && p.next_due_date && <span> · next {String(p.next_due_date).slice(0, 10)}</span>}
                                            {meter && (() => {
                                                const f = forecasts.get(p.id);
                                                if (!f) return null;
                                                if (f.daysToDue === 0) return <span className="text-red-600 font-bold"> · due now (meter ≥ {f.dueAt})</span>;
                                                if (f.forecastDate) return <span title={f.basis}> · due at {f.dueAt} — <span className="font-semibold text-slate-600">≈ {f.forecastDate}</span> ({f.remaining} to go)</span>;
                                                return <span> · due at {f.dueAt} ({f.remaining} to go — more readings needed to project a date)</span>;
                                            })()}
                                        </div>
                                    </div>
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${meter ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>{meter ? 'METER' : 'TIME'}</span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

// ── Asset hierarchy tree node (Tree view) ───────────────────────────────────
// Renders an asset and, indented beneath it, its sub-components — so measuring
// points read on a location in the hierarchy (SAP PM / Maximo style), while the
// List view keeps the due-sorted rounds worklist.
const AssetTreeNode: React.FC<{
    asset: Asset; depth: number; isLast: boolean; ancestorLastFlags: boolean[];
    childrenOf: Map<string, Asset[]>; visible: Set<string>;
    selectedId: string | null; forceExpand: boolean; collapsed: Set<string>;
    onToggle: (id: string) => void; onSelect: (id: string) => void;
    dueOf: (id: string) => { due: number; overdue: number; never: number } | undefined;
    pointCountOf: (id: string) => number;
}> = ({ asset, depth, isLast, ancestorLastFlags, childrenOf, visible, selectedId, forceExpand, collapsed, onToggle, onSelect, dueOf, pointCountOf }) => {
    const kids = (childrenOf.get(asset.id) || []).filter(k => visible.has(k.id));
    const hasKids = kids.length > 0;
    const expanded = forceExpand || !collapsed.has(asset.id);
    const due = dueOf(asset.id);
    const pts = pointCountOf(asset.id);
    const isSel = selectedId === asset.id;
    const crit = asset.criticality;
    const critTone = crit === 'A' ? 'border-red-400 text-red-600 bg-red-50'
        : crit === 'B' ? 'border-orange-400 text-orange-600 bg-orange-50'
        : crit === 'C' ? 'border-blue-400 text-blue-600 bg-blue-50' : 'border-slate-300 text-slate-500 bg-slate-50';
    return (
        <>
            <div className={`hierarchy-row ${depth > 0 ? 'hierarchy-expand-enter' : ''} ${isSel ? 'hierarchy-row--selected' : ''}`} style={{ minHeight: '44px' }}>
                {/* Tree connector lines */}
                {depth > 0 && (
                    <>
                        {ancestorLastFlags.map((flagLast, i) => !flagLast && (
                            <div key={`vl-${i}`} className="tree-vline" style={{ left: `calc(8px + ${i} * var(--tree-indent) + var(--tree-line-left))` }} />
                        ))}
                        <div className="tree-hbranch" style={{ left: `calc(8px + ${depth - 1} * var(--tree-indent) + var(--tree-line-left))`, top: 0, height: '100%', width: 'var(--tree-branch-width)' }} />
                        {!isLast && <div className="tree-vline-below" style={{ left: `calc(8px + ${depth - 1} * var(--tree-indent) + var(--tree-line-left))`, top: '50%', height: '50%' }} />}
                    </>
                )}
                {/* Card */}
                <div
                    onClick={() => onSelect(asset.id)}
                    style={{ marginLeft: `calc(8px + ${depth} * var(--tree-indent) + ${depth > 0 ? 'var(--tree-branch-width) + 4px' : '0px'})` }}
                    className={`hierarchy-card hierarchy-card--equipment flex items-center gap-2 px-2 py-1.5 mx-1 my-0.5 cursor-pointer group bg-white ${isSel ? 'hierarchy-card--selected' : ''}`}
                >
                    {/* Expand / collapse */}
                    <div className="flex-shrink-0">
                        {hasKids ? (
                            <button
                                onClick={e => { e.stopPropagation(); onToggle(asset.id); }}
                                className={`w-5 h-5 flex items-center justify-center rounded border transition-all duration-150 ${expanded ? 'bg-emerald-50 border-emerald-300 text-emerald-700 shadow-sm' : 'bg-white border-slate-300 text-slate-500 hover:bg-slate-50 hover:border-slate-400'}`}
                                title={expanded ? 'Collapse' : 'Expand'}
                            >
                                {expanded ? <Minus size={11} strokeWidth={2.5} /> : <Plus size={11} strokeWidth={2.5} />}
                            </button>
                        ) : (
                            <span className="w-5 h-5 flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-blue-300" /></span>
                        )}
                    </div>
                    {/* Type icon */}
                    <div className={`flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center ${hasKids ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                        {hasKids ? <Package size={14} /> : <MapPin size={13} />}
                    </div>
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-900 group-hover:text-blue-700 truncate transition-colors">{asset.tag}</span>
                            {pts > 0 && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 flex-shrink-0">{pts} pt{pts !== 1 ? 's' : ''}</span>}
                        </div>
                        <p className="text-[11px] text-slate-500 truncate leading-tight mt-0.5">{asset.name}</p>
                        {(hasKids || (due && (due.overdue + due.due) > 0)) && (
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                {due && due.overdue > 0 && <span className="text-[9px] font-bold text-red-700 bg-red-50 border border-red-100 px-1.5 py-0.5 rounded-full flex items-center gap-1"><Clock size={9} />{due.overdue} overdue</span>}
                                {due && due.overdue === 0 && due.due > 0 && <span className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded-full">{due.due} due</span>}
                                {hasKids && (
                                    <button onClick={e => { e.stopPropagation(); onToggle(asset.id); }} className="text-[10px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100 hover:bg-blue-100 transition-colors">
                                        {kids.length} {kids.length === 1 ? 'child' : 'children'}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                    {/* Criticality */}
                    {crit && (
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black border-2 flex-shrink-0 ${critTone}`} title={`Criticality ${crit}`}>
                            {crit}
                        </div>
                    )}
                </div>
            </div>
            {expanded && kids.map((k, i) => (
                <AssetTreeNode key={k.id} asset={k} depth={depth + 1} isLast={i === kids.length - 1} ancestorLastFlags={[...ancestorLastFlags, isLast]}
                    childrenOf={childrenOf} visible={visible} selectedId={selectedId} forceExpand={forceExpand} collapsed={collapsed}
                    onToggle={onToggle} onSelect={onSelect} dueOf={dueOf} pointCountOf={pointCountOf} />
            ))}
        </>
    );
};

