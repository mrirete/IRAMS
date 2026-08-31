/**
 * PredictionService — Supabase CRUD + compute for the ERS Predict domain.
 *
 * Tables: ers_twin_states, ers_rul_estimates, ers_prediction_alerts, ers_sensor_readings
 *
 * ── ISO 13374 processing spine (Phase 6.2 — where each layer lives) ──
 *  DA  Data Acquisition      getSensorReadings / getManualReadingsAsSensors /
 *                            importSensorReadings (CSV) — online feed + rounds bridge
 *  DM  Data Manipulation     sensorKind tagging (lib/predict/healthModels), trend
 *                            derivation in the manual bridge; spectral features
 *                            (RMS/kurtosis/crest, FFT + envelope) via
 *                            lib/predict/spectral on ers_waveforms captures (0206)
 *  SD  State Detection       _runAlertScan — band breaches with ISA-18.2-lite dedup
 *                            + persistence (one open alert per point)
 *  HA  Health Assessment     _runDigitalTwinSnapshot — class-aware weighting
 *                            (lib/predict/healthModels × lib/predict/equipmentClass),
 *                            bands from lib/predict/limitLibrary provenance
 *  PA  Prognostic Assessment _runRULAnalysis (censored Weibull MRL via eam/utils/
 *                            weibull + lib/pmRecommendation), _runDegradationUpdate
 *                            (fitted wear-out / API 570 corrosion via lib/predict/
 *                            integrity), RBI screening (lib/predict/rbi)
 *  AG  Advisory Generation   threshold_adapter proposals (AgentService → HITL
 *                            AgentReviewPanel), alert→WO drafts, Create-WR actions
 *
 * Adding a new equipment class touches HA/PA config (healthModels, limitLibrary)
 * only — the spine stays put.
 */
import { supabase } from '../lib/supabase';
import { buildSensorReading } from '../lib/sensorReading';
import { failureIntervalsHours, isFailure } from './reliabilityMetrics';
import { groundedRulFromHistory } from '../../lib/pmRecommendation';
import { conditionalRemainingQuantileHours } from '../utils/weibull';
import { resolveEquipmentClass } from '../../lib/predict/equipmentClass';
import { healthModelFor, sensorKind } from '../../lib/predict/healthModels';
import { assessIntegrity } from '../../lib/predict/integrity';
import type { BearingSpec, BearingToneMatch } from '../../lib/predict/bearingFaults';
import {
    diagnoseEvidence,
    type DiagnosisResult, type SensorEvidence, type SpectralEvidence, type AssetPriors,
} from '../../lib/predict/diagnosisRules';

// ─── Types ───────────────────────────────────────────────────
export interface TwinState {
    id: string;
    asset_id: string;
    twin_id: string;
    health_index: number;
    calibration_quality: number | null;
    calibration_drift: number | null;
    sensor_summary: Record<string, number>;
    degradation_models: DegradationModel[];
    health_projection: HealthProjectionPoint[];
    last_calibrated_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface DegradationModel {
    mechanism: string;
    model_type: string;
    parameters: Record<string, number>;
    current_damage_pct: number;
}

export interface HealthProjectionPoint {
    date: string;
    predicted_health: number;
}

export interface RULEstimate {
    id: string;
    asset_id: string;
    rul_days: number;
    confidence: number | null;
    distribution_type: string | null;
    dqs_impact: number | null;
    governance_tier: number | null;
    confidence_bands: ConfidenceBand[];
    computed_at: string;
    created_at: string;
}

export interface ConfidenceBand {
    percentile: number;
    lower_days: number;
    upper_days: number;
    median_days: number;
}

export interface PredictionAlert {
    id: string;
    alert_id: string;
    asset_id: string;
    alert_type: 'trend_deviation' | 'threshold_breach' | 'anomaly' | 'rul_warning' | 'pattern_detected';
    severity: 'low' | 'medium' | 'high' | 'critical';
    title: string;
    description: string | null;
    confidence: number | null;
    dqs_impact: number | null;
    governance_tier: number | null;
    acknowledged: boolean;
    acknowledged_by: string | null;
    acknowledged_at: string | null;
    created_at: string;
    /** Diagnosis layer (0215): ranked failure-mode hypotheses + evidence (diagnosis-rules-v1). */
    diagnosis?: DiagnosisResult | null;
    /** Top hypothesis — denormalized for filtering (reference_codes FAILURE_MODE). */
    failure_mode_code?: string | null;
}

export interface SensorReading {
    id: string;
    asset_id: string;
    tag: string;
    current_value: number | null;
    unit: string;
    trend: 'rising' | 'falling' | 'stable' | null;
    alarm_high: number | null;
    alarm_low: number | null;
    readings: number[];
    created_at: string;
    /** ISA-18.2 rationalization (0205) — per-point alarm hygiene + guidance. */
    alarm_deadband_pct?: number | null;
    alarm_persistence?: number | null;
    operator_action?: string | null;
}

/** Stored under assets.properties.predict (0005 JSONB — no schema change). */
export interface AssetPredictConfig {
    rated_rpm?: number | null;
    bearings?: BearingSpec[];
}

/** A stored vibration time-waveform + its computed spectral features (0206). */
export interface WaveformCapture {
    id: string;
    asset_id: string;
    tag: string;
    sample_rate_hz: number;
    rpm: number | null;
    features: Record<string, any>;
    captured_at: string;
}

// ─── Agentic Intelligence Types ──────────────────────────────

export type AgentType = 'alert_to_wo' | 'bad_actor_rca' | 'threshold_adapter' | 'pm_effectiveness' | 'budget_overrun' | 'stockout_prevention' | 'cert_expiry' | 'compliance_audit' | 'auto_pareto' | 'vision_to_wo' | 'inspection_to_wo' | 'conversational_planner' | 'predictive_procurement';
// 'applied' (0299): approved AND written into IREAMS's own schedule — terminal.
export type AgentActionStatus = 'pending_review' | 'approved' | 'rejected' | 'expired' | 'applied';
export type AgentActionType = 'wr_draft' | 'rca_draft' | 'threshold_proposal' | 'pm_adjustment' | 'cost_investigation' | 'emergency_po_draft' | 'training_request' | 'quality_report' | 'de_task_draft' | 'work_plan_draft' | 'procurement_forecast';

export interface PredictionFeedback {
    id: string;
    alert_id: string;
    asset_id: string;
    feedback_type: 'actionable' | 'false_alarm';
    feedback_by: string;
    notes: string | null;
    created_at: string;
}

export interface AgentAction {
    id: string;
    agent_type: AgentType;
    trigger_id: string;
    asset_id: string;
    action_type: AgentActionType;
    draft_payload: Record<string, any>;
    status: AgentActionStatus;
    reviewed_by: string | null;
    reviewed_at: string | null;
    review_notes: string | null;
    created_at: string;
}

// ─── Service ─────────────────────────────────────────────────
class PredictionService {
    private static instance: PredictionService;
    private constructor() { }

    static getInstance(): PredictionService {
        if (!PredictionService.instance) {
            PredictionService.instance = new PredictionService();
        }
        return PredictionService.instance;
    }

    // ── Twin States ────────────────────────────────────────────
    async getTwinStates(assetId?: string): Promise<TwinState[]> {
        try {
            let query = supabase.from('ers_twin_states').select('*');
            if (assetId) query = query.eq('asset_id', assetId);
            const { data, error } = await query.order('created_at', { ascending: false });
            if (error) { console.error('PredictionService.getTwinStates:', error); throw error; }
            return (data || []) as TwinState[];
        } catch (e) {
            console.error('Error fetching twin states:', e);
            return [];
        }
    }

