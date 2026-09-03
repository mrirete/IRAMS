/**
 * Client-side OEE from the 0105 production module's tables — the fallback
 * for compute_oee when the RPC is unavailable (it ships SECURITY DEFINER
 * without a pinned search_path and 42P01s until migration 0203 is applied).
 * Same math as the RPC (SMRP 7th Edition 2.1.1 / 2.2 / 2.5 / 2.1.2, 0307):
 *
 *   Idle         = downtime logged as NO_DEMAND / MATERIAL (2.4) — outside the denominator
 *   Availability = Σ actual_run_time_min / (Σ planned_run_time_min − idle)          (2.2)
 *   Performance  = Σ total_output / (design_capacity_per_hr × Σ actual_run_hrs), capped at 1
 *   Quality      = Σ good_output / Σ total_output
 *   OEE          = A × P × Q                                                        (2.1.1)
 *   Utilization  = (Σ planned − idle) / Σ planned                                  (2.5)
 *   TEEP         = Utilization × OEE                                                (2.1.2)
 */
import { downtimeBucket } from '../oee7';

export interface ShiftLogRow {
    planned_run_time_min: number;
    actual_run_time_min: number;
    total_output: number;
    good_output: number;
    downtime_minutes?: number | null;
    downtime_reason_code?: string | null;
}

export interface OeeLegs {
    availability_pct: number | null;
    performance_pct: number | null;
    quality_pct: number | null;
    oee_pct: number | null;
    utilization_pct?: number | null;
    teep_pct?: number | null;
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
    const idleMin = rows.reduce((s, l) => s + (downtimeBucket(l.downtime_reason_code) === 'idle' ? (Number(l.downtime_minutes) || 0) : 0), 0);
    const total = rows.reduce((s, l) => s + (Number(l.total_output) || 0), 0);
    const good = rows.reduce((s, l) => s + (Number(l.good_output) || 0), 0);

    const scheduledMin = Math.max(0, planned - idleMin);
    const availability = scheduledMin > 0 ? Math.min(1, actualMin / scheduledMin) : null;
    const utilization = planned > 0 ? scheduledMin / planned : null;
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
        utilization_pct: utilization != null ? r1(utilization * 100) : null,
        teep_pct: oee != null && utilization != null ? r1(utilization * oee * 100) : null,
        total_output: total,
        planned_hrs: r1(planned / 60),
        n: rows.length,
    };
}
