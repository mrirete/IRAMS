import React, { useState, useEffect, useCallback } from 'react';
import {
    BarChart2, Filter, Search, X, Info, Bot, Loader2,
} from 'lucide-react';
import { ParetoChart } from './ParetoChart';
import type { ParetoResult, ParetoParams } from '../../eam/services/AnalyzeService';
import analyzeService from '../../eam/services/AnalyzeService';

// ── Types ────────────────────────────────────────────────────
type ParetoCriteria = 'cost' | 'downtime' | 'wo_frequency';
type HierarchyLevel = 'SITE' | 'UNIT' | 'SYSTEM' | 'EQUIPMENT' | 'COMPONENT';
type DatePreset = '30d' | '90d' | 'ytd' | '12m' | 'custom';

const HIERARCHY_LEVELS: { value: HierarchyLevel; label: string }[] = [
    { value: 'SITE', label: 'Site' },
    { value: 'UNIT', label: 'Unit' },
    { value: 'SYSTEM', label: 'System' },
    { value: 'EQUIPMENT', label: 'Equipment' },
    { value: 'COMPONENT', label: 'Component' },
];

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
    { value: '30d', label: 'Last 30 Days' },
    { value: '90d', label: 'Last 90 Days' },
    { value: 'ytd', label: 'Year to Date' },
    { value: '12m', label: 'Last 12 Months' },
];

function getDateRange(preset: DatePreset): { from: string; to: string } {
    const now = new Date();
    const to = now.toISOString();
    let from: Date;
    switch (preset) {
        case '30d': from = new Date(now); from.setDate(from.getDate() - 30); break;
        case '90d': from = new Date(now); from.setDate(from.getDate() - 90); break;
        case 'ytd': from = new Date(now.getFullYear(), 0, 1); break;
        case '12m': default: from = new Date(now); from.setFullYear(from.getFullYear() - 1); break;
    }
    return { from: from.toISOString(), to };
}

// ── Props ────────────────────────────────────────────────────
interface ParetoAnalysisTabProps {
    onDrillDown: (asset: ParetoResult) => void;
    onParetoDataChange?: (data: ParetoResult[], criteria: ParetoCriteria) => void;
    onInvestigate?: (asset: ParetoResult) => void;
    /** Trigger the BadActorAgent to auto-draft an RCA for a VITAL zone asset */
    onAutoDraftRCA?: (asset: ParetoResult) => Promise<void>;
}

