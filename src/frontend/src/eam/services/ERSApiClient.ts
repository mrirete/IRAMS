/**
 * ERSApiClient — Typed client for the IREAMS FastAPI backend (Railway)
 * ═══════════════════════════════════════════════════════════════════
 * 
 * Connects the React frontend to all Layer 2/3 backend endpoints:
 * - ERS Predict: Health Index, RUL, Failure Probability, Digital Twin
 * - ERS Analyze: RCM, FMEA, RCA, Criticality, Bad Actors, OEE, Monte Carlo
 * - Data Quality: Asset DQS scoring
 * 
 * Auth: Passes the Supabase session token as Bearer token.
 * Base URL: from VITE_ERS_API_URL env var (Railway deployment).
 */

import { supabase } from '../lib/supabase';

// ── Configuration ──────────────────────────────────────────
const ERS_API_URL = import.meta.env.VITE_ERS_API_URL || '';
const IS_CONFIGURED = !!ERS_API_URL;

// ── Response Types (matching FastAPI Pydantic schemas) ─────

export interface AssetHealthIndex {
    asset_id: string;
    health_index: number;           // 0-100
    confidence: number;             // 0-1
    model_agreement: number;        // 0-1 (< 0.7 triggers HITL)
    governance_tier: 'GREEN' | 'AMBER' | 'RED';
    contributing_factors: { factor: string; weight: number; score: number }[];
    dqs_adjusted: boolean;
    timestamp: string;
}

export interface RULEstimate {
    asset_id: string;
    rul_days: number;
    confidence: number;
    distribution_type: string;      // weibull_2p, weibull_3p, lognormal, exponential
    confidence_bands: ConfidenceBand[];
    recommended_action: string;
    governance_tier: 'GREEN' | 'AMBER' | 'RED';
}

export interface ConfidenceBand {
    percentile: number;             // 50, 80, 95
    lower_days: number;
    upper_days: number;
    median_days: number;
}

export interface FailurePrediction {
    asset_id: string;
    failure_mode: string;
    probability_7d: number;
    probability_30d: number;
    probability_90d: number;
    rpn: number;                    // Risk Priority Number
    recommended_action: string;
    governance_tier: 'GREEN' | 'AMBER' | 'RED';
}

export interface TwinState {
    twin_id: string;
    asset_id: string;
    health_index: number;
    sensor_summary: Record<string, number>;
    degradation_models: DegradationModel[];
    last_calibrated_at: string | null;
}

export interface DegradationModel {
    mechanism: string;
    model_type: string;
    parameters: Record<string, number>;
    current_damage_pct: number;
}

export interface DistributionFit {
    distribution: string;
    parameters: Record<string, number>;
    aic: number;
    bic: number;
    log_likelihood: number;
    ks_statistic: number;
    ks_p_value: number;
}

export interface DQSResult {
    asset_id: string;
    overall_score: number;          // 0-100
    completeness: number;
    accuracy: number;
    timeliness: number;
    consistency: number;
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

export interface CriticalityResult {
    asset_id: string;
    criticality_ranking: 'A' | 'B' | 'C';
    risk_score: number;
    safety_score: number;
    environmental_score: number;
    production_score: number;
    maintenance_score: number;
}

export interface BadActorReport {
    period: string;
    criteria: string;
    top_assets: BadActorEntry[];
    total_cost: number;
    total_downtime_hours: number;
}

export interface BadActorEntry {
    asset_id: string;
    asset_name: string;
    asset_tag: string;
    rank: number;
    wo_count: number;
    total_cost: number;
    total_downtime_hours: number;
    cumulative_pct: number;
    failure_modes: string[];
}

export interface FeatureVector {
    asset_id: string;
    vibration_rms?: number;
    temperature_c?: number;
    pressure_bar?: number;
    flow_rate?: number;
    current_amps?: number;
    operating_hours?: number;
    starts_count?: number;
    speed_rpm?: number;
    custom_features?: Record<string, number>;
}

// ── API Client ────────────────────────────────────────────

class ERSApiClient {
    private static instance: ERSApiClient;
    private baseUrl: string;

    private constructor() {
        this.baseUrl = ERS_API_URL;
    }

    static getInstance(): ERSApiClient {
        if (!ERSApiClient.instance) {
            ERSApiClient.instance = new ERSApiClient();
        }
        return ERSApiClient.instance;
    }

    /** Whether the backend API is configured */
    get isConfigured(): boolean {
        return IS_CONFIGURED;
    }

    // ── Core fetch wrapper ──────────────────────────────────

