import { describe, it, expect } from 'vitest';
import { buildSensorReading } from './sensorReading';

describe('buildSensorReading', () => {
    it('defaults NOT-NULL unit and generates an id', () => {
        const r = buildSensorReading({ assetId: 'a1', tag: 'Vib' });
        expect(r.unit).toBe('—');
        expect(typeof r.id).toBe('string');
        expect(r.asset_id).toBe('a1');
        expect(r.readings).toEqual([]);
    });

    it('keeps a valid trend and nulls an invalid one (CHECK-safe)', () => {
        expect(buildSensorReading({ assetId: 'a', tag: 't', trend: 'rising' }).trend).toBe('rising');
        // a stray value must not reach the CHECK constraint
        expect(buildSensorReading({ assetId: 'a', tag: 't', trend: 'up' as any }).trend).toBeNull();
        expect(buildSensorReading({ assetId: 'a', tag: 't' }).trend).toBeNull();
    });

    it('reuses a supplied id for idempotent upsert, maps bands', () => {
        const r = buildSensorReading({ assetId: 'a', tag: 't', id: 'existing-id', alarmHigh: 7.1, alarmLow: 0, currentValue: 5.2 });
        expect(r.id).toBe('existing-id');
        expect(r.alarm_high).toBe(7.1);
        expect(r.alarm_low).toBe(0);
        expect(r.current_value).toBe(5.2);
    });
});