// ── Component ────────────────────────────────────────────────
export const ParetoAnalysisTab: React.FC<ParetoAnalysisTabProps> = ({
    onDrillDown,
    onParetoDataChange,
    onInvestigate,
    onAutoDraftRCA,
}) => {
    const [draftingRCA, setDraftingRCA] = useState<string | null>(null);

    const handleAutoDraftRCA = async (asset: ParetoResult) => {
        if (!onAutoDraftRCA) return;
        setDraftingRCA(asset.asset_id);
        try { await onAutoDraftRCA(asset); }
        finally { setDraftingRCA(null); }
    };
    const [paretoCriteria, setParetoCriteria] = useState<ParetoCriteria>('cost');
    const [hierarchyLevel, setHierarchyLevel] = useState<HierarchyLevel>('EQUIPMENT');
    const [datePreset, setDatePreset] = useState<DatePreset>('12m');
    // Default lens = corrective work only, matching the Metrics scoreboard's
    // failure definition — a "bad actor" ranking that counted PM visits as
    // events contradicted the fleet bad-actor list. Including PM cost is an
    // explicit, labeled opt-in via the WO Types toggle.
    const [woTypeFilter, setWoTypeFilter] = useState<string[]>(['CM', 'EM']);
    const [thresholdInput, setThresholdInput] = useState('');
    const [threshold, setThreshold] = useState<number | null>(null);

    const [paretoData, setParetoData] = useState<ParetoResult[]>([]);
    const [paretoLoading, setParetoLoading] = useState(false);
    const [showExplainer, setShowExplainer] = useState(() => {
        try { return localStorage.getItem('ers_pareto_explainer_dismissed') !== 'true'; } catch { return true; }
    });

    // ── Fetch Pareto data ────────────────────────────────────
    useEffect(() => {
        const fetchPareto = async () => {
            setParetoLoading(true);
            try {
                const range = getDateRange(datePreset);
                const params: ParetoParams = {
                    hierarchyLevel,
                    criteria: paretoCriteria,
                    dateFrom: range.from,
                    dateTo: range.to,
                    woTypes: woTypeFilter,
                    limit: 20,
                };
                const results = await analyzeService.getParetoAnalysis(params);
                setParetoData(results);
                onParetoDataChange?.(results, paretoCriteria);
            } catch (e) {
                console.error('[ParetoAnalysisTab] Pareto fetch error:', e);
            } finally {
                setParetoLoading(false);
            }
        };
        fetchPareto();
    }, [paretoCriteria, hierarchyLevel, datePreset, woTypeFilter]);

    const criteriaLabels: Record<ParetoCriteria, string> = { cost: 'By Cost', downtime: 'By Downtime', wo_frequency: 'By Freq' };

    return (
        <div className="space-y-4">
            {/* The explainer banner is gone: it restated the sheet's own subtitle
                ("which assets drive 80% of your cost…") and the action it described
                ("click Investigate on any row") is visible in the table below it. */}

            {/* ── Filter Bar ──────────────────────────────── */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                <div className="flex items-center gap-2 mb-3 text-xs text-slate-600 font-semibold uppercase tracking-wider">
                    <Filter size={14} /> Analysis Parameters
                </div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {/* Criteria */}
                    <div>
                        <label className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1 block">Criteria</label>
                        <div className="flex rounded-lg overflow-hidden border border-slate-300">
                            {(['cost', 'downtime', 'wo_frequency'] as ParetoCriteria[]).map(c => (
                                <button
                                    key={c}
                                    onClick={() => setParetoCriteria(c)}
                                    className={`flex-1 px-2 py-1.5 text-xs font-medium transition-colors ${paretoCriteria === c ? 'bg-accent-cyan text-brand-900' : 'bg-slate-50 text-slate-600 hover:text-slate-800'}`}
                                >
                                    {criteriaLabels[c]}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Hierarchy Level */}
                    <div>
                        <label className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1 block">Roll-Up Level</label>
                        <select
                            value={hierarchyLevel}
                            onChange={e => setHierarchyLevel(e.target.value as HierarchyLevel)}
                            className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:border-accent-cyan"
                        >
                            {HIERARCHY_LEVELS.map(h => (
                                <option key={h.value} value={h.value}>{h.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Date Range */}
                    <div>
                        <label className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1 block">Date Range</label>
                        <select
                            value={datePreset}
                            onChange={e => setDatePreset(e.target.value as DatePreset)}
                            className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:border-accent-cyan"
                        >
                            {DATE_PRESETS.map(d => (
                                <option key={d.value} value={d.value}>{d.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* WO Type Filter */}
                    <div>
                        <label className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1 block">WO Types</label>
                        <div className="flex rounded-lg overflow-hidden border border-slate-300">
                            {[
                                { val: ['CM', 'EM'], label: 'Corrective' },
                                { val: ['CM', 'EM', 'PM'], label: '+ PM cost' },
                            ].map(opt => (
                                <button
                                    key={opt.label}
                                    onClick={() => setWoTypeFilter(opt.val)}
                                    className={`flex-1 px-2 py-1.5 text-xs font-medium transition-colors ${JSON.stringify(woTypeFilter) === JSON.stringify(opt.val) ? 'bg-accent-cyan text-brand-900' : 'bg-slate-50 text-slate-600 hover:text-slate-800'}`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Threshold */}
                    <div>
                        <label className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1 block">Threshold</label>
                        <div className="flex gap-1">
                            <input
                                type="number"
                                placeholder="e.g. 11"
                                value={thresholdInput}
                                onChange={e => setThresholdInput(e.target.value)}
                                onBlur={() => setThreshold(thresholdInput ? parseFloat(thresholdInput) : null)}
                                onKeyDown={e => { if (e.key === 'Enter') setThreshold(thresholdInput ? parseFloat(thresholdInput) : null); }}
                                className="flex-1 bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-accent-cyan w-full"
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Pareto Chart Card ───────────────────────── */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-lg">
                <div className="p-5 border-b border-slate-200 flex justify-between items-center">
                    <div className="flex items-center space-x-3">
                        <div className="p-2 bg-accent-cyan/10 rounded-lg">
                            <BarChart2 className="text-accent-cyan" size={20} />
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold text-slate-800">Bad Actor Pareto Analysis</h3>
                            <p className="text-xs text-slate-500 mt-0.5">
                                {criteriaLabels[paretoCriteria]} · {hierarchyLevel} level · Top {paretoData.length} assets
                            </p>
                        </div>
                    </div>
                    {paretoLoading && (
                        <div className="w-5 h-5 border-2 border-accent-cyan border-t-transparent rounded-full animate-spin" />
                    )}
                </div>
                <div className="p-4">
                    <ParetoChart
                        data={paretoData}
                        criteria={paretoCriteria}
                        threshold={threshold}
                        onBarClick={onDrillDown}
                    />
                </div>

                {/* Summary stats */}
                {paretoData.length > 0 && (
                    <div className="p-4 border-t border-slate-200 grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="bg-slate-50 rounded-lg p-3 text-center">
                            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Assets Analyzed</p>
                            <p className="text-xl font-bold text-slate-800 mt-1">{paretoData.length}</p>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-3 text-center">
                            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Vital Few (80%)</p>
                            <p className="text-xl font-bold text-red-400 mt-1">{paretoData.filter(d => d.cumulative_pct <= 80).length}</p>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-3 text-center">
                            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Total WOs</p>
                            <p className="text-xl font-bold text-slate-800 mt-1">{paretoData.reduce((s, d) => s + d.event_count, 0)}</p>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-3 text-center">
                            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Worst Actor</p>
                            <p className="text-sm font-bold text-accent-cyan mt-1 truncate">{paretoData[0]?.asset_tag || '—'}</p>
                        </div>
                    </div>
                )}
            </div>

            {/* ── Ranked Table ────────────────────────────── */}
            {paretoData.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                    <div className="p-4 border-b border-slate-200">
                        <h3 className="text-sm font-semibold text-slate-700">Ranked Asset Table</h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-200 text-slate-500 text-xs uppercase tracking-wider">
                                    <th className="p-3 text-left">#</th>
                                    <th className="p-3 text-left">Tag</th>
                                    <th className="p-3 text-left">Asset Name</th>
                                    <th className="p-3 text-center">Crit</th>
                                    <th className="p-3 text-right">Value</th>
                                    <th className="p-3 text-right">WOs</th>
                                    <th className="p-3 text-right">% Total</th>
                                    <th className="p-3 text-right">Cumul %</th>
                                    <th className="p-3 text-center">Zone</th>
                                    {(onInvestigate || onAutoDraftRCA) && <th className="p-3 text-center">Action</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {paretoData.map((d) => (
                                    <tr
                                        key={d.asset_id}
                                        onClick={() => onDrillDown(d)}
                                        className="border-b border-slate-200/50 hover:bg-slate-50 cursor-pointer transition-colors"
                                    >
                                        <td className="p-3 font-mono text-slate-500">{d.rank}</td>
                                        <td className="p-3 font-medium text-accent-cyan">{d.asset_tag}</td>
                                        <td className="p-3 text-slate-700 truncate max-w-[200px]">{d.asset_name}</td>
                                        <td className="p-3 text-center">
                                            <span className={`inline-flex w-6 h-6 rounded-full items-center justify-center text-[10px] font-bold ${d.criticality === 'A' ? 'bg-red-500/20 text-red-400' : d.criticality === 'B' ? 'bg-amber-500/20 text-amber-400' : 'bg-green-500/20 text-green-400'}`}>
                                                {d.criticality}
                                            </span>
                                        </td>
                                        <td className="p-3 text-right font-mono text-slate-700">
                                            {d.metric_unit === '$' ? '$' : ''}{d.metric_value.toLocaleString()}{d.metric_unit !== '$' ? ` ${d.metric_unit}` : ''}
                                        </td>
                                        <td className="p-3 text-right font-mono text-blue-400">{d.event_count}</td>
                                        <td className="p-3 text-right text-slate-600">{d.pct_of_total.toFixed(1)}%</td>
                                        <td className="p-3 text-right font-medium text-amber-400">{d.cumulative_pct.toFixed(1)}%</td>
                                        <td className="p-3 text-center">
                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${d.cumulative_pct <= 80 ? 'bg-red-500/10 text-red-400' : 'bg-slate-50 text-slate-500'}`}>
                                                {d.cumulative_pct <= 80 ? 'VITAL' : 'MANY'}
                                            </span>
                                        </td>
                                        {(onInvestigate || onAutoDraftRCA) && (
                                            <td className="p-3 text-center">
                                                <div className="flex items-center justify-center gap-1.5">
                                                    {onInvestigate && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); onInvestigate(d); }}
                                                            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                                                                d.cumulative_pct <= 80
                                                                    ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20'
                                                                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200 border border-slate-200'
                                                            }`}
                                                        >
                                                            <Search size={11} /> Investigate
                                                        </button>
                                                    )}
                                                    {onAutoDraftRCA && d.cumulative_pct <= 80 && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleAutoDraftRCA(d); }}
                                                            disabled={draftingRCA === d.asset_id}
                                                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 transition-colors disabled:opacity-50"
                                                        >
                                                            {draftingRCA === d.asset_id ? <Loader2 size={11} className="animate-spin" /> : <Bot size={11} />}
                                                            Draft RCA
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ParetoAnalysisTab;
