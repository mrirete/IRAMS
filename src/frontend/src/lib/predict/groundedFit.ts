/**
 * Shared grounded-fit fetch for the Predict surfaces (Phase 1 — one engine).
 *
 * Mirrors the Reliability Advisor's data recipe EXACTLY so the tabs and the
 * Advisor modal show the same numbers by construction: WO history → canonical
 * failure inter-arrivals (isFailure predicate) + running time since the last
 * failure as a right-censored suspension → censored Weibull → conditional MRL.
 */
import { supabase } from '../../eam/lib/supabase';
import { failureIntervalsHours, isFailure, eventDate, FAILURE_QUERY_COLUMNS } from '../../eam/services/reliabilityMetrics';
import { groundedRulFromHistory, type GroundedRul } from '../pmRecommendation';

export type { GroundedRul };

export async function fetchGroundedFit(assetId: string): Promise<GroundedRul> {
    // FAILURE_QUERY_COLUMNS, not a local list: the engine needs breakdown
    // (0295 predicate), malfunction_start (event basis) and secondary_failure
    // (0289 collateral exclusion) — a stale hand-rolled select silently
    // degrades the fit to paperwork dates and type heuristics.
    const { data: wos } = await supabase.from('work_orders')
        .select(FAILURE_QUERY_COLUMNS)
        .eq('asset_id', assetId)
        .order('created_at');
    const rows = wos || [];
    const intervals = failureIntervalsHours(rows);
    // Running time since the last failure is a right-censored unit (R-1).
    const lastFail = rows.filter(isFailure)
        .map((w: any) => new Date(eventDate(w) as string).getTime())
        .sort((a, b) => b - a)[0];
    const suspensions: number[] = [];
    if (lastFail) {
        const h = Math.floor((Date.now() - lastFail) / 3600000);
        if (h > 0) suspensions.push(h);
    }
    return groundedRulFromHistory(intervals, suspensions);
}
