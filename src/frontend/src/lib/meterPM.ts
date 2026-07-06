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
