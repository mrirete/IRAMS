import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
// @ts-ignore
import * as jStat from 'jstat';
import { MonteCarloSimTab } from '../components/MonteCarloSimTab';
import BathtubCurve from '../../components/reliability/BathtubCurve';
import { CreatePMFromWeibullModal, type WeibullPMData } from '../../components/analyze/CreatePMFromWeibullModal';

// ─── Corrective WO type codes (dictionary-aligned) ──────────
const CORRECTIVE_WO_TYPES = ['CM', 'EM'];

/* ╔══════════════════════════════════════════════════════════════╗
   ║  RELIABILITY ENGINEERING TOOLKIT                             ║
   ║  5 calculators: MTBF/MTTR, Ao, Weibull, Spares, Maintain.   ║
   ╚══════════════════════════════════════════════════════════════╝ */

// ─── Types ───────────────────────────────────────────────────
interface AssetOption { id: string; name: string; tag: string; criticality: string; }

export interface TabProps {
    onStateChange?: (inputs: Record<string, any>, results: Record<string, any>, asset?: { id: string; tag: string; name: string } | null) => void;
    loadedData?: { inputs: Record<string, any>; results: Record<string, any> } | null;
    /** P2.2: Bridge from RAM → Spares Demand — push MTBF to spares calculator */
    onSendToSpares?: (mtbf: number) => void;
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

// Weibull MRR (Median Rank Regression)
function weibullFit(failureTimes: number[]) {
    const n = failureTimes.length;
    if (n < 2) return { beta: 1, eta: 1, r2: 0, plotData: [] };
    const sorted = [...failureTimes].sort((a, b) => a - b);

    // Bernard's median rank: (i - 0.3) / (n + 0.4)
    const ranks = sorted.map((t, i) => {
        const F = (i + 1 - 0.3) / (n + 0.4);
        return { t, F, x: Math.log(t), y: Math.log(Math.log(1 / (1 - F))) };
    });

    // Linear regression: y = beta*x - beta*ln(eta)
    const xMean = ranks.reduce((s, r) => s + r.x, 0) / n;
    const yMean = ranks.reduce((s, r) => s + r.y, 0) / n;
    const sxy = ranks.reduce((s, r) => s + (r.x - xMean) * (r.y - yMean), 0);
    const sxx = ranks.reduce((s, r) => s + (r.x - xMean) ** 2, 0);
    const beta = sxy / sxx;
    const intercept = yMean - beta * xMean;
    const eta = Math.exp(-intercept / beta);

    // R² goodness of fit
    const ssRes = ranks.reduce((s, r) => s + (r.y - (beta * r.x + intercept)) ** 2, 0);
    const ssTot = ranks.reduce((s, r) => s + (r.y - yMean) ** 2, 0);
    const r2 = 1 - ssRes / ssTot;

    // Generate plot data (CDF)
    const plotData: { t: number; reliability: number; failure: number }[] = [];
    const maxT = sorted[n - 1] * 1.5;
    for (let t = 1; t <= maxT; t += maxT / 100) {
        const F = 1 - Math.exp(-Math.pow(t / eta, beta));
        plotData.push({ t: Math.round(t), reliability: Math.round((1 - F) * 10000) / 100, failure: Math.round(F * 10000) / 100 });
    }

    return { beta: Math.round(beta * 100) / 100, eta: Math.round(eta), r2: Math.round(r2 * 1000) / 1000, plotData, ranks };
}

function weibullBLife(beta: number, eta: number, pct: number) {
    return eta * Math.pow(-Math.log(1 - pct / 100), 1 / beta);
}

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

