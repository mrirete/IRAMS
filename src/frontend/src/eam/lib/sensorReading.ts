/**
 * Sensor-reading builder — single source of truth for the ers_sensor_readings
 * insert shape (the feed the Predict twin reads + the CSV/connector writes to).
 * Centralises the two schema traps: `unit` is NOT NULL, and `trend` is
 * CHECK-constrained to rising/falling/stable — a stray value 400s at runtime.
 *
 * Column names verified against the live ers_sensor_readings table (migration 0074).
 */

export type SensorTrend = 'rising' | 'falling' | 'stable';

export interface SensorReadingInput {
    assetId: string;               // NOT NULL (FK)
    tag: string;                   // NOT NULL
    currentValue?: number | null;
    unit?: string;                 // NOT NULL → defaults to '—'
    trend?: SensorTrend | null;    // CHECK: rising|falling|stable, else null
    alarmHigh?: number | null;
    alarmLow?: number | null;
    readings?: number[];
    id?: string;                   // supplied for idempotent upsert; else generated
}

const VALID_TREND = new Set<SensorTrend>(['rising', 'falling', 'stable']);

/** Build an ers_sensor_readings row — required columns guaranteed, trend CHECK-safe. */
export function buildSensorReading(i: SensorReadingInput): Record<string, unknown> {
    return {
        id: i.id ?? self.crypto.randomUUID(),
        asset_id: i.assetId,
        tag: i.tag,
        current_value: i.currentValue ?? null,
        unit: i.unit || '—',                                             // NOT NULL
        trend: i.trend && VALID_TREND.has(i.trend) ? i.trend : null,     // CHECK-safe
        alarm_high: i.alarmHigh ?? null,
        alarm_low: i.alarmLow ?? null,
        readings: i.readings ?? [],
        created_at: new Date().toISOString(),
    };
}
