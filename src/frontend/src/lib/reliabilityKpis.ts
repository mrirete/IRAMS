/**
 * reliabilityKpis — THE canonical MTBF / MTTR / availability / PM definitions.
 *
 * Why this exists (the audit that produced it):
 *  - Reports displayed "MTBF" as `(8760 - MTTR × 12) / 12`. That is not MTBF;
 *    it silently assumes every plant suffers exactly 12 failures a year, so
 *    the headline reliability number moved only when MTTR moved. Fabricated
 *    numbers on a reliability product are worse than no number.
 *  - MTTR came from an RPC averaging downtime across ALL work orders, PMs
 *    included — planned work dilutes repair time.
 *  - The card labelled "PM Compliance" showed preventive ÷ all work orders.
 *    That is the PM RATIO (proactive share). PM compliance is schedule
 *    adherence: PMs finished by their due date ÷ PMs due. Two different KPIs
 *    wearing one name, with the ratio's 80% target attached.
 *  - `assets.mtbf_days` is a third, stored source that nothing recomputes.
 *
 * Definitions here follow SMRP usage. Every function returns null rather than
 * a zero when the denominator is missing — "not enough data" is a legitimate
 * answer and the honest-data rule everywhere else in this codebase.
 */

export interface KpiWoRow {
    type: string | null;
    status: string | null;
    created_at: string;
    closed_at?: string | null;
    due_date?: string | null;
    actual_downtime_hrs?: number | null;
}

export interface MtbfResult {
    /** Corrective events in the window — the failure count. */
    failures: number;
    /** Recorded downtime on those events (hours). */
    downtimeHrs: number;
    /** Operating hours = calendar hours across in-scope assets, less downtime. */
    operatingHrs: number;
    /** Mean operating time between failures (hours); null when no failures. */
    mtbfHours: number | null;
    /** Mean time to repair a failure (hours); null when no timed repairs. */
    mttrHours: number | null;
    /** Inherent availability = MTBF/(MTBF+MTTR) × 100; null when either is null. */
    availabilityPct: number | null;
    /** Share of failures that carry a downtime figure — the trust caveat. */
    downtimeCoveragePct: number;
}

const HOURS_PER_DAY = 24;
const isCm = (t: string | null | undefined) => String(t ?? '').toUpperCase() === 'CM';
const isPm = (t: string | null | undefined) => ['PM', 'PREVENTIVE', 'PREVENTATIVE', 'SCHEDULED'].includes(String(t ?? '').toUpperCase());

/**
 * Fleet MTBF/MTTR/availability over a window.
 *
 * Operating hours are calendar-based: windowDays × 24 × assetsInScope, less
 * recorded downtime. Without commissioning dates and run-hour meters this is
 * the defensible approximation — it assumes assets were in service for the
 * whole window, which is stated wherever the number is shown.
 */
export function computeMtbfMttr(
    wos: KpiWoRow[],
    windowDays: number,
    assetsInScope: number,
): MtbfResult {
    const failures = wos.filter((w) => isCm(w.type));
    const timed = failures.filter((w) => Number(w.actual_downtime_hrs) > 0);
    const downtimeHrs = timed.reduce((s, w) => s + (Number(w.actual_downtime_hrs) || 0), 0);

    const calendarHrs = Math.max(0, windowDays) * HOURS_PER_DAY * Math.max(0, assetsInScope);
    const operatingHrs = Math.max(0, calendarHrs - downtimeHrs);

    const mtbfHours = failures.length > 0 ? operatingHrs / failures.length : null;
    const mttrHours = timed.length > 0 ? downtimeHrs / timed.length : null;
    const availabilityPct = mtbfHours != null && mttrHours != null && (mtbfHours + mttrHours) > 0
        ? (mtbfHours / (mtbfHours + mttrHours)) * 100
        : null;

    return {
        failures: failures.length,
        downtimeHrs: Math.round(downtimeHrs * 10) / 10,
        operatingHrs: Math.round(operatingHrs),
        mtbfHours: mtbfHours == null ? null : Math.round(mtbfHours),
        mttrHours: mttrHours == null ? null : Math.round(mttrHours * 10) / 10,
        availabilityPct: availabilityPct == null ? null : Math.round(availabilityPct * 10) / 10,
        downtimeCoveragePct: failures.length ? Math.round((timed.length / failures.length) * 100) : 0,
    };
}

export interface PmComplianceResult {
    /** PMs that fell due inside the window. */
    due: number;
    /** Of those, finished on or before the due date. */
    onTime: number;
    /** Schedule adherence %; null when nothing was due. */
    compliancePct: number | null;
}

/**
 * PM compliance = schedule adherence, NOT the proactive share. A PM counts as
 * due when its due date falls in the window — OR when it is still open past
 * its due date, however old. Compliant = closed on or before the due date.
 *
 * The overdue-open clause is deliberate: with a pure sliding window, a missed
 * PM counted against compliance for 90 days and then aged out while still not
 * done — the dashboard read 100% beside live "PM Overdue" escalations. Neglect
 * must not be able to age out of the metric; a miss leaves the denominator
 * only by being completed or cancelled.
 */
const DONE_STATUSES = ['CLOSED', 'TECO', 'COMP', 'CANCELLED'];
export function computePmCompliance(wos: KpiWoRow[], windowStartMs: number, nowMs: number): PmComplianceResult {
    const due = wos.filter((w) => {
        if (!isPm(w.type) || !w.due_date) return false;
        const d = new Date(w.due_date).getTime();
        if (!Number.isFinite(d)) return false;
        if (d >= windowStartMs && d <= nowMs) return true;
        // Still-open overdue PM from before the window: stays due until done.
        const open = !DONE_STATUSES.includes(String(w.status ?? '').toUpperCase());
        return open && d < nowMs;
    });
    const onTime = due.filter((w) => {
        if (!w.closed_at) return false;
        const closed = new Date(w.closed_at).getTime();
        const dueMs = new Date(w.due_date as string).getTime();
        return Number.isFinite(closed) && closed <= dueMs;
    });
    return {
        due: due.length,
        onTime: onTime.length,
        compliancePct: due.length ? Math.round((onTime.length / due.length) * 1000) / 10 : null,
    };
}

/**
 * PM ratio = preventive share of all work — the "proactive vs reactive"
 * number (SMRP target ≈ 80%). Deliberately named apart from compliance.
 */
export function computePmRatio(wos: KpiWoRow[]): { preventive: number; corrective: number; ratioPct: number | null } {
    const preventive = wos.filter((w) => isPm(w.type)).length;
    const corrective = wos.filter((w) => isCm(w.type)).length;
    const total = wos.length;
    return {
        preventive,
        corrective,
        ratioPct: total ? Math.round((preventive / total) * 1000) / 10 : null,
    };
}