                for (const asset of critAssets) {
                    const { count, data: wos } = await supabase.from('work_orders')
                        .select('created_at', { count: 'exact', head: false })
                        .eq('asset_id', asset.id)
                        .in('type', CORRECTIVE_WO_TYPES)
                        .gte('created_at', yearAgo)
                        .order('created_at', { ascending: false })
                        .limit(1);

                    if ((count || 0) > 0) {
                        const parent = asset.parent as any;
                        results.push({
                            id: asset.id,
                            name: asset.name || '(Unnamed)',
                            tag: asset.tag || 'N/A',
                            criticality: asset.criticality || 'B',
                            hierarchyLevel: asset.hierarchy_level || 'EQUIPMENT',
                            parentName: parent?.name || parent?.tag || '—',
                            failureCount: count || 0,
                            lastFailure: wos?.[0]?.created_at || null,
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
        <div className="bg-gradient-to-r from-indigo-50 via-blue-50 to-cyan-50 border border-indigo-200/60 rounded-xl overflow-hidden">
            <button onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/30 transition-colors">
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
                        <BookOpen size={16} className="text-indigo-600" />
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
                                <div className="text-indigo-500">{uc.icon}</div>
                                <p className="text-xs font-bold text-slate-800">{uc.title}</p>
                            </div>
                            <p className="text-[11px] text-slate-600 leading-relaxed">{uc.desc}</p>
                            <p className="text-[9px] text-indigo-500 font-semibold mt-2 uppercase tracking-wider">→ {uc.who}</p>
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

    // Auto-populate from WO data
    useEffect(() => {
        if (!asset) return;
        setLoading(true);
        (async () => {
            const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString();
            // Get corrective WOs
            const { data: wos } = await supabase.from('work_orders')
                .select('id, created_at, actual_hours, status')
                .eq('asset_id', asset.id)
                .in('type', CORRECTIVE_WO_TYPES)
                .gte('created_at', yearAgo)
                .order('created_at');

            if (wos && wos.length > 0) {
                setFailures(String(wos.length));
                setTotalHours('8760'); // 1 year
                const repairs = wos.map(w => parseFloat(w.actual_hours) || 0).filter(h => h > 0);
                if (repairs.length > 0) setRepairTimesStr(repairs.join(', '));
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
                        className="w-full p-2 border border-slate-300 rounded-lg text-sm" />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Number of Failures</label>
                    <input type="number" value={failures} onChange={e => setFailures(e.target.value)}
                        className="w-full p-2 border border-slate-300 rounded-lg text-sm" />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Confidence Level (%)</label>
                    <select value={confidence} onChange={e => setConfidence(Number(e.target.value))}
                        className="w-full p-2 border border-slate-300 rounded-lg text-sm">
                        <option value={60}>60%</option>
                        <option value={80}>80%</option>
                        <option value={90}>90%</option>
                        <option value={95}>95%</option>
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Repair Times (hours, comma-sep)</label>
                    <input type="text" value={repairTimesStr} onChange={e => setRepairTimesStr(e.target.value)}
                        className="w-full p-2 border border-slate-300 rounded-lg text-sm" placeholder="4, 6, 8, 2" />
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
                <h4 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2"><Wrench size={16} className="text-purple-600" /> MTTR Results</h4>
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

    // Auto-populate from WO data
    useEffect(() => {
        if (!asset) return;
        setLoading(true);
        (async () => {
            const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString();
            const { data: wos } = await supabase.from('work_orders')
                .select('id, created_at, actual_hours, status')
                .eq('asset_id', asset.id)
                .in('type', CORRECTIVE_WO_TYPES)
                .gte('created_at', yearAgo)
                .order('created_at');
            if (wos && wos.length > 0) {
                const calcMtbf = 8760 / wos.length;
                setMtbf(calcMtbf.toFixed(0));
                const repairs = wos.map(w => parseFloat(w.actual_hours) || 0).filter(h => h > 0);
                if (repairs.length > 0) {
                    const calcMttr = repairs.reduce((s, v) => s + v, 0) / repairs.length;
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
                        className="w-full p-2 border border-slate-300 rounded-lg text-sm" />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">MTTR (hours)</label>
                    <input type="number" value={mttr} onChange={e => setMttr(e.target.value)}
                        className="w-full p-2 border border-slate-300 rounded-lg text-sm" />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">MLDT (hours)</label>
                    <input type="number" value={mldt} onChange={e => setMldt(e.target.value)}
                        className="w-full p-2 border border-slate-300 rounded-lg text-sm" />
                    <p className="text-[10px] text-slate-400 mt-0.5">Mean logistics delay time</p>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Target Ao (%)</label>
                    <input type="number" value={targetAo} onChange={e => setTargetAo(e.target.value)}
                        className="w-full p-2 border border-slate-300 rounded-lg text-sm" />
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
export function WeibullTab({ onStateChange, loadedData }: TabProps = {}) {
    const [asset, setAsset] = useState<AssetOption | null>(null);
    const [dataStr, setDataStr] = useState('20, 42, 55, 73, 95, 101, 118, 139');
    const [loading, setLoading] = useState(false);
    const [showRtFt, setShowRtFt] = useState(false);
    const [showPMModal, setShowPMModal] = useState(false);

    // Load saved analysis data
    useEffect(() => {
        if (!loadedData?.inputs) return;
        if (loadedData.inputs.dataStr) setDataStr(loadedData.inputs.dataStr);
    }, [loadedData]);

    useEffect(() => {
        if (!asset) return;
        setLoading(true);
        (async () => {
            // Pull failure intervals from WOs
            const { data: wos } = await supabase.from('work_orders')
                .select('created_at')
                .eq('asset_id', asset.id)
                .in('type', CORRECTIVE_WO_TYPES)
                .order('created_at');
            if (wos && wos.length >= 2) {
                const times: number[] = [];
                for (let i = 1; i < wos.length; i++) {
                    const diff = (new Date(wos[i].created_at).getTime() - new Date(wos[i - 1].created_at).getTime()) / 3600000;
                    if (diff > 0) times.push(Math.round(diff));
                }
                if (times.length > 0) setDataStr(times.join(', '));
            }
            setLoading(false);
        })();
    }, [asset]);

    const failureTimes = dataStr.split(/[,\s]+/).map(Number).filter(n => !isNaN(n) && n > 0);
    const fit = failureTimes.length >= 2 ? weibullFit(failureTimes) : null;

    // Report state changes to parent (bridge to Monte Carlo)
    useEffect(() => {
        onStateChange?.(
            { dataStr },
            fit ? { beta: fit.beta, eta: fit.eta, r2: fit.r2, b10: Math.round(weibullBLife(fit.beta, fit.eta, 10)) } : {},
            asset ? { id: asset.id, tag: asset.tag, name: asset.name } : null
        );
    }, [dataStr, asset, fit?.beta, fit?.eta, onStateChange]);




    return (
        <div className="space-y-6">
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                <label className="block text-sm font-medium text-blue-900 mb-2">
                    <Search size={14} className="inline mr-1" /> Auto-populate from asset failure intervals
                </label>
                <AssetSelector selected={asset} onSelect={setAsset} />
                {loading && <p className="text-xs text-blue-500 mt-2 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Calculating failure intervals...</p>}
            </div>

            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                    Time-to-Failure Data (hours, comma-separated)
                    <span className="text-xs text-slate-400 ml-2">Enter individual failure times or inter-failure intervals</span>
                </label>
                <textarea value={dataStr} onChange={e => setDataStr(e.target.value)}
                    className="w-full p-3 border border-slate-300 rounded-lg text-sm font-mono h-20" />
            </div>

            {fit && (
                <>
                    {/* Parameters */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <ResultCard label="Shape (β)" value={fit.beta} color="blue" sub="Failure characteristic" />
                        <ResultCard label="Scale (η)" value={fit.eta} unit="hrs" color="purple" sub="Characteristic life (63.2%)" />
                        <ResultCard label="R²" value={fit.r2} color={fit.r2 >= 0.9 ? 'green' : 'amber'} sub={fit.r2 >= 0.9 ? 'Good fit' : 'Fair fit'} />
                        <ResultCard label="B10 Life" value={Math.round(weibullBLife(fit.beta, fit.eta, 10))} unit="hrs" color="green" sub="10% failure probability" />
                    </div>




                    {/* B-Life Table */}
                    <div className="bg-white border border-slate-200 rounded-xl p-4">
                        <h4 className="text-sm font-bold text-slate-900 mb-3">B-Life Values (Percentile Failures)</h4>
                        <div className="grid grid-cols-5 gap-3">
                            {[1, 5, 10, 50, 63.2].map(pct => (
                                <div key={pct} className="text-center p-2 bg-slate-50 rounded-lg">
                                    <p className="text-xs text-slate-500">B{pct}%</p>
                                    <p className="text-sm font-bold text-slate-900">{Math.round(weibullBLife(fit.beta, fit.eta, pct))} hrs</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Reliability & CDF curves — collapsible */}
                    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                        <button
                            type="button"
                            onClick={() => setShowRtFt(prev => !prev)}
                            className="w-full flex items-center justify-between px-6 py-3.5 hover:bg-slate-50/60 transition-colors"
                        >
                            <span className="text-sm font-bold text-slate-500 flex items-center gap-2">
                                <Activity size={14} className="text-emerald-400" />
                                Reliability R(t) & Cumulative Failure F(t)
                                <span className="text-[10px] font-normal text-slate-400 ml-1">Probability curves</span>
                            </span>
                            {showRtFt
                                ? <ChevronUp size={16} className="text-slate-400" />
                                : <ChevronDown size={16} className="text-slate-400" />}
                        </button>
                        {showRtFt && (
                            <div className="px-6 pb-6">
                                <ResponsiveContainer width="100%" height={300}>
                                    <LineChart data={fit.plotData}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                        <XAxis dataKey="t" label={{ value: 'Time (hours)', position: 'insideBottom', offset: -5 }} tick={{ fontSize: 11 }} />
                                        <YAxis label={{ value: 'Probability %', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} domain={[0, 100]} />
                                        <Tooltip />
                                        <Legend />
                                        <Line type="monotone" dataKey="reliability" stroke="#10b981" strokeWidth={2} name="Reliability R(t)" dot={false} />
                                        <Line type="monotone" dataKey="failure" stroke="#ef4444" strokeWidth={2} name="Failure CDF F(t)" dot={false} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </div>

                    {/* ── PM Recommendation Panel ────────────── */}
                    {fit.beta > 1 && asset && (
                        <div className="bg-gradient-to-r from-teal-50 via-cyan-50 to-sky-50 border-2 border-teal-200 rounded-2xl p-5">
                            <div className="flex items-start justify-between flex-wrap gap-3">
                                <div className="flex items-start gap-3">
                                    <div className="p-2.5 rounded-xl bg-teal-100 text-teal-600">
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
                                            <strong className="text-teal-700">
                                                {Math.round(fit.eta * (fit.beta > 3 ? 0.7 : fit.beta > 2 ? 0.75 : 0.8)).toLocaleString()} hours
                                            </strong>{' '}
                                            ({Math.round((fit.beta > 3 ? 70 : fit.beta > 2 ? 75 : 80))}% of η) to maintain ≥{Math.round((fit.beta > 3 ? 70 : fit.beta > 2 ? 75 : 80))}% reliability.
                                            B10 safety lower-bound: {Math.round(weibullBLife(fit.beta, fit.eta, 10)).toLocaleString()} hrs.
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setShowPMModal(true)}
                                    className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-teal-500 to-cyan-500 text-white text-sm font-bold rounded-xl shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all"
                                >
                                    <Wrench size={15} />
                                    Create PM Program
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ── Bathtub Curve — Hazard Rate h(t) ────── */}
                    <BathtubCurve
                        beta={fit.beta}
                        eta={fit.eta}
                        r2={fit.r2}
                        assetTag={asset?.tag}
                        onCreatePM={asset ? () => setShowPMModal(true) : undefined}
                    />

                    {/* ── PM Creation Modal ─────────────────── */}
                    {asset && (
                        <CreatePMFromWeibullModal
                            isOpen={showPMModal}
                            onClose={() => setShowPMModal(false)}
                            data={{
                                asset: { id: asset.id, tag: asset.tag, name: asset.name },
                                beta: fit.beta,
                                eta: fit.eta,
                                r2: fit.r2,
                                b10: Math.round(weibullBLife(fit.beta, fit.eta, 10)),
                                pmInterval: Math.round(fit.eta * (fit.beta > 3 ? 0.7 : fit.beta > 2 ? 0.75 : 0.8)),
                                dataPoints: failureTimes.length,
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
            const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString();
            const { data: wos } = await supabase.from('work_orders')
                .select('id')
                .eq('asset_id', asset.id)
                .in('type', CORRECTIVE_WO_TYPES)
                .gte('created_at', yearAgo);
            if (wos && wos.length > 0) {
                const calcMtbf = 8760 / wos.length;
                setMtbfVal(calcMtbf.toFixed(0));
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
        <div className="space-y-6">
            {/* Asset Selector */}
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                <label className="block text-sm font-medium text-blue-900 mb-2">
                    <Search size={14} className="inline mr-1" /> Auto-populate MTBF from asset work orders
                </label>
                <AssetSelector selected={asset} onSelect={setAsset} />
                {loadingSp && <p className="text-xs text-blue-500 mt-2 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Calculating failure rate...</p>}
            </div>

            <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                <p className="text-sm text-amber-800 flex items-center gap-2">
                    <Info size={14} /> Based on Poisson distribution. Assumes constant failure rate (exponential distribution) and no repair during resupply interval.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Equipment Population</label>
                    <input type="number" value={population} onChange={e => setPopulation(e.target.value)}
                        className="w-full p-2 border border-slate-300 rounded-lg text-sm" />
                    <p className="text-[10px] text-slate-400 mt-0.5">Number of identical units in service</p>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">MTBF (hours)</label>
                    <input type="number" value={mtbfVal} onChange={e => setMtbfVal(e.target.value)}
                        className="w-full p-2 border border-slate-300 rounded-lg text-sm" />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Resupply Interval (hours)</label>
                    <input type="number" value={interval} onChange={e => setInterval(e.target.value)}
                        className="w-full p-2 border border-slate-300 rounded-lg text-sm" />
                    <p className="text-[10px] text-slate-400 mt-0.5">Time between restock / lead time</p>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Confidence Level (%)</label>
                    <select value={confidence} onChange={e => setConfidence(e.target.value)}
                        className="w-full p-2 border border-slate-300 rounded-lg text-sm">
                        <option value="90">90%</option>
                        <option value="95">95%</option>
                        <option value="99">99%</option>
                    </select>
                </div>
            </div>

            {/* Results */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <ResultCard label="Expected Demand (λ)" value={result.lambda.toFixed(2)} unit="failures" color="blue" sub="Expected failures in interval" />
                <ResultCard label={`Spares Required (${confidence}%)`} value={result.requiredSpares} unit="units" color="green"
                    sub={`${confidence}% confidence of no stockout`} />
                <ResultCard label="Failure Rate" value={(failureRate * 1000).toFixed(3)} unit="per 1000h" color="red" />
            </div>

            {/* Probability Table */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100">
                    <h4 className="text-sm font-bold text-slate-900">Poisson Probability Distribution</h4>
                </div>
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
                    className="w-full p-3 border border-slate-300 rounded-lg text-sm font-mono h-20" />
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

    // Section collapse state
    const [expandedR, setExpandedR] = useState(true);
    const [expandedM, setExpandedM] = useState(true);
    const [expandedA, setExpandedA] = useState(true);

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

    // ─── Auto-populate from WO data ───────────────────────────
    useEffect(() => {
        if (!asset) return;
        setLoading(true);
        (async () => {
            const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString();
            // Corrective WOs for MTBF
            const { data: wos } = await supabase.from('work_orders')
                .select('id, created_at, actual_hours, status')
                .eq('asset_id', asset.id)
                .in('type', CORRECTIVE_WO_TYPES)
                .gte('created_at', yearAgo)
                .order('created_at');

            if (wos && wos.length > 0) {
                setFailures(String(wos.length));
                setTotalHours('8760');
                const repairs = wos.map(w => parseFloat(w.actual_hours) || 0).filter(h => h > 0);
                if (repairs.length > 0) {
                    setRepairTimesStr(repairs.map(r => r.toFixed(1)).join(', '));
                }
            }

            // Also pull all actual repair hours for maintainability (not just corrective)
            const { data: allWos } = await supabase.from('work_orders')
                .select('actual_hours')
                .eq('asset_id', asset.id)
                .not('actual_hours', 'is', null)
                .gt('actual_hours', 0);
            if (allWos && allWos.length > 0) {
                setRepairTimesStr(allWos.map(w => parseFloat(w.actual_hours).toFixed(1)).join(', '));
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

    return (
        <div className="space-y-5">
            {/* ─── Critical Assets Quick-Launch ─────────────────── */}
            <CriticalAssetsPanel onSelectAsset={(a) => setAsset(a)} />

            {/* ─── Shared Asset Selector ───────────────────────── */}
            <div className="bg-gradient-to-r from-blue-50 to-cyan-50 border border-blue-200/60 rounded-xl p-4">
                <label className="block text-sm font-semibold text-blue-900 mb-2 flex items-center gap-1.5">
                    <Search size={14} /> Auto-populate from asset work orders
                </label>
                <AssetSelector selected={asset} onSelect={setAsset} />
                {loading && <p className="text-xs text-blue-500 mt-2 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Loading WO data for all RAM metrics...</p>}
            </div>

            {/* ═══════════ SECTION 1: RELIABILITY (R) ═══════════ */}
            <RAMSectionHeader
                icon={<Activity size={18} />}
                title="Reliability (R)"
                subtitle="MTBF, failure rate, and confidence intervals"
                expanded={expandedR}
                onToggle={() => setExpandedR(!expandedR)}
                accentColor="blue"
            />
            {expandedR && (
                <div className="space-y-4 pl-1 animate-in slide-in-from-top-2 duration-200">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Total Operating Hours</label>
                            <input type="number" value={totalHours} onChange={e => setTotalHours(e.target.value)}
                                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Number of Failures</label>
                            <input type="number" value={failures} onChange={e => setFailures(e.target.value)}
                                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Confidence Level (%)</label>
                            <select value={confidence} onChange={e => setConfidence(Number(e.target.value))}
                                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500">
                                <option value={60}>60%</option>
                                <option value={80}>80%</option>
                                <option value={90}>90%</option>
                                <option value={95}>95%</option>
                            </select>
                        </div>
                    </div>

                    {hasReliabilityData ? (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <ResultCard label="Point MTBF" value={mtbfResult.mtbf === Infinity ? '∞' : mtbfResult.mtbf.toFixed(0)} unit="hrs" color="blue" />
                            <ResultCard label={`Lower (${confidence}%)`} value={mtbfResult.lower.toFixed(0)} unit="hrs" color="amber" sub="Conservative estimate" />
                            <ResultCard label={`Upper (${confidence}%)`} value={mtbfResult.upper === Infinity ? '∞' : mtbfResult.upper.toFixed(0)} unit="hrs" color="green" />
                            <ResultCard label="Failure Rate (λ)" value={mtbfResult.mtbf > 0 && mtbfResult.mtbf < Infinity ? (1 / mtbfResult.mtbf * 1000).toFixed(3) : '0'} unit="per 1000h" color="red" />
                        </div>
                    ) : (
                        <div className="text-center py-8 bg-gradient-to-b from-blue-50/50 to-slate-50 border border-dashed border-blue-200/60 rounded-xl">
                            <Activity size={28} className="mx-auto mb-3 text-blue-300" />
                            <p className="text-sm font-semibold text-slate-600 mb-1">🎯 Reliability (R) — How often does this asset fail?</p>
                            <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                                MTBF is the primary measure of equipment reliability. Select a critical asset above or enter historical operating data to benchmark against OREDA/industry standards, set PM interval thresholds (IEC 61649), and feed Availability (Ao) calculations.
                            </p>
                        </div>
                    )}
                </div>
            )}

            {/* ═══════════ SECTION 2: MAINTAINABILITY (M) ═══════════ */}
            <RAMSectionHeader
                icon={<Wrench size={18} />}
                title="Maintainability (M)"
                subtitle="MTTR, lognormal repair distribution M(t)"
                expanded={expandedM}
                onToggle={() => setExpandedM(!expandedM)}
                accentColor="purple"
            />
            {expandedM && (
                <div className="space-y-4 pl-1 animate-in slide-in-from-top-2 duration-200">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Repair Times (hours, comma-separated)</label>
                        <textarea value={repairTimesStr} onChange={e => setRepairTimesStr(e.target.value)}
                            className="w-full p-3 border border-slate-300 rounded-lg text-sm font-mono h-16 focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500" />
                        <p className="text-xs text-slate-400 mt-0.5">{repairTimes.length} data points</p>
                    </div>

                    {/* MTTR summary cards */}
                    {hasMaintainabilityData ? (
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                            <ResultCard label="Mean (MTTR)" value={mttrResult.mean.toFixed(1)} unit="hrs" color="purple" />
                            <ResultCard label="Median" value={mttrResult.median.toFixed(1)} unit="hrs" color="purple" />
                            <ResultCard label="Std Dev" value={mttrResult.stdDev.toFixed(1)} unit="hrs" color="slate" />
                            <ResultCard label="Mmax (90%)" value={mttrResult.mmax90.toFixed(1)} unit="hrs" color="amber" sub="90% repairs complete" />
                            <ResultCard label="Mmax (95%)" value={mttrResult.mmax95.toFixed(1)} unit="hrs" color="red" sub="95% repairs complete" />
                        </div>
                    ) : (
                        <div className="text-center py-8 bg-gradient-to-b from-purple-50/50 to-slate-50 border border-dashed border-purple-200/60 rounded-xl">
                            <Wrench size={28} className="mx-auto mb-3 text-purple-300" />
                            <p className="text-sm font-semibold text-slate-600 mb-1">🔧 Maintainability (M) — How quickly can we restore this asset?</p>
                            <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                                MTTR quantifies repair efficiency. Enter individual repair times from work orders to model the lognormal repair distribution and determine Mmax(90/95%) — the time by which 90% or 95% of repairs should be complete.
                            </p>
                        </div>
                    )}

                    {/* Lognormal parameters and chart */}
                    {lognormalFit && (
                        <>
                            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
                                <p className="text-sm text-slate-600">Lognormal Distribution: μ = {lognormalFit.mu}, σ = {lognormalFit.sigma}</p>
                                <p className="text-xs text-slate-400 mt-0.5">Geometric Mean = e^μ = {Math.exp(lognormalFit.mu).toFixed(1)} hrs · t₅₀ = {lognormalFit.t50.toFixed(1)}h · t₉₀ = {lognormalFit.t90.toFixed(1)}h · t₉₅ = {lognormalFit.t95.toFixed(1)}h</p>
                            </div>
                            <div className="bg-white border border-slate-200 rounded-xl p-5">
                                <h4 className="text-sm font-bold text-slate-900 mb-4">Maintainability Function M(t) — Lognormal CDF</h4>
                                <ResponsiveContainer width="100%" height={240}>
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

                    {/* Also show the empirical MTTR CDF (exponential) if enough data */}
                    {mttrChartData.length > 2 && !lognormalFit && (
                        <div className="bg-white border border-slate-200 rounded-xl p-5">
                            <h4 className="text-sm font-bold text-slate-900 mb-4">Repair Time CDF — Exponential Approximation</h4>
                            <ResponsiveContainer width="100%" height={220}>
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
            )}

            {/* ═══════════ SECTION 3: AVAILABILITY (A) ═══════════ */}
            <RAMSectionHeader
                icon={<Gauge size={18} />}
                title="Availability (A)"
                subtitle={hasReliabilityData ? `Ao = MTBF / (MTBF + MRT) — auto-calculated: ${aoPercent}%` : 'Ao = MTBF / (MTBF + MRT) — enter R & M data first'}
                expanded={expandedA}
                onToggle={() => setExpandedA(!expandedA)}
                accentColor="green"
            />
            {expandedA && (
                <div className="space-y-4 pl-1 animate-in slide-in-from-top-2 duration-200">
                    {(hasReliabilityData || hasMaintainabilityData) ? (
                        <>
                    {/* Only MLDT and Target need user input — MTBF & MTTR feed from above */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="bg-blue-50/50 border border-blue-100 rounded-lg p-3">
                            <p className="text-[10px] text-blue-500 font-bold uppercase tracking-wider">From Reliability</p>
                            <p className="text-lg font-bold text-blue-700 mt-0.5">{mtbfResult.mtbf === Infinity ? '∞' : mtbfResult.mtbf.toFixed(0)} <span className="text-xs font-normal">hrs MTBF</span></p>
                        </div>
                        <div className="bg-purple-50/50 border border-purple-100 rounded-lg p-3">
                            <p className="text-[10px] text-purple-500 font-bold uppercase tracking-wider">From Maintainability</p>
                            <p className="text-lg font-bold text-purple-700 mt-0.5">{mttrResult.mean.toFixed(1)} <span className="text-xs font-normal">hrs MTTR</span></p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">MLDT (hours)</label>
                            <input type="number" value={mldt} onChange={e => setMldt(e.target.value)}
                                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500/20 focus:border-green-500" />
                            <p className="text-[10px] text-slate-400 mt-0.5">Mean logistics delay time</p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Target Ao (%)</label>
                            <input type="number" value={targetAo} onChange={e => setTargetAo(e.target.value)}
                                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500/20 focus:border-green-500" />
                        </div>
                    </div>

                    {/* Formula */}
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
                        <p className="text-sm text-slate-500">
                            Ao = MTBF / (MTBF + MRT) = {mtbfResult.mtbf === Infinity ? '∞' : mtbfResult.mtbf.toFixed(0)} / ({mtbfResult.mtbf === Infinity ? '∞' : mtbfResult.mtbf.toFixed(0)} + {mrt.toFixed(1)})
                        </p>
                    </div>

                    {/* Ao Results */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <ResultCard label="Operational Availability" value={`${aoPercent}%`} color={aoColor}
                            sub={ao >= 0.95 ? '✅ Meets world-class target' : ao >= 0.90 ? '⚠️ Below target' : '🔴 Critical'} />
                        <ResultCard label="MRT (Total)" value={mrt.toFixed(1)} unit="hrs" color="purple" sub={`MTTR ${mttrResult.mean.toFixed(1)}h + MLDT ${mldt}h`} />
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

                    {/* P2.2: Bridge to Spares Calculator */}
                    {onSendToSpares && mtbfResult.mtbf > 0 && mtbfResult.mtbf < Infinity && (
                        <div className="flex items-center justify-between p-3 bg-gradient-to-r from-teal-50 to-cyan-50 border border-teal-200 rounded-xl">
                            <div className="text-[11px] text-teal-700">
                                <span className="font-semibold">Next Step:</span> Use this MTBF ({Math.round(mtbfResult.mtbf).toLocaleString()}h) to calculate recommended spares holding
                            </div>
                            <button onClick={() => onSendToSpares(mtbfResult.mtbf)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-teal-500 to-cyan-500 text-white text-xs font-medium rounded-lg shadow-sm hover:shadow-md transition-all shrink-0 ml-3">
                                <span>📦</span> Calculate Spares →
                            </button>
                        </div>
                    )}

                    {/* Trade-off Chart */}
                    <div className="bg-white border border-slate-200 rounded-xl p-5">
                        <h4 className="text-sm font-bold text-slate-900 mb-4">
                            MTBF vs MRT Trade-off for Ao = {targetAo}%
                            <span className="text-xs font-normal text-slate-400 ml-2">Combinations that achieve target availability</span>
                        </h4>
                        <ResponsiveContainer width="100%" height={260}>
                            <AreaChart data={tradeoffData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                <XAxis dataKey="mrt" label={{ value: 'MRT (hours)', position: 'insideBottom', offset: -5 }} tick={{ fontSize: 11 }} />
                                <YAxis label={{ value: 'Required MTBF (hrs)', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} />
                                <Tooltip formatter={(v: any) => `${v} hrs`} />
                                <Area type="monotone" dataKey="mtbfReq" stroke="#22c55e" fill="#22c55e" fillOpacity={0.1} name="Required MTBF" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                        </>
                    ) : (
                        <div className="text-center py-10 bg-gradient-to-b from-green-50/50 to-slate-50 border border-dashed border-green-200/60 rounded-xl">
                            <Gauge size={32} className="mx-auto mb-3 text-green-300" />
                            <p className="text-sm font-semibold text-slate-600 mb-1">⚡ Availability (A) — What percentage of time is this asset operational?</p>
                            <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                                Operational Availability (Ao) combines reliability and maintainability: Ao = MTBF / (MTBF + MRT). Enter data in the R and M sections above, and availability will be auto-calculated. Target Ao ≥ 95% for world-class performance.
                            </p>
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
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                    <Calculator size={24} className="text-blue-600" /> Reliability Engineering Toolkit
                </h1>
                <p className="text-sm text-slate-500 mt-1">
                    ISO 14224 • MIL-HDBK-338 • Interactive calculators with auto-population from ERS work order data
                </p>
            </div>

            {/* Tabs */}
            <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-1">
                {TABS.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${activeTab === tab.id
                            ? 'bg-white text-blue-700 border border-b-white border-slate-200 -mb-[1px] shadow-sm'
                            : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                            }`}
                        title={tab.desc}
                    >
                        {tab.icon} {tab.label}
                    </button>
                ))}
            </div>

            {/* Description */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex items-start gap-2">
                <HelpCircle size={16} className="text-slate-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-slate-500">{TABS.find(t => t.id === activeTab)?.desc}</p>
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
