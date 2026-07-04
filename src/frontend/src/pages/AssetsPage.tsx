import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Activity, Search, Filter, Plus, Download, X, ChevronDown, ChevronUp,
    Gauge, AlertTriangle, Clock, Wrench, DollarSign,
    Layers, ArrowUpDown, Settings, Heart, Cpu, CheckCircle, Zap,
    MapPin, Tag, Hash, Calendar, Package, TrendingDown, TrendingUp, BarChart2,
    Pencil, Trash2, Save, XCircle, Box, ShieldAlert, RefreshCcw, Eye,
    ExternalLink, LayoutGrid, Loader2, Target
} from 'lucide-react';
import { useAssets, type SortField } from '../hooks/useAssets';
import { useInventory } from '../hooks/useInventory';
import { VisionHistoryPanel } from '../components/assets/VisionHistoryPanel';
import { InspectionAssetTab } from '../components/assets/InspectionAssetTab';
import type { Asset, CriticalityRank, AssetStatus, EquipmentClass, EquipmentType, MaintenanceStrategy, TaxonomyLevel, HierarchyNode } from '../types/assets';
import type { StockStatus as InvStockStatus } from '../types/inventory';
import { CRITICALITY_LABELS, EQUIPMENT_TYPE_LABELS, MAINTENANCE_STRATEGY_LABELS, FAILURE_MODE_LABELS, FAILURE_CAUSE_LABELS, REMEDY_LABELS } from '../types/assets';
import { MOCK_DICTIONARIES } from '../eam/constants';
import analyzeService from '../eam/services/AnalyzeService';
import type { RBDModel } from '../eam/services/AnalyzeService';

// ═══════════════════════════════════════════════════════════════════════
//  HELPER: Criticality Badge
// ═══════════════════════════════════════════════════════════════════════

const CritBadge: React.FC<{ crit: CriticalityRank; size?: 'sm' | 'md' }> = ({ crit, size = 'sm' }) => {
    const cls = crit === 'A' ? 'bg-red-500/15 text-red-400 border-red-500/30'
        : crit === 'B' ? 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30'
            : crit === 'C' ? 'bg-slate-100 text-brand-300 border-slate-300'
                : crit === 'D' ? 'bg-blue-500/15 text-blue-400 border-blue-500/30'
                    : 'bg-brand-800 text-slate-400 border-slate-200';
    const sz = size === 'md' ? 'text-xs px-2 py-0.5' : 'text-[10px] px-1.5 py-0.5';
    return <span className={`${sz} uppercase font-bold rounded border ${cls}`} title={CRITICALITY_LABELS[crit]}>Crit {crit}</span>;
};

// ═══════════════════════════════════════════════════════════════════════
//  HELPER: Status Badge
// ═══════════════════════════════════════════════════════════════════════