    async getTwinState(assetId: string): Promise<TwinState | null> {
        try {
            const { data, error } = await supabase
                .from('ers_twin_states')
                .select('*')
                .eq('asset_id', assetId)
                .maybeSingle();
            if (error) { console.error('PredictionService.getTwinState:', error); throw error; }
            return data as TwinState | null;
        } catch (e) {
            console.error('Error fetching twin state:', e);
            return null;
        }
    }

    async upsertTwinState(state: Partial<TwinState> & { asset_id: string }): Promise<TwinState | null> {
        try {
            const { data, error } = await supabase
                .from('ers_twin_states')
                .upsert({ ...state, updated_at: new Date().toISOString() }, { onConflict: 'asset_id' })
                .select()
                .single();
            if (error) { console.error('PredictionService.upsertTwinState:', error); throw error; }
            return data as TwinState;
        } catch (e) {
            console.error('Error upserting twin state:', e);
            return null;
        }
    }

    // ── RUL Estimates ──────────────────────────────────────────
    async getRULEstimates(assetId?: string): Promise<RULEstimate[]> {
        try {
            let query = supabase.from('ers_rul_estimates').select('*');
            if (assetId) query = query.eq('asset_id', assetId);
            const { data, error } = await query.order('computed_at', { ascending: false });
            if (error) { console.error('PredictionService.getRULEstimates:', error); throw error; }
            return (data || []) as RULEstimate[];
        } catch (e) {
            console.error('Error fetching RUL estimates:', e);
            return [];
        }
    }

    async getRULEstimate(assetId: string): Promise<RULEstimate | null> {
        try {
            const { data, error } = await supabase
                .from('ers_rul_estimates')
                .select('*')
                .eq('asset_id', assetId)
                .maybeSingle();
            if (error) { console.error('PredictionService.getRULEstimate:', error); throw error; }
            return data as RULEstimate | null;
        } catch (e) {
            console.error('Error fetching RUL estimate:', e);
            return null;
        }
    }

    async upsertRULEstimate(estimate: Partial<RULEstimate> & { asset_id: string }): Promise<RULEstimate | null> {
        try {
            const { data, error } = await supabase
                .from('ers_rul_estimates')
                .upsert(estimate, { onConflict: 'asset_id' })
                .select()
                .single();
            if (error) { console.error('PredictionService.upsertRULEstimate:', error); throw error; }
            return data as RULEstimate;
        } catch (e) {
            console.error('Error upserting RUL estimate:', e);
            return null;
        }
    }

    // ── Prediction Alerts ──────────────────────────────────────
    async getAlerts(assetId?: string, severity?: string): Promise<PredictionAlert[]> {
        try {
            let query = supabase.from('ers_prediction_alerts').select('*');
            if (assetId) query = query.eq('asset_id', assetId);
            if (severity) query = query.eq('severity', severity);
            const { data, error } = await query.order('created_at', { ascending: false });
            if (error) { console.error('PredictionService.getAlerts:', error); throw error; }
            return (data || []) as PredictionAlert[];
        } catch (e) {
            console.error('Error fetching alerts:', e);
            return [];
        }
    }

    async acknowledgeAlert(alertId: string, userId: string): Promise<boolean> {
        try {
            const { error } = await supabase
                .from('ers_prediction_alerts')
                .update({
                    acknowledged: true,
                    acknowledged_by: userId,
                    acknowledged_at: new Date().toISOString(),
                })
                .eq('id', alertId);
            if (error) { console.error('PredictionService.acknowledgeAlert:', error); throw error; }
            return true;
        } catch (e) {
            console.error('Error acknowledging alert:', e);
            return false;
        }
    }

    async createAlert(alert: Omit<PredictionAlert, 'id' | 'created_at' | 'acknowledged' | 'acknowledged_by' | 'acknowledged_at'>): Promise<PredictionAlert | null> {
        try {
            const { data, error } = await supabase
                .from('ers_prediction_alerts')
                .insert(alert)
                .select()
                .single();
            if (error) { console.error('PredictionService.createAlert:', error); throw error; }
            return data as PredictionAlert;
        } catch (e) {
            console.error('Error creating alert:', e);
            return null;
        }
    }

    // ── Sensor Readings ────────────────────────────────────────
    async getSensorReadings(assetId: string): Promise<SensorReading[]> {
        try {
            const { data, error } = await supabase
                .from('ers_sensor_readings')
                .select('*')
                .eq('asset_id', assetId)
                .order('tag', { ascending: true });
            if (error) { console.error('PredictionService.getSensorReadings:', error); throw error; }
            return (data || []) as SensorReading[];
        } catch (e) {
            console.error('Error fetching sensor readings:', e);
            return [];
        }
    }

    async upsertSensorReadings(readings: Array<Partial<SensorReading> & { asset_id: string; tag: string }>): Promise<boolean> {
        try {
            const { error } = await supabase
                .from('ers_sensor_readings')
                .upsert(readings);
            if (error) { console.error('PredictionService.upsertSensorReadings:', error); throw error; }
            return true;
        } catch (e) {
            console.error('Error upserting sensor readings:', e);
            return false;
        }
    }

    /**
     * Bridge (Condition Data → Predict): map an asset's manual measurement points
     * and their latest logged readings into the SensorReading shape the twin
     * engine consumes. This lets handheld/operator-rounds data drive Health Index
     * and RUL for sites with no online sensor feed — computed in memory, nothing
     * fabricated. Alarm bands come from the reading definition; trend is inferred
     * from the last two readings.
     */
    async getManualReadingsAsSensors(assetId: string): Promise<SensorReading[]> {
        const [defsRes, logsRes] = await Promise.all([
            supabase.from('reading_definitions').select('*').eq('asset_id', assetId).eq('is_active', true),
            supabase.from('reading_logs').select('*').eq('asset_id', assetId).order('reading_date', { ascending: false }),
        ]);
        const defs = defsRes.data || [];
        const logs = logsRes.data || [];
        // Group logs newest-first per definition.
        const byDef = new Map<string, any[]>();
        for (const l of logs) {
            const arr = byDef.get(l.definition_id) || [];
            arr.push(l);
            byDef.set(l.definition_id, arr);
        }
        return defs.map((d: any): SensorReading => {
            const hist = byDef.get(d.id) || [];
            const latest = hist[0];
            const prev = hist[1];
            const cur = latest?.reading_value != null ? Number(latest.reading_value) : null;
            let trend: 'rising' | 'falling' | 'stable' | null = null;
            if (cur != null && prev?.reading_value != null) {
                const p = Number(prev.reading_value);
                trend = cur > p ? 'rising' : cur < p ? 'falling' : 'stable';
            }
            return {
                id: `manual-${d.id}`,
                asset_id: assetId,
                tag: d.name,
                current_value: cur,
                unit: d.unit || '',
                trend,
                alarm_high: d.max_critical ?? d.max_warning ?? null,
                alarm_low: d.min_critical ?? d.min_warning ?? null,
                readings: hist.slice(0, 20).map(h => Number(h.reading_value)).filter(v => !Number.isNaN(v)).reverse(),
                created_at: latest?.reading_date || new Date().toISOString(),
                // 0205 rationalization fields — undefined pre-migration (select *)
                alarm_deadband_pct: d.alarm_deadband_pct ?? null,
                alarm_persistence: d.alarm_persistence ?? null,
                operator_action: d.operator_action ?? null,
            };
        }).filter(s => s.current_value != null);
    }

