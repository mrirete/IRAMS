/**
 * Reading-due engine — the operator-rounds worklist for Condition Data.
 *
 * Every EAM built for field rounds tells the technician what to read today
 * (SAP maintenance plan calls / Maximo PM due list / MaintainX & Fiix rounds).
 * IREAMS doesn't persist a per-point frequency yet, so we derive the interval
 * from the asset's criticality (recommendMonitoringCadence: A weekly … D
 * half-yearly) and the last logged reading to compute each point's due date.
 * Pure and deterministic — no I/O — so due/overdue logic is unit-testable.
 */
import { recommendMonitoringCadence } from './monitoringCadence';

export type DueStatus = 'NEVER' | 'OVERDUE' | 'DUE' | 'OK';

export interface DuePointInput {
    definitionId: string;
    assetId: string;
    /** Asset criticality (A/B/C/D) — the fallback interval when the point has none. */
    criticality?: string | null;
    /** Per-point monitoring interval in days (0176). Overrides criticality. */
    monitoringFrequencyDays?: number | null;
    /** Per-point P-F interval in days (0176). Cadence = half of it when no explicit frequency. */
    pfIntervalDays?: number | null;
    /** ISO date of the most recent reading on this point, if any. */
    lastReadingDate?: string | null;
}

export interface DuePointResult {
    definitionId: string;
    assetId: string;
    status: DueStatus;
    intervalDays: number;
    nextDueDate: string | null;
    /** >0 overdue by N days, 0 due today, <0 not yet due, null when never read. */
    daysOverdue: number | null;
}

const MS_DAY = 24 * 60 * 60 * 1000;

/** Midnight UTC of a date string / Date, for whole-day arithmetic. */
function dayStart(d: string | Date): number {
    const dt = new Date(d);
    return Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
}

export function computeReadingDue(inputs: DuePointInput[], today: Date = new Date()): DuePointResult[] {
    const todayMs = dayStart(today);
    return inputs.map(p => {
        // Precedence: explicit per-point frequency → P-F-derived (via cadence lib,
        // which halves P-F and caps by criticality) → asset-criticality default.
        const intervalDays = p.monitoringFrequencyDays && p.monitoringFrequencyDays > 0
            ? p.monitoringFrequencyDays
            : recommendMonitoringCadence({ criticality: p.criticality, pfIntervalDays: p.pfIntervalDays }).intervalDays;
        if (!p.lastReadingDate) {
            return { definitionId: p.definitionId, assetId: p.assetId, status: 'NEVER', intervalDays, nextDueDate: null, daysOverdue: null };
        }
        const nextDueMs = dayStart(p.lastReadingDate) + intervalDays * MS_DAY;
        const daysOverdue = Math.round((todayMs - nextDueMs) / MS_DAY);
        const status: DueStatus = daysOverdue > 0 ? 'OVERDUE' : daysOverdue === 0 ? 'DUE' : 'OK';
        return {
            definitionId: p.definitionId,
            assetId: p.assetId,
            status,
            intervalDays,
            nextDueDate: new Date(nextDueMs).toISOString().slice(0, 10),
            daysOverdue,
        };
    });
}

/** A point needs reading now: never read, overdue, or due today. */
export function isDueNow(r: DuePointResult): boolean {
    return r.status === 'NEVER' || r.status === 'OVERDUE' || r.status === 'DUE';
}

export interface DueSummary { due: number; overdue: number; never: number; ok: number; total: number; }

export function summariseDue(results: DuePointResult[]): DueSummary {
    const s: DueSummary = { due: 0, overdue: 0, never: 0, ok: 0, total: results.length };
    for (const r of results) {
        if (r.status === 'OVERDUE') s.overdue++;
        else if (r.status === 'NEVER') s.never++;
        else if (r.status === 'DUE') s.due++;
        else s.ok++;
    }
    return s;
}
