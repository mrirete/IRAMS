import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Activity, AlertTriangle, ShieldCheck, HeartPulse, Clock, Search, ChevronDown, Gauge, Thermometer, Wind, Droplets, Plus, X, CheckCircle, Cpu, Zap, BarChart2, Target, Filter, Check, LayoutGrid, Layers, BarChart3, Wrench, FileWarning, Loader2 } from 'lucide-react';
import { useIntelligence } from '../hooks/useIntelligence';
import { useAssetLookup } from '../hooks/useAssetLookup';
import { PredictOverviewTab } from '../components/predict/PredictOverviewTab';
import { DigitalTwinTab } from '../components/predict/DigitalTwinTab';
import { RULReliabilityTab } from '../components/predict/RULReliabilityTab';
import { ScrollTabStrip } from '../eam/components/ui';
import predictionService from '../eam/services/PredictionService';
import { DatabaseService } from '../eam/services/DatabaseService';
import type { FleetAssetHealth } from '../types/intelligence';
import { supabase } from '../eam/lib/supabase';
import { failureIntervalsHours, isFailure } from '../eam/services/reliabilityMetrics';
import { groundedRulFromHistory, type GroundedRul } from '../lib/pmRecommendation';
import { ReliabilityAdvisorModal } from '../components/analyze/ReliabilityAdvisorModal';

type InsightType = 'digital_twin' | 'rul_analysis' | 'alert_config' | 'degradation_model';

interface NewInsightForm {
    title: string;
    type: InsightType;
    asset_id: string;
    description: string;
}

