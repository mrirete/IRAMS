
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import {
    Search, Plus, Filter, Save, Calendar, Clock, Gauge, FileText,
    Link as LinkIcon, Layers, Package, Users, ClipboardList,
    ChevronRight, ChevronLeft, Zap, CheckCircle, AlertTriangle, Repeat, Shield,
    MoveUp, MoveDown, Trash2, Edit2, CheckSquare, Hash, AlignLeft, X, Loader2,
    Copy, Maximize2, Minimize2, Star, ArrowUpRight, ArrowLeft, History, ChevronDown, ChevronUp,
    PauseCircle, PlayCircle, BarChart3, Eye, TrendingUp, Upload, BookOpen
} from 'lucide-react';
import { AskRelanternButton } from '../components/AskRelanternButton';
import { assessPmReadiness } from '../services/pmReadiness';
import { PmReadinessBadge, PmReadinessChip } from '../components/PmReadinessBadge';
import { openStorageRef } from '../../lib/storageUrl';
import { aiContextService } from '../services/AIContextService';
import { MOCK_RECURRING_JOBS, MOCK_ASSETS, MOCK_DICTIONARIES, MOCK_WORK_ORDERS } from '../constants';
import { RecurringJob, Asset, WorkOrderType, JobJSA, JobLabor, JobInventory, JobFile, JobTask, InstructionBlock, Contact, JSAHazard, GenerationRule, LibraryTask } from '../types';
import { CreatePMModal } from '../components/modals/CreatePMModal';
import { addCadence, cadenceDays, firstDueDate, isWithinCallHorizon, sensibleLeadTimeDays, toDateOnly } from '../lib/pmCadence';
import { absorptionWindowDays, canBeParentOf, isAbsorbedBy, isHarmonic } from '../lib/pmHierarchy';
import BulkImportModal from '../components/modals/BulkImportModal';
import { sapCycleUnit, cadenceEquals, cadenceLabel, cadenceSuffix, isMeterUnit } from '../lib/sapCycles';
import { splitOperationsByCadence } from '../lib/jobPlanImport';

/**
 * A work-centre code on an imported schedule or operation (SAP GEWRK / ARBPL)
 * that IREAMS does not know yet is created from the code — the way the
 * source-list import creates vendors from LIFNR — so the plan lands whole and
 * the rate and capacity are set afterwards in Dictionaries. Returns the id,
 * or undefined when the code is blank or the create failed (reported once).
 */
async function ensureWorkCentre(
    db: ReturnType<typeof DatabaseService.getInstance>,
    centreByCode: Map<string, string>,
    code: string | undefined,
    res: ImportResult,
    reported: Set<string>,
): Promise<string | undefined> {
    const key = (code || '').trim().toUpperCase();
    if (!key) return undefined;
    const known = centreByCode.get(key);
    if (known) return known;
    try {
        await db.saveWorkCenter({ code: code!.trim(), name: code!.trim(), category: 'IMPORTED' });
        const refreshed = await db.getWorkCenters();
        for (const c of refreshed) centreByCode.set(String(c.code ?? '').toUpperCase(), c.id);
        const id = centreByCode.get(key);
        if (id && !reported.has(key)) {
            reported.add(key);
            res.notes!.push(`Work centre "${code!.trim()}" created from the SAP code — set its rate and capacity in Dictionaries › Work Centres.`);
        }
        return id;
    } catch (e: unknown) {
        if (!reported.has(key)) {
            reported.add(key);
            res.notes!.push(`Work centre "${code!.trim()}" could not be created (${errMessage(e)}) — imported without it.`);
        }
        return undefined;
    }
}
import { ConfirmationModal } from '../components/modals/ConfirmationModal';
import { DatabaseService } from '../services/DatabaseService';
import { supabase } from '../lib/supabase';
import { buildPMStrategy } from '../lib/pmStrategy';
import { emptyResult, tally, errMessage, type ImportResult } from '../services/importTypes';
import { parseDateValue } from '../services/assetTemplates';
import { ImageGallery } from '../components/ui/ImageGallery';
import { NotificationService } from '../services/NotificationService';
import { ProcedureBuilder } from '../components/ProcedureBuilder';
import { SearchableDropdown } from '../components/ui/SearchableDropdown';
import { useToast } from '../contexts/ToastContext';
import { useConfirm, usePrompt } from '../contexts/ConfirmContext';
import { useAuth } from '../contexts/AuthContext';
import type { ImportType } from '../services/assetTemplates';

type TabId = 'details' | 'assets' | 'tasks' | 'jsa' | 'labor' | 'inventory' | 'files' | 'history';
const TAB_IDS: TabId[] = ['details', 'assets', 'tasks', 'jsa', 'labor', 'inventory', 'files', 'history'];
type StatusFilter = 'ALL' | 'ACTIVE' | 'PAUSED' | 'DRAFT' | 'EXPIRED';
type GroupBy = 'none' | 'status' | 'jobType' | 'rcmStrategy';

// --- Helpers ---
const getRiskLevel = (score: number): 'Critical' | 'High' | 'Medium' | 'Low' => {
    if (score >= 20) return 'Critical';
    if (score >= 15) return 'High';
    if (score >= 8) return 'Medium';
    return 'Low';
};

/** Same shape the browser gives a <input type="date"> (dd/mm/yyyy or mm/dd/yyyy per
 *  locale) so a computed date beside a typed one reads as a matched pair. */
