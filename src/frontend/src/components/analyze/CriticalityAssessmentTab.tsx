import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    AlertTriangle, Shield, Save, ChevronDown, ChevronUp,
    Search, Info, Zap, Factory, Wind, DollarSign, Users, Loader2,
} from 'lucide-react';
import analyzeService from '../../eam/services/AnalyzeService';
import type { CriticalityAssessment } from '../../eam/services/AnalyzeService';
import { supabase } from '../../eam/lib/supabase';

// ── Constants ────────────────────────────────────────────────
const CONSEQUENCE_FACTORS = [
    { key: 'consequence_safety', label: 'Safety', icon: Shield, color: 'text-red-400', description: 'Impact on personnel safety' },
    { key: 'consequence_environment', label: 'Environment', icon: Wind, color: 'text-green-400', description: 'Environmental impact' },
    { key: 'consequence_production', label: 'Production', icon: Factory, color: 'text-blue-400', description: 'Production / operational impact' },
    { key: 'consequence_cost', label: 'Cost', icon: DollarSign, color: 'text-amber-400', description: 'Financial cost impact' },
    { key: 'consequence_reputation', label: 'Reputation', icon: Users, color: 'text-blue-400', description: 'Reputational / regulatory impact' },
] as const;

const SEVERITY_LABELS = ['Negligible', 'Minor', 'Moderate', 'Major', 'Catastrophic'];
const PROBABILITY_LABELS = ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost Certain'];
const CRITICALITY_COLORS = {
    A: 'bg-red-500/20 text-red-400 border-red-500/30',
    B: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    C: 'bg-green-500/20 text-green-400 border-green-500/30',
};

// Auto-default equipment types → Criticality A
const AUTO_CRIT_A_TYPES = ['generator', 'compressor', 'turbine', 'pump', 'boiler', 'vessel'];

type AssetRow = {
    id: string;
    tag: string;
    name: string;
    hierarchy_level: string;
    criticality: 'A' | 'B' | 'C';
};

function calcCriticality(riskScore: number): 'A' | 'B' | 'C' {
    return riskScore >= 15 ? 'A' : riskScore >= 8 ? 'B' : 'C';
}

function riskColor(score: number): string {
    if (score >= 15) return 'bg-red-500/80 text-white';
    if (score >= 8) return 'bg-amber-500/70 text-white';
    return 'bg-green-500/60 text-white';
}

