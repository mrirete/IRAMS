import { describe, it, expect } from 'vitest';
import { evaluateMeterPMs, forecastMeterPM, isMeterSchedule, matchesReading, type MeterPM, type MeterReadingCtx } from './meterPM';

const pm = (over: Partial<MeterPM> = {}): MeterPM => ({ id: 'pm1', title: '500h Service', scheduleType: 'READING', interval: 500, unit: 'Hours', ...over });
const rd = (over: Partial<MeterReadingCtx> = {}): MeterReadingCtx => ({ defName: 'Operating Hours', unit: 'Hours', category: 'METER', newValue: 0, ...over });

describe('isMeterSchedule', () => {
    it('true for READING schedule and legacy meter units', () => {
        expect(isMeterSchedule(pm())).toBe(true);
        expect(isMeterSchedule(pm({ scheduleType: undefined, frequencyType: 'HOURS' }))).toBe(true);
        expect(isMeterSchedule(pm({ scheduleType: 'TIME', frequencyType: 'MONTHS' }))).toBe(false);
    });
});

describe('matchesReading', () => {
    it('matches meter readings by unit / code / name, ignores condition readings', () => {
        expect(matchesReading(pm({ unit: 'Hours' }), rd({ unit: 'Hours' }))).toBe(true);
        expect(matchesReading(pm({ unit: 'Hours' }), rd({ unit: 'hr', defName: 'Operating Hours' }))).toBe(true);
        expect(matchesReading(pm({ unit: 'Km' }), rd({ unit: 'Hours' }))).toBe(false);
        expect(matchesReading(pm(), rd({ category: 'CONDITION' }))).toBe(false);
    });
});

describe('evaluateMeterPMs — baseline known', () => {
    it('due when meter reaches last-service + interval', () => {
        const due = evaluateMeterPMs([pm({ baseline: 4800 })], [rd({ previousValue: 5200, newValue: 5310 })]);
        expect(due).toHaveLength(1);
        expect(due[0].dueAt).toBe(5300);
        expect(due[0].pmId).toBe('pm1');
    });
    it('not due before the threshold', () => {
        expect(evaluateMeterPMs([pm({ baseline: 5000 })], [rd({ newValue: 5200 })])).toHaveLength(0);
    });
    it('does not re-fire after the baseline is stamped at generation', () => {
        // Fires at 5310 (baseline 4800 + 500 = 5300 crossed)...
        expect(evaluateMeterPMs([pm({ baseline: 4800 })], [rd({ newValue: 5310 })])).toHaveLength(1);
        // ...after stamping baseline=5310, a later 5400 reading must NOT re-fire (next due 5810).
        expect(evaluateMeterPMs([pm({ baseline: 5310 })], [rd({ previousValue: 5310, newValue: 5400 })])).toHaveLength(0);
        // ...and it fires again only once the meter passes 5810.
        expect(evaluateMeterPMs([pm({ baseline: 5310 })], [rd({ newValue: 5820 })])).toHaveLength(1);
    });
});

describe('evaluateMeterPMs — no baseline (interval crossing)', () => {
    it('fires when the reading rolls past a new interval boundary', () => {
        const due = evaluateMeterPMs([pm()], [rd({ previousValue: 480, newValue: 510 })]);
        expect(due).toHaveLength(1);
        expect(due[0].dueAt).toBe(500);
    });
    it('does not fire when still within the same interval', () => {
        expect(evaluateMeterPMs([pm()], [rd({ previousValue: 210, newValue: 260 })])).toHaveLength(0);
    });
    it('declines (no false trigger) when there is no previous reading', () => {
        expect(evaluateMeterPMs([pm()], [rd({ previousValue: null, newValue: 999999 })])).toHaveLength(0);
    });
});

describe('evaluateMeterPMs — hygiene', () => {
    it('ignores time-based PMs and zero intervals', () => {
        expect(evaluateMeterPMs([pm({ scheduleType: 'TIME' })], [rd({ previousValue: 480, newValue: 510 })])).toHaveLength(0);
        expect(evaluateMeterPMs([pm({ interval: 0 })], [rd({ previousValue: 480, newValue: 510 })])).toHaveLength(0);
    });
    it('reports each due PM once even if multiple readings match', () => {
        const due = evaluateMeterPMs(
            [pm({ baseline: 0 })],
            [rd({ newValue: 600 }), rd({ defName: 'Run Hours', newValue: 700 })],
        );
        expect(due).toHaveLength(1);
    });
});

describe('forecastMeterPM — projected due date (SAP annual-estimate style)', () => {
    it('projects the due date from the usage rate (baseline known)', () => {
        // Last service at 4800, every 500 → due at 5300. Meter at 5100, 20/day → 200 to go = 10 days.
        const f = forecastMeterPM(pm({ baseline: 4800 }), { value: 5100, date: '2026-07-01' }, 20, '2026-07-01');
        expect(f).not.toBeNull();
        expect(f!.dueAt).toBe(5300);
        expect(f!.remaining).toBe(200);
        expect(f!.daysToDue).toBe(10);
        expect(f!.forecastDate).toBe('2026-07-11');
    });
    it('uses the next interval boundary when no baseline is tracked', () => {
        // No baseline, every 500, meter at 1180 → next boundary 1500; 320 to go at 32/day = 10 days.
        const f = forecastMeterPM(pm(), { value: 1180, date: '2026-07-01' }, 32, '2026-07-01');
        expect(f!.dueAt).toBe(1500);
        expect(f!.daysToDue).toBe(10);
        expect(f!.forecastDate).toBe('2026-07-11');
    });
    it('reports due now (0 days) once the meter has passed the due point', () => {
        const f = forecastMeterPM(pm({ baseline: 4800 }), { value: 5320, date: '2026-07-01' }, 20, '2026-07-01');
        expect(f!.remaining).toBe(0);
        expect(f!.daysToDue).toBe(0);
        expect(f!.forecastDate).toBe('2026-07-01');
    });
    it('declines a date (but still reports remaining) without a usage rate', () => {
        const f = forecastMeterPM(pm({ baseline: 4800 }), { value: 5100, date: '2026-07-01' }, null, '2026-07-01');
        expect(f!.remaining).toBe(200);
        expect(f!.daysToDue).toBeNull();
        expect(f!.forecastDate).toBeNull();
    });
    it('rounds partial days up (due date is never optimistic)', () => {
        // 200 to go at 30/day = 6.67 days → 7 days.
        const f = forecastMeterPM(pm({ baseline: 4800 }), { value: 5100, date: '2026-07-01' }, 30, '2026-07-01');
        expect(f!.daysToDue).toBe(7);
        expect(f!.forecastDate).toBe('2026-07-08');
    });
    it('returns null for time-based PMs and zero intervals', () => {
        expect(forecastMeterPM(pm({ scheduleType: 'TIME', frequencyType: 'MONTHS' }), { value: 100, date: '2026-07-01' }, 10)).toBeNull();
        expect(forecastMeterPM(pm({ interval: 0 }), { value: 100, date: '2026-07-01' }, 10)).toBeNull();
    });
});