    /**
     * Sensor source for the Predict engine: prefer an online sensor feed
     * (ers_sensor_readings); fall back to manual Condition Data when none exists.
     */
    async getSensorsForAsset(assetId: string): Promise<SensorReading[]> {
        const online = await this.getSensorReadings(assetId);
        if (online.length > 0) return online;
        return this.getManualReadingsAsSensors(assetId);
    }

    // ── Waveform captures (DM layer, 0206) ─────────────────
    // Raw samples are kept only up to a cap; the computed spectral features
    // (the DM layer's actual product) always persist.

    async saveWaveform(rec: {
        asset_id: string; tag: string; sample_rate_hz: number; rpm: number | null;
        samples: number[] | null; features: Record<string, any>; created_by?: string | null;
    }): Promise<WaveformCapture | null> {
        const { data, error } = await supabase.from('ers_waveforms').insert({
            asset_id: rec.asset_id,
            tag: rec.tag,
            sample_rate_hz: rec.sample_rate_hz,
            rpm: rec.rpm,
            samples: rec.samples && rec.samples.length <= 16384 ? rec.samples : null,
            features: rec.features,
            created_by: rec.created_by ?? null,
        }).select('id, asset_id, tag, sample_rate_hz, rpm, features, captured_at').single();
        if (error) {
            // Graceful pre-0206: the table may not exist yet.
            console.warn('[PredictionService.saveWaveform]', error.message);
            return null;
        }
        return data as WaveformCapture;
    }

    /**
     * Per-asset Predict config (rated RPM, bearing specs) — lives under
     * assets.properties.predict so no schema change is needed. Read-modify-write
     * on save so other properties keys are preserved.
     */
    async getAssetPredictConfig(assetId: string): Promise<AssetPredictConfig> {
        const { data, error } = await supabase.from('assets')
            .select('properties').eq('id', assetId).maybeSingle();
        if (error || !data) return {};
        return ((data.properties as Record<string, any> | null)?.predict ?? {}) as AssetPredictConfig;
    }

    async saveAssetPredictConfig(assetId: string, cfg: AssetPredictConfig): Promise<boolean> {
        const { data, error } = await supabase.from('assets')
            .select('properties').eq('id', assetId).maybeSingle();
        if (error) {
            console.warn('[PredictionService.saveAssetPredictConfig]', error.message);
            return false;
        }
        const properties = { ...((data?.properties as Record<string, any>) || {}), predict: cfg };
        const { error: upErr } = await supabase.from('assets').update({ properties }).eq('id', assetId);
        if (upErr) console.warn('[PredictionService.saveAssetPredictConfig]', upErr.message);
        return !upErr;
    }

    async getWaveforms(assetId: string, limit = 10): Promise<WaveformCapture[]> {
        const { data, error } = await supabase.from('ers_waveforms')
            .select('id, asset_id, tag, sample_rate_hz, rpm, features, captured_at')
            .eq('asset_id', assetId)
            .order('captured_at', { ascending: false })
            .limit(limit);
        if (error) {
            console.warn('[PredictionService.getWaveforms]', error.message);
            return [];
        }
        return (data || []) as WaveformCapture[];
    }

    /**
     * CSV connector — upsert imported sensor readings into ers_sensor_readings
     * (the online feed the Predict twin reads). Idempotent: existing rows for the
     * same (asset, tag) are updated in place rather than duplicated, so re-importing
     * an export refreshes values instead of piling up.
     */
    async importSensorReadings(items: Array<{
        asset_id: string; tag: string; unit: string; current_value: number;
        trend: 'rising' | 'falling' | 'stable' | null; readings: number[];
        alarm_high: number | null; alarm_low: number | null;
    }>): Promise<{ upserted: number }> {
        if (items.length === 0) return { upserted: 0 };
        const assetIds = [...new Set(items.map(i => i.asset_id))];
        const idByKey = new Map<string, string>();
        for (const aid of assetIds) {
            const existing = await this.getSensorReadings(aid);
            existing.forEach(r => idByKey.set(`${aid}|${r.tag}`, r.id));
        }
        const payload = items.map(i => buildSensorReading({
            id: idByKey.get(`${i.asset_id}|${i.tag}`),   // reuse existing row id → idempotent upsert
            assetId: i.asset_id,
            tag: i.tag,
            currentValue: i.current_value,
            unit: i.unit,
            trend: i.trend,
            alarmHigh: i.alarm_high,
            alarmLow: i.alarm_low,
            readings: i.readings,
        }));
        const { error } = await supabase.from('ers_sensor_readings').upsert(payload);
        if (error) { console.error('PredictionService.importSensorReadings:', error); throw new Error(error.message); }
        return { upserted: payload.length };
    }

    // ══════════════════════════════════════════════════════════
    //  Run Prediction — compute & persist per insight type
    // ══════════════════════════════════════════════════════════

    async runPrediction(
        type: 'digital_twin' | 'rul_analysis' | 'alert_config' | 'degradation_model',
        assetId: string,
        title: string,
        description: string,
    ): Promise<{ success: boolean; message: string }> {
        try {
            switch (type) {
                case 'digital_twin':
                    return this._runDigitalTwinSnapshot(assetId, title);
                case 'rul_analysis':
                    return this._runRULAnalysis(assetId, title);
                case 'alert_config':
                    return this._runAlertScan(assetId, title);
                case 'degradation_model':
                    return this._runDegradationUpdate(assetId, title);
                default:
                    return { success: false, message: `Unknown prediction type: ${type}` };
            }
        } catch (e: any) {
            console.error(`[PredictionService.runPrediction] ${type} failed:`, e);
            return { success: false, message: e.message || 'Prediction failed' };
        }
    }

