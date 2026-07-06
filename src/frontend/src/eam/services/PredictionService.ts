/**
 * PredictionService — Supabase CRUD for ERS Predict domain
 *
 * Tables: ers_twin_states, ers_rul_estimates, ers_prediction_alerts, ers_sensor_readings
 */
import { supabase } from '../lib/supabase';

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
}

// ─── Agentic Intelligence Types ──────────────────────────────

export type AgentType = 'alert_to_wo' | 'bad_actor_rca' | 'threshold_adapter' | 'pm_effectiveness' | 'budget_overrun' | 'stockout_prevention' | 'cert_expiry' | 'compliance_audit' | 'auto_pareto' | 'vision_to_wo' | 'inspection_to_wo' | 'conversational_planner' | 'predictive_procurement';
export type AgentActionStatus = 'pending_review' | 'approved' | 'rejected' | 'expired';
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
        const payload = items.map(i => ({
            id: idByKey.get(`${i.asset_id}|${i.tag}`) || crypto.randomUUID(),
            asset_id: i.asset_id,
            tag: i.tag,
            current_value: i.current_value,
            unit: i.unit || '—',        // column is NOT NULL
            trend: i.trend,             // nullable, but CHECK-constrained when set
            alarm_high: i.alarm_high,
            alarm_low: i.alarm_low,
            readings: i.readings,
            created_at: new Date().toISOString(),
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

        // Weighted: vibration 35%, temperature 30%, pressure 20%, flow 15%
        const weights: Record<string, number> = {
            'Vibration': 0.35, 'Temperature': 0.30, 'Pressure': 0.20, 'Flow': 0.15,
        };
        let totalWeight = 0;
        let weightedSum = 0;
        sensors.forEach((s, i) => {
            const matchKey = Object.keys(weights).find(k => s.tag.startsWith(k));
            const w = matchKey ? weights[matchKey] : 0.25;
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
        return { success: true, message: `Digital Twin updated — Health Index: ${healthIndex.toFixed(1)}/100 (from ${source})` };
    }

    // ── RUL Analysis ───────────────────────────────────────
    private async _runRULAnalysis(assetId: string, _title: string): Promise<{ success: boolean; message: string }> {
        // Get current twin state for health baseline
        const twin = await this.getTwinState(assetId);
        const sensors = await this.getSensorsForAsset(assetId);

        const healthIndex = twin ? Number(twin.health_index) : 75;
        const remainingHealth = healthIndex - 30; // failure threshold at 30

        // Weibull-inspired RUL estimation
        // Higher health = more days remaining, with sensor trend acceleration
        const risingSensors = sensors.filter(s => s.trend === 'rising').length;
        const trendPenalty = 1 - risingSensors * 0.08;
        const baseRUL = Math.max(15, remainingHealth * 4.5 * trendPenalty);

        // Distribution type selection based on data characteristics
        const distType = risingSensors >= 2 ? 'weibull_2p' : healthIndex < 70 ? 'weibull_3p' : 'lognormal';

        // Confidence: higher with more sensor data, lower with high variance
        const dataPoints = sensors.reduce((sum, s) => sum + (s.readings?.length || 0), 0);
        const confidence = Math.min(0.98, Math.max(0.60, 0.70 + dataPoints * 0.002));

        // DQS impact: penalizes missing or flat sensors
        const flatSensors = sensors.filter(s => s.trend === 'stable').length;
        const dqsImpact = Math.round(flatSensors * 0.015 * 100) / 100;

        // Governance tier based on health and confidence
        const govTier = healthIndex < 60 ? 2 : healthIndex < 80 ? 3 : 4;

        // Confidence bands
        const bands = [
            { percentile: 50, lower_days: Math.round(baseRUL * 0.85), upper_days: Math.round(baseRUL * 1.15), median_days: Math.round(baseRUL) },
            { percentile: 80, lower_days: Math.round(baseRUL * 0.70), upper_days: Math.round(baseRUL * 1.35), median_days: Math.round(baseRUL) },
            { percentile: 95, lower_days: Math.round(baseRUL * 0.55), upper_days: Math.round(baseRUL * 1.60), median_days: Math.round(baseRUL) },
        ];

        const result = await this.upsertRULEstimate({
            asset_id: assetId,
            rul_days: Math.round(baseRUL * 10) / 10,
            confidence: Math.round(confidence * 100) / 100,
            distribution_type: distType,
            dqs_impact: dqsImpact,
            governance_tier: govTier,
            confidence_bands: bands,
        });

        if (!result) return { success: false, message: 'Failed to persist RUL estimate to database.' };
        return { success: true, message: `RUL Forecast: ${baseRUL.toFixed(0)} days (${(confidence * 100).toFixed(0)}% confidence, ${distType})` };
    }

    // ── Alert Scan ─────────────────────────────────────────
    private async _runAlertScan(assetId: string, title: string): Promise<{ success: boolean; message: string }> {
        const sensors = await this.getSensorsForAsset(assetId);
        if (sensors.length === 0) {
            return { success: false, message: 'No sensor readings found — enter readings on Condition Data (Work Management), or connect an online sensor feed.' };
        }

        let alertsCreated = 0;
        for (const s of sensors) {
            if (s.current_value == null) continue;

            // Threshold breach: current value near or beyond alarm limits
            const breachHigh = s.alarm_high != null && s.current_value >= s.alarm_high * 0.90;
            const breachLow = s.alarm_low != null && s.current_value <= s.alarm_low * 1.10;

            // Trend anomaly: rising trend combined with proximity to alarm
            const trendAnomaly = s.trend === 'rising' && breachHigh;

            if (breachHigh || breachLow || trendAnomaly) {
                const severity: 'low' | 'medium' | 'high' | 'critical' = breachHigh && trendAnomaly
                    ? 'high' : breachHigh || breachLow ? 'medium' : 'low';

                const alertType: 'threshold_breach' | 'trend_deviation' | 'anomaly' =
                    breachHigh || breachLow ? 'threshold_breach' : trendAnomaly ? 'trend_deviation' : 'anomaly';

                const description = breachHigh
                    ? `${s.tag} at ${s.current_value} ${s.unit} — approaching alarm high of ${s.alarm_high} ${s.unit}. Trend: ${s.trend}.`
                    : breachLow
                        ? `${s.tag} at ${s.current_value} ${s.unit} — approaching alarm low of ${s.alarm_low} ${s.unit}. Trend: ${s.trend}.`
                        : `${s.tag} shows ${s.trend} trend with current value ${s.current_value} ${s.unit}.`;

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
                });
                alertsCreated++;
            }
        }

        if (alertsCreated === 0) {
            return { success: true, message: 'All sensors within normal limits — no alerts generated.' };
        }
        return { success: true, message: `${alertsCreated} prediction alert${alertsCreated > 1 ? 's' : ''} generated from threshold analysis.` };
    }

    // ── Degradation Model Update ───────────────────────────
    private async _runDegradationUpdate(assetId: string, _title: string): Promise<{ success: boolean; message: string }> {
        const twin = await this.getTwinState(assetId);
        if (!twin) {
            return { success: false, message: 'No digital twin found — run a Digital Twin Snapshot first.' };
        }

        const healthIndex = Number(twin.health_index);
        const existingModels = twin.degradation_models || [];

        // If models exist, advance their damage percentage based on health
        // If no models, infer a default degradation mechanism
        let updatedModels: any[];
        if (existingModels.length > 0) {
            updatedModels = existingModels.map((m: any) => {
                const advanceRate = healthIndex < 70 ? 2.5 : healthIndex < 85 ? 1.2 : 0.5;
                const newDamage = Math.min(100, Number(m.current_damage_pct) + advanceRate);
                const daysToFailure = Math.max(14, Math.round((100 - newDamage) / advanceRate * 30));
                return {
                    ...m,
                    current_damage_pct: Math.round(newDamage * 10) / 10,
                    projected_failure_date: new Date(Date.now() + daysToFailure * 86400000).toISOString(),
                };
            });
        } else {
            // Infer a default degradation model based on health range
            const mechanism = healthIndex < 70 ? 'Bearing Wear' : healthIndex < 85 ? 'Seal Degradation' : 'General Wear';
            const modelType = healthIndex < 70 ? 'L10 Lifetime' : healthIndex < 85 ? 'Linear Wear' : 'Linear';
            const damagePct = Math.round((100 - healthIndex) * 0.7 * 10) / 10;
            const daysToFailure = Math.max(30, Math.round(healthIndex * 3));
            updatedModels = [{
                mechanism,
                model_type: modelType,
                // Deterministic wear rate derived from the health deficit (not random):
                // the further below 100 the health, the faster the modelled wear.
                parameters: { wear_rate: Math.round((100 - healthIndex) * 0.0001 * 10000) / 10000 },
                current_damage_pct: damagePct,
                projected_failure_date: new Date(Date.now() + daysToFailure * 86400000).toISOString(),
            }];
        }

        const result = await this.upsertTwinState({
            asset_id: assetId,
            degradation_models: updatedModels,
        });

        if (!result) return { success: false, message: 'Failed to persist degradation models.' };
        return {
            success: true,
            message: `${updatedModels.length} degradation model${updatedModels.length > 1 ? 's' : ''} updated — max damage: ${Math.max(...updatedModels.map((m: any) => m.current_damage_pct)).toFixed(1)}%`,
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
