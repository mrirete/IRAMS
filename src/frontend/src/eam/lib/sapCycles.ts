/**
 * SAP maintenance cycles → IREAMS cadence.
 *
 * SAP expresses a cadence three ways and a load file may carry any of them:
 *   - MMPT.ZYKL1 + ZEIEH on a single-cycle plan ("1" + "MON");
 *   - a strategy package's text T351X.KTEX1 ("1 MONTH", "12 MONTH/ 1 YEAR");
 *   - nothing at all on a strategy plan — the packages live on the task list,
 *     and consultants then encode the cadence in the plan text ("1M/12M, …").
 * IREAMS has one cadence per schedule: an interval and a unit the calendar
 * Autopilot (Days/Weeks/Months/Years) or a meter (Hours/KM/Cycles) can serve.
 */
export type CadenceUnit = 'Days' | 'Weeks' | 'Months' | 'Years' | 'Hours' | 'KM' | 'Cycles';
export interface Cadence { interval: number; unit: CadenceUnit }

const UNIT_KEYS: Record<string, CadenceUnit> = {
    TAG: 'Days', DAY: 'Days', DAYS: 'Days', D: 'Days',
    WCH: 'Weeks', WK: 'Weeks', WEEK: 'Weeks', WEEKS: 'Weeks', W: 'Weeks',
    MON: 'Months', MTH: 'Months', MONTH: 'Months', MONTHS: 'Months', M: 'Months',
    JHR: 'Years', YR: 'Years', YEAR: 'Years', YEARS: 'Years', Y: 'Years',
    H: 'Hours', HR: 'Hours', HRS: 'Hours', STD: 'Hours', HOUR: 'Hours', HOURS: 'Hours',
    KM: 'KM',
    CYC: 'Cycles', CYCLE: 'Cycles', CYCLES: 'Cycles',
};

const METER_UNITS: CadenceUnit[] = ['Hours', 'KM', 'Cycles'];
const APPROX_DAYS: Record<CadenceUnit, number> = { Days: 1, Weeks: 7, Months: 30.44, Years: 365.25, Hours: 0, KM: 0, Cycles: 0 };

/** SAP unit key or plain English → IREAMS unit; null when unknown. */
export function sapCycleUnit(raw: string | undefined): CadenceUnit | null {
    const k = String(raw ?? '').trim().toUpperCase();
    return k ? (UNIT_KEYS[k] ?? null) : null;
}

export function isMeterUnit(unit: CadenceUnit): boolean {
    return METER_UNITS.includes(unit);
}

/** "1 MONTH", "12 MONTH/ 1 YEAR", "500 H", "2 WCH" → the FIRST number + unit pair. */
export function parseSapCycleText(text: string | undefined): Cadence | null {
    const m = String(text ?? '').match(/(\d+(?:[.,]\d+)?)\s*([A-Za-z]+)/);
    if (!m) return null;
    const unit = sapCycleUnit(m[2]);
    const interval = Number(m[1].replace(',', '.'));
    return unit && interval > 0 ? { interval, unit } : null;
}

/** An explicit ZYKL1 + ZEIEH pair from the plan's cycle block. */
export function parseSapCycle(zykl1: string | undefined, zeieh: string | undefined): Cadence | null {
    const interval = Number(String(zykl1 ?? '').replace(',', '.'));
    const unit = sapCycleUnit(zeieh);
    return unit && interval > 0 ? { interval, unit } : null;
}

/**
 * The consultant's shorthand at the head of a plan or task-list text:
 * "1M/12M,PUMP P-101,MECH" → the shortest of the leading tokens (1 Months).
 * Only tokens BEFORE the first comma count, and only if the text starts
 * with one — "PUMP 12M SERVICE" is not a hint.
 */
export function parseCadenceHint(text: string | undefined): Cadence | null {
    const head = String(text ?? '').split(',')[0].trim();
    if (!/^\d/.test(head)) return null;
    const found: Cadence[] = [];
    for (const tok of head.split(/[\/|+ ]+/)) {
        const m = tok.match(/^(\d+)\s*([A-Za-z]+)$/);
        if (!m) return found.length ? shortest(found) : null;
        const unit = sapCycleUnit(m[2]);
        if (!unit) return found.length ? shortest(found) : null;
        found.push({ interval: Number(m[1]), unit });
    }
    return found.length ? shortest(found) : null;
}

/** Calendar cadences compare in days; meter cadences sort after them, by value. */
export function cadenceRank(c: Cadence): number {
    return isMeterUnit(c.unit) ? 1e9 + c.interval : c.interval * APPROX_DAYS[c.unit];
}

export function shortest(cs: Cadence[]): Cadence {
    return [...cs].sort((a, b) => cadenceRank(a) - cadenceRank(b))[0];
}

export function cadenceEquals(a: Cadence | null | undefined, b: Cadence | null | undefined): boolean {
    return !!a && !!b && a.interval === b.interval && a.unit === b.unit;
}

/** "12M", "1Y", "2W", "500H" — the suffix a package-split schedule code carries. */
export function cadenceSuffix(c: Cadence): string {
    const letter: Record<CadenceUnit, string> = { Days: 'D', Weeks: 'W', Months: 'M', Years: 'Y', Hours: 'H', KM: 'KM', Cycles: 'CYC' };
    return `${c.interval}${letter[c.unit]}`;
}

export function cadenceLabel(c: Cadence): string {
    return `${c.interval} ${c.unit}`;
}

/** ISO date + a calendar cadence → ISO date; null for meter cadences. */
export function addCadence(isoDate: string, c: Cadence): string | null {
    if (isMeterUnit(c.unit)) return null;
    const d = new Date(`${isoDate}T00:00:00Z`);
    if (isNaN(d.getTime())) return null;
    const day = d.getUTCDate();
    switch (c.unit) {
        case 'Days': d.setUTCDate(day + c.interval); break;
        case 'Weeks': d.setUTCDate(day + 7 * c.interval); break;
        case 'Months': d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + c.interval); break;
        case 'Years': d.setUTCDate(1); d.setUTCFullYear(d.getUTCFullYear() + c.interval); break;
    }
    if (c.unit === 'Months' || c.unit === 'Years') {
        // 31 Jan + 1 month is 28 Feb (SAP's rule), not 3 Mar (JavaScript's).
        const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
        d.setUTCDate(Math.min(day, lastDay));
    }
    return d.toISOString().slice(0, 10);
}
