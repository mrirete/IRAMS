/**
 * KPICommentaryService — Autonomous KPI Annotation Engine (Phase 5, Cap 5)
 * ════════════════════════════════════════════════════════════════════════
 *
 * Generates AI-powered "So What?" commentary for every dashboard KPI chart.
 * Caches results for 1 hour to minimize API calls.
 *
 * HITL: Informational only — no mutations. Executive audiences consume these
 * annotations as decision-support intelligence.
 *
 * Standards: ISO 55000 KPI benchmarks, SMRP best practices.
 */

import { aiEngine } from './AIAnalysisEngine';
import type { KPIAnnotationData } from './AIAnalysisEngine';

// ── Cache Configuration ─────────────────────────────────────

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CachedAnnotation {
    data: KPIAnnotationData;
    timestamp: number;
}

// ── Service ─────────────────────────────────────────────────

class KPICommentaryService {
    private static instance: KPICommentaryService;
    private cache: Map<string, CachedAnnotation> = new Map();
    private pendingRequests: Map<string, Promise<KPIAnnotationData>> = new Map();

    private constructor() {}

    static getInstance(): KPICommentaryService {
        if (!KPICommentaryService.instance) {
            KPICommentaryService.instance = new KPICommentaryService();
        }
        return KPICommentaryService.instance;
    }

    /**
     * Generate AI commentary for a single KPI.
     * Returns cached result if available and within TTL.
     * Deduplicates concurrent requests for the same KPI.
     */
    async getCommentary(kpiData: {
        name: string;
        currentValue: number;
        previousValue: number;
        unit: string;
        benchmarkValue?: number;
        benchmarkSource?: string;
        relatedMetrics?: { name: string; value: number; unit: string }[];
        period?: string;
    }): Promise<KPIAnnotationData> {
        const cacheKey = `${kpiData.name}_${kpiData.currentValue}_${kpiData.previousValue}`;

        // 1. Check cache
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
            return cached.data;
        }

        // 2. Deduplicate concurrent requests
        const pending = this.pendingRequests.get(cacheKey);
        if (pending) {
            return pending;
        }

        // 3. Generate fresh commentary
        const request = aiEngine.generateKPICommentary({
            kpiName: kpiData.name,
            currentValue: kpiData.currentValue,
            previousValue: kpiData.previousValue,
            unit: kpiData.unit,
            benchmarkValue: kpiData.benchmarkValue,
            benchmarkSource: kpiData.benchmarkSource,
            relatedMetrics: kpiData.relatedMetrics,
            period: kpiData.period,
        }).then(result => {
            // Cache the result
            this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
            this.pendingRequests.delete(cacheKey);
            return result;
        }).catch(error => {
            this.pendingRequests.delete(cacheKey);
            console.error('[KPICommentaryService] Commentary generation failed:', error);
            // Return graceful fallback
            const changePercent = kpiData.previousValue !== 0
                ? ((kpiData.currentValue - kpiData.previousValue) / Math.abs(kpiData.previousValue)) * 100
                : 0;
            return {
                kpiName: kpiData.name,
                currentValue: `${kpiData.currentValue}${kpiData.unit}`,
                trend: (Math.abs(changePercent) < 2 ? 'stable' : changePercent > 0 ? 'improving' : 'declining') as 'improving' | 'stable' | 'declining',
                commentary: `${kpiData.name} is at ${kpiData.currentValue}${kpiData.unit}. AI commentary unavailable.`,
                actionRequired: false,
            } satisfies KPIAnnotationData;
        });

        this.pendingRequests.set(cacheKey, request);
        return request;
    }

    /**
     * Batch-generate commentary for multiple KPIs.
     * Useful for dashboard load — fires all requests concurrently.
     */
    async batchGetCommentary(kpis: {
        name: string;
        currentValue: number;
        previousValue: number;
        unit: string;
        benchmarkValue?: number;
        benchmarkSource?: string;
        relatedMetrics?: { name: string; value: number; unit: string }[];
        period?: string;
    }[]): Promise<KPIAnnotationData[]> {
        return Promise.all(kpis.map(kpi => this.getCommentary(kpi)));
    }

    /**
     * Clear the commentary cache (e.g. when dashboard data refreshes).
     */
    clearCache(): void {
        this.cache.clear();
    }

    /**
     * Get cache statistics for debugging.
     */
    getCacheStats(): { size: number; pendingRequests: number } {
        return {
            size: this.cache.size,
            pendingRequests: this.pendingRequests.size,
        };
    }
}

export const kpiCommentaryService = KPICommentaryService.getInstance();
export type { KPIAnnotationData };
