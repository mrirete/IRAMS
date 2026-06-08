/**
 * Intelligence API
 * ════════════════
 * Typed fetch functions for ERS Predict, Analyze, and Knowledge Graph endpoints.
 * Used by useIntelligence hook when VITE_USE_MOCK is false.
 */

import { apiGet } from './client';
import type {
    TwinState,
    RULEstimate,
    BadActorReportOutput,
    FMEAWorksheetRead,
    RCAInvestigationRead,
    GraphNode,
    GraphLink,
} from '../types/intelligence';

// ── Predict endpoints ────────────────────────────────────────

export async function fetchTwinHealth(assetId: string) {
    return apiGet<TwinState>(`/predict/twin/${assetId}`);
}

export async function fetchRUL(assetId: string) {
    return apiGet<RULEstimate>(`/predict/rul?asset_id=${assetId}`);
}

export interface AlertItem {
    id: string;
    asset_id: string;
    alert_type: string;
    severity: string;
    title: string;
    description: string;
    confidence: number;
    triggered_at: string;
    acknowledged: boolean;
}

export async function fetchAlerts(assetId: string) {
    return apiGet<AlertItem[]>(`/predict/alerts/${assetId}`);
}

export async function fetchSensorSummary(assetId: string) {
    return apiGet<Record<string, { value: number; unit: string; status: string }>>(`/predict/twin/${assetId}/sensors`);
}

// ── Analyze endpoints ────────────────────────────────────────

export async function fetchBadActors(criteria: 'cost' | 'downtime' | 'wo_frequency' = 'cost') {
    return apiGet<BadActorReportOutput>(`/analyze/bad-actors?criteria=${criteria}`);
}

export async function fetchFMEA(worksheetId?: string) {
    const path = worksheetId
        ? `/analyze/fmea/${worksheetId}`
        : `/analyze/fmea`;
    return apiGet<FMEAWorksheetRead>(path);
}

export async function fetchRCAList() {
    return apiGet<RCAInvestigationRead[]>(`/analyze/rca`);
}

export async function fetchRCA(investigationId: string) {
    return apiGet<RCAInvestigationRead>(`/analyze/rca/${investigationId}`);
}

// ── Knowledge Graph endpoints ────────────────────────────────

export interface KGGraphResponse {
    nodes: GraphNode[];
    edges: GraphLink[];
}

export async function fetchKnowledgeGraph(rootAssetId?: string) {
    const params = rootAssetId ? `?root_asset_id=${rootAssetId}` : '';
    return apiGet<KGGraphResponse>(`/graph/subgraph${params}`);
}

// ── Degradation Models ───────────────────────────────────────

export interface DegradationModel {
    name: string;
    current_damage_pct: number;
    projected_failure_date: string | null;
    confidence: number;
}

export async function fetchDegradationModels(assetId: string) {
    return apiGet<DegradationModel[]>(`/predict/degradation/${assetId}`);
}
