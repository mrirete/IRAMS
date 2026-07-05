import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import {
    Calendar,
    Clock,
    CheckCircle,
    User as UserIcon,
    AlertTriangle,
    FileText,
    Camera,
    Folder,
    Plus,
    Minus,
    Trash2,
    Save,
    X,
    MessageSquare,
    ChevronDown,
    ChevronRight,
    Search,
    Filter,
    ArrowRight,
    MoveUp,
    MoveDown,
    ClipboardList,
    AlignLeft,
    Hash,
    CheckSquare,
    Users,
    MapPin,
    Lock,
    TrendingUp,
    ShieldCheck,
    Printer, Copy, ChevronLeft, Download, GitPullRequest,
    BarChart3, Shield, Box, Paperclip, AlertOctagon, Book, Package, Info, Bell, Send, Layers, Eye, Repeat,
    DollarSign, Briefcase, PenTool, Edit3, Sparkles, Loader2, Check, Factory
} from 'lucide-react';
import { InventoryPicker } from '../components/pickers/InventoryPicker';
import { FinOpsService, type CostAllocation, type AssetFinancial, type WarrantyCheckResult, type CostAnomalyResult } from '../services/FinOpsService';
import { MOCK_WORK_ORDERS, MOCK_ASSETS, MOCK_DICTIONARIES, MOCK_RECURRING_JOBS } from '../constants';
import { WorkOrder, WorkOrderScope, WorkOrderStatus, WorkOrderType, JobJSA, JobTask, JobLabor, JobInventory, InstructionBlock, DictionaryEntry, JobFile, JSAHazard as JobHazard, OrganizationUnit, User, LibraryTask, WorkCenter, OrderActuals, DocumentCategory, DOCUMENT_CATEGORY_META } from '../types';
import { LoadingState } from '../components/ui';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { useAuth } from '../contexts/AuthContext';

import { DatabaseService } from '../services/DatabaseService';
import { ImageGallery } from '../components/ui/ImageGallery';
import { aiEngine, type JSAHazardSuggestion } from '../services/AIAnalysisEngine';
import { SignaturePad } from '../components/ui/SignaturePad';
import { DataMapper } from '../services/DataMapper';
import { offlineQueue } from '../services/offlineQueue';
import { CreateWorkOrderModal } from '../components/modals/CreateWorkOrderModal';
import { CreatePMModal } from '../components/modals/CreatePMModal';
import { OrgTreePicker } from '../components/OrgTreePicker';
import { ProcedureBuilder } from '../components/ProcedureBuilder';
import { FilesTab } from '../components/FilesTab';
import { ConfirmationModal } from '../components/modals/ConfirmationModal'; // Added import
import { NotificationService } from '../services/NotificationService';
import { AskRelanternButton } from '../components/AskRelanternButton';
import { UnifiedDetailHeader } from '../components/ui/UnifiedDetailHeader';
import { assessReadiness, assessCloseout, classifyWork, type ReadinessResult } from '../services/workReadiness';
import { computeAssetReliability, computePMEffectiveness, pmEffectivenessKpi, kpisToAIContext, type AssetReliability } from '../services/reliabilityMetrics';
import { useRelantern } from '../contexts/RelanternContext';
import { UnifiedTabBar } from '../components/ui/UnifiedTabBar';
import { FloatingActionButton } from '../components/ui/FloatingActionButton';
import { DensityToggle, type Density } from '../components/ui/DensityToggle';
import { Button, Badge, StatusPill, PriorityPill, Modal, DataList, type DataColumn } from '../components/ui';
import { supabase } from '../lib/supabase';
import ersApi from '../services/ERSApiClient';

type ViewMode = 'LIST' | 'DETAIL' | 'PM_LIST' | 'MY_WORK';
type TabId = 'details' | 'tasks' | 'jsa' | 'resources' | 'cost' | 'files' | 'analysis';

// ...

export const WorkOrders: React.FC = () => {
    const { jobId } = useParams();
    const navigate = useNavigate();
    const { showToast } = useToast(); // Added toast hook
    const { permissions, profile: woProfile, dataScope } = useAuth();
    // ═══ RBAC Permission Extraction (ISO 27001 / NIST CSF) ═══
    const canCreate = permissions?.workOrders?.create === true;
    const canEdit = permissions?.workOrders?.edit === true;
    const canDelete = permissions?.workOrders?.delete === true;
    const canApprove = permissions?.workOrders?.approve === true;
    // GAP-11: Default to MyWorkTodayView on mobile — the best mobile UX component (rated 9/10)
    const [viewMode, setViewMode] = useState<ViewMode>(() => {
        return typeof window !== 'undefined' && window.innerWidth < 640 ? 'MY_WORK' : 'LIST';
    });
    const [selectedJob, setSelectedJob] = useState<WorkOrder | null>(null);
    const [showStatusModal, setShowStatusModal] = useState(false);
    const [statusNote, setStatusNote] = useState('');
    const [pendingStatus, setPendingStatus] = useState<WorkOrderStatus | null>(null);

    // Delete Confirmation State
    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; jobId: string | null; jobNo: string | null }>({
        isOpen: false,
        jobId: null,
        jobNo: null
    });
    const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
    const [pms, setPms] = useState<any[]>([]); // Recurring Work
    const [assets, setAssets] = useState<any[]>([]); // For PM asset name resolution
    const [dictionaries, setDictionaries] = useState<DictionaryEntry[]>([]);
    const [orgUnits, setOrgUnits] = useState<OrganizationUnit[]>([]);

    const [users, setUsers] = useState<any[]>([]); // For assigning labor
    const [contacts, setContacts] = useState<any[]>([]); // For linking users to roles

    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isCreatePMOpen, setIsCreatePMOpen] = useState(false);
    const [searchParams, setSearchParams] = useSearchParams();

    // Auto-open Create WO modal when navigated with ?action=create (from Dashboard quick actions)
    useEffect(() => {
        if (searchParams.get('action') === 'create') {
            setIsCreateOpen(true);
            setSearchParams({}, { replace: true }); // Clean URL to prevent re-trigger on refresh
        }
    }, [searchParams, setSearchParams]);

    const loadOrders = async () => {
        try {
            const dbInstance = DatabaseService.getInstance() as any;
            const results = await Promise.all([
                dbInstance.getWorkOrders ? dbInstance.getWorkOrders() : Promise.resolve([]),
                dbInstance.getAssets ? dbInstance.getAssets() : Promise.resolve([]),
                dbInstance.getDictionaries ? dbInstance.getDictionaries() : Promise.resolve([]),
                dbInstance.getPMs ? dbInstance.getPMs() : Promise.resolve([]),
                dbInstance.getUsers ? dbInstance.getUsers() : Promise.resolve([]),
                dbInstance.getContacts ? dbInstance.getContacts() : Promise.resolve([]),
                dbInstance.getOrgUnits ? dbInstance.getOrgUnits() : Promise.resolve([])
            ]);

            const dbOrders = results[0];
            const dbAssets = results[1];
            const dbDictionaries = results[2] as DictionaryEntry[];
            const dbPMs = results[3];
            const dbUsers = results[4];
            const dbContacts = results[5];
            const dbOrgUnits = results[6] as OrganizationUnit[];

            setDictionaries(dbDictionaries.length > 0 ? dbDictionaries : MOCK_DICTIONARIES);
            setPms(dbPMs); // Always use real DB data, no mock fallback

            // ═══ Site Scope Filtering (ISO 55000 Data Boundary Enforcement) ═══
            const scopedAssets = DatabaseService.filterAssetsBySiteScope(dbAssets, dataScope?.siteIds);
            setAssets(scopedAssets);
            console.log(`[WorkOrders] Site scope filter: ${dbAssets.length} → ${scopedAssets.length} assets`);

            setUsers(dbUsers);
            setContacts(dbContacts);
            setOrgUnits(dbOrgUnits.length > 0 ? dbOrgUnits : []);

            // Fetch Org Units (Added)
            // Ideally we store this in state
            // Let's create state for it.
            // Wait, I can't modify state declaration easily with replace_file.
            // But I can fetch and setDictionaries which is where some live? No they are separate tables now.
            // I need to add state `orgUnits` to WorkOrders component.



            // Logic:
            const uiOrders = dbOrders.map((order: any) => DataMapper.toUIWorkOrder(order, scopedAssets, dbDictionaries));
            // Filter WOs to only those linked to in-scope assets
            const scopedOrders = DatabaseService.filterWorkOrdersBySiteScope(uiOrders, scopedAssets, dataScope?.siteIds);
            console.log(`[WorkOrders] Site scope filter: ${uiOrders.length} → ${scopedOrders.length} work orders`);
            setWorkOrders(scopedOrders);
        } catch (e) {
            console.error(e);
            setWorkOrders(MOCK_WORK_ORDERS);
            setDictionaries(MOCK_DICTIONARIES);
        }
    };

    useEffect(() => {
        loadOrders();
    }, [jobId, dataScope]); // Refresh when nav changes or data scope changes

    // Sync URL param with state
    // Sync URL param with state and fetch details
    useEffect(() => {
        const datasource = workOrders;

        if (jobId) {
            const foundJob = datasource.find(j => j.id === jobId);

            if (foundJob) {
                // Initial set with what we have (shallow)
                setSelectedJob(foundJob);
                setViewMode('DETAIL');

                // If DB is connected, Fetch Full Details (Deep Load)
                // This compensates for getWorkOrders being shallow
                if (workOrders.length > 0) { // Only fetch if using real data (or at least loaded data)
                    const fetchDetails = async () => {
                        try {
                            // Use getWorkOrder which already JOINs job_tasks, work_order_labor, work_order_parts, jsa
                            const raw = await DatabaseService.getInstance().getWorkOrder(jobId);
                            if (!raw) return;

                            // Map DB results to UI types
                            const labor = (raw as any).work_order_labor || [];
                            const parts = (raw as any).work_order_parts || [];
                            const rawJsa = (raw as any).jsa_assessments;
                            const rawTasks = (raw as any).job_tasks || [];

                            const mappedLabor = labor.map((l: any) => DataMapper.toUIJobLabor(l));
                            const mappedInventory = parts.map((p: any) => DataMapper.toUIJobInventory(p));

                            // Map tasks via DataMapper
                            const mappedTasks = rawTasks.map((t: any) => DataMapper.toUIJobTask(t)).sort((a: any, b: any) => a.sequence - b.sequence);

                            // JSA Mapping - from joined jsa_assessments relation
                            const jsaRecord = Array.isArray(rawJsa) ? rawJsa[0] : rawJsa;
                            const mappedJSA: JobJSA | undefined = jsaRecord ? {
                                id: jsaRecord.id || `jsa-${jobId}`,
                                status: jsaRecord.status || 'DRAFT',
                                hazards: (jsaRecord.jsa_hazards || []).map((h: any) => ({
                                    id: h.id,
                                    hazard: h.hazard,
                                    riskScore: h.risk_score,
                                    controls: h.controls
                                })),
                                permits: jsaRecord.permits || [],
                                signoffs: jsaRecord.signoffs || []
                            } : undefined;

                            // Build assets list for path mapping
                            const assets = await DatabaseService.getInstance().getAssets();
                            const foundAsset = assets.find((a: any) => a.id === raw.asset_id);

                            // Update Selected Job with deep data
                            const fullJob: WorkOrder = {
                                ...foundJob,
                                labor: mappedLabor,
                                inventory: mappedInventory,
                                jsa: mappedJSA,
                                tasks: mappedTasks.length > 0 ? mappedTasks : foundJob.tasks,
                                assignedTo: (raw as any).assigned_to,
                                costCenter: (raw as any).cost_center,
                                enforceJobCostCenter: (raw.properties as any)?.enforceJobCostCenter,
                                // Restore journals from properties JSONB
                                journals: (raw.properties as any)?.journals || foundJob.journals || [],
                                // Restore failureData from joined wo_failure_data
                                failureData: (() => {
                                    const fd = Array.isArray(raw.wo_failure_data) ? raw.wo_failure_data[0] : raw.wo_failure_data;
                                    if (!fd) return foundJob.failureData;
                                    return {
                                        failureMode: fd.failure_mode_code || undefined,
                                        failureCause: fd.failure_cause_code || undefined,
                                        remedyCode: fd.remedy_code || undefined,
                                        comments: fd.comments || undefined,
                                        localImpact: fd.local_impact || undefined,
                                        plantWideImpact: fd.plant_wide_impact || undefined,
                                    };
                                })(),
                            };

                            setSelectedJob(fullJob);

                        } catch (e) {
                            console.error("Failed to load job details", e);
                        }
                    };
                    fetchDetails();
                }

            } else {
                // Invalid ID or still loading
            }
        } else {
            setSelectedJob(null);
            setViewMode('LIST');
        }
    }, [jobId, navigate, workOrders]);

    const handleJobSelect = (job: WorkOrder) => {
        navigate(`/work-orders/${job.id}`);
    };

    const handleBack = () => {
        navigate('/work-orders');
    };

    const handleJobCreated = () => {
        loadOrders();
        setIsCreateOpen(false);
    };

    // Placeholder for handleStatusConfirm, assuming it would be defined in JobDetail
    // or passed down from WorkOrders if the status modal was here.
    const handleStatusConfirm = () => {
        console.log("Status confirmed:", pendingStatus, statusNote);
        setShowStatusModal(false);
        setPendingStatus(null);
        setStatusNote('');
        // Logic to update job status would go here
    };

    const location = useLocation();
    const assetParam = new URLSearchParams(location.search).get('asset') || '';

    return (
        <div className="h-[calc(100vh-6rem)] w-full overflow-hidden">
            <CreateWorkOrderModal
                isOpen={isCreateOpen}
                onClose={() => setIsCreateOpen(false)}
                onSave={handleJobCreated}
                dictionaries={dictionaries}
            />
            <CreatePMModal
                isOpen={isCreatePMOpen}
                onClose={() => setIsCreatePMOpen(false)}
                onSave={handleJobCreated}
                dictionaries={dictionaries}
            />
            <div className={`${viewMode === 'DETAIL' ? 'hidden' : 'hidden sm:flex'} flex-wrap justify-between items-center mb-3 md:mb-4 gap-2`}>
                <div>
                    <h1 className="text-base md:text-lg font-bold text-slate-900">Work Order Manager</h1>
                    <p className="text-[11px] md:text-xs text-slate-500">Track jobs and strategies</p>
                </div>
                <div className="flex items-center gap-2">
                    <AskRelanternButton
                        contextType="workOrder"
                        contextSummary={`Work Order Summary: ${workOrders.length} total WOs. Open: ${workOrders.filter(w => w.status === 'OPEN' || w.status === 'WIP').length}. Overdue: ${workOrders.filter(w => w.dueDate && new Date(w.dueDate) < new Date() && !['CLOSED', 'TECO', 'CANCELLED'].includes(w.status)).length}. PM-to-CM Ratio: ${workOrders.filter(w => (w.type as string) === 'PM').length}:${workOrders.filter(w => (w.type as string) === 'CM').length}.`}
                        compact
                    />
                    <div className="flex bg-slate-100 p-0.5 rounded-lg">
                        <button
                            onClick={() => setViewMode('LIST')}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${viewMode === 'LIST' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            Work Orders
                        </button>
                        <button
                            onClick={() => setViewMode('PM_LIST')}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${viewMode === 'PM_LIST' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            Strategies (PMs)
                        </button>
                        <button
                            onClick={() => setViewMode('MY_WORK')}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${viewMode === 'MY_WORK' ? 'bg-white shadow-sm text-slate-900 font-bold' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            My Work Today 📱
                        </button>
                    </div>
                </div>
            </div>

            {viewMode === 'LIST' && (
                <>
                    <JobListing
                        jobs={workOrders}
                        onSelect={handleJobSelect}
                        onCreate={() => setIsCreateOpen(true)}
                        dictionaries={dictionaries}
                        assets={assets}
                        initialSearch={assetParam}
                        canCreate={canCreate}
                        canDelete={canDelete}
                        onBulkDelete={async (ids: string[]) => {
                            // ═══ RBAC Layer 2: Submit-level guard ═══
                            if (!canDelete) {
                                console.warn('[RBAC-AUDIT] BLOCKED: workOrders.bulkDelete attempt by unauthorized user', woProfile?.username);
                                showToast('⛔ Access Denied: You do not have permission to delete work orders.', 'error');
                                return;
                            }
                            const db = DatabaseService.getInstance();
                            let deleted = 0;
                            for (const id of ids) {
                                try {
                                    await db.deleteWorkOrder(id);
                                    deleted++;
                                } catch (e: any) {
                                    console.error('Bulk delete failed for', id, e);
                                }
                            }
                            setWorkOrders(prev => prev.filter(wo => !ids.includes(wo.id)));
                            showToast(`Deleted ${deleted} of ${ids.length} Work Order(s)`, deleted === ids.length ? 'success' : 'warning');
                        }}
                    />
                    {/* FAB for mobile — one-hand creation (visible < 768px only) */}
                    {canCreate && (
                        <FloatingActionButton onClick={() => setIsCreateOpen(true)} label="New Work Order" />
                    )}
                </>
            )}

            {viewMode === 'PM_LIST' && (
                <PMList pms={pms} dictionaries={dictionaries} assets={assets} onCreate={() => setIsCreatePMOpen(true)} onRefresh={loadOrders} canCreate={canCreate} canDelete={canDelete} workOrders={workOrders} />
            )}

            {viewMode === 'MY_WORK' && (
                <MyWorkTodayView
                    workOrders={workOrders}
                    currentUser={woProfile || (users as any)}
                    onSelectJob={(job) => {
                        setSelectedJob(job);
                        setViewMode('DETAIL');
                    }}
                    onUpdateJob={(() => {}) as any}
                    dictionaries={dictionaries}
                    assets={assets}
                />
            )}

            {viewMode === 'DETAIL' && (
                selectedJob && <JobDetail key={selectedJob.id} job={selectedJob} onBack={handleBack} dictionaries={dictionaries} users={users} contacts={contacts} orgUnits={orgUnits} setDeleteModal={setDeleteModal} canEdit={canEdit} canDelete={canDelete} />
            )}

            {showStatusModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                        <h3 className="font-bold text-lg text-slate-900 mb-4">Update Status</h3>
                        <p className="text-sm text-slate-600 mb-4">
                            Changing status to <strong>{pendingStatus}</strong>.
                            {(pendingStatus as string) === 'COMPLETED' && ' This will finalize the Work Order.'}
                            {(pendingStatus as string) === 'CANCELLED' && ' Please provide a reason for cancellation.'}
                        </p>
                        <textarea
                            value={statusNote}
                            onChange={(e) => setStatusNote(e.target.value)}
                            placeholder={(pendingStatus as string) === 'CANCELLED' ? "Reason for cancellation required..." : "Add a note (optional)..."}
                            className="w-full p-3 border border-slate-300 rounded-lg text-sm mb-6 h-32 resize-none"
                            autoFocus
                        />
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => {
                                    setShowStatusModal(false);
                                    setPendingStatus(null);
                                    setStatusNote('');
                                }}
                                className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-50 rounded-lg"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleStatusConfirm}
                                disabled={(pendingStatus as string) === 'CANCELLED' && !statusNote.trim()}
                                className="px-4 py-2 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-500 disabled:opacity-50"
                            >
                                Confirm Update
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmationModal
                isOpen={deleteModal.isOpen}
                onClose={() => setDeleteModal({ isOpen: false, jobId: null, jobNo: null })}
                onConfirm={async () => {
                    // ═══ RBAC Layer 2: Submit-level guard ═══
                    if (!canDelete) {
                        console.warn('[RBAC-AUDIT] BLOCKED: workOrders.delete attempt by unauthorized user', woProfile?.username);
                        showToast('⛔ Access Denied: You do not have permission to delete work orders.', 'error');
                        return;
                    }
                    if (deleteModal.jobId) {
                        try {
                            await DatabaseService.getInstance().deleteWorkOrder(deleteModal.jobId);
                            navigate('/work-orders');
                            showToast('Work Order deleted', 'success');
                        } catch (e: any) {
                            showToast('Failed to delete Work Order: ' + e.message, 'error');
                        } finally {
                            setDeleteModal({ isOpen: false, jobId: null, jobNo: null });
                        }
                    }
                }}
                title="Delete Work Order"
                message={`Are you sure you want to delete Work Order ${deleteModal.jobNo}? This cannot be undone.`}
                type="danger"
                confirmText="Delete Work Order"
            />
        </div>
    );
};

// --- 1. Job Listing Component ---

// Shared Planned-vs-Reactive pill (used in the WO list column + mobile card).
const WORK_CLASS_PILL: Record<string, { label: string; cls: string }> = {
    PROACTIVE: { label: 'Proactive', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    REACTIVE: { label: 'Reactive', cls: 'bg-red-100 text-red-700 border-red-200' },
    UNCLASSIFIED: { label: 'Planning', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
};
const WorkClassPill: React.FC<{ c: string }> = ({ c }) => {
    const m = WORK_CLASS_PILL[c] || WORK_CLASS_PILL.UNCLASSIFIED;
    return <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full border ${m.cls}`}>{m.label}</span>;
};

const JobListing: React.FC<{ jobs: WorkOrder[], onSelect: (job: WorkOrder) => void, onCreate: () => void, dictionaries: DictionaryEntry[], assets?: any[], onBulkDelete?: (ids: string[]) => Promise<void>, initialSearch?: string, canCreate?: boolean, canDelete?: boolean }> = ({ jobs, onSelect, onCreate, dictionaries, assets = [], onBulkDelete, initialSearch = '', canCreate = true, canDelete = true }) => {
    const [density, setDensity] = useState<Density>('compact');
    const [statusFilter, setStatusFilter] = useState<WorkOrderStatus | 'ALL'>('ALL');
    const [classFilter, setClassFilter] = useState<'ALL' | 'PROACTIVE' | 'REACTIVE'>('ALL');
    const [search, setSearch] = useState(initialSearch);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [bulkDeleting, setBulkDeleting] = useState(false);
    const [showBulkConfirm, setShowBulkConfirm] = useState(false);

    // ═══ GAP-01: Smart Sort (persisted via localStorage) ═══
    type SortField = 'priority' | 'dueDate' | 'status' | 'created';
    const [sortField, setSortField] = useState<SortField>(() => {
        return (localStorage.getItem('irams_wo_sort_field') as SortField) || 'priority';
    });
    const [sortAsc, setSortAsc] = useState(() => {
        return localStorage.getItem('irams_wo_sort_asc') === 'true';
    });

    const handleSortChange = (field: SortField) => {
        if (sortField === field) {
            const newAsc = !sortAsc;
            setSortAsc(newAsc);
            localStorage.setItem('irams_wo_sort_asc', String(newAsc));
        } else {
            setSortField(field);
            setSortAsc(false);
            localStorage.setItem('irams_wo_sort_field', field);
            localStorage.setItem('irams_wo_sort_asc', 'false');
        }
    };

    // Priority rank for sorting (higher number = higher priority)
    const PRIORITY_RANK: Record<string, number> = { EMERGENCY: 5, HIGH: 4, MEDIUM: 3, LOW: 2, ROUTINE: 1 };
    const STATUS_RANK: Record<string, number> = { WIP: 5, SCHED: 4, OPEN: 3, TECO: 2, CLOSED: 1, CANC: 0, CANCELLED: 0 };

    const filteredJobs = useMemo(() => {
        const filtered = jobs.filter(job => {
            const matchesStatus = statusFilter === 'ALL' || job.status === statusFilter;
            const matchesClass = classFilter === 'ALL' || classifyWork(job) === classFilter;
            const matchesSearch = (job.title || '').toLowerCase().includes(search.toLowerCase()) ||
                (job.id || '').toLowerCase().includes(search.toLowerCase()) ||
                (job.woNumber || '').toLowerCase().includes(search.toLowerCase()) ||
                (job.assetName || '').toLowerCase().includes(search.toLowerCase());
            return matchesStatus && matchesClass && matchesSearch;
        });

        // Apply sort
        return filtered.sort((a, b) => {
            let cmp = 0;
            switch (sortField) {
                case 'priority':
                    cmp = (PRIORITY_RANK[a.priority?.toUpperCase() || ''] || 0) - (PRIORITY_RANK[b.priority?.toUpperCase() || ''] || 0);
                    break;
                case 'dueDate':
                    cmp = new Date(a.dueDate || '9999').getTime() - new Date(b.dueDate || '9999').getTime();
                    break;
                case 'status':
                    cmp = (STATUS_RANK[a.status || ''] || 0) - (STATUS_RANK[b.status || ''] || 0);
                    break;
                case 'created':
                    cmp = new Date((a as any).createdAt || 0).getTime() - new Date((b as any).createdAt || 0).getTime();
                    break;
            }
            return sortAsc ? cmp : -cmp;
        });
    }, [jobs, statusFilter, classFilter, search, sortField, sortAsc]);

    // Planned-vs-Reactive ratio (governance KPI) — over classified work only.
    const classRatio = useMemo(() => {
        let pro = 0, rea = 0;
        for (const j of jobs) {
            const c = classifyWork(j);
            if (c === 'PROACTIVE') pro++;
            else if (c === 'REACTIVE') rea++;
        }
        const total = pro + rea;
        const proPct = total ? Math.round((pro / total) * 100) : 0;
        return { pro, rea, total, proPct, reaPct: total ? 100 - proPct : 0 };
    }, [jobs]);

    // ═══ GAP-02/09/10: Helpers for overdue, RPN, criticality ═══
    const isOverdue = (job: WorkOrder) => {
        return job.dueDate && new Date(job.dueDate) < new Date() && !['CLOSED', 'TECO', 'CANC', 'CANCELLED'].includes(job.status);
    };
    const getOverdueDays = (job: WorkOrder) => {
        if (!job.dueDate) return 0;
        return Math.ceil((Date.now() - new Date(job.dueDate).getTime()) / (1000 * 60 * 60 * 24));
    };
    const CRIT_RANK: Record<string, number> = { A: 5, B: 3, C: 2, D: 1 };
    const PRI_RANK: Record<string, number> = { EMERGENCY: 5, HIGH: 4, MEDIUM: 3, LOW: 2, ROUTINE: 1 };
    const getRPN = (job: WorkOrder) => {
        const asset = assets.find((a: any) => a.id === job.assetId);
        const crit = CRIT_RANK[asset?.criticality || ''] || 1;
        const pri = PRI_RANK[job.priority?.toUpperCase() || ''] || 1;
        return crit * pri;
    };
    const getAssetCriticality = (job: WorkOrder) => {
        const asset = assets.find((a: any) => a.id === job.assetId);
        return asset?.criticality || null;
    };

    // Clear selections that are no longer visible after filter changes
    useEffect(() => {
        const visibleIds = new Set(filteredJobs.map(j => j.id));
        setSelectedIds(prev => {
            const next = new Set<string>();
            prev.forEach(id => { if (visibleIds.has(id)) next.add(id); });
            return next.size !== prev.size ? next : prev;
        });
    }, [statusFilter, search]);

    const toggleSelect = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const toggleAll = () => {
        if (selectedIds.size === filteredJobs.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredJobs.map(j => j.id)));
        }
    };

    const handleBulkDelete = async () => {
        if (!onBulkDelete) return;
        setBulkDeleting(true);
        await onBulkDelete(Array.from(selectedIds));
        setSelectedIds(new Set());
        setBulkDeleting(false);
        setShowBulkConfirm(false);
    };

    const getStatusIcon = (status: WorkOrderStatus) => {
        if (status === WorkOrderStatus.CLOSED) return <CheckCircle size={14} className="text-green-600" />;
        if (status === WorkOrderStatus.WIP) return <Clock size={14} className="text-blue-500" />;
        return <Clock size={14} className="text-slate-400" />;
    };

    // ── Unified list definition: desktop dense table + mobile cards from ONE source (DataList) ──
    const woColumns: DataColumn<WorkOrder>[] = [
        {
            id: 'select',
            header: '',
            hideOnCard: true,
            widthClass: 'w-8',
            headerCell: (
                <input
                    type="checkbox"
                    checked={filteredJobs.length > 0 && selectedIds.size === filteredJobs.length}
                    ref={(el) => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < filteredJobs.length; }}
                    onChange={toggleAll}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-primary-600 cursor-pointer"
                />
            ),
            render: (job) => (
                <span onClick={(e) => e.stopPropagation()}>
                    <input
                        type="checkbox"
                        checked={selectedIds.has(job.id)}
                        onChange={() => toggleSelect(job.id)}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-primary-600 cursor-pointer"
                    />
                </span>
            ),
        },
        { id: 'status', header: 'Status', render: (job) => <StatusPill status={job.status} /> },
        {
            id: 'wo',
            header: 'WO Number',
            cardTitle: true,
            render: (job) => <span className="font-mono font-medium text-slate-900">{job.woNumber || job.id}</span>,
        },
        {
            id: 'desc',
            header: 'Description',
            hideBelow: 'sm',
            render: (job) => (
                <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-900 truncate">{job.title}</div>
                    <div className="text-[11px] text-slate-500 truncate">{job.description}</div>
                </div>
            ),
        },
        { id: 'asset', header: 'Asset', hideBelow: 'md', render: (job) => <span className="text-slate-600">{job.assetName || '—'}</span> },
        {
            id: 'type',
            header: 'Type',
            hideBelow: 'lg',
            render: (job) => (
                <div className="flex items-center gap-1">
                    {job.type && <Badge tone="neutral" pill={false}>{job.type}</Badge>}
                    {job.recurringWorkId && (
                        <Badge tone="info" pill={false}><Repeat size={8} className="mr-0.5" />PM</Badge>
                    )}
                </div>
            ),
        },
        { id: 'plan', header: 'Plan', hideBelow: 'lg', render: (job) => <WorkClassPill c={classifyWork(job)} /> },
        { id: 'priority', header: 'Priority', render: (job) => <PriorityPill priority={job.priority} /> },
        {
            id: 'due',
            header: 'Due Date',
            align: 'right',
            hideBelow: 'sm',
            render: (job) => isOverdue(job)
                ? <span className="text-red-600 font-bold text-xs">{getOverdueDays(job)}d overdue</span>
                : <span className="text-slate-600 text-xs">{job.dueDate ? new Date(job.dueDate).toLocaleDateString() : '—'}</span>,
        },
    ];

    // Rich mobile card (preserves overdue / Crit-A / RPN cues) rendered inside DataList's card surface.
    const renderWoCard = (job: WorkOrder) => {
        const overdue = isOverdue(job);
        const overdueDays = getOverdueDays(job);
        const rpn = getRPN(job);
        const crit = getAssetCriticality(job);
        return (
            <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        {getStatusIcon(job.status)}
                        <span className="text-sm font-bold text-slate-900 truncate">{job.woNumber || job.id}</span>
                        {crit === 'A' && <span className="crit-a-badge">🔴 Crit-A</span>}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                        {rpn > 0 && (
                            <span className={`rpn-badge ${rpn > 12 ? 'rpn-high' : rpn > 6 ? 'rpn-medium' : 'rpn-low'}`}>RPN:{rpn}</span>
                        )}
                        <PriorityPill priority={job.priority} />
                    </div>
                </div>
                <p className="text-xs text-slate-700 line-clamp-1 font-medium">{job.title}</p>
                <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-slate-500 truncate">{job.assetName || 'No Asset'}</span>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                        <WorkClassPill c={classifyWork(job)} />
                        {job.type && <Badge tone="neutral" pill={false}>{job.type}</Badge>}
                        {overdue ? (
                            <span className="overdue-badge overdue-pulse">{overdueDays}d overdue</span>
                        ) : (
                            <span className="text-slate-400 text-[10px]">{job.dueDate ? new Date(job.dueDate).toLocaleDateString() : ''}</span>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="flex flex-col h-full bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            {/* Header / Filters */}
            <div className="p-2 sm:p-3 md:p-4 border-b border-slate-200 space-y-2 sm:space-y-3">
                <div className="flex flex-wrap justify-between items-center gap-2">
                    {/* Heading — hidden on mobile (outer page title covers it) */}
                    <div className="hidden sm:block">
                        <h1 className="text-base md:text-lg font-bold text-slate-900">Work Orders</h1>
                        <p className="text-[11px] md:text-xs text-slate-500">Manage maintenance tasks, schedules, and resources.</p>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* Density toggle — desktop only */}
                        <div className="hidden md:block">
                            <DensityToggle value={density} onChange={setDensity} />
                        </div>
                        <Button
                            onClick={onCreate}
                            disabled={!canCreate}
                            size="sm"
                            leftIcon={<Plus size={14} />}
                            className="hidden sm:inline-flex"
                            title={!canCreate ? 'Insufficient permissions' : 'Create new work order'}
                        >
                            New Work Order
                        </Button>
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                        <input
                            type="text"
                            placeholder="Search WO, Asset, Description..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full pl-8 pr-3 py-1.5 border border-slate-300 rounded-lg text-xs focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                        />
                    </div>
                    <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
                        {[{ code: 'ALL', description: 'All' }, ...dictionaries.filter(d => d.type === 'STATUS_CODE' && d.active)].map((status) => (
                            <button
                                key={status.code}
                                onClick={() => setStatusFilter(status.code as any)}
                                className={`whitespace-nowrap px-2 py-0.5 rounded-full text-[9px] font-bold uppercase border transition-all ${statusFilter === status.code
                                    ? 'bg-primary-600 text-white border-primary-600 shadow-sm'
                                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                                    }`}
                            >
                                {status.description}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Planned vs Reactive — governance KPI + quick filter */}
                <div className="flex items-center gap-x-4 gap-y-2 flex-wrap">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Planned vs Reactive</span>
                        <div className="flex h-2 w-24 rounded-full overflow-hidden bg-slate-100 border border-slate-200" title={`${classRatio.pro} proactive · ${classRatio.rea} reactive`}>
                            <div className="bg-emerald-500 h-full" style={{ width: `${classRatio.proPct}%` }} />
                            <div className="bg-red-500 h-full" style={{ width: `${classRatio.reaPct}%` }} />
                        </div>
                        <span className="text-[11px] font-bold text-emerald-600">{classRatio.proPct}%</span>
                        <span className="text-[11px] text-slate-300">/</span>
                        <span className="text-[11px] font-bold text-red-600">{classRatio.reaPct}%</span>
                    </div>
                    <div className="flex gap-1.5 sm:ml-auto">
                        {([['ALL', 'All'], ['PROACTIVE', 'Proactive'], ['REACTIVE', 'Reactive']] as const).map(([val, label]) => (
                            <button
                                key={val}
                                onClick={() => setClassFilter(val)}
                                className={`whitespace-nowrap px-2 py-0.5 rounded-full text-[9px] font-bold uppercase border transition-all ${classFilter === val
                                    ? (val === 'REACTIVE' ? 'bg-red-600 text-white border-red-600' : val === 'PROACTIVE' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-primary-600 text-white border-primary-600')
                                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                                    }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Bulk Action Bar */}
            {selectedIds.size > 0 && (
                <div className="px-3 py-2 bg-gradient-to-r from-blue-50 to-blue-50 border-b border-blue-200 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                        <div className="flex items-center gap-1.5">
                            <div className="w-5 h-5 bg-blue-600 rounded flex items-center justify-center">
                                <span className="text-[10px] font-bold text-white">{selectedIds.size}</span>
                            </div>
                            <span className="text-xs font-semibold text-blue-800">selected</span>
                        </div>
                        <button onClick={() => setSelectedIds(new Set())} className="text-[10px] text-blue-600 hover:text-blue-800 font-medium hover:underline">
                            Clear selection
                        </button>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            onClick={() => setShowBulkConfirm(true)}
                            disabled={bulkDeleting}
                            variant="danger"
                            size="sm"
                            leftIcon={<Trash2 size={12} />}
                        >
                            Delete Selected
                        </Button>
                    </div>
                </div>
            )}

            {/* Bulk Delete Confirmation Modal */}
            <Modal
                open={showBulkConfirm}
                onClose={() => !bulkDeleting && setShowBulkConfirm(false)}
                title={`Delete ${selectedIds.size} Work Order${selectedIds.size !== 1 ? 's' : ''}?`}
                size="sm"
                footer={
                    <>
                        <Button variant="secondary" size="sm" onClick={() => setShowBulkConfirm(false)} disabled={bulkDeleting}>
                            Cancel
                        </Button>
                        <Button
                            variant="danger"
                            size="sm"
                            onClick={handleBulkDelete}
                            loading={bulkDeleting}
                            leftIcon={!bulkDeleting ? <Trash2 size={12} /> : undefined}
                        >
                            {bulkDeleting ? 'Deleting…' : `Delete ${selectedIds.size} Work Order${selectedIds.size !== 1 ? 's' : ''}`}
                        </Button>
                    </>
                }
            >
                <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                        <AlertTriangle size={20} className="text-red-600" />
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">
                        This will permanently delete the selected work orders and all associated tasks, parts, labor, and JSA records.<br />
                        <strong className="text-red-600">This action cannot be undone.</strong>
                    </p>
                </div>
            </Modal>

            {/* ═══ Mobile sort toolbar (DataList renders the cards below) ═══ */}
            <div className="md:hidden flex items-center gap-1 px-3 py-2 border-b border-slate-100 bg-slate-50/50 overflow-x-auto scrollbar-hide flex-shrink-0">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mr-1 flex-shrink-0">Sort:</span>
                {([['priority', 'Priority'], ['dueDate', 'Due Date'], ['status', 'Status'], ['created', 'Created']] as [SortField, string][]).map(([field, label]) => (
                    <button
                        key={field}
                        onClick={() => handleSortChange(field)}
                        className={`flex items-center gap-0.5 px-2 py-1 rounded-full text-[10px] font-bold transition-all whitespace-nowrap ${
                            sortField === field
                                ? 'bg-primary-600 text-white shadow-sm'
                                : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-100'
                        }`}
                    >
                        {label}
                        {sortField === field && (
                            <span className="text-[8px]">{sortAsc ? '↑' : '↓'}</span>
                        )}
                    </button>
                ))}
            </div>

            {/* ═══ Unified list — Fiori-dense table (md+) / MaintainX cards (mobile) ═══ */}
            <DataList<WorkOrder>
                columns={woColumns}
                data={filteredJobs}
                getRowId={(job) => job.id}
                onRowClick={onSelect}
                selectedId={null}
                density={density}
                renderCard={renderWoCard}
                empty={
                    <div className="unified-empty-state">
                        <div className="unified-empty-state-icon"><Search size={20} /></div>
                        <div className="unified-empty-state-title">No Work Orders Found</div>
                        <div className="unified-empty-state-desc">Try adjusting your filters or search terms.</div>
                    </div>
                }
            />
        </div>
    );
};

// --- 2. Job Detail Component ---

const JobDetail: React.FC<{ job: WorkOrder; onBack: () => void; dictionaries: DictionaryEntry[]; users: any[]; contacts: any[]; orgUnits: OrganizationUnit[]; setDeleteModal: React.Dispatch<React.SetStateAction<{ isOpen: boolean; jobId: string | null; jobNo: string | null }>>; canEdit?: boolean; canDelete?: boolean }> = ({ job, onBack, dictionaries, users, contacts, orgUnits, setDeleteModal, canEdit = true, canDelete = true }) => {
    const { showToast } = useToast();
    const { user } = useAuth();
    const navigate = useNavigate();
    // Local state to manage edits during the session (e.g. adding failure data before completion)
    const [localJob, setLocalJob] = useState<WorkOrder>(job);
    const [activeTab, setActiveTab] = useState<TabId>('details');
    const [costRefreshKey, setCostRefreshKey] = useState(0); // bumped after a time confirmation to re-roll the Cost tab
    const [showCompleteModal, setShowCompleteModal] = useState(false);
    const [modalFailureMode, setModalFailureMode] = useState('');
    const [modalFailureCause, setModalFailureCause] = useState('');
    const [modalRemedy, setModalRemedy] = useState('');
    const [modalJournalNote, setModalJournalNote] = useState('');

    useEffect(() => {
        if (!showCompleteModal) {
            setModalFailureMode('');
            setModalFailureCause('');
            setModalRemedy('');
            setModalJournalNote('');
        }
    }, [showCompleteModal]);

    const [showNotificationModal, setShowNotificationModal] = useState(false);
    const [pendingStatus, setPendingStatus] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [followUpDescription, setFollowUpDescription] = useState('');

    // ── GAP-21: Styled modal states (replace native alert/confirm) ──
    const [showFinancialCloseModal, setShowFinancialCloseModal] = useState(false);
    const [journalDeleteId, setJournalDeleteId] = useState<string | null>(null);

    // Resolve asset class for failure mode context filtering
    const [resolvedAssetClass, setResolvedAssetClass] = useState<string>('');
    useEffect(() => {
        if (!localJob.assetId) return;
        DatabaseService.getInstance().getAssets().then((assets: any[]) => {
            const asset = assets.find((a: any) => a.id === localJob.assetId);
            if (asset) {
                setResolvedAssetClass(asset.assetClass || asset.assetCategory || asset.asset_class || asset.asset_category || '');
            }
        }).catch(() => {});
    }, [localJob.assetId]);

    // ── Gatekeeper Protocol (Criticality A cancellation) ──
    const [showGatekeeperModal, setShowGatekeeperModal] = useState(false);
    const [gatekeeperReason, setGatekeeperReason] = useState('');
    const [gatekeeperConfirmed, setGatekeeperConfirmed] = useState(false);

    // Debounce refs for auto-save
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingUpdatesRef = useRef<Partial<WorkOrder>>({});
    // Bumped on every local edit. The post-save refetch only re-syncs state if this
    // hasn't changed during the save round-trip — otherwise the refetch would
    // overwrite keystrokes typed while saving (the "letters disappear" bug).
    const editVersionRef = useRef(0);

    // Update local job if props change (e.g. navigation between jobs)
    useEffect(() => {
        setLocalJob(job);
    }, [job]);

    // Cleanup debounce timer on unmount
    useEffect(() => {
        return () => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        };
    }, []);

    // ── Asset Criticality lookup (for conditional TECO rules) ──
    const [assetCriticality, setAssetCriticality] = useState<string | null>(null);
    useEffect(() => {
        if (!localJob.assetId) { setAssetCriticality(null); return; }
        (async () => {
            try {
                const { data } = await supabase
                    .from('assets')
                    .select('criticality')
                    .eq('id', localJob.assetId)
                    .single();
                setAssetCriticality(data?.criticality || null);
            } catch { setAssetCriticality(null); }
        })();
    }, [localJob.assetId]);

    // ── Validation Status (SAP PM best practice + ISO 14224) ──
    // PM / Preventive / Scheduled / Inspection → skip failure coding, require journal only
    // CM / Corrective / Breakdown / Emergency → require failure coding + journal
    // If technician finds a defect during PM → toggle triggers follow-up corrective WO
    const hasFailureMode = !!localJob.failureData?.failureMode;
    const hasFailureCause = !!localJob.failureData?.failureCause;
    const hasRemedyCode = !!localJob.failureData?.remedyCode;
    const hasJournals = (localJob.journals && localJob.journals.length > 0);

    const allFailureModes = dictionaries.filter(d => d.type === 'FAILURE_MODE' && d.active);
    const allFailureCauses = dictionaries.filter(d => d.type === 'FAILURE_CAUSE' && d.active);

    const woType = (localJob.type || '').toString().toUpperCase();
    const isPreventiveType = ['PM', 'PREVENTIVE', 'PREVENTATIVE', 'SCHEDULED', 'INSPECTION', 'PREDICTIVE'].includes(woType);
    const isCriticalityA = assetCriticality === 'A';
    // PMs ALWAYS skip failure coding — defects found during PMs get their own follow-up corrective WO
    const requiresFailureCoding = !isPreventiveType;
    // SAP PM Standard: Only Failure Mode (Damage Code) is mandatory for CM.
    // Failure Cause (Cause Code) is optional. Remedy is NOT a standard SAP catalog field.
    const failureCodingMet = !requiresFailureCoding || hasFailureMode;
    const canComplete = failureCodingMet && hasJournals;
    // Modal completion gating (depends on requiresFailureCoding above).
    const modalFailureModeMet = hasFailureMode || !!modalFailureMode || !requiresFailureCoding;
    const modalJournalsMet = hasJournals || !!modalJournalNote.trim();
    const modalCanComplete = modalFailureModeMet && modalJournalsMet;
    const [defectFound, setDefectFound] = useState(false);

    const tabs: { id: TabId; label: string; icon: any }[] = [
        { id: 'details', label: 'Details', icon: FileText },
        { id: 'tasks', label: 'Tasks', icon: ClipboardList },
        { id: 'jsa', label: 'Safety (JSA)', icon: Shield },
        { id: 'resources', label: 'Resources', icon: Layers },
        { id: 'cost', label: 'Cost', icon: DollarSign },
        { id: 'files', label: 'Files', icon: Paperclip },
        { id: 'analysis', label: 'Analysis & History', icon: AlertOctagon }, // Merged Tab
    ];

    // ── Core DB persist function (called after debounce or immediately) ──
    const persistToDb = useCallback(async (updatedJob: WorkOrder, originalJob: WorkOrder, updates: Partial<WorkOrder>) => {
        if (!updatedJob.id) return;
        const versionAtSaveStart = editVersionRef.current;
        setIsSaving(true);
        try {
            const dbRecord = DataMapper.toDBWorkOrder(updatedJob, dictionaries);

            // Ensure every child row has a stable id so the offline replay (upsert-by-id)
            // is idempotent even if a flush retries after a partial network failure.
            const ensureIds = <T,>(arr?: T[]): T[] | undefined =>
                Array.isArray(arr) ? arr.map(x => (x && !(x as { id?: string }).id ? { ...x, id: crypto.randomUUID() } : x)) : arr;

            const extra = updatedJob as { properties?: Record<string, unknown>; enforceJobCostCenter?: boolean };
            const dbUpdates = {
                ...dbRecord,
                tasks: ensureIds(updates.tasks !== undefined ? updates.tasks : updatedJob.tasks),
                labor: ensureIds(updates.labor !== undefined ? updates.labor : updatedJob.labor),
                inventory: ensureIds(updates.inventory !== undefined ? updates.inventory : updatedJob.inventory),
                jsa: updates.jsa !== undefined ? updates.jsa : updatedJob.jsa,
                failureData: updatedJob.failureData,
                // Persist journals into properties JSONB
                properties: {
                    ...(extra.properties || {}),
                    enforceJobCostCenter: extra.enforceJobCostCenter,
                    journals: updatedJob.journals || [],
                },
            };

            // Route through the offline queue: runs immediately when online, otherwise
            // saves the whole WO state locally and replays on reconnect. TECO completion
            // stays online (it needs server-side failure-code validation).
            const { queued } = await offlineQueue.run(
                'saveWorkOrder',
                { id: updatedJob.id, updates: dbUpdates, actor: user?.id || 'unknown' },
                `WO ${updatedJob.woNumber || updatedJob.id}`,
            );
            if (queued) {
                // Offline: keep the optimistic UI; skip the server refetch.
                showToast('Saved offline — this work order will sync when you reconnect.', 'info');
                setIsSaving(false);
                return;
            }

            // --- REFETCH TO SYNC IDS ---
            const raw = await DatabaseService.getInstance().getWorkOrder(updatedJob.id);
            if (raw) {
                const rawLabor = (raw as any).work_order_labor || [];
                const rawParts = (raw as any).work_order_parts || [];
                const rawJsa = (raw as any).jsa_assessments;
                const rawTasks = (raw as any).job_tasks || [];

                const mappedLabor = rawLabor.map((l: any) => DataMapper.toUIJobLabor(l));
                const mappedInventory = rawParts.map((p: any) => DataMapper.toUIJobInventory(p));
                const mappedTasks = rawTasks.map((t: any) => DataMapper.toUIJobTask(t)).sort((a: any, b: any) => a.sequence - b.sequence);

                const jsaRecord = Array.isArray(rawJsa) ? rawJsa[0] : rawJsa;
                const mappedJSA: JobJSA | undefined = jsaRecord ? {
                    id: jsaRecord.id,
                    status: jsaRecord.status || 'DRAFT',
                    hazards: (jsaRecord.jsa_hazards || []).map((h: any) => ({
                        id: h.id,
                        hazard: h.hazard,
                        riskScore: h.risk_score,
                        controls: h.controls
                    })),
                    permits: jsaRecord.permits || [],
                    signoffs: jsaRecord.signoffs || []
                } : undefined;

                let dateDueStart = '';
                let timeDueStart = '';
                if (raw.date_due_start) {
                    const d = new Date(raw.date_due_start);
                    dateDueStart = d.toISOString().split('T')[0];
                    timeDueStart = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                }
                let dueDate = '';
                let timeDueFinish = '';
                if (raw.due_date) {
                    const d = new Date(raw.due_date);
                    dueDate = d.toISOString().split('T')[0];
                    timeDueFinish = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                }

                const refreshedJob: WorkOrder = {
                    ...updatedJob,
                    id: raw.id,
                    title: raw.title,
                    description: raw.description || raw.title,
                    status: raw.status,
                    type: raw.type,
                    scope: raw.scope || 'STANDARD',
                    priority: raw.priority_code,
                    assetId: raw.asset_id,
                    assignedTo: raw.assigned_to,
                    costCenter: raw.cost_center,
                    estDuration: raw.est_duration || 0,
                    dateDueStart,
                    timeDueStart,
                    dueDate,
                    timeDueFinish,
                    labor: mappedLabor,
                    inventory: mappedInventory,
                    tasks: mappedTasks.length > 0 ? mappedTasks : updatedJob.tasks,
                    jsa: mappedJSA,
                    properties: raw.properties || {},
                    enforceJobCostCenter: (raw.properties as any)?.enforceJobCostCenter,
                    // Restore journals from properties JSONB
                    journals: (raw.properties as any)?.journals || updatedJob.journals || [],
                    // Restore failureData from joined wo_failure_data
                    failureData: (() => {
                        const fd = Array.isArray(raw.wo_failure_data) ? raw.wo_failure_data[0] : raw.wo_failure_data;
                        if (!fd) return updatedJob.failureData;
                        return {
                            failureMode: fd.failure_mode_code || undefined,
                            failureCause: fd.failure_cause_code || undefined,
                            remedyCode: fd.remedy_code || undefined,
                            comments: fd.comments || undefined,
                            localImpact: fd.local_impact || undefined,
                            plantWideImpact: fd.plant_wide_impact || undefined,
                        };
                    })(),
                };
                // Only re-sync from the server if the user hasn't typed since this
                // save began — otherwise we'd clobber in-flight keystrokes.
                if (editVersionRef.current === versionAtSaveStart) {
                    setLocalJob(refreshedJob);
                }
            }

            showToast('Work Order saved', 'success');

            // ── Notification Hook-Ins (fire-and-forget) ──────────────
            const previousStatus = originalJob.status;
            const newStatus = updatedJob.status;
            const previousAssignee = originalJob.assignedTo;
            const newAssignee = updatedJob.assignedTo;

            if (updates.status && previousStatus !== newStatus) {
                NotificationService.checkRules('workOrders', 'WO_STATUS_CHANGE', updatedJob, {
                    currentUserId: user?.id || 'SYSTEM',
                    previousEntity: { ...originalJob },
                }).catch(console.error);
            }

            if (updates.assignedTo && previousAssignee !== newAssignee && newAssignee) {
                NotificationService.notify({
                    recipientId: newAssignee,
                    title: `📋 You've been assigned ${updatedJob.woNumber || 'a Work Order'}`,
                    message: `Work Order "${updatedJob.title}" has been assigned to you. ${updatedJob.priority === 'emergency' ? 'EMERGENCY priority — respond immediately.' : 'Review scope and plan execution.'}`,
                    severity: updatedJob.priority === 'emergency' ? 'CRITICAL' : 'INFO',
                    notificationType: 'ASSIGNMENT',
                    module: 'workOrders',
                    entityId: updatedJob.id,
                    entityType: 'WORK_ORDER',
                    entityNumber: updatedJob.woNumber || '',
                    actionLink: '/work-orders',
                    actionRequired: true,
                    createdBy: user?.id || 'SYSTEM',
                }).catch(console.error);
            }
        } catch (e: any) {
            console.error("Update Job Failed:", e);
            const msg = e.message || 'Unknown error';
            const details = e.details || e.hint || '';
            showToast(`Failed to update: ${msg} ${details ? `(${details})` : ''}`, 'error');
        } finally {
            setIsSaving(false);
        }
    }, [dictionaries, user, showToast]);

    // ── Debounced updateJob: local state updates instantly, DB save is debounced ──
    const updateJob = async (updates: Partial<WorkOrder>, force = false) => {
        if (!localJob.id) return;

        // Intercept Status Change to WIP - Check Material Staging
        if (updates.status === 'WIP' && localJob.status !== 'WIP') {
            const hasParts = localJob.inventory && localJob.inventory.length > 0;
            const isStaged = localJob.properties?.staging_confirmed === true;
            if (hasParts && !isStaged) {
                showToast("⛔ Material Staging Required: Staging must be confirmed prior to executing work.", "error");
                return;
            }
        }

        // Intercept Status Change to SCHED
        if (!force && updates.status === 'SCHED' && localJob.status !== 'SCHED') {
            setPendingStatus('SCHED');
            setShowNotificationModal(true);
            return;
        }

        // ═══ GATEKEEPER PROTOCOL: Criticality A cancellation ═══
        // Per user rules: "Any cancellation of a Work Request on a Criticality A asset
        // requires a mandatory 'Reason for Rejection' and a digital sign-off"
        if (!force && (updates.status as string) === 'CANCELLED' && (localJob.status as string) !== 'CANCELLED' && isCriticalityA) {
            setShowGatekeeperModal(true);
            setGatekeeperReason('');
            setGatekeeperConfirmed(false);
            return;
        }

        // 1. Optimistic UI Update — instant, no lag
        editVersionRef.current++;
        const updated = { ...localJob, ...updates };
        setLocalJob(updated);

        // 2. Accumulate pending updates
        pendingUpdatesRef.current = { ...pendingUpdatesRef.current, ...updates };

        // 3. Clear any existing debounce timer
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

        // 4. Debounce DB persist — wait 1500ms after last change
        const DEBOUNCE_MS = 1500;
        const snapshot = { ...updated };
        const originalSnapshot = { ...localJob };
        const accumulatedUpdates = { ...pendingUpdatesRef.current };

        saveTimerRef.current = setTimeout(async () => {
            pendingUpdatesRef.current = {}; // reset accumulated updates
            await persistToDb(snapshot, originalSnapshot, accumulatedUpdates);
        }, DEBOUNCE_MS);
    };

    // WM-2c: after a time confirmation is posted (a direct DB write + roll-up in
    // postConfirmation), refetch this WO's labour + operations so localJob reflects
    // it — and so the normal labour save flow won't clobber the posted confirmation.
    const reloadOperations = async () => {
        if (!localJob.id) return;
        const raw = await DatabaseService.getInstance().getWorkOrder(localJob.id);
        if (!raw) return;
        const mappedLabor = ((raw as any).work_order_labor || []).map((l: any) => DataMapper.toUIJobLabor(l));
        const mappedTasks = ((raw as any).job_tasks || []).map((t: any) => DataMapper.toUIJobTask(t)).sort((a: any, b: any) => a.sequence - b.sequence);
        setLocalJob(prev => ({ ...prev, labor: mappedLabor, tasks: mappedTasks.length ? mappedTasks : prev.tasks }));
        setCostRefreshKey(k => k + 1); // re-roll the Cost tab's actuals after a confirmation
    };

    // ── Immediate save (for manual Save button) — flushes any pending debounce ──
    const handleSave = () => {
        // ═══ RBAC Layer 2: Submit-level guard (ISO 27001 / NIST CSF) ═══
        if (!canEdit) {
            console.warn('[RBAC-AUDIT] BLOCKED: workOrders.edit attempt by unauthorized user');
            showToast('⛔ Access Denied: You do not have permission to edit work orders.', 'error');
            return;
        }
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        pendingUpdatesRef.current = {};
        persistToDb(localJob, job, {});
    };

    const handleConfirmCompletion = async (followUp: boolean) => {
        const finalJournals = !hasJournals && modalJournalNote.trim()
            ? [{
                id: `inst-${Date.now()}`,
                type: 'Note',
                author: (user as any)?.username || 'unknown',
                date: new Date().toISOString(),
                comments: modalJournalNote.trim()
              }, ...(localJob.journals || [])]
            : (localJob.journals || []);

        const finalFailureData = requiresFailureCoding && !hasFailureMode && modalFailureMode
            ? {
                ...(localJob.failureData || {}),
                failureMode: modalFailureMode,
                failureCause: modalFailureCause || localJob.failureData?.failureCause,
                remedyCode: modalRemedy || localJob.failureData?.remedyCode
              }
            : localJob.failureData;

        const finalHasFailureMode = !!finalFailureData?.failureMode;
        const finalFailureCodingMet = !requiresFailureCoding || finalHasFailureMode;
        const finalHasJournals = finalJournals.length > 0;
        const finalCanComplete = finalFailureCodingMet && finalHasJournals;

        if (!finalCanComplete) {
            showToast('Completion requirements not met. Please fill failure mode and journal note.', 'warning');
            return;
        }

        const updatedStatus = WorkOrderStatus.TECO;
        let message = `Work Order ${localJob.woNumber || localJob.id} is now Technically Complete.`;

        try {
            // Flush any pending debounced saves first
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }

            // Include failureData + journals + properties in the close call
            // so that wo_failure_data is written BEFORE TECO validation
            await DatabaseService.getInstance().updateWorkOrder(localJob.id, {
                status: updatedStatus,
                failureData: finalFailureData,
                properties: {
                    ...((localJob as any).properties || {}),
                    journals: finalJournals,
                },
            } as any, user?.id || 'unknown');
            updateJob({
                status: updatedStatus,
                failureData: finalFailureData,
                journals: finalJournals as any
            });

            // Enhancement 3: Lock any library templates referenced by this WO's tasks (MoC compliance)
            try {
                const libraryTaskIds = (localJob.tasks || [])
                    .map(t => t.libraryTaskId)
                    .filter((id): id is string => !!id);

                const uniqueIds = [...new Set(libraryTaskIds)];
                if (uniqueIds.length > 0) {
                    const db = DatabaseService.getInstance();
                    for (const ltId of uniqueIds) {
                        await db.lockLibraryTask(ltId, user?.id || 'system');
                    }
                    console.log(`[TECO] Locked ${uniqueIds.length} library template(s):`, uniqueIds);
                }
            } catch (lockErr) {
                console.warn('[TECO] Non-critical: Failed to lock library templates:', lockErr);
            }

            // Create follow-up corrective WO if requested
            if (followUp || defectFound) {
                const followUpPriority = isCriticalityA ? 'EMERGENCY' : 'HIGH';
                const followUpTitle = `Follow-up: Defect found during ${localJob.type} ${localJob.woNumber || ''}`.trim();
                const followUpDesc = [
                    followUpDescription.trim() ? followUpDescription.trim() : '',
                    `Corrective follow-up generated from ${localJob.type} work order ${localJob.woNumber || localJob.id}.`,
                    localJob.failureData?.comments ? `\nInspection Observations: ${localJob.failureData.comments}` : '',
                    `\nOriginal PM: ${localJob.title || 'N/A'}`,
                    `Asset: ${localJob.assetCode || localJob.assetName || 'N/A'}`,
                    isCriticalityA ? '\n⚠️ CRITICALITY A ASSET — Requires engineering review.' : ''
                ].filter(Boolean).join('\n');

                try {
                    const newWO = await DatabaseService.getInstance().createWorkOrder({
                        wo_number: `WO-FU-${Date.now().toString(36).toUpperCase()}`,
                        title: followUpTitle,
                        description: followUpDesc,
                        type: 'CM',
                        status: 'OPEN',
                        priority_code: followUpPriority,
                        asset_id: localJob.assetId,
                        parent_wo_id: localJob.id,
                        created_by: user?.id || 'unknown'
                    }, user?.id || 'unknown');

                    const woNum = newWO?.wo_number || newWO?.id || 'NEW';
                    message += `\n\nFollow-up Corrective WO ${woNum} created (Priority: ${followUpPriority}).`;
                    if (isCriticalityA) {
                        message += '\nCriticality A — Engineering review required.';
                    }
                } catch (fuErr: any) {
                    console.error('Failed to create follow-up WO:', fuErr);
                    message += `\n\n⚠️ Follow-up WO creation failed: ${fuErr.message}. Please create manually.`;
                }
            }

            showToast(message, 'success');
            setShowCompleteModal(false);
            onBack();
        } catch (e: any) {
            showToast('Error closing job: ' + e.message, 'error');
        }
    };


    return (
        <div className="flex flex-col h-full bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden relative">
            {/* Header */}
            <UnifiedDetailHeader
                title={localJob.woNumber || localJob.id}
                subtitle={localJob.title}
                status={localJob.status ? localJob.status.replace('_', ' ') : 'UNKNOWN'}
                statusClassName={localJob.status === 'CLOSED' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-blue-100 text-blue-700 border-blue-200'}
                icon={<FileText size={20} className="text-blue-500" />}
                onClose={onBack}
                badges={
                    localJob.recurringWorkId ? (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-100 text-blue-700 border border-blue-200 flex items-center gap-1" title="Generated from Recurring Work">
                            <Repeat size={9} /> Source PM
                        </span>
                    ) : undefined
                }
                actions={[
                    {
                        label: 'Save',
                        icon: isSaving
                            ? <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            : <Download size={14} />,
                        onClick: handleSave,
                        variant: 'primary' as const,
                        disabled: isSaving,
                        isPrimary: true,
                    },
                    ...(localJob.status !== WorkOrderStatus.CLOSED && localJob.status !== WorkOrderStatus.TECO ? [{
                        label: 'Complete',
                        icon: <CheckCircle size={14} />,
                        onClick: () => setShowCompleteModal(true),
                        variant: 'secondary' as const,
                        isPrimary: true,
                    }] : []),
                    ...(localJob.status === WorkOrderStatus.TECO ? [{
                        label: 'Close (Financial)',
                        icon: <Lock size={14} />,
                        onClick: async () => {
                            setShowFinancialCloseModal(true);
                        },
                        variant: 'secondary' as const,
                        isPrimary: true,
                    }] : []),
                ]}
            />

            {/* Action Toolbar — hidden on mobile, visible md+ */}
            <div className="px-3 py-2 md:px-5 md:py-2.5 border-t border-slate-100 hidden md:flex flex-wrap justify-between items-center gap-2 bg-slate-50/50">
                <div className="flex flex-wrap gap-1 md:gap-2">
                    <button className="flex items-center gap-1.5 px-2 py-1 md:px-2.5 md:py-1.5 text-[11px] md:text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-white border border-transparent hover:border-slate-200 rounded transition-colors" title="Print Work Order">
                        <Printer size={14} /> Print
                    </button>
                    <button
                        onClick={async () => {
                            const name = prompt("Enter a name for this new Library Template:", localJob.title);
                            if (name) {
                                try {
                                    const mappedInstructions = localJob.tasks?.map(t => ({ id: 'new', stepNumber: t.sequence, description: t.description, type: 'TEXT', required: false })) || [];
                                    const mappedInventory = (localJob.inventory || []).map(i => ({ inventoryItemId: i.inventoryId || i.id, quantity: i.estQty, notes: i.description }));
                                    const mappedRoles = (localJob.labor || []).map(l => ({ roleCode: l.contactType, quantity: 1, estimatedHours: l.estDuration }));
                                    const libraryTask: any = {
                                        code: localJob.woNumber || 'NEW-TEMPLATE',
                                        title: name,
                                        description: localJob.description,
                                        category: 'MAINTENANCE',
                                        estimatedDuration: localJob.labor?.reduce((acc, l) => acc + (l.estDuration || 0), 0) || 0,
                                        instructions: mappedInstructions
                                    };
                                    await DatabaseService.getInstance().createLibraryTask(libraryTask, mappedInventory, mappedRoles, [], user?.id || 'unknown');
                                    showToast('Saved as Library Template!', 'success');
                                } catch (e: any) {
                                    showToast('Failed to save template: ' + e.message, 'error');
                                }
                            }
                        }}
                        className="flex items-center gap-1.5 px-2 py-1 md:px-2.5 md:py-1.5 text-[11px] md:text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-white border border-transparent hover:border-slate-200 rounded transition-colors" title="Save as Library Template"
                    >
                        <Book size={14} /> Template
                    </button>
                    <button className="flex items-center gap-1.5 px-2 py-1 md:px-2.5 md:py-1.5 text-[11px] md:text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-white border border-transparent hover:border-slate-200 rounded transition-colors" title="Duplicate Work Order">
                        <Copy size={14} /> Duplicate
                    </button>
                    <button
                        onClick={() => setDeleteModal({
                            isOpen: true,
                            jobId: localJob.id,
                            jobNo: localJob.woNumber || localJob.id
                        })}
                        className="flex items-center gap-1.5 px-2 py-1 md:px-2.5 md:py-1.5 text-[11px] md:text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 border border-transparent hover:border-red-100 rounded transition-colors" title="Delete Work Order">
                        <Trash2 size={14} /> Delete
                    </button>
                    {/* ── Raise RCA — only for Corrective/Breakdown/Emergency WOs ── */}
                    {['CM', 'BM', 'EM'].includes(localJob.type) && (
                        <button
                            onClick={() => {
                                navigate('/analyze', {
                                    state: {
                                        raiseRCA: {
                                            asset_id: localJob.assetId || '',
                                            wo_id: localJob.id,
                                            wo_number: localJob.woNumber || localJob.id,
                                            title: localJob.title || '',
                                            description: localJob.description || '',
                                            failure_mode: localJob.failureData?.failureMode || null,
                                            failure_cause: localJob.failureData?.failureCause || null,
                                            event_date: localJob.dateCreated || new Date().toISOString(),
                                            cost: (localJob as any).costs?.total || 0,
                                        }
                                    }
                                });
                            }}
                            className="flex items-center gap-1.5 px-2.5 py-1 md:px-3 md:py-1.5 text-[11px] md:text-xs font-bold text-white rounded transition-all hover:shadow-md"
                            style={{ background: 'linear-gradient(135deg, #0891b2, #0d9488)' }}
                            title="Raise a Root Cause Analysis investigation from this Work Order"
                        >
                            <GitPullRequest size={14} /> Raise RCA
                        </button>
                    )}
                </div>
            </div>

            {/* Tab Navigation */}
            <UnifiedTabBar
                tabs={tabs}
                activeTab={activeTab}
                onTabChange={(id) => setActiveTab(id as TabId)}
            />

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 md:p-6 pb-32 sm:pb-5 md:pb-6 bg-slate-50/50">
                <div className="max-w-7xl mx-auto">
                    {activeTab === 'details' && <DetailsTab job={localJob} onUpdate={updateJob} dictionaries={dictionaries} />}
                    {activeTab === 'tasks' && (
                        <TasksTab
                            job={localJob}
                            onUpdate={(updatedTasks) => updateJob({ tasks: updatedTasks })}
                            availableOrgUnits={orgUnits}
                            availableUsers={users}
                            contacts={contacts}
                            onUpdateJob={updateJob}
                            onOperationConfirmed={reloadOperations}
                            dictionaries={dictionaries}
                        />
                    )}
                    {activeTab === 'jsa' && <JSATab job={localJob} onUpdate={updateJob} dictionaries={dictionaries} />}
                    {activeTab === 'resources' && <ResourcesTab job={localJob} users={users} contacts={contacts} onNavigateToTask={(taskId) => { setActiveTab('tasks'); }} dictionaries={dictionaries} />}
                    {activeTab === 'cost' && <CostTab job={localJob} refreshKey={costRefreshKey} />}
                    {activeTab === 'files' && <FilesTab job={localJob} onUpdate={updateJob} tasks={localJob.tasks || []} />}
                    {activeTab === 'analysis' && <AnalysisTab job={localJob} onUpdate={updateJob} dictionaries={dictionaries} isPreventive={isPreventiveType} onOpenCompleteModal={() => setShowCompleteModal(true)} followUpDescription={followUpDescription} onFollowUpDescriptionChange={setFollowUpDescription} assetClassCode={resolvedAssetClass} />}
                    {/* Placeholders */}
                    {[''].includes(activeTab) && (
                        <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                            <Folder size={64} className="mb-4 opacity-20" />
                            <p>No data recorded for this section.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* ═══ Sticky Bottom Action Bar ═══ */}
            <div className="sm:hidden mobile-detail-footer justify-end">
                {localJob.status !== WorkOrderStatus.CLOSED && localJob.status !== WorkOrderStatus.TECO && (
                    <Button
                        onClick={() => setShowCompleteModal(true)}
                        variant="secondary"
                        size="md"
                        leftIcon={<CheckCircle size={14} />}
                        className="border-2 border-primary-600 text-primary-600 hover:bg-primary-50"
                    >
                        Complete
                    </Button>
                )}
                {localJob.status === WorkOrderStatus.TECO && (
                    <Button
                        onClick={() => setShowFinancialCloseModal(true)}
                        variant="secondary"
                        size="md"
                        leftIcon={<Lock size={14} />}
                        className="border-2"
                    >
                        Close
                    </Button>
                )}
                <Button
                    onClick={handleSave}
                    loading={isSaving}
                    size="md"
                    leftIcon={<Download size={14} />}
                >
                    Save
                </Button>
            </div>

            {/* Completion Modal */}
            {showCompleteModal && (
                <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                            <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                <CheckCircle size={20} className="text-green-600" /> Technically Complete Work Order
                            </h3>
                            <button onClick={() => setShowCompleteModal(false)}><X size={20} className="text-slate-400 hover:text-slate-600" /></button>
                        </div>

                        <div className="p-6 overflow-y-auto max-h-[60vh] space-y-4">
                            {(!canComplete && !modalCanComplete) && (
                                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-xs text-amber-850 flex gap-2">
                                    <AlertTriangle size={16} className="flex-shrink-0 mt-0.5 text-amber-600" />
                                    <div>
                                        <span className="font-bold text-amber-900 block mb-0.5">Missing Completion Details</span>
                                        <p>Please enter the required failure coding or journal notes below to complete this work order.</p>
                                    </div>
                                </div>
                            )}

                            <div className="space-y-4">
                                {/* Inline Failure Coding for Modal */}
                                {requiresFailureCoding && !hasFailureMode && (
                                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                                        <span className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider">Required Failure Coding (ISO 14224)</span>
                                        <div>
                                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Failure Mode *</label>
                                            <select
                                                className="w-full text-xs border border-slate-300 rounded-lg bg-white p-2"
                                                value={modalFailureMode}
                                                onChange={e => setModalFailureMode(e.target.value)}
                                            >
                                                <option value="">-- Select Failure Mode --</option>
                                                {allFailureModes.map(fm => (
                                                    <option key={fm.id} value={fm.code}>{fm.description} ({fm.code})</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Failure Cause (Optional)</label>
                                            <select
                                                className="w-full text-xs border border-slate-300 rounded-lg bg-white p-2"
                                                value={modalFailureCause}
                                                onChange={e => setModalFailureCause(e.target.value)}
                                            >
                                                <option value="">-- Select Failure Cause --</option>
                                                {allFailureCauses.map(fc => (
                                                    <option key={fc.id} value={fc.code}>{fc.description} ({fc.code})</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Remedy / Action Taken (Optional)</label>
                                            <input
                                                type="text"
                                                className="w-full text-xs border border-slate-300 rounded-lg bg-white p-2"
                                                placeholder="Describe action taken..."
                                                value={modalRemedy}
                                                onChange={e => setModalRemedy(e.target.value)}
                                            />
                                        </div>
                                    </div>
                                )}

                                {/* Inline Journal Note for Modal */}
                                {!hasJournals && (
                                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                                        <span className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider">Required Completion Journal Note</span>
                                        <div>
                                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Activity Log Note *</label>
                                            <textarea
                                                className="w-full text-xs border border-slate-300 rounded-lg bg-white p-2 h-20 resize-none"
                                                placeholder="Write work performed, findings, or technician notes..."
                                                value={modalJournalNote}
                                                onChange={e => setModalJournalNote(e.target.value)}
                                            />
                                        </div>
                                    </div>
                                )}

                                <p className="text-slate-600 text-sm">
                                    You are about to mark work order <strong>{localJob.woNumber || localJob.id}</strong> as <strong>Technically Complete (TECO)</strong>.
                                    The work is physically complete. Costs can still be posted until Financial Close.
                                </p>

                                {isPreventiveType && (
                                    <>
                                        <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-800 space-y-1">
                                            <div className="flex items-center gap-1.5 font-bold">
                                                <CheckCircle size={14} className="text-blue-500" /> Preventive Maintenance — Failure Coding Skipped
                                            </div>
                                            <p>Failure Mode, Cause, and Remedy are not required for {localJob.type} work orders because no failure occurred. Journal entry verified.</p>
                                        </div>

                                        {/* Defect Found Toggle — SAP PM best practice */}
                                        <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${defectFound
                                                ? 'bg-amber-50 border-amber-300 shadow-sm'
                                                : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                                            }`}>
                                            <input
                                                type="checkbox"
                                                checked={defectFound}
                                                onChange={(e) => setDefectFound(e.target.checked)}
                                                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                                            />
                                            <div className="flex-1">
                                                <span className="text-sm font-bold text-slate-800">Defect Found During Inspection</span>
                                                <p className="text-xs text-slate-500 mt-0.5">
                                                    Check this if a defect or abnormal condition was discovered. A follow-up corrective work order will be created with full failure coding requirements.
                                                </p>
                                            </div>
                                        </label>

                                        {defectFound && (
                                            <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-800 flex items-start gap-2">
                                                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                                                <div>
                                                    <span className="font-bold">Follow-up Required:</span> A corrective work order will be created for
                                                    {isCriticalityA && <span className="font-bold text-red-700"> Criticality-A</span>} asset <strong>{localJob.assetCode || localJob.assetName || 'this asset'}</strong>.
                                                    The follow-up WO will require Failure Mode, Cause, and Remedy coding per ISO 14224.
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-3">
                            <button onClick={() => setShowCompleteModal(false)} className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg">Cancel</button>
                            {modalCanComplete && (
                                <>
                                    {/* For PMs with defect: prominently show follow-up button */}
                                    {isPreventiveType && defectFound ? (
                                        <button
                                            onClick={() => handleConfirmCompletion(true)}
                                            className="px-4 py-2 bg-amber-600 text-white font-bold rounded-lg hover:bg-amber-700 flex items-center gap-2 shadow-sm animate-pulse"
                                        >
                                            <AlertTriangle size={16} /> TECO & Create Corrective WO
                                        </button>
                                    ) : (
                                        <>
                                            <button
                                                onClick={() => handleConfirmCompletion(true)}
                                                className="px-4 py-2 border border-blue-200 bg-blue-50 text-blue-700 font-bold rounded-lg hover:bg-blue-100 hover:border-blue-300 flex items-center gap-2"
                                            >
                                                <GitPullRequest size={16} /> TECO & Request Follow-up
                                            </button>
                                            <button
                                                onClick={() => handleConfirmCompletion(false)}
                                                className="px-4 py-2 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 flex items-center gap-2 shadow-sm"
                                            >
                                                <CheckCircle size={16} /> Technically Complete
                                            </button>
                                        </>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Notification Confirmation Modal */}
            {showNotificationModal && (
                <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                            <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                <Bell size={20} className="text-blue-600" /> Send Notifications?
                            </h3>
                            <button onClick={() => { setShowNotificationModal(false); setPendingStatus(null); }}><X size={20} className="text-slate-400 hover:text-slate-600" /></button>
                        </div>
                        <div className="p-6">
                            <p className="text-slate-600 text-sm mb-4">
                                You are scheduling this job. Would you like to send email/SMS notifications to the assigned resources?
                            </p>
                            <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-800 flex gap-2">
                                <Info size={16} className="shrink-0 mt-0.5" />
                                <div>
                                    Notifications will be sent to all assigned Personnel and Teams.
                                </div>
                            </div>
                        </div>
                        <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-3">
                            <button
                                onClick={() => {
                                    // No, just update status
                                    if (pendingStatus) updateJob({ status: pendingStatus as any }, true);
                                    setShowNotificationModal(false);
                                    setPendingStatus(null);
                                }}
                                className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg"
                            >
                                No, Just Schedule
                            </button>
                            <button
                                onClick={async () => {
                                    // Yes, Notify & Update
                                    if (pendingStatus) {
                                        await updateJob({ status: pendingStatus as any }, true);
                                        if (localJob.id) {
                                            const count = await DatabaseService.getInstance().sendJobNotifications(localJob.id);
                                            showToast(`Notifications sent to ${count} recipient(s)`, 'success');
                                        }
                                    }
                                    setShowNotificationModal(false);
                                    setPendingStatus(null);
                                }}
                                className="px-4 py-2 bg-primary-600 text-white font-bold rounded-lg hover:bg-primary-500 flex items-center gap-2 shadow-sm"
                            >
                                <Send size={16} /> Yes, Notify & Schedule
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ GATEKEEPER PROTOCOL MODAL — Criticality A Cancellation ═══ */}
            {showGatekeeperModal && (
                <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-5 border-b border-red-200 flex justify-between items-center bg-red-50">
                            <h3 className="font-bold text-red-800 flex items-center gap-2">
                                <AlertTriangle size={20} className="text-red-600" />
                                Gatekeeper Protocol — Criticality A Cancellation
                            </h3>
                            <button onClick={() => setShowGatekeeperModal(false)}>
                                <X size={20} className="text-slate-400 hover:text-slate-600" />
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
                            {/* Warning Banner */}
                            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800 flex items-start gap-3">
                                <Shield size={20} className="flex-shrink-0 mt-0.5 text-red-600" />
                                <div>
                                    <p className="font-bold mb-1">Safety Critical Asset (Criticality A)</p>
                                    <p className="text-xs leading-relaxed">
                                        This work order is against a <strong>Criticality A</strong> asset. Cancelling work on safety-critical equipment requires
                                        a documented justification and digital sign-off per <strong>ISO 55000</strong> and site Gatekeeper Protocol.
                                    </p>
                                </div>
                            </div>

                            {/* WO Info */}
                            <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600 space-y-1 border border-slate-200">
                                <div className="flex justify-between">
                                    <span className="font-bold text-slate-500">Work Order:</span>
                                    <span className="font-mono font-bold text-slate-800">{localJob.woNumber || localJob.id}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="font-bold text-slate-500">Asset:</span>
                                    <span className="text-slate-800">{localJob.assetCode || localJob.assetName || 'N/A'}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="font-bold text-slate-500">Type / Priority:</span>
                                    <span className="text-slate-800">{localJob.type} / {localJob.priority}</span>
                                </div>
                            </div>

                            {/* Mandatory Reason */}
                            <div>
                                <label className="block text-xs font-bold text-red-700 uppercase mb-1.5">
                                    Reason for Rejection / Cancellation <span className="text-red-500">*</span>
                                </label>
                                <textarea
                                    value={gatekeeperReason}
                                    onChange={(e) => setGatekeeperReason(e.target.value)}
                                    placeholder="Provide a detailed justification for cancelling this safety-critical work order..."
                                    className="w-full p-3 border border-red-300 rounded-lg text-sm h-28 resize-none focus:ring-2 focus:ring-red-500 focus:border-red-500 bg-red-50/30"
                                    autoFocus
                                />
                                {gatekeeperReason.trim().length > 0 && gatekeeperReason.trim().length < 20 && (
                                    <p className="text-[10px] text-red-500 mt-1">Minimum 20 characters required for audit compliance.</p>
                                )}
                            </div>

                            {/* Digital Sign-off */}
                            <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                                gatekeeperConfirmed
                                    ? 'bg-green-50 border-green-300 shadow-sm'
                                    : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                            }`}>
                                <input
                                    type="checkbox"
                                    checked={gatekeeperConfirmed}
                                    onChange={(e) => setGatekeeperConfirmed(e.target.checked)}
                                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-green-600 focus:ring-green-500"
                                />
                                <div className="flex-1">
                                    <span className="text-sm font-bold text-slate-800">Digital Sign-off</span>
                                    <p className="text-[10px] text-slate-500 mt-0.5">
                                        I, <strong>{user?.user_metadata?.full_name || user?.email || 'Unknown User'}</strong>,
                                        confirm that I have authority to cancel this Criticality A work order and accept responsibility for this decision.
                                    </p>
                                </div>
                            </label>
                        </div>

                        <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-between items-center">
                            <span className="text-[9px] text-slate-400 flex items-center gap-1">
                                <Lock size={10} />
                                Action will be logged to audit trail (NIST/IEC 62443)
                            </span>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setShowGatekeeperModal(false)}
                                    className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={async () => {
                                        // Write audit log
                                        try {
                                            await supabase.from('audit_logs').insert({
                                                table_name: 'work_orders',
                                                record_id: localJob.id,
                                                action: 'GATEKEEPER_CANCELLATION',
                                                changed_by: user?.email || user?.id || 'unknown',
                                                timestamp: new Date().toISOString(),
                                                changes: JSON.stringify({
                                                    event: 'CRITICALITY_A_CANCELLATION',
                                                    wo_number: localJob.woNumber,
                                                    asset_id: localJob.assetId,
                                                    asset_code: localJob.assetCode || localJob.assetName,
                                                    criticality: 'A',
                                                    reason_for_rejection: gatekeeperReason.trim(),
                                                    signed_off_by: user?.user_metadata?.full_name || user?.email,
                                                    signed_off_at: new Date().toISOString(),
                                                }),
                                            });
                                        } catch (auditErr) {
                                            console.warn('[Gatekeeper] Audit log write failed:', auditErr);
                                        }

                                        // Proceed with cancellation
                                        setShowGatekeeperModal(false);
                                        await updateJob({ status: 'CANCELLED' as any }, true);
                                        showToast(
                                            `⛔ WO ${localJob.woNumber || localJob.id} cancelled (Criticality A — Gatekeeper approved). Audit trail logged.`,
                                            'warning'
                                        );
                                    }}
                                    disabled={gatekeeperReason.trim().length < 20 || !gatekeeperConfirmed}
                                    className="px-4 py-2 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 flex items-center gap-2 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    <AlertTriangle size={16} /> Confirm Cancellation
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ GAP-21: Financial Close Styled Modal (replaces native confirm) ═══ */}
            <ConfirmationModal
                isOpen={showFinancialCloseModal}
                onClose={() => setShowFinancialCloseModal(false)}
                onConfirm={async () => {
                    try {
                        await DatabaseService.getInstance().updateWorkOrder(localJob.id, { status: WorkOrderStatus.CLOSED } as any, user?.id || 'unknown');
                        updateJob({ status: WorkOrderStatus.CLOSED });
                        showToast(`Work Order ${localJob.woNumber || localJob.id} has been Financially Closed. All costs are frozen.`, 'success');
                        setShowFinancialCloseModal(false);
                        onBack();
                    } catch (e: any) {
                        showToast('Error closing: ' + e.message, 'error');
                        setShowFinancialCloseModal(false);
                    }
                }}
                title="Financial Close"
                message={`Close (Financial) WO ${localJob.woNumber || localJob.id}?\n\nThis will freeze all costs and prevent further postings. This action cannot be undone.`}
                type="danger"
                confirmText="Freeze Costs & Close"
            />

            {/* ═══ GAP-21: Journal Delete Styled Modal (replaces native confirm) ═══ */}
            <ConfirmationModal
                isOpen={!!journalDeleteId}
                onClose={() => setJournalDeleteId(null)}
                onConfirm={() => {
                    if (journalDeleteId) {
                        const updated = (localJob.journals || []).filter((j: any) => j.id !== journalDeleteId);
                        updateJob({ journals: updated });
                        setJournalDeleteId(null);
                    }
                }}
                title="Delete Journal Entry"
                message="Are you sure you want to delete this journal entry? This cannot be undone."
                type="danger"
                confirmText="Delete Entry"
            />
        </div>
    );
};

// --- Analysis Tab (New) ---

// Group label mapping for failure mode asset classes
const FM_GROUP_LABELS: Record<string, string> = {
    'ROTATING': '⚙️ Rotating Equipment',
    'STATIC_PRESSURE': '🏗️ Static / Pressure Vessels',
    'ELECTRICAL': '⚡ Electrical',
    'INSTRUMENT': '📊 Instrumentation',
    'PIPING': '🔩 Piping',
    'SAFETY_SYSTEM': '🛡️ Safety Systems',
    'HEAT_TRANSFER': '🌡️ Heat Transfer',
};

// --- Searchable Select Component (for Failure Mode / Cause dropdowns) ---
const SearchableSelect: React.FC<{
    value: string;
    onChange: (val: string) => void;
    options: { id: string; code: string; description: string; categoryRef?: string }[];
    placeholder: string;
    groupKey?: string; // When set, groups options by this field (e.g. 'categoryRef')
    allowManualEntry?: boolean; // Enable "Not in list?" manual code entry
    allOptions?: { id: string; code: string; description: string }[]; // Full list for duplicate validation
}> = ({ value, onChange, options, placeholder, groupKey, allowManualEntry = false, allOptions }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLUListElement>(null);
    const [highlightIdx, setHighlightIdx] = useState(-1);
    const [showManualEntry, setShowManualEntry] = useState(false);
    const [manualCode, setManualCode] = useState('');
    const [manualDesc, setManualDesc] = useState('');
    const [duplicateError, setDuplicateError] = useState('');

    // Close on click outside
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
                setSearch('');
                setShowManualEntry(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const filtered = options.filter(o => {
        if (!search) return true;
        const q = search.toLowerCase();
        return o.code.toLowerCase().includes(q) || o.description.toLowerCase().includes(q);
    });

    // Build grouped or flat items for rendering
    const renderItems = useMemo(() => {
        if (!groupKey) return filtered.map(o => ({ type: 'item' as const, option: o }));

        // Group: ungrouped first (General), then by categoryRef
        const general = filtered.filter(o => !(o as any)[groupKey]);
        const grouped = new Map<string, typeof filtered>();
        filtered.forEach(o => {
            const gv = (o as any)[groupKey];
            if (!gv) return;
            if (!grouped.has(gv)) grouped.set(gv, []);
            grouped.get(gv)!.push(o);
        });

        const items: { type: 'header' | 'item'; label?: string; option?: typeof filtered[0] }[] = [];
        if (general.length > 0) {
            items.push({ type: 'header', label: '🔧 General (All Assets)' });
            general.forEach(o => items.push({ type: 'item', option: o }));
        }
        grouped.forEach((opts, key) => {
            items.push({ type: 'header', label: FM_GROUP_LABELS[key] || key });
            opts.forEach(o => items.push({ type: 'item', option: o }));
        });
        return items;
    }, [filtered, groupKey]);

    // Flat list of selectable items (for keyboard nav)
    const selectableItems = renderItems.filter(i => i.type === 'item');

    // Reset highlight when results change
    useEffect(() => { setHighlightIdx(-1); }, [filtered.length, search]);

    // Scroll highlighted item into view
    useEffect(() => {
        if (highlightIdx >= 0 && listRef.current) {
            // Find the DOM index (accounting for headers)
            let domIdx = 0;
            let selectIdx = 0;
            for (const item of renderItems) {
                if (item.type === 'item') {
                    if (selectIdx === highlightIdx) break;
                    selectIdx++;
                }
                domIdx++;
            }
            const el = listRef.current.children[domIdx] as HTMLElement;
            el?.scrollIntoView({ block: 'nearest' });
        }
    }, [highlightIdx, renderItems]);

    const select = (code: string) => {
        onChange(code);
        setIsOpen(false);
        setSearch('');
        setShowManualEntry(false);
    };

    const selectedLabel = value
        ? (() => {
            if (value.startsWith('MANUAL:')) return value.replace('MANUAL:', '');
            const o = options.find(o => o.code === value) || (allOptions || []).find(o => o.code === value);
            return o ? `${o.code} — ${o.description}` : value;
        })()
        : '';

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!isOpen) { if (e.key === 'ArrowDown' || e.key === 'Enter') { setIsOpen(true); e.preventDefault(); } return; }
        if (e.key === 'ArrowDown') { setHighlightIdx(i => Math.min(i + 1, selectableItems.length - 1)); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { setHighlightIdx(i => Math.max(i - 1, 0)); e.preventDefault(); }
        else if (e.key === 'Enter' && highlightIdx >= 0 && selectableItems[highlightIdx]?.option) { select(selectableItems[highlightIdx].option!.code); e.preventDefault(); }
        else if (e.key === 'Escape') { setIsOpen(false); setSearch(''); setShowManualEntry(false); }
    };

    // Manual entry: validate for duplicate codes
    const handleManualCodeChange = (code: string) => {
        const upper = code.toUpperCase().replace(/[^A-Z0-9_]/g, '');
        setManualCode(upper);
        const checkList = allOptions || options;
        const dup = checkList.find(o => o.code === upper);
        setDuplicateError(dup ? `Code "${dup.code}" already exists: ${dup.description}` : '');
    };

    const submitManualEntry = () => {
        if (!manualCode || !manualDesc || duplicateError) return;
        onChange(`MANUAL:${manualCode} — ${manualDesc}`);
        setShowManualEntry(false);
        setIsOpen(false);
        setManualCode('');
        setManualDesc('');
    };

    return (
        <div ref={containerRef} className="relative">
            <div
                className={`w-full p-2 border rounded-lg text-xs bg-white flex items-center gap-1 cursor-pointer transition-colors ${isOpen ? 'border-blue-400 ring-1 ring-blue-200' : 'border-slate-300 hover:border-slate-400'}`}
                onClick={() => { setIsOpen(true); setShowManualEntry(false); setTimeout(() => inputRef.current?.focus(), 0); }}
            >
                {isOpen && !showManualEntry ? (
                    <input
                        ref={inputRef}
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="flex-1 outline-none bg-transparent text-xs placeholder:text-slate-400"
                        placeholder={`Type to search...`}
                        autoFocus
                    />
                ) : (
                    <span className={`flex-1 truncate ${selectedLabel ? 'text-slate-800' : 'text-slate-400'}`}>
                        {selectedLabel || placeholder}
                    </span>
                )}
                <ChevronDown size={14} className={`text-slate-400 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </div>
            {isOpen && !showManualEntry && (
                <ul ref={listRef} className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg py-1 text-xs">
                    {value && (
                        <li
                            className="px-3 py-1.5 text-slate-400 hover:bg-slate-50 cursor-pointer border-b border-slate-100 italic"
                            onClick={() => select('')}
                        >
                            Clear selection
                        </li>
                    )}
                    {selectableItems.length === 0 ? (
                        <li className="px-3 py-3 text-center text-slate-400 italic">No results for "{search}"</li>
                    ) : (
                        renderItems.map((item, idx) => {
                            if (item.type === 'header') {
                                return (
                                    <li key={`hdr-${idx}`} className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase bg-slate-50 border-y border-slate-100 tracking-wide select-none sticky top-0">
                                        {item.label}
                                    </li>
                                );
                            }
                            const o = item.option!;
                            const selIdx = selectableItems.indexOf(item);
                            return (
                                <li
                                    key={o.id}
                                    className={`px-3 py-1.5 cursor-pointer transition-colors ${o.code === value ? 'bg-blue-50 text-blue-700 font-semibold' : ''
                                        } ${selIdx === highlightIdx ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                                    onClick={() => select(o.code)}
                                    onMouseEnter={() => setHighlightIdx(selIdx)}
                                >
                                    <span className="font-medium">{o.code}</span>
                                    <span className="text-slate-500"> — {o.description}</span>
                                </li>
                            );
                        })
                    )}
                    {/* Manual Entry Trigger */}
                    {allowManualEntry && (
                        <li
                            onClick={() => { setShowManualEntry(true); setIsOpen(true); }}
                            className="px-3 py-2 border-t border-slate-200 bg-slate-50 text-center cursor-pointer hover:bg-blue-50 transition-colors"
                        >
                            <span className="text-xs font-medium text-blue-600 flex items-center justify-center gap-1.5">
                                <Edit3 size={12} /> Not in list? Enter manually
                            </span>
                        </li>
                    )}
                </ul>
            )}
            {/* Manual Entry Panel */}
            {showManualEntry && (
                <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-blue-200 rounded-lg shadow-xl p-4 animate-in fade-in zoom-in-95 duration-100">
                    <div className="flex items-center justify-between mb-3">
                        <h4 className="text-xs font-bold text-slate-700 uppercase">Manual Entry</h4>
                        <button onClick={() => { setShowManualEntry(false); setIsOpen(true); }} className="text-slate-400 hover:text-slate-600">
                            <X size={14} />
                        </button>
                    </div>
                    <div className="space-y-2">
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Code <span className="text-red-500">*</span></label>
                            <input
                                type="text"
                                value={manualCode}
                                onChange={(e) => handleManualCodeChange(e.target.value)}
                                placeholder="e.g. CUSTOM_MODE_01"
                                className={`w-full p-2 border rounded-lg text-xs font-mono ${duplicateError ? 'border-red-400 bg-red-50' : 'border-slate-300'}`}
                                maxLength={30}
                                autoFocus
                            />
                            {duplicateError && (
                                <p className="text-[10px] text-red-600 mt-0.5">{duplicateError}</p>
                            )}
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Description <span className="text-red-500">*</span></label>
                            <input
                                type="text"
                                value={manualDesc}
                                onChange={(e) => setManualDesc(e.target.value)}
                                placeholder="Describe the failure mode..."
                                className="w-full p-2 border border-slate-300 rounded-lg text-xs"
                            />
                        </div>
                        <div className="flex justify-between items-center pt-1">
                            <p className="text-[9px] text-slate-400">Flagged for admin review.</p>
                            <button
                                onClick={submitManualEntry}
                                disabled={!manualCode || !manualDesc || !!duplicateError}
                                className="px-3 py-1.5 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-primary-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                            >
                                <Check size={12} /> Apply
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const AnalysisTab: React.FC<{ job: WorkOrder; onUpdate: (u: Partial<WorkOrder>) => void, dictionaries: DictionaryEntry[], isPreventive?: boolean, onOpenCompleteModal?: () => void, followUpDescription?: string, onFollowUpDescriptionChange?: (val: string) => void, assetClassCode?: string }> = ({ job, onUpdate, dictionaries, isPreventive = false, onOpenCompleteModal, followUpDescription = '', onFollowUpDescriptionChange, assetClassCode }) => {
    const { profile } = useAuth();
    // Dropdown Data — all failure modes (unfiltered, for duplicate validation)
    const allFailureModes = useMemo(() => dictionaries.filter(d => d.type === 'FAILURE_MODE' && d.active), [dictionaries]);
    // Context-filtered: General (no categoryRef) + matched asset class
    const failureModes = useMemo(() => {
        if (!assetClassCode) return allFailureModes;
        return allFailureModes.filter(d => {
            const ref = d.categoryRef;
            return !ref || ref === assetClassCode;
        });
    }, [allFailureModes, assetClassCode]);
    const allFailureCauses = useMemo(() => dictionaries.filter(d => d.type === 'FAILURE_CAUSE' && d.active), [dictionaries]);
    const failureCauses = allFailureCauses; // Causes are not asset-specific

    // AI-assisted failure effects
    const [aiSuggestingEffects, setAiSuggestingEffects] = useState(false);
    // AI-suggested failure modes from Railway API
    const [aiSuggestedModes, setAiSuggestedModes] = useState<string[]>([]);
    const [aiSuggestingModes, setAiSuggestingModes] = useState(false);

    // Local State for Journal Entry
    const [note, setNote] = useState('');

    const handleFailureModeChange = (val: string) => {
        onUpdate({
            failureData: {
                ...job.failureData,
                failureMode: val
            }
        });
    };

    const handleFailureCauseChange = (val: string) => {
        onUpdate({
            failureData: {
                ...job.failureData,
                failureCause: val
            }
        });
    };

    // Local state for free-text fields — only save onBlur to avoid disruptive auto-save while typing
    const [localActionTaken, setLocalActionTaken] = useState(job.failureData?.remedyCode || '');
    const [localEffects, setLocalEffects] = useState(job.failureData?.comments || '');
    const [localLocalImpact, setLocalLocalImpact] = useState(job.failureData?.localImpact || '');
    const [localPlantWideImpact, setLocalPlantWideImpact] = useState(job.failureData?.plantWideImpact || '');

    // Sync local state when job data changes from outside (e.g. after DB refetch)
    useEffect(() => {
        setLocalActionTaken(job.failureData?.remedyCode || '');
    }, [job.failureData?.remedyCode]);
    useEffect(() => {
        setLocalEffects(job.failureData?.comments || '');
    }, [job.failureData?.comments]);
    useEffect(() => {
        setLocalLocalImpact(job.failureData?.localImpact || '');
    }, [job.failureData?.localImpact]);
    useEffect(() => {
        setLocalPlantWideImpact(job.failureData?.plantWideImpact || '');
    }, [job.failureData?.plantWideImpact]);

    const flushActionTaken = () => {
        onUpdate({
            failureData: {
                ...job.failureData,
                remedyCode: localActionTaken
            }
        });
    };

    const flushEffects = () => {
        onUpdate({
            failureData: {
                ...job.failureData,
                comments: localEffects
            }
        });
    };

    const flushLocalImpact = () => {
        onUpdate({
            failureData: {
                ...job.failureData,
                localImpact: localLocalImpact
            }
        });
    };

    const flushPlantWideImpact = () => {
        onUpdate({
            failureData: {
                ...job.failureData,
                plantWideImpact: localPlantWideImpact
            }
        });
    };

    const [editingId, setEditingId] = useState<string | null>(null);
    const [editText, setEditText] = useState('');
    const [journalType, setJournalType] = useState('Note');
    const [showFollowUpConfirm, setShowFollowUpConfirm] = useState(false);

    const addJournal = () => {
        if (!note.trim()) return;
        const newJournal = {
            id: `j-${Date.now()}`,
            type: journalType,
            entry: note,
            createdBy: profile?.username || profile?.fullName || 'Unknown User',
            createdAt: new Date().toLocaleString(),
            isSystem: false
        };
        onUpdate({ journals: [newJournal, ...(job.journals || [])] });
        setNote('');
    };

    const deleteJournal = (id: string) => {
        const updated = (job.journals || []).filter(j => j.id !== id);
        onUpdate({ journals: updated });
    };

    const startEdit = (j: any) => {
        setEditingId(j.id);
        setEditText(j.entry);
    };

    const saveEdit = (id: string) => {
        const updated = (job.journals || []).map(j =>
            j.id === id ? { ...j, entry: editText, editedAt: new Date().toLocaleString() } : j
        );
        onUpdate({ journals: updated });
        setEditingId(null);
        setEditText('');
    };

    const journalTypeColors: Record<string, string> = {
        'Note': 'bg-blue-100 text-blue-700',
        'Observation': 'bg-emerald-100 text-emerald-700',
        'Handover': 'bg-blue-100 text-blue-700',
        'Safety': 'bg-red-100 text-red-700',
        'SYSTEM': 'bg-slate-200 text-slate-600'
    };

    // Phase 4: asset reliability context (failure history → MTBF/MTTR + RCA signal).
    const [relMetrics, setRelMetrics] = useState<AssetReliability | null>(null);
    useEffect(() => {
        let active = true;
        if (!job.assetId) { setRelMetrics(null); return; }
        DatabaseService.getInstance().getWorkOrdersByAssetId(job.assetId)
            .then(recs => { if (active) setRelMetrics(computeAssetReliability(recs as any[])); })
            .catch(() => { if (active) setRelMetrics(null); });
        return () => { active = false; };
    }, [job.assetId]);

    // Gate 2: Closeout quality — advisory strip + Specialist review.
    const { openRelantern } = useRelantern();
    const closeout = assessCloseout(job, { isPreventive });
    const handleReviewCloseout = () => {
        const tasks = job.tasks || [];
        const done = tasks.filter(t => String(t.status).toUpperCase() === 'COMPLETED').length;
        const fd = job.failureData || {};
        const missing = closeout.blockers.map(b => b.label).join(', ') || 'none';
        const context = [
            `WORK ORDER CLOSEOUT REVIEW`,
            `WO ${job.woNumber || job.id} | Type: ${job.type} | Status: ${job.status}`,
            `Asset: ${job.assetCode ? job.assetCode + ' - ' : ''}${job.assetName || 'UNLINKED'}`,
            `Scope: ${(job.description || '').trim() || '(none)'}`,
            `Tasks: ${done}/${tasks.length} step(s) completed.`,
            `Findings/journal entries: ${(job.journals || []).length}.`,
            `Failure coding (ISO 14224): mode=${fd.failureMode || 'none'}, cause=${fd.failureCause || 'none'}, remedy=${fd.remedyCode || 'none'}.`,
            `Actuals: duration=${job.actualDuration || 0}h.`,
            `Closeout quality: ${closeout.score}% | Missing required: ${missing}.`,
            relMetrics ? `Asset reliability (12mo): ${relMetrics.failures12mo} failure(s)${relMetrics.mtbfDays != null ? `, MTBF ${relMetrics.mtbfDays}d` : ''}${relMetrics.recurringModes.length ? `, recurring modes: ${relMetrics.recurringModes.map(m => `${m.mode}×${m.count}`).join(', ')}` : ''}.` : '',
            relMetrics?.recommendRCA ? `RCA SIGNAL: ${relMetrics.rcaReason}` : '',
            isPreventive ? `This is preventive/inspection work.` : `This is corrective work — failure coding expected.`,
        ].filter(Boolean).join('\n');
        const prompt = `As a reliability engineer, review this work order's CLOSE-OUT quality for a trustworthy ISO 14224 record. Be specific and concise. Provide:\n1. Findings — is the work documented well enough? What's missing?\n2. Failure coding — is the mode/cause sensible for this asset and symptom? Suggest the most likely mode & cause if missing or weak.\n3. Reliability — does this warrant an RCA (repeat or critical failure) or an FMEA/PM change?\n4. Verdict — is this OK to close, and the top fixes to make it a quality record.`;
        openRelantern(context, 'workOrder', prompt);
    };

    return (
        <div className="flex flex-col gap-3 md:gap-4 animate-in fade-in duration-300">
            {/* ══ Closeout Quality (Gate 2) — advisory ══ */}
            <CloseoutReadinessStrip readiness={closeout} onReview={handleReviewCloseout} />

            {/* ══ Asset Reliability context (Phase 4) — SMRP equipment-reliability KPIs ══ */}
            {relMetrics && relMetrics.totalFailures > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white p-3 md:p-4">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2"><AlertOctagon size={15} className="text-blue-600" /> Asset Reliability</h3>
                        <span className="text-[10px] text-slate-400 uppercase tracking-wide">last 12 months</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {([
                            ['Failures (12mo)', String(relMetrics.failures12mo)],
                            ['MTBF', relMetrics.mtbfDays != null ? `${relMetrics.mtbfDays}d` : '—'],
                            ['MTTR', relMetrics.mttrHours != null ? `${relMetrics.mttrHours}h` : '—'],
                            ['Last failure', relMetrics.lastFailureDate ? new Date(relMetrics.lastFailureDate).toLocaleDateString() : '—'],
                        ] as [string, string][]).map(([label, value]) => (
                            <div key={label} className="bg-slate-50 rounded-lg p-2 text-center border border-slate-100">
                                <div className="text-base font-extrabold text-slate-800">{value}</div>
                                <div className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</div>
                            </div>
                        ))}
                    </div>
                    {relMetrics.recurringModes.length > 0 && (
                        <div className="mt-2 flex items-center gap-1.5 flex-wrap text-[11px]">
                            <span className="text-slate-500 font-semibold flex items-center gap-1"><Repeat size={11} /> Recurring modes:</span>
                            {relMetrics.recurringModes.slice(0, 4).map(m => (
                                <span key={m.mode} className="px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-semibold">{m.mode} ×{m.count}</span>
                            ))}
                        </div>
                    )}
                    {relMetrics.recommendRCA && (
                        <div className="mt-2.5 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-800">
                            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                            <div><span className="font-bold">RCA recommended.</span> {relMetrics.rcaReason} Use “Raise RCA” in the header to investigate.</div>
                        </div>
                    )}
                </div>
            )}

            {/* Top Row: Failure Analysis (context-aware) + Follow-Up */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                {/* Failure Analysis Card */}
                <div className="bg-white p-3 md:p-4 rounded-lg border border-slate-200 shadow-sm">
                    <h3 className="font-bold text-xs md:text-sm text-slate-800 border-b border-slate-100 pb-2 mb-3 flex items-center gap-1.5">
                        <AlertOctagon className={isPreventive ? 'text-green-600' : 'text-red-600'} size={14} /> Failure Analysis
                    </h3>

                    {isPreventive ? (
                        <div className="space-y-3">
                            <div className="bg-green-50 p-3 rounded-lg border border-green-200">
                                <div className="flex items-center gap-2 mb-1.5">
                                    <CheckCircle size={16} className="text-green-600" />
                                    <span className="font-bold text-green-800 text-sm">Not Required for Preventive Maintenance</span>
                                </div>
                                <p className="text-xs text-green-700 leading-relaxed">
                                    Failure coding is not required for PM work orders since no failure has occurred.
                                    Use the <strong>"Raise Follow-Up"</strong> button if a defect was found during inspection.
                                </p>
                            </div>
                            {/* Show pre-populated failure impacts from PM template (read-only context) */}
                            {(job.failureData?.localImpact || job.failureData?.plantWideImpact) && (
                                <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                                    <h4 className="text-[10px] font-bold text-blue-700 uppercase mb-2 flex items-center gap-1">
                                        <Shield size={11} /> PM Failure Impact Context (from PM Strategy)
                                    </h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        {job.failureData.localImpact && (
                                            <div>
                                                <p className="text-[10px] font-bold text-blue-600 uppercase mb-0.5">Local Impact</p>
                                                <p className="text-xs text-blue-800 bg-white p-2 rounded border border-blue-100">{job.failureData.localImpact}</p>
                                            </div>
                                        )}
                                        {job.failureData.plantWideImpact && (
                                            <div>
                                                <p className="text-[10px] font-bold text-blue-600 uppercase mb-0.5">Plant-Wide Impact</p>
                                                <p className="text-xs text-blue-800 bg-white p-2 rounded border border-blue-100">{job.failureData.plantWideImpact}</p>
                                            </div>
                                        )}
                                    </div>
                                    <p className="text-[9px] text-blue-400 mt-1.5">These impacts describe what this PM prevents. They are inherited from the parent PM strategy.</p>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="bg-blue-50 p-2 rounded text-[11px] text-blue-800 border border-blue-100">
                                Accurate failure coding is essential for Reliability Centered Maintenance (RCM) and Root Cause Analysis (RCA).
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <label className="block text-[10px] font-bold text-slate-500 uppercase">Failure Mode <span className="text-red-500">*</span></label>
                                    {job.assetId && ersApi.isConfigured && (
                                        <button
                                            onClick={async () => {
                                                setAiSuggestingModes(true);
                                                try {
                                                    const suggestions = await ersApi.suggestFailureModes(job.id, (job as any).assetClass || 'rotating_equipment');
                                                    const codes = suggestions.map((s: any) => s.code || s.failure_mode || s);
                                                    setAiSuggestedModes(codes.slice(0, 5));
                                                } catch (err) {
                                                    console.log('[AnalysisTab] AI failure mode suggestion unavailable:', err);
                                                }
                                                setAiSuggestingModes(false);
                                            }}
                                            disabled={aiSuggestingModes}
                                            className="text-[9px] font-medium text-blue-600 hover:text-blue-800 flex items-center gap-0.5 transition disabled:opacity-50"
                                        >
                                            {aiSuggestingModes ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                                            AI Suggest
                                        </button>
                                    )}
                                </div>
                                {/* AI-suggested failure modes chips */}
                                {aiSuggestedModes.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mb-1.5">
                                        {aiSuggestedModes.map(code => {
                                            const fm = failureModes.find(f => f.code === code);
                                            return fm ? (
                                                <button
                                                    key={code}
                                                    onClick={() => { handleFailureModeChange(code); setAiSuggestedModes([]); }}
                                                    className="text-[9px] px-2 py-1 bg-blue-50 text-blue-700 rounded-full border border-blue-200 hover:bg-blue-100 transition"
                                                >
                                                    {fm.description || code}
                                                </button>
                                            ) : null;
                                        })}
                                    </div>
                                )}
                                <SearchableSelect
                                    value={job.failureData?.failureMode || ''}
                                    onChange={handleFailureModeChange}
                                    options={failureModes}
                                    placeholder="-- Select Failure Mode --"
                                    groupKey="categoryRef"
                                    allowManualEntry
                                    allOptions={allFailureModes}
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Failure Cause <span className="text-slate-400 font-normal">(Optional)</span></label>
                                <SearchableSelect
                                    value={job.failureData?.failureCause || ''}
                                    onChange={handleFailureCauseChange}
                                    options={failureCauses}
                                    placeholder="-- Select Failure Cause --"
                                    allowManualEntry
                                    allOptions={allFailureCauses}
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Action Taken <span className="text-slate-400 font-normal">(Optional)</span></label>
                                <textarea
                                    value={localActionTaken}
                                    onChange={(e) => setLocalActionTaken(e.target.value)}
                                    onBlur={flushActionTaken}
                                    className="w-full h-14 p-2 border border-slate-300 rounded-lg text-xs bg-white focus:ring-1 focus:ring-primary-500 resize-none"
                                    placeholder="Describe the corrective action taken..."
                                />
                            </div>

                            {/* Failure Impact Fields (ISO 14224 §B.2.5) */}
                            <div className="pt-3 mt-3 border-t border-slate-100">
                                <div className="flex items-center justify-between mb-2">
                                    <h4 className="text-[10px] font-bold text-slate-600 uppercase flex items-center gap-1">
                                        <AlertTriangle size={11} className="text-amber-500" /> Failure Effects (ISO 14224)
                                    </h4>
                                    {job.failureData?.failureMode && (
                                        <button
                                            onClick={async () => {
                                                setAiSuggestingEffects(true);
                                                try {
                                                    const fmEntry = failureModes.find(fm => fm.code === job.failureData?.failureMode);
                                                    const result = await aiEngine.suggestFailureEffects({
                                                        failureMode: job.failureData?.failureMode || '',
                                                        failureModeDescription: fmEntry?.description,
                                                        assetName: job.assetName || (job as any).assetTag,
                                                        assetType: job.type,
                                                    });
                                                    if (result.localEffect) setLocalLocalImpact(result.localEffect);
                                                    if (result.plantWideEffect) setLocalPlantWideImpact(result.plantWideEffect);
                                                    // Flush to parent
                                                    onUpdate({
                                                        failureData: {
                                                            ...job.failureData,
                                                            localImpact: result.localEffect || localLocalImpact,
                                                            plantWideImpact: result.plantWideEffect || localPlantWideImpact,
                                                        }
                                                    });
                                                } catch (e) { console.error('[AI] Effect suggestion failed:', e); }
                                                setAiSuggestingEffects(false);
                                            }}
                                            disabled={aiSuggestingEffects}
                                            className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded-md bg-gradient-to-r from-blue-500 to-blue-500 text-white hover:from-blue-600 hover:to-blue-600 transition-all disabled:opacity-50 shadow-sm"
                                        >
                                            {aiSuggestingEffects ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                                            {aiSuggestingEffects ? 'Analyzing...' : '✨ AI Suggest'}
                                        </button>
                                    )}
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Local Effect <span className="text-slate-400 font-normal">(Equipment)</span></label>
                                        <textarea
                                            value={localLocalImpact}
                                            onChange={(e) => setLocalLocalImpact(e.target.value)}
                                            onBlur={flushLocalImpact}
                                            className="w-full h-14 p-2 border border-slate-300 rounded-lg text-xs bg-white focus:ring-1 focus:ring-primary-500 resize-none"
                                            placeholder="Impact on the equipment/subsystem itself..."
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Plant-Wide Effect <span className="text-slate-400 font-normal">(Production/Safety)</span></label>
                                        <textarea
                                            value={localPlantWideImpact}
                                            onChange={(e) => setLocalPlantWideImpact(e.target.value)}
                                            onBlur={flushPlantWideImpact}
                                            className="w-full h-14 p-2 border border-slate-300 rounded-lg text-xs bg-white focus:ring-1 focus:ring-primary-500 resize-none"
                                            placeholder="Impact on production, safety, or environment..."
                                        />
                                    </div>
                                </div>
                                {job.recurringWorkId && (localLocalImpact || localPlantWideImpact) && (
                                    <p className="text-[10px] text-blue-500 mt-1.5 flex items-center gap-1">
                                        <Shield size={10} /> Pre-populated from PM Strategy — editable during WO execution.
                                    </p>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Follow-Up Card — visible for all work types */}
                <div className="bg-white p-3 md:p-4 rounded-lg border border-slate-200 shadow-sm">
                    <h3 className="font-bold text-xs md:text-sm text-slate-800 border-b border-slate-100 pb-2 mb-3 flex items-center gap-1.5">
                        <GitPullRequest className="text-amber-600" size={14} /> Follow-Up Actions
                    </h3>
                    <div className="space-y-3">
                        <p className="text-xs text-slate-600">
                            {isPreventive
                                ? 'If a defect or abnormal condition was discovered during this inspection, complete the work order and raise a follow-up corrective work order.'
                                : 'Complete this work order and optionally raise a follow-up for additional corrective actions, secondary defects, or related remediation work.'}
                        </p>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Follow-Up Description <span className="text-red-500">*</span></label>
                            <textarea
                                value={followUpDescription}
                                onChange={(e) => onFollowUpDescriptionChange?.(e.target.value)}
                                className="w-full h-20 p-2.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-1 focus:ring-amber-500 focus:border-amber-500 resize-none placeholder:text-slate-400"
                                placeholder="Describe the defect, abnormal condition, or required follow-up action in detail..."
                            />
                            <p className="text-[10px] text-slate-400 mt-1">This description will be included in the follow-up work order for the corrective team.</p>
                        </div>
                        <button
                            onClick={() => onOpenCompleteModal?.()}
                            disabled={!followUpDescription.trim()}
                            className={`w-full px-4 py-2.5 border-2 border-dashed font-bold rounded-lg flex items-center justify-center gap-2 transition-all text-sm ${followUpDescription.trim()
                                    ? 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100 hover:border-amber-400 cursor-pointer'
                                    : 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed'
                                }`}
                        >
                            <AlertTriangle size={16} /> Complete &amp; Raise Follow-Up
                        </button>
                    </div>
                </div>
            </div>

            {/* Bottom Row: Unified Journals & Notes (full width) */}
            <div className="bg-white p-3 md:p-4 rounded-lg border border-slate-200 shadow-sm flex flex-col" style={{ minHeight: isPreventive ? '350px' : '400px' }}>
                <h3 className="font-bold text-xs md:text-sm text-slate-800 border-b border-slate-100 pb-2 mb-3 flex items-center gap-1.5">
                    <Book className="text-blue-600" size={14} /> Journals & Notes
                    <span className="text-[10px] font-normal text-slate-400 ml-auto">{(job.journals || []).length} entries</span>
                </h3>

                {/* Add Entry — with type selector */}
                <div className="mb-3">
                    <div className="flex items-center gap-2 mb-1.5">
                        <select
                            value={journalType}
                            onChange={(e) => setJournalType(e.target.value)}
                            className="text-[10px] font-bold border border-slate-200 rounded px-1.5 py-1 bg-slate-50 text-slate-600 uppercase"
                        >
                            <option value="Note">Note</option>
                            <option value="Observation">Observation</option>
                            <option value="Handover">Handover</option>
                            <option value="Safety">Safety</option>
                        </select>
                        <span className="text-[10px] text-slate-400">as {profile?.username || 'Unknown'}</span>
                    </div>
                    <div className="relative">
                        <textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            className="w-full border border-slate-300 rounded-lg p-2 md:p-3 text-xs h-16 focus:ring-1 focus:ring-primary-500 pr-12 resize-none"
                            placeholder={`Add ${journalType.toLowerCase()} entry...`}
                            onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey) addJournal(); }}
                        />
                        <button
                            onClick={addJournal}
                            disabled={!note.trim()}
                            className="absolute bottom-2 right-2 p-1.5 sm:p-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-500 disabled:opacity-50 disabled:hover:bg-primary-600 transition min-w-[32px] min-h-[32px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
                            title="Add entry (Ctrl+Enter)"
                        >
                            <ArrowRight size={14} />
                        </button>
                    </div>
                </div>

                {/* Timeline */}
                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                    {job.journals?.length ? (
                        job.journals.map(j => (
                            <div key={j.id} className="relative pl-4 border-l-2 border-slate-100 group">
                                <div className={`absolute -left-[5px] top-2 w-2.5 h-2.5 rounded-full border-2 border-white ${j.isSystem ? 'bg-slate-300' : 'bg-blue-500'}`}></div>
                                <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-100 hover:border-slate-200 transition">
                                    <div className="flex justify-between items-start mb-1">
                                        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${journalTypeColors[j.type] || journalTypeColors['Note']}`}>
                                            {j.type}
                                        </span>
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[10px] text-slate-400">{j.createdAt}</span>
                                            {!j.isSystem && (
                                                <div className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex gap-0.5">
                                                    <button
                                                        onClick={() => startEdit(j)}
                                                        className="p-1 sm:p-0.5 text-slate-400 hover:text-blue-600 rounded min-w-[28px] min-h-[28px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
                                                        title="Edit"
                                                    >
                                                        <Edit3 size={11} />
                                                    </button>
                                                    <button
                                                        onClick={() => { if (confirm('Delete this journal entry?')) deleteJournal(j.id); }}
                                                        className="p-1 sm:p-0.5 text-slate-400 hover:text-red-600 rounded min-w-[28px] min-h-[28px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
                                                        title="Delete"
                                                    >
                                                        <Trash2 size={11} />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="text-[11px] font-semibold text-slate-600 mb-0.5">{j.createdBy}</div>
                                    {editingId === j.id ? (
                                        <div className="space-y-1.5">
                                            <textarea
                                                value={editText}
                                                onChange={(e) => setEditText(e.target.value)}
                                                className="w-full border border-blue-300 rounded p-1.5 text-xs bg-blue-50 focus:ring-1 focus:ring-primary-500 resize-none h-16"
                                                autoFocus
                                            />
                                            <div className="flex gap-1.5">
                                                <button onClick={() => saveEdit(j.id)} className="px-2 py-0.5 text-[10px] font-bold bg-blue-600 text-white rounded hover:bg-primary-500">Save</button>
                                                <button onClick={() => setEditingId(null)} className="px-2 py-0.5 text-[10px] text-slate-500 bg-slate-100 rounded hover:bg-slate-200">Cancel</button>
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="text-xs text-slate-600 whitespace-pre-wrap">{j.entry}</p>
                                    )}
                                    {(j as any).editedAt && editingId !== j.id && (
                                        <span className="text-[9px] text-slate-400 italic mt-1 block">edited {(j as any).editedAt}</span>
                                    )}
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="text-center py-8 text-slate-400">
                            <MessageSquare size={24} className="mx-auto mb-2 opacity-20" />
                            <p className="text-xs">No journal entries yet. Add a note above.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// ─── Asset Picker (SAP search-help / MaintainX-style): search assets, color-coded by node type ───
const AssetPickerModal: React.FC<{
    open: boolean;
    assets: any[];
    currentAssetId?: string;
    onClose: () => void;
    onSelect: (asset: any, path: string[]) => void;
}> = ({ open, assets, currentAssetId, onClose, onSelect }) => {
    const [search, setSearch] = useState('');
    if (!open) return null;
    const isLoc = (a: any) =>
        a?.isLocation === true ||
        /location/i.test(String(a?.assetType || a?.type || '')) ||
        String(a?.assetCategory || a?.asset_category || '').toLowerCase() === 'location';
    const buildPath = (asset: any): string[] => {
        const path: string[] = [];
        let cur = asset?.parentId ? assets.find(a => a.id === asset.parentId) : null;
        let guard = 0;
        while (cur && guard++ < 25) {
            path.unshift(cur.tag || cur.name);
            cur = cur.parentId ? assets.find(a => a.id === cur.parentId) : null;
        }
        return path;
    };
    const q = search.trim().toLowerCase();
    const filtered = assets
        .filter(a => !q || String(a.tag || '').toLowerCase().includes(q) || String(a.name || '').toLowerCase().includes(q))
        .slice(0, 300);
    return (
        <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150" onClick={e => e.stopPropagation()}>
                <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                    <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2"><Package size={16} className="text-blue-600" /> Select Asset</h3>
                    <button onClick={onClose}><X size={18} className="text-slate-400 hover:text-slate-600" /></button>
                </div>
                <div className="p-3 border-b border-slate-100">
                    <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by tag or name…" className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-primary-500 outline-none" />
                </div>
                <div className="flex-1 overflow-y-auto">
                    {filtered.length === 0 ? (
                        <div className="p-10 text-center text-slate-400 text-sm">No assets found</div>
                    ) : filtered.map(a => {
                        const loc = isLoc(a);
                        const path = buildPath(a);
                        return (
                            <button key={a.id} onClick={() => { onSelect(a, path); onClose(); }} className={`w-full flex items-center gap-3 px-4 py-2.5 text-left border-b border-slate-100 hover:bg-slate-50 transition-colors ${a.id === currentAssetId ? 'bg-blue-50' : ''}`}>
                                <span className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${loc ? 'bg-emerald-100 text-emerald-600' : 'bg-blue-100 text-blue-600'}`}>{loc ? <MapPin size={14} /> : <Package size={14} />}</span>
                                <span className="min-w-0 flex-1">
                                    <span className="block text-sm font-semibold text-slate-800 truncate">{a.tag}</span>
                                    <span className="block text-xs text-slate-500 truncate">{path.length > 0 ? `${path.join(' › ')} › ` : ''}{a.name}</span>
                                </span>
                                {a.id === currentAssetId && <CheckCircle size={15} className="text-blue-500 flex-shrink-0" />}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

// ─── Parent Work Order Picker (SAP superior-order style) ───
const ParentWoPickerModal: React.FC<{
    open: boolean;
    workOrders: any[];
    excludeId?: string;
    currentId?: string;
    onClose: () => void;
    onSelect: (wo: any) => void;
}> = ({ open, workOrders, excludeId, currentId, onClose, onSelect }) => {
    const [search, setSearch] = useState('');
    if (!open) return null;
    const num = (w: any) => w.woNumber || w.wo_number || w.id;
    const title = (w: any) => w.title || w.description || '';
    const q = search.trim().toLowerCase();
    const filtered = workOrders
        .filter(w => w.id !== excludeId)
        .filter(w => !q || String(num(w)).toLowerCase().includes(q) || String(title(w)).toLowerCase().includes(q))
        .slice(0, 300);
    return (
        <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150" onClick={e => e.stopPropagation()}>
                <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                    <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2"><FileText size={16} className="text-blue-600" /> Select Parent Work Order</h3>
                    <button onClick={onClose}><X size={18} className="text-slate-400 hover:text-slate-600" /></button>
                </div>
                <div className="p-3 border-b border-slate-100">
                    <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by WO number or title…" className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-primary-500 outline-none" />
                </div>
                <div className="flex-1 overflow-y-auto">
                    {filtered.length === 0 ? (
                        <div className="p-10 text-center text-slate-400 text-sm">No work orders found</div>
                    ) : filtered.map(w => (
                        <button key={w.id} onClick={() => { onSelect(w); onClose(); }} className={`w-full flex items-center gap-3 px-4 py-2.5 text-left border-b border-slate-100 hover:bg-slate-50 transition-colors ${w.id === currentId ? 'bg-blue-50' : ''}`}>
                            <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-blue-100 text-blue-600"><FileText size={14} /></span>
                            <span className="min-w-0 flex-1">
                                <span className="block text-sm font-semibold text-slate-800 truncate">{num(w)}</span>
                                <span className="block text-xs text-slate-500 truncate">{title(w)}</span>
                            </span>
                            {w.id === currentId && <CheckCircle size={15} className="text-blue-500 flex-shrink-0" />}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

// ─── Work Readiness strip (Gate 1: Planning) — advisory governance UI ───
const READINESS_CLASS_BADGE: Record<string, { label: string; cls: string }> = {
    PROACTIVE: { label: 'Proactive', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    REACTIVE: { label: 'Reactive', cls: 'bg-red-100 text-red-700 border-red-200' },
    UNCLASSIFIED: { label: 'Planning', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
};
// Generic governance gate strip — shared by the Planning and Closeout gates.
const GateStrip: React.FC<{
    title: string;
    readiness: ReadinessResult;
    readyText: string;
    incompleteText: (n: number) => string;
    scoreTitle: string;
    leftBadges?: React.ReactNode;
    reviewLabel?: string;
    onReview?: () => void;
    isExpanded?: boolean;
    onToggleExpand?: () => void;
}> = ({ title, readiness, readyText, incompleteText, scoreTitle, leftBadges, reviewLabel = 'Review with Specialist', onReview, isExpanded, onToggleExpand }) => {
    const { score, requiredMet, items, blockers } = readiness;
    const ring = score >= 80 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444';
    return (
        <div className={`rounded-xl border p-3 md:p-4 ${requiredMet ? 'bg-emerald-50/50 border-emerald-200' : 'bg-amber-50/50 border-amber-200'}`}>
            <div className="flex items-center gap-3 flex-wrap">
                {/* Score ring */}
                <div className="relative w-12 h-12 flex-shrink-0" title={scoreTitle}>
                    <div className="w-12 h-12 rounded-full" style={{ background: `conic-gradient(${ring} ${score * 3.6}deg, #e2e8f0 0deg)` }} />
                    <div className="absolute inset-[3px] rounded-full bg-white flex items-center justify-center text-xs font-extrabold text-slate-700">{score}</div>
                </div>
                {/* Title + status */}
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-slate-800">{title}</span>
                        {leftBadges}
                        {onReview && (
                            <button
                                onClick={onReview}
                                title="Have the Reliability Specialist review this"
                                className="inline-flex items-center gap-1 text-[10px] font-bold text-white bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 px-2 py-0.5 rounded-full shadow-sm transition-all"
                            >
                                <Sparkles size={11} /> {reviewLabel}
                            </button>
                        )}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">{requiredMet ? readyText : incompleteText(blockers.length)}</p>
                </div>
                {/* Criteria chips */}
                <div className={`items-center gap-1.5 flex-wrap md:ml-auto w-full md:w-auto ${onToggleExpand ? (isExpanded ? 'flex' : 'hidden md:flex') : 'flex'}`}>
                    {items.map(it => (
                        <span
                            key={it.id}
                            title={it.hint}
                            className={`text-[10px] font-semibold px-2 py-1 rounded-full border flex items-center gap-1 ${
                                it.met
                                    ? 'bg-white text-emerald-700 border-emerald-200'
                                    : it.severity === 'required'
                                        ? 'bg-white text-amber-700 border-amber-300'
                                        : 'bg-white text-slate-400 border-slate-200'
                            }`}
                        >
                            {it.met ? <CheckCircle size={11} /> : <AlertTriangle size={11} />}
                            {it.label}
                        </span>
                    ))}
                </div>

                {onToggleExpand && (
                    <div className="w-full md:hidden flex justify-end pt-2 border-t border-slate-100/50 mt-1">
                        <button
                            type="button"
                            onClick={onToggleExpand}
                            className="text-xs font-bold text-blue-650 hover:text-blue-800 flex items-center gap-1 transition-colors"
                        >
                            {isExpanded ? 'Hide Details' : 'Show Details'}
                            <ChevronDown size={14} className={`transform transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

const WorkReadinessStrip: React.FC<{
    readiness: ReadinessResult;
    onReview?: () => void;
    isExpanded?: boolean;
    onToggleExpand?: () => void;
}> = ({ readiness, onReview, isExpanded, onToggleExpand }) => {
    const badge = READINESS_CLASS_BADGE[readiness.classification] || READINESS_CLASS_BADGE.UNCLASSIFIED;
    return (
        <GateStrip
            title="Work Readiness"
            readiness={readiness}
            readyText="Planning essentials in place — ready to schedule."
            incompleteText={(n) => `${n} planning item${n === 1 ? '' : 's'} to complete before scheduling.`}
            scoreTitle={`Planning readiness: ${readiness.score}%`}
            leftBadges={<>
                <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${badge.cls}`}>{badge.label}</span>
                {readiness.isHighCriticality && <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">Crit A/B</span>}
            </>}
            reviewLabel="Review plan with Specialist"
            onReview={onReview}
            isExpanded={isExpanded}
            onToggleExpand={onToggleExpand}
        />
    );
};

const CloseoutReadinessStrip: React.FC<{ readiness: ReadinessResult; onReview?: () => void }> = ({ readiness, onReview }) => (
    <GateStrip
        title="Closeout Quality"
        readiness={readiness}
        readyText="Closeout essentials captured — quality record."
        incompleteText={(n) => `${n} closeout item${n === 1 ? '' : 's'} needed before closing.`}
        scoreTitle={`Closeout quality: ${readiness.score}%`}
        leftBadges={<span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${readiness.requiredMet ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-amber-100 text-amber-700 border-amber-200'}`}>{readiness.requiredMet ? 'Ready to close' : 'Incomplete'}</span>}
        reviewLabel="Review closeout with Specialist"
        onReview={onReview}
    />
);

// --- Other Tabs (Unchanged except minor prop threading if needed, mostly static in this refactor) ---

const DetailsTab: React.FC<{ job: WorkOrder, onUpdate: (u: Partial<WorkOrder>) => void, dictionaries: DictionaryEntry[] }> = ({ job, onUpdate, dictionaries }) => {
    const [isFieldsExpanded, setIsFieldsExpanded] = useState(false);
    const tasks = job.tasks || [];
    const completedTasksCount = tasks.filter(t => t.status === 'COMPLETED').length;
    const totalTasksCount = tasks.length;
    const workCompletionPct = totalTasksCount > 0 ? Math.round((completedTasksCount / totalTasksCount) * 100) : 0;

    // ── Asset / Parent-WO pickers (SAP/MaintainX best practice: editable, locked once TECO/CLOSED) ──
    const isRefLocked = job.status === WorkOrderStatus.CLOSED || job.status === WorkOrderStatus.TECO;
    const [showAssetPicker, setShowAssetPicker] = useState(false);
    const [showParentPicker, setShowParentPicker] = useState(false);
    const [pickAssets, setPickAssets] = useState<any[]>([]);
    const [pickWOs, setPickWOs] = useState<any[]>([]);
    useEffect(() => {
        DatabaseService.getInstance().getAssets().then(a => setPickAssets(a || [])).catch(() => {});
        DatabaseService.getInstance().getWorkOrders().then(w => setPickWOs((w as any[]) || [])).catch(() => {});
    }, []);
    const parentWoLabel = (() => {
        if (!job.parentWoId) return '';
        const w = pickWOs.find((x: any) => x.id === job.parentWoId);
        return w ? (w.woNumber || w.wo_number || job.parentWoId) : job.parentWoId;
    })();

    // Work Readiness (Gate 1: Planning) — asset criticality drives mandatory items.
    const assetCriticality = (pickAssets.find((a: any) => a.id === job.assetId) || {}).criticality;
    const readiness = assessReadiness(job, { criticality: assetCriticality });

    // "Review plan with Specialist" — hand the WO context to the Reliability AI and
    // auto-run a structured plan/readiness/RCA review.
    const { openRelantern } = useRelantern();
    const handleReviewPlan = () => {
        const tasks = job.tasks || [];
        const withInstr = tasks.filter(t => (t.instructions || []).length > 0).length;
        const estHrs = job.estDuration && job.estDuration > 0 ? job.estDuration : tasks.reduce((s, t) => s + (t.estHours || 0), 0);
        const jsaHaz = job.jsa?.hazards?.length || 0;
        const missing = readiness.blockers.map(b => b.label).join(', ') || 'none';
        const context = [
            `WORK ORDER PLAN REVIEW`,
            `WO ${job.woNumber || job.id} | Type: ${job.type} | Status: ${job.status} | Priority: ${job.priority || '—'}`,
            `Asset: ${job.assetCode ? job.assetCode + ' - ' : ''}${job.assetName || 'UNLINKED'}${assetCriticality ? ' | Criticality: ' + assetCriticality : ''}`,
            (job.assetPath && job.assetPath.length) ? `Location: ${job.assetPath.join(' > ')} > ${job.assetName || ''}` : '',
            `Scope: ${(job.description || '').trim() || '(none provided)'}`,
            `Job plan: ${tasks.length} step(s), ${withInstr} with instructions. Estimated effort: ${estHrs}h.`,
            `Labour: ${(job.labor || []).length > 0 ? `${job.labor!.length} craft/person line(s) assigned` : 'NONE assigned'}.`,
            `Parts/kitting: ${(job.inventory || []).length > 0 ? `${job.inventory!.length} part line(s) identified` : 'none identified'}.`,
            `Safety: JSA with ${jsaHaz} hazard(s)${jsaHaz ? '' : ' — none assessed'}.`,
            `Readiness: ${readiness.score}% | Classification: ${readiness.classification} | Missing planning essentials: ${missing}.`,
        ].filter(Boolean).join('\n');
        const prompt = `As a senior maintenance planner and reliability engineer, critically review this work order and make it proactive, well-planned work. Be specific and concise. Provide:\n1. Job plan — gaps and the key task steps to add, in sequence.\n2. Resources — explicitly call out if labour is unassigned or parts/kitting are missing, then recommend the crafts/skills, spare parts, special tools and permits this job needs.\n3. Safety — likely hazards and whether the JSA is adequate.\n4. Reliability — should an RCA be raised (repeat or critical failure)? Any FMEA / PM implication for this asset?\n5. Verdict — a readiness call and the top 3 actions before this job is scheduled.`;
        openRelantern(context, 'workOrder', prompt);
    };

    const handleScheduleChange = (field: keyof WorkOrder, value: string) => {
        const updates: Partial<WorkOrder> = { [field]: value };

        // Auto-calculate Duration (Elapsed / Wall-Clock)
        // Use current value or update value, and Format to YYYY-MM-DD to ensure clean Date construction
        const rawStart = field === 'dateDueStart' ? value : job.dateDueStart;
        const newStart = rawStart ? formatDateForInput(rawStart) : '';

        const newStartTime = field === 'timeDueStart' ? value : job.timeDueStart;

        const rawEnd = field === 'dueDate' ? value : job.dueDate;
        const newEnd = rawEnd ? formatDateForInput(rawEnd) : '';

        const newEndTime = field === 'timeDueFinish' ? value : job.timeDueFinish;

        // Validation: Start vs End
        if (newStart && newStartTime && newEnd && newEndTime) {
            const start = new Date(`${newStart}T${newStartTime}`);
            const end = new Date(`${newEnd}T${newEndTime}`);

            if (end < start) {
                // Invalid: Finish before Start
                // For now, we allow the input but don't calculate a negative duration.
                // In a stricter system, we might reject the change or show a toast.
                console.warn('Scheduled Finish is before Scheduled Start');
            } else {
                const diff = (end.getTime() - start.getTime()) / (1000 * 60 * 60); // Hours
                if (!isNaN(diff) && diff >= 0) {
                    updates.estDuration = parseFloat(diff.toFixed(2));
                }
            }
        }
        onUpdate(updates);
    };

    // Helper to get description or fallback
    const getDesc = (type: string, code: string) => dictionaries.find(d => d.type === type && d.code === code)?.description || code;

    // Helper to format date for input (YYYY-MM-DD)
    const formatDateForInput = (dateStr?: string) => {
        if (!dateStr || dateStr === 'undefined') return '';
        if (dateStr.includes('T')) return dateStr.split('T')[0];
        return dateStr;
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 animate-in fade-in duration-300">
            <AssetPickerModal
                open={showAssetPicker}
                assets={pickAssets}
                currentAssetId={job.assetId}
                onClose={() => setShowAssetPicker(false)}
                onSelect={(asset, path) => onUpdate({ assetId: asset.id, assetCode: asset.tag, assetName: asset.name, assetPath: path })}
            />
            <ParentWoPickerModal
                open={showParentPicker}
                workOrders={pickWOs}
                excludeId={job.id}
                currentId={job.parentWoId}
                onClose={() => setShowParentPicker(false)}
                onSelect={(wo) => onUpdate({ parentWoId: wo.id })}
            />
            {/* ══ Work Readiness (Gate 1: Planning) — advisory ══ */}
            <div className="lg:col-span-2">
                <WorkReadinessStrip
                    readiness={readiness}
                    onReview={handleReviewPlan}
                    isExpanded={isFieldsExpanded}
                    onToggleExpand={() => setIsFieldsExpanded(!isFieldsExpanded)}
                />
            </div>

            {/* Core Info */}
            <div className={`bg-white p-4 md:p-5 lg:p-6 rounded-xl border border-slate-200 shadow-sm space-y-4 ${isFieldsExpanded ? 'block' : 'hidden lg:block'}`}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Asset</label>
                        <div className="flex gap-1.5">
                            <input type="text"
                                value={job.assetCode ? `${job.assetCode} - ${job.assetName}` : (job.assetName || '')}
                                className="w-full text-sm border border-slate-300 rounded-lg bg-slate-50 px-3 py-2.5 text-slate-700 font-medium"
                                readOnly
                            />
                            <button
                                type="button"
                                onClick={() => !isRefLocked && setShowAssetPicker(true)}
                                disabled={isRefLocked}
                                title={isRefLocked ? 'Asset is locked on completed/closed work orders' : 'Browse & change asset'}
                                className={`p-1.5 border rounded-lg flex-shrink-0 transition-colors ${isRefLocked ? 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed' : 'bg-slate-100 border-slate-300 text-slate-600 hover:bg-slate-200'}`}
                            ><Folder size={14} /></button>
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Status</label>
                        <select
                            className="w-full text-sm border border-slate-300 rounded-lg bg-white px-3 py-2.5"
                            value={job.status}
                            onChange={(e) => onUpdate({ status: e.target.value as any })}
                        >
                            {dictionaries.filter(d => d.type === 'STATUS_CODE' && d.active).map(s => (
                                <option key={s.id} value={s.code}>{s.description}</option>
                            ))}
                            {!dictionaries.some(d => d.type === 'STATUS_CODE' && d.code === job.status) && (
                                <option value={job.status}>{job.status}</option>
                            )}
                        </select>
                    </div>

                    {/* Hierarchy Path — color-coded: locations (emerald) › asset (blue), matching the asset tree */}
                    <div className="md:col-span-2">
                        <div className="flex items-center gap-1 text-[10px] bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 overflow-x-auto">
                            {job.assetPath?.map((p, i) => (
                                <React.Fragment key={i}>
                                    <span className="whitespace-nowrap font-semibold text-emerald-600">{p}</span>
                                    <ChevronRight size={10} className="text-slate-300 flex-shrink-0" />
                                </React.Fragment>
                            ))}
                            <span className="whitespace-nowrap font-bold text-blue-600">{job.assetName}</span>
                        </div>
                    </div>

                    <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Description</label>
                        <textarea
                            defaultValue={job.description}
                            className="w-full h-24 md:h-28 text-sm border border-slate-300 rounded-lg bg-white px-3 py-2.5 resize-none focus:ring-2 focus:ring-primary-500 outline-none"
                            placeholder="Detailed job requirements, scope of work, and instructions..."
                        />
                    </div>

                    <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Parent Work Order</label>
                        <div className="flex gap-1.5">
                            <input
                                type="text"
                                value={parentWoLabel}
                                readOnly
                                placeholder="No parent linked"
                                className="w-full text-sm border border-slate-300 rounded-lg bg-slate-50 px-3 py-2.5"
                            />
                            {job.parentWoId && !isRefLocked && (
                                <button
                                    type="button"
                                    onClick={() => onUpdate({ parentWoId: '' })}
                                    title="Clear parent work order"
                                    className="p-1.5 bg-slate-100 border border-slate-300 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-500 flex-shrink-0 transition-colors"
                                ><X size={14} /></button>
                            )}
                            <button
                                type="button"
                                onClick={() => !isRefLocked && setShowParentPicker(true)}
                                disabled={isRefLocked}
                                title={isRefLocked ? 'Locked on completed/closed work orders' : 'Browse & link parent WO'}
                                className={`p-1.5 border rounded-lg flex-shrink-0 transition-colors ${isRefLocked ? 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed' : 'bg-slate-100 border-slate-300 text-slate-600 hover:bg-slate-200'}`}
                            ><Folder size={14} /></button>
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Work Type {job.recurringWorkId && <Lock size={10} className="inline text-slate-400 ml-1" />}</label>
                        <select
                            className={`w-full text-sm border rounded-lg px-3 py-2.5 ${job.recurringWorkId ? 'bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed' : 'border-slate-300 bg-white'}`}
                            value={job.type}
                            onChange={(e) => onUpdate({ type: e.target.value as any })}
                            disabled={!!job.recurringWorkId}
                            title={job.recurringWorkId ? 'Work Type is locked for PM work orders generated from Recurring Work strategies' : ''}
                        >
                            {dictionaries.filter(d => d.type === 'WORK_TYPE' && d.active).map(t => (
                                <option key={t.id} value={t.code}>{t.description}</option>
                            ))}
                            {!dictionaries.some(d => d.type === 'WORK_TYPE' && d.code === job.type) && (
                                <option value={job.type}>{job.type}</option>
                            )}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Scope</label>
                        <select
                            className={`w-full text-sm border rounded-lg px-3 py-2.5 font-medium ${job.scope === 'PROJECT' ? 'bg-blue-50 text-blue-700 border-blue-300' : 'bg-white border-slate-300'
                                }`}
                            value={job.scope || 'STANDARD'}
                            onChange={(e) => onUpdate({ scope: e.target.value as WorkOrderScope })}
                        >
                            <option value="STANDARD">Standard</option>
                            <option value="PROJECT">Project (Shutdown/TA)</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Priority</label>
                        <select
                            className="w-full text-sm border border-slate-300 rounded-lg bg-white px-3 py-2.5"
                            value={job.priority}
                            onChange={(e) => onUpdate({ priority: e.target.value as any })}
                        >
                            {dictionaries.filter(d => d.type === 'PRIORITY' && d.active).map(p => (
                                <option key={p.id} value={p.code}>{p.description}</option>
                            ))}
                            {!dictionaries.some(d => d.type === 'PRIORITY' && d.code === job.priority) && (
                                <option value={job.priority}>{job.priority}</option>
                            )}
                        </select>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Cost Centre</label>
                        <select
                            className="w-full text-sm border border-slate-300 rounded-lg bg-white px-3 py-2.5"
                            value={job.costCenter || ''}
                            onChange={(e) => onUpdate({ costCenter: e.target.value })}
                        >
                            <option value="">-- Select Cost Centre --</option>
                            {dictionaries.filter(d => d.type === 'COST_CENTRE' && d.active).map(c => (
                                <option key={c.id} value={c.id}>{c.code} - {c.description}</option>
                            ))}
                            {job.costCenter && !dictionaries.some(d => d.type === 'COST_CENTRE' && d.code === job.costCenter) && (
                                <option value={job.costCenter}>{job.costCenter}</option>
                            )}
                        </select>
                    </div>
                    <div className="flex items-center md:mt-4">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                                type="checkbox"
                                className="rounded border-slate-300 text-blue-600 w-3.5 h-3.5"
                                checked={job.enforceJobCostCenter || false}
                                onChange={(e) => onUpdate({ enforceJobCostCenter: e.target.checked })}
                            />
                            <span className="text-[10px] font-bold text-slate-600 uppercase">Enforce Job Cost Center</span>
                        </label>
                    </div>

                    <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Safety Notes (Auto-Populated)</label>
                        <div className="px-2.5 py-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800 flex gap-1.5">
                            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                            <p>CAUTION: H2S Risk in area. Personal Gas Monitor Required.</p>
                        </div>
                    </div>


                    {/* Material Staging Card */}
                    {job.inventory && job.inventory.length > 0 && (
                        <div className="md:col-span-2 bg-gradient-to-r from-blue-50/50 to-blue-50/50 p-4 rounded-xl border border-blue-100 shadow-sm space-y-3 mt-4">
                            <div className="flex justify-between items-center border-b border-blue-100/50 pb-2">
                                <h4 className="font-bold text-xs md:text-sm text-slate-800 flex items-center gap-2">
                                    <Package className="text-blue-600" size={16} />
                                    Material Staging Control (ISO 55000)
                                </h4>
                                <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                                    job.properties?.staging_confirmed
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : 'bg-amber-100 text-amber-800'
                                }`}>
                                    {job.properties?.staging_confirmed ? 'Staged & Ready' : 'Awaiting Staging'}
                                </span>
                            </div>
                            
                            <p className="text-xs text-slate-500">
                                This work order requires parts from the warehouse. Verify and confirm all required materials are staged before starting the job.
                            </p>

                            <div className="bg-white rounded-lg border border-slate-100 p-3 space-y-2">
                                <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Required Materials Checklist</span>
                                <div className="divide-y divide-slate-100 max-h-36 overflow-y-auto pr-1">
                                    {job.inventory.map(part => (
                                        <div key={part.id} className="py-2 flex justify-between items-center text-xs">
                                            <div className="flex items-center gap-2">
                                                <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                                <span className="font-medium text-slate-700">{part.description || 'Unnamed Material'}</span>
                                            </div>
                                            <span className="font-bold text-slate-600 px-2 py-0.5 bg-slate-50 rounded border border-slate-100">
                                                Qty: {part.estQty} {part.uom || 'EA'}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="flex items-center pt-2">
                                <label className="flex items-center gap-2.5 cursor-pointer select-none bg-white p-3 rounded-lg border border-blue-200/60 shadow-sm w-full transition hover:bg-slate-50">
                                    <input
                                        type="checkbox"
                                        className="rounded border-blue-300 text-blue-600 w-4 h-4 focus:ring-primary-500 cursor-pointer"
                                        checked={job.properties?.staging_confirmed || false}
                                        onChange={(e) => onUpdate({
                                            properties: {
                                                ...(job.properties || {}),
                                                staging_confirmed: e.target.checked
                                            }
                                        })}
                                    />
                                    <div className="flex flex-col">
                                        <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">Confirm All Materials Staged</span>
                                        <span className="text-[10px] text-slate-400">All checklist items are physically staged at Site Store and verified.</span>
                                    </div>
                                </label>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Scheduling & Progress */}
            <div className={`bg-white p-4 md:p-5 lg:p-6 rounded-xl border border-slate-200 shadow-sm space-y-4 ${isFieldsExpanded ? 'block' : 'hidden lg:block'}`}>
                {job.scope === 'PROJECT' && (
                    <div className="flex justify-end">
                        <span className="text-[9px] font-bold uppercase bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">
                            Turnaround / Project Mode
                        </span>
                    </div>
                )}

                <div className="space-y-3">

                    {/* --- STANDARD SCOPE: Simplified Scheduling --- */}
                    {(!job.scope || job.scope === 'STANDARD') && (
                        <div className="space-y-3">
                            <div className="bg-slate-50 border border-slate-200 rounded px-2.5 py-2 text-[11px] text-slate-500 flex items-center gap-1.5">
                                <Calendar size={12} className="text-slate-400 flex-shrink-0" />
                                Standard work orders use a simple due date and estimated duration for planning.
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Due Date</label>
                                    <input
                                        key={`due-std-${job.id}`}
                                        type="date"
                                        value={job.dueDate ? formatDateForInput(job.dueDate) : ''}
                                        onChange={(e) => handleScheduleChange('dueDate', e.target.value)}
                                        className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2.5 bg-white font-medium"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Est. Duration (Hrs)</label>
                                    <input
                                        type="number"
                                        value={job.estDuration || ''}
                                        onChange={(e) => onUpdate({ estDuration: parseFloat(e.target.value) })}
                                        className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2.5 bg-white"
                                        placeholder="0"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Est. Downtime (Hrs)</label>
                                    <input
                                        type="number"
                                        value={job.estDowntime || ''}
                                        onChange={(e) => onUpdate({ estDowntime: parseFloat(e.target.value) })}
                                        className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2.5 bg-white"
                                        placeholder="0"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Date Completed</label>
                                    <input
                                        key={`fin-std-${job.id}`}
                                        type="date"
                                        value={job.dateFinished ? formatDateForInput(job.dateFinished) : ''}
                                        onChange={(e) => onUpdate({ dateFinished: e.target.value })}
                                        className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2.5 bg-white"
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* --- PROJECT SCOPE: Full Turnaround Scheduling Matrix --- */}
                    {job.scope === 'PROJECT' && (
                        <div className="space-y-3">
                            <div className="bg-blue-50 border border-blue-200 rounded px-2.5 py-2 text-[11px] text-blue-700 flex items-center gap-1.5">
                                <Calendar size={12} className="text-blue-500 flex-shrink-0" />
                                Project/Turnaround mode � full start & finish scheduling with time precision for shutdown planning.
                            </div>

                            {/* Scheduling Matrix */}
                            <div className="grid grid-cols-1 md:grid-cols-[60px_1fr_1fr] gap-x-3 gap-y-3 items-start">
                                {/* Headers - hidden on mobile */}
                                <div className="hidden md:block"></div>
                                <div className="hidden md:block text-[10px] font-bold text-blue-600 uppercase text-center tracking-wider">Scheduled</div>
                                <div className="hidden md:block text-[10px] font-bold text-slate-500 uppercase text-center tracking-wider">Actual</div>

                                {/* Start Row */}
                                <div className="font-bold text-slate-700 text-xs pt-1.5">Start</div>
                                <div className="space-y-1">
                                    <label className="md:hidden block text-[10px] font-bold text-blue-600 uppercase mb-0.5">Scheduled</label>
                                    <input
                                        key={`start-${job.id}`}
                                        type="date"
                                        value={job.dateDueStart ? formatDateForInput(job.dateDueStart) : ''}
                                        onChange={(e) => handleScheduleChange('dateDueStart', e.target.value)}
                                        className="w-full text-sm border border-blue-200 rounded-lg px-3 py-2.5 bg-blue-50/50 font-medium"
                                    />
                                    {(job.timeDueStart) ? (
                                        <div className="flex gap-1 items-center">
                                            <input
                                                type="time"
                                                value={job.timeDueStart || ''}
                                                onChange={(e) => handleScheduleChange('timeDueStart', e.target.value)}
                                                className="flex-1 text-sm border border-blue-200 rounded-lg px-2 py-1 bg-blue-50/50"
                                            />
                                            <button
                                                onClick={() => handleScheduleChange('timeDueStart', '')}
                                                className="text-slate-400 hover:text-red-500 p-0.5"
                                                title="Remove time"
                                            ><X size={11} /></button>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => handleScheduleChange('timeDueStart', '06:00')}
                                            className="text-[10px] text-blue-500 hover:text-blue-700 flex items-center gap-1 font-medium"
                                        ><Clock size={10} /> Add time</button>
                                    )}
                                </div>
                                <div className="space-y-1">
                                    <label className="md:hidden block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Actual</label>
                                    <div className="flex gap-1.5">
                                        <input
                                            key={`started-${job.id}`}
                                            type="date"
                                            value={job.dateStarted ? formatDateForInput(job.dateStarted) : ''}
                                            onChange={(e) => onUpdate({ dateStarted: e.target.value })}
                                            className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2.5 bg-white"
                                        />
                                        <input
                                            type="time"
                                            value={job.timeStarted || ''}
                                            onChange={(e) => onUpdate({ timeStarted: e.target.value })}
                                            className="w-20 text-sm border border-slate-300 rounded-lg px-1.5 py-1.5 bg-white"
                                        />
                                    </div>
                                </div>

                                {/* Finish Row */}
                                <div className="font-bold text-slate-700 text-xs pt-1.5">Finish</div>
                                <div className="space-y-1">
                                    <label className="md:hidden block text-[10px] font-bold text-blue-600 uppercase mb-0.5">Scheduled</label>
                                    <input
                                        key={`due-${job.id}`}
                                        type="date"
                                        value={job.dueDate ? formatDateForInput(job.dueDate) : ''}
                                        onChange={(e) => handleScheduleChange('dueDate', e.target.value)}
                                        className="w-full text-sm border border-blue-200 rounded-lg px-3 py-2.5 bg-blue-50/50 font-medium"
                                    />
                                    {(job.timeDueFinish) ? (
                                        <div className="flex gap-1 items-center">
                                            <input
                                                type="time"
                                                value={job.timeDueFinish || ''}
                                                onChange={(e) => handleScheduleChange('timeDueFinish', e.target.value)}
                                                className="flex-1 text-sm border border-blue-200 rounded-lg px-2 py-1 bg-blue-50/50"
                                            />
                                            <button
                                                onClick={() => handleScheduleChange('timeDueFinish', '')}
                                                className="text-slate-400 hover:text-red-500 p-0.5"
                                                title="Remove time"
                                            ><X size={11} /></button>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => handleScheduleChange('timeDueFinish', '18:00')}
                                            className="text-[10px] text-blue-500 hover:text-blue-700 flex items-center gap-1 font-medium"
                                        ><Clock size={10} /> Add time</button>
                                    )}
                                </div>
                                <div className="space-y-1">
                                    <label className="md:hidden block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Actual</label>
                                    <div className="flex gap-1.5">
                                        <input
                                            key={`fin-${job.id}`}
                                            type="date"
                                            value={job.dateFinished ? formatDateForInput(job.dateFinished) : ''}
                                            onChange={(e) => onUpdate({ dateFinished: e.target.value })}
                                            className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2.5 bg-white"
                                        />
                                        <input
                                            type="time"
                                            value={job.timeFinished || ''}
                                            onChange={(e) => onUpdate({ timeFinished: e.target.value })}
                                            className="w-20 text-sm border border-slate-300 rounded-lg px-1.5 py-1.5 bg-white"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="border-t border-slate-100 my-3 pt-3"></div>

                            {/* Estimates */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <span className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Est. Duration (Hrs)</span>
                                    <input
                                        type="number"
                                        value={job.estDuration || ''}
                                        onChange={(e) => onUpdate({ estDuration: parseFloat(e.target.value) })}
                                        className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2.5"
                                    />
                                </div>
                                <div>
                                    <span className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Est. Downtime (Hrs)</span>
                                    <input
                                        type="number"
                                        value={job.estDowntime || ''}
                                        onChange={(e) => onUpdate({ estDowntime: parseFloat(e.target.value) })}
                                        className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2.5"
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Status Footer */}
                    <div className="flex items-center justify-end pt-2 gap-2">
                        <span className="text-xs font-medium text-slate-500">Overall Status:</span>
                        <div className={`flex items-center gap-1 text-slate-600 font-bold bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200 text-xs`}>
                            {job.status === 'CLOSED' ? <CheckCircle size={13} /> : <Clock size={13} />}
                            {job.status.replace('_', ' ')}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const MetricsTab: React.FC<{ job: WorkOrder, users: any[], contacts: any[] }> = ({ job, users, contacts }) => {
    const [allocations, setAllocations] = useState<CostAllocation[]>([]);
    const [financials, setFinancials] = useState<AssetFinancial | null>(null);
    const [warrantyCheck, setWarrantyCheck] = useState<WarrantyCheckResult | null>(null);
    const [anomaly, setAnomaly] = useState<CostAnomalyResult | null>(null);
    const [loading, setLoading] = useState(true);

    // Helper to resolve user name
    const getUserName = (userIdOrName: string) => {
        if (!userIdOrName) return 'Unknown';
        const user = users.find(u => u.id === userIdOrName || u.username === userIdOrName);
        if (user && user.contactId) {
            const contact = contacts.find(c => c.id === user.contactId);
            if (contact) return `${contact.firstName} ${contact.lastName}`;
            return user.username;
        }
        return userIdOrName;
    };

    // Calculate Costs & Fetch Data
    const estLaborCost = (job.labor || []).reduce((acc, l) => acc + (l.estDuration * l.estRate), 0);
    const estMaterialCost = (job.inventory || []).reduce((acc, i) => acc + (i.estQty * i.estUnitCost), 0);
    const totalEstCost = estLaborCost + estMaterialCost;

    const actualLaborCost = (job.labor || []).reduce((acc, l) => acc + ((l.actualDuration || 0) * (l.actualRate || l.estRate)), 0);
    const actualMaterialCost = (job.inventory || []).reduce((acc, i) => acc + ((i.actualQty || 0) * (i.actualUnitCost || i.estUnitCost)), 0);
    const totalActualCost = actualLaborCost + actualMaterialCost;

    const costPct = totalEstCost > 0 ? Math.min(100, (totalActualCost / totalEstCost) * 100) : 0;
    const durationPct = job.estDuration > 0 ? Math.min(100, (job.actualDuration / job.estDuration) * 100) : 0;

    useEffect(() => {
        const loadMetrics = async () => {
            setLoading(true);
            try {
                const results = await Promise.all([
                    FinOpsService.getCostAllocations(job.id),
                    job.assetId ? FinOpsService.checkWarrantyStatus(job.assetId) : Promise.resolve(null),
                    job.assetId ? FinOpsService.detectCostAnomaly(job.assetId, job.type, totalEstCost) : Promise.resolve(null),
                    // If job is closed, we rely on frozen actualCost. If open, we calculate live.
                ]);

                setAllocations(results[0]);
                setWarrantyCheck(results[1]);
                setAnomaly(results[2]);
            } catch (error) {
                console.error("Failed to load financial metrics", error);
            } finally {
                setLoading(false);
            }
        };

        if (job.id) {
            loadMetrics();
        }
    }, [job.id, job.assetId, totalEstCost]);

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4 animate-in fade-in duration-300 lg:min-h-[600px]">
            <div className="bg-white p-3 md:p-4 rounded-lg border border-slate-200 shadow-sm space-y-3 md:space-y-4">
                <h3 className="font-bold text-xs md:text-sm text-slate-800 border-b border-slate-100 pb-2 mb-3">Financial Performance</h3>

                {/* Frozen Cost Warning */}
                {job.status === 'CLOSED' && (
                    <div className="bg-slate-100 border border-slate-300 p-2.5 rounded flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                            <Lock size={14} className="text-slate-500" />
                            <span className="font-bold text-slate-700">Costs Frozen (Closed)</span>
                        </div>
                        <div className="font-mono font-bold text-sm md:text-base">${(job.actualCost || totalActualCost).toFixed(2)}</div>
                    </div>
                )}

                {/* Anomaly Detection */}
                {anomaly?.isAnomaly && (
                    <div className={`p-2.5 rounded border flex items-start gap-2 text-xs ${anomaly.severity === 'HIGH' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                        <TrendingUp size={14} className="mt-0.5" />
                        <div>
                            <span className="font-bold block uppercase text-[10px] mb-1">Cost Anomaly Detected</span>
                            <p>{anomaly.message}</p>
                        </div>
                    </div>
                )}

                {/* Warranty Alert */}
                {warrantyCheck?.underWarranty && (
                    <div className="bg-green-50 border border-green-200 p-2.5 rounded flex items-start gap-2 text-xs text-green-800">
                        <ShieldCheck size={14} className="mt-0.5" />
                        <div>
                            <span className="font-bold block uppercase text-[10px] mb-1">Asset Under Warranty</span>
                            <p>{warrantyCheck.message}</p>
                            <div className="mt-1.5 text-[11px] bg-white border border-green-200 p-1.5 rounded">
                                Policy: {warrantyCheck.warranty?.warrantyType} (Ends: {warrantyCheck.warranty?.endDate})
                            </div>
                        </div>
                    </div>
                )}


                {/* Cost Progress */}
                <div>
                    <div className="flex justify-between text-xs mb-1">
                        <span className="font-medium text-slate-700">Budget Consumption</span>
                        <span className={`font-bold ${costPct > 100 ? 'text-red-600' : 'text-green-600'}`}>{costPct.toFixed(0)}%</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2.5">
                        <div className={`h-2.5 rounded-full ${costPct > 100 ? 'bg-red-500' : 'bg-green-600'}`} style={{ width: `${Math.min(100, costPct)}%` }}></div>
                    </div>
                    <div className="flex justify-between text-[11px] text-slate-500 mt-1">
                        <span>Actual: ${totalActualCost.toFixed(2)}</span>
                        <span>Est: ${totalEstCost.toFixed(2)}</span>
                    </div>
                </div>

                <div className="p-3 bg-slate-50 rounded border border-slate-200">
                    <h4 className="text-[10px] font-bold text-slate-700 uppercase mb-2">Detailed Breakdown</h4>
                    <div className="space-y-1 text-xs text-slate-600">
                        <div className="flex justify-between border-b border-slate-100 pb-1">
                            <span>Labor</span>
                            <div className="text-right">
                                <span className="block font-medium">${actualLaborCost.toFixed(2)}</span>
                                <span className="text-[10px] text-slate-400">Est: ${estLaborCost.toFixed(2)}</span>
                            </div>
                        </div>
                        <div className="flex justify-between border-b border-slate-100 pb-1 pt-1">
                            <span>Materials & Parts</span>
                            <div className="text-right">
                                <span className="block font-medium">${actualMaterialCost.toFixed(2)}</span>
                                <span className="text-[10px] text-slate-400">Est: ${estMaterialCost.toFixed(2)}</span>
                            </div>
                        </div>
                        <div className="flex justify-between pt-2 font-bold text-slate-900 text-xs md:text-sm">
                            <span>Total Cost</span>
                            <span>${totalActualCost.toFixed(2)}</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="bg-white p-3 md:p-4 rounded-lg border border-slate-200 shadow-sm space-y-3">
                <h3 className="font-bold text-xs md:text-sm text-slate-800 border-b border-slate-100 pb-2 mb-3">Audit & Allocation</h3>

                {/* Cost Allocations Table */}
                <div>
                    <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-1.5">Cost Centre Allocations</h4>
                    {allocations.length > 0 ? (
                        <div className="text-xs border border-slate-200 rounded overflow-hidden">
                            <table className="w-full text-left">
                                <thead className="bg-slate-50 font-bold text-slate-600">
                                    <tr>
                                        <th className="p-2 border-b">Type</th>
                                        <th className="p-2 border-b">Cost Centre</th>
                                        <th className="p-2 border-b text-right">Amount</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {allocations.map(a => (
                                        <tr key={a.id} className="border-b last:border-0 hover:bg-slate-50">
                                            <td className="p-2">{a.costType}</td>
                                            <td className="p-2 font-mono">{a.costCenterId || '-'}</td>
                                            <td className="p-2 text-right">${a.amount.toFixed(2)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="text-xs text-slate-400 italic p-2 border border-dashed rounded text-center">
                            No posted allocations yet.
                        </div>
                    )}
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Notes</label>
                    <textarea
                        className="w-full h-20 text-sm border border-slate-300 rounded-lg bg-white p-2 resize-none focus:ring-1 focus:ring-primary-500"
                        placeholder="..."
                    />
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-2.5 rounded">
                    <div>
                        <span className="block text-[10px] font-bold text-slate-500 uppercase">Created By</span>
                        <div className="font-medium text-slate-900">
                            {getUserName(job.createdById)}
                        </div>
                        <div className="text-xs text-slate-400">{job.dateCreated}</div>
                    </div>
                    <div>
                        <span className="block text-[10px] font-bold text-slate-500 uppercase">Last Printed</span>
                        <div className="font-medium text-slate-900">-</div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// --- COST TAB (WM-2 → FI-1): planned vs actual labour, per operation, with the
//     settlement receiver each rolls up to. The visible payoff of the
//     order-to-cost spine — confirm time on an operation, watch its actual
//     cost appear here against plan, and see which cost center it settles to. ---

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const CostTab: React.FC<{ job: WorkOrder; refreshKey: number }> = ({ job, refreshKey }) => {
    const [actuals, setActuals] = useState<OrderActuals | null>(null);
    const [workCenters, setWorkCenters] = useState<WorkCenter[]>([]);
    const [costCenters, setCostCenters] = useState<{ id: string; code: string; name: string }[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        DatabaseService.getInstance().getWorkCenters(false).then(setWorkCenters).catch(() => setWorkCenters([]));
        FinOpsService.getCostCenters().then(setCostCenters).catch(() => setCostCenters([]));
    }, []);

    useEffect(() => {
        let active = true;
        if (!job.id || job.id.startsWith('new-')) { setLoading(false); return; }
        setLoading(true);
        DatabaseService.getInstance().getOrderActuals(job.id)
            .then(a => { if (active) setActuals(a); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [job.id, refreshKey]);

    const wcById = useMemo(() => new Map(workCenters.map(w => [w.id, w])), [workCenters]);
    const ccById = useMemo(() => new Map(costCenters.map(c => [c.id, c])), [costCenters]);

    // Per-operation planned cost = estHours × (per-op rate ?? work-center rate).
    const rows = useMemo(() => (job.tasks || []).map(t => {
        const wc = t.workCenterId ? wcById.get(t.workCenterId) : undefined;
        const rate = t.plannedRate ?? wc?.activityRate ?? 0;
        const plannedHours = t.estHours || 0;
        const plannedCost = plannedHours * rate;
        const act = actuals?.operations.find(o => o.operationId === t.id);
        const actualHours = act?.actualHours ?? 0;
        const actualCost = act?.actualLabourCost ?? 0;
        const cc = act?.costCenterId ? ccById.get(act.costCenterId) : (wc?.costCenterId ? ccById.get(wc.costCenterId) : undefined);
        return {
            id: t.id, opNo: t.operationNo || String((t.sequence ?? 0) * 10).padStart(4, '0'),
            desc: t.description || 'Operation',
            wcLabel: wc ? `${wc.code}` : '—', rate,
            plannedHours, plannedCost, actualHours, actualCost,
            varianceCost: actualCost - plannedCost,
            settlesTo: cc ? `${cc.code} · ${cc.name}` : (t.workCenterId ? 'Work center has no cost center' : '—'),
        };
    }), [job.tasks, wcById, ccById, actuals]);

    const plannedLabour = rows.reduce((s, r) => s + r.plannedCost, 0);
    const actualLabour = actuals?.labourCost ?? rows.reduce((s, r) => s + r.actualCost, 0);
    const partsCost = actuals?.partsCost ?? 0;
    const anyWorkCenters = rows.some(r => r.wcLabel !== '—');

    const SummaryCard = ({ label, planned, actual }: { label: string; planned: number; actual: number }) => {
        const variance = actual - planned;
        const over = variance > 0.5;
        return (
            <div className="bg-white border border-slate-200 rounded-card p-4">
                <div className="text-[11px] uppercase font-semibold tracking-wide text-slate-500">{label}</div>
                <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-slate-800 tabular-nums">{money(actual)}</span>
                    <span className="text-xs text-slate-400">actual</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-xs">
                    <span className="text-slate-500 tabular-nums">Plan {money(planned)}</span>
                    {planned > 0 && (
                        <span className={`font-semibold tabular-nums ${over ? 'text-red-600' : 'text-emerald-600'}`}>
                            {variance >= 0 ? '+' : ''}{money(variance)} ({planned ? Math.round((variance / planned) * 100) : 0}%)
                        </span>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="p-3 sm:p-4 space-y-4">
            <div className="flex items-center gap-2">
                <DollarSign size={16} className="text-slate-400" />
                <h3 className="text-sm font-bold text-slate-700">Operation Cost &amp; Settlement</h3>
                <span className="text-[11px] text-slate-400">planned vs confirmed-actual labour · SAP order-to-cost</span>
            </div>

            {loading ? (
                <LoadingState label="Loading cost roll-up…" className="h-40" />
            ) : rows.length === 0 ? (
                <div className="text-center py-10 text-slate-400 bg-white border border-slate-200 rounded-card">
                    <ClipboardList size={32} className="mx-auto mb-2 opacity-20" />
                    <p className="text-sm">No operations yet. Add tasks on the <strong>Tasks</strong> tab and assign each a work center to cost it.</p>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <SummaryCard label="Labour" planned={plannedLabour} actual={actualLabour} />
                        <div className="bg-white border border-slate-200 rounded-card p-4">
                            <div className="text-[11px] uppercase font-semibold tracking-wide text-slate-500">Parts</div>
                            <div className="mt-1 text-2xl font-bold text-slate-800 tabular-nums">{money(partsCost)}</div>
                            <div className="mt-1 text-xs text-slate-400">issued to this order</div>
                        </div>
                        <div className="bg-primary-50 border border-primary-200 rounded-card p-4">
                            <div className="text-[11px] uppercase font-semibold tracking-wide text-primary-700">Total actual</div>
                            <div className="mt-1 text-2xl font-bold text-primary-700 tabular-nums">{money(actualLabour + partsCost)}</div>
                            <div className="mt-1 text-xs text-primary-600/70">labour + parts · settlement basis</div>
                        </div>
                    </div>

                    {!anyWorkCenters && (
                        <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
                            No operations have a work center assigned yet — assign one on the Tasks tab so labour is costed at the work-center rate and settles to its cost center.
                        </div>
                    )}

                    <div className="bg-white border border-slate-200 rounded-card overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm min-w-[720px]">
                                <thead>
                                    <tr className="text-[10px] uppercase tracking-wide text-slate-500 border-b border-slate-200 bg-slate-50">
                                        <th className="text-left font-semibold px-3 py-2">Op</th>
                                        <th className="text-left font-semibold px-3 py-2">Operation</th>
                                        <th className="text-left font-semibold px-3 py-2">Work Center</th>
                                        <th className="text-right font-semibold px-3 py-2">Plan (h · cost)</th>
                                        <th className="text-right font-semibold px-3 py-2">Actual (h · cost)</th>
                                        <th className="text-right font-semibold px-3 py-2">Var</th>
                                        <th className="text-left font-semibold px-3 py-2">Settles to</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map(r => (
                                        <tr key={r.id} className="border-b border-slate-100 last:border-0">
                                            <td className="px-3 py-2 font-mono text-xs text-slate-500">{r.opNo}</td>
                                            <td className="px-3 py-2 text-slate-700 max-w-[200px] truncate" title={r.desc}>{r.desc}</td>
                                            <td className="px-3 py-2 text-slate-600">{r.wcLabel}{r.rate ? <span className="text-slate-400"> @{r.rate}/h</span> : null}</td>
                                            <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.plannedHours || 0}h · {money(r.plannedCost)}</td>
                                            <td className="px-3 py-2 text-right tabular-nums text-slate-800 font-medium">{r.actualHours || 0}h · {money(r.actualCost)}</td>
                                            <td className={`px-3 py-2 text-right tabular-nums font-semibold ${r.varianceCost > 0.5 ? 'text-red-600' : r.varianceCost < -0.5 ? 'text-emerald-600' : 'text-slate-400'}`}>
                                                {r.actualCost > 0 ? `${r.varianceCost >= 0 ? '+' : ''}${money(r.varianceCost)}` : '—'}
                                            </td>
                                            <td className="px-3 py-2 text-xs text-slate-500 max-w-[180px] truncate" title={r.settlesTo}>{r.settlesTo}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <p className="text-[11px] text-slate-400">
                        Actuals roll up from time confirmations posted on the Tasks tab (Do-work mode). Rate precedence: per-operation planned rate → work-center activity rate → the confirmation's own rate.
                    </p>
                </>
            )}
        </div>
    );
};

// --- TASKS TAB: Fully Reworked ---

const TasksTab: React.FC<{
    job: WorkOrder;
    onUpdate: (tasks: JobTask[]) => void;
    availableOrgUnits: OrganizationUnit[];
    availableUsers: User[];
    contacts: any[];
    onUpdateJob: (u: Partial<WorkOrder>) => void;
    onOperationConfirmed?: () => Promise<void> | void;
    dictionaries: DictionaryEntry[];
}> = ({ job, onUpdate, availableOrgUnits, availableUsers, contacts, onUpdateJob, onOperationConfirmed, dictionaries }) => {
    const confirm = useConfirm();
    const tasks = job.tasks || [];
    const [expandedTaskId, setExpandedTaskId] = useState<string | null>(tasks.length === 1 ? tasks[0]?.id : null);
    const [editorTab, setEditorTab] = useState<'instructions' | 'resources'>('instructions');
    // WM-2b: active work centers for the per-operation picker (loaded once).
    const [workCenters, setWorkCenters] = useState<WorkCenter[]>([]);
    useEffect(() => {
        DatabaseService.getInstance().getWorkCenters(true).then(setWorkCenters).catch(() => setWorkCenters([]));
    }, []);
    // Plan (build the checklist) vs Do-the-work (technician executes: tick boxes,
    // enter readings). Completed WOs are always execute + read-only.
    const [execMode, setExecMode] = useState(false);

    const addTask = () => {
        const nextSeq = tasks.length > 0 ? Math.max(...tasks.map(t => t.sequence)) + 10 : 10;
        const newTask: JobTask = {
            id: `new-${Date.now()}`,
            sequence: nextSeq,
            description: 'New Task Step',
            estHours: 0,
            status: 'PENDING',
            instructions: [],
            estStartDate: job.dateDueStart,
            estFinishDate: job.dueDate,
            assignedUserIds: [],
            assignedOrgUnitIds: []
        };
        onUpdate([...tasks, newTask]);
        setExpandedTaskId(newTask.id);
    };

    const moveTask = (index: number, direction: 'up' | 'down') => {
        if ((direction === 'up' && index === 0) || (direction === 'down' && index === tasks.length - 1)) return;
        const newTasks = [...tasks];
        const swapIndex = direction === 'up' ? index - 1 : index + 1;
        [newTasks[index], newTasks[swapIndex]] = [newTasks[swapIndex], newTasks[index]];
        newTasks.forEach((t, i) => t.sequence = (i + 1) * 10);
        onUpdate(newTasks);
    };

    const deleteTask = async (id: string) => {
        const taskToDelete = tasks.find(t => t.id === id);
        if (!taskToDelete) return;
        const ok = await confirm({
            title: 'Delete Task',
            message: `Task #${taskToDelete.sequence} "${taskToDelete.description}" will be permanently removed.`,
            variant: 'danger',
            confirmLabel: 'Delete',
        });
        if (!ok) return;
        const filtered = tasks.filter(t => t.id !== id);
        onUpdate(filtered);
        if (expandedTaskId === id) setExpandedTaskId(filtered.length > 0 ? filtered[0].id : null);
    };

    const updateTask = (id: string, updates: Partial<JobTask>) => {
        onUpdate(tasks.map(t => t.id === id ? { ...t, ...updates } : t));
    };

    const toggleExpand = (taskId: string) => {
        setExpandedTaskId(prev => prev === taskId ? null : taskId);
        setEditorTab('instructions'); // Reset tab on expand
    };

    // Progress stats
    const completed = tasks.filter(t => t.status === 'COMPLETED').length;
    const totalHrs = tasks.reduce((s, t) => s + (t.estHours || 0), 0);
    const pct = tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0;
    const allDone = completed === tasks.length && tasks.length > 0;

    return (
        <div className="animate-in fade-in duration-300 space-y-0">
            {/* Header Bar */}
            <div className="bg-white border border-slate-200 rounded-t-lg p-2 sm:p-3 flex items-center justify-between">
                <div className="flex items-center gap-2 sm:gap-4">
                    <h3 className="font-bold text-slate-800 text-sm">Steps</h3>
                    {tasks.length > 0 && (
                        <div className="flex items-center gap-2">
                            <div className="w-16 sm:w-24 bg-slate-200 rounded-full h-1.5 overflow-hidden">
                                <div
                                    className={`h-1.5 rounded-full transition-all duration-500 ${allDone ? 'bg-green-500' : 'bg-blue-500'}`}
                                    style={{ width: `${pct}%` }}
                                />
                            </div>
                            <span className={`text-[10px] font-bold whitespace-nowrap ${allDone ? 'text-green-600' : completed > 0 ? 'text-blue-600' : 'text-slate-400'}`}>
                                {completed}/{tasks.length}
                            </span>
                            <span className="hidden sm:inline text-[10px] text-slate-400 border-l border-slate-200 pl-2">
                                {totalHrs.toFixed(1)}h total
                            </span>
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {/* Plan ↔ Do-the-work toggle */}
                    <div className="flex bg-slate-100 p-0.5 rounded-lg text-[11px] font-bold flex-shrink-0">
                        <button onClick={() => setExecMode(false)} className={`px-2 py-1 rounded-md transition-colors ${!execMode ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Plan</button>
                        <button onClick={() => setExecMode(true)} className={`px-2 py-1 rounded-md transition-colors ${execMode ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Do work</button>
                    </div>
                    {tasks.length > 0 && tasks.some(t => t.status !== 'COMPLETED') && (
                        <button
                            onClick={async () => {
                                const ok = await confirm({
                                    title: 'Complete All Tasks',
                                    message: `Mark all ${tasks.length} tasks as COMPLETED? This cannot be easily undone.`,
                                    variant: 'info',
                                    confirmLabel: 'Complete All',
                                });
                                if (ok) {
                                    onUpdate(tasks.map(t => ({ ...t, status: 'COMPLETED' as const })));
                                }
                            }}
                            className="hidden sm:flex text-xs bg-green-600 text-white px-2.5 py-1.5 rounded hover:bg-green-700 items-center gap-1 font-medium"
                        >
                            <CheckCircle size={12} /> Complete All
                        </button>
                    )}
                    <button onClick={addTask} className="text-xs bg-primary-600 text-white px-3 py-1.5 rounded hover:bg-primary-500 flex items-center gap-1 font-medium">
                        <Plus size={14} /> Add
                    </button>
                </div>
            </div>

            {/* Stacked Accordion */}
            <div className="border-x border-b border-slate-200 rounded-b-lg overflow-hidden bg-slate-50/50">
                {tasks.map((task, index) => {
                    const isExpanded = expandedTaskId === task.id;
                    const tLabor = (job.labor || []).filter(l => l.jobTaskId === task.id);
                    const tParts = (job.inventory || []).filter(i => i.jobTaskId === task.id);
                    const laborCount = tLabor.reduce((s, l) => s + (l.headcount || 1), 0);
                    const partsCount = tParts.length;
                    const hasWarning = (task.estStartDate && job.dateDueStart && task.estStartDate < job.dateDueStart) ||
                                       (task.estFinishDate && job.dueDate && task.estFinishDate > job.dueDate);

                    return (
                        <div key={task.id} className={`${index > 0 ? 'border-t border-slate-200' : ''}`}>
                            {/* Collapsed Header Row */}
                            <div
                                onClick={() => toggleExpand(task.id)}
                                className={`flex items-center gap-2 sm:gap-3 px-2 sm:px-4 py-2.5 sm:py-3 cursor-pointer transition-colors group ${
                                    isExpanded
                                        ? 'bg-blue-50 border-l-[3px] border-l-blue-500'
                                        : 'bg-white hover:bg-slate-50 border-l-[3px] border-l-transparent'
                                }`}
                            >
                                {/* Expand chevron */}
                                <ChevronRight
                                    size={16}
                                    className={`text-slate-400 transition-transform duration-200 flex-shrink-0 ${isExpanded ? 'rotate-90 text-blue-500' : ''}`}
                                />

                                {/* Step number badge — show the 1-based position (sequence 10/20/30 is kept internally for ordering) */}
                                <span className={`font-mono text-xs font-bold px-2 py-0.5 rounded flex-shrink-0 ${
                                    isExpanded ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'
                                }`}>
                                    {index + 1}
                                </span>

                                {/* Task description — editable inline */}
                                <div className="flex-1 min-w-0">
                                    <input
                                        type="text"
                                        value={task.description}
                                        onChange={(e) => updateTask(task.id, { description: e.target.value })}
                                        onClick={(e) => e.stopPropagation()}
                                        onFocus={(e) => e.stopPropagation()}
                                        className="w-full font-medium text-sm text-slate-900 bg-transparent border-none p-0 focus:ring-0 focus:outline-none placeholder:text-slate-300 truncate"
                                        placeholder="Enter task step name..."
                                    />
                                    {/* Operation number (SAP) + dependency indicator */}
                                    <div className="flex items-center gap-2 mt-0.5">
                                        {task.operationNo && (
                                            <span className="text-[10px] text-slate-400 font-mono" title="SAP operation number">
                                                Op {task.operationNo}
                                            </span>
                                        )}
                                        {task.predecessorTaskId && (() => {
                                            const pred = tasks.find(t => t.id === task.predecessorTaskId);
                                            return pred ? (
                                                <span className="text-[10px] text-blue-500 font-medium flex items-center gap-0.5">
                                                    <ArrowRight size={9} className="rotate-180" /> After #{pred.sequence}
                                                </span>
                                            ) : null;
                                        })()}
                                    </div>
                                </div>

                                {/* Delete task button — always visible */}
                                <button
                                    onClick={(e) => { e.stopPropagation(); deleteTask(task.id); }}
                                    className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0"
                                    title="Delete task step"
                                >
                                    <Trash2 size={14} />
                                </button>

                                {/* Resource badges (compact) — hidden on mobile */}
                                <div className="hidden sm:flex items-center gap-1.5 flex-shrink-0">
                                    {laborCount > 0 && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100 font-medium flex items-center gap-0.5">
                                            <Users size={9} /> {laborCount}
                                        </span>
                                    )}
                                    {partsCount > 0 && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-100 font-medium flex items-center gap-0.5">
                                            <Box size={9} /> {partsCount}
                                        </span>
                                    )}
                                    {(task.instructions?.length || 0) > 0 && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium flex items-center gap-0.5">
                                            <ClipboardList size={9} /> {task.instructions?.length}
                                        </span>
                                    )}
                                </div>

                                {/* Hours — hidden on mobile */}
                                <span className="hidden sm:block text-xs text-slate-500 font-medium flex-shrink-0 w-14 text-right">
                                    {task.estHours}h
                                </span>

                                {/* Status badge */}
                                <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded flex-shrink-0 ${
                                    task.status === 'COMPLETED' ? 'bg-green-100 text-green-700' :
                                    task.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700' :
                                    'bg-slate-100 text-slate-500'
                                }`}>
                                    {task.status === 'IN_PROGRESS' ? 'WIP' : task.status}
                                </span>

                                {/* Warning */}
                                {hasWarning && <AlertTriangle size={14} className="text-amber-500 flex-shrink-0" />}

                                {/* Move controls — hidden on mobile (supervisor-only) */}
                                <div className={`hidden sm:flex items-center gap-0.5 flex-shrink-0 ${isExpanded ? 'opacity-100' : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100'} transition-opacity`}>
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

                            {/* Expanded: Full-Width Task Editor */}
                            {isExpanded && (
                                <div className="bg-white border-t border-slate-200 animate-in slide-in-from-top-2 duration-200">
                                    <TaskEditor
                                        task={task}
                                        onChange={(updates) => updateTask(task.id, updates)}
                                        onDelete={() => deleteTask(task.id)}
                                        onUpdateJob={onUpdateJob}
                                        jobContext={job}
                                        availableOrgUnits={availableOrgUnits}
                                        availableUsers={availableUsers}
                                        contacts={contacts}
                                        dictionaries={dictionaries}
                                        workCenters={workCenters}
                                        onConfirmed={onOperationConfirmed}
                                        editorTab={editorTab}
                                        onTabChange={setEditorTab}
                                        execMode={execMode}
                                    />
                                </div>
                            )}
                        </div>
                    );
                })}

                {/* Empty State */}
                {tasks.length === 0 && (
                    <div className="text-center py-12 text-slate-400 bg-white">
                        <ClipboardList size={40} className="mx-auto mb-3 opacity-20" />
                        <p className="text-sm font-medium">No tasks defined</p>
                        <p className="text-xs mt-1">Click <strong>Add</strong> to create your first job step.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

// --- Task Editor Sub-Component ---

const TaskEditor: React.FC<{
    task: JobTask;
    onChange: (u: Partial<JobTask>) => void;
    onDelete: () => void;
    onUpdateJob: (u: Partial<WorkOrder>) => void;
    jobContext: WorkOrder;
    availableOrgUnits: OrganizationUnit[];
    availableUsers: User[];
    contacts: any[];
    dictionaries: DictionaryEntry[];
    workCenters: WorkCenter[];
    onConfirmed?: () => Promise<void> | void;
    editorTab: 'instructions' | 'resources';
    onTabChange: (tab: 'instructions' | 'resources') => void;
    execMode?: boolean;
}> = ({ task, onChange, onDelete, onUpdateJob, jobContext, availableOrgUnits, availableUsers, contacts, dictionaries, workCenters, onConfirmed, editorTab, onTabChange, execMode = false }) => {
    const { showToast } = useToast();
    // WM-2b: resolved costing rate for this operation = per-op override ?? work-center rate.
    const selectedWorkCenter = workCenters.find(w => w.id === task.workCenterId);
    const effectiveRate = task.plannedRate ?? selectedWorkCenter?.activityRate;

    // WM-2c: time confirmation posting (IW41/CO11). Posts immediately, then refetches.
    const [confHours, setConfHours] = useState('');
    const [confFinal, setConfFinal] = useState(false);
    const [posting, setPosting] = useState(false);
    const postTimeConfirmation = async () => {
        const hrs = parseFloat(confHours);
        if (!hrs || hrs <= 0) { showToast('Enter the hours worked.', 'warning'); return; }
        if (task.id.startsWith('new-')) { showToast('Save the work order before confirming time.', 'warning'); return; }
        setPosting(true);
        try {
            await DatabaseService.getInstance().postConfirmation({
                woId: jobContext.id,
                operationId: task.id,
                hours: hrs,
                ratePerHour: effectiveRate,
                isFinal: confFinal,
            });
            showToast(confFinal ? 'Final confirmation posted — operation completed.' : 'Time confirmation posted.', 'success');
            setConfHours(''); setConfFinal(false);
            await onConfirmed?.();
        } catch (e: any) {
            showToast('Confirmation failed: ' + (e?.message || 'unknown'), 'error');
        } finally {
            setPosting(false);
        }
    };
    const { user } = useAuth();

    // State for Picker
    const [isPartPickerOpen, setIsPartPickerOpen] = useState(false);

    const handleReturnToStores = async (part: JobInventory) => {
        const qtyStr = window.prompt(`Return "${part.description}" to Stores.\nEnter quantity to return:`, "1");
        if (!qtyStr) return;
        const returnedQty = parseFloat(qtyStr);
        if (isNaN(returnedQty) || returnedQty <= 0) {
            showToast('Invalid quantity entered.', 'warning');
            return;
        }

        try {
            // Fetch current stock
            const { data: stockRecords, error: fetchError } = await supabase
                .from('inventory_stock')
                .select('*')
                .eq('item_id', part.inventoryId);

            if (fetchError) throw fetchError;

            let locationId = 'default-wh';
            let currentQty = 0;

            if (stockRecords && stockRecords.length > 0) {
                locationId = stockRecords[0].location_id;
                currentQty = stockRecords[0].quantity;
            }

            const newLocationQty = currentQty + returnedQty;

            // 1. Adjust inventory stock in DB
            await DatabaseService.getInstance().adjustInventoryStock(
                part.inventoryId!,
                locationId,
                newLocationQty,
                'ADJUSTMENT',
                `Return to Stores from WO ${jobContext.woNumber || jobContext.id}`,
                (user as any)?.username || 'unknown'
            );

            // 2. Decrement actual quantity used on WO
            const updated = (jobContext.inventory || []).map(p => {
                if (p.id !== part.id) return p;
                const currentActual = p.actualQty !== undefined ? p.actualQty : p.estQty;
                return {
                    ...p,
                    actualQty: Math.max(0, currentActual - returnedQty),
                    estQty: Math.max(0, p.estQty - returnedQty)
                };
            });

            onUpdateJob({ inventory: updated });
            showToast(`Successfully returned ${returnedQty} ${part.uom || 'EA'} to stores. Stock updated.`, 'success');
        } catch (e: any) {
            console.error(e);
            showToast('Failed to return parts to stores: ' + e.message, 'error');
        }
    };

    // Resource Search States
    const [resourceSearchPeople, setResourceSearchPeople] = useState('');
    const [resourceSearchRole, setResourceSearchRole] = useState('');
    const [resourceSearchParts, setResourceSearchParts] = useState('');
    const [teamsSectionOpen, setTeamsSectionOpen] = useState(false);
    const [peopleSectionOpen, setPeopleSectionOpen] = useState(true);

    // Helper: Get role description from dictionary
    const getRoleLabel = (roleCode?: string): string => {
        if (!roleCode) return '';
        const entry = dictionaries.find(d => d.type === 'CONTACT_TYPE' && d.code === roleCode && d.active);
        return entry?.description || roleCode;
    };

    // Helper: Dual Rate Cascade � User Override ? Role Dictionary ? Default
    const resolveRate = (roleCode: string, contactId?: string): number => {
        // 1. User-level override (contact.hourlyRate from Admin Financials)
        if (contactId) {
            const contact = contacts.find((c: any) => c.id === contactId);
            if (contact?.hourlyRate && contact.hourlyRate > 0) return contact.hourlyRate;
        }
        // 2. Role-level rate (CONTACT_TYPE dictionary)
        const roleEntry = dictionaries.find(d => d.type === 'CONTACT_TYPE' && d.code === roleCode && d.active);
        if (roleEntry?.hourlyRate && roleEntry.hourlyRate > 0) return roleEntry.hourlyRate;
        // 3. Default fallback
        return 75;
    };

    // Unified Filter Logic:
    // 1. Must have a valid Contact record (Fixes "Ghost Users" / Username mismatch)
    // 2. Must match selected Team (if any selected)
    const filteredUsers = useMemo(() => {
        // Enrich users with Contact data � keep ALL users, even without a contact
        const enrichedUsers = availableUsers.map(user => {
            const contact = contacts.find(c => c.id === user.contactId);
            return { user, contact };
        });

        // If no Org Units selected, return all users
        if (!task.assignedOrgUnitIds || task.assignedOrgUnitIds.length === 0) {
            return enrichedUsers;
        }

        // Strict Team Filter � only show members of selected teams
        return enrichedUsers.filter(({ contact }) => {
            if (!contact) return false; // Exclude contactless users when teams are selected
            const contactOrgIds = contact.organizationUnitIds || (contact.organizationUnitId ? [contact.organizationUnitId] : []);
            return contactOrgIds.some((id: string) => task.assignedOrgUnitIds!.includes(id));
        });
    }, [availableUsers, contacts, task.assignedOrgUnitIds]);

    // Sorting: Alphabetical by Name (Contact Name)
    const sortedUsers = useMemo(() => {
        return [...filteredUsers].sort((a, b) => {
            const nameA = a.contact?.name || a.user.username || '';
            const nameB = b.contact?.name || b.user.username || '';
            return nameA.localeCompare(nameB);
        });
    }, [filteredUsers]);

    // Search-filtered people list
    const displayedUsers = useMemo(() => {
        if (!resourceSearchPeople.trim()) return sortedUsers;
        const q = resourceSearchPeople.toLowerCase();
        return sortedUsers.filter(({ user, contact }) => {
            const username = (user.username || '').toLowerCase();
            const name = (contact?.name || '').toLowerCase();
            const role = (contact?.defaultType || '').toLowerCase();
            const roleDesc = getRoleLabel(contact?.defaultType).toLowerCase();
            // Match all craft types on the contact (e.g. MECHANIC, ELECTRICIAN)
            const craftTypes: string[] = (contact as any)?.types || [];
            const craftMatch = craftTypes.some((t: string) =>
                t.toLowerCase().includes(q) || getRoleLabel(t).toLowerCase().includes(q)
            );
            return username.includes(q) || name.includes(q) || role.includes(q) || roleDesc.includes(q) || craftMatch;
        });
    }, [sortedUsers, resourceSearchPeople]);

    // --- Task-Based Resource Logic ---
    const taskLabor = useMemo(() => (jobContext.labor || []).filter(l => l.jobTaskId === task.id), [jobContext.labor, task.id]);
    const taskParts = useMemo(() => (jobContext.inventory || []).filter(i => i.jobTaskId === task.id), [jobContext.inventory, task.id]);

    // --- Planning-First: Role-Driven People Filter ---
    const plannedRoleCodes = useMemo(() =>
        new Set(taskLabor.map(l => l.contactType).filter(Boolean)),
        [taskLabor]
    );

    // Only show people who hold at least one planned role (strict planning-first)
    // Helper: check if a contact matches any planned role code
    const isQualifiedForPlannedRoles = (contact: any): boolean => {
        if (plannedRoleCodes.size === 0) return false;
        const contactRoles: string[] = contact?.types || [];
        const defaultType: string = contact?.defaultType || '';
        return contactRoles.some((r: string) => plannedRoleCodes.has(r)) || (defaultType !== '' && defaultType !== 'GUEST' && plannedRoleCodes.has(defaultType));
    };

    // All assignable people - qualified first, then everyone else
    // When craft requirements exist, show qualified people + already-assigned people
    const sortedAssignableUsers = useMemo(() => {
        // When actively searching, bypass craft requirement filter so supervisors can find anyone
        const isSearching = resourceSearchPeople.trim().length > 0;
        const assignedIds = new Set(task.assignedUserIds || []);
        const base = (!isSearching && plannedRoleCodes.size > 0)
            ? displayedUsers.filter(({ user, contact }) => isQualifiedForPlannedRoles(contact) || assignedIds.has(user.id))
            : displayedUsers;
        return [...base].sort((a, b) => {
            // Sort assigned people first, then by name
            const aAssigned = assignedIds.has(a.user.id) ? 0 : 1;
            const bAssigned = assignedIds.has(b.user.id) ? 0 : 1;
            if (aAssigned !== bAssigned) return aAssigned - bAssigned;
            const nameA = a.contact?.name || a.user.username || '';
            const nameB = b.contact?.name || b.user.username || '';
            return nameA.localeCompare(nameB);
        });
    }, [displayedUsers, plannedRoleCodes, resourceSearchPeople, task.assignedUserIds]);

    const qualifiedCount = useMemo(() => {
        return displayedUsers.filter(({ contact }) => isQualifiedForPlannedRoles(contact)).length;
    }, [displayedUsers, plannedRoleCodes]);

    // Staffing summary: how many planned roles have assigned people
    const roleStaffingSummary = useMemo(() => {
        const totalRoles = taskLabor.length;
        const totalPeopleNeeded = taskLabor.reduce((sum, l) => sum + (l.headcount || 1), 0);
        const totalHours = taskLabor.reduce((sum, l) => sum + ((l.estDuration || 0) * (l.headcount || 1)), 0);
        const assignedUserIds = task.assignedUserIds || [];
        // Count how many assigned users match each role, capped by headcount
        let filledPeople = 0;
        taskLabor.forEach(labor => {
            const matchingCount = assignedUserIds.filter(uid => {
                const user = availableUsers.find(u => u.id === uid);
                const contact = contacts.find((c: any) => c.id === user?.contactId);
                const contactRoles: string[] = (contact as any)?.types || [];
                const defaultType: string = (contact as any)?.defaultType || '';
                return contactRoles.includes(labor.contactType) || defaultType === labor.contactType;
            }).length;
            filledPeople += Math.min(matchingCount, labor.headcount || 1);
        });
        return { totalRoles, totalPeopleNeeded, totalHours, filledPeople, pct: totalPeopleNeeded > 0 ? Math.round((filledPeople / totalPeopleNeeded) * 100) : 0 };
    }, [taskLabor, task.assignedUserIds, availableUsers, contacts]);

    // --- Cross-Highlighting: People ? Teams ---
    // Org unit IDs of assigned people (for highlighting teams)
    const assignedPeopleOrgUnitIds = useMemo(() => {
        const orgIds = new Set<string>();
        (task.assignedUserIds || []).forEach(uid => {
            const user = availableUsers.find(u => u.id === uid);
            const contact = contacts.find((c: any) => c.id === user?.contactId);
            const contactOrgIds: string[] = (contact as any)?.organizationUnitIds || [];
            const singleOrgId = (contact as any)?.organizationUnitId;
            contactOrgIds.forEach(id => orgIds.add(id));
            if (singleOrgId) orgIds.add(singleOrgId);
        });
        return Array.from(orgIds);
    }, [task.assignedUserIds, availableUsers, contacts]);

    // Set of selected team IDs (for highlighting people in those teams)
    const selectedTeamIds = useMemo(() => new Set(task.assignedOrgUnitIds || []), [task.assignedOrgUnitIds]);

    const addTaskLabor = () => {
        const availableRoles = dictionaries.filter(d => d.type === 'CONTACT_TYPE' && d.active);
        const defaultType = availableRoles.length > 0 ? availableRoles[0].code : 'TECHNICIAN';
        const isFirst = taskLabor.length === 0;
        const newLabor: JobLabor = {
            id: `new-${Date.now()}`,
            contactType: defaultType,
            isLead: isFirst, // First role added is auto-designated as lead
            headcount: 1,
            estDuration: 1,
            estRate: resolveRate(defaultType),
            jobTaskId: task.id // Link to this task
        };
        onUpdateJob({ labor: [...(jobContext.labor || []), newLabor] });
    };

    const updateTaskLabor = (laborId: string, updates: Partial<JobLabor>) => {
        const updated = (jobContext.labor || []).map(l => {
            if (l.id !== laborId) return l;
            const merged = { ...l, ...updates };
            // Auto-update rate when contactType changes (dual cascade)
            if (updates.contactType) {
                merged.estRate = resolveRate(updates.contactType, merged.contactId);
            }
            return merged;
        });
        onUpdateJob({ labor: updated });
    };

    // Auto-Calculate Task Duration
    const handleTaskScheduleChange = (field: keyof JobTask, value: any) => {
        const updates: Partial<JobTask> = { [field]: value };

        // Resolve new values
        const newStartDateRaw = field === 'estStartDate' ? value : task.estStartDate;
        const newStartDate = newStartDateRaw ? newStartDateRaw.split('T')[0] : '';

        const newStartTime = field === 'estStartTime' ? value : task.estStartTime;

        const newFinishDateRaw = field === 'estFinishDate' ? value : task.estFinishDate;
        const newFinishDate = newFinishDateRaw ? newFinishDateRaw.split('T')[0] : '';

        const newFinishTime = field === 'estFinishTime' ? value : task.estFinishTime;

        if (newStartDate && newStartTime && newFinishDate && newFinishTime) {
            const start = new Date(`${newStartDate}T${newStartTime}`);
            const end = new Date(`${newFinishDate}T${newFinishTime}`);
            const diff = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
            if (!isNaN(diff) && diff >= 0) {
                updates.estHours = parseFloat(diff.toFixed(2));
            }
        }
        onChange(updates);
    };


    const removeTaskLabor = (laborId: string) => {
        onUpdateJob({ labor: (jobContext.labor || []).filter(l => l.id !== laborId) });
    };

    const addTaskPart = () => {
        setIsPartPickerOpen(true);
    };

    const handlePartSelect = (item: any) => {
        const newPart: JobInventory = {
            id: `new-${Date.now()}`,
            inventoryId: item.id,
            description: item.description,
            uom: item.uom,
            estQty: 1,
            estUnitCost: item.itemCost || 0,
            jobTaskId: task.id // Linking to this task
        };
        onUpdateJob({ inventory: [...(jobContext.inventory || []), newPart] });
        setIsPartPickerOpen(false);
    };

    const removeTaskPart = (partId: string) => {
        onUpdateJob({ inventory: (jobContext.inventory || []).filter(p => p.id !== partId) });
    };

    // Warning Logic
    const dateWarning = (() => {
        if (task.estStartDate && jobContext.dateDueStart && task.estStartDate < jobContext.dateDueStart) return "Warning: Task starts before Job Start Date.";
        if (task.estFinishDate && jobContext.dueDate && task.estFinishDate > jobContext.dueDate) return "Warning: Task finishes after Job Due Date.";
        return null;
    })();



    // Helper for Multi-Select (Simple implementation)
    const toggleSelection = (list: string[] | undefined, item: string) => {
        const current = list || [];
        if (current.includes(item)) return current.filter(i => i !== item);
        return [...current, item];
    };

    const [showObservations, setShowObservations] = useState(false);
    const [observationText, setObservationText] = useState(task.observations || '');
    const [showLibraryPicker, setShowLibraryPicker] = useState(false);
    const [libraryTasks, setLibraryTasks] = useState<LibraryTask[]>([]);
    const [libraryLoading, setLibraryLoading] = useState(false);

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

    const importFromLibrary = (libTask: LibraryTask) => {
        const updates: Partial<JobTask> = {
            instructions: [
                ...(task.instructions || []),
                ...(libTask.instructions || []).map((inst, i) => ({
                    ...inst,
                    id: `lib-${Date.now()}-${i}`,
                    sequence: (task.instructions?.length || 0) + i + 1,
                }))
            ],
            // Enhancement 3: Track library task ID for TECO locking
            libraryTaskId: libTask.id,
        };
        if (!task.description || task.description === 'New Task') {
            updates.description = libTask.title;
        }
        if (libTask.estimatedDuration && !task.estHours) {
            updates.estHours = libTask.estimatedDuration;
        }
        onChange(updates);
        setShowLibraryPicker(false);
    };

    return (
        <div className="flex flex-col h-full">
            {/* Compact Toolbar — stacks on mobile */}
            <div className="px-3 sm:px-4 py-2 border-b border-slate-200 bg-white space-y-1.5 sm:space-y-0">
                {/* Mobile toolbar: Duration + Status + Delete */}
                <div className="flex items-center gap-2 sm:hidden">
                    <div className="flex items-center gap-1 text-xs">
                        <Clock size={12} className="text-slate-400" />
                        <input
                            type="number"
                            value={task.estHours || ''}
                            onChange={(e) => onChange({ estHours: parseFloat(e.target.value) || 0 })}
                            className="w-14 px-1.5 py-1 text-xs text-right border border-slate-200 rounded focus:ring-1 focus:ring-primary-500"
                            placeholder="0"
                        />
                        <span className="text-slate-400">hrs</span>
                    </div>
                    {/* WM-2b: work center picker (mobile) */}
                    <select
                        value={task.workCenterId || ''}
                        onChange={(e) => onChange({ workCenterId: e.target.value || undefined })}
                        className="flex-1 min-w-0 px-1.5 py-1 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-primary-500 text-slate-600"
                        title="Work center"
                    >
                        <option value="">Work center…</option>
                        {workCenters.map(wc => (
                            <option key={wc.id} value={wc.id}>{wc.code}</option>
                        ))}
                    </select>
                    <select
                        value={task.status}
                        onChange={(e) => onChange({ status: e.target.value as any })}
                        className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg ${task.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : task.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}
                    >
                        <option value="PENDING">PENDING</option>
                        <option value="IN_PROGRESS">IN PROGRESS</option>
                        <option value="COMPLETED">COMPLETED</option>
                    </select>
                </div>
                {/* Desktop inline toolbar — hidden on mobile */}
                <div className="hidden sm:flex items-center gap-2 -mt-1">
                    <div className="flex-1" /> {/* spacer */}
                    {/* WM-2b: work center — the costed resource this operation runs at */}
                    <div className="flex items-center gap-1 text-xs" title="Work center — costed resource this operation is performed at">
                        <Factory size={12} className="text-slate-400" />
                        <select
                            value={task.workCenterId || ''}
                            onChange={(e) => onChange({ workCenterId: e.target.value || undefined })}
                            className="px-1.5 py-0.5 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-primary-500 max-w-[150px] text-slate-600"
                        >
                            <option value="">Work center…</option>
                            {workCenters.map(wc => (
                                <option key={wc.id} value={wc.id}>{wc.code} · {wc.name}</option>
                            ))}
                        </select>
                        {effectiveRate != null && (
                            <span className="text-slate-400 whitespace-nowrap" title={task.plannedRate != null ? 'Per-operation planned rate' : 'Work-center activity rate'}>
                                @ {effectiveRate}/hr
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-1 text-xs">
                        <Clock size={12} className="text-slate-400" />
                        <input
                            type="number"
                            value={task.estHours || ''}
                            onChange={(e) => onChange({ estHours: parseFloat(e.target.value) || 0 })}
                            className="w-12 px-1 py-0.5 text-xs text-right border border-slate-200 rounded focus:ring-1 focus:ring-primary-500"
                            placeholder="0"
                        />
                        <span className="text-slate-400">hrs</span>
                    </div>
                    <select
                        value={task.status}
                        onChange={(e) => onChange({ status: e.target.value as any })}
                        className={`text-xs font-semibold px-2 py-1 rounded ${task.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : task.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}
                    >
                        <option value="PENDING">PENDING</option>
                        <option value="IN_PROGRESS">IN PROGRESS</option>
                        <option value="COMPLETED">COMPLETED</option>
                    </select>
                    <button onClick={onDelete} className="text-slate-400 hover:text-red-500 p-1"><Trash2 size={14} /></button>
                </div>
            </div>

            {/* WM-2c: time confirmation (shown in Do-work mode) */}
            {execMode && !task.id.startsWith('new-') && (
                <div className="px-3 sm:px-4 py-2 border-b border-slate-200 bg-blue-50/40 flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wide flex items-center gap-1">
                        <Clock size={12} /> Confirm time
                    </span>
                    <input
                        type="number"
                        min={0}
                        step="0.5"
                        value={confHours}
                        onChange={(e) => setConfHours(e.target.value)}
                        placeholder="Hours"
                        className="w-20 px-2 py-1 text-xs text-right border border-slate-200 rounded focus:ring-1 focus:ring-blue-500"
                    />
                    {effectiveRate != null && parseFloat(confHours) > 0 && (
                        <span className="text-[11px] text-slate-500">≈ {(parseFloat(confHours) * effectiveRate).toFixed(2)} labour cost</span>
                    )}
                    <label className="flex items-center gap-1 text-[11px] text-slate-600 cursor-pointer">
                        <input type="checkbox" checked={confFinal} onChange={(e) => setConfFinal(e.target.checked)} className="rounded border-slate-300 text-blue-600 focus:ring-blue-400" />
                        Final (close operation)
                    </label>
                    <button
                        onClick={postTimeConfirmation}
                        disabled={posting}
                        className="text-xs bg-blue-600 text-white px-2.5 py-1 rounded hover:bg-blue-700 disabled:opacity-60 flex items-center gap-1 font-medium"
                    >
                        {posting ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Post
                    </button>
                    {task.actualHours ? (
                        <span className="text-[11px] text-slate-400 ml-auto">Confirmed to date: {task.actualHours}h</span>
                    ) : null}
                </div>
            )}

            {/* Tab Bar: Instructions | Resources */}
            <div className="px-2 sm:px-4 py-0 border-b border-slate-200 bg-slate-50/50 flex items-center gap-0">
                <button
                    onClick={() => onTabChange('instructions')}
                    className={`flex-1 sm:flex-none px-3 sm:px-4 py-2 text-xs font-bold uppercase tracking-wide border-b-2 transition-colors text-center ${
                        editorTab === 'instructions'
                            ? 'border-blue-600 text-blue-700 bg-white'
                            : 'border-transparent text-slate-400 hover:text-slate-600'
                    }`}
                >
                    <ClipboardList size={12} className="inline mr-1.5 -mt-0.5" />
                    Instructions
                </button>
                <button
                    onClick={() => onTabChange('resources')}
                    className={`flex-1 sm:flex-none px-3 sm:px-4 py-2 text-xs font-bold uppercase tracking-wide border-b-2 transition-colors flex items-center justify-center sm:justify-start gap-1.5 ${
                        editorTab === 'resources'
                            ? 'border-blue-600 text-blue-700 bg-white'
                            : 'border-transparent text-slate-400 hover:text-slate-600'
                    }`}
                >
                    <Users size={12} className="inline -mt-0.5" />
                    Resources
                    {/* Badge showing resource count */}
                    {(taskLabor.length > 0 || taskParts.length > 0) && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                            editorTab === 'resources' ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-500'
                        }`}>
                            {taskLabor.length + taskParts.length}
                        </span>
                    )}
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 sm:p-3 md:p-5 space-y-3 sm:space-y-4">

                {/* Warning Banner (always visible) */}
                {dateWarning && (
                    <div className="bg-amber-50 border-l-4 border-amber-400 rounded-r px-3 py-2 flex items-center gap-2 text-xs text-amber-800">
                        <AlertTriangle size={14} />
                        {dateWarning}
                    </div>
                )}

                {/* ====================== INSTRUCTIONS TAB ====================== */}
                {editorTab === 'instructions' && (
                    <>

                {/* Instructions Section (PRIMARY - Full Page) */}
                <div className="bg-white rounded-lg border border-slate-200">
                    <div className="px-2 sm:px-3 py-1.5 sm:py-2 border-b border-slate-100 flex items-center justify-between">
                        <h4 className="hidden sm:flex text-xs font-bold text-slate-700 uppercase items-center gap-2">
                            <ClipboardList size={14} /> Task Instructions
                        </h4>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setShowObservations(!showObservations)}
                                className={`text-xs font-medium flex items-center gap-1 ${task.observations ? 'text-emerald-600 hover:text-emerald-700' : 'text-blue-600 hover:text-blue-700'}`}
                            >
                                <FileText size={12} />
                                {showObservations ? 'Hide' : (task.observations ? 'View' : 'Add')} Observation
                                {task.observations && !showObservations && (
                                    <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                                )}
                            </button>
                            <button
                                onClick={openLibraryPicker}
                                className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                            >
                                <Book size={12} />
                                <span className="hidden sm:inline">Import Template</span>
                            </button>
                        </div>
                    </div>

                    <div className="p-2 sm:p-3">
                        <ProcedureBuilder
                            instructions={task.instructions || []}
                            onChange={(blocks) => onChange({ instructions: blocks })}
                            readOnly={(jobContext.status as string) === 'COMPLETED'}
                            mode={((jobContext.status as string) === 'COMPLETED' || execMode) ? 'EXECUTE' : 'EDIT'}
                        />
                    </div>

                    {/* Collapsible Observations Section */}
                    {showObservations && (
                        <div className="border-t border-slate-100 px-3 py-3 bg-slate-50">
                            <label className="text-xs font-bold text-slate-600 uppercase mb-2 block flex items-center gap-1">
                                <FileText size={12} />
                                Observations & Notes
                            </label>
                            <textarea
                                value={observationText}
                                onChange={(e) => setObservationText(e.target.value)}
                                placeholder="Add observations, findings, or notes about this task..."
                                className="w-full p-2 text-sm border border-slate-200 rounded focus:ring-1 focus:ring-primary-500 focus:border-blue-500 min-h-[60px] resize-y"
                                rows={2}
                            />
                            <div className="mt-2 flex items-center gap-2">
                                <button className="text-xs flex items-center gap-1 px-2 py-1 rounded border border-slate-200 hover:bg-white transition">
                                    <Camera size={12} />
                                    Add Photo
                                </button>
                                <button className="text-xs flex items-center gap-1 px-2 py-1 rounded border border-slate-200 hover:bg-white transition">
                                    <FileText size={12} />
                                    Attach File
                                </button>
                                <button
                                    onClick={() => {
                                        onChange({ observations: observationText });
                                        setShowObservations(false);
                                    }}
                                    className="ml-auto text-xs bg-primary-600 text-white px-3 py-1 rounded hover:bg-primary-500 font-medium"
                                >
                                    Save Observation
                                </button>
                                {task.observations && (
                                    <button
                                        onClick={() => {
                                            setObservationText('');
                                            onChange({ observations: '' });
                                            setShowObservations(false);
                                        }}
                                        className="text-xs text-red-500 hover:text-red-700 font-medium"
                                    >
                                        Clear
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Compact Project Scheduling (Only for PROJECT scope) */}
                {jobContext.scope === 'PROJECT' && (
                    <div className="bg-white rounded-lg border border-blue-100 p-2 sm:p-3">
                        <h4 className="text-xs font-bold text-blue-600 uppercase mb-2">Task Schedule (Project Mode)</h4>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                            <div>
                                <label className="text-[10px] text-slate-400 uppercase font-bold block mb-1">Start Date</label>
                                <input
                                    type="date"
                                    value={task.estStartDate ? task.estStartDate.split('T')[0] : ''}
                                    onChange={(e) => handleTaskScheduleChange('estStartDate', e.target.value)}
                                    className="w-full text-xs border-slate-300 rounded p-1"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] text-slate-400 uppercase font-bold block mb-1">Start Time</label>
                                <input
                                    type="time"
                                    value={task.estStartTime || ''}
                                    onChange={(e) => handleTaskScheduleChange('estStartTime', e.target.value)}
                                    className="w-full text-xs border-slate-300 rounded p-1"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] text-slate-400 uppercase font-bold block mb-1">Finish Date</label>
                                <input
                                    type="date"
                                    value={task.estFinishDate ? task.estFinishDate.split('T')[0] : ''}
                                    onChange={(e) => handleTaskScheduleChange('estFinishDate', e.target.value)}
                                    className="w-full text-xs border-slate-300 rounded p-1"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] text-slate-400 uppercase font-bold block mb-1">Finish Time</label>
                                <input
                                    type="time"
                                    value={task.estFinishTime || ''}
                                    onChange={(e) => handleTaskScheduleChange('estFinishTime', e.target.value)}
                                    className="w-full text-xs border-slate-300 rounded p-1"
                                />
                            </div>
                        </div>
                        {/* Predecessor Dependency */}
                        <div className="mt-2">
                            <label className="text-[10px] text-blue-500 uppercase font-bold block mb-1">Predecessor (Start After)</label>
                            <select
                                value={task.predecessorTaskId || ''}
                                onChange={(e) => onChange({ predecessorTaskId: e.target.value || undefined })}
                                className="w-full text-xs border-slate-300 rounded p-1 bg-white"
                            >
                                <option value="">(None)</option>
                                {(jobContext.tasks || []).filter(t => t.id !== task.id).map(t => (
                                    <option key={t.id} value={t.id}>#{t.sequence} � {t.description}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                )}

                    </>
                )}

                {/* ====================== RESOURCES TAB ====================== */}
                {editorTab === 'resources' && (
                    <>

                <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
                    <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
                        <h4 className="text-xs font-bold text-slate-700 uppercase flex items-center gap-2">
                            <Users size={14} className="text-blue-600" /> Assign People
                        </h4>
                        <button onClick={addTaskLabor} className="text-xs text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1 hover:bg-blue-50 px-2 py-1 rounded-lg transition-colors">
                            <Plus size={12} /> Add Role
                        </button>
                    </div>

                    <div className="p-4 space-y-4">

                        {/* -- Craft Requirements (Planning) -- */}
                        {taskLabor.length === 0 ? (
                            <button
                                onClick={addTaskLabor}
                                className="w-full text-xs text-blue-500 hover:text-blue-700 hover:bg-blue-50 border border-dashed border-blue-200 rounded-lg px-3 py-2 flex items-center justify-center gap-1.5 transition-colors"
                            >
                                <Plus size={12} /> Add craft requirement to enable role-based scheduling
                            </button>
                        ) : (
                            <>
                            <div>
                                <label className="text-[11px] text-blue-600 uppercase font-bold tracking-wider flex items-center gap-1.5 mb-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" /> Craft Requirements <span className="text-slate-400 font-normal">(Planning)</span>
                                </label>
                                {taskLabor.length > 1 && (
                                    <input
                                        type="text"
                                        placeholder="Filter roles..."
                                        value={resourceSearchRole}
                                        onChange={(e) => setResourceSearchRole(e.target.value)}
                                        className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg mb-2 focus:ring-2 focus:ring-primary-400 focus:border-primary-600"
                                    />
                                )}
                                <div className="space-y-1.5">
                                    {taskLabor
                                        .filter(labor => {
                                            if (!resourceSearchRole.trim()) return true;
                                            const q = resourceSearchRole.toLowerCase();
                                            const desc = getRoleLabel(labor.contactType).toLowerCase();
                                            return labor.contactType.toLowerCase().includes(q) || desc.includes(q);
                                        })
                                        .map(labor => {
                                            // Skill gap check: count qualified people for this role
                                            const qualifiedCount = displayedUsers.filter(({ contact }) => {
                                                const contactRoles: string[] = (contact as any)?.types || [];
                                                const defaultType: string = (contact as any)?.defaultType || '';
                                                return contactRoles.includes(labor.contactType) || defaultType === labor.contactType;
                                            }).length;
                                            return (
                                                <div key={labor.id} className={`flex items-center gap-2 p-2.5 rounded-lg text-xs border ${labor.isLead ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-100'
                                                    }`}>
                                                    {/* Lead Craft Toggle */}
                                                    <button
                                                        onClick={() => {
                                                            const updated = (jobContext.labor || []).map(l => {
                                                                if (l.jobTaskId !== task.id) return l;
                                                                return { ...l, isLead: l.id === labor.id ? !l.isLead : false };
                                                            });
                                                            onUpdateJob({ labor: updated });
                                                        }}
                                                        className={`text-xs shrink-0 ${labor.isLead ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'
                                                            }`}
                                                        title={labor.isLead ? 'Lead Craft (click to unset)' : 'Set as Lead Craft'}
                                                    >
                                                        ⭐
                                                    </button>
                                                    <select
                                                        value={labor.contactType}
                                                        onChange={(e) => updateTaskLabor(labor.id, { contactType: e.target.value })}
                                                        className="text-xs border-slate-300 rounded-lg p-1.5 flex-1"
                                                    >
                                                        <option value="">— Select Role —</option>
                                                        {dictionaries.filter(d => d.type === 'CONTACT_TYPE' && d.active).length === 0 && (
                                                            <option disabled>No roles configured</option>
                                                        )}
                                                        {dictionaries.filter(d => d.type === 'CONTACT_TYPE' && d.active).map(d => (
                                                            <option key={d.id} value={d.code}>{d.description}</option>
                                                        ))}
                                                    </select>
                                                    {/* Headcount */}
                                                    <div className="flex items-center gap-0.5">
                                                        <span className="text-[10px] text-slate-400">×</span>
                                                        <input
                                                            type="number" min="1" step="1"
                                                            value={labor.headcount || 1}
                                                            onChange={(e) => updateTaskLabor(labor.id, { headcount: parseInt(e.target.value) || 1 })}
                                                            className="w-10 px-1 py-1 text-xs text-center bg-white border border-slate-200 rounded-lg text-slate-700 focus:ring-2 focus:ring-primary-400 focus:border-primary-600 transition-colors"
                                                            title="Number of people needed for this role"
                                                        />
                                                    </div>
                                                    <input
                                                        type="number" min="0.5" step="0.5"
                                                        value={labor.estDuration}
                                                        onChange={(e) => updateTaskLabor(labor.id, { estDuration: parseFloat(e.target.value) || 0 })}
                                                        className="w-14 px-1 py-1 text-xs text-right bg-white border border-slate-200 rounded-lg text-slate-700 focus:ring-2 focus:ring-primary-400 focus:border-primary-600 transition-colors"
                                                        title="Est. Hours per person"
                                                    />
                                                    <span className="text-[10px] text-slate-400">hrs</span>
                                                    <span className="text-[10px] font-medium text-emerald-600 min-w-[52px] text-right" title={`Rate/hr — ${labor.estRate > 0 ? 'From role or user override' : 'Default'}`}>
                                                        ${labor.estRate.toFixed(0)}/hr
                                                    </span>
                                                    <span className="text-[10px] font-medium text-blue-600 min-w-[40px] text-right" title="Line Cost (all people)">
                                                        ${((labor.estDuration * labor.estRate) * (labor.headcount || 1)).toFixed(0)}
                                                    </span>
                                                    {/* Skill Gap Warning */}
                                                    {qualifiedCount === 0 && labor.contactType && <span className="text-[9px] text-red-500 shrink-0" title="No qualified personnel available">⚠ 0</span>}
                                                    <button onClick={() => removeTaskLabor(labor.id)} className="text-slate-400 hover:text-red-500">
                                                        <Trash2 size={12} />
                                                    </button>
                                                </div>
                                            );
                                        })}
                                </div>
                            </div>

                            {/* Staffing Summary Bar */}
                            <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg border border-slate-100 text-[11px]">
                                <span className="text-slate-500 font-medium">Planned: {roleStaffingSummary.totalRoles} role{roleStaffingSummary.totalRoles !== 1 ? 's' : ''} — {roleStaffingSummary.totalPeopleNeeded} people ({roleStaffingSummary.totalHours}h)</span>
                                <span className="text-slate-300">|</span>
                                <span className={`font-medium ${roleStaffingSummary.pct === 100 ? 'text-emerald-600' : roleStaffingSummary.pct > 0 ? 'text-amber-600' : 'text-red-500'}`}>
                                    Assigned: {roleStaffingSummary.filledPeople} of {roleStaffingSummary.totalPeopleNeeded} filled
                                </span>
                                <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                    <div
                                        className={`h-full rounded-full transition-all ${roleStaffingSummary.pct === 100 ? 'bg-emerald-500' : roleStaffingSummary.pct > 0 ? 'bg-amber-400' : 'bg-red-400'}`}
                                        style={{ width: `${roleStaffingSummary.pct}%` }}
                                    />
                                </div>
                                <span className="text-slate-400 font-mono">{roleStaffingSummary.pct}%</span>
                            </div>

                            {/* Divider between Planning and Scheduling */}
                            <div className="relative py-1">
                                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-dashed border-slate-200" /></div>
                                <div className="relative flex justify-center">
                                    <span className="px-3 bg-white text-[9px] text-slate-400 uppercase tracking-widest">Scheduling</span>
                                </div>
                            </div>
                            </>
                        )}

                        {/* -- Personnel Assignment (Scheduling) -- */}
                        <div className="space-y-3">
                            {/* Teams — collapsible full-width row on top */}
                            <div>
                                <button
                                    type="button"
                                    onClick={() => setTeamsSectionOpen(prev => !prev)}
                                    className="w-full text-[11px] text-emerald-600 uppercase font-bold mb-1.5 flex items-center gap-1 hover:text-emerald-700 transition-colors"
                                >
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                                    {teamsSectionOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                    Teams
                                    {(task.assignedOrgUnitIds || []).length > 0 && (
                                        <span className="text-[9px] text-slate-400 font-normal ml-1">
                                            ({(task.assignedOrgUnitIds || []).length} selected)
                                        </span>
                                    )}
                                </button>
                                {teamsSectionOpen && (
                                    <OrgTreePicker
                                        units={availableOrgUnits}
                                        selectedIds={task.assignedOrgUnitIds || []}
                                        onChange={(newIds) => onChange({ assignedOrgUnitIds: newIds })}
                                        highlightedIds={assignedPeopleOrgUnitIds}
                                    />
                                )}
                            </div>

                            {/* People — collapsible full-width row below */}
                            <div>
                                <button
                                    type="button"
                                    onClick={() => setPeopleSectionOpen(prev => !prev)}
                                    className="w-full text-[11px] text-emerald-600 uppercase font-bold mb-1.5 flex items-center gap-1 hover:text-emerald-700 transition-colors"
                                >
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                                    {peopleSectionOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                    People
                                    <span className="text-[9px] text-slate-400 font-normal ml-1">
                                        ({plannedRoleCodes.size > 0
                                            ? `${qualifiedCount} qualified${(task.assignedUserIds || []).length > 0 && qualifiedCount === 0 ? ` \u00b7 ${(task.assignedUserIds || []).length} assigned` : ''}`
                                            : `${sortedAssignableUsers.length} available`})
                                    </span>
                                    {(task.assignedUserIds || []).length > 0 && (
                                        <span className="text-[9px] font-normal ml-auto px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                                            {(task.assignedUserIds || []).length} assigned
                                        </span>
                                    )}
                                </button>
                                {peopleSectionOpen && (
                                    <>
                                    {sortedAssignableUsers.length === 0 ? (
                                        <div className="border border-dashed border-slate-200 rounded-lg p-4 text-center">
                                            <Users size={20} className="mx-auto text-slate-300 mb-1" />
                                            <div className="text-[11px] text-slate-400">
                                                {plannedRoleCodes.size > 0 || selectedTeamIds.size > 0
                                                    ? 'No matching people — check craft requirements and team selections'
                                                    : 'No people found — add contacts in the People module'}
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <input
                                                type="text"
                                                placeholder="Search by name, username, or craft..."
                                                value={resourceSearchPeople}
                                                onChange={(e) => setResourceSearchPeople(e.target.value)}
                                                className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg mb-1.5 focus:ring-2 focus:ring-primary-400 focus:border-primary-600"
                                            />
                                            <div className="border border-slate-200 rounded-lg max-h-56 overflow-y-auto p-1.5 text-xs">
                                                {sortedAssignableUsers.map(({ user, contact }, idx) => {
                                                    const isInternal = (contact as any)?.flags?.isLabour;
                                                    const isVendor = (contact as any)?.flags?.isVendor;
                                                    const isAssigned = (task.assignedUserIds || []).includes(user.id);
                                                    const isQualified = isQualifiedForPlannedRoles(contact);
                                                    const contactOrgIds: string[] = (contact as any)?.organizationUnitIds || [];
                                                    const singleOrgId = (contact as any)?.organizationUnitId;
                                                    const isInSelectedTeam = selectedTeamIds.size > 0 && (
                                                        contactOrgIds.some(id => selectedTeamIds.has(id)) ||
                                                        (singleOrgId && selectedTeamIds.has(singleOrgId))
                                                    );
                                                    return (
                                                        <React.Fragment key={user.id}>
                                                            <label className={`flex items-center gap-2 p-1.5 cursor-pointer rounded-lg transition-colors ${isAssigned ? 'bg-emerald-50' : isInSelectedTeam ? 'bg-blue-50/50 ring-1 ring-blue-100' : 'hover:bg-slate-50'
                                                                }`}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={isAssigned}
                                                                    onChange={() => onChange({ assignedUserIds: toggleSelection(task.assignedUserIds, user.id) })}
                                                                    className="rounded border-slate-300 h-3 w-3"
                                                                />
                                                                <span className={`text-xs flex-1 ${isQualified ? 'text-slate-700 font-medium' : 'text-slate-500'}`}>
                                                                    {contact?.name || user.username}
                                                                </span>
                                                                {isQualified && plannedRoleCodes.size > 0 && (
                                                                    <span className="text-[8px] px-1 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-200 shrink-0" title="Matches planned role">✓</span>
                                                                )}
                                                                {isInSelectedTeam && !isAssigned && (
                                                                    <span className="text-[8px] px-1 py-0.5 rounded bg-blue-50 text-blue-500 border border-blue-100 shrink-0" title="In selected team">team</span>
                                                                )}
                                                                {isVendor ? (
                                                                    <span className="text-[8px] px-1 py-0.5 rounded bg-orange-50 text-orange-600 border border-orange-100 shrink-0" title="Contractor">🔧</span>
                                                                ) : isInternal ? (
                                                                    <span className="text-[8px] px-1 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100 shrink-0" title="Internal">🏢</span>
                                                                ) : null}
                                                                {contact?.defaultType && contact.defaultType !== 'GUEST' && (
                                                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-medium border border-blue-100 shrink-0">
                                                                        {getRoleLabel(contact.defaultType)}
                                                                    </span>
                                                                )}
                                                            </label>
                                                        </React.Fragment>
                                                    );
                                                })}
                                            </div>
                                        </>
                                    )}
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* ----------------------------------------------------------- */}
                {/* CARD 2 � ?? PARTS & MATERIALS                             */}
                {/* ----------------------------------------------------------- */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
                    <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
                        <h4 className="text-xs font-bold text-slate-700 uppercase flex items-center gap-2">
                            <Box size={14} className="text-amber-600" /> Parts & Materials
                        </h4>
                        <button onClick={addTaskPart} className="text-xs text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1 hover:bg-blue-50 px-2 py-1 rounded-lg transition-colors">
                            <Plus size={12} /> Add Part
                        </button>
                    </div>

                    <div className="p-4">
                        {taskParts.length > 2 && (
                            <input
                                type="text"
                                placeholder="Search parts..."
                                value={resourceSearchParts}
                                onChange={(e) => setResourceSearchParts(e.target.value)}
                                className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg mb-3 focus:ring-2 focus:ring-primary-400 focus:border-primary-600"
                            />
                        )}
                        <div className="space-y-1.5">
                            {taskParts.length === 0 && (
                                <div className="border border-dashed border-slate-200 rounded-lg p-6 text-center">
                                    <Box size={24} className="mx-auto text-slate-300 mb-2" />
                                    <div className="text-xs text-slate-400">No parts required</div>
                                    <div className="text-[10px] text-slate-300 mt-0.5">Click "+ Add Part" to plan materials for this task</div>
                                </div>
                            )}
                            {taskParts
                                .filter(part => {
                                    if (!resourceSearchParts.trim()) return true;
                                    return part.description.toLowerCase().includes(resourceSearchParts.toLowerCase());
                                })
                                .map(part => (
                                    <div key={part.id} className="flex items-center justify-between p-2.5 bg-slate-50 rounded-lg text-xs border border-slate-100">
                                        <div className="flex-1">
                                            <span className="font-medium text-slate-700">{part.description}</span>
                                            <span className="ml-2 text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{part.uom || 'EA'}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="number"
                                                min="0.1"
                                                step="0.1"
                                                value={part.estQty}
                                                onChange={(e) => {
                                                    const val = parseFloat(e.target.value);
                                                    const updated = (jobContext.inventory || []).map(p => p.id === part.id ? { ...p, estQty: val } : p);
                                                    onUpdateJob({ inventory: updated });
                                                }}
                                                className="w-14 px-1 py-0.5 text-xs text-right border border-slate-300 rounded focus:ring-1 focus:ring-primary-500"
                                            />
                                            {part.estUnitCost > 0 && (
                                                <span className="text-[10px] font-medium text-blue-600 min-w-[40px] text-right" title="Line Cost">
                                                    ${(part.estQty * part.estUnitCost).toFixed(0)}
                                                </span>
                                            )}
                                            {(jobContext.status === 'WIP' || jobContext.status === 'TECO') && (
                                                <button
                                                    onClick={() => handleReturnToStores(part)}
                                                    className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded text-[10px] font-bold border border-amber-200 transition-colors shrink-0"
                                                    title="Return to Stores"
                                                >
                                                    Return
                                                 </button>
                                            )}
                                            <button onClick={() => removeTaskPart(part.id)} className="text-slate-400 hover:text-red-500"><Trash2 size={12} /></button>
                                        </div>
                                    </div>
                                ))}
                        </div>

                        {/* Cost Summary Footer */}
                        {taskParts.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                                <span className="text-slate-500 font-medium">{taskParts.length} item{taskParts.length !== 1 ? 's' : ''} � {taskParts.reduce((sum, p) => sum + p.estQty, 0).toFixed(1)} total qty</span>
                                <span className="font-bold text-blue-700">
                                    Est. Total: ${taskParts.reduce((sum, p) => sum + (p.estQty * (p.estUnitCost || 0)), 0).toFixed(0)}
                                </span>
                            </div>
                        )}
                    </div>
                </div>


                    </>
                )}

            </div>

            {/* Inventory Picker Modal */}
            <InventoryPicker
                isOpen={isPartPickerOpen}
                onClose={() => setIsPartPickerOpen(false)}
                onSelect={handlePartSelect}
            />

            {/* Library Task Picker Modal */}
            {showLibraryPicker && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={() => setShowLibraryPicker(false)}>
                    <div className="bg-white rounded-xl shadow-2xl w-[480px] max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
                            <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                                <Book size={16} className="text-blue-600" />
                                Import from Task Library
                            </h3>
                            <button onClick={() => setShowLibraryPicker(false)} className="text-slate-400 hover:text-slate-600">
                                <X size={16} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-3">
                            {libraryLoading ? (
                                <div className="text-center py-8 text-sm text-slate-400">Loading library tasks...</div>
                            ) : libraryTasks.length === 0 ? (
                                <div className="text-center py-8 text-sm text-slate-400">
                                    <Book size={32} className="mx-auto mb-2 opacity-20" />
                                    No library tasks found. Create templates in Admin ? Task Library.
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {libraryTasks.map(lt => (
                                        <button
                                            key={lt.id}
                                            onClick={() => importFromLibrary(lt)}
                                            className="w-full text-left p-3 border border-slate-200 rounded-lg hover:border-blue-300 hover:bg-blue-50/30 transition group"
                                        >
                                            <div className="flex items-start justify-between">
                                                <div>
                                                    <div className="font-semibold text-sm text-slate-800 group-hover:text-blue-700">{lt.title}</div>
                                                    <div className="text-xs text-slate-400 mt-0.5">
                                                        {lt.category && <span className="bg-slate-100 px-1.5 py-0.5 rounded mr-2">{lt.category}</span>}
                                                        {lt.instructions?.length || 0} steps
                                                        {lt.estimatedDuration ? ` � ${lt.estimatedDuration}h` : ''}
                                                    </div>
                                                    {lt.description && <div className="text-xs text-slate-500 mt-1 line-clamp-2">{lt.description}</div>}
                                                </div>
                                                <ArrowRight size={14} className="text-slate-300 group-hover:text-blue-500 mt-1 shrink-0" />
                                            </div>
                                        </button>
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


const JSATab: React.FC<{ job: WorkOrder; onUpdate: (u: Partial<WorkOrder>) => void; dictionaries: DictionaryEntry[] }> = ({ job, onUpdate, dictionaries }) => {
    const { user } = useAuth();
    const { showToast } = useToast();
    const confirm = useConfirm();
    const [permits, setPermits] = useState<any[]>([]);
    const [showCreatePermit, setShowCreatePermit] = useState(false);
    const [expandedPermit, setExpandedPermit] = useState<string | null>(null);
    const [newPermit, setNewPermit] = useState<any>({
        permitType: 'GENERAL',
        description: job.description || '',
        ppeRequirements: [],
        safetyRequirements: [],
        environmentalConditions: '',
    });
    const [loadingPermits, setLoadingPermits] = useState(false);

    // --- Enhancement state ---
    const [aiSuggesting, setAiSuggesting] = useState(false);
    const [aiSuggestions, setAiSuggestions] = useState<JSAHazardSuggestion[]>([]);
    const [showTemplatePicker, setShowTemplatePicker] = useState(false);
    const [showTemplateSave, setShowTemplateSave] = useState(false);
    const [templateName, setTemplateName] = useState('');
    const [savedTemplates, setSavedTemplates] = useState<{ name: string; hazards: any[] }[]>([]);

    // Load saved JSA templates from localStorage
    useEffect(() => {
        try {
            const stored = localStorage.getItem('jsa_templates');
            if (stored) setSavedTemplates(JSON.parse(stored));
        } catch { /* ignore */ }
    }, []);

    // Dictionary lookups
    const permitTypes = dictionaries.filter(d => d.type === 'PERMIT_TYPE' && d.active);
    const ptwStatuses = dictionaries.filter(d => d.type === 'PTW_STATUS' && d.active);
    const isolationTypes = dictionaries.filter(d => d.type === 'ISOLATION_TYPE' && d.active);
    const ppeTypes = dictionaries.filter(d => d.type === 'PPE_TYPE' && d.active);

    const getStatusDesc = (code: string) => ptwStatuses.find(s => s.code === code)?.description || code;
    const getPermitTypeDesc = (code: string) => permitTypes.find(p => p.code === code)?.description || code;
    const getIsolationTypeDesc = (code: string) => isolationTypes.find(i => i.code === code)?.description || code;
    const getPPEDesc = (code: string) => ppeTypes.find(p => p.code === code)?.description || code;

    // Load permits when JSA exists
    useEffect(() => {
        if (job.jsa?.id) {
            loadPermits();
        }
    }, [job.jsa?.id]);

    const loadPermits = async () => {
        if (!job.jsa?.id) return;
        setLoadingPermits(true);
        try {
            const db = DatabaseService.getInstance();
            const data = await db.getPermitsByJSA(job.jsa.id);
            setPermits(data);
        } catch (e) {
            console.error('Failed to load permits:', e);
        } finally {
            setLoadingPermits(false);
        }
    };

    // Initialize JSA if missing
    if (!job.jsa) {
        return (
            <div className="p-8 text-center text-slate-400">
                <p className="mb-4">No Job Safety Analysis initialized for this job.</p>
                <button
                    onClick={() => onUpdate({ jsa: { id: `jsa-${Date.now()}`, status: 'DRAFT', permits: [], hazards: [], signoffs: [] } })}
                    className="bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-500"
                >
                    Init JSA
                </button>
            </div>
        );
    }

    const addHazard = () => {
        const newHazard: JobHazard = {
            id: `hz-${Date.now()}`,
            hazard: '',
            consequence: 1,
            likelihood: 1,
            riskScore: 1,
            riskLevel: 'Low',
            controlHierarchy: [],
            controls: ''
        };
        onUpdate({
            jsa: {
                ...job.jsa!,
                hazards: [...(job.jsa!.hazards || []), newHazard]
            } as any
        });
    };

    // --- Risk Matrix Constants ---
    const CONSEQUENCE_LABELS = ['Insignificant', 'Minor', 'Moderate', 'Major', 'Catastrophic'];
    const LIKELIHOOD_LABELS = ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost Certain'];
    const WO_CONTROL_HIERARCHY = ['Elimination', 'Substitution', 'Engineering', 'Admin', 'PPE'] as const;
    const WO_RISK_COLORS: Record<string, string> = {
        Critical: 'border-red-500 bg-red-50',
        High: 'border-orange-400 bg-orange-50',
        Medium: 'border-amber-400 bg-amber-50',
        Low: 'border-green-400 bg-green-50',
    };
    const getWORiskLevel = (score: number): 'Critical' | 'High' | 'Medium' | 'Low' => {
        if (score >= 20) return 'Critical';
        if (score >= 15) return 'High';
        if (score >= 8) return 'Medium';
        return 'Low';
    };
    const cellColor = (c: number, l: number) => {
        const s = c * l;
        if (s >= 20) return 'bg-red-600 text-white';
        if (s >= 15) return 'bg-orange-500 text-white';
        if (s >= 8) return 'bg-amber-400 text-amber-900';
        if (s >= 4) return 'bg-yellow-300 text-yellow-900';
        return 'bg-green-400 text-green-900';
    };

    const updateHazard = (id: string, field: keyof JobHazard, value: any) => {
        const newHazards = (job.jsa!.hazards || []).map(h => {
            if (h.id !== id) return h;
            const updated = { ...h, [field]: value };
            // Auto-compute INITIAL risk score when consequence or likelihood changes
            if (field === 'consequence' || field === 'likelihood') {
                const c = field === 'consequence' ? Number(value) : (h.consequence || 1);
                const l = field === 'likelihood' ? Number(value) : (h.likelihood || 1);
                (updated as any).riskScore = c * l;
                (updated as any).riskLevel = getWORiskLevel(c * l);
                (updated as any).signoffRequired = c * l >= 15;
            }
            // Auto-compute RESIDUAL risk score when residual consequence or likelihood changes
            if (field === 'residualConsequence' || field === 'residualLikelihood') {
                const rc = field === 'residualConsequence' ? Number(value) : ((h as any).residualConsequence || 1);
                const rl = field === 'residualLikelihood' ? Number(value) : ((h as any).residualLikelihood || 1);
                (updated as any).residualRiskScore = rc * rl;
                (updated as any).residualRiskLevel = getWORiskLevel(rc * rl);
            }
            return updated;
        });
        onUpdate({ jsa: { ...job.jsa!, hazards: newHazards } });
    };

    // --- AI Hazard Suggestions ---
    const handleAISuggest = async () => {
        setAiSuggesting(true);
        try {
            const result = await aiEngine.suggestJSAHazards({
                workDescription: job.description || job.title || '',
                assetName: (job as any).assetName || '',
                assetType: (job as any).assetType || '',
                workType: (job as any).workType || job.type,
                location: (job as any).locationName || '',
            });
            setAiSuggestions(result.hazards || []);
            if ((result.hazards || []).length === 0) {
                showToast('AI could not generate suggestions. Try editing the work description.', 'info');
            }
        } catch (e: any) {
            showToast('AI suggestion failed: ' + (e.message || 'Unknown error'), 'error');
        } finally {
            setAiSuggesting(false);
        }
    };

    const acceptSuggestion = (s: JSAHazardSuggestion) => {
        const newHazard: JobHazard = {
            id: `hz-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            hazard: s.hazard,
            consequence: s.consequence,
            likelihood: s.likelihood,
            riskScore: s.consequence * s.likelihood,
            riskLevel: getWORiskLevel(s.consequence * s.likelihood),
            controlHierarchy: s.controlHierarchy,
            controls: s.controls,
        };
        onUpdate({ jsa: { ...job.jsa!, hazards: [...(job.jsa!.hazards || []), newHazard] } });
        setAiSuggestions(prev => prev.filter(x => x !== s));
        showToast('Hazard accepted and added', 'success');
    };

    // --- JSA Template Library ---
    const handleSaveTemplate = () => {
        if (!templateName.trim()) return;
        const tpl = { name: templateName.trim(), hazards: (job.jsa!.hazards || []).map(h => ({ ...h, id: '' })) };
        const updated = [...savedTemplates.filter(t => t.name !== tpl.name), tpl];
        localStorage.setItem('jsa_templates', JSON.stringify(updated));
        setSavedTemplates(updated);
        setShowTemplateSave(false);
        setTemplateName('');
        showToast(`Template "${tpl.name}" saved`, 'success');
    };

    const handleLoadTemplate = (tpl: { name: string; hazards: any[] }) => {
        const newHazards = tpl.hazards.map(h => ({
            ...h,
            id: `hz-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            riskScore: (h.consequence || 1) * (h.likelihood || 1),
            riskLevel: getWORiskLevel((h.consequence || 1) * (h.likelihood || 1)),
        }));
        onUpdate({ jsa: { ...job.jsa!, hazards: [...(job.jsa!.hazards || []), ...newHazards], templateName: tpl.name } });
        setShowTemplatePicker(false);
        showToast(`Loaded ${newHazards.length} hazards from "${tpl.name}"`, 'success');
    };

    const handleDeleteTemplate = (name: string) => {
        const updated = savedTemplates.filter(t => t.name !== name);
        localStorage.setItem('jsa_templates', JSON.stringify(updated));
        setSavedTemplates(updated);
    };

    // --- Digital Signature ---
    const handleSignoff = (role: string, signatureDataUrl: string) => {
        const signoffs = [...(job.jsa!.signoffs || [])];
        const existingIdx = signoffs.findIndex(s => s.role === role);
        if (signatureDataUrl) {
            const entry = { userId: user?.id || '', role, signedAt: new Date().toISOString(), status: 'Signed' as const, signatureDataUrl };
            if (existingIdx >= 0) signoffs[existingIdx] = entry;
            else signoffs.push(entry);
        } else {
            if (existingIdx >= 0) signoffs[existingIdx] = { ...signoffs[existingIdx], status: 'Pending' as any, signatureDataUrl: '' };
        }
        onUpdate({ jsa: { ...job.jsa!, signoffs } });
    };

    const toggleControl = (id: string, control: string) => {
        const h = (job.jsa!.hazards || []).find(h => h.id === id);
        if (!h) return;
        const current = (h as any).controlHierarchy || [];
        const next = current.includes(control)
            ? current.filter((c: string) => c !== control)
            : [...current, control];
        updateHazard(id, 'controlHierarchy' as keyof JobHazard, next);
    };

    const deleteHazard = async (id: string) => {
        const ok = await confirm({
            title: 'Remove Hazard',
            message: 'This hazard entry and its risk assessment will be removed from the JSA.',
            variant: 'danger',
            confirmLabel: 'Remove',
        });
        if (ok) {
            onUpdate({ jsa: { ...job.jsa!, hazards: (job.jsa!.hazards || []).filter(h => h.id !== id) } });
        }
    };

    const handleCreatePermit = async () => {
        if (!job.jsa?.id || !user?.id) return;
        try {
            const db = DatabaseService.getInstance();
            const created = await db.createPermit(newPermit, job.jsa.id, user.id);
            if (created) {
                showToast(`Permit ${created.permitNumber} created`, 'success');
                setShowCreatePermit(false);
                setNewPermit({ permitType: 'GENERAL', description: job.description || '', ppeRequirements: [], safetyRequirements: [], environmentalConditions: '' });
                await loadPermits();
            }
        } catch (e: any) {
            showToast('Failed to create permit: ' + e.message, 'error');
        }
    };

    const handlePermitStatusChange = async (permitId: string, newStatus: string) => {
        if (!user?.id) return;
        try {
            const db = DatabaseService.getInstance();
            await db.updatePermitStatus(permitId, newStatus, user.id);
            showToast(`Permit status updated to ${getStatusDesc(newStatus)}`, 'success');
            await loadPermits();
        } catch (e: any) {
            showToast(e.message, 'error');
        }
    };

    const handleApprovalDecision = async (approvalId: string, decision: 'APPROVED' | 'REJECTED') => {
        if (!user?.id) return;
        const comments = decision === 'REJECTED' ? prompt('Reason for rejection:') : '';
        if (decision === 'REJECTED' && !comments) return;
        try {
            const db = DatabaseService.getInstance();
            await db.recordApprovalDecision(approvalId, decision, comments || '', user.id);
            showToast(`Approval ${decision.toLowerCase()}`, 'success');
            await loadPermits();
        } catch (e: any) {
            showToast(e.message, 'error');
        }
    };

    const handleIsolationAction = async (pointId: string, action: 'ISOLATED' | 'VERIFIED' | 'DE_ISOLATED') => {
        if (!user?.id) return;
        try {
            const db = DatabaseService.getInstance();
            await db.updateIsolationPointStatus(pointId, action, user.id);
            showToast(`Isolation point ${action.toLowerCase().replace('_', '-')}`, 'success');
            await loadPermits();
        } catch (e: any) {
            showToast(e.message, 'error');
        }
    };

    const handleReturnPermit = async (permitId: string) => {
        if (!user?.id) return;
        const notes = prompt('Return notes (de-isolation confirmed):');
        if (!notes) return;
        try {
            const db = DatabaseService.getInstance();
            await db.returnPermit(permitId, notes, user.id);
            showToast('Permit returned', 'success');
            await loadPermits();
        } catch (e: any) {
            showToast(e.message, 'error');
        }
    };

    const handleUpdatePermit = async (permitId: string, updates: any) => {
        try {
            const db = DatabaseService.getInstance();
            await db.updatePermit(permitId, updates);
            await loadPermits();
        } catch (e: any) {
            showToast(e.message, 'error');
        }
    };

    const togglePPE = (code: string) => {
        setNewPermit((prev: any) => ({
            ...prev,
            ppeRequirements: prev.ppeRequirements.includes(code)
                ? prev.ppeRequirements.filter((c: string) => c !== code)
                : [...prev.ppeRequirements, code]
        }));
    };

    const getStatusColor = (status: string) => {
        const colors: Record<string, string> = {
            'DRAFT': 'bg-slate-100 text-slate-700',
            'PENDING': 'bg-amber-100 text-amber-800',
            'APPROVED': 'bg-blue-100 text-blue-700',
            'ISSUED': 'bg-blue-100 text-blue-700',
            'ACTIVE': 'bg-green-100 text-green-700',
            'SUSPENDED': 'bg-red-100 text-red-700',
            'RETURNED': 'bg-blue-100 text-blue-700',
            'CLOSED': 'bg-slate-200 text-slate-600',
            'REJECTED': 'bg-red-200 text-red-800'
        };
        return colors[status] || 'bg-slate-100 text-slate-700';
    };

    const getPermitTypeColor = (type: string) => {
        const colors: Record<string, string> = {
            'HOT_WORK': 'border-red-400 bg-red-50',
            'CONFINED_SPACE': 'border-amber-400 bg-amber-50',
            'ELECTRICAL': 'border-yellow-400 bg-yellow-50',
            'HEIGHT': 'border-blue-400 bg-blue-50',
            'CHEMICAL': 'border-blue-400 bg-blue-50',
            'RADIATION': 'border-pink-400 bg-pink-50',
            'EXCAVATION': 'border-orange-400 bg-orange-50',
        };
        return colors[type] || 'border-slate-300 bg-white';
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* ? Hazard Matrix � 5�5 Risk Matrix (ISO 31000 / ISO 45001) */}
            <details open className="group">
                <summary className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex justify-between items-center cursor-pointer list-none">
                    <div className="flex items-center gap-3">
                        <Shield size={20} className="text-blue-600" />
                        <div>
                            <h3 className="font-bold text-slate-800">Job Safety Analysis (JSA)</h3>
                            <p className="text-xs text-slate-500">5�5 Risk Matrix � Hierarchy of Controls � ISO 31000 / ISO 45001</p>
                        </div>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{(job.jsa.hazards || []).length}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={(e) => { e.preventDefault(); handleAISuggest(); }}
                            disabled={aiSuggesting}
                            className="bg-gradient-to-r from-blue-500 to-blue-500 hover:from-blue-600 hover:to-blue-600 text-white px-3 py-1.5 rounded text-sm font-bold shadow-sm flex items-center gap-1.5 disabled:opacity-50 transition"
                        >
                            {aiSuggesting ? (
                                <><span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Analyzing...</>
                            ) : (
                                <>✨ AI Suggest</>
                            )}
                        </button>
                        <button onClick={(e) => { e.preventDefault(); setShowTemplatePicker(true); }} className="bg-white border border-slate-300 hover:border-blue-400 text-slate-700 px-3 py-1.5 rounded text-sm font-bold shadow-sm flex items-center gap-1 hover:bg-blue-50 transition">
                            📋 Load Template
                        </button>
                        {(job.jsa.hazards || []).length > 0 && (
                            <button onClick={(e) => { e.preventDefault(); setShowTemplateSave(true); }} className="text-slate-500 hover:text-blue-600 px-2 py-1.5 rounded text-sm flex items-center gap-1 hover:bg-blue-50 transition" title="Save current hazards as template">
                                💾 Save
                            </button>
                        )}
                        <button onClick={(e) => { e.preventDefault(); addHazard(); }} className="bg-primary-600 hover:bg-primary-500 text-white px-3 py-1.5 rounded text-sm font-bold shadow-sm flex items-center gap-1">
                            + Hazard
                        </button>
                    </div>
                </summary>

                <div className="mt-2 space-y-4">
                    {/* Template Save Modal */}
                    {showTemplateSave && (
                        <div className="bg-white border-2 border-blue-200 rounded-lg p-4 flex items-end gap-3 animate-in fade-in">
                            <div className="flex-1">
                                <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Save as JSA Template</label>
                                <input type="text" value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="e.g. Hot Work - Compressor, Confined Space Entry" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500" autoFocus />
                            </div>
                            <button onClick={handleSaveTemplate} disabled={!templateName.trim()} className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-primary-500 disabled:opacity-50 shadow-sm">Save</button>
                            <button onClick={() => { setShowTemplateSave(false); setTemplateName(''); }} className="px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 rounded-lg">Cancel</button>
                        </div>
                    )}

                    {/* Template Picker Modal */}
                    {showTemplatePicker && (
                        <div className="bg-white border-2 border-blue-200 rounded-lg p-4 space-y-3 animate-in fade-in">
                            <div className="flex justify-between items-center mb-1">
                                <h4 className="font-bold text-sm text-slate-800">📋 JSA Template Library</h4>
                                <button onClick={() => setShowTemplatePicker(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
                            </div>
                            {savedTemplates.length === 0 ? (
                                <p className="text-sm text-slate-400 text-center py-4">No saved templates yet. Build a JSA and click "💾 Save" to create one.</p>
                            ) : (
                                <div className="space-y-2">
                                    {savedTemplates.map(tpl => (
                                        <div key={tpl.name} className="flex items-center justify-between bg-slate-50 rounded-lg px-4 py-3 hover:bg-blue-50 transition group">
                                            <div>
                                                <p className="text-sm font-bold text-slate-800">{tpl.name}</p>
                                                <p className="text-[10px] text-slate-400">{tpl.hazards.length} hazard{tpl.hazards.length !== 1 ? 's' : ''}</p>
                                            </div>
                                            <div className="flex gap-2">
                                                <button onClick={() => handleLoadTemplate(tpl)} className="px-3 py-1 text-xs font-bold bg-blue-600 text-white rounded hover:bg-primary-500 shadow-sm">Load</button>
                                                <button onClick={() => handleDeleteTemplate(tpl.name)} className="text-xs text-slate-400 hover:text-red-500 px-2 py-1 rounded hover:bg-red-50">Delete</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* AI Suggestion Panel */}
                    {aiSuggestions.length > 0 && (
                        <div className="bg-gradient-to-br from-blue-50 to-blue-50 border-2 border-blue-200 rounded-lg p-4 space-y-3 animate-in fade-in">
                            <div className="flex justify-between items-center">
                                <h4 className="font-bold text-sm text-blue-800 flex items-center gap-2">✨ AI-Suggested Hazards <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-600">{aiSuggestions.length}</span></h4>
                                <button onClick={() => setAiSuggestions([])} className="text-xs text-slate-400 hover:text-slate-600">Dismiss All</button>
                            </div>
                            <p className="text-[10px] text-blue-600">⚠️ HITL: These are AI suggestions only. Review each hazard carefully before accepting.</p>
                            <div className="space-y-2">
                                {aiSuggestions.map((s, i) => {
                                    const sScore = s.consequence * s.likelihood;
                                    const sLevel = getWORiskLevel(sScore);
                                    return (
                                        <div key={i} className="bg-white rounded-lg p-3 border border-blue-200 flex gap-3">
                                            <div className="flex-1">
                                                <p className="text-sm font-bold text-slate-800">{s.hazard}</p>
                                                <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-500">
                                                    <span>C:{s.consequence} × L:{s.likelihood} = <strong className={sLevel === 'Critical' || sLevel === 'High' ? 'text-red-600' : sLevel === 'Medium' ? 'text-amber-600' : 'text-green-600'}>{sScore} {sLevel}</strong></span>
                                                    <span>Controls: {s.controlHierarchy.join(', ')}</span>
                                                </div>
                                                <p className="text-[10px] text-slate-400 mt-0.5 italic">{s.rationale}</p>
                                                {s.controls && <p className="text-[10px] text-slate-500 mt-1">💡 {s.controls}</p>}
                                            </div>
                                            <div className="flex flex-col gap-1">
                                                <button onClick={() => acceptSuggestion(s)} className="px-3 py-1 text-xs font-bold bg-green-600 text-white rounded hover:bg-green-700 shadow-sm">Accept</button>
                                                <button onClick={() => setAiSuggestions(prev => prev.filter(x => x !== s))} className="px-3 py-1 text-xs text-slate-400 hover:text-red-500 hover:bg-red-50 rounded">Dismiss</button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

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
                        {(job.jsa.hazards || []).map((h, idx) => {
                            const score = typeof h.riskScore === 'number' ? h.riskScore : ((h as any).consequence || 1) * ((h as any).likelihood || 1);
                            const level = (h as any).riskLevel || getWORiskLevel(typeof score === 'number' ? score : 1);
                            return (
                                <div key={h.id} className={`bg-white border-2 rounded-lg p-5 hover:shadow-md transition ${WO_RISK_COLORS[level] || 'border-slate-200'}`}>
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
                                                    placeholder="e.g. Working at height, confined space entry, H2S exposure..."
                                                    className="w-full p-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                                                />
                                            </div>

                                            {/* Risk Matrix Selectors */}
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                <div>
                                                    <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Consequence (1-5)</label>
                                                    <select
                                                        value={(h as any).consequence || 3}
                                                        onChange={(e) => updateHazard(h.id, 'consequence' as keyof JobHazard, Number(e.target.value))}
                                                        className="w-full p-2 border border-slate-300 rounded-lg text-sm"
                                                    >
                                                        {CONSEQUENCE_LABELS.map((label, i) => (
                                                            <option key={i} value={i + 1}>{i + 1} � {label}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Likelihood (1-5)</label>
                                                    <select
                                                        value={(h as any).likelihood || 3}
                                                        onChange={(e) => updateHazard(h.id, 'likelihood' as keyof JobHazard, Number(e.target.value))}
                                                        className="w-full p-2 border border-slate-300 rounded-lg text-sm"
                                                    >
                                                        {LIKELIHOOD_LABELS.map((label, i) => (
                                                            <option key={i} value={i + 1}>{i + 1} � {label}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Risk Score</label>
                                                    <div className={`flex items-center gap-2 p-2 rounded-lg border-2 font-bold text-lg ${WO_RISK_COLORS[level] || 'border-slate-300'}`}>
                                                        <span>{score}</span>
                                                        <span className="text-xs font-bold uppercase">{level}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Hierarchy of Controls (ISO 45001) */}
                                            <div>
                                                <label className="text-[10px] uppercase font-bold text-slate-500 mb-2 block">Hierarchy of Controls (ISO 45001)</label>
                                                <div className="flex flex-wrap gap-2">
                                                    {WO_CONTROL_HIERARCHY.map((ctrl, i) => {
                                                        const active = ((h as any).controlHierarchy || []).includes(ctrl);
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
                                                <p className="text-[10px] text-slate-400 mt-1">Most effective (1. Elimination) ? Least effective (5. PPE)</p>
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

                                            {/* ── RESIDUAL RISK (Post-Controls) ── */}
                                            <div className="bg-gradient-to-r from-blue-50 to-green-50 border border-blue-200 rounded-lg p-4">
                                                <label className="text-[10px] uppercase font-bold text-blue-600 mb-3 block flex items-center gap-1.5">↕ Residual Risk (Post-Controls)</label>
                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                    <div>
                                                        <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Residual Consequence</label>
                                                        <select
                                                            value={(h as any).residualConsequence || 1}
                                                            onChange={(e) => updateHazard(h.id, 'residualConsequence' as keyof JobHazard, Number(e.target.value))}
                                                            className="w-full p-2 border border-blue-200 rounded-lg text-sm bg-white"
                                                        >
                                                            {CONSEQUENCE_LABELS.map((label, i) => (
                                                                <option key={i} value={i + 1}>{i + 1} — {label}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Residual Likelihood</label>
                                                        <select
                                                            value={(h as any).residualLikelihood || 1}
                                                            onChange={(e) => updateHazard(h.id, 'residualLikelihood' as keyof JobHazard, Number(e.target.value))}
                                                            className="w-full p-2 border border-blue-200 rounded-lg text-sm bg-white"
                                                        >
                                                            {LIKELIHOOD_LABELS.map((label, i) => (
                                                                <option key={i} value={i + 1}>{i + 1} — {label}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Risk Reduction</label>
                                                        {(() => {
                                                            const residualScore = ((h as any).residualConsequence || 1) * ((h as any).residualLikelihood || 1);
                                                            const residualLevel = getWORiskLevel(residualScore);
                                                            const reduction = score > 0 ? Math.round(((score - residualScore) / score) * 100) : 0;
                                                            return (
                                                                <div className="flex items-center gap-2">
                                                                    <div className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border-2 font-bold text-sm ${WO_RISK_COLORS[level]}`}>
                                                                        {score}
                                                                    </div>
                                                                    <span className="text-lg text-slate-400">→</span>
                                                                    <div className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border-2 font-bold text-sm ${WO_RISK_COLORS[residualLevel]}`}>
                                                                        {residualScore}
                                                                    </div>
                                                                    {reduction > 0 && (
                                                                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${reduction >= 50 ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                                                                            ↓{reduction}%
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            );
                                                        })()}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Sign-off (mandatory for high risk) */}
                                            {(typeof score === 'number' ? score : 0) >= 15 && (
                                                <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-3">
                                                    <AlertTriangle size={16} className="text-red-600 flex-shrink-0" />
                                                    <div className="flex-1">
                                                        <p className="text-xs font-bold text-red-800">High-Risk: Mandatory Sign-Off Required</p>
                                                        <p className="text-[10px] text-red-600">This hazard requires engineering review and sign-off before work commences.</p>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="text"
                                                            value={(h as any).signoffBy || ''}
                                                            onChange={(e) => updateHazard(h.id, 'signoffBy' as keyof JobHazard, e.target.value)}
                                                            placeholder="Approved by..."
                                                            className="text-xs border border-red-300 rounded px-2 py-1 w-32"
                                                        />
                                                        {(h as any).signoffBy ? (
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
                                            <X size={16} />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                        {(job.jsa.hazards || []).length === 0 && (
                            <div className="p-8 text-center border border-dashed border-slate-200 rounded-lg bg-slate-50">
                                <AlertTriangle size={32} className="mx-auto mb-3 text-slate-300" />
                                <p className="text-slate-400 text-sm">No hazards identified yet. Click "+ Hazard" to start building the risk assessment.</p>
                            </div>
                        )}
                    </div>
                </div>
            </details>

            {/* ? Permit to Work */}
            <details open className="group">
                <summary className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex justify-between items-center cursor-pointer list-none">
                    <div className="flex items-center gap-3">
                        <FileText size={20} className="text-blue-600" />
                        <h3 className="font-bold text-slate-800">Permits to Work</h3>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{permits.length}</span>
                    </div>
                    <button onClick={(e) => { e.preventDefault(); if (!showCreatePermit) { setNewPermit((prev: any) => ({ ...prev, description: job.description || prev.description })); } setShowCreatePermit(!showCreatePermit); }} className="bg-primary-600 hover:bg-primary-500 text-white px-3 py-1.5 rounded text-sm font-bold shadow-sm">
                        + New Permit
                    </button>
                </summary>

                <div className="mt-2 space-y-3">
                    {/* Create Permit Form */}
                    {showCreatePermit && (
                        <div className="bg-white border-2 border-blue-200 rounded-lg p-5 space-y-4">
                            <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                                <FileText size={16} className="text-blue-600" /> New Permit Request
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Permit Type</label>
                                    <select
                                        value={newPermit.permitType}
                                        onChange={e => setNewPermit({ ...newPermit, permitType: e.target.value })}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-blue-500"
                                    >
                                        {permitTypes.map(pt => (
                                            <option key={pt.code} value={pt.code}>{pt.description}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Environmental Conditions</label>
                                    <input
                                        type="text"
                                        value={newPermit.environmentalConditions}
                                        onChange={e => setNewPermit({ ...newPermit, environmentalConditions: e.target.value })}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                                        placeholder="Weather, atmosphere, wind speed..."
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Scope of Work</label>
                                <textarea
                                    value={newPermit.description}
                                    onChange={e => setNewPermit({ ...newPermit, description: e.target.value })}
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                                    rows={2}
                                    placeholder="Describe the work to be performed..."
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">PPE Requirements</label>
                                <div className="flex flex-wrap gap-2">
                                    {ppeTypes.map(ppe => (
                                        <button
                                            key={ppe.code}
                                            onClick={() => togglePPE(ppe.code)}
                                            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${newPermit.ppeRequirements.includes(ppe.code)
                                                ? 'bg-blue-600 text-white border-blue-600'
                                                : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400'
                                                }`}
                                        >
                                            {ppe.description}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
                                <button onClick={() => setShowCreatePermit(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
                                <button
                                    onClick={handleCreatePermit}
                                    disabled={!newPermit.description}
                                    className="px-4 py-2 text-sm font-bold text-white bg-primary-600 hover:bg-primary-500 rounded-lg disabled:opacity-50 shadow-sm"
                                >
                                    Create Permit
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Permit Cards */}
                    {loadingPermits && <div className="text-center py-4 text-slate-400 text-sm">Loading permits...</div>}
                    {!loadingPermits && permits.length === 0 && !showCreatePermit && (
                        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-400 text-sm">
                            No permits created for this JSA. Click "+ New Permit" to start.
                        </div>
                    )}

                    {permits.map(permit => (
                        <div key={permit.id} className={`bg-white border-l-4 rounded-lg shadow-sm overflow-hidden ${getPermitTypeColor(permit.permitType)}`}>
                            {/* Permit Header */}
                            <div
                                className="p-4 flex justify-between items-center cursor-pointer hover:bg-slate-50/50 transition-colors"
                                onClick={() => setExpandedPermit(expandedPermit === permit.id ? null : permit.id)}
                            >
                                <div className="flex items-center gap-3">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-slate-800 text-sm">{permit.permitNumber}</span>
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${getStatusColor(permit.status)}`}>
                                                {getStatusDesc(permit.status)}
                                            </span>
                                        </div>
                                        <p className="text-xs text-slate-500 mt-0.5">{getPermitTypeDesc(permit.permitType)} � {permit.description?.substring(0, 80) || 'No description'}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {/* Status transition buttons */}
                                    {permit.status === 'DRAFT' && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handlePermitStatusChange(permit.id, 'PENDING'); }}
                                            className="px-3 py-1 text-xs font-bold bg-amber-500 text-white rounded hover:bg-amber-600 shadow-sm"
                                        >
                                            Submit for Approval
                                        </button>
                                    )}
                                    {permit.status === 'APPROVED' && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handlePermitStatusChange(permit.id, 'ISSUED'); }}
                                            className="px-3 py-1 text-xs font-bold bg-blue-600 text-white rounded hover:bg-primary-500 shadow-sm"
                                        >
                                            Issue Permit
                                        </button>
                                    )}
                                    {permit.status === 'ISSUED' && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handlePermitStatusChange(permit.id, 'ACTIVE'); }}
                                            className="px-3 py-1 text-xs font-bold bg-green-600 text-white rounded hover:bg-green-700 shadow-sm"
                                        >
                                            Start Work
                                        </button>
                                    )}
                                    {permit.status === 'ACTIVE' && (
                                        <>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleReturnPermit(permit.id); }}
                                                className="px-3 py-1 text-xs font-bold bg-blue-600 text-white rounded hover:bg-primary-500 shadow-sm"
                                            >
                                                Return Permit
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handlePermitStatusChange(permit.id, 'SUSPENDED'); }}
                                                className="px-3 py-1 text-xs font-bold bg-red-500 text-white rounded hover:bg-red-600 shadow-sm"
                                            >
                                                Suspend
                                            </button>
                                        </>
                                    )}
                                    {permit.status === 'RETURNED' && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handlePermitStatusChange(permit.id, 'CLOSED'); }}
                                            className="px-3 py-1 text-xs font-bold bg-slate-600 text-white rounded hover:bg-slate-700 shadow-sm"
                                        >
                                            Close Permit
                                        </button>
                                    )}
                                    <ChevronDown size={16} className={`text-slate-400 transition-transform ${expandedPermit === permit.id ? 'rotate-180' : ''}`} />
                                </div>
                            </div>

                            {/* Expanded Permit Detail */}
                            {expandedPermit === permit.id && (
                                <div className="border-t border-slate-200 divide-y divide-slate-100">
                                    {/* Permit Info */}
                                    <div className="p-4 bg-slate-50/30">
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                                            <div><span className="font-bold text-slate-500 uppercase block">Type</span>{getPermitTypeDesc(permit.permitType)}</div>
                                            <div><span className="font-bold text-slate-500 uppercase block">Validity Start</span>{permit.validityStart ? new Date(permit.validityStart).toLocaleString() : '�'}</div>
                                            <div><span className="font-bold text-slate-500 uppercase block">Validity End</span>{permit.validityEnd ? new Date(permit.validityEnd).toLocaleString() : '�'}</div>
                                            <div><span className="font-bold text-slate-500 uppercase block">Environment</span>{permit.environmentalConditions || '�'}</div>
                                        </div>
                                        {permit.ppeRequirements.length > 0 && (
                                            <div className="mt-3">
                                                <span className="font-bold text-slate-500 uppercase text-xs block mb-1">PPE Required</span>
                                                <div className="flex flex-wrap gap-1">
                                                    {permit.ppeRequirements.map((ppe: string) => (
                                                        <span key={ppe} className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-bold">{getPPEDesc(ppe)}</span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* ? Isolation Plan (LOTO) */}
                                    <div className="p-4">
                                        <div className="flex justify-between items-center mb-3">
                                            <h4 className="font-bold text-sm text-slate-700 flex items-center gap-2">
                                                <AlertTriangle size={14} className="text-amber-500" /> Isolation Plan (LOTO)
                                                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100">{permit.isolationPoints?.length || 0}</span>
                                            </h4>
                                        </div>
                                        {(permit.isolationPoints || []).length > 0 ? (
                                            <table className="min-w-full text-xs">
                                                <thead className="bg-slate-50">
                                                    <tr>
                                                        <th className="px-3 py-2 text-left font-bold text-slate-500 uppercase">Seq</th>
                                                        <th className="px-3 py-2 text-left font-bold text-slate-500 uppercase">Tag</th>
                                                        <th className="px-3 py-2 text-left font-bold text-slate-500 uppercase">Type</th>
                                                        <th className="px-3 py-2 text-left font-bold text-slate-500 uppercase">Method</th>
                                                        <th className="px-3 py-2 text-left font-bold text-slate-500 uppercase">Status</th>
                                                        <th className="px-3 py-2"></th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {permit.isolationPoints.map((pt: any) => (
                                                        <tr key={pt.id} className="hover:bg-slate-50">
                                                            <td className="px-3 py-2 text-slate-600">{pt.sequence}</td>
                                                            <td className="px-3 py-2 font-bold text-slate-800">{pt.tagNumber}</td>
                                                            <td className="px-3 py-2">{getIsolationTypeDesc(pt.isolationType)}</td>
                                                            <td className="px-3 py-2">{pt.method}</td>
                                                            <td className="px-3 py-2">
                                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${pt.status === 'VERIFIED' ? 'bg-green-100 text-green-700' :
                                                                    pt.status === 'ISOLATED' ? 'bg-amber-100 text-amber-700' :
                                                                        pt.status === 'DE_ISOLATED' ? 'bg-blue-100 text-blue-700' :
                                                                            'bg-slate-100 text-slate-600'
                                                                    }`}>{pt.status.replace('_', ' ')}</span>
                                                            </td>
                                                            <td className="px-3 py-2 text-right">
                                                                {pt.status === 'PENDING' && (
                                                                    <button onClick={() => handleIsolationAction(pt.id, 'ISOLATED')} className="text-amber-600 hover:text-amber-700 font-bold">Isolate</button>
                                                                )}
                                                                {pt.status === 'ISOLATED' && (
                                                                    <button onClick={() => handleIsolationAction(pt.id, 'VERIFIED')} className="text-green-600 hover:text-green-700 font-bold">Verify</button>
                                                                )}
                                                                {pt.status === 'VERIFIED' && permit.status === 'RETURNED' && (
                                                                    <button onClick={() => handleIsolationAction(pt.id, 'DE_ISOLATED')} className="text-blue-600 hover:text-blue-700 font-bold">De-Isolate</button>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        ) : (
                                            <p className="text-slate-400 text-sm text-center py-4">No isolation points defined.</p>
                                        )}
                                    </div>

                                    {/* ? Approval Workflow */}
                                    <div className="p-4">
                                        <h4 className="font-bold text-sm text-slate-700 flex items-center gap-2 mb-3">
                                            <CheckCircle size={14} className="text-green-500" /> Approval Workflow
                                        </h4>
                                        <div className="space-y-2">
                                            {(permit.approvals || []).sort((a: any, b: any) => a.sequence - b.sequence).map((app: any) => (
                                                <div key={app.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-4 py-3">
                                                    <div className="flex items-center gap-3">
                                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${app.decision === 'APPROVED' ? 'bg-green-100 text-green-700' :
                                                            app.decision === 'REJECTED' ? 'bg-red-100 text-red-700' :
                                                                'bg-slate-200 text-slate-500'
                                                            }`}>
                                                            {app.sequence}
                                                        </div>
                                                        <div>
                                                            <p className="text-sm font-bold text-slate-800">{app.role.replace(/_/g, ' ')}</p>
                                                            <p className="text-[10px] text-slate-500">
                                                                {app.decision === 'PENDING' ? 'Awaiting decision' :
                                                                    `${app.decision} ${app.decidedAt ? ' � ' + new Date(app.decidedAt).toLocaleString() : ''}`}
                                                            </p>
                                                            {app.comments && <p className="text-[10px] text-slate-400 italic mt-0.5">{app.comments}</p>}
                                                        </div>
                                                    </div>
                                                    {app.decision === 'PENDING' && permit.status === 'PENDING' && (
                                                        <div className="flex gap-2">
                                                            <button
                                                                onClick={() => handleApprovalDecision(app.id, 'APPROVED')}
                                                                className="px-3 py-1 text-xs font-bold bg-green-600 text-white rounded hover:bg-green-700"
                                                            >
                                                                Approve
                                                            </button>
                                                            <button
                                                                onClick={() => handleApprovalDecision(app.id, 'REJECTED')}
                                                                className="px-3 py-1 text-xs font-bold bg-red-500 text-white rounded hover:bg-red-600"
                                                            >
                                                                Reject
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                        {/* Auto-approve check */}
                                        {permit.status === 'PENDING' && (permit.approvals || []).every((a: any) => a.decision === 'APPROVED') && (
                                            <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg flex justify-between items-center">
                                                <p className="text-xs text-green-800 font-bold">? All approvals received</p>
                                                <button
                                                    onClick={() => handlePermitStatusChange(permit.id, 'APPROVED')}
                                                    className="px-3 py-1 text-xs font-bold bg-green-600 text-white rounded hover:bg-green-700 shadow-sm"
                                                >
                                                    Mark as Approved
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {/* ? Toolbox Talk / Issuance */}
                                    {(permit.status === 'APPROVED' || permit.status === 'ISSUED' || permit.status === 'ACTIVE') && (
                                        <div className="p-4">
                                            <h4 className="font-bold text-sm text-slate-700 flex items-center gap-2 mb-3">
                                                <UserIcon size={14} className="text-blue-500" /> Toolbox Talk & Issuance
                                            </h4>
                                            <div className="space-y-3">
                                                <div className="flex items-center gap-3">
                                                    <label className="flex items-center gap-2 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={permit.toolboxTalkCompleted}
                                                            onChange={(e) => handleUpdatePermit(permit.id, { toolboxTalkCompleted: e.target.checked })}
                                                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-primary-500"
                                                            disabled={permit.status !== 'APPROVED'}
                                                        />
                                                        <span className="text-sm font-bold text-slate-700">Toolbox Talk Completed</span>
                                                    </label>
                                                </div>
                                                <textarea
                                                    value={permit.toolboxTalkNotes || ''}
                                                    onChange={(e) => handleUpdatePermit(permit.id, { toolboxTalkNotes: e.target.value })}
                                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                                                    rows={2}
                                                    placeholder="Toolbox talk topics, attendees, safety briefing notes..."
                                                    disabled={permit.status !== 'APPROVED'}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* ? Return / Closure */}
                                    {(permit.status === 'RETURNED' || permit.status === 'CLOSED') && (
                                        <div className="p-4 bg-blue-50/30">
                                            <h4 className="font-bold text-sm text-slate-700 flex items-center gap-2 mb-3">
                                                <CheckCircle size={14} className="text-blue-500" /> Permit Return
                                            </h4>
                                            <div className="grid grid-cols-2 gap-4 text-xs">
                                                <div><span className="font-bold text-slate-500 uppercase block">Returned At</span>{permit.returnedAt ? new Date(permit.returnedAt).toLocaleString() : '�'}</div>
                                                <div><span className="font-bold text-slate-500 uppercase block">Return Notes</span>{permit.returnNotes || '�'}</div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </details>

            {/* ── DIGITAL SIGN-OFF ── */}
            <details open className="group">
                <summary className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex justify-between items-center cursor-pointer list-none">
                    <div className="flex items-center gap-3">
                        <PenTool size={20} className="text-blue-600" />
                        <h3 className="font-bold text-slate-800">Digital Sign-offs</h3>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                            {(job.jsa.signoffs || []).filter(s => s.status === 'Signed').length}/{['Worker', 'Supervisor', 'HSE Officer'].length}
                        </span>
                    </div>
                </summary>
                <div className="mt-2 bg-white border border-slate-200 rounded-lg p-5">
                    <p className="text-[10px] text-slate-500 uppercase font-bold mb-4">All personnel must sign below before commencing work</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {['Worker', 'Supervisor', 'HSE Officer'].map(role => {
                            const signoff = (job.jsa!.signoffs || []).find(s => s.role === role);
                            const isSigned = signoff?.status === 'Signed' && signoff?.signatureDataUrl;
                            return (
                                <div key={role} className={`rounded-lg border-2 p-4 transition ${isSigned ? 'border-green-300 bg-green-50/30' : 'border-slate-200'}`}>
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-bold text-slate-700">{role}</span>
                                        {isSigned && (
                                            <span className="flex items-center gap-1 text-[10px] text-green-600 font-bold">
                                                <CheckCircle size={12} /> Signed
                                            </span>
                                        )}
                                    </div>
                                    <SignaturePad
                                        label={isSigned ? undefined : `Sign as ${role}`}
                                        existingSignature={isSigned ? signoff?.signatureDataUrl : undefined}
                                        onCapture={(dataUrl) => handleSignoff(role, dataUrl)}
                                    />
                                    {isSigned && signoff?.signedAt && (
                                        <p className="text-[10px] text-slate-400 mt-1">{new Date(signoff.signedAt).toLocaleString()}</p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </details>

            <div className="bg-blue-50 p-3 rounded border border-blue-200 text-xs text-blue-800 flex gap-2">
                <Info size={16} />
                <p>Personnel must review and sign the JSA prior to commencing work. All permits require four-eyes approval.</p>
            </div>
        </div>
    );
};

const ResourcesTab: React.FC<{
    job: WorkOrder;
    users: any[];
    contacts: any[];
    onNavigateToTask: (taskId: string) => void;
    dictionaries: DictionaryEntry[];
}> = ({ job, users, contacts, onNavigateToTask, dictionaries }) => {

    // Craft role lookup helper
    const craftRoles = useMemo(() => dictionaries.filter(d => d.type === 'CONTACT_TYPE' && d.active), [dictionaries]);
    const getCraftLabel = (code: string) => craftRoles.find(r => r.code === code)?.description || code || 'Labour';

    // --- LABOR AGGREGATION (from tasks + standalone labor records) ---
    const labourSummary = useMemo(() => {
        const entries: { userId: string; userName: string; craft: string; taskName: string; taskId: string; estHours: number; actHours: number; estRate: number; actRate: number; isPlanning: boolean }[] = [];

        // 1. From task assignments (actual user assignments)
        (job.tasks || []).forEach(task => {
            (task.assignedUserIds || []).forEach(userId => {
                const u = users.find((us: any) => us.id === userId);
                const c = u ? contacts.find((co: any) => co.id === u.contactId) : null;
                entries.push({
                    userId,
                    userName: c?.name || u?.username || userId.substring(0, 8),
                    craft: c?.title || 'Technician',
                    taskName: task.description || `Task ${task.sequence}`,
                    taskId: task.id,
                    estHours: task.estHours || 0,
                    actHours: task.actualHours || 0,
                    estRate: 0,
                    actRate: 0,
                    isPlanning: false,
                });
            });
        });

        // 2. From standalone labor records (work_order_labor)
        (job.labor || []).forEach(l => {
            const c = l.contactId ? contacts.find((co: any) => co.id === l.contactId) : null;
            const taskRef = l.jobTaskId ? (job.tasks || []).find(t => t.id === l.jobTaskId) : null;
            const hasRealPerson = !!(l.contactId && c);
            entries.push({
                userId: l.contactId || l.id,
                userName: hasRealPerson ? (c!.name || `${(c as any)?.firstName || ''} ${(c as any)?.lastName || ''}`.trim() || l.contactId!.substring(0, 8)) : `${getCraftLabel(l.contactType)} (Unassigned)`,
                craft: hasRealPerson ? (c!.title || getCraftLabel(l.contactType)) : getCraftLabel(l.contactType),
                taskName: taskRef ? (taskRef.description || `Task ${taskRef.sequence}`) : 'General',
                taskId: l.jobTaskId || '',
                estHours: l.estDuration || 0,
                actHours: l.actualDuration || l.estDuration || 0,
                estRate: l.estRate || 0,
                actRate: l.actualRate || l.estRate || 0,
                isPlanning: !hasRealPerson,
            });
        });

        return entries;
    }, [job.tasks, job.labor, users, contacts, craftRoles]);

    // --- PARTS AGGREGATION ---
    const partsSummary = useMemo(() => {
        const inventory = job.inventory || [];
        return inventory.map(part => {
            const taskRef = part.jobTaskId ? (job.tasks || []).find(t => t.id === part.jobTaskId) : null;
            return {
                partId: part.id,
                description: part.description || 'Unknown Part',
                uom: part.uom || 'EA',
                estQty: part.estQty || 0,
                actQty: part.actualQty ?? part.estQty ?? 0,
                estUnitCost: part.estUnitCost || 0,
                actUnitCost: part.actualUnitCost ?? part.estUnitCost ?? 0,
                costCenter: part.costCenter || job.costCenter || '�',
                taskName: taskRef ? (taskRef.description || `Task ${taskRef.sequence}`) : 'Unassigned',
                taskId: part.jobTaskId || '',
            };
        });
    }, [job.tasks, job.inventory, job.costCenter]);

    // --- KPI CALCULATIONS ---
    const assignedPeople = labourSummary.filter(l => !l.isPlanning);
    const planningRoles = labourSummary.filter(l => l.isPlanning);
    const uniquePeople = new Set(assignedPeople.map(l => l.userId)).size;
    const unfilledRoles = planningRoles.length;
    const totalEstHours = labourSummary.reduce((s, l) => s + l.estHours, 0);
    const totalActHours = labourSummary.reduce((s, l) => s + l.actHours, 0);

    const totalEstLaborCost = labourSummary.reduce((s, l) => s + (l.estHours * l.estRate), 0);
    const totalActLaborCost = labourSummary.reduce((s, l) => s + (l.actHours * (l.actRate || l.estRate)), 0);

    const totalEstPartsCost = partsSummary.reduce((s, p) => s + (p.estQty * p.estUnitCost), 0);
    const totalActPartsCost = partsSummary.reduce((s, p) => s + (p.actQty * p.actUnitCost), 0);

    const totalEstCost = totalEstLaborCost + totalEstPartsCost;
    const totalActCost = totalActLaborCost + totalActPartsCost;
    const costVariance = totalEstCost > 0 ? ((totalActCost - totalEstCost) / totalEstCost * 100) : 0;

    // --- FINANCIAL DATA (merged from MetricsTab) ---
    const [allocations, setAllocations] = useState<CostAllocation[]>([]);
    const [warrantyCheck, setWarrantyCheck] = useState<WarrantyCheckResult | null>(null);
    const [anomaly, setAnomaly] = useState<CostAnomalyResult | null>(null);

    useEffect(() => {
        const loadFinancials = async () => {
            try {
                const results = await Promise.all([
                    FinOpsService.getCostAllocations(job.id),
                    job.assetId ? FinOpsService.checkWarrantyStatus(job.assetId) : Promise.resolve(null),
                    job.assetId ? FinOpsService.detectCostAnomaly(job.assetId, job.type, totalEstCost) : Promise.resolve(null),
                ]);
                setAllocations(results[0]);
                setWarrantyCheck(results[1]);
                setAnomaly(results[2]);
            } catch (error) {
                console.error("Failed to load financial metrics", error);
            }
        };
        if (job.id) loadFinancials();
    }, [job.id, job.assetId, totalEstCost]);

    // --- GROUPING ---
    const labourByPerson = useMemo(() => {
        const map = new Map<string, typeof labourSummary>();
        labourSummary.forEach(entry => {
            const existing = map.get(entry.userId) || [];
            existing.push(entry);
            map.set(entry.userId, existing);
        });
        return Array.from(map.entries());
    }, [labourSummary]);

    const partsByTask = useMemo(() => {
        const map = new Map<string, typeof partsSummary>();
        partsSummary.forEach(entry => {
            const key = entry.taskId || '__unassigned__';
            const existing = map.get(key) || [];
            existing.push(entry);
            map.set(key, existing);
        });
        return Array.from(map.entries());
    }, [partsSummary]);

    // Progress bar helper
    const ProgressBar = ({ planned, actual, color }: { planned: number; actual: number; color: string }) => {
        const pct = planned > 0 ? Math.min((actual / planned) * 100, 150) : 0;
        const over = pct > 100;
        return (
            <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                <div
                    className={`h-full rounded-full transition-all duration-500 ${over ? 'bg-red-500' : color}`}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                />
            </div>
        );
    };

    const fmtCost = (n: number) => n > 0 ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '$0';

    return (
        <div className="space-y-3 md:space-y-4 animate-in fade-in duration-300">
            {/* KPI Stats Header */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-3">
                <div className="bg-gradient-to-br from-blue-50 to-blue-50 border border-blue-100 rounded-lg p-3 text-center">
                    <div className="text-xl md:text-2xl font-black text-blue-700">{uniquePeople}{unfilledRoles > 0 && <span className="text-xs font-medium text-amber-500 ml-1">+{unfilledRoles} open</span>}</div>
                    <div className="text-[10px] text-blue-500 font-bold uppercase mt-0.5">Assigned</div>
                </div>
                <div className="bg-gradient-to-br from-emerald-50 to-green-50 border border-emerald-100 rounded-lg p-3 text-center">
                    <div className="text-xl md:text-2xl font-black text-emerald-700">{totalActHours.toFixed(1)}<span className="text-xs font-medium text-emerald-400">/{totalEstHours.toFixed(1)}</span></div>
                    <div className="text-[10px] text-emerald-500 font-bold uppercase mt-0.5">Act / Plan Hrs</div>
                </div>
                <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-100 rounded-lg p-3 text-center">
                    <div className="text-xl md:text-2xl font-black text-amber-700">{partsSummary.length}</div>
                    <div className="text-[10px] text-amber-500 font-bold uppercase mt-0.5">Part Lines</div>
                </div>
                <div className={`bg-gradient-to-br border rounded-lg p-3 text-center ${costVariance > 10 ? 'from-red-50 to-red-50 border-red-200' : costVariance > 0 ? 'from-amber-50 to-yellow-50 border-amber-100' : 'from-slate-50 to-slate-50 border-slate-200'}`}>
                    <div className={`text-xl md:text-2xl font-black ${costVariance > 10 ? 'text-red-700' : costVariance > 0 ? 'text-amber-700' : 'text-slate-700'}`}>
                        {fmtCost(totalActCost)}
                    </div>
                    <div className="text-[10px] font-bold uppercase mt-0.5">
                        <span className={costVariance > 10 ? 'text-red-500' : costVariance > 0 ? 'text-amber-500' : 'text-slate-500'}>
                            Total Actual {costVariance !== 0 && `(${costVariance > 0 ? '+' : ''}${costVariance.toFixed(0)}%)`}
                        </span>
                    </div>
                </div>
            </div>

            {/* Labor Summary Table */}
            <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
                <div className="px-3 py-2.5 md:px-4 md:py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2 text-xs md:text-sm">
                        <Users size={14} className="text-blue-600" /> Labor Summary
                    </h3>
                    <span className="text-[10px] text-slate-400 font-medium">{uniquePeople} {uniquePeople === 1 ? 'person' : 'people'} � {totalEstHours.toFixed(1)}h planned</span>
                </div>
                {labourByPerson.length === 0 ? (
                    <div className="p-6 text-center text-slate-400 text-xs">
                        <Users size={28} className="mx-auto mb-2 opacity-20" />
                        No labour assigned. Assign people to tasks in the <strong>Tasks</strong> tab.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="text-[10px] text-slate-400 uppercase font-bold border-b border-slate-100">
                                    <th className="text-left px-3 py-2">Person</th>
                                    <th className="text-left px-2 py-2 hidden sm:table-cell">Craft</th>
                                    <th className="text-left px-2 py-2 hidden md:table-cell">Task</th>
                                    <th className="text-right px-2 py-2 w-16">Plan H</th>
                                    <th className="text-right px-2 py-2 w-16">Act. H</th>
                                    <th className="text-right px-2 py-2 w-20 hidden sm:table-cell">Plan $</th>
                                    <th className="text-right px-3 py-2 w-20 hidden sm:table-cell">Act. $</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {labourByPerson.map(([userId, entries]) => (
                                    <React.Fragment key={userId}>
                                        {entries.map((entry, i) => (
                                            <tr key={`${userId}-${i}`} className={`hover:bg-slate-50/50 transition ${entry.isPlanning ? 'bg-amber-50/30' : ''}`}>
                                                {i === 0 && (
                                                    <td className="px-3 py-2 align-top" rowSpan={entries.length}>
                                                        <div className="flex items-center gap-2">
                                                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-bold shadow-sm flex-shrink-0 ${entry.isPlanning ? 'bg-amber-100 text-amber-600 border-2 border-dashed border-amber-300' : 'bg-gradient-to-br from-blue-500 to-blue-600 text-white'}`}>
                                                                {entry.isPlanning ? '?' : entry.userName.substring(0, 2).toUpperCase()}
                                                            </div>
                                                            <span className={`truncate max-w-[120px] ${entry.isPlanning ? 'text-amber-700 italic text-[11px] font-medium' : 'font-semibold text-slate-800'}`}>{entry.userName}</span>
                                                        </div>
                                                    </td>
                                                )}
                                                <td className="px-2 py-2 text-slate-500 hidden sm:table-cell">{entry.craft}</td>
                                                <td className="px-2 py-2 hidden md:table-cell">
                                                    {entry.taskId ? (
                                                        <button
                                                            onClick={() => onNavigateToTask(entry.taskId)}
                                                            className="text-[10px] text-blue-600 hover:text-blue-800 hover:underline truncate max-w-[140px] block"
                                                        >
                                                            {entry.taskName}
                                                        </button>
                                                    ) : (
                                                        <span className="text-slate-400 italic">{entry.taskName}</span>
                                                    )}
                                                </td>
                                                <td className="px-2 py-2 text-right font-medium text-slate-600">{entry.estHours.toFixed(1)}</td>
                                                <td className={`px-2 py-2 text-right font-bold ${entry.actHours > entry.estHours ? 'text-red-600' : 'text-emerald-600'}`}>
                                                    {entry.actHours.toFixed(1)}
                                                </td>
                                                <td className="px-2 py-2 text-right text-slate-500 hidden sm:table-cell">
                                                    {fmtCost(entry.estHours * entry.estRate)}
                                                </td>
                                                <td className={`px-3 py-2 text-right font-medium hidden sm:table-cell ${(entry.actHours * (entry.actRate || entry.estRate)) > (entry.estHours * entry.estRate) ? 'text-red-600' : 'text-slate-700'}`}>
                                                    {fmtCost(entry.actHours * (entry.actRate || entry.estRate))}
                                                </td>
                                            </tr>
                                        ))}
                                    </React.Fragment>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="border-t border-slate-200 bg-slate-50/50 font-bold text-[11px]">
                                    <td className="px-3 py-2 text-slate-500 uppercase" colSpan={1}>Total</td>
                                    <td className="hidden sm:table-cell"></td>
                                    <td className="hidden md:table-cell"></td>
                                    <td className="px-2 py-2 text-right text-slate-600">{totalEstHours.toFixed(1)}</td>
                                    <td className={`px-2 py-2 text-right ${totalActHours > totalEstHours ? 'text-red-600' : 'text-emerald-600'}`}>{totalActHours.toFixed(1)}</td>
                                    <td className="px-2 py-2 text-right text-slate-600 hidden sm:table-cell">{fmtCost(totalEstLaborCost)}</td>
                                    <td className={`px-3 py-2 text-right hidden sm:table-cell ${totalActLaborCost > totalEstLaborCost ? 'text-red-600' : 'text-slate-700'}`}>{fmtCost(totalActLaborCost)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}
            </div>

            {/* Parts & Materials Table */}
            <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
                <div className="px-3 py-2.5 md:px-4 md:py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2 text-xs md:text-sm">
                        <Package size={14} className="text-amber-600" /> Parts & Materials
                    </h3>
                    <span className="text-[10px] text-slate-400 font-medium">{partsSummary.length} {partsSummary.length === 1 ? 'item' : 'items'}</span>
                </div>
                {partsSummary.length === 0 ? (
                    <div className="p-6 text-center text-slate-400 text-xs">
                        <Package size={28} className="mx-auto mb-2 opacity-20" />
                        No parts required. Add parts to tasks in the <strong>Tasks</strong> tab.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="text-[10px] text-slate-400 uppercase font-bold border-b border-slate-100">
                                    <th className="text-left px-3 py-2">Part</th>
                                    <th className="text-center px-2 py-2 w-12">UOM</th>
                                    <th className="text-left px-2 py-2 hidden md:table-cell">Task</th>
                                    <th className="text-right px-2 py-2 w-14">Plan Q</th>
                                    <th className="text-right px-2 py-2 w-14">Act. Q</th>
                                    <th className="text-right px-2 py-2 w-20 hidden sm:table-cell">Plan $</th>
                                    <th className="text-right px-3 py-2 w-20 hidden sm:table-cell">Act. $</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {partsByTask.map(([taskKey, parts]) => (
                                    <React.Fragment key={taskKey}>
                                        {parts.map((part, i) => (
                                            <tr key={part.partId} className="hover:bg-slate-50/50 transition">
                                                <td className="px-3 py-2 text-slate-700 font-medium truncate max-w-[160px]">{part.description}</td>
                                                <td className="px-2 py-2 text-center">
                                                    <span className="text-[9px] bg-slate-100 text-slate-500 px-1 py-0.5 rounded">{part.uom}</span>
                                                </td>
                                                <td className="px-2 py-2 hidden md:table-cell">
                                                    {part.taskId ? (
                                                        <button
                                                            onClick={() => onNavigateToTask(part.taskId)}
                                                            className="text-[10px] text-blue-600 hover:text-blue-800 hover:underline truncate max-w-[120px] block"
                                                        >
                                                            {part.taskName}
                                                        </button>
                                                    ) : (
                                                        <span className="text-slate-400 italic text-[10px]">Unassigned</span>
                                                    )}
                                                </td>
                                                <td className="px-2 py-2 text-right font-medium text-slate-600">{part.estQty}</td>
                                                <td className={`px-2 py-2 text-right font-bold ${part.actQty > part.estQty ? 'text-red-600' : 'text-emerald-600'}`}>
                                                    {part.actQty}
                                                </td>
                                                <td className="px-2 py-2 text-right text-slate-500 hidden sm:table-cell">
                                                    {fmtCost(part.estQty * part.estUnitCost)}
                                                </td>
                                                <td className={`px-3 py-2 text-right font-medium hidden sm:table-cell ${(part.actQty * part.actUnitCost) > (part.estQty * part.estUnitCost) ? 'text-red-600' : 'text-slate-700'}`}>
                                                    {fmtCost(part.actQty * part.actUnitCost)}
                                                </td>
                                            </tr>
                                        ))}
                                    </React.Fragment>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="border-t border-slate-200 bg-slate-50/50 font-bold text-[11px]">
                                    <td className="px-3 py-2 text-slate-500 uppercase">Total</td>
                                    <td></td>
                                    <td className="hidden md:table-cell"></td>
                                    <td className="px-2 py-2 text-right text-slate-600">{partsSummary.reduce((s, p) => s + p.estQty, 0)}</td>
                                    <td className="px-2 py-2 text-right text-emerald-600">{partsSummary.reduce((s, p) => s + p.actQty, 0)}</td>
                                    <td className="px-2 py-2 text-right text-slate-600 hidden sm:table-cell">{fmtCost(totalEstPartsCost)}</td>
                                    <td className={`px-3 py-2 text-right hidden sm:table-cell ${totalActPartsCost > totalEstPartsCost ? 'text-red-600' : 'text-slate-700'}`}>{fmtCost(totalActPartsCost)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}
            </div>

            {/* Cost Roll-Up Card */}
            <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
                <div className="px-3 py-2.5 md:px-4 md:py-3 bg-slate-50 border-b border-slate-200">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2 text-xs md:text-sm">
                        <DollarSign size={14} className="text-green-600" /> Cost Roll-Up
                    </h3>
                </div>
                <div className="p-3 md:p-4 space-y-3">
                    {/* Labor Cost Bar */}
                    <div>
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-[10px] font-bold text-slate-500 uppercase">Labor</span>
                            <span className="text-[10px] text-slate-500">
                                {fmtCost(totalActLaborCost)} / {fmtCost(totalEstLaborCost)}
                            </span>
                        </div>
                        <ProgressBar planned={totalEstLaborCost} actual={totalActLaborCost} color="bg-blue-500" />
                    </div>

                    {/* Material Cost Bar */}
                    <div>
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-[10px] font-bold text-slate-500 uppercase">Materials</span>
                            <span className="text-[10px] text-slate-500">
                                {fmtCost(totalActPartsCost)} / {fmtCost(totalEstPartsCost)}
                            </span>
                        </div>
                        <ProgressBar planned={totalEstPartsCost} actual={totalActPartsCost} color="bg-amber-500" />
                    </div>

                    {/* Total */}
                    <div className="pt-2 border-t border-slate-100">
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-xs font-bold text-slate-700 uppercase">Total</span>
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-800">{fmtCost(totalActCost)} / {fmtCost(totalEstCost)}</span>
                                {costVariance !== 0 && (
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${costVariance > 10 ? 'bg-red-100 text-red-700' : costVariance > 0 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                                        {costVariance > 0 ? '+' : ''}{costVariance.toFixed(0)}%
                                    </span>
                                )}
                            </div>
                        </div>
                        <ProgressBar planned={totalEstCost} actual={totalActCost} color="bg-emerald-500" />
                    </div>

                    {/* Project Budget Envelope (only for PROJECT scope) */}
                    {(job as any).scope === 'PROJECT' && (
                        <div className="mt-3 pt-3 border-t border-dashed border-slate-200">
                            <div className="flex items-center gap-2 mb-2">
                                <Briefcase size={13} className="text-blue-500" />
                                <span className="text-[10px] font-bold text-blue-600 uppercase">Project Budget Envelope</span>
                            </div>
                            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
                                <div className="flex justify-between items-center mb-1">
                                    <span className="text-[10px] text-blue-500">Approved Budget</span>
                                    <span className="text-xs font-bold text-blue-700">{fmtCost((job as any).budgetApproved || 0)}</span>
                                </div>
                                <div className="flex justify-between items-center mb-1.5">
                                    <span className="text-[10px] text-blue-500">Spent to Date</span>
                                    <span className="text-xs font-bold text-blue-700">{fmtCost(totalActCost)}</span>
                                </div>
                                <ProgressBar
                                    planned={(job as any).budgetApproved || totalEstCost || 1}
                                    actual={totalActCost}
                                    color="bg-blue-500"
                                />
                                <div className="flex justify-between items-center mt-1">
                                    <span className="text-[10px] text-blue-400">
                                        {(((job as any).budgetApproved || totalEstCost) > 0
                                            ? (totalActCost / ((job as any).budgetApproved || totalEstCost) * 100).toFixed(0)
                                            : 0)}% consumed
                                    </span>
                                    <span className="text-[10px] font-medium text-blue-600">
                                        {fmtCost(((job as any).budgetApproved || totalEstCost) - totalActCost)} remaining
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Financial Intelligence (merged from Metrics) */}
            <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
                <div className="px-3 py-2.5 md:px-4 md:py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2 text-xs md:text-sm">
                        <BarChart3 size={14} className="text-blue-600" /> Financial Performance
                    </h3>
                    {job.status === 'CLOSED' && (
                        <span className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-bold flex items-center gap-1">
                            <Lock size={10} /> Costs Frozen
                        </span>
                    )}
                </div>
                <div className="p-3 md:p-4 space-y-3">
                    {/* Alerts Row */}
                    {(anomaly?.isAnomaly || warrantyCheck?.underWarranty) && (
                        <div className="space-y-2">
                            {anomaly?.isAnomaly && (
                                <div className={`p-2.5 rounded border flex items-start gap-2 text-xs ${anomaly.severity === 'HIGH' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                                    <TrendingUp size={14} className="mt-0.5 shrink-0" />
                                    <div>
                                        <span className="font-bold block uppercase text-[10px] mb-0.5">Cost Anomaly Detected</span>
                                        <p>{anomaly.message}</p>
                                    </div>
                                </div>
                            )}
                            {warrantyCheck?.underWarranty && (
                                <div className="bg-green-50 border border-green-200 p-2.5 rounded flex items-start gap-2 text-xs text-green-800">
                                    <ShieldCheck size={14} className="mt-0.5 shrink-0" />
                                    <div>
                                        <span className="font-bold block uppercase text-[10px] mb-0.5">Asset Under Warranty</span>
                                        <p>{warrantyCheck.message}</p>
                                        <div className="mt-1 text-[11px] bg-white border border-green-200 p-1.5 rounded">
                                            Policy: {warrantyCheck.warranty?.warrantyType} (Ends: {warrantyCheck.warranty?.endDate})
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Budget Consumption */}
                    <div>
                        <div className="flex justify-between text-xs mb-1">
                            <span className="font-medium text-slate-700">Budget Consumption</span>
                            <span className={`font-bold ${(totalEstCost > 0 ? (totalActCost / totalEstCost * 100) : 0) > 100 ? 'text-red-600' : 'text-green-600'}`}>
                                {totalEstCost > 0 ? (totalActCost / totalEstCost * 100).toFixed(0) : 0}%
                            </span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-2.5">
                            <div className={`h-2.5 rounded-full transition-all duration-500 ${totalActCost > totalEstCost ? 'bg-red-500' : 'bg-green-600'}`} style={{ width: `${Math.min(100, totalEstCost > 0 ? (totalActCost / totalEstCost * 100) : 0)}%` }}></div>
                        </div>
                        <div className="flex justify-between text-[11px] text-slate-500 mt-1">
                            <span>Actual: {fmtCost(totalActCost)}</span>
                            <span>Est: {fmtCost(totalEstCost)}</span>
                        </div>
                    </div>

                    {/* Cost Centre Allocations */}
                    {allocations.length > 0 && (
                        <div className="pt-2 border-t border-slate-100">
                            <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-1.5">Cost Centre Allocations</h4>
                            <div className="text-xs border border-slate-200 rounded overflow-hidden">
                                <table className="w-full text-left">
                                    <thead className="bg-slate-50 font-bold text-slate-600">
                                        <tr>
                                            <th className="p-2 border-b">Type</th>
                                            <th className="p-2 border-b">Cost Centre</th>
                                            <th className="p-2 border-b text-right">Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {allocations.map(a => (
                                            <tr key={a.id} className="border-b last:border-0 hover:bg-slate-50">
                                                <td className="p-2">{a.costType}</td>
                                                <td className="p-2 font-mono">{a.costCenterId || '-'}</td>
                                                <td className="p-2 text-right">${a.amount.toFixed(2)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Info Notice */}
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 flex items-start gap-2">
                <Info size={14} className="text-blue-500 mt-0.5 shrink-0" />
                <div className="text-[10px] text-blue-700">
                    <strong>Resource management is task-based.</strong> To add or edit labour assignments and parts, go to the <strong>Tasks</strong> tab and expand a task.
                    This view provides a consolidated summary across all tasks.
                </div>
            </div>
        </div>
    );
};





const PMList: React.FC<{ pms: any[], dictionaries: DictionaryEntry[], assets: any[], onCreate: () => void, onRefresh?: () => void, canCreate?: boolean, canDelete?: boolean, workOrders?: WorkOrder[] }> = ({ pms, dictionaries, assets, onCreate, onRefresh, canCreate = true, canDelete = true, workOrders = [] }) => {
    const navigate = useNavigate();
    const { showToast } = useToast();
    const confirm = useConfirm();
    const { openRelantern } = useRelantern();
    const [generating, setGenerating] = useState<string | null>(null);

    // SMRP 5.4.13 — PM & PdM Effectiveness (overall + per-PM).
    const pmEff = useMemo(() => computePMEffectiveness(workOrders), [workOrders]);

    // Ask the Reliability Specialist to advise which PMs to reduce/eliminate, off
    // the actual KPI results (low effectiveness or no findings = candidates).
    const handleOptimizePMs = () => {
        const lowValue = pms.filter(pm => { const e = pmEff.byPM[pm.id]; return e && e.written >= 2 && (e.pct ?? 100) < 50; });
        const noFindings = pms.filter(pm => !pmEff.byPM[pm.id]);
        const kpiBlock = kpisToAIContext([pmEffectivenessKpi(pmEff)]);
        const context = [
            `PM/PdM PROGRAM OPTIMISATION`,
            kpiBlock,
            `Active strategies: ${pms.length}.`,
            lowValue.length ? `Low-effectiveness PMs (generate corrective work that's mostly unnecessary): ${lowValue.slice(0, 10).map(p => `${p.description || p.title} [${pmEff.byPM[p.id].pct}%]`).join('; ')}.` : `No clearly low-effectiveness PMs.`,
            noFindings.length ? `PMs generating NO corrective work (possible over-maintenance — review against the failure mode): ${noFindings.slice(0, 12).map(p => `${p.description || p.title} (${p.frequency_interval || ''} ${p.frequency_unit || ''})`).join('; ')}.` : '',
        ].filter(Boolean).join('\n');
        const prompt = `As a reliability engineer applying RCM, advise on this PM/PdM programme. Be specific and concise:\n1. Which PMs add little value (low effectiveness, or consuming resources without catching defects) and should be REDUCED in frequency or ELIMINATED — and why.\n2. Which "no findings" PMs are genuinely protective vs over-maintenance (consider the failure mode, criticality, and P-F interval).\n3. Where PdM/condition-based tasks should replace fixed-interval PMs.\nGive a short prioritised action list the planner can execute.`;
        openRelantern(context, 'workOrder', prompt);
    };

    const getAssetLabel = (assetId: string | null | undefined) => {
        if (!assetId) return '-';
        const asset = assets.find((a: any) => a.id === assetId);
        if (asset) return `${asset.tag || ''} — ${asset.name || ''}`.replace(/^ — |— $/, '').trim() || assetId.substring(0, 8);
        return assetId.substring(0, 8) + '…';
    };

    const handleRowClick = (pmId: string) => {
        navigate('/recurring-work');
    };

    const handleGenerate = async (pmId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const ok = await confirm({
            title: 'Generate Work Order',
            message: 'A new Work Order will be generated from this maintenance strategy.',
            variant: 'info',
            confirmLabel: 'Generate',
        });
        if (ok) {
            setGenerating(pmId);
            try {
                await DatabaseService.getInstance().generateWOFromPM(pmId);
                showToast('Work Order generated successfully', 'success');
                onRefresh?.();
            } catch (err: any) {
                console.error(err);
                showToast('Failed to generate WO: ' + err.message, 'error');
            } finally {
                setGenerating(null);
            }
        }
    };

    const handleDelete = async (pmId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        // ═══ RBAC Layer 2: Submit-level guard ═══
        if (!canDelete) {
            console.warn('[RBAC-AUDIT] BLOCKED: workOrders.pmDelete attempt by unauthorized user');
            showToast('Access Denied: You do not have permission to delete strategies.', 'error');
            return;
        }
        const ok = await confirm({
            title: 'Delete Strategy',
            message: 'This maintenance strategy will be permanently deleted. This action cannot be undone.',
            variant: 'danger',
            confirmLabel: 'Delete',
        });
        if (ok) {
            try {
                await DatabaseService.getInstance().deletePM(pmId);
                showToast('Strategy deleted', 'success');
                onRefresh?.();
            } catch (err: any) {
                showToast('Failed to delete: ' + err.message, 'error');
            }
        }
    };

    // Determine status display: DB uses 'status' field (ACTIVE/PAUSED/DRAFT) and 'active' boolean
    const getStatusDisplay = (pm: any) => {
        const status = (pm.status || '').toUpperCase();
        if (status === 'ACTIVE' || pm.active === true) return { label: 'ACTIVE', classes: 'bg-green-100 text-green-700' };
        if (status === 'PAUSED') return { label: 'PAUSED', classes: 'bg-amber-100 text-amber-700' };
        if (status === 'DRAFT') return { label: 'DRAFT', classes: 'bg-slate-100 text-slate-500' };
        return { label: status || 'INACTIVE', classes: 'bg-slate-100 text-slate-500' };
    };

    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden animate-in fade-in duration-500 h-full flex flex-col">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center shrink-0">
                <div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="font-bold text-slate-800">Recurring Maintenance Strategies</h2>
                        {pmEff.overall.written > 0 && (
                            <span
                                title="PM & PdM Effectiveness = necessary ÷ written PM/PdM corrective work orders. Higher = PM/PdM is catching real defects."
                                className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${(pmEff.overall.pct ?? 0) >= 70 ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : (pmEff.overall.pct ?? 0) >= 40 ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-red-100 text-red-700 border-red-200'}`}
                            >
                                PM/PdM Effectiveness {pmEff.overall.pct}% ({pmEff.overall.necessary}/{pmEff.overall.written})
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-slate-500">Manage PM intervals, templates, and auto-generation rules.</p>
                </div>
                <div className="flex gap-2">
                    <button onClick={handleOptimizePMs} className="border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2" title="Ask the Reliability Specialist which PMs to optimise or eliminate">
                        <Sparkles size={16} /> Optimise PMs
                    </button>
                    <button onClick={() => navigate('/recurring-work')} className="border border-slate-300 hover:bg-slate-50 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
                        <Repeat size={16} /> Full Manager
                    </button>
                    <button onClick={onCreate} disabled={!canCreate} className={`bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${!canCreate ? 'opacity-50 cursor-not-allowed' : 'hover:bg-primary-500'}`} title={!canCreate ? 'Insufficient permissions' : 'Create new strategy'}>
                        <Plus size={18} /> New Strategy
                    </button>
                </div>
            </div>

            <div className="overflow-auto flex-1">
                <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50 sticky top-0 z-10">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">PM Title</th>
                            <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Asset</th>
                            <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Frequency</th>
                            <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Next Due</th>
                            <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider" title="PM & PdM Effectiveness — necessary ÷ written PM/PdM corrective work orders">Effectiveness</th>
                            <th className="px-6 py-3 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-200">
                        {pms.map((pm) => {
                            const isOverdue = pm.next_due_date && new Date(pm.next_due_date) < new Date();
                            const statusInfo = getStatusDisplay(pm);
                            return (
                                <tr key={pm.id} onClick={() => handleRowClick(pm.id)} className="hover:bg-slate-50 transition-colors cursor-pointer">
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="text-sm font-bold text-slate-900">{pm.description || pm.title}</div>
                                        <div className="text-xs text-slate-500 font-mono">{pm.code || pm.id?.substring(0, 8)}</div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                                        {getAssetLabel(pm.asset_id)}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-700">
                                        {pm.frequency_interval} {pm.frequency_unit}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                                        {pm.next_due_date ? (
                                            <span className={`font-medium ${isOverdue ? 'text-red-600' : 'text-slate-600'}`}>
                                                {isOverdue && <AlertTriangle size={12} className="inline mr-1 -mt-0.5" />}
                                                {new Date(pm.next_due_date).toLocaleDateString()}
                                            </span>
                                        ) : '-'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <span className={`px-2 py-1 text-xs font-bold rounded-full ${statusInfo.classes}`}>
                                            {statusInfo.label}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        {(() => {
                                            const e = pmEff.byPM[pm.id];
                                            if (!e || e.written === 0) {
                                                return <span className="text-[11px] text-slate-400 italic" title="No corrective work generated from this PM — either protective, or possible over-maintenance. Use Optimise PMs.">No findings</span>;
                                            }
                                            const pct = e.pct ?? 0;
                                            const cls = pct >= 70 ? 'bg-emerald-100 text-emerald-700' : pct >= 40 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
                                            return <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${cls}`} title={`${e.necessary} necessary of ${e.written} PM/PdM corrective work orders`}>{pct}%</span>;
                                        })()}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium flex justify-end gap-2">
                                        <button
                                            onClick={(e) => handleGenerate(pm.id, e)}
                                            disabled={generating === pm.id}
                                            className="text-white bg-primary-600 hover:bg-primary-500 px-2 py-1 rounded text-xs flex items-center gap-1"
                                            title="Generate Work Order Now"
                                        >
                                            <Clock size={14} className={generating === pm.id ? 'animate-spin' : ''} /> Generate
                                        </button>
                                        <button
                                            onClick={(e) => handleDelete(pm.id, e)}
                                            disabled={!canDelete}
                                            className={`px-2 py-1 ${!canDelete ? 'text-slate-300 cursor-not-allowed' : 'text-slate-400 hover:text-red-600'}`}
                                            title={!canDelete ? 'Insufficient permissions' : 'Delete Strategy'}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                        {pms.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                                    <Calendar size={48} className="mx-auto mb-4 opacity-20" />
                                    <p className="font-medium">No recurring strategies found.</p>
                                    <p className="text-xs mt-1">Create a new strategy or go to <button onClick={() => navigate('/recurring-work')} className="text-blue-600 hover:underline font-medium">Recurring Work</button> to manage PMs.</p>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

interface MyWorkTodayViewProps {
    workOrders: WorkOrder[];
    currentUser: any;
    onSelectJob: (job: WorkOrder) => void;
    onUpdateJob: (updates: Partial<WorkOrder>, force?: boolean) => Promise<void>;
    dictionaries: DictionaryEntry[];
    assets: any[];
}

const MyWorkTodayView: React.FC<MyWorkTodayViewProps> = ({
    workOrders,
    currentUser,
    onSelectJob,
    onUpdateJob,
    dictionaries,
    assets
}) => {
    const { showToast } = useToast();
    const [selectedFailureModes, setSelectedFailureModes] = useState<Record<string, string>>({});
    const [actualHoursInput, setActualHoursInput] = useState<Record<string, string>>({});

    // Filter work orders assigned to current user in active states (SCHED / WIP)
    const assignedJobs = useMemo(() => {
        const username = currentUser?.username || currentUser?.email || '';
        const filtered = workOrders.filter(job => {
            const isAssigned = job.assignedTo === username || job.assignedTo === currentUser?.id;
            const isActive = ['SCHED', 'WIP'].includes(job.status);
            return isAssigned && isActive;
        });

        // Fallback for development/testing if no WOs are assigned to current user
        if (filtered.length === 0) {
            return workOrders.filter(job => ['SCHED', 'WIP'].includes(job.status));
        }
        return filtered;
    }, [workOrders, currentUser]);

    const isDevFallback = useMemo(() => {
        const username = currentUser?.username || currentUser?.email || '';
        const trueAssigned = workOrders.some(job => job.assignedTo === username || job.assignedTo === currentUser?.id);
        return !trueAssigned;
    }, [workOrders, currentUser]);

    // Handle Quick Start Job
    const handleStartJob = async (job: WorkOrder) => {
        try {
            await onUpdateJob({ ...job, status: WorkOrderStatus.WIP });
            showToast("Job status updated to WIP. Execution started! 🛠️", "success");
        } catch (e: any) {
            showToast(`Failed to start job: ${e.message}`, "error");
        }
    };

    // Handle checklist tap
    const handleToggleTaskInstruction = async (job: WorkOrder, task: JobTask, instIdx: number) => {
        const updatedInstructions = (task.instructions || []).map((inst, i) => {
            if (i !== instIdx) return inst;
            return { ...inst, checked: !(inst as any).checked };
        });

        const updatedTasks = (job.tasks || []).map(t => {
            if (t.id !== task.id) return t;
            const completedCount = updatedInstructions.filter(i => (i as any).checked).length;
            const isCompleted = completedCount === updatedInstructions.length;
            return {
                ...t,
                instructions: updatedInstructions,
                status: isCompleted ? 'COMPLETED' : 'IN_PROGRESS'
            };
        });

        onUpdateJob({ ...job, tasks: updatedTasks } as any);
    };

    // Handle Quick TECO (Technical Complete)
    const handleCompleteJob = async (job: WorkOrder) => {
        const asset = assets.find(a => a.id === job.assetId);
        const isCriticalA = asset?.criticality === 'A';
        const requiresFailureCoding = (job.type as string) !== 'PM' && isCriticalA;

        // Failure Coding enforcement
        if (requiresFailureCoding) {
            const fMode = selectedFailureModes[job.id];
            if (!fMode) {
                showToast("⛔ Failure Coding Required: Standard Failure Mode is mandatory for Criticality A assets.", "error");
                return;
            }

            // Save failure data to job before completing
            job.failureData = {
                ...(job.failureData || {}),
                failureMode: fMode,
                comments: 'Quick completed via technician mobile execution view.'
            };
        }

        // Include actual hours if entered
        const hours = parseFloat(actualHoursInput[job.id] || "0");
        if (hours > 0) {
            job.actualDuration = hours;
        }

        // Add a default closing journal if none exist
        if (!job.journals || job.journals.length === 0) {
            job.journals = [
                {
                    id: `journal-${Date.now()}`,
                    createdAt: new Date().toISOString(),
                    type: 'TECHNICAL',
                    createdBy: (currentUser as any)?.username || 'technician',
                    entry: `Job closed via My Work Today technician portal. Staged materials consumed. Failure mode: ${job.failureData?.failureMode || 'None'}. Actual hours logged: ${hours}h.`
                }
            ];
        }

        try {
            await onUpdateJob({
                ...job,
                status: WorkOrderStatus.TECO,
                failureData: job.failureData,
                journals: job.journals,
                actualDuration: job.actualDuration
            }, true); // force true to bypass regular scheduling confirmation
            showToast("Work Order is now Technically Complete (TECO)! ✅", "success");
        } catch (e: any) {
            showToast(`Failed to complete work order: ${e.message}`, "error");
        }
    };

    return (
        <div className="space-y-4 max-w-lg mx-auto pb-12 animate-in fade-in duration-300">
            <div className="bg-slate-800 text-white rounded-xl p-4 shadow-sm flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-bold">Technician execution cockpit</h3>
                    <p className="text-[11px] text-slate-300">Active jobs assigned to {currentUser?.username || 'you'}</p>
                </div>
                <span className="bg-blue-600/30 text-blue-300 border border-blue-500/20 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">
                    Mobile View
                </span>
            </div>

            {isDevFallback && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[11px] text-amber-800 flex items-center gap-2">
                    <span className="text-base">⚠️</span>
                    <span>No work orders explicitly assigned to you. Showing all active system work orders for testing.</span>
                </div>
            )}

            {assignedJobs.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400">
                    <ClipboardList size={32} className="mx-auto mb-2 text-slate-300" />
                    <p className="text-xs">You have no active work orders scheduled for today.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {assignedJobs.map((job) => {
                        const asset = assets.find(a => a.id === job.assetId);
                        const isCriticalA = asset?.criticality === 'A';
                        const requiresFailureCoding = (job.type as string) !== 'PM' && isCriticalA;
                        const hasParts = job.inventory && job.inventory.length > 0;
                        const isStaged = job.properties?.staging_confirmed === true;

                        // Calculate checklist progress
                        const totalInstructions = (job.tasks || []).reduce((sum, t) => sum + (t.instructions?.length || 0), 0);
                        const completedInstructions = (job.tasks || []).reduce((sum, t) => sum + (t.instructions?.filter(i => (i as any).checked).length || 0), 0);
                        const checklistPct = totalInstructions > 0 ? Math.round((completedInstructions / totalInstructions) * 100) : 0;

                        return (
                            <div key={job.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-4 hover:shadow-md transition-all">
                                {/* Card Header */}
                                <div className="flex justify-between items-start gap-2">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-mono font-bold text-blue-650 bg-blue-50 px-2 py-0.5 rounded">
                                                {job.woNumber || job.id}
                                            </span>
                                            {isCriticalA && (
                                                <span className="bg-red-50 text-red-700 text-[9px] font-bold px-1.5 py-0.5 rounded border border-red-150 uppercase">
                                                    Safety Critical
                                                </span>
                                            )}
                                        </div>
                                        <h4 className="font-bold text-sm text-slate-900 mt-1.5 truncate">{job.title}</h4>
                                        <p className="text-[11px] text-slate-500 mt-0.5">{job.assetName}</p>
                                    </div>
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase shrink-0 ${
                                        job.status === 'WIP'
                                            ? 'bg-blue-100 text-blue-800'
                                            : 'bg-slate-100 text-slate-600'
                                    }`}>
                                        {job.status}
                                    </span>
                                </div>

                                {/* Checklist Progress Bar */}
                                {totalInstructions > 0 && (
                                    <div className="space-y-1">
                                        <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase">
                                            <span>Task Progress</span>
                                            <span>{completedInstructions} / {totalInstructions} ({checklistPct}%)</span>
                                        </div>
                                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                            <div className="h-full bg-emerald-500 rounded-full transition-all duration-300" style={{ width: `${checklistPct}%` }} />
                                        </div>
                                    </div>
                                )}

                                {/* Interactive Checklist Section */}
                                {job.status === 'WIP' && (job.tasks || []).length > 0 && (
                                    <div className="bg-slate-50 rounded-lg p-3 space-y-2 border border-slate-100">
                                        <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Checklist Steps</span>
                                        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                                            {(job.tasks || []).map(task => 
                                                (task.instructions || []).map((inst, instIdx) => (
                                                    <label key={`${task.id}-${instIdx}`} className="flex items-start gap-2.5 p-1.5 cursor-pointer hover:bg-white rounded transition select-none">
                                                        <input
                                                            type="checkbox"
                                                            checked={(inst as any).checked || false}
                                                            onChange={() => handleToggleTaskInstruction(job, task, instIdx)}
                                                            className="rounded border-slate-350 text-emerald-600 w-4 h-4 mt-0.5 cursor-pointer"
                                                        />
                                                        <span className={`text-xs ${(inst as any).checked ? 'line-through text-slate-400 font-medium' : 'text-slate-700'}`}>
                                                            {(inst as any).text || inst.label}
                                                        </span>
                                                    </label>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* GAP-19: JSA Safety Section — Field Review */}
                                {job.jsa && job.jsa.hazards && job.jsa.hazards.length > 0 && (
                                    <details className="bg-red-50/50 rounded-lg border border-red-100 overflow-hidden group">
                                        <summary className="p-3 cursor-pointer flex items-center justify-between select-none touch-target-mobile">
                                            <div className="flex items-center gap-2">
                                                <span className="text-red-600">🛡️</span>
                                                <span className="text-[10px] font-bold text-red-700 uppercase tracking-wider">Safety (JSA) — {job.jsa.hazards.length} Hazard{job.jsa.hazards.length > 1 ? 's' : ''}</span>
                                            </div>
                                            <span className="text-red-400 text-xs group-open:rotate-90 transition-transform">▶</span>
                                        </summary>
                                        <div className="px-3 pb-3 space-y-2 border-t border-red-100 pt-2">
                                            {job.jsa.hazards.map((h: any, idx: number) => (
                                                <div key={idx} className="bg-white rounded-lg p-2.5 border border-red-100 space-y-1">
                                                    <div className="flex justify-between items-start">
                                                        <span className="text-xs font-bold text-slate-800">{h.hazard || h.description}</span>
                                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                                                            (h.riskLevel || h.risk || '').toUpperCase() === 'HIGH' ? 'bg-red-100 text-red-700 border-red-200' :
                                                            (h.riskLevel || h.risk || '').toUpperCase() === 'MEDIUM' ? 'bg-amber-100 text-amber-700 border-amber-200' :
                                                            'bg-green-100 text-green-700 border-green-200'
                                                        }`}>
                                                            {h.riskLevel || h.risk || 'N/A'}
                                                        </span>
                                                    </div>
                                                    {h.controls && (
                                                        <p className="text-[10px] text-slate-600 leading-relaxed">
                                                            <span className="font-bold text-slate-500">Controls: </span>{h.controls}
                                                        </p>
                                                    )}
                                                    {h.ppe && (
                                                        <p className="text-[10px] text-blue-700 font-medium">
                                                            🧤 PPE: {h.ppe}
                                                        </p>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </details>
                                )}

                                {/* Material Staging Alert / Action */}
                                {hasParts && (
                                    <div className={`p-3 rounded-lg border text-xs space-y-2 ${
                                        isStaged
                                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                            : 'bg-amber-50 border-amber-200 text-amber-800'
                                    }`}>
                                        <div className="flex justify-between items-center">
                                            <span className="font-bold">Staging Status:</span>
                                            <span className="font-bold uppercase tracking-wider">{isStaged ? '✓ VERIFIED' : '⛔ STAGING REQUIRED'}</span>
                                        </div>
                                        <p className="text-[11px] opacity-80">
                                            {isStaged 
                                                ? 'All required materials are staged at Site Store and verified.' 
                                                : 'Materials must be staged before starting execution. Intercepted in updateJob.'}
                                        </p>
                                        {!isStaged && (
                                            <button
                                                onClick={() => {
                                                    onUpdateJob({
                                                        ...job,
                                                        properties: {
                                                            ...(job.properties || {}),
                                                            staging_confirmed: true
                                                        }
                                                    });
                                                    showToast("Staging confirmed successfully!", "success");
                                                }}
                                                className="w-full py-1.5 bg-amber-600 text-white font-bold rounded hover:bg-amber-700 text-xs transition shadow-sm"
                                            >
                                                Confirm Staging Now
                                            </button>
                                        )}
                                    </div>
                                )}

                                {/* Execution Forms (WIP only) */}
                                {job.status === 'WIP' && (
                                    <div className="grid grid-cols-1 gap-3 pt-2">
                                        {/* Actual Hours Input */}
                                        <div>
                                            <label className="block text-[10px] font-bold text-slate-450 uppercase tracking-wider mb-1">
                                                Actual Hours Worked
                                            </label>
                                            <input
                                                type="number"
                                                step="0.5"
                                                min="0.5"
                                                value={actualHoursInput[job.id] || ""}
                                                onChange={(e) => setActualHoursInput({
                                                    ...actualHoursInput,
                                                    [job.id]: e.target.value
                                                })}
                                                placeholder="e.g. 2.5"
                                                className="w-full px-3 py-1.5 border border-slate-350 rounded-lg text-xs"
                                            />
                                        </div>

                                        {/* Standard Failure Coding (Mandatory for CM on Crit A) */}
                                        {requiresFailureCoding && (
                                            <div>
                                                <label className="block text-[10px] font-bold text-red-650 uppercase tracking-wider mb-1">
                                                    Failure Mode (Mandatory - Crit A)
                                                </label>
                                                <select
                                                    value={selectedFailureModes[job.id] || ""}
                                                    onChange={(e) => setSelectedFailureModes({
                                                        ...selectedFailureModes,
                                                        [job.id]: e.target.value
                                                    })}
                                                    className="w-full px-3 py-1.5 border border-slate-350 rounded-lg text-xs bg-white"
                                                >
                                                    <option value="">-- Select Standard Failure Mode --</option>
                                                    {dictionaries.filter(d => d.type === 'FAILURE_MODE' && d.active).map(fm => (
                                                        <option key={fm.id} value={fm.code}>
                                                            {fm.code} - {fm.description}
                                                        </option>
                                                    ))}
                                                    {dictionaries.filter(d => d.type === 'FAILURE_MODE' && d.active).length === 0 && (
                                                        <>
                                                            <option value="F-01">VIBRATION DEVIATION</option>
                                                            <option value="F-02">MECHANICAL WEAR / CATASTROPHIC</option>
                                                            <option value="F-03">ELECTRICAL SHORT CIRCUIT</option>
                                                            <option value="F-04">LEAKAGE / CONTAINMENT FAILURE</option>
                                                        </>
                                                    )}
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Action Buttons */}
                                <div className="flex gap-2 pt-2">
                                    <button
                                        onClick={() => onSelectJob(job)}
                                        className="flex-1 py-2 bg-slate-105 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs transition border border-slate-200"
                                    >
                                        View Details 🔍
                                    </button>

                                    {job.status === 'SCHED' && (
                                        <button
                                            onClick={() => handleStartJob(job)}
                                            className="flex-1 py-2 bg-primary-600 hover:bg-primary-500 text-white font-bold rounded-lg text-xs transition shadow shadow-blue-500/25"
                                        >
                                            Start Job 🛠️
                                        </button>
                                    )}

                                    {job.status === 'WIP' && (
                                        <button
                                            onClick={() => handleCompleteJob(job)}
                                            className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs transition shadow shadow-emerald-500/25"
                                        >
                                            Complete Job (TECO) ✅
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
