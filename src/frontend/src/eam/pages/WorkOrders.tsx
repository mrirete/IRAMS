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
    Shield, Box, Paperclip, AlertOctagon, Book, Bookmark, Package, Info, Bell, Send, Layers, Eye, Repeat, Network,
    DollarSign, Briefcase, PenTool, Edit3, Sparkles, Loader2, Check, Factory
} from 'lucide-react';
import { InventoryPicker } from '../components/pickers/InventoryPicker';
import { FinOpsService, type CostAllocation, type WarrantyCheckResult, type CostAnomalyResult, type WorkOrderSettlement } from '../services/FinOpsService';
import { MOCK_WORK_ORDERS, MOCK_ASSETS, MOCK_DICTIONARIES, MOCK_RECURRING_JOBS } from '../constants';
import { WorkOrder, WorkOrderScope, WorkOrderStatus, WorkOrderType, JobJSA, JobTask, JobLabor, JobInventory, InstructionBlock, DictionaryEntry, JobFile, JSAHazard as JobHazard, OrganizationUnit, User, LibraryTask, WorkCenter, OrderActuals, DocumentCategory, DOCUMENT_CATEGORY_META } from '../types';
import { LoadingState } from '../components/ui';
import { useToast } from '../contexts/ToastContext';
import { useConfirm, usePrompt } from '../contexts/ConfirmContext';
import { useAuth } from '../contexts/AuthContext';

import { DatabaseService } from '../services/DatabaseService';
import { buildWorkOrder, isPreventiveWoType } from '../lib/workOrder';
import { resolveLabourRate, labourRateSourceLabel } from '../lib/labourRate';
import { issueWorkOrderParts } from '../lib/goodsIssue';
import { ImageGallery } from '../components/ui/ImageGallery';
import { ThreadPanel } from '../../components/messaging/ThreadPanel';
import { aiEngine, type JSAHazardSuggestion } from '../services/AIAnalysisEngine';
import { SignaturePad } from '../components/ui/SignaturePad';
import { DataMapper } from '../services/DataMapper';
import { offlineQueue } from '../services/offlineQueue';
import { CreateWorkOrderModal } from '../components/modals/CreateWorkOrderModal';
import { CreatePMModal } from '../components/modals/CreatePMModal';
import { OrgTreePicker } from '../components/OrgTreePicker';
import { ProcedureBuilder } from '../components/ProcedureBuilder';
import { FilesTab } from '../components/FilesTab';
import { AuditTrail } from '../components/AuditTrail';
import { AroundThisFailure } from '../components/AroundThisFailure';
import { ConfirmationModal } from '../components/modals/ConfirmationModal'; // Added import
import { NotificationService } from '../services/NotificationService';
import { AskRelanternButton } from '../components/AskRelanternButton';
import { UnifiedDetailHeader } from '../components/ui/UnifiedDetailHeader';
import { assessReadiness, assessCloseout, classifyWork, canReviewPlan, canReviewCloseout, canRaiseRCA, type ReadinessResult, type ActionGate } from '../services/workReadiness';
import { computeAssetReliability, computePMEffectiveness, pmEffectivenessKpi, kpisToAIContext, type AssetReliability } from '../services/reliabilityMetrics';
import { useRelantern } from '../contexts/RelanternContext';
import { UnifiedTabBar } from '../components/ui/UnifiedTabBar';
import { FloatingActionButton } from '../components/ui/FloatingActionButton';
import { DensityToggle, type Density } from '../components/ui/DensityToggle';
import { Button, Badge, StatusPill, PriorityPill, Modal, DataList, ModernSelect, type DataColumn } from '../components/ui';
import { supabase } from '../lib/supabase';
import ersApi from '../services/ERSApiClient';
import { JSATab, isRealJsaId } from '../components/JSATab';

type ViewMode = 'LIST' | 'DETAIL' | 'PM_LIST' | 'MY_WORK';
type TabId = 'details' | 'tasks' | 'jsa' | 'resources' | 'cost' | 'files' | 'analysis' | 'discussion';

// Members of the wo_status Postgres enum (0000 + 0148). The STATUS_CODE
// dictionary is a merged list that also carries request/PM statuses, which
// the work_orders column cannot accept.
const WO_STATUS_ENUM = ['OPEN', 'PLAN', 'SCHED', 'WIP', 'WAIT', 'TECO', 'CLOSED', 'CANC', 'CANCELLED'];

// ...

