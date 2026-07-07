
import React, { useState, useMemo, useEffect } from 'react';
import {
    Calendar as CalendarIcon, List, BarChart2, ChevronLeft, ChevronRight,
    Filter, Search, Clock, AlertTriangle, CheckCircle, User, GripVertical,
    Layers, Zap, CalendarRange, Briefcase, Lock, UserPlus, ArrowRight,
    Repeat, Eye, EyeOff, CalendarDays, Loader2, Users, Shield
} from 'lucide-react';
import { AskRelanternButton } from '../components/AskRelanternButton';
import { aiContextService } from '../services/AIContextService';
import { useNavigate } from 'react-router-dom';
import { MOCK_WORK_ORDERS, MOCK_CONTACTS, MOCK_ASSETS, MOCK_RECURRING_JOBS, MOCK_DICTIONARIES } from '../constants';
import { WorkOrder, WorkOrderStatus, RecurringJob, Asset, DictionaryEntry, Contact } from '../types';
import { DatabaseService } from '../services/DatabaseService';
import { buildWorkOrder } from '../lib/workOrder';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { AssignmentModal } from '../components/scheduling/AssignmentModal';
import { FrozenZoneModal } from '../components/scheduling/FrozenZoneModal';
import { MaterialCheckModal } from '../components/scheduling/MaterialCheckModal';
import type { MaterialCheckResult } from '../components/scheduling/MaterialCheckModal';
import { MRSView } from '../components/scheduling/MRSView';
import type { LaborResource } from '../components/scheduling/MRSView';
import { ScheduleKPIs } from '../components/scheduling/ScheduleKPIs';
import { CapacityChart } from '../components/scheduling/CapacityChart';
import { InteractiveGantt } from '../components/scheduling/InteractiveGantt';
import { SchedulePrintModal, PrintExportButton } from '../components/scheduling/SchedulePrint';
import { NotificationService } from '../services/NotificationService';
import { Button } from '../components/ui';

// --- Scheduling Constants ---
const FROZEN_ZONE_DAYS = 7; // Industry standard — weekly schedule lock
const NON_RESCHEDULABLE_STATUSES: string[] = ['TECO', 'CLOSED', 'CANC', 'CANCELLED'];

type ViewMode = 'CALENDAR' | 'GANTT' | 'BACKLOG' | 'MRS';
type CalendarScale = 'MONTH' | 'WEEK' | 'DAY';

interface CalendarItem {
    id: string;
    displayId: string; // for UI
    title: string;
    assetName: string;
    date: string;
    priority: string;
    type: 'WO' | 'PM';
    status?: string;
    isFromPM?: boolean; // true if WO was generated from a recurring PM
    originalData?: any;
}

// --- Priority Color Utility ---
const DEFAULT_PRIORITY_PALETTE = [
    { bg: '#FEE2E2', text: '#B91C1C', border: '#FECACA', hex: '#EF4444' }, // Red — P1
    { bg: '#FFEDD5', text: '#C2410C', border: '#FED7AA', hex: '#F97316' }, // Orange — P2
    { bg: '#FEF3C7', text: '#B45309', border: '#FDE68A', hex: '#F59E0B' }, // Amber — P3
    { bg: '#DBEAFE', text: '#1D4ED8', border: '#BFDBFE', hex: '#3B82F6' }, // Blue — P4
    { bg: '#F1F5F9', text: '#475569', border: '#E2E8F0', hex: '#64748B' }, // Slate — P5+
];

function getPriorityStyle(priorityCode: string, dictionaries: DictionaryEntry[]): { bg: string; text: string; border: string; hex: string; label: string } {
    const priorities = dictionaries
        .filter(d => d.type === 'PRIORITY' && d.active)
        .sort((a, b) => (a.sequence ?? 99) - (b.sequence ?? 99));

    const match = priorities.find(p => p.code === priorityCode);
    const index = match ? priorities.indexOf(match) : priorities.length; // fallback to last
    const palette = DEFAULT_PRIORITY_PALETTE[Math.min(index, DEFAULT_PRIORITY_PALETTE.length - 1)];

    // If the org set a custom colorCode, use it for the hex and derive styles
    if (match?.colorCode) {
        const hex = match.colorCode;
        return {
            bg: `${hex}18`, // 10% opacity approximation — use inline style
            text: hex,
            border: `${hex}40`,
            hex,
            label: match.code
        };
    }

    return { ...palette, label: match?.code || priorityCode };
}

function getPriorityLegend(dictionaries: DictionaryEntry[]): { code: string; description: string; hex: string }[] {
    return dictionaries
        .filter(d => d.type === 'PRIORITY' && d.active)
        .sort((a, b) => (a.sequence ?? 99) - (b.sequence ?? 99))
        .map((p, i) => ({
            code: p.code,
            description: p.description,
            hex: p.colorCode || DEFAULT_PRIORITY_PALETTE[Math.min(i, DEFAULT_PRIORITY_PALETTE.length - 1)].hex
        }));
}

// --- Date Helpers ---
function getWeekDates(date: Date): Date[] {
    const start = new Date(date);
    start.setDate(start.getDate() - start.getDay()); // Start on Sunday
    return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        return d;
    });
}

function formatDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isToday(d: Date): boolean {
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

// ========================================
// MAIN SCHEDULING PAGE
// ========================================
export const Scheduling: React.FC = () => {
    const { showToast } = useToast();
    const { dataScope, permissions } = useAuth();
    const [viewMode, setViewMode] = useState<ViewMode>('CALENDAR');
    const [currentDate, setCurrentDate] = useState(new Date());
    const [showProjections, setShowProjections] = useState(true);
    const [calendarScale, setCalendarScale] = useState<CalendarScale>('MONTH');
    const [searchQuery, setSearchQuery] = useState('');
    const [backlogSearchQuery, setBacklogSearchQuery] = useState('');

    // State — start empty, populated by live fetch (mock fallback)
    const [jobs, setJobs] = useState<WorkOrder[]>([]);
    const [recurringJobs, setRecurringJobs] = useState<RecurringJob[]>([]);
    const [loadingPMs, setLoadingPMs] = useState(true);
    const [loadingWOs, setLoadingWOs] = useState(true);
    const dictionaries = MOCK_DICTIONARIES;

    // Labor contacts for assignment modal
    const [laborContacts, setLaborContacts] = useState<Contact[]>([]);
    useEffect(() => {
        const loadLaborContacts = async () => {
            try {
                const db = DatabaseService.getInstance();
                const allContacts = await db.getContacts();
                setLaborContacts(allContacts.filter((c: any) => c.active && (c.flags?.isLabour || c.types?.some((t: string) => ['TECHNICIAN', 'ELECTRICIAN', 'MECHANIC', 'INSTRUMENT', 'OPERATOR', 'SUPERVISOR'].includes(t.toUpperCase())))));
            } catch { setLaborContacts([]); }
        };
        loadLaborContacts();
    }, []);

    // Assignment modal state
    const [assignModalOpen, setAssignModalOpen] = useState(false);
    const [assignTargetIds, setAssignTargetIds] = useState<Set<string>>(new Set());
    const [assignWoTitle, setAssignWoTitle] = useState('');
    const [assignWoNumber, setAssignWoNumber] = useState('');

    // Listen for assignment modal dispatch from BacklogView
    useEffect(() => {
        const handler = (e: Event) => {
            const ids = (e as CustomEvent).detail?.ids as string[];
            if (ids?.length) {
                setAssignTargetIds(new Set(ids));
                const firstWo = jobs.find(j => j.id === ids[0]);
                setAssignWoTitle(ids.length > 1 ? `${ids.length} Work Orders` : (firstWo?.title || ''));
                setAssignWoNumber(ids.length > 1 ? 'Bulk Assignment' : (firstWo?.woNumber || ''));
                setAssignModalOpen(true);
            }
        };
        window.addEventListener('open-assignment-modal', handler);
        return () => window.removeEventListener('open-assignment-modal', handler);
    }, [jobs]);

    // Frozen zone modal state
    const [frozenModalOpen, setFrozenModalOpen] = useState(false);
    const [frozenPendingAction, setFrozenPendingAction] = useState<{ itemId: string; newDate: string; source: 'WO' | 'PM'; originalDate: string; woNumber: string; woTitle: string; criticality?: string } | null>(null);
    const [assetCritMap, setAssetCritMap] = useState<Record<string, string>>({}); // R-3: asset id → criticality

    // Material check modal state
    const [materialModalOpen, setMaterialModalOpen] = useState(false);
    const [materialCheckResult, setMaterialCheckResult] = useState<any>(null);
    const [materialPendingAction, setMaterialPendingAction] = useState<{ itemId: string; newDate: string; woNumber: string; woTitle: string } | null>(null);

    // Print/Export modal state
    const [printModalOpen, setPrintModalOpen] = useState(false);

    // MRS labor resources + capacity demand (live fetch)
    const [mrsResources, setMrsResources] = useState<LaborResource[]>([]);
    const [mrsLoading, setMrsLoading] = useState(false);
    const [mrsDemand, setMrsDemand] = useState<Record<string, Record<string, number>>>({});
    const [mrsDateRange, setMrsDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' });

    // GAP-D: materialStatusMap for KPIs — batch-checked on load
    const [materialStatusMap, setMaterialStatusMap] = useState<Record<string, 'AVAILABLE' | 'ON_ORDER' | 'SHORTAGE' | 'UNCHECKED'>>({});

    useEffect(() => {
        if (viewMode !== 'MRS') return;
        const loadMRS = async () => {
            setMrsLoading(true);
            try {
                const db = DatabaseService.getInstance();
                const weekStart = new Date(currentDate);
                weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1); // Monday
                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekEnd.getDate() + 6);
                const range = {
                    start: weekStart.toISOString().split('T')[0],
                    end: weekEnd.toISOString().split('T')[0],
                };
                setMrsDateRange(range);

                // GAP-A: Load both labor availability AND resource demand in parallel
                const [laborResult, demandResult] = await Promise.all([
                    db.getLaborAvailability(range, dataScope?.siteIds),
                    db.getResourceDemand(range),
                ]);
                setMrsResources(laborResult.resources as LaborResource[]);
                setMrsDemand(demandResult);
            } catch (err) {
                console.error('[Scheduling] Failed to load MRS resources:', err);
                setMrsResources([]);
                setMrsDemand({});
            } finally {
                setMrsLoading(false);
            }
        };
        loadMRS();
    }, [viewMode, currentDate, dataScope?.siteIds]);

    // GAP-D: Batch material availability check (runs once on WO load, cached)
    useEffect(() => {
        if (loadingWOs || jobs.length === 0) return;
        const batchCheckMaterials = async () => {
            try {
                const db = DatabaseService.getInstance();
                const scheduledWOs = jobs.filter(j =>
                    j.dateDueStart && !['TECO', 'CLOSED', 'CANC'].includes(j.status as string)
                ).slice(0, 50); // Throttle to 50 WOs max
                const statusMap: Record<string, 'AVAILABLE' | 'ON_ORDER' | 'SHORTAGE' | 'UNCHECKED'> = {};
                for (const wo of scheduledWOs) {
                    try {
                        const result = await db.checkMaterialAvailability(wo.id);
                        if (result.items.length === 0) {
                            statusMap[wo.id] = 'UNCHECKED';
                        } else if (result.ready) {
                            statusMap[wo.id] = 'AVAILABLE';
                        } else if (result.items.some((i: any) => i.status === 'ON_ORDER')) {
                            statusMap[wo.id] = 'ON_ORDER';
                        } else {
                            statusMap[wo.id] = 'SHORTAGE';
                        }
                    } catch {
                        statusMap[wo.id] = 'UNCHECKED';
                    }
                }
                setMaterialStatusMap(statusMap);
            } catch (err) {
                console.warn('[Scheduling] Batch material check failed:', err);
            }
        };
        batchCheckMaterials();
    }, [loadingWOs, jobs.length]);

    // Live WORK ORDER data fetch — replaces mock on success (hybrid fallback)
    useEffect(() => {
        const loadLiveWOs = async () => {
            try {
                const db = DatabaseService.getInstance();
                const rawWOs = await db.getWorkOrders();

                if (rawWOs.length > 0) {
                    // Fetch assets for name + criticality resolution (R-3: scheduling
                    // consumes the criticality the assessment engine writes to assets).
                    let assetMap: Record<string, string> = {};
                    const critMap: Record<string, string> = {};
                    try {
                        const assets = await db.getAssets();
                        assets.forEach((a: any) => {
                            assetMap[a.id] = a.tag || a.name || 'Unknown';
                            if (a.criticality) critMap[a.id] = a.criticality;
                        });
                        setAssetCritMap(critMap);
                    } catch { /* use empty map */ }

                    const mappedWOs: WorkOrder[] = rawWOs.map((raw: any) => ({
                        id: raw.id,
                        woNumber: raw.wo_number,
                        title: raw.title || raw.wo_number || 'Untitled',
                        description: raw.description || '',
                        status: raw.status || 'OPEN',
                        type: raw.type || 'CM',
                        scope: raw.properties?.scope || 'STANDARD',
                        priority: raw.priority_code || 'MEDIUM',

                        assetId: raw.asset_id,
                        assetName: assetMap[raw.asset_id] || raw.asset_id || 'Unknown',
                        parentWoId: raw.parent_wo_id,
                        recurringWorkId: raw.recurring_work_id,

                        costCenter: raw.cost_center_id,
                        enforceJobCostCenter: raw.properties?.enforceJobCostCenter || false,

                        dateCreated: raw.created_at,
                        dateDueStart: raw.date_due_start || raw.due_date || '',
                        dueDate: raw.due_date || raw.date_due_start || '',
                        estDuration: raw.est_duration || 0,
                        estDowntime: raw.properties?.est_downtime || 0,
                        actualDuration: raw.properties?.actual_duration || 0,
                        actualDowntime: raw.properties?.actual_downtime || 0,

                        createdById: raw.created_by || 'system',
                        comments: raw.properties?.comments,

                        tasks: [],
                        labor: [],
                        inventory: [],
                    }));

                    setJobs(mappedWOs);
                    console.log(`[Scheduling] Loaded ${mappedWOs.length} live work orders`);
                } else {
                    // Fallback to mock data if DB is empty
                    setJobs(MOCK_WORK_ORDERS);
                    console.log('[Scheduling] No live WOs found, using mock data');
                }
            } catch (e) {
                console.warn('[Scheduling] WO fetch failed, using mock data', e);
                setJobs(MOCK_WORK_ORDERS);
            } finally {
                setLoadingWOs(false);
            }
        };
        loadLiveWOs();
    }, []);

    // Live PM data fetch — replaces mock on success (hybrid fallback)
    useEffect(() => {
        const loadLivePMs = async () => {
            try {
                const db = DatabaseService.getInstance();
                const dbPMs = await db.getPMs();

                if (dbPMs.length > 0) {
                    // Fetch assigned assets per PM for last_completed dates
                    let assignedAssetsMap: Record<string, any[]> = {};
                    try {
                        const { data: rwa } = await (await import('../lib/supabase')).supabase
                            .from('recurring_work_assigned_assets')
                            .select('*');
                        if (rwa) {
                            rwa.forEach((row: any) => {
                                if (!assignedAssetsMap[row.recurring_work_id]) assignedAssetsMap[row.recurring_work_id] = [];
                                assignedAssetsMap[row.recurring_work_id].push(row);
                            });
                        }
                    } catch { /* will use PM-level asset_id fallback */ }

                    // Fetch assets for name resolution
                    let assetMap: Record<string, string> = {};
                    try {
                        const assets = await db.getAssets();
                        assets.forEach((a: any) => { assetMap[a.id] = a.tag || a.name || 'Unknown'; });
                    } catch { /* use empty map */ }

                    const mappedPMs: RecurringJob[] = dbPMs
                        .filter((pm: any) => pm.active !== false)
                        .map((pm: any) => {
                            // Build assignedAssets from the join table, or fallback to PM-level asset_id
                            const rwaEntries = assignedAssetsMap[pm.id] || [];
                            let assignedAssets: any[];

                            if (rwaEntries.length > 0) {
                                assignedAssets = rwaEntries.map((rwa: any) => ({
                                    assetId: rwa.asset_id,
                                    lastCompletedDate: rwa.last_completed || '',
                                    lastReadingValue: rwa.last_reading_value || 0,
                                }));
                            } else if (pm.asset_id) {
                                assignedAssets = [{ assetId: pm.asset_id, lastCompletedDate: '', lastReadingValue: 0 }];
                            } else {
                                assignedAssets = [];
                            }

                            // Map frequency_type to scheduleType
                            const freqType = (pm.frequency_type || '').toUpperCase();
                            const isTimeBased = ['DAYS', 'WEEKS', 'MONTHS', 'YEARS'].includes(freqType);

                            // Map frequency_type to frequencyUnit for projection calculation
                            const unitMap: Record<string, string> = {
                                'DAYS': 'Days', 'WEEKS': 'Weeks', 'MONTHS': 'Months', 'YEARS': 'Years',
                                'HOURS': 'Hours', 'KM': 'KM'
                            };

                            return {
                                id: pm.id,
                                code: pm.code || `PM-${pm.id.slice(0, 5)}`,
                                description: pm.description || pm.title || 'Untitled PM',
                                status: pm.active ? 'ACTIVE' : 'PAUSED',
                                assignedAssets,
                                scheduleType: isTimeBased ? 'TIME' : 'READING',
                                frequencyInterval: pm.interval || pm.frequency_interval || 1,
                                frequencyUnit: unitMap[freqType] || pm.frequency_unit || 'Months',
                                leadTimeDays: pm.lead_time_days || 7,
                                nextDueDate: pm.next_due_date, // Direct from DB
                                jobType: pm.job_type_code || pm.job_type || 'PM',
                                priority: pm.priority_code || 'MEDIUM',
                                estDuration: pm.est_duration || 0,
                                estDowntime: pm.est_downtime || 0,
                                tasks: [],
                                jsa: { id: 'jsa-live', status: 'DRAFT', hazards: [], permits: [], signoffs: [] },
                                labor: [],
                                inventory: [],
                                createdById: 'system',
                                createdAt: new Date().toISOString()
                            } as any;
                        });

                    setRecurringJobs(mappedPMs);
                    setLiveAssetMap(assetMap);
                    console.log(`[Scheduling] Loaded ${mappedPMs.length} live PMs`);
                }
            } catch (e) {
                console.warn('[Scheduling] DB fetch failed, using mock PMs', e);
            } finally {
                setLoadingPMs(false);
            }
        };
        loadLivePMs();
    }, []);

    // Asset map for live name resolution (set by PM loader)
    const [liveAssetMap, setLiveAssetMap] = useState<Record<string, string>>({});

    // --- Logic ---

    // 1. Calculate Projections from Recurring Jobs
    const projections = useMemo<CalendarItem[]>(() => {
        if (!showProjections) return [];
        const items: CalendarItem[] = [];

        recurringJobs.forEach(rj => {
            if (rj.scheduleType === 'TIME' && rj.assignedAssets) {
                rj.assignedAssets.forEach(assignment => {
                    let projectedDate: string | null = null;

                    if (assignment.lastCompletedDate) {
                        // Calculate from last completed + frequency
                        const lastDate = new Date(assignment.lastCompletedDate);
                        const nextDate = new Date(lastDate);

                        if (rj.frequencyUnit === 'Days') nextDate.setDate(lastDate.getDate() + rj.frequencyInterval);
                        if (rj.frequencyUnit === 'Weeks') nextDate.setDate(lastDate.getDate() + rj.frequencyInterval * 7);
                        if (rj.frequencyUnit === 'Months') nextDate.setMonth(lastDate.getMonth() + rj.frequencyInterval);
                        if (rj.frequencyUnit === 'Years') nextDate.setFullYear(lastDate.getFullYear() + rj.frequencyInterval);

                        projectedDate = nextDate.toISOString().split('T')[0];
                    } else if ((rj as any).nextDueDate) {
                        // Use the PM's next_due_date directly from DB
                        projectedDate = new Date((rj as any).nextDueDate).toISOString().split('T')[0];
                    }

                    if (projectedDate) {
                        // Resolve asset name: try live map, then mock assets, then fallback
                        const assetName = liveAssetMap[assignment.assetId]
                            || MOCK_ASSETS.find(a => a.id === assignment.assetId)?.tag
                            || 'Unknown Asset';

                        items.push({
                            id: `PM_PROJ_${rj.id}_${assignment.assetId}`,
                            displayId: rj.code,
                            title: rj.description,
                            assetName,
                            date: projectedDate,
                            priority: rj.priority,
                            type: 'PM',
                            originalData: { job: rj, assetId: assignment.assetId, assetName }
                        });
                    }
                });
            }
        });
        return items;
    }, [recurringJobs, showProjections, liveAssetMap]);

    // 2. Transform Existing Jobs to Calendar Items
    const workOrderItems = useMemo<CalendarItem[]>(() => {
        return jobs
            .filter(j => j.dateDueStart) // Only scheduled jobs
            .map(j => ({
                id: j.id,
                displayId: j.woNumber || j.id,
                title: j.title,
                assetName: j.assetName || 'Unknown',
                date: j.dateDueStart,
                priority: j.priority,
                type: 'WO',
                status: j.status,
                isFromPM: !!j.recurringWorkId,
                originalData: j
            }));
    }, [jobs]);

    // 3. Combined & Filtered
    const allItems = useMemo(() => {
        const combined = [...workOrderItems, ...projections];
        if (!searchQuery.trim()) return combined;
        const q = searchQuery.toLowerCase();
        return combined.filter(item =>
            item.title.toLowerCase().includes(q) ||
            item.assetName.toLowerCase().includes(q) ||
            item.displayId.toLowerCase().includes(q)
        );
    }, [workOrderItems, projections, searchQuery]);

    // 4. Handle Drag & Drop Actions — synced to Supabase
    //    Phase 1: Status Gate + Frozen Zone + Auto SCHED transition
    const handleItemDrop = async (itemId: string, newDate: string, source: 'WO' | 'PM') => {
        const db = DatabaseService.getInstance();

        if (source === 'WO') {
            // ── STATUS GATE ENFORCEMENT (GAP-2) ──
            const wo = jobs.find(j => j.id === itemId);
            if (wo && NON_RESCHEDULABLE_STATUSES.includes(wo.status as string)) {
                showToast(`Cannot reschedule — WO is ${wo.status}. Only OPEN, PLAN, or SCHED work orders can be rescheduled.`, 'error');
                return;
            }

            // ── FROZEN ZONE CHECK (GAP-3) ──
            const targetDate = new Date(newDate);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const daysFromNow = Math.ceil((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

            if (daysFromNow >= 0 && daysFromNow < FROZEN_ZONE_DAYS) {
                // Show frozen zone confirmation modal — execution continues in handleFrozenZoneConfirm
                setFrozenPendingAction({
                    itemId,
                    newDate,
                    source,
                    originalDate: wo?.dateDueStart || '',
                    woNumber: wo?.woNumber || itemId,
                    woTitle: wo?.title || '',
                    criticality: wo?.assetId ? assetCritMap[wo.assetId] : undefined, // R-3: resolved from asset
                });
                setFrozenModalOpen(true);
                return;
            }

            // Execute the reschedule
            await executeReschedule(itemId, newDate, source);
        } else {
            // PM Projection → Create real Work Order in DB
            await executePMCommit(itemId, newDate);
        }
    };

    // GAP-B: Persist audit entry for scheduling overrides
    const persistScheduleAudit = async (woId: string, action: string, reason: string, details?: any) => {
        try {
            const { supabase } = await import('../lib/supabase');
            await supabase.from('audit_logs').insert({
                table_name: 'work_orders',
                record_id: woId,
                action: 'UPDATE',
                changed_by: permissions?.username || 'scheduler',
                timestamp: new Date().toISOString(),
                changes: JSON.stringify({
                    override_type: action,
                    reason,
                    ...details,
                }),
            });
        } catch (err) {
            console.error('[Scheduling] Audit log failed (non-blocking):', err);
        }
    };

    // GAP-C: Conflict detection — checks for asset double-booking and technician overload
    const checkConflicts = (itemId: string, newDate: string): { hasConflict: boolean; warnings: string[] } => {
        const warnings: string[] = [];
        const wo = jobs.find(j => j.id === itemId);
        if (!wo) return { hasConflict: false, warnings };

        // Asset conflict: another WO on the same asset on the same date
        const sameAssetSameDate = jobs.filter(j =>
            j.id !== itemId &&
            j.assetId === wo.assetId &&
            j.dateDueStart === newDate &&
            !['TECO', 'CLOSED', 'CANC', 'CANCELLED'].includes(j.status as string)
        );
        if (sameAssetSameDate.length > 0) {
            warnings.push(`⚠ Asset conflict: ${wo.assetName} already has ${sameAssetSameDate.map(j => j.woNumber).join(', ')} on ${newDate}`);
        }

        // Technician overload: assigned tech already at/over capacity
        if ((wo as any).assignedTo) {
            const assignedContactId = (wo as any).assignedTo;
            const techResource = mrsResources.find(r => r.contactId === assignedContactId);
            if (techResource) {
                const available = techResource.availableHoursPerDay?.[newDate] ?? techResource.dailyCapacityHours;
                const estHours = wo.estDuration || 0;
                if (estHours > available) {
                    warnings.push(`⚠ Technician overload: ${techResource.name} has ${available.toFixed(1)}h available but this job needs ${estHours}h`);
                }
            }
        }

        return { hasConflict: warnings.length > 0, warnings };
    };

    // Frozen zone override handler
    const handleFrozenZoneConfirm = async (reason: string) => {
        if (!frozenPendingAction) return;
        setFrozenModalOpen(false);

        // GAP-B: Persist frozen zone override to audit trail
        await persistScheduleAudit(frozenPendingAction.itemId, 'FROZEN_ZONE_OVERRIDE', reason, {
            targetDate: frozenPendingAction.newDate,
            originalDate: frozenPendingAction.originalDate,
            woNumber: frozenPendingAction.woNumber,
            frozenZoneDays: FROZEN_ZONE_DAYS,
        });
        showToast(`Schedule override logged: ${reason}`, 'warning');

        if (frozenPendingAction.source === 'WO') {
            await executeReschedule(frozenPendingAction.itemId, frozenPendingAction.newDate, frozenPendingAction.source);
        } else {
            await executePMCommit(frozenPendingAction.itemId, frozenPendingAction.newDate);
        }
        setFrozenPendingAction(null);
    };

    // Core reschedule execution (WO)
    const executeReschedule = async (itemId: string, newDate: string, _source: 'WO' | 'PM') => {
        const db = DatabaseService.getInstance();
        const wo = jobs.find(j => j.id === itemId);

        // ── GAP-C: CONFLICT DETECTION ──
        const { hasConflict, warnings } = checkConflicts(itemId, newDate);
        if (hasConflict) {
            warnings.forEach(w => showToast(w, 'warning'));
            // Non-blocking for standard assets — just warn
            // But for Criticality A, the frozen zone modal already handles blocking
        }

        // ── MATERIAL AVAILABILITY CHECK (GAP-6 / Phase 2) ──
        try {
            const materialResult = await db.checkMaterialAvailability(itemId);
            if (!materialResult.ready && materialResult.items.length > 0) {
                // Show material check modal instead of scheduling immediately
                setMaterialCheckResult(materialResult);
                setMaterialPendingAction({ itemId, newDate, woNumber: wo?.woNumber || '', woTitle: wo?.title || '' });
                setMaterialModalOpen(true);
                return; // Execution continues in handleMaterialScheduleAnyway or handleMaterialScheduleSuggested
            }
        } catch (materialErr) {
            console.warn('[Scheduling] Material check failed (non-blocking):', materialErr);
            // Fail-open: continue with scheduling
        }

        // No material issues — proceed with scheduling
        await commitReschedule(itemId, newDate, wo || null);
    };

    // Material check handlers
    const handleMaterialScheduleAnyway = async (reason: string) => {
        setMaterialModalOpen(false);
        if (!materialPendingAction) return;

        // GAP-B: Persist material override to audit trail
        await persistScheduleAudit(materialPendingAction.itemId, 'MATERIAL_SHORTAGE_OVERRIDE', reason, {
            shortageCount: materialCheckResult?.items?.filter((i: any) => i.status !== 'AVAILABLE').length || 0,
            items: materialCheckResult?.items?.map((i: any) => ({
                materialNumber: i.materialNumber,
                description: i.description,
                status: i.status,
                requiredQty: i.requiredQty,
                onHandQty: i.onHandQty,
            })) || [],
            woNumber: materialPendingAction.woNumber,
            targetDate: materialPendingAction.newDate,
        });
        showToast(`Scheduled despite shortage: ${reason}`, 'warning');
        const wo = jobs.find(j => j.id === materialPendingAction.itemId);
        await commitReschedule(materialPendingAction.itemId, materialPendingAction.newDate, wo || null);
        setMaterialPendingAction(null);
    };

    const handleMaterialScheduleSuggested = async (suggestedDate: string) => {
        setMaterialModalOpen(false);
        if (!materialPendingAction) return;
        showToast(`Scheduled for suggested date: ${new Date(suggestedDate).toLocaleDateString()}`, 'success');
        const wo = jobs.find(j => j.id === materialPendingAction.itemId);
        await commitReschedule(materialPendingAction.itemId, suggestedDate, wo || null);
        setMaterialPendingAction(null);
    };

    // Shared commit logic for reschedule
    const commitReschedule = async (itemId: string, newDate: string, wo: WorkOrder | null) => {
        const db = DatabaseService.getInstance();

        // AUTO SCHED TRANSITION
        const newStatus = (wo?.status === 'OPEN' || wo?.status === 'PLAN') ? 'SCHED' : wo?.status;

        // Optimistic UI update
        setJobs(prev => prev.map(j =>
            j.id === itemId ? {
                ...j,
                dateDueStart: newDate,
                dueDate: newDate,
                status: (newStatus || j.status) as any
            } : j
        ));

        // Persist to Supabase
        try {
            const oldDate = wo?.dateDueStart || '';
            await db.scheduleWorkOrder(itemId, {
                date_due_start: newDate,
                due_date: newDate,
                status: newStatus || 'SCHED',
            }, (permissions?.username || 'scheduler') as string);
            showToast(`${wo?.woNumber || 'WO'} scheduled for ${new Date(newDate).toLocaleDateString()}`, 'success');

            // GAP-G: Send notification to assigned technician on reschedule
            if ((wo as any)?.assignedTo && oldDate && oldDate !== newDate) {
                try {
                    await NotificationService.notify({
                        recipientId: (wo as any).assignedTo,
                        title: `Schedule Change: ${wo?.woNumber || 'WO'}`,
                        message: `Work order "${wo?.title}" rescheduled from ${new Date(oldDate).toLocaleDateString()} to ${new Date(newDate).toLocaleDateString()}.`,
                        severity: wo?.priority === 'EMERGENCY' ? 'CRITICAL' : 'INFO',
                        notificationType: 'SCHEDULE_ALERT',
                        module: 'workOrders',
                        entityId: itemId,
                        entityType: 'WORK_ORDER',
                        entityNumber: wo?.woNumber || '',
                        actionLink: '/work-orders',
                        createdBy: (permissions?.username || 'scheduler') as string,
                    });
                } catch (notifErr) {
                    console.warn('[Scheduling] Reschedule notification failed (non-blocking):', notifErr);
                }
            }
        } catch (err) {
            console.error('[Scheduling] Failed to persist date change:', err);
            showToast('Failed to save schedule change — reverting', 'error');
            try {
                const rawWOs = await db.getWorkOrders();
                if (rawWOs.length > 0) {
                    let assetMap: Record<string, string> = {};
                    try {
                        const assets = await db.getAssets();
                        assets.forEach((a: any) => { assetMap[a.id] = a.tag || a.name || 'Unknown'; });
                    } catch { /* ignore */ }
                    setJobs(rawWOs.map((raw: any) => ({
                        id: raw.id, woNumber: raw.wo_number, title: raw.title || raw.wo_number || 'Untitled',
                        description: raw.description || '', status: raw.status || 'OPEN', type: raw.type || 'CM',
                        scope: raw.properties?.scope || 'STANDARD', priority: raw.priority_code || 'MEDIUM',
                        assetId: raw.asset_id, assetName: assetMap[raw.asset_id] || raw.asset_id || 'Unknown',
                        dateCreated: raw.created_at, dateDueStart: raw.date_due_start || raw.due_date || '',
                        dueDate: raw.due_date || raw.date_due_start || '', estDuration: raw.est_duration || 0,
                        estDowntime: raw.properties?.est_downtime || 0, actualDuration: raw.properties?.actual_duration || 0,
                        actualDowntime: raw.properties?.actual_downtime || 0, createdById: raw.created_by || 'system',
                        tasks: [], labor: [], inventory: [],
                    })));
                }
            } catch { /* last resort: keep stale state */ }
        }
    };

    // Core PM commit execution
    const executePMCommit = async (itemId: string, newDate: string) => {
        const db = DatabaseService.getInstance();
        const proj = projections.find(p => p.id === itemId);
        if (!proj) return;

        const rj = proj.originalData.job as RecurringJob;

        try {
            const woPayload = buildWorkOrder({
                woNumber: `WO-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`,
                title: rj.jobDescription || rj.description,
                description: rj.jobDescription || rj.description,
                status: 'SCHED', // Auto-set to SCHED since we have a date
                type: rj.jobType || 'PM',
                priorityCode: rj.priority || 'MEDIUM',
                assetId: proj.originalData.assetId,
                dateDueStart: newDate,
                dueDate: newDate,
                estDuration: rj.estDuration || 0,
                recurringWorkId: rj.id,
                costFrozen: false,
                frozenLaborCost: 0,
                frozenMaterialCost: 0,
            });

            const createdWO = await db.createWorkOrder(woPayload, 'scheduler');
            showToast(`PM ${rj.code} committed as ${createdWO.wo_number} on ${new Date(newDate).toLocaleDateString()}`, 'success');
            console.log(`[Scheduling] PM ${rj.code} committed as WO ${createdWO.wo_number} on ${newDate}`);

            // Add to local state
            const newWorkOrder: WorkOrder = {
                id: createdWO.id,
                woNumber: createdWO.wo_number,
                title: createdWO.title,
                description: createdWO.description,
                status: WorkOrderStatus.SCHED as any,
                type: rj.jobType,
                scope: 'STANDARD',
                priority: rj.priority,
                assetId: proj.originalData.assetId,
                assetName: proj.originalData.assetName,
                costCenter: rj.costCenter || '',
                dateCreated: new Date().toISOString().split('T')[0],
                dateDueStart: newDate,
                dueDate: newDate,
                estDuration: rj.estDuration,
                estDowntime: rj.estDowntime,
                actualDuration: 0,
                actualDowntime: 0,
                createdById: 'scheduler',
                recurringWorkId: rj.id,
                tasks: [],
                labor: [],
                inventory: [],
            };

            setJobs(prev => [...prev, newWorkOrder]);
        } catch (err) {
            console.error('[Scheduling] Failed to create WO from PM:', err);
            showToast(`Failed to commit recurring job: ${(err as Error).message}`, 'error');
        }
    };

    // 5. Navigation
    const navigateDate = (direction: number) => {
        const d = new Date(currentDate);
        if (calendarScale === 'MONTH') d.setMonth(d.getMonth() + direction);
        else if (calendarScale === 'WEEK') d.setDate(d.getDate() + 7 * direction);
        else d.setDate(d.getDate() + direction);
        setCurrentDate(d);
    };

    return (
        <div className="flex flex-col h-[calc(100vh-6rem)]">
            {/* Top Toolbar */}
            <div className="flex flex-wrap justify-between items-center mb-4 gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Work Scheduling</h1>
                    <p className="text-sm text-slate-500">Plan maintenance, manage backlog, and optimize resource utilization.</p>
                </div>
                <div className="flex items-center gap-3 overflow-x-auto">
                    <AskRelanternButton
                        contextType="scheduling"
                        contextSummary={aiContextService.buildSchedulingContext({
                            scheduledWOs: jobs.filter(j => j.dateDueStart && !['TECO', 'CLOSED', 'CANC'].includes(j.status as string)).length,
                            unscheduledWOs: jobs.filter(j => !j.dateDueStart && !['TECO', 'CLOSED', 'CANC'].includes(j.status as string)).length,
                            plannedHours: jobs.reduce((s, j) => s + (j.estDuration || 0), 0),
                            availableHours: mrsResources.reduce((s, r) => s + (r.dailyCapacityHours || 0) * 5, 0),
                            resourceLoad: mrsResources.map(r => ({
                                craft: (r as any).craft || r.name || 'General',
                                planned: 0,
                                available: (r.dailyCapacityHours || 8) * 5,
                            })),
                            conflicts: 0,
                        })}
                    />
                    {/* View Switcher */}
                    <div className="flex bg-white rounded-lg p-1 border border-slate-200 shadow-sm">
                        <button
                            onClick={() => setViewMode('CALENDAR')}
                            className={`px-3 sm:px-4 py-2 text-sm font-medium rounded-md flex items-center gap-2 transition ${viewMode === 'CALENDAR' ? 'bg-primary-50 text-primary-600' : 'text-slate-600 hover:bg-slate-50'}`}
                        >
                            <CalendarIcon size={16} /><span className="hidden sm:inline">Calendar</span>
                        </button>
                        <button
                            onClick={() => setViewMode('GANTT')}
                            className={`px-3 sm:px-4 py-2 text-sm font-medium rounded-md flex items-center gap-2 transition ${viewMode === 'GANTT' ? 'bg-primary-50 text-primary-600' : 'text-slate-600 hover:bg-slate-50'}`}
                        >
                            <BarChart2 size={16} /><span className="hidden sm:inline">Gantt</span>
                        </button>
                        <button
                            onClick={() => setViewMode('BACKLOG')}
                            className={`px-3 sm:px-4 py-2 text-sm font-medium rounded-md flex items-center gap-2 transition ${viewMode === 'BACKLOG' ? 'bg-primary-50 text-primary-600' : 'text-slate-600 hover:bg-slate-50'}`}
                        >
                            <List size={16} /><span className="hidden sm:inline">Backlog</span>
                        </button>
                        <button
                            onClick={() => setViewMode('MRS')}
                            className={`px-3 sm:px-4 py-2 text-sm font-medium rounded-md flex items-center gap-2 transition ${viewMode === 'MRS' ? 'bg-primary-50 text-primary-600' : 'text-slate-600 hover:bg-slate-50'}`}
                        >
                            <Users size={16} /><span className="hidden sm:inline">Resources</span>
                        </button>
                    </div>
                    <PrintExportButton onClick={() => setPrintModalOpen(true)} />
                </div>
            </div>

            {/* ── Schedule KPIs Strip ── */}
            <ScheduleKPIs jobs={jobs} recurringJobs={recurringJobs} materialStatusMap={materialStatusMap} resources={mrsResources} />

            {/* Content Area */}
            <div className="flex-1 bg-white rounded-card shadow-card border border-slate-200 overflow-hidden relative flex flex-col">
                {viewMode === 'CALENDAR' && (
                    <>
                        {/* Calendar Toolbar */}
                        <div className="px-4 py-2.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                                {/* Search */}
                                <div className="relative">
                                    <Search className="absolute left-2.5 top-2 text-slate-400" size={14} />
                                    <input
                                        type="text"
                                        placeholder="Search WO, asset, title..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-white w-56 focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-600"
                                    />
                                </div>
                                {/* Scale Switcher */}
                                <div className="flex bg-slate-100 rounded-lg p-0.5">
                                    {(['MONTH', 'WEEK', 'DAY'] as CalendarScale[]).map(scale => (
                                        <button
                                            key={scale}
                                            onClick={() => setCalendarScale(scale)}
                                            className={`px-3 py-1 text-[11px] font-bold rounded-md transition ${calendarScale === scale
                                                ? 'bg-white text-primary-600 shadow-sm'
                                                : 'text-slate-500 hover:text-slate-700'
                                                }`}
                                        >
                                            {scale === 'MONTH' ? 'Month' : scale === 'WEEK' ? 'Week' : 'Day'}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => setShowProjections(!showProjections)}
                                    className={`text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-2 border transition ${showProjections ? 'bg-primary-50 text-primary-700 border-primary-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}
                                >
                                    {showProjections ? <Eye size={14} /> : <EyeOff size={14} />}
                                    {showProjections ? 'Hide Projections' : 'Show Projections'}
                                </button>
                            </div>
                        </div>
                        <CalendarView
                            currentDate={currentDate}
                            setDate={setCurrentDate}
                            items={allItems}
                            onItemDrop={handleItemDrop}
                            scale={calendarScale}
                            onNavigate={navigateDate}
                            dictionaries={dictionaries}
                        />
                    </>
                )}
                {viewMode === 'GANTT' && (
                    <InteractiveGantt
                        jobs={jobs}
                        dictionaries={dictionaries}
                        onReschedule={async (woId, newStart, newEnd) => {
                            const db = DatabaseService.getInstance();
                            const wo = jobs.find(j => j.id === woId);
                            if (!wo) return;

                            // Status gate
                            if (NON_RESCHEDULABLE_STATUSES.includes(wo.status as string)) {
                                showToast(`Cannot reschedule — WO is ${wo.status}`, 'error');
                                return;
                            }

                            // Optimistic UI
                            setJobs(prev => prev.map(j => j.id === woId ? {
                                ...j,
                                dateDueStart: newStart,
                                dueDate: newEnd,
                                status: (j.status === 'OPEN' || j.status === 'PLAN') ? 'SCHED' as any : j.status,
                            } : j));

                            try {
                                await db.scheduleWorkOrder(woId, {
                                    date_due_start: newStart,
                                    due_date: newEnd,
                                    status: (wo.status === 'OPEN' || wo.status === 'PLAN') ? 'SCHED' : wo.status as string,
                                }, (permissions?.username || 'scheduler') as string);
                                showToast(`${wo.woNumber} rescheduled: ${new Date(newStart).toLocaleDateString()} — ${new Date(newEnd).toLocaleDateString()}`, 'success');
                            } catch (err) {
                                console.error('[Gantt] Reschedule failed:', err);
                                showToast('Reschedule failed — reverting', 'error');
                                // Revert optimistic UI
                                setJobs(prev => prev.map(j => j.id === woId ? {
                                    ...j,
                                    dateDueStart: wo.dateDueStart,
                                    dueDate: wo.dueDate,
                                    status: wo.status,
                                } : j));
                            }
                        }}
                    />
                )}
                {viewMode === 'BACKLOG' && <BacklogView jobs={jobs} onJobsUpdate={setJobs} dictionaries={dictionaries} laborContacts={laborContacts} />}
                {viewMode === 'MRS' && (
                    <div className="flex flex-col h-full">
                        <MRSView
                            resources={mrsResources}
                            jobs={jobs}
                            currentDate={currentDate}
                            onDateChange={setCurrentDate}
                            onAssignJob={async (woId, contactId, date) => {
                                const db = DatabaseService.getInstance();
                                // Optimistic UI update
                                setJobs(prev => prev.map(j => j.id === woId ? { ...j, assignedTo: contactId, dateDueStart: date, dueDate: date, status: (j.status === 'OPEN' || j.status === 'PLAN') ? 'SCHED' as any : j.status } : j));
                                try {
                                    await db.scheduleWorkOrder(woId, {
                                        assigned_to: contactId,
                                        date_due_start: date,
                                        due_date: date,
                                        status: 'SCHED',
                                    }, (permissions?.username || 'scheduler') as string);
                                    showToast('Job assigned and scheduled', 'success');

                                    // GAP-G: Notify assigned technician
                                    try {
                                        const wo = jobs.find(j => j.id === woId);
                                        const contact = laborContacts.find(c => c.id === contactId);
                                        await NotificationService.notify({
                                            recipientId: contactId,
                                            title: `New Assignment: ${wo?.woNumber || 'WO'}`,
                                            message: `You have been assigned "${wo?.title || 'Work Order'}" for ${new Date(date).toLocaleDateString()}.`,
                                            severity: wo?.priority === 'EMERGENCY' ? 'CRITICAL' : 'INFO',
                                            notificationType: 'ASSIGNMENT',
                                            module: 'workOrders',
                                            entityId: woId,
                                            entityType: 'WORK_ORDER',
                                            entityNumber: wo?.woNumber || '',
                                            actionLink: '/work-orders',
                                            createdBy: (permissions?.username || 'scheduler') as string,
                                        });
                                    } catch { /* non-blocking */ }
                                } catch (err) {
                                    console.error('[MRS] Failed to assign:', err);
                                    showToast('Assignment failed', 'error');
                                }
                            }}
                            loading={mrsLoading}
                        />

                        {/* GAP-A: Capacity Chart — wired to live demand data */}
                        {mrsDateRange.start && (
                            <div className="px-4 pb-4">
                                <CapacityChart
                                    demand={mrsDemand}
                                    resources={mrsResources.map(r => ({
                                        craftTypes: r.craftTypes,
                                        dailyCapacityHours: r.dailyCapacityHours,
                                        workingDays: r.workingDays,
                                        name: r.name,
                                    }))}
                                    dateRange={mrsDateRange}
                                    loading={mrsLoading}
                                />
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* ── Assignment Modal ── */}
            <AssignmentModal
                isOpen={assignModalOpen}
                onClose={() => { setAssignModalOpen(false); setAssignTargetIds(new Set()); }}
                onAssign={(contactId, contactName) => {
                    const updated = jobs.map(j => assignTargetIds.has(j.id) ? { ...j, assignedTo: contactId } : j);
                    setJobs(updated);
                    // Persist each assignment
                    const db = DatabaseService.getInstance();
                    assignTargetIds.forEach(woId => {
                        db.updateWorkOrder(woId, { assigned_to: contactId } as any, 'scheduler').catch(console.error);
                    });
                    showToast(`Assigned ${assignTargetIds.size} job(s) to ${contactName}`, 'success');
                    setAssignModalOpen(false);
                    setAssignTargetIds(new Set());
                }}
                contacts={laborContacts}
                woTitle={assignWoTitle}
                woNumber={assignWoNumber}
                selectedIds={assignTargetIds}
                requiredQualifications={
                    // PO-1: union of required competencies across the target WO(s).
                    // Activates competency gating automatically once WOs carry required certs.
                    Array.from(new Set(
                        jobs
                            .filter(j => assignTargetIds.has(j.id))
                            .flatMap(j => ((j as any).requiredQualifications as string[]) ?? [])
                    ))
                }
            />

            {/* ── Frozen Zone Modal ── */}
            <FrozenZoneModal
                isOpen={frozenModalOpen}
                onClose={() => { setFrozenModalOpen(false); setFrozenPendingAction(null); }}
                onConfirm={handleFrozenZoneConfirm}
                woNumber={frozenPendingAction?.woNumber || ''}
                woTitle={frozenPendingAction?.woTitle || ''}
                originalDate={frozenPendingAction?.originalDate || ''}
                newDate={frozenPendingAction?.newDate || ''}
                daysFromNow={frozenPendingAction ? Math.ceil((new Date(frozenPendingAction.newDate).getTime() - new Date().setHours(0,0,0,0)) / (1000*60*60*24)) : 0}
                assetCriticality={frozenPendingAction?.criticality as any}
            />

            {/* ── Material Check Modal ── */}
            <MaterialCheckModal
                isOpen={materialModalOpen}
                onClose={() => { setMaterialModalOpen(false); setMaterialPendingAction(null); }}
                onScheduleAnyway={handleMaterialScheduleAnyway}
                onScheduleSuggested={handleMaterialScheduleSuggested}
                woNumber={materialPendingAction?.woNumber || ''}
                woTitle={materialPendingAction?.woTitle || ''}
                targetDate={materialPendingAction?.newDate || ''}
                checkResult={materialCheckResult || { ready: true, items: [] }}
            />

            {/* ── Print/Export Modal (GAP-F) ── */}
            <SchedulePrintModal
                isOpen={printModalOpen}
                onClose={() => setPrintModalOpen(false)}
                jobs={jobs}
                currentDate={currentDate}
                materialStatusMap={materialStatusMap}
            />
        </div>
    );
};

// ========================================
// 1. CALENDAR VIEW — Month / Week / Day
// ========================================

const CalendarView: React.FC<{
    currentDate: Date;
    setDate: (d: Date) => void;
    items: CalendarItem[];
    onItemDrop: (id: string, date: string, type: 'WO' | 'PM') => void;
    scale: CalendarScale;
    onNavigate: (dir: number) => void;
    dictionaries: DictionaryEntry[];
}> = ({ currentDate, setDate, items, onItemDrop, scale, onNavigate, dictionaries }) => {
    const navigate = useNavigate();
    const { showToast } = useToast();
    const [draggingId, setDraggingId] = useState<string | null>(null);

    // GAP-I: Mobile detection
    const [isMobile, setIsMobile] = useState(false);
    useEffect(() => {
        const check = () => setIsMobile(window.innerWidth < 640);
        check();
        window.addEventListener('resize', check);
        return () => window.removeEventListener('resize', check);
    }, []);

    const legend = getPriorityLegend(dictionaries);

    // Drag Handlers
    const onDragStart = (e: React.DragEvent, id: string, type: 'WO' | 'PM') => {
        setDraggingId(id);
        e.dataTransfer.setData('itemId', id);
        e.dataTransfer.setData('itemType', type);
        e.dataTransfer.effectAllowed = 'move';
    };

    const onDragOver = (e: React.DragEvent) => {
        e.preventDefault();
    };

    const onDropDate = (e: React.DragEvent, dateStr: string) => {
        e.preventDefault();
        const itemId = e.dataTransfer.getData('itemId');
        const itemType = e.dataTransfer.getData('itemType') as 'WO' | 'PM';
        if (itemId) onItemDrop(itemId, dateStr, itemType);
        setDraggingId(null);
    };

    const handleJobClick = (item: CalendarItem) => {
        if (item.type === 'WO') {
            navigate(`/work-orders/${item.id}`);
        } else {
            showToast(`Projected Recurring Job: ${item.title}. Drag this item to a date to schedule it firmly.`, 'info');
        }
    };

    // Title
    const getTitle = () => {
        if (scale === 'MONTH') return currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });
        if (scale === 'WEEK') {
            const weekDates = getWeekDates(currentDate);
            const from = weekDates[0];
            const to = weekDates[6];
            return `${from.toLocaleDateString('default', { month: 'short', day: 'numeric' })} – ${to.toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        }
        return currentDate.toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    };

    // Render a calendar item chip
    const renderItem = (item: CalendarItem) => {
        const isPM = item.type === 'PM';
        const pStyle = getPriorityStyle(item.priority, dictionaries);

        return (
            <div
                key={item.id}
                draggable
                onDragStart={(e) => onDragStart(e, item.id, item.type)}
                onClick={(e) => { e.stopPropagation(); handleJobClick(item); }}
                className={`text-[10px] px-1.5 py-1 rounded border cursor-pointer hover:shadow-md transition flex flex-col gap-0.5 ${isPM ? 'border-dashed opacity-80 hover:opacity-100 bg-white text-slate-500 border-slate-300 hover:border-blue-300 hover:text-blue-700' : ''
                    }`}
                style={!isPM ? {
                    backgroundColor: pStyle.hex + '18',
                    color: pStyle.hex,
                    borderColor: pStyle.hex + '40',
                } : undefined}
                title={`${isPM ? 'Projected: ' : ''}${item.title} (${item.assetName}) [${item.priority}]`}
            >
                <div className="flex items-center gap-1 truncate">
                    {isPM && <Repeat size={10} className="flex-shrink-0" />}
                    {!isPM && item.isFromPM && <Repeat size={9} className="flex-shrink-0 opacity-60" />}
                    <span className="font-bold">{item.displayId}</span>
                    <span className="opacity-75">·</span>
                    <span className="font-medium truncate">{item.assetName}</span>
                </div>
                <div className="truncate opacity-80 text-[9px] leading-tight">{item.title}</div>
            </div>
        );
    };

    // Unscheduled sidebar items
    const unscheduledJobs = items.filter(i => i.type === 'WO' && (!i.date));

    // GAP-I: Mobile vertical day list — shows 5 rolling days
    if (isMobile) {
        const mobileDays: Date[] = [];
        for (let i = -1; i < 4; i++) {
            const d = new Date(currentDate);
            d.setDate(d.getDate() + i);
            mobileDays.push(d);
        }

        return (
            <div className="flex flex-col h-full overflow-y-auto">
                {/* Mobile header */}
                <div className="p-3 flex items-center justify-between border-b border-slate-200 bg-white sticky top-0 z-10">
                    <button onClick={() => onNavigate(-1)} className="p-1.5 hover:bg-slate-100 rounded"><ChevronLeft size={18} /></button>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setDate(new Date())}
                            className="px-3 py-1 text-xs font-bold text-blue-600 bg-blue-50 rounded-full"
                        >Today</button>
                        <span className="text-sm font-bold text-slate-800">{getTitle()}</span>
                    </div>
                    <button onClick={() => onNavigate(1)} className="p-1.5 hover:bg-slate-100 rounded"><ChevronRight size={18} /></button>
                </div>

                {/* Vertical day list */}
                {mobileDays.map(day => {
                    const dateStr = formatDateStr(day);
                    const dayItems = items.filter(i => i.date === dateStr);
                    const todayHere = isToday(day);

                    return (
                        <div
                            key={dateStr}
                            onDragOver={onDragOver}
                            onDrop={(e) => onDropDate(e, dateStr)}
                            className={`border-b border-slate-100 p-3 ${todayHere ? 'bg-blue-50/40' : ''}`}
                        >
                            <div className="flex items-center gap-2 mb-2">
                                <div className={`text-xs font-bold uppercase ${todayHere ? 'text-blue-600' : 'text-slate-500'}`}>
                                    {day.toLocaleDateString('default', { weekday: 'short' })}
                                </div>
                                <div className={`text-sm font-bold ${todayHere ? 'bg-primary-600 text-white rounded-full w-7 h-7 flex items-center justify-center' : 'text-slate-800'}`}>
                                    {day.getDate()}
                                </div>
                                <div className="text-xs text-slate-400">{day.toLocaleDateString('default', { month: 'short' })}</div>
                                {todayHere && <span className="text-[9px] font-bold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded">TODAY</span>}
                                <span className="ml-auto text-[10px] text-slate-400">{dayItems.length} job{dayItems.length !== 1 ? 's' : ''}</span>
                            </div>
                            <div className="space-y-1.5 pl-2">
                                {dayItems.length === 0 && <div className="text-[11px] text-slate-300 py-3 text-center">No jobs</div>}
                                {dayItems.map(renderItem)}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    }

    return (
        <div className="flex h-full overflow-hidden">
            {/* Sidebar: Unscheduled */}
            <div className="hidden md:flex w-72 bg-slate-50 border-r border-slate-200 flex-col flex-shrink-0">
                <div className="p-4 border-b border-slate-200">
                    <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                        <Layers size={16} className="text-slate-500" /> Unscheduled Pool
                    </h3>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {unscheduledJobs.length === 0 && <div className="text-center text-xs text-slate-400 py-8">No unscheduled jobs.</div>}
                    {unscheduledJobs.map(item => {
                        const pStyle = getPriorityStyle(item.priority, dictionaries);
                        return (
                            <div
                                key={item.id}
                                draggable
                                onDragStart={(e) => onDragStart(e, item.id, item.type)}
                                onClick={() => handleJobClick(item)}
                                className="bg-white p-3 rounded border shadow-sm cursor-grab active:cursor-grabbing hover:border-blue-400 group"
                                style={{ borderLeftWidth: '3px', borderLeftColor: pStyle.hex }}
                            >
                                <div className="flex justify-between items-start mb-1">
                                    <div className="flex items-center gap-1">
                                        <span className="text-xs font-mono font-bold text-slate-500">{item.displayId}</span>
                                        {item.isFromPM && <Repeat size={10} className="text-blue-400" />}
                                    </div>
                                    <GripVertical size={14} className="text-slate-300 group-hover:text-slate-500" />
                                </div>
                                <div className="text-xs font-bold text-slate-800 truncate">{item.title}</div>
                                <div className="text-[10px] text-slate-500 mt-1 flex items-center gap-1.5">
                                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: pStyle.hex }}></span>
                                    {item.priority} • {item.assetName}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Main Calendar Grid */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* Header */}
                <div className="p-4 flex justify-between items-center border-b border-slate-200 bg-white">
                    <div className="flex items-center gap-3">
                        <button onClick={() => onNavigate(-1)} className="p-1.5 hover:bg-slate-100 rounded"><ChevronLeft size={18} /></button>
                        <button
                            onClick={() => setDate(new Date())}
                            className="px-3 py-1 text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-full transition"
                        >
                            Today
                        </button>
                        <button onClick={() => onNavigate(1)} className="p-1.5 hover:bg-slate-100 rounded"><ChevronRight size={18} /></button>
                        <h2 className="text-lg font-bold text-slate-900">{getTitle()}</h2>
                    </div>
                    <div className="hidden sm:flex items-center gap-3 text-xs">
                        {legend.map(p => (
                            <span key={p.code} className="flex items-center gap-1" title={p.description}>
                                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.hex }}></span>
                                {p.code}
                            </span>
                        ))}
                        <div className="h-4 w-px bg-slate-300 mx-1"></div>
                        <span className="flex items-center gap-1 text-slate-500"><Repeat size={12} /> Projected PM</span>
                    </div>
                </div>

                {/* Render based on scale */}
                {scale === 'MONTH' && <MonthGrid currentDate={currentDate} items={items} onDragOver={onDragOver} onDropDate={onDropDate} renderItem={renderItem} />}
                {scale === 'WEEK' && <WeekGrid currentDate={currentDate} items={items} onDragOver={onDragOver} onDropDate={onDropDate} renderItem={renderItem} dictionaries={dictionaries} />}
                {scale === 'DAY' && <DayGrid currentDate={currentDate} items={items} onDragOver={onDragOver} onDropDate={onDropDate} renderItem={renderItem} dictionaries={dictionaries} handleJobClick={handleJobClick} />}
            </div>
        </div>
    );
};

// ========================================
// MONTH GRID
// ========================================
const MonthGrid: React.FC<{
    currentDate: Date;
    items: CalendarItem[];
    onDragOver: (e: React.DragEvent) => void;
    onDropDate: (e: React.DragEvent, date: string) => void;
    renderItem: (item: CalendarItem) => React.ReactNode;
}> = ({ currentDate, items, onDragOver, onDropDate, renderItem }) => {
    const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
    const startDayOfWeek = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay();
    const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    const blanksArray = Array.from({ length: startDayOfWeek }, (_, i) => i);

    return (
        <>
            <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-200 flex-shrink-0">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                    <div key={d} className="calendar-day-header py-2 text-center text-xs font-bold text-slate-500 uppercase">{d}</div>
                ))}
            </div>
            <div className="flex-1 grid grid-cols-7 auto-rows-fr overflow-y-auto">
                {blanksArray.map(i => <div key={`blank-${i}`} className="bg-slate-50/30 border-b border-r border-slate-100"></div>)}
                {daysArray.map(day => {
                    const dateStr = formatDateStr(new Date(currentDate.getFullYear(), currentDate.getMonth(), day));
                    const dayItems = items.filter(i => i.date === dateStr);
                    const todayClass = isToday(new Date(currentDate.getFullYear(), currentDate.getMonth(), day)) ? 'bg-blue-50/40' : '';

                    return (
                        <div
                            key={day}
                            onDragOver={onDragOver}
                            onDrop={(e) => onDropDate(e, dateStr)}
                            className={`calendar-grid-cell min-h-[120px] border-b border-r border-slate-100 p-1 hover:bg-blue-50/30 transition-colors relative ${todayClass}`}
                        >
                            <span className={`text-xs font-bold p-1 ${isToday(new Date(currentDate.getFullYear(), currentDate.getMonth(), day))
                                ? 'text-white bg-primary-600 rounded-full w-6 h-6 flex items-center justify-center'
                                : dayItems.length > 0 ? 'text-slate-800' : 'text-slate-400'
                                }`}>{day}</span>
                            <div className="space-y-0.5 mt-1">
                                {dayItems.map(renderItem)}
                            </div>
                        </div>
                    );
                })}
            </div>
        </>
    );
};

// ========================================
// WEEK GRID
// ========================================
const WeekGrid: React.FC<{
    currentDate: Date;
    items: CalendarItem[];
    onDragOver: (e: React.DragEvent) => void;
    onDropDate: (e: React.DragEvent, date: string) => void;
    renderItem: (item: CalendarItem) => React.ReactNode;
    dictionaries: DictionaryEntry[];
}> = ({ currentDate, items, onDragOver, onDropDate, renderItem }) => {
    const weekDates = getWeekDates(currentDate);

    return (
        <>
            <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-200 flex-shrink-0">
                {weekDates.map((d, i) => {
                    const dayName = d.toLocaleDateString('default', { weekday: 'short' });
                    const dayNum = d.getDate();
                    const todayHighlight = isToday(d);
                    return (
                        <div key={i} className="py-3 text-center">
                            <div className="text-[10px] font-bold text-slate-500 uppercase">{dayName}</div>
                            <div className={`text-lg font-bold mt-0.5 ${todayHighlight ? 'text-blue-600' : 'text-slate-800'}`}>
                                {todayHighlight ? (
                                    <span className="bg-primary-600 text-white rounded-full w-8 h-8 inline-flex items-center justify-center">{dayNum}</span>
                                ) : dayNum}
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="flex-1 grid grid-cols-7 overflow-y-auto">
                {weekDates.map((d, i) => {
                    const dateStr = formatDateStr(d);
                    const dayItems = items.filter(item => item.date === dateStr);
                    return (
                        <div
                            key={i}
                            onDragOver={onDragOver}
                            onDrop={(e) => onDropDate(e, dateStr)}
                            className={`border-r border-slate-100 p-2 space-y-1.5 min-h-[400px] hover:bg-blue-50/20 transition ${isToday(d) ? 'bg-blue-50/30' : ''}`}
                        >
                            {dayItems.length === 0 && <div className="text-[10px] text-slate-300 text-center py-8">No jobs</div>}
                            {dayItems.map(item => (
                                <div key={item.id} className="text-xs">
                                    {renderItem(item)}
                                </div>
                            ))}
                        </div>
                    );
                })}
            </div>
        </>
    );
};

// ========================================
// DAY GRID
// ========================================
const DayGrid: React.FC<{
    currentDate: Date;
    items: CalendarItem[];
    onDragOver: (e: React.DragEvent) => void;
    onDropDate: (e: React.DragEvent, date: string) => void;
    renderItem: (item: CalendarItem) => React.ReactNode;
    dictionaries: DictionaryEntry[];
    handleJobClick: (item: CalendarItem) => void;
}> = ({ currentDate, items, onDragOver, onDropDate, dictionaries, handleJobClick }) => {
    const dateStr = formatDateStr(currentDate);
    const dayItems = items.filter(i => i.date === dateStr);

    const hours = Array.from({ length: 12 }, (_, i) => i + 6); // 6 AM to 5 PM

    return (
        <div className="flex-1 overflow-y-auto">
            {/* Day Summary Header */}
            <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-blue-50 to-white">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="text-lg font-bold text-slate-900">
                            {currentDate.toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric' })}
                        </div>
                        <div className="text-sm text-slate-500 mt-0.5">{dayItems.length} job{dayItems.length !== 1 ? 's' : ''} scheduled</div>
                    </div>
                    {isToday(currentDate) && (
                        <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-bold">TODAY</span>
                    )}
                </div>
            </div>

            {/* Time Slots */}
            <div
                onDragOver={onDragOver}
                onDrop={(e) => onDropDate(e, dateStr)}
                className="relative"
            >
                {hours.map(hour => (
                    <div key={hour} className="flex border-b border-slate-100 min-h-[60px]">
                        <div className="w-20 py-2 px-4 text-xs font-medium text-slate-400 border-r border-slate-100 flex-shrink-0 text-right">
                            {hour > 12 ? `${hour - 12} PM` : hour === 12 ? '12 PM' : `${hour} AM`}
                        </div>
                        <div className="flex-1 py-1 px-3">
                            {/* Place items visually — for now all items shown at top */}
                        </div>
                    </div>
                ))}
            </div>

            {/* All Jobs for the Day — Full Cards */}
            <div className="px-6 py-4 border-t-2 border-slate-200 bg-slate-50">
                <h3 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
                    <CalendarDays size={14} /> All Scheduled Work — {currentDate.toLocaleDateString('default', { month: 'short', day: 'numeric' })}
                </h3>
                {dayItems.length === 0 && (
                    <div className="text-center text-sm text-slate-400 py-8">No jobs scheduled for this day. Drag work from the unscheduled pool.</div>
                )}
                <div className="space-y-2">
                    {dayItems.map(item => {
                        const isPM = item.type === 'PM';
                        const pStyle = getPriorityStyle(item.priority, dictionaries);
                        return (
                            <div
                                key={item.id}
                                onClick={() => handleJobClick(item)}
                                className="bg-white rounded-lg border border-slate-200 p-3 flex items-center gap-4 hover:shadow-md transition cursor-pointer group"
                                style={{ borderLeftWidth: '4px', borderLeftColor: isPM ? '#A855F7' : pStyle.hex }}
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-xs font-mono font-bold text-slate-500">{item.displayId}</span>
                                        {isPM && <span className="text-[9px] font-bold bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full">PROJECTED PM</span>}
                                        {!isPM && item.isFromPM && <span className="text-[9px] font-bold bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full flex items-center gap-0.5"><Repeat size={8} />PM</span>}
                                    </div>
                                    <div className="text-sm font-bold text-slate-900 truncate">{item.title}</div>
                                    <div className="text-xs text-slate-500 mt-0.5">{item.assetName}</div>
                                </div>
                                <div className="flex-shrink-0 flex items-center gap-2">
                                    <span
                                        className="px-2 py-1 rounded text-[10px] font-bold"
                                        style={{ backgroundColor: pStyle.hex + '18', color: pStyle.hex }}
                                    >
                                        {item.priority}
                                    </span>
                                    <ArrowRight size={14} className="text-slate-300 group-hover:text-blue-500 transition" />
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

// (Old static GanttView removed — replaced by InteractiveGantt component)

// ========================================
// 3. BACKLOG VIEW
// ========================================

const BacklogView: React.FC<{ jobs: WorkOrder[], onJobsUpdate: (j: WorkOrder[]) => void, dictionaries: DictionaryEntry[], laborContacts?: Contact[] }> = ({ jobs, onJobsUpdate, dictionaries, laborContacts }) => {
    const navigate = useNavigate();
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [filterPriority, setFilterPriority] = useState('ALL');
    const [backlogSearch, setBacklogSearch] = useState('');

    const priorities = dictionaries
        .filter(d => d.type === 'PRIORITY' && d.active)
        .sort((a, b) => (a.sequence ?? 99) - (b.sequence ?? 99));

    const backlogJobs = jobs.filter(j => {
        if (j.status === 'CLOSED' || j.status === 'CANC') return false;
        if (filterPriority !== 'ALL' && j.priority !== filterPriority) return false;
        if (backlogSearch.trim()) {
            const q = backlogSearch.toLowerCase();
            return (j.title?.toLowerCase().includes(q) || j.woNumber?.toLowerCase().includes(q) || j.assetName?.toLowerCase().includes(q) || j.description?.toLowerCase().includes(q));
        }
        return true;
    });

    const toggleSelect = (id: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedIds(newSet);
    };

    // Assignment handled by parent's AssignmentModal — triggered via state lift
    const handleBulkAssign = () => {
        // Dispatch event to parent to open AssignmentModal
        const event = new CustomEvent('open-assignment-modal', { detail: { ids: Array.from(selectedIds) } });
        window.dispatchEvent(event);
    };

    const handleBulkPriority = (priority: string) => {
        const updated = jobs.map(j => selectedIds.has(j.id) ? { ...j, priority } : j);
        onJobsUpdate(updated);
        setSelectedIds(new Set());
    };

    return (
        <div className="flex flex-col h-full bg-white">
            {/* Toolbar */}
            <div className="p-4 border-b border-slate-200 flex flex-wrap justify-between items-center gap-3 bg-slate-50/50">
                <div className="flex flex-wrap gap-3 items-center">
                    <div className="relative">
                        <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                        <input type="text" placeholder="Search backlog..." value={backlogSearch} onChange={e => setBacklogSearch(e.target.value)} className="pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm bg-white" />
                    </div>
                    <select
                        className="p-2 border border-slate-300 rounded-lg text-sm bg-white"
                        value={filterPriority}
                        onChange={(e) => setFilterPriority(e.target.value)}
                    >
                        <option value="ALL">All Priorities</option>
                        {priorities.map(p => (
                            <option key={p.code} value={p.code}>{p.code} — {p.description}</option>
                        ))}
                    </select>
                </div>

                {selectedIds.size > 0 && (
                    <div className="flex gap-2 animate-in fade-in slide-in-from-right-4">
                        <span className="text-sm font-bold text-slate-600 self-center mr-2">{selectedIds.size} Selected</span>
                        <Button variant="secondary" size="sm" onClick={handleBulkAssign} leftIcon={<UserPlus size={16} />}>
                            Assign
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => handleBulkPriority('P1')} leftIcon={<Zap size={16} />} className="!text-red-600 hover:!bg-red-50">
                            Set P1 (Emergency)
                        </Button>
                    </div>
                )}
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto table-responsive">
                {/* ═══ Mobile Card View for Backlog (≤640px) ═══ */}
                <div className="mobile-cards">
                    {backlogJobs.map(job => {
                        const pStyle = getPriorityStyle(job.priority, dictionaries);
                        return (
                            <div
                                key={job.id}
                                onClick={() => navigate(`/work-orders/${job.id}`)}
                                className={`mobile-card-contact ${selectedIds.has(job.id) ? 'bg-blue-50' : ''}`}
                            >
                                <div className="mobile-card-contact-avatar" style={{ backgroundColor: pStyle.hex + '18', color: pStyle.hex }}>
                                    {job.priority?.charAt(0) || '?'}
                                </div>
                                <div className="mobile-card-contact-body">
                                    <div className="mobile-card-contact-name">{job.title}</div>
                                    <div className="mobile-card-contact-sub">
                                        {job.woNumber || job.id} · {job.assetName} · Due: {job.dueDate || 'N/A'}
                                    </div>
                                </div>
                                <div className="mobile-card-contact-badge">
                                    <span className="px-2 py-0.5 text-[10px] font-bold rounded-full" style={{ backgroundColor: pStyle.hex + '18', color: pStyle.hex }}>
                                        {job.priority}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* ═══ Desktop Table View for Backlog (≥640px) ═══ */}
                <div className="desktop-table">
                <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50 sticky top-0 z-10">
                        <tr>
                            <th className="w-12 px-6 py-3 text-left"><input type="checkbox" className="rounded" onChange={(e) => e.target.checked ? setSelectedIds(new Set(backlogJobs.map(j => j.id))) : setSelectedIds(new Set())} /></th>
                            <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase">Job ID</th>
                            <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase">Description</th>
                            <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase">Asset</th>
                            <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase">Priority</th>
                            <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase hidden sm:table-cell">Due Date</th>
                            <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase hidden md:table-cell">Assigned To</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-200">
                        {backlogJobs.map(job => {
                            const pStyle = getPriorityStyle(job.priority, dictionaries);
                            return (
                                <tr
                                    key={job.id}
                                    onClick={() => navigate(`/work-orders/${job.id}`)}
                                    className={`hover:bg-slate-50 transition cursor-pointer ${selectedIds.has(job.id) ? 'bg-blue-50' : ''}`}
                                >
                                    <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.has(job.id)}
                                            onChange={() => toggleSelect(job.id)}
                                            className="rounded text-blue-600 focus:ring-primary-500"
                                        />
                                    </td>
                                    <td className="px-6 py-4 text-sm font-mono font-medium text-blue-600">{job.id}</td>
                                    <td className="px-6 py-4">
                                        <div className="text-sm font-medium text-slate-900">{job.title}</div>
                                        <div className="text-xs text-slate-500">{job.description.substring(0, 50)}...</div>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-slate-600">{job.assetName}</td>
                                    <td className="px-6 py-4">
                                        <span
                                            className="px-2 py-1 rounded text-xs font-bold uppercase"
                                            style={{ backgroundColor: pStyle.hex + '18', color: pStyle.hex }}
                                        >
                                            {job.priority}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-slate-600 hidden sm:table-cell">{job.dueDate}</td>
                                    <td className="px-6 py-4 hidden md:table-cell">
                                        {job.assignedTo ? (
                                            <div className="flex items-center gap-2">
                                                <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-600">JD</div>
                                                <span className="text-sm text-slate-900">John Doe</span>
                                            </div>
                                        ) : (
                                            <span className="text-xs text-slate-400 italic">Unassigned</span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                </div>
            </div>
        </div>
    );
};
