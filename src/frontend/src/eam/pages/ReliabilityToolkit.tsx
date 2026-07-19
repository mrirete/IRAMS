import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
    BarChart, Bar, AreaChart, Area, ScatterChart, Scatter, Cell, ReferenceLine
} from 'recharts';
import {
    Calculator, Activity, Gauge, Package, Wrench, TrendingUp, Download, RefreshCw,
    AlertTriangle, ChevronRight, Info, Loader2, Search, HelpCircle, BarChart2,
    Shield, Zap, Target, BookOpen, ChevronDown, ChevronUp, ArrowRight, Lightbulb,
    FileText, Clock, DollarSign, Settings, Users, Filter, MapPin, SlidersHorizontal,
    Dices, Play, RotateCcw, Upload, Cpu
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
    computeAssetReliability, failureRepairHours, failureIntervalsHours,
    isFailure, assetFailureBasis, FAILURE_QUERY_COLUMNS,
} from '../services/reliabilityMetrics';
// @ts-ignore
import * as jStat from 'jstat';
import { MonteCarloSimTab } from '../components/MonteCarloSimTab';
import { ScrollTabStrip } from '../components/ui';
import LifecycleAnalysis from '../../components/reliability/LifecycleAnalysis';
import { CreatePMFromWeibullModal, type WeibullPMData } from '../../components/analyze/CreatePMFromWeibullModal';
import { fitWeibull, weibullBLife } from '../utils/weibull';

// M1 (one reliability engine): failure classification is the shared engine's
// isFailure — never a local WO-type list. Queries fetch ALL types in-window
// (FAILURE_QUERY_COLUMNS) and let the engine decide what counts.

// Asset-register hierarchy levels (SITE > UNIT > SYSTEM > EQUIPMENT > COMPONENT).
// Locations are the upper nodes; equipment/components are the maintainable units.
type TreeAsset = { id: string; tag: string; name: string; hierarchy_level: string; parent_id: string | null; asset_class: string | null };
const LOC_LEVELS = ['SITE', 'UNIT', 'SYSTEM'];
const EQUIP_LEVELS = ['EQUIPMENT', 'COMPONENT'];

/**
 * Shared form-control style for the Toolkit calculators — matches the
 * design-system Field control (primary focus ring, 40px touch target on
 * mobile) so every calculator input looks consistent with the rest of the app.
 */
const CONTROL_CLS =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 min-h-[40px] md:min-h-0 text-sm text-slate-900 ' +
    'placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-primary-500';

/* ╔══════════════════════════════════════════════════════════════╗
   ║  RELIABILITY ENGINEERING TOOLKIT                             ║
   ║  5 calculators: MTBF/MTTR, Ao, Weibull, Spares, Maintain.   ║
   ╚══════════════════════════════════════════════════════════════╝ */

// ─── Types ───────────────────────────────────────────────────
interface AssetOption { id: string; name: string; tag: string; criticality: string; }

export interface TabProps {
    onStateChange?: (inputs: Record<string, any>, results: Record<string, any>, asset?: { id: string; tag: string; name: string } | null) => void;
    loadedData?: { inputs: Record<string, any>; results: Record<string, any> } | null;
    /** Fired after a PM program is created from this analysis — lets the parent stamp linked_pm_id on the saved study. */
    onPMCreated?: (pmId: string, pmTitle: string) => void;
    /** P2.2: Bridge from RAM → Spares Demand — push MTBF to spares calculator */
    onSendToSpares?: (mtbf: number) => void;
    /** Seed the tab's asset once (e.g. from a Metrics bad-actor drill-through). */
    initialAsset?: AssetOption | null;
}

type TabId = 'mtbf' | 'availability' | 'weibull' | 'spares' | 'maintainability' | 'montecarlo';

const TABS: { id: TabId; label: string; icon: React.ReactNode; desc: string }[] = [
    { id: 'mtbf', label: 'MTBF / MTTR', icon: <Activity size={16} />, desc: 'Mean Time Between Failures & Mean Time To Repair with confidence intervals' },
    { id: 'availability', label: 'Availability (Ao)', icon: <Gauge size={16} />, desc: 'Operational Availability = MTBF / (MTBF + MRT)' },
    { id: 'weibull', label: 'Weibull Analysis', icon: <TrendingUp size={16} />, desc: 'Life data analysis — predict failures, determine PM intervals' },
    { id: 'spares', label: 'Spares Demand', icon: <Package size={16} />, desc: 'Poisson-based spare parts demand prediction' },
    { id: 'maintainability', label: 'Maintainability', icon: <Wrench size={16} />, desc: 'Lognormal repair time distribution — M(t) analysis' },
    { id: 'montecarlo', label: 'Monte Carlo', icon: <Dices size={16} />, desc: 'Probabilistic lifecycle simulation — Weibull failures, PM optimization, P10/P50/P90 forecasting' },
];

// ─── Utility functions ───────────────────────────────────────
const chi2Lower = (alpha: number, df: number) => jStat.chisquare.inv(alpha / 2, df);
const chi2Upper = (alpha: number, df: number) => jStat.chisquare.inv(1 - alpha / 2, df);

function computeMTBFWithConfidence(totalHours: number, failures: number, confidencePct: number) {
    const alpha = 1 - confidencePct / 100;
    const mtbf = failures > 0 ? totalHours / failures : Infinity;
    // Time-terminated test: 2T / chi2(alpha/2, 2r+2) for lower, 2T / chi2(1-alpha/2, 2r) for upper
    const lower = failures > 0 ? (2 * totalHours) / chi2Upper(alpha, 2 * failures + 2) : 0;
    const upper = failures > 0 ? (2 * totalHours) / chi2Lower(alpha, 2 * failures) : Infinity;
    return { mtbf, lower, upper, failures, totalHours };
}

function computeMTTR(repairTimes: number[]) {
    if (repairTimes.length === 0) return { mean: 0, median: 0, stdDev: 0, mmax90: 0, mmax95: 0, count: 0 };
    const sorted = [...repairTimes].sort((a, b) => a - b);
    const mean = repairTimes.reduce((s, v) => s + v, 0) / repairTimes.length;
    const median = sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];
    const variance = repairTimes.reduce((s, v) => s + (v - mean) ** 2, 0) / repairTimes.length;
    const stdDev = Math.sqrt(variance);
    // Exponential approximation: M(t) = 1 - e^(-t/MTTR)  →  t = -MTTR * ln(1-p)
    const mmax90 = -mean * Math.log(1 - 0.90);
    const mmax95 = -mean * Math.log(1 - 0.95);
    return { mean, median, stdDev, mmax90, mmax95, count: repairTimes.length };
}

function poissonSpares(population: number, failureRate: number, interval: number, confidence: number) {
    const lambda = population * failureRate * interval;
    let cumulative = 0;
    let k = 0;
    const rows: { k: number; prob: number; cumProb: number }[] = [];
    while (cumulative < confidence / 100 && k < 200) {
        const prob = (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
        cumulative += prob;
        rows.push({ k, prob: Math.round(prob * 10000) / 10000, cumProb: Math.round(cumulative * 10000) / 10000 });
        k++;
    }
    return { lambda, requiredSpares: k - 1, rows };
}

function factorial(n: number): number {
    if (n <= 1) return 1;
    // Use Stirling for large n, exact for small
    if (n > 170) return Infinity;
    let result = 1;
    for (let i = 2; i <= n; i++) result *= i;
    return result;
}

// R-1: Weibull fitting lives in the SHARED censored-capable fitter
// (eam/utils/weibull.ts — Johnson adjusted ranks + confidence bounds).
// No local Weibull math in this file.

// ─── Asset Selector Component ────────────────────────────────
function AssetSelector({ selected, onSelect }: { selected: AssetOption | null; onSelect: (a: AssetOption | null) => void }) {
    const [query, setQuery] = useState('');
    const [assets, setAssets] = useState<AssetOption[]>([]);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        supabase.from('assets').select('id, name, tag, criticality')
            .order('name').limit(200)
            .then(({ data }) => setAssets(data || []));
    }, []);

    const filtered = query
        ? assets.filter(a => a.name.toLowerCase().includes(query.toLowerCase()) || a.tag?.toLowerCase().includes(query.toLowerCase()))
        : assets;

    return (
        <div className="relative">
            <div className="flex items-center gap-2 border border-slate-300 rounded-lg px-3 py-2 bg-white cursor-pointer"
                onClick={() => setOpen(!open)}>
                <Search size={14} className="text-slate-400" />
                <input
                    type="text"
                    value={open ? query : selected ? `${selected.name} (${selected.tag || 'No Tag'})` : ''}
                    onChange={e => { setQuery(e.target.value); setOpen(true); }}
                    onFocus={() => setOpen(true)}
                    placeholder="Select an asset to auto-populate..."
                    className="w-full text-sm outline-none bg-transparent"
                />
                {selected && (
                    <button onClick={(e) => { e.stopPropagation(); onSelect(null); setQuery(''); }} className="text-slate-400 hover:text-red-500">✕</button>
                )}
            </div>
            {open && (
                <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                    {filtered.slice(0, 20).map(a => (
                        <button key={a.id} onClick={() => { onSelect(a); setOpen(false); setQuery(''); }}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50 flex justify-between">
                            <span>{a.name}</span>
                            <span className="text-xs text-slate-400 font-mono">{a.tag}</span>
                        </button>
                    ))}
                    {filtered.length === 0 && <p className="px-3 py-2 text-sm text-slate-400">No assets found</p>}
                </div>
            )}
        </div>
    );
}

// ─── Result Card ─────────────────────────────────────────────
const ResultCard = ({ label, value, unit, color = 'blue', sub }: {
    label: string; value: string | number; unit?: string; color?: string; sub?: string;
}) => (
    <div className={`bg-${color}-50 border border-${color}-100 rounded-xl p-4`}>
        <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">{label}</p>
        <p className={`text-lg font-bold text-${color}-700 mt-1`}>{value} {unit && <span className="text-xs font-normal">{unit}</span>}</p>
        {sub && <p className={`text-xs text-${color}-500 mt-1`}>{sub}</p>}
    </div>
);

// ─── Critical Assets Quick-Launch Panel (Fields-Only Design) ─────────
interface CriticalAsset {
    id: string;
    name: string;
    tag: string;
    criticality: string;
    hierarchyLevel: string;
    parentName: string;
    failureCount: number;
    lastFailure: string | null;
}