    // ── Digital Twin Snapshot ───────────────────────────────
    private async _runDigitalTwinSnapshot(assetId: string, title: string): Promise<{ success: boolean; message: string }> {
        const online = await this.getSensorReadings(assetId);
        const sensors = online.length > 0 ? online : await this.getManualReadingsAsSensors(assetId);
        const source = online.length > 0 ? 'online sensors' : 'manual Condition Data';
        if (sensors.length === 0) {
            return { success: false, message: 'No sensor readings found. Enter readings on Condition Data (Work Management), or connect an online sensor feed.' };
        }

        // Weighted health scoring from sensor proximity to alarm limits
        const sensorScores = sensors.map(s => {
            if (s.current_value == null || s.alarm_high == null || s.alarm_low == null) return 100;
            const range = s.alarm_high - s.alarm_low;
            if (range <= 0) return 100;
            // How far from midpoint relative to range → proximity to alarm = damage
            const midpoint = (s.alarm_high + s.alarm_low) / 2;
            const deviation = Math.abs(s.current_value - midpoint) / (range / 2);
            return Math.max(0, Math.min(100, 100 - deviation * 40));
        });

        // Class-aware weighting (Phase 2): a static cooler's health is driven by
        // thickness/thermal/pressure, a rotating machine's by vibration — one
        // universal blend was wrong for both. Class from the register (declared)
        // or inferred from the name; 'other' keeps the legacy generic blend.
        const { data: assetRow } = await supabase.from('assets')
            .select('name, tag, asset_class, asset_category, asset_type_code')
            .eq('id', assetId)
            .maybeSingle();
        const classRes = resolveEquipmentClass(assetRow ? {
            name: assetRow.name, tag: assetRow.tag,
            assetClass: assetRow.asset_class, assetCategory: assetRow.asset_category, assetType: assetRow.asset_type_code,
        } : null);
        const model = healthModelFor(classRes.cls);

        let totalWeight = 0;
        let weightedSum = 0;
        sensors.forEach((s, i) => {
            const w = model.weights[sensorKind(s.tag)] ?? model.defaultWeight;
            weightedSum += sensorScores[i] * w;
            totalWeight += w;
        });
        const healthIndex = totalWeight > 0
            ? Math.round((weightedSum / totalWeight) * 10) / 10
            : sensorScores.reduce((a, b) => a + b, 0) / sensorScores.length;

        // Build sensor summary
        const sensorSummary: Record<string, number> = {};
        sensors.forEach(s => { sensorSummary[s.tag] = s.current_value ?? 0; });

        // Build 30-day health projection — deterministic linear decay from the
        // current index. Uncertainty is expressed by the widening confidence
        // band (±0.15/day), NOT by fabricated random noise on the mean.
        const decayRate = healthIndex < 70 ? 0.25 : healthIndex < 85 ? 0.12 : 0.05;
        const healthProjection = Array.from({ length: 30 }, (_, i) => {
            const d = i + 1;
            const predicted = Math.max(20, healthIndex - d * decayRate);
            return {
                days_ahead: d,
                health_index: Math.round(predicted * 10) / 10,
                confidence_lower: Math.round(Math.max(10, predicted - d * 0.15) * 10) / 10,
                confidence_upper: Math.round(Math.min(100, predicted + d * 0.15) * 10) / 10,
            };
        });

        // Calibration quality = real data coverage (fraction of sensors reporting
        // a current value), not a fabricated 90–98. Drift is not measured from
        // this data, so report 0 rather than inventing a number.
        const sensorsWithValue = sensors.filter(s => s.current_value != null).length;
        const calQuality = sensors.length ? Math.round((sensorsWithValue / sensors.length) * 1000) / 10 : 0;
        const calDrift = 0;

        const result = await this.upsertTwinState({
            asset_id: assetId,
            twin_id: `twn-${assetId.substring(0, 8)}`,
            health_index: healthIndex,
            calibration_quality: calQuality,
            calibration_drift: calDrift,
            sensor_summary: sensorSummary,
            degradation_models: [], // preserved from existing if needed
            health_projection: healthProjection as any,
            last_calibrated_at: new Date().toISOString(),
        });

        if (!result) return { success: false, message: 'Failed to persist twin state to database.' };
        return { success: true, message: `Digital Twin updated — Health Index: ${healthIndex.toFixed(1)}/100 (from ${source}, ${model.label.toLowerCase()} model${classRes.basis !== 'declared' ? ` · class ${classRes.basis}` : ''})` };
    }

    // ── RUL Analysis ───────────────────────────────────────
    // Grounded-first (R-1/R-6): fit a censored Weibull to the asset's WO
    // failure history and persist the conditional mean-residual-life RUL —
    // the same math the Reliability Advisor shows. The health-index heuristic
    // survives only as an explicitly tagged 'heuristic' fallback.
    private async _runRULAnalysis(assetId: string, _title: string): Promise<{ success: boolean; message: string }> {
        const twin = await this.getTwinState(assetId);
        const sensors = await this.getSensorsForAsset(assetId);

        // DQS impact: penalizes missing or flat sensors (both paths)
        const flatSensors = sensors.filter(s => s.trend === 'stable').length;
        const dqsImpact = Math.round(flatSensors * 0.015 * 100) / 100;
        const healthIndex = twin ? Number(twin.health_index) : 75;
        const govTier = healthIndex < 60 ? 2 : healthIndex < 80 ? 3 : 4;

        // ── Grounded path: WO failure history → censored Weibull → MRL ──
        const { data: wos } = await supabase.from('work_orders')
            .select('id, type, created_at, closed_at, wo_failure_data!wo_id(failure_mode_code)')
            .eq('asset_id', assetId)
            .order('created_at');
        const rows = wos || [];
        const intervals = failureIntervalsHours(rows);
        const lastFail = rows.filter(isFailure)
            .map((w: any) => new Date(w.closed_at || w.created_at).getTime())
            .sort((a, b) => b - a)[0];
        const suspensions: number[] = [];
        if (lastFail) {
            const h = Math.floor((Date.now() - lastFail) / 3600000);
            if (h > 0) suspensions.push(h);
        }
        const grounded = groundedRulFromHistory(intervals, suspensions);

        if (grounded.method === 'weibull-mrl' && grounded.rulDays != null && grounded.beta && grounded.eta) {
            const ageH = grounded.ageDays * 24;
            const q = (p: number) => Math.round(conditionalRemainingQuantileHours(grounded.beta!, grounded.eta!, ageH, p) / 24);
            // Percentile bands = conditional remaining-life quantiles of the fit.
            const bands = [
                { percentile: 50, lower_days: q(0.25), upper_days: q(0.75), median_days: q(0.5) },
                { percentile: 80, lower_days: q(0.10), upper_days: q(0.90), median_days: q(0.5) },
                { percentile: 95, lower_days: q(0.025), upper_days: q(0.975), median_days: q(0.5) },
            ];
            // Confidence from regression fit quality (R² of the median-rank fit).
            const confidence = Math.min(0.98, Math.max(0.50, grounded.fit?.r2 ?? 0.8));

            const result = await this.upsertRULEstimate({
                asset_id: assetId,
                rul_days: grounded.rulDays,
                confidence: Math.round(confidence * 100) / 100,
                distribution_type: 'weibull_2p',
                dqs_impact: dqsImpact,
                governance_tier: govTier,
                confidence_bands: bands,
                computed_at: new Date().toISOString(),
            });
            if (!result) return { success: false, message: 'Failed to persist RUL estimate to database.' };
            return {
                success: true,
                message: `RUL Forecast: ${grounded.rulDays.toFixed(0)} days — Weibull MRL (β=${grounded.beta}, η=${grounded.eta}h, R²=${grounded.fit?.r2 ?? '—'}) from ${grounded.fit?.nFailures ?? intervals.length} failures`,
            };
        }

        // ── Fallback: health-index heuristic, honestly tagged ──
        const remainingHealth = healthIndex - 30; // failure threshold at 30
        const risingSensors = sensors.filter(s => s.trend === 'rising').length;
        const trendPenalty = 1 - risingSensors * 0.08;
        const baseRUL = Math.max(15, remainingHealth * 4.5 * trendPenalty);

        // Confidence: higher with more sensor data
        const dataPoints = sensors.reduce((sum, s) => sum + (s.readings?.length || 0), 0);
        const confidence = Math.min(0.98, Math.max(0.60, 0.70 + dataPoints * 0.002));

        // Directional spread markers — NOT fitted percentiles (no distribution exists).
        const bands = [
            { percentile: 50, lower_days: Math.round(baseRUL * 0.85), upper_days: Math.round(baseRUL * 1.15), median_days: Math.round(baseRUL) },
            { percentile: 80, lower_days: Math.round(baseRUL * 0.70), upper_days: Math.round(baseRUL * 1.35), median_days: Math.round(baseRUL) },
            { percentile: 95, lower_days: Math.round(baseRUL * 0.55), upper_days: Math.round(baseRUL * 1.60), median_days: Math.round(baseRUL) },
        ];

        const result = await this.upsertRULEstimate({
            asset_id: assetId,
            rul_days: Math.round(baseRUL * 10) / 10,
            confidence: Math.round(confidence * 100) / 100,
            distribution_type: 'heuristic',
            dqs_impact: dqsImpact,
            governance_tier: govTier,
            confidence_bands: bands,
            computed_at: new Date().toISOString(),
        });

        if (!result) return { success: false, message: 'Failed to persist RUL estimate to database.' };
        return {
            success: true,
            message: `RUL Forecast: ${baseRUL.toFixed(0)} days — directional heuristic (needs ≥2 recorded failures for a fitted Weibull; ${intervals.length} on record)`,
        };
    }