    private async fetch<T>(
        path: string,
        options: {
            method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
            body?: any;
            params?: Record<string, string | number | boolean>;
        } = {},
    ): Promise<T> {
        if (!IS_CONFIGURED) {
            throw new Error('[ERSApiClient] VITE_ERS_API_URL not configured. Set it in Vercel environment variables.');
        }

        const { method = 'GET', body, params } = options;

        // Build URL with query params
        let url = `${this.baseUrl}${path}`;
        if (params) {
            const searchParams = new URLSearchParams();
            Object.entries(params).forEach(([key, value]) => {
                if (value !== undefined && value !== null) {
                    searchParams.append(key, String(value));
                }
            });
            const qs = searchParams.toString();
            if (qs) url += `?${qs}`;
        }

        // Get Supabase auth token
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token || '';

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
        });

        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
            const message = errorBody.detail || errorBody.message || `API error: ${response.status}`;
            console.error(`[ERSApiClient] ${method} ${path} → ${response.status}:`, message);
            throw new Error(message);
        }

        return response.json();
    }

    // ══════════════════════════════════════════════════════════
    //  ERS PREDICT
    // ══════════════════════════════════════════════════════════

    /** Predict asset health index (multi-model ensemble) */
    async predictHealth(
        features: FeatureVector,
        assetClass: string = 'default',
        dqsScore: number = 100,
    ): Promise<AssetHealthIndex> {
        return this.fetch<AssetHealthIndex>('/predict/health', {
            method: 'POST',
            body: features,
            params: { asset_class: assetClass, dqs_score: dqsScore },
        });
    }

    /** Estimate remaining useful life with confidence bands */
    async predictRUL(
        features: FeatureVector,
        assetClass: string = 'default',
        failureMode: string = 'general',
        dqsScore: number = 100,
    ): Promise<RULEstimate> {
        return this.fetch<RULEstimate>('/predict/rul', {
            method: 'POST',
            body: features,
            params: { asset_class: assetClass, failure_mode: failureMode, dqs_score: dqsScore },
        });
    }

    /** Predict failure probability at 7d/30d/90d horizons */
    async predictFailure(
        features: FeatureVector,
        failureMode: string = 'general',
        assetClass: string = 'default',
        assetCriticality: 'A' | 'B' | 'C' = 'B',
        dqsScore: number = 100,
    ): Promise<FailurePrediction> {
        return this.fetch<FailurePrediction>('/predict/failure', {
            method: 'POST',
            body: features,
            params: {
                failure_mode: failureMode,
                asset_class: assetClass,
                asset_criticality: assetCriticality,
                dqs_score: dqsScore,
            },
        });
    }

    /** Get current digital twin state */
    async getTwinState(assetId: string, assetClass: string = 'default'): Promise<TwinState> {
        return this.fetch<TwinState>(`/predict/twin/${assetId}`, {
            params: { asset_class: assetClass },
        });
    }

    /** Update digital twin with new sensor data */
    async updateTwin(features: FeatureVector, assetClass: string = 'default'): Promise<TwinState> {
        return this.fetch<TwinState>('/predict/twin/update', {
            method: 'POST',
            body: features,
            params: { asset_class: assetClass },
        });
    }

    /** Fit failure time data to statistical distributions */
    async fitDistributions(failureTimes: number[]): Promise<DistributionFit[]> {
        return this.fetch<DistributionFit[]>('/predict/distributions/fit', {
            method: 'POST',
            body: failureTimes,
        });
    }

    /** Get OREDA/IEEE 493 Bayesian prior for sparse data */
    async getBayesianPrior(assetClass: string, failureMode: string = 'general'): Promise<any> {
        return this.fetch('/predict/bayesian/prior', {
            params: { asset_class: assetClass, failure_mode: failureMode },
        });
    }

    // ══════════════════════════════════════════════════════════
    //  ERS ANALYZE
    // ══════════════════════════════════════════════════════════

    /** Get criticality assessment for an asset */
    async getCriticality(assetId: string): Promise<CriticalityResult> {
        return this.fetch<CriticalityResult>(`/analyze/criticality/${assetId}`);
    }

    /** Generate bad actor Pareto report */
    async generateBadActorReport(
        period: string,
        criteria: 'cost' | 'downtime' | 'frequency' = 'cost',
        assetData: any[] = [],
    ): Promise<BadActorReport> {
        return this.fetch<BadActorReport>('/analyze/bad-actors/generate', {
            method: 'POST',
            body: assetData,
            params: { period, criteria },
        });
    }

    /** Get latest bad actor report */
    async getLatestBadActorReport(): Promise<BadActorReport> {
        return this.fetch<BadActorReport>('/analyze/bad-actors/latest');
    }

    /** Create a Defect Elimination campaign */
    async createDECampaign(
        assetId: string,
        assetName: string,
        title: string,
        defectSource: string,
        problemDescription: string = '',
    ): Promise<any> {
        return this.fetch('/analyze/defect-elimination', {
            method: 'POST',
            params: {
                asset_id: assetId,
                asset_name: assetName,
                title,
                defect_source: defectSource,
                problem_description: problemDescription,
            },
        });
    }

    /** AI-suggest failure modes for RCM analysis */
    async suggestFailureModes(analysisId: string, assetClass: string): Promise<any[]> {
        return this.fetch(`/analyze/rcm/${analysisId}/suggest-failure-modes`, {
            method: 'POST',
            params: { asset_class: assetClass },
        });
    }

    // ══════════════════════════════════════════════════════════
    //  DATA QUALITY
    // ══════════════════════════════════════════════════════════

    /** Get Data Quality Score for an asset */
    async getAssetDQS(assetId: string): Promise<DQSResult> {
        return this.fetch<DQSResult>(`/quality/asset/${assetId}/score`);
    }

    /** Get system-wide DQS summary */
    async getSystemDQSSummary(): Promise<any> {
        return this.fetch('/quality/system/summary');
    }
}

// ── Singleton export ──────────────────────────────────────
export const ersApi = ERSApiClient.getInstance();
export default ersApi;
