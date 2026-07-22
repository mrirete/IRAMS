import { useState, useEffect, useCallback } from 'react';
import type {
    TwinState,
    RULEstimate,
    PredictionAlert,
    BadActorReportOutput,
    BadActorAsset,
    FMEAWorksheetRead,
    RCAInvestigationRead,
    ImpactNetworkResponse,
    SensorTrend,
    GovernanceTier
} from '../types/intelligence';
import * as api from '../api/intelligence';
import {
    MOCK_PREDICT_ASSETS,
    MOCK_TWIN_STATES,
    MOCK_RUL,
    MOCK_ALERTS,
    MOCK_BAD_ACTORS,
    MOCK_FMEA,
    MOCK_RCAS,
    MOCK_NETWORK,
    MOCK_SENSOR_TRENDS
} from '../mockData/intelligence';
import predictionService from '../eam/services/PredictionService';
import type { TwinState as DbTwinState, RULEstimate as DbRULEstimate, PredictionAlert as DbAlert, SensorReading as DbSensor } from '../eam/services/PredictionService';
import analyzeService from '../eam/services/AnalyzeService';
import { DEMO_DATA } from '../config/demoMode';

// Re-export the asset picker type
export type { AssetOption } from '../mockData/intelligence';
export { MOCK_PREDICT_ASSETS as MOCK_ASSETS } from '../mockData/intelligence';

// Show fabricated sample data ONLY in demo mode. In production (default) the
// hook stays empty when the DB/API has nothing, so buyers never see fake
// reliability numbers presented as real.
const USE_MOCK = DEMO_DATA;

// Local aliases for the mock data used in this hook
const assetTwins = MOCK_TWIN_STATES;
const assetRUL = MOCK_RUL;
const mockAlerts = MOCK_ALERTS;
const badActorsByCriteria = MOCK_BAD_ACTORS;
const mockFMEA = MOCK_FMEA;
const mockRCAs = MOCK_RCAS;
const mockNetwork = MOCK_NETWORK;
const mockSensorTrends = MOCK_SENSOR_TRENDS;

// ─── Normalizers: DB shapes → UI types ──────────────────────

/** Convert PredictionService.TwinState (DB) → intelligence.TwinState (UI) */
function normalizeTwin(db: DbTwinState): TwinState {
    return {
        asset_id: db.asset_id,
        twin_id: db.twin_id,
        health_index: Number(db.health_index),
        calibration_quality: Number(db.calibration_quality ?? 0),
        calibration_drift: Number(db.calibration_drift ?? 0),
        sensor_summary: db.sensor_summary || {},
        degradation_models: (db.degradation_models || []).map(m => ({
            mechanism: m.mechanism,
            model_type: m.model_type,
            parameters: m.parameters,
            current_damage_pct: Number(m.current_damage_pct),
            projected_failure_date: (m as any).projected_failure_date ?? null,
        })),
        health_projection: ((db.health_projection || []) as any[]).map(p => ({
            days_ahead: p.days_ahead ?? 0,
            health_index: Number(p.health_index ?? p.predicted_health ?? 0),
            confidence_lower: Number(p.confidence_lower ?? (p.health_index ?? p.predicted_health ?? 0) - 5),
            confidence_upper: Number(p.confidence_upper ?? (p.health_index ?? p.predicted_health ?? 0) + 5),
        })),
        last_calibrated_at: db.last_calibrated_at,
        updated_at: db.updated_at,
    };
}

/** Convert PredictionService.RULEstimate (DB) → intelligence.RULEstimate (UI) */
function normalizeRUL(db: DbRULEstimate): RULEstimate {
    return {
        asset_id: db.asset_id,
        rul_days: Number(db.rul_days),
        confidence: Number(db.confidence ?? 0),
        distribution_type: db.distribution_type || 'weibull_2p',
        dqs_impact: Number(db.dqs_impact ?? 0),
        governance_tier: (db.governance_tier ?? 3) as GovernanceTier,
        computed_at: db.computed_at,
        confidence_bands: (db.confidence_bands || []).map(b => ({
            percentile: Number(b.percentile),
            lower_days: Number(b.lower_days),
            upper_days: Number(b.upper_days),
            median_days: Number(b.median_days),
        })),
    };
}

