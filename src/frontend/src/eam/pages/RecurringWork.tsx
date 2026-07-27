
import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Search, Plus, Filter, Save, Calendar, Clock, Gauge, FileText,
    Link as LinkIcon, Layers, Package, Users, ClipboardList,
    ChevronRight, Zap, Play, CheckCircle, AlertTriangle, Repeat, Shield,
    MoveUp, MoveDown, Trash2, Edit2, CheckSquare, Hash, AlignLeft, X, Loader2,
    Copy, Maximize2, Minimize2, Star, ArrowUpRight, History, ChevronDown, ChevronUp,
    PauseCircle, PlayCircle, BarChart3, Eye, TrendingUp, Upload, BookOpen
} from 'lucide-react';
import { AskRelanternButton } from '../components/AskRelanternButton';
import { aiContextService } from '../services/AIContextService';
import { MOCK_RECURRING_JOBS, MOCK_ASSETS, MOCK_DICTIONARIES, MOCK_WORK_ORDERS } from '../constants';
import { RecurringJob, Asset, WorkOrderType, JobJSA, JobLabor, JobInventory, JobFile, JobTask, InstructionBlock, Contact, JSAHazard, GenerationRule, LibraryTask } from '../types';
import { CreatePMModal } from '../components/modals/CreatePMModal';
import BulkImportModal from '../components/modals/BulkImportModal';
import { ConfirmationModal } from '../components/modals/ConfirmationModal';
import { DatabaseService } from '../services/DatabaseService';
import { buildPMStrategy } from '../lib/pmStrategy';
import { emptyResult, tally, errMessage } from '../services/importTypes';
import { parseDateValue } from '../services/assetTemplates';
import { ImageGallery } from '../components/ui/ImageGallery';
import { NotificationService } from '../services/NotificationService';
import { ProcedureBuilder } from '../components/ProcedureBuilder';
import { SearchableDropdown } from '../components/ui/SearchableDropdown';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { useAuth } from '../contexts/AuthContext';
import type { ImportType } from '../services/assetTemplates';

type TabId = 'details' | 'assets' | 'tasks' | 'jsa' | 'labor' | 'inventory' | 'files' | 'history';
type StatusFilter = 'ALL' | 'ACTIVE' | 'PAUSED' | 'DRAFT' | 'EXPIRED';
type GroupBy = 'none' | 'status' | 'jobType' | 'rcmStrategy';

