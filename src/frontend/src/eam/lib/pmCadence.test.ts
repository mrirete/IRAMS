import { describe, it, expect } from 'vitest';
import { addCadence, cadenceDays, firstDueDate, isWithinCallHorizon, sensibleLeadTimeDays, toDateOnly } from './pmCadence';

describe('pmCadence — the PM-44743 class (unit ignored → daily reads as monthly)', () => {
    it('adds the cadence in the unit the planner chose, not in 30-day blocks', () => {
        expect(addCadence('2026-09-14', 1, 'Days')).toBe('2026-09-15');
        expect(addCadence('2026-09-14', 2, 'weeks')).toBe('2026-09-28');
        expect(addCadence('2026-09-14', 1, 'MONTHS')).toBe('2026-10-14');
        expect(addCadence('2026-09-14', 1, 'Years')).toBe('2027-09-14');
    });

    it('is calendar-aware for months and years (not 30 × n days)', () => {
        expect(addCadence('2026-01-31', 1, 'Months')).toBe('2026-02-28'); // clamps to month end, like Postgres make_interval
        expect(addCadence('2026-02-01', 6, 'Months')).toBe('2026-08-01');
        expect(addCadence('2024-02-29', 1, 'Years')).toBe('2025-02-28');
    });

    it('returns date-only strings — the sweep compares on the calendar day', () => {
        expect(addCadence(new Date(2026, 8, 14, 14, 25), 1, 'Days')).toBe('2026-09-15');
        expect(toDateOnly(new Date(2026, 8, 14, 23, 59))).toBe('2026-09-14');
        // A stored timestamptz keeps its own calendar day whatever the browser's zone.
        expect(toDateOnly('2026-10-14T00:00:00+00:00')).toBe('2026-10-14');
        expect(toDateOnly('2026-10-14 14:25:37.305+00')).toBe('2026-10-14');
    });

    it('leaves the date alone for a meter unit (READING schedules own those)', () => {
        expect(addCadence('2026-09-14', 500, 'Hours')).toBe('2026-09-14');
        expect(cadenceDays(500, 'Hours')).toBe(0);
    });

    it('first due for a new schedule is today, whatever the cadence', () => {
        expect(firstDueDate(new Date(2026, 8, 14, 14, 25))).toBe('2026-09-14');
    });
});

describe('pmCadence — lead time as a call horizon', () => {
    it('keeps a lead time shorter than the cadence and drops one that is not', () => {
        expect(sensibleLeadTimeDays(7, 3, 'Months')).toBe(7);
        expect(sensibleLeadTimeDays(7, 1, 'Days')).toBe(0);
        expect(sensibleLeadTimeDays(7, 1, 'Weeks')).toBe(0);
        expect(sensibleLeadTimeDays(3, 1, 'Weeks')).toBe(3);
    });

    it('an occurrence enters the horizon lead-time days before it is due', () => {
        expect(isWithinCallHorizon('2026-09-21', 7, '2026-09-14')).toBe(true);
        expect(isWithinCallHorizon('2026-09-21', 7, '2026-09-13')).toBe(false);
        expect(isWithinCallHorizon('2026-09-21', 0, '2026-09-21')).toBe(true);
        expect(isWithinCallHorizon('2026-09-21', 0, '2026-09-20')).toBe(false);
    });

    it('a due date carrying a clock time still counts as due on that day', () => {
        // 0365 fix: 14:25 UTC on the due day must not be "not yet due" at the 04:20 sweep.
        expect(isWithinCallHorizon('2026-09-14T14:25:37.305Z', 0, new Date(2026, 8, 14, 4, 20))).toBe(true);
    });
});
