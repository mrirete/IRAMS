/**
 * Shared grounded-fit fetch for the Predict surfaces (Phase 1 — one engine).
 *
 * Mirrors the Reliability Advisor's data recipe EXACTLY so the tabs and the
 * Advisor modal show the same numbers by construction: WO history → canonical
 * failure inter-arrivals (isFailure predicate) + running time since the last
 * failure as a right-censored suspension → censored Weibull → conditional MRL.
 */
import { supabase } from '../../eam/lib/supabase';
import { failureIntervalsHours, isFailure } from '../../eam/services/reliabilityMetrics';
import { groundedRulFromHistory, type GroundedRul } from '../pmRecommendation';

export type { GroundedRul };

export async function fetchGroundedFit(assetId: string): Promise<GroundedRul> {
    const { data: wos } = await supabase.from('work_orders')
        .select('id, type, created_at, closed_at, wo_failure_data!wo_id(failure_mode_code)')
        .eq('asset_id', assetId)
        .order('created_at');
    const rows = wos || [];
    const intervals = failureIntervalsHours(rows);
    // Running time since the last failure is a right-censored unit (R-1).
    const lastFail = rows.filter(isFailure)
        .map((w: any) => new Date(w.closed_at || w.created_at).getTime())
        .sort((a, b) => b - a)[0];
    const suspensions: number[] = [];
    if (lastFail) {
        const h = Math.floor((Date.now() - lastFail) / 3600000);
        if (h > 0) suspensions.push(h);
    }
    return groundedRulFromHistory(intervals, suspensions);
}