    // ── Alert Scan ─────────────────────────────────────────
    // ISA-18.2-lite hygiene (1.5.5): one OPEN alert per measurement point
    // (re-scanning a breaching sensor must not stack duplicates), and a
    // persistence check (the previous reading must also breach) so a value
    // chattering around a limit doesn't fire on every oscillation.
    private async _runAlertScan(assetId: string, title: string): Promise<{ success: boolean; message: string }> {
        const sensors = await this.getSensorsForAsset(assetId);
        if (sensors.length === 0) {
            return { success: false, message: 'No sensor readings found — enter readings on Condition Data (Work Management), or connect an online sensor feed.' };
        }

        // Tags that already have an unacknowledged alert — skip them (dedup).
        const existing = await this.getAlerts(assetId);
        const openTags = new Set(
            existing.filter(a => !a.acknowledged)
                .map(a => (a.title.split(': ').pop() || '').trim().toLowerCase())
                .filter(Boolean),
        );

        let suppressed = 0;
        const fired: { s: SensorReading; breachHigh: boolean; breachLow: boolean; trendAnomaly: boolean }[] = [];
        for (const s of sensors) {
            if (s.current_value == null) continue;

            // Threshold breach: current value near or beyond alarm limits.
            // Approach margin (deadband) is per-point when rationalized (0205),
            // engine default 10% otherwise; clamped to a sane 0–50%.
            const deadband = Math.min(50, Math.max(0, s.alarm_deadband_pct ?? 10)) / 100;
            const hiGate = s.alarm_high != null ? s.alarm_high * (1 - deadband) : null;
            const loGate = s.alarm_low != null ? s.alarm_low * (1 + deadband) : null;
            let breachHigh = hiGate != null && s.current_value >= hiGate;
            let breachLow = loGate != null && s.current_value <= loGate;

            // Persistence (ISA-18.2): require the last N consecutive readings to
            // breach before firing (per-point when rationalized, default 2 —
            // i.e. current + previous). Readings are stored oldest→newest.
            const requireN = Math.min(10, Math.max(1, s.alarm_persistence ?? 2));
            const hist = s.readings || [];
            if (requireN > 1 && hist.length >= 2) {
                // The window covers the N-1 readings before the current value.
                const window = hist.slice(-requireN, -1);
                const enough = window.length >= requireN - 1;
                if (breachHigh && hiGate != null && (!enough || window.some(v => v < hiGate))) breachHigh = false;
                if (breachLow && loGate != null && (!enough || window.some(v => v > loGate))) breachLow = false;
            }

            // Dedup: an open alert already covers this point.
            if ((breachHigh || breachLow) && openTags.has(s.tag.trim().toLowerCase())) {
                suppressed++;
                continue;
            }

            // Trend anomaly: rising trend combined with proximity to alarm
            const trendAnomaly = s.trend === 'rising' && breachHigh;

            if (breachHigh || breachLow || trendAnomaly) fired.push({ s, breachHigh, breachLow, trendAnomaly });
        }

        // Diagnosis layer (0215): ONE evidence bundle across all firing points —
        // cross-signal rules (bearing temp + vibration → LUB) need the full
        // picture, and every alert from this scan shares the same plant state.
        const diagnosis = fired.length > 0 ? await this._diagnoseFiring(assetId, fired) : null;

        let alertsCreated = 0;
        for (const { s, breachHigh, breachLow, trendAnomaly } of fired) {
            const severity: 'low' | 'medium' | 'high' | 'critical' = breachHigh && trendAnomaly
                ? 'high' : breachHigh || breachLow ? 'medium' : 'low';

            const alertType: 'threshold_breach' | 'trend_deviation' | 'anomaly' =
                breachHigh || breachLow ? 'threshold_breach' : trendAnomaly ? 'trend_deviation' : 'anomaly';

            let description = breachHigh
                ? `${s.tag} at ${s.current_value} ${s.unit} — approaching alarm high of ${s.alarm_high} ${s.unit}. Trend: ${s.trend}.`
                : breachLow
                    ? `${s.tag} at ${s.current_value} ${s.unit} — approaching alarm low of ${s.alarm_low} ${s.unit}. Trend: ${s.trend}.`
                    : `${s.tag} shows ${s.trend} trend with current value ${s.current_value} ${s.unit}.`;
            // AG layer: carry the rationalized operator response onto the alert.
            if (s.operator_action) description += ` Operator action: ${s.operator_action}`;

            await this.createAlert({
                alert_id: `alt-${Date.now()}-${s.tag.replace(/[^a-zA-Z0-9]/g, '')}`,
                asset_id: assetId,
                alert_type: alertType,
                severity,
                title: `${title || 'Alert'}: ${s.tag}`,
                description,
                confidence: severity === 'high' ? 0.92 : severity === 'medium' ? 0.82 : 0.70,
                dqs_impact: 0.02,
                governance_tier: severity === 'high' ? 2 : 3,
                diagnosis,
                failure_mode_code: diagnosis?.hypotheses[0]?.failure_mode_code ?? null,
            });
            alertsCreated++;
        }

        if (alertsCreated === 0) {
            return {
                success: true,
                message: suppressed > 0
                    ? `No new alerts — ${suppressed} breaching point${suppressed > 1 ? 's' : ''} already ha${suppressed > 1 ? 've' : 's'} an open alert (chatter guard).`
                    : 'All sensors within normal limits — no alerts generated.',
            };
        }
        return { success: true, message: `${alertsCreated} prediction alert${alertsCreated > 1 ? 's' : ''} generated from threshold analysis${suppressed > 0 ? ` (${suppressed} suppressed — already open)` : ''}.` };
    }