const fmtLocalDate = (v?: string | null): string => {
    if (!v) return '—';
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00` : v);
    return isNaN(d.getTime()) ? v : d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' });
};

/** Estimated hours carried by the template's steps. When any step carries hours this is
 *  the schedule's duration estimate (Details shows it read-only and the save writes it
 *  into est_duration) so the generated order and the planner's figure never disagree. */
const stepsHours = (tasks?: JobTask[] | null): { total: number; count: number } => {
    let total = 0, count = 0;
    for (const t of tasks || []) {
        const h = Number(t?.estHours) || 0;
        if (h > 0) { total += h; count += 1; }
    }
    return { total: Math.round(total * 100) / 100, count };
};

const RISK_COLORS: Record<string, string> = {
    Critical: 'border-red-500 bg-red-50',
    High: 'border-orange-400 bg-orange-50',
    Medium: 'border-amber-400 bg-amber-50',
    Low: 'border-green-400 bg-green-50',
};

const CONTROL_HIERARCHY = ['Elimination', 'Substitution', 'Engineering', 'Admin', 'PPE'] as const;

export const RecurringWork: React.FC = () => {
    const { showToast } = useToast();
    const { user, permissions } = useAuth();
    // PM strategies are planner work. The page had no permission checks at all
    // (2026-09-06 walk-through): a TECHNICIAN (pm: view only) could create,
    // edit, delete and generate orders from strategies. RLS on recurring_work
    // is tenant-only for INSERT/UPDATE, so the page is the gate.
    const canCreatePM = permissions?.pm?.create === true;
    const canEditPM = permissions?.pm?.edit === true;
    const canDeletePM = permissions?.pm?.delete === true || permissions?.admin?.view === true;
    const denied = (what: string) => showToast(`Your role cannot ${what} (needs Recurring Work · ${what === 'delete strategies' ? 'Delete' : what === 'create strategies' ? 'Create' : 'Edit'}).`, 'error');
    const [jobs, setJobs] = useState<RecurringJob[]>([]);
    const [selectedJob, setSelectedJob] = useState<RecurringJob | null>(null);
    const [activeTab, setActiveTab] = useState<TabId>('details');
    const [showGenerator, setShowGenerator] = useState(false);
    const [isCreatePMOpen, setIsCreatePMOpen] = useState(false);
    const [dictionaries, setDictionaries] = useState<any[]>([]);
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [inventoryItems, setInventoryItems] = useState<any[]>([]);
    const [dbAssets, setDbAssets] = useState<Asset[]>([]);
    const [saving, setSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
    const [isFullscreen, setIsFullscreen] = useState(false);
    // Deep link (e.g. RCM task matrix → /recurring-work?q=RCM-xxxx) seeds the search box
    const [urlParams, setUrlParams] = useSearchParams();
    const [searchQuery, setSearchQuery] = useState(urlParams.get('q') || '');
    // Deep link from Specialist missions: ?due=overdue lands the plan already
    // scoped to past-due programmes (clearable chip in the toolbar).
    const [overdueOnly, setOverdueOnly] = useState(urlParams.get('due') === 'overdue');
    const [deleting, setDeleting] = useState(false);
    const [duplicating, setDuplicating] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    // Phase 4A — Master List UX
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
    const [groupBy, setGroupBy] = useState<GroupBy>('none');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    // Bulk Import
    const [showBulkImport, setShowBulkImport] = useState(urlParams.get('action') === 'import');
    // Phase 5B — PM Calendar
    const [showCalendar, setShowCalendar] = useState(false);
    // Phones: group / select-all / calendar live in a bottom sheet so the list owns the screen
    const [showFilterSheet, setShowFilterSheet] = useState(false);
    useEffect(() => {
        if (!showFilterSheet) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowFilterSheet(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [showFilterSheet]);
    const [calendarDate, setCalendarDate] = useState(new Date());

    // Load data on mount
    useEffect(() => {
        loadStrategies();
        loadDictionaries();
        loadContacts();
        loadInventoryItems();
        loadAssets();
    }, []);

    // Deep link from a notification: /recurring-work?id=<pm_id> (notificationNav).
    // PM-due alerts are raised from this page, so landing on the unfiltered list
    // was the one place the alert's own programme could get lost.
    useEffect(() => {
        const targetId = urlParams.get('id');
        if (!targetId || selectedJob || jobs.length === 0) return;
        const match = jobs.find(j => j.id === targetId);
        if (!match) return;
        setSelectedJob(match);
        // A strategy created a moment ago has no assets yet: land on the tab
        // that needs filling first (?tab=assets), otherwise Details as before.
        const tab = urlParams.get('tab');
        if (tab && TAB_IDS.includes(tab as TabId)) setActiveTab(tab as TabId);
        setUrlParams(prev => {
            const next = new URLSearchParams(prev);
            next.delete('id');
            next.delete('tab');
            return next;
        }, { replace: true });
    }, [urlParams, jobs, selectedJob, setUrlParams]);

    // PM-Due Notification Trigger — 4-tier escalation (ISO 55000)
    useEffect(() => {
        if (jobs.length > 0 && user?.id) {
            NotificationService.triggerPMDueNotifications(jobs, dbAssets.length > 0 ? dbAssets : MOCK_ASSETS, user.id).catch(console.error);
        }
    }, [jobs, user?.id]);

    const loadDictionaries = async () => {
        try {
            const dbDicts = await DatabaseService.getInstance().getDictionaries();
            if (dbDicts.length > 0) setDictionaries(dbDicts);
        } catch (e) {
            console.error("Failed to load dictionaries", e);
        }
    };

    const loadContacts = async () => {
        try {
            const data = await DatabaseService.getInstance().getContacts();
            setContacts(data);
        } catch (e) {
            console.error('Failed to load contacts', e);
        }
    };

    const loadInventoryItems = async () => {
        try {
            const data = await DatabaseService.getInstance().getInventory();
            setInventoryItems(data);
        } catch (e) {
            console.error('Failed to load inventory items', e);
        }
    };

    const loadAssets = async () => {
        try {
            const assets = await DatabaseService.getInstance().getAssets();
            setDbAssets(assets);
        } catch (e) {
            console.error('Failed to load assets', e);
        }
    };

    const loadStrategies = async () => {
        try {
            const dbPMs = await DatabaseService.getInstance().getPMs();
            const mappedPMs: RecurringJob[] = dbPMs.map((pm: any) => ({
                id: pm.id,
                code: pm.code,
                title: pm.title || '',
                description: pm.description || pm.title,
                jobDescription: pm.description || pm.title,
                status: pm.status,
                assignedAssets: (pm.assigned_assets && Array.isArray(pm.assigned_assets) && pm.assigned_assets.length > 0)
                    ? pm.assigned_assets
                    : pm.asset_id ? [{ assetId: pm.asset_id, lastCompletedDate: pm.last_generated_date || '', lastReadingValue: 0 }] : [],
                scheduleType: pm.schedule_type,
                frequencyInterval: pm.frequency_interval,
                frequencyUnit: pm.frequency_unit,
                autoGenerate: pm.auto_generate !== false, // 0304 Autopilot opt-out
                parentId: pm.parent_pm_id || undefined, // 0366 nested within
                nestingMode: pm.nesting_mode === 'COMBINES' ? 'COMBINES' : 'SUPERSEDES',
                leadTimeDays: pm.lead_time_days ?? 7, // 0 is a real value (daily rounds) — `||` showed 7 for it
                jobType: pm.job_type,
                priority: pm.priority_code,
                strategyId: pm.strategy_id || undefined,
                strategyPackage: pm.strategy_package || undefined,
                origin: pm.origin || undefined, // 0299 structured provenance

                estDuration: pm.est_duration || 0,
                estDowntime: pm.est_downtime || 0,
                nextDueDate: pm.next_due_date || '',
                lastGeneratedDate: pm.last_generated_date || '',
                // 0365: what the row said when loaded — Save compares against it
                loadedCadence: `${pm.frequency_interval}|${pm.frequency_unit}`,
                loadedNextDue: pm.next_due_date || '',
                // Failure Impact (ISO 14224 §B.2.5)
                localImpact: pm.local_impact || '',
                plantWideImpact: pm.plant_wide_impact || '',
                // The row already carries its plan (select('*') includes templates) —
                // mapping it here lets the list and the Generator score readiness
                // without a second fetch per schedule; selecting a schedule still
                // re-reads templates and wins when they are non-empty.
                tasks: Array.isArray(pm.templates?.tasks) ? pm.templates.tasks : [],
                jsa: pm.templates?.jsa || { id: 'jsa-mock', status: 'DRAFT', hazards: [], permits: [], signoffs: [] },
                labor: Array.isArray(pm.templates?.labor) ? pm.templates.labor : [],
                inventory: Array.isArray(pm.templates?.inventory) ? pm.templates.inventory : [],
                createdById: pm.created_by || 'system',
                createdAt: pm.created_at || new Date().toISOString()
            }));

            setJobs(mappedPMs);
        } catch (e) {
            console.error("Failed to load PMs", e);
        }
    };

    // --- Generator Logic (Mock) ---
    // ... (rest of generator logic)

    // ... inside return ...



    // ── 0304/0305 — Autopilot status per schedule (loud gaps) ──────────────
    // A schedule the daily sweep can't serve says so on the list instead of
    // freezing silently: wrong cadence, unarmed, blocked by an open WO, or off.
    // Company-wide generation mode (companies.pm_auto_generate, Admin › Your Company).
    const [companyAuto, setCompanyAuto] = useState<boolean>(true);
    useEffect(() => {
        (async () => {
            try {
                const co = (await DatabaseService.getInstance().getCompanies(false))[0];
                setCompanyAuto(co ? co.pmAutoGenerate !== false : true);
            } catch { /* default Automatic */ }
        })();
    }, []);
    const [woRollup, setWoRollup] = useState<Record<string, { completed: boolean; open: boolean; openNumber?: string }>>({});
    const [rollupTick, setRollupTick] = useState(0);
    useEffect(() => {
        (async () => {
            try {
                const { data } = await supabase.from('work_orders')
                    .select('recurring_work_id, status, wo_number')
                    .not('recurring_work_id', 'is', null);
                const acc: Record<string, { completed: boolean; open: boolean; openNumber?: string }> = {};
                for (const w of (data || []) as any[]) {
                    const st = String(w.status || '').toUpperCase();
                    const m = acc[w.recurring_work_id] || (acc[w.recurring_work_id] = { completed: false, open: false });
                    if (['COMP', 'TECO', 'CLOSED'].includes(st)) m.completed = true;
                    else if (st !== 'CANCELLED') { m.open = true; m.openNumber = w.wo_number ? `WO-${w.wo_number}` : m.openNumber; }
                }
                setWoRollup(acc);
            } catch { /* chip is advisory only */ }
        })();
    }, [jobs.length, rollupTick]);

    const AUTOPILOT_CALENDAR_UNITS = ['DAYS', 'WEEKS', 'MONTHS', 'YEARS'];
    // 0366: is this schedule's next occurrence satisfied by its longer-interval task's next order?
    const waitingInParent = (job: RecurringJob): RecurringJob | null => {
        if (!job.parentId || !job.nextDueDate) return null;
        const p = jobs.find(j => j.id === job.parentId);
        if (!p?.nextDueDate) return null;
        return isAbsorbedBy(job.nextDueDate, p.nextDueDate, absorptionWindowDays(job)) ? p : null;
    };
    const autopilotChip = (job: RecurringJob): { label: string; cls: string } | null => {
        if (String(job.scheduleType || 'TIME').toUpperCase() !== 'TIME') return null; // meter cadence — readings path
        if (!AUTOPILOT_CALENDAR_UNITS.includes(String(job.frequencyUnit || '').toUpperCase()))
            return { label: '⚠ Meter unit on a time schedule', cls: 'bg-red-50 text-red-700 border-red-200' };
        if (!companyAuto)
            return { label: 'Manual — company setting', cls: 'bg-slate-100 text-slate-500 border-slate-200' };
        if (job.autoGenerate === false)
            return { label: 'Manual (Generator only)', cls: 'bg-slate-100 text-slate-500 border-slate-200' };
        const parent = waitingInParent(job);
        if (parent)
            return { label: `Waiting — satisfied by ${parent.code}`, cls: 'bg-violet-50 text-violet-700 border-violet-200' };
        const r = woRollup[job.id];
        if (!r?.completed)
            return { label: 'Arms after 1st completed PM', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
        if (r.open)
            return { label: 'Autopilot · waiting (WO open)', cls: 'bg-blue-50 text-blue-700 border-blue-200' };
        return { label: 'Autopilot active', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    };

    // --- Generator Logic ---
    const [generateDate, setGenerateDate] = useState(new Date().toISOString().split('T')[0]);
    const [generatedPreview, setGeneratedPreview] = useState<any[]>([]);
    const [selectedGenItems, setSelectedGenItems] = useState<Set<number>>(new Set());
    const [generating, setGenerating] = useState(false);
    const [generationResult, setGenerationResult] = useState<string | null>(null);

    const handleRunGenerator = () => {
        setGenerationResult(null);
        const newJobs: any[] = [];

        console.log(`[Generator] Running for date: ${generateDate}, processing ${jobs.length} PMs`);

        jobs.forEach(rj => {
            const statusUpper = (rj.status || '').toUpperCase();
            if (statusUpper !== 'ACTIVE') {
                console.log(`[Generator] SKIP ${rj.code}: status='${rj.status}' (not ACTIVE)`);
                return;
            }
            if (rj.assignedAssets.length === 0) {
                // 0376: a strategy can exist before its assets are linked. Show it,
                // blocked, with the reason — hiding it made "where is my PM?" a
                // support question. Blocked rows cannot be ticked (see Select all).
                newJobs.push({
                    pmId: rj.id,
                    jobCode: rj.code,
                    asset: 'No asset linked',
                    desc: rj.title || rj.jobDescription || rj.description,
                    dueDate: (rj as any).nextDueDate || generateDate,
                    status: 'Blocked',
                    triggerType: rj.scheduleType,
                    blocked: true,
                    reason: 'No asset linked — link one on its Assets tab',
                });
                return;
            }

            // Calculate nextDue: prefer explicit nextDueDate, else compute from lastCompletedDate + frequency
            let nextDue = (rj as any).nextDueDate || (rj as any).next_due_date || '';

            // If no nextDue, compute from the most recent lastCompletedDate
            if (!nextDue && rj.assignedAssets.length > 0 && rj.frequencyInterval) {
                const completedDates = rj.assignedAssets
                    .map(a => a.lastCompletedDate)
                    .filter(d => d && d.length > 0)
                    .map(d => new Date(d!).getTime())
                    .filter(t => !isNaN(t));

                if (completedDates.length > 0) {
                    nextDue = addCadence(new Date(Math.max(...completedDates)), rj.frequencyInterval, rj.frequencyUnit);
                }
            }

            // 0365: lead time is an advance generation window (raise lead-time days before due) and
            // the comparison is on the calendar day, exactly as the daily sweep does it.
            const lead = rj.scheduleType === 'TIME' ? sensibleLeadTimeDays(rj.leadTimeDays, rj.frequencyInterval, rj.frequencyUnit) : 0;
            const isDue = !nextDue || isWithinCallHorizon(nextDue, lead, generateDate);
            console.log(`[Generator] ${rj.code}: nextDue=${nextDue || '(empty)'}, isDue=${isDue}, assets=${rj.assignedAssets.length}`);
            if (!isDue) return;

            const isInspection = rj.jobType === WorkOrderType.INSPECTION || (rj.jobType as string) === 'Inspection';

            if (isInspection) {
                if (rj.assignedAssets.length > 0 && rj.scheduleType === 'TIME') {
                    newJobs.push({
                        pmId: rj.id,
                        jobCode: rj.code,
                        asset: `${rj.assignedAssets.length} Assets (Route)`,
                        desc: rj.jobDescription || rj.description,
                        dueDate: generateDate,
                        status: 'Scheduled',
                        triggerType: 'TIME',
                        reason: `Inspection Round (${rj.frequencyInterval} ${rj.frequencyUnit}) - Grouped`
                    });
                }
            } else {
                rj.assignedAssets.forEach(ra => {
                    const asset = dbAssets.find(a => a.id === ra.assetId);
                    if (rj.scheduleType === 'TIME') {
                        const parent = waitingInParent(rj);
                        const openOrder = woRollup[rj.id]?.open ? (woRollup[rj.id]?.openNumber || 'an open order') : null;
                        newJobs.push({
                            pmId: rj.id,
                            jobCode: rj.code,
                            assetId: ra.assetId,
                            asset: asset?.tag || asset?.name || 'Unknown Asset',
                            desc: rj.title || rj.jobDescription || rj.description,
                            dueDate: nextDue ? toDateOnly(nextDue) : generateDate,
                            status: openOrder ? 'Blocked' : parent ? 'Nested' : 'Scheduled',
                            triggerType: 'TIME',
                            // The sweep never stacks a second open order on a schedule; the
                            // manual path applies the same rule instead of raising a duplicate.
                            blocked: !!openOrder || !!parent,
                            reason: openOrder
                                ? `${openOrder} is still open — complete or cancel it first`
                                : parent
                                    ? `Nested within ${parent.code} (due ${toDateOnly(parent.nextDueDate!)}) — satisfied by that order`
                                    : `Due ${nextDue ? toDateOnly(nextDue) : generateDate} · every ${rj.frequencyInterval} ${String(rj.frequencyUnit || '').toLowerCase()}`
                        });
                    } else if (rj.scheduleType === 'READING') {
                        const lastReading = ra.lastReadingValue || 0;
                        const threshold = rj.frequencyInterval;
                        if (lastReading >= threshold) {
                            newJobs.push({
                                pmId: rj.id,
                                jobCode: rj.code,
                                assetId: ra.assetId,
                                asset: asset?.tag || asset?.name || 'Unknown Asset',
                                desc: rj.jobDescription || rj.description,
                                dueDate: generateDate,
                                status: 'Triggered',
                                triggerType: 'READING',
                                lastReading: lastReading,
                                reason: `Trigger: Reading ≥ ${threshold} ${rj.frequencyUnit}`
                            });
                        }
                    }
                });
            }
        });
        setGeneratedPreview(newJobs);
        setSelectedGenItems(new Set(newJobs.map((j, i) => (j.blocked ? -1 : i)).filter(i => i >= 0)));
    };

    const handleCreateJobs = async () => {
        if (selectedGenItems.size === 0) return;
        setGenerating(true);
        setGenerationResult(null);
        const db = DatabaseService.getInstance();
        let created = 0;
        const incomplete: string[] = [];
        let errors = 0;

        // Iterate per selected item (each is a PM + asset combination)
        const selectedItems = generatedPreview.filter((it: any, i: number) => selectedGenItems.has(i) && !it.blocked);

        // Group items by PM to coordinate date advancement
        const pmGroups: Record<string, typeof selectedItems> = {};
        for (const item of selectedItems) {
            if (!pmGroups[item.pmId]) pmGroups[item.pmId] = [];
            pmGroups[item.pmId].push(item);
        }

        // 0366: longer-interval tasks first — their order satisfies the nested
        // occurrences, and a nested task already satisfied must not be raised again.
        const hasChildren = (id: string) => jobs.some(j => j.parentId === id);
        const carried: string[] = [];
        const carriedBy = new Map<string, string>();
        const ordered = Object.entries(pmGroups).sort(([a], [b]) => Number(hasChildren(b)) - Number(hasChildren(a)));
        for (const [pmId, items] of ordered) {
            // Skip mock PMs (they start with 'pm-')
            if (pmId.startsWith('pm-')) {
                created += items.length;
                continue;
            }
            if (carriedBy.has(pmId)) {
                carried.push(`${items[0]?.jobCode ?? pmId} satisfied by ${carriedBy.get(pmId)}`);
                continue;
            }
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const isLastAssetForPM = i === items.length - 1;
                try {
                    const assetId = item.assetId || undefined;
                    // Only advance PM dates on the last asset so all WOs get the same due date
                    const wo = await db.generateWOFromPM(pmId, assetId, !isLastAssetForPM);
                    created++;
                    for (const cid of ((wo as any)?.__includedScopes as string[] | undefined) || []) {
                        carriedBy.set(cid, `WO-${(wo as any).wo_number ?? ''}`);
                    }
                    // The WO exists, but part of its plan may not have copied —
                    // a technician must not receive it believing it is complete.
                    const missing = (wo as any)?.__copyFailures as string[] | undefined;
                    if (missing?.length) incomplete.push(`${(wo as any).wo_number ?? pmId}: ${missing.join(', ')}`);
                } catch (e: any) {
                    if (e?.absorbed) { carried.push(String(e.message || '').replace(/^Nested: /, '')); continue; }
                    console.error(`Failed to generate WO for PM ${pmId} / asset ${item.asset}:`, e);
                    errors++;
                }
            }
        }

        setGenerating(false);
        let resultMsg = `Created ${created} Work Order${created !== 1 ? 's' : ''}${errors > 0 ? `, ${errors} failed` : ''} successfully.`;
        if (carried.length > 0) {
            resultMsg += ` ${carried.length} nested occurrence${carried.length === 1 ? '' : 's'} satisfied by a longer-interval order — ${carried.join('; ')}.`;
        }
        if (incomplete.length > 0) {
            resultMsg += ` ${incomplete.length} generated without part of their plan — ${incomplete.join('; ')}.`;
        }
        setGenerationResult(resultMsg);
        showToast(resultMsg, errors > 0 || incomplete.length > 0 ? 'warning' : 'success');
        // Reload strategies to reflect updated next_due_date; refresh the open-order
        // roll-up so the chips and the next Generator run see the orders just raised.
        await loadStrategies();
        setRollupTick(t => t + 1);
    };

    const handleJobUpdate = (updates: Partial<RecurringJob>) => {
        if (!selectedJob) return;
        const updatedJob = { ...selectedJob, ...updates };
        setSelectedJob(updatedJob);
        setJobs(prev => prev.map(j => j.id === updatedJob.id ? updatedJob : j));
        setSaveStatus('idle');
    };

    // Linking or unlinking an asset is a fact about the schedule, not a draft:
    // it is written the moment it happens (asset_id mirrors the first link for
    // the sweep and the older readers). Since 0376 a strategy is created without
    // assets and linked here; if this depended on the Save button, a planner who
    // linked two assets and tapped back would leave a schedule that never runs.
    // Steps, labour, parts and the header still save on Save, as before.
    const handleAssetsUpdate = async (updates: Partial<RecurringJob>) => {
        if (!selectedJob) return;
        handleJobUpdate(updates);
        if (updates.assignedAssets === undefined) return;
        const links = updates.assignedAssets || [];
        try {
            await DatabaseService.getInstance().updatePM(selectedJob.id, {
                asset_id: links[0]?.assetId || null,
                assigned_assets: links,
            } as any);
            showToast(links.length === 0 ? 'Asset links removed.' : `${links.length} asset${links.length === 1 ? '' : 's'} linked.`, 'success');
        } catch (e: any) {
            console.error('[RecurringWork] asset link not saved:', e);
            showToast(`Asset link not saved: ${e?.message || e}. Press Save to retry.`, 'error');
        }
    };

    const handleDuplicate = async () => {
        if (!selectedJob) return;
        if (!canCreatePM) { denied('create strategies'); return; }
        const dupAssetId = selectedJob.assignedAssets?.[0]?.assetId;
        if (!dupAssetId) { showToast('Cannot duplicate: this strategy has no assigned asset.', 'error'); return; }
        setDuplicating(true);
        try {
            const newPM = buildPMStrategy({
                title: (selectedJob.description || 'PM Strategy') + ' (Copy)',
                description: (selectedJob.description || '') + ' (Copy)',
                assetId: dupAssetId,
                scheduleType: selectedJob.scheduleType,
                frequencyInterval: selectedJob.frequencyInterval,
                frequencyUnit: selectedJob.frequencyUnit,
                leadTimeDays: selectedJob.leadTimeDays,
                jobType: selectedJob.jobType,
                priorityCode: selectedJob.priority,
                estDuration: selectedJob.estDuration,
                estDowntime: selectedJob.estDowntime,
                createdBy: 'system',
                templates: {
                    tasks: selectedJob.tasks || [],
                    jsa: selectedJob.jsa || null,
                    labor: selectedJob.labor || [],
                    inventory: selectedJob.inventory || [],
                },
            });
            await DatabaseService.getInstance().createPM(newPM);
            showToast('Strategy duplicated successfully', 'success');
            await loadStrategies();
        } catch (e) {
            console.error('Duplicate failed', e);
            showToast('Failed to duplicate strategy', 'error');
        } finally {
            setDuplicating(false);
        }
    };

    const handleDelete = async () => {
        if (!selectedJob) return;
        if (!canDeletePM) { denied('delete strategies'); return; }
        console.log('[RecurringWork] handleDelete triggered for:', selectedJob.id, selectedJob.code);
        setShowDeleteConfirm(true);
    };

    const confirmDelete = async () => {
        if (!selectedJob) return;
        setShowDeleteConfirm(false);

        setDeleting(true);
        try {
            console.log('[RecurringWork] Calling deletePM for:', selectedJob.id);
            await DatabaseService.getInstance().deletePM(selectedJob.id);
            console.log('[RecurringWork] deletePM success');

            setSelectedJob(null);
            setJobs(prev => prev.filter(j => j.id !== selectedJob.id));
            showToast('Strategy deleted', 'success');
        } catch (e) {
            console.error('Delete failed', e);
            showToast('Failed to delete strategy', 'error');
        } finally {
            setDeleting(false);
        }
    };

    const filteredJobs = useMemo(() => {
        let result = jobs;
        // Status filter (Phase 4A)
        if (statusFilter !== 'ALL') {
            result = result.filter(j => j.status === statusFilter);
        }
        // Overdue deep-link: active programmes whose next due date has passed
        // (same definition the Specialist's digest and missions use).
        if (overdueOnly) {
            const today = toDateOnly(new Date());
            result = result.filter(j => {
                const due = (j as any).nextDueDate || (j as any).next_due_date || '';
                return j.status === 'ACTIVE' && due && toDateOnly(due) < today;
            });
        }
        // Search text
        if (searchQuery.trim()) {
            // A trailing space or a pasted en-dash ("PM–44743") used to match
            // nothing while the pill counts still said 9 — the list just went blank.
            const norm = (v: string) => v.toLowerCase().replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ').trim();
            const q = norm(searchQuery);
            result = result.filter(j =>
                norm(j.code || '').includes(q) ||
                norm(j.title || '').includes(q) ||
                norm(j.jobDescription || j.description || '').includes(q) ||
                norm(j.jobType || '').includes(q)
            );
        }
        return result;
    }, [jobs, searchQuery, statusFilter, overdueOnly]);

    // Status counts for pills (Phase 4A)
    const statusCounts = useMemo(() => {
        const counts: Record<string, number> = { ALL: jobs.length, ACTIVE: 0, PAUSED: 0, DRAFT: 0, EXPIRED: 0 };
        jobs.forEach(j => { if (counts[j.status] !== undefined) counts[j.status]++; });
        return counts;
    }, [jobs]);

    // Grouped jobs (Phase 4A)
    const groupedJobs = useMemo(() => {
        if (groupBy === 'none') return { '': filteredJobs };
        const groups: Record<string, typeof filteredJobs> = {};
        filteredJobs.forEach(j => {
            const key = groupBy === 'status' ? j.status : groupBy === 'jobType' ? (j.jobType || 'Unknown') : (j.rcmStrategy || 'Not Set');
            if (!groups[key]) groups[key] = [];
            groups[key].push(j);
        });
        return groups;
    }, [filteredJobs, groupBy]);

    // Bulk actions (Phase 4A)
    const handleBulkStatusChange = (newStatus: 'ACTIVE' | 'PAUSED') => {
        if (!canEditPM) { denied('pause or activate strategies'); return; }
        setJobs(prev => prev.map(j => selectedIds.has(j.id) ? { ...j, status: newStatus } : j));
        showToast(`${selectedIds.size} job(s) set to ${newStatus}`, 'success');
        setSelectedIds(new Set());
    };

    const handleBulkGenerate = () => {
        if (!canEditPM) { denied('generate work orders from strategies'); return; }
        setShowGenerator(true);
        // Pre-load generator with selected items only
    };

    // The due-list is a pure local calculation over the loaded schedules, so it
    // runs by itself when the window opens and whenever the date or the
    // schedules change — no "Run Analysis" click, no empty placeholder, and no
    // stale tick-set from a previous run counting on the Create button.
    const closeGenerator = () => {
        setShowGenerator(false);
        setGeneratedPreview([]);
        setSelectedGenItems(new Set());
        setGenerationResult(null);
    };
    useEffect(() => {
        if (!showGenerator || generationResult) return;
        handleRunGenerator();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showGenerator, generateDate, jobs, woRollup]);

    const toggleSelect = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === filteredJobs.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredJobs.map(j => j.id)));
        }
    };

    // Load templates from DB when selecting a real (non-mock) job
    const handleSelectJob = async (job: RecurringJob) => {
        setSelectedJob(job);
        setActiveTab('details');
        setSaveStatus('idle');
        // If this is a DB-persisted job (not mock), load templates
        if (job.id && !job.id.startsWith('pm-')) {
            try {
                const templates = await DatabaseService.getInstance().getPMTemplates(job.id);
                if (templates.tasks.length > 0 || templates.labor.length > 0 || templates.inventory.length > 0 || templates.jsa) {
                    const updatedJob = {
                        ...job,
                        tasks: templates.tasks.length > 0 ? templates.tasks : job.tasks,
                        labor: templates.labor.length > 0 ? templates.labor : job.labor,
                        inventory: templates.inventory.length > 0 ? templates.inventory : job.inventory,
                        jsa: templates.jsa || job.jsa,
                    };
                    setSelectedJob(updatedJob);
                    setJobs(prev => prev.map(j => j.id === updatedJob.id ? updatedJob : j));
                }
            } catch (e) {
                console.error('Failed to load PM templates:', e);
            }
        }
    };

    const handleSave = async () => {
        if (!selectedJob) return;
        if (!canEditPM) { denied('edit strategies'); return; }
        setSaving(true);
        setSaveStatus('idle');
        try {
            const db = DatabaseService.getInstance();
            const headerPayload: any = {
                description: selectedJob.jobDescription || selectedJob.description,
                status: selectedJob.status,
                schedule_type: selectedJob.scheduleType,
                frequency_interval: selectedJob.frequencyInterval,
                frequency_unit: selectedJob.frequencyUnit,
                auto_generate: selectedJob.autoGenerate !== false, // 0304 Autopilot
                parent_pm_id: selectedJob.parentId || null,       // 0366 nested within
                nesting_mode: selectedJob.nestingMode === 'COMBINES' ? 'COMBINES' : 'SUPERSEDES',
                lead_time_days: selectedJob.leadTimeDays,
                job_type: selectedJob.jobType,
                priority_code: selectedJob.priority,
                strategy_id: (selectedJob as any).strategyId || null,
                strategy_package: (selectedJob as any).strategyPackage || null,
                // 0299: provenance survives the whole-row save — never dropped.
                origin: (selectedJob as any).origin || null,
                // Steps with hours own the estimate — the generated order copies est_duration,
                // so a typed 3 h beside 7 h of steps must not survive the save.
                est_duration: stepsHours(selectedJob.tasks).total || selectedJob.estDuration || 0,
                est_downtime: selectedJob.estDowntime || 0,
                // Persist the primary asset link
                asset_id: selectedJob.assignedAssets?.[0]?.assetId || null,
                // Persist full assigned assets array with per-asset dates
                assigned_assets: selectedJob.assignedAssets || [],
                // Failure Impact (ISO 14224 §B.2.5)
                local_impact: selectedJob.localImpact || null,
                plant_wide_impact: selectedJob.plantWideImpact || null,
            };

            // Auto-calculate next_due_date from the most recent lastCompletedDate + frequency
            const completedDates = (selectedJob.assignedAssets || [])
                .map(a => a.lastCompletedDate)
                .filter(d => d && d.length > 0)
                .map(d => new Date(d!).getTime())
                .filter(t => !isNaN(t));

            if (completedDates.length > 0 && selectedJob.frequencyInterval) {
                headerPayload.next_due_date = addCadence(new Date(Math.max(...completedDates)), selectedJob.frequencyInterval, selectedJob.frequencyUnit);
            }
            // 0365 — on a calendar schedule: the planner's own next-due date wins; a
            // cadence change on a schedule that has never generated moves the first
            // due date to today (PM-44743 kept a +30-day date after "Months" became
            // "Days"); lead time is clamped below the cadence, as the sweep clamps it.
            if (String(selectedJob.scheduleType || 'TIME').toUpperCase() === 'TIME') {
                const dOnly = (v?: string) => (v ? toDateOnly(v) : '');
                const cadenceNow = `${selectedJob.frequencyInterval}|${selectedJob.frequencyUnit}`;
                if (dOnly(selectedJob.nextDueDate) !== dOnly(selectedJob.loadedNextDue)) {
                    headerPayload.next_due_date = dOnly(selectedJob.nextDueDate) || null;
                } else if (!headerPayload.next_due_date && !selectedJob.lastGeneratedDate
                    && selectedJob.loadedCadence && selectedJob.loadedCadence !== cadenceNow) {
                    headerPayload.next_due_date = firstDueDate();
                }
                headerPayload.lead_time_days = sensibleLeadTimeDays(selectedJob.leadTimeDays, selectedJob.frequencyInterval, selectedJob.frequencyUnit);
            }
            if (headerPayload.next_due_date !== undefined) {
                // Update local state so the Generator and the Autopilot chip see it immediately
                const updatedJob = {
                    ...selectedJob,
                    nextDueDate: headerPayload.next_due_date || '',
                    loadedNextDue: headerPayload.next_due_date || '',
                    loadedCadence: `${selectedJob.frequencyInterval}|${selectedJob.frequencyUnit}`,
                };
                setSelectedJob(updatedJob);
                setJobs(prev => prev.map(j => j.id === updatedJob.id ? updatedJob : j));
            }
            console.log('[handleSave] PM ID:', selectedJob.id, 'Payload:', headerPayload);
            // Save header fields
            await db.updatePM(selectedJob.id, headerPayload);
            // Save templates (tasks, jsa, labor, inventory). This is the job
            // plan — the steps, hazards, labour and parts. Losing it silently
            // was never "non-critical": the header saved, the user was told the
            // strategy saved, and every step they had just written was gone on
            // the next reload.
            let templateError: string | null = null;
            try {
                await db.savePMTemplates(selectedJob.id, {
                    tasks: selectedJob.tasks || [],
                    jsa: selectedJob.jsa || null,
                    labor: selectedJob.labor || [],
                    inventory: selectedJob.inventory || [],
                });
            } catch (templateErr: any) {
                templateError = templateErr?.message || String(templateErr);
                console.error('[handleSave] Template save failed:', templateError);
            }

            if (templateError) {
                setSaveStatus('error');
                showToast(
                    `Schedule details saved, but the job plan (steps, JSA, labour, parts) did NOT save: ${templateError}. Re-save before leaving this page.`,
                    'error'
                );
                return;
            }

            setSaveStatus('saved');
            showToast('Strategy saved successfully', 'success');
            setTimeout(() => setSaveStatus('idle'), 3000);
        } catch (e: any) {
            console.error('Failed to save PM:', e);
            setSaveStatus('error');
            showToast(`Failed to save: ${e?.message || 'Unknown error'}`, 'error');
        } finally {
            setSaving(false);
        }
    };

    const TABS: { id: TabId; label: string; icon: any }[] = [
        { id: 'details', label: 'Details', icon: FileText },
        { id: 'assets', label: 'Assets', icon: Package },
        { id: 'tasks', label: 'Tasks', icon: ClipboardList },
        { id: 'jsa', label: 'Safety (JSA)', icon: Shield },
        { id: 'labor', label: 'Labour', icon: Users },
        { id: 'inventory', label: 'Inventory', icon: Layers },
        { id: 'files', label: 'Files', icon: LinkIcon },
        { id: 'history', label: 'History', icon: History },
    ];

    // Mobile tab navigation: the strip scrolls, so keep the active tab visible
    // and give thumbs prev/next steppers instead of hunting by swipe.
    const activeTabIndex = TABS.findIndex(t => t.id === activeTab);
    const tabStripRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        // Only when the strip actually overflows: on a wide screen every tab is
        // already visible, and centring the active one just scrolled the first
        // tab (Details) out of sight (seen when Create opens on Assets).
        const strip = tabStripRef.current;
        if (!strip || strip.scrollWidth <= strip.clientWidth + 2) return;
        strip.querySelector<HTMLElement>('[data-tab-active]')
            ?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
    }, [activeTab]);

    /**
     * Job-plan import — the procedure content a migrated PM otherwise lacks.
     *
     * Each row is one operation; rows are grouped by pmCode into that
     * schedule's task list (recurring_work.templates.tasks), which is what
     * generateWOFromPM copies onto every work order the schedule raises.
     * Re-importing a pmCode replaces that schedule's plan, so a corrected
     * export can simply be re-run.
     */
    const handleJobPlanImport = async (rows: Record<string, string>[]) => {
        const db = DatabaseService.getInstance();
        const res = emptyResult();

        // recurring_work.code carries no unique constraint, so a code that
        // matches more than one schedule is ambiguous and must not be guessed.
        const pmsByCode = new Map<string, RecurringJob[]>();
        for (const pm of jobs) {
            const key = (pm.code || '').toUpperCase();
            if (!key) continue;
            (pmsByCode.get(key) ?? pmsByCode.set(key, []).get(key)!).push(pm);
        }

        const centres = await db.getWorkCenters().catch(() => [] as any[]);
        const centreByCode = new Map(
            (centres || []).map((c: any) => [String(c.code ?? '').toUpperCase(), c.id])
        );

        // A SAP general task list is referenced by its group/counter
        // ("30009001/01"), stamped on each schedule's origin by the schedule
        // import. Unlike a PM code, one task list legitimately serves several
        // schedules — the operations attach to every one of them.
        const pmsByTaskList = new Map<string, RecurringJob[]>();
        for (const pm of jobs) {
            const origin = pm.origin as Record<string, unknown> | undefined;
            const ref = String(origin?.task_list ?? '').toUpperCase();
            // A package sibling ("…-12M") carries the task list too, but it is
            // derived from its base schedule — re-importing the list must find
            // the base and reuse the sibling, never give the sibling a sibling.
            if (!ref || origin?.split_from) continue;
            (pmsByTaskList.get(ref) ?? pmsByTaskList.set(ref, []).get(ref)!).push(pm);
        }

        // Group operations by the schedule they belong to, preserving sheet order.
        interface Op { row: number; data: Record<string, string> }
        const opsByPm = new Map<string, { pms: RecurringJob[]; ops: Op[] }>();
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const rowNo = Number(r.__row) || i + 2;
            const code = (r['pmcode'] || '').trim();
            if (!code) { tally(res, { row: rowNo, status: 'failed', reason: 'Missing pmCode' }); continue; }
            const key = code.toUpperCase();
            let matches = pmsByCode.get(key) ?? [];
            let shared = false;
            if (matches.length === 0 && pmsByTaskList.has(key)) { matches = pmsByTaskList.get(key)!; shared = true; }
            if (matches.length === 0) {
                tally(res, { row: rowNo, key: code, status: 'failed', reason: key.includes('/')
                    ? `No schedule uses task list ${code} — import the maintenance items (schedules) first`
                    : `PM schedule "${code}" not found — import schedules first` });
                continue;
            }
            if (matches.length > 1 && !shared) {
                tally(res, { row: rowNo, key: code, status: 'failed', reason: `PM code "${code}" matches ${matches.length} schedules — cannot tell which` });
                continue;
            }
            (opsByPm.get(key) ?? opsByPm.set(key, { pms: matches, ops: [] }).get(key)!).ops.push({ row: rowNo, data: r });
        }

        const reportedCentres = new Set<string>();
        const itemByCode = new Map<string, any>();
        for (const it of inventoryItems) {
            if (it.code) itemByCode.set(String(it.code).toUpperCase(), it);
            if (it.materialNumber) itemByCode.set(String(it.materialNumber).toUpperCase(), it);
        }
        const unlinkedMaterials = new Set<string>();

        const buildPlan = async (ops: Op[], key: string) => {
            const tasks: JobTask[] = [];
            const inventory: JobInventory[] = [];
            for (let idx = 0; idx < ops.length; idx++) {
                const op = ops[idx];
                const d = op.data;
                const seq = (idx + 1) * 10;
                const centreId = await ensureWorkCentre(db, centreByCode, d['workcentre'], res, reportedCentres);
                const longText = (d['longtext'] || '').trim();
                const taskId = `imp-${Date.now()}-${key}-${idx}`;
                tasks.push({
                    id: taskId,
                    sequence: seq,
                    operationNo: (d['operationno'] || String(seq).padStart(4, '0')).trim(),
                    description: d['description'] || 'Imported operation',
                    estHours: parseFloat(d['esthours'] || '0') || 0,
                    status: 'PENDING',
                    controlKey: (d['controlkey'] || 'PM01').toUpperCase(),
                    workCenterId: centreId,
                    // The long text is what a technician actually reads on the
                    // work order, so it becomes a procedure block rather than
                    // being stashed somewhere the app never renders.
                    instructions: longText
                        ? [{ id: `ib-${Date.now()}-${idx}`, type: 'PROCEDURE', content: longText, required: false }]
                        : [],
                } as unknown as JobTask);
                // Planned materials (SAP task-list components) → the plan's
                // parts, linked to inventory by part number when it exists.
                let materials: { code: string; qty: string; uom: string }[] = [];
                try { materials = d['materials'] ? JSON.parse(d['materials']) : []; } catch { materials = []; }
                for (const m of materials) {
                    const item = itemByCode.get(m.code.toUpperCase());
                    if (!item) unlinkedMaterials.add(m.code);
                    inventory.push({
                        id: `inv-${Date.now()}-${key}-${idx}-${inventory.length}`,
                        inventoryId: item?.id || '',
                        description: item?.description || m.code,
                        uom: m.uom || item?.uom || 'EA',
                        estQty: parseFloat(m.qty) || 1,
                        estUnitCost: Number(item?.itemCost) || 0,
                        jobTaskId: taskId,
                    });
                }
            }
            return { tasks, inventory };
        };

        const savePlan = async (pm: RecurringJob, ops: Op[], key: string) => {
            const existing = await db.getPMTemplates(pm.id).catch(() => null);
            const { tasks, inventory } = await buildPlan(ops, key);
            await db.savePMTemplates(pm.id, { ...(existing || {}), tasks, inventory });
            const replaced = (existing?.tasks ?? []).length;
            if (replaced > 0) res.notes!.push(`${pm.code}: replaced an existing ${replaced}-step plan.`);
        };

        for (const [key, { pms, ops }] of opsByPm) {
            // Operation numbers order the plan; blanks keep sheet order behind them.
            const sorted = [...ops].sort((a, b) => {
                const an = parseInt(a.data['operationno'] || '', 10);
                const bn = parseInt(b.data['operationno'] || '', 10);
                if (isNaN(an) && isNaN(bn)) return a.row - b.row;
                if (isNaN(an)) return 1;
                if (isNaN(bn)) return -1;
                return an - bn;
            });

            // A strategy task list carries a package (cadence) per operation.
            // IREAMS has one cadence per schedule, so the schedule keeps the
            // shortest package and each longer package becomes its own
            // schedule beside it — the shape SAP itself schedules.
            const split = splitOperationsByCadence(sorted.map(op => {
                const iv = Number(op.data['frequencyinterval']);
                const unit = sapCycleUnit(op.data['frequencyunit']);
                return { op, cadence: iv > 0 && unit ? { interval: iv, unit } : null };
            }));

            for (const pm of pms) {
                try {
                    await savePlan(pm, split.base.ops, key);
                    const base = split.base.cadence;
                    const own = { interval: pm.frequencyInterval, unit: sapCycleUnit(pm.frequencyUnit) };
                    const origin = (pm.origin ?? {}) as Record<string, unknown>;
                    if (base && origin.cadence_from === 'plan_text' && !(own.unit && cadenceEquals(base, { interval: own.interval, unit: own.unit }))) {
                        // The schedule import could only guess the cadence from
                        // the plan text; the package sheet is the authority.
                        await db.updatePM(pm.id, {
                            frequency_interval: base.interval, frequency_unit: base.unit.toLowerCase(),
                            schedule_type: isMeterUnit(base.unit) ? 'READING' : 'TIME',
                            origin: { ...origin, cadence_from: 'task_list_package' },
                        } as any);
                        res.notes!.push(`${pm.code}: cadence corrected to ${cadenceLabel(base)} from the task list packages.`);
                    }
                    for (const sib of split.siblings) {
                        const cadence = sib.cadence!;
                        const sibCode = `${pm.code}-${cadenceSuffix(cadence)}`;
                        const pkgText = sib.ops[0]?.data['packagetext'] || cadenceLabel(cadence);
                        let sibling = pmsByCode.get(sibCode.toUpperCase())?.[0];
                        if (!sibling) {
                            const assetId = pm.assignedAssets?.[0]?.assetId;
                            if (!assetId) { sib.ops.forEach(op => tally(res, { row: op.row, key: sibCode, status: 'failed', reason: `${pm.code} has no asset to clone for the ${pkgText} package` })); continue; }
                            const created = await db.createPM(buildPMStrategy({
                                code: sibCode,
                                title: `${pm.description} — ${pkgText}`,
                                description: `${pm.description} — ${pkgText}`,
                                assetId,
                                scheduleType: isMeterUnit(cadence.unit) ? 'READING' : 'TIME',
                                frequencyInterval: cadence.interval,
                                frequencyUnit: cadence.unit.toLowerCase(),
                                jobType: pm.jobType,
                                priorityCode: pm.priority,
                                leadTimeDays: pm.leadTimeDays,
                                estDuration: pm.estDuration,
                                estDowntime: pm.estDowntime,
                                nextDueDate: pm.nextDueDate || undefined,
                                origin: { ...origin, package: sib.ops[0]?.data['package'] || null, package_text: pkgText, split_from: pm.code, cadence_from: 'task_list_package' },
                            }));
                            sibling = { ...pm, id: String(created?.id ?? created?.[0]?.id ?? ''), code: sibCode } as RecurringJob;
                            if (!sibling.id) throw new Error(`Could not create ${sibCode}`);
                            pmsByCode.set(sibCode.toUpperCase(), [sibling]);
                            res.notes!.push(`${pm.code}: package "${pkgText}" became its own schedule ${sibCode} (${sib.ops.length} operation${sib.ops.length === 1 ? '' : 's'}).`);
                        }
                        await savePlan(sibling, sib.ops, `${key}-${cadenceSuffix(cadence)}`);
                    }
                    sorted.forEach(op => tally(res, { row: op.row, key: pm.code, status: 'inserted' }));
                } catch (e: unknown) {
                    sorted.forEach(op => tally(res, { row: op.row, key: pm.code, status: 'failed', reason: errMessage(e) }));
                }
            }
        }

        if (unlinkedMaterials.size > 0) {
            res.notes!.push(`${unlinkedMaterials.size} planned material code(s) not in inventory — kept as text lines (${[...unlinkedMaterials].slice(0, 5).join(', ')}${unlinkedMaterials.size > 5 ? '…' : ''}); import the materials and re-import the task list to link them.`);
        }
        if (res.inserted > 0) {
            res.notes!.push('Job plans flow onto work orders when the schedule next generates.');
        }
        showToast(`Imported ${res.inserted} operations across ${opsByPm.size} schedule(s)`, res.failed === 0 ? 'success' : 'warning');
        loadStrategies();
        return res;
    };

    // --- Bulk Import handler for Recurring Jobs ---
    const handleBulkImportData = async (type: ImportType, rows: Record<string, string>[]) => {
        if (type === 'jobplan') return handleJobPlanImport(rows);
        if (type !== 'recurring') return;
        const db = DatabaseService.getInstance();
        const res = emptyResult();

        // Tags were matched case-sensitively, so "gt-301" silently vanished.
        const assetByTag = new Map(dbAssets.map(a => [(a.tag || '').toUpperCase(), a.id]));
        const centres = await db.getWorkCenters().catch(() => [] as any[]);
        const centreByCode = new Map<string, string>((centres || []).map((c: any) => [String(c.code ?? '').toUpperCase(), c.id]));
        const reportedCentres = new Set<string>();

        // The template's vocabulary is not the app's — translate rather than
        // defaulting everything to Preventive/MED.
        const JOB_TYPES: Record<string, string> = {
            PM: 'Preventive', PDM: 'Predictive', INSPECTION: 'Inspection', CM: 'Corrective',
        };
        const PRIORITIES: Record<string, string> = {
            EMERGENCY: 'EMG', HIGH: 'HIGH', MEDIUM: 'MED', LOW: 'LOW',
        };

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowNo = Number(row.__row) || i + 2;
            const code = row['code'] || `PM-${Date.now()}-${i}`;
            const tag = row['assettag'] || '';

            const importAssetId = assetByTag.get(tag.toUpperCase());
            if (!importAssetId) {
                tally(res, { row: rowNo, key: code, status: 'failed', reason: `Asset tag "${tag || '(blank)'}" not found — import assets first` });
                continue;
            }

            try {
                const importTitle = row['title'] || row['jobdescription'] || row['description'] || code || 'Imported PM';
                const rawJob = (row['jobtype'] || '').toUpperCase();
                const rawPrio = (row['priority'] || '').toUpperCase();
                const payload = buildPMStrategy({
                    code,
                    title: importTitle,
                    description: row['description'] || row['jobdescription'] || row['title'] || 'Imported PM',
                    status: (row['status'] || 'ACTIVE').toUpperCase(),
                    assetId: importAssetId,
                    scheduleType: (row['scheduletype'] || 'TIME').toUpperCase(),
                    frequencyInterval: parseInt(row['frequencyinterval'] || '1') || 1,
                    frequencyUnit: (row['frequencyunit'] || 'months').toLowerCase(),
                    jobType: JOB_TYPES[rawJob] || row['jobtype'] || 'Preventive',
                    priorityCode: PRIORITIES[rawPrio] || row['priority'] || 'MED',
                    estDuration: parseFloat(row['estduration'] || '0') || 0,
                    estDowntime: parseFloat(row['estdowntime'] || '0') || 0,
                    // Both were collected by the template and thrown away here.
                    leadTimeDays: row['leadtimedays'] ? (parseInt(row['leadtimedays']) || undefined) : undefined,
                    nextDueDate: parseDateValue(row['nextduedate'] || '') || undefined,
                    workCenterId: row['workcentre'] ? ((await ensureWorkCentre(db, centreByCode, row['workcentre'], res, reportedCentres)) ?? null) : undefined,
                    // A SAP maintenance item remembers its plan, strategy and task
                    // list, so the job-plan import can find it by task list and
                    // knows whether the cadence was read from the plan text.
                    origin: row['plan'] || row['tasklist'] ? {
                        source: 'sap_load_file',
                        plan: row['plan'] || null,
                        plan_text: row['plantext'] || null,
                        item: code,
                        strategy: row['strategy'] || null,
                        task_list: row['tasklist'] || null,
                        order_type: row['ordertype'] || null,
                        activity_type: row['activitytype'] || null,
                        cadence_from: row['_cadencehint'] ? 'plan_text' : row['frequencyinterval'] ? 'plan_cycle' : 'sheet',
                    } : undefined,
                });
                await db.createPM(payload);
                if (row['rcmstrategy'] || row['costcenter'] || row['department']) {
                    res.notes!.push(`Row ${rowNo}: rcmStrategy / costCenter / department are not stored on a PM — set them on the job afterwards.`);
                }
                tally(res, { row: rowNo, key: code, status: 'inserted' });
            } catch (e: unknown) {
                tally(res, { row: rowNo, key: code, status: 'failed', reason: errMessage(e) });
            }
        }

        showToast(`Imported ${res.inserted} of ${rows.length} recurring jobs`, res.failed === 0 ? 'success' : 'warning');
        loadStrategies();
        return res;
    };

    return (
        <div className="flex lg:h-[calc(100vh-6rem)] gap-6 relative">
            {/* List Sidebar — below lg the page itself scrolls (no half-height inner list) */}
            <div className={`flex flex-col bg-white rounded-card shadow-card border border-slate-200 lg:overflow-hidden transition-all duration-300 ${isFullscreen ? 'hidden' : selectedJob ? 'w-1/3 hidden lg:flex' : 'w-full ers-page-record'}`}>
                <div className="p-3 sm:p-4 border-b border-slate-200 flex justify-between items-center">
                    <h2 className="font-bold text-slate-900">Recurring Jobs</h2>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setShowBulkImport(true)}
                            className="bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2 shadow-sm"
                            title="Bulk Import Recurring Jobs"
                        >
                            <Upload size={16} /> <span className="hidden xl:inline">Import</span>
                        </button>
                        <button
                            onClick={() => canEditPM ? setShowGenerator(true) : denied('generate work orders from strategies')}
                            disabled={!canEditPM}
                            className="bg-primary-600 hover:bg-primary-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                            title={canEditPM ? 'Run Job Generator' : 'Needs Recurring Work · Edit'}
                        >
                            <Zap size={16} /> <span className="hidden xl:inline">Generate</span>
                        </button>
                        <button
                            onClick={() => canCreatePM ? setIsCreatePMOpen(true) : denied('create strategies')}
                            disabled={!canCreatePM}
                            title={canCreatePM ? 'New strategy' : 'Needs Recurring Work · Create'}
                            className="bg-primary-600 hover:bg-primary-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Plus size={16} /> New
                        </button>
                    </div>
                </div>

                <div className="p-3 sm:p-4 border-b border-slate-200 bg-slate-50 space-y-2 sm:space-y-3">
                    <div className="flex gap-2">
                        <div className="relative flex-1 min-w-0">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                            <input
                                type="text"
                                placeholder="Search PMs..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowFilterSheet(true)}
                            className={`sm:hidden relative flex-shrink-0 w-11 rounded-lg border flex items-center justify-center ${groupBy !== 'none' ? 'bg-primary-50 border-primary-300 text-primary-700' : 'bg-white border-slate-300 text-slate-600'}`}
                            title="View options"
                            aria-label="View options"
                        >
                            <Filter size={16} />
                            {groupBy !== 'none' && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-primary-600 border-2 border-white" />}
                        </button>
                    </div>
                    {/* Phase 4A — Status Filter Pills: one swipeable row on phones, wrapping on sm+ */}
                    <div className="flex gap-1.5 flex-nowrap overflow-x-auto scrollbar-hide -mx-3 px-3 sm:mx-0 sm:px-0 sm:flex-wrap sm:overflow-visible">
                        {overdueOnly && (
                            <button
                                onClick={() => setOverdueOnly(false)}
                                title="Showing only past-due active programmes — click to clear"
                                className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase border bg-amber-500 text-white border-amber-500 shadow-sm flex items-center gap-1.5 flex-shrink-0"
                            >
                                Overdue only ✕
                            </button>
                        )}
                        {(['ALL', 'ACTIVE', 'PAUSED', 'DRAFT', 'EXPIRED'] as StatusFilter[]).map(s => (
                            <button
                                key={s}
                                onClick={() => { setStatusFilter(s); setSelectedIds(new Set()); }}
                                className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase border transition-all flex items-center gap-1.5 flex-shrink-0 ${statusFilter === s
                                    ? 'bg-primary-600 text-white border-blue-600 shadow-sm'
                                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                                    }`}
                            >
                                {s === 'ALL' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
                                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${statusFilter === s ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                                    }`}>{statusCounts[s]}</span>
                            </button>
                        ))}
                    </div>
                    {/* Phase 4A — GroupBy + Select All (sm+; phones use the view-options sheet) */}
                    <div className="hidden sm:flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <label className="text-[10px] font-bold text-slate-400 uppercase">Group:</label>
                            <select
                                value={groupBy}
                                onChange={e => setGroupBy(e.target.value as GroupBy)}
                                className="text-[11px] px-2 py-1 border border-slate-200 rounded bg-white text-slate-600"
                            >
                                <option value="none">None</option>
                                <option value="status">Status</option>
                                <option value="jobType">Job Type</option>
                                <option value="rcmStrategy">RCM Strategy</option>
                            </select>
                        </div>
                        <button
                            onClick={toggleSelectAll}
                            className="text-[10px] text-blue-600 hover:text-blue-800 font-medium"
                        >
                            {selectedIds.size === filteredJobs.length && filteredJobs.length > 0 ? 'Deselect All' : 'Select All'}
                        </button>
                    </div>
                </div>

                {/* Phase 5B — PM Calendar toggle (sm+; phones use the view-options sheet) */}
                <div className="hidden sm:block px-4 py-2 border-b border-slate-200 bg-white">
                    <button
                        onClick={() => setShowCalendar(!showCalendar)}
                        className="text-xs flex items-center gap-2 text-slate-500 hover:text-blue-600 font-medium w-full"
                    >
                        <Calendar size={14} />
                        PM Calendar
                        {showCalendar ? <ChevronUp size={12} className="ml-auto" /> : <ChevronDown size={12} className="ml-auto" />}
                    </button>
                    {showCalendar && <PMCalendarWidget jobs={jobs} calendarDate={calendarDate} onDateChange={setCalendarDate} />}
                </div>

                <div className="flex-1 overflow-y-auto">
                    {filteredJobs.length === 0 && (
                        <div className="p-10 text-center text-sm text-slate-500">
                            {jobs.length === 0
                                ? 'No recurring jobs yet — create one with New.'
                                : searchQuery.trim()
                                    ? <>No schedule matches “{searchQuery.trim()}” — searched code, title, description and type across {jobs.length} schedules.</>
                                    : 'No schedules match the current filters.'}
                        </div>
                    )}
                    {(Object.entries(groupedJobs) as [string, RecurringJob[]][]).map(([groupLabel, groupItems]) => (
                        <div key={groupLabel}>
                            {groupBy !== 'none' && (
                                <div className="px-4 py-2 bg-slate-100 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider sticky top-0 z-10">
                                    {groupLabel} ({groupItems.length})
                                </div>
                            )}
                            {groupItems.map(job => {
                                const nextDue = (job as any).next_due_date || (job as any).nextDueDate;
                                // Overdue = due DAY earlier than today (0365 stores midnight due dates,
                                // so a timestamp compare flagged a schedule overdue on its own due day).
                                const isOverdue = !!nextDue && toDateOnly(nextDue) < toDateOnly(new Date());
                                const isDueToday = !!nextDue && toDateOnly(nextDue) === toDateOnly(new Date());
                                const isSelected = selectedIds.has(job.id);
                                return (
                                    <div
                                        key={job.id}
                                        className={`mobile-card flex items-start gap-3 ${selectedJob?.id === job.id ? 'bg-blue-50 border-l-4 border-l-blue-600' : ''} ${isSelected ? 'bg-blue-50/40' : ''} ${isOverdue ? 'overdue-strip' : ''}`}
                                    >
                                        {/* Checkbox */}
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={(e) => { e.stopPropagation(); toggleSelect(job.id); }}
                                            onClick={(e) => e.stopPropagation()}
                                            className="mt-1 h-3.5 w-3.5 rounded text-blue-600 cursor-pointer flex-shrink-0"
                                        />
                                        <div className="flex-1 min-w-0" onClick={() => handleSelectJob(job)}>
                                            <div className="flex justify-between items-start mb-0.5">
                                                <span className="font-mono text-xs font-bold text-slate-500">{job.code}</span>
                                                <div className="flex items-center gap-1">
                                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${job.status === 'ACTIVE' ? 'bg-green-50 text-green-700 border-green-200' : job.status === 'PAUSED' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>{job.status}</span>
                                                    <span className="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-bold uppercase">{job.scheduleType}</span>
                                                    <PmReadinessChip readiness={assessPmReadiness(job, dbAssets)} />
                                                </div>
                                            </div>
                                            <h3 className="text-sm font-bold text-slate-900 mb-1 line-clamp-1">{job.title || job.jobDescription || job.description}</h3>
                                            {job.title && (job.jobDescription || job.description) && (job.jobDescription || job.description) !== job.title && (
                                                <p className="text-[11px] text-slate-500 -mt-0.5 mb-1 line-clamp-1">{job.jobDescription || job.description}</p>
                                            )}
                                            <div className="text-[11px] text-slate-500 flex gap-3 flex-wrap">
                                                <span className="flex items-center gap-1">
                                                    <Clock size={11} /> {job.frequencyInterval} {job.frequencyUnit}
                                                </span>
                                                <span className={`flex items-center gap-1 font-medium ${job.jobType === 'Inspection' ? 'text-blue-600' : 'text-blue-600'}`}>
                                                    {job.jobType === 'Inspection' ? <ClipboardList size={11} /> : <Package size={11} />}
                                                    {job.jobType}
                                                </span>
                                                {nextDue && (
                                                    isOverdue ? (
                                                        <span className="overdue-badge overdue-pulse">
                                                            Overdue
                                                        </span>
                                                    ) : isDueToday ? (
                                                        <span className="flex items-center gap-1 font-bold text-amber-700">
                                                            <Calendar size={11} /> Due today
                                                        </span>
                                                    ) : (
                                                        <span className="flex items-center gap-1 font-medium text-emerald-600">
                                                            <Calendar size={11} />
                                                            {toDateOnly(nextDue)}
                                                        </span>
                                                    )
                                                )}
                                                {job.parentId && (() => {
                                                    const p = jobs.find(j => j.id === job.parentId);
                                                    return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border bg-violet-50 text-violet-700 border-violet-200" title="Nested within a longer-interval task — satisfied by that order when both are due together">nested in {p?.code || '…'}</span>;
                                                })()}
                                                {(() => {
                                                    const n = jobs.filter(j => j.parentId === job.id).length;
                                                    return n > 0 ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border bg-violet-50 text-violet-700 border-violet-200" title="Shorter-interval tasks nested within this one — satisfied by this order when they fall due together">nests {n}</span> : null;
                                                })()}
                                                {(() => {
                                                    const chip = autopilotChip(job);
                                                    return chip && (
                                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${chip.cls}`}>{chip.label}</span>
                                                    );
                                                })()}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>

                {/* Phones: view options sheet (group, select all, calendar). Portalled to body —
                    the shell's bottom nav is z-50 and anything inside this card would paint under it. */}
                {showFilterSheet && createPortal(
                    <div className="fixed inset-0 z-[60] sm:hidden" role="dialog" aria-modal="true" aria-label="View options">
                        <div className="absolute inset-0 bg-slate-900/40" onClick={() => setShowFilterSheet(false)} />
                        <div className="absolute inset-x-0 bottom-0 bg-white rounded-t-2xl shadow-2xl max-h-[85vh] overflow-y-auto pb-[calc(1rem+env(safe-area-inset-bottom,0px))] animate-in slide-in-from-bottom duration-200">
                            <div className="sticky top-0 bg-white px-4 pt-4 pb-2 border-b border-slate-100 flex items-center justify-between">
                                <span className="absolute left-1/2 -translate-x-1/2 top-1.5 w-10 h-1 rounded-full bg-slate-200" />
                                <h3 className="text-sm font-bold text-slate-800">View options</h3>
                                <button onClick={() => setShowFilterSheet(false)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100" aria-label="Close"><X size={16} /></button>
                            </div>
                            <div className="p-4 space-y-4">
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Group by</label>
                                    <select
                                        value={groupBy}
                                        onChange={e => setGroupBy(e.target.value as GroupBy)}
                                        className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg bg-white text-slate-700"
                                    >
                                        <option value="none">None</option>
                                        <option value="status">Status</option>
                                        <option value="jobType">Job Type</option>
                                        <option value="rcmStrategy">RCM Strategy</option>
                                    </select>
                                </div>
                                <button
                                    onClick={toggleSelectAll}
                                    className="w-full text-sm font-medium text-primary-700 bg-primary-50 border border-primary-200 rounded-lg py-2"
                                >
                                    {selectedIds.size === filteredJobs.length && filteredJobs.length > 0 ? 'Deselect all' : `Select all (${filteredJobs.length})`}
                                </button>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 flex items-center gap-1.5"><Calendar size={12} /> PM Calendar</label>
                                    <PMCalendarWidget jobs={jobs} calendarDate={calendarDate} onDateChange={setCalendarDate} />
                                </div>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}

                {/* Phase 4A — Bulk Action Bar — sticks above the bottom nav while the page scrolls on phones */}
                {selectedIds.size > 0 && (
                    <div className="p-3 border-t border-slate-200 bg-blue-50 flex items-center justify-between gap-3 animate-in slide-in-from-bottom duration-200 sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] lg:static z-10">
                        <span className="text-xs font-bold text-blue-700">{selectedIds.size} selected</span>
                        <div className="flex gap-2">
                            <button onClick={() => handleBulkStatusChange('PAUSED')} className="px-3 py-1.5 bg-amber-100 text-amber-700 rounded-lg text-[11px] font-bold flex items-center gap-1.5 hover:bg-amber-200">
                                <PauseCircle size={13} /> Pause
                            </button>
                            <button onClick={() => handleBulkStatusChange('ACTIVE')} className="px-3 py-1.5 bg-green-100 text-green-700 rounded-lg text-[11px] font-bold flex items-center gap-1.5 hover:bg-green-200">
                                <PlayCircle size={13} /> Activate
                            </button>
                            <button onClick={handleBulkGenerate} className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-[11px] font-bold flex items-center gap-1.5 hover:bg-primary-500">
                                <Zap size={13} /> Generate
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Detail View */}
            {selectedJob && (
                /* Mobile: full-page takeover (fixed overlay above the bottom nav, z-30)
                   so the detail never squashes into the list layout; desktop keeps the
                   in-page panel. */
                <div className="fixed inset-0 z-40 lg:static lg:z-auto lg:flex-1 bg-white lg:rounded-xl lg:shadow-lg lg:border border-slate-200 flex flex-col overflow-hidden">
                    {/* Header */}
                    <div className="p-3 sm:p-4 lg:p-6 border-b border-slate-200 flex flex-col lg:flex-row justify-between items-start gap-2 lg:gap-4 bg-white">
                        <div className="min-w-0 w-full lg:w-auto">
                            <div className="flex items-center gap-2 sm:gap-3 mb-1">
                                <button
                                    onClick={() => setSelectedJob(null)}
                                    className="lg:hidden -ml-1 p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 flex-shrink-0"
                                    title="Back to PM list"
                                >
                                    <ArrowLeft size={20} />
                                </button>
                                <h1 className="text-lg sm:text-2xl font-bold text-slate-900 truncate">{selectedJob.code}</h1>
                                <span className={`${selectedJob?.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : selectedJob?.status === 'PAUSED' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'} text-xs font-bold px-2 py-0.5 rounded uppercase flex-shrink-0`}>
                                    {dictionaries.find(d => d.type === 'STATUS_CODE' && d.code === selectedJob?.status)?.description || selectedJob?.status || 'Unknown'}
                                </span>
                            </div>
                            {(() => {
                                // Weibull-created PMs saved before the description was
                                // slimmed carry the full analysis prose; show only the
                                // first sentence — the Origin chip below has the numbers.
                                // (Old records may predate `origin`, so also match the text.)
                                const raw = String(selectedJob.jobDescription || selectedJob.description || '');
                                const isWeibullProse = (selectedJob as any).origin?.source === 'weibull_analysis' || raw.includes('Analysis Parameters:');
                                const desc = isWeibullProse ? raw.split('\n')[0].split('Analysis Parameters:')[0].trim() : raw;
                                // The title is what every order will be called; the description sits
                                // under it, and only when it says something the title does not.
                                const title = String(selectedJob.title || '').trim();
                                return (
                                    <div className="pl-8 lg:pl-0">
                                        {title && <p className="text-sm sm:text-base font-semibold text-slate-800 line-clamp-2">{title}</p>}
                                        {desc && desc !== title && <p className={`text-slate-500 line-clamp-2 ${title ? 'text-xs sm:text-sm mt-0.5' : 'text-sm sm:text-base'}`}>{desc}</p>}
                                    </div>
                                );
                            })()}
                            {/* Readiness before an order exists — the same items the work order's
                                planning gate checks; each missing item links to the tab that fixes it. */}
                            <div className="pl-8 lg:pl-0 mt-2">
                                <PmReadinessBadge readiness={assessPmReadiness(selectedJob, dbAssets)} onFix={(t) => setActiveTab(t)} />
                            </div>
                            {/* 0299: origin provenance — why this PM exists at this interval */}
                            {(() => {
                                const o = (selectedJob as any).origin as Record<string, any> | undefined;
                                if (!o?.source) return null;
                                const line = o.source === 'weibull_analysis'
                                    ? `Created from Weibull analysis — β=${o.beta}, η=${Number(o.eta_hours).toLocaleString()} h, R²=${o.r2} · interval = ${o.interval_basis}`
                                    : o.source === 'rcm'
                                        ? `From RCM study${o.study_title ? ` “${o.study_title}”` : ''}${o.study_revision ? ` rev ${o.study_revision}` : ''}${o.failure_mode ? ` · prevents: ${o.failure_mode}` : ''}${o.strategy_code ? ` · ${o.strategy_code}` : ''}`
                                        : `Origin: ${String(o.source).replaceAll('_', ' ')}`;
                                const revs = Array.isArray(o.interval_revisions) ? o.interval_revisions : [];
                                const last = revs.length ? revs[revs.length - 1] : null;
                                return (
                                    <div className="pl-8 lg:pl-0 mt-1.5 space-y-0.5">
                                        <p className="text-[11px] text-primary-700 bg-primary-50 border border-primary-100 rounded-lg px-2.5 py-1 inline-flex items-center gap-1.5 flex-wrap">
                                            <span className="font-bold uppercase tracking-wide text-[9px]">Origin</span> {line}
                                            {o.source === 'rcm' && o.study_id && (
                                                <Link to={`/rcm/${o.study_id}`} className="font-semibold underline underline-offset-2 hover:text-primary-900">Open study</Link>
                                            )}
                                        </p>
                                        {o.source === 'rcm' && o.justification && (
                                            <p className="text-[11px] text-slate-500 block">{o.justification}</p>
                                        )}
                                        {last && (
                                            <p className="text-[11px] text-slate-500 block">
                                                Interval revised {last.from_interval} {String(last.from_unit || '').toLowerCase()} → {last.to_days} days on {new Date(last.applied_at).toLocaleDateString()} (approved proposal)
                                            </p>
                                        )}
                                    </div>
                                );
                            })()}
                        </div>
                        <div className="flex gap-1.5 sm:gap-2 flex-wrap w-full lg:w-auto lg:justify-end">
                            <AskRelanternButton
                                contextType="recurringWork"
                                contextSummary={aiContextService.buildRecurringWorkContext({
                                    totalPMs: jobs.length,
                                    activePMs: jobs.filter(j => j.status === 'ACTIVE').length,
                                    suspendedPMs: jobs.filter(j => j.status === 'PAUSED').length,
                                    overdueCount: jobs.filter(j => (j as any).nextDueDate && toDateOnly((j as any).nextDueDate) < toDateOnly(new Date())).length,
                                    complianceRate: statusCounts['ACTIVE'] > 0 ? Math.round((statusCounts['ACTIVE'] / jobs.length) * 100) : 0,
                                    selectedPM: selectedJob ? {
                                        code: selectedJob.code,
                                        title: selectedJob.jobDescription || selectedJob.description || '',
                                        assetTag: dbAssets.find(a => a.id === selectedJob.assignedAssets?.[0]?.assetId)?.tag,
                                        frequency: `${selectedJob.frequencyInterval} ${selectedJob.frequencyUnit}`,
                                        lastExecuted: (selectedJob as any).lastGeneratedDate,
                                        nextDue: (selectedJob as any).nextDueDate,
                                    } : undefined,
                                })}
                            />
                            {/* Estimated cost roll-up */}
                            {(() => {
                                const laborCost = (selectedJob.labor || []).reduce((s: number, l: any) => s + ((l.estDuration || 0) * (l.hourlyRate || 0)), 0);
                                const matCost = (selectedJob.inventory || []).reduce((s: number, i: any) => s + ((i.estQty || 0) * (i.estUnitCost || 0)), 0);
                                const total = laborCost + matCost;
                                return total > 0 ? (
                                    <div className="text-xs text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg flex items-center gap-1">
                                        <span className="font-bold text-slate-700">${total.toFixed(0)}</span> est.
                                    </div>
                                ) : null;
                            })()}
                            <button
                                onClick={handleDuplicate}
                                disabled={duplicating}
                                title="Duplicate strategy"
                                className="px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-lg text-sm font-medium flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-60"
                            >
                                {duplicating ? <Loader2 size={16} className="animate-spin" /> : <Copy size={16} />}
                                <span className="hidden xl:inline">Duplicate</span>
                            </button>
                            <button
                                onClick={handleDelete}
                                disabled={deleting || !canDeletePM}
                                title={canDeletePM ? 'Delete strategy' : 'Needs Recurring Work · Delete'}
                                className="px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-lg text-sm font-medium flex items-center gap-2 bg-red-50 hover:bg-red-100 text-red-600 disabled:opacity-60"
                            >
                                {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                                <span className="hidden xl:inline">Delete</span>
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={saving || !canEditPM}
                                title={canEditPM ? 'Save' : 'Needs Recurring Work · Edit'}
                                className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition ${saveStatus === 'saved' ? 'bg-green-600 text-white' :
                                    saveStatus === 'error' ? 'bg-red-600 text-white' :
                                        'bg-primary-600 hover:bg-primary-500 text-white'
                                    } disabled:opacity-60`}
                            >
                                {saving ? <Loader2 size={16} className="animate-spin" /> :
                                    saveStatus === 'saved' ? <CheckCircle size={16} /> :
                                        <Save size={16} />}
                                {saving ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Error' : 'Save'}
                            </button>
                            <button
                                onClick={() => setIsFullscreen(f => !f)}
                                title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen planning'}
                                className="hidden lg:flex px-3 py-2 rounded-lg text-sm font-medium items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700"
                            >
                                {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                            </button>
                        </div>
                    </div>

                    {/* Tabs — on mobile the strip scrolls between prev/next steppers,
                        and the active tab auto-scrolls into view */}
                    <div className="px-0.5 sm:px-6 border-b border-slate-200 bg-slate-50/50 flex items-center">
                        <button
                            onClick={() => activeTabIndex > 0 && setActiveTab(TABS[activeTabIndex - 1].id)}
                            disabled={activeTabIndex <= 0}
                            className="lg:hidden p-1.5 text-slate-400 hover:text-slate-600 disabled:opacity-30 flex-shrink-0"
                            title="Previous tab"
                        ><ChevronLeft size={16} /></button>
                        <div ref={tabStripRef} className="flex gap-x-1 sm:gap-x-6 overflow-x-auto flex-1 min-w-0">
                            {TABS.map(tab => (
                                <button
                                    key={tab.id}
                                    data-tab-active={activeTab === tab.id || undefined}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`flex items-center gap-1.5 sm:gap-2 px-2 sm:px-0 py-2.5 sm:py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === tab.id
                                        ? 'border-blue-600 text-blue-600 bg-white'
                                        : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                                        }`}
                                >
                                    <tab.icon size={16} />
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={() => activeTabIndex < TABS.length - 1 && setActiveTab(TABS[activeTabIndex + 1].id)}
                            disabled={activeTabIndex >= TABS.length - 1}
                            className="lg:hidden p-1.5 text-slate-400 hover:text-slate-600 disabled:opacity-30 flex-shrink-0"
                            title="Next tab"
                        ><ChevronRight size={16} /></button>
                    </div>

                    {/* Content — extra bottom padding on mobile so the last fields
                        clear the bottom navigation bar */}
                    <div className="flex-1 overflow-y-auto p-3 pb-24 sm:p-6 sm:pb-24 lg:pb-6 bg-slate-50/30">
                        {/* One reading column for every tab — the detail pane is as wide as the
                            window allows, and an unbounded form is harder to read than a bounded
                            one. Binds only on wide monitors; narrower panes are unchanged. */}
                        <div className="ers-page-record">
                            {activeTab === 'details' && <DetailsTab companyAuto={companyAuto} job={selectedJob} onUpdate={handleJobUpdate} dictionaries={dictionaries} jobs={jobs} assets={dbAssets.length > 0 ? dbAssets : MOCK_ASSETS} />}
                            {activeTab === 'assets' && <AssetsTab job={selectedJob} onUpdate={handleAssetsUpdate} onNavigateToAsset={(assetId) => { window.location.href = `/assets?id=${assetId}`; }} assets={dbAssets.length > 0 ? dbAssets : MOCK_ASSETS} />}
                            {activeTab === 'tasks' && <TasksTab job={selectedJob} onUpdate={handleJobUpdate} />}
                            {activeTab === 'jsa' && <JSATab job={selectedJob} onUpdate={handleJobUpdate} />}
                            {activeTab === 'labor' && <LaborTab job={selectedJob} onUpdate={handleJobUpdate} contacts={contacts} dictionaries={dictionaries} />}
                            {activeTab === 'inventory' && <InventoryTab job={selectedJob} onUpdate={handleJobUpdate} inventoryItems={inventoryItems} dictionaries={dictionaries} />}
                            {activeTab === 'files' && <FilesTab job={selectedJob} onUpdate={handleJobUpdate} />}
                            {activeTab === 'history' && <HistoryTab job={selectedJob} jobs={jobs} onUpdate={handleJobUpdate} />}
                        </div>
                    </div>
                </div>
            )}

            {/* Generator Modal */}
            {showGenerator && (
                <div className="absolute inset-0 z-50 bg-black/50 flex items-center justify-center backdrop-blur-sm p-4">
                    <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
                        <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-primary-600 text-white rounded-t-2xl">
                            <div>
                                <h2 className="text-xl font-bold flex items-center gap-2"><Zap size={20} /> Recurring Job Generator</h2>
                                <p className="text-blue-100 text-sm">Process due PMs and create Work Orders.</p>
                            </div>
                            <button onClick={closeGenerator} className="text-white/70 hover:text-white p-2 hover:bg-blue-500 rounded-full transition">X</button>
                        </div>

                        <div className="p-6 bg-slate-50 border-b border-slate-200 flex flex-wrap gap-4 items-end">
                            <div className="w-full sm:w-64">
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Due on or before</label>
                                <input
                                    type="date"
                                    value={generateDate}
                                    onChange={(e) => setGenerateDate(e.target.value)}
                                    className="w-full p-2 border border-slate-300 rounded-lg"
                                />
                            </div>
                            <p className="text-xs text-slate-500 pb-2">
                                {generatedPreview.length === 0
                                    ? 'Nothing is due by this date.'
                                    : `${generatedPreview.length} occurrence${generatedPreview.length === 1 ? '' : 's'} due${generatedPreview.some((j: any) => j.blocked) ? ` (${generatedPreview.filter((j: any) => j.blocked).length} held back — see reason)` : ''} — untick anything you do not want raised.`}
                            </p>
                        </div>

                        {/* 0304 — the daily server sweep now owns routine generation */}
                        {companyAuto ? (
                            <div className="mx-6 mt-3 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-[11px] text-emerald-800">
                                <span className="font-bold">Automatic generation is on:</span> a daily server sweep raises due work orders for every schedule whose first generated PM has been completed (one open occurrence at a time; meter-based cadences excluded). This manual run stays for previews, backfills, first occurrences, and schedules set to Manual.
                            </div>
                        ) : (
                            <div className="mx-6 mt-3 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-700">
                                <span className="font-bold">Manual generation:</span> this company raises PM work orders only from here (Admin › Your Company › Preventive work order generation). Review the due list and create what should go out.
                            </div>
                        )}

                        <div className="flex-1 overflow-y-auto p-6">
                            {generatedPreview.length > 0 ? (
                                <div className="space-y-4">
                                    {/* Phase 4D — separated Time-Based and Reading-Based sections */}
                                    {(['TIME', 'READING'] as const).map(triggerType => {
                                        const items = generatedPreview.filter((it: any) => it.triggerType === triggerType);
                                        if (items.length === 0) return null;
                                        return (
                                            <div key={triggerType}>
                                                <div className="flex items-center gap-2 mb-2">
                                                    {triggerType === 'TIME' ? <Calendar size={14} className="text-blue-600" /> : <Gauge size={14} className="text-amber-600" />}
                                                    <h4 className="text-xs font-bold text-slate-600 uppercase">{triggerType === 'TIME' ? 'Time-Based' : 'Reading-Based'} ({items.length})</h4>
                                                </div>
                                                <table className="min-w-full divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
                                                    <thead className="bg-slate-100">
                                                        <tr>
                                                            <th className="p-3 text-left">
                                                                {/* Select all — the raisable ones; held-back rows never join a bulk tick */}
                                                                <label className="inline-flex items-center gap-1.5 cursor-pointer" title="Select all that can be raised">
                                                                    <input
                                                                        type="checkbox"
                                                                        className="rounded"
                                                                        checked={items.some((it: any) => !it.blocked) && items.every((it: any) => it.blocked || selectedGenItems.has(generatedPreview.indexOf(it)))}
                                                                        onChange={(e) => {
                                                                            const next = new Set(selectedGenItems);
                                                                            items.forEach((it: any) => {
                                                                                if (it.blocked) return;
                                                                                const idx = generatedPreview.indexOf(it);
                                                                                if (e.target.checked) next.add(idx); else next.delete(idx);
                                                                            });
                                                                            setSelectedGenItems(next);
                                                                        }}
                                                                    />
                                                                    <span className="text-[10px] font-bold text-slate-500 uppercase">All</span>
                                                                </label>
                                                            </th>
                                                            <th className="p-3 text-left text-xs font-bold text-slate-500 uppercase">PM Code</th>
                                                            <th className="p-3 text-left text-xs font-bold text-slate-500 uppercase" title="How complete the schedule's plan is — 100% lands as Planned">Plan</th>
                                                            <th className="p-3 text-left text-xs font-bold text-slate-500 uppercase">Asset / Route</th>
                                                            <th className="p-3 text-left text-xs font-bold text-slate-500 uppercase">Description</th>
                                                            {triggerType === 'READING' && <th className="p-3 text-left text-xs font-bold text-slate-500 uppercase">Last Reading</th>}
                                                            <th className="p-3 text-left text-xs font-bold text-slate-500 uppercase">Reason</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="bg-white divide-y divide-slate-200">
                                                        {items.map((item: any) => {
                                                            const idx = generatedPreview.indexOf(item);
                                                            return (
                                                                <tr key={idx} className={selectedGenItems.has(idx) ? 'bg-blue-50/50' : ''}>
                                                                    <td className="p-3">
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={selectedGenItems.has(idx)}
                                                                            disabled={!!item.blocked}
                                                                            title={item.blocked ? item.reason : undefined}
                                                                            onChange={(e) => {
                                                                                const next = new Set(selectedGenItems);
                                                                                if (e.target.checked) next.add(idx); else next.delete(idx);
                                                                                setSelectedGenItems(next);
                                                                            }}
                                                                            className="rounded text-blue-600 disabled:opacity-40"
                                                                        />
                                                                    </td>
                                                                    <td className="p-3 text-sm font-bold text-slate-900">{item.jobCode}</td>
                                                                    <td className="p-3">
                                                                        {(() => { const rj = jobs.find(j => j.id === item.pmId); return rj ? <PmReadinessChip readiness={assessPmReadiness(rj, dbAssets)} /> : null; })()}
                                                                    </td>
                                                                    <td className="p-3 text-sm text-slate-600 font-medium">{item.asset}</td>
                                                                    <td className="p-3 text-sm text-slate-600">{item.desc}</td>
                                                                    {triggerType === 'READING' && (
                                                                        <td className="p-3 text-sm font-mono text-amber-700 font-bold">{item.lastReading ?? '-'}</td>
                                                                    )}
                                                                    <td className={`p-3 text-sm font-medium ${item.blocked ? 'text-amber-700' : triggerType === 'READING' ? 'text-amber-600' : 'text-green-600'}`}>{item.reason}</td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="text-center py-12 text-slate-400">
                                    <Repeat size={48} className="mx-auto mb-4 opacity-20" />
                                    <p>No schedule is due on or before {generateDate} — move the date forward to preview upcoming work.</p>
                                </div>
                            )}
                        </div>

                        <div className="p-4 border-t border-slate-200 bg-white rounded-b-2xl flex justify-between items-center">
                            <div>
                                {generationResult && (
                                    <span className="text-sm font-medium text-green-700 flex items-center gap-2">
                                        <CheckCircle size={16} /> {generationResult}
                                    </span>
                                )}
                            </div>
                            <div className="flex gap-3">
                                <button onClick={closeGenerator} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium">
                                    {generationResult ? 'Close' : 'Cancel'}
                                </button>
                                {!generationResult && (
                                    <button
                                        disabled={selectedGenItems.size === 0 || generating}
                                        className="px-6 py-2 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 shadow-md disabled:opacity-50 flex items-center gap-2"
                                        onClick={handleCreateJobs}
                                    >
                                        {generating ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                                        {generating ? 'Creating...' : `Create ${selectedGenItems.size} Jobs`}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {/* Bulk Import Modal */}
            <BulkImportModal
                isOpen={showBulkImport}
                onClose={() => setShowBulkImport(false)}
                allowedTypes={['recurring', 'jobplan']}
                onImportData={handleBulkImportData}
            />
            {/* Create PM Modal */}
            <CreatePMModal
                isOpen={isCreatePMOpen}
                onClose={() => setIsCreatePMOpen(false)}
                onSave={(newId) => {
                    // Open the new strategy on its Assets tab once the list has reloaded
                    // (same path a notification deep link takes: ?id=…&tab=…).
                    if (newId) setUrlParams(prev => { const next = new URLSearchParams(prev); next.set('id', newId); next.set('tab', 'assets'); return next; });
                    loadStrategies();
                }}
                dictionaries={dictionaries}
            />
            {/* GAP-21: Delete Confirmation Modal */}
            <ConfirmationModal
                isOpen={showDeleteConfirm}
                onClose={() => setShowDeleteConfirm(false)}
                onConfirm={confirmDelete}
                title="Delete Strategy?"
                message={`Are you sure you want to delete "${selectedJob?.jobDescription || selectedJob?.description}"? This action cannot be undone.`}
                type="danger"
                confirmText="Delete Strategy"
            />
        </div>
    );
};

const DetailsTab: React.FC<{ job: RecurringJob, onUpdate: (u: Partial<RecurringJob>) => void, dictionaries?: any[], jobs?: RecurringJob[], assets?: Asset[], companyAuto?: boolean }> = ({ job, onUpdate, dictionaries = [], jobs = [], assets = [], companyAuto = true }) => {
    // 0292: strategy-package linkage — makes cycle absorption reach the real schedule.
    const [strategies, setStrategies] = useState<any[]>([]);
    useEffect(() => {
        DatabaseService.getInstance().getStrategies().then(setStrategies).catch(() => setStrategies([]));
    }, []);
    const selectedStrategy = strategies.find((s: any) => s.id === (job as any).strategyId);
    // Steps with hours own the duration estimate; keep estDuration aligned so the
    // generated order (which copies est_duration) shows the same figure as this tab.
    const fromSteps = stepsHours(job.tasks);
    useEffect(() => {
        if (fromSteps.count > 0 && (Number(job.estDuration) || 0) !== fromSteps.total) onUpdate({ estDuration: fromSteps.total });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fromSteps.total, fromSteps.count, job.estDuration]);
    // Dictionary lookups
    const readingTypes = dictionaries.filter(d => d.type === 'READING_TYPE' && d.active);
    const timePeriods = dictionaries.filter(d => d.type === 'TIME_PERIOD' && d.active);
    const statusCodes = dictionaries.filter(d => d.type === 'STATUS_CODE' && d.active);
    const functionalFailures = dictionaries.filter(d => d.type === 'FAULT_TYPE' && d.active);
    const failureModes = dictionaries.filter(d => d.type === 'FAILURE_MODE' && d.active);
    const costCentres = dictionaries.filter(d => d.type === 'COST_CENTRE' && d.active);
    const pmStatuses = dictionaries.filter(d => d.type === 'PM_STATUS' && d.active);
    const rcmStrategies = dictionaries.filter(d => d.type === 'RCM_STRATEGY' && d.active);

    // Criticality from first assigned asset
    const primaryAssetId = job.assignedAssets?.[0]?.assetId;
    const primaryAsset = assets.find(a => a.id === primaryAssetId);
    const criticality = primaryAsset?.criticality;

    return (
        <div className="ers-dense ers-dense-labels space-y-3 sm:space-y-6 animate-in fade-in">
            {/* Criticality Badge */}
            {criticality && (
                <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[11px] sm:text-xs ${criticality === 'A' ? 'bg-red-50 border-red-200 text-red-800' :
                    criticality === 'B' ? 'bg-amber-50 border-amber-200 text-amber-800' :
                        'bg-green-50 border-green-200 text-green-800'
                    }`}>
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${criticality === 'A' ? 'bg-red-500' : criticality === 'B' ? 'bg-amber-500' : 'bg-green-500'}`} />
                    <span className="truncate min-w-0">
                        <strong>Criticality {criticality}</strong>
                        <span className="opacity-80"> · {criticality === 'A' ? 'Safety critical' : criticality === 'B' ? 'Production critical' : 'General'}</span>
                        {primaryAsset && <span className="opacity-70"> · {primaryAsset.tag || primaryAsset.name}</span>}
                    </span>
                    {criticality === 'A' && !job.jsa?.hazards?.length && (
                        <span className="ml-auto text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold flex items-center gap-1 flex-shrink-0" title="A safety-critical schedule needs a JSA before it can be active">
                            <AlertTriangle size={11} /> JSA required
                        </span>
                    )}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-6">
                {/* Left Column: Scheduling Settings */}
                <div className="bg-white p-4 sm:p-6 rounded-lg border border-slate-200 shadow-sm space-y-6">
                    <div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="sm:col-span-2">
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Description <span className="normal-case font-normal text-slate-400">— copied to each work order; steps go on the Tasks tab</span></label>
                                <textarea
                                    value={job.jobDescription || job.description}
                                    onChange={(e) => onUpdate({ jobDescription: e.target.value })}
                                    className="w-full p-2 border border-slate-300 rounded-lg text-sm h-20 resize-none focus:ring-2 focus:ring-primary-500"
                                    placeholder="Text to appear on the generated Work Order..."
                                />
                            </div>
                            <div className="sm:col-span-2">
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Status</label>
                                <div className="flex gap-1.5 flex-nowrap overflow-x-auto scrollbar-hide -mx-1 px-1 sm:flex-wrap">
                                    {(pmStatuses.length > 0
                                        ? pmStatuses.map(s => ({ code: s.code, label: s.description || s.code }))
                                        : [
                                            { code: 'ACTIVE', label: 'Active' },
                                            { code: 'PAUSED', label: 'Paused' },
                                            { code: 'DRAFT', label: 'Draft' },
                                            { code: 'EXPIRED', label: 'Expired' },
                                        ]
                                    ).map(opt => {
                                        const isSelected = (job.status || 'ACTIVE') === opt.code;
                                        const colorMap: Record<string, { active: string; inactive: string }> = {
                                            ACTIVE: { active: 'bg-emerald-600 text-white ring-emerald-300', inactive: 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50' },
                                            PAUSED: { active: 'bg-amber-500 text-white ring-amber-300', inactive: 'bg-white text-amber-700 border-amber-200 hover:bg-amber-50' },
                                            DRAFT: { active: 'bg-slate-600 text-white ring-slate-300', inactive: 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50' },
                                            EXPIRED: { active: 'bg-red-600 text-white ring-red-300', inactive: 'bg-white text-red-600 border-red-200 hover:bg-red-50' },
                                        };
                                        const colors = colorMap[opt.code] || colorMap['DRAFT'];
                                        return (
                                            <button
                                                key={opt.code}
                                                onClick={() => onUpdate({ status: opt.code as any })}
                                                className={`px-2.5 sm:px-3.5 py-1 rounded-full text-[11px] sm:text-xs font-bold border transition-all flex-shrink-0 whitespace-nowrap ${
                                                    isSelected
                                                        ? `${colors.active} ring-2 shadow-sm`
                                                        : `${colors.inactive}`
                                                }`}
                                            >
                                                {isSelected && <span className="mr-1">●</span>}
                                                {opt.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                            <div className="sm:col-span-2">
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Schedule Basis</label>
                                <div className="flex flex-col sm:flex-row gap-2 sm:gap-4">
                                    <label className={`flex items-start gap-3 cursor-pointer border p-3 rounded-lg flex-1 transition hover:bg-slate-50 ${job.scheduleType === 'TIME' ? 'bg-blue-50 border-blue-500 ring-1 ring-blue-500' : 'bg-white border-slate-200'}`}>
                                        <input type="radio" name="schedType" checked={job.scheduleType === 'TIME'} onChange={() => onUpdate({ scheduleType: 'TIME' })} className="mt-1 h-4 w-4 text-blue-600" />
                                        <div className="flex flex-col">
                                            <span className="text-sm font-bold text-slate-900 flex items-center gap-2"><Calendar size={14} /> Time Based</span>
                                            <span className="text-[10px] text-slate-500 mt-0.5">Days, Weeks, Months, Years</span>
                                        </div>
                                    </label>
                                    <label className={`flex items-start gap-3 cursor-pointer border p-3 rounded-lg flex-1 transition hover:bg-slate-50 ${job.scheduleType === 'READING' ? 'bg-blue-50 border-blue-500 ring-1 ring-blue-500' : 'bg-white border-slate-200'}`}>
                                        <input type="radio" name="schedType" checked={job.scheduleType === 'READING'} onChange={() => onUpdate({ scheduleType: 'READING' })} className="mt-1 h-4 w-4 text-blue-600" />
                                        <div className="flex flex-col">
                                            <span className="text-sm font-bold text-slate-900 flex items-center gap-2"><Gauge size={14} /> Reading Based</span>
                                            <span className="text-[10px] text-slate-500 mt-0.5">Hours, Km, Cycles, Output</span>
                                        </div>
                                    </label>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                                    {job.scheduleType === 'READING' ? 'Reading Type Interval' : 'Frequency'}
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        type="number"
                                        value={job.frequencyInterval}
                                        onChange={(e) => onUpdate({ frequencyInterval: parseFloat(e.target.value) })}
                                        className="w-20 p-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                                    />
                                    {job.scheduleType === 'TIME' ? (
                                        <select
                                            value={job.frequencyUnit}
                                            onChange={(e) => onUpdate({ frequencyUnit: e.target.value })}
                                            className="flex-1 p-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-primary-500"
                                        >
                                            {timePeriods.length > 0
                                                ? timePeriods.map(tp => <option key={tp.code} value={tp.code}>{tp.description || tp.code}</option>)
                                                : [
                                                    <option key="Days" value="Days">Days</option>,
                                                    <option key="Weeks" value="Weeks">Weeks</option>,
                                                    <option key="Months" value="Months">Months</option>,
                                                    <option key="Years" value="Years">Years</option>,
                                                ]
                                            }
                                        </select>
                                    ) : (
                                        <select
                                            value={job.frequencyUnit}
                                            onChange={(e) => onUpdate({ frequencyUnit: e.target.value })}
                                            className="flex-1 p-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-primary-500"
                                        >
                                            {readingTypes.length > 0
                                                ? readingTypes.map(rt => <option key={rt.id} value={rt.code}>{rt.description || rt.code}</option>)
                                                : [
                                                    <option key="Hours" value="Hours">Operating Hours</option>,
                                                    <option key="KM" value="KM">Kilometres</option>,
                                                    <option key="Cycles" value="Cycles">Cycles</option>,
                                                    <option key="Starts" value="Starts">Starts</option>,
                                                ]
                                            }
                                        </select>
                                    )}
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Lead Time (Days)</label>
                                <input type="number" min={0} value={job.leadTimeDays} onChange={(e) => onUpdate({ leadTimeDays: parseFloat(e.target.value) })} className="w-full p-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500" />
                                {job.scheduleType === 'TIME' && cadenceDays(job.frequencyInterval, job.frequencyUnit) > 0 && (job.leadTimeDays || 0) >= cadenceDays(job.frequencyInterval, job.frequencyUnit) && (
                                    <p className="text-[11px] text-amber-700 mt-1">Longer than the cadence — orders are raised on the due day (treated as 0).</p>
                                )}
                            </div>

                            {/* Next due sits with the cadence it derives from; the compliance
                                KPI and its thresholds moved to the History tab. */}
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Next Due</label>
                                {job.scheduleType === 'TIME' ? (
                                    <input
                                        type="date"
                                        value={job.nextDueDate ? toDateOnly(job.nextDueDate) : ''}
                                        onChange={(e) => onUpdate({ nextDueDate: e.target.value })}
                                        className="w-full p-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                                    />
                                ) : (
                                    <p className="text-sm font-medium text-slate-800 py-2">{job.nextDueDate || 'Not computed'}</p>
                                )}
                                {job.nextDueDate && (() => {
                                    const daysUntil = Math.ceil((new Date(job.nextDueDate).getTime() - Date.now()) / 86400000);
                                    return (
                                        <span className={`inline-block mt-1.5 text-[10px] px-2 py-0.5 rounded-full font-bold ${daysUntil < 0 ? 'bg-red-100 text-red-700' :
                                            daysUntil <= job.leadTimeDays ? 'bg-amber-100 text-amber-700' :
                                                'bg-green-100 text-green-700'
                                            }`}>
                                            {daysUntil < 0 ? `${Math.abs(daysUntil)}d overdue` :
                                                daysUntil === 0 ? 'Due today' :
                                                    `${daysUntil}d remaining`}
                                        </span>
                                    );
                                })()}
                            </div>

                            {/* 0304 PM Autopilot — per-schedule opt-out. The sweep only takes a
                                schedule after its first generated WO has been completed. */}
                            <div className="sm:col-span-2 flex items-start gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={job.autoGenerate !== false}
                                    onClick={() => onUpdate({ autoGenerate: job.autoGenerate === false })}
                                    className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors mt-0.5 ${job.autoGenerate !== false ? 'bg-emerald-500' : 'bg-slate-300'}`}
                                >
                                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transform transition-transform ${job.autoGenerate !== false ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                                </button>
                                <div className="min-w-0">
                                    <div className="text-xs font-bold text-slate-700">{job.autoGenerate !== false ? 'Automatic (Autopilot)' : 'Manual (Generator only)'}</div>
                                    <p className="text-[10px] text-slate-500 mt-0.5">
                                        {job.autoGenerate !== false
                                            ? 'Raises due work orders daily once the first PM is completed — one open occurrence at a time.'
                                            : 'Nothing is raised on its own — a planner creates each occurrence from Generate.'}
                                    </p>
                                    {!companyAuto && (
                                        <p className="text-[10px] text-amber-700 mt-1">Company setting is Manual (Admin › Your Company) — applies once Automatic is enabled there.</p>
                                    )}
                                </div>
                            </div>

                            <div className="sm:col-span-2 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Nested within (longer-interval task)</label>
                                {(() => {
                                    // 0366: same asset, longer calendar cadence, one level, no cycles.
                                    const hier = (j: RecurringJob) => ({
                                        id: j.id, assetId: j.assignedAssets?.[0]?.assetId, parentId: j.parentId, scheduleType: j.scheduleType,
                                        frequencyInterval: j.frequencyInterval, frequencyUnit: j.frequencyUnit, leadTimeDays: j.leadTimeDays,
                                    });
                                    const candidates = jobs.filter(j => canBeParentOf(hier(job), hier(j)));
                                    const children = jobs.filter(j => j.parentId === job.id);
                                    const win = absorptionWindowDays(job);
                                    const parent = job.parentId ? jobs.find(j => j.id === job.parentId) : undefined;
                                    const harmonic = parent ? isHarmonic(hier(job), hier(parent)) : true;
                                    return (
                                        <>
                                            <select
                                                value={job.parentId || ''}
                                                onChange={(e) => onUpdate({ parentId: e.target.value || undefined })}
                                                disabled={job.scheduleType !== 'TIME'}
                                                className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-primary-500 disabled:bg-slate-100"
                                            >
                                                <option value="">(None) — independent schedule</option>
                                                {candidates.map(j => (
                                                    <option key={j.id} value={j.id}>{j.code} — every {j.frequencyInterval} {j.frequencyUnit} — {j.jobDescription || j.description}</option>
                                                ))}
                                                {job.parentId && !candidates.some(j => j.id === job.parentId) && (
                                                    <option value={job.parentId}>{jobs.find(j => j.id === job.parentId)?.code || job.parentId} (no longer valid — same asset, longer interval)</option>
                                                )}
                                            </select>
                                            {job.parentId && (
                                                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                    {([
                                                        ['SUPERSEDES', 'Supersedes', `The longer task's plan already covers this scope. Its order carries the longer plan only; this occurrence is recorded on it.`],
                                                        ['COMBINES', 'Combines', `Distinct scope done on the same visit. This task's steps and parts are appended to the longer order, tagged [${job.code}].`],
                                                    ] as const).map(([mode, label, help]) => (
                                                        <label key={mode} className={`flex items-start gap-2 p-2 rounded-lg border text-[11px] cursor-pointer ${(job.nestingMode || 'SUPERSEDES') === mode ? 'border-violet-300 bg-violet-50' : 'border-slate-200 bg-white'}`}>
                                                            <input type="radio" name={`nesting-${job.id}`} className="mt-0.5" checked={(job.nestingMode || 'SUPERSEDES') === mode} onChange={() => onUpdate({ nestingMode: mode })} />
                                                            <span><span className="font-bold text-slate-700">{label}</span><br /><span className="text-slate-500">{help}</span></span>
                                                        </label>
                                                    ))}
                                                </div>
                                            )}
                                            {job.parentId && !harmonic && (
                                                <p className="text-[10px] text-amber-700 mt-2">Intervals are not harmonic ({job.frequencyInterval} {job.frequencyUnit} within {parent?.frequencyInterval} {parent?.frequencyUnit}) — the two only coincide occasionally; on the other dates this task raises its own order.</p>
                                            )}
                                            <p className="text-[10px] text-slate-500 mt-2">
                                                Due {win === 0 ? 'on the same day as' : `within ±${win} days of`} the longer task: that order covers this one and counts for its compliance.
                                            </p>
                                            {children.length > 0 && (
                                                <p className="text-[10px] text-violet-700 mt-1">Nests: {children.map(c => `${c.code} (${c.frequencyInterval} ${c.frequencyUnit}, ${(c.nestingMode || 'SUPERSEDES').toLowerCase()})`).join(', ')}</p>
                                            )}
                                        </>
                                    );
                                })()}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Column: Default Job Settings */}
                <div className="bg-white p-4 sm:p-6 rounded-lg border border-slate-200 shadow-sm space-y-6">
                    <div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Job Type</label>
                                <select value={job.jobType} onChange={(e) => onUpdate({ jobType: e.target.value as WorkOrderType })} className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-primary-500">
                                    {dictionaries.filter(d => d.type === 'WORK_TYPE' && d.active).length > 0
                                        ? dictionaries.filter(d => d.type === 'WORK_TYPE' && d.active).map(d => (
                                            <option key={d.code} value={d.code}>{d.description || d.code}</option>
                                        ))
                                        : [
                                            <option key="PM" value="Preventive">Preventive</option>,
                                            <option key="INSP" value="Inspection">Inspection</option>,
                                            <option key="PdM" value="Predictive">Predictive</option>,
                                        ]
                                    }
                                </select>
                                {job.jobType === 'Inspection' && <p className="text-[10px] text-blue-600 mt-1 font-medium">Generates grouped Work Order (Route)</p>}
                                {job.jobType === 'Preventive' && <p className="text-[10px] text-blue-600 mt-1 font-medium">Generates individual Work Orders</p>}
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Priority</label>
                                <select value={job.priority} onChange={(e) => onUpdate({ priority: e.target.value })} className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-primary-500">
                                    {dictionaries.filter(d => d.type === 'PRIORITY' && d.active).length > 0
                                        ? dictionaries.filter(d => d.type === 'PRIORITY' && d.active).map(d => (
                                            <option key={d.code} value={d.code}>{d.description || d.code}</option>
                                        ))
                                        : [
                                            <option key="HIGH" value="HIGH">HIGH</option>,
                                            <option key="MEDIUM" value="MEDIUM">MEDIUM</option>,
                                            <option key="LOW" value="LOW">LOW</option>,
                                        ]
                                    }
                                </select>
                            </div>
                            {/* 0292: Strategy package — same-day absorption by longer packages */}
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Maintenance Strategy</label>
                                <select
                                    value={(job as any).strategyId || ''}
                                    onChange={(e) => onUpdate({ strategyId: e.target.value || undefined, strategyPackage: undefined } as any)}
                                    className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-primary-500"
                                >
                                    <option value="">— None (standalone PM) —</option>
                                    {strategies.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Strategy Package</label>
                                <select
                                    value={(job as any).strategyPackage || ''}
                                    onChange={(e) => onUpdate({ strategyPackage: e.target.value || undefined } as any)}
                                    disabled={!selectedStrategy}
                                    className={`w-full p-2 border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 ${selectedStrategy ? 'border-slate-300 bg-white' : 'border-slate-200 bg-slate-50 text-slate-400'}`}
                                >
                                    <option value="">— Select package —</option>
                                    {(selectedStrategy?.packages || []).map((p: any) => (
                                        <option key={p.id} value={p.label}>{p.label} — every {p.intervalDays} days</option>
                                    ))}
                                </select>
                                {(job as any).strategyPackage && (
                                    <p className="text-[10px] text-blue-600 mt-1 font-medium">
                                        Absorbed when a longer package of this strategy is due the same day — one service, not a stack.
                                    </p>
                                )}
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Cost Center</label>
                                <select value={job.costCenter || ''} onChange={(e) => onUpdate({ costCenter: e.target.value })} className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-primary-500">
                                    <option value="">— Select —</option>
                                    {costCentres.length > 0
                                        ? costCentres.map(cc => <option key={cc.code} value={cc.code}>{cc.code} — {cc.description || ''}</option>)
                                        : <option value="CC-M100">CC-M100 — Main Maintenance</option>
                                    }
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Est. Duration (Hrs)</label>
                                {fromSteps.count > 0 ? (
                                    <>
                                        <div className="w-full p-2 border border-slate-200 rounded-lg text-sm bg-slate-50 text-slate-800 tabular-nums" title="Derived from the steps on the Tasks tab">{fromSteps.total}</div>
                                        <p className="text-[10px] text-slate-400 mt-1">from {fromSteps.count} step{fromSteps.count === 1 ? '' : 's'}</p>
                                    </>
                                ) : (
                                    <input type="number" value={job.estDuration} onChange={(e) => onUpdate({ estDuration: parseFloat(e.target.value) })} className="w-full p-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500" />
                                )}
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Est. Downtime (Hrs)</label>
                                <input type="number" value={job.estDowntime} onChange={(e) => onUpdate({ estDowntime: parseFloat(e.target.value) })} className="w-full p-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* RCM Strategy Card (SAE JA1011 / ISO 14224) */}
            <div className="bg-white p-4 sm:p-6 rounded-lg border border-slate-200 shadow-sm">
                <h3 className="font-bold text-slate-800 border-b border-slate-100 pb-2 mb-4 flex items-center gap-2">
                    <Shield size={18} className="text-blue-600" /> RCM Strategy (SAE JA1011)
                </h3>
                <p className="text-xs text-slate-500 mb-4">Justify this PM by linking it to the failure it prevents. Required for Criticality A assets.</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Strategy Type</label>
                        <select
                            value={job.rcmStrategy || ''}
                            onChange={(e) => onUpdate({ rcmStrategy: e.target.value as any || undefined })}
                            className={`w-full p-2 border rounded-lg text-sm bg-white focus:ring-2 focus:ring-primary-500 ${criticality === 'A' && !job.rcmStrategy ? 'border-red-300 bg-red-50' : 'border-slate-300'}`}
                        >
                            <option value="">— Select Strategy —</option>
                            {rcmStrategies.length > 0
                                ? rcmStrategies.map(s => <option key={s.code} value={s.code}>{s.code} — {s.description}</option>)
                                : [
                                    <option key="TIME_DIRECTED" value="TIME_DIRECTED">Time-Directed (Scheduled Restoration/Discard)</option>,
                                    <option key="CONDITION_DIRECTED" value="CONDITION_DIRECTED">Condition-Directed (On-Condition / CBM)</option>,
                                    <option key="FAILURE_FINDING" value="FAILURE_FINDING">Failure-Finding (Hidden Failure Detection)</option>,
                                    <option key="RUN_TO_FAILURE" value="RUN_TO_FAILURE">Run-to-Failure (Acceptable Consequence)</option>,
                                ]
                            }
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Functional Failure</label>
                        <select
                            value={job.functionalFailureCode || ''}
                            onChange={(e) => onUpdate({ functionalFailureCode: e.target.value || undefined })}
                            className={`w-full p-2 border rounded-lg text-sm bg-white focus:ring-2 focus:ring-primary-500 ${criticality === 'A' && !job.functionalFailureCode ? 'border-red-300 bg-red-50' : 'border-slate-300'}`}
                        >
                            <option value="">— Select —</option>
                            {functionalFailures.length > 0
                                ? functionalFailures.map(ff => <option key={ff.code} value={ff.code}>{ff.code} — {ff.description}</option>)
                                : [
                                    <option key="FAIL_START" value="FAIL_START">FAIL_START — Failure to Start</option>,
                                    <option key="LEAK_EXT" value="LEAK_EXT">LEAK_EXT — External Leakage</option>,
                                    <option key="VIBRATION" value="VIBRATION">VIBRATION — Vibration High</option>,
                                    <option key="OVERHEAT" value="OVERHEAT">OVERHEAT — Overheating</option>,
                                ]
                            }
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Failure Mode Prevented</label>
                        <select
                            value={job.failureModeCode || ''}
                            onChange={(e) => onUpdate({ failureModeCode: e.target.value || undefined })}
                            className={`w-full p-2 border rounded-lg text-sm bg-white focus:ring-2 focus:ring-primary-500 ${criticality === 'A' && !job.failureModeCode ? 'border-red-300 bg-red-50' : 'border-slate-300'}`}
                        >
                            <option value="">— Select —</option>
                            {failureModes.length > 0 ? (() => {
                                const FM_GROUPS: Record<string, string> = {
                                    'ROTATING': '⚙️ Rotating Equipment',
                                    'STATIC_PRESSURE': '🏗️ Static / Pressure Vessels',
                                    'ELECTRICAL': '⚡ Electrical',
                                    'INSTRUMENT': '📊 Instrumentation',
                                    'PIPING': '🔩 Piping',
                                    'SAFETY_SYSTEM': '🛡️ Safety Systems',
                                    'HEAT_TRANSFER': '🌡️ Heat Transfer',
                                    'STRUCTURAL': '🏛️ Structural / Civil',
                                };
                                const general = failureModes.filter(fm => !fm.categoryRef);
                                const grouped = new Map<string, typeof failureModes>();
                                failureModes.forEach(fm => {
                                    if (!fm.categoryRef) return;
                                    if (!grouped.has(fm.categoryRef)) grouped.set(fm.categoryRef, []);
                                    grouped.get(fm.categoryRef)!.push(fm);
                                });
                                return (
                                    <>
                                        {general.length > 0 && (
                                            <optgroup label="🔧 General (All Assets)">
                                                {general.map(fm => <option key={fm.code} value={fm.code}>{fm.code} — {fm.description}</option>)}
                                            </optgroup>
                                        )}
                                        {Array.from(grouped.entries()).map(([key, fms]) => (
                                            <optgroup key={key} label={FM_GROUPS[key] || key}>
                                                {fms.map(fm => <option key={fm.code} value={fm.code}>{fm.code} — {fm.description}</option>)}
                                            </optgroup>
                                        ))}
                                    </>
                                );
                            })() : (
                                <>
                                    <optgroup label="🔧 General">
                                        <option value="BRD">BRD — Breakdown (Complete Loss of Function)</option>
                                        <option value="OHE">OHE — Overheating</option>
                                        <option value="VIB">VIB — Abnormal Vibration</option>
                                        <option value="ELP">ELP — External Leakage — Process Medium</option>
                                    </optgroup>
                                    <optgroup label="⚙️ Rotating Equipment">
                                        <option value="FTS">FTS — Fail to Start</option>
                                        <option value="BRG">BRG — Bearing Failure</option>
                                        <option value="SEL">SEL — Seal Failure / Seal Leakage</option>
                                    </optgroup>
                                    <optgroup label="⚡ Electrical">
                                        <option value="INS">INS — Insulation Failure / Breakdown</option>
                                        <option value="OVL">OVL — Overload / Overcurrent Trip</option>
                                    </optgroup>
                                </>
                            )}
                        </select>
                    </div>
                </div>

                {/* Failure Effects (ISO 14224 §B.2.5) — kept as the RCM effect record, but
                    closed by default; it opens on its own only when something is written. */}
                <details className="mt-4 pt-3 border-t border-slate-100 group" open={!!(job.localImpact || job.plantWideImpact)}>
                    <summary className="list-none cursor-pointer text-xs font-bold text-slate-600 uppercase flex items-center gap-1.5 select-none">
                        <AlertTriangle size={13} className="text-amber-500" /> Failure Effects (ISO 14224)
                        <span className="text-[10px] font-normal normal-case text-slate-400">{(job.localImpact || job.plantWideImpact) ? 'recorded' : 'optional'}</span>
                        <ChevronDown size={14} className="ml-auto text-slate-400 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Local Impact <span className="text-slate-400 font-normal">(Equipment Level)</span></label>
                            <textarea
                                value={job.localImpact || ''}
                                onChange={(e) => onUpdate({ localImpact: e.target.value })}
                                className="w-full h-20 p-2.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-primary-500 resize-none placeholder:text-slate-400"
                                placeholder="Describe the local effect on this equipment or subsystem if the failure mode occurs (e.g., 'Pump seizure, loss of lubrication to bearings')..."
                            />
                            <p className="text-[10px] text-slate-400 mt-1">Impact on the equipment/subsystem itself when the failure occurs.</p>
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Plant-Wide Impact <span className="text-slate-400 font-normal">(Production / Safety / Environment)</span></label>
                            <textarea
                                value={job.plantWideImpact || ''}
                                onChange={(e) => onUpdate({ plantWideImpact: e.target.value })}
                                className="w-full h-20 p-2.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-primary-500 resize-none placeholder:text-slate-400"
                                placeholder="Describe the broader impact on plant operations, safety, or environment (e.g., 'Loss of cooling water to reactor, emergency shutdown required')..."
                            />
                            <p className="text-[10px] text-slate-400 mt-1">Wider consequence to production output, personnel safety, or environmental compliance.</p>
                        </div>
                    </div>
                </details>

                {criticality === 'A' && (!job.rcmStrategy || !job.functionalFailureCode || !job.failureModeCode) && (
                    <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700 flex items-center gap-2">
                        <AlertTriangle size={14} /> <strong>Criticality A:</strong> RCM strategy, functional failure, and failure mode are mandatory for safety-critical assets.
                    </div>
                )}
            </div>

        </div>
    );
};

const AssetsTab: React.FC<{ job: RecurringJob; onUpdate?: (u: Partial<RecurringJob>) => void; onNavigateToAsset?: (assetId: string) => void; assets?: Asset[] }> = ({ job, onUpdate, onNavigateToAsset, assets = [] }) => {
    // Phase 5C — Functional Auto-Assignment Rules
    type AssignRule = { id: string; field: 'assetType' | 'costCentre' | 'criticality' | 'tag'; operator: 'equals' | 'contains' | 'startsWith'; value: string };
    const [rules, setRules] = React.useState<AssignRule[]>([]);
    const [newRule, setNewRule] = React.useState<Omit<AssignRule, 'id'>>({ field: 'assetType', operator: 'equals', value: '' });
    const [ruleResults, setRuleResults] = React.useState<string | null>(null);
    const [showAddManual, setShowAddManual] = React.useState(false);
    const [assetSearch, setAssetSearch] = React.useState('');

    const addRule = () => {
        if (!newRule.value.trim()) return;
        setRules(prev => [...prev, { ...newRule, id: `rule-${Date.now()}` }]);
        setNewRule({ field: 'assetType', operator: 'equals', value: '' });
    };

    const removeRule = (id: string) => setRules(prev => prev.filter(r => r.id !== id));

    const runRules = () => {
        if (rules.length === 0) {
            setRuleResults('No rules defined. Add at least one rule to auto-assign assets.');
            return;
        }
        // Filter assets by rules
        const matched = assets.filter(asset => {
            return rules.every(rule => {
                let fieldVal = '';
                switch (rule.field) {
                    case 'assetType': fieldVal = (asset as any).assetType || (asset as any).type || ''; break;
                    case 'costCentre': fieldVal = (asset as any).costCentre || (asset as any).costCenter || ''; break;
                    case 'criticality': fieldVal = asset.criticality || ''; break;
                    case 'tag': fieldVal = asset.tag || ''; break;
                }
                const fv = fieldVal.toLowerCase();
                const rv = rule.value.toLowerCase();
                switch (rule.operator) {
                    case 'equals': return fv === rv;
                    case 'contains': return fv.includes(rv);
                    case 'startsWith': return fv.startsWith(rv);
                    default: return false;
                }
            });
        });

        if (matched.length === 0) {
            setRuleResults('No assets matched the current rules.');
            return;
        }

        // Build assigned assets from matched
        const existingIds = new Set(job.assignedAssets.map(a => a.assetId));
        const newAssigned = matched
            .filter(a => !existingIds.has(a.id))
            .map(a => ({
                assetId: a.id,
                lastCompletedDate: undefined,
                lastReadingValue: undefined,
            }));

        if (newAssigned.length > 0 && onUpdate) {
            onUpdate({ assignedAssets: [...job.assignedAssets, ...newAssigned] });
            setRuleResults(`✅ Assigned ${newAssigned.length} new asset(s). ${matched.length - newAssigned.length} already linked.`);
        } else {
            setRuleResults(`All ${matched.length} matching asset(s) are already linked.`);
        }
    };

    const removeAsset = (assetId: string) => {
        if (onUpdate) {
            onUpdate({ assignedAssets: job.assignedAssets.filter(a => a.assetId !== assetId) });
        }
    };

    return (
        <div className="space-y-3 sm:space-y-6">
            {/* Auto-Assignment Rules Engine (Phase 5C) */}
            <div className="bg-white p-3 sm:p-4 rounded-lg border border-slate-200 shadow-sm">
                <div className="flex justify-between items-start gap-2 mb-3">
                    <div className="min-w-0">
                        <h3 className="font-bold text-slate-800 text-xs sm:text-sm uppercase">Auto-Assignment Rules</h3>
                        <p className="text-[10px] text-slate-400 mt-0.5">Link every asset that matches these rules.</p>
                    </div>
                    <button onClick={runRules} className="text-[11px] sm:text-xs bg-primary-600 text-white px-2.5 py-1.5 rounded-lg hover:bg-primary-500 font-bold shadow-sm flex items-center gap-1.5 flex-shrink-0">
                        <TrendingUp size={12} /> Run<span className="hidden sm:inline"> Rules Now</span>
                    </button>
                </div>

                {/* Existing Rules */}
                {rules.length > 0 && (
                    <div className="space-y-2 mb-3">
                        {rules.map((r, i) => (
                            <div key={r.id} className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs">
                                <span className="font-mono text-blue-400 font-bold">{i + 1}</span>
                                <span className="font-bold text-blue-800">{r.field}</span>
                                <span className="text-blue-500">{r.operator}</span>
                                <span className="font-mono bg-white border border-blue-200 rounded px-2 py-0.5 text-blue-900">"{r.value}"</span>
                                <button onClick={() => removeRule(r.id)} className="ml-auto text-red-400 hover:text-red-600">
                                    <X size={14} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* Add New Rule — two small selects on one phone row, value + Add on the next; one row on sm+ */}
                <div className="ers-dense grid grid-cols-2 sm:flex sm:items-end gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                    <div className="sm:flex-1 min-w-0">
                        <label className="block text-[9px] uppercase font-bold text-slate-500 mb-0.5">Field</label>
                        <select value={newRule.field} onChange={e => setNewRule(p => ({ ...p, field: e.target.value as any }))} className="w-full text-xs px-2 py-1.5 border border-slate-200 rounded-md bg-white">
                            <option value="assetType">Asset Type</option>
                            <option value="costCentre">Cost Centre</option>
                            <option value="criticality">Criticality</option>
                            <option value="tag">Asset Tag</option>
                        </select>
                    </div>
                    <div className="sm:flex-1 min-w-0">
                        <label className="block text-[9px] uppercase font-bold text-slate-500 mb-0.5">Operator</label>
                        <select value={newRule.operator} onChange={e => setNewRule(p => ({ ...p, operator: e.target.value as any }))} className="w-full text-xs px-2 py-1.5 border border-slate-200 rounded-md bg-white">
                            <option value="equals">Equals</option>
                            <option value="contains">Contains</option>
                            <option value="startsWith">Starts With</option>
                        </select>
                    </div>
                    <div className="col-span-2 sm:col-span-1 sm:flex-1 flex items-end gap-2 min-w-0">
                        <div className="flex-1 min-w-0">
                            <label className="block text-[9px] uppercase font-bold text-slate-500 mb-0.5">Value</label>
                            <input type="text" value={newRule.value} onChange={e => setNewRule(p => ({ ...p, value: e.target.value }))} className="w-full text-xs px-2 py-1.5 border border-slate-200 rounded-md" placeholder="e.g. Pump" />
                        </div>
                        <button onClick={addRule} className="px-3 min-h-[36px] border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 rounded-md text-xs font-bold flex-shrink-0">Add</button>
                    </div>
                </div>

                {/* Rule Result */}
                {ruleResults && (
                    <div className={`mt-3 text-xs p-2 rounded-lg border ${ruleResults.startsWith('✅') ? 'bg-green-50 border-green-200 text-green-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                        {ruleResults}
                    </div>
                )}
            </div>

            {/* Asset List */}
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                <div className="p-3 bg-slate-50 border-b border-slate-200 font-bold text-slate-700 text-sm flex justify-between">
                    <span>Linked Assets ({job.assignedAssets.length})</span>
                    <button
                        onClick={() => setShowAddManual(prev => !prev)}
                        className="text-xs bg-white border border-slate-300 px-2 py-1 rounded hover:bg-slate-100 font-medium"
                    >
                        {showAddManual ? 'Cancel' : '+ Add Manual'}
                    </button>
                </div>

                {/* Manual Add Asset Dropdown */}
                {showAddManual && (
                    <div className="p-4 border-b border-slate-200 bg-blue-50/50">
                        <label className="block text-xs font-bold text-slate-600 uppercase mb-2">Search & Select Asset</label>
                        <div className="flex gap-2 items-end">
                            <div className="flex-1">
                                <input
                                    type="text"
                                    value={assetSearch}
                                    onChange={e => setAssetSearch(e.target.value)}
                                    className="w-full text-sm p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                                    placeholder="Search by tag, name, or ID..."
                                />
                            </div>
                        </div>
                        {assetSearch.trim() && (
                            <div className="mt-2 max-h-48 overflow-y-auto border border-slate-200 rounded-lg bg-white divide-y divide-slate-100">
                                {assets
                                    .filter(a => {
                                        const q = assetSearch.toLowerCase();
                                        return (
                                            (a.tag?.toLowerCase().includes(q)) ||
                                            (a.name?.toLowerCase().includes(q)) ||
                                            (a.id?.toLowerCase().includes(q))
                                        );
                                    })
                                    .filter(a => !job.assignedAssets.some(ra => ra.assetId === a.id))
                                    .slice(0, 15)
                                    .map(a => (
                                        <button
                                            key={a.id}
                                            className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center justify-between gap-3 transition"
                                            onClick={() => {
                                                if (onUpdate) {
                                                    onUpdate({
                                                        assignedAssets: [
                                                            ...job.assignedAssets,
                                                            { assetId: a.id, lastCompletedDate: undefined as any, lastReadingValue: undefined as any }
                                                        ]
                                                    });
                                                }
                                                setAssetSearch('');
                                                setShowAddManual(false);
                                            }}
                                        >
                                            <div className="flex items-center gap-2 min-w-0">
                                                <span className="font-mono font-bold text-blue-600 text-xs shrink-0">{a.tag || '—'}</span>
                                                <span className="text-slate-700 truncate">{a.name}</span>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                {a.criticality && (
                                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${a.criticality === 'A' ? 'bg-red-100 text-red-700' : a.criticality === 'B' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                                                        Crit {a.criticality}
                                                    </span>
                                                )}
                                                <Plus size={14} className="text-blue-500" />
                                            </div>
                                        </button>
                                    ))
                                }
                                {assets.filter(a => {
                                    const q = assetSearch.toLowerCase();
                                    return ((a.tag?.toLowerCase().includes(q)) || (a.name?.toLowerCase().includes(q)));
                                }).filter(a => !job.assignedAssets.some(ra => ra.assetId === a.id)).length === 0 && (
                                        <div className="px-3 py-4 text-center text-sm text-slate-400">No matching assets found</div>
                                    )}
                            </div>
                        )}
                    </div>
                )}

                {/* Mobile: stacked cards — every linked asset fully visible without
                    sideways scrolling; the table stays for sm+ */}
                <div className="sm:hidden divide-y divide-slate-100">
                    {job.assignedAssets.map((ra, idx) => {
                        const asset = assets.find(a => a.id === ra.assetId);
                        const nextDue = ra.lastCompletedDate ? addCadence(ra.lastCompletedDate, job.frequencyInterval, job.frequencyUnit) : 'Pending';
                        const crit = asset?.criticality;
                        return (
                            <div key={idx} className="p-3">
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => asset && onNavigateToAsset?.(asset.id)}
                                        className="font-bold text-blue-600 text-sm flex items-center gap-1 min-w-0"
                                        title={`Navigate to ${asset?.tag || 'asset'}`}
                                    >
                                        <span className="truncate">{asset?.tag || '—'}</span>
                                        <ArrowUpRight size={12} className="opacity-50 flex-shrink-0" />
                                    </button>
                                    {crit && (
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold flex-shrink-0 ${crit === 'A' ? 'bg-red-100 text-red-700' : crit === 'B' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                                            {crit}
                                        </span>
                                    )}
                                    <div className="flex-1" />
                                    <button onClick={() => removeAsset(ra.assetId)} className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded flex-shrink-0" title="Remove asset">
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                                <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">{asset?.name}</p>
                                <div className={`ers-dense mt-2 grid gap-2 ${job.scheduleType === 'READING' ? 'grid-cols-3' : 'grid-cols-2'}`}>
                                    <div>
                                        <label className="block text-[9px] font-bold text-slate-400 uppercase mb-0.5">Last completed</label>
                                        {/* The visible text is ours (same formatter as Next due) — a native
                                            date input shows whatever shape the browser likes. The real input
                                            sits on top, invisible, so a tap still opens the system picker. */}
                                        <div className="relative">
                                            <div className={`w-full min-h-[36px] flex items-center justify-between gap-1 border border-slate-200 rounded-md px-2 py-1 text-sm bg-white tabular-nums ${ra.lastCompletedDate ? 'text-slate-800' : 'text-slate-400'}`}>
                                                <span className="truncate">{ra.lastCompletedDate ? fmtLocalDate(ra.lastCompletedDate) : 'Set date'}</span>
                                                <Calendar size={13} className="text-slate-400 flex-shrink-0" />
                                            </div>
                                            <input type="date" aria-label="Last completed" value={ra.lastCompletedDate || ''} onChange={e => {
                                                if (onUpdate) {
                                                    const updated = job.assignedAssets.map((a, i) => i === idx ? { ...a, lastCompletedDate: e.target.value } : a);
                                                    onUpdate({ assignedAssets: updated });
                                                }
                                            }} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                                        </div>
                                    </div>
                                    {job.scheduleType === 'READING' && (
                                        <div>
                                            <label className="block text-[9px] font-bold text-slate-400 uppercase mb-0.5">Last reading</label>
                                            <input type="number" value={ra.lastReadingValue ?? ''} onChange={e => {
                                                if (onUpdate) {
                                                    const updated = job.assignedAssets.map((a, i) => i === idx ? { ...a, lastReadingValue: parseFloat(e.target.value) || undefined } : a);
                                                    onUpdate({ assignedAssets: updated });
                                                }
                                            }} className="w-full border border-slate-200 rounded-md px-2 py-1 text-sm text-slate-800 bg-white" />
                                        </div>
                                    )}
                                    <div>
                                        <label className="block text-[9px] font-bold text-slate-400 uppercase mb-0.5">Next due (est)</label>
                                        <div className="w-full min-h-[36px] flex items-center border border-slate-200 rounded-md px-2 py-1 text-sm text-slate-800 bg-slate-50 tabular-nums">{fmtLocalDate(nextDue)}</div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    {job.assignedAssets.length === 0 && (
                        <div className="px-4 py-8 text-center text-slate-400 text-sm">
                            <Package size={28} className="mx-auto mb-2 opacity-20" />
                            <p>No assets linked. Use the rules above or add manually.</p>
                        </div>
                    )}
                </div>

                <div className="hidden sm:block overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50">
                        <tr>
                            <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Asset Tag</th>
                            <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Description</th>
                            <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Criticality</th>
                            <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Last Completed</th>
                            {job.scheduleType === 'READING' && <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Last Reading</th>}
                            <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Next Due (Est)</th>
                            <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                        {job.assignedAssets.map((ra, idx) => {
                            const asset = assets.find(a => a.id === ra.assetId);
                            const nextDue = ra.lastCompletedDate ? addCadence(ra.lastCompletedDate, job.frequencyInterval, job.frequencyUnit) : 'Pending';
                            const crit = asset?.criticality;

                            return (
                                <tr key={idx} className="hover:bg-slate-50">
                                    <td className="px-4 py-3 text-sm">
                                        <button
                                            onClick={() => asset && onNavigateToAsset?.(asset.id)}
                                            className="font-bold text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1 transition-colors"
                                            title={`Navigate to ${asset?.tag || 'asset'}`}
                                        >
                                            {asset?.tag}
                                            <ArrowUpRight size={12} className="opacity-50" />
                                        </button>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-slate-600">{asset?.name}</td>
                                    <td className="px-4 py-3 text-sm">
                                        {crit && (
                                            <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-bold ${crit === 'A' ? 'bg-red-100 text-red-700' :
                                                crit === 'B' ? 'bg-amber-100 text-amber-700' :
                                                    'bg-green-100 text-green-700'
                                                }`}>
                                                {crit === 'A' ? '🔴' : crit === 'B' ? '🟡' : '🟢'} {crit}
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-sm">
                                        <input type="date" value={ra.lastCompletedDate || ''} onChange={e => {
                                            if (onUpdate) {
                                                const updated = job.assignedAssets.map((a, i) => i === idx ? { ...a, lastCompletedDate: e.target.value } : a);
                                                onUpdate({ assignedAssets: updated });
                                            }
                                        }} className="border border-slate-300 rounded px-2 py-1 text-sm text-slate-900 focus:ring-2 focus:ring-primary-500" />
                                    </td>
                                    {job.scheduleType === 'READING' && (
                                        <td className="px-4 py-3 text-sm">
                                            <input type="number" value={ra.lastReadingValue ?? ''} onChange={e => {
                                                if (onUpdate) {
                                                    const updated = job.assignedAssets.map((a, i) => i === idx ? { ...a, lastReadingValue: parseFloat(e.target.value) || undefined } : a);
                                                    onUpdate({ assignedAssets: updated });
                                                }
                                            }} className="w-20 border border-slate-300 rounded px-1 text-sm" />
                                        </td>
                                    )}
                                    <td className="px-4 py-3 text-sm font-mono text-slate-500">{nextDue}</td>
                                    <td className="px-4 py-3 text-right">
                                        <button onClick={() => removeAsset(ra.assetId)} className="text-red-500 hover:text-red-700 font-bold text-xs">Remove</button>
                                    </td>
                                </tr>
                            );
                        })}
                        {job.assignedAssets.length === 0 && (
                            <tr>
                                <td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-sm">
                                    <Package size={32} className="mx-auto mb-2 opacity-20" />
                                    <p>No assets linked. Use Auto-Assignment Rules above or add manually.</p>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
                </div>
            </div>
        </div >
    );
};

const TasksTab: React.FC<{ job: RecurringJob; onUpdate: (u: Partial<RecurringJob>) => void }> = ({ job, onUpdate }) => {
    const confirm = useConfirm();
    const promptModal = usePrompt();
    const { showToast } = useToast();
    const { user } = useAuth();
    const [savingToLibrary, setSavingToLibrary] = useState(false);
    const [tasks, setTasks] = useState<JobTask[]>(job.tasks || []);
    const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

    // Enhancement 1: Import from Library state
    const [showLibraryPicker, setShowLibraryPicker] = useState(false);
    const [libraryTasks, setLibraryTasks] = useState<LibraryTask[]>([]);
    const [libraryLoading, setLibraryLoading] = useState(false);
    const [librarySearch, setLibrarySearch] = useState('');
    const [libraryCategory, setLibraryCategory] = useState<string>('ALL');

    const updateTasks = (newTasks: JobTask[]) => {
        setTasks(newTasks);
        // Steps with hours own the schedule's duration estimate (Details shows it read-only).
        const hrs = stepsHours(newTasks);
        onUpdate(hrs.count > 0 ? { tasks: newTasks, estDuration: hrs.total } : { tasks: newTasks });
    };

    const addTask = () => {
        const nextSeq = tasks.length > 0 ? Math.max(...tasks.map(t => t.sequence)) + 10 : 10;
        const newTask: JobTask = {
            id: `new-${Date.now()}`,
            sequence: nextSeq,
            description: 'New Task Step',
            estHours: 0,
            status: 'PENDING',
            instructions: [],
            estStartDate: new Date().toISOString().split('T')[0],
        };
        const newTasks = [...tasks, newTask];
        updateTasks(newTasks);
        setEditingTaskId(newTask.id);
    };

    const moveTask = (index: number, direction: 'up' | 'down') => {
        if ((direction === 'up' && index === 0) || (direction === 'down' && index === tasks.length - 1)) return;
        const newTasks = [...tasks];
        const swapIndex = direction === 'up' ? index - 1 : index + 1;
        [newTasks[index], newTasks[swapIndex]] = [newTasks[swapIndex], newTasks[index]];
        newTasks.forEach((t, i) => t.sequence = (i + 1) * 10);
        updateTasks(newTasks);
    };

    const deleteTask = async (id: string) => {
        const ok = await confirm({
            title: 'Delete Task Step',
            message: 'This task step will be permanently removed from the procedure.',
            variant: 'danger',
            confirmLabel: 'Delete',
        });
        if (ok) {
            const newTasks = tasks.filter(t => t.id !== id);
            updateTasks(newTasks);
            if (editingTaskId === id) setEditingTaskId(null);
        }
    };

    const updateTask = (id: string, updates: Partial<JobTask>) => {
        const newTasks = tasks.map(t => t.id === id ? { ...t, ...updates } : t);
        updateTasks(newTasks);
    };

    // Enhancement 1: Open library picker and load tasks
    const openLibraryPicker = async () => {
        setShowLibraryPicker(true);
        if (libraryTasks.length === 0) {
            setLibraryLoading(true);
            try {
                const tasks = await DatabaseService.getInstance().getLibraryTasks();
                setLibraryTasks(tasks);
            } catch (e) { console.error('Failed to load library:', e); }
            setLibraryLoading(false);
        }
    };

    // Enhancement 1: Import a library task into the PM template
    const importFromLibrary = (libTask: LibraryTask) => {
        // Create a new JobTask from the library template
        const nextSeq = tasks.length > 0 ? Math.max(...tasks.map(t => t.sequence)) + 10 : 10;
        const newTask: JobTask = {
            id: `lib-${Date.now()}`,
            sequence: nextSeq,
            description: libTask.title,
            estHours: libTask.estimatedDuration || 0,
            status: 'PENDING',
            instructions: (libTask.instructions || []).map((inst, i) => ({
                ...inst,
                // Library blocks saved from a work order kept their text in description;
                // everything downstream renders label (0371 repaired stored rows).
                label: (inst as any).label || (inst as any).description || '',
                id: `lib-inst-${Date.now()}-${i}`,
                sequence: i + 1,
            })),
        };

        const newTasks = [...tasks, newTask];
        updateTasks(newTasks);
        setEditingTaskId(newTask.id);
        setShowLibraryPicker(false);
    };

    // The way back: a step authored here becomes a Task Library template other
    // schedules and work orders can import. Instruction blocks are copied with fresh
    // ids and without any execution data (observations / evidence never exist on a
    // template, but a step imported from a WO could carry them).
    const saveStepToLibrary = async (task: JobTask) => {
        const title = await promptModal({
            title: 'Save step to Task Library',
            message: 'Other schedules and work orders can then import it from the Library.',
            defaultValue: task.description || '',
            placeholder: 'Template title',
            confirmLabel: 'Save to Library',
        });
        if (!title || !title.trim()) return;
        setSavingToLibrary(true);
        try {
            const category: LibraryTask['category'] = job.jobType === 'Inspection' ? 'INSPECTION' : 'MAINTENANCE';
            const stamp = Date.now();
            const created = await DatabaseService.getInstance().createLibraryTask({
                code: `LIB-${stamp.toString(36).toUpperCase()}`,
                title: title.trim(),
                description: `From ${job.code} — ${job.title || job.jobDescription || job.description || ''}`.trim(),
                category,
                estimatedDuration: task.estHours || 0,
                instructions: (task.instructions || []).map((inst, i) => ({ ...inst, id: `lib-src-${stamp}-${i}`, sequence: i + 1, valueString: inst.type === 'TEXT' ? undefined : inst.valueString, photoUrls: undefined })),
                safetyRequirements: [],
            }, [], [], [], user?.id || 'unknown');
            if (created) setLibraryTasks(prev => [created, ...prev]);
            showToast(`"${title.trim()}" saved to the Task Library`, 'success');
        } catch (e: any) {
            const msg = String(e?.message || e);
            showToast(e?.code === '42501' || /policy|permission/i.test(msg) ? 'Your role cannot add Task Library templates.' : `Could not save to the Library: ${msg}`, 'error');
        } finally {
            setSavingToLibrary(false);
        }
    };

    // Enhancement 1: Filter library tasks
    const filteredLibrary = libraryTasks.filter(t => {
        const matchesCategory = libraryCategory === 'ALL' || t.category === libraryCategory;
        const matchesSearch = !librarySearch ||
            t.title.toLowerCase().includes(librarySearch.toLowerCase()) ||
            t.code?.toLowerCase().includes(librarySearch.toLowerCase()) ||
            t.description?.toLowerCase().includes(librarySearch.toLowerCase());
        return matchesCategory && matchesSearch;
    });

    const editingTask = tasks.find(t => t.id === editingTaskId);
    const editingIndex = tasks.findIndex(t => t.id === editingTaskId);

    // Step popup plumbing — Esc closes, body scroll locks while open. Same
    // pattern as the Work Order step popup so PM templates feel identical.
    useEffect(() => {
        if (!editingTaskId) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setEditingTaskId(null); };
        window.addEventListener('keydown', onKey);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; };
    }, [editingTaskId]);

    const totalHrs = tasks.reduce((s, t) => s + (t.estHours || 0), 0);

    return (
        <div className="animate-in fade-in duration-300">
            {/* Header Bar — harmonised with the Work Order Tasks tab */}
            <div className="bg-white border border-slate-200 rounded-t-lg p-2 sm:p-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                    <h3 className="font-bold text-slate-800 text-sm whitespace-nowrap">Steps <span className="hidden sm:inline text-slate-400 font-normal">(template)</span></h3>
                    {tasks.length > 0 && (
                        <span className="text-[10px] text-slate-400 whitespace-nowrap border-l border-slate-200 pl-2">
                            {tasks.length} step{tasks.length === 1 ? '' : 's'} · {totalHrs.toFixed(1)}h
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                        onClick={openLibraryPicker}
                        className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-1.5 rounded hover:bg-blue-100 flex items-center gap-1 font-medium transition-colors"
                        title="Import steps from Task Library"
                    >
                        <BookOpen size={13} /> Library
                    </button>
                    <button onClick={addTask} className="text-xs bg-primary-600 text-white px-3 py-1.5 rounded hover:bg-primary-500 flex items-center gap-1 font-medium">
                        <Plus size={14} /> Add
                    </button>
                </div>
            </div>

            {/* Stacked step rows — full width, same look as the WO Tasks tab */}
            <div className="ers-dense border-x border-b border-slate-200 rounded-b-lg overflow-hidden bg-slate-50/50">
                {tasks.map((task, index) => (
                    <div key={task.id} className={index > 0 ? 'border-t border-slate-200' : ''}>
                        <div
                            onClick={() => setEditingTaskId(task.id)}
                            className="flex items-center gap-2 sm:gap-3 px-2 sm:px-4 py-2 sm:py-3 cursor-pointer transition-colors group bg-white hover:bg-slate-50 border-l-[3px] border-l-transparent hover:border-l-blue-300"
                        >
                            <ChevronRight size={16} className="text-slate-400 flex-shrink-0" />
                            <span className="font-mono text-xs font-bold px-2 py-0.5 rounded flex-shrink-0 bg-slate-100 text-slate-500">
                                {index + 1}
                            </span>
                            <div className="flex-1 min-w-0">
                                <input
                                    type="text"
                                    value={task.description}
                                    onChange={(e) => updateTask(task.id, { description: e.target.value })}
                                    onClick={(e) => e.stopPropagation()}
                                    onFocus={(e) => e.stopPropagation()}
                                    className="w-full font-medium text-sm text-slate-900 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 hover:border-slate-300 focus:ring-2 focus:ring-primary-400 focus:border-primary-600 focus:outline-none placeholder:text-slate-300 truncate transition-colors"
                                    placeholder="Enter task step name..."
                                />
                            </div>
                            <button
                                onClick={(e) => { e.stopPropagation(); deleteTask(task.id); }}
                                className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0"
                                title="Delete task step"
                            >
                                <Trash2 size={14} />
                            </button>
                            {(task.instructions?.length || 0) > 0 && (
                                <span className="hidden sm:flex text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium items-center gap-0.5 flex-shrink-0">
                                    <ClipboardList size={9} /> {task.instructions?.length}
                                </span>
                            )}
                            <span className="hidden sm:block text-xs text-slate-500 font-medium flex-shrink-0 w-14 text-right">
                                {task.estHours}h
                            </span>
                            <div className="hidden sm:flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                    onClick={(e) => { e.stopPropagation(); moveTask(index, 'up'); }}
                                    className="p-1 hover:bg-slate-200 rounded text-slate-400 disabled:opacity-30"
                                    disabled={index === 0}
                                ><MoveUp size={12} /></button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); moveTask(index, 'down'); }}
                                    className="p-1 hover:bg-slate-200 rounded text-slate-400 disabled:opacity-30"
                                    disabled={index === tasks.length - 1}
                                ><MoveDown size={12} /></button>
                            </div>
                        </div>
                    </div>
                ))}
                {tasks.length === 0 && (
                    <div className="text-center py-12 text-slate-400 bg-white">
                        <BookOpen size={40} className="mx-auto mb-3 opacity-20" />
                        <p className="text-sm font-medium">No tasks defined</p>
                        <p className="text-xs mt-1">Click <strong>Library</strong> to import from the Task Library, or <strong>Add</strong> to start from scratch.</p>
                    </div>
                )}
            </div>

            {/* Step popup — same shell as the Work Order step popup: full-screen on
                mobile, centered modal on desktop. Portaled to <body>: the PM detail
                overlay (fixed z-40) is a stacking context that would trap this below
                the z-50 mobile bottom nav. */}
            {editingTask && createPortal(
                <div className="fixed inset-0 z-[60] flex items-stretch sm:items-center justify-center sm:p-6">
                    <div
                        className="absolute inset-0 bg-black/50 animate-in fade-in duration-200"
                        onClick={() => setEditingTaskId(null)}
                    />
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label={`Step ${editingIndex + 1}: ${editingTask.description || 'Untitled step'}`}
                        className="relative w-full sm:max-w-3xl h-full sm:h-[90vh] bg-slate-50 sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 fade-in duration-200"
                    >
                        {/* Header — step identity + navigation */}
                        <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-5 py-3 bg-blue-600 text-white shrink-0">
                            <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-white/20 shrink-0">
                                {editingIndex + 1}
                            </span>
                            <div className="flex-1 min-w-0">
                                <div className="font-semibold text-sm sm:text-base truncate">{editingTask.description || 'Untitled step'}</div>
                                <div className="text-[10px] sm:text-[11px] text-blue-100">
                                    Step {editingIndex + 1} of {tasks.length} — PM template
                                </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                                <button
                                    onClick={addTask}
                                    className="hidden sm:flex items-center gap-1 text-[11px] font-semibold px-2 py-1.5 rounded-lg bg-white/15 text-white hover:bg-white/25 transition-colors mr-1"
                                    title="Add a new step to this template"
                                ><Plus size={13} /> New step</button>
                                <button
                                    onClick={() => setEditingTaskId(tasks[editingIndex - 1].id)}
                                    disabled={editingIndex <= 0}
                                    className="p-1.5 rounded-lg text-blue-100 hover:bg-white/15 disabled:opacity-30 transition-colors"
                                    title="Previous step"
                                ><ChevronLeft size={16} /></button>
                                <button
                                    onClick={() => setEditingTaskId(tasks[editingIndex + 1].id)}
                                    disabled={editingIndex >= tasks.length - 1}
                                    className="p-1.5 rounded-lg text-blue-100 hover:bg-white/15 disabled:opacity-30 transition-colors"
                                    title="Next step"
                                ><ChevronRight size={16} /></button>
                                <button
                                    onClick={() => setEditingTaskId(null)}
                                    className="p-1.5 rounded-lg text-blue-100 hover:bg-white/15 ml-1 transition-colors"
                                    title="Close (Esc)"
                                ><X size={16} /></button>
                            </div>
                        </div>
                        {/* Step name + estimate */}
                        <div className="ers-dense px-3 sm:px-5 py-3 bg-white border-b border-slate-200 shrink-0">
                            <label className="text-[11px] font-bold uppercase tracking-wider text-blue-600 flex items-center gap-1.5 mb-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" /> Step name
                            </label>
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    value={editingTask.description}
                                    onChange={(e) => updateTask(editingTask.id, { description: e.target.value })}
                                    autoFocus={!editingTask.description}
                                    placeholder="What does this step do? e.g. Isolate and lock out main drive"
                                    className={`flex-1 min-w-0 text-sm font-medium rounded-lg px-3 py-2 border outline-none transition-colors focus:ring-2 focus:ring-primary-400 focus:border-primary-600 ${
                                        !editingTask.description
                                            ? 'border-amber-300 bg-amber-50/40 placeholder:text-amber-500/60'
                                            : 'border-slate-200 bg-white hover:border-slate-300'
                                    }`}
                                />
                                <div className="flex items-center gap-1 flex-shrink-0 text-xs">
                                    <Clock size={12} className="text-slate-400" />
                                    <input
                                        type="number"
                                        value={editingTask.estHours}
                                        onChange={(e) => updateTask(editingTask.id, { estHours: parseFloat(e.target.value) || 0 })}
                                        className="w-14 text-sm border border-slate-200 rounded-lg p-2 text-right focus:ring-2 focus:ring-primary-400 focus:border-primary-600 outline-none"
                                        title="Estimated hours for this step"
                                    />
                                    <span className="text-slate-400">hrs</span>
                                </div>
                            </div>
                        </div>
                        {/* Body — instruction builder */}
                        <div className="ers-dense flex-1 overflow-y-auto overscroll-contain p-2 sm:p-3">
                            <ProcedureBuilder
                                instructions={editingTask.instructions || []}
                                onChange={(blocks) => updateTask(editingTask.id, { instructions: blocks })}
                                mode="EDIT"
                                context="TEMPLATE"
                            />
                        </div>
                        {/* Footer */}
                        <div
                            className="flex items-center gap-2 px-3 sm:px-5 py-3 bg-white border-t border-slate-200 shrink-0"
                            style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
                        >
                            <button
                                onClick={() => deleteTask(editingTask.id)}
                                className="flex items-center gap-1.5 text-xs font-semibold text-red-500 hover:text-red-600 hover:bg-red-50 px-2.5 py-2 rounded-lg transition-colors"
                                title="Delete this step from the template"
                            >
                                <Trash2 size={13} /> Delete step
                            </button>
                            <button
                                onClick={() => void saveStepToLibrary(editingTask)}
                                disabled={savingToLibrary}
                                className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 hover:bg-blue-50 px-2.5 py-2 rounded-lg transition-colors disabled:opacity-60"
                                title="Save this step as a Task Library template"
                            >
                                {savingToLibrary ? <Loader2 size={13} className="animate-spin" /> : <BookOpen size={13} />} <span className="hidden sm:inline">Save to </span>Library
                            </button>
                            <span className="hidden sm:flex items-center gap-1 text-[10px] text-slate-400 ml-1">
                                <CheckCircle size={11} className="text-emerald-500" /> Changes apply to the template — Save the PM to persist
                            </span>
                            <div className="flex-1" />
                            <button
                                onClick={() => setEditingTaskId(null)}
                                className="text-xs font-bold bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-500 transition-colors"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Enhancement 1: Library Picker Modal — portaled for the same
                stacking-context reason as the step popup */}
            {showLibraryPicker && createPortal(
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-4 border-b border-slate-200 bg-blue-50 flex justify-between items-center">
                            <div>
                                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                    <BookOpen size={18} className="text-blue-600" /> Import from Task Library
                                </h3>
                                <p className="text-xs text-slate-500 mt-0.5">Select a template to add as a job step. Procedures, parts, and hours will be imported.</p>
                            </div>
                            <button onClick={() => setShowLibraryPicker(false)} className="text-slate-400 hover:text-slate-600 p-1"><X size={20} /></button>
                        </div>

                        {/* Search & Filter */}
                        <div className="p-3 border-b border-slate-200 bg-slate-50 flex gap-3 items-center">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
                                <input
                                    type="text"
                                    placeholder="Search templates..."
                                    value={librarySearch}
                                    onChange={e => setLibrarySearch(e.target.value)}
                                    className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm"
                                    autoFocus
                                />
                            </div>
                            <select
                                value={libraryCategory}
                                onChange={e => setLibraryCategory(e.target.value)}
                                className="text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white"
                            >
                                <option value="ALL">All Categories</option>
                                <option value="MAINTENANCE">Maintenance</option>
                                <option value="INSPECTION">Inspection</option>
                                <option value="SAFETY">Safety</option>
                                <option value="PROJECT">Project</option>
                            </select>
                        </div>

                        {/* List */}
                        <div className="flex-1 overflow-y-auto p-3">
                            {libraryLoading ? (
                                <div className="flex items-center justify-center py-12 text-slate-400">
                                    <Loader2 className="animate-spin mr-2" size={20} /> Loading library...
                                </div>
                            ) : filteredLibrary.length === 0 ? (
                                <div className="text-center py-12 text-slate-400">
                                    <BookOpen size={40} className="mx-auto mb-3 opacity-20" />
                                    <p>No templates found.</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {filteredLibrary.map(libTask => (
                                        <div
                                            key={libTask.id}
                                            onClick={() => importFromLibrary(libTask)}
                                            className="p-4 border border-slate-200 rounded-lg hover:bg-blue-50 hover:border-blue-300 cursor-pointer transition-all group"
                                        >
                                            <div className="flex justify-between items-start mb-1.5">
                                                <div className="flex items-center gap-2">
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                                        libTask.category === 'MAINTENANCE' ? 'bg-orange-100 text-orange-700' :
                                                        libTask.category === 'SAFETY' ? 'bg-red-100 text-red-700' :
                                                        libTask.category === 'INSPECTION' ? 'bg-blue-100 text-blue-700' :
                                                        'bg-blue-100 text-blue-700'
                                                    }`}>{libTask.category}</span>
                                                    <span className="text-xs font-mono text-slate-400">{libTask.code}</span>
                                                    {libTask.isLocked && (
                                                        <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold flex items-center gap-1" title="Locked — used on a completed WO">
                                                            🔒 v{libTask.version}
                                                        </span>
                                                    )}
                                                    {libTask.version && libTask.version > 1 && !libTask.isLocked && (
                                                        <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-bold">v{libTask.version}</span>
                                                    )}
                                                </div>
                                                <span className="text-xs text-blue-600 font-medium opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                                                    Click to import <ChevronRight size={12} />
                                                </span>
                                            </div>
                                            <h4 className="font-bold text-slate-800 text-sm">{libTask.title}</h4>
                                            <p className="text-xs text-slate-500 line-clamp-2 mt-1">{libTask.description || 'No description'}</p>
                                            <div className="flex gap-4 mt-2 text-[11px] text-slate-400">
                                                <span className="flex items-center gap-1"><Clock size={11} /> {libTask.estimatedDuration}h</span>
                                                <span className="flex items-center gap-1"><CheckSquare size={11} /> {libTask.instructions?.length || 0} steps</span>
                                                {(libTask.assetClassCodes || []).length > 0 && (
                                                    <span className="flex items-center gap-1 text-primary-600">
                                                        <Layers size={11} /> {libTask.assetClassCodes!.join(', ')}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

const JSATab: React.FC<{ job: RecurringJob, onUpdate: (u: Partial<RecurringJob>) => void }> = ({ job, onUpdate }) => {
    const confirm = useConfirm();
    const jsa = job.jsa || { id: `jsa-${Date.now()}`, status: 'DRAFT', hazards: [], permits: [], signoffs: [] };

    const CONSEQUENCE_LABELS = ['Insignificant', 'Minor', 'Moderate', 'Major', 'Catastrophic'];
    const LIKELIHOOD_LABELS = ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost Certain'];

    const addHazard = () => {
        const newHazard: JSAHazard = {
            id: `hz-${Date.now()}`,
            hazard: '',
            consequence: 3,
            likelihood: 3,
            riskScore: 9,
            riskLevel: 'Medium',
            controlHierarchy: [],
            controls: '',
            signoffRequired: false,
        };
        onUpdate({ jsa: { ...jsa, hazards: [...(jsa.hazards || []), newHazard] } });
    };

    const updateHazard = (id: string, field: string, value: any) => {
        const newHazards = (jsa.hazards || []).map(h => {
            if (h.id !== id) return h;
            const updated = { ...h, [field]: value };
            // Auto-compute risk score when consequence or likelihood changes
            if (field === 'consequence' || field === 'likelihood') {
                const c = field === 'consequence' ? Number(value) : (h.consequence || 1);
                const l = field === 'likelihood' ? Number(value) : (h.likelihood || 1);
                updated.riskScore = c * l;
                updated.riskLevel = getRiskLevel(c * l);
                updated.signoffRequired = c * l >= 15;
            }
            return updated;
        });
        onUpdate({ jsa: { ...jsa, hazards: newHazards } });
    };

    const toggleControl = (id: string, control: string) => {
        const h = (jsa.hazards || []).find(h => h.id === id);
        if (!h) return;
        const current = h.controlHierarchy || [];
        const next = current.includes(control as any)
            ? current.filter((c: string) => c !== control)
            : [...current, control as any];
        updateHazard(id, 'controlHierarchy', next);
    };

    const deleteHazard = async (id: string) => {
        const ok = await confirm({
            title: 'Remove Hazard',
            message: 'This hazard entry and its risk assessment will be removed from the JSA.',
            variant: 'danger',
            confirmLabel: 'Remove',
        });
        if (ok) {
            onUpdate({ jsa: { ...jsa, hazards: (jsa.hazards || []).filter(h => h.id !== id) } });
        }
    };

    // Risk matrix cell color
    const cellColor = (c: number, l: number) => {
        const s = c * l;
        if (s >= 20) return 'bg-red-600 text-white';
        if (s >= 15) return 'bg-orange-500 text-white';
        if (s >= 8) return 'bg-amber-400 text-amber-900';
        if (s >= 4) return 'bg-yellow-300 text-yellow-900';
        return 'bg-green-400 text-green-900';
    };

    return (
        <div className="space-y-3 sm:space-y-6 animate-in fade-in duration-300">
            <div className="bg-white p-3 sm:p-4 rounded-lg border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                <div>
                    <h3 className="font-bold text-slate-800 text-sm sm:text-base">Job Safety Analysis (JSA) Template</h3>
                    <p className="text-xs sm:text-sm text-slate-500">5×5 Risk Matrix · Hierarchy of Controls · ISO 31000 / ISO 45001</p>
                </div>
                <button onClick={addHazard} className="bg-primary-600 hover:bg-primary-500 text-white px-3 py-2 sm:px-4 rounded-lg text-xs sm:text-sm font-bold shadow-sm flex items-center gap-2 self-start sm:self-auto flex-shrink-0">
                    <Plus size={16} /> Add Hazard
                </button>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800 flex items-start gap-2">
                <Shield size={14} className="mt-0.5 flex-shrink-0" />
                <span>Permit to Work (PTW) creation happens on the generated Work Order. Define hazards and risk controls here. Items scoring ≥ 15 require mandatory sign-off before WO generation.</span>
            </div>

            {/* 5×5 Risk Matrix Reference */}
            <div className="bg-white border border-slate-200 rounded-lg p-4">
                <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">Risk Matrix Reference (Consequence × Likelihood)</h4>
                <div className="overflow-x-auto">
                    <table className="text-[10px] w-full max-w-lg">
                        <thead>
                            <tr>
                                <th className="p-1 text-left text-slate-400">C↓ / L→</th>
                                {LIKELIHOOD_LABELS.map((l, i) => (
                                    <th key={i} className="p-1 text-center font-bold text-slate-600">{i + 1}<br /><span className="font-normal text-slate-400">{l}</span></th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {CONSEQUENCE_LABELS.map((cl, ci) => (
                                <tr key={ci}>
                                    <td className="p-1 font-bold text-slate-600">{ci + 1} <span className="font-normal text-slate-400">{cl}</span></td>
                                    {LIKELIHOOD_LABELS.map((_, li) => {
                                        const score = (ci + 1) * (li + 1);
                                        return (
                                            <td key={li} className={`p-1 text-center font-bold rounded ${cellColor(ci + 1, li + 1)}`}>
                                                {score}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Hazard Cards */}
            <div className="space-y-4">
                {(jsa.hazards || []).map((h: any, idx: number) => {
                    const score = typeof h.riskScore === 'number' ? h.riskScore : (h.consequence || 1) * (h.likelihood || 1);
                    const level = h.riskLevel || getRiskLevel(score);
                    return (
                        <div key={h.id} className={`ers-dense bg-white border-2 rounded-lg p-3 sm:p-4 transition ${RISK_COLORS[level] || 'border-slate-200'}`}>
                            <div className="flex items-start gap-2 sm:gap-3">
                                <span className="font-mono text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded mt-1 flex-shrink-0">{idx + 1}</span>
                                <div className="flex-1 min-w-0 space-y-2.5 sm:space-y-3">
                                    {/* Hazard Description */}
                                    <div>
                                        <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Hazard Description</label>
                                        <input
                                            type="text"
                                            value={h.hazard}
                                            onChange={(e) => updateHazard(h.id, 'hazard', e.target.value)}
                                            placeholder="e.g. Working at height, confined space entry, H₂S exposure..."
                                            className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-primary-500"
                                        />
                                    </div>

                                    {/* Risk Matrix Selectors */}
                                    <div className="grid grid-cols-[1fr_1fr_auto] sm:grid-cols-3 gap-2 sm:gap-3 items-end">
                                        <div className="min-w-0">
                                            <label className="text-[9px] sm:text-[10px] uppercase font-bold text-slate-500 mb-0.5 block">Consequence</label>
                                            <select
                                                value={h.consequence || 3}
                                                onChange={(e) => updateHazard(h.id, 'consequence', Number(e.target.value))}
                                                className="w-full px-2 py-1.5 border border-slate-300 rounded-md text-xs"
                                            >
                                                {CONSEQUENCE_LABELS.map((label, i) => (
                                                    <option key={i} value={i + 1}>{i + 1} — {label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-[9px] sm:text-[10px] uppercase font-bold text-slate-500 mb-0.5 block">Likelihood</label>
                                            <select
                                                value={h.likelihood || 3}
                                                onChange={(e) => updateHazard(h.id, 'likelihood', Number(e.target.value))}
                                                className="w-full px-2 py-1.5 border border-slate-300 rounded-md text-xs"
                                            >
                                                {LIKELIHOOD_LABELS.map((label, i) => (
                                                    <option key={i} value={i + 1}>{i + 1} — {label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-[9px] sm:text-[10px] uppercase font-bold text-slate-500 mb-0.5 block">Risk Score</label>
                                            <div className={`flex items-center gap-1.5 px-2.5 min-h-[36px] rounded-md border-2 font-bold text-sm whitespace-nowrap ${RISK_COLORS[level] || 'border-slate-300'}`}>
                                                <span>{score}</span>
                                                <span className="text-[10px] font-bold uppercase">{level}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Hierarchy of Controls (ISO 45001) */}
                                    <div>
                                        <label className="text-[10px] uppercase font-bold text-slate-500 mb-1.5 block">Hierarchy of Controls (ISO 45001)</label>
                                        <div className="flex flex-wrap gap-1.5">
                                            {CONTROL_HIERARCHY.map((ctrl, i) => {
                                                const active = (h.controlHierarchy || []).includes(ctrl);
                                                const colors = [
                                                    'bg-green-100 text-green-800 border-green-300',
                                                    'bg-primary-100 text-primary-800 border-primary-300',
                                                    'bg-blue-100 text-blue-800 border-blue-300',
                                                    'bg-blue-100 text-blue-800 border-blue-300',
                                                    'bg-orange-100 text-orange-800 border-orange-300',
                                                ];
                                                return (
                                                    <button
                                                        key={ctrl}
                                                        onClick={() => toggleControl(h.id, ctrl)}
                                                        className={`px-2 py-1 rounded-md text-[11px] font-bold border transition-all ${active ? colors[i] + ' shadow-sm ring-2 ring-offset-1 ring-current/20' : 'bg-slate-50 text-slate-400 border-slate-200 hover:border-slate-300'
                                                            }`}
                                                    >
                                                        {i + 1}. {ctrl}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        <p className="text-[10px] text-slate-400 mt-1">Most effective (1. Elimination) → Least effective (5. PPE)</p>
                                    </div>

                                    {/* Controls Description */}
                                    <div>
                                        <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Controls / Precautions</label>
                                        <textarea
                                            value={h.controls}
                                            onChange={(e) => updateHazard(h.id, 'controls', e.target.value)}
                                            placeholder="Describe the specific control measures, procedures, PPE requirements..."
                                            className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md text-sm h-16 resize-none focus:ring-2 focus:ring-primary-500"
                                        />
                                    </div>

                                    {/* Sign-off (mandatory for high risk) */}
                                    {score >= 15 && (
                                        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                                            <AlertTriangle size={16} className="text-red-600 flex-shrink-0 hidden sm:block" />
                                            <div className="flex-1">
                                                <p className="text-xs font-bold text-red-800 flex items-center gap-1.5"><AlertTriangle size={13} className="sm:hidden flex-shrink-0" /> High-Risk: Mandatory Sign-Off Required</p>
                                                <p className="text-[10px] text-red-600">This hazard requires engineering review and sign-off before WO generation.</p>
                                            </div>
                                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                                <input
                                                    type="text"
                                                    value={h.signoffBy || ''}
                                                    onChange={(e) => updateHazard(h.id, 'signoffBy', e.target.value)}
                                                    placeholder="Approved by..."
                                                    className="text-xs border border-red-300 rounded px-2 py-1.5 flex-1 sm:flex-initial sm:w-32"
                                                />
                                                {h.signoffBy ? (
                                                    <CheckCircle size={16} className="text-green-600" />
                                                ) : (
                                                    <AlertTriangle size={16} className="text-red-400" />
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <button
                                    onClick={() => deleteHazard(h.id)}
                                    className="text-slate-300 hover:text-red-500 p-1.5 rounded hover:bg-red-50 transition mt-1"
                                    title="Remove hazard"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>
                    );
                })}
                {(jsa.hazards || []).length === 0 && (
                    <div className="p-8 text-center border border-dashed border-slate-200 rounded-lg bg-slate-50">
                        <AlertTriangle size={32} className="mx-auto mb-3 text-slate-300" />
                        <p className="text-slate-400 text-sm">No hazards defined. Click "Add Hazard" to start building the JSA template.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

const LaborTab: React.FC<{ job: RecurringJob; onUpdate: (u: Partial<RecurringJob>) => void; contacts?: Contact[]; dictionaries?: any[] }> = ({ job, onUpdate, contacts = [], dictionaries = [] }) => {
    const labor = job.labor || [];
    const craftRoles = dictionaries.filter(d => d.type === 'CONTACT_TYPE' && d.active && !d.isManufacturer);

    const addLabor = () => {
        const defaultRate = craftRoles.find(r => r.code === 'TECHNICIAN')?.hourlyRate || 85;
        const newEntry: JobLabor = {
            id: `labor-${Date.now()}`,
            contactId: '',
            contactType: 'TECHNICIAN',
            estDuration: 1,
            estRate: defaultRate,
            isLead: labor.length === 0, // First entry is lead by default
        };
        onUpdate({ labor: [...labor, newEntry] });
    };

    const updateLabor = (id: string, field: string, value: any) => {
        let newLabor = labor.map(l => l.id === id ? { ...l, [field]: value } : l);
        // When changing role, auto-fill rate from dictionary
        if (field === 'contactType') {
            const roleDict = craftRoles.find(r => r.code === value);
            if (roleDict?.hourlyRate) {
                newLabor = newLabor.map(l => l.id === id ? { ...l, estRate: roleDict.hourlyRate } : l);
            }
        }
        // When toggling lead, ensure only one lead
        if (field === 'isLead' && value === true) {
            newLabor = newLabor.map(l => ({ ...l, isLead: l.id === id }));
        }
        onUpdate({ labor: newLabor });
    };

    const deleteLabor = (id: string) => {
        const remaining = labor.filter(l => l.id !== id);
        // If we deleted the lead, promote the first remaining
        if (remaining.length > 0 && !remaining.some(l => l.isLead)) {
            remaining[0].isLead = true;
        }
        onUpdate({ labor: remaining });
    };

    // Staffing summary
    const totalHours = labor.reduce((sum, l) => sum + (l.estDuration || 0), 0);
    const totalCost = labor.reduce((sum, l) => sum + ((l.estDuration || 0) * (l.estRate || 0)), 0);
    const leadCraft = labor.find(l => l.isLead);

    // Filter contacts by role for assignment
    const getContactsForRole = (roleCode: string) => {
        return contacts.filter(c =>
            c.types?.includes(roleCode) || c.defaultType === roleCode || roleCode === ''
        );
    };

    const craftOptionEls = craftRoles.length > 0
        ? craftRoles.map(d => <option key={d.code} value={d.code}>{d.description || d.code}</option>)
        : [
            <option key="TECH" value="TECHNICIAN">Technician</option>,
            <option key="ELEC" value="ELECTRICIAN">Electrician</option>,
            <option key="MECH" value="MECHANIC">Mechanic</option>,
            <option key="OPR" value="OPERATOR">Operator</option>,
            <option key="SUP" value="SUPERVISOR">Supervisor</option>,
            <option key="VEN" value="VENDOR">Vendor / Contractor</option>,
        ];
    const contactOptionEls = (roleContacts: Contact[]) => (roleContacts.length > 0 ? roleContacts : contacts).map(c => (
        <option key={c.id} value={c.id}>{c.name || `${(c as any).firstName || ''} ${(c as any).lastName || ''}`}</option>
    ));
    // 0369: a craft line can be pinned to one step of the template. With a single
    // step every line lands on it anyway; with several, "whole job" stays at
    // order level on the generated work order.
    const steps = job.tasks || [];
    const stepSelect = (l: JobLabor, cls: string) => steps.length > 1 ? (
        <select
            value={l.jobTaskId && steps.some(t => t.id === l.jobTaskId) ? l.jobTaskId : ''}
            onChange={(e) => updateLabor(l.id, 'jobTaskId', e.target.value || undefined)}
            className={cls}
            title="Which step this craft works on the generated order"
        >
            <option value="">Whole job</option>
            {steps.map((t, i) => <option key={t.id} value={t.id}>{i + 1}. {t.description || 'Untitled step'}</option>)}
        </select>
    ) : (
        <span className="text-xs text-slate-400" title={steps.length === 1 ? 'The only step — labour lands on it' : 'Add steps on the Tasks tab to pin crafts to them'}>
            {steps.length === 1 ? `Step 1` : '—'}
        </span>
    );

    return (
        <div className="space-y-4 animate-in fade-in duration-300">
            {/* Staffing Summary Card */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 sm:p-4">
                <div className="flex items-start sm:items-center justify-between gap-3">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:flex sm:gap-8 flex-1 min-w-0">
                        <div>
                            <p className="text-[9px] sm:text-[10px] uppercase font-bold text-blue-500">Total Hours</p>
                            <p className="text-lg sm:text-2xl font-black text-blue-700 leading-tight">{totalHours.toFixed(1)}<span className="text-xs sm:text-sm font-normal ml-1">hrs</span></p>
                        </div>
                        <div>
                            <p className="text-[9px] sm:text-[10px] uppercase font-bold text-blue-500">Est. Labour Cost</p>
                            <p className="text-lg sm:text-2xl font-black text-blue-700 leading-tight">${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                        </div>
                        <div>
                            <p className="text-[9px] sm:text-[10px] uppercase font-bold text-blue-500">Headcount</p>
                            <p className="text-lg sm:text-2xl font-black text-blue-700 leading-tight">{labor.length}</p>
                        </div>
                        <div className="min-w-0">
                            <p className="text-[9px] sm:text-[10px] uppercase font-bold text-blue-500">Lead Craft</p>
                            <p className="text-xs sm:text-sm font-bold text-blue-700 mt-0.5 sm:mt-1 truncate">
                                {leadCraft ? (craftRoles.find(r => r.code === leadCraft.contactType)?.description || leadCraft.contactType) : '—'}
                            </p>
                        </div>
                    </div>
                    <button onClick={addLabor} className="text-xs bg-primary-600 text-white px-2.5 sm:px-4 py-2 rounded-lg hover:bg-primary-500 flex items-center gap-1 font-bold shadow-sm flex-shrink-0" title="Add craft requirement">
                        <Plus size={14} /> <span className="hidden sm:inline">Add Craft Requirement</span><span className="sm:hidden">Add</span>
                    </button>
                </div>
            </div>

            {/* Phase 1: Craft Requirements Table */}
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="p-3 border-b border-slate-200 bg-slate-50">
                    <h3 className="font-bold text-slate-700 text-xs sm:text-sm flex items-center gap-2">
                        <Users size={16} className="text-blue-600" /> Phase 1: Craft Requirements (Planning)
                    </h3>
                    <p className="text-[10px] text-slate-500 mt-0.5">Define the roles and hours needed. Personnel are assigned in Phase 2.</p>
                </div>
                {/* Phones: stacked rows — nothing scrolls sideways; the table stays for sm+ */}
                <div className="ers-dense sm:hidden divide-y divide-slate-100">
                    {labor.map((l) => {
                        const roleContacts = getContactsForRole(l.contactType);
                        const assignedContact = contacts.find(c => c.id === l.contactId);
                        const isExternal = assignedContact?.types?.includes('VENDOR') || assignedContact?.types?.includes('CONTRACTOR') || l.contactType === 'VENDOR';
                        const lineTotal = (l.estDuration || 0) * (l.estRate || 0);
                        return (
                            <div key={l.id} className={`p-3 space-y-2 ${l.isLead ? 'bg-amber-50/40' : ''}`}>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => updateLabor(l.id, 'isLead', true)}
                                        title={l.isLead ? 'Lead Craft' : 'Set as Lead'}
                                        className={`p-1 rounded flex-shrink-0 ${l.isLead ? 'text-amber-500' : 'text-slate-300'}`}
                                    >
                                        <Star size={16} fill={l.isLead ? 'currentColor' : 'none'} />
                                    </button>
                                    <select
                                        value={l.contactType}
                                        onChange={(e) => updateLabor(l.id, 'contactType', e.target.value)}
                                        className="flex-1 min-w-0 text-sm border border-slate-200 rounded-md px-2 py-1.5 bg-white font-medium"
                                    >
                                        {craftOptionEls}
                                    </select>
                                    {isExternal ? (
                                        <span className="text-[9px] font-bold bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded uppercase shrink-0">EXT</span>
                                    ) : l.contactId ? (
                                        <span className="text-[9px] font-bold bg-green-100 text-green-700 px-1.5 py-0.5 rounded uppercase shrink-0">INT</span>
                                    ) : null}
                                    <button onClick={() => deleteLabor(l.id)} className="p-1.5 text-slate-300 hover:text-red-500 rounded flex-shrink-0" title="Remove">
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                                <select
                                    value={l.contactId || ''}
                                    onChange={(e) => updateLabor(l.id, 'contactId', e.target.value)}
                                    className={`w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 bg-white ${!l.contactId ? 'text-slate-400 italic' : ''}`}
                                >
                                    <option value="">— Unassigned (Planning) —</option>
                                    {contactOptionEls(roleContacts)}
                                </select>
                                {steps.length > 1 && stepSelect(l, 'w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-600')}
                                <div className="grid grid-cols-3 gap-2">
                                    <div>
                                        <label className="block text-[9px] font-bold text-slate-400 uppercase mb-0.5">Hours</label>
                                        <input type="number" value={l.estDuration} onChange={(e) => updateLabor(l.id, 'estDuration', parseFloat(e.target.value) || 0)} className="w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 text-right" min="0" step="0.5" />
                                    </div>
                                    <div>
                                        <label className="block text-[9px] font-bold text-slate-400 uppercase mb-0.5">Rate $/hr</label>
                                        <input type="number" value={l.estRate || 0} onChange={(e) => updateLabor(l.id, 'estRate', parseFloat(e.target.value) || 0)} className="w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 text-right" min="0" step="5" />
                                    </div>
                                    <div>
                                        <label className="block text-[9px] font-bold text-slate-400 uppercase mb-0.5">Line total</label>
                                        <div className="min-h-[36px] flex items-center justify-end text-sm font-semibold text-slate-700 tabular-nums px-1">${lineTotal.toFixed(2)}</div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    {labor.length === 0 && (
                        <div className="p-6 text-center text-slate-400">
                            <Users size={28} className="mx-auto mb-2 opacity-30" />
                            <p className="text-sm">No craft requirements defined.</p>
                            <p className="text-xs mt-1">Tap Add to plan the labour needed for this PM.</p>
                        </div>
                    )}
                    {labor.length > 0 && (
                        <div className="p-3 bg-slate-50 flex items-center justify-between text-xs">
                            <span className="font-bold text-slate-500 uppercase">Totals</span>
                            <span className="text-slate-700 tabular-nums">{totalHours.toFixed(1)} hrs · <span className="font-bold text-blue-700">${totalCost.toFixed(2)}</span></span>
                        </div>
                    )}
                </div>

                <div className="hidden sm:block overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-white">
                        <tr>
                            <th className="px-3 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase w-8">Lead</th>
                            <th className="px-3 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase">Craft / Role</th>
                            <th className="px-3 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase">Assigned To</th>
                            <th className="px-3 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase w-40">Step</th>
                            <th className="px-3 py-2.5 text-right text-[10px] font-bold text-slate-500 uppercase w-20">Hours</th>
                            <th className="px-3 py-2.5 text-right text-[10px] font-bold text-slate-500 uppercase w-24">Rate ($/hr)</th>
                            <th className="px-3 py-2.5 text-right text-[10px] font-bold text-slate-500 uppercase w-24">Line Total</th>
                            <th className="px-3 py-2.5 w-10"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {labor.map((l) => {
                            const roleContacts = getContactsForRole(l.contactType);
                            const assignedContact = contacts.find(c => c.id === l.contactId);
                            const isExternal = assignedContact?.types?.includes('VENDOR') || assignedContact?.types?.includes('CONTRACTOR') || l.contactType === 'VENDOR';
                            const lineTotal = (l.estDuration || 0) * (l.estRate || 0);

                            return (
                                <tr key={l.id} className="group hover:bg-slate-50">
                                    <td className="px-3 py-2">
                                        <button
                                            onClick={() => updateLabor(l.id, 'isLead', true)}
                                            title={l.isLead ? 'Lead Craft' : 'Set as Lead'}
                                            className={`p-1 rounded transition ${l.isLead ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'}`}
                                        >
                                            <Star size={16} fill={l.isLead ? 'currentColor' : 'none'} />
                                        </button>
                                    </td>
                                    <td className="px-3 py-2">
                                        <div className="flex items-center gap-2">
                                            <select
                                                value={l.contactType}
                                                onChange={(e) => updateLabor(l.id, 'contactType', e.target.value)}
                                                className="flex-1 text-sm border-slate-300 rounded p-1.5 bg-white font-medium"
                                            >
                                                {craftOptionEls}
                                            </select>
                                            {isExternal && (
                                                <span className="text-[9px] font-bold bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded uppercase shrink-0">EXT</span>
                                            )}
                                            {!isExternal && l.contactId && (
                                                <span className="text-[9px] font-bold bg-green-100 text-green-700 px-1.5 py-0.5 rounded uppercase shrink-0">INT</span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-3 py-2">
                                        <select
                                            value={l.contactId || ''}
                                            onChange={(e) => updateLabor(l.id, 'contactId', e.target.value)}
                                            className={`w-full text-sm border-slate-300 rounded p-1.5 bg-white ${!l.contactId ? 'text-slate-400 italic' : ''}`}
                                        >
                                            <option value="">— Unassigned (Planning) —</option>
                                            {contactOptionEls(roleContacts)}
                                        </select>
                                    </td>
                                    <td className="px-3 py-2">
                                        {stepSelect(l, 'w-full text-xs border-slate-300 rounded p-1.5 bg-white text-slate-600')}
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                        <input
                                            type="number"
                                            value={l.estDuration}
                                            onChange={(e) => updateLabor(l.id, 'estDuration', parseFloat(e.target.value) || 0)}
                                            className="w-16 text-sm bg-white border border-slate-200 rounded-lg p-1.5 text-right text-slate-700 focus:ring-2 focus:ring-primary-400 focus:border-primary-600 transition-colors"
                                            min="0" step="0.5"
                                        />
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                        <input
                                            type="number"
                                            value={l.estRate || 0}
                                            onChange={(e) => updateLabor(l.id, 'estRate', parseFloat(e.target.value) || 0)}
                                            className="w-20 text-sm bg-white border border-slate-200 rounded-lg p-1.5 text-right text-slate-700 focus:ring-2 focus:ring-primary-400 focus:border-primary-600 transition-colors"
                                            min="0" step="5"
                                        />
                                    </td>
                                    <td className="px-3 py-2 text-right text-sm font-medium text-slate-700">
                                        ${lineTotal.toFixed(2)}
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                        <button
                                            onClick={() => deleteLabor(l.id)}
                                            className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition p-1"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                        {labor.length === 0 && (
                            <tr>
                                <td colSpan={7} className="p-8 text-center text-slate-400">
                                    <Users size={32} className="mx-auto mb-2 opacity-30" />
                                    <p className="text-sm">No craft requirements defined.</p>
                                    <p className="text-xs mt-1">Click "Add Craft Requirement" to plan the labor needed for this PM.</p>
                                </td>
                            </tr>
                        )}
                    </tbody>
                    {labor.length > 0 && (
                        <tfoot className="bg-slate-50 border-t border-slate-200">
                            <tr>
                                <td colSpan={4} className="px-3 py-2 text-right text-xs font-bold text-slate-500 uppercase">Totals</td>
                                <td className="px-3 py-2 text-right text-sm font-bold text-slate-700">{totalHours.toFixed(1)}</td>
                                <td className="px-3 py-2 text-right text-xs text-slate-400">—</td>
                                <td className="px-3 py-2 text-right text-sm font-bold text-blue-700">${totalCost.toFixed(2)}</td>
                                <td></td>
                            </tr>
                        </tfoot>
                    )}
                </table>
                </div>
            </div>

            {/* Skill Gap Warning */}
            {labor.some(l => !l.contactId) && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 text-xs text-amber-800">
                    <AlertTriangle size={14} />
                    <span><strong>{labor.filter(l => !l.contactId).length} role(s)</strong> have no assigned personnel. Work orders will generate with unassigned labor lines for scheduling.</span>
                </div>
            )}
        </div>
    );
};

const InventoryTab: React.FC<{ job: RecurringJob; onUpdate: (u: Partial<RecurringJob>) => void; inventoryItems?: any[]; dictionaries?: any[] }> = ({ job, onUpdate, inventoryItems = [], dictionaries = [] }) => {
    const inventory = job.inventory || [];

    const addItem = () => {
        const newItem: JobInventory = {
            id: `inv-${Date.now()}`,
            inventoryId: '',
            description: '',
            uom: 'EA',
            estQty: 1,
            estUnitCost: 0,
        };
        onUpdate({ inventory: [...inventory, newItem] });
    };

    const updateItem = (id: string, field: string, value: any) => {
        const newInv = inventory.map(item => item.id === id ? { ...item, [field]: value } : item);
        onUpdate({ inventory: newInv });
    };

    const deleteItem = (id: string) => {
        onUpdate({ inventory: inventory.filter(item => item.id !== id) });
    };

    // Build SearchableDropdown options from inventory items
    const partOptions = inventoryItems.map((inv: any) => ({
        code: inv.id,
        description: `${inv.code ? `[${inv.code}] ` : ''}${inv.description || inv.name}`,
    }));

    // Choosing a catalogue part fills description / UOM / unit cost from the item.
    // Shared by the phone rows and the table. DatabaseService.getInventory maps
    // unit_cost → itemCost; the older unitCost/unit_cost names are kept as fallbacks.
    const pickPart = (itemId: string, code: string) => {
        const selected = inventoryItems.find((inv: any) => inv.id === code);
        const updates = inventory.map(i => i.id === itemId ? {
            ...i,
            inventoryId: code,
            description: selected?.description || selected?.name || '',
            uom: selected?.uom || 'EA',
            estUnitCost: Number(selected?.itemCost ?? selected?.unitCost ?? selected?.unit_cost) || 0,
        } : i);
        onUpdate({ inventory: updates });
    };
    const uomDict = dictionaries.filter(d => d.type === 'UOM' && d.active);
    const uomOptionEls = uomDict.length > 0
        ? uomDict.map(d => <option key={d.code} value={d.code}>{d.code}</option>)
        : [
            <option key="EA" value="EA">EA</option>,
            <option key="L" value="L">L</option>,
            <option key="KG" value="KG">KG</option>,
            <option key="M" value="M">M</option>,
            <option key="SET" value="SET">SET</option>,
            <option key="BOX" value="BOX">BOX</option>,
        ];

    // Cost summary
    const totalMaterialCost = inventory.reduce((sum, item) => sum + ((item.estQty || 0) * (item.estUnitCost || 0)), 0);
    const criticalCount = inventory.filter((item: any) => item.isCritical).length;

    return (
        <div className="space-y-4 animate-in fade-in duration-300">
            {/* Material Cost Summary */}
            {inventory.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-lg p-3 sm:p-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-4 sm:gap-6 min-w-0">
                        <div>
                            <p className="text-[9px] sm:text-xs text-slate-500 uppercase font-bold">Items Planned</p>
                            <p className="text-base sm:text-xl font-black text-slate-800">{inventory.length}</p>
                        </div>
                        <div className="h-8 w-px bg-slate-200" />
                        <div>
                            <p className="text-[9px] sm:text-xs text-slate-500 uppercase font-bold">Est. Material Cost</p>
                            <p className="text-base sm:text-xl font-black text-blue-600">${totalMaterialCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        </div>
                        {criticalCount > 0 && (
                            <>
                                <div className="h-8 w-px bg-slate-200" />
                                <div>
                                    <p className="text-[9px] sm:text-xs text-slate-500 uppercase font-bold">Critical Spares</p>
                                    <p className="text-base sm:text-xl font-black text-red-600 flex items-center gap-1">
                                        <AlertTriangle size={16} /> {criticalCount}
                                    </p>
                                </div>
                            </>
                        )}
                    </div>
                    <button onClick={addItem} className="text-xs bg-primary-600 text-white px-3 py-1.5 rounded hover:bg-primary-500 flex items-center gap-1 shadow-sm flex-shrink-0">
                        <Plus size={14} /> Add Item
                    </button>
                </div>
            )}

            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                {inventory.length === 0 && (
                    <div className="p-3 sm:p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center gap-3">
                        <h3 className="font-bold text-slate-700 text-sm">Required Spare Parts & Material</h3>
                        <button onClick={addItem} className="text-xs bg-primary-600 text-white px-3 py-1.5 rounded hover:bg-primary-500 flex items-center gap-1">
                            <Plus size={14} /> Add Item
                        </button>
                    </div>
                )}
                {/* Phones: stacked rows — nothing scrolls sideways; the table stays for sm+ */}
                <div className="ers-dense sm:hidden divide-y divide-slate-100">
                    {inventory.map((item) => {
                        const sourceItem = inventoryItems.find((inv: any) => inv.id === item.inventoryId);
                        const stockOnHand = sourceItem?.totalQtyOnHand ?? sourceItem?.quantity ?? null;
                        const lineTotal = (item.estQty || 0) * (item.estUnitCost || 0);
                        return (
                            <div key={item.id} className="p-3 space-y-2">
                                <div className="flex items-start gap-2">
                                    <div className="flex-1 min-w-0">
                                        {inventoryItems.length > 0 ? (
                                            <>
                                                <SearchableDropdown
                                                    options={partOptions}
                                                    value={item.inventoryId || undefined}
                                                    onChange={(code) => pickPart(item.id, code)}
                                                    placeholder="Search parts..."
                                                />
                                                {item.inventoryId && stockOnHand !== null && (
                                                    <span className={`inline-flex items-center gap-1 mt-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${stockOnHand <= 0 ? 'bg-red-100 text-red-700' : stockOnHand <= 5 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                                                        <Package size={10} /> {stockOnHand} on hand
                                                    </span>
                                                )}
                                            </>
                                        ) : (
                                            <input
                                                type="text"
                                                value={item.description}
                                                onChange={(e) => updateItem(item.id, 'description', e.target.value)}
                                                placeholder="Part description..."
                                                className="w-full text-sm border border-slate-200 rounded-md px-2 py-1.5"
                                            />
                                        )}
                                    </div>
                                    <button onClick={() => deleteItem(item.id)} className="p-1.5 text-slate-300 hover:text-red-500 rounded flex-shrink-0" title="Remove">
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                                <div className="grid grid-cols-4 gap-2">
                                    <div>
                                        <label className="block text-[9px] font-bold text-slate-400 uppercase mb-0.5">UOM</label>
                                        <select value={item.uom} onChange={(e) => updateItem(item.id, 'uom', e.target.value)} className="w-full text-sm border border-slate-200 rounded-md px-1.5 py-1.5 bg-white">
                                            {uomOptionEls}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[9px] font-bold text-slate-400 uppercase mb-0.5">Qty</label>
                                        <input type="number" value={item.estQty} onChange={(e) => updateItem(item.id, 'estQty', parseFloat(e.target.value) || 0)} className="w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 text-right" min="0" step="1" />
                                    </div>
                                    <div>
                                        <label className="block text-[9px] font-bold text-slate-400 uppercase mb-0.5">Unit cost</label>
                                        <input type="number" value={item.estUnitCost || 0} onChange={(e) => updateItem(item.id, 'estUnitCost', parseFloat(e.target.value) || 0)} className="w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 text-right" min="0" step="0.01" />
                                    </div>
                                    <div>
                                        <label className="block text-[9px] font-bold text-slate-400 uppercase mb-0.5">Total</label>
                                        <div className="min-h-[36px] flex items-center justify-end text-sm font-semibold text-slate-700 tabular-nums px-1">${lineTotal.toFixed(2)}</div>
                                    </div>
                                </div>
                                <label className="flex items-center gap-2 text-[11px] text-slate-600">
                                    <input
                                        type="checkbox"
                                        checked={(item as any).isCritical || false}
                                        onChange={(e) => updateItem(item.id, 'isCritical', e.target.checked)}
                                        className="rounded border-slate-300 text-red-600 focus:ring-red-500"
                                    />
                                    Critical spare — stop work if missing
                                </label>
                            </div>
                        );
                    })}
                    {inventory.length === 0 && (
                        <div className="p-6 text-center text-slate-400">
                            <Package size={28} className="mx-auto mb-2 opacity-20" />
                            <p className="text-sm">No inventory requirements defined.</p>
                            <p className="text-xs mt-1">Tap Add Item to plan spare parts and materials for this PM.</p>
                        </div>
                    )}
                </div>

                <div className="hidden sm:block overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-white">
                        <tr>
                            <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Part / Description</th>
                            <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase w-24">UOM</th>
                            <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase w-24">Est Qty</th>
                            <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase w-28">Est Unit Cost</th>
                            <th className="px-4 py-3 text-center text-xs font-bold text-slate-500 uppercase w-20">Critical</th>
                            <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase w-24">Line Total</th>
                            <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase w-16"></th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-200">
                        {inventory.map((item) => {
                            const sourceItem = inventoryItems.find((inv: any) => inv.id === item.inventoryId);
                            const stockOnHand = sourceItem?.totalQtyOnHand ?? sourceItem?.quantity ?? null;
                            const lineTotal = (item.estQty || 0) * (item.estUnitCost || 0);

                            return (
                                <tr key={item.id} className="group hover:bg-slate-50">
                                    <td className="px-4 py-3">
                                        {inventoryItems.length > 0 ? (
                                            <div>
                                                <SearchableDropdown
                                                    options={partOptions}
                                                    value={item.inventoryId || undefined}
                                                    onChange={(code) => pickPart(item.id, code)}
                                                    placeholder="Search parts..."
                                                />
                                                {item.inventoryId && stockOnHand !== null && (
                                                    <span className={`inline-flex items-center gap-1 mt-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${stockOnHand <= 0 ? 'bg-red-100 text-red-700' : stockOnHand <= 5 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
                                                        }`}>
                                                        <Package size={10} /> {stockOnHand} on hand
                                                    </span>
                                                )}
                                            </div>
                                        ) : (
                                            <input
                                                type="text"
                                                value={item.description}
                                                onChange={(e) => updateItem(item.id, 'description', e.target.value)}
                                                placeholder="Part description..."
                                                className="w-full text-sm border-slate-300 rounded p-1.5"
                                            />
                                        )}
                                    </td>
                                    <td className="px-4 py-3">
                                        <select
                                            value={item.uom}
                                            onChange={(e) => updateItem(item.id, 'uom', e.target.value)}
                                            className="w-full text-sm border-slate-300 rounded p-1.5 bg-white"
                                        >
                                            {uomOptionEls}
                                        </select>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <input
                                            type="number"
                                            value={item.estQty}
                                            onChange={(e) => updateItem(item.id, 'estQty', parseFloat(e.target.value) || 0)}
                                            className="w-20 text-sm border-slate-300 rounded p-1.5 text-right"
                                            min="0" step="1"
                                        />
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <input
                                            type="number"
                                            value={item.estUnitCost || 0}
                                            onChange={(e) => updateItem(item.id, 'estUnitCost', parseFloat(e.target.value) || 0)}
                                            className="w-24 text-sm border-slate-300 rounded p-1.5 text-right"
                                            min="0" step="0.01"
                                        />
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <input
                                            type="checkbox"
                                            checked={(item as any).isCritical || false}
                                            onChange={(e) => updateItem(item.id, 'isCritical', e.target.checked)}
                                            className="rounded border-slate-300 text-red-600 focus:ring-red-500"
                                            title="Critical Spare — Stop Work if missing"
                                        />
                                    </td>
                                    <td className="px-4 py-3 text-right text-sm font-medium text-slate-700">
                                        ${lineTotal.toFixed(2)}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <button
                                            onClick={() => deleteItem(item.id)}
                                            className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition p-1"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                        {inventory.length === 0 && (
                            <tr>
                                <td colSpan={7} className="p-8 text-center text-slate-400">
                                    <Package size={32} className="mx-auto mb-2 opacity-20" />
                                    <p>No inventory requirements defined.</p>
                                    <p className="text-xs mt-1">Click "Add Item" to plan spare parts and materials for this PM.</p>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
                </div>
            </div>
        </div>
    );
};

const FilesTab: React.FC<{ job: RecurringJob; onUpdate: (u: Partial<RecurringJob>) => void }> = ({ job, onUpdate }) => {
    const files = job.files || [];
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    const FILE_CATEGORIES = ['SOP', 'P&ID', 'Datasheet', 'Drawing', 'Photo', 'Checklist', 'Other'] as const;

    const getFileIcon = (name: string) => {
        const ext = name.split('.').pop()?.toLowerCase() || '';
        if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(ext)) return '🖼️';
        if (['pdf'].includes(ext)) return '📄';
        if (['doc', 'docx'].includes(ext)) return '📝';
        if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
        if (['mp4', 'mov', 'avi'].includes(ext)) return '🎬';
        if (['dwg', 'dxf'].includes(ext)) return '📐';
        return '📎';
    };

    const handleFileAttach = (event: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFiles = event.target.files;
        if (!selectedFiles) return;

        const newFiles: JobFile[] = Array.from(selectedFiles as FileList).map((f: File) => ({
            id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: f.name,
            description: '',
            type: 'Other',
            url: URL.createObjectURL(f),
            uploadedBy: 'current-user',
            uploadedAt: new Date().toISOString(),
        }));

        onUpdate({ files: [...files, ...newFiles] });
        // Reset input so same file can be re-attached
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const updateFile = (id: string, field: string, value: string) => {
        onUpdate({ files: files.map(f => f.id === id ? { ...f, [field]: value } : f) });
    };

    const removeFile = (id: string) => {
        onUpdate({ files: files.filter(f => f.id !== id) });
    };

    return (
        <div className="space-y-4 animate-in fade-in duration-300">
            {/* Photo Evidence */}
            <div className="bg-white p-4 sm:p-6 rounded-lg border border-slate-200 shadow-sm">
                <ImageGallery
                    entityId={job.id}
                    entityType="RECURRING_JOB"
                    bucket="assets"
                    prefix="pm_"
                />
            </div>

            <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileAttach}
            />

            {/* Summary bar */}
            <div className="bg-white border border-slate-200 rounded-lg p-4 flex justify-between items-center">
                <div className="flex items-center gap-4">
                    <h3 className="font-bold text-slate-700">Attached Documents & Files</h3>
                    {files.length > 0 && (
                        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">
                            {files.length} file{files.length !== 1 ? 's' : ''}
                        </span>
                    )}
                </div>
                <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs bg-primary-600 text-white px-3 py-1.5 rounded hover:bg-primary-500 flex items-center gap-1 shadow-sm"
                >
                    <Plus size={14} /> Attach File
                </button>
            </div>

            {/* File cards */}
            {files.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {files.map((f) => (
                        <div key={f.id} className="bg-white border border-slate-200 rounded-lg p-4 hover:shadow-sm transition group">
                            <div className="flex items-start gap-3">
                                <div className="text-2xl flex-shrink-0 mt-0.5">{getFileIcon(f.name)}</div>
                                <div className="flex-1 min-w-0 space-y-2">
                                    <div className="flex items-start justify-between gap-2">
                                        <div>
                                            <p className="font-bold text-sm text-slate-800 truncate">{f.name}</p>
                                            <p className="text-[10px] text-slate-400 mt-0.5">
                                                Attached {new Date(f.uploadedAt).toLocaleDateString()}
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => removeFile(f.id)}
                                            className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition p-1 flex-shrink-0"
                                            title="Remove file"
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                    <div className="flex gap-2">
                                        <select
                                            value={f.type || 'Other'}
                                            onChange={(e) => updateFile(f.id, 'type', e.target.value)}
                                            className="text-xs border border-slate-200 rounded px-2 py-1 bg-white w-28"
                                        >
                                            {FILE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                        <input
                                            type="text"
                                            value={f.description || ''}
                                            onChange={(e) => updateFile(f.id, 'description', e.target.value)}
                                            placeholder="Description..."
                                            className="text-xs border border-slate-200 rounded px-2 py-1 flex-1"
                                        />
                                    </div>
                                    {f.url && (
                                        <button type="button" onClick={() => void openStorageRef(f.url)} className="text-[10px] text-blue-600 hover:underline inline-flex items-center gap-1">
                                            <FileText size={10} /> Open / Download
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="bg-white border border-slate-200 rounded-lg p-12 text-center">
                    <FileText size={40} className="mx-auto mb-3 text-slate-200" />
                    <p className="text-slate-400 text-sm">No files attached to this PM strategy.</p>
                    <p className="text-slate-400 text-xs mt-1">Attach SOPs, P&IDs, data sheets, or inspection checklists.</p>
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="mt-3 text-xs text-blue-600 hover:text-blue-700 font-medium"
                    >
                        + Attach your first file
                    </button>
                </div>
            )}
        </div>
    );
};

// ─────────────────────────────────────────────────────────────
// Phase 4B — History / Audit Tab
// ─────────────────────────────────────────────────────────────
const HistoryTab: React.FC<{ job: RecurringJob; jobs?: RecurringJob[]; onUpdate?: (u: Partial<RecurringJob>) => void }> = ({ job, onUpdate }) => {
    type Entry = { id: string; date: string; event: string; user: string; details: string; type: 'generation' | 'edit' | 'status' | 'compliance' };
    // 0365: the audit trail is the schedule's real work orders. It used to be
    // invented from the row ("PM Strategy Created by Admin, 90 days ago",
    // "Completed — On-Time") — an audit trail cannot carry events that never happened.
    const [orders, setOrders] = useState<any[]>([]);
    const [satisfiedBy, setSatisfiedBy] = useState<any[]>([]);
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const cols = 'id, wo_number, title, status, created_at, updated_at, created_by, due_date, completed_at, completed_by, closed_at, properties';
                const [own, nested] = await Promise.all([
                    supabase.from('work_orders').select(cols).eq('recurring_work_id', job.id).order('created_at', { ascending: false }).limit(200),
                    // 0366: longer-interval orders that satisfied this schedule's occurrences
                    supabase.from('work_orders').select(cols).contains('properties', { included_pm_ids: [job.id] }).order('created_at', { ascending: false }).limit(200),
                ]);
                if (!alive) return;
                setOrders(own.data || []);
                setSatisfiedBy(nested.data || []);
            } catch { if (alive) { setOrders([]); setSatisfiedBy([]); } }
        })();
        return () => { alive = false; };
    }, [job.id]);

    const history = useMemo(() => {
        const entries: Entry[] = [];
        for (const w of orders) {
            const num = w.wo_number ? `WO-${w.wo_number}` : String(w.id);
            entries.push({
                id: `gen-${w.id}`, date: w.created_at, event: 'Work order generated',
                user: w.created_by ? 'Generator' : 'Autopilot',
                details: `${num}${w.due_date ? ` — due ${toDateOnly(String(w.due_date))}` : ''}`,
                type: 'generation',
            });
            const st = String(w.status || '').toUpperCase();
            const doneAt = w.completed_at || w.closed_at;
            if (['COMP', 'TECO', 'CLOSED'].includes(st) && doneAt) {
                const late = !!w.due_date && toDateOnly(String(doneAt)) > toDateOnly(String(w.due_date));
                entries.push({
                    id: `done-${w.id}`, date: doneAt, event: 'Work order completed',
                    user: w.completed_by ? 'Technician' : 'System',
                    details: `${num} — ${late ? 'after the due date' : 'on time'}`,
                    type: 'compliance',
                });
            } else if (st === 'CANCELLED') {
                entries.push({ id: `canc-${w.id}`, date: w.updated_at || w.created_at, event: 'Work order cancelled', user: 'System', details: num, type: 'status' });
            }
        }
        for (const w of satisfiedBy) {
            const num = w.wo_number ? `WO-${w.wo_number}` : String(w.id);
            const scope = (w.properties?.included_scopes || []).find((x: any) => x?.pmId === job.id);
            const mode = String(scope?.mode || 'SUPERSEDES').toLowerCase();
            entries.push({
                id: `nest-${w.id}`, date: w.created_at, event: 'Occurrence satisfied by a longer-interval order',
                user: w.created_by ? 'Generator' : 'Autopilot',
                details: `${num}${scope?.dueDate ? ` — this task was due ${scope.dueDate}` : ''} (${mode})`,
                type: 'generation',
            });
            const st = String(w.status || '').toUpperCase();
            const doneAt = w.completed_at || w.closed_at;
            if (['COMP', 'TECO', 'CLOSED'].includes(st) && doneAt) {
                const late = !!scope?.dueDate && toDateOnly(String(doneAt)) > String(scope.dueDate);
                entries.push({
                    id: `nest-done-${w.id}`, date: doneAt, event: 'Nested occurrence completed',
                    user: w.completed_by ? 'Technician' : 'System',
                    details: `${num} — ${late ? 'after this task\'s due date' : 'on time'}`,
                    type: 'compliance',
                });
            }
        }
        if (job.createdAt) {
            entries.push({
                id: 'created', date: job.createdAt, event: 'PM strategy created',
                user: job.createdById && job.createdById !== 'system' ? 'Planner' : 'System',
                details: `${job.code} — ${job.jobDescription || job.description}. Cadence: ${job.frequencyInterval} ${job.frequencyUnit}.`,
                type: 'edit',
            });
        }
        return entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [orders, satisfiedBy, job]);

    const typeColors: Record<string, string> = {
        generation: 'bg-blue-100 text-blue-700',
        edit: 'bg-slate-100 text-slate-700',
        status: 'bg-blue-100 text-blue-700',
        compliance: 'bg-green-100 text-green-700',
    };

    // Compliance stats
    const totalGenerated = history.filter(h => h.type === 'generation').length;
    const totalCompleted = history.filter(h => h.type === 'compliance').length;
    const complianceRate = totalGenerated > 0 ? Math.round((totalCompleted / totalGenerated) * 100) : 0;

    // ISO 55000 on-time compliance. job.complianceData is never written back after an
    // order completes, so the strip read "Never" beside a closed order. Derive it from
    // the schedule's real work orders loaded above (own orders by due_date; longer-interval
    // orders that satisfied an occurrence by that occurrence's due date, 0366) and fall
    // back to complianceData only when the schedule has no orders at all. The colour
    // thresholds still live in complianceData.
    const stored = job.complianceData || { scheduledCount: 0, executedCount: 0, compliancePct: 0 };
    const derived = useMemo(() => {
        const DONE = ['COMP', 'TECO', 'CLOSED'];
        const completions: { doneAt: string; due: string | null; num: string }[] = [];
        for (const w of orders) {
            const doneAt = w.completed_at || w.closed_at;
            if (!DONE.includes(String(w.status || '').toUpperCase()) || !doneAt) continue;
            completions.push({ doneAt: String(doneAt), due: w.due_date ? toDateOnly(String(w.due_date)) : null, num: w.wo_number ? `WO-${w.wo_number}` : String(w.id) });
        }
        for (const w of satisfiedBy) {
            const doneAt = w.completed_at || w.closed_at;
            if (!DONE.includes(String(w.status || '').toUpperCase()) || !doneAt) continue;
            const scope = (w.properties?.included_scopes || []).find((x: any) => x?.pmId === job.id);
            completions.push({ doneAt: String(doneAt), due: scope?.dueDate ? String(scope.dueDate) : null, num: w.wo_number ? `WO-${w.wo_number}` : String(w.id) });
        }
        completions.sort((a, b) => new Date(b.doneAt).getTime() - new Date(a.doneAt).getTime());
        const last = completions[0] || null;
        const since = Date.now() - 365 * 24 * 60 * 60 * 1000;
        const window = completions.filter(c => new Date(c.doneAt).getTime() >= since);
        const onTime = window.filter(c => !c.due || toDateOnly(c.doneAt) <= c.due).length;
        return {
            hasOrders: orders.length > 0 || satisfiedBy.length > 0,
            lastCompletedDate: last?.doneAt || null,
            lastWOId: last?.num || null,
            scheduledCount: window.length,
            executedCount: onTime,
            compliancePct: window.length > 0 ? (onTime / window.length) * 100 : 0,
        };
    }, [orders, satisfiedBy, job.id]);
    const compliance = derived.hasOrders
        ? derived
        : { ...derived, lastCompletedDate: stored.lastCompletedDate || null, lastWOId: stored.lastWOId || null, scheduledCount: stored.scheduledCount || 0, executedCount: stored.executedCount || 0, compliancePct: stored.compliancePct || 0 };
    const greenThreshold = stored.greenThreshold ?? 95;
    const yellowThreshold = stored.yellowThreshold ?? 85;
    const complianceTone = compliance.compliancePct >= greenThreshold ? 'text-green-600' : compliance.compliancePct >= yellowThreshold ? 'text-amber-500' : 'text-red-600';
    const setThreshold = (key: 'greenThreshold' | 'yellowThreshold', raw: string) => {
        if (!onUpdate) return;
        const val = Math.min(100, Math.max(0, parseInt(raw) || 0));
        onUpdate({ complianceData: { ...stored, [key]: val } });
    };

    return (
        <div className="space-y-4 sm:space-y-6 animate-in fade-in duration-300">
            {/* Compliance strip (ISO 55000) */}
            <div className="ers-dense bg-white border border-slate-200 rounded-lg p-3 sm:p-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
                    <div>
                        <p className="text-[9px] sm:text-[10px] text-slate-400 uppercase font-bold">On time · 12 months</p>
                        <p className={`text-lg sm:text-2xl font-black leading-tight ${compliance.scheduledCount > 0 ? complianceTone : 'text-slate-300'}`}>
                            {compliance.scheduledCount > 0 ? `${Math.round(compliance.compliancePct)}%` : '—'}
                        </p>
                        <p className="text-[10px] text-slate-400">{compliance.scheduledCount > 0 ? `${compliance.executedCount}/${compliance.scheduledCount} on time` : 'No history yet'}</p>
                    </div>
                    <div>
                        <p className="text-[9px] sm:text-[10px] text-slate-400 uppercase font-bold">Last completed</p>
                        <p className="text-sm font-semibold text-slate-800 mt-1">{compliance.lastCompletedDate ? fmtLocalDate(compliance.lastCompletedDate) : 'Never'}</p>
                        {compliance.lastWOId && <p className="text-[10px] text-blue-600">{compliance.lastWOId}</p>}
                    </div>
                    <div>
                        <p className="text-[9px] sm:text-[10px] text-slate-400 uppercase font-bold">WOs generated</p>
                        <p className="text-lg sm:text-2xl font-black text-blue-600 leading-tight">{totalGenerated}</p>
                    </div>
                    <div>
                        <p className="text-[9px] sm:text-[10px] text-slate-400 uppercase font-bold">Completed</p>
                        <p className="text-lg sm:text-2xl font-black text-green-600 leading-tight">{totalCompleted}</p>
                        <p className="text-[10px] text-slate-400">{totalGenerated > 0 ? `${complianceRate}% of generated` : '—'}</p>
                    </div>
                </div>
                <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px] text-slate-500">
                    <span className="font-bold uppercase text-slate-400">Targets</span>
                    <label className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> ≥
                        <input type="number" min={0} max={100} value={greenThreshold} disabled={!onUpdate} onChange={e => setThreshold('greenThreshold', e.target.value)} className="w-12 text-xs px-1 py-0.5 border border-slate-200 rounded text-center" />%
                    </label>
                    <label className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> ≥
                        <input type="number" min={0} max={100} value={yellowThreshold} disabled={!onUpdate} onChange={e => setThreshold('yellowThreshold', e.target.value)} className="w-12 text-xs px-1 py-0.5 border border-slate-200 rounded text-center" />%
                    </label>
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> below {yellowThreshold}%</span>
                    <span className="hidden sm:inline ml-auto text-slate-400">Oil &amp; Gas benchmark ≥ 90%</span>
                </div>
            </div>

            {/* Audit Trail */}
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="p-3 bg-slate-50 border-b border-slate-200 font-bold text-slate-700 text-sm flex items-center gap-2">
                    <History size={14} />
                    Audit Trail ({history.length} entries)
                </div>
                <div className="divide-y divide-slate-100">
                    {history.map(entry => (
                        <div key={entry.id} className="px-4 py-3 hover:bg-slate-50 transition">
                            <div className="flex items-start gap-3">
                                <div className="text-[10px] text-slate-400 font-mono w-20 flex-shrink-0 pt-0.5">
                                    {new Date(entry.date).toLocaleDateString()}
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${typeColors[entry.type]}`}>
                                            {entry.type}
                                        </span>
                                        <span className="text-sm font-bold text-slate-800">{entry.event}</span>
                                    </div>
                                    <p className="text-xs text-slate-500">{entry.details}</p>
                                    <p className="text-[10px] text-slate-400 mt-0.5">By: {entry.user}</p>
                                </div>
                            </div>
                        </div>
                    ))}
                    {history.length === 0 && (
                        <div className="p-8 text-center text-slate-400 text-sm">
                            <History size={32} className="mx-auto mb-2 opacity-20" />
                            <p>No history entries yet.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────
// Phase 5B — PM Calendar Dashboard Widget
// ─────────────────────────────────────────────────────────────
const PMCalendarWidget: React.FC<{
    jobs: RecurringJob[];
    calendarDate: Date;
    onDateChange: (d: Date) => void;
}> = ({ jobs, calendarDate, onDateChange }) => {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthName = calendarDate.toLocaleString('default', { month: 'long' });

    // Build due-date map for the month
    const dueDateMap = useMemo(() => {
        const map: Record<number, { count: number; criticalities: string[] }> = {};
        jobs.forEach(job => {
            if (job.status !== 'ACTIVE') return;
            job.assignedAssets.forEach(ra => {
                const asset = MOCK_ASSETS.find(a => a.id === ra.assetId);
                if (ra.lastCompletedDate && job.scheduleType === 'TIME') {
                    const nextDue = new Date(ra.lastCompletedDate);
                    // Advance by frequency interval
                    if (job.frequencyUnit === 'Days') nextDue.setDate(nextDue.getDate() + job.frequencyInterval);
                    else if (job.frequencyUnit === 'Weeks') nextDue.setDate(nextDue.getDate() + job.frequencyInterval * 7);
                    else if (job.frequencyUnit === 'Months') nextDue.setMonth(nextDue.getMonth() + job.frequencyInterval);
                    else if (job.frequencyUnit === 'Years') nextDue.setFullYear(nextDue.getFullYear() + job.frequencyInterval);

                    if (nextDue.getFullYear() === year && nextDue.getMonth() === month) {
                        const day = nextDue.getDate();
                        if (!map[day]) map[day] = { count: 0, criticalities: [] };
                        map[day].count++;
                        if (asset?.criticality) map[day].criticalities.push(asset.criticality);
                    }
                }
            });
        });
        return map;
    }, [jobs, year, month]);

    const prevMonth = () => onDateChange(new Date(year, month - 1, 1));
    const nextMonth = () => onDateChange(new Date(year, month + 1, 1));

    const getCritColor = (crits: string[]) => {
        if (crits.includes('A')) return 'bg-red-500';
        if (crits.includes('B')) return 'bg-amber-500';
        return 'bg-green-500';
    };

    return (
        <div className="mt-2 bg-white border border-slate-200 rounded-lg p-3">
            {/* Month Navigation */}
            <div className="flex items-center justify-between mb-2">
                <button onClick={prevMonth} className="text-slate-400 hover:text-slate-600 p-1">
                    <ChevronDown size={12} className="rotate-90" />
                </button>
                <span className="text-xs font-bold text-slate-700">{monthName} {year}</span>
                <button onClick={nextMonth} className="text-slate-400 hover:text-slate-600 p-1">
                    <ChevronUp size={12} className="rotate-90" />
                </button>
            </div>
            {/* Day Headers */}
            <div className="grid grid-cols-7 gap-0.5 text-center mb-1">
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                    <div key={i} className="text-[9px] font-bold text-slate-400">{d}</div>
                ))}
            </div>
            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-0.5">
                {Array.from({ length: firstDay }).map((_, i) => (
                    <div key={`empty-${i}`} className="h-6" />
                ))}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                    const day = i + 1;
                    const due = dueDateMap[day];
                    const isToday = new Date().getDate() === day && new Date().getMonth() === month && new Date().getFullYear() === year;
                    return (
                        <div
                            key={day}
                            className={`h-6 flex items-center justify-center text-[10px] rounded relative cursor-default ${isToday ? 'ring-1 ring-blue-500 font-bold text-blue-700' : 'text-slate-600'
                                } ${due ? 'font-bold' : ''}`}
                            title={due ? `${due.count} PM(s) due` : ''}
                        >
                            {day}
                            {due && (
                                <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${getCritColor(due.criticalities)}`} />
                            )}
                        </div>
                    );
                })}
            </div>
            {/* Legend */}
            <div className="flex gap-3 mt-2 text-[9px] text-slate-400">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> Crit A</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> Crit B</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Crit C</span>
            </div>
        </div>
    );
};
