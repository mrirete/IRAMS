/**
 * sensorScore — the high-only vibration point that used to score 100 at any value.
 */
import { describe, it, expect } from 'vitest';
import { sensorHealthScore, sensorZone } from './sensorScore';

describe('sensorHealthScore', () => {
    it('two-sided: unchanged — 100 at the midpoint, 60 at a limit', () => {
        expect(sensorHealthScore({ current: 537.5, alarm_low: 530, alarm_high: 545 })).toBe(100);
        expect(sensorHealthScore({ current: 545, alarm_low: 530, alarm_high: 545 })).toBe(60);
    });

    it('high-only vibration now moves the score (was always 100)', () => {
        // ISO 20816-3 Group 2 rigid: critical (C/D) 4.5 mm/s
        const at = (v: number) => sensorHealthScore({ current: v, alarm_high: 4.5 });
        expect(at(1.0)).toBe(100);           // zone A — healthy
        expect(at(2.25)).toBe(100);          // half the limit — still normal
        expect(at(4.5)).toBe(60);            // at the alarm limit
        expect(at(9)).toBeLessThan(10);      // twice the limit — near floor
        expect(at(3.4)).toBeGreaterThan(60); // zone C, not yet alarmed
        expect(at(3.4)).toBeLessThan(90);
    });

    it('low-only: 100 well above, 60 at the limit', () => {
        expect(sensorHealthScore({ current: 4, alarm_low: 2 })).toBe(100);
        expect(sensorHealthScore({ current: 2, alarm_low: 2 })).toBe(60);
        expect(sensorHealthScore({ current: 1, alarm_low: 2 })).toBe(40);
    });

    it('no usable limit → unscored, not 100', () => {
        expect(sensorHealthScore({ current: 7 })).toBeNull();
        expect(sensorHealthScore({ current: 7, alarm_high: 0 })).toBeNull();
        expect(sensorHealthScore({ current: null, alarm_high: 5 })).toBeNull();
    });
});

describe('sensorZone', () => {
    it('vibration zones come from the point limits (warning = B/C, critical = C/D)', () => {
        const p = (v: number) => sensorZone({ current: v, warn_high: 2.8, alarm_high: 4.5 }, true)?.zone;
        expect(p(1.0)).toBe('A');
        expect(p(2.0)).toBe('B');
        expect(p(3.0)).toBe('C');
        expect(p(4.6)).toBe('D');
    });

    it('a large machine is not judged on a medium machine table', () => {
        // Group 1 flexible: B/C 7.1, C/D 11.2 — 5 mm/s is zone B, not C.
        expect(sensorZone({ current: 5, warn_high: 7.1, alarm_high: 11.2 }, true)?.zone).toBe('B');
    });

    it('temperature reads the point, not a fixed 80/100/130', () => {
        const z = (v: number) => sensorZone({ current: v, warn_high: 80, alarm_high: 95 }, false)?.zone;
        expect(z(70)).toBe('Normal');
        expect(z(85)).toBe('Alert');
        expect(z(96)).toBe('Danger');
    });

    it('no limits → no badge', () => {
        expect(sensorZone({ current: 3 }, true)).toBeNull();
        expect(sensorZone({ current: 90 }, false)).toBeNull();
    });
});
