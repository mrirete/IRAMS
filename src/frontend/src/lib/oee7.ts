/**
 * oee7 — Overall Equipment Effectiveness per SMRP Best Practices, 7th Edition
 * (metric 2.1.1 revised 2023, 2.1.2 TEEP, 2.2 Availability, 2.3 Uptime,
 * 2.4 Idle Time, 2.5 Utilization Time; Guideline 2.0).
 *
 * The time model (Figure 1, "Overall Equipment Effectiveness Timeline"):
 *
 *   Total Available Time (TAT)
 *   ├─ Idle Time            — no demand, no feedstock, no raw material, administrative idle
 *   └─ Scheduled Hours of Production = TAT − Idle
 *       ├─ Scheduled Downtime   — work on the finalized weekly schedule
 *       ├─ Unscheduled Downtime — repairs/modifications not on the schedule, setups, waiting…
 *       └─ Uptime               — actually producing
 *
 *   OEE 1 = utilization of the asset and scheduling deficiencies (looks at TAT)
 *   OEE 2 = Availability × Performance × Quality while scheduled
 *   Availability   = Uptime ÷ (TAT − Idle)          — scheduled downtime stays in the denominator
 *   Utilization    = (TAT − Idle) ÷ TAT
 *   TEEP           = Utilization × Availability × Performance × Quality
 *   Performance    = actual rate ÷ best rate; > 100% means the best rate is mis-specified
 *   Quality        = first-pass, first-time saleable ÷ actual production
 *
 * Mirrors compute_oee / get_plant_oee (0307) so the client fallback, the
 * what-if calculator and the RPC agree by construction.
 */

export interface Oee7Input {
    totalAvailableHrs: number;     // TAT for the period (24 per day)
    idleHrs: number;               // SMRP 2.4
    scheduledDowntimeHrs: number;  // SMRP 3.3
    unscheduledDowntimeHrs: number;// SMRP 3.4
    bestRatePerHr: number;         // design or demonstrated best sustained rate, whichever is higher
    actualProduction: number;      // all units, good and bad
    firstPassGood: number;         // first pass, first time saleable
}

export interface Oee7Result {
    scheduledHrs: number;          // TAT − idle
    uptimeHrs: number;             // scheduled − scheduled DT − unscheduled DT (floored at 0)
    utilizationPct: number | null; // 2.5
    availabilityPct: number | null;// 2.2
    performanceRawPct: number | null; // uncapped — visible when > 100 (7th-ed caution)
    performancePct: number | null; // capped at 100 for the product
    qualityPct: number | null;
    oeePct: number | null;         // 2.1.1 (OEE 2)
    teepPct: number | null;        // 2.1.2
    uptimePct: number | null;      // 2.3 — uptime ÷ TAT
    idlePct: number | null;        // 2.4 — idle ÷ TAT
    totalDowntimePct: number | null; // 3.2 — (sched + unsched) ÷ TAT
    /** Hours of equivalent capacity lost to each leg — the Eight Big Losses lens. */
    losses: { idle: number; scheduled: number; unscheduled: number; speed: number; quality: number };
    warnings: string[];
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
const pct = (num: number, den: number): number | null => (den > 0 ? r1((num / den) * 100) : null);

export function computeOee7(i: Oee7Input): Oee7Result {
    const warnings: string[] = [];
    const tat = Math.max(0, Number(i.totalAvailableHrs) || 0);
    const idle = Math.min(tat, Math.max(0, Number(i.idleHrs) || 0));
    const scheduledHrs = tat - idle;
    const sdt = Math.max(0, Number(i.scheduledDowntimeHrs) || 0);
    const udt = Math.max(0, Number(i.unscheduledDowntimeHrs) || 0);
    if (sdt + udt > scheduledHrs) warnings.push('Downtime exceeds scheduled hours — check the time entries.');
    const uptimeHrs = Math.max(0, scheduledHrs - sdt - udt);

    const best = Math.max(0, Number(i.bestRatePerHr) || 0);
    const actual = Math.max(0, Number(i.actualProduction) || 0);
    const good = Math.min(actual, Math.max(0, Number(i.firstPassGood) || 0));

    const utilizationPct = pct(scheduledHrs, tat);
    const availabilityPct = pct(uptimeHrs, scheduledHrs);
    const performanceRawPct = best > 0 && uptimeHrs > 0 ? pct(actual, best * uptimeHrs) : null;
    if (performanceRawPct != null && performanceRawPct > 100) {
        warnings.push(`Performance ${performanceRawPct}% exceeds 100% — the best production rate is under-specified (SMRP 2.1.1 caution); the product uses 100%.`);
    }
    const performancePct = performanceRawPct == null ? null : Math.min(100, performanceRawPct);
    const qualityPct = pct(good, actual);

    const a = availabilityPct, p = performancePct, q = qualityPct, u = utilizationPct;
    const oeePct = a != null && p != null && q != null ? r1((a / 100) * (p / 100) * (q / 100) * 100) : null;
    const teepPct = oeePct != null && u != null ? r1((u / 100) * oeePct) : null;

    // Capacity-equivalent hours lost per leg.
    const speedLossHrs = best > 0 ? Math.max(0, uptimeHrs - actual / best) : 0;
    const qualityLossHrs = best > 0 ? (actual - good) / best : 0;

    return {
        scheduledHrs: r2(scheduledHrs),
        uptimeHrs: r2(uptimeHrs),
        utilizationPct, availabilityPct, performanceRawPct, performancePct, qualityPct, oeePct, teepPct,
        uptimePct: pct(uptimeHrs, tat),
        idlePct: pct(idle, tat),
        totalDowntimePct: pct(sdt + udt, tat),
        losses: { idle: r2(idle), scheduled: r2(sdt), unscheduled: r2(udt), speed: r2(speedLossHrs), quality: r2(qualityLossHrs) },
        warnings,
    };
}

/**
 * How a production_logs downtime reason lands on the 7th-edition timeline.
 * No demand / no material are IDLE (outside the availability denominator);
 * planned maintenance is SCHEDULED downtime; everything else is unscheduled.
 * compute_oee (0307) applies the same map in SQL.
 */
export const IDLE_REASONS = ['NO_DEMAND', 'MATERIAL'];
export const SCHEDULED_REASONS = ['PLANNED_MAINT'];
export type DowntimeBucket = 'idle' | 'scheduled' | 'unscheduled';
export const downtimeBucket = (reason: string | null | undefined): DowntimeBucket => {
    const r = String(reason || '').toUpperCase();
    if (IDLE_REASONS.includes(r)) return 'idle';
    if (SCHEDULED_REASONS.includes(r)) return 'scheduled';
    return 'unscheduled';
};

/** The worked example of SMRP 2.1.1 Table 1 — used as the calculator's seed. */
export const SMRP_TABLE1_EXAMPLE: Oee7Input = {
    totalAvailableHrs: 24, idleHrs: 8, scheduledDowntimeHrs: 1.66, unscheduledDowntimeHrs: 2.08,
    bestRatePerHr: 167 / 12.26, actualProduction: 100, firstPassGood: 92,
};
