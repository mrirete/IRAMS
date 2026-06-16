import { useState, useEffect, useMemo, useCallback } from 'react';
import type {
    CML, ThicknessReading, CorrosionRate, RBIAssessment,
    DamageMechanism, FFSAssessment, IOWParameter, InspectionEvent,
    IntegritySummary
} from '../types/integrity';
import {
    MOCK_CMLS, MOCK_READINGS, MOCK_CORROSION, MOCK_RBI,
    MOCK_DAMAGE_MECHS, MOCK_FFS, MOCK_IOW, MOCK_INSPECTIONS
} from '../mockData/integrity';
import integrityService from '../eam/services/IntegrityService';
import { demoSeed } from '../config/demoMode';
import { assessAllCMLs, assessmentToCorrosionRate, type CMLAssessment } from '../eam/utils/integrityCalcs';

// ═══════════════════════════════════════════════════════════════════════
//  HOOK — Supabase first; mock seed only in DEMO_DATA mode (empty otherwise)
// ═══════════════════════════════════════════════════════════════════════

export function useIntegrity() {
    const [cmls, setCmls] = useState<CML[]>(() => demoSeed(MOCK_CMLS, []));
    const [readings, setReadings] = useState<ThicknessReading[]>(() => demoSeed(MOCK_READINGS, []));
    const [corrosionRates, setCorrosionRates] = useState<CorrosionRate[]>(() => demoSeed(MOCK_CORROSION, []));
    const [rbiAssessments, setRbiAssessments] = useState<RBIAssessment[]>(() => demoSeed(MOCK_RBI, []));
    const [damageMechanisms, setDamageMechanisms] = useState<DamageMechanism[]>(() => demoSeed(MOCK_DAMAGE_MECHS, []));
    const [ffsAssessments, setFfsAssessments] = useState<FFSAssessment[]>(() => demoSeed(MOCK_FFS, []));
    const [iowParameters, setIowParameters] = useState<IOWParameter[]>(() => demoSeed(MOCK_IOW, []));
    const [inspections, setInspections] = useState<InspectionEvent[]>(() => demoSeed(MOCK_INSPECTIONS, []));
    const [loading, setLoading] = useState(true);

    // ── Fetch from Supabase via IntegrityService ──────────────────────
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [
                    dbCmls, dbCorrosion, dbRbi,
                    dbDm, dbFfs, dbIow, dbInspections
                ] = await Promise.all([
                    integrityService.getCMLs(),
                    integrityService.getCorrosionRates(),
                    integrityService.getRBIAssessments(),
                    integrityService.getDamageMechanisms(),
                    integrityService.getFFSAssessments(),
                    integrityService.getIOWParameters(),
                    integrityService.getInspections(),
                ]);

                if (cancelled) return;

                // Only replace mock data if Supabase returned real rows
                if (dbCmls.length > 0) setCmls(dbCmls as any);
                if (dbCorrosion.length > 0) setCorrosionRates(dbCorrosion as any);
                if (dbRbi.length > 0) setRbiAssessments(dbRbi as any);
                if (dbDm.length > 0) setDamageMechanisms(dbDm as any);
                if (dbFfs.length > 0) setFfsAssessments(dbFfs as any);
                if (dbIow.length > 0) setIowParameters(dbIow as any);
                if (dbInspections.length > 0) setInspections(dbInspections as any);

                // Thickness readings need CML IDs, so fetch after CMLs
                if (dbCmls.length > 0) {
                    const allReadings: ThicknessReading[] = [];
                    for (const cml of dbCmls) {
                        const r = await integrityService.getThicknessReadings(cml.id);
                        allReadings.push(...(r as any));
                    }
                    if (allReadings.length > 0 && !cancelled) setReadings(allReadings);
                }

                console.log('[useIntegrity] Supabase data loaded', {
                    cmls: dbCmls.length, corrosion: dbCorrosion.length,
                    rbi: dbRbi.length, dm: dbDm.length, ffs: dbFfs.length,
                    iow: dbIow.length, inspections: dbInspections.length,
                });
            } catch (e) {
                console.warn('[useIntegrity] Supabase unavailable, using mock data:', e);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // ── Local mutators (immediate UI update) ──────────────────────────
    const addReading = useCallback((r: ThicknessReading) => {
        setReadings(prev => [r, ...prev]);
        // Fire & forget Supabase write
        integrityService.addThicknessReading(r as any).catch(() => { });
    }, []);

    const addRbiAssessment = useCallback((r: RBIAssessment) => {
        setRbiAssessments(prev => [r, ...prev]);
        integrityService.createRBIAssessment(r as any).catch(() => { });
    }, []);

    const addDamageMechanism = useCallback((dm: DamageMechanism) => {
        setDamageMechanisms(prev => [dm, ...prev]);
        integrityService.createDamageMechanism(dm as any).catch(() => { });
    }, []);

    const addFfsAssessment = useCallback((f: FFSAssessment) => {
        setFfsAssessments(prev => [f, ...prev]);
        integrityService.createFFSAssessment(f as any).catch(() => { });
    }, []);

    const addIowParameter = useCallback((p: IOWParameter) => {
        setIowParameters(prev => [p, ...prev]);
        integrityService.createIOWParameter(p as any).catch(() => { });
    }, []);

    const addInspection = useCallback((i: InspectionEvent) => {
        setInspections(prev => [i, ...prev]);
        integrityService.createInspection(i as any).catch(() => { });
    }, []);

    const updateInspection = useCallback((id: string, updates: Partial<InspectionEvent>) => {
        setInspections(prev => prev.map(i => i.id === id ? { ...i, ...updates } : i));
        integrityService.updateInspection(id, updates as any).catch(() => { });
    }, []);

    // ── API-510/570/653 assessments computed from thickness readings ──
    // Derive corrosion rate + remaining life from the raw readings (the data
    // inspectors actually capture) rather than trusting pre-stored rates.
    const assessments = useMemo<Map<string, CMLAssessment>>(
        () => assessAllCMLs(cmls, readings),
        [cmls, readings],
    );

    // Effective corrosion rates: computed where we have ≥2 readings, else stored.
    const effectiveCorrosionRates = useMemo<CorrosionRate[]>(() => {
        const computed = Array.from(assessments.values()).map(assessmentToCorrosionRate);
        const computedIds = new Set(computed.map(c => c.cml_id));
        const storedOnly = corrosionRates.filter(c => !computedIds.has(c.cml_id));
        return [...computed, ...storedOnly];
    }, [assessments, corrosionRates]);

    // ── Summary computations ──────────────────────────────────────────
    const summary = useMemo<IntegritySummary>(() => {
        const assessed = Array.from(assessments.values());
        const belowTmin = assessed.filter(a => a.below_tmin).length;

        const rates = effectiveCorrosionRates.map(c => c.short_term_rate_mmpy);
        const avgRate = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;

        const lives = assessed.map(a => a.remaining_life_years).filter((v): v is number => v !== null);
        const minLife = lives.length ? Math.min(...lives) : null;

        return {
            total_cmls: cmls.length,
            cmls_below_tmin: belowTmin,
            avg_corrosion_rate: parseFloat(avgRate.toFixed(3)),
            min_remaining_life_years: minLife,
            cmls_assessed: assessed.length,
            accelerating_count: effectiveCorrosionRates.filter(c => c.is_accelerating).length,
            rbi_high_risk_count: rbiAssessments.filter(r => r.risk_rank === 'High' || r.risk_rank === 'Very High').length,
            active_damage_mechs: damageMechanisms.filter(dm => dm.status === 'active').length,
            ai_suggested_pending: damageMechanisms.filter(dm => dm.source === 'ai_suggested').length,
            ffs_total: ffsAssessments.length,
            ffs_passed: ffsAssessments.filter(f => f.status === 'passed').length,
            ffs_failed: ffsAssessments.filter(f => f.status === 'failed').length,
            iow_total: iowParameters.length,
            iow_breach_count: iowParameters.filter(i => i.breach_status === 'breach').length,
            inspections_scheduled: inspections.filter(i => i.status === 'scheduled').length,
            inspections_overdue: inspections.filter(i => i.status === 'overdue').length,
            inspections_completed_ytd: inspections.filter(i => i.status === 'completed').length,
        };
    }, [cmls, assessments, effectiveCorrosionRates, rbiAssessments, damageMechanisms, ffsAssessments, iowParameters, inspections]);

    return {
        loading,
        cmls,
        readings,
        corrosionRates: effectiveCorrosionRates,
        assessments,
        rbiAssessments,
        damageMechanisms,
        ffsAssessments,
        iowParameters,
        inspections,
        summary,
        addReading,
        addRbiAssessment,
        addDamageMechanism,
        addFfsAssessment,
        addIowParameter,
        addInspection,
        updateInspection,
    };
}
