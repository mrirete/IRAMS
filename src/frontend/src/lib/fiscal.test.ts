import { describe, it, expect } from 'vitest';
import { fiscalYearOf, fiscalPeriodOf, fiscalYearLabel, fiscalYearBounds } from './fiscal';

// Same cases as the 0396 SQL proof, so the screens and the database agree.
describe('fiscal year', () => {
    it('January start is the calendar year', () => {
        expect(fiscalYearOf('2026-02-15', 1)).toBe(2026);
        expect(fiscalPeriodOf('2026-02-15', 1)).toBe(2);
        expect(fiscalYearLabel(2026, 1)).toBe('FY 2026');
    });

    it('April start: Jan–Mar belong to the year that started the previous April', () => {
        expect(fiscalYearOf('2026-02-15', 4)).toBe(2025);
        expect(fiscalYearOf('2026-04-01', 4)).toBe(2026);
        expect(fiscalPeriodOf('2026-04-01', 4)).toBe(1);
        expect(fiscalPeriodOf('2027-03-31', 4)).toBe(12);
        expect(fiscalYearLabel(2026, 4)).toBe('FY 2026/27');
        expect(fiscalYearBounds(2026, 4)).toEqual({ from: '2026-04-01', to: '2027-04-01' });
    });

    it('a 99/00 boundary label is two digits', () => {
        expect(fiscalYearLabel(2099, 7)).toBe('FY 2099/00');
    });
});