    /**
     * Diagnosis layer (gap-closeout slice 3): assemble the evidence bundle for
     * lib/predict/diagnosisRules — firing sensors, the latest spectral capture
     * (0206), and the asset's documented priors (RCM failure modes, FMEA text,
     * confirmed WO failure history). Every lookup is best-effort: a missing
     * table or empty set means fewer evidence items, never a failed scan.
     */
    private async _diagnoseFiring(
        assetId: string,
        fired: { s: SensorReading; breachHigh: boolean; breachLow: boolean; trendAnomaly: boolean }[],
    ): Promise<DiagnosisResult | null> {
        const { data: assetRow } = await supabase.from('assets')
            .select('name, tag, asset_class, asset_category, asset_type_code')
            .eq('id', assetId)
            .maybeSingle();
        const cls = resolveEquipmentClass(assetRow ? {
            name: assetRow.name, tag: assetRow.tag,
            assetClass: assetRow.asset_class, assetCategory: assetRow.asset_category, assetType: assetRow.asset_type_code,
        } : null).cls;

        const sensors: SensorEvidence[] = fired.map(({ s, breachHigh, breachLow }) => ({
            tag: s.tag,
            kind: sensorKind(s.tag),
            direction: breachHigh ? 'high' : breachLow ? 'low' : 'rising',
            value: s.current_value,
            limit: breachHigh ? s.alarm_high : breachLow ? s.alarm_low : null,
            unit: s.unit,
        }));

        // Latest waveform capture → spectral evidence (flags derived from the
        // same persisted features the panel computed).
        let spectral: SpectralEvidence | null = null;
        const caps = await this.getWaveforms(assetId, 1);
        if (caps.length > 0) {
            const f = caps[0].features || {};
            const findings: { label?: string }[] = f.diagnosis?.findings ?? [];
            const has = (needle: string) => findings.some(x => String(x.label ?? '').includes(needle));
            spectral = {
                impulsive: (f.time?.kurtosis ?? 0) > 4 || (f.time?.crest ?? 0) > 5,
                oneTimesDominant: has('1× dominant'),
                twoTimesElevated: has('2×'),
                bearingMatches: (f.bearingMatches ?? []) as BearingToneMatch[],
            };
        }

        const priors: AssetPriors = {};
        try {
            const { data } = await supabase.from('ers_rcm_failure_modes')
                .select('failure_mode_code, rpn, historical_wo_count, ers_rcm_functions!inner(ers_rcm_studies!inner(asset_id))')
                .eq('ers_rcm_functions.ers_rcm_studies.asset_id', assetId)
                .limit(50);
            const modes = (data || []).filter((r: any) => r.failure_mode_code);
            if (modes.length > 0) {
                priors.rcmModes = modes.map((r: any) => ({
                    code: r.failure_mode_code, rpn: r.rpn, woCount: r.historical_wo_count,
                }));
            }
        } catch { /* RCM study absent for this asset */ }
        try {
            const { data } = await supabase.from('ers_fmea_items')
                .select('failure_mode, ers_fmea_worksheets!inner(asset_id)')
                .eq('ers_fmea_worksheets.asset_id', assetId)
                .limit(100);
            const texts = (data || []).map((r: any) => r.failure_mode).filter(Boolean);
            if (texts.length > 0) priors.fmeaModes = texts;
        } catch { /* no FMEA worksheet */ }
        try {
            const { data } = await supabase.from('wo_failure_data')
                .select('failure_mode_code, work_orders!inner(asset_id)')
                .eq('work_orders.asset_id', assetId)
                .limit(200);
            const counts: Record<string, number> = {};
            for (const r of data || []) {
                if ((r as any).failure_mode_code) {
                    counts[(r as any).failure_mode_code] = (counts[(r as any).failure_mode_code] ?? 0) + 1;
                }
            }
            if (Object.keys(counts).length > 0) priors.historyCodes = counts;
        } catch { /* no coded failure history */ }

        const result = diagnoseEvidence({ equipmentClass: cls, sensors, spectral, priors });
        return result.hypotheses.length > 0 ? result : null;
    }

    // ── Degradation Model Update ───────────────────────────
    // Phase 3 (data-grounded degradation): mechanisms come from DATA, not a
    // health-band guess — the fitted censored Weibull (WO failure history) and
    // the API 570 thickness trend (static equipment). Their failure projections
    // are the SAME numbers the RUL tab and Integrity panel show, so degradation
    // and RUL can never tell two different stories. When neither data source
    // exists, the fallback is a single heuristic model explicitly tagged as
    // directional (no invented wear rates).
    private async _runDegradationUpdate(assetId: string, _title: string): Promise<{ success: boolean; message: string }> {
        const twin = await this.getTwinState(assetId);
        if (!twin) {
            return { success: false, message: 'No digital twin found — run a Digital Twin Snapshot first.' };
        }

        // Equipment class steers which physical mechanism applies.
        const { data: assetRow } = await supabase.from('assets')
            .select('name, tag, asset_class, asset_category, asset_type_code')
            .eq('id', assetId)
            .maybeSingle();
        const classRes = resolveEquipmentClass(assetRow ? {
            name: assetRow.name, tag: assetRow.tag,
            assetClass: assetRow.asset_class, assetCategory: assetRow.asset_category, assetType: assetRow.asset_type_code,
        } : null);

        const models: any[] = [];
        const r1 = (v: number) => Math.round(v * 10) / 10;

        // ── A. STATIC: wall-loss corrosion from the thickness trend (API 570) ──
        if (classRes.cls === 'static') {
            const [defsRes, logsRes] = await Promise.all([
                supabase.from('reading_definitions').select('*').eq('asset_id', assetId).eq('is_active', true),
                supabase.from('reading_logs').select('*').eq('asset_id', assetId).order('reading_date', { ascending: true }),
            ]);
            const thicknessDef = (defsRes.data || []).find((d: any) => sensorKind(d.name) === 'thickness');
            if (thicknessDef) {
                const pts = (logsRes.data || [])
                    .filter((l: any) => l.definition_id === thicknessDef.id && l.is_active !== false)
                    .map((l: any) => ({ date: l.reading_date, value: Number(l.reading_value) }));
                const integ = assessIntegrity(pts, thicknessDef.min_critical ?? thicknessDef.min_warning ?? null);
                if (integ) {
                    // Damage = corrodible allowance consumed (first reading → t-min).
                    const firstVal = pts.length ? Math.max(...pts.map(p => p.value)) : integ.current;
                    const damage = integ.tMin != null && firstVal > integ.tMin
                        ? Math.min(100, Math.max(0, ((firstVal - integ.current) / (firstVal - integ.tMin)) * 100))
                        : 0;
                    models.push({
                        mechanism: 'Wall loss / corrosion',
                        model_type: 'API 570 thickness trend',
                        parameters: {
                            ltcr_per_year: integ.ltcrPerYear,
                            stcr_per_year: integ.stcrPerYear,
                            governing_per_year: integ.governingPerYear,
                            t_min: integ.tMin ?? 0,
                        },
                        current_damage_pct: r1(damage),
                        projected_failure_date: integ.remainingLifeYears != null
                            ? new Date(Date.now() + integ.remainingLifeYears * 365.25 * 86400000).toISOString()
                            : null,
                    });
                }
            }
        }

        // ── B. Fitted Weibull wear-out from WO failure history (R-1) ──
        const { data: wos } = await supabase.from('work_orders')
            .select('id, type, created_at, closed_at, wo_failure_data!wo_id(failure_mode_code)')
            .eq('asset_id', assetId)
            .order('created_at');
        const rows = wos || [];
        const intervals = failureIntervalsHours(rows);
        const lastFail = rows.filter(isFailure)
            .map((w: any) => new Date(w.closed_at || w.created_at).getTime())
            .sort((a, b) => b - a)[0];
        const suspensions: number[] = [];
        if (lastFail) {
            const h = Math.floor((Date.now() - lastFail) / 3600000);
            if (h > 0) suspensions.push(h);
        }
        const grounded = groundedRulFromHistory(intervals, suspensions);
        if (grounded.method === 'weibull-mrl' && grounded.rulDays != null && grounded.beta && grounded.eta) {
            // Life consumed = age / (age + expected residual life).
            const lifeConsumed = grounded.ageDays + grounded.rulDays > 0
                ? (grounded.ageDays / (grounded.ageDays + grounded.rulDays)) * 100
                : 0;
            models.push({
                mechanism: classRes.cls === 'rotating' ? 'Wear-out — bearings/seals (fitted)' : 'Wear-out (fitted from failure history)',
                model_type: `Censored Weibull (β=${grounded.beta}, η=${grounded.eta}h)`,
                parameters: { beta: grounded.beta, eta_hours: grounded.eta, age_days: grounded.ageDays, n_failures: grounded.fit?.nFailures ?? intervals.length },
                current_damage_pct: r1(lifeConsumed),
                // Same MRL the RUL tab shows — one number, by construction.
                projected_failure_date: new Date(Date.now() + grounded.rulDays * 86400000).toISOString(),
            });
        }

        // ── C. Honest fallback: nothing data-grounded → tagged directional ──
        if (models.length === 0) {
            const healthIndex = Number(twin.health_index);
            const est = await this.getRULEstimate(assetId);
            const projDays = est?.rul_days ?? Math.max(30, Math.round(healthIndex * 3));
            models.push({
                mechanism: classRes.cls === 'static' ? 'General deterioration' : healthIndex < 70 ? 'Bearing wear (suspected)' : 'General wear',
                model_type: 'Heuristic — health trend (directional, no life data yet)',
                parameters: { health_index: healthIndex },
                current_damage_pct: r1(Math.min(100, Math.max(0, 100 - healthIndex))),
                projected_failure_date: new Date(Date.now() + projDays * 86400000).toISOString(),
            });
        }

        // Direct UPDATE — the twin row exists (checked above); a partial upsert
        // would trip NOT NULL columns on the insert path before conflict handling.
        const { error: updErr } = await supabase.from('ers_twin_states')
            .update({ degradation_models: models, updated_at: new Date().toISOString() })
            .eq('asset_id', assetId);

        if (updErr) {
            console.error('[_runDegradationUpdate] persist failed:', updErr);
            return { success: false, message: `Failed to persist degradation models: ${updErr.message}` };
        }
        const basis = models.map((m: any) => `${m.mechanism} (${m.model_type.split(' (')[0]})`).join(' · ');
        return {
            success: true,
            message: `${models.length} degradation model${models.length > 1 ? 's' : ''} updated — ${basis}`,
        };
    }

