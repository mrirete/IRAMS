import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { Activity, AlertTriangle, HeartPulse, Clock, Search, Plus, X, CheckCircle, Cpu, Zap, BarChart2, Target, LayoutGrid, Layers, BarChart3, FileWarning, RefreshCw } from 'lucide-react';
import { TwinDrawingPanel } from '../components/predict/TwinDrawingPanel';
import { PredictSideRail } from '../components/predict/PredictSideRail';
import { useIntelligence } from '../hooks/useIntelligence';
import { useAssetLookup } from '../hooks/useAssetLookup';
import { PredictOverviewTab } from '../components/predict/PredictOverviewTab';
import { FleetHealthMap } from '../components/predict/FleetHealthMap';
import { buildLineage } from '../components/predict/WhereItSits';
import { fitHealthTrend, suggestNeededBy, freshHistory, type HistoryPoint } from '../lib/predict/healthTrend';
import { HEALTH_FAILURE_THRESHOLD, STALE_DAYS } from '../config/predict';
import { buildVerdict } from '../lib/predict/verdict';
import { VerdictLine } from '../components/predict/VerdictLine';
import { rulAlertWindowDays } from '../lib/predict/rulAlert';
import { isOpenAlert } from '../lib/predict/vibrationCaptures';
import { DigitalTwinTab } from '../components/predict/DigitalTwinTab';
import { RULReliabilityTab } from '../components/predict/RULReliabilityTab';
import { ScrollTabStrip } from '../eam/components/ui';
import predictionService from '../eam/services/PredictionService';
import { DatabaseService } from '../eam/services/DatabaseService';
import { RaiseWorkModal } from '../eam/components/RaiseWorkModal';
import { useAuth } from '../eam/contexts/AuthContext';
import type { FleetAssetHealth, AlertOutcome } from '../types/intelligence';
import { ReliabilityAdvisorModal } from '../components/analyze/ReliabilityAdvisorModal';
import { SetupJourney } from '../components/predict/SetupJourney';
import { usePredictSetup } from '../hooks/usePredictSetup';
import { fetchGroundedFit, type GroundedRul } from '../lib/predict/groundedFit';
import { conditionalRemainingQuantileHours } from '../eam/utils/weibull';
import type { RULEstimate, PredictionAlert } from '../types/intelligence';
import { agentService } from '../eam/services/AgentService';
import { AgentReviewPanel } from '../components/predict/AgentReviewPanel';
import { AlertPrecisionCard } from '../components/predict/AlertPrecisionCard';
import { KpiOutlook } from '../components/predict/KpiOutlook';
import { resolveEquipmentClass } from '../lib/predict/equipmentClass';
import { sensorKind } from '../lib/predict/healthModels';
import { assessIntegrity, type IntegrityAssessment } from '../lib/predict/integrity';
import { rollupHierarchy, redundancyGroupsFromRbdModels, type RedundancyGroup } from '../lib/predict/rollup';
import analyzeService from '../eam/services/AnalyzeService';
import { useAssetContext } from '../contexts/AssetContext';

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
    { id: 'overview', label: 'Now', icon: <LayoutGrid size={16} />, description: 'Drawing, condition & health' },
    { id: 'twin', label: 'Model', icon: <Layers size={16} />, description: 'Trajectory, degradation & what-if' },
    { id: 'rul', label: 'Forecast', icon: <BarChart3 size={16} />, description: 'Remaining life & alerts' },
];

