/**
 * Sensor-reading CSV importer — the first *real* connector.
 *
 * The #1 real-world way a site gets sensor data into a new EAM is a historian /
 * SCADA / lab CSV export. This parses that export and aggregates it into the
 * ers_sensor_readings shape the Predict twin already reads — turning the Connector
 * Hub's "CSV" type from a mock into a working ingestion path. Pure and
 * deterministic (no I/O); the DB upsert lives in PredictionService.
 *
 * Accepted headers (case-insensitive, synonyms tolerated):
 *   asset      — asset tag or id (asset, asset_tag, equipment, tag_asset)
 *   tag        — the sensor/measurement point (tag, sensor, point, measurement)
 *   value      — numeric reading (value, reading, val)
 *   unit       — engineering unit (unit, uom)              [optional]
 *   timestamp  — ISO date/time (timestamp, time, date, ts) [optional, orders series]
 *   alarm_high / alarm_low (max/high, min/low)             [optional]
 */

export interface RawSensorRow {
    asset?: string;        // tag or id — resolved to asset_id by the caller
    tag: string;
    value: number;
    unit?: string;
    timestamp?: string;
    alarmHigh?: number | null;
    alarmLow?: number | null;
    line: number;
}

export interface ParseResult {
    rows: RawSensorRow[];
    errors: string[];
    headers: string[];
}

export interface AggregatedSensor {
    asset: string;         // the asset tag/id token from the file
    tag: string;
    unit: string;
    currentValue: number;
    trend: 'rising' | 'falling' | 'stable' | null;
    readings: number[];
    alarmHigh: number | null;
    alarmLow: number | null;
    count: number;
}

const HEADER_SYNONYMS: Record<string, string> = {
    asset: 'asset', asset_tag: 'asset', 'asset tag': 'asset', equipment: 'asset', tag_asset: 'asset', assetid: 'asset', asset_id: 'asset',
    tag: 'tag', sensor: 'tag', point: 'tag', measurement: 'tag', 'measurement point': 'tag',
    value: 'value', reading: 'value', val: 'value', reading_value: 'value',
    unit: 'unit', uom: 'unit', units: 'unit',
    timestamp: 'timestamp', time: 'timestamp', date: 'timestamp', datetime: 'timestamp', ts: 'timestamp', reading_date: 'timestamp',
    alarm_high: 'alarmHigh', 'alarm high': 'alarmHigh', max: 'alarmHigh', high: 'alarmHigh', max_critical: 'alarmHigh',
    alarm_low: 'alarmLow', 'alarm low': 'alarmLow', min: 'alarmLow', low: 'alarmLow', min_critical: 'alarmLow',
};

function detectDelimiter(headerLine: string): string {
    const counts = [[',', (headerLine.match(/,/g) || []).length], [';', (headerLine.match(/;/g) || []).length], ['\t', (headerLine.match(/\t/g) || []).length]] as [string, number][];
    counts.sort((a, b) => b[1] - a[1]);
    return counts[0][1] > 0 ? counts[0][0] : ',';
}

function splitRow(line: string, delim: string): string[] {
    // Minimal CSV: handles simple quoted fields (no embedded newlines).
    const out: string[] = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
        else if (c === delim && !inQ) { out.push(cur); cur = ''; }
        else cur += c;
    }
    out.push(cur);
    return out.map(s => s.trim());
}

const num = (s?: string): number | null => {
    if (s == null || s.trim() === '') return null;
    const n = Number(s.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
};

export function parseSensorCsv(text: string): ParseResult {
    const errors: string[] = [];
    const lines = (text || '').split(/\r?\n/).filter(l => l.trim() !== '');
    if (lines.length < 2) return { rows: [], errors: ['Need a header row and at least one data row.'], headers: [] };

    const delim = detectDelimiter(lines[0]);
    const rawHeaders = splitRow(lines[0], delim);
    const headers = rawHeaders.map(h => HEADER_SYNONYMS[h.toLowerCase()] || h.toLowerCase());
    const col = (name: string) => headers.indexOf(name);

    const iTag = col('tag'), iVal = col('value');
    if (iTag < 0) errors.push('Missing a "tag" (sensor/point) column.');
    if (iVal < 0) errors.push('Missing a "value" column.');
    if (iTag < 0 || iVal < 0) return { rows: [], errors, headers };

    const iAsset = col('asset'), iUnit = col('unit'), iTs = col('timestamp'), iHi = col('alarmHigh'), iLo = col('alarmLow');
    const rows: RawSensorRow[] = [];

    for (let r = 1; r < lines.length; r++) {
        const cells = splitRow(lines[r], delim);
        const tag = (cells[iTag] || '').trim();
        const value = num(cells[iVal]);
        if (!tag) { errors.push(`Line ${r + 1}: empty tag — skipped.`); continue; }
        if (value == null) { errors.push(`Line ${r + 1}: non-numeric value "${cells[iVal] ?? ''}" — skipped.`); continue; }
        rows.push({
            asset: iAsset >= 0 ? (cells[iAsset] || '').trim() : undefined,
            tag, value,
            unit: iUnit >= 0 ? (cells[iUnit] || '').trim() : undefined,
            timestamp: iTs >= 0 ? (cells[iTs] || '').trim() : undefined,
            alarmHigh: iHi >= 0 ? num(cells[iHi]) : undefined,
            alarmLow: iLo >= 0 ? num(cells[iLo]) : undefined,
            line: r + 1,
        });
    }
    return { rows, errors, headers };
}

/** Collapse many rows into one aggregated sensor per (asset, tag): latest value,
 *  chronological series, inferred trend, and any alarm bands present. */
export function aggregateSensors(rows: RawSensorRow[]): AggregatedSensor[] {
    const groups = new Map<string, RawSensorRow[]>();
    for (const r of rows) {
        const key = `${(r.asset || '').toLowerCase()}|${r.tag.toLowerCase()}`;
        (groups.get(key) || groups.set(key, []).get(key)!).push(r);
    }
    const out: AggregatedSensor[] = [];
    for (const grp of groups.values()) {
        // Order by timestamp when available, else keep file order.
        const ordered = grp.every(g => g.timestamp)
            ? [...grp].sort((a, b) => new Date(a.timestamp!).getTime() - new Date(b.timestamp!).getTime())
            : grp;
        const values = ordered.map(g => g.value);
        const last = values[values.length - 1];
        const prev = values.length > 1 ? values[values.length - 2] : undefined;
        const trend = prev == null ? null : last > prev ? 'rising' : last < prev ? 'falling' : 'stable';
        const firstDefined = <T,>(pick: (r: RawSensorRow) => T | null | undefined): T | null => {
            for (const r of ordered) { const v = pick(r); if (v != null && v !== ('' as any)) return v as T; }
            return null;
        };
        out.push({
            asset: ordered[0].asset || '',
            tag: ordered[0].tag,
            unit: firstDefined(r => r.unit) || '',
            currentValue: last,
            trend,
            readings: values.slice(-50),
            alarmHigh: firstDefined(r => r.alarmHigh),
            alarmLow: firstDefined(r => r.alarmLow),
            count: values.length,
        });
    }
    return out;
}