    // ══════════════════════════════════════════════════════════
    //  Prediction Feedback — drives Bayesian threshold adaptation
    // ══════════════════════════════════════════════════════════

    async submitAlertFeedback(
        alertId: string,
        assetId: string,
        feedbackType: 'actionable' | 'false_alarm',
        feedbackBy: string,
        notes?: string,
    ): Promise<PredictionFeedback | null> {
        try {
            // 1. Insert feedback record
            const { data, error } = await supabase
                .from('ers_prediction_feedback')
                .insert({ alert_id: alertId, asset_id: assetId, feedback_type: feedbackType, feedback_by: feedbackBy, notes })
                .select()
                .single();
            if (error) { console.error('PredictionService.submitAlertFeedback:', error); throw error; }

            // 2. Update the alert's feedback_status
            await supabase
                .from('ers_prediction_alerts')
                .update({ feedback_status: feedbackType })
                .eq('alert_id', alertId);

            return data as PredictionFeedback;
        } catch (e) {
            console.error('Error submitting alert feedback:', e);
            return null;
        }
    }

    async getAlertFeedbackStats(assetId: string): Promise<{ actionable: number; falseAlarm: number; precision: number }> {
        try {
            const { data, error } = await supabase
                .from('ers_prediction_feedback')
                .select('feedback_type')
                .eq('asset_id', assetId);
            if (error) { console.error('PredictionService.getAlertFeedbackStats:', error); throw error; }

            const records = data || [];
            const actionable = records.filter(r => r.feedback_type === 'actionable').length;
            const falseAlarm = records.filter(r => r.feedback_type === 'false_alarm').length;
            const total = actionable + falseAlarm;
            return { actionable, falseAlarm, precision: total > 0 ? actionable / total : 1 };
        } catch (e) {
            console.error('Error fetching feedback stats:', e);
            return { actionable: 0, falseAlarm: 0, precision: 1 };
        }
    }

    /**
     * Fleet-wide measured alert precision (B6 — the anti-alert-fatigue number).
     * Precision = actionable ÷ reviewed, from HUMAN feedback on real alerts —
     * never a model's self-score. null (not 100%) until something is reviewed:
     * an unmeasured precision must not masquerade as a perfect one.
     */
    async getFleetAlertPrecision(): Promise<{
        reviewed: number; actionable: number; falseAlarm: number;
        precision: number | null;
        reviewed90: number; precision90: number | null;
        totalAlerts: number; coveragePct: number | null;
        worstTypes: { type: string; falseAlarms: number }[];
    }> {
        const empty = { reviewed: 0, actionable: 0, falseAlarm: 0, precision: null, reviewed90: 0, precision90: null, totalAlerts: 0, coveragePct: null, worstTypes: [] };
        try {
            const [fbQ, alertCountQ] = await Promise.all([
                supabase.from('ers_prediction_feedback')
                    .select('alert_id, feedback_type, created_at')
                    .order('created_at', { ascending: false })
                    .limit(10000),
                supabase.from('ers_prediction_alerts').select('id', { count: 'exact', head: true }),
            ]);
            if (fbQ.error) throw fbQ.error;
            const rows = fbQ.data ?? [];
            // One verdict per alert — the latest wins (rows are ordered desc).
            const latestByAlert = new Map<string, { type: string; at: string }>();
            for (const r of rows) {
                if (!latestByAlert.has(r.alert_id)) latestByAlert.set(r.alert_id, { type: r.feedback_type, at: r.created_at });
            }
            const verdicts = [...latestByAlert.values()];
            const actionable = verdicts.filter(v => v.type === 'actionable').length;
            const falseAlarm = verdicts.filter(v => v.type === 'false_alarm').length;
            const reviewed = actionable + falseAlarm;

            const cutoff90 = Date.now() - 90 * 86400000;
            const v90 = verdicts.filter(v => new Date(v.at).getTime() >= cutoff90);
            const actionable90 = v90.filter(v => v.type === 'actionable').length;
            const reviewed90 = v90.length;

            // Which alert types cry wolf — the tuning targets.
            const falseIds = [...latestByAlert.entries()].filter(([, v]) => v.type === 'false_alarm').map(([id]) => id).slice(0, 500);
            let worstTypes: { type: string; falseAlarms: number }[] = [];
            if (falseIds.length > 0) {
                const { data: alerts } = await supabase.from('ers_prediction_alerts')
                    .select('alert_id, alert_type').in('alert_id', falseIds);
                const byType = new Map<string, number>();
                for (const a of alerts ?? []) byType.set(a.alert_type, (byType.get(a.alert_type) ?? 0) + 1);
                worstTypes = [...byType.entries()].map(([type, falseAlarms]) => ({ type, falseAlarms }))
                    .sort((a, b) => b.falseAlarms - a.falseAlarms).slice(0, 3);
            }

            const totalAlerts = alertCountQ.count ?? 0;
            return {
                reviewed, actionable, falseAlarm,
                precision: reviewed > 0 ? actionable / reviewed : null,
                reviewed90,
                precision90: reviewed90 > 0 ? actionable90 / reviewed90 : null,
                totalAlerts,
                coveragePct: totalAlerts > 0 ? Math.round((reviewed / totalAlerts) * 100) : null,
                worstTypes,
            };
        } catch (e) {
            console.error('Error computing fleet alert precision:', e);
            return empty;
        }
    }

    // ══════════════════════════════════════════════════════════
    //  Agent Actions — HITL governance audit trail
    // ══════════════════════════════════════════════════════════

    async getAgentActions(
        assetId?: string,
        status?: AgentActionStatus,
        agentType?: AgentType,
    ): Promise<AgentAction[]> {
        try {
            let query = supabase.from('ers_agent_actions').select('*');
            if (assetId) query = query.eq('asset_id', assetId);
            if (status) query = query.eq('status', status);
            if (agentType) query = query.eq('agent_type', agentType);
            const { data, error } = await query.order('created_at', { ascending: false });
            if (error) { console.error('PredictionService.getAgentActions:', error); throw error; }
            return (data || []) as AgentAction[];
        } catch (e) {
            console.error('Error fetching agent actions:', e);
            return [];
        }
    }

