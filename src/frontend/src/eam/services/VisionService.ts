/**
 * VisionService — Centralised access layer for Vision module data.
 *
 * All cross-module consumers read Vision data through this service,
 * not by importing useStrategy() directly. This keeps Vision's data
 * layer decoupled from any specific module.
 *
 * Data flow: VisionPage → useStrategy (state owner) → VisionService (read-only cross-module)
 */

import type { VisionResult, DroneSurvey, VisionSeverity, AnalysisType } from '../../types/strategy';
import { MOCK_VISION, MOCK_DRONE } from '../../mockData/strategy';
import analyzeService from './AnalyzeService';

// ─── Severity Score Mapping ─────────────────────────────────

const VISION_SEVERITY_SCORE: Record<VisionSeverity, number> = {
    minor: 1,
    moderate: 2,
    severe: 4,
    critical: 5,
};

// ─── Service ─────────────────────────────────────────────────

class VisionService {
    private static instance: VisionService;
    private cachedResults: VisionResult[] = [];
    private cachedDrones: DroneSurvey[] = [];
    private loaded = false;

    private constructor() {}

    static getInstance(): VisionService {
        if (!VisionService.instance) VisionService.instance = new VisionService();
        return VisionService.instance;
    }

    // ── Data Loading (Supabase-first, fallback to mock) ──────────

    private async ensureLoaded(): Promise<void> {
        if (this.loaded) return;
        try {
            const [dbVision, dbDrones] = await Promise.all([
                analyzeService.getVisionResults(),
                analyzeService.getDroneSurveys(),
            ]);
            this.cachedResults = (dbVision.length > 0 ? dbVision : MOCK_VISION) as VisionResult[];
            this.cachedDrones = (dbDrones.length > 0 ? dbDrones : MOCK_DRONE) as DroneSurvey[];
        } catch {
            this.cachedResults = [...MOCK_VISION];
            this.cachedDrones = [...MOCK_DRONE];
        }
        this.loaded = true;
    }

    /** Force refresh from data source */
    invalidateCache(): void {
        this.loaded = false;
    }

    // ── Vision Result Queries ────────────────────────────────────

    /** Get all vision results */
    async getAllResults(): Promise<VisionResult[]> {
        await this.ensureLoaded();
        return this.cachedResults;
    }

    /** Get vision results for a specific asset */
    async getResultsByAsset(assetId: string): Promise<VisionResult[]> {
        await this.ensureLoaded();
        return this.cachedResults.filter(r => r.asset_id === assetId);
    }

    /** Get critical + severe findings (eligible for WR drafting) */
    async getCriticalFindings(): Promise<VisionResult[]> {
        await this.ensureLoaded();
        return this.cachedResults.filter(r =>
            r.max_severity === 'critical' || r.max_severity === 'severe'
        );
    }

    /** Get unreviewed findings (pending HITL review) */
    async getUnreviewedFindings(): Promise<VisionResult[]> {
        await this.ensureLoaded();
        return this.cachedResults.filter(r => !r.reviewed);
    }

    /** Get corrosion findings — feeds into Integrity/RBI */
    async getCorrosionFindings(assetId?: string): Promise<VisionResult[]> {
        await this.ensureLoaded();
        return this.cachedResults.filter(r =>
            r.analysis_type === 'corrosion' && (!assetId || r.asset_id === assetId)
        );
    }

    /** Get thermal findings — feeds into Predict/Digital Twin */
    async getThermalFindings(assetId?: string): Promise<VisionResult[]> {
        await this.ensureLoaded();
        return this.cachedResults.filter(r =>
            r.analysis_type === 'thermal' && (!assetId || r.asset_id === assetId)
        );
    }

    /** Get findings filtered by analysis type */
    async getByAnalysisType(type: AnalysisType, assetId?: string): Promise<VisionResult[]> {
        await this.ensureLoaded();
        return this.cachedResults.filter(r =>
            r.analysis_type === type && (!assetId || r.asset_id === assetId)
        );
    }

    /** Get count of vision findings for a given asset */
    async getAssetFindingCount(assetId: string): Promise<{ total: number; unreviewed: number; maxSeverity: VisionSeverity | null }> {
        const results = await this.getResultsByAsset(assetId);
        if (results.length === 0) return { total: 0, unreviewed: 0, maxSeverity: null };
        const unreviewed = results.filter(r => !r.reviewed).length;
        const maxSev = results.reduce<VisionSeverity>((max, r) =>
            VISION_SEVERITY_SCORE[r.max_severity] > VISION_SEVERITY_SCORE[max] ? r.max_severity : max,
            'minor'
        );
        return { total: results.length, unreviewed, maxSeverity: maxSev };
    }

    // ── Drone Survey Queries ─────────────────────────────────────

    /** Get all drone surveys */
    async getAllDroneSurveys(): Promise<DroneSurvey[]> {
        await this.ensureLoaded();
        return this.cachedDrones;
    }

    /** Get drone surveys with anomalies found */
    async getDroneSurveyAnomalies(): Promise<DroneSurvey[]> {
        await this.ensureLoaded();
        return this.cachedDrones.filter(d => d.anomalies_found > 0);
    }

    /** Get drone surveys for a specific asset */
    async getDroneSurveysByAsset(assetId: string): Promise<DroneSurvey[]> {
        await this.ensureLoaded();
        return this.cachedDrones.filter(d => d.asset_id === assetId);
    }

    /** Get unreviewed drone surveys with anomalies for a specific asset */
    async getUnreviewedDroneAnomalies(assetId?: string): Promise<DroneSurvey[]> {
        await this.ensureLoaded();
        return this.cachedDrones.filter(d =>
            d.anomalies_found > 0 && !d.reviewed && (!assetId || d.asset_id === assetId)
        );
    }

    // ── HITL Actions ─────────────────────────────────────────────

    /** Mark a vision result as reviewed (HITL approval) */
    async markReviewed(resultId: string): Promise<boolean> {
        await this.ensureLoaded();
        const idx = this.cachedResults.findIndex(r => r.id === resultId);
        if (idx === -1) return false;
        this.cachedResults[idx] = { ...this.cachedResults[idx], reviewed: true };
        // Persist to Supabase if available
        try { await analyzeService.updateVisionResult?.(resultId, { reviewed: true }); } catch { /* mock fallback */ }
        return true;
    }

    // ── Utility ──────────────────────────────────────────────────

    /** Get numeric severity score for RPN calculations */
    getSeverityScore(severity: VisionSeverity): number {
        return VISION_SEVERITY_SCORE[severity];
    }

    /** Check if a severity level qualifies for auto-WR drafting */
    isWRDraftEligible(severity: VisionSeverity): boolean {
        return severity === 'critical' || severity === 'severe';
    }
}

export const visionService = VisionService.getInstance();
