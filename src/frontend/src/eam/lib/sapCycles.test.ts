import { describe, it, expect } from 'vitest';
import {
    sapCycleUnit, parseSapCycleText, parseSapCycle, parseCadenceHint, shortest, cadenceSuffix, addCadence, cadenceEquals,
} from './sapCycles';

describe('sapCycleUnit', () => {
    it('reads SAP unit keys and plain English', () => {
        expect(sapCycleUnit('MON')).toBe('Months');
        expect(sapCycleUnit('month')).toBe('Months');
        expect(sapCycleUnit('WCH')).toBe('Weeks');
        expect(sapCycleUnit('TAG')).toBe('Days');
        expect(sapCycleUnit('JHR')).toBe('Years');
        expect(sapCycleUnit('H')).toBe('Hours');
        expect(sapCycleUnit('KM')).toBe('KM');
        expect(sapCycleUnit('')).toBeNull();
        expect(sapCycleUnit('FOO')).toBeNull();
    });
});

describe('parseSapCycleText — package text T351X.KTEX1', () => {
    it('takes the first number + unit pair', () => {
        expect(parseSapCycleText('1 MONTH')).toEqual({ interval: 1, unit: 'Months' });
        expect(parseSapCycleText('12 MONTH/ 1 YEAR')).toEqual({ interval: 12, unit: 'Months' });
        expect(parseSapCycleText('500 H')).toEqual({ interval: 500, unit: 'Hours' });
        expect(parseSapCycleText('2 WCH')).toEqual({ interval: 2, unit: 'Weeks' });
    });
    it('rejects text with no cadence', () => {
        expect(parseSapCycleText('MONTHLY')).toBeNull();
        expect(parseSapCycleText('')).toBeNull();
        expect(parseSapCycleText('PACKAGE A')).toBeNull();
    });
});

describe('parseSapCycle — ZYKL1 + ZEIEH', () => {
    it('pairs the cycle with its unit', () => {
        expect(parseSapCycle('3', 'MON')).toEqual({ interval: 3, unit: 'Months' });
        expect(parseSapCycle('2000', 'H')).toEqual({ interval: 2000, unit: 'Hours' });
        expect(parseSapCycle('', 'MON')).toBeNull();
        expect(parseSapCycle('3', '')).toBeNull();
    });
});

describe('parseCadenceHint — "1M/12M,PUMP P-101,MECH"', () => {
    it('reads the shortest of the leading tokens', () => {
        expect(parseCadenceHint('1M/12M,PUMP P-101,MECH')).toEqual({ interval: 1, unit: 'Months' });
        expect(parseCadenceHint('12M/1M, MOTOR')).toEqual({ interval: 1, unit: 'Months' });
        expect(parseCadenceHint('2W')).toEqual({ interval: 2, unit: 'Weeks' });
        expect(parseCadenceHint('500H/2000H, GT-301')).toEqual({ interval: 500, unit: 'Hours' });
    });
    it('is not fooled by text that merely contains a cadence', () => {
        expect(parseCadenceHint('PUMP 12M SERVICE')).toBeNull();
        expect(parseCadenceHint('PUMP P-101 PREVENTIVE MAINTENANCE')).toBeNull();
        expect(parseCadenceHint('')).toBeNull();
    });
});

describe('cadence arithmetic', () => {
    it('shortest ranks calendar cadences by days and meters after them', () => {
        expect(shortest([{ interval: 12, unit: 'Months' }, { interval: 1, unit: 'Months' }, { interval: 2, unit: 'Weeks' }]))
            .toEqual({ interval: 2, unit: 'Weeks' });
        expect(shortest([{ interval: 500, unit: 'Hours' }, { interval: 1, unit: 'Years' }])).toEqual({ interval: 1, unit: 'Years' });
    });
    it('suffix and equality', () => {
        expect(cadenceSuffix({ interval: 12, unit: 'Months' })).toBe('12M');
        expect(cadenceSuffix({ interval: 1, unit: 'Years' })).toBe('1Y');
        expect(cadenceSuffix({ interval: 500, unit: 'Hours' })).toBe('500H');
        expect(cadenceEquals({ interval: 1, unit: 'Months' }, { interval: 1, unit: 'Months' })).toBe(true);
        expect(cadenceEquals({ interval: 1, unit: 'Months' }, { interval: 1, unit: 'Years' })).toBe(false);
        expect(cadenceEquals(null, { interval: 1, unit: 'Years' })).toBe(false);
    });
    it('addCadence walks the calendar; meters have no date', () => {
        expect(addCadence('2026-10-01', { interval: 1, unit: 'Months' })).toBe('2026-11-01');
        expect(addCadence('2026-10-01', { interval: 12, unit: 'Months' })).toBe('2027-10-01');
        expect(addCadence('2026-10-01', { interval: 2, unit: 'Weeks' })).toBe('2026-10-15');
        expect(addCadence('2026-01-31', { interval: 1, unit: 'Months' })).toBe('2026-02-28'); // SAP's rule, not JavaScript's roll-over
        expect(addCadence('2028-02-29', { interval: 1, unit: 'Years' })).toBe('2029-02-28');
        expect(addCadence('2026-10-01', { interval: 500, unit: 'Hours' })).toBeNull();
        expect(addCadence('not a date', { interval: 1, unit: 'Days' })).toBeNull();
    });
});
