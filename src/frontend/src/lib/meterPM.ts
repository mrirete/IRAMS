/**
 * Meter-based PM triggers — the Condition Data ↔ Recurring Work integration.
 *
 * A meter-based PM ("service every 500 running hours") is due when the asset's
 * running meter crosses the next interval boundary. Leading EAMs (SAP counter
 * plans, Maximo meter-based PM, MaintainX meter automations) evaluate this on
 * every reading. This is the pure evaluator: given an asset's meter PMs and the
 * meter readings just logged, it returns which PMs have come due — deterministic,
 * no I/O, so the fuzzy matching and threshold logic can be unit-tested.
 *
 * Two due bases, most-precise first:
 *   1. Baseline known (meter value at last completion) → due when new ≥ baseline + interval.
 *   2. No baseline → interval-crossing: due when the reading rolls past a new
 *      multiple of the interval since the previous reading. Needs a previous
 *      reading; otherwise we decline rather than raise a false trigger.
 */

export interface MeterPM {
    id: string;
    title: string;
    /** 'READING' for meter-based; 'TIME' for calendar-based (ignored here). */
    scheduleType?: string;
    /** Legacy frequency_type alias (e.g. 'HOURS'). */
    frequencyType?: string;
    /** frequency_interval — e.g. 500. */
    interval: number;
    /** frequency_unit — e.g. 'Hours', 'Km', or a reading-type code. */
    unit: string;
    /** Meter value at last completion for this asset, if tracked. */
    baseline?: number | null;
}

export interface MeterReadingCtx {
    defName: string;
    unit?: string;
    readingTypeCode?: string;
    category: string; // 'METER' | 'CONDITION'
    previousValue?: number | null;
    newValue: number;
}

export interface MeterPMDue {
    pmId: string;
    pmTitle: string;
    /** The meter value at which the PM fell due. */
    dueAt: number;
    /** The reading that triggered it. */
    current: number;
    unit: string;
    reading: string;
    basis: string;
}

const norm = (s?: string | null) => (s || '').toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Calendar-based meter units that indicate a genuine running-meter schedule. */
const METER_UNIT_HINTS = ['HOURS', 'HOUR', 'HRS', 'HR', 'KM', 'KILOMETRES', 'KILOMETERS', 'MILES', 'CYCLES', 'CYCLE', 'STARTS', 'START', 'RUNTIME', 'OPERATINGHOURS'];

/** A PM is meter-based when it is scheduled by READING (or a legacy meter unit). */
export function isMeterSchedule(pm: MeterPM): boolean {
    if (norm(pm.scheduleType) === 'READING') return true;
    const u = norm(pm.frequencyType);
    return METER_UNIT_HINTS.some(h => u === norm(h));
}

/** Does this reading feed this PM's counter? Matches on unit / type code / name. */
export function matchesReading(pm: MeterPM, r: MeterReadingCtx): boolean {
    if (norm(r.category) !== 'METER') return false;
    const pmU = norm(pm.unit);
    if (!pmU) return false;
    const candidates = [norm(r.unit), norm(r.readingTypeCode), norm(r.defName)].filter(Boolean);
    // Direct or containment match either direction (e.g. PM "Hours" vs reading "Operating Hours").
    return candidates.some(c => c === pmU || c.includes(pmU) || pmU.includes(c));
}

export function evaluateMeterPMs(pms: MeterPM[], readings: MeterReadingCtx[]): MeterPMDue[] {
    const due: MeterPMDue[] = [];
    for (const pm of pms) {
        if (!isMeterSchedule(pm) || !(pm.interval > 0)) continue;
        for (const r of readings) {
            if (!matchesReading(pm, r)) continue;

            if (pm.baseline != null) {
                const dueAt = pm.baseline + pm.interval;
                if (r.newValue >= dueAt) {
                    due.push({
                        pmId: pm.id, pmTitle: pm.title, dueAt, current: r.newValue, unit: pm.unit, reading: r.defName,
                        basis: `Meter ${r.newValue}${pm.unit ? ' ' + pm.unit : ''} ≥ due at ${dueAt} (last service ${pm.baseline} + ${pm.interval})`,
                    });
                }
                continue;
            }

            // No baseline — fire on an interval-boundary crossing, needs a prior reading.
            if (r.previousValue != null) {
                const prevBoundary = Math.floor(r.previousValue / pm.interval);
                const newBoundary = Math.floor(r.newValue / pm.interval);
                if (newBoundary > prevBoundary) {
                    const dueAt = (prevBoundary + 1) * pm.interval;
                    due.push({
                        pmId: pm.id, pmTitle: pm.title, dueAt, current: r.newValue, unit: pm.unit, reading: r.defName,
                        basis: `Meter crossed ${dueAt}${pm.unit ? ' ' + pm.unit : ''} (every ${pm.interval})`,
                    });
                }
            }
        }
    }
    // De-dup by PM (a PM appears once even if several readings match).
    const seen = new Set<string>();
    return due.filter(d => (seen.has(d.pmId) ? false : (seen.add(d.pmId), true)));
}

// ── Due-date forecasting (SAP "annual estimate" for counter-based plans) ────
// Given the latest meter value and the observed usage rate, project WHEN a
// meter-based PM will fall due — so the scheduler sees it weeks ahead instead
// of only when the crossing actually happens.

export interface MeterPMForecast {
    pmId: string;
    /** Meter value at which the PM falls due. */
    dueAt: number;
    /** Meter units still to run (0 = due/overdue now). */
    remaining: number;
    /** Usage per day the forecast is based on, if known. */
    dailyRate: number | null;
    /** Whole days until due (0 = due now), null when the rate is unknown/zero. */
    daysToDue: number | null;
    /** Projected due date (ISO yyyy-mm-dd), null when it can't be projected. */
    forecastDate: string | null;
    basis: string;
}

const addDays = (iso: string, days: number): string => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
};

/**
 * Forecast when a meter-based PM falls due. Pure: `today` is injectable.
 * Returns null for non-meter PMs / zero intervals — nothing to forecast.
 */
export function forecastMeterPM(
    pm: MeterPM,
    current: { value: number; date: string },
    dailyRate: number | null,
    today: string = new Date().toISOString().slice(0, 10),
): MeterPMForecast | null {
    if (!isMeterSchedule(pm) || !(pm.interval > 0)) return null;

    // Next due point: from the last-service baseline when tracked, else the next
    // interval boundary above the current meter (mirrors evaluateMeterPMs).
    const dueAt = pm.baseline != null
        ? pm.baseline + pm.interval
        : (Math.floor(current.value / pm.interval) + 1) * pm.interval;
    const remaining = Math.max(0, dueAt - current.value);

    if (remaining === 0) {
        return {
            pmId: pm.id, dueAt, remaining, dailyRate, daysToDue: 0, forecastDate: today,
            basis: `Meter ${current.value}${pm.unit ? ' ' + pm.unit : ''} ≥ due at ${dueAt} — due now`,
        };
    }
    if (dailyRate == null || !(dailyRate > 0)) {
        return {
            pmId: pm.id, dueAt, remaining, dailyRate: null, daysToDue: null, forecastDate: null,
            basis: `${remaining}${pm.unit ? ' ' + pm.unit : ''} to go — no usage rate yet to project a date`,
        };
    }
    const daysToDue = Math.ceil(remaining / dailyRate);
    return {
        pmId: pm.id, dueAt, remaining, dailyRate, daysToDue, forecastDate: addDays(today, daysToDue),
        basis: `${remaining}${pm.unit ? ' ' + pm.unit : ''} to go at ~${dailyRate.toFixed(1)}/day → ~${daysToDue}d`,
    };
}
