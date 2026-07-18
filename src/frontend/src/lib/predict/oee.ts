/**
 * Client-side OEE from the 0105 production module's tables — the fallback
 * for compute_oee when the RPC is unavailable (it ships SECURITY DEFINER
 * without a pinned search_path and 42P01s until migration 0203 is applied).
 * Same ISO 22400-2 math as the RPC:
 *
 *   Availability = Σ actual_run_time_min / Σ planned_run_time_min
 *   Performance  = Σ total_output / (design_capacity_per_hr × Σ actual_run_hrs)
 *   Quality      = Σ good_output / Σ total_output
 *   OEE          = A × P × Q
 */

export interface ShiftLogRow {
    planned_run_time_min: number;
    actual_run_time_min: number;
    total_output: number;
    good_output: number;
}

export interface OeeLegs {
    availability_pct: number | null;
    performance_pct: number | null;
    quality_pct: number | null;
    oee_pct: number | null;
    total_output: number;
    planned_hrs: number;
    n: number;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export function computeOeeClientSide(logs: ShiftLogRow[], designCapacityPerHr: number | null | undefined): OeeLegs | null {
    const rows = (logs || []).filter(l => Number(l.planned_run_time_min) > 0);
    if (rows.length === 0) return null;

    const planned = rows.reduce((s, l) => s + Number(l.planned_run_time_min), 0);
    const actualMin = rows.reduce((s, l) => s + Math.min(Number(l.actual_run_time_min) || 0, Number(l.planned_run_time_min)), 0);
    const total = rows.reduce((s, l) => s + (Number(l.total_output) || 0), 0);
    const good = rows.reduce((s, l) => s + (Number(l.good_output) || 0), 0);

    const availability = planned > 0 ? actualMin / planned : null;
    const idealUnits = designCapacityPerHr && designCapacityPerHr > 0 ? designCapacityPerHr * (actualMin / 60) : null;
    const performance = idealUnits && idealUnits > 0 ? Math.min(1.5, total / idealUnits) : null;
    const quality = total > 0 ? Math.min(1, good / total) : null;
    const oee = availability != null && performance != null && quality != null
        ? availability * Math.min(1, performance) * quality
        : null;

    return {
        availability_pct: availability != null ? r1(availability * 100) : null,
        performance_pct: performance != null ? r1(performance * 100) : null,
        quality_pct: quality != null ? r1(quality * 100) : null,
        oee_pct: oee != null ? r1(oee * 100) : null,
        total_output: total,
        planned_hrs: r1(planned / 60),
        n: rows.length,
    };
}
