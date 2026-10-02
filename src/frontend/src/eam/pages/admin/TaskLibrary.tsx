import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
    Search, Plus, Edit2, Trash2, BookOpen, Wrench, HardHat, Package,
    ClipboardList, Clock, Layers, FileText, CheckSquare, X, Sparkles, Shield,
    Lock, GitBranch, AlertTriangle, Tag, ChevronUp, ChevronDown, ExternalLink
} from 'lucide-react';
import { DatabaseService } from '../../services/DatabaseService';
import { LibraryTask, LibraryTaskInventory, DictionaryEntry, InstructionBlock } from '../../types';
import { ProcedureBuilder } from '../../components/ProcedureBuilder';
import { DataList, Drawer, Badge, Button, EmptyState, cn } from '../../components/ui';
import type { DataColumn, Tone } from '../../components/ui';

import { useAuth } from '../../contexts/AuthContext';
import { useConfirm, usePrompt } from '../../contexts/ConfirmContext';

// Used only when the tenant's ASSET_CLASS dictionary is empty.
const FALLBACK_ASSET_CLASSES = ['PUMP', 'COMPRESSOR', 'TURBINE', 'MOTOR', 'GENERATOR', 'VALVE', 'HEAT_EXCHANGER',
    'VESSEL', 'PIPING', 'CRANE', 'CONVEYOR', 'INSTRUMENT', 'ELECTRICAL', 'HVAC', 'SAFETY_SYSTEM'];

const CATEGORIES: { code: LibraryTask['category']; label: string }[] = [
    { code: 'MAINTENANCE', label: 'Maintenance' },
    { code: 'INSPECTION', label: 'Inspection' },
    { code: 'SAFETY', label: 'Safety' },
    { code: 'PROJECT', label: 'Project' },
];

const CATEGORY_TONE: Record<string, Tone> = {
    MAINTENANCE: 'warning', INSPECTION: 'info', SAFETY: 'danger', PROJECT: 'purple', OTHER: 'neutral',
};

type SortKey = 'code' | 'title' | 'category' | 'version';
type Option = { code: string; description: string };

interface RoleLine { roleCode: string; quantity: number; estimatedHours: number }
interface PartLine { inventoryItemId: string; itemCode?: string; itemDescription?: string; uom?: string; quantity: number; notes?: string }
interface StockItem { id: string; code?: string; description?: string; uom?: string }
interface FileLine { name: string; url: string; type?: string; uploadedAt?: string }

// createNewVersion names a version "<base>-vN", so the family is the code without that suffix.
const familyOf = (code?: string) => String(code || '').trim().replace(/-v\d+$/i, '').toUpperCase();

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const CategoryBadge: React.FC<{ category: string }> = ({ category }) => (
    <Badge tone={CATEGORY_TONE[category] ?? 'neutral'} pill={false}>{category}</Badge>
);

const AssetClassChips: React.FC<{ codes?: string[]; labelOf: (code: string) => string; max?: number }> = ({ codes = [], labelOf, max }) => {
    if (codes.length === 0) return <span className="text-slate-300">—</span>;
    const shown = max ? codes.slice(0, max) : codes;
    const rest = codes.length - shown.length;
    return (
        <span className="inline-flex items-center gap-1 min-w-0 max-w-full" title={codes.map(labelOf).join(', ')}>
            {shown.map(code => (
                <span key={code} className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary-50 text-primary-700 border border-primary-200 truncate">
                    {code}
                </span>
            ))}
            {rest > 0 && <span className="text-[10px] font-semibold text-slate-400 flex-shrink-0">+{rest}</span>}
        </span>
    );
};

const DetailSection: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({ title, icon, children }) => (
    <section className="bg-white rounded-lg border border-slate-200 p-3.5">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-2 flex items-center gap-1.5">{icon}{title}</h3>
        {children}
    </section>
);

