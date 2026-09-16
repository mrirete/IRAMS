/**
 * PM calendar cadence — the one place that turns "every N <unit>" into dates.
 *
 * The New Strategy modal once computed the first due date as `interval × 30
 * days` whatever the unit, so a "1 Days" PM was first due a month out and
 * read as monthly (PM-44743, 2026-09-14). Three other places hard-coded
 * `setMonth(+interval)`. Every caller now goes through here, and every date
 * this module hands back is a plain `YYYY-MM-DD` — the daily sweep compares
 * schedules on the calendar day, never on a clock time (0365).
 */

export type CalendarUnit = 'DAYS' | 'WEEKS' | 'MONTHS' | 'YEARS';

/** Approximate length of one cadence unit in days — for lead-time sanity only. */
const UNIT_DAYS: Record<CalendarUnit, number> = { DAYS: 1, WEEKS: 7, MONTHS: 30, YEARS: 365 };

export function normaliseUnit(unit: string | null | undefined): CalendarUnit | null {
    const u = String(unit || '').toUpperCase();
    return (u === 'DAYS' || u === 'WEEKS' || u === 'MONTHS' || u === 'YEARS') ? u : null;
}

/**
 * `YYYY-MM-DD` of a date. A Date is read in the caller's local calendar; an
 * ISO string keeps its own date part — a stored `2026-10-14T00:00:00+00:00`
 * is the 14th whatever timezone the browser sits in.
 */
export function toDateOnly(d: Date | string): string {
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
    const x = typeof d === 'string' ? new Date(d) : d;
    const y = x.getFullYear();
    const m = String(x.getMonth() + 1).padStart(2, '0');
    const day = String(x.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/** Parse `YYYY-MM-DD` (or any ISO string) as a local-midnight Date. */
function atLocalMidnight(d: Date | string): Date {
    const s = typeof d === 'string' ? d : toDateOnly(d);
    const [y, m, day] = s.slice(0, 10).split('-').map(Number);
    return new Date(y, (m || 1) - 1, day || 1);
}

/** The date one cadence step after `from`, unit-aware. Unknown units return `from` unchanged. */
export function addCadence(from: Date | string, interval: number, unit: string | null | undefined): string {
    const d = atLocalMidnight(from);
    const n = Math.max(0, Math.floor(Number(interval) || 0));
    switch (normaliseUnit(unit)) {
        case 'DAYS': d.setDate(d.getDate() + n); break;
        case 'WEEKS': d.setDate(d.getDate() + n * 7); break;
        case 'MONTHS': { const day = d.getDate(); d.setMonth(d.getMonth() + n); if (d.getDate() !== day) d.setDate(0); break; }
        case 'YEARS': { const day = d.getDate(); d.setFullYear(d.getFullYear() + n); if (d.getDate() !== day) d.setDate(0); break; }
        default: break;
    }
    return toDateOnly(d);
}

/** Cadence length in days (approximate for months/years). 0 for unknown units. */
export function cadenceDays(interval: number, unit: string | null | undefined): number {
    const u = normaliseUnit(unit);
    return u ? Math.max(0, Math.floor(Number(interval) || 0)) * UNIT_DAYS[u] : 0;
}

/**
 * First due date for a brand-new schedule: today. A PM a planner just created
 * should be servable now — the cadence governs the gap between occurrences,
 * not how long the first one waits.
 */
export function firstDueDate(now: Date = new Date()): string {
    return toDateOnly(now);
}

/**
 * Lead time (advance generation window) that makes sense for a cadence: the 7-day default
 * is fine for a quarterly service and nonsense for a daily round. Anything
 * ≥ the cadence collapses to 0 — the sweep clamps the same way (0365).
 */
export function sensibleLeadTimeDays(requested: number, interval: number, unit: string | null | undefined): number {
    const lead = Math.max(0, Math.floor(Number(requested) || 0));
    const cad = cadenceDays(interval, unit);
    if (cad <= 0) return lead;
    return lead >= cad ? 0 : lead;
}

/** Is an occurrence due `dueDate` inside its advance generation window (lead time) on `asOf`? */
export function isWithinCallHorizon(dueDate: string | Date, leadTimeDays: number, asOf: Date | string = new Date()): boolean {
    const due = atLocalMidnight(dueDate);
    due.setDate(due.getDate() - Math.max(0, Math.floor(Number(leadTimeDays) || 0)));
    return due.getTime() <= atLocalMidnight(asOf).getTime();
}