// ── Component ────────────────────────────────────────────────
export const CriticalityAssessmentTab: React.FC = () => {
    // Data
    const [assets, setAssets] = useState<AssetRow[]>([]);
    const [assessments, setAssessments] = useState<CriticalityAssessment[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Filters
    const [search, setSearch] = useState('');
    const [filterCrit, setFilterCrit] = useState<'ALL' | 'A' | 'B' | 'C'>('ALL');
    const [filterLevel, setFilterLevel] = useState<string>('ALL');

    // Expanded inline editor
    const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<{
        consequence_safety: number;
        consequence_environment: number;
        consequence_production: number;
        consequence_cost: number;
        consequence_reputation: number;
        probability: number;
        notes: string;
    }>({
        consequence_safety: 1, consequence_environment: 1, consequence_production: 1,
        consequence_cost: 1, consequence_reputation: 1, probability: 1, notes: '',
    });

    // Batch selection
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [batchCrit, setBatchCrit] = useState<'A' | 'B' | 'C'>('B');

    // ── Data fetching ─────────────────────────────────────────
    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            // Fetch assets (EQUIPMENT + COMPONENT only)
            const { data: assetData } = await supabase
                .from('assets')
                .select('id, tag, name, hierarchy_level, criticality')
                .in('hierarchy_level', ['EQUIPMENT', 'COMPONENT'])
                .order('tag');
            setAssets((assetData || []) as AssetRow[]);

            // Fetch existing assessments
            const assessmentData = await analyzeService.getCriticalityAssessments();
            setAssessments(assessmentData);
        } catch (e) {
            console.error('[CriticalityTab] fetch error:', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    // ── Filtered & merged data ────────────────────────────────
    const mergedData = useMemo(() => {
        const assessMap = new Map(assessments.map(a => [a.asset_id, a]));
        return assets
            .map(asset => ({
                ...asset,
                assessment: assessMap.get(asset.id) || null,
                effectiveCrit: assessMap.get(asset.id)?.overall_criticality || asset.criticality,
                riskScore: assessMap.get(asset.id)?.risk_score || 0,
            }))
            .filter(a => {
                if (search && !a.tag.toLowerCase().includes(search.toLowerCase()) && !a.name.toLowerCase().includes(search.toLowerCase())) return false;
                if (filterCrit !== 'ALL' && a.effectiveCrit !== filterCrit) return false;
                if (filterLevel !== 'ALL' && a.hierarchy_level !== filterLevel) return false;
                return true;
            });
    }, [assets, assessments, search, filterCrit, filterLevel]);

    // ── Expand editor ─────────────────────────────────────────
    const handleExpand = useCallback((assetId: string) => {
        if (expandedAssetId === assetId) {
            setExpandedAssetId(null);
            return;
        }
        setExpandedAssetId(assetId);
        const existing = assessments.find(a => a.asset_id === assetId);
        const asset = assets.find(a => a.id === assetId);

        // Auto-default Criticality A for generators, compressors, turbines
        const isAutoA = asset && AUTO_CRIT_A_TYPES.some(t =>
            asset.name.toLowerCase().includes(t) || asset.tag.toLowerCase().includes(t)
        );

        if (existing) {
            setEditForm({
                consequence_safety: existing.consequence_safety,
                consequence_environment: existing.consequence_environment,
                consequence_production: existing.consequence_production,
                consequence_cost: existing.consequence_cost,
                consequence_reputation: existing.consequence_reputation,
                probability: existing.probability,
                notes: existing.notes || '',
            });
        } else if (isAutoA) {
            setEditForm({
                consequence_safety: 5, consequence_environment: 4, consequence_production: 4,
                consequence_cost: 3, consequence_reputation: 3, probability: 4,
                notes: 'Auto-defaulted to Criticality A (safety-critical equipment type)',
            });
        } else {
            setEditForm({
                consequence_safety: 1, consequence_environment: 1, consequence_production: 1,
                consequence_cost: 1, consequence_reputation: 1, probability: 1, notes: '',
            });
        }
    }, [expandedAssetId, assessments, assets]);

    // ── Save single assessment ────────────────────────────────
    const handleSave = useCallback(async () => {
        if (!expandedAssetId) return;
        setSaving(true);
        try {
            await analyzeService.saveCriticalityAssessment({
                asset_id: expandedAssetId,
                ...editForm,
                overall_criticality: calcCriticality(
                    Math.max(
                        editForm.consequence_safety, editForm.consequence_environment,
                        editForm.consequence_production, editForm.consequence_cost,
                        editForm.consequence_reputation,
                    ) * editForm.probability
                ),
                assessed_by: null,
            });
            await fetchData();
            setExpandedAssetId(null);
        } catch (e) {
            console.error('[CriticalityTab] save error:', e);
        } finally {
            setSaving(false);
        }
    }, [expandedAssetId, editForm, fetchData]);

    // ── Batch update ──────────────────────────────────────────
    const handleBatchUpdate = useCallback(async () => {
        if (selectedIds.size === 0) return;
        setSaving(true);
        try {
            await analyzeService.batchUpdateCriticality(Array.from(selectedIds), batchCrit);
            await fetchData();
            setSelectedIds(new Set());
        } catch (e) {
            console.error('[CriticalityTab] batch error:', e);
        } finally {
            setSaving(false);
        }
    }, [selectedIds, batchCrit, fetchData]);

    const toggleSelect = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };
    const toggleSelectAll = () => {
        if (selectedIds.size === mergedData.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(mergedData.map(d => d.id)));
        }
    };

    // ── Compute current form risk score ───────────────────────
    const formRiskScore = Math.max(
        editForm.consequence_safety, editForm.consequence_environment,
        editForm.consequence_production, editForm.consequence_cost,
        editForm.consequence_reputation,
    ) * editForm.probability;

    // ── Summary stats ─────────────────────────────────────────
    const stats = useMemo(() => {
        const total = assets.length;
        const assessed = assessments.length;
        const critA = mergedData.filter(d => d.effectiveCrit === 'A').length;
        const critB = mergedData.filter(d => d.effectiveCrit === 'B').length;
        const critC = mergedData.filter(d => d.effectiveCrit === 'C').length;
        return { total, assessed, critA, critB, critC };
    }, [assets, assessments, mergedData]);

    // ── Loading ───────────────────────────────────────────────
    if (loading) {
        return (
            <div className="flex items-center justify-center py-24">
                <Loader2 className="animate-spin text-accent-cyan mr-3" size={24} />
                <span className="text-slate-500">Loading criticality data…</span>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* ── Summary Cards ────────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 text-center">
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Total Assets</p>
                    <p className="text-2xl font-bold text-slate-800 mt-1">{stats.total}</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 text-center">
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Assessed</p>
                    <p className="text-2xl font-bold text-accent-cyan mt-1">{stats.assessed}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                        {stats.total > 0 ? `${Math.round((stats.assessed / stats.total) * 100)}%` : '0%'}
                    </p>
                </div>
                <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 text-center">
                    <p className="text-[10px] text-red-400 uppercase tracking-wider font-semibold">Criticality A</p>
                    <p className="text-2xl font-bold text-red-400 mt-1">{stats.critA}</p>
                </div>
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 text-center">
                    <p className="text-[10px] text-amber-400 uppercase tracking-wider font-semibold">Criticality B</p>
                    <p className="text-2xl font-bold text-amber-400 mt-1">{stats.critB}</p>
                </div>
                <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-4 text-center">
                    <p className="text-[10px] text-green-400 uppercase tracking-wider font-semibold">Criticality C</p>
                    <p className="text-2xl font-bold text-green-400 mt-1">{stats.critC}</p>
                </div>
            </div>

            {/* ── 5×5 Risk Matrix ──────────────────────────── */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-lg">
                <div className="p-5 border-b border-slate-200 flex items-center gap-2">
                    <AlertTriangle className="text-amber-400" size={20} />
                    <h3 className="text-lg font-semibold text-slate-800">5×5 Risk Matrix</h3>
                    <span className="text-xs text-slate-400 ml-2">ISO 14224 / ISO 31000</span>
                </div>
                <div className="p-5 overflow-x-auto">
                    <div className="flex items-end gap-2">
                        {/* Y-axis label */}
                        <div className="flex flex-col items-center mr-2 pb-8">
                            <span className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider writing-mode-vertical" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                                Probability →
                            </span>
                        </div>
                        <div>
                            <table className="border-collapse">
                                <thead>
                                    <tr>
                                        <th className="p-1 text-[9px] text-slate-400 w-20"></th>
                                        {SEVERITY_LABELS.map((label, i) => (
                                            <th key={i} className="p-2 text-[9px] text-slate-500 uppercase tracking-wider text-center w-20">
                                                {i + 1}. {label}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {PROBABILITY_LABELS.slice().reverse().map((pLabel, pi) => {
                                        const prob = 5 - pi;
                                        return (
                                            <tr key={prob}>
                                                <td className="p-2 text-[9px] text-slate-500 uppercase tracking-wider text-right pr-3 font-semibold">
                                                    {prob}. {pLabel}
                                                </td>
                                                {[1, 2, 3, 4, 5].map(cons => {
                                                    const score = cons * prob;
                                                    const crit = calcCriticality(score);
                                                    const count = mergedData.filter(d =>
                                                        d.assessment &&
                                                        Math.max(
                                                            d.assessment.consequence_safety,
                                                            d.assessment.consequence_environment,
                                                            d.assessment.consequence_production,
                                                            d.assessment.consequence_cost,
                                                            d.assessment.consequence_reputation,
                                                        ) === cons && d.assessment.probability === prob
                                                    ).length;

                                                    return (
                                                        <td key={cons} className="p-1">
                                                            <div className={`w-20 h-14 rounded-lg flex flex-col items-center justify-center ${riskColor(score)} transition-all relative`}>
                                                                <span className="text-sm font-bold">{score}</span>
                                                                <span className="text-[9px] font-semibold opacity-80">{crit}</span>
                                                                {count > 0 && (
                                                                    <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-slate-50 text-accent-cyan text-[9px] font-bold flex items-center justify-center border border-slate-200">
                                                                        {count}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            <div className="text-center mt-1">
                                <span className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider">Consequence →</span>
                            </div>
                        </div>
                    </div>

                    {/* Legend */}
                    <div className="flex items-center gap-4 mt-4 text-xs text-slate-500">
                        <div className="flex items-center gap-1.5">
                            <div className="w-4 h-4 rounded bg-red-500/80" />
                            <span>A — High Risk (≥15)</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-4 h-4 rounded bg-amber-500/70" />
                            <span>B — Medium Risk (8–14)</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-4 h-4 rounded bg-green-500/60" />
                            <span>C — Low Risk (≤7)</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Filter Bar + Batch Actions ──────────────── */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                <div className="flex flex-wrap items-center gap-3">
                    {/* Search */}
                    <div className="relative flex-1 min-w-[200px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                        <input
                            type="text" placeholder="Search by tag or name..."
                            value={search} onChange={e => setSearch(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-700 focus:outline-none focus:border-accent-cyan"
                        />
                    </div>
                    {/* Criticality filter */}
                    <div className="flex rounded-lg overflow-hidden border border-slate-300">
                        {(['ALL', 'A', 'B', 'C'] as const).map(c => (
                            <button key={c} onClick={() => setFilterCrit(c)}
                                className={`px-3 py-2 text-xs font-medium transition-colors ${filterCrit === c ? 'bg-accent-cyan text-brand-900' : 'bg-slate-50 text-slate-500 hover:text-slate-700'}`}
                            >{c === 'ALL' ? 'All' : `Crit ${c}`}</button>
                        ))}
                    </div>
                    {/* Level filter */}
                    <select value={filterLevel} onChange={e => setFilterLevel(e.target.value)}
                        className="bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:border-accent-cyan"
                    >
                        <option value="ALL">All Levels</option>
                        <option value="EQUIPMENT">Equipment</option>
                        <option value="COMPONENT">Component</option>
                    </select>

                    {/* Batch actions */}
                    {selectedIds.size > 0 && (
                        <div className="flex items-center gap-2 ml-auto bg-slate-50 rounded-lg px-3 py-1.5 border border-slate-300">
                            <span className="text-xs text-slate-600">{selectedIds.size} selected</span>
                            <select value={batchCrit} onChange={e => setBatchCrit(e.target.value as 'A' | 'B' | 'C')}
                                className="bg-slate-50 border border-slate-300 rounded px-2 py-1 text-xs text-slate-700"
                            >
                                <option value="A">Set A</option>
                                <option value="B">Set B</option>
                                <option value="C">Set C</option>
                            </select>
                            <button onClick={handleBatchUpdate} disabled={saving}
                                className="px-3 py-1 bg-accent-cyan text-brand-900 rounded text-xs font-semibold hover:bg-primary-400 transition-colors disabled:opacity-50"
                            >
                                {saving ? 'Applying…' : 'Apply'}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* ── Asset Table ─────────────────────────────── */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-200 text-slate-500 text-xs uppercase tracking-wider">
                                <th className="p-3 text-left w-10">
                                    <input type="checkbox" checked={selectedIds.size === mergedData.length && mergedData.length > 0}
                                        onChange={toggleSelectAll} className="rounded border-slate-300 bg-slate-50 accent-accent-cyan"
                                    />
                                </th>
                                <th className="p-3 text-left">Tag</th>
                                <th className="p-3 text-left">Asset Name</th>
                                <th className="p-3 text-center">Level</th>
                                <th className="p-3 text-center">Current</th>
                                <th className="p-3 text-center">Risk Score</th>
                                <th className="p-3 text-center">Assessed</th>
                                <th className="p-3 text-center">Assessed Crit</th>
                                <th className="p-3 text-center w-10"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {mergedData.length === 0 ? (
                                <tr>
                                    <td colSpan={9} className="p-12 text-center">
                                        <AlertTriangle className="mx-auto mb-3 text-slate-400 opacity-40" size={32} />
                                        <p className="text-slate-400 text-sm">No assets match your filters.</p>
                                    </td>
                                </tr>
                            ) : mergedData.map(item => (
                                <React.Fragment key={item.id}>
                                    <tr
                                        className={`border-b border-slate-200 hover:bg-slate-50 cursor-pointer transition-colors ${expandedAssetId === item.id ? 'bg-slate-50/70' : ''}`}
                                        onClick={() => handleExpand(item.id)}
                                    >
                                        <td className="p-3" onClick={e => { e.stopPropagation(); toggleSelect(item.id); }}>
                                            <input type="checkbox" checked={selectedIds.has(item.id)} readOnly
                                                className="rounded border-slate-300 bg-slate-50 accent-accent-cyan"
                                            />
                                        </td>
                                        <td className="p-3 font-medium text-accent-cyan font-mono">{item.tag}</td>
                                        <td className="p-3 text-slate-700 truncate max-w-[200px]">{item.name}</td>
                                        <td className="p-3 text-center">
                                            <span className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded">{item.hierarchy_level}</span>
                                        </td>
                                        <td className="p-3 text-center">
                                            <span className={`inline-flex w-7 h-7 rounded-full items-center justify-center text-xs font-bold border ${CRITICALITY_COLORS[item.criticality]}`}>
                                                {item.criticality}
                                            </span>
                                        </td>
                                        <td className="p-3 text-center">
                                            {item.assessment ? (
                                                <span className={`inline-flex px-2.5 py-1 rounded-lg text-xs font-bold ${riskColor(item.riskScore)}`}>
                                                    {item.riskScore}
                                                </span>
                                            ) : (
                                                <span className="text-slate-400 text-xs">—</span>
                                            )}
                                        </td>
                                        <td className="p-3 text-center">
                                            {item.assessment ? (
                                                <span className="text-[10px] text-slate-500">
                                                    {new Date(item.assessment.assessed_at).toLocaleDateString()}
                                                </span>
                                            ) : (
                                                <span className="text-[10px] text-slate-400 italic">Not assessed</span>
                                            )}
                                        </td>
                                        <td className="p-3 text-center">
                                            {item.assessment ? (
                                                <span className={`inline-flex w-7 h-7 rounded-full items-center justify-center text-xs font-bold border ${CRITICALITY_COLORS[item.assessment.overall_criticality]}`}>
                                                    {item.assessment.overall_criticality}
                                                </span>
                                            ) : (
                                                <span className="text-slate-400 text-xs">—</span>
                                            )}
                                        </td>
                                        <td className="p-3 text-center">
                                            {expandedAssetId === item.id
                                                ? <ChevronUp size={14} className="text-accent-cyan" />
                                                : <ChevronDown size={14} className="text-slate-400" />
                                            }
                                        </td>
                                    </tr>

                                    {/* ── Inline Editor ─────────── */}
                                    {expandedAssetId === item.id && (
                                        <tr>
                                            <td colSpan={9} className="p-0">
                                                <div className="bg-slate-50/80 border-t border-slate-200 p-5 animate-in slide-in-from-top-2 duration-200">
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                        {/* Left: Consequence Factors */}
                                                        <div>
                                                            <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                                                                <AlertTriangle size={14} className="text-amber-400" />
                                                                Consequence of Failure
                                                            </h4>
                                                            <div className="space-y-3">
                                                                {CONSEQUENCE_FACTORS.map(factor => {
                                                                    const value = editForm[factor.key as keyof typeof editForm] as number;
                                                                    const Icon = factor.icon;
                                                                    return (
                                                                        <div key={factor.key} className="flex items-center gap-3">
                                                                            <div className="flex items-center gap-2 w-32">
                                                                                <Icon size={14} className={factor.color} />
                                                                                <span className="text-xs text-slate-600 font-medium">{factor.label}</span>
                                                                            </div>
                                                                            <div className="flex-1 flex gap-1">
                                                                                {[1, 2, 3, 4, 5].map(n => (
                                                                                    <button key={n}
                                                                                        onClick={(e) => { e.stopPropagation(); setEditForm(prev => ({ ...prev, [factor.key]: n })); }}
                                                                                        className={`flex-1 py-1.5 rounded text-xs font-bold transition-all ${value === n
                                                                                            ? (n >= 4 ? 'bg-red-500/30 text-red-300 ring-1 ring-red-500/50' : n >= 3 ? 'bg-amber-500/30 text-amber-300 ring-1 ring-amber-500/50' : 'bg-green-500/30 text-green-300 ring-1 ring-green-500/50')
                                                                                            : 'bg-white text-slate-400 hover:bg-slate-100 hover:text-slate-600'
                                                                                            }`}
                                                                                    >{n}</button>
                                                                                ))}
                                                                            </div>
                                                                            <span className="text-[9px] text-slate-400 w-20 text-right">
                                                                                {SEVERITY_LABELS[value - 1]}
                                                                            </span>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>

                                                        {/* Right: Probability + Results */}
                                                        <div className="space-y-4">
                                                            <div>
                                                                <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                                                                    <Zap size={14} className="text-blue-400" />
                                                                    Probability of Occurrence
                                                                </h4>
                                                                <div className="flex gap-1">
                                                                    {[1, 2, 3, 4, 5].map(n => (
                                                                        <button key={n}
                                                                            onClick={(e) => { e.stopPropagation(); setEditForm(prev => ({ ...prev, probability: n })); }}
                                                                            className={`flex-1 py-2 rounded text-xs font-bold transition-all ${editForm.probability === n
                                                                                ? (n >= 4 ? 'bg-red-500/30 text-red-300 ring-1 ring-red-500/50' : n >= 3 ? 'bg-amber-500/30 text-amber-300 ring-1 ring-amber-500/50' : 'bg-green-500/30 text-green-300 ring-1 ring-green-500/50')
                                                                                : 'bg-white text-slate-400 hover:bg-slate-100 hover:text-slate-600'
                                                                                }`}
                                                                        >
                                                                            <div>{n}</div>
                                                                            <div className="text-[8px] mt-0.5 opacity-70">{PROBABILITY_LABELS[n - 1]}</div>
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            </div>

                                                            {/* Result Preview */}
                                                            <div className={`rounded-xl p-4 border ${formRiskScore >= 15 ? 'bg-red-500/5 border-red-500/20' : formRiskScore >= 8 ? 'bg-amber-500/5 border-amber-500/20' : 'bg-green-500/5 border-green-500/20'}`}>
                                                                <div className="flex items-center justify-between">
                                                                    <div>
                                                                        <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Risk Score</p>
                                                                        <div className="flex items-center gap-3 mt-1">
                                                                            <span className={`text-3xl font-bold ${formRiskScore >= 15 ? 'text-red-400' : formRiskScore >= 8 ? 'text-amber-400' : 'text-green-400'}`}>
                                                                                {formRiskScore}
                                                                            </span>
                                                                            <span className="text-xs text-slate-400">/ 25</span>
                                                                        </div>
                                                                    </div>
                                                                    <div className="text-right">
                                                                        <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Overall Criticality</p>
                                                                        <span className={`mt-1 inline-flex w-10 h-10 rounded-full items-center justify-center text-lg font-bold border-2 ${CRITICALITY_COLORS[calcCriticality(formRiskScore)]}`}>
                                                                            {calcCriticality(formRiskScore)}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* Notes */}
                                                            <div>
                                                                <label className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-1 block">Notes</label>
                                                                <textarea
                                                                    value={editForm.notes}
                                                                    onClick={e => e.stopPropagation()}
                                                                    onChange={e => setEditForm(prev => ({ ...prev, notes: e.target.value }))}
                                                                    rows={2}
                                                                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:border-accent-cyan resize-none"
                                                                    placeholder="Assessment notes..."
                                                                />
                                                            </div>

                                                            {/* Save button */}
                                                            <div className="flex justify-end gap-2">
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); setExpandedAssetId(null); }}
                                                                    className="px-4 py-2 bg-white text-slate-500 rounded-lg text-xs font-medium hover:bg-slate-100 transition-colors"
                                                                >
                                                                    Cancel
                                                                </button>
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); handleSave(); }}
                                                                    disabled={saving}
                                                                    className="px-4 py-2 bg-accent-cyan text-brand-900 rounded-lg text-xs font-bold hover:bg-primary-400 transition-colors flex items-center gap-2 disabled:opacity-50"
                                                                >
                                                                    {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
                                                                    {saving ? 'Saving…' : 'Save Assessment'}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Auto-default info */}
                                                    {AUTO_CRIT_A_TYPES.some(t =>
                                                        item.name.toLowerCase().includes(t) || item.tag.toLowerCase().includes(t)
                                                    ) && !item.assessment && (
                                                            <div className="mt-3 flex items-center gap-2 bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2">
                                                                <Info size={14} className="text-red-400" />
                                                                <span className="text-xs text-red-300">
                                                                    <strong>Auto-defaulted to Criticality A</strong> — this equipment type
                                                                    (generator/compressor/turbine) is classified as safety-critical per your governance rules.
                                                                </span>
                                                            </div>
                                                        )}
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default CriticalityAssessmentTab;