const StatusBadge: React.FC<{ status: AssetStatus }> = ({ status }) => {
    const cfg: Record<AssetStatus, { label: string; cls: string }> = {
        operating: { label: 'Operating', cls: 'bg-accent-safe/15 text-accent-safe border-accent-safe/30' },
        standby: { label: 'Standby', cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
        under_maintenance: { label: 'Maintenance', cls: 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30' },
        decommissioned: { label: 'Decommissioned', cls: 'bg-slate-100 text-slate-500 border-slate-300' },
        mothballed: { label: 'Mothballed', cls: 'bg-slate-100 text-slate-500 border-slate-300' },
    };
    const { label, cls } = cfg[status];
    return <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${cls}`}>{label}</span>;
};

// ═══════════════════════════════════════════════════════════════════════
//  HELPER: Linked RBD Studies (for Asset → RBD navigation)
// ═══════════════════════════════════════════════════════════════════════

const LinkedRBDStudies: React.FC<{ assetId: string; navigate: ReturnType<typeof import('react-router-dom').useNavigate> }> = ({ assetId, navigate }) => {
    const [linkedStudies, setLinkedStudies] = React.useState<RBDModel[]>([]);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const allModels = await analyzeService.getRBDModels();
                // Client-side filter: find models where blocks contain this assetId
                const matched = allModels.filter(m => {
                    const blocks = (m.blocks || []) as any[];
                    return blocks.some(b => b.assetId === assetId);
                });
                if (!cancelled) setLinkedStudies(matched);
            } catch { /* fail soft */ }
            if (!cancelled) setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [assetId]);

    if (loading) {
        return (
            <div className="mt-4 p-4 bg-brand-800/50 border border-slate-700/30 rounded-lg">
                <div className="flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin text-primary-500" />
                    <span className="text-xs text-slate-400">Loading linked RBD studies…</span>
                </div>
            </div>
        );
    }

    return (
        <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
                <h4 className="text-[11px] font-bold text-brand-200 uppercase tracking-wider flex items-center gap-1.5">
                    <LayoutGrid size={12} className="text-primary-500" /> RBD Studies
                </h4>
                <button onClick={() => navigate('/analyze?tab=reliability')}
                    className="text-[10px] text-primary-500 hover:text-primary-400 font-medium flex items-center gap-1">
                    View All <ExternalLink size={9} />
                </button>
            </div>
            {linkedStudies.length === 0 ? (
                <div className="text-center py-6 border border-dashed border-slate-700/30 rounded-lg bg-brand-800/30">
                    <Cpu size={20} className="mx-auto text-slate-600 mb-1" />
                    <p className="text-[11px] text-slate-500">No RBD studies reference this asset</p>
                    <button onClick={() => navigate('/analyze?tab=reliability')}
                        className="mt-2 text-[10px] text-primary-500 hover:text-primary-400 font-medium">
                        Create Study →
                    </button>
                </div>
            ) : (
                <div className="space-y-2">
                    {linkedStudies.map(study => {
                        const blocks = (study.blocks || []) as any[];
                        const ao = blocks.length > 0
                            ? blocks.reduce((a: number, b: any) => a * (b.mtbf / (b.mtbf + b.mttr)), 1)
                            : 0;
                        return (
                            <div key={study.id} onClick={() => navigate('/analyze?tab=reliability')}
                                className="flex items-center gap-3 p-3 bg-brand-800/50 border border-slate-700/30 rounded-lg cursor-pointer hover:border-primary-500/40 hover:bg-brand-800/80 transition-all group">
                                <div className="w-8 h-8 rounded-lg bg-primary-500/10 flex items-center justify-center shrink-0">
                                    <Cpu size={14} className="text-primary-500" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-slate-200 truncate group-hover:text-primary-400 transition-colors">{study.title}</p>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        <span className="text-[9px] text-slate-500 font-mono">{blocks.length} blocks</span>
                                        {ao > 0 && (
                                            <span className={`text-[9px] font-bold font-mono ${ao >= 0.95 ? 'text-green-400' : ao >= 0.90 ? 'text-yellow-400' : 'text-red-400'}`}>
                                                Ao: {(ao * 100).toFixed(1)}%
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <ExternalLink size={12} className="text-slate-600 group-hover:text-primary-500 transition-colors shrink-0" />
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
// ═══════════════════════════════════════════════════════════════════════
//  HELPER: Health Bar
// ═══════════════════════════════════════════════════════════════════════

const HealthBar: React.FC<{ value: number; showLabel?: boolean }> = ({ value, showLabel = true }) => {
    const color = value >= 80 ? 'bg-accent-safe' : value >= 60 ? 'bg-yellow-500' : 'bg-red-500';
    return (
        <div className="flex items-center gap-2">
            <div className="w-20 bg-slate-50 rounded-full h-1.5 relative">
                <div className={`h-1.5 rounded-full ${color} transition-all`} style={{ width: `${value}%` }} />
            </div>
            {showLabel && <span className={`text-xs font-bold font-mono ${value >= 80 ? 'text-accent-safe' : value >= 60 ? 'text-yellow-500' : 'text-red-400'}`}>{value.toFixed(0)}</span>}
        </div>
    );
};

// ═══════════════════════════════════════════════════════════════════════
//  HELPER: Sortable Header
// ═══════════════════════════════════════════════════════════════════════

const SortHeader: React.FC<{ field: SortField; label: string; currentField: SortField; currentDir: 'asc' | 'desc'; onSort: (f: SortField) => void; className?: string }> =
    ({ field, label, currentField, currentDir, onSort, className = '' }) => (
        <th
            className={`px-4 py-3 font-medium cursor-pointer hover:text-brand-200 transition-colors select-none ${className}`}
            onClick={() => onSort(field)}
        >
            <div className="flex items-center gap-1">
                {label}
                {currentField === field
                    ? currentDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                    : <ArrowUpDown size={10} className="opacity-30" />}
            </div>
        </th>
    );

// ═══════════════════════════════════════════════════════════════════════
//  EQUIPMENT CLASS LABELS
// ═══════════════════════════════════════════════════════════════════════

const EQUIP_CLASS_LABELS: Record<EquipmentClass, string> = {
    rotating: 'Rotating', static_pressure: 'Static / Pressure', electrical: 'Electrical',
    instrument: 'Instrument', piping: 'Piping', structural: 'Structural',
    safety: 'Safety', control: 'Control', other: 'Other',
};

// ═══════════════════════════════════════════════════════════════════════
//  NEW ASSET FORM
// ═══════════════════════════════════════════════════════════════════════

const CRIT_COLORS: Record<CriticalityRank, { bg: string; text: string; border: string; ring: string }> = {
    A: { bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/30', ring: 'ring-red-500/20' },
    B: { bg: 'bg-yellow-500/15', text: 'text-yellow-500', border: 'border-yellow-500/30', ring: 'ring-yellow-500/20' },
    C: { bg: 'bg-slate-100', text: 'text-brand-200', border: 'border-slate-300', ring: 'ring-brand-500/20' },
    D: { bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/30', ring: 'ring-blue-500/20' },
    E: { bg: 'bg-brand-800', text: 'text-slate-400', border: 'border-slate-200', ring: 'ring-brand-600/20' },
};

// ═══════════════════════════════════════════════════════════════════════
//  MAIN PAGE COMPONENT
// ═══════════════════════════════════════════════════════════════════════

export const AssetsPage: React.FC = () => {
    const navigate = useNavigate();
    const {
        assets, summary, filters, updateFilter, resetFilters,
        sortField, sortDir, toggleSort, selectedAsset, selectAsset, sites,
        hierarchySites, hierarchyUnits, hierarchySystems,
        addAsset, updateAsset, deleteAsset, addHierarchyNode,
        getAssetFailures, getAssetKPIs,
    } = useAssets();

    const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
    const [showFilters, setShowFilters] = useState(false);
    const [showRegister, setShowRegister] = useState(false);
    const [registerCreated, setRegisterCreated] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [detailTab, setDetailTab] = useState<'overview' | 'reliability' | 'failures' | 'bom' | 'inspections' | 'vision'>('overview');

    // ── Inventory BOM Hook ──
    const { getBOMForAsset, items: inventoryItems } = useInventory();

    // ── Edit Mode ──
    const [editMode, setEditMode] = useState(false);
    const [editForm, setEditForm] = useState<Partial<Asset>>({});

    // ── Delete Confirmation ──
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleteReason, setDeleteReason] = useState('');

    // ── Add Hierarchy Node Popover ──
    const [hierPopover, setHierPopover] = useState<{ level: TaxonomyLevel; parentId: string | null } | null>(null);
    const [hierName, setHierName] = useState('');
    const [hierCode, setHierCode] = useState('');

    const [registerForm, setRegisterForm] = useState({
        tag: '', name: '', description: '', site: '', unit: '', system: '',
        equipment_category: '',  // ASSET_CATEGORY dict code (broadest)
        equipment_class: '',     // ASSET_CLASS dict code (filtered by category)
        equipment_type: '',      // ASSET_TYPE dict code (filtered by class, most specific)
        criticality: '' as CriticalityRank,
        maintenance_strategy: 'not_assigned' as MaintenanceStrategy,
        manufacturer: '', model: '', serial_number: '', install_date: '',
        design_pressure_bar: '', design_temperature_c: '', rated_power_kw: '', material_class: '', weight_kg: '',
        service_medium: '', operating_mode: '' as string, environment: '' as string,
    });

    // ── ISO 14224 Cascading Dictionary Lookups ──
    const dictCategories = React.useMemo(() => MOCK_DICTIONARIES.filter(d => d.type === 'ASSET_CATEGORY' && d.active), []);
    const dictClasses = React.useMemo(() => {
        if (!registerForm.equipment_category) return MOCK_DICTIONARIES.filter(d => d.type === 'ASSET_CLASS' && d.active);
        return MOCK_DICTIONARIES.filter(d => d.type === 'ASSET_CLASS' && d.active && d.categoryRef === registerForm.equipment_category);
    }, [registerForm.equipment_category]);
    const dictTypes = React.useMemo(() => {
        if (!registerForm.equipment_class) return MOCK_DICTIONARIES.filter(d => d.type === 'ASSET_TYPE' && d.active);
        return MOCK_DICTIONARIES.filter(d => d.type === 'ASSET_TYPE' && d.active && d.categoryRef === registerForm.equipment_class);
    }, [registerForm.equipment_class]);

    const activeFilters = [filters.criticality, filters.status, filters.equipment_class, filters.site]
        .filter(v => v !== 'all').length;

    const handleRegister = () => {
        const newAsset: Asset = {
            id: `asset-${Date.now()}`,
            tag: registerForm.tag,
            name: registerForm.name,
            description: registerForm.description || '',
            taxonomy_level: 'equipment' as TaxonomyLevel,
            parent_id: null,
            children_count: 0,
            site: registerForm.site,
            unit: registerForm.unit,
            system: registerForm.system,
            functional_location: `${registerForm.site} / ${registerForm.unit} / ${registerForm.system || '—'}`,
            criticality: registerForm.criticality,
            criticality_method: 'manual' as const,
            status: 'operating' as AssetStatus,
            equipment_type: (registerForm.equipment_type || 'mechanical') as EquipmentType,
            equipment_class: (registerForm.equipment_class || 'rotating') as EquipmentClass,
            equipment_category: registerForm.equipment_category || 'general',
            maintenance_strategy: registerForm.maintenance_strategy,
            manufacturer: registerForm.manufacturer || 'N/A',
            model: registerForm.model || 'N/A',
            serial_number: registerForm.serial_number || 'N/A',
            install_date: registerForm.install_date || new Date().toISOString().slice(0, 10),
            warranty_expiry: null,
            last_overhaul: null,
            running_hours: 0,
            health_index: 100,
            condition_rating: 5,
            rul_days: null,
            risk_priority: { consequence: 3, probability: 2, detectability: 3, rpn: 18 },
            mtbf_days: null,
            mttr_hours: null,
            failure_count_ytd: 0,
            wo_count_ytd: 0,
            cost_ytd: 0,
            design_data: registerForm.design_pressure_bar ? {
                design_pressure_bar: Number(registerForm.design_pressure_bar) || undefined,
                design_temperature_c: Number(registerForm.design_temperature_c) || undefined,
                rated_power_kw: Number(registerForm.rated_power_kw) || undefined,
                material_class: registerForm.material_class || undefined,
                weight_kg: Number(registerForm.weight_kg) || undefined,
            } : undefined,
            operating_context: (registerForm.service_medium || registerForm.operating_mode || registerForm.environment) ? {
                service_medium: registerForm.service_medium || undefined,
                operating_mode: (registerForm.operating_mode || undefined) as 'continuous' | 'intermittent' | 'standby' | 'seasonal' | undefined,
                environment: (registerForm.environment || undefined) as 'onshore' | 'offshore' | 'subsea' | 'desert' | 'arctic' | undefined,
            } : undefined,
        };
        addAsset(newAsset);
        setRegisterCreated(true);
        setTimeout(() => {
            setRegisterCreated(false);
            setShowRegister(false);
            setRegisterForm({
                tag: '', name: '', description: '', site: '', unit: '', system: '',
                equipment_category: '', equipment_class: '', equipment_type: '',
                criticality: '' as CriticalityRank,
                maintenance_strategy: 'not_assigned' as MaintenanceStrategy,
                manufacturer: '', model: '', serial_number: '', install_date: '',
                design_pressure_bar: '', design_temperature_c: '', rated_power_kw: '', material_class: '', weight_kg: '',
                service_medium: '', operating_mode: '' as string, environment: '' as string,
            });
        }, 2000);
    };

    // ── Edit Mode Handlers ──
    const startEdit = useCallback(() => {
        if (!selectedAsset) return;
        setEditForm({
            name: selectedAsset.name,
            description: selectedAsset.description,
            criticality: selectedAsset.criticality,
            status: selectedAsset.status,
            health_index: selectedAsset.health_index,
            running_hours: selectedAsset.running_hours,
            condition_rating: selectedAsset.condition_rating,
            manufacturer: selectedAsset.manufacturer,
            model: selectedAsset.model,
            serial_number: selectedAsset.serial_number,
            cost_ytd: selectedAsset.cost_ytd,
        });
        setEditMode(true);
    }, [selectedAsset]);

    const saveEdit = useCallback(() => {
        if (!selectedAsset) return;
        updateAsset(selectedAsset.id, editForm);
        setEditMode(false);
        setEditForm({});
    }, [selectedAsset, editForm, updateAsset]);

    const cancelEdit = useCallback(() => {
        setEditMode(false);
        setEditForm({});
    }, []);

    // ── Delete Handler ──
    const handleDelete = useCallback(() => {
        if (!selectedAsset) return;
        deleteAsset(selectedAsset.id);
        setShowDeleteConfirm(false);
        setDeleteReason('');
    }, [selectedAsset, deleteAsset]);

    // ── Hierarchy Node Creator ──
    const handleCreateHierNode = useCallback((level: TaxonomyLevel, parentId: string | null, targetField: 'site' | 'unit' | 'system') => {
        if (!hierName.trim()) return;
        const newNode: HierarchyNode = {
            id: `hier-${Date.now()}`,
            name: hierName.trim(),
            code: hierCode.trim() || hierName.trim().substring(0, 6).toUpperCase(),
            level,
            parent_id: parentId,
            description: '',
            children_count: 0,
        };
        addHierarchyNode(newNode);
        setRegisterForm(f => ({ ...f, [targetField]: newNode.name }));
        setHierPopover(null);
        setHierName('');
        setHierCode('');
    }, [hierName, hierCode, addHierarchyNode]);

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* ═══ Page Header ═══ */}
            <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 font-sans tracking-tight">Asset Register</h1>
                    <p className="text-slate-500 text-sm mt-1">ISO 14224 compliant enterprise asset management</p>
                </div>
                <div className="flex gap-2">
                    <button onClick={() => {/* CSV export */ }} className="flex items-center gap-2 px-3 py-1.5 bg-brand-800 hover:bg-slate-100 text-brand-300 rounded-lg text-sm transition-colors border border-slate-200">
                        <Download size={16} /> Export
                    </button>
                    <button
                        onClick={() => setShowRegister(true)}
                        className="flex items-center gap-2 px-4 py-1.5 bg-accent-cyan hover:bg-primary-400 text-brand-900 font-semibold rounded-lg text-sm transition-colors shadow-[0_0_15px_rgba(6,182,212,0.2)]"
                    >
                        <Plus size={16} /> Register Asset
                    </button>
                </div>
            </div>

            {/* ═══ KPI Row ═══ */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 hover:border-slate-300 transition-all">
                    <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1">Total Assets</p>
                    <p className="text-2xl font-bold text-slate-800">{summary.total_assets}</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 hover:border-accent-safe/30 transition-all">
                    <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1">Operating</p>
                    <p className="text-2xl font-bold text-accent-safe">{summary.operating_count}</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 hover:border-yellow-500/30 transition-all">
                    <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1">In Maint.</p>
                    <p className="text-2xl font-bold text-yellow-500">{summary.maintenance_count}</p>
                </div>
                <div className="bg-brand-800 border-l-4 border-l-red-500 border-y border-y-brand-700 border-r border-r-brand-700 rounded-r-xl p-4">
                    <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1">Crit A</p>
                    <p className="text-2xl font-bold text-red-400">{summary.crit_a_count}</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                    <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1">Crit B</p>
                    <p className="text-2xl font-bold text-yellow-500">{summary.crit_b_count}</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                    <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1">Crit C</p>
                    <p className="text-2xl font-bold text-brand-300">{summary.crit_c_count}</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                    <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1">D / E</p>
                    <p className="text-2xl font-bold text-blue-400">{summary.crit_d_count + summary.crit_e_count}</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                    <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1">Avg Health</p>
                    <p className={`text-2xl font-bold ${summary.avg_health >= 80 ? 'text-accent-safe' : 'text-yellow-500'}`}>{summary.avg_health}</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 hover:border-red-500/30 transition-all">
                    <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1">Overdue PM</p>
                    <p className="text-2xl font-bold text-red-400">{summary.overdue_pm_count}</p>
                </div>
            </div>

            {/* ═══ Search & Filter Bar ═══ */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                <div className="flex flex-col md:flex-row gap-3">
                    {/* Search */}
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input
                            type="text"
                            placeholder="Search by tag, name, manufacturer…"
                            value={filters.search}
                            onChange={e => updateFilter('search', e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500 placeholder-brand-600"
                        />
                    </div>

                    {/* Quick filters */}
                    <div className="flex gap-2">
                        <button
                            onClick={() => setShowFilters(!showFilters)}
                            className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm transition-colors border ${showFilters ? 'bg-accent-cyan/10 border-accent-cyan/30 text-accent-cyan' : 'bg-slate-50 border-slate-200 text-brand-300 hover:border-slate-300'}`}
                        >
                            <Filter size={14} />
                            Filters
                            {activeFilters > 0 && <span className="bg-accent-cyan text-brand-900 text-[10px] font-bold px-1.5 rounded-full">{activeFilters}</span>}
                        </button>

                        {/* View toggle */}
                        <div className="flex bg-slate-50 rounded-lg p-1 border border-slate-200">
                            <button onClick={() => setViewMode('table')} className={`px-3 py-1.5 text-xs rounded transition-all ${viewMode === 'table' ? 'bg-slate-100 text-brand-200 shadow' : 'text-slate-500 hover:text-brand-200'}`}>
                                <Layers size={14} />
                            </button>
                            <button onClick={() => setViewMode('grid')} className={`px-3 py-1.5 text-xs rounded transition-all ${viewMode === 'grid' ? 'bg-slate-100 text-brand-200 shadow' : 'text-slate-500 hover:text-brand-200'}`}>
                                <Settings size={14} />
                            </button>
                        </div>

                        {/* Taxonomy level filter */}
                        <select
                            value={filters.taxonomyLevel}
                            onChange={e => updateFilter('taxonomyLevel', e.target.value as 'equipment' | 'all')}
                            className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500 appearance-none cursor-pointer"
                        >
                            <option value="equipment">Equipment Only</option>
                            <option value="all">All Levels</option>
                        </select>
                    </div>
                </div>

                {/* Extended filter panel */}
                {showFilters && (
                    <div className="mt-4 pt-4 border-t border-slate-200 grid grid-cols-2 md:grid-cols-4 gap-3 animate-in slide-in-from-top-2 duration-200">
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Criticality</label>
                            <select value={filters.criticality} onChange={e => updateFilter('criticality', e.target.value as CriticalityRank | 'all')} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500 appearance-none cursor-pointer">
                                <option value="all">All</option>
                                <option value="A">A — Safety Critical</option>
                                <option value="B">B — Production Significant</option>
                                <option value="C">C — Standard</option>
                                <option value="D">D — Low Impact</option>
                                <option value="E">E — Run-to-Failure</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Status</label>
                            <select value={filters.status} onChange={e => updateFilter('status', e.target.value as AssetStatus | 'all')} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500 appearance-none cursor-pointer">
                                <option value="all">All</option>
                                <option value="operating">Operating</option>
                                <option value="standby">Standby</option>
                                <option value="under_maintenance">Under Maintenance</option>
                                <option value="decommissioned">Decommissioned</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Equipment Class</label>
                            <select value={filters.equipment_class} onChange={e => updateFilter('equipment_class', e.target.value as EquipmentClass | 'all')} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500 appearance-none cursor-pointer">
                                <option value="all">All</option>
                                {Object.entries(EQUIP_CLASS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Site</label>
                            <select value={filters.site} onChange={e => updateFilter('site', e.target.value)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500 appearance-none cursor-pointer">
                                <option value="all">All Sites</option>
                                {sites.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                        {activeFilters > 0 && (
                            <div className="col-span-full">
                                <button onClick={resetFilters} className="text-xs text-accent-cyan hover:text-primary-300 transition-colors">Clear all filters</button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* ═══ Results Count ═══ */}
            <div className="flex items-center justify-between text-xs text-slate-400">
                <span>{assets.length} asset{assets.length !== 1 ? 's' : ''} found</span>
                <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-accent-safe animate-pulse" />
                    Live data feed active
                </span>
            </div>

            {/* ═══ Asset Table ═══ */}
            {viewMode === 'table' ? (
                <div className="bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-slate-400 uppercase bg-slate-50 sticky top-0 z-10">
                                <tr>
                                    <SortHeader field="tag" label="Tag" currentField={sortField} currentDir={sortDir} onSort={toggleSort} className="w-28" />
                                    <SortHeader field="name" label="Asset Name" currentField={sortField} currentDir={sortDir} onSort={toggleSort} />
                                    <th className="px-4 py-3 font-medium">Location</th>
                                    <SortHeader field="criticality" label="Crit" currentField={sortField} currentDir={sortDir} onSort={toggleSort} className="w-20" />
                                    <SortHeader field="status" label="Status" currentField={sortField} currentDir={sortDir} onSort={toggleSort} className="w-28" />
                                    <SortHeader field="health_index" label="Health" currentField={sortField} currentDir={sortDir} onSort={toggleSort} className="w-32" />
                                    <SortHeader field="running_hours" label="Run Hrs" currentField={sortField} currentDir={sortDir} onSort={toggleSort} className="w-24" />
                                    <SortHeader field="failure_count_ytd" label="Fails YTD" currentField={sortField} currentDir={sortDir} onSort={toggleSort} className="w-24" />
                                    <SortHeader field="cost_ytd" label="Cost YTD" currentField={sortField} currentDir={sortDir} onSort={toggleSort} className="w-28" />
                                    <th className="px-4 py-3 font-medium w-16">RPN</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-brand-700/50">
                                {assets.map(asset => (
                                    <tr
                                        key={asset.id}
                                        onClick={() => selectAsset(asset.id)}
                                        className={`cursor-pointer transition-colors ${selectedAsset?.id === asset.id ? 'bg-accent-cyan/5 border-l-2 border-l-accent-cyan' : 'hover:bg-slate-100/30 border-l-2 border-l-transparent'}`}
                                    >
                                        <td className="px-4 py-3">
                                            <span className="font-mono font-bold text-accent-cyan text-xs">{asset.tag}</span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <p className="text-slate-800 font-medium text-sm">{asset.name}</p>
                                            <p className="text-[11px] text-slate-400 mt-0.5">{asset.manufacturer} {asset.model}</p>
                                        </td>
                                        <td className="px-4 py-3">
                                            <p className="text-brand-300 text-xs">{asset.unit}</p>
                                            <p className="text-[10px] text-slate-400 mt-0.5">{asset.system}</p>
                                        </td>
                                        <td className="px-4 py-3"><CritBadge crit={asset.criticality} /></td>
                                        <td className="px-4 py-3"><StatusBadge status={asset.status} /></td>
                                        <td className="px-4 py-3"><HealthBar value={asset.health_index} /></td>
                                        <td className="px-4 py-3 text-brand-300 text-xs font-mono">{asset.running_hours.toLocaleString()}</td>
                                        <td className="px-4 py-3">
                                            <span className={`text-xs font-bold ${asset.failure_count_ytd > 2 ? 'text-red-400' : asset.failure_count_ytd > 0 ? 'text-yellow-500' : 'text-slate-400'}`}>
                                                {asset.failure_count_ytd}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-brand-300 text-xs font-mono">${asset.cost_ytd.toLocaleString()}</td>
                                        <td className="px-4 py-3">
                                            <span className={`text-xs font-bold px-2 py-0.5 rounded ${asset.risk_priority.rpn >= 60 ? 'bg-red-500/15 text-red-400' : asset.risk_priority.rpn >= 30 ? 'bg-yellow-500/15 text-yellow-500' : 'bg-slate-100 text-slate-500'}`}>
                                                {asset.risk_priority.rpn}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                /* ═══ Grid View ═══ */
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {assets.map(asset => (
                        <div
                            key={asset.id}
                            onClick={() => selectAsset(asset.id)}
                            className={`bg-brand-800 border rounded-xl p-5 cursor-pointer transition-all hover:shadow-lg ${selectedAsset?.id === asset.id ? 'border-accent-cyan shadow-accent-cyan/10' : 'border-slate-200 hover:border-slate-300'}`}
                        >
                            <div className="flex items-start justify-between mb-3">
                                <div>
                                    <span className="font-mono font-bold text-accent-cyan text-sm">{asset.tag}</span>
                                    <p className="text-slate-800 font-semibold mt-1">{asset.name}</p>
                                    <p className="text-xs text-slate-400 mt-0.5">{asset.unit} • {asset.system}</p>
                                </div>
                                <CritBadge crit={asset.criticality} size="md" />
                            </div>
                            <div className="flex items-center justify-between mb-3">
                                <StatusBadge status={asset.status} />
                                <HealthBar value={asset.health_index} />
                            </div>
                            <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-200/50">
                                <div>
                                    <p className="text-[9px] text-slate-400 uppercase">RPN</p>
                                    <p className={`text-sm font-bold ${asset.risk_priority.rpn >= 60 ? 'text-red-400' : 'text-brand-200'}`}>{asset.risk_priority.rpn}</p>
                                </div>
                                <div>
                                    <p className="text-[9px] text-slate-400 uppercase">Fails YTD</p>
                                    <p className={`text-sm font-bold ${asset.failure_count_ytd > 2 ? 'text-red-400' : 'text-brand-200'}`}>{asset.failure_count_ytd}</p>
                                </div>
                                <div>
                                    <p className="text-[9px] text-slate-400 uppercase">Cost YTD</p>
                                    <p className="text-sm font-bold text-brand-200">${(asset.cost_ytd / 1000).toFixed(0)}k</p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ═══ Detail Slide-Out Panel ═══ */}
            {selectedAsset && (
                <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-brand-800 border-l border-slate-200 shadow-2xl shadow-black/60 z-40 overflow-y-auto animate-in slide-in-from-right duration-300">
                    {/* Header */}
                    <div className="sticky top-0 bg-brand-800/95 backdrop-blur-sm border-b border-slate-200 p-6 z-10">
                        <div className="flex items-start justify-between">
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="font-mono font-bold text-accent-cyan">{selectedAsset.tag}</span>
                                    <CritBadge crit={editMode ? (editForm.criticality || selectedAsset.criticality) : selectedAsset.criticality} size="md" />
                                    <StatusBadge status={editMode ? (editForm.status || selectedAsset.status) : selectedAsset.status} />
                                </div>
                                {editMode ? (
                                    <input value={editForm.name || ''} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                                        className="text-xl font-bold text-slate-800 bg-slate-50 border border-slate-300 rounded px-2 py-1 w-full focus:outline-none focus:border-relantern-500" />
                                ) : (
                                    <h2 className="text-xl font-bold text-slate-800">{selectedAsset.name}</h2>
                                )}
                                {editMode ? (
                                    <textarea value={editForm.description || ''} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                                        rows={2} className="text-sm text-slate-500 mt-1 bg-slate-50 border border-slate-300 rounded px-2 py-1 w-full focus:outline-none focus:border-relantern-500 resize-none" />
                                ) : (
                                    <p className="text-sm text-slate-500 mt-1">{selectedAsset.description}</p>
                                )}
                            </div>
                            <div className="flex items-center gap-1">
                                {editMode ? (
                                    <>
                                        <button onClick={saveEdit} className="p-2 text-accent-safe hover:bg-accent-safe/10 rounded-lg transition-colors" title="Save changes">
                                            <Save size={18} />
                                        </button>
                                        <button onClick={cancelEdit} className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors" title="Cancel">
                                            <XCircle size={18} />
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button onClick={startEdit} className="p-2 text-slate-500 hover:text-accent-cyan hover:bg-accent-cyan/10 rounded-lg transition-colors" title="Edit asset">
                                            <Pencil size={16} />
                                        </button>
                                        <button onClick={() => setShowDeleteConfirm(true)} className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors" title="Delete asset">
                                            <Trash2 size={16} />
                                        </button>
                                    </>
                                )}
                                <button onClick={() => { selectAsset(null); setEditMode(false); }} className="p-2 text-slate-500 hover:text-brand-200 hover:bg-slate-100 rounded-lg transition-colors">
                                    <X size={20} />
                                </button>
                            </div>
                        </div>
                        {/* Edit-mode: Criticality + Status selectors */}
                        {editMode && (
                            <div className="flex gap-3 mt-3 animate-in fade-in duration-200">
                                <div className="flex-1">
                                    <label className="block text-[10px] text-slate-400 uppercase mb-1">Criticality</label>
                                    <select value={editForm.criticality || 'C'} onChange={e => setEditForm(f => ({ ...f, criticality: e.target.value as CriticalityRank }))}
                                        className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded text-sm text-slate-800 focus:outline-none focus:border-relantern-500">
                                        {Object.entries(CRITICALITY_LABELS).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}
                                    </select>
                                </div>
                                <div className="flex-1">
                                    <label className="block text-[10px] text-slate-400 uppercase mb-1">Status</label>
                                    <select value={editForm.status || 'operating'} onChange={e => setEditForm(f => ({ ...f, status: e.target.value as AssetStatus }))}
                                        className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded text-sm text-slate-800 focus:outline-none focus:border-relantern-500">
                                        <option value="operating">Operating</option>
                                        <option value="standby">Standby</option>
                                        <option value="under_maintenance">Under Maintenance</option>
                                        <option value="decommissioned">Decommissioned</option>
                                        <option value="mothballed">Mothballed</option>
                                    </select>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Delete Confirmation Modal */}
                    {showDeleteConfirm && (
                        <div className="absolute inset-0 z-20 bg-black/50 backdrop-blur-sm flex items-center justify-center p-6">
                            <div className="bg-white border border-slate-200 rounded-xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200">
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="p-2 bg-red-500/10 rounded-lg"><Trash2 size={20} className="text-red-400" /></div>
                                    <div>
                                        <h3 className="text-base font-bold text-slate-800">Delete Asset</h3>
                                        <p className="text-xs text-slate-500">{selectedAsset.tag} — {selectedAsset.name}</p>
                                    </div>
                                </div>
                                {selectedAsset.criticality === 'A' && (
                                    <div className="flex items-start gap-2 bg-red-500/5 border border-red-500/20 rounded-lg p-3 mb-4 animate-in fade-in duration-200">
                                        <AlertTriangle size={14} className="text-red-400 mt-0.5 shrink-0" />
                                        <div>
                                            <p className="text-xs font-semibold text-red-400">Safety Critical — Gatekeeper Required</p>
                                            <p className="text-[10px] text-slate-500 mt-0.5">Criticality A assets require a mandatory reason for deletion and digital sign-off.</p>
                                        </div>
                                    </div>
                                )}
                                {(selectedAsset.criticality === 'A' || selectedAsset.criticality === 'B') && (
                                    <div className="mb-4">
                                        <label className="block text-[10px] text-slate-500 uppercase mb-1">Reason for Deletion *</label>
                                        <textarea value={deleteReason} onChange={e => setDeleteReason(e.target.value)} rows={3} placeholder="Justification required…"
                                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-red-400 placeholder-brand-600 resize-none" />
                                    </div>
                                )}
                                <div className="flex justify-end gap-2">
                                    <button onClick={() => { setShowDeleteConfirm(false); setDeleteReason(''); }} className="px-4 py-2 bg-slate-50 border border-slate-200 text-brand-300 hover:bg-slate-100 rounded-lg text-sm transition-colors">Cancel</button>
                                    <button onClick={handleDelete}
                                        disabled={['A', 'B'].includes(selectedAsset.criticality) && deleteReason.trim().length < 10}
                                        className="px-4 py-2 bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-semibold transition-colors">
                                        Confirm Delete
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="p-6 space-y-5">
                        {/* Tab Bar */}
                        <div className="flex gap-1 bg-slate-50 border border-slate-200 rounded-lg p-1">
                            {(['overview', 'reliability', 'failures', 'bom', 'inspections', 'vision'] as const).map(tab => (
                                <button key={tab} onClick={() => setDetailTab(tab)}
                                    className={`flex-1 px-3 py-2 rounded-md text-xs font-bold uppercase tracking-wider transition-all ${detailTab === tab ? 'bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/30' : 'text-slate-500 hover:text-brand-200 border border-transparent'
                                        }`}>
                                    {tab === 'overview' ? 'Overview' : tab === 'reliability' ? 'Reliability' : tab === 'failures' ? 'Failures' : tab === 'bom' ? 'BOM' : tab === 'inspections' ? 'Inspect' : 'Vision'}
                                </button>
                            ))}
                        </div>

                        {/* OVERVIEW TAB */}
                        {detailTab === 'overview' && (
                            <div className="space-y-5 animate-in fade-in duration-200">
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Heart size={14} className="text-accent-safe" />
                                            <p className="text-[10px] text-slate-400 uppercase font-bold">Health Index</p>
                                        </div>
                                        <p className={`text-3xl font-bold ${selectedAsset.health_index >= 80 ? 'text-accent-safe' : selectedAsset.health_index >= 60 ? 'text-yellow-500' : 'text-red-400'}`}>{selectedAsset.health_index}</p>
                                        <HealthBar value={selectedAsset.health_index} showLabel={false} />
                                    </div>
                                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Clock size={14} className="text-slate-500" />
                                            <p className="text-[10px] text-slate-400 uppercase font-bold">Remaining Life</p>
                                        </div>
                                        <p className={`text-3xl font-bold ${(selectedAsset.rul_days || 999) < 90 ? 'text-red-400' : 'text-slate-800'}`}>
                                            {selectedAsset.rul_days?.toFixed(0) || '---'}
                                        </p>
                                        <p className="text-[10px] text-slate-400">days estimated</p>
                                    </div>
                                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                                        <div className="flex items-center gap-2 mb-2">
                                            <AlertTriangle size={14} className="text-yellow-500" />
                                            <p className="text-[10px] text-slate-400 uppercase font-bold">Risk Priority</p>
                                        </div>
                                        <p className={`text-3xl font-bold ${selectedAsset.risk_priority.rpn >= 60 ? 'text-red-400' : 'text-slate-800'}`}>{selectedAsset.risk_priority.rpn}</p>
                                        <p className="text-[10px] text-slate-400">RPN {selectedAsset.risk_priority.rpn}</p>
                                    </div>
                                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                                        <div className="flex items-center gap-2 mb-2">
                                            <DollarSign size={14} className="text-slate-500" />
                                            <p className="text-[10px] text-slate-400 uppercase font-bold">Cost YTD</p>
                                        </div>
                                        <p className="text-3xl font-bold text-slate-800">${(selectedAsset.cost_ytd / 1000).toFixed(0)}k</p>
                                        <p className="text-[10px] text-slate-400">{selectedAsset.wo_count_ytd} work orders</p>
                                    </div>
                                </div>
                                <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
                                    <h3 className="text-sm font-bold text-brand-200 uppercase tracking-wider mb-4 flex items-center gap-2">
                                        <Gauge size={16} className="text-accent-cyan" /> Reliability Metrics
                                    </h3>
                                    <div className="space-y-3">
                                        {[
                                            { label: 'Running Hours', value: selectedAsset.running_hours.toLocaleString(), icon: <Clock size={14} />, editKey: 'running_hours' as const },
                                            { label: 'MTBF', value: selectedAsset.mtbf_days ? `${selectedAsset.mtbf_days} days` : '---', icon: <TrendingUp size={14} /> },
                                            { label: 'MTTR', value: selectedAsset.mttr_hours ? `${selectedAsset.mttr_hours} hrs` : '---', icon: <TrendingDown size={14} /> },
                                            { label: 'Failures YTD', value: selectedAsset.failure_count_ytd.toString(), icon: <Zap size={14} />, alert: selectedAsset.failure_count_ytd > 2 },
                                            { label: 'Condition Rating', value: `${selectedAsset.condition_rating}/5`, icon: <BarChart2 size={14} />, editKey: 'condition_rating' as const },
                                        ].map(row => (
                                            <div key={row.label} className="flex items-center justify-between py-2 border-b border-slate-200/50 last:border-0">
                                                <div className="flex items-center gap-2 text-slate-500">
                                                    {row.icon}
                                                    <span className="text-xs">{row.label}</span>
                                                </div>
                                                {editMode && row.editKey ? (
                                                    <input type="number" value={editForm[row.editKey] ?? ''}
                                                        onChange={e => setEditForm(f => ({ ...f, [row.editKey!]: Number(e.target.value) }))}
                                                        className="w-24 px-2 py-0.5 bg-brand-800 border border-slate-300 rounded text-sm text-slate-800 font-mono text-right focus:outline-none focus:border-relantern-500" />
                                                ) : (
                                                    <span className={`text-sm font-bold font-mono ${'alert' in row && row.alert ? 'text-red-400' : 'text-slate-800'}`}>{row.value}</span>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
                                    <h3 className="text-sm font-bold text-brand-200 uppercase tracking-wider mb-4 flex items-center gap-2">
                                        <Tag size={16} className="text-accent-cyan" /> Asset Details
                                    </h3>
                                    <div className="space-y-3">
                                        {[
                                            { label: 'Functional Location', value: selectedAsset.functional_location, icon: <MapPin size={14} /> },
                                            { label: 'Category', value: MOCK_DICTIONARIES.find(d => d.type === 'ASSET_CATEGORY' && d.code === selectedAsset.equipment_category)?.description || selectedAsset.equipment_category.replace(/_/g, ' '), icon: <Layers size={14} /> },
                                            { label: 'Equipment Class', value: MOCK_DICTIONARIES.find(d => d.type === 'ASSET_CLASS' && d.code === selectedAsset.equipment_class)?.description || EQUIP_CLASS_LABELS[selectedAsset.equipment_class] || selectedAsset.equipment_class, icon: <Settings size={14} /> },
                                            { label: 'Equipment Type', value: MOCK_DICTIONARIES.find(d => d.type === 'ASSET_TYPE' && d.code === selectedAsset.equipment_type)?.description || EQUIPMENT_TYPE_LABELS[selectedAsset.equipment_type] || selectedAsset.equipment_type, icon: <Cpu size={14} /> },
                                            { label: 'Maint. Strategy', value: MAINTENANCE_STRATEGY_LABELS[selectedAsset.maintenance_strategy], icon: <Activity size={14} /> },
                                            { label: 'Manufacturer', value: selectedAsset.manufacturer, icon: <Package size={14} />, editKey: 'manufacturer' as const },
                                            { label: 'Model', value: selectedAsset.model, icon: <Cpu size={14} />, editKey: 'model' as const },
                                            { label: 'Serial No.', value: selectedAsset.serial_number, icon: <Hash size={14} />, editKey: 'serial_number' as const },
                                            { label: 'Install Date', value: new Date(selectedAsset.install_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }), icon: <Calendar size={14} /> },
                                            { label: 'Last Overhaul', value: selectedAsset.last_overhaul ? new Date(selectedAsset.last_overhaul).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '---', icon: <Wrench size={14} /> },
                                        ].map(row => (
                                            <div key={row.label} className="flex items-center justify-between py-2 border-b border-slate-200/50 last:border-0">
                                                <div className="flex items-center gap-2 text-slate-500">
                                                    {row.icon}
                                                    <span className="text-xs">{row.label}</span>
                                                </div>
                                                {editMode && row.editKey ? (
                                                    <input type="text" value={(editForm as Record<string, unknown>)[row.editKey] as string ?? ''}
                                                        onChange={e => setEditForm(f => ({ ...f, [row.editKey!]: e.target.value }))}
                                                        className="w-40 px-2 py-0.5 bg-brand-800 border border-slate-300 rounded text-sm text-slate-800 text-right focus:outline-none focus:border-relantern-500" />
                                                ) : (
                                                    <span className="text-sm text-slate-800 font-medium text-right max-w-[200px] truncate">{row.value}</span>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="flex gap-2 flex-wrap">
                                    <button className="flex items-center gap-2 px-4 py-2 bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan hover:bg-accent-cyan/20 rounded-lg text-sm font-medium transition-colors">
                                        <Wrench size={14} /> Create WO
                                    </button>
                                    <button onClick={() => navigate(`/predict?asset=${selectedAsset.id}`)}
                                        className="flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-200 text-brand-300 hover:bg-slate-100 rounded-lg text-sm font-medium transition-colors">
                                        <Activity size={14} /> Predict
                                    </button>
                                    <button onClick={() => navigate(`/analyze?asset=${selectedAsset.id}&tab=fmeca`)}
                                        className="flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-200 text-brand-300 hover:bg-slate-100 rounded-lg text-sm font-medium transition-colors">
                                        <BarChart2 size={14} /> Analyze
                                    </button>
                                    <button onClick={() => navigate(`/analyze?tab=reliability`)}
                                        className="flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-200 text-brand-300 hover:bg-slate-100 rounded-lg text-sm font-medium transition-colors">
                                        <Cpu size={14} /> Model in RBD
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* RELIABILITY TAB */}
                        {detailTab === 'reliability' && (
                            <div className="space-y-5 animate-in fade-in duration-200">
                                <div className="grid grid-cols-2 gap-3">
                                    {getAssetKPIs(selectedAsset.id, selectedAsset.running_hours).map(kpi => {
                                        const sc = kpi.status === 'good'
                                            ? { bg: 'bg-green-500/10', bd: 'border-green-500/30', tx: 'text-green-400', rg: 'ring-green-500/20', bar: 'bg-green-500' }
                                            : kpi.status === 'warning'
                                                ? { bg: 'bg-yellow-500/10', bd: 'border-yellow-500/30', tx: 'text-yellow-400', rg: 'ring-yellow-500/20', bar: 'bg-yellow-500' }
                                                : { bg: 'bg-red-500/10', bd: 'border-red-500/30', tx: 'text-red-400', rg: 'ring-red-500/20', bar: 'bg-red-500' };
                                        const dispVal = kpi.name === 'Maint. Cost' ? `$${(kpi.value / 1000).toFixed(0)}k` : String(kpi.value);
                                        const dispTarget = kpi.name === 'Maint. Cost' ? `$${(kpi.target / 1000).toFixed(0)}k` : String(kpi.target);
                                        return (
                                            <div key={kpi.code} className={`${sc.bg} border ${sc.bd} rounded-xl p-4 transition-all hover:ring-2 ${sc.rg}`}>
                                                <div className="flex items-center justify-between mb-2">
                                                    <p className="text-[10px] text-slate-400 uppercase font-bold">{kpi.name}</p>
                                                    <span className="text-[9px] text-brand-600 font-mono">SMRP {kpi.code}</span>
                                                </div>
                                                <div className="flex items-end gap-2">
                                                    <p className={`text-2xl font-bold font-mono ${sc.tx}`}>{dispVal}</p>
                                                    <span className="text-[10px] text-slate-400 mb-1">{kpi.unit}</span>
                                                </div>
                                                <div className="mt-2 flex items-center justify-between">
                                                    <div className="flex-1 h-1.5 bg-brand-800 rounded-full overflow-hidden mr-3">
                                                        <div className={`h-full rounded-full transition-all ${sc.bar}`}
                                                            style={{ width: `${Math.min(100, (kpi.value / kpi.target) * 100)}%` }} />
                                                    </div>
                                                    <span className="text-[9px] text-slate-400">Target: {dispTarget}</span>
                                                </div>
                                                <div className="mt-1 flex items-center gap-1">
                                                    {kpi.trend === 'up' ? <TrendingUp size={10} className="text-green-400" /> : kpi.trend === 'down' ? <TrendingDown size={10} className="text-red-400" /> : null}
                                                    <span className="text-[9px] text-slate-400">{kpi.trend === 'up' ? 'On target' : kpi.trend === 'down' ? 'Below target' : 'Stable'}</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                {getAssetFailures(selectedAsset.id).length >= 3 && (
                                    <div className="flex items-start gap-3 bg-red-500/5 border border-red-500/20 rounded-lg p-4">
                                        <AlertTriangle size={16} className="text-red-400 mt-0.5 shrink-0" />
                                        <div className="flex-1">
                                            <p className="text-sm font-semibold text-red-400">Bad Actor Alert</p>
                                            <p className="text-xs text-slate-500 mt-1">This asset has {getAssetFailures(selectedAsset.id).length} recorded failures. Qualifies for Defect Elimination review.</p>
                                            <button
                                                onClick={() => navigate(`/analyze?division=defect_elimination&asset=${selectedAsset.id}`)}
                                                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
                                            >
                                                <Target size={12} /> View / Create DE Task
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* ═══ RBD Studies Referencing This Asset ═══ */}
                                <LinkedRBDStudies assetId={selectedAsset.id} navigate={navigate} />
                            </div>
                        )}

                        {/* FAILURES TAB */}
                        {detailTab === 'failures' && (
                            <div className="space-y-4 animate-in fade-in duration-200">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-sm font-bold text-brand-200 uppercase tracking-wider flex items-center gap-2">
                                        <Zap size={16} className="text-red-400" /> Failure History
                                    </h3>
                                    <span className="text-xs text-slate-400">{getAssetFailures(selectedAsset.id).length} events</span>
                                </div>
                                {getAssetFailures(selectedAsset.id).length === 0 ? (
                                    <div className="text-center py-12">
                                        <CheckCircle size={32} className="mx-auto text-green-500/30 mb-3" />
                                        <p className="text-sm text-slate-500">No failure events recorded</p>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {getAssetFailures(selectedAsset.id).map(evt => (
                                            <div key={evt.id} className="bg-slate-50 border border-slate-200 rounded-lg p-4 hover:border-slate-300 transition-colors">
                                                <div className="flex items-start justify-between mb-2">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${evt.severity >= 4 ? 'bg-red-500/20 text-red-400' :
                                                            evt.severity >= 3 ? 'bg-yellow-500/20 text-yellow-400' :
                                                                'bg-blue-500/20 text-blue-400'
                                                            }`}>SEV {evt.severity}</span>
                                                        <span className="text-[10px] text-slate-400 font-mono">{evt.wo_id || '---'}</span>
                                                    </div>
                                                    <span className="text-[10px] text-slate-400">{new Date(evt.start_time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                                </div>
                                                <p className="text-xs text-brand-200 leading-relaxed mb-2">{evt.description}</p>
                                                <div className="grid grid-cols-3 gap-2">
                                                    <div>
                                                        <p className="text-[9px] text-brand-600 uppercase">Mode</p>
                                                        <p className="text-[10px] text-brand-300 font-medium">{FAILURE_MODE_LABELS[evt.failure_mode]}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-[9px] text-brand-600 uppercase">Cause</p>
                                                        <p className="text-[10px] text-brand-300 font-medium">{FAILURE_CAUSE_LABELS[evt.failure_cause]}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-[9px] text-brand-600 uppercase">Remedy</p>
                                                        <p className="text-[10px] text-brand-300 font-medium">{REMEDY_LABELS[evt.remedy]}</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-4 mt-2 pt-2 border-t border-slate-200/50">
                                                    <span className="text-[10px] text-slate-400">{evt.downtime_hours}h downtime</span>
                                                    <span className="text-[10px] text-slate-400">${evt.cost.toLocaleString()}</span>
                                                    <span className="text-[10px] text-slate-400 capitalize">{evt.detected_by.replace(/_/g, ' ')}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* BOM TAB */}
                        {detailTab === 'bom' && (() => {
                            const bomEntries = getBOMForAsset(selectedAsset.id);
                            const totalBomCost = bomEntries.reduce((s, e) => s + e.qty_required * e.unit_cost_usd, 0);
                            const criticalCount = bomEntries.filter(e => e.criticality_flag).length;

                            // Lookup stock status for each BOM entry
                            const getStockInfo = (itemId: string) => {
                                const inv = inventoryItems.find(i => i.id === itemId);
                                return inv ? { qty: inv.qty_on_hand, status: inv.stock_status } : { qty: 0, status: 'out_of_stock' as InvStockStatus };
                            };

                            return (
                                <div className="space-y-5 animate-in fade-in duration-200">
                                    {/* BOM Summary Cards */}
                                    <div className="grid grid-cols-3 gap-3">
                                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                                            <div className="flex items-center gap-2 mb-2">
                                                <Box size={14} className="text-accent-cyan" />
                                                <p className="text-[10px] text-slate-400 uppercase font-bold">Components</p>
                                            </div>
                                            <p className="text-3xl font-bold text-slate-800">{bomEntries.length}</p>
                                            <p className="text-[10px] text-slate-400">sub-components</p>
                                        </div>
                                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                                            <div className="flex items-center gap-2 mb-2">
                                                <DollarSign size={14} className="text-yellow-500" />
                                                <p className="text-[10px] text-slate-400 uppercase font-bold">BOM Cost</p>
                                            </div>
                                            <p className="text-3xl font-bold text-slate-800">${totalBomCost >= 1000 ? `${(totalBomCost / 1000).toFixed(1)}k` : totalBomCost.toFixed(0)}</p>
                                            <p className="text-[10px] text-slate-400">total replacement</p>
                                        </div>
                                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                                            <div className="flex items-center gap-2 mb-2">
                                                <ShieldAlert size={14} className="text-red-400" />
                                                <p className="text-[10px] text-slate-400 uppercase font-bold">Critical</p>
                                            </div>
                                            <p className={`text-3xl font-bold ${criticalCount > 0 ? 'text-red-400' : 'text-slate-800'}`}>{criticalCount}</p>
                                            <p className="text-[10px] text-slate-400">safety-critical parts</p>
                                        </div>
                                    </div>

                                    {/* BOM Entries */}
                                    {bomEntries.length === 0 ? (
                                        <div className="text-center py-12">
                                            <Box size={32} className="mx-auto text-brand-600 mb-3" />
                                            <p className="text-sm text-slate-500">No BOM entries linked to this asset</p>
                                            <p className="text-xs text-slate-400 mt-1">Add components via the Inventory module</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <h3 className="text-sm font-bold text-brand-200 uppercase tracking-wider flex items-center gap-2">
                                                    <Box size={16} className="text-accent-cyan" /> Sub-Components
                                                </h3>
                                                <span className="text-xs text-slate-400">{bomEntries.length} items</span>
                                            </div>
                                            {bomEntries.map(entry => {
                                                const stock = getStockInfo(entry.item_id);
                                                const lineCost = entry.qty_required * entry.unit_cost_usd;
                                                return (
                                                    <div key={entry.id} className="bg-slate-50 border border-slate-200 rounded-lg p-4 hover:border-slate-300 transition-colors">
                                                        <div className="flex items-start justify-between mb-2">
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-mono text-xs font-bold text-accent-cyan">{entry.part_number}</span>
                                                                {entry.criticality_flag && (
                                                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-500/20 text-red-400">CRITICAL</span>
                                                                )}
                                                            </div>
                                                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${stock.status === 'in_stock' ? 'bg-green-500/15 text-green-400' :
                                                                stock.status === 'low_stock' ? 'bg-yellow-500/15 text-yellow-400' :
                                                                    stock.status === 'on_order' ? 'bg-blue-500/15 text-blue-400' :
                                                                        'bg-red-500/15 text-red-400'
                                                                }`}>
                                                                {stock.status === 'in_stock' ? `${stock.qty} in stock` :
                                                                    stock.status === 'low_stock' ? `${stock.qty} low` :
                                                                        stock.status === 'on_order' ? 'On Order' : 'Out of Stock'}
                                                            </span>
                                                        </div>
                                                        <p className="text-xs text-brand-200 mb-2">{entry.description}</p>
                                                        <div className="grid grid-cols-4 gap-3">
                                                            <div>
                                                                <p className="text-[9px] text-brand-600 uppercase">Qty Req.</p>
                                                                <p className="text-xs text-brand-300 font-bold font-mono">{entry.qty_required}</p>
                                                            </div>
                                                            <div>
                                                                <p className="text-[9px] text-brand-600 uppercase">Unit Cost</p>
                                                                <p className="text-xs text-brand-300 font-mono">${entry.unit_cost_usd.toLocaleString()}</p>
                                                            </div>
                                                            <div>
                                                                <p className="text-[9px] text-brand-600 uppercase">Line Cost</p>
                                                                <p className="text-xs text-brand-300 font-bold font-mono">${lineCost.toLocaleString()}</p>
                                                            </div>
                                                            <div>
                                                                <p className="text-[9px] text-brand-600 uppercase">Replace</p>
                                                                <p className="text-xs text-brand-300 flex items-center gap-1">
                                                                    <RefreshCcw size={10} />
                                                                    {entry.replacement_interval_days
                                                                        ? entry.replacement_interval_days >= 365
                                                                            ? `${(entry.replacement_interval_days / 365).toFixed(1)}y`
                                                                            : `${entry.replacement_interval_days}d`
                                                                        : '—'}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        {/* Stock shortfall warning */}
                                                        {stock.qty < entry.qty_required && (
                                                            <div className="mt-2 pt-2 border-t border-slate-200/50 flex items-center gap-2">
                                                                <AlertTriangle size={12} className="text-yellow-500 shrink-0" />
                                                                <span className="text-[10px] text-yellow-400">
                                                                    Shortfall: need {entry.qty_required}, only {stock.qty} on hand
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {/* Total Cost Bar */}
                                    {bomEntries.length > 0 && (
                                        <div className="bg-slate-50 border border-accent-cyan/20 rounded-lg p-4">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <DollarSign size={16} className="text-accent-cyan" />
                                                    <span className="text-sm font-bold text-brand-200 uppercase tracking-wider">Total BOM Replacement Cost</span>
                                                </div>
                                                <span className="text-lg font-bold text-accent-cyan font-mono">${totalBomCost.toLocaleString()}</span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })()}

                        {/* VISION TAB */}
                        {detailTab === 'vision' && (
                            <VisionHistoryPanel
                                assetId={selectedAsset.id}
                                assetName={selectedAsset.name}
                                assetTag={selectedAsset.tag}
                                assetCriticality={selectedAsset.criticality}
                            />
                        )}

                        {/* INSPECTIONS TAB */}
                        {detailTab === 'inspections' && (
                            <div className="animate-in fade-in duration-200">
                                <InspectionAssetTab assetId={selectedAsset.id} assetName={selectedAsset.name} />
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ═══ Register New Asset Modal ═══ */}
            {
                showRegister && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => !registerCreated && setShowRegister(false)}>
                        <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl mx-4 shadow-2xl shadow-black/50 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                            <div className="p-6 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-brand-800 z-10">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-accent-cyan/10 rounded-lg text-accent-cyan"><Plus size={20} /></div>
                                    <div>
                                        <h2 className="text-lg font-bold text-slate-800">Register New Asset</h2>
                                        <p className="text-xs text-slate-500 mt-0.5">ISO 14224 Equipment Level Registration</p>
                                    </div>
                                </div>
                                <button onClick={() => setShowRegister(false)} className="p-1.5 text-slate-500 hover:text-brand-200 hover:bg-slate-100 rounded-lg transition-colors">
                                    <X size={18} />
                                </button>
                            </div>

                            {registerCreated ? (
                                <div className="p-12 flex flex-col items-center gap-4 animate-in zoom-in-95 duration-300">
                                    <div className="p-4 bg-accent-safe/10 rounded-2xl text-accent-safe ring-4 ring-accent-safe/10"><CheckCircle size={40} /></div>
                                    <h3 className="text-lg font-bold text-slate-800">Asset Registered</h3>
                                    <p className="text-sm text-slate-500 text-center">
                                        <span className="text-accent-cyan font-medium font-mono">{registerForm.tag}</span> has been added to the asset register.
                                    </p>
                                </div>
                            ) : (
                                <div className="p-6 space-y-5">
                                    {/* Identification */}
                                    <div>
                                        <h3 className="text-xs font-bold text-brand-300 uppercase tracking-wider mb-3">Identification</h3>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className="block text-[10px] text-slate-500 uppercase mb-1">Equipment Tag *</label>
                                                <input type="text" value={registerForm.tag} onChange={e => setRegisterForm(f => ({ ...f, tag: e.target.value }))} placeholder="e.g. K-701" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500 placeholder-brand-600 font-mono" />
                                            </div>
                                            <div>
                                                <label className="block text-[10px] text-slate-500 uppercase mb-1">Asset Name *</label>
                                                <input type="text" value={registerForm.name} onChange={e => setRegisterForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Gas Compressor K-701" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500 placeholder-brand-600" />
                                            </div>
                                        </div>
                                        <div className="mt-3">
                                            <label className="block text-[10px] text-slate-500 uppercase mb-1">Description</label>
                                            <textarea value={registerForm.description} onChange={e => setRegisterForm(f => ({ ...f, description: e.target.value }))} rows={2} placeholder="Technical description…" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500 placeholder-brand-600 resize-none" />
                                        </div>
                                    </div>

                                    {/* Location */}
                                    <div>
                                        <h3 className="text-xs font-bold text-brand-300 uppercase tracking-wider mb-3">Location & Hierarchy</h3>
                                        <div className="grid grid-cols-3 gap-3">
                                            {/* Site */}
                                            <div>
                                                <label className="block text-[10px] text-slate-500 uppercase mb-1">Site *</label>
                                                <div className="flex gap-1">
                                                    <select value={registerForm.site} onChange={e => setRegisterForm(f => ({ ...f, site: e.target.value }))} className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500 appearance-none cursor-pointer">
                                                        <option value="">Select…</option>
                                                        {hierarchySites.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                                                    </select>
                                                    <button type="button" onClick={() => setHierPopover(hierPopover?.level === 'site' ? null : { level: 'site', parentId: null })} className="px-2 py-2 bg-slate-50 border border-slate-200 rounded-lg text-accent-cyan hover:bg-accent-cyan/10 hover:border-accent-cyan/30 transition-colors" title="Add new site">
                                                        <Plus size={14} />
                                                    </button>
                                                </div>
                                                {hierPopover?.level === 'site' && (
                                                    <div className="mt-2 p-3 bg-slate-50 border border-accent-cyan/30 rounded-lg space-y-2 animate-in fade-in duration-200">
                                                        <input type="text" value={hierName} onChange={e => setHierName(e.target.value)} placeholder="Site name" className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-sm text-slate-800 focus:outline-none focus:border-relantern-500 placeholder-brand-600" autoFocus />
                                                        <input type="text" value={hierCode} onChange={e => setHierCode(e.target.value)} placeholder="Code (auto)" className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-sm text-slate-800 focus:outline-none focus:border-relantern-500 placeholder-brand-600 font-mono" />
                                                        <div className="flex gap-1">
                                                            <button onClick={() => handleCreateHierNode('site', null, 'site')} disabled={!hierName.trim()} className="flex-1 px-2 py-1.5 bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan text-xs font-semibold rounded disabled:opacity-40 transition-colors">Create</button>
                                                            <button onClick={() => { setHierPopover(null); setHierName(''); setHierCode(''); }} className="px-2 py-1.5 bg-white border border-slate-200 text-slate-500 text-xs rounded transition-colors">Cancel</button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            {/* Unit */}
                                            <div>
                                                <label className="block text-[10px] text-slate-500 uppercase mb-1">Unit *</label>
                                                <div className="flex gap-1">
                                                    <select value={registerForm.unit} onChange={e => setRegisterForm(f => ({ ...f, unit: e.target.value }))} className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500 appearance-none cursor-pointer">
                                                        <option value="">Select…</option>
                                                        {hierarchyUnits.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                                                    </select>
                                                    <button type="button" onClick={() => setHierPopover(hierPopover?.level === 'unit' ? null : { level: 'unit', parentId: null })} className="px-2 py-2 bg-slate-50 border border-slate-200 rounded-lg text-accent-cyan hover:bg-accent-cyan/10 hover:border-accent-cyan/30 transition-colors" title="Add new unit">
                                                        <Plus size={14} />
                                                    </button>
                                                </div>
                                                {hierPopover?.level === 'unit' && (
                                                    <div className="mt-2 p-3 bg-slate-50 border border-accent-cyan/30 rounded-lg space-y-2 animate-in fade-in duration-200">
                                                        <input type="text" value={hierName} onChange={e => setHierName(e.target.value)} placeholder="Unit name" className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-sm text-slate-800 focus:outline-none focus:border-relantern-500 placeholder-brand-600" autoFocus />
                                                        <input type="text" value={hierCode} onChange={e => setHierCode(e.target.value)} placeholder="Code (auto)" className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-sm text-slate-800 focus:outline-none focus:border-relantern-500 placeholder-brand-600 font-mono" />
                                                        <div className="flex gap-1">
                                                            <button onClick={() => handleCreateHierNode('unit', null, 'unit')} disabled={!hierName.trim()} className="flex-1 px-2 py-1.5 bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan text-xs font-semibold rounded disabled:opacity-40 transition-colors">Create</button>
                                                            <button onClick={() => { setHierPopover(null); setHierName(''); setHierCode(''); }} className="px-2 py-1.5 bg-white border border-slate-200 text-slate-500 text-xs rounded transition-colors">Cancel</button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            {/* System */}
                                            <div>
                                                <label className="block text-[10px] text-slate-500 uppercase mb-1">System</label>
                                                <div className="flex gap-1">
                                                    <select value={registerForm.system} onChange={e => setRegisterForm(f => ({ ...f, system: e.target.value }))} className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500 appearance-none cursor-pointer">
                                                        <option value="">Select…</option>
                                                        {hierarchySystems.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                                                    </select>
                                                    <button type="button" onClick={() => setHierPopover(hierPopover?.level === 'system' ? null : { level: 'system', parentId: null })} className="px-2 py-2 bg-slate-50 border border-slate-200 rounded-lg text-accent-cyan hover:bg-accent-cyan/10 hover:border-accent-cyan/30 transition-colors" title="Add new system">
                                                        <Plus size={14} />
                                                    </button>
                                                </div>
                                                {hierPopover?.level === 'system' && (
                                                    <div className="mt-2 p-3 bg-slate-50 border border-accent-cyan/30 rounded-lg space-y-2 animate-in fade-in duration-200">
                                                        <input type="text" value={hierName} onChange={e => setHierName(e.target.value)} placeholder="System name" className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-sm text-slate-800 focus:outline-none focus:border-relantern-500 placeholder-brand-600" autoFocus />
                                                        <input type="text" value={hierCode} onChange={e => setHierCode(e.target.value)} placeholder="Code (auto)" className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-sm text-slate-800 focus:outline-none focus:border-relantern-500 placeholder-brand-600 font-mono" />
                                                        <div className="flex gap-1">
                                                            <button onClick={() => handleCreateHierNode('system', null, 'system')} disabled={!hierName.trim()} className="flex-1 px-2 py-1.5 bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan text-xs font-semibold rounded disabled:opacity-40 transition-colors">Create</button>
                                                            <button onClick={() => { setHierPopover(null); setHierName(''); setHierCode(''); }} className="px-2 py-1.5 bg-white border border-slate-200 text-slate-500 text-xs rounded transition-colors">Cancel</button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* ISO 14224 Classification — Cascading: Category → Class → Type */}
                                    <div>
                                        <h3 className="text-xs font-bold text-brand-300 uppercase tracking-wider mb-3">ISO 14224 Classification</h3>
                                        <div className="grid grid-cols-3 gap-3">
                                            {/* Category (broadest) */}
                                            <div>
                                                <label className="block text-[10px] text-slate-500 uppercase mb-1">Category *</label>
                                                <select
                                                    value={registerForm.equipment_category}
                                                    onChange={e => setRegisterForm(f => ({ ...f, equipment_category: e.target.value, equipment_class: '', equipment_type: '' }))}
                                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500 appearance-none cursor-pointer"
                                                >
                                                    <option value="">Select Category…</option>
                                                    {dictCategories.map(d => <option key={d.id} value={d.code}>{d.description}</option>)}
                                                </select>
                                            </div>
                                            {/* Class (filtered by Category) */}
                                            <div>
                                                <label className="block text-[10px] text-slate-500 uppercase mb-1">Class *</label>
                                                <select
                                                    value={registerForm.equipment_class}
                                                    onChange={e => setRegisterForm(f => ({ ...f, equipment_class: e.target.value, equipment_type: '' }))}
                                                    disabled={!registerForm.equipment_category}
                                                    className={`w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500 appearance-none cursor-pointer ${!registerForm.equipment_category ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                >
                                                    <option value="">{registerForm.equipment_category ? 'Select Class…' : 'Select Category first'}</option>
                                                    {dictClasses.map(d => <option key={d.id} value={d.code}>{d.description}</option>)}
                                                </select>
                                            </div>
                                            {/* Type (filtered by Class — most specific) */}
                                            <div>
                                                <label className="block text-[10px] text-slate-500 uppercase mb-1">Type</label>
                                                <select
                                                    value={registerForm.equipment_type}
                                                    onChange={e => setRegisterForm(f => ({ ...f, equipment_type: e.target.value }))}
                                                    disabled={!registerForm.equipment_class}
                                                    className={`w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500 appearance-none cursor-pointer ${!registerForm.equipment_class ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                >
                                                    <option value="">{registerForm.equipment_class ? 'Select Type…' : 'Select Class first'}</option>
                                                    {dictTypes.map(d => <option key={d.id} value={d.code}>{d.description}</option>)}
                                                </select>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3 mt-3">
                                            <div>
                                                <label className="block text-[10px] text-slate-500 uppercase mb-1">Maintenance Strategy *</label>
                                                <select value={registerForm.maintenance_strategy} onChange={e => setRegisterForm(f => ({ ...f, maintenance_strategy: e.target.value as MaintenanceStrategy }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500 appearance-none cursor-pointer">
                                                    {Object.entries(MAINTENANCE_STRATEGY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-[10px] text-slate-500 uppercase mb-1">Criticality Rank *</label>
                                                <div className="flex gap-1.5 mt-1">
                                                    {(['A', 'B', 'C', 'D', 'E'] as CriticalityRank[]).map(c => {
                                                        const colors = CRIT_COLORS[c];
                                                        return (
                                                            <button
                                                                key={c}
                                                                onClick={() => setRegisterForm(f => ({ ...f, criticality: c }))}
                                                                title={CRITICALITY_LABELS[c]}
                                                                className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-all ${registerForm.criticality === c
                                                                    ? `${colors.bg} ${colors.text} ${colors.border} ring-2 ${colors.ring}`
                                                                    : 'bg-slate-50 text-slate-500 border-slate-200 hover:border-slate-300'
                                                                    }`}
                                                            >
                                                                {c}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Nameplate */}
                                    <div>
                                        <h3 className="text-xs font-bold text-brand-300 uppercase tracking-wider mb-3">Nameplate Data</h3>
                                        <div className="grid grid-cols-3 gap-3">
                                            <div>
                                                <label className="block text-[10px] text-slate-500 uppercase mb-1">Manufacturer</label>
                                                <input type="text" value={registerForm.manufacturer} onChange={e => setRegisterForm(f => ({ ...f, manufacturer: e.target.value }))} placeholder="e.g. Siemens" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500 placeholder-brand-600" />
                                            </div>
                                            <div>
                                                <label className="block text-[10px] text-slate-500 uppercase mb-1">Model</label>
                                                <input type="text" value={registerForm.model} onChange={e => setRegisterForm(f => ({ ...f, model: e.target.value }))} placeholder="e.g. STC-SV" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500 placeholder-brand-600" />
                                            </div>
                                            <div>
                                                <label className="block text-[10px] text-slate-500 uppercase mb-1">Serial No.</label>
                                                <input type="text" value={registerForm.serial_number} onChange={e => setRegisterForm(f => ({ ...f, serial_number: e.target.value }))} placeholder="e.g. SIE-K701-2026" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500 placeholder-brand-600 font-mono" />
                                            </div>
                                        </div>
                                        <div className="mt-3">
                                            <label className="block text-[10px] text-slate-500 uppercase mb-1">Installation Date</label>
                                            <input type="date" value={registerForm.install_date} onChange={e => setRegisterForm(f => ({ ...f, install_date: e.target.value }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500" />
                                        </div>
                                    </div>

                                    {/* Advanced ISO 14224 Data (Collapsible) */}
                                    <div>
                                        <button
                                            onClick={() => setShowAdvanced(!showAdvanced)}
                                            className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider hover:text-brand-200 transition-colors"
                                        >
                                            {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                            Advanced — Design & Operating Data
                                        </button>
                                        {showAdvanced && (
                                            <div className="mt-3 space-y-4 animate-in slide-in-from-top-2 duration-200">
                                                <div>
                                                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Design / Nameplate Data (ISO 14224 §7.3)</h4>
                                                    <div className="grid grid-cols-3 gap-3">
                                                        <div>
                                                            <label className="block text-[10px] text-slate-500 uppercase mb-1">Rated Power (kW)</label>
                                                            <input type="number" value={registerForm.rated_power_kw} onChange={e => setRegisterForm(f => ({ ...f, rated_power_kw: e.target.value }))} placeholder="e.g. 8500" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500 placeholder-brand-600 font-mono" />
                                                        </div>
                                                        <div>
                                                            <label className="block text-[10px] text-slate-500 uppercase mb-1">Design Pressure (bar)</label>
                                                            <input type="number" value={registerForm.design_pressure_bar} onChange={e => setRegisterForm(f => ({ ...f, design_pressure_bar: e.target.value }))} placeholder="e.g. 85" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500 placeholder-brand-600 font-mono" />
                                                        </div>
                                                        <div>
                                                            <label className="block text-[10px] text-slate-500 uppercase mb-1">Design Temp (°C)</label>
                                                            <input type="number" value={registerForm.design_temperature_c} onChange={e => setRegisterForm(f => ({ ...f, design_temperature_c: e.target.value }))} placeholder="e.g. 150" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500 placeholder-brand-600 font-mono" />
                                                        </div>
                                                        <div>
                                                            <label className="block text-[10px] text-slate-500 uppercase mb-1">Material Class</label>
                                                            <input type="text" value={registerForm.material_class} onChange={e => setRegisterForm(f => ({ ...f, material_class: e.target.value }))} placeholder="e.g. SS316" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500 placeholder-brand-600 font-mono" />
                                                        </div>
                                                        <div>
                                                            <label className="block text-[10px] text-slate-500 uppercase mb-1">Weight (kg)</label>
                                                            <input type="number" value={registerForm.weight_kg} onChange={e => setRegisterForm(f => ({ ...f, weight_kg: e.target.value }))} placeholder="e.g. 12500" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500 placeholder-brand-600 font-mono" />
                                                        </div>
                                                    </div>
                                                </div>
                                                <div>
                                                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Operating Context (ISO 14224 §7.4)</h4>
                                                    <div className="grid grid-cols-3 gap-3">
                                                        <div>
                                                            <label className="block text-[10px] text-slate-500 uppercase mb-1">Service Medium</label>
                                                            <input type="text" value={registerForm.service_medium} onChange={e => setRegisterForm(f => ({ ...f, service_medium: e.target.value }))} placeholder="e.g. Natural Gas" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500 placeholder-brand-600" />
                                                        </div>
                                                        <div>
                                                            <label className="block text-[10px] text-slate-500 uppercase mb-1">Operating Mode</label>
                                                            <select value={registerForm.operating_mode} onChange={e => setRegisterForm(f => ({ ...f, operating_mode: e.target.value }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500 appearance-none cursor-pointer">
                                                                <option value="">Select…</option>
                                                                <option value="continuous">Continuous</option>
                                                                <option value="intermittent">Intermittent</option>
                                                                <option value="standby">Standby</option>
                                                                <option value="seasonal">Seasonal</option>
                                                            </select>
                                                        </div>
                                                        <div>
                                                            <label className="block text-[10px] text-slate-500 uppercase mb-1">Environment</label>
                                                            <select value={registerForm.environment} onChange={e => setRegisterForm(f => ({ ...f, environment: e.target.value }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500 appearance-none cursor-pointer">
                                                                <option value="">Select…</option>
                                                                <option value="onshore">Onshore</option>
                                                                <option value="offshore">Offshore</option>
                                                                <option value="subsea">Subsea</option>
                                                                <option value="desert">Desert</option>
                                                                <option value="arctic">Arctic</option>
                                                            </select>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Crit A warning */}
                                    {registerForm.criticality === 'A' && (
                                        <div className="flex items-start gap-3 bg-red-500/5 border border-red-500/20 rounded-lg p-4 animate-in fade-in duration-200">
                                            <AlertTriangle size={16} className="text-red-400 mt-0.5 shrink-0" />
                                            <div>
                                                <p className="text-sm font-semibold text-red-400">Safety Critical Asset</p>
                                                <p className="text-xs text-slate-500 mt-1 leading-relaxed">Criticality A assets require mandatory failure coding, engineering review on work order closure, and mandatory RCA for unplanned shutdowns per ISO 55000.</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {!registerCreated && (
                                <div className="p-6 pt-0 flex justify-end gap-3">
                                    <button onClick={() => setShowRegister(false)} className="px-4 py-2 bg-slate-50 border border-slate-200 text-brand-300 hover:bg-slate-100 rounded-lg text-sm font-medium transition-colors">Cancel</button>
                                    <button
                                        onClick={handleRegister}
                                        disabled={!registerForm.tag || !registerForm.name || !registerForm.site || !registerForm.unit}
                                        className="px-6 py-2 bg-accent-cyan hover:bg-primary-400 disabled:opacity-40 disabled:cursor-not-allowed text-brand-900 font-bold rounded-lg text-sm transition-colors shadow-[0_0_15px_rgba(6,182,212,0.2)] flex items-center gap-2"
                                    >
                                        <Plus size={16} /> Register Asset
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )
            }
        </div>
    );
};
