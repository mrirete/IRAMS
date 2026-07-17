import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Activity, AlertTriangle, HeartPulse, Clock, Search, Plus, X, CheckCircle, Cpu, Zap, BarChart2, Target, Filter, Check, LayoutGrid, Layers, BarChart3, FileWarning } from 'lucide-react';
import { useIntelligence } from '../hooks/useIntelligence';
import { useAssetLookup } from '../hooks/useAssetLookup';
import { PredictOverviewTab } from '../components/predict/PredictOverviewTab';
import { FleetHealthMap } from '../components/predict/FleetHealthMap';
import { DigitalTwinTab } from '../components/predict/DigitalTwinTab';
import { RULReliabilityTab } from '../components/predict/RULReliabilityTab';
import { ScrollTabStrip } from '../eam/components/ui';
import predictionService from '../eam/services/PredictionService';
import { DatabaseService } from '../eam/services/DatabaseService';
import { RaiseWorkModal } from '../eam/components/RaiseWorkModal';
import { useAuth } from '../eam/contexts/AuthContext';
import type { FleetAssetHealth } from '../types/intelligence';
import { ReliabilityAdvisorModal } from '../components/analyze/ReliabilityAdvisorModal';
import { SetupJourney } from '../components/predict/SetupJourney';
import { usePredictSetup } from '../hooks/usePredictSetup';
import { fetchGroundedFit, type GroundedRul } from '../lib/predict/groundedFit';
import { conditionalRemainingQuantileHours } from '../eam/utils/weibull';
import type { RULEstimate } from '../types/intelligence';
import { agentService } from '../eam/services/AgentService';
import { AgentReviewPanel } from '../components/predict/AgentReviewPanel';

type ConditionAlarms = Awaited<ReturnType<DatabaseService['getAssetConditionAlarms']>>;

type InsightType = 'digital_twin' | 'rul_analysis' | 'alert_config' | 'degradation_model';

interface NewInsightForm {
    title: string;
    type: InsightType;
    asset_id: string;
    description: string;
}

