
import React, { useState, useMemo, useEffect } from 'react';
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
import { Button } from '../components/ui';
import { offlineQueue } from '../services/offlineQueue';
import { ConfirmationModal } from '../components/modals/ConfirmationModal';
import { useNavigate, useLocation } from 'react-router-dom';
import { evaluateReading, type AlarmLevel } from '../../lib/readingAlarm';
import { recommendMonitoringCadence } from '../../lib/monitoringCadence';
import { evaluateMeterPMs, forecastMeterPM, isMeterSchedule, matchesReading, type MeterPM, type MeterReadingCtx, type MeterPMDue, type MeterPMForecast } from '../../lib/meterPM';
import { computeReadingDue, summariseDue } from '../../lib/readingDue';
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
    const [raisingWO, setRaisingWO] = useState(false);
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
    const location = useLocation();
    useEffect(() => {
        const q = new URLSearchParams(location.search).get('asset');
        if (q) { setSelectedAssetId(q); setActiveTab('entry'); }
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

    const filteredAssets = useMemo(() => {
        const q = filterText.trim().toLowerCase();
        const hasPoints = (id: string) => definitions.some(d => d.assetId === id && d.isActive);
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
                const da = dueByAsset.get(a.id); const db = dueByAsset.get(b.id);
                const dueScore = (x?: { due: number; overdue: number; never: number }) => x ? x.overdue * 100 + x.never * 10 + x.due : 0;
                const byDue = dueScore(db) - dueScore(da);
                if (byDue !== 0) return byDue;
                const byPoints = (hasPoints(b.id) ? 1 : 0) - (hasPoints(a.id) ? 1 : 0);
                if (byPoints !== 0) return byPoints;
                return (a.tag || a.name).localeCompare(b.tag || b.name);
            });
    }, [assets, definitions, filterText, dueOnly, dueByAsset]);

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
    const handleSaveReadings = async (newReadings: Partial<ReadingLogEntry>[]) => {
        // ═══ RBAC Layer 2: Submit-level guard (ISO 27001 / NIST CSF) ═══
        if (!canCreate) {
            console.warn('[RBAC-AUDIT] BLOCKED: readings.saveReadings attempt by unauthorized user', profile?.username);
            showToast('Access Denied: You do not have permission to enter readings.', 'error');
            return;
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
    const raiseWOFromAlarm = async (b: BreachInfo) => {
        setRaisingWO(true);
        try {
            const req = await createRequestForBreach(b, false);
            showToast('Maintenance request raised from alarm.', 'success');
            setAlarmBreaches([]);
            // Lands on the request itself — /requests?id= opens the record
            // rather than dropping the user on the board to hunt for it.
            const id = (req as any)?.id;
            if (id) navigate(`/requests?id=${id}`);
        } catch (e: any) {
            showToast('Failed to raise request: ' + (e?.message || 'unknown'), 'error');
        } finally { setRaisingWO(false); }
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
    const handleToggleActive = (logId: string, currentStatus: boolean) => {
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

        setLogs(updatedLogs);
    };

    // Learned-baseline limits (1.5.2): propose μ+2σ / μ+3σ from this point's own
    // logged readings; the user approves before anything is written. Provenance
    // becomes 'learned'.
    const handleSuggestBands = async (def: ReadingDefinition) => {
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
        <div className="flex h-[calc(100vh-6rem)] gap-4 sm:gap-6">
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
                                        dueOf={(id) => dueByAsset.get(id)} pointCountOf={(id) => definitions.filter(d => d.assetId === id && d.isActive).length}
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
                    {viewMode === 'list' && filteredAssets.map(asset => {
                        const assetDefs = definitions.filter(d => d.assetId === asset.id);
                        const due = dueByAsset.get(asset.id);
                        return (
                            <div
                                key={asset.id}
                                onClick={() => { setSelectedAssetId(asset.id); setActiveTab('entry'); }}
                                className={`mobile-card ${selectedAssetId === asset.id ? 'bg-blue-50 border-l-4 border-l-blue-600' : ''}`}
                            >
                                <div className="flex justify-between items-start mb-1 gap-2">
                                    <span className="font-bold text-slate-900 text-sm">{asset.tag}</span>
                                    <div className="flex items-center gap-1 flex-shrink-0">
                                        {due && due.overdue > 0 && <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold">{due.overdue} overdue</span>}
                                        {due && due.overdue === 0 && due.due > 0 && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">{due.due} due</span>}
                                        {assetDefs.length > 0 && <span className="text-[10px] bg-slate-200 px-1.5 py-0.5 rounded text-slate-600 font-bold">{assetDefs.length} Pts</span>}
                                    </div>
                                </div>
                                <p className="text-xs text-slate-500 truncate mb-2">{asset.name}</p>
                                <div className="flex flex-wrap gap-1">
                                    {assetDefs.map(d => (
                                        <span key={d.id} className={`text-[10px] px-1.5 rounded border flex items-center gap-1 ${d.category === 'METER' ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-blue-50 text-blue-700 border-blue-100'}`}>
                                            {d.category === 'METER' ? <Clock size={10} /> : <Activity size={10} />}
                                            {d.name}
                                        </span>
                                    ))}
                                    {assetDefs.length === 0 && <span className="text-[10px] text-slate-400 italic">No readings configured</span>}
                                </div>
                            </div>
                        );
                    })}
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
                        <div className="p-6 border-b border-slate-200 bg-white">
                            <div className="flex justify-between items-center mb-4">
                                <div>
                                    <h1 className="text-xl font-bold text-slate-900">{selectedAsset.tag} - {selectedAsset.name}</h1>
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
                                <div className="flex gap-2 items-center">
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
                                        contextSummary={`Readings for ${selectedAsset.tag} (${selectedAsset.name}): ${definitions.filter(d => d.assetId === selectedAsset.id).length} reading points configured. Categories: ${[...new Set(definitions.filter(d => d.assetId === selectedAsset.id).map(d => d.category))].join(', ')}. ${logs.filter(l => l.assetId === selectedAsset.id && l.isAlarm).length} alarms triggered. Ask about trend analysis, predictive maintenance triggers, condition exceedances, or meter reading optimization.`}
                                        compact
                                    />
                                    <button
                                        className={`px-4 py-2 text-sm font-medium rounded-lg transition ${activeTab === 'entry' ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                                        onClick={() => setActiveTab('entry')}
                                    >
                                        Entry Sheet
                                    </button>
                                    <button
                                        className={`px-4 py-2 text-sm font-medium rounded-lg transition ${activeTab === 'history' ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                                        onClick={() => setActiveTab('history')}
                                    >
                                        History & Analysis
                                    </button>
                                    <button
                                        className={`px-4 py-2 text-sm font-medium rounded-lg transition ${activeTab === 'definitions' ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                                        onClick={() => setActiveTab('definitions')}
                                    >
                                        Definitions
                                    </button>
                                    <button
                                        className={`px-4 py-2 text-sm font-medium rounded-lg transition ${activeTab === 'work' ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                                        onClick={() => setActiveTab('work')}
                                    >
                                        Related Work
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
                            {activeTab === 'entry' && (
                                <SingleAssetEntry
                                    asset={selectedAsset}
                                    definitions={definitions.filter(d => d.assetId === selectedAsset.id)}
                                    onSave={handleSaveReadings}
                                    onAddDefinition={handleAddDefinition}
                                    onDeleteDefinition={handleDeleteDefinition}
                                    onOpenAddPoint={setAddPointAssetId}
                                    readingTypes={readingTypes} // Pass it down
                                />
                            )}
                            {activeTab === 'history' && (
                                <TrendAnalysis
                                    definitions={definitions.filter(d => d.assetId === selectedAsset.id)}
                                    logs={logs}
                                    onToggleActive={handleToggleActive}
                                />
                            )}
                            {activeTab === 'definitions' && (
                                <DefinitionsManager
                                    definitions={definitions.filter(d => d.assetId === selectedAsset.id)}
                                    assetId={selectedAsset.id}
                                    onAdd={handleAddDefinition}
                                    onMeterChange={handleMeterChange}
                                    onDelete={handleDeleteDefinition}
                                    onOpenAddPoint={setAddPointAssetId}
                                    onSuggestBands={handleSuggestBands}
                                    logCountByDef={logs.reduce<Record<string, number>>((m, l) => { if (l.isActive !== false) m[l.definitionId] = (m[l.definitionId] || 0) + 1; return m; }, {})}
                                    readingTypes={readingTypes}
                                />
                            )}
                            {activeTab === 'work' && (
                                <RelatedWork
                                    assetId={selectedAsset.id}
                                    pms={pms.filter(p => p.asset_id === selectedAsset.id || (Array.isArray(p.assigned_assets) && p.assigned_assets.some((a: any) => a.assetId === selectedAsset.id)))}
                                    definitions={definitions.filter(d => d.assetId === selectedAsset.id)}
                                    logs={logs}
                                    onOpenWO={(id) => navigate(`/work-orders/${id}`)}
                                />
                            )}
                        </div>
                    </>
                ) : sheetOpen ? (
                    /* Full-page entry sheet — assets are picked INSIDE the sheet */
                    <BatchEntryView
                        allAssets={filteredAssets}
                        allDefinitions={definitions}
                        onSave={handleSaveReadings}
                        readingTypes={readingTypes}
                        onAddDefinition={handleAddDefinition}
                        onDeleteDefinition={handleDeleteDefinition}
                        pickAssets
                        onBack={() => setSheetOpen(false)}
                        onOpenAddPoint={setAddPointAssetId}
                        onOpenAsset={(id) => { setSheetOpen(false); setSelectedAssetId(id); }}
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
                onConfirm={() => {
                    if (meterChangeDefId) {
                        setLogs(prev => prev.map(l => l.definitionId === meterChangeDefId ? { ...l, isActive: false } : l));
                        setDefinitions(prev => prev.map(d => d.id === meterChangeDefId ? { ...d, lastReadingValue: 0 } : d));
                        showToast('Meter reset. Previous readings archived.', 'success');
                        setMeterChangeDefId(null);
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
                            showToast('Reading point removed. History preserved.', 'success');
                        } catch (e: any) {
                            showToast('Failed to delete definition: ' + e.message, 'error');
                        }
                        setDeleteDefId(null);
                    }
                }}
                title="Delete Reading Point?"
                message="History will be kept but this reading point will be removed from future entry sheets."
                type="danger"
                confirmText="Delete Point"
            />

            {/* Raise ▾ — Request / Work Order / PM from the focused asset */}
            {raiseKind && selectedAsset && (
                <RaiseWorkModal
                    asset={selectedAsset}
                    kind={raiseKind}
                    actor={profile?.username || profile?.fullName || 'user'}
                    requesterId={profile?.id}
                    faultTypes={faultTypes}
                    contextNote={`Condition Data: ${definitions.filter(d => d.assetId === selectedAsset.id).length} reading point(s), ${logs.filter(l => l.assetId === selectedAsset.id && l.isAlarm).length} in alarm.`}
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
                                    <Button variant="primary" size="sm" fullWidth className="mt-2" loading={raisingWO} leftIcon={<Plus size={14} />} onClick={() => raiseWOFromAlarm(b)}>
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
}> = ({ definitions, logs, onToggleActive }) => {
    const [selectedDefId, setSelectedDefId] = useState<string>(definitions[0]?.id || '');
    const selectedDef = definitions.find(d => d.id === selectedDefId);

    // Date-range filter for the chart + history (AMPRO/SAP graph filtering).
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const applyPreset = (days: number | null) => {
        if (days == null) { setFromDate(''); setToDate(''); return; }
        const d = new Date(); d.setDate(d.getDate() - days);
        setFromDate(d.toISOString().slice(0, 10)); setToDate('');
    };

    // Prepare Graph Data - Sorted Ascending for Line Chart
    const graphData = useMemo(() => {
        if (!selectedDefId) return [];
        return logs
            .filter(l => l.definitionId === selectedDefId) // Show all, visually distinguish inactive
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
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

    // Average Calculations — over the visible date range; lifetime cumulative
    // deliberately ignores the filter (it's a total, not a window stat).
    const averages = useMemo(() => {
        const activeData = filteredData.filter(d => d.active);

        if (selectedDef?.category === 'METER') {
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
            return {
                daily: daily,
                weekly: daily * 7,
                monthly: daily * 30.4,
                yearly: daily * 365,
                overall: cumulative
            };
        } else {
            if (activeData.length < 2) return { daily: 0, weekly: 0, monthly: 0, yearly: 0, overall: 0 };
            // Condition Monitoring - Simple Average
            const sum = activeData.reduce((acc, curr) => acc + curr.value, 0);
            const avg = sum / activeData.length;
            return { daily: avg, weekly: avg, monthly: avg, yearly: avg, overall: avg };
        }
    }, [graphData, filteredData, selectedDef]);

    if (!selectedDef) return <div className="text-center p-8 text-slate-400">No reading definitions found for this asset.</div>;

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
                        {([[30, '30d'], [90, '90d'], [365, '1y'], [null, 'All']] as [number | null, string][]).map(([days, label]) => {
                            const active = days == null ? (!fromDate && !toDate) : false;
                            return (
                                <button key={label} onClick={() => applyPreset(days)}
                                    className={`text-[11px] font-semibold px-2 py-1 rounded-md border transition ${active ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'}`}>
                                    {label}
                                </button>
                            );
                        })}
                        <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} title="From"
                            className="p-1.5 border border-slate-300 rounded-md text-xs bg-white" />
                        <span className="text-slate-400 text-xs">–</span>
                        <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} title="To"
                            className="p-1.5 border border-slate-300 rounded-md text-xs bg-white" />
                    </div>
                </div>
            </div>

            {/* Averages Header */}
            <div className="bg-slate-800 text-white p-4 rounded-xl shadow-md grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="p-2 border-r border-slate-600 last:border-0">
                    <div className="text-[10px] uppercase opacity-70 mb-1">Average (Daily)</div>
                    <div className="text-xl font-bold">{averages.daily.toFixed(2)}</div>
                </div>
                <div className="p-2 border-r border-slate-600 last:border-0">
                    <div className="text-[10px] uppercase opacity-70 mb-1">Average (Weekly)</div>
                    <div className="text-xl font-bold">{averages.weekly.toFixed(2)}</div>
                </div>
                <div className="p-2 border-r border-slate-600 last:border-0">
                    <div className="text-[10px] uppercase opacity-70 mb-1">Average (Monthly)</div>
                    <div className="text-xl font-bold">{averages.monthly.toFixed(2)}</div>
                </div>
                <div className="p-2 border-r border-slate-600 last:border-0">
                    <div className="text-[10px] uppercase opacity-70 mb-1">Average (Yearly)</div>
                    <div className="text-xl font-bold">{averages.yearly.toFixed(2)}</div>
                </div>
                <div className="p-2">
                    <div className="text-[10px] uppercase opacity-70 mb-1">{selectedDef.category === 'METER' ? 'Cumulative (Total)' : 'Overall Avg'}</div>
                    <div className="text-xl font-bold">{averages.overall.toFixed(2)} <span className="text-sm font-normal opacity-70">{selectedDef.unit}</span></div>
                </div>
            </div>

            {/* Graph */}
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm h-80">
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
                        {selectedDef.maxCritical && <ReferenceLine y={selectedDef.maxCritical} stroke="red" strokeDasharray="3 3" label="Crit High" />}
                        {selectedDef.minCritical && <ReferenceLine y={selectedDef.minCritical} stroke="red" strokeDasharray="3 3" label="Crit Low" />}
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
                <div className="p-4 bg-slate-50 border-b border-slate-200 font-bold text-slate-700 text-sm flex justify-between items-center">
                    <span>Reading History</span>
                    <button className="text-xs bg-white border border-slate-300 px-3 py-1 rounded hover:bg-slate-100 flex items-center gap-1">
                        <RefreshCcw size={12} /> Meter Replaced?
                    </button>
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
                        {filteredData.length === 0 && (
                            <tr><td colSpan={selectedDef.category === 'METER' ? 8 : 7} className="p-8 text-center text-sm text-slate-400">No readings in this date range.</td></tr>
                        )}
                        {filteredData.slice().reverse().map((row, idx) => ( // Show newest first
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
                                        onChange={(e) => onToggleActive(row.id, row.active)}
                                        className="rounded text-blue-600 focus:ring-primary-500 h-4 w-4 cursor-pointer"
                                        title={row.active ? "Click to Deactivate (will cascade)" : "Click to Activate (will restore chain)"}
                                    />
                                </td>
                                <td className="px-6 py-3 text-sm text-slate-500 italic">{row.comment}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

// --- Entry Components ---

const SingleAssetEntry: React.FC<{
    asset: Asset;
    definitions: ReadingDefinition[];
    readingTypes: DictionaryRecord[];
    onSave: (data: Partial<ReadingLogEntry>[]) => void;
    onAddDefinition: (assetId: string, typeCode: string) => void;
    onDeleteDefinition: (id: string) => void;
    onOpenAddPoint: (assetId: string) => void;
}> = ({ asset, definitions, readingTypes, onSave, onAddDefinition, onDeleteDefinition, onOpenAddPoint }) => {
    return (
        <BatchEntryView
            allAssets={[asset]}
            allDefinitions={definitions}
            onSave={onSave}
            onAddDefinition={onAddDefinition}
            onDeleteDefinition={onDeleteDefinition}
            onOpenAddPoint={onOpenAddPoint}
            titleOverride="Reading Entry Sheet"
            readingTypes={readingTypes}
        />
    );
};

const BatchEntryView: React.FC<{
    allAssets: Asset[];
    allDefinitions: ReadingDefinition[];
    onSave: (data: Partial<ReadingLogEntry>[]) => void;
    onAddDefinition?: (assetId: string, typeCode: string) => void;
    onDeleteDefinition?: (id: string) => void;
    onOpenAddPoint?: (assetId: string) => void;
    titleOverride?: string;
    readingTypes?: DictionaryRecord[]; // Added prop
    /** In-sheet asset picker: the user builds their round by adding assets here. */
    pickAssets?: boolean;
    onBack?: () => void;
    /** Open the asset's detail view (history/analysis/config). */
    onOpenAsset?: (assetId: string) => void;
}> = ({ allAssets, allDefinitions, onSave, onAddDefinition, onDeleteDefinition, onOpenAddPoint, titleOverride, readingTypes = [], pickAssets = false, onBack, onOpenAsset }) => {
    const [inputValues, setInputValues] = useState<Record<string, { value: number | string, date: string, time: string, comment: string, finding?: string }>>({});

    // Add New Reading State
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [selectedType, setSelectedType] = useState('');

    // In-sheet picker state (pickAssets mode)
    const [sheetAssetIds, setSheetAssetIds] = useState<string[]>([]);
    const [pickerText, setPickerText] = useState('');

    const sheetAssets = useMemo(
        () => pickAssets ? allAssets.filter(a => sheetAssetIds.includes(a.id)) : allAssets,
        [pickAssets, allAssets, sheetAssetIds],
    );

    const pickerMatches = useMemo(() => {
        if (!pickAssets) return [];
        const q = pickerText.trim().toLowerCase();
        return allAssets
            .filter(a => !sheetAssetIds.includes(a.id))
            .filter(a => !q || a.tag?.toLowerCase().includes(q) || a.name?.toLowerCase().includes(q))
            .slice(0, 8);
    }, [pickAssets, allAssets, sheetAssetIds, pickerText]);

    // Shared results dropdown — the picker renders in two places (centered hero on
    // an empty sheet, compact top bar once assets are added) but is one search.
    const pickerDropdown = pickerText.trim() ? (
        pickerMatches.length > 0 ? (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-20 overflow-hidden">
                {pickerMatches.map(a => {
                    const nPts = allDefinitions.filter(d => d.assetId === a.id && d.isActive).length;
                    return (
                        <button key={a.id}
                            onClick={() => { setSheetAssetIds(prev => [...prev, a.id]); setPickerText(''); }}
                            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-primary-50 text-sm">
                            <span className="min-w-0">
                                <span className="font-bold text-slate-800">{a.tag}</span>
                                <span className="text-slate-500 truncate"> — {a.name}</span>
                            </span>
                            <span className={`shrink-0 text-[10px] font-semibold ${nPts ? 'text-slate-500' : 'text-amber-600'}`}>{nPts ? `${nPts} pts` : 'no points'}</span>
                        </button>
                    );
                })}
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
            const defs = allDefinitions.filter(d => d.assetId === asset.id && d.isActive);
            defs.forEach(def => {
                result.push({ asset, def });
            });
        });
        return result;
    }, [sheetAssets, allDefinitions]);

    // Available Types for Add Modal (If single asset)
    const singleAsset = allAssets.length === 1 ? allAssets[0] : null;

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

    const handleSaveBatch = () => {
        const payload: Partial<ReadingLogEntry>[] = [];
        Object.keys(inputValues).forEach(defId => {
            const entry = inputValues[defId];
            if (entry.value !== undefined && entry.value !== '') {
                payload.push({
                    definitionId: defId,
                    value: Number(entry.value),
                    date: entry.date || new Date().toISOString().split('T')[0],
                    time: entry.time || new Date().toTimeString().split(' ')[0].substring(0, 5),
                    comments: entry.comment,
                    valuationCode: entry.finding || undefined
                });
            }
        });
        if (payload.length === 0) return;
        onSave(payload);
        setInputValues({});
    };

    const handleAdd = () => {
        if (selectedType && singleAsset && onAddDefinition) {
            onAddDefinition(singleAsset.id, selectedType);
            setIsAddOpen(false);
            setSelectedType('');
        }
    };

    return (
        <div className="flex flex-col h-full relative">
            <div className="p-4 sm:p-6 border-b border-slate-200 bg-white flex flex-wrap justify-between items-center gap-3">
                <div className="flex items-center gap-3">
                    {onBack && (
                        <button onClick={onBack} className="flex items-center gap-1 text-xs font-bold text-slate-600 hover:text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 hover:bg-slate-50" title="Back to the asset browser">
                            ← Assets
                        </button>
                    )}
                    <div>
                        <h1 className="text-xl font-bold text-slate-900">{titleOverride || 'Readings Entry Sheet'}</h1>
                        <p className="text-sm text-slate-500">{pickAssets ? `${sheetAssets.length} asset${sheetAssets.length === 1 ? '' : 's'} · ${rows.length} points` : `Record data for ${rows.length} points.`}</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    {singleAsset && (onOpenAddPoint || onAddDefinition) && (
                        <Button
                            onClick={() => onOpenAddPoint ? onOpenAddPoint(singleAsset.id) : setIsAddOpen(true)}
                            variant="secondary"
                            leftIcon={<Plus size={16} />}
                        >
                            Add Reading Point
                        </Button>
                    )}
                    <button
                        onClick={handleSaveBatch}
                        className="bg-primary-600 hover:bg-primary-500 text-white px-6 py-2 rounded-lg font-bold shadow-sm flex items-center gap-2"
                    >
                        <Save size={16} /> Save All
                    </button>
                </div>
            </div>
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
                        {sheetAssets.map(a => (
                            <span key={a.id} className="flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 bg-white border border-primary-200 text-primary-700 rounded-full text-xs font-bold">
                                <button onClick={() => onOpenAsset?.(a.id)} className="hover:underline" title="Open asset detail (history & configuration)">{a.tag}</button>
                                <button onClick={() => setSheetAssetIds(prev => prev.filter(id => id !== a.id))}
                                    className="w-4 h-4 rounded-full hover:bg-primary-100 flex items-center justify-center" title="Remove from sheet">×</button>
                            </span>
                        ))}
                    </div>
                </div>
            )}
            <div className="flex-1 overflow-y-auto bg-slate-50/50">
                {/* Added assets with no reading points: configure them right here */}
                {pickAssets && sheetAssets.filter(a => !allDefinitions.some(d => d.assetId === a.id && d.isActive)).map(a => (
                    <div key={a.id} className="mx-4 sm:mx-6 mt-3 flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-relantern-50 border border-relantern-200 rounded-xl">
                        <span className="text-sm text-slate-700">
                            <strong>{a.tag}</strong> — {a.name}: <span className="text-slate-500">no reading points yet.</span>
                        </span>
                        {onOpenAddPoint && (
                            <button onClick={() => onOpenAddPoint(a.id)}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-relantern-500 hover:bg-relantern-600 text-white">
                                <Plus size={12} /> Add reading point
                            </button>
                        )}
                    </div>
                ))}
                {/* Empty sheet → centered hero picker, front and centre */}
                {pickAssets && sheetAssets.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-center p-8">
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
                    </div>
                )}
                <table className={`min-w-full divide-y divide-slate-200 border-b border-slate-200 ${pickAssets && rows.length === 0 ? 'hidden' : ''}`}>
                    <thead className="bg-slate-100 sticky top-0 z-10 shadow-sm">
                        <tr>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-40">Asset</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-28">Type</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-20">Last</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-auto">Date</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Value</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-40">Finding</th>
                            <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider w-10"></th>
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
                                        <div className="text-sm font-bold text-slate-700">{def.lastReadingValue ?? '-'} <span className="text-xs font-normal text-slate-500">{def.unit}</span></div>
                                        <div className="text-xs text-slate-400">{def.lastReadingDate || 'Never'}</div>
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
                                        <div className="flex gap-2 items-center">
                                            <input
                                                type="number"
                                                placeholder="0.00"
                                                className="w-24 p-2 border border-slate-200 rounded text-sm font-bold text-right focus:ring-2 focus:ring-primary-500 focus:border-blue-500 outline-none transition-all shadow-sm bg-white"
                                                value={currentInput.value}
                                                onChange={(e) => handleInputChange(def.id, 'value', e.target.value)}
                                            />
                                        </div>
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
                                    <td className="px-4 py-3 text-center">
                                        {onDeleteDefinition && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onDeleteDefinition(def.id); }}
                                                className="text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors p-2 rounded-lg"
                                                title="Delete Reading Point"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                        {rows.length === 0 && (
                            <tr><td colSpan={7} className="p-10 text-center text-slate-400">
                                {singleAsset
                                    ? <>No reading points on this asset yet. Click <span className="font-semibold text-slate-500">Add Reading Point</span> to define one (e.g. Bearing Vibration, mm/s, with warning/critical limits).</>
                                    : <>Select an asset on the left, then add a reading point to start capturing condition data.</>}
                            </td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Inline Modal for adding readings */}
            {isAddOpen && (
                <div className="absolute top-20 right-4 w-96 bg-white rounded-xl shadow-2xl border border-slate-200 z-50 animate-in fade-in slide-in-from-top-4">
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
}> = ({ definitions, assetId, readingTypes, onAdd, onMeterChange, onDelete, onOpenAddPoint, onSuggestBands, logCountByDef = {} }) => {
    const [isAddOpen, setIsAddOpen] = useState(false);
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
            <div className="flex justify-end">
                <button
                    onClick={() => onOpenAddPoint ? onOpenAddPoint(assetId) : setIsAddOpen(true)}
                    className="text-xs bg-primary-600 text-white px-3 py-1.5 rounded hover:bg-primary-500 flex items-center gap-1"
                >
                    <Plus size={14} /> Add Point
                </button>
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
                const canSuggest = def.category === 'CONDITION' && onSuggestBands && (logCountByDef[def.id] || 0) >= MIN_BASELINE_READINGS;
                return (
                <div key={def.id} className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex justify-between items-center">
                    <div>
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
                    <div className="flex items-center gap-4">
                        <div className="text-right mr-4">
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
                        {def.category === 'METER' && (
                            <button
                                onClick={() => onMeterChange(def.id)}
                                className="px-3 py-1.5 border border-slate-300 rounded text-xs font-medium hover:bg-slate-50 flex items-center gap-1 text-slate-700"
                                title="Reset meter or replace component"
                            >
                                <RefreshCcw size={12} /> Meter Change
                            </button>
                        )}
                        <button className="text-slate-400 hover:text-blue-600"><Save size={16} /></button>
                        <button onClick={() => onDelete(def.id)} className="text-slate-400 hover:text-red-600"><Trash2 size={16} /></button>
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

    const CLOSED = new Set(['CLOSED', 'COMPLETED', 'COMPLETE', 'CANCELLED', 'CANCELED', 'DONE']);
    const openWos = wos.filter(w => !CLOSED.has((w.status || '').toUpperCase()));
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