    async createAgentAction(action: Omit<AgentAction, 'id' | 'created_at' | 'reviewed_by' | 'reviewed_at' | 'review_notes'>): Promise<AgentAction | null> {
        try {
            const { data, error } = await supabase
                .from('ers_agent_actions')
                .insert(action)
                .select()
                .single();
            if (error) { console.error('PredictionService.createAgentAction:', error); throw error; }
            return data as AgentAction;
        } catch (e) {
            console.error('Error creating agent action:', e);
            return null;
        }
    }

    /**
     * Apply an APPROVED threshold-adapter proposal set (1.5.4 write-back) —
     * called by AgentReviewPanel only after the human clicks Approve. Updates
     * BOTH band stores: the online sensor rows (ers_sensor_readings) and any
     * matching manual reading definitions (name === tag), whose provenance
     * becomes 'learned'. An Approve that changes nothing would be a lie.
     */
    async applyApprovedThresholds(
        assetId: string,
        proposals: Array<{ tag: string; proposed_alarm_high: number | null; proposed_alarm_low: number | null; direction: string }>,
    ): Promise<{ applied: number }> {
        const active = (proposals || []).filter(p => p && p.direction !== 'no_change');
        if (active.length === 0) return { applied: 0 };
        let applied = 0;

        // 1. Online sensor rows — the bands the alert scan reads directly.
        const sensors = await this.getSensorReadings(assetId);
        for (const p of active) {
            const s = sensors.find(x => x.tag === p.tag);
            if (!s) continue;
            const { error } = await supabase.from('ers_sensor_readings')
                .update({ alarm_high: p.proposed_alarm_high, alarm_low: p.proposed_alarm_low })
                .eq('id', s.id);
            if (!error) applied++;
            else console.error('[applyApprovedThresholds] sensor update failed:', error);
        }

        // 2. Manual-bridge definitions — the bridge maps alarm_high from
        //    max_critical ?? max_warning, so write back to whichever is set.
        const { data: defs } = await supabase.from('reading_definitions')
            .select('id, name, max_critical, max_warning, min_critical, min_warning')
            .eq('asset_id', assetId)
            .eq('is_active', true);
        for (const p of active) {
            const d = (defs || []).find((x: any) => x.name === p.tag);
            if (!d) continue;
            const row: any = { limit_source: 'learned' };
            if (p.proposed_alarm_high != null) {
                if (d.max_critical != null) row.max_critical = p.proposed_alarm_high;
                else row.max_warning = p.proposed_alarm_high;
            }
            if (p.proposed_alarm_low != null) {
                if (d.min_critical != null) row.min_critical = p.proposed_alarm_low;
                else row.min_warning = p.proposed_alarm_low;
            }
            let { error } = await supabase.from('reading_definitions').update(row).eq('id', d.id);
            // Graceful degradation while 0198 is unapplied.
            if (error && /limit_source|PGRST204|column .* does not exist/i.test(error.message || '')) {
                const { limit_source, ...legacy } = row;
                ({ error } = await supabase.from('reading_definitions').update(legacy).eq('id', d.id));
            }
            if (!error) applied++;
            else console.error('[applyApprovedThresholds] definition update failed:', error);
        }
        return { applied };
    }

    async updateAgentActionStatus(
        actionId: string,
        status: 'approved' | 'rejected' | 'expired',
        reviewedBy: string,
        reviewNotes?: string,
    ): Promise<boolean> {
        try {
            const { error } = await supabase
                .from('ers_agent_actions')
                .update({
                    status,
                    reviewed_by: reviewedBy,
                    reviewed_at: new Date().toISOString(),
                    review_notes: reviewNotes || null,
                })
                .eq('id', actionId);
            if (error) { console.error('PredictionService.updateAgentActionStatus:', error); throw error; }
            return true;
        } catch (e) {
            console.error('Error updating agent action status:', e);
            return false;
        }
    }

    // ── Capital Event → RUL Reset ──────────────────────────────
    /**
     * When a capital event (overhaul, major repair, upgrade) extends asset life,
     * this method recalculates the RUL estimate and optionally refreshes the
     * Digital Twin health index to reflect the renewal.
     *
     * Called by FinancialsTab after a successful recapitalization.
     */
    async resetRULForCapitalEvent(
        assetId: string,
        lifeExtensionDays: number,
        eventType: string,
        healthBoostPct?: number // e.g. 15 means +15% health improvement
    ): Promise<{ success: boolean; message: string; newRULDays?: number }> {
        try {
            // 1. Get current RUL estimate
            const currentRUL = await this.getRULEstimate(assetId);
            const currentDays = currentRUL?.rul_days || 0;
            const newRULDays = currentDays + lifeExtensionDays;

            // 2. Upsert the new RUL estimate
            const newRUL = await this.upsertRULEstimate({
                asset_id: assetId,
                rul_days: newRULDays,
                confidence: Math.min((currentRUL?.confidence || 70) + 5, 95), // Slight confidence boost
                distribution_type: currentRUL?.distribution_type || 'weibull',
                computed_at: new Date().toISOString(),
                confidence_bands: [
                    { percentile: 10, lower_days: Math.round(newRULDays * 0.7), upper_days: Math.round(newRULDays * 0.85), median_days: Math.round(newRULDays * 0.78) },
                    { percentile: 50, lower_days: Math.round(newRULDays * 0.85), upper_days: Math.round(newRULDays * 1.05), median_days: newRULDays },
                    { percentile: 90, lower_days: Math.round(newRULDays * 1.05), upper_days: Math.round(newRULDays * 1.3), median_days: Math.round(newRULDays * 1.15) },
                ],
            });

            if (!newRUL) {
                return { success: false, message: 'Failed to update RUL estimate.' };
            }

            // 3. Optionally boost the Digital Twin health index
            if (healthBoostPct && healthBoostPct > 0) {
                const twin = await this.getTwinState(assetId);
                if (twin) {
                    const newHealth = Math.min(100, twin.health_index + healthBoostPct);
                    await this.upsertTwinState({
                        asset_id: assetId,
                        health_index: newHealth,
                    });
                }
            }

            // 4. Create an alert for visibility
            try {
                await this.createAlert({
                    asset_id: assetId,
                    alert_id: `cap-rul-reset-${Date.now()}`,
                    alert_type: 'pattern_detected',
                    severity: 'low',
                    title: `RUL Reset — ${eventType}`,
                    description: `Asset RUL extended by ${lifeExtensionDays} days (${Math.round(lifeExtensionDays / 30)} months) due to capital event. New RUL: ${newRULDays} days.`,
                    confidence: 95,
                    dqs_impact: null,
                    governance_tier: null,
                });
            } catch (alertErr) {
                console.warn('Could not create RUL reset alert:', alertErr);
            }

            return {
                success: true,
                message: `RUL extended: ${currentDays} → ${newRULDays} days (+${lifeExtensionDays} days from ${eventType}).`,
                newRULDays,
            };
        } catch (err: any) {
            console.error('[PredictionService.resetRULForCapitalEvent]', err);
            return { success: false, message: err.message || 'RUL reset failed' };
        }
    }
}

export type InsightType = 'digital_twin' | 'rul_analysis' | 'alert_config' | 'degradation_model';

export const predictionService = PredictionService.getInstance();
export default predictionService;