const INSIGHT_TYPES: { value: InsightType; label: string; description: string; icon: React.ReactNode; color: string }[] = [
    { value: 'digital_twin', label: 'Digital Twin Snapshot', description: 'Create a new health baseline for an asset digital twin with current sensor data', icon: <Cpu size={20} />, color: 'text-accent-cyan bg-accent-cyan/10 border-accent-cyan/30' },
    { value: 'rul_analysis', label: 'RUL Forecast', description: 'Remaining Useful Life — fitted censored Weibull (conditional MRL) when the asset has failure history; directional heuristic fallback otherwise', icon: <Clock size={20} />, color: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
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
    const { profile } = useAuth();
    const [raiseOpen, setRaiseOpen] = useState(false);
    const [predictFaultTypes, setPredictFaultTypes] = useState<{ id: string; code: string; description: string }[]>([]);
    useEffect(() => {
        DatabaseService.getInstance().getDictionaries()
            .then(d => setPredictFaultTypes((d || []).filter((x: any) => x.type === 'FAULT_TYPE' && x.active).map((x: any) => ({ id: x.id, code: x.code, description: x.description }))))
            .catch(() => setPredictFaultTypes([]));
    }, []);

    const { assetOptions, getAssetById, loading: assetsLoading } = useAssetLookup();

    // ── Setup Journey: first-timers land in the guide, not an empty dashboard ──
    const setup = usePredictSetup();
    const [setupOpen, setSetupOpen] = useState<{ assetId?: string } | null>(null);
    const [setupSkipped, setSetupSkipped] = useState<boolean>(() => {
        try { return localStorage.getItem('predict.setupSkipped') === '1'; } catch { return false; }
    });
    // Auto-enter the journey when NO registered equipment has any condition data
    // yet (empty register counts — the journey starts with equipment intake).
    useEffect(() => {
        if (setup.loading || assetsLoading || setupSkipped || setupOpen) return;
        const anyConnected = assetOptions.some(a => setup.connected.has(a.id));
        if (!anyConnected) setSetupOpen({});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [setup.loading, assetsLoading, setupSkipped, assetOptions, setup.connected]);

    const openSetup = (assetId?: string) => setSetupOpen({ assetId });
    const closeSetup = (focusAssetId?: string) => {
        setSetupOpen(null);
        setSetupSkipped(true);
        try { localStorage.setItem('predict.setupSkipped', '1'); } catch { /* ignore */ }
        setup.refresh();
        if (focusAssetId) {
            setSelectedAssetId(focusAssetId);
            refetchPredict(focusAssetId);
        }
    };

    // #2: Reliability Advisor modal (grounded Weibull RUL lives in there now —
    // the old banner's inline grounded-RUL display went with the banner).
    const [advisorOpen, setAdvisorOpen] = useState(false);

    // ── 1.5.4: alert feedback → threshold-adapter loop (HITL) ──
    // Actionable/false-alarm feedback feeds the threshold_adapter agent, whose
    // band proposals land in the review panel below — never auto-applied.
    const [alertFeedbackMap, setAlertFeedbackMap] = useState<Record<string, 'actionable' | 'false_alarm'>>({});
    const [feedbackStats, setFeedbackStats] = useState<{ actionable: number; falseAlarm: number; precision: number } | null>(null);
    const [adapterNudge, setAdapterNudge] = useState<string | null>(null);
    useEffect(() => {
        setAlertFeedbackMap({});
        setAdapterNudge(null);
        if (!selectedAssetId) { setFeedbackStats(null); return; }
        let active = true;
        predictionService.getAlertFeedbackStats(selectedAssetId)
            .then(s => { if (active) setFeedbackStats(s); })
            .catch(() => { if (active) setFeedbackStats(null); });
        return () => { active = false; };
    }, [selectedAssetId]);

    const handleAlertFeedback = async (alertId: string, type: 'actionable' | 'false_alarm') => {
        if (!selectedAssetId) return;
        const user = profile?.username || profile?.fullName || 'user';
        const saved = await predictionService.submitAlertFeedback(alertId, selectedAssetId, type, user);
        if (!saved) return;
        setAlertFeedbackMap(prev => ({ ...prev, [alertId]: type }));
        const stats = await predictionService.getAlertFeedbackStats(selectedAssetId);
        setFeedbackStats(stats);
        if (type === 'false_alarm') {
            // Surface the (previously dormant) threshold adapter: enough feedback
            // → band proposals, pending human review in the panel below.
            try {
                const res = await agentService.proposeThresholdAdjustments(selectedAssetId);
                if (res.agentAction) setAdapterNudge(res.message);
            } catch { /* advisory only — feedback itself already saved */ }
        }
    };

    // ── #3: REAL condition alarms from R-4 measurement-point bands (not synthetic) ──
    const [conditionAlarms, setConditionAlarms] = useState<ConditionAlarms | null>(null);
    useEffect(() => {
        if (!selectedAssetId) { setConditionAlarms(null); return; }
        let active = true;
        (async () => {
            try {
                const res = await DatabaseService.getInstance().getAssetConditionAlarms(selectedAssetId);
                if (active) setConditionAlarms(res);
            } catch {
                if (active) setConditionAlarms(null);
            }
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

    // Deliberately NO auto-selection: the page defaults to a plain chooser —
    // the user picks the asset or system to study (or sets up new equipment).

    const { loading, twinHealth, rulEstimate, getAssetAlerts, getSensorTrends, refetchPredict } = useIntelligence(selectedAssetId);

    // ── Phase 1 (one engine): the grounded censored-Weibull fit from WO failure
    // history — the SAME fit the Reliability Advisor computes. When it exists it
    // overrides the persisted heuristic everywhere (headline RUL, bands, chart,
    // P-failure), so all Predict surfaces agree by construction.
    const [grounded, setGrounded] = useState<GroundedRul | null>(null);
    useEffect(() => {
        if (!selectedAssetId) { setGrounded(null); return; }
        let active = true;
        fetchGroundedFit(selectedAssetId)
            .then(g => { if (active) setGrounded(g); })
            .catch(() => { if (active) setGrounded(null); });
        return () => { active = false; };
    }, [selectedAssetId]);

    const groundedActive = !!grounded && grounded.method === 'weibull-mrl' && grounded.rulDays != null && !!grounded.beta && !!grounded.eta;

    // Display estimate: grounded fit wins; heuristic estimate passes through
    // unchanged (tagged by its distribution_type) when no fit exists.
    const displayRul = useMemo<RULEstimate | null>(() => {
        if (!groundedActive || !grounded) return rulEstimate;
        const ageH = grounded.ageDays * 24;
        const q = (p: number) => Math.round(conditionalRemainingQuantileHours(grounded.beta!, grounded.eta!, ageH, p) / 24);
        return {
            asset_id: selectedAssetId,
            rul_days: grounded.rulDays!,
            confidence: Math.min(0.98, Math.max(0.50, grounded.fit?.r2 ?? (rulEstimate?.confidence ?? 0.8))),
            distribution_type: 'weibull_2p',
            dqs_impact: rulEstimate?.dqs_impact ?? 0,
            governance_tier: rulEstimate?.governance_tier ?? 3,
            computed_at: rulEstimate?.computed_at ?? new Date().toISOString(),
            confidence_bands: [
                { percentile: 50, lower_days: q(0.25), upper_days: q(0.75), median_days: q(0.5) },
                { percentile: 80, lower_days: q(0.10), upper_days: q(0.90), median_days: q(0.5) },
                { percentile: 95, lower_days: q(0.025), upper_days: q(0.975), median_days: q(0.5) },
            ],
        } as RULEstimate;
    }, [groundedActive, grounded, rulEstimate, selectedAssetId]);

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

    // First-timer experience: the setup guide IS the page until data flows.
    // Every click in it performs real setup (register, measurement points,
    // first readings) — the dashboard appears once there is something to show.
    if (setupOpen) {
        return (
            <div className="py-4">
                <SetupJourney initialAssetId={setupOpen.assetId} onExit={closeSetup} />
            </div>
        );
    }

    if (loading || setup.loading) {
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
    // Honesty guard: no twin state = "not connected yet", never "0.0 health".
    const hasTwin = !!twinHealth;
    const isHealthy = systemHealth >= 80;
    const critLevel = selectedAsset?.criticality;
    const critColor = critLevel === 'A' ? 'bg-red-500/20 text-red-400 border-red-500/30' : critLevel === 'B' ? 'bg-yellow-500/20 text-yellow-500 border-yellow-500/30' : 'bg-slate-100 text-brand-300 border-slate-300';

    // ── #3: prefer REAL measurement-point band breaches; only fall back to synthetic when the asset has no reading definitions ──
    const hasRealBands = !!conditionAlarms && conditionAlarms.pointCount > 0;
    const realAlarmCount = conditionAlarms ? conditionAlarms.criticalCount + conditionAlarms.warningCount : 0;
    const effectiveAlertCount = hasRealBands ? realAlarmCount : assetAlerts.length;

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
                    <p className="text-slate-500 text-sm mt-1">Condition-based health monitoring & failure forecasting — fitted Weibull RUL where failure history exists, directional heuristics otherwise</p>
                </div>

                <div className="flex items-center gap-3">
                    {/* Guided setup — always reachable, auto-shown for first-timers */}
                    <button
                        onClick={() => openSetup(selectedAssetId || undefined)}
                        title="Step-by-step guide: register equipment, define measurements, get data flowing"
                        className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:border-primary-300 hover:text-primary-700 text-slate-600 font-semibold rounded-lg text-sm transition-colors"
                    >
                        <HeartPulse size={16} /> Setup guide
                    </button>
                    {/* #2: Reliability Advisor — grounded, cited PM proposal for this asset */}
                    <button
                        onClick={() => setAdvisorOpen(true)}
                        disabled={!selectedAssetId}
                        title="Run the Reliability Advisor: real Weibull RUL + cost-justified PM proposal you can approve"
                        className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors"
                    >
                        <Cpu size={16} /> Reliability Advisor
                    </button>
                </div>
            </div>

            {/* ═══ Experimental disclaimer — only once an asset's heuristics are on screen ═══ */}
            {selectedAssetId && !groundedActive && (
                <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-card text-sm">
                    <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-amber-800 leading-relaxed">
                        <strong>Directional only:</strong> this asset has no fitted life model yet — Health Index and RUL are <strong>heuristic estimates</strong> from condition trends, useful for triage but not for life decisions. A fitted Weibull RUL appears automatically once ≥2 failures are on record. For manual life-data studies and Monte-Carlo availability analysis, use{' '}
                        <a href="/reliability-modelling" className="font-semibold underline decoration-amber-400 underline-offset-2 hover:text-amber-900">Reliability Modelling</a>.
                    </p>
                </div>
            )}

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

            {/* ═══ ASSET BAR — search-first selector + New Prediction (replaces the old focused-asset banner) ═══ */}
            <div className="flex items-stretch gap-3">
                <button
                    onClick={() => { setAssetPickerOpen(true); setAssetSearch(''); }}
                    className="flex-1 min-w-0 flex items-center gap-3 px-4 py-2.5 bg-white border border-slate-200 rounded-xl shadow-sm hover:border-accent-cyan/50 hover:shadow-md transition-all text-left group"
                    title="Change asset · Ctrl+K"
                >
                    <Search size={17} className="text-slate-400 group-hover:text-accent-cyan transition-colors shrink-0" />
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 group-hover:text-accent-cyan transition-colors truncate">
                            {selectedAsset ? selectedAsset.name : 'Search assets…'}
                        </p>
                        <p className="text-[10px] text-slate-400 truncate">
                            {selectedAsset ? [selectedAsset.tag, selectedAsset.system].filter(Boolean).join(' · ') : 'by tag, name, or system'}
                        </p>
                    </div>
                    {!hasTwin && selectedAssetId && (
                        <span className="hidden sm:inline text-[10px] font-semibold text-primary-600 shrink-0">Not connected yet</span>
                    )}
                    {selectedAsset && (
                        <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border shrink-0 ${critColor}`}>Crit {critLevel || '?'}</span>
                    )}
                    <kbd className="hidden md:inline px-1.5 py-0.5 text-[10px] font-mono font-bold bg-slate-100 text-slate-400 border border-slate-200 rounded shrink-0">Ctrl+K</kbd>
                </button>
                <button
                    onClick={() => setShowNewInsight(true)}
                    className="flex items-center gap-2 px-4 bg-accent-cyan hover:bg-primary-400 text-brand-900 font-semibold rounded-xl text-sm transition-colors shadow-[0_0_15px_rgba(6,182,212,0.2)] whitespace-nowrap"
                >
                    <Plus size={16} /> New Prediction
                </button>
            </div>

            {/* ═══ PLAIN DEFAULT — no asset selected: choose what to study ═══ */}
            {!selectedAssetId && (
                <>
                    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-10 text-center">
                        <div className="inline-flex p-3 bg-slate-50 rounded-xl text-slate-300 mb-3">
                            <Target size={28} />
                        </div>
                        <h2 className="text-lg font-bold text-slate-800">Choose an asset or system to study</h2>
                        <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
                            Search above, pick from the fleet below — or set up new equipment for monitoring.
                        </p>
                        <div className="flex flex-wrap items-center justify-center gap-3 mt-5">
                            <button
                                onClick={() => { setAssetPickerOpen(true); setAssetSearch(''); }}
                                className="flex items-center gap-2 px-5 py-2.5 bg-primary-600 hover:bg-primary-500 text-white font-bold rounded-lg text-sm transition-colors"
                            >
                                <Search size={15} /> Select asset or system
                            </button>
                            <button
                                onClick={() => openSetup()}
                                className="flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200 hover:border-primary-300 hover:text-primary-700 text-slate-600 font-semibold rounded-lg text-sm transition-colors"
                            >
                                <HeartPulse size={15} /> Set up new equipment
                            </button>
                        </div>
                    </div>
                    {visibleFleetData.length > 0 && (
                        <FleetHealthMap
                            selectedAssetId=""
                            onAssetSelect={(id: string) => setSelectedAssetId(id)}
                            fleetData={visibleFleetData}
                            totalAssetCount={fleetData.length}
                        />
                    )}
                </>
            )}

            {/* ═══ TAB NAVIGATION ═══ */}
            {selectedAssetId && (
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
            )}

            {/* ═══ TAB CONTENT ═══ */}
            {selectedAssetId && activeTab === 'overview' && (
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
                    rulDays={displayRul?.rul_days}
                    alertCount={effectiveAlertCount}
                    rulConfidenceBands={displayRul?.confidence_bands || []}
                    distributionType={displayRul?.distribution_type || null}
                    rulConfidence={displayRul?.confidence ?? null}
                    groundedFit={groundedActive ? grounded : null}
                    twinHealth={twinHealth}
                    assetSensorTrends={assetSensorTrends}
                    onInvestigate={() => window.location.href = '/analyze'}
                    onCreateWR={() => setRaiseOpen(true)}
                    onSetup={() => openSetup(selectedAssetId || undefined)}
                    hasData={hasTwin}
                />
            )}

            {selectedAssetId && activeTab === 'twin' && (
                <DigitalTwinTab
                    twinHealth={twinHealth}
                    rulEstimate={displayRul}
                    selectedAssetId={selectedAssetId}
                    selectedAssetName={selectedAsset?.name || selectedAssetId}
                />
            )}

            {selectedAssetId && activeTab === 'rul' && (
                <>
                    <RULReliabilityTab
                        rulEstimate={displayRul}
                        assetAlerts={assetAlerts}
                        groundedFit={groundedActive ? grounded : null}
                        feedbackStats={feedbackStats}
                        alertFeedbackMap={alertFeedbackMap}
                        onAlertFeedback={handleAlertFeedback}
                    />
                    {/* Threshold-adapter nudge: false-alarm feedback produced band proposals */}
                    {adapterNudge && (
                        <div className="mt-4 flex items-start gap-3 px-4 py-3 bg-primary-50 border border-primary-200 rounded-card text-sm">
                            <Zap size={16} className="text-primary-600 shrink-0 mt-0.5" />
                            <p className="text-primary-800 leading-relaxed">
                                <strong>Threshold Agent:</strong> {adapterNudge} Review and approve in the panel below — nothing changes without your sign-off.
                            </p>
                        </div>
                    )}
                    {/* HITL review panel — WO drafts, RCA drafts, threshold proposals */}
                    <div className="mt-4">
                        <AgentReviewPanel
                            assetId={selectedAssetId}
                            currentUser={profile?.username || profile?.fullName || 'user'}
                        />
                    </div>
                </>
            )}

            {/* Corrective work — unified Raise modal (Request / Work Order / PM) */}
            {raiseOpen && selectedAssetId && (
                <RaiseWorkModal
                    asset={{ id: selectedAssetId, tag: selectedAsset?.tag || '', name: selectedAsset?.name || selectedAssetId, criticality: (critLevel as any) } as any}
                    kind="WO"
                    actor={profile?.username || profile?.fullName || 'user'}
                    requesterId={profile?.id}
                    sourceLabel="Predict"
                    faultTypes={predictFaultTypes}
                    contextNote={`From Predict — Health ${systemHealth.toFixed(1)}/100 · RUL ${rulEstimate?.rul_days?.toFixed(0) || 'N/A'}d · Criticality ${critLevel || 'B'} · ${effectiveAlertCount} condition alarm(s).`}
                    onClose={() => setRaiseOpen(false)}
                />
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