export const TaskLibraryManager: React.FC = () => {
    const { permissions, user } = useAuth();
    const confirm = useConfirm();
    const [tasks, setTasks] = useState<LibraryTask[]>([]);
    const [dictionaries, setDictionaries] = useState<DictionaryEntry[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
    const [selectedClass, setSelectedClass] = useState<string>('ALL');
    const [currentOnly, setCurrentOnly] = useState(true);
    const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'title', dir: 'asc' });
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [versioning, setVersioning] = useState(false);

    const [editingTask, setEditingTask] = useState<LibraryTask | null>(null);
    const [showModal, setShowModal] = useState(false);

    // Read-only detail drawer. The list row shows at once; roles/parts/files
    // arrive with the full fetch (the list query does not load them).
    const [detailId, setDetailId] = useState<string | null>(null);
    const [detailFull, setDetailFull] = useState<LibraryTask | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState<string | null>(null);
    const detailReq = useRef<string | null>(null);

    const db = DatabaseService.getInstance();

    const loadTasks = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const data = await db.getLibraryTasks();
            setTasks(data);
        } catch (e) {
            console.error("Failed to load library tasks", e);
            setLoadError(errText(e) || 'The library could not be loaded.');
        } finally {
            setLoading(false);
        }
    }, [db]);

    useEffect(() => {
        loadTasks();
        // Labels only — the page still works on codes if the dictionary is unavailable.
        db.getDictionaries().then(d => setDictionaries(d || [])).catch(() => setDictionaries([]));
    }, [db, loadTasks]);

    const assetClassLabels = useMemo(() => {
        const m = new Map<string, string>();
        dictionaries.filter(d => d.type === 'ASSET_CLASS').forEach(d => m.set(d.code, d.description || d.code));
        return m;
    }, [dictionaries]);
    const labelOfClass = useCallback((code: string) => assetClassLabels.get(code) || code.replace(/_/g, ' '), [assetClassLabels]);

    const assetClassOptions = useMemo<Option[]>(() => {
        const dict = dictionaries.filter(d => d.type === 'ASSET_CLASS' && d.active)
            .map(d => ({ code: d.code, description: d.description || d.code }))
            .sort((a, b) => a.description.localeCompare(b.description));
        return dict.length > 0 ? dict : FALLBACK_ASSET_CLASSES.map(c => ({ code: c, description: c.replace(/_/g, ' ') }));
    }, [dictionaries]);

    // Labour on a template is a craft — the same CONTACT_TYPE roles the work-order
    // labour picker and the labour-rate cascade (lib/labourRate) resolve against.
    const craftOptions = useMemo<Option[]>(() => dictionaries
        .filter(d => d.type === 'CONTACT_TYPE' && d.active && !d.isManufacturer)
        .map(d => ({ code: d.code, description: d.description || d.code }))
        .sort((a, b) => a.description.localeCompare(b.description)), [dictionaries]);

    // A template is superseded when its family holds a higher version, or a
    // newer template names it as parent (covers a code that was renamed).
    const supersededIds = useMemo(() => {
        const top = new Map<string, number>();
        for (const t of tasks) {
            const f = familyOf(t.code);
            if (f) top.set(f, Math.max(top.get(f) ?? 0, t.version || 1));
        }
        const out = new Set<string>();
        for (const t of tasks) {
            const f = familyOf(t.code);
            if (f && (t.version || 1) < (top.get(f) ?? 0)) out.add(t.id);
            if (t.parentTaskId) out.add(t.parentTaskId);
        }
        return out;
    }, [tasks]);

    const classesInUse = useMemo(() => {
        const codes = new Set<string>();
        tasks.forEach(t => (t.assetClassCodes || []).forEach(c => codes.add(c)));
        return [...codes].sort((a, b) => labelOfClass(a).localeCompare(labelOfClass(b)));
    }, [tasks, labelOfClass]);

    const filteredTasks = useMemo(() => {
        const q = searchTerm.trim().toLowerCase();
        const rows = tasks.filter(t => {
            if (selectedCategory !== 'ALL' && t.category !== selectedCategory) return false;
            if (selectedClass !== 'ALL' && !(t.assetClassCodes || []).includes(selectedClass)) return false;
            if (currentOnly && supersededIds.has(t.id)) return false;
            if (!q) return true;
            const classes = (t.assetClassCodes || []).map(c => `${c} ${labelOfClass(c)}`).join(' ');
            return `${t.code || ''} ${t.title || ''} ${t.description || ''} ${classes}`.toLowerCase().includes(q);
        });
        const dir = sort.dir === 'asc' ? 1 : -1;
        const text = (t: LibraryTask) => String(sort.key === 'code' ? t.code : sort.key === 'category' ? t.category : t.title) || '';
        return rows.sort((a, b) => {
            const primary = sort.key === 'version'
                ? (a.version || 1) - (b.version || 1)
                : text(a).localeCompare(text(b), undefined, { numeric: true, sensitivity: 'base' });
            return (primary || String(a.code || '').localeCompare(String(b.code || ''), undefined, { numeric: true })) * dir;
        });
    }, [tasks, searchTerm, selectedCategory, selectedClass, currentOnly, supersededIds, labelOfClass, sort]);

    const hiddenOlder = useMemo(
        () => (currentOnly ? tasks.filter(t => supersededIds.has(t.id)).length : 0),
        [tasks, supersededIds, currentOnly]
    );

    // Permission guard AFTER all hooks — an early return between hook calls
    // changes the hook count across renders and crashes React.
    if (permissions && !permissions.taskLibrary?.view) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-slate-400">
                <Shield size={64} className="mb-4 opacity-20" />
                <h2 className="text-xl font-bold text-slate-700">Access Denied</h2>
                <p className="text-sm text-slate-500 mt-2">You do not have permission to view the Task Library.</p>
            </div>
        );
    }

    // taskLibrary.view opens the page; create/edit/delete are separate rights.
    // A TECHNICIAN holds view only (J.tech has a per-user override for
    // create+edit — that is what the override mechanism is for).
    const canCreateTL = permissions?.taskLibrary?.create === true;
    const canEditTL = permissions?.taskLibrary?.edit === true;
    const canDeleteTL = permissions?.taskLibrary?.delete === true;

    const openDetail = async (task: LibraryTask) => {
        setDetailId(task.id);
        setDetailFull(null);
        setDetailError(null);
        setDetailLoading(true);
        detailReq.current = task.id;
        try {
            const full = await db.getLibraryTask(task.id);
            if (detailReq.current !== task.id) return;
            if (full) setDetailFull(full);
            else setDetailError('Roles, parts and files could not be loaded.');
        } catch (e) {
            if (detailReq.current === task.id) setDetailError(errText(e));
        } finally {
            if (detailReq.current === task.id) setDetailLoading(false);
        }
    };

    const closeDetail = () => {
        detailReq.current = null;
        setDetailId(null);
        setDetailFull(null);
        setDetailError(null);
        setDetailLoading(false);
    };

    const handleCreate = () => {
        if (!canCreateTL) return;
        setEditingTask({
            id: '', // New
            code: '',
            title: '',
            description: '',
            category: 'MAINTENANCE',
            estimatedDuration: 0,
            instructions: [],
            safetyRequirements: [],
            inventory: [],
            roles: [],
            files: [],
            assetClassCodes: [],
            version: 1,
            isLocked: false,
        });
        setShowModal(true);
    };

    const handleEdit = async (task: LibraryTask, preloaded?: LibraryTask | null) => {
        if (!canEditTL) return;
        try {
            const fullTask = preloaded ?? await db.getLibraryTask(task.id);
            if (fullTask) {
                closeDetail();
                setEditingTask(fullTask);
                setShowModal(true);
            } else {
                alert("Error loading task details");
            }
        } catch {
            alert("Error loading task details");
        }
    };

    const handleDelete = async (id: string) => {
        if (!canDeleteTL) return;
        const task = tasks.find(t => t.id === id);
        if (task?.isLocked) {
            alert('🔒 This template is locked (used on a completed Work Order). It cannot be deleted. Create a new version instead.');
            return;
        }
        // useConfirm resolves a Promise — unawaited it was always truthy and the delete ran before the answer.
        if (!(await confirm("Are you sure you want to delete this task template?"))) return;
        try {
            await db.deleteLibraryTask(id);
            setTasks(prev => prev.filter(t => t.id !== id));
            if (detailId === id) closeDetail();
        } catch (e) {
            alert("Error deleting task: " + errText(e));
        }
    };

    // Enhancement 3: Create new version of a locked template (MoC workflow)
    const handleCreateNewVersion = async (taskId: string) => {
        if (!canCreateTL) return;
        if (versioning) return;
        setVersioning(true);
        try {
            const newVersion = await db.createNewVersion(taskId, user?.id || 'unknown');
            if (newVersion) {
                await loadTasks();
                closeDetail();
                setEditingTask(newVersion);
                setShowModal(true);
                alert(`✅ New version created: ${newVersion.code} (v${newVersion.version}). You may now edit the new version.`);
            }
        } catch (e) {
            alert('Error creating new version: ' + errText(e));
        } finally {
            setVersioning(false);
        }
    };

    const toggleSort = (key: SortKey) =>
        setSort(prev => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

    const sortHead = (label: string, key: SortKey) => (
        <button
            type="button"
            onClick={() => toggleSort(key)}
            className={cn('uppercase tracking-wide inline-flex items-center gap-0.5', sort.key === key ? 'text-slate-900' : 'hover:text-slate-700')}
        >
            {label}
            {sort.key === key && (sort.dir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
        </button>
    );

    const versionCell = (t: LibraryTask) => {
        const superseded = supersededIds.has(t.id);
        return (
            <span
                className={cn('inline-flex items-center gap-1 tabular-nums', superseded ? 'text-slate-400' : 'text-slate-700')}
                title={[t.isLocked ? 'Locked — used on a completed work order' : '', superseded ? 'Superseded by a newer version' : ''].filter(Boolean).join(' · ') || undefined}
            >
                {t.isLocked && <Lock size={12} className="text-amber-600" />}
                v{t.version || 1}
                {superseded && <span className="text-[10px] font-semibold uppercase">old</span>}
            </span>
        );
    };

    const columns: DataColumn<LibraryTask>[] = [
        {
            id: 'code', header: 'Code', headerCell: sortHead('Code', 'code'), widthClass: 'w-40',
            render: t => <span className="font-mono text-xs text-slate-600">{t.code || '—'}</span>,
        },
        {
            id: 'title', header: 'Title', headerCell: sortHead('Title', 'title'), cardTitle: true,
            render: t => (
                <div className="min-w-0 py-1.5">
                    <div className="font-semibold text-slate-800 truncate" title={t.title}>{t.title}</div>
                    <div className="text-xs text-slate-400 truncate" title={t.description || undefined}>{t.description || 'No description'}</div>
                </div>
            ),
        },
        { id: 'category', header: 'Category', headerCell: sortHead('Category', 'category'), widthClass: 'w-32', render: t => <CategoryBadge category={t.category} /> },
        {
            id: 'classes', header: 'Asset classes', widthClass: 'w-48', hideBelow: 'lg',
            render: t => <AssetClassChips codes={t.assetClassCodes} labelOf={labelOfClass} max={2} />,
        },
        { id: 'steps', header: 'Steps', widthClass: 'w-16', align: 'right', render: t => <span className="tabular-nums">{t.instructions?.length || 0}</span> },
        {
            id: 'resources', header: 'Resources', widthClass: 'w-24', align: 'right',
            render: t => <span className="tabular-nums" title="Roles and parts on this template">{t.resourceCount ?? '—'}</span>,
        },
        { id: 'version', header: 'Version', headerCell: sortHead('Version', 'version'), widthClass: 'w-24', render: versionCell },
    ];

    const renderCard = (t: LibraryTask) => (
        <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
                <CategoryBadge category={t.category} />
                {t.isLocked && <Badge tone="warning" pill={false}><Lock size={10} /> Locked</Badge>}
                {(t.version || 1) > 1 && <Badge pill={false}><GitBranch size={10} /> v{t.version}</Badge>}
                <span className="ml-auto text-[11px] font-mono text-slate-400 truncate">{t.code || 'NO-CODE'}</span>
            </div>
            <div className="font-bold text-slate-800 text-sm truncate">{t.title}</div>
            {t.description && <p className="text-xs text-slate-500 line-clamp-2">{t.description}</p>}
            <div className="flex items-center gap-3 text-[11px] text-slate-500 min-w-0">
                <span className="flex items-center gap-1 flex-shrink-0"><Clock size={11} /> {t.estimatedDuration}h</span>
                <span className="flex items-center gap-1 flex-shrink-0"><CheckSquare size={11} /> {t.instructions?.length || 0} steps</span>
                {t.resourceCount != null && <span className="flex items-center gap-1 flex-shrink-0"><Layers size={11} /> {t.resourceCount}</span>}
                {(t.assetClassCodes || []).length > 0 && (
                    <span className="ml-auto min-w-0 flex"><AssetClassChips codes={t.assetClassCodes} labelOf={labelOfClass} max={2} /></span>
                )}
            </div>
        </div>
    );

    const detailRow = detailId ? tasks.find(t => t.id === detailId) ?? null : null;
    const shown = detailFull ?? detailRow;
    const newerVersion = shown && supersededIds.has(shown.id)
        ? tasks.filter(t => t.id !== shown.id && (familyOf(t.code) === familyOf(shown.code) || t.parentTaskId === shown.id))
            .sort((a, b) => (b.version || 1) - (a.version || 1))[0]
        : undefined;
    const craftLabel = (code: string) => craftOptions.find(c => c.code === code)?.description || code;

    const filtersActive = !!searchTerm.trim() || selectedCategory !== 'ALL' || selectedClass !== 'ALL';

    return (
        <div className="ers-page-wide w-full flex h-full flex-col bg-white rounded-xl border border-slate-200 overflow-hidden">
            {/* Header / Filter Bar */}
            <div className="px-4 py-3 md:px-6 md:py-4 border-b border-slate-200 bg-slate-50 space-y-3">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                            <BookOpen size={18} className="text-blue-600" /> Task Library
                        </h2>
                        <p className="text-sm text-slate-500 hidden sm:block">Reusable job templates for Maintenance, Inspection, Safety and Project work.</p>
                    </div>
                    {canCreateTL && (
                        <Button size="sm" leftIcon={<Plus size={14} />} onClick={handleCreate} className="flex-shrink-0">
                            <span className="sm:hidden">New</span><span className="hidden sm:inline">New Template</span>
                        </Button>
                    )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative w-full sm:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
                        <input
                            type="text"
                            placeholder="Search code, title, scope, class..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="pl-9 pr-3 py-1.5 border border-slate-300 rounded-lg text-sm w-full bg-white"
                        />
                    </div>
                    <select
                        className="py-1.5 px-2 border border-slate-300 rounded-lg text-sm bg-white"
                        value={selectedCategory}
                        onChange={e => setSelectedCategory(e.target.value)}
                        aria-label="Category"
                    >
                        <option value="ALL">All categories</option>
                        {CATEGORIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                    </select>
                    <select
                        className="py-1.5 px-2 border border-slate-300 rounded-lg text-sm bg-white max-w-[14rem]"
                        value={selectedClass}
                        onChange={e => setSelectedClass(e.target.value)}
                        aria-label="Asset class"
                        disabled={classesInUse.length === 0}
                    >
                        <option value="ALL">All asset classes</option>
                        {classesInUse.map(c => <option key={c} value={c}>{labelOfClass(c)}</option>)}
                    </select>
                    <label className="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            className="w-4 h-4 rounded border-slate-300 text-primary-600"
                            checked={currentOnly}
                            onChange={e => setCurrentOnly(e.target.checked)}
                        />
                        Current versions only
                    </label>
                    <span className="ml-auto text-xs text-slate-500 tabular-nums">
                        {filteredTasks.length} template{filteredTasks.length === 1 ? '' : 's'}
                        {hiddenOlder > 0 && <span className="text-slate-400"> · {hiddenOlder} older version{hiddenOlder === 1 ? '' : 's'} hidden</span>}
                    </span>
                </div>
            </div>

            {loadError && (
                <div className="m-4 p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-800 flex items-center justify-between gap-3">
                    <span>The library could not be loaded: {loadError}</span>
                    <button onClick={loadTasks} className="px-3 py-1 rounded-md bg-white border border-red-300 text-red-700 text-xs font-semibold hover:bg-red-100">Retry</button>
                </div>
            )}

            {/* List — dense table on desktop, cards on phones */}
            {!loadError && (
                <DataList
                    columns={columns}
                    data={filteredTasks}
                    getRowId={t => t.id}
                    onRowClick={openDetail}
                    selectedId={detailId}
                    loading={loading && tasks.length === 0}
                    renderCard={renderCard}
                    empty={
                        <EmptyState
                            icon={<BookOpen size={22} />}
                            title={tasks.length === 0 ? 'No templates yet' : 'No templates match'}
                            description={tasks.length === 0
                                ? (canCreateTL ? 'Create one to reuse it on work orders and PM plans.' : 'Templates appear here once someone with create rights adds them.')
                                : filtersActive ? 'Try a different search or clear the filters.' : 'Untick "Current versions only" to see older versions.'}
                            action={tasks.length === 0 && canCreateTL ? { label: 'New Template', onClick: handleCreate, icon: <Plus size={14} /> } : undefined}
                        />
                    }
                />
            )}

            {/* Read-only detail */}
            <Drawer
                open={!!shown}
                onClose={closeDetail}
                title={shown?.title}
                subtitle={shown ? <span className="font-mono">{shown.code || 'NO-CODE'}</span> : undefined}
                width="lg"
                footer={shown && (
                    (canDeleteTL && !shown.isLocked) || (canEditTL && !shown.isLocked) || (canCreateTL && shown.isLocked)
                ) ? (
                    <div className="flex w-full items-center gap-2">
                        {canDeleteTL && !shown.isLocked && (
                            <Button variant="ghost" size="sm" leftIcon={<Trash2 size={14} />} className="text-red-600 hover:bg-red-50" onClick={() => handleDelete(shown.id)}>
                                Delete
                            </Button>
                        )}
                        <div className="ml-auto flex items-center gap-2">
                            {canEditTL && !shown.isLocked && (
                                <Button size="sm" leftIcon={<Edit2 size={14} />} onClick={() => handleEdit(shown, detailFull)}>Edit</Button>
                            )}
                            {canCreateTL && shown.isLocked && (
                                <Button size="sm" leftIcon={<GitBranch size={14} />} loading={versioning} onClick={() => handleCreateNewVersion(shown.id)}>
                                    New version
                                </Button>
                            )}
                        </div>
                    </div>
                ) : undefined}
            >
                {shown && (
                    <div className="p-4 space-y-3">
                        {shown.isLocked && (
                            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 flex items-start gap-2">
                                <Lock size={14} className="mt-0.5 flex-shrink-0" />
                                <span>
                                    Locked — used on a completed work order
                                    {shown.lockedAt ? ` (${new Date(shown.lockedAt).toLocaleDateString()})` : ''}. Changes go through a new version.
                                </span>
                            </div>
                        )}
                        {newerVersion && (
                            <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600 flex items-center gap-2">
                                <GitBranch size={14} className="flex-shrink-0 text-slate-400" />
                                <span className="min-w-0">Superseded by <strong className="font-mono">{newerVersion.code}</strong> (v{newerVersion.version || 1}).</span>
                                <button type="button" onClick={() => openDetail(newerVersion)} className="ml-auto text-primary-600 font-semibold hover:underline flex-shrink-0">Open</button>
                            </div>
                        )}

                        <section className="bg-white rounded-lg border border-slate-200 p-3.5 space-y-3">
                            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <div>
                                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Category</dt>
                                    <dd className="mt-0.5"><CategoryBadge category={shown.category} /></dd>
                                </div>
                                <div>
                                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Est. hours</dt>
                                    <dd className="mt-0.5 text-sm text-slate-800 tabular-nums">{shown.estimatedDuration || 0}h</dd>
                                </div>
                                <div>
                                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Version</dt>
                                    <dd className="mt-0.5 text-sm">{versionCell(shown)}</dd>
                                </div>
                                <div>
                                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">State</dt>
                                    <dd className="mt-0.5 text-sm text-slate-800">{shown.isLocked ? 'Locked' : 'Editable'}</dd>
                                </div>
                            </dl>
                            <p className="text-sm text-slate-600 whitespace-pre-line">{shown.description || 'No description provided.'}</p>
                        </section>

                        <DetailSection title="Asset classes" icon={<Tag size={12} />}>
                            {(shown.assetClassCodes || []).length === 0 ? (
                                <p className="text-xs text-slate-400 italic">Not tagged — offered for every asset.</p>
                            ) : (
                                <div className="flex flex-wrap gap-1.5">
                                    {shown.assetClassCodes!.map(code => (
                                        <span key={code} className="px-2 py-0.5 rounded text-xs bg-primary-50 text-primary-700 border border-primary-200">
                                            {labelOfClass(code)}{labelOfClass(code) !== code && <span className="ml-1 font-mono text-[10px] text-primary-400">{code}</span>}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </DetailSection>

                        <DetailSection title={`Steps (${shown.instructions?.length || 0})`} icon={<ClipboardList size={12} />}>
                            <StepList blocks={shown.instructions || []} />
                        </DetailSection>

                        <DetailSection title="Resources" icon={<Wrench size={12} />}>
                            {detailLoading && !detailFull ? (
                                <p className="text-xs text-slate-400">Loading roles and parts...</p>
                            ) : detailError && !detailFull ? (
                                <p className="text-xs text-red-600">{detailError}</p>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <h4 className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1 flex items-center gap-1"><HardHat size={11} /> Labour</h4>
                                        {(detailFull?.roles || []).length === 0 ? <p className="text-xs text-slate-400 italic">No roles specified.</p> : (
                                            <ul className="space-y-1">
                                                {detailFull!.roles!.map((r, i) => (
                                                    <li key={r.id || i} className="text-sm flex justify-between gap-2">
                                                        <span className="truncate" title={r.roleCode}>{craftLabel(r.roleCode)}</span>
                                                        <span className="text-xs text-slate-500 whitespace-nowrap tabular-nums">×{r.quantity} · {r.estimatedHours}h</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                    <div>
                                        <h4 className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1 flex items-center gap-1"><Package size={11} /> Spare parts</h4>
                                        {(detailFull?.inventory || []).length === 0 ? <p className="text-xs text-slate-400 italic">No parts specified.</p> : (
                                            <ul className="space-y-1">
                                                {detailFull!.inventory!.map((p, i) => {
                                                    const line = toPartLine(p);
                                                    return (
                                                        <li key={p.id || i} className="text-sm flex justify-between gap-2">
                                                            <span className="truncate min-w-0">
                                                                {line.itemCode && <span className="font-mono text-xs text-slate-400 mr-1">{line.itemCode}</span>}
                                                                {line.itemDescription || line.inventoryItemId}
                                                            </span>
                                                            <span className="text-xs text-slate-500 whitespace-nowrap tabular-nums">×{line.quantity}{line.uom ? ` ${line.uom}` : ''}</span>
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                        )}
                                    </div>
                                </div>
                            )}
                        </DetailSection>

                        <DetailSection title="Files" icon={<FileText size={12} />}>
                            {detailLoading && !detailFull ? (
                                <p className="text-xs text-slate-400">Loading files...</p>
                            ) : (detailFull?.files || []).length === 0 ? (
                                <p className="text-xs text-slate-400 italic">No files attached.</p>
                            ) : (
                                <ul className="space-y-1.5">
                                    {detailFull!.files!.map((f, i) => (
                                        <li key={f.id || i}>
                                            <a href={f.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-primary-700 hover:underline min-w-0">
                                                <FileText size={14} className="flex-shrink-0 text-slate-400" />
                                                <span className="truncate">{f.name}</span>
                                                <ExternalLink size={12} className="flex-shrink-0 text-slate-400" />
                                            </a>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </DetailSection>
                    </div>
                )}
            </Drawer>

            {/* Modal */}
            {showModal && editingTask && (
                <TaskEditorModal
                    task={editingTask}
                    assetClassOptions={assetClassOptions}
                    assetClassLabel={labelOfClass}
                    craftOptions={craftOptions}
                    onClose={() => setShowModal(false)}
                    onSave={async (t, inv, roles, files) => {
                        if (!String(t.title || '').trim() || !String(t.code || '').trim()) {
                            alert('A template needs a code and a title.');
                            return;
                        }
                        try {
                            if (!t.id) {
                                // Create
                                await db.createLibraryTask(t, inv, roles, files, user?.id || 'unknown');
                            } else {
                                // Update
                                await db.updateLibraryTask(t.id, t, inv, roles, files);
                            }
                            setShowModal(false);
                            loadTasks();
                        } catch (e) {
                            alert("Error: " + errText(e));
                        }
                    }}
                />
            )}
        </div>
    );
};

// getLibraryTask returns the joined description as itemDescription (not on the type).
const toPartLine = (i: LibraryTaskInventory & { itemDescription?: string }): PartLine => ({
    inventoryItemId: i.inventoryItemId,
    itemCode: i.itemCode,
    itemDescription: i.itemDescription ?? i.description,
    uom: i.uom,
    quantity: i.quantity,
    notes: i.notes,
});

const STRUCTURAL = new Set(['HEADING', 'SECTION']);

const StepList: React.FC<{ blocks: InstructionBlock[] }> = ({ blocks }) => {
    if (blocks.length === 0) return <p className="text-xs text-slate-400 italic">No steps defined.</p>;
    const ordered = [...blocks].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    // Headings are not steps, so they take no number.
    const numbers = ordered.reduce<number[]>((acc, b) => [...acc, (acc[acc.length - 1] ?? 0) + (STRUCTURAL.has(b.type) ? 0 : 1)], []);
    return (
        <ol className="space-y-1">
            {ordered.map((b, i) => {
                if (STRUCTURAL.has(b.type)) {
                    return <li key={`${b.id ?? 'step'}-${i}`} className="pt-2 first:pt-0 text-xs font-bold text-slate-700 uppercase tracking-wide">{b.label}</li>;
                }
                const n = numbers[i];
                const limits = b.minValue != null || b.maxValue != null || b.targetValue != null
                    ? [b.minValue != null ? `min ${b.minValue}` : '', b.targetValue != null ? `target ${b.targetValue}` : '', b.maxValue != null ? `max ${b.maxValue}` : '']
                        .filter(Boolean).join(' · ') + (b.uom ? ` ${b.uom}` : '')
                    : '';
                return (
                    <li key={`${b.id ?? 'step'}-${i}`} className="flex gap-2 text-sm">
                        <span className="w-5 flex-shrink-0 text-right text-xs text-slate-400 tabular-nums pt-0.5">{n}.</span>
                        <div className="min-w-0 flex-1">
                            <div className="text-slate-800">
                                {b.label || <span className="italic text-slate-400">Untitled step</span>}
                                {b.required && <span className="text-red-500 ml-0.5" title="Required">*</span>}
                            </div>
                            <div className="text-[11px] text-slate-400">
                                {b.type.replace(/_/g, ' ').toLowerCase()}{limits && ` · ${limits}`}
                            </div>
                        </div>
                    </li>
                );
            })}
        </ol>
    );
};

// --- Sub-Component: Task Editor Modal ---

const TaskEditorModal: React.FC<{
    task: LibraryTask;
    assetClassOptions: Option[];
    assetClassLabel: (code: string) => string;
    craftOptions: Option[];
    onClose: () => void;
    onSave: (task: LibraryTask, inventory: PartLine[], roles: RoleLine[], files: FileLine[]) => Promise<void>;
}> = ({ task, assetClassOptions, assetClassLabel, craftOptions, onClose, onSave }) => {
    const promptModal = usePrompt();
    // Local State
    const [formData, setFormData] = useState<LibraryTask>(task);
    // Separate state for relations because they might be complex
    const [inventory, setInventory] = useState<PartLine[]>(() => (task.inventory || []).map(toPartLine));
    const [roles, setRoles] = useState<RoleLine[]>(() => (task.roles || []).map(r => ({
        roleCode: r.roleCode, quantity: r.quantity, estimatedHours: r.estimatedHours,
    })));
    const [localFiles, setLocalFiles] = useState<FileLine[]>(task.files || []);
    const [partQuery, setPartQuery] = useState('');

    // Save in flight (a double-click on a new template created two)
    const [saving, setSaving] = useState(false);
    // Keyword suggestion state
    const [isThinking, setIsThinking] = useState(false);
    // Real stock, so part suggestions reference items that actually exist.
    const [stockItems, setStockItems] = useState<StockItem[]>([]);
    useEffect(() => {
        let active = true;
        DatabaseService.getInstance().getInventory()
            .then(items => { if (active) setStockItems(items || []); })
            .catch(() => { if (active) setStockItems([]); });
        return () => { active = false; };
    }, []);

    const locked = !!formData.isLocked;

    // A role code saved before the craft list changed must still show in its select.
    const roleOptionsFor = (code: string): Option[] =>
        !code || craftOptions.some(c => c.code === code)
            ? craftOptions
            : [{ code, description: `${code} (not in craft list)` }, ...craftOptions];

    const updateRole = (idx: number, patch: Partial<RoleLine>) =>
        setRoles(prev => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
    const updatePart = (idx: number, patch: Partial<PartLine>) =>
        setInventory(prev => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));

    const addRole = () => setRoles(prev => [...prev, { roleCode: '', quantity: 1, estimatedHours: formData.estimatedDuration || 1 }]);

    const addPart = (item: StockItem) => {
        setInventory(prev => (prev.some(p => p.inventoryItemId === item.id) ? prev : [...prev, {
            inventoryItemId: item.id,
            itemCode: item.code,
            itemDescription: item.description,
            uom: item.uom,
            quantity: 1,
        }]));
        setPartQuery('');
    };

    const partMatches = useMemo(() => {
        const q = partQuery.trim().toLowerCase();
        if (!q) return [];
        return stockItems
            .filter(s => !inventory.some(p => p.inventoryItemId === s.id))
            .filter(s => `${s.code ?? ''} ${s.description ?? ''}`.toLowerCase().includes(q))
            .slice(0, 8);
    }, [partQuery, stockItems, inventory]);

    // Keyword suggestion: matches words in the title/description to crafts and
    // real stock. It is a rule, not AI, so it runs at once (it used to sit on a
    // fixed 1.5 s "Analyzing Task..." spinner).
    const handleAutoSuggest = () => {
        setIsThinking(true);
        {
            // Heuristics based on description
            const desc = (formData.description + " " + formData.title).toLowerCase();
            const newRoles = [...roles];
            const newInventory = [...inventory];

            // Prefer the tenant's own craft code (e.g. ELECTRICIAN) over the bare keyword.
            const craftFor = (fallback: string, pattern: RegExp) =>
                craftOptions.find(c => pattern.test(c.code) || pattern.test(c.description))?.code ?? fallback;

            // Roles
            if (desc.includes('electrical') || desc.includes('wire') || desc.includes('motor')) {
                const code = craftFor('ELEC', /elec/i);
                if (!newRoles.find(r => r.roleCode === code)) {
                    newRoles.push({ roleCode: code, quantity: 1, estimatedHours: formData.estimatedDuration || 2 });
                }
            }
            if (desc.includes('pump') || desc.includes('bearing') || desc.includes('seal')) {
                const code = craftFor('MECH', /mech|fitter/i);
                if (!newRoles.find(r => r.roleCode === code)) {
                    newRoles.push({ roleCode: code, quantity: 1, estimatedHours: formData.estimatedDuration || 2 });
                }
            }

            // Parts — matched against REAL stock. These used to push the literal
            // ids 'mock-bearing-id' / 'mock-filter-id', which are not uuids and
            // do not exist, so saving the task threw an FK violation on
            // task_library_inventory.inventory_item_id.
            for (const keyword of ['bearing', 'filter', 'seal', 'gasket', 'belt']) {
                if (!desc.includes(keyword)) continue;
                const match = stockItems.find(i =>
                    `${i.description ?? ''} ${i.code ?? ''}`.toLowerCase().includes(keyword)
                );
                if (match && !newInventory.find(n => n.inventoryItemId === match.id)) {
                    newInventory.push({
                        inventoryItemId: match.id,
                        itemCode: match.code,
                        itemDescription: match.description,
                        uom: match.uom,
                        quantity: 1,
                        notes: 'Auto-suggested',
                    });
                }
            }

            setRoles(newRoles);
            setInventory(newInventory);

            // Suggest Time
            if (desc.includes('service') && formData.estimatedDuration === 0) {
                setFormData(prev => ({ ...prev, estimatedDuration: 2 }));
            } else if (desc.includes('inspect') && formData.estimatedDuration === 0) {
                setFormData(prev => ({ ...prev, estimatedDuration: 1 }));
            }

            setIsThinking(false);
        }
    };

    const handleSave = async () => {
        if (saving) return;
        // A blank line carries nothing; dropping it beats saving a role with no craft.
        const cleanRoles = roles
            .filter(r => r.roleCode.trim())
            .map(r => ({
                roleCode: r.roleCode.trim(),
                quantity: Math.max(1, Math.round(Number(r.quantity) || 1)),
                estimatedHours: Math.max(0, Number(r.estimatedHours) || 0),
            }));
        const cleanParts = inventory
            .filter(p => p.inventoryItemId)
            .map(p => ({ ...p, quantity: Number(p.quantity) > 0 ? Number(p.quantity) : 1 }));
        setSaving(true);
        try { await onSave(formData, cleanParts, cleanRoles, localFiles); } finally { setSaving(false); }
    };

    const numInput = 'p-1.5 border rounded text-sm tabular-nums bg-white disabled:bg-slate-100';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-2 sm:p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[95vh] sm:max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95">
                <div className="p-4 border-b flex justify-between items-center bg-slate-50">
                    <h3 className="font-bold text-lg text-slate-800">{formData.id ? 'Edit Template' : 'New Library Task'}</h3>
                    <button onClick={onClose} aria-label="Close"><X size={20} className="text-slate-400 hover:text-slate-600" /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
                    {/* Enhancement 3: MoC Warning for locked templates */}
                    {locked && (
                        <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 flex items-start gap-3">
                            <AlertTriangle size={20} className="text-amber-600 mt-0.5 flex-shrink-0" />
                            <div>
                                <h4 className="font-bold text-amber-800 text-sm">Template Locked — Management of Change Required</h4>
                                <p className="text-xs text-amber-700 mt-1">
                                    This template is locked because it has been used on a completed Work Order. Direct edits are not permitted.
                                    To modify, use <strong>"New version"</strong> in the template's details to create an unlocked copy.
                                </p>
                                <p className="text-[10px] text-amber-500 mt-1">
                                    Locked at: {formData.lockedAt ? new Date(formData.lockedAt).toLocaleString() : 'Unknown'} | Locked by: {formData.lockedBy || 'System'}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Core Info */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Task Code</label>
                            <input
                                className="w-full p-2 border rounded text-sm font-mono"
                                value={formData.code}
                                onChange={e => setFormData({ ...formData, code: e.target.value })}
                                placeholder="e.g. MAINT-PUMP-01"
                                disabled={locked}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Category</label>
                            <select
                                className="w-full p-2 border rounded text-sm"
                                value={formData.category}
                                onChange={e => setFormData({ ...formData, category: e.target.value as LibraryTask['category'] })}
                                disabled={locked}
                            >
                                {CATEGORIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                            </select>
                        </div>

                        {/* Enhancement 2: Asset Class Association */}
                        <div className="sm:col-span-2">
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                                <Tag size={11} className="inline mr-1" /> Asset Classes (ISO 14224)
                            </label>
                            <div className="flex flex-wrap gap-1.5 p-2 border rounded bg-white min-h-[38px]">
                                {(formData.assetClassCodes || []).map(code => (
                                    <span key={code} title={assetClassLabel(code)} className="px-2 py-0.5 bg-primary-50 text-primary-700 border border-primary-200 rounded text-xs font-medium flex items-center gap-1">
                                        {code}
                                        {!locked && (
                                            <button
                                                type="button"
                                                aria-label={`Remove ${code}`}
                                                onClick={() => setFormData({
                                                    ...formData,
                                                    assetClassCodes: (formData.assetClassCodes || []).filter(c => c !== code)
                                                })}
                                                className="text-primary-400 hover:text-red-500 ml-0.5"
                                            >
                                                <X size={10} />
                                            </button>
                                        )}
                                    </span>
                                ))}
                                {!locked && (
                                    <select
                                        className="text-xs border-0 bg-transparent text-slate-400 focus:outline-none cursor-pointer max-w-full"
                                        value=""
                                        onChange={e => {
                                            const val = e.target.value;
                                            if (val && !(formData.assetClassCodes || []).includes(val)) {
                                                setFormData({
                                                    ...formData,
                                                    assetClassCodes: [...(formData.assetClassCodes || []), val]
                                                });
                                            }
                                        }}
                                    >
                                        <option value="">+ Add class...</option>
                                        {assetClassOptions.filter(c => !(formData.assetClassCodes || []).includes(c.code)).map(c => (
                                            <option key={c.code} value={c.code}>{c.description}{c.description !== c.code ? ` (${c.code})` : ''}</option>
                                        ))}
                                    </select>
                                )}
                            </div>
                            <p className="text-[10px] text-slate-400 mt-1">Tag templates to specific equipment classes for contextual filtering in WO/PM pickers.</p>
                        </div>

                        <div className="sm:col-span-2">
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Title</label>
                            <input
                                className="w-full p-2 border rounded text-sm font-bold"
                                value={formData.title}
                                onChange={e => setFormData({ ...formData, title: e.target.value })}
                                placeholder="e.g. Monthly Pump Inspection"
                                disabled={locked}
                            />
                        </div>
                        <div className="sm:col-span-2">
                            <div className="flex justify-between items-center mb-1">
                                <label className="block text-xs font-bold text-slate-500 uppercase">Description / Scope</label>
                                <button
                                    onClick={handleAutoSuggest}
                                    type="button"
                                    disabled={isThinking || locked}
                                    className="text-xs flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium px-2 py-1 bg-blue-50 rounded-full border border-blue-100 transition-colors disabled:opacity-50"
                                >
                                    <Sparkles size={12} className={isThinking ? "animate-spin" : ""} />
                                    {isThinking ? 'Suggesting...' : 'Suggest from keywords'}
                                </button>
                            </div>
                            <textarea
                                className="w-full p-2 border rounded text-sm h-24"
                                value={formData.description}
                                onChange={e => setFormData({ ...formData, description: e.target.value })}
                                placeholder="Describe the task in detail. Keywords here drive the role and part suggestions."
                                disabled={locked}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Est. Hours</label>
                            <input
                                type="number"
                                className="w-full p-2 border rounded text-sm"
                                value={formData.estimatedDuration}
                                onChange={e => setFormData({ ...formData, estimatedDuration: e.target.value === '' ? 0 : (Number(e.target.value) || 0) })}
                                disabled={locked}
                            />
                        </div>
                    </div>

                    {/* Required Resources */}
                    <div className="border border-slate-200 rounded-lg p-3 sm:p-4 bg-slate-50">
                        <h4 className="font-bold text-sm text-slate-700 mb-3 flex items-center gap-2"><Wrench size={14} /> Required Resources</h4>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Roles */}
                            <div className="bg-white p-3 rounded border border-slate-200">
                                <div className="flex items-center justify-between mb-2">
                                    <h5 className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1"><HardHat size={12} /> Labour / Roles</h5>
                                    {!locked && (
                                        <button type="button" onClick={addRole} className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 font-medium">
                                            <Plus size={12} /> Add role
                                        </button>
                                    )}
                                </div>
                                {roles.length === 0 ? <p className="text-xs text-slate-400 italic">No roles specified.</p> : (
                                    <ul className="space-y-2">
                                        {roles.map((r, i) => (
                                            <li key={i} className="flex flex-wrap items-center gap-1.5">
                                                {craftOptions.length > 0 ? (
                                                    <select
                                                        className="flex-1 min-w-[8rem] p-1.5 border rounded text-sm bg-white disabled:bg-slate-100"
                                                        value={r.roleCode}
                                                        onChange={e => updateRole(i, { roleCode: e.target.value })}
                                                        disabled={locked}
                                                        aria-label="Craft"
                                                    >
                                                        <option value="">Choose craft...</option>
                                                        {roleOptionsFor(r.roleCode).map(c => <option key={c.code} value={c.code}>{c.description}</option>)}
                                                    </select>
                                                ) : (
                                                    <input
                                                        className="flex-1 min-w-[8rem] p-1.5 border rounded text-sm font-mono uppercase disabled:bg-slate-100"
                                                        value={r.roleCode}
                                                        onChange={e => updateRole(i, { roleCode: e.target.value.toUpperCase() })}
                                                        placeholder="Craft code, e.g. MECH"
                                                        disabled={locked}
                                                        aria-label="Craft code"
                                                    />
                                                )}
                                                <label className="flex items-center gap-1 text-[11px] text-slate-400">
                                                    Qty
                                                    <input type="number" min={1} step={1} className={cn(numInput, 'w-14')} value={r.quantity}
                                                        onChange={e => updateRole(i, { quantity: Number(e.target.value) || 0 })} disabled={locked} />
                                                </label>
                                                <label className="flex items-center gap-1 text-[11px] text-slate-400">
                                                    Hrs
                                                    <input type="number" min={0} step={0.5} className={cn(numInput, 'w-16')} value={r.estimatedHours}
                                                        onChange={e => updateRole(i, { estimatedHours: Number(e.target.value) || 0 })} disabled={locked} />
                                                </label>
                                                {!locked && (
                                                    <button type="button" onClick={() => setRoles(prev => prev.filter((_, idx) => idx !== i))}
                                                        className="p-1 text-slate-400 hover:text-red-500" aria-label="Remove role">
                                                        <X size={14} />
                                                    </button>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>

                            {/* Inventory */}
                            <div className="bg-white p-3 rounded border border-slate-200">
                                <h5 className="text-xs font-bold text-slate-500 uppercase mb-2 flex items-center gap-1"><Package size={12} /> Spare Parts</h5>
                                {inventory.length === 0 ? <p className="text-xs text-slate-400 italic mb-2">No parts specified.</p> : (
                                    <ul className="space-y-2 mb-2">
                                        {inventory.map((item, i) => (
                                            <li key={item.inventoryItemId || i} className="flex items-center gap-1.5">
                                                <span className="flex-1 min-w-0 text-sm truncate" title={item.itemDescription || item.inventoryItemId}>
                                                    {item.itemCode && <span className="font-mono text-xs text-slate-400 mr-1">{item.itemCode}</span>}
                                                    {item.itemDescription || item.inventoryItemId}
                                                </span>
                                                <label className="flex items-center gap-1 text-[11px] text-slate-400 flex-shrink-0">
                                                    Qty
                                                    <input type="number" min={0} step="any" className={cn(numInput, 'w-16')} value={item.quantity}
                                                        onChange={e => updatePart(i, { quantity: Number(e.target.value) || 0 })} disabled={locked} />
                                                    {item.uom && <span>{item.uom}</span>}
                                                </label>
                                                {!locked && (
                                                    <button type="button" onClick={() => setInventory(prev => prev.filter((_, idx) => idx !== i))}
                                                        className="p-1 text-slate-400 hover:text-red-500 flex-shrink-0" aria-label="Remove part">
                                                        <X size={14} />
                                                    </button>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                {!locked && (
                                    <div>
                                        <div className="relative">
                                            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                                            <input
                                                className="w-full pl-7 pr-2 py-1.5 border rounded text-sm"
                                                value={partQuery}
                                                onChange={e => setPartQuery(e.target.value)}
                                                placeholder={stockItems.length ? 'Add a part from stock: code or name...' : 'No stock items available'}
                                                disabled={stockItems.length === 0}
                                                aria-label="Find a stock part"
                                            />
                                        </div>
                                        {partQuery.trim() && (
                                            <ul className="mt-1 border border-slate-200 rounded divide-y divide-slate-100 max-h-48 overflow-y-auto">
                                                {partMatches.length === 0 ? (
                                                    <li className="px-2 py-1.5 text-xs text-slate-400">No matching stock item.</li>
                                                ) : partMatches.map(s => (
                                                    <li key={s.id}>
                                                        <button type="button" onClick={() => addPart(s)} className="w-full text-left px-2 py-1.5 text-sm hover:bg-slate-50 flex items-center gap-2 min-w-0">
                                                            <Plus size={12} className="flex-shrink-0 text-blue-600" />
                                                            {s.code && <span className="font-mono text-xs text-slate-400 flex-shrink-0">{s.code}</span>}
                                                            <span className="truncate">{s.description}</span>
                                                        </button>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Files Section */}
                    <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                        <div className="flex justify-between items-center mb-3">
                            <h4 className="font-bold text-sm text-slate-700 flex items-center gap-2"><FileText size={14} /> Attachments & Media</h4>
                            <button
                                type="button"
                                onClick={async () => {
                                    const url = await promptModal({
                                        title: 'Add Document or Media Link',
                                        message: 'Enter direct URL to technical document or manual:',
                                        defaultValue: '',
                                        placeholder: 'https://...',
                                        confirmLabel: 'Attach File',
                                        icon: <FileText size={20} className="text-blue-600" />
                                    });
                                    if (url) {
                                        const name = url.split('/').pop() || 'file';
                                        setLocalFiles([...localFiles, {
                                            name: name,
                                            url: url,
                                            type: 'DOCUMENT'
                                        }]);
                                    }
                                }}
                                className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 font-medium"
                            >
                                <Plus size={12} /> Add File
                            </button>
                        </div>

                        {localFiles.length === 0 ? (
                            <p className="text-xs text-slate-400 italic">No files attached.</p>
                        ) : (
                            <ul className="space-y-2">
                                {localFiles.map((file, i) => (
                                    <li key={i} className="flex items-center justify-between bg-white p-2 rounded border border-slate-200 text-sm">
                                        <div className="flex items-center gap-2 truncate">
                                            <div className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center text-slate-500 text-xs uppercase font-bold">
                                                {file.type ? (file.type.includes('/') ? file.type.split('/')[1] : file.type) : 'FILE'}
                                            </div>
                                            <div>
                                                <div className="font-medium text-slate-700 truncate">{file.name}</div>
                                                <div className="text-xs text-slate-400">{file.uploadedAt || 'Just now'}</div>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => setLocalFiles(localFiles.filter((_, idx) => idx !== i))}
                                            className="text-slate-400 hover:text-red-500"
                                        >
                                            <X size={14} />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    <div className="border border-slate-200 rounded-lg p-4 bg-white">
                        <h4 className="font-bold text-sm text-slate-700 mb-3 flex items-center gap-2"><ClipboardList size={14} /> Procedure Steps</h4>
                        <ProcedureBuilder
                            instructions={formData.instructions || []}
                            onChange={(blocks) => setFormData({ ...formData, instructions: blocks })}
                            mode="EDIT"
                            context="TEMPLATE"
                        />
                    </div>

                </div>

                <div className="p-4 border-t bg-slate-50 flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg text-sm font-medium">Cancel</button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-6 py-2 bg-primary-600 text-white rounded-lg text-sm font-bold hover:bg-primary-500 shadow-sm disabled:opacity-50"
                    >
                        {saving ? 'Saving...' : 'Save Template'}
                    </button>
                </div>
            </div>
        </div>
    );
}