function CriticalAssetsPanel({ onSelectAsset }: { onSelectAsset: (asset: AssetOption) => void }) {
    const [assets, setAssets] = useState<CriticalAsset[]>([]);
    const [loading, setLoading] = useState(true);
    const [expanded, setExpanded] = useState(true);

    // Filters
    const [searchQuery, setSearchQuery] = useState('');
    const [critFilter, setCritFilter] = useState<string>('ALL');
    const [hierFilter, setHierFilter] = useState<string>('ALL');
    const [locFilter, setLocFilter] = useState<string>('ALL');
    const [sortBy, setSortBy] = useState<'failures' | 'name' | 'recent' | 'location'>('failures');

    useEffect(() => {
        (async () => {
            try {
                // Fetch critical assets with parent name for location context
                const { data: critAssets } = await supabase.from('assets')
                    .select('id, name, tag, criticality, hierarchy_level, parent:parent_id(name, tag)')
                    .in('criticality', ['A', 'B'])
                    .order('criticality')
                    .limit(100);

                if (!critAssets || critAssets.length === 0) { setLoading(false); return; }

                const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString();
                const results: CriticalAsset[] = [];

                // ONE batched query for all candidate assets (was an N+1 loop of
                // up to 100 count queries), counted with the shared engine's
                // isFailure so the picker badge equals the calculators' failure
                // count for the same asset.
                const { data: allWos } = await supabase.from('work_orders')
                    .select(`asset_id, ${FAILURE_QUERY_COLUMNS}`)
                    .in('asset_id', critAssets.map(a => a.id))
                    .gte('created_at', yearAgo)
                    .order('created_at', { ascending: false });

                const byAsset: Record<string, any[]> = {};
                (allWos || []).forEach(w => { (byAsset[w.asset_id] ||= []).push(w); });

                for (const asset of critAssets) {
                    const failures = (byAsset[asset.id] || []).filter(isFailure);
                    if (failures.length > 0) {
                        const parent = asset.parent as any;
                        results.push({
                            id: asset.id,
                            name: asset.name || '(Unnamed)',
                            tag: asset.tag || 'N/A',
                            criticality: asset.criticality || 'B',
                            hierarchyLevel: asset.hierarchy_level || 'EQUIPMENT',
                            parentName: parent?.name || parent?.tag || '—',
                            failureCount: failures.length,
                            lastFailure: failures[0]?.created_at || null,
                        });
                    }
                }

                results.sort((a, b) => b.failureCount - a.failureCount);
                setAssets(results);
            } catch (err) {
                console.error('CriticalAssetsPanel:', err);
            }
            setLoading(false);
        })();
    }, []);

    // Derive unique filter options from data
    const hierOptions = useMemo(() => {
        const levels = new Set(assets.map(a => a.hierarchyLevel));
        return Array.from(levels).sort();
    }, [assets]);

    const locOptions = useMemo(() => {
        const locs = new Set(assets.map(a => a.parentName).filter(p => p && p !== '—'));
        return Array.from(locs).sort();
    }, [assets]);

    // Apply filters + search + sort
    const filteredAssets = useMemo(() => {
        let result = [...assets];
        if (critFilter !== 'ALL') result = result.filter(a => a.criticality === critFilter);
        if (hierFilter !== 'ALL') result = result.filter(a => a.hierarchyLevel === hierFilter);
        if (locFilter !== 'ALL') result = result.filter(a => a.parentName === locFilter);
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter(a =>
                a.name.toLowerCase().includes(q) ||
                a.tag.toLowerCase().includes(q) ||
                a.parentName.toLowerCase().includes(q)
            );
        }
        if (sortBy === 'failures') result.sort((a, b) => b.failureCount - a.failureCount);
        else if (sortBy === 'name') result.sort((a, b) => a.name.localeCompare(b.name));
        else if (sortBy === 'location') result.sort((a, b) => a.parentName.localeCompare(b.parentName));
        else if (sortBy === 'recent') result.sort((a, b) => {
            const da = a.lastFailure ? new Date(a.lastFailure).getTime() : 0;
            const db = b.lastFailure ? new Date(b.lastFailure).getTime() : 0;
            return db - da;
        });
        return result;
    }, [assets, critFilter, hierFilter, locFilter, searchQuery, sortBy]);

    const hasFilters = critFilter !== 'ALL' || hierFilter !== 'ALL' || locFilter !== 'ALL' || searchQuery;

    if (!loading && assets.length === 0) return null;

    const HIER_LABELS: Record<string, string> = {
        SITE: 'Site', UNIT: 'Unit', SYSTEM: 'System',
        EQUIPMENT: 'Equipment', COMPONENT: 'Component',
    };

    return (
        <div className="bg-white border border-red-200/60 rounded-xl overflow-hidden shadow-sm">
            {/* Header bar */}
            <button onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-red-50 via-orange-50 to-amber-50 hover:from-red-100/50 hover:via-orange-100/50 hover:to-amber-100/50 transition-colors">
                <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-red-100 flex items-center justify-center">
                        <Shield size={14} className="text-red-600" />
                    </div>
                    <div className="text-left">
                        <p className="text-sm font-bold text-slate-800">Critical Assets Requiring Analysis</p>
                        <p className="text-[10px] text-slate-500">Crit A/B with corrective WOs (12 months) — select to analyze</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {assets.length > 0 && (
                        <span className="text-[10px] font-bold px-2 py-0.5 bg-red-100 text-red-700 rounded-full">
                            {filteredAssets.length}/{assets.length}
                        </span>
                    )}
                    {expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                </div>
            </button>

            {expanded && (
                <div className="px-4 pb-3 pt-2">
                    {loading ? (
                        <div className="flex items-center justify-center py-4 gap-2">
                            <Loader2 size={16} className="animate-spin text-red-400" />
                            <span className="text-xs text-slate-400">Scanning critical assets...</span>
                        </div>
                    ) : (
                        <>
                            {/* ─── Filter Fields ─── */}
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                                {/* Search */}
                                <div className="relative flex-1 min-w-[150px] max-w-[220px]">
                                    <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={e => setSearchQuery(e.target.value)}
                                        placeholder="Search tag or name..."
                                        className="w-full pl-7 pr-2 py-1.5 text-[11px] border border-slate-200 rounded-md bg-slate-50/80 focus:bg-white focus:border-blue-300 outline-none transition-colors"
                                    />
                                </div>
                                {/* Criticality */}
                                <select value={critFilter} onChange={e => setCritFilter(e.target.value)}
                                    className="text-[11px] px-2 py-1.5 border border-slate-200 rounded-md bg-slate-50/80 focus:bg-white focus:border-blue-300 outline-none cursor-pointer">
                                    <option value="ALL">All Criticality</option>
                                    <option value="A">Crit A — Safety</option>
                                    <option value="B">Crit B — Production</option>
                                </select>
                                {/* Level */}
                                <select value={hierFilter} onChange={e => setHierFilter(e.target.value)}
                                    className="text-[11px] px-2 py-1.5 border border-slate-200 rounded-md bg-slate-50/80 focus:bg-white focus:border-blue-300 outline-none cursor-pointer">
                                    <option value="ALL">All Levels</option>
                                    {hierOptions.map(h => <option key={h} value={h}>{HIER_LABELS[h] || h}</option>)}
                                </select>
                                {/* Location / Parent */}
                                <select value={locFilter} onChange={e => setLocFilter(e.target.value)}
                                    className="text-[11px] px-2 py-1.5 border border-slate-200 rounded-md bg-slate-50/80 focus:bg-white focus:border-blue-300 outline-none cursor-pointer">
                                    <option value="ALL">All Locations</option>
                                    {locOptions.map(l => <option key={l} value={l}>{l}</option>)}
                                </select>
                                {/* Sort */}
                                <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}
                                    className="text-[11px] px-2 py-1.5 border border-slate-200 rounded-md bg-slate-50/80 focus:bg-white focus:border-blue-300 outline-none cursor-pointer">
                                    <option value="failures">Sort: Most Failures</option>
                                    <option value="recent">Sort: Most Recent</option>
                                    <option value="location">Sort: Location</option>
                                    <option value="name">Sort: A → Z</option>
                                </select>
                                {/* Clear */}
                                {hasFilters && (
                                    <button onClick={() => { setCritFilter('ALL'); setHierFilter('ALL'); setLocFilter('ALL'); setSearchQuery(''); }}
                                        className="text-[10px] text-blue-600 hover:text-blue-800 font-medium px-1.5 py-1 hover:bg-blue-50 rounded transition-colors">
                                        Clear
                                    </button>
                                )}
                            </div>

                            {/* ─── Compact Inline List (No Table Headers) ─── */}
                            <div className="max-h-[200px] overflow-y-auto rounded-lg border border-slate-100">
                                {filteredAssets.length === 0 ? (
                                    <div className="px-3 py-4 text-center text-xs text-slate-400">
                                        No assets match the current filters
                                    </div>
                                ) : (
                                    filteredAssets.map((a, i) => (
                                        <button
                                            key={a.id}
                                            onClick={() => onSelectAsset({ id: a.id, name: a.name, tag: a.tag, criticality: a.criticality })}
                                            className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-blue-50/70 transition-colors group ${
                                                i > 0 ? 'border-t border-slate-100' : ''
                                            }`}
                                        >
                                            {/* Tag + Crit badge */}
                                            <div className="flex items-center gap-1.5 shrink-0 w-[120px]">
                                                <span className="text-[11px] font-mono font-bold text-slate-600 group-hover:text-blue-700 truncate">{a.tag}</span>
                                                <span className={`shrink-0 text-[8px] font-bold px-1 py-0.5 rounded ${
                                                    a.criticality === 'A' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                                                }`}>{a.criticality}</span>
                                            </div>
                                            {/* Name */}
                                            <span className="text-[11px] text-slate-700 truncate flex-1 min-w-0">{a.name}</span>
                                            {/* Location (parent) */}
                                            <span className="hidden sm:flex items-center gap-1 text-[10px] text-slate-400 shrink-0 max-w-[140px] truncate">
                                                <MapPin size={9} className="shrink-0" />{a.parentName}
                                            </span>
                                            {/* Failure count */}
                                            <span className="text-[11px] text-red-600 font-semibold shrink-0 w-[50px] text-right">
                                                {a.failureCount} <span className="text-[8px] font-normal text-slate-400">CM</span>
                                            </span>
                                            {/* Last failure */}
                                            <span className="text-[10px] text-slate-400 shrink-0 w-[46px] text-right hidden md:block">
                                                {a.lastFailure ? new Date(a.lastFailure).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'}
                                            </span>
                                            {/* Hover action */}
                                            <span className="text-[10px] text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                                <ArrowRight size={12} />
                                            </span>
                                        </button>
                                    ))
                                )}
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── Contextual Action Cards ─────────────────────────────────
function ContextualActions({ mtbf, ao, beta, asset }: {
    mtbf?: number; ao?: number; beta?: number;
    asset?: { id: string; tag: string; name: string } | null;
}) {
    const actions: { icon: React.ReactNode; text: string; severity: 'red' | 'amber' | 'blue' | 'green'; detail: string }[] = [];

    if (mtbf !== undefined && mtbf > 0 && mtbf < 2000) {
        actions.push({
            icon: <AlertTriangle size={14} />,
            text: `MTBF of ${Math.round(mtbf)}h is a reliability concern`,
            severity: 'red',
            detail: 'Consider initiating an RCA to identify chronic failure modes. MTBF < 2,000h for rotating equipment typically warrants investigation.'
        });
    }
    if (ao !== undefined && ao < 0.90) {
        actions.push({
            icon: <Gauge size={14} />,
            text: `Operational Availability at ${(ao * 100).toFixed(1)}% is below acceptable limits`,
            severity: 'red',
            detail: 'Review maintenance strategy — reduce MTTR through better procedures/spares, or improve MTBF through PM optimization.'
        });
    } else if (ao !== undefined && ao < 0.95) {
        actions.push({
            icon: <Gauge size={14} />,
            text: `Availability at ${(ao * 100).toFixed(1)}% — below world-class target of 95%`,
            severity: 'amber',
            detail: 'Marginal availability. Review logistics delay (MLDT) and stock holding to improve MRT.'
        });
    }
    if (beta !== undefined && beta > 3) {
        actions.push({
            icon: <TrendingUp size={14} />,
            text: `Severe wear-out detected (β = ${beta})`,
            severity: 'red',
            detail: 'Strong age-related failure pattern. Time-based PM replacement is highly effective. Consider CAPEX replacement if repair costs exceed 60% of new unit cost.'
        });
    } else if (beta !== undefined && beta > 1 && beta <= 3) {
        actions.push({
            icon: <TrendingUp size={14} />,
            text: `Early wear-out pattern (β = ${beta})`,
            severity: 'amber',
            detail: 'Failures increasing with age. PM replacement before characteristic life (η) is beneficial.'
        });
    } else if (beta !== undefined && beta < 1) {
        actions.push({
            icon: <Wrench size={14} />,
            text: `Infant mortality pattern (β = ${beta})`,
            severity: 'blue',
            detail: 'Failures decrease with age — likely installation, commissioning, or manufacturing defects. Review QA/QC procedures.'
        });
    }
    if (mtbf !== undefined && mtbf >= 2000 && (ao === undefined || ao >= 0.95)) {
        actions.push({
            icon: <Target size={14} />,
            text: 'Asset reliability meets acceptable thresholds',
            severity: 'green',
            detail: 'Continue current maintenance strategy. Monitor for degradation trends using Weibull analysis.'
        });
    }

    if (actions.length === 0) return null;

    const severityStyles = {
        red: 'bg-red-50 border-red-200 text-red-800',
        amber: 'bg-amber-50 border-amber-200 text-amber-800',
        blue: 'bg-blue-50 border-blue-200 text-blue-800',
        green: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    };

    return (
        <div className="space-y-2">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Lightbulb size={12} className="text-amber-500" /> Recommended Actions
            </p>
            {actions.map((a, i) => (
                <div key={i} className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${severityStyles[a.severity]}`}>
                    <div className="mt-0.5 shrink-0">{a.icon}</div>
                    <div>
                        <p className="text-sm font-semibold">{a.text}</p>
                        <p className="text-xs opacity-80 mt-0.5">{a.detail}</p>
                    </div>
                </div>
            ))}
        </div>
    );
}

// ─── Use Cases & Workflows Panel ─────────────────────────────
const USE_CASES = [
    { icon: <Settings size={14} />, title: 'PM Interval Optimization', who: 'Maintenance Planners', desc: 'Use MTBF to validate whether current PM frequencies are too early (wasteful) or too late (risky). If MTBF >> PM interval, you may be over-maintaining.' },
    { icon: <AlertTriangle size={14} />, title: 'Bad Actor Identification', who: 'Reliability Engineers', desc: 'The Critical Assets panel auto-surfaces equipment with the highest failure counts — feeding the Defect Elimination workflow for chronic failures.' },
    { icon: <FileText size={14} />, title: 'Warranty Claim Validation', who: 'Asset Managers', desc: 'If MTBF is below the manufacturer\'s guaranteed life (OREDA benchmarks), flag the asset for warranty claim documentation.' },
    { icon: <Clock size={14} />, title: 'Shutdown/Turnaround Planning', who: 'Operations / TA Planners', desc: 'RAM analysis identifies which systems drive plant downtime — prioritize shutdown scope and resource allocation accordingly.' },
    { icon: <Package size={14} />, title: 'Spares Rationalization', who: 'Inventory / Procurement', desc: 'Spares Demand calculator outputs stock-holding recommendations based on actual failure rates, not historical guesswork or vendor defaults.' },
    { icon: <Shield size={14} />, title: 'SIL/SIS Validation', who: 'Safety Engineers', desc: 'For safety-instrumented systems: Weibull β and MTBF feed into PFD (Probability of Failure on Demand) calculations per IEC 61508/61511.' },
    { icon: <Users size={14} />, title: 'Contract KPI Monitoring', who: 'Contract Managers', desc: 'Validate Availability (Ao) targets in maintenance contracts against actual field performance to enforce SLA compliance.' },
    { icon: <DollarSign size={14} />, title: 'Capital Replacement Justification', who: 'Asset Strategy', desc: 'When Weibull shows β > 3 (severe wear-out) and repair costs exceed 60% of replacement cost — build a data-driven CAPEX business case.' },
];

function UseCasesPanel() {
    const [expanded, setExpanded] = useState(false);
    return (
        <div className="bg-gradient-to-r from-blue-50 via-blue-50 to-primary-50 border border-blue-200/60 rounded-xl overflow-hidden">
            <button onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/30 transition-colors">
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                        <BookOpen size={16} className="text-blue-600" />
                    </div>
                    <div className="text-left">
                        <p className="text-sm font-bold text-slate-800">Use Cases & Workflows</p>
                        <p className="text-[10px] text-slate-500">How reliability data drives operational decisions — 8 key workflows</p>
                    </div>
                </div>
                {expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
            </button>
            {expanded && (
                <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {USE_CASES.map((uc, i) => (
                        <div key={i} className="bg-white/80 border border-slate-200/80 rounded-xl p-3.5 hover:shadow-sm transition-shadow">
                            <div className="flex items-center gap-2 mb-1.5">
                                <div className="text-blue-500">{uc.icon}</div>
                                <p className="text-xs font-bold text-slate-800">{uc.title}</p>
                            </div>
                            <p className="text-[11px] text-slate-600 leading-relaxed">{uc.desc}</p>
                            <p className="text-[9px] text-blue-500 font-semibold mt-2 uppercase tracking-wider">→ {uc.who}</p>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
//  TAB 1: MTBF / MTTR Calculator
// ═══════════════════════════════════════════════════════════════
export function MTBFTab({ onStateChange, loadedData }: TabProps = {}) {
    const [asset, setAsset] = useState<AssetOption | null>(null);
    const [totalHours, setTotalHours] = useState('8760');
    const [failures, setFailures] = useState('3');
    const [repairTimesStr, setRepairTimesStr] = useState('4, 6, 8, 2, 12, 3');
    const [confidence, setConfidence] = useState(90);
    const [loading, setLoading] = useState(false);

    // Load saved analysis data
    useEffect(() => {
        if (!loadedData?.inputs) return;
        const { inputs } = loadedData;
        if (inputs.totalHours) setTotalHours(String(inputs.totalHours));
        if (inputs.failures) setFailures(String(inputs.failures));
        if (inputs.repairTimesStr) setRepairTimesStr(inputs.repairTimesStr);
        if (inputs.confidence) setConfidence(inputs.confidence);
    }, [loadedData]);

    // Auto-populate from WO data (M1: via the shared reliability engine)
    useEffect(() => {
        if (!asset) return;
        setLoading(true);
        (async () => {
            const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString();
            const { data: wos } = await supabase.from('work_orders')
                .select(FAILURE_QUERY_COLUMNS)
                .eq('asset_id', asset.id)
                .gte('created_at', yearAgo)
                .order('created_at');

            const basis = assetFailureBasis(wos || []);
            if (basis.failures > 0) {
                setFailures(String(basis.failures));
                setTotalHours(String(basis.totalHours));
                if (basis.repairHours.length > 0) setRepairTimesStr(basis.repairHours.map(r => r.toFixed(1)).join(', '));
            }
            setLoading(false);
        })();
    }, [asset]);

    const repairTimes = repairTimesStr.split(/[,\s]+/).map(Number).filter(n => !isNaN(n) && n > 0);
    const mtbfResult = computeMTBFWithConfidence(parseFloat(totalHours) || 0, parseInt(failures) || 0, confidence);
    const mttrResult = computeMTTR(repairTimes);

    // Report state changes to parent
    useEffect(() => {
        onStateChange?.({
            totalHours, failures, repairTimesStr, confidence
        }, {
            mtbf: mtbfResult.mtbf, lower: mtbfResult.lower, upper: mtbfResult.upper,
            mttr: mttrResult.mean, mttrMedian: mttrResult.median
        }, asset ? { id: asset.id, tag: asset.tag, name: asset.name } : null);
    }, [totalHours, failures, repairTimesStr, confidence, asset]);

    // Chart data — MTTR distribution
    const mttrChartData = repairTimes.length > 0
        ? [...repairTimes].sort((a, b) => a - b).map((t, i) => ({
            time: t,
            Mt: Math.round((1 - Math.exp(-t / mttrResult.mean)) * 100),
            rank: Math.round(((i + 1) / repairTimes.length) * 100)
        }))
        : [];

    return (
        <div className="space-y-6">
            {/* Asset Selector */}
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                <label className="block text-sm font-medium text-blue-900 mb-2">
                    <Search size={14} className="inline mr-1" /> Auto-populate from asset work orders
                </label>
                <AssetSelector selected={asset} onSelect={setAsset} />
                {loading && <p className="text-xs text-blue-500 mt-2 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Loading WO data...</p>}
            </div>

            {/* Manual Inputs */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Total Operating Hours</label>
                    <input type="number" value={totalHours} onChange={e => setTotalHours(e.target.value)}
                        className={CONTROL_CLS} />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Number of Failures</label>
                    <input type="number" value={failures} onChange={e => setFailures(e.target.value)}
                        className={CONTROL_CLS} />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Confidence Level (%)</label>
                    <select value={confidence} onChange={e => setConfidence(Number(e.target.value))}
                        className={CONTROL_CLS}>
                        <option value={60}>60%</option>
                        <option value={80}>80%</option>
                        <option value={90}>90%</option>
                        <option value={95}>95%</option>
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Repair Times (hours, comma-sep)</label>
                    <input type="text" value={repairTimesStr} onChange={e => setRepairTimesStr(e.target.value)}
                        className={CONTROL_CLS} placeholder="4, 6, 8, 2" />
                </div>
            </div>

            {/* MTBF Results */}
            <div>
                <h4 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2"><Activity size={16} className="text-blue-600" /> MTBF Results</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <ResultCard label="Point MTBF" value={mtbfResult.mtbf === Infinity ? '∞' : mtbfResult.mtbf.toFixed(0)} unit="hrs" color="blue" />
                    <ResultCard label={`Lower (${confidence}%)`} value={mtbfResult.lower.toFixed(0)} unit="hrs" color="amber" sub="Conservative estimate" />
                    <ResultCard label={`Upper (${confidence}%)`} value={mtbfResult.upper === Infinity ? '∞' : mtbfResult.upper.toFixed(0)} unit="hrs" color="green" />
                    <ResultCard label="Failure Rate (λ)" value={mtbfResult.mtbf > 0 && mtbfResult.mtbf < Infinity ? (1 / mtbfResult.mtbf * 1000).toFixed(3) : '0'} unit="per 1000h" color="red" />
                </div>
            </div>

            {/* MTTR Results */}
            <div>
                <h4 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2"><Wrench size={16} className="text-blue-600" /> MTTR Results</h4>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <ResultCard label="Mean (MTTR)" value={mttrResult.mean.toFixed(1)} unit="hrs" color="purple" />
                    <ResultCard label="Median" value={mttrResult.median.toFixed(1)} unit="hrs" color="purple" />
                    <ResultCard label="Std Dev" value={mttrResult.stdDev.toFixed(1)} unit="hrs" color="slate" />
                    <ResultCard label="Mmax (90%)" value={mttrResult.mmax90.toFixed(1)} unit="hrs" color="amber" sub="90% repairs complete" />
                    <ResultCard label="Mmax (95%)" value={mttrResult.mmax95.toFixed(1)} unit="hrs" color="red" sub="95% repairs complete" />
                </div>
            </div>

            {/* MTTR Chart */}
            {mttrChartData.length > 2 && (
                <div className="bg-white border border-slate-200 rounded-xl p-6">
                    <h4 className="text-sm font-bold text-slate-900 mb-4">Maintainability Function M(t) — Repair Time CDF</h4>
                    <ResponsiveContainer width="100%" height={250}>
                        <LineChart data={mttrChartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                            <XAxis dataKey="time" label={{ value: 'Repair Time (hrs)', position: 'insideBottom', offset: -5 }} tick={{ fontSize: 11 }} />
                            <YAxis label={{ value: 'M(t) %', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} domain={[0, 100]} />
                            <Tooltip formatter={(v: any) => `${v}%`} />
                            <Legend />
                            <Line type="monotone" dataKey="Mt" stroke="#8b5cf6" strokeWidth={2} name="Exponential M(t)" dot={false} />
                            <Line type="stepAfter" dataKey="rank" stroke="#3b82f6" strokeWidth={1} strokeDasharray="4 4" name="Empirical CDF" dot={{ r: 3, fill: '#3b82f6' }} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
//  TAB 2: Availability (Ao) Calculator
// ═══════════════════════════════════════════════════════════════
export function AvailabilityTab({ onStateChange, loadedData }: TabProps = {}) {
    const [asset, setAsset] = useState<AssetOption | null>(null);
    const [loading, setLoading] = useState(false);
    const [mtbf, setMtbf] = useState('2920');
    const [mttr, setMttr] = useState('6');
    const [mldt, setMldt] = useState('2');
    const [targetAo, setTargetAo] = useState('95');

    // Load saved analysis data
    useEffect(() => {
        if (!loadedData?.inputs) return;
        const { inputs } = loadedData;
        if (inputs.mtbf) setMtbf(String(inputs.mtbf));
        if (inputs.mttr) setMttr(String(inputs.mttr));
        if (inputs.mldt) setMldt(String(inputs.mldt));
        if (inputs.targetAo) setTargetAo(String(inputs.targetAo));
    }, [loadedData]);

    // Auto-populate from WO data (M1: via the shared reliability engine)
    useEffect(() => {
        if (!asset) return;
        setLoading(true);
        (async () => {
            const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString();
            const { data: wos } = await supabase.from('work_orders')
                .select(FAILURE_QUERY_COLUMNS)
                .eq('asset_id', asset.id)
                .gte('created_at', yearAgo)
                .order('created_at');
            const basis = assetFailureBasis(wos || []);
            if (basis.failures > 0) {
                setMtbf(String(Math.round(basis.totalHours / basis.failures)));
                if (basis.repairHours.length > 0) {
                    const calcMttr = basis.repairHours.reduce((s, v) => s + v, 0) / basis.repairHours.length;
                    setMttr(calcMttr.toFixed(1));
                }
            }
            setLoading(false);
        })();
    }, [asset]);

    const mrt = parseFloat(mttr) + parseFloat(mldt);
    const ao = parseFloat(mtbf) / (parseFloat(mtbf) + mrt);
    const aoPercent = (ao * 100).toFixed(2);

    // Generate trade-off data: for fixed Ao, what MTBF/MRT combos work?
    const tradeoffData = useMemo(() => {
        const target = parseFloat(targetAo) / 100;
        const data: { mrt: number; mtbfReq: number }[] = [];
        for (let m = 1; m <= 100; m += 2) {
            const mtbfReq = (target * m) / (1 - target);
            if (mtbfReq < 50000) data.push({ mrt: m, mtbfReq: Math.round(mtbfReq) });
        }
        return data;
    }, [targetAo]);

    const aoColor = ao >= 0.95 ? 'green' : ao >= 0.90 ? 'amber' : 'red';

    // Report state changes to parent
    useEffect(() => {
        onStateChange?.(
            { mtbf, mttr, mldt, targetAo },
            { ao: aoPercent, mrt, annualDowntime: ((1 - ao) * 8760).toFixed(0) },
            asset ? { id: asset.id, tag: asset.tag, name: asset.name } : null
        );
    }, [mtbf, mttr, mldt, targetAo, asset]);

    return (
        <div className="space-y-6">
            {/* Asset Selector */}
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                <label className="block text-sm font-medium text-blue-900 mb-2">
                    <Search size={14} className="inline mr-1" /> Auto-populate from asset work orders
                </label>
                <AssetSelector selected={asset} onSelect={setAsset} />
                {loading && <p className="text-xs text-blue-500 mt-2 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Calculating MTBF and MTTR from WOs...</p>}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">MTBF (hours)</label>
                    <input type="number" value={mtbf} onChange={e => setMtbf(e.target.value)}
                        className={CONTROL_CLS} />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">MTTR (hours)</label>
                    <input type="number" value={mttr} onChange={e => setMttr(e.target.value)}
                        className={CONTROL_CLS} />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">MLDT (hours)</label>
                    <input type="number" value={mldt} onChange={e => setMldt(e.target.value)}
                        className={CONTROL_CLS} />
                    <p className="text-[10px] text-slate-400 mt-0.5">Mean logistics delay time</p>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Target Ao (%)</label>
                    <input type="number" value={targetAo} onChange={e => setTargetAo(e.target.value)}
                        className={CONTROL_CLS} />
                </div>
            </div>

            {/* Formula */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center">
                <p className="text-sm text-slate-500">Ao = MTBF / (MTBF + MRT) = {parseFloat(mtbf).toFixed(0)} / ({parseFloat(mtbf).toFixed(0)} + {mrt.toFixed(1)})</p>
            </div>

            {/* Results */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <ResultCard label="Operational Availability" value={`${aoPercent}%`} color={aoColor}
                    sub={ao >= 0.95 ? '✅ Meets world-class target' : ao >= 0.90 ? '⚠️ Below target' : '🔴 Critical'} />
                <ResultCard label="MRT (Total)" value={mrt.toFixed(1)} unit="hrs" color="purple" sub={`MTTR ${mttr}h + MLDT ${mldt}h`} />
                <ResultCard label="Annual Downtime" value={((1 - ao) * 8760).toFixed(0)} unit="hrs/yr" color="red" />
                <ResultCard label="Annual Uptime" value={(ao * 8760).toFixed(0)} unit="hrs/yr" color="green" />
            </div>

            {/* Ao vs Target */}
            <div className={`p-4 rounded-xl border ${ao >= parseFloat(targetAo) / 100 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                <p className={`text-sm font-medium ${ao >= parseFloat(targetAo) / 100 ? 'text-green-700' : 'text-red-700'}`}>
                    {ao >= parseFloat(targetAo) / 100
                        ? `✅ Current Ao (${aoPercent}%) meets the target of ${targetAo}%`
                        : `🔴 Current Ao (${aoPercent}%) is below the target of ${targetAo}%. Need to improve MTBF or reduce MRT.`}
                </p>
            </div>

            {/* Trade-off Chart */}
            <div className="bg-white border border-slate-200 rounded-xl p-6">
                <h4 className="text-sm font-bold text-slate-900 mb-4">
                    MTBF vs MRT Trade-off for Ao = {targetAo}%
                    <span className="text-xs font-normal text-slate-400 ml-2">Combinations that achieve target availability</span>
                </h4>
                <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={tradeoffData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="mrt" label={{ value: 'MRT (hours)', position: 'insideBottom', offset: -5 }} tick={{ fontSize: 11 }} />
                        <YAxis label={{ value: 'Required MTBF (hrs)', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(v: any) => `${v} hrs`} />
                        <Area type="monotone" dataKey="mtbfReq" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} name="Required MTBF" />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
//  TAB 3: Weibull Analysis
// ═══════════════════════════════════════════════════════════════
export function WeibullTab({ onStateChange, loadedData, initialAsset, onPMCreated }: TabProps = {}) {
    const navigate = useNavigate();
    const [asset, setAsset] = useState<AssetOption | null>(null);
    const [dataStr, setDataStr] = useState('20, 42, 55, 73, 95, 101, 118, 139');
    // Right-censored units (suspensions): ages of units removed/still running
    // unfailed. Auto-populated with the running time since the last failure.
    const [suspStr, setSuspStr] = useState('');
    const [loading, setLoading] = useState(false);
    const [showRtFt, setShowRtFt] = useState(false);
    const [showPMModal, setShowPMModal] = useState(false);

    // Population mode — pool failures across a group of assets (scoped by functional
    // location and/or class) and fit ONE life curve, then create a single PM for them.
    const [mode, setMode] = useState<'asset' | 'class'>('asset');
    const [assetClass, setAssetClass] = useState('');
    const [locationId, setLocationId] = useState(''); // functional location node ('' = whole plant)
    const [allAssets, setAllAssets] = useState<TreeAsset[]>([]);

    // The register is a recursive parent_id tree (SITE > UNIT > SYSTEM > EQUIPMENT
    // > COMPONENT); load it once to resolve locations + their descendant equipment.
    useEffect(() => {
        supabase.from('assets').select('id, tag, name, hierarchy_level, parent_id, asset_class')
            .then(({ data }) => setAllAssets((data || []) as TreeAsset[]));
    }, []);

    const childrenMap = useMemo(() => {
        const m: Record<string, TreeAsset[]> = {};
        for (const a of allAssets) { const p = a.parent_id || ''; (m[p] = m[p] || []).push(a); }
        return m;
    }, [allAssets]);
    const descendantIds = useCallback((rootId: string): string[] => {
        const out: string[] = [];
        const stack = [...(childrenMap[rootId] || [])];
        while (stack.length) { const n = stack.pop()!; out.push(n.id); const kids = childrenMap[n.id]; if (kids) stack.push(...kids); }
        return out;
    }, [childrenMap]);
    const locationNodes = useMemo(() =>
        allAssets.filter(a => LOC_LEVELS.includes(a.hierarchy_level))
            .sort((a, b) => LOC_LEVELS.indexOf(a.hierarchy_level) - LOC_LEVELS.indexOf(b.hierarchy_level) || (a.tag || '').localeCompare(b.tag || '')),
        [allAssets]);
    const scopedEquip = useMemo(() => {
        const inLoc = locationId ? new Set(descendantIds(locationId)) : null;
        return allAssets.filter(a => EQUIP_LEVELS.includes(a.hierarchy_level) && (!inLoc || inLoc.has(a.id)));
    }, [allAssets, locationId, descendantIds]);
    const classesInScope = useMemo(() =>
        Array.from(new Set(scopedEquip.map(a => (a.asset_class || '').trim()).filter(Boolean))).sort(),
        [scopedEquip]);
    // The population members: scoped equipment, optionally narrowed to one class.
    const poolMembers = useMemo(() =>
        scopedEquip.filter(a => !assetClass || (a.asset_class || '') === assetClass),
        [scopedEquip, assetClass]);
    const classAssets = poolMembers.map(a => ({ id: a.id, tag: a.tag, name: a.name }));

    // Seed the asset once from a drill-through (Metrics bad actor → Fit Weibull).
    // The asset-change effect below then auto-pulls WO failures and fits.
    const seededRef = useRef(false);
    useEffect(() => {
        if (seededRef.current || !initialAsset) return;
        seededRef.current = true;
        setAsset(initialAsset);
    }, [initialAsset]);

    // Load saved analysis data
    useEffect(() => {
        if (!loadedData?.inputs) return;
        if (loadedData.inputs.dataStr) setDataStr(loadedData.inputs.dataStr);
        if (loadedData.inputs.suspStr != null) setSuspStr(loadedData.inputs.suspStr);
    }, [loadedData]);

    // Running (right-censored) interval: hours survived since the last failure.
    const runningSuspensionHours = (recs: any[]): number | null => {
        const lastFail = (recs || []).filter(isFailure)
            .map(w => new Date(w.closed_at || w.created_at).getTime())
            .sort((a, b) => b - a)[0];
        if (!lastFail) return null;
        const h = Math.floor((Date.now() - lastFail) / 3600000);
        return h > 0 ? h : null;
    };

    useEffect(() => {
        if (!asset) return;
        setLoading(true);
        (async () => {
            // Inter-arrival failure intervals via the shared engine (M1) — same
            // failure definition (corrective OR coded failure mode) as Metrics/RAM.
            // All-time (life data wants every failure), all types; the engine filters.
            const { data: wos } = await supabase.from('work_orders')
                .select('id, type, created_at, closed_at, wo_failure_data(failure_mode_code)')
                .eq('asset_id', asset.id)
                .order('created_at');
            const times = failureIntervalsHours(wos || []);
            if (times.length > 0) setDataStr(times.join(', '));
            // The time survived since the last failure is a suspension — leaving
            // it out is what biased the old failures-only fit pessimistic (R-1).
            const run = runningSuspensionHours(wos || []);
            setSuspStr(run != null ? String(run) : '');
            setLoading(false);
        })();
    }, [asset]);

    // Class mode: pool inter-arrival intervals across the scoped population (a
    // location branch and/or a class). Intervals are computed per-asset then
    // concatenated (never across assets), so it's a valid population life sample.
    // Requires a class or a location to be chosen (avoids pooling the whole plant).
    useEffect(() => {
        if (mode !== 'class') return;
        if ((!assetClass && !locationId) || poolMembers.length === 0) { setDataStr(''); return; }
        setLoading(true);
        (async () => {
            const ids = poolMembers.map(a => a.id);
            const { data: wos } = await supabase.from('work_orders')
                .select('id, type, asset_id, created_at, closed_at, wo_failure_data(failure_mode_code)')
                .in('asset_id', ids)
                .order('created_at');
            const byAsset: Record<string, any[]> = {};
            for (const w of (wos || [])) { const k = (w as any).asset_id; (byAsset[k] = byAsset[k] || []).push(w); }
            const pooled: number[] = [];
            const pooledSusp: number[] = [];
            for (const recs of Object.values(byAsset)) {
                pooled.push(...failureIntervalsHours(recs));
                // Each pool member's running time since ITS last failure is a
                // right-censored unit of the population sample.
                const run = runningSuspensionHours(recs);
                if (run != null) pooledSusp.push(run);
            }
            setDataStr(pooled.length > 0 ? pooled.join(', ') : '');
            setSuspStr(pooledSusp.length > 0 ? pooledSusp.join(', ') : '');
            setLoading(false);
        })();
    }, [mode, assetClass, locationId, poolMembers]);

    const failureTimes = dataStr.split(/[,\s]+/).map(Number).filter(n => !isNaN(n) && n > 0);
    const suspensionTimes = suspStr.split(/[,\s]+/).map(Number).filter(n => !isNaN(n) && n > 0);
    const fit = failureTimes.length >= 2 ? fitWeibull(failureTimes, suspensionTimes) : null;

    // Effective target for Create PM: the scoped population, or the single asset.
    const classActive = mode === 'class' && !!(assetClass || locationId) && classAssets.length > 0;
    const pmAsset = classActive
        ? { id: classAssets[0].id, tag: classAssets[0].tag, name: classAssets[0].name }
        : (asset ? { id: asset.id, tag: asset.tag, name: asset.name } : null);
    const locNode = locationNodes.find(n => n.id === locationId);
    const scopeLabel = assetClass
        ? (locNode ? `${assetClass} @ ${locNode.tag}` : assetClass)
        : (locNode ? `${locNode.tag} equipment` : 'Equipment');

    // Report state changes to parent (bridge to Monte Carlo)
    useEffect(() => {
        onStateChange?.(
            { dataStr, suspStr },
            fit ? { beta: fit.beta, eta: fit.eta, r2: fit.r2, b10: Math.round(weibullBLife(fit.beta, fit.eta, 10)) } : {},
            asset ? { id: asset.id, tag: asset.tag, name: asset.name } : null
        );
    }, [dataStr, suspStr, asset, fit?.beta, fit?.eta, onStateChange]);




    return (
        <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-3">
                {/* Scope toggle: fit one asset, or pool a whole class (population Weibull) */}
                <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs font-semibold">
                        <button onClick={() => setMode('asset')}
                            className={`px-3 py-1.5 transition-colors ${mode === 'asset' ? 'bg-primary-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                            Single asset
                        </button>
                        <button onClick={() => setMode('class')}
                            className={`px-3 py-1.5 transition-colors ${mode === 'class' ? 'bg-primary-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                            Asset class
                        </button>
                    </div>
                    <span className="text-[11px] text-slate-400">
                        {mode === 'class' ? 'Pool failures across a class → one PM for all its assets' : 'Fit a single asset’s failure history'}
                    </span>
                    {loading && <p className="text-xs text-blue-500 flex items-center gap-1 ml-auto shrink-0"><Loader2 size={12} className="animate-spin" /> Loading…</p>}
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 shrink-0">
                        <Search size={14} className="text-blue-500" /> {mode === 'class' ? 'Scope' : 'Asset'}
                    </div>
                    <div className="flex-1 min-w-0">
                        {mode === 'asset' ? (
                            <AssetSelector selected={asset} onSelect={setAsset} />
                        ) : (
                            <div className="flex flex-col sm:flex-row gap-2">
                                {/* Functional location — scope to a branch of the register (or whole plant) */}
                                <select value={locationId} onChange={e => setLocationId(e.target.value)} className={CONTROL_CLS} title="Functional location">
                                    <option value="">All locations (whole plant)</option>
                                    {locationNodes.map(n => <option key={n.id} value={n.id}>{n.hierarchy_level} · {n.tag} — {n.name}</option>)}
                                </select>
                                {/* Asset class within that location */}
                                <select value={assetClass} onChange={e => setAssetClass(e.target.value)} className={CONTROL_CLS} title="Asset class">
                                    <option value="">All classes</option>
                                    {classesInScope.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                        )}
                    </div>
                    {mode === 'class' && (assetClass || locationId) && (
                        <span className="text-[11px] text-slate-500 shrink-0">
                            {classAssets.length} assets · {failureTimes.length} pooled failures
                        </span>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                    <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Time-to-Failure Data (hrs, comma-sep)
                    </label>
                    <textarea value={dataStr} onChange={e => setDataStr(e.target.value)} placeholder="20, 42, 55, 73, 95..."
                        className="w-full p-2 border border-slate-200 rounded-lg text-xs font-mono h-12 md:h-16 resize-none focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500" />
                </div>
                <div>
                    <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Suspensions — censored, unfailed (hrs, optional)
                    </label>
                    <textarea value={suspStr} onChange={e => setSuspStr(e.target.value)} placeholder="e.g. running time since last failure, units renewed unfailed…"
                        className="w-full p-2 border border-slate-200 rounded-lg text-xs font-mono h-12 md:h-16 resize-none focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500" />
                    <p className="text-[10px] text-slate-400 mt-0.5">
                        Units still running (or removed unfailed) at these ages. Ignoring them biases β/η pessimistic — auto-filled with the time survived since the last failure.
                    </p>
                </div>
            </div>

            {fit && (
                <>
                    {/* Fit basis */}
                    <p className="text-[11px] text-slate-500 -mt-1">
                        Fit basis: <strong>{fit.nFailures} failures</strong>
                        {fit.nSuspensions > 0 && <> + <strong>{fit.nSuspensions} suspensions</strong> (Johnson adjusted ranks)</>}
                        {fit.confidence && <> · bounds at {Math.round(fit.confidence.level * 100)}% confidence (regression approx.)</>}
                    </p>

                    {/* Parameters */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <ResultCard label="Shape (β)" value={fit.beta} color="blue"
                            sub={`${fit.beta < 1 ? 'Infant mortality' : fit.beta <= 1.5 ? 'Random failures' : 'Wear-out'}${fit.confidence ? ` · ${Math.round(fit.confidence.level * 100)}%: ${fit.confidence.betaLower.toFixed(2)}–${fit.confidence.betaUpper.toFixed(2)}` : ''}`} />
                        <ResultCard label="Scale (η)" value={fit.eta} unit="hrs" color="purple"
                            sub={`Life at 63.2% failed${fit.confidence ? ` · ${Math.round(fit.confidence.level * 100)}%: ${Math.round(fit.confidence.etaLower).toLocaleString()}–${Math.round(fit.confidence.etaUpper).toLocaleString()}h` : ''}`} />
                        <ResultCard label="R²" value={fit.r2} color={fit.r2 >= 0.9 ? 'green' : 'amber'}
                            sub={fit.r2 >= 0.9 ? 'Fit quality — excellent' : 'Fit quality — weak, use caution'} />
                        <ResultCard label="B10 Life" value={Math.round(weibullBLife(fit.beta, fit.eta, 10))} unit="hrs" color="green" sub="10% fail / 90% survive" />
                    </div>




                    {/* B-Life Table */}
                    <div className="bg-white border border-slate-200 rounded-xl p-3">
                        <h4 className="text-xs font-bold text-slate-800 mb-2">B-Life Values</h4>
                        <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                            {[1, 5, 10, 50, 63.2].map(pct => (
                                <div key={pct} className="text-center p-1.5 bg-slate-50 rounded-lg">
                                    <p className="text-[9px] text-slate-500">B{pct}%</p>
                                    <p className="text-xs font-bold text-slate-900">{Math.round(weibullBLife(fit.beta, fit.eta, pct))}h</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Reliability curve R(t) — single annotated line, collapsible */}
                    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                        <button
                            type="button"
                            onClick={() => setShowRtFt(prev => !prev)}
                            className="w-full flex items-center justify-between px-6 py-3.5 hover:bg-slate-50/60 transition-colors"
                        >
                            <span className="text-sm font-bold text-slate-500 flex items-center gap-2">
                                <Activity size={14} className="text-emerald-400" />
                                Reliability R(t)
                                <span className="text-[10px] font-normal text-slate-400 ml-1">Probability of surviving to time t</span>
                            </span>
                            {showRtFt
                                ? <ChevronUp size={16} className="text-slate-400" />
                                : <ChevronDown size={16} className="text-slate-400" />}
                        </button>
                        {showRtFt && (
                            <div className="px-6 pb-6">
                                <ResponsiveContainer width="100%" height={200}>
                                    <LineChart data={fit.plotData}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                        <XAxis dataKey="t" label={{ value: 'Time (hours)', position: 'insideBottom', offset: -5 }} tick={{ fontSize: 11 }} />
                                        <YAxis label={{ value: 'Reliability %', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} domain={[0, 100]} />
                                        <Tooltip formatter={(v: any) => `${Math.round(v)}%`} />
                                        <Line type="monotone" dataKey="reliability" stroke="#10b981" strokeWidth={2.5} name="Reliability R(t)" dot={false} />
                                        {/* B10 — 90% surviving */}
                                        <ReferenceLine x={Math.round(weibullBLife(fit.beta, fit.eta, 10))} stroke="#059669" strokeDasharray="4 3"
                                            label={{ value: 'B10', position: 'top', fill: '#059669', fontSize: 10, fontWeight: 700 }} />
                                        {/* η — characteristic life (63.2% failed) */}
                                        <ReferenceLine x={Math.round(fit.eta)} stroke="#8b5cf6" strokeDasharray="6 4"
                                            label={{ value: 'η', position: 'top', fill: '#7c3aed', fontSize: 11, fontWeight: 700 }} />
                                        {/* Recommended PM interval (wear-out only) */}
                                        {fit.beta > 1 && (
                                            <ReferenceLine x={Math.round(fit.eta * (fit.beta > 3 ? 0.7 : fit.beta > 2 ? 0.75 : 0.8))} stroke="#0ea5e9" strokeDasharray="3 3"
                                                label={{ value: 'PM', position: 'top', fill: '#0284c7', fontSize: 10, fontWeight: 700 }} />
                                        )}
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </div>

                    {/* ── PM Recommendation Panel ────────────── */}
                    {fit.beta > 1 && asset && (
                        <div className="bg-gradient-to-r from-primary-50 via-primary-50 to-sky-50 border-2 border-primary-200 rounded-2xl p-5">
                            <div className="flex items-start justify-between flex-wrap gap-3">
                                <div className="flex items-start gap-3">
                                    <div className="p-2.5 rounded-xl bg-primary-100 text-primary-600">
                                        <Wrench size={20} />
                                    </div>
                                    <div>
                                        <h5 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                                            PM Interval Recommendation
                                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                                                fit.beta > 3 ? 'bg-red-100 text-red-700' : fit.beta > 1.5 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                                            }`}>
                                                {fit.beta > 3 ? 'Aggressive Replacement' : fit.beta > 1.5 ? 'Time-Directed PM' : 'Condition-Based'}
                                            </span>
                                        </h5>
                                        <p className="text-xs text-slate-600 mt-1.5 leading-relaxed max-w-xl">
                                            Based on β = {fit.beta} and η = {fit.eta.toLocaleString()} hrs, schedule PM replacement every{' '}
                                            <strong className="text-primary-700">
                                                {Math.round(fit.eta * (fit.beta > 3 ? 0.7 : fit.beta > 2 ? 0.75 : 0.8)).toLocaleString()} hours
                                            </strong>{' '}
                                            ({Math.round((fit.beta > 3 ? 70 : fit.beta > 2 ? 75 : 80))}% of η) to maintain ≥{Math.round((fit.beta > 3 ? 70 : fit.beta > 2 ? 75 : 80))}% reliability.
                                            B10 safety lower-bound: {Math.round(weibullBLife(fit.beta, fit.eta, 10)).toLocaleString()} hrs.
                                        </p>
                                    </div>
                                </div>
                                <div className="flex flex-col gap-2 shrink-0">
                                    <button
                                        onClick={() => setShowPMModal(true)}
                                        className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-primary-500 to-primary-500 text-white text-sm font-bold rounded-xl shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all"
                                    >
                                        <Wrench size={15} />
                                        Create PM Program
                                    </button>
                                    {pmAsset && (
                                        <button
                                            onClick={() => navigate('/rcm', {
                                                state: {
                                                    seed: {
                                                        asset: { id: pmAsset.id, name: pmAsset.name, tag: pmAsset.tag },
                                                        weibull: {
                                                            beta: fit.beta,
                                                            eta: fit.eta,
                                                            b10: Math.round(weibullBLife(fit.beta, fit.eta, 10)),
                                                            interval: Math.round(fit.eta * (fit.beta > 3 ? 0.7 : fit.beta > 2 ? 0.75 : 0.8)),
                                                            r2: fit.r2,
                                                        },
                                                    },
                                                },
                                            })}
                                            title="Start an RCM study seeded with this asset and the fitted life data"
                                            className="flex items-center justify-center gap-2 px-5 py-2 bg-white border border-slate-200 text-slate-600 text-xs font-semibold rounded-xl hover:border-primary-300 hover:text-primary-600 transition-colors"
                                        >
                                            Send to RCM Study
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ── Lifecycle Analysis — Hazard Rate h(t) ────── */}
                    <LifecycleAnalysis
                        beta={fit.beta}
                        eta={fit.eta}
                        r2={fit.r2}
                        assetTag={classActive ? scopeLabel : asset?.tag}
                        onCreatePM={pmAsset ? () => setShowPMModal(true) : undefined}
                    />

                    {/* ── PM Creation Modal ─────────────────── */}
                    {pmAsset && (
                        <CreatePMFromWeibullModal
                            isOpen={showPMModal}
                            onClose={() => setShowPMModal(false)}
                            onSuccess={(pmId, pmTitle) => { if (pmId) onPMCreated?.(pmId, pmTitle || 'PM program'); }}
                            data={{
                                asset: pmAsset,
                                beta: fit.beta,
                                eta: fit.eta,
                                r2: fit.r2,
                                b10: Math.round(weibullBLife(fit.beta, fit.eta, 10)),
                                pmInterval: Math.round(fit.eta * (fit.beta > 3 ? 0.7 : fit.beta > 2 ? 0.75 : 0.8)),
                                dataPoints: failureTimes.length,
                                className: classActive ? scopeLabel : undefined,
                                classAssets: classActive ? classAssets : undefined,
                            }}
                        />
                    )}
                </>
            )}

            {failureTimes.length < 2 && (
                <div className="text-center py-12 text-slate-400">
                    <TrendingUp size={40} className="mx-auto mb-3 text-slate-300" />
                    <p className="text-sm">Enter at least 2 failure times to perform Weibull analysis</p>
                </div>
            )}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
//  TAB 4: Spares Demand (Poisson)
// ═══════════════════════════════════════════════════════════════
export function SparesTab({ onStateChange, loadedData }: TabProps = {}) {
    const [asset, setAsset] = useState<AssetOption | null>(null);
    const [loadingSp, setLoadingSp] = useState(false);
    const [population, setPopulation] = useState('10');
    const [mtbfVal, setMtbfVal] = useState('8760');
    const [interval, setInterval] = useState('2160');
    const [confidence, setConfidence] = useState('95');

    // Result → Action: apply the stocking recommendation to an inventory item's min level
    const [invItems, setInvItems] = useState<{ id: string; code: string; description: string; minLevel: number }[]>([]);
    const [invSel, setInvSel] = useState('');
    const [invApplying, setInvApplying] = useState(false);
    const [invToast, setInvToast] = useState<string | null>(null);

    useEffect(() => {
        supabase.from('inventory_items').select('id, part_number, description, min_level').order('part_number')
            .then(({ data }) => setInvItems((data || []).map((r: any) => ({
                id: r.id, code: r.part_number || '—', description: r.description || '', minLevel: r.min_level || 0,
            }))));
    }, []);

    // Load saved analysis data
    useEffect(() => {
        if (!loadedData?.inputs) return;
        const { inputs } = loadedData;
        if (inputs.population) setPopulation(String(inputs.population));
        if (inputs.mtbfVal) setMtbfVal(String(inputs.mtbfVal));
        if (inputs.interval) setInterval(String(inputs.interval));
        if (inputs.confidence) setConfidence(String(inputs.confidence));
    }, [loadedData]);

    // Auto-populate MTBF from WO data
    useEffect(() => {
        if (!asset) return;
        setLoadingSp(true);
        (async () => {
            // M1: same engine basis as RAM/Metrics so the spares MTBF reconciles.
            const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString();
            const { data: wos } = await supabase.from('work_orders')
                .select(FAILURE_QUERY_COLUMNS)
                .eq('asset_id', asset.id)
                .gte('created_at', yearAgo);
            const basis = assetFailureBasis(wos || []);
            if (basis.failures > 0) {
                setMtbfVal(String(Math.round(basis.totalHours / basis.failures)));
            }
            setLoadingSp(false);
        })();
    }, [asset]);

    const failureRate = 1 / parseFloat(mtbfVal);
    const result = poissonSpares(
        parseInt(population) || 1,
        failureRate,
        parseFloat(interval) || 1,
        parseFloat(confidence) || 95
    );

    // Report state changes to parent
    useEffect(() => {
        onStateChange?.(
            { population, mtbfVal, interval, confidence },
            { lambda: result.lambda, requiredSpares: result.requiredSpares, failureRate },
            asset ? { id: asset.id, tag: asset.tag, name: asset.name } : null
        );
    }, [population, mtbfVal, interval, confidence, asset]);

    return (
        <div className="space-y-4">
            {/* Asset Selector */}
            <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 shrink-0">
                    <Search size={14} className="text-blue-500" /> Asset
                </div>
                <div className="flex-1 min-w-0">
                    <AssetSelector selected={asset} onSelect={setAsset} />
                </div>
                {loadingSp && <p className="text-xs text-blue-500 flex items-center gap-1 shrink-0"><Loader2 size={12} className="animate-spin" /> Loading...</p>}
            </div>

            <div className="bg-amber-50/60 border border-amber-100 rounded-lg p-2.5">
                <p className="text-[10px] text-amber-700 flex items-center gap-1.5">
                    <Info size={12} className="shrink-0" /> Poisson-based · Assumes constant failure rate · No repair during resupply
                </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div>
                    <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-0.5">Population</label>
                    <input type="number" value={population} onChange={e => setPopulation(e.target.value)}
                        className="w-full p-2 border border-slate-200 rounded-lg text-sm h-10" />
                </div>
                <div>
                    <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-0.5">MTBF (hrs)</label>
                    <input type="number" value={mtbfVal} onChange={e => setMtbfVal(e.target.value)}
                        className="w-full p-2 border border-slate-200 rounded-lg text-sm h-10" />
                </div>
                <div>
                    <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-0.5">Resupply (hrs)</label>
                    <input type="number" value={interval} onChange={e => setInterval(e.target.value)}
                        className="w-full p-2 border border-slate-200 rounded-lg text-sm h-10" />
                </div>
                <div>
                    <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-0.5">Confidence</label>
                    <select value={confidence} onChange={e => setConfidence(e.target.value)}
                        className="w-full p-2 border border-slate-200 rounded-lg text-sm h-10">
                        <option value="90">90%</option>
                        <option value="95">95%</option>
                        <option value="99">99%</option>
                    </select>
                </div>
            </div>

            {/* Results */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                <ResultCard label="Expected (λ)" value={result.lambda.toFixed(2)} unit="failures" color="blue" />
                <ResultCard label={`Spares ${confidence}%`} value={result.requiredSpares} unit="units" color="green" />
                <ResultCard label="Fail Rate" value={(failureRate * 1000).toFixed(3)} unit="/1000h" color="red" />
            </div>

            {/* Result → Action: stock the recommendation in Inventory */}
            <div className="bg-white border border-emerald-200 rounded-xl p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-emerald-800">
                    <Package size={14} className="text-emerald-600" />
                    Turn this into stock — set an item's minimum level to {result.requiredSpares}
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                    <select value={invSel} onChange={e => setInvSel(e.target.value)}
                        className="flex-1 min-w-0 p-2 border border-slate-200 rounded-lg text-sm bg-white">
                        <option value="">— Select the spare part in Inventory —</option>
                        {invItems.map(i => (
                            <option key={i.id} value={i.id}>
                                {i.code} — {i.description.slice(0, 60)} (min: {i.minLevel})
                            </option>
                        ))}
                    </select>
                    <button
                        onClick={async () => {
                            if (!invSel) return;
                            setInvApplying(true);
                            const { error } = await supabase.from('inventory_items')
                                .update({ min_level: result.requiredSpares }).eq('id', invSel);
                            setInvApplying(false);
                            const item = invItems.find(i => i.id === invSel);
                            if (!error) {
                                setInvItems(prev => prev.map(i => i.id === invSel ? { ...i, minLevel: result.requiredSpares } : i));
                                setInvToast(`Min level set to ${result.requiredSpares} on ${item?.code} ✓`);
                            } else {
                                setInvToast('Failed to update the inventory item');
                            }
                            setTimeout(() => setInvToast(null), 4000);
                        }}
                        disabled={!invSel || invApplying}
                        className="shrink-0 flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-bold rounded-lg transition-colors"
                    >
                        {invApplying ? <Loader2 size={13} className="animate-spin" /> : <ArrowRight size={13} />}
                        Apply min level
                    </button>
                </div>
                {invToast && <p className="text-[11px] font-medium text-emerald-700">{invToast}</p>}
            </div>

            {/* Probability Table */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-3 py-2 border-b border-slate-100">
                    <h4 className="text-xs font-bold text-slate-800">Poisson Distribution</h4>
                </div>
                <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' } as any}>
                <table className="min-w-full divide-y divide-slate-100">
                    <thead className="bg-slate-50">
                        <tr>
                            <th className="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">Spares (k)</th>
                            <th className="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">P(X=k)</th>
                            <th className="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">P(X≤k) Cumulative</th>
                            <th className="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">Fill Rate</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {result.rows.map(row => (
                            <tr key={row.k} className={row.k === result.requiredSpares ? 'bg-green-50 font-medium' : 'hover:bg-slate-50'}>
                                <td className="px-4 py-2 text-sm">{row.k}</td>
                                <td className="px-4 py-2 text-sm">{(row.prob * 100).toFixed(2)}%</td>
                                <td className="px-4 py-2 text-sm">{(row.cumProb * 100).toFixed(2)}%</td>
                                <td className="px-4 py-2">
                                    <div className="flex items-center gap-2">
                                        <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
                                            <div className={`h-full rounded-full ${row.cumProb >= parseFloat(confidence) / 100 ? 'bg-green-500' : 'bg-blue-400'}`}
                                                style={{ width: `${row.cumProb * 100}%` }} />
                                        </div>
                                        <span className="text-xs text-slate-500">{(row.cumProb * 100).toFixed(1)}%</span>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                </div>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
//  TAB 5: Maintainability Analysis
// ═══════════════════════════════════════════════════════════════
export function MaintainabilityTab({ onStateChange, loadedData }: TabProps = {}) {
    const [asset, setAsset] = useState<AssetOption | null>(null);
    const [dataStr, setDataStr] = useState('0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.5, 8.0, 12.0');
    const [loading, setLoading] = useState(false);

    // Load saved analysis data
    useEffect(() => {
        if (!loadedData?.inputs) return;
        if (loadedData.inputs.dataStr) setDataStr(loadedData.inputs.dataStr);
    }, [loadedData]);

    useEffect(() => {
        if (!asset) return;
        setLoading(true);
        (async () => {
            const { data: wos } = await supabase.from('work_orders')
                .select('actual_hours')
                .eq('asset_id', asset.id)
                .not('actual_hours', 'is', null)
                .gt('actual_hours', 0);
            if (wos && wos.length > 0) {
                setDataStr(wos.map(w => parseFloat(w.actual_hours).toFixed(1)).join(', '));
            }
            setLoading(false);
        })();
    }, [asset]);

    const repairTimes = dataStr.split(/[,\s]+/).map(Number).filter(n => !isNaN(n) && n > 0);
    const mttrResult = computeMTTR(repairTimes);

    // Report state changes to parent
    useEffect(() => {
        onStateChange?.(
            { dataStr },
            { mean: mttrResult.mean, median: mttrResult.median, mmax90: mttrResult.mmax90, mmax95: mttrResult.mmax95 },
            asset ? { id: asset.id, tag: asset.tag, name: asset.name } : null
        );
    }, [dataStr, asset]);

    // Lognormal fit
    const lognormalFit = useMemo(() => {
        if (repairTimes.length < 3) return null;
        const logTimes = repairTimes.map(t => Math.log(t));
        const mu = logTimes.reduce((s, v) => s + v, 0) / logTimes.length;
        const sigma = Math.sqrt(logTimes.reduce((s, v) => s + (v - mu) ** 2, 0) / logTimes.length);
        // Generate M(t) CDF
        const sorted = [...repairTimes].sort((a, b) => a - b);
        const maxT = sorted[sorted.length - 1] * 1.5;
        const curveData: { t: number; Mt: number }[] = [];
        for (let t = 0.1; t <= maxT; t += maxT / 80) {
            const z = (Math.log(t) - mu) / sigma;
            const Mt = jStat.normal.cdf(z, 0, 1);
            curveData.push({ t: Math.round(t * 10) / 10, Mt: Math.round(Mt * 10000) / 100 });
        }
        // Percentile times
        const t50 = Math.exp(mu);
        const t90 = Math.exp(mu + sigma * jStat.normal.inv(0.90, 0, 1));
        const t95 = Math.exp(mu + sigma * jStat.normal.inv(0.95, 0, 1));
        return { mu: Math.round(mu * 100) / 100, sigma: Math.round(sigma * 100) / 100, t50, t90, t95, curveData };
    }, [dataStr]);

    return (
        <div className="space-y-6">
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                <label className="block text-sm font-medium text-blue-900 mb-2">
                    <Search size={14} className="inline mr-1" /> Auto-populate from asset actual repair hours
                </label>
                <AssetSelector selected={asset} onSelect={setAsset} />
                {loading && <p className="text-xs text-blue-500 mt-2 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Loading repair data...</p>}
            </div>

            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                    Repair Times (hours, comma-separated)
                </label>
                <textarea value={dataStr} onChange={e => setDataStr(e.target.value)}
                    className={`${CONTROL_CLS} font-mono h-20`} />
                <p className="text-xs text-slate-400 mt-1">{repairTimes.length} data points</p>
            </div>

            {repairTimes.length >= 3 && lognormalFit && (
                <>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        <ResultCard label="Mean (MTTR)" value={mttrResult.mean.toFixed(1)} unit="hrs" color="purple" />
                        <ResultCard label="Median (t₅₀)" value={lognormalFit.t50.toFixed(1)} unit="hrs" color="blue" />
                        <ResultCard label="Mmax 90%" value={lognormalFit.t90.toFixed(1)} unit="hrs" color="amber" sub="90% repairs complete" />
                        <ResultCard label="Mmax 95%" value={lognormalFit.t95.toFixed(1)} unit="hrs" color="red" sub="95% repairs complete" />
                        <ResultCard label="σ (lognormal)" value={lognormalFit.sigma} color="slate" sub="Log-space std dev" />
                    </div>

                    {/* Lognormal Parameters */}
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center">
                        <p className="text-sm text-slate-600">
                            Lognormal Distribution: μ = {lognormalFit.mu}, σ = {lognormalFit.sigma}
                        </p>
                        <p className="text-xs text-slate-400 mt-1">
                            Geometric Mean = e^μ = {Math.exp(lognormalFit.mu).toFixed(1)} hrs
                        </p>
                    </div>

                    {/* M(t) Curve */}
                    <div className="bg-white border border-slate-200 rounded-xl p-6">
                        <h4 className="text-sm font-bold text-slate-900 mb-4">Maintainability Function M(t) — Lognormal CDF</h4>
                        <ResponsiveContainer width="100%" height={300}>
                            <AreaChart data={lognormalFit.curveData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                <XAxis dataKey="t" label={{ value: 'Repair Time (hours)', position: 'insideBottom', offset: -5 }} tick={{ fontSize: 11 }} />
                                <YAxis label={{ value: 'M(t) %', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} domain={[0, 100]} />
                                <Tooltip formatter={(v: any) => `${v}%`} />
                                <Area type="monotone" dataKey="Mt" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.15} name="M(t) - Probability of repair" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </>
            )}

            {repairTimes.length < 3 && (
                <div className="text-center py-12 text-slate-400">
                    <Wrench size={40} className="mx-auto mb-3 text-slate-300" />
                    <p className="text-sm">Enter at least 3 repair times for maintainability analysis</p>
                </div>
            )}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
//  UNIFIED RAM DASHBOARD — Reliability, Availability, Maintainability
// ═══════════════════════════════════════════════════════════════

function RAMSectionHeader({ icon, title, subtitle, expanded, onToggle, accentColor = 'blue' }: {
    icon: React.ReactNode; title: string; subtitle: string;
    expanded: boolean; onToggle: () => void; accentColor?: string;
}) {
    return (
        <button onClick={onToggle}
            className={`w-full flex items-center gap-3 px-5 py-3.5 rounded-xl transition-all group ${
                expanded
                    ? `bg-${accentColor}-50 border-2 border-${accentColor}-200 shadow-sm`
                    : 'bg-white border-2 border-slate-100 hover:border-slate-200 hover:shadow-sm'
            }`}>
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                expanded ? `bg-${accentColor}-100 text-${accentColor}-600` : 'bg-slate-100 text-slate-400 group-hover:bg-slate-200'
            }`}>
                {icon}
            </div>
            <div className="flex-1 text-left">
                <p className={`text-base font-bold ${expanded ? `text-${accentColor}-800` : 'text-slate-700'}`}>{title}</p>
                <p className={`text-xs ${expanded ? `text-${accentColor}-500` : 'text-slate-400'}`}>{subtitle}</p>
            </div>
            <div className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                expanded ? `bg-${accentColor}-100 text-${accentColor}-600` : 'bg-slate-100 text-slate-400'
            }`}>
                {expanded ? '▼' : '▶'}
            </div>
        </button>
    );
}

export function RAMDashboardTab({ onStateChange, loadedData, onSendToSpares }: TabProps = {}) {
    // ─── Shared state ─────────────────────────────────────────
    const [asset, setAsset] = useState<AssetOption | null>(null);
    const [loading, setLoading] = useState(false);

    // ─── Reliability (R) inputs ───────────────────────────────
    const [totalHours, setTotalHours] = useState('');
    const [failures, setFailures] = useState('');
    const [confidence, setConfidence] = useState(90);

    // ─── Maintainability (M) inputs ───────────────────────────
    const [repairTimesStr, setRepairTimesStr] = useState('');

    // ─── Availability (A) inputs ──────────────────────────────
    const [mldt, setMldt] = useState('');
    const [targetAo, setTargetAo] = useState('95');

    // ─── Load saved analysis data ─────────────────────────────
    useEffect(() => {
        if (!loadedData?.inputs) return;
        const { inputs } = loadedData;
        if (inputs.totalHours) setTotalHours(String(inputs.totalHours));
        if (inputs.failures) setFailures(String(inputs.failures));
        if (inputs.confidence) setConfidence(inputs.confidence);
        if (inputs.repairTimesStr) setRepairTimesStr(inputs.repairTimesStr);
        if (inputs.mldt) setMldt(String(inputs.mldt));
        if (inputs.targetAo) setTargetAo(String(inputs.targetAo));
    }, [loadedData]);

    // ─── Auto-populate from WO data (M1: via the shared reliability engine) ───
    // Fetches the asset's WOs and derives failures / MTBF basis / repair times from
    // computeAssetReliability — the SAME engine the Metrics scoreboard uses — so the
    // per-asset RAM numbers reconcile with the fleet numbers instead of diverging.
    useEffect(() => {
        if (!asset) return;
        setLoading(true);
        (async () => {
            const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString();
            // All WO types in-window; the shared engine decides what counts as a failure
            // (corrective OR a coded failure mode), matching the Metrics definition.
            const { data: wos } = await supabase.from('work_orders')
                .select('id, type, status, created_at, closed_at, actual_hours, actual_downtime_hrs, actual_duration, wo_failure_data(failure_mode_code)')
                .eq('asset_id', asset.id)
                .gte('created_at', yearAgo)
                .order('created_at');

            if (wos && wos.length > 0) {
                const rel = computeAssetReliability(wos);
                const n = rel.failures12mo || rel.totalFailures;
                if (n > 0) {
                    setFailures(String(n));
                    // Operating time chosen so RAM MTBF (= totalHours/failures) equals the
                    // shared engine's inter-arrival MTBF; the χ² CI then forms around it.
                    // Falls back to a calendar year when MTBF can't be derived (<2 failures).
                    setTotalHours(rel.mtbfDays != null ? String(Math.round(rel.mtbfDays * 24 * n)) : '8760');
                }
                // Repair times = same failure set + downtime basis as the engine's MTTR.
                const repairs = failureRepairHours(wos);
                if (repairs.length > 0) {
                    setRepairTimesStr(repairs.map(r => r.toFixed(1)).join(', '));
                }
            }

            setLoading(false);
        })();
    }, [asset]);

    // ─── Computed values ──────────────────────────────────────
    const repairTimes = repairTimesStr.split(/[,\s]+/).map(Number).filter(n => !isNaN(n) && n > 0);
    const mtbfResult = computeMTBFWithConfidence(parseFloat(totalHours) || 0, parseInt(failures) || 0, confidence);
    const mttrResult = computeMTTR(repairTimes);

    // ─── Empty-state guards ───────────────────────────────────
    const hasReliabilityData = !!totalHours && !!failures && parseFloat(totalHours) > 0 && parseInt(failures) > 0;
    const hasMaintainabilityData = repairTimes.length > 0;

    // Availability auto-calculated from R + M
    const mrt = mttrResult.mean + (parseFloat(mldt) || 0);
    const ao = mtbfResult.mtbf > 0 && mtbfResult.mtbf < Infinity
        ? mtbfResult.mtbf / (mtbfResult.mtbf + mrt) : 0;
    const aoPercent = (ao * 100).toFixed(2);
    const aoColor = ao >= 0.95 ? 'green' : ao >= 0.90 ? 'amber' : 'red';

    // MTTR distribution chart data
    const mttrChartData = repairTimes.length > 0
        ? [...repairTimes].sort((a, b) => a - b).map((t, i) => ({
            time: t,
            Mt: Math.round((1 - Math.exp(-t / mttrResult.mean)) * 100),
            rank: Math.round(((i + 1) / repairTimes.length) * 100)
        }))
        : [];

    // Lognormal fit for maintainability
    const lognormalFit = useMemo(() => {
        if (repairTimes.length < 3) return null;
        const logTimes = repairTimes.map(t => Math.log(t));
        const mu = logTimes.reduce((s, v) => s + v, 0) / logTimes.length;
        const sigma = Math.sqrt(logTimes.reduce((s, v) => s + (v - mu) ** 2, 0) / logTimes.length);
        const sorted = [...repairTimes].sort((a, b) => a - b);
        const maxT = sorted[sorted.length - 1] * 1.5;
        const curveData: { t: number; Mt: number }[] = [];
        for (let t = 0.1; t <= maxT; t += maxT / 80) {
            const z = (Math.log(t) - mu) / sigma;
            const Mt = jStat.normal.cdf(z, 0, 1);
            curveData.push({ t: Math.round(t * 10) / 10, Mt: Math.round(Mt * 10000) / 100 });
        }
        const t50 = Math.exp(mu);
        const t90 = Math.exp(mu + sigma * jStat.normal.inv(0.90, 0, 1));
        const t95 = Math.exp(mu + sigma * jStat.normal.inv(0.95, 0, 1));
        return { mu: Math.round(mu * 100) / 100, sigma: Math.round(sigma * 100) / 100, t50, t90, t95, curveData };
    }, [repairTimesStr]);

    // Ao trade-off data
    const tradeoffData = useMemo(() => {
        const target = parseFloat(targetAo) / 100;
        const data: { mrt: number; mtbfReq: number }[] = [];
        for (let m = 1; m <= 100; m += 2) {
            const mtbfReq = (target * m) / (1 - target);
            if (mtbfReq < 50000) data.push({ mrt: m, mtbfReq: Math.round(mtbfReq) });
        }
        return data;
    }, [targetAo]);

    // Report state changes to parent
    useEffect(() => {
        onStateChange?.({
            totalHours, failures, repairTimesStr, confidence, mldt, targetAo
        }, {
            mtbf: mtbfResult.mtbf, lower: mtbfResult.lower, upper: mtbfResult.upper,
            mttr: mttrResult.mean, mttrMedian: mttrResult.median,
            ao: aoPercent, mrt, annualDowntime: ((1 - ao) * 8760).toFixed(0)
        }, asset ? { id: asset.id, tag: asset.tag, name: asset.name } : null);
    }, [totalHours, failures, repairTimesStr, confidence, mldt, targetAo, asset]);

    // Mobile section switcher
    const [mobileSection, setMobileSection] = useState<'R' | 'M' | 'A'>('R');
    const [showCharts, setShowCharts] = useState(false);

    return (
        <div className="space-y-4">
            {/* ─── Critical Assets Quick-Launch ─────────────────── */}
            <CriticalAssetsPanel onSelectAsset={(a) => setAsset(a)} />

            {/* ─── Shared Asset Selector ───────────────────────── */}
            <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 shrink-0">
                    <Search size={14} className="text-blue-500" /> Asset
                </div>
                <div className="flex-1 min-w-0">
                    <AssetSelector selected={asset} onSelect={setAsset} />
                </div>
                {loading && <p className="text-xs text-blue-500 flex items-center gap-1 shrink-0"><Loader2 size={12} className="animate-spin" /> Loading...</p>}
            </div>

            {/* ─── Mobile Pill Tabs (visible only on small screens) ─── */}
            <div className="flex lg:hidden gap-1 bg-slate-100 p-1 rounded-xl">
                {(['R', 'M', 'A'] as const).map(s => (
                    <button key={s} onClick={() => setMobileSection(s)}
                        className={`flex-1 py-2.5 text-xs font-bold rounded-lg transition-all ${
                            mobileSection === s
                                ? s === 'R' ? 'bg-blue-500 text-white shadow-md' : s === 'M' ? 'bg-purple-500 text-white shadow-md' : 'bg-green-500 text-white shadow-md'
                                : 'text-slate-500 hover:bg-white/60'
                        }`}>
                        {s === 'R' ? '🎯 Reliability' : s === 'M' ? '🔧 Maintain.' : '⚡ Availability'}
                    </button>
                ))}
            </div>

            {/* ═══════════ 3-COLUMN RAM GRID ═══════════ */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">

                {/* ─── COLUMN 1: RELIABILITY (R) ─── */}
                <div className={`bg-white border border-slate-200 rounded-xl overflow-hidden ${mobileSection !== 'R' ? 'hidden lg:block' : ''}`}>
                    <div className="h-1 bg-gradient-to-r from-blue-400 to-blue-600" />
                    <div className="p-3 space-y-3">
                        <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
                                <Activity size={14} className="text-blue-600" />
                            </div>
                            <div>
                                <p className="text-xs font-bold text-slate-800">Reliability (R)</p>
                                <p className="text-[10px] text-slate-400">MTBF & failure rate</p>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div>
                                <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-0.5">Operating Hours</label>
                                <input type="number" value={totalHours} onChange={e => setTotalHours(e.target.value)} placeholder="e.g. 8760"
                                    className="w-full p-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500 h-10" />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-0.5">Failures</label>
                                    <input type="number" value={failures} onChange={e => setFailures(e.target.value)} placeholder="0"
                                        className="w-full p-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500 h-10" />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-0.5">Confidence</label>
                                    <select value={confidence} onChange={e => setConfidence(Number(e.target.value))}
                                        className="w-full p-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500 h-10">
                                        <option value={60}>60%</option><option value={80}>80%</option><option value={90}>90%</option><option value={95}>95%</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* R Results */}
                        {hasReliabilityData ? (
                            <div className="grid grid-cols-2 gap-2">
                                <ResultCard label="MTBF" value={mtbfResult.mtbf === Infinity ? '∞' : mtbfResult.mtbf.toFixed(0)} unit="hrs" color="blue" />
                                <ResultCard label="λ (Fail Rate)" value={mtbfResult.mtbf > 0 && mtbfResult.mtbf < Infinity ? (1 / mtbfResult.mtbf * 1000).toFixed(3) : '0'} unit="/1000h" color="red" />
                                <ResultCard label={`Lower ${confidence}%`} value={mtbfResult.lower.toFixed(0)} unit="hrs" color="amber" />
                                <ResultCard label={`Upper ${confidence}%`} value={mtbfResult.upper === Infinity ? '∞' : mtbfResult.upper.toFixed(0)} unit="hrs" color="green" />
                            </div>
                        ) : (
                            <div className="text-center py-3 bg-blue-50/50 border border-dashed border-blue-200/60 rounded-lg">
                                <p className="text-[10px] text-blue-400">Enter hours & failures to calculate MTBF</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* ─── COLUMN 2: MAINTAINABILITY (M) ─── */}
                <div className={`bg-white border border-slate-200 rounded-xl overflow-hidden ${mobileSection !== 'M' ? 'hidden lg:block' : ''}`}>
                    <div className="h-1 bg-gradient-to-r from-purple-400 to-purple-600" />
                    <div className="p-3 space-y-3">
                        <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-purple-50 flex items-center justify-center">
                                <Wrench size={14} className="text-purple-600" />
                            </div>
                            <div>
                                <p className="text-xs font-bold text-slate-800">Maintainability (M)</p>
                                <p className="text-[10px] text-slate-400">MTTR & repair distribution</p>
                            </div>
                        </div>

                        <div>
                            <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-0.5">Repair Times (hrs, comma-sep)</label>
                            <textarea value={repairTimesStr} onChange={e => setRepairTimesStr(e.target.value)} placeholder="2.5, 4, 1.5, 6, 3"
                                className="w-full p-2 border border-slate-200 rounded-lg text-xs font-mono h-12 focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 resize-none" />
                            <p className="text-[10px] text-slate-400 mt-0.5">{repairTimes.length} data points</p>
                        </div>

                        {/* M Results */}
                        {hasMaintainabilityData ? (
                            <div className="space-y-2">
                                <div className="grid grid-cols-2 gap-2">
                                    <ResultCard label="MTTR" value={mttrResult.mean.toFixed(1)} unit="hrs" color="purple" />
                                    <ResultCard label="Median" value={mttrResult.median.toFixed(1)} unit="hrs" color="purple" />
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                    <ResultCard label="σ" value={mttrResult.stdDev.toFixed(1)} unit="hrs" color="slate" />
                                    <ResultCard label="Mmax90" value={mttrResult.mmax90.toFixed(1)} unit="hrs" color="amber" />
                                    <ResultCard label="Mmax95" value={mttrResult.mmax95.toFixed(1)} unit="hrs" color="red" />
                                </div>
                                {lognormalFit && (
                                    <div className="bg-purple-50/50 border border-purple-100 rounded-lg p-2">
                                        <p className="text-[10px] text-purple-600 font-medium">Lognormal: μ={lognormalFit.mu} σ={lognormalFit.sigma}</p>
                                        <p className="text-[10px] text-purple-400">t₅₀={lognormalFit.t50.toFixed(1)}h · t₉₀={lognormalFit.t90.toFixed(1)}h · t₉₅={lognormalFit.t95.toFixed(1)}h</p>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="text-center py-3 bg-purple-50/50 border border-dashed border-purple-200/60 rounded-lg">
                                <p className="text-[10px] text-purple-400">Enter repair times to calculate MTTR</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* ─── COLUMN 3: AVAILABILITY (A) ─── */}
                <div className={`bg-white border border-slate-200 rounded-xl overflow-hidden ${mobileSection !== 'A' ? 'hidden lg:block' : ''}`}>
                    <div className={`h-1 ${ao >= 0.95 ? 'bg-gradient-to-r from-green-400 to-emerald-500' : ao >= 0.90 ? 'bg-gradient-to-r from-amber-400 to-yellow-500' : 'bg-gradient-to-r from-red-400 to-rose-500'}`} />
                    <div className="p-3 space-y-3">
                        <div className="flex items-center gap-2">
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${ao >= 0.95 ? 'bg-green-50' : ao >= 0.90 ? 'bg-amber-50' : 'bg-red-50'}`}>
                                <Gauge size={14} className={ao >= 0.95 ? 'text-green-600' : ao >= 0.90 ? 'text-amber-600' : 'text-red-600'} />
                            </div>
                            <div>
                                <p className="text-xs font-bold text-slate-800">Availability (A)</p>
                                <p className="text-[10px] text-slate-400">Ao auto-calculated from R + M</p>
                            </div>
                        </div>

                        {(hasReliabilityData || hasMaintainabilityData) ? (
                            <div className="space-y-2">
                                {/* Source metrics */}
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="bg-blue-50/60 border border-blue-100 rounded-lg p-2">
                                        <p className="text-[9px] text-blue-500 font-bold uppercase">From R</p>
                                        <p className="text-sm font-bold text-blue-700">{mtbfResult.mtbf === Infinity ? '∞' : mtbfResult.mtbf.toFixed(0)}h</p>
                                    </div>
                                    <div className="bg-purple-50/60 border border-purple-100 rounded-lg p-2">
                                        <p className="text-[9px] text-purple-500 font-bold uppercase">From M</p>
                                        <p className="text-sm font-bold text-purple-700">{mttrResult.mean.toFixed(1)}h</p>
                                    </div>
                                </div>
                                {/* User inputs */}
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-0.5">MLDT (hrs)</label>
                                        <input type="number" value={mldt} onChange={e => setMldt(e.target.value)} placeholder="0"
                                            className="w-full p-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-green-500/20 focus:border-green-500 h-10" />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-0.5">Target Ao%</label>
                                        <input type="number" value={targetAo} onChange={e => setTargetAo(e.target.value)}
                                            className="w-full p-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-green-500/20 focus:border-green-500 h-10" />
                                    </div>
                                </div>
                                {/* Ao Result — prominent */}
                                <div className={`p-3 rounded-xl text-center ${ao >= 0.95 ? 'bg-green-50 border border-green-200' : ao >= 0.90 ? 'bg-amber-50 border border-amber-200' : 'bg-red-50 border border-red-200'}`}>
                                    <p className={`text-2xl font-black ${ao >= 0.95 ? 'text-green-700' : ao >= 0.90 ? 'text-amber-700' : 'text-red-700'}`}>{aoPercent}%</p>
                                    <p className={`text-[10px] font-medium ${ao >= 0.95 ? 'text-green-500' : ao >= 0.90 ? 'text-amber-500' : 'text-red-500'}`}>
                                        {ao >= 0.95 ? '✅ World-class' : ao >= 0.90 ? '⚠️ Below target' : '🔴 Critical'}
                                    </p>
                                </div>
                                {/* Downtime/Uptime */}
                                <div className="grid grid-cols-2 gap-2">
                                    <ResultCard label="Downtime" value={((1 - ao) * 8760).toFixed(0)} unit="hrs/yr" color="red" />
                                    <ResultCard label="Uptime" value={(ao * 8760).toFixed(0)} unit="hrs/yr" color="green" />
                                </div>
                            </div>
                        ) : (
                            <div className="text-center py-3 bg-green-50/50 border border-dashed border-green-200/60 rounded-lg">
                                <p className="text-[10px] text-green-400">Enter R & M data — Ao auto-calculates</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* ═══════════ FORMULA BAR (compact) ═══════════ */}
            {(hasReliabilityData || hasMaintainabilityData) && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-center overflow-x-auto">
                    <p className="text-[11px] text-slate-500 font-mono whitespace-nowrap">
                        Ao = MTBF / (MTBF + MRT) = {mtbfResult.mtbf === Infinity ? '∞' : mtbfResult.mtbf.toFixed(0)} / ({mtbfResult.mtbf === Infinity ? '∞' : mtbfResult.mtbf.toFixed(0)} + {mrt.toFixed(1)})
                    </p>
                </div>
            )}

            {/* ═══════════ BRIDGE TO SPARES ═══════════ */}
            {onSendToSpares && mtbfResult.mtbf > 0 && mtbfResult.mtbf < Infinity && (
                <div className="flex items-center flex-wrap gap-2 p-2.5 bg-gradient-to-r from-primary-50 to-primary-50 border border-primary-200 rounded-xl">
                    <div className="text-[11px] text-primary-700 flex-1 min-w-0">
                        <span className="font-semibold">Next:</span> Use MTBF ({Math.round(mtbfResult.mtbf).toLocaleString()}h) for spares analysis
                    </div>
                    <button onClick={() => onSendToSpares(mtbfResult.mtbf)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-primary-500 to-primary-500 text-white text-xs font-medium rounded-lg shadow-sm hover:shadow-md transition-all shrink-0 ml-3">
                        📦 Spares →
                    </button>
                </div>
            )}

            {/* ═══════════ COLLAPSIBLE CHARTS ═══════════ */}
            {(lognormalFit || (mttrChartData.length > 2) || (hasReliabilityData && hasMaintainabilityData)) && (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <button onClick={() => setShowCharts(!showCharts)}
                        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-50 transition-colors">
                        <span className="text-xs font-semibold text-slate-700 flex items-center gap-2">
                            <BarChart2 size={14} className="text-slate-400" />
                            📊 Charts & Analysis
                        </span>
                        <span className="text-[10px] text-slate-400">{showCharts ? '▲ Collapse' : '▼ Expand'}</span>
                    </button>
                    {showCharts && (
                        <div className="border-t border-slate-100 p-4 space-y-4 animate-in slide-in-from-top-2 duration-200">
                            {/* M(t) Lognormal CDF */}
                            {lognormalFit && (
                                <div>
                                    <h4 className="text-xs font-bold text-slate-800 mb-3">Maintainability Function M(t) — Lognormal CDF</h4>
                                    <ResponsiveContainer width="100%" height={200}>
                                        <AreaChart data={lognormalFit.curveData}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                            <XAxis dataKey="t" label={{ value: 'Repair Time (hrs)', position: 'insideBottom', offset: -5 }} tick={{ fontSize: 10 }} />
                                            <YAxis label={{ value: 'M(t) %', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 10 }} domain={[0, 100]} />
                                            <Tooltip formatter={(v: any) => `${v}%`} />
                                            <Area type="monotone" dataKey="Mt" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.15} name="M(t)" />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                            {/* Empirical CDF fallback */}
                            {mttrChartData.length > 2 && !lognormalFit && (
                                <div>
                                    <h4 className="text-xs font-bold text-slate-800 mb-3">Repair Time CDF — Exponential</h4>
                                    <ResponsiveContainer width="100%" height={180}>
                                        <LineChart data={mttrChartData}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                            <XAxis dataKey="time" label={{ value: 'Repair Time (hrs)', position: 'insideBottom', offset: -5 }} tick={{ fontSize: 10 }} />
                                            <YAxis label={{ value: 'M(t) %', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 10 }} domain={[0, 100]} />
                                            <Tooltip formatter={(v: any) => `${v}%`} />
                                            <Legend />
                                            <Line type="monotone" dataKey="Mt" stroke="#8b5cf6" strokeWidth={2} name="Exponential M(t)" dot={false} />
                                            <Line type="stepAfter" dataKey="rank" stroke="#3b82f6" strokeWidth={1} strokeDasharray="4 4" name="Empirical CDF" dot={{ r: 3, fill: '#3b82f6' }} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                            {/* Ao Trade-off */}
                            {hasReliabilityData && hasMaintainabilityData && (
                                <div>
                                    <h4 className="text-xs font-bold text-slate-800 mb-3">
                                        MTBF vs MRT Trade-off for Ao = {targetAo}%
                                    </h4>
                                    <ResponsiveContainer width="100%" height={200}>
                                        <AreaChart data={tradeoffData}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                            <XAxis dataKey="mrt" label={{ value: 'MRT (hours)', position: 'insideBottom', offset: -5 }} tick={{ fontSize: 10 }} />
                                            <YAxis label={{ value: 'Required MTBF (hrs)', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 10 }} />
                                            <Tooltip formatter={(v: any) => `${v} hrs`} />
                                            <Area type="monotone" dataKey="mtbfReq" stroke="#22c55e" fill="#22c55e" fillOpacity={0.1} name="Required MTBF" />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* ═══════════ CONTEXTUAL ACTIONS ═══════════ */}
            {hasReliabilityData && (
                <ContextualActions
                    mtbf={mtbfResult.mtbf !== Infinity ? mtbfResult.mtbf : undefined}
                    ao={ao > 0 ? ao : undefined}
                    asset={asset}
                />
            )}

            {/* ═══════════ USE CASES & WORKFLOWS ═══════════ */}
            <UseCasesPanel />
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
//  MAIN PAGE
// ═══════════════════════════════════════════════════════════════
export const ReliabilityToolkit: React.FC = () => {
    const [activeTab, setActiveTab] = useState<TabId>('mtbf');
    const [showHelp, setShowHelp] = useState(false);
    const activeTabDef = TABS.find(t => t.id === activeTab);

    // ── Weibull → Monte Carlo bridge state ──
    const [weibullBridge, setWeibullBridge] = useState<{ beta: number; eta: number; dataStr?: string } | null>(null);

    const handleWeibullStateChange = useCallback((
        inputs: Record<string, any>,
        results: Record<string, any>,
        _asset?: { id: string; tag: string; name: string } | null
    ) => {
        if (results?.beta && results?.eta) {
            setWeibullBridge({ beta: results.beta, eta: results.eta, dataStr: inputs?.dataStr });
        }
    }, []);

    return (
        <div className="space-y-5">
            {/* ── Page Header — gradient accent bar (matches Reliability Modelling) ── */}
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-3">
                <div>
                    <div className="flex items-center gap-2.5">
                        <div className="w-1.5 h-8 rounded-full bg-gradient-to-b from-primary-500 to-primary-700" />
                        <h1 className="text-xl sm:text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
                            <Calculator size={22} className="text-primary-600" /> Reliability Engineering Toolkit
                        </h1>
                    </div>
                    <p className="text-slate-500 text-xs sm:text-sm mt-1.5 ml-4">
                        Interactive calculators with auto-population from ERS work order data · ISO 14224 · MIL-HDBK-338
                    </p>
                </div>
            </div>

            {/* ── Tabs + inline help popover ── */}
            <div className="flex items-center gap-2">
                <ScrollTabStrip
                    activeId={activeTab}
                    className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 shadow-sm flex-1"
                >
                    {TABS.map(tab => (
                        <button
                            key={tab.id}
                            data-active={activeTab === tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            title={tab.desc}
                            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap shrink-0 ${activeTab === tab.id
                                ? 'bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-sm shadow-primary-500/20'
                                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                                }`}
                        >
                            <span className={activeTab === tab.id ? 'text-white/90' : 'text-slate-400'}>{tab.icon}</span>
                            <span>{tab.label}</span>
                        </button>
                    ))}
                </ScrollTabStrip>

                {/* Compact help — popover replaces the old full-width description box */}
                <div className="relative shrink-0">
                    <button
                        onClick={() => setShowHelp(s => !s)}
                        className={`flex items-center justify-center w-9 h-9 rounded-lg border transition-colors ${showHelp
                            ? 'bg-primary-50 border-primary-200 text-primary-600'
                            : 'bg-white border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                            }`}
                        title="About this calculator"
                        aria-label="About this calculator"
                    >
                        <HelpCircle size={18} />
                    </button>
                    {showHelp && (
                        <>
                            <div className="fixed inset-0 z-40" onClick={() => setShowHelp(false)} />
                            <div className="absolute right-0 top-full mt-2 w-72 z-50 bg-white border border-slate-200 rounded-xl shadow-xl p-4 animate-in fade-in slide-in-from-top-1 duration-150">
                                <div className="flex items-center gap-2 mb-1.5">
                                    <span className="text-primary-600">{activeTabDef?.icon}</span>
                                    <h4 className="text-sm font-bold text-slate-800">{activeTabDef?.label}</h4>
                                </div>
                                <p className="text-xs text-slate-500 leading-relaxed">{activeTabDef?.desc}</p>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Active Tab Content */}
            {activeTab === 'mtbf' && <MTBFTab />}
            {activeTab === 'availability' && <AvailabilityTab />}
            {activeTab === 'weibull' && <WeibullTab onStateChange={handleWeibullStateChange} />}
            {activeTab === 'spares' && <SparesTab />}
            {activeTab === 'maintainability' && <MaintainabilityTab />}
            {activeTab === 'montecarlo' && <MonteCarloSimTab bridgeData={weibullBridge} />}
        </div>
    );
};
