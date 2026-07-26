import React, { useState, useMemo } from 'react';
import { Activity, AlertTriangle, TrendingDown, TrendingUp, Minus, Search, ChevronDown, ChevronLeft, ChevronRight, LayoutGrid, List, ArrowUpDown, SlidersHorizontal } from 'lucide-react';
import type { FleetAssetHealth } from '../../types/intelligence';

// ─────────────────────────────────────────────────────────
//  Mock Fleet Data
// ─────────────────────────────────────────────────────────

const MOCK_FLEET: FleetAssetHealth[] = [
    { asset_id: 'ast-k601', asset_name: 'Gas Compressor K-601', unit: 'Compression Train A', criticality: 'A', health_index: 82.5, rul_days: 245, trend: 'degrading', active_alerts: 2 },
    { asset_id: 'ast-p102', asset_name: 'Booster Pump P-102', unit: 'Water Injection', criticality: 'B', health_index: 64.2, rul_days: 89, trend: 'degrading', active_alerts: 3 },
    { asset_id: 'ast-gt301', asset_name: 'Gas Turbine GT-301', unit: 'Power Generation', criticality: 'A', health_index: 91.0, rul_days: 720, trend: 'stable', active_alerts: 0 },
    { asset_id: 'ast-p101', asset_name: 'Centrifugal Pump P-101A', unit: 'Crude Export', criticality: 'A', health_index: 74.8, rul_days: 156, trend: 'degrading', active_alerts: 1 },
    { asset_id: 'ast-v401', asset_name: 'Separator V-401', unit: 'Gas Processing', criticality: 'B', health_index: 88.3, rul_days: 410, trend: 'stable', active_alerts: 0 },
    { asset_id: 'ast-hx201', asset_name: 'Heat Exchanger HX-201', unit: 'Crude Stabilization', criticality: 'B', health_index: 71.5, rul_days: 132, trend: 'degrading', active_alerts: 1 },
    { asset_id: 'ast-cv902', asset_name: 'Conveyor Belt C-902', unit: 'Utility Systems', criticality: 'C', health_index: 95.2, rul_days: 900, trend: 'improving', active_alerts: 0 },
    { asset_id: 'ast-tk005', asset_name: 'Slop Oil Tank TK-005', unit: 'Storage', criticality: 'C', health_index: 56.0, rul_days: 45, trend: 'degrading', active_alerts: 2 },
];

// ─────────────────────────────────────────────────────────
//  Types & Config
// ─────────────────────────────────────────────────────────

type SortOption = 'health_asc' | 'health_desc' | 'rul_asc' | 'rul_desc' | 'name_asc' | 'crit_asc';
type CritFilter = 'all' | 'A' | 'B' | 'C';
type ViewMode = 'grid' | 'list';

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
    { value: 'health_asc', label: 'Health ↑ (Worst first)' },
    { value: 'health_desc', label: 'Health ↓ (Best first)' },
    { value: 'rul_asc', label: 'RUL ↑ (Shortest first)' },
    { value: 'rul_desc', label: 'RUL ↓ (Longest first)' },
    { value: 'name_asc', label: 'Name A→Z' },
    { value: 'crit_asc', label: 'Criticality (A→C)' },
];

const ITEMS_PER_PAGE = 8;

// ─────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────

function getHealthColor(hi: number): string {
    if (hi >= 85) return 'from-accent-safe/20 to-accent-safe/5 border-accent-safe/30';
    if (hi >= 70) return 'from-yellow-500/20 to-yellow-500/5 border-yellow-500/30';
    if (hi >= 55) return 'from-orange-500/20 to-orange-500/5 border-orange-500/30';
    return 'from-red-500/20 to-red-500/5 border-red-500/30';
}

function getHealthTextColor(hi: number): string {
    if (hi >= 85) return 'text-accent-safe';
    if (hi >= 70) return 'text-yellow-500';
    if (hi >= 55) return 'text-orange-400';
    return 'text-red-400';
}

function getHealthDot(hi: number): string {
    if (hi >= 85) return 'bg-emerald-500';
    if (hi >= 70) return 'bg-yellow-500';
    if (hi >= 55) return 'bg-orange-500';
    return 'bg-red-500';
}