const INSIGHT_TYPES: { value: InsightType; label: string; description: string; icon: React.ReactNode; color: string }[] = [
    { value: 'digital_twin', label: 'Digital Twin Snapshot', description: 'Create a new health baseline for an asset digital twin with current sensor data', icon: <Cpu size={20} />, color: 'text-accent-cyan bg-accent-cyan/10 border-accent-cyan/30' },
    { value: 'rul_analysis', label: 'RUL Forecast', description: 'Heuristic Remaining Useful Life estimate from health-index trend (experimental — for rigorous fits use Reliability Modelling)', icon: <Clock size={20} />, color: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
    { value: 'alert_config', label: 'Prediction Alert Rule', description: 'Configure AI-driven alert thresholds for vibration, temperature, or flow anomalies', icon: <Zap size={20} />, color: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/30' },
    { value: 'degradation_model', label: 'Degradation Model', description: 'Fit a degradation curve (corrosion / erosion / fatigue) to time-series failure data', icon: <BarChart2 size={20} />, color: 'text-red-400 bg-red-500/10 border-red-500/30' },
];

type PredictTab = 'overview' | 'twin' | 'rul';

const PREDICT_TABS: { id: PredictTab; label: string; icon: React.ReactNode; description: string }[] = [
    { id: 'overview', label: 'Overview', icon: <LayoutGrid size={16} />, description: 'Fleet health, KPIs & sensors' },
    { id: 'twin', label: 'Digital Twin', icon: <Layers size={16} />, description: 'Trajectory & degradation' },
    { id: 'rul', label: 'RUL & Reliability', icon: <BarChart3 size={16} />, description: 'Failure forecast & alerts' },
];

export const PredictPage: React.FC = () => {
    const [selectedAssetId, setSelectedAssetId] = useState('');
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<PredictTab>('overview');
    const [assetSearch, setAssetSearch] = useState('');
    const [showNewInsight, setShowNewInsight] = useState(false);
    const [insightForm, setInsightForm] = useState<NewInsightForm>({ title: '', type: 'digital_twin', asset_id: '', description: '' });
    const [insightCreated, setInsightCreated] = useState(false);
    const [predictionRunning, setPredictionRunning] = useState(false);
    const [predictionError, setPredictionError] = useState<string | null>(null);
    const [predictionMessage, setPredictionMessage] = useState('');
    const [manageFleetOpen, setManageFleetOpen] = useState(false);
    const [hiddenFleetIds, setHiddenFleetIds] = useState<Set<string>>(new Set());
    const [fleetSearch, setFleetSearch] = useState('');
    const fleetFilterRef = useRef<HTMLDivElement>(null);

    // ── Corrective Work Request Modal state ──
    const [wrModalOpen, setWrModalOpen] = useState(false);
    const [wrSubmitting, setWrSubmitting] = useState(false);
    const [wrSuccess, setWrSuccess] = useState(false);
    const [wrError, setWrError] = useState<string | null>(null);
    const [wrForm, setWrForm] = useState({ title: '', description: '', priority: 'ROUTINE' as string, workType: 'CM' as string });

    const { assetOptions, getAssetById } = useAssetLookup();

    // ── #1: data-grounded RUL (real Weibull MRL) for the selected asset ──
    const [advisorOpen, setAdvisorOpen] = useState(false);
    const [groundedRul, setGroundedRul] = useState<GroundedRul | null>(null);
    useEffect(() => {
        if (!selectedAssetId) { setGroundedRul(null); return; }
        let active = true;
        (async () => {
            const { data: wos } = await supabase.from('work_orders')
                .select('id, type, created_at, closed_at, wo_failure_data(failure_mode_code)')
                .eq('asset_id', selectedAssetId).order('created_at');
            if (!active) return;
            const rows = wos || [];
            const intervals = failureIntervalsHours(rows);
            const lastFail = rows.filter(isFailure)
                .map((w: any) => new Date(w.closed_at || w.created_at).getTime())
                .sort((a, b) => b - a)[0];
            const susp = lastFail ? [Math.max(1, Math.floor((Date.now() - lastFail) / 3600000))] : [];
            setGroundedRul(groundedRulFromHistory(intervals, susp));
        })();
        return () => { active = false; };
    }, [selectedAssetId]);

    // Close fleet filter on outside click
    useEffect(() => {
        if (!manageFleetOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (fleetFilterRef.current && !fleetFilterRef.current.contains(e.target as Node)) {
                setManageFleetOpen(false);
                setFleetSearch('');
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [manageFleetOpen]);

    // Auto-select the first equipment asset once real data loads
    useEffect(() => {
        if (!selectedAssetId && assetOptions.length > 0) {
            setSelectedAssetId(assetOptions[0].id);
        }
    }, [assetOptions, selectedAssetId]);

    const { loading, twinHealth, rulEstimate, getAssetAlerts, getSensorTrends, refetchPredict } = useIntelligence(selectedAssetId);

    const selectedAsset = getAssetById(selectedAssetId);
    const assetAlerts = useMemo(() => getAssetAlerts(selectedAssetId), [getAssetAlerts, selectedAssetId]);
    const assetSensorTrends = useMemo(() => getSensorTrends(selectedAssetId), [getSensorTrends, selectedAssetId]);

    const filteredAssets = useMemo(() => {
        const q = assetSearch.toLowerCase();
        return assetOptions.filter(a => a.name.toLowerCase().includes(q) || a.system.toLowerCase().includes(q) || a.tag.toLowerCase().includes(q));
    }, [assetSearch, assetOptions]);

    // ── Fleet data from Supabase ──────────────────────────
    const [fleetData, setFleetData] = useState<FleetAssetHealth[]>([]);
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [twins, ruls, dbAlerts] = await Promise.all([
                    predictionService.getTwinStates(),
                    predictionService.getRULEstimates(),
                    predictionService.getAlerts(),
                ]);
                if (cancelled) return;
                if (twins.length === 0) return; // will fall back to mock

                const rulMap = new Map(ruls.map(r => [r.asset_id, r]));
                const alertCountMap = new Map<string, number>();
                dbAlerts.forEach(a => alertCountMap.set(a.asset_id, (alertCountMap.get(a.asset_id) || 0) + 1));

                // Build FleetAssetHealth array, enriching each with register data
                // Only include equipment-level assets (exclude SITE/UNIT/SYSTEM hierarchy items)
                // Multi-strategy asset resolution:
                //   1. Exact ID match
                //   2. Fuzzy match by partial ID prefix (twin asset_id might be truncated)
                //   3. Fallback to readable label from asset_id
                const resolveAsset = (assetId: string) => {
                    // Strategy 1: exact
                    const exact = getAssetById(assetId);
                    if (exact) return exact;
                    // Strategy 2: check if any asset id starts with this prefix
                    const matchByPrefix = assetOptions.find(a => a.id.startsWith(assetId) || assetId.startsWith(a.id));
                    if (matchByPrefix) return getAssetById(matchByPrefix.id);
                    return null;
                };

                const fleet: FleetAssetHealth[] = twins
                    .filter(t => {
                        const asset = resolveAsset(t.asset_id);
                        if (!asset) return true; // keep unresolved twins
                        const level = asset.taxonomy_level;
                        return level !== 'site' && level !== 'unit' && level !== 'system';
                    })
                    .map(t => {
                        const rul = rulMap.get(t.asset_id);
                        const hi = Number(t.health_index);
                        const registeredAsset = resolveAsset(t.asset_id);

                        // Human-readable fallback: derive name from sensor keys or show truncated ID
                        const fallbackName = (() => {
                            if (t.sensor_summary && Object.keys(t.sensor_summary).length > 0) {
                                // Try to infer equipment type from sensor tags
                                const keys = Object.keys(t.sensor_summary).join(' ').toLowerCase();
                                if (keys.includes('turbine') || keys.includes('exhaust')) return `Equipment ${t.asset_id.substring(0, 8).toUpperCase()}`;
                                if (keys.includes('pump') || keys.includes('discharge')) return `Equipment ${t.asset_id.substring(0, 8).toUpperCase()}`;
                                if (keys.includes('compressor') || keys.includes('suction')) return `Equipment ${t.asset_id.substring(0, 8).toUpperCase()}`;
                            }
                            return `Equipment ${t.asset_id.substring(0, 8).toUpperCase()}`;
                        })();

                        return {
                            asset_id: t.asset_id,
                            asset_name: registeredAsset
                                ? `${registeredAsset.tag} — ${registeredAsset.name}`
                                : fallbackName,
                            unit: registeredAsset
                                ? (registeredAsset.system || registeredAsset.unit || registeredAsset.site || '-')
                                : '-',
                            criticality: registeredAsset
                                ? (registeredAsset.criticality as 'A' | 'B' | 'C')
                                : (hi < 70 ? 'A' as const : hi < 85 ? 'B' as const : 'C' as const),
                            health_index: hi,
                            rul_days: rul ? Number(rul.rul_days) : 0,
                            trend: hi < 70 ? 'degrading' as const : hi < 85 ? 'stable' as const : 'improving' as const,
                            active_alerts: alertCountMap.get(t.asset_id) || 0,
                        };
                    });

                setFleetData(fleet);
            } catch (err) {
                console.error('[PredictPage] Fleet data fetch error:', err);
            }
        })();
        return () => { cancelled = true; };
    }, [getAssetById, assetOptions]);

    const visibleFleetData = useMemo(() => {
        return fleetData.filter(a => !hiddenFleetIds.has(a.asset_id));
    }, [fleetData, hiddenFleetIds]);

    const toggleAssetVisibility = (id: string) => {
        setHiddenFleetIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    // Fleet list for the filter dropdown: sorted by health (worst first), searchable
    const filteredFleet = useMemo(() => {
        const q = fleetSearch.toLowerCase();
        return [...fleetData]
            .filter(a => !q || a.asset_name.toLowerCase().includes(q) || a.unit.toLowerCase().includes(q))
            .sort((a, b) => a.health_index - b.health_index);
    }, [fleetData, fleetSearch]);

    // ── Ctrl+K keyboard shortcut ──────────────────────────
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                setAssetPickerOpen(prev => !prev);
                setAssetSearch('');
            }
            if (e.key === 'Escape' && assetPickerOpen) {
                setAssetPickerOpen(false);
                setAssetSearch('');
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [assetPickerOpen]);

    if (loading) {
        return (
            <div className="space-y-6 animate-pulse">
                {/* Skeleton Header */}
                <div className="h-8 w-64 bg-brand-800 rounded" />
                <div className="h-4 w-96 bg-brand-800 rounded" />
                {/* Skeleton Metric Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 h-24" />
                    ))}
                </div>
                {/* Skeleton Chart */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl h-96" />
                    <div className="bg-white border border-slate-200 rounded-xl h-96" />
                </div>
            </div>
        );
    }

    const systemHealth = twinHealth?.health_index || 0;
    const isHealthy = systemHealth >= 80;
    const critLevel = selectedAsset?.criticality;
    const critColor = critLevel === 'A' ? 'bg-red-500/20 text-red-400 border-red-500/30' : critLevel === 'B' ? 'bg-yellow-500/20 text-yellow-500 border-yellow-500/30' : 'bg-slate-100 text-brand-300 border-slate-300';

    const handleCreateInsight = async () => {
        setPredictionRunning(true);
        setPredictionError(null);
        setPredictionMessage('');

        try {
            const targetAssetId = insightForm.asset_id || selectedAssetId;
            if (!targetAssetId) {
                setPredictionError('Please select a target asset.');
                setPredictionRunning(false);
                return;
            }

            const result = await predictionService.runPrediction(
                insightForm.type,
                targetAssetId,
                insightForm.title,
                insightForm.description,
            );

            if (result.success) {
                setPredictionMessage(result.message);
                setInsightCreated(true);
                // Refresh the dashboard with updated data
                await refetchPredict(targetAssetId);
                setTimeout(() => {
                    setInsightCreated(false);
                    setShowNewInsight(false);
                    setPredictionMessage('');
                    setInsightForm({ title: '', type: 'digital_twin', asset_id: '', description: '' });
                }, 3000);
            } else {
                setPredictionError(result.message);
            }
        } catch (e: any) {
            setPredictionError(e.message || 'An unexpected error occurred.');
        } finally {
            setPredictionRunning(false);
        }
    };


    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Page Header */}
            <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-4">
                <div>
                    <div className="flex items-center gap-2.5">
                        <h1 className="text-2xl font-bold text-slate-800 font-sans tracking-tight">Predictive Insights</h1>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700 border border-amber-200">
                            <FileWarning size={11} /> Experimental
                        </span>
                    </div>
                    <p className="text-slate-500 text-sm mt-1">Condition-based health monitoring & heuristic forecasts — directional triage, not a fitted reliability model</p>
                </div>

                <div className="flex items-center gap-3">
                    {/* #2: Reliability Advisor — grounded, cited PM proposal for this asset */}
                    <button
                        onClick={() => setAdvisorOpen(true)}
                        disabled={!selectedAssetId}
                        title="Run the Reliability Advisor: real Weibull RUL + cost-justified PM proposal you can approve"
                        className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors"
                    >
                        <Cpu size={16} /> Reliability Advisor
                    </button>
                    {/* New Insight Button */}
                    <button
                        onClick={() => setShowNewInsight(true)}
                        className="flex items-center gap-2 px-4 py-2.5 bg-accent-cyan hover:bg-primary-400 text-brand-900 font-semibold rounded-lg text-sm transition-colors shadow-[0_0_15px_rgba(6,182,212,0.2)]"
                    >
                        <Plus size={16} /> New Prediction
                    </button>

                    {/* Slim Focused Asset Display + Search Trigger */}
                    <button
                        onClick={() => { setAssetPickerOpen(true); setAssetSearch(''); }}
                        className="flex items-center gap-3 px-4 py-2.5 bg-white border border-slate-200 rounded-lg hover:border-accent-cyan/50 hover:shadow-md transition-all min-w-[260px] group"
                        title="Ctrl+K to search"
                    >
                        <div className="flex-1 text-left">
                            <p className="text-sm font-semibold text-slate-800 group-hover:text-accent-cyan transition-colors truncate">{selectedAsset?.name || selectedAssetId || 'Select asset...'}</p>
                            <p className="text-[10px] text-slate-400 truncate">{selectedAsset?.system || 'Click or press Ctrl+K'}</p>
                        </div>
                        <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border ${critColor}`}>
                            Crit {critLevel || '?'}
                        </span>
                        <Search size={16} className="text-slate-400 group-hover:text-accent-cyan transition-colors shrink-0" />
                    </button>
                </div>
            </div>

            {/* ═══ Experimental disclaimer — keep heuristic forecasts from being mistaken for fitted reliability models ═══ */}
            <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-card text-sm">
                <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                <p className="text-amber-800 leading-relaxed">
                    <strong>Experimental:</strong> Health Index and RUL here are <strong>heuristic estimates</strong> from condition trends — useful for triage, not for life decisions. For rigorous Weibull fits and Monte-Carlo availability analysis, use{' '}
                    <a href="/reliability-modelling" className="font-semibold underline decoration-amber-400 underline-offset-2 hover:text-amber-900">Reliability Modelling</a>.
                </p>
            </div>

            {/* ═══ Command Palette Modal ═══ */}
            {assetPickerOpen && (
                <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] bg-black/50 backdrop-blur-sm animate-in fade-in duration-150" onClick={() => { setAssetPickerOpen(false); setAssetSearch(''); }}>
                    <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl shadow-black/30 border border-slate-200 overflow-hidden animate-in slide-in-from-top-4 duration-200" onClick={e => e.stopPropagation()}>
                        {/* Search Input */}
                        <div className="p-4 border-b border-slate-200">
                            <div className="relative">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                <input
                                    type="text"
                                    placeholder="Search by tag, name, or system..."
                                    value={assetSearch}
                                    onChange={e => setAssetSearch(e.target.value)}
                                    className="w-full pl-12 pr-20 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-accent-cyan/40 focus:border-accent-cyan placeholder:text-slate-400 font-medium"
                                    autoFocus
                                />
                                <kbd className="absolute right-3 top-1/2 -translate-y-1/2 px-2 py-0.5 text-[10px] font-mono font-bold bg-slate-100 text-slate-400 border border-slate-200 rounded">ESC</kbd>
                            </div>
                        </div>

                        {/* Results — grouped by system */}
                        <div className="max-h-[50vh] overflow-y-auto">
                            {filteredAssets.length === 0 ? (
                                <div className="p-8 text-center">
                                    <Search size={32} className="mx-auto mb-2 text-slate-300" />
                                    <p className="text-sm font-medium text-slate-500">No matching assets</p>
                                    <p className="text-xs text-slate-400 mt-1">Try a different search term</p>
                                </div>
                            ) : (() => {
                                // Group filtered assets by system
                                const systemGroups = new Map<string, typeof filteredAssets>();
                                filteredAssets.forEach(asset => {
                                    const sys = asset.system || 'Unassigned';
                                    if (!systemGroups.has(sys)) systemGroups.set(sys, []);
                                    systemGroups.get(sys)!.push(asset);
                                });

                                return Array.from(systemGroups.entries()).map(([systemName, assets]) => (
                                    <div key={systemName}>
                                        {/* System Group Header */}
                                        <div className="sticky top-0 z-10 px-5 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                                            <span className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                                <Layers size={11} className="text-slate-400" /> {systemName}
                                            </span>
                                            <span className="text-[10px] text-slate-400">{assets.length} asset{assets.length !== 1 ? 's' : ''}</span>
                                        </div>
                                        {assets.map((asset, idx) => {
                                            const isActive = asset.id === selectedAssetId;
                                            const aCritColor = asset.criticality === 'A' ? 'bg-red-500/15 text-red-500 border-red-500/30' : asset.criticality === 'B' ? 'bg-yellow-500/15 text-yellow-600 border-yellow-500/30' : 'bg-slate-100 text-slate-500 border-slate-300';
                                            const fleetMatch = fleetData.find(f => f.asset_id === asset.id);
                                            const hi = fleetMatch?.health_index;
                                            const healthDot = hi != null ? (hi >= 85 ? 'bg-emerald-500' : hi >= 70 ? 'bg-yellow-500' : hi >= 55 ? 'bg-orange-500' : 'bg-red-500') : 'bg-slate-300';

                                            return (
                                                <button
                                                    key={asset.id}
                                                    onClick={() => { setSelectedAssetId(asset.id); setAssetPickerOpen(false); setAssetSearch(''); }}
                                                    className={`w-full flex items-center gap-3 px-5 py-3 text-left transition-all hover:bg-slate-50 ${isActive ? 'bg-accent-cyan/5 border-l-[3px] border-l-accent-cyan' : 'border-l-[3px] border-l-transparent'} ${idx > 0 ? 'border-t border-t-slate-50' : ''}`}
                                                >
                                                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${healthDot}`} />
                                                    <div className="flex-1 min-w-0">
                                                        <p className={`text-sm font-semibold truncate ${isActive ? 'text-accent-cyan' : 'text-slate-800'}`}>
                                                            {asset.tag} — {asset.name}
                                                        </p>
                                                        <div className="flex items-center gap-2 mt-0.5">
                                                            {hi != null && (
                                                                <span className={`text-[10px] font-bold ${hi >= 70 ? 'text-slate-500' : 'text-red-500'}`}>HI: {hi.toFixed(0)}</span>
                                                            )}
                                                            {fleetMatch && fleetMatch.rul_days > 0 && (
                                                                <>
                                                                    <span className="text-[10px] text-slate-300">·</span>
                                                                    <span className={`text-[10px] ${fleetMatch.rul_days < 90 ? 'text-red-500 font-bold' : 'text-slate-400'}`}>RUL: {fleetMatch.rul_days}d</span>
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${aCritColor}`}>
                                                        {asset.criticality}
                                                    </span>
                                                    {isActive && <CheckCircle size={16} className="text-accent-cyan shrink-0" />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                ));
                            })()}
                        </div>

                        {/* Footer */}
                        <div className="p-2.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-[10px] text-slate-400">
                            <span>{filteredAssets.length} asset{filteredAssets.length !== 1 ? 's' : ''} · {new Set(filteredAssets.map(a => a.system)).size} system{new Set(filteredAssets.map(a => a.system)).size !== 1 ? 's' : ''}</span>
                            <div className="flex items-center gap-3">
                                <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 bg-white border border-slate-200 rounded font-mono text-[9px]">↑↓</kbd> Navigate</span>
                                <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 bg-white border border-slate-200 rounded font-mono text-[9px]">Ctrl+K</kbd> Toggle</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {/* ═══ New Predictive Insight Modal ═══ */}
            {showNewInsight && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => !insightCreated && setShowNewInsight(false)}>
                    <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-xl mx-4 shadow-2xl shadow-black/50 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                        {/* Modal Header */}
                        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-accent-cyan/10 rounded-lg text-accent-cyan">
                                    <Target size={20} />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-slate-800">New Predictive Insight</h2>
                                    <p className="text-xs text-slate-500 mt-0.5">ISO 55000 · Governance Tier auto-assigned</p>
                                </div>
                            </div>
                            <button onClick={() => setShowNewInsight(false)} className="p-1.5 text-slate-500 hover:text-brand-200 hover:bg-slate-100 rounded-lg transition-colors">
                                <X size={18} />
                            </button>
                        </div>

                        {predictionRunning ? (
                            <div className="p-12 flex flex-col items-center gap-4 animate-in zoom-in-95 duration-300">
                                <div className="p-4 bg-accent-cyan/10 rounded-2xl text-accent-cyan ring-4 ring-accent-cyan/10 animate-pulse">
                                    <Cpu size={40} className="animate-spin" style={{ animationDuration: '3s' }} />
                                </div>
                                <h3 className="text-lg font-bold text-slate-800">Computing Prediction…</h3>
                                <p className="text-sm text-slate-500 text-center">
                                    Running <span className="text-accent-cyan font-medium">{INSIGHT_TYPES.find(t => t.value === insightForm.type)?.label}</span> against sensor data and models.
                                </p>
                            </div>
                        ) : insightCreated ? (
                            <div className="p-12 flex flex-col items-center gap-4 animate-in zoom-in-95 duration-300">
                                <div className="p-4 bg-accent-safe/10 rounded-2xl text-accent-safe ring-4 ring-accent-safe/10">
                                    <CheckCircle size={40} />
                                </div>
                                <h3 className="text-lg font-bold text-slate-800">Prediction Complete</h3>
                                <p className="text-sm text-slate-500 text-center">
                                    {predictionMessage || 'Results have been written to the database.'}
                                </p>
                                <p className="text-xs text-accent-cyan mt-1">Dashboard refreshed ✓</p>
                            </div>
                        ) : (
                            <div className="p-6 space-y-5">
                                {/* Prediction Type Selector */}
                                <div>
                                    <label className="block text-xs font-bold text-brand-300 uppercase tracking-wider mb-3">Prediction Type</label>
                                    <div className="grid grid-cols-2 gap-3">
                                        {INSIGHT_TYPES.map(t => (
                                            <button
                                                key={t.value}
                                                onClick={() => setInsightForm(f => ({ ...f, type: t.value }))}
                                                className={`p-3 rounded-xl border text-left transition-all ${insightForm.type === t.value
                                                    ? `${t.color} ring-2 ring-current/30 shadow-lg`
                                                    : 'bg-slate-50 border-slate-200 text-brand-300 hover:border-slate-300'
                                                    }`}
                                            >
                                                <div className="flex items-center gap-2 mb-1.5">
                                                    {t.icon}
                                                    <span className="text-sm font-semibold">{t.label}</span>
                                                </div>
                                                <p className="text-[11px] opacity-70 leading-snug">{t.description}</p>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Title */}
                                <div>
                                    <label className="block text-xs font-bold text-brand-300 uppercase tracking-wider mb-2">Title</label>
                                    <input
                                        type="text"
                                        value={insightForm.title}
                                        onChange={e => setInsightForm(f => ({ ...f, title: e.target.value }))}
                                        placeholder={`e.g. ${insightForm.type === 'digital_twin' ? 'K-601 February Health Baseline' : insightForm.type === 'rul_analysis' ? 'K-601 Bearing RUL Forecast' : insightForm.type === 'alert_config' ? 'Vibration Anomaly Alert - K-601' : 'K-601 Hot Gas Path Corrosion Model'}`}
                                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500 placeholder-brand-600"
                                    />
                                </div>

                                {/* Asset Selection */}
                                <div>
                                    <label className="block text-xs font-bold text-brand-300 uppercase tracking-wider mb-2">Target Asset</label>
                                    <select
                                        value={insightForm.asset_id}
                                        onChange={e => setInsightForm(f => ({ ...f, asset_id: e.target.value }))}
                                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500 appearance-none cursor-pointer"
                                    >
                                        <option value="" className="text-brand-600">Select asset…</option>
                                        {assetOptions.map(a => (
                                            <option key={a.id} value={a.id}>{a.tag} — {a.name}</option>
                                        ))}
                                    </select>
                                </div>

                                {/* Description */}
                                <div>
                                    <label className="block text-xs font-bold text-brand-300 uppercase tracking-wider mb-2">Notes / Context</label>
                                    <textarea
                                        value={insightForm.description}
                                        onChange={e => setInsightForm(f => ({ ...f, description: e.target.value }))}
                                        rows={3}
                                        placeholder="Any context, trigger events, or specific parameters for this prediction…"
                                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500 placeholder-brand-600 resize-none"
                                    />
                                </div>
                            </div>
                        )}

                        {/* Modal Footer */}
                        {!insightCreated && !predictionRunning && (
                            <div className="p-6 pt-0 space-y-3">
                                {predictionError && (
                                    <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
                                        <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                                        <span>{predictionError}</span>
                                    </div>
                                )}
                                <div className="flex justify-end gap-3">
                                    <button
                                        onClick={() => { setShowNewInsight(false); setPredictionError(null); }}
                                        className="px-4 py-2 bg-slate-50 border border-slate-200 text-brand-300 hover:bg-slate-100 rounded-lg text-sm font-medium transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleCreateInsight}
                                        disabled={!insightForm.title || !insightForm.asset_id}
                                        className="px-6 py-2 bg-accent-cyan hover:bg-primary-400 disabled:opacity-40 disabled:cursor-not-allowed text-brand-900 font-bold rounded-lg text-sm transition-colors shadow-[0_0_15px_rgba(6,182,212,0.2)] flex items-center gap-2"
                                    >
                                        <Cpu size={16} /> Run Prediction
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ═══ FOCUSED ASSET BANNER — with integrated asset selector ═══ */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="flex items-stretch">
                    {/* Left accent stripe */}
                    <div className={`w-1.5 shrink-0 ${isHealthy ? 'bg-emerald-500' : systemHealth >= 60 ? 'bg-amber-500' : 'bg-red-500'}`} />

                    <div className="flex-1 flex items-center justify-between px-5 py-4">
                        {/* Left: Asset info + clickable selector */}
                        <button
                            onClick={() => { setAssetPickerOpen(true); setAssetSearch(''); }}
                            className="flex items-center gap-4 text-left hover:bg-slate-50 -mx-2 px-2 py-1 rounded-lg transition-colors group"
                            title="Click to change asset · Ctrl+K"
                        >
                            <div className={`p-3 rounded-xl border transition-colors ${isHealthy ? 'bg-emerald-50 border-emerald-200 text-emerald-600 group-hover:bg-emerald-100' : systemHealth >= 60 ? 'bg-amber-50 border-amber-200 text-amber-600 group-hover:bg-amber-100' : 'bg-red-50 border-red-200 text-red-500 group-hover:bg-red-100'}`}>
                                <Target size={24} />
                            </div>
                            <div>
                                <div className="flex items-center gap-2 mb-0.5">
                                    <p className="text-[9px] text-slate-400 uppercase tracking-widest font-bold">Focused Asset</p>
                                    <span className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded border ${critColor}`}>Crit {critLevel || '?'}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <h2 className="text-lg font-bold text-slate-800 leading-tight group-hover:text-primary-700 transition-colors">{selectedAsset?.name || selectedAssetId}</h2>
                                    <ChevronDown size={14} className="text-slate-300 group-hover:text-primary-500 transition-colors" />
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                    {selectedAsset?.system && (
                                        <span className="flex items-center gap-1 text-[10px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                                            <Layers size={10} /> {selectedAsset.system}
                                        </span>
                                    )}
                                    {selectedAsset?.tag && (
                                        <span className="text-[10px] text-slate-400 font-mono">{selectedAsset.tag}</span>
                                    )}
                                </div>
                            </div>
                        </button>

                        {/* Right: RUL (data-grounded when failure history exists) + Health gauge */}
                        <div className="flex items-center gap-5">
                            {groundedRul?.method === 'weibull-mrl' && groundedRul.rulDays != null ? (
                                <div className="text-right border-r border-slate-100 pr-5">
                                    <p className="text-[9px] text-emerald-600 uppercase tracking-wider font-bold mb-1">RUL · data-grounded</p>
                                    <div className="flex items-baseline gap-1 justify-end">
                                        <span className={`text-2xl font-bold tabular-nums ${groundedRul.rulDays < 90 ? 'text-red-500' : 'text-slate-800'}`}>{groundedRul.rulDays}</span>
                                        <span className="text-sm text-slate-400 font-medium">days</span>
                                    </div>
                                    <p className="text-[9px] text-slate-400 mt-0.5" title={groundedRul.note}>Weibull MRL · not heuristic</p>
                                </div>
                            ) : rulEstimate?.rul_days ? (
                                <div className="text-right border-r border-slate-100 pr-5">
                                    <p className="text-[9px] text-amber-600 uppercase tracking-wider font-bold mb-1">RUL · heuristic</p>
                                    <div className="flex items-baseline gap-1 justify-end">
                                        <span className="text-2xl font-bold tabular-nums text-slate-500">{rulEstimate.rul_days.toFixed(0)}</span>
                                        <span className="text-sm text-slate-400 font-medium">days</span>
                                    </div>
                                    <p className="text-[9px] text-slate-400 mt-0.5">Thin data — directional only</p>
                                </div>
                            ) : null}
                            <div className="text-right">
                                <p className="text-[9px] text-slate-400 uppercase tracking-wider font-bold mb-1">Health Index</p>
                                <div className="flex items-baseline gap-1">
                                    <span className={`text-3xl font-bold tabular-nums ${isHealthy ? 'text-emerald-600' : systemHealth >= 60 ? 'text-amber-500' : 'text-red-500'}`}>
                                        {systemHealth.toFixed(1)}
                                    </span>
                                    <span className="text-sm text-slate-400 font-medium">/ 100</span>
                                </div>
                                <div className="mt-1.5 w-28 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                    <div
                                        className={`h-full rounded-full transition-all ${isHealthy ? 'bg-emerald-500' : systemHealth >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                                        style={{ width: `${systemHealth}%` }}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ═══ TAB NAVIGATION ═══ */}
            <ScrollTabStrip activeId={activeTab} className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 shadow-sm">
                {PREDICT_TABS.map(tab => (
                    <button
                        key={tab.id}
                        data-active={activeTab === tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${activeTab === tab.id
                            ? 'bg-accent-cyan text-brand-900 shadow-sm shadow-primary-500/20'
                            : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                            }`}
                    >
                        {tab.icon}
                        <span>{tab.label}</span>
                        <span className={`hidden md:inline text-[10px] font-normal ${activeTab === tab.id ? 'text-brand-900/60' : 'text-slate-400'
                            }`}>— {tab.description}</span>
                    </button>
                ))}
            </ScrollTabStrip>

            {/* ═══ TAB CONTENT ═══ */}
            {activeTab === 'overview' && (
                <PredictOverviewTab
                    selectedAssetId={selectedAssetId}
                    selectedAssetName={selectedAsset?.name || selectedAssetId}
                    onAssetSelect={(id) => { setSelectedAssetId(id); setAssetPickerOpen(false); }}
                    fleetData={fleetData}
                    visibleFleetData={visibleFleetData}
                    totalAssetCount={fleetData.length}
                    filterSlot={
                        <div className="relative" ref={fleetFilterRef}>
                            <button
                                onClick={() => { setManageFleetOpen(!manageFleetOpen); if (!manageFleetOpen) setFleetSearch(''); }}
                                className={`flex items-center gap-2 px-3 py-1.5 border font-semibold rounded-lg text-xs transition-all ${hiddenFleetIds.size > 0 ? 'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100' : 'bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-600'}`}
                            >
                                <Filter size={14} />
                                Filter
                                {hiddenFleetIds.size > 0 && (
                                    <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-500 text-white rounded-full min-w-[18px] text-center">
                                        {fleetData.length - hiddenFleetIds.size}/{fleetData.length}
                                    </span>
                                )}
                            </button>

                            {manageFleetOpen && (
                                <div className="absolute right-0 top-full mt-2 w-96 bg-white border border-slate-200 rounded-xl shadow-2xl shadow-black/20 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                                    <div className="p-3 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                                        <span className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                                            <Activity size={14} className="text-accent-cyan" />
                                            Fleet Assets
                                            <span className="text-xs font-normal text-slate-400">({fleetData.length - hiddenFleetIds.size} of {fleetData.length})</span>
                                        </span>
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => setHiddenFleetIds(new Set())} className="text-xs text-accent-cyan hover:underline font-medium focus:outline-none">Show All</button>
                                            <span className="text-slate-300">|</span>
                                            <button onClick={() => setHiddenFleetIds(new Set(fleetData.map(a => a.asset_id)))} className="text-xs text-slate-500 hover:text-slate-800 hover:underline font-medium focus:outline-none">Hide All</button>
                                        </div>
                                    </div>
                                    <div className="p-2 border-b border-slate-100">
                                        <div className="relative">
                                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={13} />
                                            <input type="text" placeholder="Search assets..." value={fleetSearch} onChange={e => setFleetSearch(e.target.value)} className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-accent-cyan placeholder:text-slate-400" autoFocus />
                                        </div>
                                    </div>
                                    <div className="max-h-72 overflow-y-auto p-1">
                                        {filteredFleet.length === 0 ? (
                                            <div className="p-4 text-center text-sm text-slate-400">{fleetData.length === 0 ? 'No assets available.' : 'No matching assets.'}</div>
                                        ) : (
                                            filteredFleet.map(asset => {
                                                const isHidden = hiddenFleetIds.has(asset.asset_id);
                                                const hi = asset.health_index;
                                                const healthDotColor = hi >= 85 ? 'bg-emerald-500' : hi >= 70 ? 'bg-yellow-500' : hi >= 55 ? 'bg-orange-500' : 'bg-red-500';
                                                const cColor = asset.criticality === 'A' ? 'bg-red-500/15 text-red-500 border-red-500/30' : asset.criticality === 'B' ? 'bg-yellow-500/15 text-yellow-600 border-yellow-500/30' : 'bg-slate-100 text-slate-500 border-slate-300';
                                                return (
                                                    <button key={asset.asset_id} onClick={() => toggleAssetVisibility(asset.asset_id)} className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left rounded-lg transition-all group ${isHidden ? 'opacity-50 hover:opacity-75' : 'hover:bg-slate-50'}`}>
                                                        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${healthDotColor} ${isHidden ? 'opacity-40' : ''}`} />
                                                        <div className="flex-1 min-w-0">
                                                            <p className={`text-sm font-medium truncate transition-colors ${isHidden ? 'text-slate-400 line-through decoration-slate-300' : 'text-slate-700 group-hover:text-accent-cyan'}`}>{asset.asset_name}</p>
                                                            <div className="flex items-center gap-2 mt-0.5">
                                                                <span className="text-[10px] text-slate-400 truncate">{asset.unit}</span>
                                                                <span className="text-[10px] text-slate-400">·</span>
                                                                <span className={`text-[10px] font-bold ${hi >= 70 ? 'text-slate-500' : 'text-red-500'}`}>HI: {hi.toFixed(0)}</span>
                                                                {asset.rul_days > 0 && (<><span className="text-[10px] text-slate-400">·</span><span className={`text-[10px] ${asset.rul_days < 90 ? 'text-red-500 font-bold' : 'text-slate-400'}`}>RUL: {asset.rul_days}d</span></>)}
                                                            </div>
                                                        </div>
                                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${cColor}`}>{asset.criticality}</span>
                                                        <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 border transition-all ${isHidden ? 'bg-white border-slate-300' : 'bg-accent-cyan border-accent-cyan text-white shadow-sm shadow-primary-500/20'}`}>{!isHidden && <Check size={14} strokeWidth={3} />}</div>
                                                    </button>
                                                );
                                            })
                                        )}
                                    </div>
                                    <div className={`p-2.5 border-t text-xs text-center font-medium ${hiddenFleetIds.size > 0 ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-slate-100 bg-slate-50 text-slate-400'}`}>
                                        {hiddenFleetIds.size > 0 ? `${hiddenFleetIds.size} asset(s) hidden · Avg Health recalculated` : 'All assets visible'}
                                    </div>
                                </div>
                            )}
                        </div>
                    }
                    systemHealth={systemHealth}
                    isHealthy={isHealthy}
                    rulDays={rulEstimate?.rul_days}
                    alertCount={assetAlerts.length}
                    rulConfidenceBands={rulEstimate?.confidence_bands || []}
                    distributionType={rulEstimate?.distribution_type || null}
                    rulConfidence={rulEstimate?.confidence ?? null}
                    twinHealth={twinHealth}
                    assetSensorTrends={assetSensorTrends}
                    onInvestigate={() => window.location.href = '/analyze'}
                    onCreateWR={() => {
                        // Pre-populate WR form from health data
                        const hiVal = systemHealth.toFixed(1);
                        const critLabel = critLevel || 'B';
                        const assetName = selectedAsset?.name || selectedAssetId;
                        const assetTag = selectedAsset?.tag || '';
                        const rulVal = rulEstimate?.rul_days?.toFixed(0) || 'N/A';

                        // Auto-calculate priority: Crit A + HI<70 = EMERGENCY, Crit A + HI<85 = URGENT, else ROUTINE
                        const autoPriority = critLabel === 'A' && systemHealth < 70 ? 'EMERGENCY'
                            : (critLabel === 'A' || systemHealth < 60) ? 'URGENT'
                            : systemHealth < 75 ? 'ROUTINE' : 'ROUTINE';

                        setWrForm({
                            title: `PdM — Corrective action on ${assetTag || assetName}`,
                            description: `Auto-generated from Predictive Insights.\n\nAsset: ${assetTag} — ${assetName}\nHealth Index: ${hiVal}/100\nRemaining Useful Life: ${rulVal} days\nCriticality: ${critLabel}\nAlerts: ${assetAlerts.length}\n\nCondition monitoring indicates degradation. Investigate and perform corrective maintenance per ISO 55000.`,
                            priority: autoPriority,
                            workType: 'CM',
                        });
                        setWrModalOpen(true);
                        setWrSuccess(false);
                        setWrError(null);
                    }}
                />
            )}

            {activeTab === 'twin' && (
                <DigitalTwinTab
                    twinHealth={twinHealth}
                    rulEstimate={rulEstimate}
                    selectedAssetId={selectedAssetId}
                    selectedAssetName={selectedAsset?.name || selectedAssetId}
                />
            )}

            {activeTab === 'rul' && (
                <RULReliabilityTab
                    rulEstimate={rulEstimate}
                    assetAlerts={assetAlerts}
                />
            )}

            {/* ═══ CORRECTIVE WORK REQUEST MODAL (PdM → EAM Bridge) ═══ */}
            {wrModalOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-150" onClick={() => !wrSubmitting && setWrModalOpen(false)}>
                    <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg mx-4 shadow-2xl shadow-black/40 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                        {/* Header */}
                        <div className="p-5 border-b border-slate-200 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-primary-50 rounded-xl text-primary-600 border border-primary-100">
                                    <Wrench size={20} />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-slate-800">Raise Corrective WR</h2>
                                    <p className="text-[10px] text-slate-400 mt-0.5 uppercase tracking-wider">PdM → EAM Bridge · ISO 55000 Feedback Loop</p>
                                </div>
                            </div>
                            <button onClick={() => setWrModalOpen(false)} disabled={wrSubmitting} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-40">
                                <X size={18} />
                            </button>
                        </div>

                        {wrSuccess ? (
                            /* Success state */
                            <div className="p-8 text-center">
                                <div className="inline-flex p-3 bg-emerald-50 rounded-xl text-emerald-600 mb-3">
                                    <CheckCircle size={32} />
                                </div>
                                <h3 className="text-base font-bold text-slate-800">Work Request Created</h3>
                                <p className="text-sm text-slate-500 mt-1 max-w-xs mx-auto">
                                    The corrective work order has been inserted into the EAM work queue. It will appear in <strong>Work Management</strong>.
                                </p>
                                <button onClick={() => { setWrModalOpen(false); setWrSuccess(false); }} className="mt-4 px-5 py-2 bg-accent-cyan text-brand-900 font-semibold rounded-lg text-sm hover:bg-primary-400 transition-colors">
                                    Done
                                </button>
                            </div>
                        ) : (
                            /* Form */
                            <div className="p-5 space-y-4">
                                {wrError && (
                                    <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
                                        <AlertTriangle size={14} /> {wrError}
                                    </div>
                                )}

                                {/* Pre-populated source badge */}
                                <div className="flex items-center gap-2 px-3 py-2 bg-primary-50 border border-primary-100 rounded-lg">
                                    <FileWarning size={14} className="text-primary-600" />
                                    <p className="text-xs text-primary-700">
                                        <strong>Source:</strong> Predictive Insights · {selectedAsset?.tag || selectedAssetId} · HI {systemHealth.toFixed(0)}/100
                                    </p>
                                </div>

                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Title</label>
                                    <input
                                        type="text"
                                        value={wrForm.title}
                                        onChange={e => setWrForm(f => ({ ...f, title: e.target.value }))}
                                        className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Work Type</label>
                                        <select
                                            value={wrForm.workType}
                                            onChange={e => setWrForm(f => ({ ...f, workType: e.target.value }))}
                                            className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                                        >
                                            <option value="CM">CM — Corrective</option>
                                            <option value="PdM">PdM — Predictive</option>
                                            <option value="EM">EM — Emergency</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Priority</label>
                                        <select
                                            value={wrForm.priority}
                                            onChange={e => setWrForm(f => ({ ...f, priority: e.target.value }))}
                                            className={`w-full px-3 py-2.5 border rounded-lg text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary-500/30 ${wrForm.priority === 'EMERGENCY' ? 'bg-red-50 border-red-300 text-red-700' : wrForm.priority === 'URGENT' ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-slate-50 border-slate-200 text-slate-800'}`}
                                        >
                                            <option value="ROUTINE">Routine</option>
                                            <option value="URGENT">Urgent</option>
                                            <option value="EMERGENCY">Emergency</option>
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Description</label>
                                    <textarea
                                        value={wrForm.description}
                                        onChange={e => setWrForm(f => ({ ...f, description: e.target.value }))}
                                        rows={5}
                                        className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-500/30 font-mono leading-relaxed"
                                    />
                                </div>

                                {/* Asset + Criticality info */}
                                <div className="flex items-center gap-3 text-[10px] text-slate-400">
                                    <span>Asset: <strong className="text-slate-600">{selectedAsset?.tag}</strong></span>
                                    <span>·</span>
                                    <span>Criticality: <strong className={`${critLevel === 'A' ? 'text-red-500' : critLevel === 'B' ? 'text-amber-500' : 'text-slate-600'}`}>{critLevel}</strong></span>
                                    <span>·</span>
                                    <span>RUL: <strong className="text-slate-600">{rulEstimate?.rul_days?.toFixed(0) || '--'}d</strong></span>
                                </div>

                                {/* Submit */}
                                <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
                                    <button onClick={() => setWrModalOpen(false)} disabled={wrSubmitting} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-40">
                                        Cancel
                                    </button>
                                    <button
                                        onClick={async () => {
                                            setWrSubmitting(true);
                                            setWrError(null);
                                            try {
                                                const db = DatabaseService.getInstance();
                                                const now = new Date().toISOString();
                                                const woPayload = {
                                                    title: wrForm.title,
                                                    description: wrForm.description,
                                                    type: wrForm.workType,
                                                    priority: wrForm.priority.toLowerCase(),
                                                    status: 'WIP',
                                                    asset_id: selectedAssetId,
                                                    source: 'PREDICT',
                                                    wo_number: `PdM-${Date.now().toString(36).toUpperCase()}`,
                                                    created_at: now,
                                                    updated_at: now,
                                                    properties: {
                                                        source_module: 'predictive_insights',
                                                        health_index_at_creation: systemHealth,
                                                        rul_at_creation: rulEstimate?.rul_days || null,
                                                        criticality_at_creation: critLevel,
                                                    },
                                                };
                                                await db.createWorkOrder(woPayload, 'system_admin');
                                                setWrSuccess(true);
                                            } catch (err: any) {
                                                console.error('[PredictPage] WR creation failed:', err);
                                                setWrError(err.message || 'Failed to create work request. Check database connection.');
                                            } finally {
                                                setWrSubmitting(false);
                                            }
                                        }}
                                        disabled={wrSubmitting || !wrForm.title.trim()}
                                        className="flex items-center gap-2 px-5 py-2.5 bg-accent-cyan hover:bg-primary-400 text-brand-900 font-bold rounded-lg text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                                    >
                                        {wrSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Wrench size={16} />}
                                        {wrSubmitting ? 'Creating...' : 'Create Work Order'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* #2: Reliability Advisor — condition triage → grounded, cited PM decision */}
            {advisorOpen && selectedAssetId && (
                <ReliabilityAdvisorModal
                    asset={{ id: selectedAssetId, tag: selectedAsset?.tag || '', name: selectedAsset?.name || selectedAssetId }}
                    onClose={() => setAdvisorOpen(false)}
                />
            )}
        </div>
    );
};
