/**
 * evaluateReading — classify a condition reading against its alarm bands.
 *
 * The measurement-point definition carries four limits (SAP-style IOW /
 * condition bands): minCritical / minWarning / maxWarning / maxCritical.
 * Critical wins over warning; min and max are both checked. Uses null checks
 * (not truthy) so a legitimate 0 limit is honoured.
 */
export type AlarmLevel = 'OK' | 'WARNING' | 'CRITICAL';

export interface ReadingBandDef {
    name?: string;
    unit?: string;
    minCritical?: number | null;
    minWarning?: number | null;
    maxWarning?: number | null;
    maxCritical?: number | null;
}

export interface AlarmResult {
    level: AlarmLevel;
    /** short human phrase, e.g. "above critical max 90 °C" */
    detail: string;
    limit?: number;
}

const has = (x: number | null | undefined): x is number => x !== null && x !== undefined && !Number.isNaN(x);

export function evaluateReading(value: number, def: ReadingBandDef): AlarmResult {
    const v = Number(value);
    const u = def.unit ? ` ${def.unit}` : '';
    if (has(def.maxCritical) && v > def.maxCritical) return { level: 'CRITICAL', detail: `above critical max ${def.maxCritical}${u}`, limit: def.maxCritical };
    if (has(def.minCritical) && v < def.minCritical) return { level: 'CRITICAL', detail: `below critical min ${def.minCritical}${u}`, limit: def.minCritical };
    if (has(def.maxWarning) && v > def.maxWarning) return { level: 'WARNING', detail: `above warning max ${def.maxWarning}${u}`, limit: def.maxWarning };
    if (has(def.minWarning) && v < def.minWarning) return { level: 'WARNING', detail: `below warning min ${def.minWarning}${u}`, limit: def.minWarning };
    return { level: 'OK', detail: '' };
}