export const WorkOrders: React.FC = () => {
    const { jobId } = useParams();
    const navigate = useNavigate();
    const { showToast } = useToast(); // Added toast hook
    const confirm = useConfirm();
    const promptModal = usePrompt();
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
    // Optional pre-fill for the Create WO modal (drill-throughs like RCM → corrective WO)
    const [createSeed, setCreateSeed] = useState<{ title?: string; assetId?: string; type?: string } | null>(null);

    // Auto-open Create WO modal when navigated with ?action=create (Dashboard quick actions,
    // RCM failure-mode drill-through). Optional seeds: &title=, &asset=, &type=.
    useEffect(() => {
        if (searchParams.get('action') === 'create') {
            const title = searchParams.get('title') || undefined;
            const assetId = searchParams.get('asset') || undefined;
            const type = searchParams.get('type') || undefined;
            setCreateSeed(title || assetId || type ? { title, assetId, type } : null);
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
            // Honest fallback: demo data must announce itself — users were
            // editing mock WOs and hitting cryptic uuid errors on save.
            setWorkOrders(MOCK_WORK_ORDERS);
            setDictionaries(MOCK_DICTIONARIES);
            showToast('Live data unavailable — showing DEMO work orders (read-only). Reload to retry.', 'warning');
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
                                hazards: (jsaRecord.jsa_hazards || []).map((h: any) => DataMapper.toUIJSAHazard(h)),
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
                                // Journals: prefer the append-only journal_entries rows (0285);
                                // properties.journals is the offline cache / legacy fallback.
                                journals: (raw as any).journal_rows?.length
                                    ? DataMapper.toUIJournals((raw as any).journal_rows)
                                    : ((raw.properties as any)?.journals || foundJob.journals || []),
                                // Restore failureData from joined wo_failure_data
                                failureData: (() => {
                                    const fd = Array.isArray(raw.wo_failure_data) ? raw.wo_failure_data[0] : raw.wo_failure_data;
                                    if (!fd) return foundJob.failureData;
                                    return {
                                        failureMode: fd.failure_mode_code || undefined,
                                        failureCause: fd.failure_cause_code || undefined,
                                        remedyCode: fd.remedy_code || undefined,
                                        detectionCode: fd.detection_code || undefined,
                                        subunitCode: fd.subunit_code || undefined,
                                        objectPart: fd.object_part || undefined,
                                        failedBomItemId: fd.failed_bom_item_id || undefined,
                                        failedPartNo: fd.failed_part_no || undefined,
                                        secondaryFailure: typeof fd.secondary_failure === 'boolean' ? fd.secondary_failure : undefined,
                                        causedByWoId: fd.caused_by_wo_id || undefined,
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
                onClose={() => { setIsCreateOpen(false); setCreateSeed(null); }}
                onSave={handleJobCreated}
                dictionaries={dictionaries}
                initial={createSeed || undefined}
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
    const promptModal = usePrompt();
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
        setActiveViewId('');
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

    // ═══ U-4: Saved Views (filter + sort presets) + W-4 Backlog cockpit preset ═══
    // Backlog = open work only (excludes finished statuses); the "Backlog" preset
    // sorts oldest-first so the aging tail surfaces — a planner's backlog cockpit.
    const [backlogOnly, setBacklogOnly] = useState(false);
    type WOView = { id: string; name: string; builtin?: boolean; statusFilter: WorkOrderStatus | 'ALL'; classFilter: 'ALL' | 'PROACTIVE' | 'REACTIVE'; backlogOnly?: boolean; sortField: SortField; sortAsc: boolean };
    const BUILTIN_VIEWS: WOView[] = [
        { id: 'all', name: 'All Work Orders', builtin: true, statusFilter: 'ALL', classFilter: 'ALL', backlogOnly: false, sortField: 'priority', sortAsc: false },
        { id: 'backlog', name: 'Backlog · oldest first', builtin: true, statusFilter: 'ALL', classFilter: 'ALL', backlogOnly: true, sortField: 'created', sortAsc: true },
        { id: 'reactive-backlog', name: 'Reactive backlog', builtin: true, statusFilter: 'ALL', classFilter: 'REACTIVE', backlogOnly: true, sortField: 'priority', sortAsc: false },
    ];
    const VIEWS_KEY = 'irams_wo_saved_views';
    const [userViews, setUserViews] = useState<WOView[]>(() => { try { return JSON.parse(localStorage.getItem(VIEWS_KEY) || '[]'); } catch { return []; } });
    const [activeViewId, setActiveViewId] = useState<string>('all');
    const [viewsOpen, setViewsOpen] = useState(false);
    const viewsRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const h = (e: MouseEvent) => { if (viewsRef.current && !viewsRef.current.contains(e.target as Node)) setViewsOpen(false); };
        document.addEventListener('mousedown', h);
        return () => document.removeEventListener('mousedown', h);
    }, []);

    const applyView = (v: WOView) => {
        setStatusFilter(v.statusFilter); setClassFilter(v.classFilter); setBacklogOnly(!!v.backlogOnly);
        setSortField(v.sortField); setSortAsc(v.sortAsc); setActiveViewId(v.id); setViewsOpen(false);
        localStorage.setItem('irams_wo_sort_field', v.sortField);
        localStorage.setItem('irams_wo_sort_asc', String(v.sortAsc));
    };
    const saveCurrentView = async () => {
        const name = await promptModal({
            title: 'Save Custom View',
            message: 'Enter a name for this saved filter & sort configuration:',
            placeholder: 'e.g. High Priority Backlog',
            confirmLabel: 'Save View',
            icon: <Bookmark size={20} className="text-indigo-600" />
        });
        if (!name || !name.trim()) return;
        const v: WOView = { id: 'u-' + Date.now(), name: name.trim(), statusFilter, classFilter, backlogOnly, sortField, sortAsc };
        const next = [...userViews, v];
        setUserViews(next); localStorage.setItem(VIEWS_KEY, JSON.stringify(next));
        setActiveViewId(v.id); setViewsOpen(false);
    };
    const deleteView = (id: string) => {
        const next = userViews.filter(v => v.id !== id);
        setUserViews(next); localStorage.setItem(VIEWS_KEY, JSON.stringify(next));
        if (activeViewId === id) applyView(BUILTIN_VIEWS[0]);
    };
    const activeViewName = [...BUILTIN_VIEWS, ...userViews].find(v => v.id === activeViewId)?.name || 'Custom view';

    // Priority rank for sorting (higher number = higher priority)
    const PRIORITY_RANK: Record<string, number> = { EMERGENCY: 5, HIGH: 4, MEDIUM: 3, LOW: 2, ROUTINE: 1 };
    const STATUS_RANK: Record<string, number> = { WIP: 5, SCHED: 4, OPEN: 3, TECO: 2, CLOSED: 1, CANC: 0, CANCELLED: 0 };

    const BACKLOG_FINISHED = useMemo(() => new Set(['TECO', 'CLOSED', 'CANC', 'CANCELLED', 'COMPLETED']), []);
    const filteredJobs = useMemo(() => {
        const filtered = jobs.filter(job => {
            const matchesStatus = statusFilter === 'ALL' || job.status === statusFilter;
            const matchesClass = classFilter === 'ALL' || classifyWork(job) === classFilter;
            const matchesBacklog = !backlogOnly || !BACKLOG_FINISHED.has((job.status || '').toUpperCase());
            const matchesSearch = (job.title || '').toLowerCase().includes(search.toLowerCase()) ||
                (job.id || '').toLowerCase().includes(search.toLowerCase()) ||
                (job.woNumber || '').toLowerCase().includes(search.toLowerCase()) ||
                (job.assetName || '').toLowerCase().includes(search.toLowerCase());
            return matchesStatus && matchesClass && matchesBacklog && matchesSearch;
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
    }, [jobs, statusFilter, classFilter, backlogOnly, search, sortField, sortAsc, BACKLOG_FINISHED]);

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
                        {/* U-4: Saved Views selector */}
                        <div className="relative" ref={viewsRef}>
                            <button
                                onClick={() => setViewsOpen(o => !o)}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-[36px] md:min-h-0 rounded-lg text-xs font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50 max-w-[190px]"
                                title="Saved views — filter + sort presets"
                            >
                                <Layers size={13} className="flex-shrink-0 text-slate-400" />
                                <span className="truncate">{activeViewId ? activeViewName : 'Custom view'}</span>
                                <ChevronDown size={13} className="flex-shrink-0 text-slate-400" />
                            </button>
                            {viewsOpen && (
                                <div className="absolute right-0 mt-1 w-64 bg-white border border-slate-200 rounded-xl shadow-xl z-30 py-1 text-sm">
                                    <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Presets</div>
                                    {BUILTIN_VIEWS.map(v => (
                                        <button key={v.id} onClick={() => applyView(v)}
                                            className={`w-full text-left px-3 py-1.5 hover:bg-slate-50 flex items-center justify-between ${activeViewId === v.id ? 'text-primary-700 font-semibold' : 'text-slate-700'}`}>
                                            {v.name}{activeViewId === v.id && <Check size={13} />}
                                        </button>
                                    ))}
                                    {userViews.length > 0 && <div className="px-3 py-1 mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400 border-t border-slate-100">My views</div>}
                                    {userViews.map(v => (
                                        <div key={v.id} className={`group flex items-center justify-between px-3 py-1.5 hover:bg-slate-50 ${activeViewId === v.id ? 'text-primary-700 font-semibold' : 'text-slate-700'}`}>
                                            <button onClick={() => applyView(v)} className="flex-1 text-left truncate">{v.name}</button>
                                            <button onClick={() => deleteView(v.id)} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 ml-2" title="Delete view"><Trash2 size={12} /></button>
                                        </div>
                                    ))}
                                    <div className="border-t border-slate-100 mt-1 pt-1">
                                        <button onClick={saveCurrentView} className="w-full text-left px-3 py-1.5 hover:bg-slate-50 text-primary-600 font-semibold flex items-center gap-1.5">
                                            <Plus size={13} /> Save current view…
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
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
                                onClick={() => { setStatusFilter(status.code as any); setActiveViewId(''); }}
                                className={`whitespace-nowrap inline-flex items-center min-h-[32px] md:min-h-0 px-2.5 py-1 md:py-0.5 rounded-full text-[9px] font-bold uppercase border transition-all ${statusFilter === status.code
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
                                onClick={() => { setClassFilter(val); setActiveViewId(''); }}
                                className={`whitespace-nowrap inline-flex items-center min-h-[32px] md:min-h-0 px-2.5 py-1 md:py-0.5 rounded-full text-[9px] font-bold uppercase border transition-all ${classFilter === val
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
    const promptModal = usePrompt();
    // Local state to manage edits during the session (e.g. adding failure data before completion)
    const [localJob, setLocalJob] = useState<WorkOrder>(job);
    const [activeTab, setActiveTab] = useState<TabId>('details');
    const [costRefreshKey, setCostRefreshKey] = useState(0); // bumped after a time confirmation to re-roll the Cost tab
    const [showCompleteModal, setShowCompleteModal] = useState(false);
    const [modalFailureMode, setModalFailureMode] = useState('');
    const [modalFailureCause, setModalFailureCause] = useState('');
    const [modalRemedy, setModalRemedy] = useState('');
    const [modalJournalNote, setModalJournalNote] = useState('');
    // Completion actuals (0283) — the equipment-event data reliability math runs on
    const [modalActualHours, setModalActualHours] = useState('');
    const [modalDowntimeHours, setModalDowntimeHours] = useState('');
    const [modalMalfStart, setModalMalfStart] = useState('');
    const [modalMalfEnd, setModalMalfEnd] = useState('');
    const [modalBreakdown, setModalBreakdown] = useState(false);
    const [modalFailedBomId, setModalFailedBomId] = useState('');
    const [modalCollateral, setModalCollateral] = useState(false);

    useEffect(() => {
        if (!showCompleteModal) {
            setModalFailureMode('');
            setModalFailureCause('');
            setModalRemedy('');
            setModalJournalNote('');
            setModalActualHours('');
            setModalDowntimeHours('');
            setModalMalfStart('');
            setModalMalfEnd('');
            setModalBreakdown(false);
            setModalFailedBomId('');
            setModalCollateral(false);
        }
    }, [showCompleteModal]);

    // Raising an RCA hands this WO's asset, problem statement and event data to a
    // new investigation — it stays locked until those exist, so the investigation
    // backlog doesn't fill with empty records.
    const rcaGate = canRaiseRCA(localJob);

    const [showNotificationModal, setShowNotificationModal] = useState(false);
    const [pendingStatus, setPendingStatus] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [followUpDescription, setFollowUpDescription] = useState('');

    // ── GAP-21: Styled modal states (replace native alert/confirm) ──
    const [showFinancialCloseModal, setShowFinancialCloseModal] = useState(false);

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
    const localJobIdRef = useRef<string | undefined>(undefined);
    // Bumped on every local edit. The post-save refetch only re-syncs state if this
    // hasn't changed during the save round-trip — otherwise the refetch would
    // overwrite keystrokes typed while saving (the "letters disappear" bug).
    const editVersionRef = useRef(0);

    // Update local job if props change (e.g. navigation between jobs, or the
    // deep-link's background detail fetch completing). Skip while the user has
    // unsaved edits on the SAME job — a late-arriving refetch would silently
    // clobber them (verified: JSA hazard edits made during the deep-link load
    // were lost and only the pristine hazard reached the DB).
    useEffect(() => {
        const hasPendingEdits =
            saveTimerRef.current !== null || Object.keys(pendingUpdatesRef.current).length > 0;
        if (job.id !== localJobIdRef.current || !hasPendingEdits) {
            setLocalJob(job);
        }
        localJobIdRef.current = job.id;
    }, [job]);

    // Cleanup debounce timer on unmount
    useEffect(() => {
        return () => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        };
    }, []);

    // ── Asset BOM (0287): the maintainable-component list for failure coding.
    // A failed component is picked from here so the record lands on a real
    // BOM line (ISO 14224 level 8/9), not free text.
    const [bomItems, setBomItems] = useState<any[]>([]);
    useEffect(() => {
        let active = true;
        if (!localJob.assetId) { setBomItems([]); return; }
        DatabaseService.getInstance().getBomForAsset(localJob.assetId)
            .then(items => { if (active) setBomItems(items || []); })
            .catch(() => { if (active) setBomItems([]); });
        return () => { active = false; };
    }, [localJob.assetId]);

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
    // Single policy shared with the server-side TECO gate — see lib/workOrder.ts.
    const isPreventiveType = isPreventiveWoType(woType);
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
    const [duplicating, setDuplicating] = useState(false);

    const tabs: { id: TabId; label: string; icon: any }[] = [
        { id: 'details', label: 'Details', icon: FileText },
        { id: 'tasks', label: 'Tasks', icon: ClipboardList },
        { id: 'jsa', label: 'Safety (JSA)', icon: Shield },
        { id: 'resources', label: 'Resources', icon: Layers },
        { id: 'cost', label: 'Cost', icon: DollarSign },
        { id: 'files', label: 'Files', icon: Paperclip },
        { id: 'analysis', label: 'Analysis & History', icon: AlertOctagon }, // Merged Tab
        { id: 'discussion', label: 'Discussion', icon: MessageSquare },
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
                    hazards: (jsaRecord.jsa_hazards || []).map((h: any) => DataMapper.toUIJSAHazard(h)),
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
                    estDowntime: Number(raw.est_downtime_hrs) || 0,
                    actualDuration: Number(raw.actual_duration_hrs) || 0,
                    actualDowntime: Number(raw.actual_downtime_hrs) || 0,
                    malfunctionStart: raw.malfunction_start || undefined,
                    malfunctionEnd: raw.malfunction_end || undefined,
                    breakdown: typeof raw.breakdown === 'boolean' ? raw.breakdown : undefined,
                    parentWoId: raw.parent_wo_id || undefined,
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
                    // Journals: prefer the append-only journal_entries rows (0285).
                    journals: (raw as any).journal_rows?.length
                        ? DataMapper.toUIJournals((raw as any).journal_rows)
                        : ((raw.properties as any)?.journals || updatedJob.journals || []),
                    // Restore failureData from joined wo_failure_data
                    failureData: (() => {
                        const fd = Array.isArray(raw.wo_failure_data) ? raw.wo_failure_data[0] : raw.wo_failure_data;
                        if (!fd) return updatedJob.failureData;
                        return {
                            failureMode: fd.failure_mode_code || undefined,
                            failureCause: fd.failure_cause_code || undefined,
                            remedyCode: fd.remedy_code || undefined,
                            detectionCode: fd.detection_code || undefined,
                            subunitCode: fd.subunit_code || undefined,
                            objectPart: fd.object_part || undefined,
                            failedBomItemId: fd.failed_bom_item_id || undefined,
                            failedPartNo: fd.failed_part_no || undefined,
                            secondaryFailure: typeof fd.secondary_failure === 'boolean' ? fd.secondary_failure : undefined,
                            causedByWoId: fd.caused_by_wo_id || undefined,
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

            // ── Goods issue on completion (B2) ────────────────────────
            // Reaching TECO consumes the planned parts: stock decrements per
            // location (ISSUE transactions), part rows flip planned→issued,
            // and the 0201 trigger releases their reservations. Idempotent —
            // already-issued rows are skipped on any repeat transition.
            const finishedStatuses = ['TECO', 'CLOSED', 'CANC', 'CANCELLED'];
            if (updates.status && newStatus === WorkOrderStatus.TECO && !finishedStatuses.includes(previousStatus as string)) {
                issueWorkOrderParts(updatedJob.id, (user as any)?.username || user?.id || 'SYSTEM')
                    .then(r => {
                        if (r.issuedParts > 0) {
                            showToast(`Goods issue: ${r.issuedParts} part line${r.issuedParts === 1 ? '' : 's'} consumed from stores.`, 'success');
                        }
                        if (r.shortfalls.length > 0) {
                            showToast(`Stores records short on ${r.shortfalls.map(s => `${s.description} (−${s.short})`).join(', ')} — reconcile stock.`, 'warning');
                        }
                    })
                    .catch(e => console.warn('[GoodsIssue] failed (parts stay planned, retry by re-saving TECO):', e));
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

    // ── Scoped JSA persist: safety-tab edits only touch the jsa tables.
    // The full-WO path rewrites the whole order (and delete-reinserts child
    // rows) on every save, so routing a hazard-description keystroke through
    // it was slow and widened the concurrency window. Used only when nothing
    // but the JSA is pending in the debounce window. ──
    const persistJsaOnly = useCallback(async (updatedJob: WorkOrder, jsa: JobJSA) => {
        if (!updatedJob.id) return;
        setIsSaving(true);
        try {
            const { queued } = await offlineQueue.run(
                'saveJsa',
                { woId: updatedJob.id, jsa, actor: user?.id || 'unknown' },
                `JSA for WO ${updatedJob.woNumber || updatedJob.id}`,
            );
            if (queued) {
                showToast('Saved offline — the safety assessment will sync when you reconnect.', 'info');
                return;
            }
            // First save creates the assessment row; adopt its real id so the
            // permits section can attach without a full refetch.
            if (!isRealJsaId(jsa.id)) {
                const created = await DatabaseService.getInstance().getJSA(updatedJob.id);
                if (created?.id) {
                    setLocalJob(prev => prev.jsa ? { ...prev, jsa: { ...prev.jsa, id: created.id } } : prev);
                }
            }
            showToast('Safety assessment saved', 'success');
        } catch (e) {
            console.error('[persistJsaOnly] failed:', e);
            showToast('Failed to save safety assessment', 'error');
        } finally {
            setIsSaving(false);
        }
    }, [user, showToast]);

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
        if (!force
            && String(updates.status || '').toUpperCase().startsWith('CANC')   // matches both enum spellings: CANC (dictionary) and CANCELLED (legacy)
            && !String(localJob.status || '').toUpperCase().startsWith('CANC')
            && isCriticalityA) {
            setShowGatekeeperModal(true);
            setGatekeeperReason('');
            setGatekeeperConfirmed(false);
            return;
        }

        // Auto-journal status & assignment changes as SYSTEM entries — the
        // "History" half of Analysis & History was manual notes only; process
        // events left no trace in the record.
        const sysEntries: any[] = [];
        const stamp = () => ({
            id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `sys-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            type: 'SYSTEM',
            createdBy: (user as any)?.username || user?.email || 'system',
            createdAt: new Date().toISOString(),
            isSystem: true,
        });
        if (updates.status && updates.status !== localJob.status) {
            sysEntries.push({ ...stamp(), entry: `Status changed: ${localJob.status || '—'} → ${updates.status}` });
        }
        if (updates.assignedTo !== undefined && updates.assignedTo !== localJob.assignedTo) {
            sysEntries.push({ ...stamp(), entry: `Assignment changed: ${localJob.assignedTo || 'unassigned'} → ${updates.assignedTo || 'unassigned'}` });
        }
        if (sysEntries.length > 0) {
            updates = { ...updates, journals: [...sysEntries, ...(updates.journals || localJob.journals || [])] };
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
            saveTimerRef.current = null;
            pendingUpdatesRef.current = {}; // reset accumulated updates
            const pendingKeys = Object.keys(accumulatedUpdates);
            if (pendingKeys.length === 1 && pendingKeys[0] === 'jsa' && accumulatedUpdates.jsa) {
                await persistJsaOnly(snapshot, accumulatedUpdates.jsa);
            } else {
                await persistToDb(snapshot, originalSnapshot, accumulatedUpdates);
            }
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
        // Same shape as every other journal writer (entry/createdBy/createdAt) —
        // this writer used author/date/comments, so TECO notes rendered blank in
        // the timeline (which reads j.entry).
        const finalJournals = !hasJournals && modalJournalNote.trim()
            ? [{
                id: `inst-${Date.now()}`,
                type: 'Note',
                createdBy: (user as any)?.username || 'unknown',
                createdAt: new Date().toISOString(),
                entry: modalJournalNote.trim(),
                isSystem: false
              }, ...(localJob.journals || [])]
            : (localJob.journals || []);

        const modalBom = modalFailedBomId ? bomItems.find((b: any) => b.id === modalFailedBomId) : undefined;
        let finalFailureData = requiresFailureCoding && !hasFailureMode && modalFailureMode
            ? {
                ...(localJob.failureData || {}),
                failureMode: modalFailureMode,
                failureCause: modalFailureCause || localJob.failureData?.failureCause,
                remedyCode: modalRemedy || localJob.failureData?.remedyCode,
                ...(modalBom ? {
                    failedBomItemId: modalBom.id,
                    failedPartNo: modalBom.partNumber || undefined,
                    objectPart: modalBom.description || undefined,
                } : {})
              }
            : localJob.failureData;
        // 0289: collateral flag from the modal — the causing WO can be linked
        // afterwards from Analysis & History → Around This Failure.
        if (!isPreventiveType && modalCollateral && finalFailureData?.secondaryFailure !== true) {
            finalFailureData = { ...(finalFailureData || {}), secondaryFailure: true };
        }

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
        let followUpFailed = false;

        // Completion actuals (0283) — parse and validate before any write.
        const actualHrs = parseFloat(modalActualHours);
        const downtimeHrs = parseFloat(modalDowntimeHours);
        const malfStartIso = modalMalfStart ? new Date(modalMalfStart).toISOString() : null;
        const malfEndIso = modalMalfEnd ? new Date(modalMalfEnd).toISOString() : null;
        if (malfStartIso && malfEndIso && malfEndIso < malfStartIso) {
            showToast('Malfunction end must be after malfunction start.', 'warning');
            return;
        }
        const actualsCols: Record<string, unknown> = {
            ...(Number.isFinite(actualHrs) && actualHrs > 0 ? { actual_duration_hrs: actualHrs } : {}),
            ...(Number.isFinite(downtimeHrs) && downtimeHrs > 0 ? { actual_downtime_hrs: downtimeHrs } : {}),
            ...(malfStartIso ? { malfunction_start: malfStartIso } : {}),
            ...(malfEndIso ? { malfunction_end: malfEndIso } : {}),
            ...(!isPreventiveType ? { breakdown: modalBreakdown } : {}),
        };

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
                ...actualsCols,
                failureData: finalFailureData,
                properties: {
                    ...((localJob as any).properties || {}),
                    journals: finalJournals,
                },
            } as any, user?.id || 'unknown');
            updateJob({
                status: updatedStatus,
                ...(Number.isFinite(actualHrs) && actualHrs > 0 ? { actualDuration: actualHrs } : {}),
                ...(Number.isFinite(downtimeHrs) && downtimeHrs > 0 ? { actualDowntime: downtimeHrs } : {}),
                ...(malfStartIso ? { malfunctionStart: malfStartIso } : {}),
                ...(malfEndIso ? { malfunctionEnd: malfEndIso } : {}),
                ...(!isPreventiveType ? { breakdown: modalBreakdown } : {}),
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
                    finalFailureData?.objectPart ? `Failed component: ${finalFailureData.objectPart}${finalFailureData.failedPartNo ? ` (${finalFailureData.failedPartNo})` : ''}` : '',
                    `\nOriginal PM: ${localJob.title || 'N/A'}`,
                    `Asset: ${localJob.assetCode || localJob.assetName || 'N/A'}`,
                    isCriticalityA ? '\n⚠️ CRITICALITY A ASSET — Requires engineering review.' : ''
                ].filter(Boolean).join('\n');

                try {
                    const newWO = await DatabaseService.getInstance().createWorkOrder(buildWorkOrder({
                        woNumber: `WO-FU-${Date.now().toString(36).toUpperCase()}`,
                        title: followUpTitle,
                        description: followUpDesc,
                        type: 'CM',
                        status: 'OPEN',
                        priorityCode: followUpPriority,
                        assetId: localJob.assetId!, // a work order always has an asset (asset_id NOT NULL)
                        parentWoId: localJob.id,
                        createdBy: user?.id || null,
                    }), user?.id || 'unknown');

                    const woNum = newWO?.wo_number || newWO?.id || 'NEW';
                    message += `\n\nFollow-up Corrective WO ${woNum} created (Priority: ${followUpPriority}).`;
                    if (isCriticalityA) {
                        message += '\nCriticality A — Engineering review required.';
                    }

                    // 0287: the failed component is a stocked material → plan it on
                    // the follow-up so the corrective team arrives with the part.
                    try {
                        const failedBom = finalFailureData?.failedBomItemId
                            ? bomItems.find((b: any) => b.id === finalFailureData.failedBomItemId)
                            : undefined;
                        if (newWO?.id && failedBom?.inventoryItemId) {
                            const qty = Number(failedBom.quantity) || 1;
                            const unit = Number(failedBom.estimatedCost) || 0;
                            const { error: partErr } = await supabase.from('work_order_parts').insert({
                                wo_id: newWO.id,
                                item_id: failedBom.inventoryItemId,
                                quantity: qty,
                                unit_cost: unit,
                                total_cost: Math.round(qty * unit * 100) / 100,
                                is_planned: true,
                                notes: `Pre-loaded from failure coding — failed component "${failedBom.description}"`,
                            });
                            if (!partErr) {
                                message += `\nPlanned part pre-loaded: ${failedBom.description}.`;
                            } else {
                                console.warn('[Follow-up] part pre-load failed (non-blocking):', partErr.message);
                            }
                        }
                    } catch (partThrown) {
                        console.warn('[Follow-up] part pre-load threw (non-blocking):', partThrown);
                    }
                } catch (fuErr: any) {
                    console.error('Failed to create follow-up WO:', fuErr);
                    followUpFailed = true;
                    message += `\n\n⚠️ Follow-up WO creation failed: ${fuErr.message}. Please create manually.`;
                }
            }

            // The message already carries the failure; the severity should too,
            // or a green toast buries the one line the user has to act on.
            showToast(message, followUpFailed ? 'warning' : 'success');
            setShowCompleteModal(false);
            onBack();
        } catch (e: any) {
            showToast('Error closing job: ' + e.message, 'error');
        }
    };

    // ── Print: field-ready job card (meta, description, tasks w/ tick boxes,
    // labor, parts, sign-off) via a hidden same-origin iframe — no popup blockers.
    const handlePrint = () => {
        const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
        const tasks = [...(localJob.tasks || [])].sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
        const labor = localJob.labor || [];
        const parts = localJob.inventory || [];
        const meta: [string, string][] = [
            ['Status', (localJob.status || '').replace(/_/g, ' ')],
            ['Type', localJob.type || '—'],
            ['Priority', localJob.priority || '—'],
            ['Asset', [localJob.assetCode, localJob.assetName].filter(Boolean).join(' — ') || '—'],
            ['Due', localJob.dueDate || '—'],
            ['Created', (localJob.dateCreated || '').slice(0, 10) || '—'],
            ['Est. duration', localJob.estDuration ? `${localJob.estDuration} h` : '—'],
            ['Cost centre', localJob.costCenter || '—'],
        ];
        const html = `<!doctype html><html><head><title>${esc(localJob.woNumber || localJob.id)}</title><style>
            * { box-sizing: border-box; } body { font: 12px/1.45 -apple-system, 'Segoe UI', Arial, sans-serif; color: #0f172a; margin: 24px; }
            h1 { font-size: 18px; margin: 0; } .sub { color: #475569; margin: 2px 0 14px; font-size: 13px; }
            .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px 16px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px 12px; margin-bottom: 14px; }
            .meta b { display: block; font-size: 9px; text-transform: uppercase; color: #64748b; letter-spacing: .04em; }
            h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: #334155; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; margin: 16px 0 6px; }
            table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #cbd5e1; padding: 5px 8px; text-align: left; vertical-align: top; }
            th { background: #f1f5f9; font-size: 10px; text-transform: uppercase; color: #475569; }
            .box { display: inline-block; width: 12px; height: 12px; border: 1.5px solid #64748b; border-radius: 2px; }
            .sig { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px; margin-top: 28px; }
            .sig div { border-top: 1px solid #334155; padding-top: 4px; font-size: 10px; color: #475569; }
            @media print { body { margin: 10mm; } }
        </style></head><body>
            <h1>${esc(localJob.woNumber || localJob.id)} — Work Order</h1>
            <p class="sub">${esc(localJob.title)}</p>
            <div class="meta">${meta.map(([k, v]) => `<span><b>${esc(k)}</b>${esc(v)}</span>`).join('')}</div>
            <h2>Description</h2><p>${esc(localJob.description || '—').replace(/\n/g, '<br/>')}</p>
            <h2>Tasks (${tasks.length})</h2>
            ${tasks.length ? `<table><tr><th style="width:28px">#</th><th>Task</th><th style="width:60px">Est. h</th><th style="width:44px">Done</th><th style="width:70px">Initials</th></tr>
                ${tasks.map(t => `<tr><td>${esc(t.sequence)}</td><td>${esc(t.description)}</td><td>${esc(t.estHours || '')}</td><td style="text-align:center"><span class="box"></span></td><td></td></tr>`).join('')}</table>` : '<p>No tasks defined.</p>'}
            ${labor.length ? `<h2>Labor</h2><table><tr><th>Role</th><th style="width:70px">People</th><th style="width:70px">Est. h</th><th>Performed by</th></tr>
                ${labor.map(l => `<tr><td>${esc(l.contactType)}</td><td>${esc(l.headcount || 1)}</td><td>${esc(l.estDuration || '')}</td><td></td></tr>`).join('')}</table>` : ''}
            ${parts.length ? `<h2>Parts &amp; Materials</h2><table><tr><th>Item</th><th style="width:70px">Qty</th><th style="width:70px">UoM</th><th style="width:90px">Used</th></tr>
                ${parts.map(p => `<tr><td>${esc(p.description)}</td><td>${esc(p.estQty)}</td><td>${esc(p.uom)}</td><td></td></tr>`).join('')}</table>` : ''}
            <div class="sig"><div>Completed by</div><div>Signature</div><div>Date</div></div>
        </body></html>`;

        const frame = document.createElement('iframe');
        frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
        document.body.appendChild(frame);
        const doc = frame.contentWindow?.document;
        if (!doc) { showToast('Unable to open the print view.', 'error'); frame.remove(); return; }
        doc.open(); doc.write(html); doc.close();
        frame.contentWindow!.focus();
        frame.contentWindow!.print();
        // Removing the frame too early blanks the dialog in some browsers.
        setTimeout(() => frame.remove(), 60000);
    };

    // ── Duplicate: copy the WO + its plan (tasks/labor/parts as estimates).
    // Actuals, confirmations, journals, failure data and JSA sign-offs stay behind.
    const handleDuplicate = async () => {
        if (duplicating) return;
        if (!localJob.assetId) { showToast('Cannot duplicate: this work order has no asset.', 'error'); return; }
        setDuplicating(true);
        try {
            const db = DatabaseService.getInstance();
            const created = await db.createWorkOrder(buildWorkOrder({
                title: localJob.title,
                description: localJob.description,
                type: localJob.type,
                status: 'OPEN',
                priorityCode: localJob.priority,
                assetId: localJob.assetId,
                workCenterId: localJob.workCenterId ?? null,
                estDuration: localJob.estDuration,
                createdBy: user?.id || null,
            }), user?.id || 'unknown');
            const newId = (created as any)?.id;

            // Fresh ids for child rows (upsert-by-id must not touch the original),
            // task links remapped so labor/parts still point at the copied task.
            const idMap = new Map<string, string>();
            const tasks = (localJob.tasks || []).map(t => {
                const id = crypto.randomUUID(); idMap.set(t.id, id);
                return {
                    ...t, id, status: 'PENDING' as const,
                    actualHours: undefined, actualStartDate: undefined, actualStartTime: undefined,
                    actualFinishDate: undefined, actualFinishTime: undefined,
                    completedBy: undefined, completedDate: undefined,
                };
            });
            const labor = (localJob.labor || []).map(l => ({
                ...l, id: crypto.randomUUID(), jobTaskId: l.jobTaskId ? idMap.get(l.jobTaskId) : undefined,
                actualDuration: undefined, actualRate: undefined, dateWorkPerformed: undefined,
                isFinal: undefined, confirmationNo: undefined, remainingHours: undefined,
            }));
            const inventory = (localJob.inventory || []).map(p => ({
                ...p, id: crypto.randomUUID(), jobTaskId: p.jobTaskId ? idMap.get(p.jobTaskId) : undefined,
                actualQty: undefined, actualUnitCost: undefined, dateUsed: undefined,
            }));
            if (newId && (tasks.length || labor.length || inventory.length)) {
                await db.updateWorkOrder(newId, { tasks, labor, inventory } as any, user?.id || 'unknown');
            }

            showToast(`Duplicated as ${(created as any)?.wo_number || 'a new work order'} — opening the copy.`, 'success');
            if (newId) navigate(`/work-orders/${newId}`);
        } catch (e: any) {
            showToast('Failed to duplicate: ' + (e?.message || 'unknown error'), 'error');
        } finally {
            setDuplicating(false);
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
                    <button onClick={handlePrint} className="flex items-center gap-1.5 px-2 py-1 md:px-2.5 md:py-1.5 text-[11px] md:text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-white border border-transparent hover:border-slate-200 rounded transition-colors" title="Print Work Order">
                        <Printer size={14} /> Print
                    </button>
                    <button
                        onClick={async () => {
                            const name = await promptModal({
                                title: 'Save as Library Template',
                                message: 'Enter a descriptive title for this new standard library template:',
                                defaultValue: localJob.title,
                                placeholder: 'Template title...',
                                confirmLabel: 'Create Template',
                                icon: <Book size={20} className="text-indigo-600" />
                            });
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
                    <button onClick={handleDuplicate} disabled={duplicating} className="flex items-center gap-1.5 px-2 py-1 md:px-2.5 md:py-1.5 text-[11px] md:text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-white border border-transparent hover:border-slate-200 rounded transition-colors disabled:opacity-50 disabled:cursor-wait" title="Duplicate Work Order (copies tasks, labor and parts as a fresh OPEN work order)">
                        <Copy size={14} /> {duplicating ? 'Duplicating…' : 'Duplicate'}
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
                    {/* ── Raise RCA — only for Corrective/Breakdown/Emergency WOs, and only
                          once the WO carries the evidence an investigation inherits ── */}
                    {['CM', 'BM', 'EM'].includes(localJob.type) && (
                        <button
                            onClick={() => {
                                if (!rcaGate.ok) { showToast(rcaGate.reason, 'info'); return; }
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
                            aria-disabled={!rcaGate.ok}
                            className={`flex items-center gap-1.5 px-2.5 py-1 md:px-3 md:py-1.5 text-[11px] md:text-xs font-bold rounded transition-all ${
                                rcaGate.ok
                                    ? 'text-white hover:shadow-md'
                                    : 'text-slate-500 bg-slate-100 border border-slate-200 hover:bg-slate-200'
                            }`}
                            style={rcaGate.ok ? { background: 'linear-gradient(135deg, #0891b2, #0d9488)' } : undefined}
                            title={rcaGate.reason}
                        >
                            {rcaGate.ok ? <GitPullRequest size={14} /> : <Lock size={14} />} Raise RCA
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
                {/* Breathable: WO detail (incl. Tasks) uses the full page width. */}
                <div className="max-w-none">
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
                            onSave={handleSave}
                            saving={isSaving}
                        />
                    )}
                    {activeTab === 'jsa' && <JSATab job={localJob} onUpdate={updateJob} dictionaries={dictionaries} />}
                    {activeTab === 'resources' && <ResourcesTab job={localJob} users={users} contacts={contacts} onNavigateToTask={(taskId) => { setActiveTab('tasks'); }} dictionaries={dictionaries} />}
                    {activeTab === 'cost' && <CostTab job={localJob} refreshKey={costRefreshKey} />}
                    {activeTab === 'files' && <FilesTab job={localJob} onUpdate={updateJob} tasks={localJob.tasks || []} />}
                    {activeTab === 'analysis' && <AnalysisTab job={localJob} onUpdate={updateJob} dictionaries={dictionaries} isPreventive={isPreventiveType} onOpenCompleteModal={() => setShowCompleteModal(true)} followUpDescription={followUpDescription} onFollowUpDescriptionChange={setFollowUpDescription} assetClassCode={resolvedAssetClass} bomItems={bomItems} />}
                    {activeTab === 'discussion' && localJob.id && (
                        <div className="h-[60vh] border border-slate-200 rounded-xl overflow-hidden">
                            <ThreadPanel threadType="work_order" threadId={localJob.id} threadLabel={localJob.woNumber || 'this work order'} />
                        </div>
                    )}
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
                                            <ModernSelect
                                                placeholder="-- Select Failure Mode --"
                                                value={modalFailureMode}
                                                onChange={val => setModalFailureMode(val)}
                                                options={allFailureModes.map(fm => ({
                                                    value: fm.code,
                                                    label: `${fm.description} (${fm.code})`,
                                                    badge: fm.code,
                                                    badgeColor: 'bg-red-50 text-red-700 border-red-200'
                                                }))}
                                                size="sm"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Failure Cause (Optional)</label>
                                            <ModernSelect
                                                placeholder="-- Select Failure Cause --"
                                                value={modalFailureCause}
                                                onChange={val => setModalFailureCause(val)}
                                                options={allFailureCauses.map(fc => ({
                                                    value: fc.code,
                                                    label: `${fc.description} (${fc.code})`,
                                                    badge: fc.code,
                                                    badgeColor: 'bg-amber-50 text-amber-700 border-amber-200'
                                                }))}
                                                size="sm"
                                            />
                                        </div>
                                        {bomItems.length > 0 && (
                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Failed Component (Optional)</label>
                                                <select
                                                    className="w-full text-xs border border-slate-300 rounded-lg bg-white p-2"
                                                    value={modalFailedBomId}
                                                    onChange={e => setModalFailedBomId(e.target.value)}
                                                >
                                                    <option value="">-- Select from asset BOM --</option>
                                                    {bomItems.map((b: any) => (
                                                        <option key={b.id} value={b.id}>
                                                            {b.description}{b.partNumber ? ` (${b.partNumber})` : ''}{b.critical ? ' ⚠ critical' : ''}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}
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

                                {/* Actuals & Downtime (0283) — the fields MTTR/MTBF/availability actually run on */}
                                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                                    <span className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider">Actuals &amp; Downtime</span>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Actual Labour (hrs)</label>
                                            <input
                                                type="number" min="0" step="0.5"
                                                className="w-full text-xs border border-slate-300 rounded-lg bg-white p-2"
                                                placeholder="e.g. 4.5"
                                                value={modalActualHours}
                                                onChange={e => setModalActualHours(e.target.value)}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Equipment Downtime (hrs)</label>
                                            <input
                                                type="number" min="0" step="0.5"
                                                className="w-full text-xs border border-slate-300 rounded-lg bg-white p-2"
                                                placeholder="Blank = derive from window"
                                                value={modalDowntimeHours}
                                                onChange={e => setModalDowntimeHours(e.target.value)}
                                            />
                                        </div>
                                    </div>
                                    {!isPreventiveType && (
                                        <>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Malfunction Start</label>
                                                    <input
                                                        type="datetime-local"
                                                        className="w-full text-xs border border-slate-300 rounded-lg bg-white p-2"
                                                        value={modalMalfStart}
                                                        onChange={e => setModalMalfStart(e.target.value)}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Back in Service</label>
                                                    <input
                                                        type="datetime-local"
                                                        className="w-full text-xs border border-slate-300 rounded-lg bg-white p-2"
                                                        value={modalMalfEnd}
                                                        onChange={e => setModalMalfEnd(e.target.value)}
                                                    />
                                                </div>
                                            </div>
                                            <label className="flex items-start gap-2.5 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={modalBreakdown}
                                                    onChange={e => setModalBreakdown(e.target.checked)}
                                                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-red-600 focus:ring-red-500"
                                                />
                                                <span className="text-xs text-slate-700">
                                                    <span className="font-bold">Breakdown</span> — the equipment lost its required function
                                                    (drives true failure counts for MTBF; leave unchecked for degraded-but-running work)
                                                </span>
                                            </label>
                                            {localJob.failureData?.secondaryFailure === undefined && (
                                                <label className="flex items-start gap-2.5 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={modalCollateral}
                                                        onChange={e => setModalCollateral(e.target.checked)}
                                                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                                                    />
                                                    <span className="text-xs text-slate-700">
                                                        <span className="font-bold">Caused by another failure</span> — this was collateral damage
                                                        (charged to the cause, not this asset; link the causing WO afterwards in Analysis &amp; History → Around This Failure)
                                                    </span>
                                                </label>
                                            )}
                                            <p className="text-[10px] text-slate-400">
                                                The malfunction window is the failure event time used for MTBF — not the work order's paperwork dates.
                                                If downtime hours are blank, they are derived from the window.
                                            </p>
                                        </>
                                    )}
                                </div>

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
                                        let auditLogged = true;
                                        try {
                                            // insert() resolves with { error } rather than throwing,
                                            // so the catch alone would have missed every real DB
                                            // failure — an RLS denial included.
                                            // action must be INSERT/UPDATE/DELETE (CHECK constraint) and
                                            // changed_by is a UUID column — the old 'GATEKEEPER_CANCELLATION'
                                            // + email combo was rejected by the DB on every attempt. The
                                            // event identity lives in `changes` instead, as a real JSONB
                                            // object (stringifying wrote a quoted string into jsonb).
                                            const { error: auditErr } = await supabase.from('audit_logs').insert({
                                                table_name: 'work_orders',
                                                record_id: localJob.id,
                                                action: 'UPDATE',
                                                changed_by: user?.id || null,
                                                timestamp: new Date().toISOString(),
                                                changes: {
                                                    event: 'GATEKEEPER_CANCELLATION',
                                                    actor_email: user?.email || null,
                                                    wo_number: localJob.woNumber,
                                                    asset_id: localJob.assetId,
                                                    asset_code: localJob.assetCode || localJob.assetName,
                                                    criticality: 'A',
                                                    reason_for_rejection: gatekeeperReason.trim(),
                                                    signed_off_by: user?.user_metadata?.full_name || user?.email,
                                                    signed_off_at: new Date().toISOString(),
                                                },
                                            });
                                            if (auditErr) {
                                                auditLogged = false;
                                                console.error('[Gatekeeper] Audit log write failed:', auditErr.message);
                                            }
                                        } catch (thrown) {
                                            auditLogged = false;
                                            console.error('[Gatekeeper] Audit log write threw:', thrown);
                                        }

                                        // Proceed with cancellation. The reason rides in properties so
                                        // the server-side gatekeeper check (which requires it for any
                                        // crit-A CANC*) sees it — without this the save was rejected
                                        // with GATEKEEPER_BLOCKED after the modal was already approved.
                                        setShowGatekeeperModal(false);
                                        await updateJob({
                                            status: 'CANCELLED' as any,
                                            properties: {
                                                ...(localJob.properties || {}),
                                                rejection_reason: gatekeeperReason.trim(),
                                                rejection_signoff: user?.user_metadata?.full_name || user?.email || user?.id || 'unknown',
                                            },
                                        } as any, true);
                                        // Never claim an audit trail that was not written — this is a
                                        // Criticality A override, and the audit record is the only
                                        // evidence the rejection was authorised.
                                        showToast(
                                            auditLogged
                                                ? `⛔ WO ${localJob.woNumber || localJob.id} cancelled (Criticality A — Gatekeeper approved). Audit trail logged.`
                                                : `⛔ WO ${localJob.woNumber || localJob.id} cancelled (Criticality A — Gatekeeper approved), but the AUDIT RECORD FAILED TO WRITE. Record this rejection manually.`,
                                            auditLogged ? 'warning' : 'error'
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

            {/* Journal deletion removed (0285): journals are append-only records. */}
        </div>
    );
};

// --- Analysis Tab (New) ---

// Calm-screens: heavy record sections collapse to one-line strips so the tab
// isn't a wall of forms. State chips keep the pending work visible at a glance;
// content (and its queries) mounts only on expand.
const CompactSection: React.FC<{
    icon: React.ReactNode;
    title: string;
    summary?: React.ReactNode;
    defaultOpen?: boolean;
    children: React.ReactNode;
}> = ({ icon, title, summary, defaultOpen = false, children }) => {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm">
            <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-50/60 rounded-lg">
                {icon}
                <span className="font-bold text-xs md:text-sm text-slate-800">{title}</span>
                <span className="ml-auto flex items-center gap-2">
                    {summary}
                    <ChevronDown size={14} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                </span>
            </button>
            {open && <div className="px-3 pb-3 md:px-4 md:pb-4">{children}</div>}
        </div>
    );
};

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

const AnalysisTab: React.FC<{ job: WorkOrder; onUpdate: (u: Partial<WorkOrder>) => void, dictionaries: DictionaryEntry[], isPreventive?: boolean, onOpenCompleteModal?: () => void, followUpDescription?: string, onFollowUpDescriptionChange?: (val: string) => void, assetClassCode?: string, bomItems?: any[] }> = ({ job, onUpdate, dictionaries, isPreventive = false, onOpenCompleteModal, followUpDescription = '', onFollowUpDescriptionChange, assetClassCode, bomItems = [] }) => {
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
    const detectionMethods = useMemo(() => dictionaries.filter(d => d.type === 'DETECTION_METHOD' && d.active), [dictionaries]);
    // ISO 14224 level-7 subunits, scoped to the asset class like failure modes (0288)
    const subunits = useMemo(() => dictionaries.filter(d =>
        d.type === 'SUBUNIT' && d.active && (!d.categoryRef || d.categoryRef === assetClassCode)
    ), [dictionaries, assetClassCode]);

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
    const [localObjectPart, setLocalObjectPart] = useState(job.failureData?.objectPart || '');
    const [localEffects, setLocalEffects] = useState(job.failureData?.comments || '');
    const [localLocalImpact, setLocalLocalImpact] = useState(job.failureData?.localImpact || '');
    const [localPlantWideImpact, setLocalPlantWideImpact] = useState(job.failureData?.plantWideImpact || '');

    // Sync local state when job data changes from outside (e.g. after DB refetch)
    useEffect(() => {
        setLocalObjectPart(job.failureData?.objectPart || '');
    }, [job.failureData?.objectPart]);
    useEffect(() => {
        setLocalEffects(job.failureData?.comments || '');
    }, [job.failureData?.comments]);
    useEffect(() => {
        setLocalLocalImpact(job.failureData?.localImpact || '');
    }, [job.failureData?.localImpact]);
    useEffect(() => {
        setLocalPlantWideImpact(job.failureData?.plantWideImpact || '');
    }, [job.failureData?.plantWideImpact]);

    const flushObjectPart = () => {
        onUpdate({
            failureData: {
                ...job.failureData,
                objectPart: localObjectPart
            }
        });
    };

    // Failed-component picker (0287). Manual mode = a typed component with no
    // BOM link — either legacy data or "not in BOM".
    const [partManualMode, setPartManualMode] = useState(
        !job.failureData?.failedBomItemId && !!job.failureData?.objectPart
    );
    useEffect(() => {
        // Only ever FORCE a mode from data — never cancel the user's explicit
        // "type manually" choice while their text is still empty.
        if (job.failureData?.failedBomItemId) setPartManualMode(false);
        else if (job.failureData?.objectPart) setPartManualMode(true);
    }, [job.failureData?.failedBomItemId, job.failureData?.objectPart]);
    const selectedBomPart = job.failureData?.failedBomItemId
        ? bomItems.find((b: any) => b.id === job.failureData?.failedBomItemId)
        : undefined;
    const handleFailedComponentPick = (value: string) => {
        if (value === '__MANUAL__') {
            setPartManualMode(true);
            onUpdate({ failureData: { ...job.failureData, failedBomItemId: undefined, failedPartNo: undefined } });
            return;
        }
        if (!value) {
            setPartManualMode(false);
            setLocalObjectPart('');
            onUpdate({ failureData: { ...job.failureData, failedBomItemId: undefined, failedPartNo: undefined, objectPart: undefined } });
            return;
        }
        const bom = bomItems.find((b: any) => b.id === value);
        if (!bom) return;
        setPartManualMode(false);
        setLocalObjectPart(bom.description || '');
        onUpdate({
            failureData: {
                ...job.failureData,
                failedBomItemId: bom.id,
                failedPartNo: bom.partNumber || undefined,
                objectPart: bom.description || undefined,
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

    const [journalType, setJournalType] = useState('Note');
    const [showFollowUpConfirm, setShowFollowUpConfirm] = useState(false);

    const addJournal = () => {
        if (!note.trim()) return;
        const newJournal = {
            id: `j-${Date.now()}`,
            type: journalType,
            entry: note,
            createdBy: profile?.username || profile?.fullName || 'Unknown User',
            createdAt: new Date().toISOString(), // ISO — sortable and timezone-safe (0285)
            isSystem: false
        };
        onUpdate({ journals: [newJournal, ...(job.journals || [])] });
        // A "Follow-up" entry IS the follow-up request: it arms the
        // Complete & Raise Follow-Up action and rides into the new WO.
        if (journalType === 'Follow-up') onFollowUpDescriptionChange?.(note);
        setNote('');
    };

    // Durable follow-up: the latest Follow-up journal seeds the description,
    // so the request survives reloads instead of living in screen state.
    useEffect(() => {
        if (followUpDescription) return;
        const fu = (job.journals || []).find((j: any) => j.type === 'Follow-up');
        if (fu?.entry) onFollowUpDescriptionChange?.(fu.entry);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [job.journals]);

    // Journal delete: own, non-system entries, only while the WO is open —
    // at TECO the record freezes (append-only from then on). The archived
    // mirror row is deleted too; if that fails the entry would resurface,
    // so the user is told.
    const journalsLocked = ['TECO', 'CLOSED', 'CANC', 'CANCELLED'].includes(String(job.status));
    const canDeleteJournal = (j: any) =>
        !j.isSystem && !journalsLocked && j.createdBy === (profile?.username || profile?.fullName);
    const handleDeleteJournal = async (j: any) => {
        onUpdate({ journals: (job.journals || []).filter((x: any) => x.id !== j.id) });
        if (j.type === 'Follow-up' && followUpDescription === j.entry) onFollowUpDescriptionChange?.('');
        try {
            const { error } = await supabase
                .from('journal_entries')
                .delete()
                .eq('entity_id', job.id)
                .eq('client_id', j.id);
            if (error) showToast('Entry removed, but the archived copy could not be deleted — it may reappear on reload.', 'warning');
        } catch { /* non-blocking */ }
    };

    // Journals are APPEND-ONLY (0285): entries mirror into journal_entries as
    // the ISO 14224 record, so there is no edit or delete — a correction is a
    // new entry. Display-side date formatting handles both ISO and the legacy
    // locale strings older entries carry.
    const formatJournalDate = (s?: string) => {
        if (!s) return '';
        const t = Date.parse(s);
        return Number.isFinite(t) ? new Date(t).toLocaleString() : s;
    };

    const journalTypeColors: Record<string, string> = {
        'Note': 'bg-blue-100 text-blue-700',
        'Observation': 'bg-emerald-100 text-emerald-700',
        'Handover': 'bg-blue-100 text-blue-700',
        'Follow-up': 'bg-amber-100 text-amber-700',
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
    const { showToast } = useToast();
    const closeout = assessCloseout(job, { isPreventive });
    // Paid AI call — needs the work done and written up before there is anything
    // to review. Failure coding is not required: the review suggests it.
    const closeoutGate = canReviewCloseout(closeout);
    const handleReviewCloseout = () => {
        if (!closeoutGate.ok) { showToast(closeoutGate.reason, 'info'); return; }
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

    // ── Additional damage items (0288, SAP notification items) ──────────────
    // The primary damage record above drives the TECO gate and analytics;
    // extra faults found on the same job land here instead of vanishing in prose.
    const [failureItems, setFailureItems] = useState<any[]>([]);
    const reloadFailureItems = () => {
        if (!job.id) return;
        DatabaseService.getInstance().getFailureItems(job.id)
            .then(setFailureItems)
            .catch(() => setFailureItems([]));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { reloadFailureItems(); }, [job.id]);
    const [draftItem, setDraftItem] = useState({ subunit: '', mode: '', cause: '', bomId: '', part: '', comments: '' });
    const [addingItem, setAddingItem] = useState(false);
    const dictDesc = (type: string, code?: string | null) =>
        code ? (dictionaries.find(d => d.type === type && d.code === code)?.description || code) : '';
    const handleAddDamageItem = async () => {
        if (!draftItem.mode && !draftItem.bomId && !draftItem.part.trim()) {
            showToast('Give the damage item at least a failure mode or a component.', 'info');
            return;
        }
        setAddingItem(true);
        try {
            const bom = draftItem.bomId ? bomItems.find((b: any) => b.id === draftItem.bomId) : undefined;
            await DatabaseService.getInstance().addFailureItem({
                woId: job.id,
                subunitCode: draftItem.subunit || undefined,
                failureModeCode: draftItem.mode || undefined,
                failureCauseCode: draftItem.cause || undefined,
                failedBomItemId: bom?.id,
                failedPartNo: bom?.partNumber || undefined,
                objectPart: bom?.description || draftItem.part.trim() || undefined,
                comments: draftItem.comments.trim() || undefined,
            });
            setDraftItem({ subunit: '', mode: '', cause: '', bomId: '', part: '', comments: '' });
            reloadFailureItems();
        } catch (e: any) {
            showToast('Failed to add damage item: ' + e.message, 'error');
        }
        setAddingItem(false);
    };
    const handleRemoveDamageItem = async (id: string) => {
        try {
            await DatabaseService.getInstance().deleteFailureItem(id);
            reloadFailureItems();
        } catch (e: any) {
            showToast('Failed to remove damage item: ' + e.message, 'error');
        }
    };

    return (
        <div className="animate-in fade-in duration-300">
        {/* LinkedIn-style shell: a centered reading column with breathing space on both
            sides, plus a sticky action rail so the close-out CTA stays in view while
            the long form scrolls. Mobile keeps the single column (rail hidden; the CTA
            lives in the Follow-Up card instead). */}
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-3 md:gap-4 items-start">
        <div className="flex flex-col gap-3 md:gap-4 min-w-0">
            {/* ══ Closeout Quality (Gate 2) — advisory ══ */}
            <CloseoutReadinessStrip readiness={closeout} onReview={handleReviewCloseout} reviewGate={closeoutGate} />

            {/* ══ Asset Reliability context (Phase 4) — SMRP equipment-reliability KPIs ══ */}
            {relMetrics && relMetrics.totalFailures > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white p-3 md:p-4">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2"><AlertOctagon size={15} className="text-blue-600" /> Asset Reliability</h3>
                        <span className="text-[10px] text-slate-400 uppercase tracking-wide">last 12 months</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {([
                            // 0289 honesty rule: collateral events are excluded from the
                            // count but always shown, never silently dropped.
                            ['Failures (12mo)', relMetrics.collateral12mo > 0 ? `${relMetrics.failures12mo} +${relMetrics.collateral12mo} collateral` : String(relMetrics.failures12mo)],
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
                    {relMetrics.recurringParts.length > 0 && (
                        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap text-[11px]">
                            <span className="text-slate-500 font-semibold flex items-center gap-1"><Package size={11} /> Failing components:</span>
                            {relMetrics.recurringParts.slice(0, 4).map(p => (
                                <span key={p.part} className="px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200 font-semibold">{p.part} ×{p.count}</span>
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

            {/* Failure Analysis Card — full width of the reading column */}
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

                            {/* Detection + object part (0285, ISO 14224 Table B.4 / SAP catalog B).
                                Detection is the field that proves PM effectiveness: found-by-inspection
                                vs found-by-breakdown is the whole story. */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Detected By <span className="text-slate-400 font-normal">(Optional)</span></label>
                                    <SearchableSelect
                                        value={job.failureData?.detectionCode || ''}
                                        onChange={(val) => onUpdate({ failureData: { ...job.failureData, detectionCode: val } })}
                                        options={detectionMethods}
                                        placeholder="-- How was it found? --"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Subunit <span className="text-slate-400 font-normal">(ISO 14224 L7)</span></label>
                                    <select
                                        className="w-full p-2 border border-slate-300 rounded-lg text-xs bg-white focus:ring-1 focus:ring-primary-500"
                                        value={job.failureData?.subunitCode || ''}
                                        onChange={(e) => onUpdate({ failureData: { ...job.failureData, subunitCode: e.target.value || undefined } })}
                                    >
                                        <option value="">-- Which system of the asset? --</option>
                                        {subunits.map(s => (
                                            <option key={s.id} value={s.code}>{s.description}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Failed Component <span className="text-slate-400 font-normal">(Optional)</span></label>
                                    {bomItems.length > 0 ? (
                                        <>
                                            {/* Pick from the asset's BOM — the failure record lands on a real
                                                maintainable component (ISO 14224 level 8/9), not free text. */}
                                            <select
                                                className="w-full p-2 border border-slate-300 rounded-lg text-xs bg-white focus:ring-1 focus:ring-primary-500"
                                                value={partManualMode ? '__MANUAL__' : (job.failureData?.failedBomItemId || '')}
                                                onChange={(e) => handleFailedComponentPick(e.target.value)}
                                            >
                                                <option value="">-- Select from asset BOM --</option>
                                                {bomItems.map((b: any) => (
                                                    <option key={b.id} value={b.id}>
                                                        {b.description}{b.partNumber ? ` (${b.partNumber})` : ''}{b.critical ? ' ⚠ critical' : ''}
                                                    </option>
                                                ))}
                                                <option value="__MANUAL__">Other / not in BOM — type manually…</option>
                                            </select>
                                            {selectedBomPart?.inventoryItemId && (
                                                <p className="text-[10px] text-blue-500 mt-1 flex items-center gap-1">
                                                    <Package size={10} /> Linked to material {selectedBomPart.materialNumber || selectedBomPart.partNumber} — a follow-up corrective WO will pre-load this part.
                                                </p>
                                            )}
                                        </>
                                    ) : (
                                        <p className="text-[10px] text-slate-400 mb-1">No BOM on this asset — components can be typed below; add a BOM on the Asset page for coded records.</p>
                                    )}
                                    {(bomItems.length === 0 || partManualMode) && (
                                        <input
                                            type="text"
                                            value={localObjectPart}
                                            onChange={(e) => setLocalObjectPart(e.target.value)}
                                            onBlur={flushObjectPart}
                                            className={`w-full p-2 border border-slate-300 rounded-lg text-xs bg-white focus:ring-1 focus:ring-primary-500 ${bomItems.length > 0 ? 'mt-1.5' : ''}`}
                                            placeholder="e.g. DE bearing, mechanical seal..."
                                        />
                                    )}
                                </div>
                            </div>

                            {/* "Action Taken" removed: it was free prose duplicating the
                                journal AND polluting remedy_code (a code column). Narrative
                                lives in Journals; the completion modal owns the remedy. */}

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

            {/* ══ Around this failure (0289) — collapsed strip; the answer chip
                keeps the systems question visible without the bulk ══ */}
            {!isPreventive && (
                <CompactSection
                    icon={<Network className="text-blue-600" size={14} />}
                    title="Around This Failure"
                    summary={
                        job.failureData?.secondaryFailure === true
                            ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Collateral</span>
                            : job.failureData?.secondaryFailure === false
                                ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Primary failure</span>
                                : <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">Caused by another failure?</span>
                    }
                >
                    <AroundThisFailure job={job} onUpdate={onUpdate} embedded />
                </CompactSection>
            )}

            {/* ══ Additional damage items (0288) — collapsed strip ══ */}
            {!isPreventive && (
                <CompactSection
                    icon={<AlertTriangle className="text-orange-500" size={14} />}
                    title="Additional Damage Items"
                    summary={failureItems.length > 0
                        ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200">{failureItems.length}</span>
                        : <span className="text-[10px] text-slate-400">none</span>}
                >

                    {failureItems.length > 0 && (
                        <div className="mb-3 border border-slate-200 rounded-lg divide-y divide-slate-100 overflow-hidden">
                            {failureItems.map((it: any) => (
                                <div key={it.id} className="flex items-start gap-2 px-3 py-2 text-xs bg-slate-50/50">
                                    <span className="font-mono text-slate-400 flex-shrink-0 mt-0.5">#{it.seq}</span>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex flex-wrap gap-1.5">
                                            {it.subunit_code && <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-semibold">{dictDesc('SUBUNIT', it.subunit_code)}</span>}
                                            {it.object_part && <span className="px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 border border-orange-200 font-semibold">{it.object_part}{it.failed_part_no ? ` (${it.failed_part_no})` : ''}</span>}
                                            {it.failure_mode_code && <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 font-semibold">{dictDesc('FAILURE_MODE', it.failure_mode_code)}</span>}
                                            {it.failure_cause_code && <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">{dictDesc('FAILURE_CAUSE', it.failure_cause_code)}</span>}
                                        </div>
                                        {it.comments && <p className="text-slate-500 mt-1">{it.comments}</p>}
                                    </div>
                                    <button
                                        onClick={() => handleRemoveDamageItem(it.id)}
                                        className="p-1 text-slate-400 hover:text-red-600 rounded flex-shrink-0"
                                        title="Remove damage item"
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Add item */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <select
                            className="p-2 border border-slate-300 rounded-lg text-xs bg-white"
                            value={draftItem.subunit}
                            onChange={e => setDraftItem(d => ({ ...d, subunit: e.target.value }))}
                        >
                            <option value="">Subunit…</option>
                            {subunits.map(s => <option key={s.id} value={s.code}>{s.description}</option>)}
                        </select>
                        <SearchableSelect
                            value={draftItem.mode}
                            onChange={val => setDraftItem(d => ({ ...d, mode: val }))}
                            options={failureModes}
                            placeholder="Failure mode…"
                            groupKey="categoryRef"
                        />
                        <select
                            className="p-2 border border-slate-300 rounded-lg text-xs bg-white"
                            value={draftItem.cause}
                            onChange={e => setDraftItem(d => ({ ...d, cause: e.target.value }))}
                        >
                            <option value="">Cause…</option>
                            {failureCauses.map(c => <option key={c.id} value={c.code}>{c.description}</option>)}
                        </select>
                        {bomItems.length > 0 ? (
                            <select
                                className="p-2 border border-slate-300 rounded-lg text-xs bg-white"
                                value={draftItem.bomId}
                                onChange={e => setDraftItem(d => ({ ...d, bomId: e.target.value, part: '' }))}
                            >
                                <option value="">Component (from BOM)…</option>
                                {bomItems.map((b: any) => (
                                    <option key={b.id} value={b.id}>{b.description}{b.partNumber ? ` (${b.partNumber})` : ''}</option>
                                ))}
                            </select>
                        ) : (
                            <input
                                type="text"
                                className="p-2 border border-slate-300 rounded-lg text-xs bg-white"
                                placeholder="Component…"
                                value={draftItem.part}
                                onChange={e => setDraftItem(d => ({ ...d, part: e.target.value }))}
                            />
                        )}
                        <input
                            type="text"
                            className="p-2 border border-slate-300 rounded-lg text-xs bg-white"
                            placeholder="Comments…"
                            value={draftItem.comments}
                            onChange={e => setDraftItem(d => ({ ...d, comments: e.target.value }))}
                        />
                        <button
                            onClick={handleAddDamageItem}
                            disabled={addingItem}
                            className="px-3 py-2 bg-slate-800 text-white text-xs font-bold rounded-lg hover:bg-slate-700 disabled:opacity-50 flex items-center justify-center gap-1.5"
                        >
                            {addingItem ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add Damage Item
                        </button>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-2">
                        The primary failure coding above drives the completion gate and reliability KPIs; damage items record the additional faults found on the same job.
                    </p>
                </CompactSection>
            )}

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
                            <option value="Follow-up">Follow-up</option>
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
                                        <span className="flex items-center gap-1.5">
                                            <span className="text-[10px] text-slate-400">{formatJournalDate(j.createdAt)}</span>
                                            {canDeleteJournal(j) && (
                                                <button
                                                    onClick={() => handleDeleteJournal(j)}
                                                    className="p-1 text-slate-300 hover:text-red-600 rounded"
                                                    title="Delete your entry (possible until the work order is completed)"
                                                >
                                                    <Trash2 size={11} />
                                                </button>
                                            )}
                                        </span>
                                    </div>
                                    <div className="text-[11px] font-semibold text-slate-600 mb-0.5">{j.createdBy}</div>
                                    <p className="text-xs text-slate-600 whitespace-pre-wrap">{j.entry}</p>
                                    {(j as any).editedAt && (
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

            {/* Follow-Up — embedded in Journals: a "Follow-up" journal entry IS the
                request. This strip just reflects the armed/disarmed state. */}
            <div className={`rounded-lg border p-3 flex items-start gap-2.5 ${followUpDescription.trim() ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200'}`}>
                <GitPullRequest size={14} className={`flex-shrink-0 mt-0.5 ${followUpDescription.trim() ? 'text-amber-600' : 'text-slate-400'}`} />
                <div className="flex-1 min-w-0">
                    {followUpDescription.trim() ? (
                        <>
                            <p className="text-xs font-bold text-amber-800">Follow-up armed — will be raised as a corrective WO at completion:</p>
                            <p className="text-[11px] text-amber-700 mt-0.5 line-clamp-2">{followUpDescription}</p>
                        </>
                    ) : (
                        <p className="text-xs text-slate-500">
                            {isPreventive
                                ? 'Found a defect during this inspection? Add a journal entry of type '
                                : 'Need remediation work after this job? Add a journal entry of type '}
                            <span className="font-bold text-amber-700">Follow-up</span> above — it arms the
                            <span className="font-semibold"> Complete &amp; Raise Follow-Up</span> action and rides into the new work order.
                        </p>
                    )}
                </div>
                <button
                    onClick={() => onOpenCompleteModal?.()}
                    disabled={!followUpDescription.trim()}
                    className={`flex-shrink-0 px-3 py-2 border-2 border-dashed font-bold rounded-lg flex items-center gap-1.5 text-xs transition-all ${followUpDescription.trim()
                        ? 'bg-amber-100 border-amber-400 text-amber-800 hover:bg-amber-200 cursor-pointer'
                        : 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed'}`}
                >
                    <AlertTriangle size={14} /> Complete &amp; Raise Follow-Up
                </button>
            </div>

            {/* ══ Change History — collapsed strip; the audit query only fires on expand ══ */}
            <CompactSection
                icon={<Clock className="text-slate-500" size={14} />}
                title="Change History"
                summary={<span className="text-[10px] text-slate-400">audit trail — append-only</span>}
            >
                <AuditTrail entityId={job.id} tableName="work_orders" limit={40} compact />
            </CompactSection>
        </div>

        {/* ── Sticky action rail (desktop) — LinkedIn-style right column that keeps
            the close-out CTA in view while the long form scrolls ── */}
        <aside className="hidden lg:block sticky top-2">
            <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex flex-col gap-3">
                <h3 className="font-bold text-xs text-slate-800 border-b border-slate-100 pb-2 flex items-center gap-1.5">
                    <GitPullRequest className="text-amber-600" size={14} /> Close-Out
                </h3>
                <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wide">Close-out quality</span>
                    <span className={`text-sm font-extrabold ${closeout.score >= 80 ? 'text-emerald-600' : closeout.score >= 50 ? 'text-amber-600' : 'text-red-600'}`}>{closeout.score}%</span>
                </div>
                {closeout.blockers.length > 0 && (
                    <p className="text-[10px] text-slate-400 -mt-1.5">Missing: {closeout.blockers.map(b => b.label).join(', ')}</p>
                )}
                <button
                    onClick={() => onOpenCompleteModal?.()}
                    className="w-full px-4 py-2.5 border-2 border-dashed font-bold rounded-lg flex items-center justify-center gap-2 transition-all text-sm bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100 hover:border-amber-400"
                >
                    <AlertTriangle size={16} /> Complete &amp; Raise Follow-Up
                </button>
                <p className="text-[10px] text-slate-400">
                    {followUpDescription.trim()
                        ? 'Your follow-up description will seed the corrective work order.'
                        : 'Optional: describe the follow-up under Journals & Notes — otherwise an auto-generated summary is used.'}
                </p>
            </div>
        </aside>
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
    /** Gate on the Specialist review — a paid AI call. Blocked = greyed, but still
     *  clickable so the handler can explain what's missing instead of firing. */
    reviewGate?: ActionGate;
    isExpanded?: boolean;
    onToggleExpand?: () => void;
}> = ({ title, readiness, readyText, incompleteText, scoreTitle, leftBadges, reviewLabel = 'Review with Specialist', onReview, reviewGate, isExpanded, onToggleExpand }) => {
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
                        {onReview && (() => {
                            const blocked = reviewGate ? !reviewGate.ok : false;
                            return (
                                <button
                                    onClick={onReview}
                                    aria-disabled={blocked}
                                    title={reviewGate ? reviewGate.reason : 'Have the Reliability Specialist review this'}
                                    className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm transition-all ${
                                        blocked
                                            ? 'text-slate-500 bg-slate-100 border border-slate-200 hover:bg-slate-200'
                                            : 'text-white bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700'
                                    }`}
                                >
                                    {blocked ? <Lock size={11} /> : <Sparkles size={11} />} {reviewLabel}
                                </button>
                            );
                        })()}
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
    reviewGate?: ActionGate;
    isExpanded?: boolean;
    onToggleExpand?: () => void;
}> = ({ readiness, onReview, reviewGate, isExpanded, onToggleExpand }) => {
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
            reviewGate={reviewGate}
            isExpanded={isExpanded}
            onToggleExpand={onToggleExpand}
        />
    );
};

const CloseoutReadinessStrip: React.FC<{ readiness: ReadinessResult; onReview?: () => void; reviewGate?: ActionGate }> = ({ readiness, onReview, reviewGate }) => (
    <GateStrip
        title="Closeout Quality"
        readiness={readiness}
        readyText="Closeout essentials captured — quality record."
        incompleteText={(n) => `${n} closeout item${n === 1 ? '' : 's'} needed before closing.`}
        scoreTitle={`Closeout quality: ${readiness.score}%`}
        leftBadges={<span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${readiness.requiredMet ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-amber-100 text-amber-700 border-amber-200'}`}>{readiness.requiredMet ? 'Ready to close' : 'Incomplete'}</span>}
        reviewLabel="Review closeout with Specialist"
        onReview={onReview}
        reviewGate={reviewGate}
    />
);

// --- Other Tabs (Unchanged except minor prop threading if needed, mostly static in this refactor) ---

const DetailsTab: React.FC<{ job: WorkOrder, onUpdate: (u: Partial<WorkOrder>) => void, dictionaries: DictionaryEntry[] }> = ({ job, onUpdate, dictionaries }) => {
    // Default expanded: this state only gates the field cards on < lg screens
    // (desktop always shows them via `hidden lg:block`), and collapsed-by-default
    // left the mobile Details tab as a near-blank page under the readiness strip.
    const [isFieldsExpanded, setIsFieldsExpanded] = useState(true);
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
    const navigateToWo = useNavigate();

    // D1: what did we learn last time — finished WOs on the same asset, most
    // recent first, one click away (derived from the already-loaded WO list).
    const pastWork = useMemo(() => {
        if (!job.assetId) return [];
        const finished = new Set(['TECO', 'CLOSED', 'CANC', 'CANCELLED', 'COMPLETED']);
        const when = (w: any) => new Date(w.dueDate || w.due_date || w.createdAt || w.created_at || 0).getTime();
        return (pickWOs as any[])
            .filter(w => (w.assetId || w.asset_id) === job.assetId && w.id !== job.id && finished.has(String(w.status)))
            .sort((a, b) => when(b) - when(a))
            .slice(0, 4);
    }, [pickWOs, job.assetId, job.id]);

    // Follow-up chain, parent → children: WOs raised from this one (e.g.
    // "Complete & Raise Follow-Up"). The link was persisted at creation but
    // never rendered in either direction.
    const followUps = useMemo(() => {
        const when = (w: any) => new Date(w.createdAt || w.created_at || 0).getTime();
        return (pickWOs as any[])
            .filter(w => (w.parentWoId || w.parent_wo_id) === job.id)
            .sort((a, b) => when(b) - when(a));
    }, [pickWOs, job.id]);
    // Main Work Center (0178): active work groups for the header-level picker.
    const [detailWorkCenters, setDetailWorkCenters] = useState<{ id: string; code: string; name: string }[]>([]);
    useEffect(() => {
        DatabaseService.getInstance().getAssets().then(a => setPickAssets(a || [])).catch(() => {});
        DatabaseService.getInstance().getWorkOrders().then(w => setPickWOs((w as any[]) || [])).catch(() => {});
        DatabaseService.getInstance().getWorkCenters(true).then((w: any[]) => setDetailWorkCenters(w || [])).catch(() => setDetailWorkCenters([]));
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
    const { showToast } = useToast();
    // The review is a paid AI call: it only runs once the plan is actually planned.
    const planGate = canReviewPlan(readiness);
    const handleReviewPlan = () => {
        if (!planGate.ok) { showToast(planGate.reason, 'info'); return; }
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

    // ── Actuals (0283) ── captured in the Complete modal; rendered here so the
    // record is readable and correctable. Correction stays open until FINANCIAL
    // close (CLOSED), matching the cost-freeze rule in 0284 — TECO is technical
    // completion, not the end of postings.
    const actualsLocked = job.status === WorkOrderStatus.CLOSED;
    const hasActuals = !!(job.actualDuration || job.actualDowntime || job.malfunctionStart || job.malfunctionEnd || job.breakdown);
    // <input type="datetime-local"> needs local 'YYYY-MM-DDTHH:mm', not a UTC ISO string.
    const toLocalInput = (iso?: string) => {
        if (!iso) return '';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    };
    const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : undefined);

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
                    reviewGate={planGate}
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
                            {/* STATUS_CODE is a merged dictionary (WO + request + PM statuses, 0038a).
                                Only wo_status enum members are offerable — picking e.g. REVIEW or
                                APPROVED produced a raw Postgres enum-cast error. */}
                            {dictionaries.filter(d => d.type === 'STATUS_CODE' && d.active && WO_STATUS_ENUM.includes(String(d.code).toUpperCase())).map(s => (
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

                    {/* Past work on this asset — the knowledge-capture answer:
                        what happened last time, with its discussion a click away */}
                    {pastWork.length > 0 && (
                        <div className="md:col-span-2">
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Past work on this asset</label>
                            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 bg-slate-50/50 overflow-hidden">
                                {pastWork.map((w: any) => (
                                    <button
                                        key={w.id}
                                        type="button"
                                        onClick={() => navigateToWo(`/work-orders/${w.id}`)}
                                        title="Open this past work order — its plan, findings and discussion"
                                        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-blue-50 transition-colors"
                                    >
                                        <Clock size={12} className="text-slate-400 flex-shrink-0" />
                                        <span className="text-xs font-mono font-bold text-slate-600 flex-shrink-0">{w.woNumber || w.wo_number || '—'}</span>
                                        <span className="text-xs text-slate-600 truncate flex-1">{w.title}</span>
                                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-500 flex-shrink-0">{w.status}</span>
                                        <span className="text-[10px] text-slate-400 flex-shrink-0">
                                            {(() => { const d = w.dueDate || w.due_date || w.createdAt || w.created_at; return d ? new Date(d).toLocaleDateString() : ''; })()}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

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

                    {/* Follow-up chain (parent → children): inspection→defect→corrective traceability */}
                    {followUps.length > 0 && (
                        <div className="md:col-span-2">
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Follow-up work orders raised from this WO</label>
                            <div className="border border-amber-200 rounded-lg divide-y divide-amber-100 bg-amber-50/40 overflow-hidden">
                                {followUps.map((w: any) => (
                                    <button
                                        key={w.id}
                                        type="button"
                                        onClick={() => navigateToWo(`/work-orders/${w.id}`)}
                                        title="Open this follow-up work order"
                                        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-amber-50 transition-colors"
                                    >
                                        <GitPullRequest size={12} className="text-amber-500 flex-shrink-0" />
                                        <span className="text-xs font-mono font-bold text-slate-600 flex-shrink-0">{w.woNumber || w.wo_number || '—'}</span>
                                        <span className="text-xs text-slate-600 truncate flex-1">{w.title}</span>
                                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-500 flex-shrink-0">{w.status}</span>
                                        <span className="text-[10px] text-slate-400 flex-shrink-0">
                                            {(() => { const d = w.createdAt || w.created_at; return d ? new Date(d).toLocaleDateString() : ''; })()}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

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
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5" title="SAP Main Work Center — the work group responsible for executing this order. Per-operation work centers (costing) are set on the Tasks tab.">Main Work Group</label>
                        <select
                            className="w-full text-sm border border-slate-300 rounded-lg bg-white px-3 py-2.5"
                            value={job.workCenterId || ''}
                            onChange={(e) => onUpdate({ workCenterId: e.target.value || undefined })}
                        >
                            <option value="">-- No work group --</option>
                            {detailWorkCenters.map(wc => (
                                <option key={wc.id} value={wc.id}>{wc.code} — {wc.name}</option>
                            ))}
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

                            {/* ── Actuals (0283): what the job really took ── */}
                            <div className="pt-3 border-t border-slate-200">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs font-bold text-slate-500 uppercase">Actuals</span>
                                    <div className="flex items-center gap-1.5">
                                        {job.breakdown === true && (
                                            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">Breakdown</span>
                                        )}
                                        {actualsLocked && (
                                            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 flex items-center gap-1">
                                                <Lock size={9} /> Closed
                                            </span>
                                        )}
                                    </div>
                                </div>
                                {!hasActuals && (
                                    <p className="text-[11px] text-slate-400 mb-2">
                                        Recorded at completion — use <strong>Complete</strong> to capture actual hours, equipment downtime and the malfunction window.
                                    </p>
                                )}
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Actual Duration (Hrs)</label>
                                        <input
                                            type="number" min="0" step="0.5"
                                            value={job.actualDuration || ''}
                                            disabled={actualsLocked}
                                            onChange={(e) => onUpdate({ actualDuration: parseFloat(e.target.value) || 0 })}
                                            className={`w-full text-sm border rounded-lg px-3 py-2.5 ${actualsLocked ? 'bg-slate-100 border-slate-200 text-slate-500' : 'bg-white border-slate-300'}`}
                                            placeholder="0"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Actual Downtime (Hrs)</label>
                                        <input
                                            type="number" min="0" step="0.5"
                                            value={job.actualDowntime || ''}
                                            disabled={actualsLocked}
                                            onChange={(e) => onUpdate({ actualDowntime: parseFloat(e.target.value) || 0 })}
                                            className={`w-full text-sm border rounded-lg px-3 py-2.5 ${actualsLocked ? 'bg-slate-100 border-slate-200 text-slate-500' : 'bg-white border-slate-300'}`}
                                            placeholder="0"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Malfunction Start</label>
                                        <input
                                            type="datetime-local"
                                            value={toLocalInput(job.malfunctionStart)}
                                            disabled={actualsLocked}
                                            onChange={(e) => onUpdate({ malfunctionStart: fromLocalInput(e.target.value) })}
                                            className={`w-full text-sm border rounded-lg px-3 py-2.5 ${actualsLocked ? 'bg-slate-100 border-slate-200 text-slate-500' : 'bg-white border-slate-300'}`}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Back in Service</label>
                                        <input
                                            type="datetime-local"
                                            value={toLocalInput(job.malfunctionEnd)}
                                            disabled={actualsLocked}
                                            onChange={(e) => onUpdate({ malfunctionEnd: fromLocalInput(e.target.value) })}
                                            className={`w-full text-sm border rounded-lg px-3 py-2.5 ${actualsLocked ? 'bg-slate-100 border-slate-200 text-slate-500' : 'bg-white border-slate-300'}`}
                                        />
                                    </div>
                                </div>
                                <p className="text-[10px] text-slate-400 mt-1.5">
                                    Downtime drives MTTR and availability; the malfunction window is the failure event time used for MTBF. Leave downtime blank and it is derived from the window.
                                </p>
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
    const serviceCost = actuals?.serviceCost ?? 0;
    const anyWorkCenters = rows.some(r => r.wcLabel !== '—');
    const plannedParts = (job.inventory || []).reduce((s, i) => s + ((i.estQty || 0) * (i.estUnitCost || 0)), 0);
    const plannedTotal = plannedLabour + plannedParts;

    // Financial intelligence (moved here from the Resources tab so money lives in one place):
    // cost anomaly vs asset history, warranty flag, posted cost-centre allocations.
    const [allocations, setAllocations] = useState<CostAllocation[]>([]);
    const [warrantyCheck, setWarrantyCheck] = useState<WarrantyCheckResult | null>(null);
    const [anomaly, setAnomaly] = useState<CostAnomalyResult | null>(null);
    // FI-1 (0244) — how much of the actual has reached the ledger.
    const [settlement, setSettlement] = useState<WorkOrderSettlement | null>(null);
    const [settling, setSettling] = useState(false);
    const [postKey, setPostKey] = useState(0);
    const { showToast } = useToast();
    // Posting to the cost ledger is a finance write, not a maintenance one.
    // The trigger still settles automatically when the order finishes — this
    // gates only the manual re-run.
    const { permissions: costPermissions } = useAuth();
    const canSettle = costPermissions?.finops?.edit === true;

    useEffect(() => {
        if (!job.id || job.id.startsWith('new-')) return;
        let active = true;
        Promise.all([
            FinOpsService.getCostAllocations(job.id),
            job.assetId ? FinOpsService.checkWarrantyStatus(job.assetId) : Promise.resolve(null),
            job.assetId ? FinOpsService.detectCostAnomaly(job.assetId, job.type, plannedTotal) : Promise.resolve(null),
            FinOpsService.getWorkOrderSettlement(job.id),
        ]).then(([alloc, warranty, anom, settled]) => {
            if (!active) return;
            setAllocations(alloc);
            setWarrantyCheck(warranty);
            setAnomaly(anom);
            setSettlement(settled);
        }).catch(() => { /* advisory only — never block the cost roll-up */ });
        return () => { active = false; };
    }, [job.id, job.assetId, job.type, plannedTotal, postKey]);

    const handleSettle = async () => {
        setSettling(true);
        try {
            const posted = await FinOpsService.settleWorkOrder(job.id);
            showToast(
                posted.length === 0
                    ? 'Already settled — no cost movement to post.'
                    : `Settled: ${posted.length} posting${posted.length === 1 ? '' : 's'} to the cost ledger.`,
                'success',
            );
            setPostKey(k => k + 1);
        } catch (e: any) {
            showToast('Settlement failed: ' + (e?.message || 'unknown error'), 'error');
        } finally {
            setSettling(false);
        }
    };

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
                {job.status === 'CLOSED' && (
                    <span className="ml-auto text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-bold flex items-center gap-1">
                        <Lock size={10} /> Costs Frozen
                    </span>
                )}
            </div>

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

            {loading ? (
                <LoadingState label="Loading cost roll-up…" className="h-40" />
            ) : rows.length === 0 ? (
                <div className="text-center py-10 text-slate-400 bg-white border border-slate-200 rounded-card">
                    <ClipboardList size={32} className="mx-auto mb-2 opacity-20" />
                    <p className="text-sm">No operations yet. Add tasks on the <strong>Tasks</strong> tab and assign each a work center to cost it.</p>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        <SummaryCard label="Labour" planned={plannedLabour} actual={actualLabour} />
                        <div className="bg-white border border-slate-200 rounded-card p-4">
                            <div className="text-[11px] uppercase font-semibold tracking-wide text-slate-500">Parts</div>
                            <div className="mt-1 flex items-baseline gap-2">
                                <span className="text-2xl font-bold text-slate-800 tabular-nums">{money(partsCost)}</span>
                                <span className="text-xs text-slate-400">issued</span>
                            </div>
                            <div className="mt-1 text-xs text-slate-500 tabular-nums">Plan {money(plannedParts)}</div>
                        </div>
                        {/* SERVICE (0249) — contractor and service-PO cost. Shown as
                            "received" because ordering a service is a commitment;
                            only what has been received is cost. */}
                        <div className="bg-white border border-slate-200 rounded-card p-4">
                            <div className="text-[11px] uppercase font-semibold tracking-wide text-slate-500">Services</div>
                            <div className="mt-1 flex items-baseline gap-2">
                                <span className="text-2xl font-bold text-slate-800 tabular-nums">{money(serviceCost)}</span>
                                <span className="text-xs text-slate-400">received</span>
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                                {serviceCost > 0 ? 'From service PO lines on this order' : 'No service PO lines on this order'}
                            </div>
                        </div>
                        <div className="bg-primary-50 border border-primary-200 rounded-card p-4">
                            <div className="text-[11px] uppercase font-semibold tracking-wide text-primary-700">Total actual</div>
                            <div className="mt-1 text-2xl font-bold text-primary-700 tabular-nums">{money(actualLabour + partsCost + serviceCost)}</div>
                            <div className="mt-1 text-xs text-primary-600/70 tabular-nums">Plan {money(plannedTotal)} · labour + parts + services · settlement basis</div>
                        </div>
                    </div>

                    {/* FI-1 — settlement status. The order-to-cost spine ends here:
                        cost confirmed on the order vs cost the ledger actually has. */}
                    {settlement && (() => {
                        const unsettled = settlement.unsettledVariance;
                        const clear = Math.abs(unsettled) < 0.01;
                        const done = settlement.woState === 'done';
                        return (
                            <div className={`rounded-card border px-3 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs ${clear ? 'bg-emerald-50 border-emerald-200' : done ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                                <div className="flex items-center gap-1.5 font-bold uppercase text-[10px] tracking-wide">
                                    {clear ? <CheckCircle size={13} className="text-emerald-600" /> : <TrendingUp size={13} className="text-amber-600" />}
                                    <span className={clear ? 'text-emerald-700' : done ? 'text-amber-700' : 'text-slate-600'}>
                                        {clear ? 'Settled to ledger' : done ? 'Awaiting settlement' : 'Accruing'}
                                    </span>
                                </div>
                                <span className="text-slate-600 tabular-nums">
                                    Posted <strong className="text-slate-800">{money(settlement.settledCost)}</strong> of {money(settlement.actualCost)}
                                </span>
                                {!clear && (
                                    <span className="text-amber-800 tabular-nums font-semibold">
                                        {money(unsettled)} not yet in the books
                                    </span>
                                )}
                                {settlement.lastSettledAt && (
                                    <span className="text-slate-400">last posted {new Date(settlement.lastSettledAt).toLocaleDateString()}</span>
                                )}
                                <button
                                    type="button"
                                    onClick={handleSettle}
                                    disabled={settling || clear || !canSettle}
                                    className="ml-auto px-2.5 py-1 rounded-md border border-slate-300 bg-white text-slate-700 font-semibold hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                                    title={
                                        !canSettle ? 'Your role cannot post to the cost ledger (FinOps edit required)'
                                            : clear ? 'Nothing to post — the ledger matches the order'
                                                : 'Post the outstanding cost to the cost ledger'
                                    }
                                >
                                    {settling ? 'Posting…' : 'Post settlement'}
                                </button>
                            </div>
                        );
                    })()}

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
                    {(job as any).scope === 'PROJECT' && (() => {
                        const spent = actualLabour + partsCost + serviceCost;
                        const budget = (job as any).budgetApproved || plannedTotal || 1;
                        const pct = Math.min(100, (spent / budget) * 100);
                        return (
                            <div className="bg-blue-50 border border-blue-100 rounded-card p-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <Briefcase size={13} className="text-blue-500" />
                                    <span className="text-[10px] font-bold text-blue-600 uppercase">Project Budget Envelope</span>
                                </div>
                                <div className="flex justify-between items-center mb-1">
                                    <span className="text-[10px] text-blue-500">Approved Budget</span>
                                    <span className="text-xs font-bold text-blue-700 tabular-nums">{money((job as any).budgetApproved || 0)}</span>
                                </div>
                                <div className="flex justify-between items-center mb-1.5">
                                    <span className="text-[10px] text-blue-500">Spent to Date</span>
                                    <span className="text-xs font-bold text-blue-700 tabular-nums">{money(spent)}</span>
                                </div>
                                <div className="w-full bg-white rounded-full h-2 overflow-hidden border border-blue-100">
                                    <div className={`h-full rounded-full transition-all duration-500 ${spent > budget ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
                                </div>
                                <div className="flex justify-between items-center mt-1">
                                    <span className="text-[10px] text-blue-400">{Math.round((spent / budget) * 100)}% consumed</span>
                                    <span className="text-[10px] font-medium text-blue-600 tabular-nums">{money(budget - spent)} remaining</span>
                                </div>
                            </div>
                        );
                    })()}

                    {allocations.length > 0 && (
                        <div className="bg-white border border-slate-200 rounded-card overflow-hidden">
                            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase">Cost Ledger Postings</div>
                            <table className="w-full text-left text-xs">
                                <thead className="bg-slate-50 font-bold text-slate-600">
                                    <tr>
                                        <th className="p-2 border-b">Date</th>
                                        <th className="p-2 border-b">Type</th>
                                        <th className="p-2 border-b">Cost Centre</th>
                                        <th className="p-2 border-b">Posted by</th>
                                        <th className="p-2 border-b text-right">Amount</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {allocations.map(a => {
                                        // A settlement run posts deltas, so a reversal is a
                                        // legitimate negative line — show it as one.
                                        const cc = a.costCenterId ? ccById.get(a.costCenterId) : undefined;
                                        return (
                                            <tr key={a.id} className="border-b last:border-0 hover:bg-slate-50">
                                                <td className="p-2 text-slate-500 whitespace-nowrap">{a.postingDate}</td>
                                                <td className="p-2">{a.costType}</td>
                                                <td className="p-2" title={a.costCenterId || undefined}>
                                                    {cc ? `${cc.code} · ${cc.name}` : (a.costCenterId ? 'Unknown cost centre' : <span className="text-red-600">No receiver</span>)}
                                                </td>
                                                <td className="p-2 text-slate-500">{a.source === 'WO_SETTLEMENT' ? 'Settlement' : a.source === 'WARRANTY_CREDIT' ? 'Warranty credit' : 'Manual'}</td>
                                                <td className={`p-2 text-right tabular-nums font-medium ${a.amount < 0 ? 'text-emerald-700' : 'text-slate-800'}`}>
                                                    {a.amount < 0 ? '−' : ''}{money(Math.abs(a.amount))}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    <p className="text-[11px] text-slate-400">
                        Actuals roll up from time confirmations posted on the Tasks tab (Do-work mode). Each confirmation is valued at its posted rate (person → craft → work centre, snapshotted at posting); the operation's planned/work-centre rate applies only to rows posted without one.
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
    onSave?: () => void;
    saving?: boolean;
}> = ({ job, onUpdate, availableOrgUnits, availableUsers, contacts, onUpdateJob, onOperationConfirmed, dictionaries, onSave, saving = false }) => {
    const confirm = useConfirm();
    const tasks = job.tasks || [];
    const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
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
        if (expandedTaskId === id) setExpandedTaskId(null); // close the drawer with its task
    };

    const updateTask = (id: string, updates: Partial<JobTask>) => {
        onUpdate(tasks.map(t => t.id === id ? { ...t, ...updates } : t));
    };

    const toggleExpand = (taskId: string) => {
        setExpandedTaskId(prev => prev === taskId ? null : taskId);
        setEditorTab('instructions'); // Reset tab on expand
    };

    // Slide-over drawer plumbing: which step is open, Esc to close, body scroll lock.
    const expandedIndex = tasks.findIndex(t => t.id === expandedTaskId);
    const expandedTask = expandedIndex >= 0 ? tasks[expandedIndex] : null;
    useEffect(() => {
        if (!expandedTaskId) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpandedTaskId(null); };
        window.addEventListener('keydown', onKey);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; };
    }, [expandedTaskId]);

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

                                {/* Task description — editable inline, clearly an input (bordered) */}
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
                                    {task.predecessorTaskId && (() => {
                                        const pred = tasks.find(t => t.id === task.predecessorTaskId);
                                        return pred ? (
                                            <span className="text-[10px] text-blue-500 font-medium flex items-center gap-0.5 mt-0.5">
                                                <ArrowRight size={9} className="rotate-180" /> After #{pred.sequence}
                                            </span>
                                        ) : null;
                                    })()}
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

            {/* Step popup — centered modal (MaintainX procedure-style: bold header, scrollable body) */}
            {expandedTask && (
                <div className="fixed inset-0 z-[60] flex items-stretch sm:items-center justify-center sm:p-6">
                    <div
                        className="absolute inset-0 bg-black/50 animate-in fade-in duration-200"
                        onClick={() => setExpandedTaskId(null)}
                    />
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label={`Step ${expandedIndex + 1}: ${expandedTask.description || 'Untitled step'}`}
                        className="relative w-full sm:max-w-3xl h-full sm:h-[90vh] bg-slate-50 sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 fade-in duration-200"
                    >
                        {/* Header — step identity + navigation */}
                        <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-5 py-3 bg-blue-600 text-white shrink-0">
                            <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-white/20 shrink-0">
                                {expandedIndex + 1}
                            </span>
                            <div className="flex-1 min-w-0">
                                <div className="font-semibold text-sm sm:text-base truncate">{expandedTask.description || 'Untitled step'}</div>
                                <div className="text-[10px] sm:text-[11px] text-blue-100">
                                    Step {expandedIndex + 1} of {tasks.length}
                                </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                                <button
                                    onClick={addTask}
                                    className="hidden sm:flex items-center gap-1 text-[11px] font-semibold px-2 py-1.5 rounded-lg bg-white/15 text-white hover:bg-white/25 transition-colors mr-1"
                                    title="Add a new step to this work order"
                                ><Plus size={13} /> New step</button>
                                <button
                                    onClick={() => setExpandedTaskId(tasks[expandedIndex - 1].id)}
                                    disabled={expandedIndex <= 0}
                                    className="p-1.5 rounded-lg text-blue-100 hover:bg-white/15 disabled:opacity-30 transition-colors"
                                    title="Previous step"
                                ><ChevronLeft size={16} /></button>
                                <button
                                    onClick={() => setExpandedTaskId(tasks[expandedIndex + 1].id)}
                                    disabled={expandedIndex >= tasks.length - 1}
                                    className="p-1.5 rounded-lg text-blue-100 hover:bg-white/15 disabled:opacity-30 transition-colors"
                                    title="Next step"
                                ><ChevronRight size={16} /></button>
                                <button
                                    onClick={() => setExpandedTaskId(null)}
                                    className="p-1.5 rounded-lg text-blue-100 hover:bg-white/15 ml-1 transition-colors"
                                    title="Close (Esc)"
                                ><X size={16} /></button>
                            </div>
                        </div>
                        {/* Step name — guide: name the step first, then write instructions below */}
                        <div className="px-3 sm:px-5 py-3 bg-white border-b border-slate-200 shrink-0">
                            <label className="text-[11px] font-bold uppercase tracking-wider text-blue-600 flex items-center gap-1.5 mb-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" /> Step name
                            </label>
                            <input
                                type="text"
                                value={expandedTask.description}
                                onChange={(e) => updateTask(expandedTask.id, { description: e.target.value })}
                                autoFocus={!expandedTask.description}
                                placeholder="What does this step do? e.g. Isolate and lock out main drive"
                                className={`w-full text-sm font-medium rounded-lg px-3 py-2 border outline-none transition-colors focus:ring-2 focus:ring-primary-400 focus:border-primary-600 ${
                                    !expandedTask.description
                                        ? 'border-amber-300 bg-amber-50/40 placeholder:text-amber-500/60'
                                        : 'border-slate-200 bg-white hover:border-slate-300'
                                }`}
                            />
                            {!expandedTask.description && (
                                <p className="text-[10px] text-amber-600 mt-1">Name this step first — then add instructions and resources below.</p>
                            )}
                        </div>
                        {/* Body */}
                        <div className="flex-1 overflow-y-auto overscroll-contain">
                            <TaskEditor
                                task={expandedTask}
                                onChange={(updates) => updateTask(expandedTask.id, updates)}
                                onDelete={() => deleteTask(expandedTask.id)}
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
                        {/* Footer — persist & exit actions (safe-area padded: the modal covers the bottom nav) */}
                        <div
                            className="flex items-center gap-2 px-3 sm:px-5 py-3 bg-white border-t border-slate-200 shrink-0"
                            style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
                        >
                            <button
                                onClick={() => deleteTask(expandedTask.id)}
                                className="flex items-center gap-1.5 text-xs font-semibold text-red-500 hover:text-red-600 hover:bg-red-50 px-2.5 py-2 rounded-lg transition-colors"
                                title="Delete this step from the work order"
                            >
                                <Trash2 size={13} /> Delete step
                            </button>
                            <span className="hidden sm:flex items-center gap-1 text-[10px] text-slate-400 ml-1">
                                <CheckCircle size={11} className="text-emerald-500" /> Changes auto-save as you edit
                            </span>
                            <div className="flex-1" />
                            <button
                                onClick={() => onSave?.()}
                                disabled={saving}
                                className="px-3.5 py-2 text-xs font-bold text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-60"
                                title="Save now and keep editing"
                            >
                                {saving ? 'Saving…' : 'Save'}
                            </button>
                            <button
                                onClick={() => { onSave?.(); setExpandedTaskId(null); }}
                                disabled={saving}
                                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-500 shadow-sm transition-colors disabled:opacity-60"
                                title="Save and return to the step list"
                            >
                                <Save size={13} /> Save & close
                            </button>
                        </div>
                    </div>
                </div>
            )}
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
    const promptModal = usePrompt();
    // WM-2b: resolved costing rate for this operation = per-op override ?? work-center rate.
    const selectedWorkCenter = workCenters.find(w => w.id === task.workCenterId);
    const effectiveRate = task.plannedRate ?? selectedWorkCenter?.activityRate;

    // WM-2c: time confirmation posting (IW41/CO11). Posts immediately, then refetches.
    // Rate + posting logic lives below, after taskLabor, so the confirmation can be
    // valued by the same cascade that priced the planned craft lines.
    const [confHours, setConfHours] = useState('');
    const [confUserId, setConfUserId] = useState('');
    const [confFinal, setConfFinal] = useState(false);
    const [posting, setPosting] = useState(false);
    const { user } = useAuth();

    // State for Picker
    const [isPartPickerOpen, setIsPartPickerOpen] = useState(false);

    const handleReturnToStores = async (part: JobInventory) => {
        const qtyStr = await promptModal({
            title: 'Return to Stores',
            message: `Return "${part.description || 'part'}" to warehouse inventory:`,
            defaultValue: '1',
            inputType: 'number',
            placeholder: 'Quantity...',
            confirmLabel: 'Return Item',
            icon: <Package size={20} className="text-amber-600" />
        });
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
                (user as any)?.username || 'unknown',
                // Returning an unused part to stores is a 262 (0245) — the
                // reversal of the 261 that issued it — not a stocktake
                // adjustment. Step 2 below drops the quantity on the order, so
                // settlement posts the credit; the movement is the stock record.
                { woId: jobContext.id, movementType: '262' }
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

    // Crew check (0191): members of this operation's work center, falling back to the
    // WO's main work center. Soft signal only — cross-crew assignment stays allowed.
    const crewWorkCenterId = task.workCenterId || jobContext.workCenterId;
    const crewWorkCenter = workCenters.find(w => w.id === crewWorkCenterId);
    const [crewContactIds, setCrewContactIds] = useState<Set<string> | null>(null);
    useEffect(() => {
        if (!crewWorkCenterId) { setCrewContactIds(null); return; }
        let cancelled = false;
        DatabaseService.getInstance().getWorkCenterMembers(crewWorkCenterId).then(members => {
            // Empty roster = membership not maintained for this crew; don't flag anyone.
            if (!cancelled) setCrewContactIds(members.length > 0 ? new Set(members.map(m => m.contactId)) : null);
        });
        return () => { cancelled = true; };
    }, [crewWorkCenterId]);
    const isOutsideCrew = (contact: any): boolean =>
        !!(crewContactIds && contact && !crewContactIds.has(contact.id));

    // Crew-first candidate pool: when the work centre has a maintained roster, the
    // People list defaults to that crew. Toggleable, and searching always bypasses it.
    const [crewFilterOn, setCrewFilterOn] = useState(true);
    const crewFilterActive = crewFilterOn && !!crewContactIds;

    // Craft ↔ work-centre coverage: can this crew staff a planned craft at all?
    // Data-driven (roster crafts, not label matching); null = no roster, no signal.
    const crewCoversCraft = (roleCode: string): boolean | null => {
        if (!crewContactIds || !roleCode) return null;
        return contacts.some((c: any) => crewContactIds.has(c.id) &&
            (((c.types || []) as string[]).includes(roleCode) || c.defaultType === roleCode));
    };

    // Helper: Get role description from dictionary
    const getRoleLabel = (roleCode?: string): string => {
        if (!roleCode) return '';
        const entry = dictionaries.find(d => d.type === 'CONTACT_TYPE' && d.code === roleCode && d.active);
        return entry?.description || roleCode;
    };

    // Labor lines may carry a contact id or a user id (work_order_labor.contact_id
    // FKs users(id) since 0071) — resolve to the contact record either way.
    const contactFromAnyId = (id?: string): any => {
        if (!id) return undefined;
        const direct = contacts.find((c: any) => c.id === id);
        if (direct) return direct;
        const u = availableUsers.find(us => us.id === id);
        return u ? contacts.find((c: any) => c.id === u.contactId) : undefined;
    };

    // Rate cascade, shared with time confirmations so estimates and actuals are
    // valued on the same basis: person override → role rate → work-centre rate → default.
    const resolveRate = (roleCode: string, contactId?: string): number =>
        resolveLabourRate({ contactId: contactFromAnyId(contactId)?.id, roleCode, contacts, dictionaries, workCenterRate: effectiveRate }).rate;

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

    // WM-2c: default the confirmation's "worked by" to the person most likely posting
    // time — the signed-in user when they're on the job, else the sole assignee.
    useEffect(() => {
        const assigned = task.assignedUserIds || [];
        const me = availableUsers.find(u => u.id === (user as any)?.id || u.username === (user as any)?.username);
        if (me && (assigned.length === 0 || assigned.includes(me.id))) setConfUserId(me.id);
        else if (assigned.length === 1) setConfUserId(assigned[0]);
        else setConfUserId('');
        // Re-defaults per operation only — a manual pick mid-edit shouldn't be fought over.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [task.id]);

    // Confirmation costing: the same cascade that priced the planned craft lines
    // (person → craft → work centre), so actuals land on the plan's rate basis.
    const confCosting = useMemo(() => {
        const confUser = availableUsers.find(u => u.id === confUserId);
        const confContact = confUser ? contacts.find((c: any) => c.id === confUser.contactId) : undefined;
        const leadLine = taskLabor.find(l => l.isLead) || taskLabor[0];
        let roleCode: string | undefined;
        if (confContact) {
            // Craft for the posting: the planned line this person staffs, else their default craft.
            const held = new Set<string>([...((confContact.types || []) as string[]), confContact.defaultType].filter(Boolean));
            roleCode = taskLabor.find(l => l.contactType && held.has(l.contactType))?.contactType
                || confContact.defaultType || undefined;
        } else {
            roleCode = leadLine?.contactType || undefined;
        }
        const { rate, source } = resolveLabourRate({
            contactId: confContact?.id,
            roleCode,
            contacts,
            dictionaries,
            workCenterRate: effectiveRate,
        });
        // Post the USER id — work_order_labor.contact_id FKs users(id) (0071).
        return { rate, source, roleCode, userId: confUser?.id as string | undefined };
    }, [confUserId, availableUsers, contacts, dictionaries, taskLabor, effectiveRate]);

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
                contactId: confCosting.userId,
                contactType: confCosting.roleCode,
                ratePerHour: confCosting.rate,
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
        // When actively searching, bypass the crew and craft filters so supervisors can find anyone
        const isSearching = resourceSearchPeople.trim().length > 0;
        const assignedIds = new Set(task.assignedUserIds || []);
        // Crew-first: default candidate pool = the work centre's roster (assigned people stay visible)
        const pool = (!isSearching && crewFilterActive)
            ? displayedUsers.filter(({ user, contact }) => (contact && crewContactIds!.has(contact.id)) || assignedIds.has(user.id))
            : displayedUsers;
        const base = (!isSearching && plannedRoleCodes.size > 0)
            ? pool.filter(({ user, contact }) => isQualifiedForPlannedRoles(contact) || assignedIds.has(user.id))
            : pool;
        return [...base].sort((a, b) => {
            // Sort assigned people first, then by name
            const aAssigned = assignedIds.has(a.user.id) ? 0 : 1;
            const bAssigned = assignedIds.has(b.user.id) ? 0 : 1;
            if (aAssigned !== bAssigned) return aAssigned - bAssigned;
            const nameA = a.contact?.name || a.user.username || '';
            const nameB = b.contact?.name || b.user.username || '';
            return nameA.localeCompare(nameB);
        });
    }, [displayedUsers, plannedRoleCodes, resourceSearchPeople, task.assignedUserIds, crewFilterActive, crewContactIds]);

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
                        className={`flex-1 min-w-0 px-1.5 py-1 text-xs border rounded focus:ring-1 focus:ring-primary-500 ${!task.workCenterId ? 'border-blue-300 bg-blue-50/60 text-blue-700 font-medium' : 'border-slate-200 text-slate-600'}`}
                        title="Work center — the crew this operation is routed to and costed at"
                    >
                        <option value="">Choose work center…</option>
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
                            className={`px-1.5 py-0.5 text-xs border rounded focus:ring-1 focus:ring-primary-500 max-w-[170px] ${!task.workCenterId ? 'border-blue-300 bg-blue-50/60 text-blue-700 font-medium' : 'border-slate-200 text-slate-600'}`}
                        >
                            <option value="">Choose work center…</option>
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
                    <select
                        value={confUserId}
                        onChange={(e) => setConfUserId(e.target.value)}
                        className="px-1.5 py-1 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-blue-500 max-w-[160px] text-slate-700"
                        title="Worked by — the posting is valued at this person's resolved rate (person → craft → work centre)"
                    >
                        <option value="">Worked by…</option>
                        {sortedAssignableUsers.map(({ user: u, contact }) => (
                            <option key={u.id} value={u.id}>{contact?.name || u.username}</option>
                        ))}
                    </select>
                    <input
                        type="number"
                        min={0}
                        step="0.5"
                        value={confHours}
                        onChange={(e) => setConfHours(e.target.value)}
                        placeholder="Hours"
                        className="w-20 px-2 py-1 text-xs text-right border border-slate-200 rounded focus:ring-1 focus:ring-blue-500"
                    />
                    {parseFloat(confHours) > 0 && (
                        <span className="text-[11px] text-slate-500" title="Same rate cascade as planning, so est-vs-actual variance stays a pure hours signal">
                            ≈ {(parseFloat(confHours) * confCosting.rate).toFixed(2)} @ ${confCosting.rate}/hr · {labourRateSourceLabel[confCosting.source]}
                        </span>
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
                                title="Import from task library"
                                className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                            >
                                <Book size={12} />
                                <span className="hidden sm:inline">Import Template</span>
                            </button>
                        </div>
                    </div>

                    {/* Collapsible Observations — directly under its toggle, above the builder,
                        so it never reads as a stray second notes section below the add palette */}
                    {showObservations && (
                        <div className="border-b border-slate-100 px-3 py-3 bg-slate-50">
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

                    <div className="p-2 sm:p-3">
                        <ProcedureBuilder
                            instructions={task.instructions || []}
                            onChange={(blocks) => onChange({ instructions: blocks })}
                            readOnly={(jobContext.status as string) === 'COMPLETED'}
                            mode={((jobContext.status as string) === 'COMPLETED' || execMode) ? 'EXECUTE' : 'EDIT'}
                        />
                    </div>
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
                                                        className="text-xs bg-white border border-slate-300 rounded-lg p-1.5 flex-1 cursor-pointer hover:border-slate-400 focus:ring-2 focus:ring-primary-400 focus:border-primary-600 transition-colors"
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
                                                    {/* Craft ↔ work-centre mismatch (soft): crew can't staff this craft */}
                                                    {labor.contactType && crewCoversCraft(labor.contactType) === false && (
                                                        <span
                                                            className="text-[9px] px-1 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200 shrink-0"
                                                            title={`No one in the ${[crewWorkCenter?.code, crewWorkCenter?.name].filter(Boolean).join(' ') || 'assigned work centre'} crew holds this craft — check the operation's work centre or plan cross-crew labour. Labour is costed at the craft/person rate; the work-centre rate applies only when neither is set.`}
                                                        >
                                                            ⚠ not in {crewWorkCenter?.code || 'crew'}
                                                        </span>
                                                    )}
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
                                    Filter by team
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
                                    {crewContactIds && (
                                        <div className="flex items-center gap-2 mb-1.5">
                                            <button
                                                type="button"
                                                onClick={() => setCrewFilterOn(v => !v)}
                                                className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold transition-colors shrink-0 ${crewFilterActive ? 'bg-emerald-100 border-emerald-300 text-emerald-700' : 'bg-white border-slate-200 text-slate-400 hover:text-slate-600'}`}
                                                title={crewFilterActive
                                                    ? `Showing the ${crewWorkCenter?.name || 'work centre'} crew — click to show everyone`
                                                    : `Click to limit the list to the ${crewWorkCenter?.name || 'work centre'} crew`}
                                            >
                                                {crewFilterActive ? '✓ ' : ''}Crew: {crewWorkCenter?.code || crewWorkCenter?.name || 'work centre'} ({crewContactIds.size})
                                            </button>
                                            <span className="text-[9px] text-slate-400">
                                                {crewFilterActive ? 'crew members only — search finds anyone' : 'showing everyone'}
                                            </span>
                                        </div>
                                    )}
                                    <input
                                        type="text"
                                        placeholder="Search by name, username, or craft..."
                                        value={resourceSearchPeople}
                                        onChange={(e) => setResourceSearchPeople(e.target.value)}
                                        className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg mb-1.5 focus:ring-2 focus:ring-primary-400 focus:border-primary-600"
                                    />
                                    {sortedAssignableUsers.length === 0 ? (
                                        <div className="border border-dashed border-slate-200 rounded-lg p-4 text-center">
                                            <Users size={20} className="mx-auto text-slate-300 mb-1" />
                                            <div className="text-[11px] text-slate-400">
                                                {crewFilterActive && !resourceSearchPeople.trim()
                                                    ? `No one from the ${crewWorkCenter?.code || 'crew'} roster is assignable — search to find anyone, or click the crew chip to show everyone`
                                                    : plannedRoleCodes.size > 0 || selectedTeamIds.size > 0
                                                        ? 'No matching people — check craft requirements and team selections'
                                                        : 'No people found — add contacts in the People module'}
                                            </div>
                                        </div>
                                    ) : (
                                        <>
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
                                                    const outsideCrew = isOutsideCrew(contact);
                                                    return (
                                                        <React.Fragment key={user.id}>
                                                            <label className={`flex items-center gap-2 p-1.5 cursor-pointer rounded-lg transition-colors ${isAssigned ? 'bg-emerald-50' : isInSelectedTeam ? 'bg-blue-50/50 ring-1 ring-blue-100' : 'hover:bg-slate-50'
                                                                }`}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={isAssigned}
                                                                    onChange={() => {
                                                                        if (!isAssigned && outsideCrew) {
                                                                            const wcLabel = [crewWorkCenter?.code, crewWorkCenter?.name].filter(Boolean).join(' ') || 'work center';
                                                                            showToast(`⚠ ${contact?.name || user.username} is not in the ${wcLabel} crew — assigned anyway.`, 'warning');
                                                                        }
                                                                        onChange({ assignedUserIds: toggleSelection(task.assignedUserIds, user.id) });
                                                                    }}
                                                                    className="rounded border-slate-300 h-3 w-3"
                                                                />
                                                                <span className={`text-xs flex-1 ${isQualified ? 'text-slate-700 font-medium' : 'text-slate-500'}`}>
                                                                    {contact?.name || user.username}
                                                                </span>
                                                                {isQualified && plannedRoleCodes.size > 0 && (
                                                                    <span className="text-[8px] px-1 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-200 shrink-0" title="Matches planned role">✓</span>
                                                                )}
                                                                {outsideCrew && (
                                                                    <span className="text-[8px] px-1 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200 shrink-0" title={`Not in the ${crewWorkCenter?.name || 'assigned work center'} crew — assignment still allowed`}>not in crew</span>
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
        const entries: { userId: string; userName: string; craft: string; taskName: string; taskId: string; estHours: number; actHours: number; isPlanning: boolean }[] = [];

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
                    isPlanning: false,
                });
            });
        });

        // 2. From standalone labor records (work_order_labor)
        (job.labor || []).forEach(l => {
            // contact_id may hold a contact id (legacy lines) or a user id (confirmations — the column FKs users(id)).
            const c = l.contactId
                ? (contacts.find((co: any) => co.id === l.contactId)
                    || contacts.find((co: any) => co.id === users.find((us: any) => us.id === l.contactId)?.contactId))
                : null;
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
                taskName: taskRef ? (taskRef.description || `Task ${taskRef.sequence}`) : 'Unassigned',
                taskId: part.jobTaskId || '',
            };
        });
    }, [job.tasks, job.inventory]);

    // --- KPI CALCULATIONS ---
    const assignedPeople = labourSummary.filter(l => !l.isPlanning);
    const planningRoles = labourSummary.filter(l => l.isPlanning);
    const uniquePeople = new Set(assignedPeople.map(l => l.userId)).size;
    const unfilledRoles = planningRoles.length;
    const totalEstHours = labourSummary.reduce((s, l) => s + l.estHours, 0);
    const totalActHours = labourSummary.reduce((s, l) => s + l.actHours, 0);

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

    return (
        <div className="space-y-3 md:space-y-4 animate-in fade-in duration-300">
            {/* KPI Stats Header */}
            <div className="grid grid-cols-3 gap-2 md:gap-3">
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
                                    <th className="text-right px-3 py-2 w-16">Act. H</th>
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
                                                <td className={`px-3 py-2 text-right font-bold ${entry.actHours > entry.estHours ? 'text-red-600' : 'text-emerald-600'}`}>
                                                    {entry.actHours.toFixed(1)}
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
                                    <td className={`px-3 py-2 text-right ${totalActHours > totalEstHours ? 'text-red-600' : 'text-emerald-600'}`}>{totalActHours.toFixed(1)}</td>
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
                                    <th className="text-right px-3 py-2 w-14">Act. Q</th>
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
                                                <td className={`px-3 py-2 text-right font-bold ${part.actQty > part.estQty ? 'text-red-600' : 'text-emerald-600'}`}>
                                                    {part.actQty}
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
                                    <td className="px-3 py-2 text-right text-emerald-600">{partsSummary.reduce((s, p) => s + p.actQty, 0)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}
            </div>

            {/* Info Notice */}
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 flex items-start gap-2">
                <Info size={14} className="text-blue-500 mt-0.5 shrink-0" />
                <div className="text-[10px] text-blue-700">
                    <strong>Resource management is task-based.</strong> To add or edit labour assignments and parts, go to the <strong>Tasks</strong> tab and expand a task.
                    This view summarises people, hours, and materials across all tasks — costs and settlement live on the <strong>Cost</strong> tab.
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
    // Same rule as the WO gates: no paid AI call when there is nothing to reason
    // about. With no strategies (or no PM history behind them) the model would be
    // inventing a programme rather than optimising one.
    const pmOptimiseBlocked = pms.length === 0
        ? 'Create at least one maintenance strategy before asking the Specialist to optimise the programme.'
        : pmEff.overall.written === 0
            ? 'No PM history yet — the Specialist optimises the programme from PM effectiveness results, so run some PM work orders first.'
            : '';
    const handleOptimizePMs = () => {
        if (pmOptimiseBlocked) { showToast(pmOptimiseBlocked, 'info'); return; }
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
                    <button
                        onClick={handleOptimizePMs}
                        aria-disabled={!!pmOptimiseBlocked}
                        className={`border px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${pmOptimiseBlocked ? 'border-slate-200 bg-slate-100 hover:bg-slate-200 text-slate-500' : 'border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700'}`}
                        title={pmOptimiseBlocked || 'Ask the Reliability Specialist which PMs to optimise or eliminate'}
                    >
                        {pmOptimiseBlocked ? <Lock size={16} /> : <Sparkles size={16} />} Optimise PMs
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
        // Same policy as the server-side TECO gate (lib/workOrder.ts): all
        // corrective work needs a failure mode. The old crit-A-only rule let
        // the client through only for the server to reject with TECO_BLOCKED.
        const requiresFailureCoding = !isPreventiveWoType(job.type);

        // Failure Coding enforcement
        if (requiresFailureCoding) {
            const fMode = selectedFailureModes[job.id];
            if (!fMode) {
                showToast("⛔ Failure Coding Required: a Failure Mode is mandatory to complete corrective work.", "error");
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
                        // Mirrors handleCompleteJob / the server TECO gate.
                        const requiresFailureCoding = !isPreventiveWoType(job.type);
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
