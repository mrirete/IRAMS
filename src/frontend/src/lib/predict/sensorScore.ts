/**
 * One per-point health score and one severity zone, shared by the twin
 * engine (PredictionService.runDigitalTwin) and the Overview tiles.
 *
 * Why this exists: the old transfer function scored only points with BOTH a
 * low and a high limit and returned 100 for everything else. The limit
 * library's vibration (ISO 20816-3) and temperature bands are high-only, so on
 * rotating equipment vibration never moved the health index. And the zone
 * badge used one fixed vibration table and one fixed temperature table that
 * could contradict the point's own limits.
 *
 * Scale (same for every limit shape): 100 = in the normal region, 60 = at the
 * alarm limit, falling past it, floor 0.
 *   two-sided  — 100 at the band midpoint, 60 at either limit (unchanged).
 *   high-only  — 100 up to half the limit, 60 at the limit.
 *   low-only   — 100 from twice the limit up, 60 at the limit.
 * One-sided shapes assume a positive-valued quantity (velocity, temperature,
 * pressure, current); a non-positive limit leaves the point unscored.
 */

export interface ScoredPoint {
    current: number | null | undefined;
    /** Alarm limit (critical, else warning) — what the engine alarms on. */
    alarm_high?: number | null;
    alarm_low?: number | null;
    /** Warning limits, when the point has them — used for zones only. */
    warn_high?: number | null;
    warn_low?: number | null;
}

const clamp = (v: number) => Math.max(0, Math.min(100, v));
const has = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** Health score 0–100 for one point, or null when it has no usable limit. */
export function sensorHealthScore(p: ScoredPoint): number | null {
    const x = p.current;
    if (!has(x)) return null;
    const hi = has(p.alarm_high) ? p.alarm_high : null;
    const lo = has(p.alarm_low) ? p.alarm_low : null;

    if (hi != null && lo != null) {
        if (hi <= lo) return null;
        const deviation = Math.abs(x - (hi + lo) / 2) / ((hi - lo) / 2);
        return clamp(100 - deviation * 40);
    }
    if (hi != null) {
        if (hi <= 0) return null;
        // 100 up to hi/2, then 80 points per limit-width → 60 at hi.
        return clamp(100 - Math.max(0, x - hi / 2) * (80 / hi));
    }
    if (lo != null) {
        if (lo <= 0) return null;
        // Mirror image: 100 from 2·lo up, 60 at lo, 40 at lo/2.
        return clamp(100 - Math.max(0, 2 * lo - x) * (40 / lo));
    }
    return null;
}

export interface SensorZone {
    zone: string;
    color: string;
    bgColor: string;
    /** Why this zone — shown as the badge tooltip. */
    basis: string;
}

const Z = {
    good: { color: 'text-emerald-600', bgColor: 'bg-emerald-50' },
    fair: { color: 'text-primary-600', bgColor: 'bg-primary-50' },
    alert: { color: 'text-amber-600', bgColor: 'bg-amber-50' },
    danger: { color: 'text-red-600', bgColor: 'bg-red-50' },
};

/**
 * Severity zone from the point's OWN limits. Vibration uses the ISO 20816-3
 * zone geometry the limit library writes (warning = B/C, critical = C/D,
 * A/B ≈ half of B/C in every group); anything else reads Normal / Alert /
 * Danger against warning and critical. No limits → no zone (null), never a
 * fixed table that may not apply to this machine.
 */
export function sensorZone(p: ScoredPoint, isVibration: boolean): SensorZone | null {
    const x = p.current;
    if (!has(x)) return null;
    const crit = has(p.alarm_high) ? p.alarm_high : null;
    const warn = has(p.warn_high) && (crit == null || p.warn_high < crit) ? p.warn_high : null;

    if (isVibration) {
        if (crit == null && warn == null) return null;
        // Only one limit known: the other follows the ISO 20816-3 ratio (B/C ≈ 0.63 × C/D).
        const bc = warn ?? (crit as number) * 0.63;
        const cd = crit ?? bc / 0.63;
        const basis = `ISO 20816-3 zones on this point's limits — B/C ${round(bc)}, C/D ${round(cd)}`;
        if (x < bc / 2) return { zone: 'A', ...Z.good, basis };
        if (x < bc) return { zone: 'B', ...Z.fair, basis };
        if (x < cd) return { zone: 'C', ...Z.alert, basis };
        return { zone: 'D', ...Z.danger, basis };
    }

    // High side
    if (crit != null || warn != null) {
        const basis = `This point's limits — ${[warn != null ? `warning ${round(warn)}` : null, crit != null ? `alarm ${round(crit)}` : null].filter(Boolean).join(', ')}`;
        if (crit != null && x >= crit) return { zone: 'Danger', ...Z.danger, basis };
        if (warn != null && x >= warn) return { zone: 'Alert', ...Z.alert, basis };
    }
    // Low side
    const lcrit = has(p.alarm_low) ? p.alarm_low : null;
    const lwarn = has(p.warn_low) && (lcrit == null || p.warn_low > lcrit) ? p.warn_low : null;
    if (lcrit != null || lwarn != null) {
        const basis = `This point's limits — ${[lwarn != null ? `low warning ${round(lwarn)}` : null, lcrit != null ? `low alarm ${round(lcrit)}` : null].filter(Boolean).join(', ')}`;
        if (lcrit != null && x <= lcrit) return { zone: 'Danger', ...Z.danger, basis };
        if (lwarn != null && x <= lwarn) return { zone: 'Alert', ...Z.alert, basis };
    }
    if (crit == null && warn == null && lcrit == null && lwarn == null) return null;
    return { zone: 'Normal', ...Z.good, basis: 'Inside this point\'s limits' };
}

const round = (v: number) => Math.round(v * 100) / 100;
