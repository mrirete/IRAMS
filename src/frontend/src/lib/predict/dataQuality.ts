/**
 * Per-point data-quality flags (ISO 13374 data manipulation layer: bad data
 * is identified before it is used for state detection or health).
 *
 *   stale        — the point's last reading is older than twice its monitoring
 *                  interval (or STALE_DAYS when it has none). Only judged when
 *                  the point's own reading time is known (manual rounds, file
 *                  loads); a live feed's age is the asset-level "Last reading".
 *   flatlined    — the last 10 readings are identical: a stuck sensor or a
 *                  frozen feed, not a perfectly steady machine.
 *   implausible  — physically impossible for its kind (negative vibration,
 *                  flow, current or wall thickness) or more than ten times its
 *                  own alarm limit — a unit or scaling error, not a condition.
 *
 * A flagged point is left out of the health score, and its tile says why.
 */
import { STALE_DAYS } from '../../config/predict';
import type { SensorKind } from './healthModels';

export type QualityFlag = 'stale' | 'flatlined' | 'implausible';

export interface PointForQuality {
    current: number | null | undefined;
    readings?: number[];
    alarm_high?: number | null;
    alarm_low?: number | null;
    kind: SensorKind | string;
    lastReadingAt?: string | null;
    intervalDays?: number | null;
}

export const FLATLINE_RUN = 10;
const NON_NEGATIVE = new Set(['vibration', 'flow', 'current', 'thickness']);

export function qualityFlags(p: PointForQuality, now = Date.now()): { flag: QualityFlag; reason: string }[] {
    const out: { flag: QualityFlag; reason: string }[] = [];

    if (p.lastReadingAt) {
        const ageDays = (now - new Date(p.lastReadingAt).getTime()) / 86_400_000;
        const limit = p.intervalDays && p.intervalDays > 0 ? 2 * p.intervalDays : STALE_DAYS;
        if (Number.isFinite(ageDays) && ageDays > limit) {
            out.push({ flag: 'stale', reason: `Last reading ${Math.floor(ageDays)} days ago — expected at least every ${p.intervalDays && p.intervalDays > 0 ? `${p.intervalDays} days` : `${STALE_DAYS} days`}.` });
        }
    }

    const r = (p.readings ?? []).filter(Number.isFinite);
    if (r.length >= FLATLINE_RUN) {
        const tail = r.slice(-FLATLINE_RUN);
        if (tail.every(v => v === tail[0])) {
            out.push({ flag: 'flatlined', reason: `The last ${FLATLINE_RUN} readings are all exactly ${tail[0]} — likely a stuck sensor or frozen feed.` });
        }
    }

    const x = p.current;
    if (x != null && Number.isFinite(x)) {
        if (NON_NEGATIVE.has(String(p.kind)) && x < 0) {
            out.push({ flag: 'implausible', reason: `A ${p.kind} reading cannot be negative (${x}).` });
        } else {
            const lim = Math.max(Math.abs(p.alarm_high ?? 0), Math.abs(p.alarm_low ?? 0));
            if (lim > 0 && Math.abs(x) > 10 * lim) {
                out.push({ flag: 'implausible', reason: `${x} is more than ten times its alarm limit (${lim}) — check units or scaling.` });
            }
        }
    }
    return out;
}

export const FLAG_LABEL: Record<QualityFlag, string> = { stale: 'Stale', flatlined: 'Flat-lined', implausible: 'Implausible' };