// --- Helpers ---
const getRiskLevel = (score: number): 'Critical' | 'High' | 'Medium' | 'Low' => {
    if (score >= 20) return 'Critical';
    if (score >= 15) return 'High';
    if (score >= 8) return 'Medium';
    return 'Low';
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
    const { user } = useAuth();
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
    const [urlParams] = useSearchParams();
    const [searchQuery, setSearchQuery] = useState(urlParams.get('q') || '');
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
    const [calendarDate, setCalendarDate] = useState(new Date());

    // Load data on mount
    useEffect(() => {
        loadStrategies();
        loadDictionaries();
        loadContacts();
        loadInventoryItems();
        loadAssets();
    }, []);

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
                description: pm.description || pm.title,
                jobDescription: pm.description || pm.title,
                status: pm.status,
                assignedAssets: (pm.assigned_assets && Array.isArray(pm.assigned_assets) && pm.assigned_assets.length > 0)
                    ? pm.assigned_assets
                    : pm.asset_id ? [{ assetId: pm.asset_id, lastCompletedDate: pm.last_generated_date || '', lastReadingValue: 0 }] : [],
                scheduleType: pm.schedule_type,
                frequencyInterval: pm.frequency_interval,
                frequencyUnit: pm.frequency_unit,
                leadTimeDays: pm.lead_time_days || 7,
                jobType: pm.job_type,
                priority: pm.priority_code,
                estDuration: pm.est_duration || 0,
                estDowntime: pm.est_downtime || 0,
                nextDueDate: pm.next_due_date || '',
                lastGeneratedDate: pm.last_generated_date || '',
                // Failure Impact (ISO 14224 §B.2.5)
                localImpact: pm.local_impact || '',
                plantWideImpact: pm.plant_wide_impact || '',
                tasks: [],
                jsa: { id: 'jsa-mock', status: 'DRAFT', hazards: [], permits: [], signoffs: [] },
                labor: [],
                inventory: [],
                createdById: 'system',
                createdAt: new Date().toISOString()
            }));

            setJobs(mappedPMs);
        } catch (e) {
            console.error("Failed to load PMs", e);
        }
    };

    // --- Generator Logic (Mock) ---
    // ... (rest of generator logic)

    // ... inside return ...



    // --- Generator Logic ---
    const [generateDate, setGenerateDate] = useState(new Date().toISOString().split('T')[0]);
    const [generatedPreview, setGeneratedPreview] = useState<any[]>([]);
    const [selectedGenItems, setSelectedGenItems] = useState<Set<number>>(new Set());
    const [generating, setGenerating] = useState(false);
    const [generationResult, setGenerationResult] = useState<string | null>(null);

    const handleRunGenerator = () => {
        setGenerationResult(null);
        const processUpTo = new Date(generateDate);
        processUpTo.setHours(23, 59, 59, 999);
        const newJobs: any[] = [];

        console.log(`[Generator] Running for date: ${generateDate}, processing ${jobs.length} PMs`);

        jobs.forEach(rj => {
            const statusUpper = (rj.status || '').toUpperCase();
            if (statusUpper !== 'ACTIVE') {
                console.log(`[Generator] SKIP ${rj.code}: status='${rj.status}' (not ACTIVE)`);
                return;
            }
            if (rj.assignedAssets.length === 0) {
                console.log(`[Generator] SKIP ${rj.code}: no assigned assets`);
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
                    const mostRecent = new Date(Math.max(...completedDates));
                    const unit = (rj.frequencyUnit || 'months').toLowerCase();
                    const interval = rj.frequencyInterval;
                    if (unit === 'days') mostRecent.setDate(mostRecent.getDate() + interval);
                    else if (unit === 'weeks') mostRecent.setDate(mostRecent.getDate() + interval * 7);
                    else if (unit === 'months') mostRecent.setMonth(mostRecent.getMonth() + interval);
                    else if (unit === 'years') mostRecent.setFullYear(mostRecent.getFullYear() + interval);
                    nextDue = mostRecent.toISOString();
                }
            }

            const isDue = !nextDue || new Date(nextDue) <= processUpTo;
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
                        newJobs.push({
                            pmId: rj.id,
                            jobCode: rj.code,
                            assetId: ra.assetId,
                            asset: asset?.tag || asset?.name || 'Unknown Asset',
                            desc: rj.jobDescription || rj.description,
                            dueDate: nextDue ? new Date(nextDue).toLocaleDateString() : generateDate,
                            status: 'Scheduled',
                            triggerType: 'TIME',
                            reason: `Due per ${rj.frequencyInterval} ${rj.frequencyUnit} cycle`
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
        setSelectedGenItems(new Set(newJobs.map((_, i) => i)));

        if (newJobs.length === 0) {
            showToast('No PMs are due by the selected date', 'info');
        }
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
        const selectedItems = generatedPreview.filter((_: any, i: number) => selectedGenItems.has(i));

        // Group items by PM to coordinate date advancement
        const pmGroups: Record<string, typeof selectedItems> = {};
        for (const item of selectedItems) {
            if (!pmGroups[item.pmId]) pmGroups[item.pmId] = [];
            pmGroups[item.pmId].push(item);
        }

        for (const [pmId, items] of Object.entries(pmGroups)) {
            // Skip mock PMs (they start with 'pm-')
            if (pmId.startsWith('pm-')) {
                created += items.length;
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
                    // The WO exists, but part of its plan may not have copied —
                    // a technician must not receive it believing it is complete.
                    const missing = (wo as any)?.__copyFailures as string[] | undefined;
                    if (missing?.length) incomplete.push(`${(wo as any).wo_number ?? pmId}: ${missing.join(', ')}`);
                } catch (e) {
                    console.error(`Failed to generate WO for PM ${pmId} / asset ${item.asset}:`, e);
                    errors++;
                }
            }
        }

        setGenerating(false);
        let resultMsg = `Created ${created} Work Order${created !== 1 ? 's' : ''}${errors > 0 ? `, ${errors} failed` : ''} successfully.`;
        if (incomplete.length > 0) {
            resultMsg += ` ${incomplete.length} generated without part of their plan — ${incomplete.join('; ')}.`;
        }
        setGenerationResult(resultMsg);
        showToast(resultMsg, errors > 0 || incomplete.length > 0 ? 'warning' : 'success');
        // Reload strategies to reflect updated next_due_date
        await loadStrategies();
    };

    const handleJobUpdate = (updates: Partial<RecurringJob>) => {
        if (!selectedJob) return;
        const updatedJob = { ...selectedJob, ...updates };
        setSelectedJob(updatedJob);
        setJobs(prev => prev.map(j => j.id === updatedJob.id ? updatedJob : j));
        setSaveStatus('idle');
    };

    const handleDuplicate = async () => {
        if (!selectedJob) return;
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
        // Search text
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter(j =>
                j.code?.toLowerCase().includes(q) ||
                (j.jobDescription || j.description || '').toLowerCase().includes(q) ||
                j.jobType?.toLowerCase().includes(q)
            );
        }
        return result;
    }, [jobs, searchQuery, statusFilter]);

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
        setJobs(prev => prev.map(j => selectedIds.has(j.id) ? { ...j, status: newStatus } : j));
        showToast(`${selectedIds.size} job(s) set to ${newStatus}`, 'success');
        setSelectedIds(new Set());
    };

    const handleBulkGenerate = () => {
        setShowGenerator(true);
        // Pre-load generator with selected items only
    };

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
                lead_time_days: selectedJob.leadTimeDays,
                job_type: selectedJob.jobType,
                priority_code: selectedJob.priority,
                est_duration: selectedJob.estDuration || 0,
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
                const mostRecent = new Date(Math.max(...completedDates));
                const unit = (selectedJob.frequencyUnit || 'months').toLowerCase();
                const interval = selectedJob.frequencyInterval;
                if (unit === 'days') mostRecent.setDate(mostRecent.getDate() + interval);
                else if (unit === 'weeks') mostRecent.setDate(mostRecent.getDate() + interval * 7);
                else if (unit === 'months') mostRecent.setMonth(mostRecent.getMonth() + interval);
                else if (unit === 'years') mostRecent.setFullYear(mostRecent.getFullYear() + interval);
                headerPayload.next_due_date = mostRecent.toISOString();
                // Update local state so generator sees it immediately
                const updatedJob = { ...selectedJob, nextDueDate: mostRecent.toISOString() };
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

        // Group operations by the schedule they belong to, preserving sheet order.
        interface Op { row: number; data: Record<string, string> }
        const opsByPm = new Map<string, Op[]>();
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const rowNo = Number(r.__row) || i + 2;
            const code = (r['pmcode'] || '').trim();
            if (!code) { tally(res, { row: rowNo, status: 'failed', reason: 'Missing pmCode' }); continue; }
            const key = code.toUpperCase();
            const matches = pmsByCode.get(key);
            if (!matches || matches.length === 0) {
                tally(res, { row: rowNo, key: code, status: 'failed', reason: `PM schedule "${code}" not found — import schedules first` });
                continue;
            }
            if (matches.length > 1) {
                tally(res, { row: rowNo, key: code, status: 'failed', reason: `PM code "${code}" matches ${matches.length} schedules — cannot tell which` });
                continue;
            }
            (opsByPm.get(key) ?? opsByPm.set(key, []).get(key)!).push({ row: rowNo, data: r });
        }

        for (const [key, ops] of opsByPm) {
            const pm = pmsByCode.get(key)![0];
            // Operation numbers order the plan; blanks keep sheet order behind them.
            const sorted = [...ops].sort((a, b) => {
                const an = parseInt(a.data['operationno'] || '', 10);
                const bn = parseInt(b.data['operationno'] || '', 10);
                if (isNaN(an) && isNaN(bn)) return a.row - b.row;
                if (isNaN(an)) return 1;
                if (isNaN(bn)) return -1;
                return an - bn;
            });

            const tasks = sorted.map((op, idx) => {
                const d = op.data;
                const seq = (idx + 1) * 10;
                const centreCode = (d['workcentre'] || '').toUpperCase();
                const centreId = centreCode ? centreByCode.get(centreCode) : undefined;
                if (centreCode && !centreId) {
                    res.notes!.push(`Row ${op.row}: work centre "${d['workcentre']}" not found — operation imported without it.`);
                }
                const longText = (d['longtext'] || '').trim();
                return {
                    id: `imp-${Date.now()}-${key}-${idx}`,
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
                } as unknown as JobTask;
            });

            try {
                const existing = await db.getPMTemplates(pm.id).catch(() => null);
                const templates = { ...(existing || {}), tasks };
                await db.savePMTemplates(pm.id, templates);
                const replaced = (existing?.tasks ?? []).length;
                if (replaced > 0) {
                    res.notes!.push(`${pm.code}: replaced an existing ${replaced}-step plan.`);
                }
                sorted.forEach(op => tally(res, { row: op.row, key: pm.code, status: 'inserted' }));
            } catch (e: unknown) {
                sorted.forEach(op => tally(res, { row: op.row, key: pm.code, status: 'failed', reason: errMessage(e) }));
            }
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
        <div className="flex h-[calc(100vh-6rem)] gap-6 relative">
            {/* List Sidebar */}
            <div className={`flex flex-col bg-white rounded-card shadow-card border border-slate-200 overflow-hidden transition-all duration-300 ${isFullscreen ? 'hidden' : selectedJob ? 'w-1/3 hidden lg:flex' : 'w-full'}`}>
                <div className="p-4 border-b border-slate-200 flex justify-between items-center">
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
                            onClick={() => setShowGenerator(true)}
                            className="bg-primary-600 hover:bg-primary-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2 shadow-sm"
                            title="Run Job Generator"
                        >
                            <Zap size={16} /> <span className="hidden xl:inline">Generate</span>
                        </button>
                        <button onClick={() => setIsCreatePMOpen(true)} className="bg-primary-600 hover:bg-primary-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2">
                            <Plus size={16} /> New
                        </button>
                    </div>
                </div>

                <div className="p-4 border-b border-slate-200 bg-slate-50 space-y-3">
                    <div className="relative">
                        <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                        <input
                            type="text"
                            placeholder="Search PMs..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm"
                        />
                    </div>
                    {/* Phase 4A — Status Filter Pills */}
                    <div className="flex gap-1.5 flex-wrap">
                        {(['ALL', 'ACTIVE', 'PAUSED', 'DRAFT', 'EXPIRED'] as StatusFilter[]).map(s => (
                            <button
                                key={s}
                                onClick={() => { setStatusFilter(s); setSelectedIds(new Set()); }}
                                className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase border transition-all flex items-center gap-1.5 ${statusFilter === s
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
                    {/* Phase 4A — GroupBy + Select All */}
                    <div className="flex justify-between items-center">
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

                {/* Phase 5B — PM Calendar toggle */}
                <div className="px-4 py-2 border-b border-slate-200 bg-white">
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
                    {(Object.entries(groupedJobs) as [string, RecurringJob[]][]).map(([groupLabel, groupItems]) => (
                        <div key={groupLabel}>
                            {groupBy !== 'none' && (
                                <div className="px-4 py-2 bg-slate-100 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider sticky top-0 z-10">
                                    {groupLabel} ({groupItems.length})
                                </div>
                            )}
                            {groupItems.map(job => {
                                const nextDue = (job as any).next_due_date || (job as any).nextDueDate;
                                const isOverdue = nextDue && new Date(nextDue) < new Date();
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
                                                </div>
                                            </div>
                                            <h3 className="text-sm font-bold text-slate-900 mb-1 line-clamp-1">{job.jobDescription || job.description}</h3>
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
                                                    ) : (
                                                        <span className="flex items-center gap-1 font-medium text-emerald-600">
                                                            <Calendar size={11} />
                                                            {new Date(nextDue).toLocaleDateString()}
                                                        </span>
                                                    )
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>

                {/* Phase 4A — Bulk Action Bar */}
                {selectedIds.size > 0 && (
                    <div className="p-3 border-t border-slate-200 bg-blue-50 flex items-center justify-between gap-3 animate-in slide-in-from-bottom duration-200">
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
                <div className="flex-1 bg-white rounded-xl shadow-lg border border-slate-200 flex flex-col overflow-hidden">
                    {/* Header */}
                    <div className="p-6 border-b border-slate-200 flex justify-between items-start bg-white">
                        <div>
                            <div className="flex items-center gap-3 mb-1">
                                <h1 className="text-2xl font-bold text-slate-900">{selectedJob.code}</h1>
                                <span className={`${selectedJob?.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : selectedJob?.status === 'PAUSED' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'} text-xs font-bold px-2 py-0.5 rounded uppercase`}>
                                    {dictionaries.find(d => d.type === 'STATUS_CODE' && d.code === selectedJob?.status)?.description || selectedJob?.status || 'Unknown'}
                                </span>
                            </div>
                            <p className="text-slate-500">{selectedJob.jobDescription || selectedJob.description}</p>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                            <AskRelanternButton
                                contextType="recurringWork"
                                contextSummary={aiContextService.buildRecurringWorkContext({
                                    totalPMs: jobs.length,
                                    activePMs: jobs.filter(j => j.status === 'ACTIVE').length,
                                    suspendedPMs: jobs.filter(j => j.status === 'PAUSED').length,
                                    overdueCount: jobs.filter(j => (j as any).nextDueDate && new Date((j as any).nextDueDate) < new Date()).length,
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
                            <button onClick={() => setSelectedJob(null)} className="lg:hidden text-slate-500 p-2"><Filter /></button>
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
                                className="px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-60"
                            >
                                {duplicating ? <Loader2 size={16} className="animate-spin" /> : <Copy size={16} />}
                                <span className="hidden xl:inline">Duplicate</span>
                            </button>
                            <button
                                onClick={handleDelete}
                                disabled={deleting}
                                title="Delete strategy"
                                className="px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 bg-red-50 hover:bg-red-100 text-red-600 disabled:opacity-60"
                            >
                                {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                                <span className="hidden xl:inline">Delete</span>
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition ${saveStatus === 'saved' ? 'bg-green-600 text-white' :
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
                                className="px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700"
                            >
                                {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                            </button>
                        </div>
                    </div>

                    {/* Tabs */}
                    <div className="px-6 border-b border-slate-200 bg-slate-50/50">
                        <div className="flex space-x-6 overflow-x-auto">
                            {TABS.map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`flex items-center gap-2 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === tab.id
                                        ? 'border-blue-600 text-blue-600 bg-white'
                                        : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                                        }`}
                                >
                                    <tab.icon size={16} />
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-6 bg-slate-50/30">
                        {activeTab === 'details' && <DetailsTab job={selectedJob} onUpdate={handleJobUpdate} dictionaries={dictionaries} jobs={jobs} assets={dbAssets.length > 0 ? dbAssets : MOCK_ASSETS} />}
                        {activeTab === 'assets' && <AssetsTab job={selectedJob} onUpdate={handleJobUpdate} onNavigateToAsset={(assetId) => { window.location.href = `/assets?id=${assetId}`; }} assets={dbAssets.length > 0 ? dbAssets : MOCK_ASSETS} />}
                        {activeTab === 'tasks' && <TasksTab job={selectedJob} onUpdate={handleJobUpdate} />}
                        {activeTab === 'jsa' && <JSATab job={selectedJob} onUpdate={handleJobUpdate} />}
                        {activeTab === 'labor' && <LaborTab job={selectedJob} onUpdate={handleJobUpdate} contacts={contacts} dictionaries={dictionaries} />}
                        {activeTab === 'inventory' && <InventoryTab job={selectedJob} onUpdate={handleJobUpdate} inventoryItems={inventoryItems} dictionaries={dictionaries} />}
                        {activeTab === 'files' && <FilesTab job={selectedJob} onUpdate={handleJobUpdate} />}
                        {activeTab === 'history' && <HistoryTab job={selectedJob} jobs={jobs} />}
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
                            <button onClick={() => setShowGenerator(false)} className="text-white/70 hover:text-white p-2 hover:bg-blue-500 rounded-full transition">X</button>
                        </div>

                        <div className="p-6 bg-slate-50 border-b border-slate-200 flex gap-4 items-end">
                            <div className="flex-1">
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Process Up To</label>
                                <input
                                    type="date"
                                    value={generateDate}
                                    onChange={(e) => setGenerateDate(e.target.value)}
                                    className="w-full p-2 border border-slate-300 rounded-lg"
                                />
                            </div>
                            <div className="flex-1">
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Filter by Parent (Area)</label>
                                <select className="w-full p-2 border border-slate-300 rounded-lg">
                                    <option value="">All Areas</option>
                                </select>
                            </div>
                            <button
                                onClick={handleRunGenerator}
                                className="px-6 py-2 bg-primary-600 text-white font-bold rounded-lg hover:bg-primary-500 shadow-md flex items-center gap-2"
                            >
                                <Play size={16} fill="currentColor" /> Run Analysis
                            </button>
                        </div>

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
                                                                <input
                                                                    type="checkbox"
                                                                    className="rounded"
                                                                    checked={items.every((_: any, i: number) => selectedGenItems.has(generatedPreview.indexOf(items[i])))}
                                                                    onChange={(e) => {
                                                                        const next = new Set(selectedGenItems);
                                                                        items.forEach((it: any) => {
                                                                            const idx = generatedPreview.indexOf(it);
                                                                            if (e.target.checked) next.add(idx); else next.delete(idx);
                                                                        });
                                                                        setSelectedGenItems(next);
                                                                    }}
                                                                />
                                                            </th>
                                                            <th className="p-3 text-left text-xs font-bold text-slate-500 uppercase">PM Code</th>
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
                                                                            onChange={(e) => {
                                                                                const next = new Set(selectedGenItems);
                                                                                if (e.target.checked) next.add(idx); else next.delete(idx);
                                                                                setSelectedGenItems(next);
                                                                            }}
                                                                            className="rounded text-blue-600"
                                                                        />
                                                                    </td>
                                                                    <td className="p-3 text-sm font-bold text-slate-900">{item.jobCode}</td>
                                                                    <td className="p-3 text-sm text-slate-600 font-medium">{item.asset}</td>
                                                                    <td className="p-3 text-sm text-slate-600">{item.desc}</td>
                                                                    {triggerType === 'READING' && (
                                                                        <td className="p-3 text-sm font-mono text-amber-700 font-bold">{item.lastReading ?? '-'}</td>
                                                                    )}
                                                                    <td className={`p-3 text-sm font-medium ${triggerType === 'READING' ? 'text-amber-600' : 'text-green-600'}`}>{item.reason}</td>
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
                                    <p>Select a date and click "Run Analysis" to see jobs that are due.</p>
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
                                <button onClick={() => { setShowGenerator(false); setGeneratedPreview([]); setGenerationResult(null); }} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium">
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
                onSave={() => loadStrategies()}
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

const DetailsTab: React.FC<{ job: RecurringJob, onUpdate: (u: Partial<RecurringJob>) => void, dictionaries?: any[], jobs?: RecurringJob[], assets?: Asset[] }> = ({ job, onUpdate, dictionaries = [], jobs = [], assets = [] }) => {
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

    // PM Compliance (computed mock — in production, sourced from pm_compliance_log)
    const compliance = job.complianceData || { scheduledCount: 0, executedCount: 0, compliancePct: 0 };
    const greenThreshold = compliance.greenThreshold ?? 95;
    const yellowThreshold = compliance.yellowThreshold ?? 85;
    const complianceColor = compliance.compliancePct >= greenThreshold ? 'green' : compliance.compliancePct >= yellowThreshold ? 'yellow' : 'red';

    return (
        <div className="space-y-6 animate-in fade-in">
            {/* Criticality Badge */}
            {criticality && (
                <div className={`flex items-center gap-3 p-3 rounded-lg border text-sm font-medium ${criticality === 'A' ? 'bg-red-50 border-red-200 text-red-800' :
                    criticality === 'B' ? 'bg-amber-50 border-amber-200 text-amber-800' :
                        'bg-green-50 border-green-200 text-green-800'
                    }`}>
                    <span className="text-lg">{criticality === 'A' ? '🔴' : criticality === 'B' ? '🟡' : '🟢'}</span>
                    <span>
                        <strong>Criticality {criticality}</strong> — {
                            criticality === 'A' ? 'Safety Critical (ISO 14224)' :
                                criticality === 'B' ? 'Production Critical' : 'General'
                        }
                        {primaryAsset && <span className="text-xs ml-2 opacity-75">({primaryAsset.tag || primaryAsset.name})</span>}
                    </span>
                    {criticality === 'A' && !job.jsa?.hazards?.length && (
                        <span className="ml-auto text-xs bg-red-100 text-red-700 px-2 py-1 rounded font-bold flex items-center gap-1">
                            <AlertTriangle size={12} /> JSA Required Before Activation
                        </span>
                    )}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Left Column: Scheduling Settings */}
                <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm space-y-6">
                    <div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="col-span-2">
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Job Description</label>
                                <textarea
                                    value={job.jobDescription || job.description}
                                    onChange={(e) => onUpdate({ jobDescription: e.target.value })}
                                    className="w-full p-2 border border-slate-300 rounded-lg text-sm h-20 resize-none focus:ring-2 focus:ring-primary-500"
                                    placeholder="Text to appear on the generated Work Order..."
                                />
                            </div>
                            <div className="col-span-2">
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Status</label>
                                <div className="flex gap-2 flex-wrap">
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
                                                className={`px-4 py-1.5 rounded-full text-xs font-bold border transition-all ${
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
                            <div className="col-span-2">
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Schedule Basis</label>
                                <div className="flex gap-4">
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
                                <input type="number" value={job.leadTimeDays} onChange={(e) => onUpdate({ leadTimeDays: parseFloat(e.target.value) })} className="w-full p-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500" />
                            </div>

                            <div className="col-span-2 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Hierarchy / Suppression</label>
                                <select
                                    value={job.parentId || ''}
                                    onChange={(e) => onUpdate({ parentId: e.target.value })}
                                    className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-primary-500"
                                >
                                    <option value="">(None) - Independent Schedule</option>
                                    {jobs.filter(j => j.id !== job.id).map(j => (
                                        <option key={j.id} value={j.id}>{j.code} - {j.jobDescription || j.description}</option>
                                    ))}
                                </select>
                                <p className="text-[10px] text-slate-500 mt-2">If a Parent Job is due within the suppression window, this job will be skipped.</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Column: Default Job Settings */}
                <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm space-y-6">
                    <div>
                        <div className="grid grid-cols-2 gap-4">
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
                                <input type="number" value={job.estDuration} onChange={(e) => onUpdate({ estDuration: parseFloat(e.target.value) })} className="w-full p-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500" />
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
            <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm">
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

                {/* Failure Effects (ISO 14224 §B.2.5) */}
                <div className="mt-4 pt-4 border-t border-slate-100">
                    <h4 className="text-xs font-bold text-slate-600 uppercase mb-3 flex items-center gap-1.5">
                        <AlertTriangle size={13} className="text-amber-500" /> Failure Effects (ISO 14224)
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                </div>

                {criticality === 'A' && (!job.rcmStrategy || !job.functionalFailureCode || !job.failureModeCode) && (
                    <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700 flex items-center gap-2">
                        <AlertTriangle size={14} /> <strong>Criticality A:</strong> RCM strategy, functional failure, and failure mode are mandatory for safety-critical assets.
                    </div>
                )}
            </div>

            {/* PM Compliance KPI (ISO 55000) */}
            <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm">
                <h3 className="font-bold text-slate-800 border-b border-slate-100 pb-2 mb-4 flex items-center gap-2">
                    📊 PM Compliance (ISO 55000)
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                        <p className="text-xs text-slate-500 uppercase font-bold mb-2">Last 12 Months</p>
                        <div className="flex items-end gap-3">
                            <span className={`text-3xl font-black ${complianceColor === 'green' ? 'text-green-600' :
                                complianceColor === 'yellow' ? 'text-amber-500' : 'text-red-600'
                                }`}>
                                {compliance.scheduledCount > 0 ? `${Math.round(compliance.compliancePct)}%` : '—'}
                            </span>
                            {compliance.scheduledCount > 0 && (
                                <span className="text-xs text-slate-500 mb-1">({compliance.executedCount}/{compliance.scheduledCount} on-time)</span>
                            )}
                        </div>
                        {compliance.scheduledCount > 0 && (
                            <div className="w-full h-2 bg-slate-100 rounded-full mt-2 overflow-hidden">
                                <div
                                    className={`h-full rounded-full transition-all ${complianceColor === 'green' ? 'bg-green-500' :
                                        complianceColor === 'yellow' ? 'bg-amber-400' : 'bg-red-500'
                                        }`}
                                    style={{ width: `${Math.min(compliance.compliancePct, 100)}%` }}
                                />
                            </div>
                        )}
                        {compliance.scheduledCount === 0 && (
                            <p className="text-xs text-slate-400 mt-1">No compliance history yet</p>
                        )}
                    </div>
                    <div>
                        <p className="text-xs text-slate-500 uppercase font-bold mb-2">Last Completed</p>
                        <p className="text-sm font-medium text-slate-800">
                            {compliance.lastCompletedDate || 'Never'}
                        </p>
                        {compliance.lastWOId && (
                            <p className="text-xs text-blue-600 mt-0.5">{compliance.lastWOId}</p>
                        )}
                    </div>
                    <div>
                        <p className="text-xs text-slate-500 uppercase font-bold mb-2">Next Due</p>
                        <p className="text-sm font-medium text-slate-800">
                            {job.nextDueDate || 'Not computed'}
                        </p>
                        {job.nextDueDate && (() => {
                            const daysUntil = Math.ceil((new Date(job.nextDueDate).getTime() - Date.now()) / 86400000);
                            return (
                                <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-bold ${daysUntil < 0 ? 'bg-red-100 text-red-700' :
                                    daysUntil <= job.leadTimeDays ? 'bg-amber-100 text-amber-700' :
                                        'bg-green-100 text-green-700'
                                    }`}>
                                    {daysUntil < 0 ? `${Math.abs(daysUntil)}d OVERDUE` :
                                        daysUntil === 0 ? 'Due Today' :
                                            `${daysUntil}d remaining`}
                                </span>
                            );
                        })()}
                    </div>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100">
                    <div className="flex items-center gap-4 text-[10px] text-slate-500 mb-2">
                        <span>🟢 ≥ {greenThreshold}% Excellent</span>
                        <span>🟡 {yellowThreshold}–{greenThreshold - 1}% Acceptable</span>
                        <span>🔴 &lt; {yellowThreshold}% Below Target</span>
                        <span className="ml-auto">Oil &amp; Gas benchmark: ≥ 90%</span>
                    </div>
                    <div className="flex items-center gap-4 mt-2">
                        <label className="text-[10px] uppercase font-bold text-slate-500 flex items-center gap-1">
                            🟢 Threshold
                            <input
                                type="number" min={0} max={100}
                                value={greenThreshold}
                                onChange={e => {
                                    const val = Math.min(100, Math.max(0, parseInt(e.target.value) || 0));
                                    onUpdate({ complianceData: { ...compliance, greenThreshold: val } });
                                }}
                                className="w-14 text-xs p-1 border border-slate-300 rounded text-center ml-1"
                            />
                            %
                        </label>
                        <label className="text-[10px] uppercase font-bold text-slate-500 flex items-center gap-1">
                            🟡 Threshold
                            <input
                                type="number" min={0} max={100}
                                value={yellowThreshold}
                                onChange={e => {
                                    const val = Math.min(100, Math.max(0, parseInt(e.target.value) || 0));
                                    onUpdate({ complianceData: { ...compliance, yellowThreshold: val } });
                                }}
                                className="w-14 text-xs p-1 border border-slate-300 rounded text-center ml-1"
                            />
                            %
                        </label>
                        <span className="text-[10px] text-slate-400 ml-auto">Admin-configurable per job</span>
                    </div>
                </div>
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
        <div className="space-y-6">
            {/* Auto-Assignment Rules Engine (Phase 5C) */}
            <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
                <div className="flex justify-between items-center mb-4">
                    <div>
                        <h3 className="font-bold text-slate-800 text-sm uppercase">Auto-Assignment Rules</h3>
                        <p className="text-[10px] text-slate-400 mt-0.5">Define rules to automatically link matching assets to this PM strategy.</p>
                    </div>
                    <button onClick={runRules} className="text-xs bg-primary-600 text-white px-3 py-1.5 rounded-lg hover:bg-primary-500 font-bold shadow-sm flex items-center gap-1.5">
                        <TrendingUp size={12} /> Run Rules Now
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

                {/* Add New Rule */}
                <div className="flex gap-2 items-end bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <div className="flex-1">
                        <label className="text-[10px] uppercase font-bold text-slate-500">Field</label>
                        <select value={newRule.field} onChange={e => setNewRule(p => ({ ...p, field: e.target.value as any }))} className="w-full text-xs p-1.5 border rounded">
                            <option value="assetType">Asset Type</option>
                            <option value="costCentre">Cost Centre</option>
                            <option value="criticality">Criticality</option>
                            <option value="tag">Asset Tag</option>
                        </select>
                    </div>
                    <div className="flex-1">
                        <label className="text-[10px] uppercase font-bold text-slate-500">Operator</label>
                        <select value={newRule.operator} onChange={e => setNewRule(p => ({ ...p, operator: e.target.value as any }))} className="w-full text-xs p-1.5 border rounded">
                            <option value="equals">Equals</option>
                            <option value="contains">Contains</option>
                            <option value="startsWith">Starts With</option>
                        </select>
                    </div>
                    <div className="flex-1">
                        <label className="text-[10px] uppercase font-bold text-slate-500">Value</label>
                        <input type="text" value={newRule.value} onChange={e => setNewRule(p => ({ ...p, value: e.target.value }))} className="w-full text-xs p-1.5 border rounded" placeholder="e.g. Pump" />
                    </div>
                    <button onClick={addRule} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-800 text-white rounded text-xs font-bold shadow-sm">Add Rule</button>
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
                            const nextDue = ra.lastCompletedDate ? new Date(new Date(ra.lastCompletedDate).setMonth(new Date(ra.lastCompletedDate).getMonth() + job.frequencyInterval)).toLocaleDateString() : 'Pending';
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
        </div >
    );
};

const TasksTab: React.FC<{ job: RecurringJob; onUpdate: (u: Partial<RecurringJob>) => void }> = ({ job, onUpdate }) => {
    const confirm = useConfirm();
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
        onUpdate({ tasks: newTasks });
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
                id: `lib-inst-${Date.now()}-${i}`,
                sequence: i + 1,
            })),
        };

        const newTasks = [...tasks, newTask];
        updateTasks(newTasks);
        setEditingTaskId(newTask.id);
        setShowLibraryPicker(false);
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

    return (
        <div className="flex gap-6 h-[600px] animate-in fade-in duration-300">
            {/* Left: Task List */}
            <div className="w-1/3 bg-white border border-slate-200 rounded-lg flex flex-col overflow-hidden">
                <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                    <h3 className="font-bold text-slate-800 text-sm">Job Steps (Template)</h3>
                    <div className="flex gap-1.5">
                        <button
                            onClick={openLibraryPicker}
                            className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-1.5 rounded hover:bg-blue-100 flex items-center gap-1 font-medium transition-colors"
                            title="Import steps from Task Library"
                        >
                            <BookOpen size={13} /> Library
                        </button>
                        <button onClick={addTask} className="text-xs bg-primary-600 text-white px-3 py-1.5 rounded hover:bg-primary-500 flex items-center gap-1">
                            <Plus size={14} /> Add
                        </button>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {tasks.map((task, index) => (
                        <div
                            key={task.id}
                            onClick={() => setEditingTaskId(task.id)}
                            className={`p-3 rounded-lg border cursor-pointer transition relative group ${editingTaskId === task.id ? 'bg-blue-50 border-blue-500 ring-1 ring-blue-500' : 'bg-white border-slate-200 hover:bg-slate-50'}`}
                        >
                            <div className="flex justify-between items-start mb-1">
                                <span className="font-mono text-xs font-bold text-slate-500 bg-slate-100 px-1.5 rounded">{task.sequence}</span>
                                <span className="text-[10px] text-slate-400">{(task.instructions || []).length} steps</span>
                            </div>
                            <input
                                type="text"
                                value={task.description}
                                onChange={(e) => { e.stopPropagation(); updateTask(task.id, { description: e.target.value }); }}
                                onClick={(e) => e.stopPropagation()}
                                className="w-full font-medium text-slate-900 text-sm mb-1 bg-transparent border-none p-0 focus:ring-0 focus:outline-none placeholder:text-slate-300"
                                placeholder="Enter task step name..."
                            />
                            <div className="flex justify-between items-center text-xs text-slate-500">
                                <span>{task.estHours} Hrs</span>
                            </div>
                            <div className={`absolute right-2 top-8 flex flex-col gap-1 ${editingTaskId === task.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
                                <button onClick={(e) => { e.stopPropagation(); moveTask(index, 'up'); }} className="p-1 hover:bg-slate-200 rounded text-slate-500" disabled={index === 0}><MoveUp size={12} /></button>
                                <button onClick={(e) => { e.stopPropagation(); moveTask(index, 'down'); }} className="p-1 hover:bg-slate-200 rounded text-slate-500" disabled={index === tasks.length - 1}><MoveDown size={12} /></button>
                            </div>
                        </div>
                    ))}
                    {tasks.length === 0 && (
                        <div className="text-center py-8 text-slate-400 text-sm">
                            <BookOpen size={32} className="mx-auto mb-3 opacity-30" />
                            <p>No tasks defined.</p>
                            <p className="mt-1">Click <strong>Library</strong> to import from the Task Library, or <strong>Add</strong> to start from scratch.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Right: Task Editor with ProcedureBuilder */}
            <div className="flex-1 bg-white border border-slate-200 rounded-lg flex flex-col overflow-hidden">
                {editingTask ? (
                    <div className="flex flex-col h-full">
                        {/* Task Header */}
                        <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                            <div className="flex items-center gap-3">
                                <span className="font-mono font-bold text-slate-500 bg-white border border-slate-200 px-2 py-1 rounded">Seq {editingTask.sequence}</span>
                                <input
                                    type="text"
                                    value={editingTask.description}
                                    onChange={(e) => updateTask(editingTask.id, { description: e.target.value })}
                                    className="font-bold text-slate-900 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 focus:outline-none px-1 py-0.5 w-64"
                                />
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2">
                                    <label className="text-[10px] text-slate-400 uppercase font-bold">Est Hrs</label>
                                    <input
                                        type="number"
                                        value={editingTask.estHours}
                                        onChange={(e) => updateTask(editingTask.id, { estHours: parseFloat(e.target.value) || 0 })}
                                        className="w-16 text-sm border-slate-300 rounded p-1 text-center"
                                    />
                                </div>
                                <button onClick={() => deleteTask(editingTask.id)} className="text-red-500 hover:bg-red-50 p-1.5 rounded" title="Delete task"><Trash2 size={16} /></button>
                            </div>
                        </div>

                        {/* ProcedureBuilder - full instruction editor */}
                        <div className="flex-1 overflow-y-auto">
                            <ProcedureBuilder
                                instructions={editingTask.instructions || []}
                                onChange={(blocks) => updateTask(editingTask.id, { instructions: blocks })}
                                mode="EDIT"
                            />
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400">
                        <ClipboardList size={48} className="mb-4 opacity-20" />
                        <p>Select a task to view details or edit instructions.</p>
                    </div>
                )}
            </div>

            {/* Enhancement 1: Library Picker Modal */}
            {showLibraryPicker && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
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
                </div>
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
        <div className="space-y-6 animate-in fade-in duration-300">
            <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex justify-between items-center">
                <div>
                    <h3 className="font-bold text-slate-800">Job Safety Analysis (JSA) Template</h3>
                    <p className="text-sm text-slate-500">5×5 Risk Matrix · Hierarchy of Controls · ISO 31000 / ISO 45001</p>
                </div>
                <button onClick={addHazard} className="bg-primary-600 hover:bg-primary-500 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm flex items-center gap-2">
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
                        <div key={h.id} className={`bg-white border-2 rounded-lg p-5 hover:shadow-md transition ${RISK_COLORS[level] || 'border-slate-200'}`}>
                            <div className="flex items-start gap-4">
                                <span className="font-mono text-xs font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded mt-1">{idx + 1}</span>
                                <div className="flex-1 space-y-4">
                                    {/* Hazard Description */}
                                    <div>
                                        <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Hazard Description</label>
                                        <input
                                            type="text"
                                            value={h.hazard}
                                            onChange={(e) => updateHazard(h.id, 'hazard', e.target.value)}
                                            placeholder="e.g. Working at height, confined space entry, H₂S exposure..."
                                            className="w-full p-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                                        />
                                    </div>

                                    {/* Risk Matrix Selectors */}
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div>
                                            <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Consequence (1-5)</label>
                                            <select
                                                value={h.consequence || 3}
                                                onChange={(e) => updateHazard(h.id, 'consequence', Number(e.target.value))}
                                                className="w-full p-2 border border-slate-300 rounded-lg text-sm"
                                            >
                                                {CONSEQUENCE_LABELS.map((label, i) => (
                                                    <option key={i} value={i + 1}>{i + 1} — {label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Likelihood (1-5)</label>
                                            <select
                                                value={h.likelihood || 3}
                                                onChange={(e) => updateHazard(h.id, 'likelihood', Number(e.target.value))}
                                                className="w-full p-2 border border-slate-300 rounded-lg text-sm"
                                            >
                                                {LIKELIHOOD_LABELS.map((label, i) => (
                                                    <option key={i} value={i + 1}>{i + 1} — {label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Risk Score</label>
                                            <div className={`flex items-center gap-2 p-2 rounded-lg border-2 font-bold text-lg ${RISK_COLORS[level] || 'border-slate-300'}`}>
                                                <span>{score}</span>
                                                <span className="text-xs font-bold uppercase">{level}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Hierarchy of Controls (ISO 45001) */}
                                    <div>
                                        <label className="text-[10px] uppercase font-bold text-slate-500 mb-2 block">Hierarchy of Controls (ISO 45001)</label>
                                        <div className="flex flex-wrap gap-2">
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
                                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition-all ${active ? colors[i] + ' shadow-sm ring-2 ring-offset-1 ring-current/20' : 'bg-slate-50 text-slate-400 border-slate-200 hover:border-slate-300'
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
                                            className="w-full p-2 border border-slate-300 rounded-lg text-sm h-20 resize-none focus:ring-2 focus:ring-primary-500"
                                        />
                                    </div>

                                    {/* Sign-off (mandatory for high risk) */}
                                    {score >= 15 && (
                                        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-3">
                                            <AlertTriangle size={16} className="text-red-600 flex-shrink-0" />
                                            <div className="flex-1">
                                                <p className="text-xs font-bold text-red-800">High-Risk: Mandatory Sign-Off Required</p>
                                                <p className="text-[10px] text-red-600">This hazard requires engineering review and sign-off before WO generation.</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="text"
                                                    value={h.signoffBy || ''}
                                                    onChange={(e) => updateHazard(h.id, 'signoffBy', e.target.value)}
                                                    placeholder="Approved by..."
                                                    className="text-xs border border-red-300 rounded px-2 py-1 w-32"
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

    return (
        <div className="space-y-4 animate-in fade-in duration-300">
            {/* Staffing Summary Card */}
            <div className="bg-gradient-to-r from-blue-50 to-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                    <div className="flex gap-8">
                        <div>
                            <p className="text-[10px] uppercase font-bold text-blue-500">Total Hours</p>
                            <p className="text-2xl font-black text-blue-700">{totalHours.toFixed(1)}<span className="text-sm font-normal ml-1">hrs</span></p>
                        </div>
                        <div>
                            <p className="text-[10px] uppercase font-bold text-blue-500">Est. Labour Cost</p>
                            <p className="text-2xl font-black text-blue-700">${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                        </div>
                        <div>
                            <p className="text-[10px] uppercase font-bold text-blue-500">Headcount</p>
                            <p className="text-2xl font-black text-blue-700">{labor.length}</p>
                        </div>
                        <div>
                            <p className="text-[10px] uppercase font-bold text-blue-500">Lead Craft</p>
                            <p className="text-sm font-bold text-blue-700 mt-1">
                                {leadCraft ? (craftRoles.find(r => r.code === leadCraft.contactType)?.description || leadCraft.contactType) : '—'}
                            </p>
                        </div>
                    </div>
                    <button onClick={addLabor} className="text-xs bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-500 flex items-center gap-1 font-bold shadow-sm">
                        <Plus size={14} /> Add Craft Requirement
                    </button>
                </div>
            </div>

            {/* Phase 1: Craft Requirements Table */}
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="p-3 border-b border-slate-200 bg-slate-50">
                    <h3 className="font-bold text-slate-700 text-sm flex items-center gap-2">
                        <Users size={16} className="text-blue-600" /> Phase 1: Craft Requirements (Planning)
                    </h3>
                    <p className="text-[10px] text-slate-500 mt-0.5">Define the roles and hours needed. Personnel are assigned in Phase 2.</p>
                </div>
                <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-white">
                        <tr>
                            <th className="px-3 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase w-8">Lead</th>
                            <th className="px-3 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase">Craft / Role</th>
                            <th className="px-3 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase">Assigned To</th>
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
                                                {craftRoles.length > 0
                                                    ? craftRoles.map(d => (
                                                        <option key={d.code} value={d.code}>{d.description || d.code}</option>
                                                    ))
                                                    : [
                                                        <option key="TECH" value="TECHNICIAN">Technician</option>,
                                                        <option key="ELEC" value="ELECTRICIAN">Electrician</option>,
                                                        <option key="MECH" value="MECHANIC">Mechanic</option>,
                                                        <option key="OPR" value="OPERATOR">Operator</option>,
                                                        <option key="SUP" value="SUPERVISOR">Supervisor</option>,
                                                        <option key="VEN" value="VENDOR">Vendor / Contractor</option>,
                                                    ]
                                                }
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
                                            {roleContacts.length > 0 ? (
                                                roleContacts.map(c => (
                                                    <option key={c.id} value={c.id}>{c.name || `${(c as any).firstName || ''} ${(c as any).lastName || ''}`}</option>
                                                ))
                                            ) : (
                                                contacts.map(c => (
                                                    <option key={c.id} value={c.id}>{c.name || `${(c as any).firstName || ''} ${(c as any).lastName || ''}`}</option>
                                                ))
                                            )}
                                        </select>
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
                                <td colSpan={3} className="px-3 py-2 text-right text-xs font-bold text-slate-500 uppercase">Totals</td>
                                <td className="px-3 py-2 text-right text-sm font-bold text-slate-700">{totalHours.toFixed(1)}</td>
                                <td className="px-3 py-2 text-right text-xs text-slate-400">—</td>
                                <td className="px-3 py-2 text-right text-sm font-bold text-blue-700">${totalCost.toFixed(2)}</td>
                                <td></td>
                            </tr>
                        </tfoot>
                    )}
                </table>
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

    // Cost summary
    const totalMaterialCost = inventory.reduce((sum, item) => sum + ((item.estQty || 0) * (item.estUnitCost || 0)), 0);
    const criticalCount = inventory.filter((item: any) => item.isCritical).length;

    return (
        <div className="space-y-4 animate-in fade-in duration-300">
            {/* Material Cost Summary */}
            {inventory.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between">
                    <div className="flex items-center gap-6">
                        <div>
                            <p className="text-xs text-slate-500 uppercase font-bold">Items Planned</p>
                            <p className="text-xl font-black text-slate-800">{inventory.length}</p>
                        </div>
                        <div className="h-8 w-px bg-slate-200" />
                        <div>
                            <p className="text-xs text-slate-500 uppercase font-bold">Est. Material Cost</p>
                            <p className="text-xl font-black text-blue-600">${totalMaterialCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        </div>
                        {criticalCount > 0 && (
                            <>
                                <div className="h-8 w-px bg-slate-200" />
                                <div>
                                    <p className="text-xs text-slate-500 uppercase font-bold">Critical Spares</p>
                                    <p className="text-xl font-black text-red-600 flex items-center gap-1">
                                        <AlertTriangle size={16} /> {criticalCount}
                                    </p>
                                </div>
                            </>
                        )}
                    </div>
                    <button onClick={addItem} className="text-xs bg-primary-600 text-white px-3 py-1.5 rounded hover:bg-primary-500 flex items-center gap-1 shadow-sm">
                        <Plus size={14} /> Add Item
                    </button>
                </div>
            )}

            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                {inventory.length === 0 && (
                    <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                        <h3 className="font-bold text-slate-700">Required Spare Parts & Material</h3>
                        <button onClick={addItem} className="text-xs bg-primary-600 text-white px-3 py-1.5 rounded hover:bg-primary-500 flex items-center gap-1">
                            <Plus size={14} /> Add Item
                        </button>
                    </div>
                )}
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
                                                    onChange={(code) => {
                                                        const selected = inventoryItems.find((inv: any) => inv.id === code);
                                                        const updates = inventory.map(i => i.id === item.id ? {
                                                            ...i,
                                                            inventoryId: code,
                                                            description: selected?.description || selected?.name || '',
                                                            uom: selected?.uom || 'EA',
                                                            estUnitCost: selected?.unitCost || selected?.unit_cost || 0,
                                                        } : i);
                                                        onUpdate({ inventory: updates });
                                                    }}
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
                                            {dictionaries.filter(d => d.type === 'UOM' && d.active).length > 0
                                                ? dictionaries.filter(d => d.type === 'UOM' && d.active).map(d => (
                                                    <option key={d.code} value={d.code}>{d.code}</option>
                                                ))
                                                : [
                                                    <option key="EA" value="EA">EA</option>,
                                                    <option key="L" value="L">L</option>,
                                                    <option key="KG" value="KG">KG</option>,
                                                    <option key="M" value="M">M</option>,
                                                    <option key="SET" value="SET">SET</option>,
                                                    <option key="BOX" value="BOX">BOX</option>,
                                                ]
                                            }
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
            <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm">
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
                                        <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-600 hover:underline inline-flex items-center gap-1">
                                            <FileText size={10} /> Open / Download
                                        </a>
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
const HistoryTab: React.FC<{ job: RecurringJob; jobs?: RecurringJob[] }> = ({ job }) => {
    // Generate mock history from job data
    const history = useMemo(() => {
        const entries: { id: string; date: string; event: string; user: string; details: string; type: 'generation' | 'edit' | 'status' | 'compliance' }[] = [];

        // Mock WO generation history based on assigned assets
        job.assignedAssets.forEach((ra, i) => {
            const asset = MOCK_ASSETS.find(a => a.id === ra.assetId);
            if (ra.lastCompletedDate) {
                entries.push({
                    id: `hist-gen-${i}`,
                    date: ra.lastCompletedDate,
                    event: 'Work Order Generated',
                    user: 'System (Auto-Generator)',
                    details: `WO generated for asset ${asset?.tag || ra.assetId}. PM Code: ${job.code}`,
                    type: 'generation',
                });
                entries.push({
                    id: `hist-comp-${i}`,
                    date: ra.lastCompletedDate,
                    event: 'Work Order Completed',
                    user: 'Technician',
                    details: `Completed on ${asset?.tag || ra.assetId}. Compliance: On-Time.`,
                    type: 'compliance',
                });
            }
        });

        // Add job creation/edit events
        entries.push({
            id: 'hist-create',
            date: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            event: 'PM Strategy Created',
            user: 'Admin',
            details: `Created ${job.code} — ${job.jobDescription || job.description}. Schedule: ${job.frequencyInterval} ${job.frequencyUnit}.`,
            type: 'edit',
        });
        if (job.status !== 'DRAFT') {
            entries.push({
                id: 'hist-activate',
                date: new Date(Date.now() - 85 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                event: 'Status Changed → ACTIVE',
                user: 'Admin',
                details: 'PM strategy activated for WO generation.',
                type: 'status',
            });
        }

        return entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [job]);

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

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* Compliance Summary */}
            <div className="grid grid-cols-3 gap-4">
                <div className="bg-white border border-slate-200 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-blue-600">{totalGenerated}</p>
                    <p className="text-[10px] text-slate-400 uppercase font-bold mt-1">WOs Generated</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-green-600">{totalCompleted}</p>
                    <p className="text-[10px] text-slate-400 uppercase font-bold mt-1">Completed</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-lg p-4 text-center">
                    <p className={`text-2xl font-bold ${complianceRate >= 90 ? 'text-green-600' : complianceRate >= 70 ? 'text-amber-600' : 'text-red-600'}`}>{complianceRate}%</p>
                    <p className="text-[10px] text-slate-400 uppercase font-bold mt-1">Compliance Rate</p>
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
