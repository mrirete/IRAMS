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
import { DEMO_DATA, demoSeed } from '../config/demoMode';
import { useToast } from '../eam/contexts/ToastContext';
import { assessAllCMLs, assessmentToCorrosionRate, type CMLAssessment } from '../eam/utils/integrityCalcs';

// ═══════════════════════════════════════════════════════════════════════
//  HOOK — Supabase first; mock seed only in DEMO_DATA mode (empty otherwise)
//
//  Write contract: every mutation is optimistic (row appears immediately),
//  awaits the Supabase write, and on failure ROLLS BACK and toasts. The DB
//  generates ids — client-side temp ids never reach Postgres. In DEMO_DATA
//  mode writes stay local-only (mock rows reference mock assets, so DB
//  writes would only fail FK checks).
// ═══════════════════════════════════════════════════════════════════════

/** Strip fields the database generates before insert/update. */
function dbPayload<T extends { id?: string; created_at?: string; updated_at?: string }>(row: T) {
    const { id: _id, created_at: _c, updated_at: _u, ...rest } = row;
    return rest;
}

export function useIntegrity() {
    const { showToast } = useToast();
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
            } catch (e) {
                console.warn('[useIntegrity] Supabase unavailable, using mock data:', e);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    /**
     * Optimistic insert: show the row under its temp id, persist, then swap
     * in the DB row (real UUID). On failure remove the temp row and toast.
     */
    const persistAdd = useCallback(async <T extends { id: string }>(
        row: T,
        setter: React.Dispatch<React.SetStateAction<T[]>>,
        write: (payload: any) => Promise<{ id: string } | null>,
        label: string,
    ) => {
        setter(prev => [row, ...prev]);
        if (DEMO_DATA) return;
        const saved = await write(dbPayload(row));
        if (saved) {
            setter(prev => prev.map(x => x.id === row.id ? { ...row, ...saved } : x));
        } else {
            setter(prev => prev.filter(x => x.id !== row.id));
            showToast(`Couldn't save ${label} — the change was not stored. Check your connection and try again.`, 'error', 6000);
        }
    }, [showToast]);

    // ── Mutators ──────────────────────────────────────────────────────
    const addCML = useCallback((c: CML) =>
        persistAdd(c, setCmls, p => integrityService.createCML(p), 'CML'), [persistAdd]);

    const addReading = useCallback((r: ThicknessReading) =>
        persistAdd(r, setReadings, p => integrityService.addThicknessReading(p), 'thickness reading'), [persistAdd]);

    const addRbiAssessment = useCallback((r: RBIAssessment) =>
        persistAdd(r, setRbiAssessments, p => integrityService.createRBIAssessment(p), 'RBI assessment'), [persistAdd]);

    const addDamageMechanism = useCallback((dm: DamageMechanism) =>
        persistAdd(dm, setDamageMechanisms, p => integrityService.createDamageMechanism(p), 'damage mechanism'), [persistAdd]);

    const addFfsAssessment = useCallback((f: FFSAssessment) =>
        persistAdd(f, setFfsAssessments, p => integrityService.createFFSAssessment(p), 'FFS assessment'), [persistAdd]);

    const addIowParameter = useCallback((p: IOWParameter) =>
        persistAdd(p, setIowParameters, x => integrityService.createIOWParameter(x), 'IOW parameter'), [persistAdd]);

    const addInspection = useCallback((i: InspectionEvent) =>
        persistAdd(i, setInspections, p => integrityService.createInspection(p), 'inspection'), [persistAdd]);

    const updateInspection = useCallback(async (id: string, updates: Partial<InspectionEvent>) => {
        let previous: InspectionEvent | undefined;
        setInspections(prev => {
            previous = prev.find(i => i.id === id);
            return prev.map(i => i.id === id ? { ...i, ...updates } : i);
        });
        if (DEMO_DATA) return;
        const saved = await integrityService.updateInspection(id, dbPayload(updates as any));
        if (!saved && previous) {
            const rollback = previous;
            setInspections(prev => prev.map(i => i.id === id ? rollback : i));
            showToast(`Couldn't save inspection changes — they were not stored. Check your connection and try again.`, 'error', 6000);
        }
    }, [showToast]);

    // ── Overdue derivation ────────────────────────────────────────────
    // 'overdue' is computed from the schedule, not trusted as a stored
    // status — a scheduled inspection whose date has passed shows overdue
    // everywhere without any background job mutating rows.
    const effectiveInspections = useMemo<InspectionEvent[]>(() => {
        const now = Date.now();
        return inspections.map(i =>
            i.status === 'scheduled' && new Date(i.scheduled_date).getTime() < now
                ? { ...i, status: 'overdue' as const }
                : i
        );
    }, [inspections]);

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
            inspections_scheduled: effectiveInspections.filter(i => i.status === 'scheduled').length,
            inspections_overdue: effectiveInspections.filter(i => i.status === 'overdue').length,
            inspections_completed_ytd: effectiveInspections.filter(i => i.status === 'completed').length,
        };
    }, [cmls, assessments, effectiveCorrosionRates, rbiAssessments, damageMechanisms, ffsAssessments, iowParameters, effectiveInspections]);

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
        inspections: effectiveInspections,
        summary,
        addCML,
        addReading,
        addRbiAssessment,
        addDamageMechanism,
        addFfsAssessment,
        addIowParameter,
        addInspection,
        updateInspection,
    };
}