const TrendIcon: React.FC<{ trend: FleetAssetHealth['trend'] }> = ({ trend }) => {
    if (trend === 'improving') return <TrendingUp size={10} className="text-accent-safe" />;
    if (trend === 'degrading') return <TrendingDown size={10} className="text-red-400" />;
    return <Minus size={10} className="text-slate-500" />;
};

// ─────────────────────────────────────────────────────────
//  Component
// ─────────────────────────────────────────────────────────

interface Props {
    selectedAssetId: string;
    onAssetSelect: (assetId: string) => void;
    fleetData?: FleetAssetHealth[];
    filterSlot?: React.ReactNode;
    totalAssetCount?: number;
    /** When true, skip outer wrapper and header (used when embedded inside a collapsible parent) */
    embedded?: boolean;
}

export const FleetHealthMap: React.FC<Props> = ({ selectedAssetId, onAssetSelect, fleetData, filterSlot, totalAssetCount, embedded }) => {
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState<SortOption>('health_asc');
    const [critFilter, setCritFilter] = useState<CritFilter>('all');
    const [viewMode, setViewMode] = useState<ViewMode>('grid');
    const [page, setPage] = useState(0);
    const [sortOpen, setSortOpen] = useState(false);

    const hasRealData = totalAssetCount != null && totalAssetCount > 0;
    const effectiveData = hasRealData ? (fleetData || []) : MOCK_FLEET;

    // Filter → Sort pipeline
    const processed = useMemo(() => {
        const q = search.toLowerCase().trim();
        const filtered = effectiveData.filter(a => {
            if (critFilter !== 'all' && a.criticality !== critFilter) return false;
            if (q && !a.asset_name.toLowerCase().includes(q) && !a.unit.toLowerCase().includes(q) && !a.asset_id.toLowerCase().includes(q)) return false;
            return true;
        });

        filtered.sort((a, b) => {
            switch (sort) {
                case 'health_asc': return a.health_index - b.health_index;
                case 'health_desc': return b.health_index - a.health_index;
                case 'rul_asc': return a.rul_days - b.rul_days;
                case 'rul_desc': return b.rul_days - a.rul_days;
                case 'name_asc': return a.asset_name.localeCompare(b.asset_name);
                case 'crit_asc': return a.criticality.localeCompare(b.criticality);
                default: return 0;
            }
        });

        return filtered;
    }, [effectiveData, search, sort, critFilter]);

    // Reset page when filters change
    const totalPages = Math.max(1, Math.ceil(processed.length / ITEMS_PER_PAGE));
    const safePage = Math.min(page, totalPages - 1);
    if (safePage !== page) setPage(safePage);
    const paged = processed.slice(safePage * ITEMS_PER_PAGE, (safePage + 1) * ITEMS_PER_PAGE);

    const criticalCount = effectiveData.filter(a => a.health_index < 70).length;
    const avgHealth = effectiveData.length > 0 ? effectiveData.reduce((s, a) => s + a.health_index, 0) / effectiveData.length : 0;
    const totalCount = totalAssetCount ?? effectiveData.length;

    const critChips: { value: CritFilter; label: string; color: string; activeColor: string }[] = [
        { value: 'all', label: 'All', color: 'text-slate-500 border-slate-200 bg-white hover:bg-slate-50', activeColor: 'text-primary-700 bg-primary-50 border-primary-300' },
        { value: 'A', label: 'Crit A', color: 'text-slate-500 border-slate-200 bg-white hover:bg-red-50', activeColor: 'text-red-700 bg-red-50 border-red-300' },
        { value: 'B', label: 'Crit B', color: 'text-slate-500 border-slate-200 bg-white hover:bg-yellow-50', activeColor: 'text-yellow-700 bg-yellow-50 border-yellow-300' },
        { value: 'C', label: 'Crit C', color: 'text-slate-500 border-slate-200 bg-white hover:bg-slate-50', activeColor: 'text-slate-700 bg-slate-100 border-slate-400' },
    ];

    return (
        <div className={embedded ? 'overflow-hidden' : 'bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden animate-in fade-in duration-300'}>
            {/* ═══ Header (hidden when embedded) ═══ */}
            {!embedded && (<div className="px-5 pt-5 pb-4">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-accent-cyan/10 rounded-lg text-accent-cyan">
                            <Activity size={20} />
                        </div>
                        <div>
                            <h3 className="text-base font-semibold text-slate-800">Fleet Health Overview</h3>
                            <p className="text-xs text-slate-400">
                                {processed.length === totalCount
                                    ? `${totalCount} assets monitored`
                                    : `${processed.length} of ${totalCount} assets`
                                }
                                {' · Click to drill down'}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                        <div>
                            <span className="text-slate-400">Avg Health: </span>
                            <span className={`font-bold ${getHealthTextColor(avgHealth)}`}>{avgHealth.toFixed(1)}</span>
                        </div>
                        {criticalCount > 0 && (
                            <div className="flex items-center gap-1 px-2 py-1 bg-red-500/10 border border-red-500/30 rounded-full">
                                <AlertTriangle size={12} className="text-red-400" />
                                <span className="text-red-400 font-bold">{criticalCount} at risk</span>
                            </div>
                        )}
                        {filterSlot}
                    </div>
                </div>

                {/* ═══ Toolbar: Search + Sort + Criticality + View Toggle ═══ */}
                <div className="flex flex-col sm:flex-row gap-3">
                    {/* Search */}
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                        <input
                            type="text"
                            placeholder="Search by name, tag, or system..."
                            value={search}
                            onChange={e => { setSearch(e.target.value); setPage(0); }}
                            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-300/40 focus:border-primary-400 placeholder:text-slate-400 transition-all"
                        />
                        {search && (
                            <button onClick={() => { setSearch(''); setPage(0); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500 transition-colors">
                                ×
                            </button>
                        )}
                    </div>

                    {/* Sort Dropdown */}
                    <div className="relative">
                        <button
                            onClick={() => setSortOpen(!sortOpen)}
                            className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors whitespace-nowrap"
                        >
                            <ArrowUpDown size={13} />
                            {SORT_OPTIONS.find(o => o.value === sort)?.label || 'Sort'}
                            <ChevronDown size={12} className={`transition-transform ${sortOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {sortOpen && (
                            <>
                                <div className="fixed inset-0 z-30" onClick={() => setSortOpen(false)} />
                                <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-40 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                                    {SORT_OPTIONS.map(opt => (
                                        <button
                                            key={opt.value}
                                            onClick={() => { setSort(opt.value); setSortOpen(false); setPage(0); }}
                                            className={`w-full px-4 py-2.5 text-left text-xs font-medium transition-colors ${sort === opt.value ? 'bg-primary-50 text-primary-700' : 'text-slate-600 hover:bg-slate-50'}`}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>

                    {/* View Toggle */}
                    <div className="flex border border-slate-200 rounded-lg overflow-hidden">
                        <button
                            onClick={() => setViewMode('grid')}
                            className={`p-2 transition-colors ${viewMode === 'grid' ? 'bg-primary-50 text-primary-600' : 'bg-white text-slate-400 hover:text-slate-600'}`}
                            title="Grid view"
                        >
                            <LayoutGrid size={14} />
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            className={`p-2 transition-colors ${viewMode === 'list' ? 'bg-primary-50 text-primary-600' : 'bg-white text-slate-400 hover:text-slate-600'}`}
                            title="List view"
                        >
                            <List size={14} />
                        </button>
                    </div>
                </div>

                {/* Criticality Chips */}
                <div className="flex items-center gap-2 mt-3">
                    <SlidersHorizontal size={12} className="text-slate-400" />
                    {critChips.map(chip => (
                        <button
                            key={chip.value}
                            onClick={() => { setCritFilter(chip.value); setPage(0); }}
                            className={`px-2.5 py-1 text-[10px] font-bold rounded-full border transition-all ${critFilter === chip.value ? chip.activeColor : chip.color}`}
                        >
                            {chip.label}
                        </button>
                    ))}
                    {(search || critFilter !== 'all') && (
                        <button
                            onClick={() => { setSearch(''); setCritFilter('all'); setPage(0); }}
                            className="ml-auto text-[10px] text-primary-600 hover:text-primary-700 font-medium"
                        >
                            Clear filters
                        </button>
                    )}
                </div>
            </div>
            )}

            {/* ═══ Sample-data ribbon — the mock fleet must never pass as real ═══ */}
            {!hasRealData && (
                <div className="mx-5 my-3 flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                    <AlertTriangle size={13} className="text-amber-500 shrink-0" />
                    <p className="text-[11px] text-amber-700 font-medium">
                        Sample data — these are illustrative assets, not your equipment. Connect assets to see your real fleet.
                    </p>
                </div>
            )}

            {/* ═══ Content: Grid or List ═══ */}
            {processed.length === 0 ? (
                <div className="text-center py-16 px-5">
                    <Search size={28} className="mx-auto mb-2 text-slate-300" />
                    <p className="text-sm font-medium text-slate-500">No matching assets</p>
                    <p className="text-xs text-slate-400 mt-1">Adjust your search or filters to find assets</p>
                </div>
            ) : viewMode === 'grid' ? (
                /* ── Grid View ── */
                <div className="px-5 pb-2">
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                        {paged.map(asset => {
                            const isSelected = asset.asset_id === selectedAssetId;
                            const isCritical = asset.health_index < 60;
                            return (
                                <button
                                    key={asset.asset_id}
                                    onClick={() => onAssetSelect(asset.asset_id)}
                                    className={`relative bg-gradient-to-br ${getHealthColor(asset.health_index)} border rounded-lg p-3 text-left transition-all hover:scale-[1.02] hover:shadow-lg group ${isSelected ? 'ring-2 ring-accent-cyan shadow-[0_0_15px_rgba(6,182,212,0.2)]' : ''} ${isCritical ? 'animate-pulse' : ''}`}
                                >
                                    <span className={`absolute top-2 right-2 text-[9px] font-bold px-1 py-0.5 rounded border ${asset.criticality === 'A' ? 'bg-red-500/15 text-red-400 border-red-500/30' : asset.criticality === 'B' ? 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30' : 'bg-slate-100 text-slate-500 border-slate-300'}`}>
                                        {asset.criticality}
                                    </span>
                                    <p className="text-xs font-semibold text-slate-800 truncate pr-6 group-hover:text-accent-cyan transition-colors">
                                        {asset.asset_name}
                                    </p>
                                    <p className="text-[10px] text-slate-400 truncate mb-2">{asset.unit}</p>
                                    <div className="flex items-baseline gap-1">
                                        <span className={`text-xl font-bold ${getHealthTextColor(asset.health_index)}`}>
                                            {asset.health_index.toFixed(0)}
                                        </span>
                                        <span className="text-[10px] text-slate-400">/ 100</span>
                                        <TrendIcon trend={asset.trend} />
                                    </div>
                                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-200">
                                        <span className={`text-[10px] font-medium ${asset.rul_days < 90 ? 'text-red-400' : 'text-slate-500'}`}>
                                            RUL: {asset.rul_days}d
                                        </span>
                                        {asset.active_alerts > 0 && (
                                            <span className="flex items-center gap-0.5 text-[10px] text-red-400 font-bold">
                                                <AlertTriangle size={10} />
                                                {asset.active_alerts}
                                            </span>
                                        )}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            ) : (
                /* ── List View ── */
                <div className="px-5 pb-2">
                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                        {/* List Header */}
                        <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-slate-50 border-b border-slate-200 text-[10px] text-slate-500 uppercase font-bold tracking-wider">
                            <div className="col-span-5">Asset</div>
                            <div className="col-span-2 text-center">Health</div>
                            <div className="col-span-2 text-center">RUL</div>
                            <div className="col-span-1 text-center">Crit</div>
                            <div className="col-span-1 text-center">Trend</div>
                            <div className="col-span-1 text-center">Alerts</div>
                        </div>
                        {paged.map(asset => {
                            const isSelected = asset.asset_id === selectedAssetId;
                            return (
                                <button
                                    key={asset.asset_id}
                                    onClick={() => onAssetSelect(asset.asset_id)}
                                    className={`w-full grid grid-cols-12 gap-2 px-4 py-3 text-left border-b border-slate-100 last:border-b-0 transition-all hover:bg-slate-50 ${isSelected ? 'bg-primary-50/50 border-l-[3px] border-l-accent-cyan' : 'border-l-[3px] border-l-transparent'}`}
                                >
                                    {/* Asset Info */}
                                    <div className="col-span-5 flex items-center gap-2.5 min-w-0">
                                        <div className={`w-2 h-2 rounded-full shrink-0 ${getHealthDot(asset.health_index)}`} />
                                        <div className="min-w-0">
                                            <p className={`text-xs font-semibold truncate ${isSelected ? 'text-primary-700' : 'text-slate-800'}`}>{asset.asset_name}</p>
                                            <p className="text-[10px] text-slate-400 truncate">{asset.unit}</p>
                                        </div>
                                    </div>
                                    {/* Health */}
                                    <div className="col-span-2 flex items-center justify-center">
                                        <span className={`text-sm font-bold font-mono ${getHealthTextColor(asset.health_index)}`}>
                                            {asset.health_index.toFixed(0)}
                                        </span>
                                        <span className="text-[9px] text-slate-300 ml-0.5">/100</span>
                                    </div>
                                    {/* RUL */}
                                    <div className="col-span-2 flex items-center justify-center">
                                        <span className={`text-xs font-mono font-medium ${asset.rul_days < 90 ? 'text-red-500' : 'text-slate-600'}`}>
                                            {asset.rul_days}d
                                        </span>
                                    </div>
                                    {/* Criticality */}
                                    <div className="col-span-1 flex items-center justify-center">
                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${asset.criticality === 'A' ? 'bg-red-500/15 text-red-400 border-red-500/30' : asset.criticality === 'B' ? 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30' : 'bg-slate-100 text-slate-500 border-slate-300'}`}>
                                            {asset.criticality}
                                        </span>
                                    </div>
                                    {/* Trend */}
                                    <div className="col-span-1 flex items-center justify-center">
                                        <TrendIcon trend={asset.trend} />
                                    </div>
                                    {/* Alerts */}
                                    <div className="col-span-1 flex items-center justify-center">
                                        {asset.active_alerts > 0 ? (
                                            <span className="flex items-center gap-0.5 text-[10px] text-red-400 font-bold">
                                                <AlertTriangle size={10} />
                                                {asset.active_alerts}
                                            </span>
                                        ) : (
                                            <span className="text-[10px] text-slate-300">—</span>
                                        )}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ═══ Pagination Footer ═══ */}
            <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <div className="flex items-center gap-3 text-[10px] text-slate-400">
                    {/* Legend */}
                    <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded bg-accent-safe/30" /> ≥85</div>
                    <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded bg-yellow-500/30" /> 70–84</div>
                    <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded bg-orange-500/30" /> 55–69</div>
                    <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded bg-red-500/30" /> &lt;55</div>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-500 font-medium">
                        {safePage * ITEMS_PER_PAGE + 1}–{Math.min((safePage + 1) * ITEMS_PER_PAGE, processed.length)} of {processed.length}
                    </span>
                    <button
                        onClick={() => setPage(p => Math.max(0, p - 1))}
                        disabled={safePage === 0}
                        className="p-1 rounded border border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                        <ChevronLeft size={14} />
                    </button>
                    {/* Page indicators */}
                    {totalPages <= 5 ? (
                        <div className="flex items-center gap-1">
                            {Array.from({ length: totalPages }).map((_, i) => (
                                <button
                                    key={i}
                                    onClick={() => setPage(i)}
                                    className={`w-6 h-6 rounded text-[10px] font-bold transition-all ${i === safePage ? 'bg-primary-500 text-white shadow-sm' : 'text-slate-400 hover:bg-slate-100'}`}
                                >
                                    {i + 1}
                                </button>
                            ))}
                        </div>
                    ) : (
                        <span className="text-[10px] text-slate-400 font-mono px-1">
                            {safePage + 1}/{totalPages}
                        </span>
                    )}
                    <button
                        onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                        disabled={safePage >= totalPages - 1}
                        className="p-1 rounded border border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                        <ChevronRight size={14} />
                    </button>
                </div>
            </div>
        </div>
    );
};