/** Convert PredictionService.PredictionAlert (DB) → intelligence.PredictionAlert (UI) */
function normalizeAlert(db: DbAlert): PredictionAlert {
    return {
        alert_id: db.alert_id,
        asset_id: db.asset_id,
        alert_type: db.alert_type,
        severity: db.severity as PredictionAlert['severity'],
        title: db.title,
        description: db.description || '',
        confidence: Number(db.confidence ?? 0),
        dqs_impact: Number(db.dqs_impact ?? 0),
        governance_tier: (db.governance_tier ?? 3) as GovernanceTier,
        created_at: db.created_at,
        diagnosis: db.diagnosis ?? null,
        failure_mode_code: db.failure_mode_code ?? null,
    };
}

/** Convert PredictionService.SensorReading (DB) → intelligence.SensorTrend (UI) */
function normalizeSensor(db: DbSensor): SensorTrend {
    return {
        tag: db.tag,
        current: Number(db.current_value ?? 0),
        unit: db.unit,
        readings: (db.readings || []).map(Number),
        trend: (db.trend as SensorTrend['trend']) || 'stable',
        alarm_high: db.alarm_high != null ? Number(db.alarm_high) : undefined,
        alarm_low: db.alarm_low != null ? Number(db.alarm_low) : undefined,
    };
}

// -------------------------------------------------------------------------
//  HOOK — tries Supabase services first, falls back to mock/API
// -------------------------------------------------------------------------

