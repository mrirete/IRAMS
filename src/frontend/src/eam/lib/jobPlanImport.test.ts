import { describe, it, expect } from 'vitest';
import { splitOperationsByCadence } from './jobPlanImport';

const M = (n: number) => ({ interval: n, unit: 'Months' as const });

describe('splitOperationsByCadence', () => {
    it('a strategy task list: monthly operations stay on the schedule, the annual one becomes a sibling', () => {
        const split = splitOperationsByCadence([
            { op: '0010 visual and leak check', cadence: M(1) },
            { op: '0020 vibration and temperature readings', cadence: M(1) },
            { op: '0030 annual bearing and seal inspection', cadence: M(12) },
        ]);
        expect(split.base.cadence).toEqual(M(1));
        expect(split.base.ops).toEqual(['0010 visual and leak check', '0020 vibration and temperature readings']);
        expect(split.siblings).toHaveLength(1);
        expect(split.siblings[0].cadence).toEqual(M(12));
        expect(split.siblings[0].ops).toEqual(['0030 annual bearing and seal inspection']);
    });

    it('operations without a package ride on the base schedule', () => {
        const split = splitOperationsByCadence([
            { op: 'a', cadence: null },
            { op: 'b', cadence: M(6) },
            { op: 'c', cadence: null },
        ]);
        expect(split.base.cadence).toEqual(M(6));
        expect(split.base.ops).toEqual(['a', 'b', 'c']);
        expect(split.siblings).toEqual([]);
    });

    it('no packages at all: one group, no cadence, nothing split', () => {
        const split = splitOperationsByCadence([{ op: 'a', cadence: null }, { op: 'b', cadence: null }]);
        expect(split.base).toEqual({ cadence: null, ops: ['a', 'b'] });
        expect(split.siblings).toEqual([]);
    });

    it('siblings come out shortest first, meters after calendar cadences', () => {
        const split = splitOperationsByCadence([
            { op: 'y', cadence: { interval: 1, unit: 'Years' } },
            { op: 'h', cadence: { interval: 500, unit: 'Hours' } },
            { op: 'w', cadence: { interval: 2, unit: 'Weeks' } },
            { op: 'q', cadence: M(3) },
        ]);
        expect(split.base.cadence).toEqual({ interval: 2, unit: 'Weeks' });
        expect(split.siblings.map(s => `${s.cadence!.interval}${s.cadence!.unit}`)).toEqual(['3Months', '1Years', '500Hours']);
    });
});