export const PredictPage: React.FC = () => {
    // The chosen asset and tab live in the address (?asset=&tab=), so Back from
    // Reliability Modelling, a refresh or a shared link returns to the same
    // asset. They used to be component state: leaving Predict lost the asset
    // and Back always landed on the chooser.
    const [searchParams, setSearchParams] = useSearchParams();
    const selectedAssetId = searchParams.get('asset') || '';
    const tabParam = searchParams.get('tab');
    const activeTab: PredictTab = tabParam === 'twin' || tabParam === 'rul' ? tabParam : 'overview';
    /** One address update per change — two back-to-back setSearchParams calls would overwrite each other. */
    const setSelectedAssetId = useCallback((id: string, tab?: PredictTab) => {
        setSearchParams(prev => {
            const n = new URLSearchParams(prev);
            n.delete('point');
            if (!id) { n.delete('asset'); n.delete('tab'); return n; }
            n.set('asset', id);
            const t = tab ?? (prev.get('tab') as PredictTab | null);
            if (t && t !== 'overview') n.set('tab', t); else n.delete('tab');
            return n;
        }, { replace: true });
    }, [setSearchParams]);
    const setActiveTab = useCallback((t: PredictTab) => {
        setSearchParams(prev => {
            const n = new URLSearchParams(prev);
            if (t !== 'overview') n.set('tab', t); else n.delete('tab');
            return n;
        }, { replace: true });
    }, [setSearchParams]);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [assetSearch, setAssetSearch] = useState('');
    const [showNewInsight, setShowNewInsight] = useState(false);
    const [insightForm, setInsightForm] = useState<NewInsightForm>({ title: '', type: 'digital_twin', asset_id: '', description: '' });
    const [insightCreated, setInsightCreated] = useState(false);
    const [predictionRunning, setPredictionRunning] = useState(false);
    const [predictionError, setPredictionError] = useState<string | null>(null);
    const [predictionMessage, setPredictionMessage] = useState('');
    // Keyboard cursor in the asset picker (↑↓ moves, Enter opens).
    const [pickerIndex, setPickerIndex] = useState(0);
    const pickerListRef = useRef<HTMLDivElement>(null);

    // ── Corrective Work Request Modal state ──
    const { profile } = useAuth();
    const [raiseOpen, setRaiseOpen] = useState(false);
    // RBI → inspection WO prefill (Predict→WM link): title/context/due date.
    const [inspectPrefill, setInspectPrefill] = useState<{ title: string; contextNote: string; dueDate: string } | null>(null);
    // What-If → PM strategy prefill (Predict→WM link): simulated interval + rationale.
    const [pmPrefill, setPmPrefill] = useState<{ intervalDays: number; rationale: string } | null>(null);
    const [predictFaultTypes, setPredictFaultTypes] = useState<{ id: string; code: string; description: string }[]>([]);
    useEffect(() => {
        DatabaseService.getInstance().getDictionaries()
            .then(d => setPredictFaultTypes((d || []).filter((x: any) => x.type === 'FAULT_TYPE' && x.active).map((x: any) => ({ id: x.id, code: x.code, description: x.description }))))
            .catch(() => setPredictFaultTypes([]));
    }, []);

    const { assetOptions, getAssetById, loading: assetsLoading } = useAssetLookup();
    // Full register (all hierarchy levels) — the roll-up needs parent links.
    const { assets: allRegisterAssets } = useAssetContext();

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

    // Deep link from an RCM decision (?asset=<id>&point=<reading definition>):
    // land on that asset, and if it has no feed yet open the setup journey on
    // it — the on-condition task is a paper task until a sensor feeds its point.
    const location = useLocation();
    const deepLinkDone = useRef(false);
    useEffect(() => {
        if (deepLinkDone.current || setup.loading || assetsLoading) return;
        const params = new URLSearchParams(location.search);
        const asset = params.get('asset');
        if (!asset) return;
        deepLinkDone.current = true;
        refetchPredict(asset);
        if (params.get('point') && !setup.connected.has(asset)) setSetupOpen({ assetId: asset });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [setup.loading, assetsLoading, location.search]);
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

    // ── 1.5.4: alert outcomes → precision + threshold-adapter loop (HITL) ──
    // A "no fault found" outcome feeds the threshold_adapter agent, whose band
    // proposals land in the review panel below — never auto-applied.
    const [feedbackStats, setFeedbackStats] = useState<{ actionable: number; falseAlarm: number; precision: number } | null>(null);
    const [adapterNudge, setAdapterNudge] = useState<string | null>(null);
    useEffect(() => {
        setAdapterNudge(null);
        if (!selectedAssetId) { setFeedbackStats(null); return; }
        let active = true;
        predictionService.getAlertFeedbackStats(selectedAssetId)
            .then(s => { if (active) setFeedbackStats(s); })
            .catch(() => { if (active) setFeedbackStats(null); });
        return () => { active = false; };
    }, [selectedAssetId]);

    // ── Alert lifecycle (0391): acknowledge → raise work → close with outcome ──
    // Anyone may acknowledge or raise work; closing needs reliability edit or
    // work-order approve (the database enforces the same rule).
    const { permissions, role } = useAuth() as any;
    const canCloseAlert = ['SUPER_ADMIN', 'SYS_ADMIN'].includes(String(role || '').toUpperCase())
        || permissions?.reliability?.edit === true || permissions?.workOrders?.approve === true;
    const [raiseForAlert, setRaiseForAlert] = useState<PredictionAlert | null>(null);

    // A remaining-life alert on stale (or no) readings: the honest first step
    // is to measure, not to overhaul. A request to take the asset's condition
    // readings, listing its measurement points, due within the week and never
    // after the work's own needed-by date. Not linked to the alert: the alert
    // closes on the repair's outcome, not on a reading being taken.
    const [readingRequest, setReadingRequest] = useState<{ alert: PredictionAlert; note: string; dueDate: string } | null>(null);
    const requestReading = async (alert: PredictionAlert) => {
        const points = await predictionService.getMeasurementPoints(alert.asset_id);
        const list = points.length
            ? `Points to read: ${points.map(p => p.name + (p.unit ? ` (${p.unit})` : '')).join(', ')}.`
            : 'No measurement points are defined yet — set them up on Condition Data first, then take vibration and bearing temperature at least.';
        const week = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
        const dueDate = neededBy.date && neededBy.date < week ? neededBy.date : week;
        setReadingRequest({
            alert,
            dueDate,
            note: `Condition reading requested for alert ${alert.alert_id}: ${alert.title}. ${alert.description} ${list} Bring the readings in on Condition Data; Predict re-scores the asset from them.`,
        });
    };

    const handleAcknowledgeAlert = async (alert: PredictionAlert) => {
        const r = await predictionService.acknowledgeAlert(alert.alert_id);
        if (r.ok) await refetchPredict(alert.asset_id);
        return r;
    };

    const handleCloseAlert = async (alert: PredictionAlert, outcome: AlertOutcome, notes: string) => {
        const user = profile?.username || profile?.fullName || 'user';
        const r = await predictionService.closeAlert(alert.alert_id, alert.asset_id, outcome, notes, user);
        if (!r.ok) return r;
        await refetchPredict(alert.asset_id);
        setFeedbackStats(await predictionService.getAlertFeedbackStats(alert.asset_id));
        // A false alarm on a BAND alert feeds the threshold adapter. A remaining-
        // life alert has no band to adjust; its false alarm is the life model's.
        if (outcome === 'no_fault_found' && alert.alert_type !== 'rul_warning') {
            try {
                const res = await agentService.proposeThresholdAdjustments(alert.asset_id);
                if (res.agentAction) setAdapterNudge(res.message);
            } catch { /* advisory only — the outcome itself is saved */ }
        }
        return r;
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

    // Deliberately NO auto-selection: the page defaults to a plain chooser —
    // the user picks the asset or system to study (or sets up new equipment).

    const { loading, twinHealth, rulEstimate, getAssetAlerts, getSensorTrends, refetchPredict } = useIntelligence(selectedAssetId);

    // ── Update twin: the four steps in order, one click — or none. ──────────
    // The four-type modal made the twin a ritual (snapshot, then degradation,
    // then RUL, then alert scan, each by hand); an asset with fresh readings
    // and no twin row looked "Not connected". One action runs them in order,
    // and runs itself when the asset's twin is missing or older than its
    // newest reading. The modal stays under "Advanced" for one-step reruns.
    const TWIN_STEPS: { type: InsightType; label: string }[] = [
        { type: 'digital_twin', label: 'health snapshot' },
        { type: 'degradation_model', label: 'degradation' },
        { type: 'rul_analysis', label: 'remaining life' },
        { type: 'alert_config', label: 'alert scan' },
    ];
    const [twinUpdate, setTwinUpdate] = useState<{ step: string; done: string[]; failed: string[]; running: boolean; reason: 'manual' | 'auto' } | null>(null);
    const twinUpdateRunning = useRef(false);
    const autoRanFor = useRef<Set<string>>(new Set());
    const updateTwin = async (assetId: string, reason: 'manual' | 'auto') => {
        if (!assetId || twinUpdateRunning.current) return;
        twinUpdateRunning.current = true;
        const done: string[] = [];
        const failed: string[] = [];
        const tag = getAssetById(assetId)?.tag || assetId;
        try {
            for (const s of TWIN_STEPS) {
                setTwinUpdate({ step: s.label, done: [...done], failed: [...failed], running: true, reason });
                const r = await predictionService.runPrediction(
                    s.type, assetId, `${tag} — ${s.label}`,
                    reason === 'auto' ? 'Automatic update: twin missing or older than the newest reading' : 'Update twin',
                );
                if (r.success) done.push(s.label);
                else failed.push(`${s.label} (${r.message})`);
            }
        } finally {
            twinUpdateRunning.current = false;
            setTwinUpdate({ step: '', done, failed, running: false, reason });
        }
        await refetchPredict(assetId);
    };
    useEffect(() => {
        if (!selectedAssetId || loading || autoRanFor.current.has(selectedAssetId)) return;
        let cancelled = false;
        (async () => {
            const newest = await predictionService.newestReadingAt(selectedAssetId);
            if (cancelled || !newest) return; // no readings at all → nothing to snapshot
            const twinAt = twinHealth?.asset_id === selectedAssetId && twinHealth.updated_at ? new Date(twinHealth.updated_at).getTime() : 0;
            if (twinAt >= new Date(newest).getTime()) return;
            autoRanFor.current.add(selectedAssetId);
            await updateTwin(selectedAssetId, 'auto');
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedAssetId, loading, twinHealth?.updated_at]);

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

    // ── Phase 2: equipment-class resolution (declared → inferred → default) ──
    const classRes = useMemo(() => {
        if (!selectedAssetId || !selectedAsset) return null;
        const a = selectedAsset as any;
        return resolveEquipmentClass({
            name: a.name, tag: a.tag,
            assetClass: a.assetClass, assetCategory: a.assetCategory, assetType: a.assetType,
        });
    }, [selectedAssetId, selectedAsset]);

    // Static-equipment integrity (2.4): thickness readings → API 570 corrosion
    // rate + remaining life to t-min. Only fetched for static assets.
    const [integrity, setIntegrity] = useState<IntegrityAssessment | null>(null);
    useEffect(() => {
        setIntegrity(null);
        if (!selectedAssetId || classRes?.cls !== 'static') return;
        let active = true;
        (async () => {
            try {
                const db = DatabaseService.getInstance();
                const [defs, logs] = await Promise.all([
                    db.getReadingDefinitions(selectedAssetId),
                    db.getReadingLogs(selectedAssetId),
                ]);
                const thicknessDef = (defs || []).find((d: any) => sensorKind(d.name, d.unit) === 'thickness' && d.isActive !== false);
                if (!thicknessDef) return;
                const points = (logs || [])
                    .filter((l: any) => l.definitionId === thicknessDef.id && l.isActive !== false)
                    .map((l: any) => ({ date: l.date || l.reading_date, value: Number(l.value) }));
                const assessed = assessIntegrity(points, thicknessDef.minCritical ?? thicknessDef.minWarning ?? null);
                if (active) setIntegrity(assessed);
            } catch { if (active) setIntegrity(null); }
        })();
        return () => { active = false; };
    }, [selectedAssetId, classRes?.cls]);

    const assetAlerts = useMemo(() => getAssetAlerts(selectedAssetId), [getAssetAlerts, selectedAssetId]);
    const assetSensorTrends = useMemo(() => getSensorTrends(selectedAssetId), [getSensorTrends, selectedAssetId]);

    // Saved health / RUL history (0392) — reloaded when the twin updates, since
    // every update adds a point (the database trigger writes it).
    const [history, setHistory] = useState<{ health: HistoryPoint[]; rul: HistoryPoint[] }>({ health: [], rul: [] });
    useEffect(() => {
        let alive = true;
        if (!selectedAssetId) { setHistory({ health: [], rul: [] }); return; }
        predictionService.getHealthHistory(selectedAssetId).then(rows => {
            if (!alive) return;
            setHistory({
                health: rows.filter(r => r.metric === 'health_index').map(r => ({ at: r.recorded_at, value: r.value })),
                rul: rows.filter(r => r.metric === 'rul_days').map(r => ({ at: r.recorded_at, value: r.value })),
            });
        });
        return () => { alive = false; };
    }, [selectedAssetId, twinHealth?.updated_at]);

    // When the asset was last MEASURED — the freshness the Now tab states.
    // The twin's updated_at is when it was last re-scored, which a manual
    // "Update twin" resets without a single new reading behind it.
    const [newestReading, setNewestReading] = useState<string | null>(null);
    useEffect(() => {
        let alive = true;
        if (!selectedAssetId) { setNewestReading(null); return; }
        predictionService.newestReadingAt(selectedAssetId).then(t => { if (alive) setNewestReading(t); });
        return () => { alive = false; };
    }, [selectedAssetId, twinHealth?.updated_at]);
    // Only history points that stand on a reading go into the fitted trend.
    const freshHealth = useMemo(() => freshHistory(history.health, newestReading, STALE_DAYS), [history.health, newestReading]);

    // The one-line verdict: what we know, what the history says, what to do.
    // Built from the same numbers the tabs show, so it cannot disagree with them.
    const readingAgeDays = newestReading ? (Date.now() - new Date(newestReading).getTime()) / 86_400_000 : null;
    const verdict = useMemo(() => {
        if (!selectedAssetId) return null;
        const b50 = displayRul?.confidence_bands?.find(b => b.percentile === 50);
        return buildVerdict({
            health: twinHealth ? Number(twinHealth.health_index) : null,
            readingAgeDays,
            fitted: groundedActive && grounded?.rulDays != null
                ? { rulDays: grounded.rulDays, band50: b50 ? { lower: b50.lower_days, upper: b50.upper_days } : null, nFailures: grounded.fit?.nFailures ?? 0 }
                : null,
            breaches: conditionAlarms?.breaches?.length ?? 0,
            openAlerts: assetAlerts.filter(isOpenAlert).length,
            windowDays: rulAlertWindowDays(selectedAsset?.criticality),
        });
    }, [selectedAssetId, twinHealth, readingAgeDays, groundedActive, grounded, displayRul, conditionAlarms, assetAlerts, selectedAsset?.criticality]);
    const onVerdictAction = () => {
        if (!verdict) return;
        if (verdict.action === 'take_reading') {
            const rul = assetAlerts.find(a => a.alert_type === 'rul_warning' && isOpenAlert(a));
            if (rul) { requestReading(rul); return; }
            setReadingRequest({ alert: { alert_id: 'none', title: 'Condition reading', description: '' } as PredictionAlert, dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10), note: `Condition reading requested: the newest reading is ${readingAgeDays != null ? `${Math.floor(readingAgeDays)} days old` : 'missing'}. Bring the readings in on Condition Data; Predict re-scores the asset from them.` });
            return;
        }
        if (verdict.action === 'plan_work') { setSelectedAssetId(selectedAssetId, 'rul'); return; }
        if (verdict.action === 'set_up') openSetup(selectedAssetId || undefined);
    };

    // Work raised from an alert gets a needed-by date: the fitted health trend's
    // crossing of the failure limit, else the remaining-life estimate, less the
    // planning lead — with the basis shown next to the field.
    const neededBy = useMemo(() => suggestNeededBy({
        fit: fitHealthTrend(freshHealth.points),
        limit: HEALTH_FAILURE_THRESHOLD,
        rulDays: displayRul?.rul_days ?? null,
        rulBasis: groundedActive ? 'fitted to failure history' : displayRul?.distribution_type === 'heuristic' ? 'directional heuristic' : displayRul?.distribution_type ?? null,
    }), [freshHealth.points, displayRul, groundedActive]);

    const filteredAssets = useMemo(() => {
        const q = assetSearch.toLowerCase();
        return assetOptions.filter(a => a.name.toLowerCase().includes(q) || a.system.toLowerCase().includes(q) || a.tag.toLowerCase().includes(q));
    }, [assetSearch, assetOptions]);
    // Grouped by system; the flat order is what ↑↓ walks.
    const pickerGroups = useMemo(() => {
        const groups = new Map<string, typeof filteredAssets>();
        filteredAssets.forEach(asset => {
            const sys = asset.system || 'Unassigned';
            if (!groups.has(sys)) groups.set(sys, []);
            groups.get(sys)!.push(asset);
        });
        return Array.from(groups.entries());
    }, [filteredAssets]);
    const pickerOrder = useMemo(() => pickerGroups.flatMap(([, assets]) => assets), [pickerGroups]);

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
                if (twins.length === 0) return; // no snapshots yet — the chooser shows the setup path, never sample data

                const rulMap = new Map(ruls.map(r => [r.asset_id, r]));
                const alertCountMap = new Map<string, number>();
                // Open alerts only — a closed alert has its outcome and needs nobody (0391).
                dbAlerts.filter(a => (a.status ? a.status !== 'closed' : !a.acknowledged))
                    .forEach(a => alertCountMap.set(a.asset_id, (alertCountMap.get(a.asset_id) || 0) + 1));

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
                            tag: registeredAsset?.tag || undefined,
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
                            // No trend: a snapshot has one health value, and an
                            // arrow derived from its band would be a guess.
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

    // Register equipment with no health snapshot — the chooser's search offers set-up for these.
    const unmonitoredAssets = useMemo(() => {
        const monitored = new Set(fleetData.map(a => a.asset_id));
        return assetOptions.filter(a => !monitored.has(a.id)).map(a => ({ id: a.id, tag: a.tag, name: a.name, system: a.system }));
    }, [fleetData, assetOptions]);

    // ── Phase 4: system/unit roll-up from monitored equipment health ──
    // AssetContext assets use the ISO-taxonomy shape: parent_id (snake) and
    // lowercase taxonomy_level — normalize before rolling up.
    // RBD-aware: parallel/standby groups from saved Reliability Modelling RBDs
    // collapse redundant siblings so a healthy standby twin absorbs the drag.
    const [redundancyGroups, setRedundancyGroups] = useState<RedundancyGroup[]>([]);
    useEffect(() => {
        analyzeService.getRBDModels()
            .then(models => setRedundancyGroups(redundancyGroupsFromRbdModels(models as any)))
            .catch(() => setRedundancyGroups([]));
    }, []);

    const rollups = useMemo(() => {
        if (fleetData.length === 0 || allRegisterAssets.length === 0) return [];
        const healthById = new Map(fleetData.map(a => [a.asset_id, a.health_index]));
        return rollupHierarchy(
            allRegisterAssets.map((a: any) => ({
                // A blank register name reads as its tag ("UNIT-200 · no name in register"), not "Unnamed unit".
                id: a.id, name: (a.name || '').trim() || `${a.tag || 'Item'} · no name in register`,
                parentId: a.parent_id ?? a.parentId,
                hierarchyLevel: a.taxonomy_level ?? a.hierarchyLevel,
                criticality: a.criticality,
            })),
            healthById,
            redundancyGroups,
        );
    }, [fleetData, allRegisterAssets, redundancyGroups]);

    // The selected asset's own chain, site down to the asset (Where it sits).
    const lineage = useMemo(
        () => buildLineage(selectedAssetId, allRegisterAssets as any[], rollups, fleetData, twinHealth?.asset_id === selectedAssetId ? twinHealth.health_index : null),
        [selectedAssetId, allRegisterAssets, rollups, fleetData, twinHealth],
    );

    // ── Asset picker keys ─────────────────────────────────
    // Ctrl+K is the global command palette's (AppLayout) — Predict used to claim
    // it too and both opened at once. The picker opens from the asset switcher.
    const closePicker = () => { setAssetPickerOpen(false); setAssetSearch(''); };
    const openPicker = () => { setAssetSearch(''); setPickerIndex(0); setAssetPickerOpen(true); };
    useEffect(() => {
        if (!assetPickerOpen) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closePicker(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [assetPickerOpen]);
    useEffect(() => { setPickerIndex(0); }, [assetSearch]);
    useEffect(() => {
        pickerListRef.current?.querySelector(`[data-picker-idx="${pickerIndex}"]`)?.scrollIntoView({ block: 'nearest' });
    }, [pickerIndex]);
    const onPickerKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setPickerIndex(i => Math.min(i + 1, pickerOrder.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setPickerIndex(i => Math.max(i - 1, 0)); }
        else if (e.key === 'Enter') {
            const hit = pickerOrder[pickerIndex];
            if (hit) { e.preventDefault(); setSelectedAssetId(hit.id); closePicker(); }
        }
    };

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


    // One result line for the last Update-twin run — inline in the main column,
    // or at the top of the side rail when the page is wide enough for one.
    const twinUpdateLine = twinUpdate && !twinUpdate.running ? (
        <div className={`flex items-start gap-2 px-4 py-2 rounded-lg border text-xs ${twinUpdate.failed.length ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
            {twinUpdate.failed.length ? <AlertTriangle size={14} className="shrink-0 mt-0.5" /> : <CheckCircle size={14} className="shrink-0 mt-0.5" />}
            <p className="flex-1 leading-relaxed">
                {twinUpdate.reason === 'auto' ? 'Twin updated automatically — ' : 'Twin updated — '}
                {twinUpdate.done.length ? `${twinUpdate.done.join(', ')}.` : 'nothing completed.'}
                {twinUpdate.failed.length > 0 && <span className="block mt-0.5">Not done: {twinUpdate.failed.join(' · ')}</span>}
            </p>
            <button onClick={() => setTwinUpdate(null)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
        </div>
    ) : null;

    return (
        // Centred like Reliability Modelling (ers-page-wide = 80rem). When the
        // page itself — not the viewport; the sidebar takes 256 px — has room
        // for a 68rem reading column plus a 19rem rail (and still some margin), the rail opens and takes the
        // at-a-glance context; below that everything stays inline.
        <div className="@container/page w-full animate-in fade-in duration-500">
        <div className="mx-auto w-full max-w-[80rem] @min-[90rem]/page:max-w-[88.5rem] @min-[90rem]/page:grid @min-[90rem]/page:grid-cols-[minmax(0,1fr)_19rem] @min-[90rem]/page:gap-6 @min-[90rem]/page:items-start">
        <div className="min-w-0 space-y-6">
            {/* Page Header */}
            <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-4">
                <div>
                    <div className="flex items-center gap-2.5">
                        <h1 className="text-2xl font-bold text-slate-800 font-sans tracking-tight">Predictive Insights</h1>
                    </div>
                    <p className="text-slate-500 text-sm mt-1">See each asset's health and when it may fail.</p>
                </div>

                <div className="flex items-center gap-3">
                    {/* Guided setup — always reachable, auto-shown for first-timers */}
                    <button
                        onClick={() => openSetup(selectedAssetId || undefined)}
                        title="Step-by-step guide: register equipment, define measurements, get data flowing"
                        className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:border-primary-300 hover:text-primary-700 text-slate-600 font-semibold rounded-lg text-sm transition-colors whitespace-nowrap"
                    >
                        <HeartPulse size={16} /> Setup guide
                    </button>
                    {/* #2: Reliability Advisor — grounded, cited PM proposal for this asset (appears once one is chosen) */}
                    {selectedAssetId && (
                        <button
                            onClick={() => setAdvisorOpen(true)}
                            title="Run the Reliability Advisor: real Weibull RUL + cost-justified PM proposal you can approve"
                            className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-500 text-white font-semibold rounded-lg text-sm transition-colors whitespace-nowrap"
                        >
                            <Cpu size={16} /> Reliability Advisor
                        </button>
                    )}
                </div>
            </div>

            {/* The "directional, no fitted life model" caveat is a chip in the
                Overview status strip and a footnote on the RUL tile — once, not a banner. */}

            {/* ═══ Command Palette Modal ═══ */}
            {assetPickerOpen && (
                <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] bg-black/50 backdrop-blur-sm animate-in fade-in duration-150" onClick={closePicker}>
                    <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl shadow-black/30 border border-slate-200 overflow-hidden animate-in slide-in-from-top-4 duration-200" onClick={e => e.stopPropagation()}>
                        {/* Search Input */}
                        <div className="p-4 border-b border-slate-200">
                            <div className="relative">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                <input
                                    type="text"
                                    placeholder="Search by tag, name or system…"
                                    value={assetSearch}
                                    onChange={e => setAssetSearch(e.target.value)}
                                    onKeyDown={onPickerKeyDown}
                                    aria-label="Find an asset"
                                    className="w-full pl-12 pr-20 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-accent-cyan/40 focus:border-accent-cyan placeholder:text-slate-400 font-medium"
                                    autoFocus
                                />
                                <kbd className="absolute right-3 top-1/2 -translate-y-1/2 px-2 py-0.5 text-[10px] font-mono font-bold bg-slate-100 text-slate-400 border border-slate-200 rounded">ESC</kbd>
                            </div>
                        </div>

                        {/* Results — grouped by system */}
                        <div ref={pickerListRef} className="max-h-[50vh] overflow-y-auto">
                            {filteredAssets.length === 0 ? (
                                <div className="p-8 text-center">
                                    <Search size={32} className="mx-auto mb-2 text-slate-300" />
                                    <p className="text-sm font-medium text-slate-500">No matching assets</p>
                                    <p className="text-xs text-slate-400 mt-1">Try a different search term</p>
                                </div>
                            ) : (() => {
                                let flatIdx = 0;
                                return pickerGroups.map(([systemName, assets]) => (
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
                                            const myIdx = flatIdx++;
                                            const isCursor = myIdx === pickerIndex;
                                            const aCritColor = asset.criticality === 'A' ? 'bg-red-500/15 text-red-500 border-red-500/30' : asset.criticality === 'B' ? 'bg-yellow-500/15 text-yellow-600 border-yellow-500/30' : 'bg-slate-100 text-slate-500 border-slate-300';
                                            const fleetMatch = fleetData.find(f => f.asset_id === asset.id);
                                            const hi = fleetMatch?.health_index;
                                            const healthDot = hi != null ? (hi >= 85 ? 'bg-emerald-500' : hi >= 70 ? 'bg-yellow-500' : hi >= 55 ? 'bg-orange-500' : 'bg-red-500') : 'bg-slate-300';

                                            return (
                                                <button
                                                    key={asset.id}
                                                    data-picker-idx={myIdx}
                                                    onMouseEnter={() => setPickerIndex(myIdx)}
                                                    onClick={() => { setSelectedAssetId(asset.id); closePicker(); }}
                                                    className={`w-full flex items-center gap-3 px-5 py-3 text-left transition-all hover:bg-slate-50 ${isCursor ? 'bg-slate-50' : ''} ${isActive ? 'bg-accent-cyan/5 border-l-[3px] border-l-accent-cyan' : 'border-l-[3px] border-l-transparent'} ${idx > 0 ? 'border-t border-t-slate-50' : ''}`}
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
                                <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 bg-white border border-slate-200 rounded font-mono text-[9px]">↑↓</kbd> Move</span>
                                <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 bg-white border border-slate-200 rounded font-mono text-[9px]">Enter</kbd> Open</span>
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

            {/* ═══ ASSET SWITCHER — the study's asset; "Change" opens the picker. Absent
                until an asset is chosen: the fleet chooser below is the one search then. ═══ */}
            {selectedAssetId && (
            <div className="flex flex-col sm:flex-row sm:items-stretch gap-2 sm:gap-3">
                <button
                    onClick={openPicker}
                    className="flex-1 min-w-0 flex items-center gap-3 px-4 py-2.5 bg-white border border-slate-200 rounded-xl shadow-sm hover:border-accent-cyan/50 hover:shadow-md transition-all text-left group"
                    title="Change asset"
                >
                    <Target size={17} className="text-slate-400 group-hover:text-accent-cyan transition-colors shrink-0" />
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 group-hover:text-accent-cyan transition-colors truncate">
                            {selectedAsset ? selectedAsset.name : selectedAssetId}
                        </p>
                        <p className="text-[10px] text-slate-400 truncate">
                            {selectedAsset ? [selectedAsset.tag, selectedAsset.system].filter(Boolean).join(' · ') : 'Not in the register'}
                        </p>
                    </div>
                    {!hasTwin && (
                        <span className="hidden sm:inline text-[10px] font-semibold text-primary-600 shrink-0">Not connected yet</span>
                    )}
                    {selectedAsset && (
                        <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border shrink-0 ${critColor}`}>Crit {critLevel || '?'}</span>
                    )}
                    <span className="flex items-center gap-1 text-xs font-semibold text-primary-600 group-hover:text-primary-500 shrink-0">
                        <Search size={13} /> Change
                    </span>
                </button>
                <div className="flex flex-col items-stretch justify-center gap-0.5">
                    <button
                        onClick={() => updateTwin(selectedAssetId, 'manual')}
                        disabled={!!twinUpdate?.running}
                        title="Snapshot health, update degradation, forecast remaining life and scan for alerts — all four steps, in order"
                        className="flex items-center gap-2 px-4 py-2 bg-accent-cyan hover:bg-primary-400 disabled:opacity-60 text-brand-900 font-semibold rounded-xl text-sm transition-colors shadow-[0_0_15px_rgba(6,182,212,0.2)] whitespace-nowrap"
                    >
                        <RefreshCw size={16} className={twinUpdate?.running ? 'animate-spin' : ''} />
                        {twinUpdate?.running ? `Updating · ${twinUpdate.step}` : 'Update twin'}
                    </button>
                    <button onClick={() => setShowNewInsight(true)} className="text-[10px] text-slate-400 hover:text-primary-600 text-center" title="Run one step on its own">
                        Advanced · one step
                    </button>
                </div>
            </div>
            )}
            {twinUpdateLine && <div className="@min-[90rem]/page:hidden">{twinUpdateLine}</div>}
            {/* The verdict on every tab: at the top of the rail when it is open, else inline here. */}
            {verdict && <div className="@min-[90rem]/page:hidden"><VerdictLine verdict={verdict} onAction={onVerdictAction} /></div>}

            {/* ═══ PLAIN DEFAULT — no asset selected: the fleet map IS the chooser, and its
                search reaches the whole register (unmonitored matches offer set-up). ═══ */}
            {!selectedAssetId && (
                <FleetHealthMap
                    selectedAssetId=""
                    onAssetSelect={(id: string) => setSelectedAssetId(id)}
                    fleetData={fleetData}
                    totalAssetCount={fleetData.length}
                    title="Choose an asset to study"
                    autoFocusSearch
                    unmonitored={unmonitoredAssets}
                    onSetupAsset={(id) => openSetup(id)}
                />
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
            {/* The picture first: the site's drawing, register-resolved and health-badged. */}
            {selectedAssetId && activeTab === 'overview' && (
                <TwinDrawingPanel
                    assetId={selectedAssetId}
                    assetTag={selectedAsset?.tag ?? null}
                    assetName={selectedAsset?.name || selectedAssetId}
                    twinHealth={twinHealth}
                    onSelectAsset={(id) => setSelectedAssetId(id, 'overview')}
                    systemName={selectedAsset?.system ?? null}
                />
            )}
            {selectedAssetId && activeTab === 'overview' && (
                <PredictOverviewTab
                    healthHistory={history.health}
                    newestReadingAt={newestReading}
                    selectedAssetId={selectedAssetId}
                    selectedAssetName={selectedAsset?.name || selectedAssetId}
                    onAssetSelect={(id) => { setSelectedAssetId(id); setAssetPickerOpen(false); }}
                    fleetData={fleetData}
                    totalAssetCount={fleetData.length}
                    systemHealth={systemHealth}
                    isHealthy={isHealthy}
                    rulDays={displayRul?.rul_days}
                    alertCount={effectiveAlertCount}
                    rulConfidenceBands={displayRul?.confidence_bands || []}
                    distributionType={displayRul?.distribution_type || null}
                    rulConfidence={displayRul?.confidence ?? null}
                    groundedFit={groundedActive ? grounded : null}
                    equipmentClass={classRes}
                    rollups={rollups}
                    lineage={lineage}
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
                    equipmentClass={classRes}
                    integrity={integrity}
                    criticality={selectedAsset?.criticality}
                    groundedFit={groundedActive ? grounded : null}
                    onScheduleInspection={setInspectPrefill}
                    onAdoptPmInterval={setPmPrefill}
                    healthHistory={freshHealth.points}
                    ignoredHistoryPoints={freshHealth.ignored}
                    readingAgeDays={readingAgeDays}
                    onAlertRaised={() => refetchPredict(selectedAssetId)}
                />
            )}

            {selectedAssetId && activeTab === 'rul' && (
                <>
                    <RULReliabilityTab
                        rulEstimate={displayRul}
                        rulHistory={history.rul}
                        assetAlerts={assetAlerts}
                        groundedFit={groundedActive ? grounded : null}
                        feedbackStats={feedbackStats}
                        canCloseAlert={canCloseAlert}
                        onAcknowledgeAlert={handleAcknowledgeAlert}
                        onRaiseWork={setRaiseForAlert}
                        onRequestReading={requestReading}
                        onCloseAlert={handleCloseAlert}
                    />
                    {/* Measure → Forecast bridge: SMRP + PSC KPIs, measured vs simulated */}
                    <div className="mt-4">
                        <KpiOutlook
                            assetId={selectedAssetId}
                            groundedFit={groundedActive ? grounded : null}
                            equipmentClass={classRes}
                        />
                    </div>
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
                    {/* B6: the measured false-alarm number — refreshes as feedback lands */}
                    <div className="mt-4">
                        <AlertPrecisionCard refreshKey={feedbackStats} />
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

            {/* Alert → work request (0391): raised here, linked back to the alert; stays on Predict */}
            {raiseForAlert && selectedAssetId && (
                <RaiseWorkModal
                    asset={{ id: selectedAssetId, tag: selectedAsset?.tag || '', name: selectedAsset?.name || selectedAssetId, criticality: (critLevel as any) } as any}
                    kind="REQUEST"
                    actor={profile?.username || profile?.fullName || 'user'}
                    requesterId={profile?.id}
                    sourceLabel="Predict · alert"
                    faultTypes={predictFaultTypes}
                    initialTitle={raiseForAlert.title}
                    dueDate={neededBy.date ?? ''}
                    dueDateNote={neededBy.note}
                    contextNote={[
                        `From Predict alert ${raiseForAlert.alert_id} (${raiseForAlert.severity}).`,
                        raiseForAlert.description,
                        raiseForAlert.diagnosis?.hypotheses?.[0] ? `Most likely cause: ${raiseForAlert.diagnosis.hypotheses[0].failure_mode_code} ${raiseForAlert.diagnosis.hypotheses[0].failure_mode_label}.` : null,
                    ].filter(Boolean).join(' ')}
                    stayOnPage
                    onCreated={async (kind, id) => {
                        if (!id || kind === 'PM') return;
                        const r = await predictionService.linkAlertWork(raiseForAlert.alert_id, kind === 'REQUEST' ? { workRequestId: id } : { workOrderId: id });
                        if (!r.ok) setAdapterNudge(r.message || 'The work was raised but not linked to the alert.');
                        await refetchPredict(raiseForAlert.asset_id);
                    }}
                    onClose={() => setRaiseForAlert(null)}
                />
            )}

            {/* Remaining-life alert → condition-reading request */}
            {readingRequest && selectedAssetId && (
                <RaiseWorkModal
                    asset={{ id: selectedAssetId, tag: selectedAsset?.tag || '', name: selectedAsset?.name || selectedAssetId, criticality: (critLevel as any) } as any}
                    kind="REQUEST"
                    actor={profile?.username || profile?.fullName || 'user'}
                    requesterId={profile?.id}
                    sourceLabel="Predict · remaining-life alert"
                    faultTypes={predictFaultTypes}
                    initialTitle={`Condition reading — ${selectedAsset?.tag || selectedAssetId}`}
                    dueDate={readingRequest.dueDate}
                    dueDateNote="Within the week, and before the work itself is needed — the reading decides what the work is."
                    contextNote={readingRequest.note}
                    stayOnPage
                    onClose={() => setReadingRequest(null)}
                />
            )}

            {/* What-If → PM strategy (Predict→WM link): simulated interval pre-filled */}
            {pmPrefill && selectedAssetId && (
                <RaiseWorkModal
                    asset={{ id: selectedAssetId, tag: selectedAsset?.tag || '', name: selectedAsset?.name || selectedAssetId, criticality: (critLevel as any) } as any}
                    kind="PM"
                    actor={profile?.username || profile?.fullName || 'user'}
                    requesterId={profile?.id}
                    sourceLabel="Predict · What-If simulation"
                    faultTypes={predictFaultTypes}
                    initialTitle={`PM — ${selectedAsset?.tag || selectedAssetId} (What-If optimized, ${pmPrefill.intervalDays}d)`}
                    initialPmIntervalDays={pmPrefill.intervalDays}
                    contextNote={pmPrefill.rationale}
                    onClose={() => setPmPrefill(null)}
                />
            )}

            {/* RBI → inspection WO (Predict→WM link): title/type/due date pre-filled */}
            {inspectPrefill && selectedAssetId && (
                <RaiseWorkModal
                    asset={{ id: selectedAssetId, tag: selectedAsset?.tag || '', name: selectedAsset?.name || selectedAssetId, criticality: (critLevel as any) } as any}
                    kind="WO"
                    actor={profile?.username || profile?.fullName || 'user'}
                    requesterId={profile?.id}
                    sourceLabel="Predict · RBI screening"
                    faultTypes={predictFaultTypes}
                    initialTitle={inspectPrefill.title}
                    initialWorkType="INSP"
                    dueDate={inspectPrefill.dueDate}
                    contextNote={inspectPrefill.contextNote}
                    onClose={() => setInspectPrefill(null)}
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
        <aside className="hidden @min-[90rem]/page:block sticky top-4 self-start max-h-[calc(100vh-2rem)] overflow-y-auto pb-4" aria-label="Asset context">
            {selectedAssetId ? (
                <PredictSideRail
                    mode="asset"
                    asset={{ id: selectedAssetId, tag: selectedAsset?.tag || '', name: selectedAsset?.name || selectedAssetId, system: selectedAsset?.system, criticality: critLevel ?? null }}
                    twinHealth={twinHealth}
                    rulDays={displayRul?.rul_days != null ? Number(displayRul.rul_days) : null}
                    fitted={groundedActive}
                    equipmentClass={classRes}
                    breaches={conditionAlarms?.breaches ?? []}
                    alerts={assetAlerts}
                    onInvestigate={() => { window.location.href = '/analyze'; }}
                    onCreateWR={() => setRaiseOpen(true)}
                    lineage={lineage}
                    rollups={rollups}
                    onSelectAsset={(id) => setSelectedAssetId(id, 'overview')}
                    statusSlot={twinUpdateLine}
                    tab={activeTab}
                    verdict={verdict}
                    onVerdictAction={onVerdictAction}
                    readingAgeDays={readingAgeDays}
                    healthPoints={freshHealth.points.length}
                    ignoredHealthPoints={freshHealth.ignored}
                    neededBy={neededBy}
                    onOpenTab={(t) => setSelectedAssetId(selectedAssetId, t)}
                />
            ) : (
                <PredictSideRail
                    mode="chooser"
                    fleet={fleetData}
                    onSetup={() => openSetup()}
                    rollups={rollups}
                    onSelectAsset={(id) => setSelectedAssetId(id)}
                />
            )}
        </aside>
        </div>
        </div>
    );
};