export function useIntelligence(selectedAssetId = '', paretoCriteria: 'cost' | 'downtime' | 'wo_frequency' | 'failure_rate' = 'cost') {
    const [loading, setLoading] = useState(true);

    // Predict state
    const [twinHealth, setTwinHealth] = useState<TwinState | null>(null);
    const [rulEstimate, setRulEstimate] = useState<RULEstimate | null>(null);
    const [alerts, setAlerts] = useState<PredictionAlert[]>([]);
    const [sensorData, setSensorData] = useState<Record<string, SensorTrend[]>>({});

    // Analyze state
    const [badActors, setBadActors] = useState<BadActorReportOutput | null>(null);
    const [fmea, setFmea] = useState<FMEAWorksheetRead | null>(null);
    const [fmeaWorksheets, setFmeaWorksheets] = useState<any[]>([]);
    const [rcas, setRcas] = useState<RCAInvestigationRead[]>([]);

    // Graph state
    const [network, setNetwork] = useState<ImpactNetworkResponse | null>(null);

    // ── Initial load: try Supabase, then API, then mock ──────────────
    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                // 1. Try Supabase services first
                const [dbAlerts, dbFmea, dbRcas] = await Promise.all([
                    predictionService.getAlerts(),
                    analyzeService.getFMEAWorksheets(),
                    analyzeService.getRCAInvestigations(),
                ]);

                if (cancelled) return;

                // Always populate list-level state from Supabase (even if empty)
                setFmeaWorksheets(dbFmea as any);
                setRcas(dbRcas as any);

                const hasSupabaseData = dbAlerts.length > 0 || dbFmea.length > 0 || dbRcas.length > 0;

                if (hasSupabaseData) {
                    if (dbAlerts.length > 0) setAlerts(dbAlerts.map(normalizeAlert));
                    if (dbFmea.length > 0) setFmea(dbFmea[0] as any); // first worksheet for detail view
                    console.log('[useIntelligence] Loaded from Supabase:', {
                        alerts: dbAlerts.length, fmea: dbFmea.length, rcas: dbRcas.length
                    });
                } else if (USE_MOCK) {
                    // 2. Mock mode fallback (display-only singles)
                    setAlerts(mockAlerts);
                    setFmea(mockFMEA);
                } else {
                    // 3. Real API mode
                    const [alertsRes, fmeaRes, graphRes] = await Promise.all([
                        api.fetchAlerts(selectedAssetId),
                        api.fetchFMEA(),
                        api.fetchKnowledgeGraph(selectedAssetId),
                    ]);

                    if (cancelled) return;

                    if (alertsRes.ok) setAlerts(alertsRes.data as any);
                    else setAlerts(mockAlerts);

                    if (fmeaRes.ok) setFmea(fmeaRes.data as any);
                    else setFmea(mockFMEA);

                    if (graphRes.ok) setNetwork(graphRes.data as any);
                    else setNetwork(mockNetwork);
                }

                // Network graph — demo-only sample (no real graph backend yet)
                if (!network && USE_MOCK) setNetwork(mockNetwork);
            } catch {
                // On error: show sample data only in demo mode; production stays empty
                if (!cancelled && USE_MOCK) {
                    setAlerts(mockAlerts);
                    setFmea(mockFMEA);
                    setRcas(mockRCAs);
                    setNetwork(mockNetwork);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // React to asset changes — try Supabase twin/RUL/sensors, fall back to mock
    useEffect(() => {
        if (!selectedAssetId) return; // wait until a real asset ID is set
        let cancelled = false;
        (async () => {
            try {
                const [dbTwin, dbRul, dbSensors] = await Promise.all([
                    predictionService.getTwinState(selectedAssetId),
                    predictionService.getRULEstimate(selectedAssetId),
                    predictionService.getSensorReadings(selectedAssetId),
                ]);
                if (cancelled) return;

                if (dbTwin) setTwinHealth(normalizeTwin(dbTwin));
                else setTwinHealth(USE_MOCK ? (assetTwins[selectedAssetId] || assetTwins['ast-k601']) : null);

                if (dbRul) setRulEstimate(normalizeRUL(dbRul));
                else setRulEstimate(USE_MOCK ? (assetRUL[selectedAssetId] || assetRUL['ast-k601']) : null);

                if (dbSensors.length > 0) {
                    setSensorData(prev => ({ ...prev, [selectedAssetId]: dbSensors.map(normalizeSensor) }));
                } else {
                    // Bridge (Condition Data → Predict): with no online feed, surface
                    // the asset's manual measurement-point readings so operator-rounds
                    // data shows up here without waiting for a prediction run.
                    const manual = await predictionService.getManualReadingsAsSensors(selectedAssetId);
                    if (!cancelled && manual.length > 0) {
                        setSensorData(prev => ({ ...prev, [selectedAssetId]: manual.map(normalizeSensor) }));
                    }
                }
            } catch {
                if (!cancelled && USE_MOCK) {
                    setTwinHealth(assetTwins[selectedAssetId] || assetTwins['ast-k601']);
                    setRulEstimate(assetRUL[selectedAssetId] || assetRUL['ast-k601']);
                }
            }
        })();
        return () => { cancelled = true; };
    }, [selectedAssetId]);

    // React to Pareto criteria changes — try Supabase, fall back to mock
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const dbSnapshot = await analyzeService.getLatestBadActors(paretoCriteria);
                if (cancelled) return;

                if (dbSnapshot) {
                    setBadActors({
                        report_period: dbSnapshot.report_period,
                        criteria: dbSnapshot.criteria as any,
                        pareto_threshold_pct: dbSnapshot.pareto_threshold_pct,
                        top_5_pct_of_total: (dbSnapshot.top_assets as any)[dbSnapshot.top_assets.length - 1]?.cumulative_pct || 0,
                        total_assets_analyzed: dbSnapshot.total_assets_analyzed,
                        generated_at: dbSnapshot.generated_at,
                        top_assets: dbSnapshot.top_assets as any,
                    });
                } else if (USE_MOCK) {
                    // Demo-only sample Pareto
                    const topAssets = badActorsByCriteria[paretoCriteria] || badActorsByCriteria['cost'];
                    const totalPct = topAssets[topAssets.length - 1]?.cumulative_pct || 0;
                    setBadActors({
                        report_period: '2026-02',
                        criteria: paretoCriteria as any,
                        pareto_threshold_pct: 80,
                        top_5_pct_of_total: totalPct,
                        total_assets_analyzed: 1450,
                        generated_at: new Date().toISOString(),
                        top_assets: topAssets,
                    });
                } else {
                    setBadActors(null);
                }
            } catch {
                if (!cancelled && USE_MOCK) {
                    const topAssets = badActorsByCriteria[paretoCriteria] || badActorsByCriteria['cost'];
                    setBadActors({
                        report_period: '2026-02', criteria: paretoCriteria as any,
                        pareto_threshold_pct: 80, top_5_pct_of_total: topAssets[topAssets.length - 1]?.cumulative_pct || 0,
                        total_assets_analyzed: 1450, generated_at: new Date().toISOString(), top_assets: topAssets,
                    });
                }
            }
        })();
        return () => { cancelled = true; };
    }, [paretoCriteria]);

    const getAssetAlerts = useCallback((assetId: string) => {
        return alerts.filter(a => a.asset_id === assetId);
    }, [alerts]);

    const getSensorTrends = useCallback((assetId: string): SensorTrend[] => {
        // Prefer live Supabase data; demo-only sample fallback
        return sensorData[assetId] || (USE_MOCK ? mockSensorTrends[assetId] : undefined) || [];
    }, [sensorData]);

    // Refetch Predict data for a specific asset (after running a new prediction)
    const refetchPredict = useCallback(async (assetId: string) => {
        if (!assetId) return;
        try {
            const [dbTwin, dbRul, dbAlerts, dbSensors] = await Promise.all([
                predictionService.getTwinState(assetId),
                predictionService.getRULEstimate(assetId),
                predictionService.getAlerts(assetId),
                predictionService.getSensorReadings(assetId),
            ]);

            if (dbTwin) setTwinHealth(normalizeTwin(dbTwin));
            if (dbRul) setRulEstimate(normalizeRUL(dbRul));
            if (dbAlerts.length > 0) {
                // Merge new asset-specific alerts with existing global alerts
                setAlerts(prev => {
                    const otherAlerts = prev.filter(a => a.asset_id !== assetId);
                    return [...otherAlerts, ...dbAlerts.map(normalizeAlert)];
                });
            }
            if (dbSensors.length > 0) {
                setSensorData(prev => ({ ...prev, [assetId]: dbSensors.map(normalizeSensor) }));
            } else {
                // Same manual-readings bridge as the initial fetch (Condition Data → Predict).
                const manual = await predictionService.getManualReadingsAsSensors(assetId);
                if (manual.length > 0) {
                    setSensorData(prev => ({ ...prev, [assetId]: manual.map(normalizeSensor) }));
                }
            }
            console.log('[useIntelligence] refetchPredict complete for', assetId);
        } catch (e) {
            console.error('[useIntelligence] refetchPredict error:', e);
        }
    }, []);

    // Refetch Analyze data (called after creating a new RCA/FMEA)
    const refetchAnalyze = useCallback(async () => {
        try {
            const [dbFmea, dbRcas] = await Promise.all([
                analyzeService.getFMEAWorksheets(),
                analyzeService.getRCAInvestigations(),
            ]);
            setFmeaWorksheets(dbFmea as any);
            if (dbFmea.length > 0) setFmea(dbFmea[0] as any);
            if (dbRcas.length > 0) setRcas(dbRcas as any);
        } catch (e) {
            console.error('[useIntelligence] refetchAnalyze error:', e);
        }
    }, []);

    return {
        loading,
        // Predict
        twinHealth,
        rulEstimate,
        alerts,
        getAssetAlerts,
        getSensorTrends,
        refetchPredict,
        // Analyze
        badActors,
        fmea,
        fmeaWorksheets,
        rcas,
        refetchAnalyze,
        // Graph
        network,
    };
}
