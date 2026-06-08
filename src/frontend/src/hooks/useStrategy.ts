import { useState, useEffect, useMemo, useCallback } from 'react';
import type {
    CarbonMetrics, RepairVsReplace, WasteStream, ClimateRisk,
    VisionResult, DroneSurvey, DataQualityScore, DataViolation
} from '../types/strategy';
import {
    MOCK_CARBON, MOCK_RVR, MOCK_WASTE, MOCK_CLIMATE,
    MOCK_VISION, MOCK_DRONE, MOCK_DQ, MOCK_VIOLATIONS
} from '../mockData/strategy';
import analyzeService from '../eam/services/AnalyzeService';

// ═══════════════════════════════════════════════════════════════════════
//  HOOK — tries Supabase first, falls back to mock data
// ═══════════════════════════════════════════════════════════════════════

export function useStrategy() {
    const [carbon, setCarbon] = useState<CarbonMetrics[]>(MOCK_CARBON);
    const [repairVsReplace] = useState(MOCK_RVR);
    const [waste] = useState(MOCK_WASTE);
    const [climateRisks, setClimateRisks] = useState<ClimateRisk[]>(MOCK_CLIMATE);
    const [visionResults, setVisionResults] = useState<VisionResult[]>(MOCK_VISION);
    const [droneSurveys, setDroneSurveys] = useState<DroneSurvey[]>(MOCK_DRONE);
    const [dataQuality] = useState(MOCK_DQ);
    const [dataViolations] = useState(MOCK_VIOLATIONS);
    const [loading, setLoading] = useState(true);

    // ── Fetch from Supabase via AnalyzeService ────────────────────────
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [dbCarbon, dbClimate, dbVision, dbDrones] = await Promise.all([
                    analyzeService.getCarbonMetrics(),
                    analyzeService.getClimateRisks(),
                    analyzeService.getVisionResults(),
                    analyzeService.getDroneSurveys(),
                ]);

                if (cancelled) return;

                if (dbCarbon.length > 0) setCarbon(dbCarbon as any);
                if (dbClimate.length > 0) setClimateRisks(dbClimate as any);
                if (dbVision.length > 0) setVisionResults(dbVision as any);
                if (dbDrones.length > 0) setDroneSurveys(dbDrones as any);

                console.log('[useStrategy] Supabase data loaded:', {
                    carbon: dbCarbon.length, climate: dbClimate.length,
                    vision: dbVision.length, drones: dbDrones.length,
                });
            } catch (e) {
                console.warn('[useStrategy] Supabase unavailable, using mock data:', e);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // ── Local mutator with Supabase persist ───────────────────────────
    const addVisionResult = useCallback((v: VisionResult) => {
        setVisionResults(prev => [v, ...prev]);
        analyzeService.createVisionResult(v as any).catch(() => { });
    }, []);

    // ── Computed summaries ────────────────────────────────────────────
    const totalCO2 = useMemo(() => carbon.reduce((a, c) => a + c.total_tco2, 0), [carbon]);
    const diversionRate = useMemo(() => {
        const diverted = waste.filter(w => w.category === 'recycled' || w.category === 'reused').reduce((a, w) => a + w.mass_tonnes, 0);
        const total = waste.reduce((a, w) => a + w.mass_tonnes, 0);
        return total ? Math.round((diverted / total) * 100) : 0;
    }, [waste]);
    const overallCompleteness = useMemo(() => {
        const avg = dataQuality.reduce((a, d) => a + d.completeness_score, 0) / (dataQuality.length || 1);
        return parseFloat(avg.toFixed(1));
    }, [dataQuality]);

    return {
        loading,
        carbon, repairVsReplace, waste, climateRisks,
        visionResults, droneSurveys,
        dataQuality, dataViolations,
        totalCO2, diversionRate, overallCompleteness,
        addVisionResult,
    };
}
