/**
 * alarmGates — where "approaching the limit" begins.
 *
 * The alert scan fires before a value crosses its alarm line, by a deadband.
 * Until 2026-09-15 that deadband was a percentage OF THE LIMIT VALUE
 * (hiGate = high × 0.9), which is meaningless for anything whose zero is
 * arbitrary: 10 % of a 550 °C limit is 55 °C, so 535 °C "approached" it;
 * and for a negative limit (furnace draught, −140 Pa) low × 1.1 moved the
 * gate AWAY from the value, so it could never fire.
 *
 * Now: when both limits exist the deadband is a share of the BAND WIDTH
 * (550 − 525 = 25 °C → 2.5 °C at 10 %). With a single limit there is no
 * width, so it falls back to a share of the limit's magnitude — subtracted
 * from a high limit and added to a low one, whatever their sign — and says
 * so in `basis`, so a caller can warn that a single-sided point deserves a
 * per-point deadband (0205).
 *
 * Pure. Per-point deadband comes from the reading definition's
 * alarm_deadband_pct when rationalised; engine default 10 %; clamped 0–50.
 */
export interface AlarmGates {
    hiGate: number | null;
    loGate: number | null;
    /** what the margin was measured against */
    basis: 'band-width' | 'limit-magnitude' | 'none';
    /** the margin in engineering units */
    margin: number;
}

export const DEFAULT_DEADBAND_PCT = 10;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function alarmGates(alarmLow: number | null | undefined, alarmHigh: number | null | undefined, deadbandPct?: number | null): AlarmGates {
    const pct = Math.min(50, Math.max(0, isNum(deadbandPct) ? deadbandPct : DEFAULT_DEADBAND_PCT)) / 100;
    const lo = isNum(alarmLow) ? alarmLow : null;
    const hi = isNum(alarmHigh) ? alarmHigh : null;

    if (lo !== null && hi !== null && hi > lo) {
        const margin = (hi - lo) * pct;
        return { hiGate: hi - margin, loGate: lo + margin, basis: 'band-width', margin };
    }
    if (hi !== null || lo !== null) {
        const ref = hi ?? lo!;
        const margin = Math.abs(ref) * pct;
        return {
            hiGate: hi !== null ? hi - margin : null,
            loGate: lo !== null ? lo + Math.abs(lo) * pct : null,
            basis: 'limit-magnitude',
            margin,
        };
    }
    return { hiGate: null, loGate: null, basis: 'none', margin: 0 };
}
