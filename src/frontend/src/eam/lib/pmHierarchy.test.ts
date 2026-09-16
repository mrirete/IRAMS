import { describe, it, expect } from 'vitest';
import { absorptionWindowDays, canBeParentOf, includedScopesSuffix, isAbsorbedBy, isHarmonic, mergeIncludedScopes } from './pmHierarchy';

const threeM = { id: 'c', assetId: 'A', frequencyInterval: 3, frequencyUnit: 'Months', leadTimeDays: 7 };
const sixM = { id: 'p', assetId: 'A', frequencyInterval: 6, frequencyUnit: 'Months', leadTimeDays: 14 };

describe('nested intervals — the 6-monthly satisfies the 3-monthly', () => {
    it('satisfies within the nested task lead-time window, not only on the exact day', () => {
        expect(absorptionWindowDays(threeM)).toBe(7);
        expect(isAbsorbedBy('2026-03-01', '2026-03-01', 7)).toBe(true);
        expect(isAbsorbedBy('2026-03-01', '2026-03-06', 7)).toBe(true);   // longer task a few days later (catch-up drift)
        expect(isAbsorbedBy('2026-03-01', '2026-02-24', 7)).toBe(true);   // longer task a few days earlier
        expect(isAbsorbedBy('2026-03-01', '2026-03-09', 7)).toBe(false);
    });

    it('a daily round (lead clamped to 0) needs the exact day', () => {
        const daily = { frequencyInterval: 1, frequencyUnit: 'Days', leadTimeDays: 7 };
        expect(absorptionWindowDays(daily)).toBe(0);
        expect(isAbsorbedBy('2026-03-01', '2026-03-02', absorptionWindowDays(daily))).toBe(false);
    });

    it('harmonic intervals coincide on every longer occurrence; others only sometimes', () => {
        expect(isHarmonic(threeM, sixM)).toBe(true);
        expect(isHarmonic({ frequencyInterval: 4, frequencyUnit: 'Months' }, sixM)).toBe(false);
        expect(isHarmonic({ frequencyInterval: 1, frequencyUnit: 'Weeks' }, { frequencyInterval: 4, frequencyUnit: 'Weeks' })).toBe(true);
        expect(isHarmonic(sixM, threeM)).toBe(false);
    });

    it('a longer task must be the same asset, longer interval, time-based, not itself, no cycle', () => {
        expect(canBeParentOf(threeM, sixM)).toBe(true);
        expect(canBeParentOf(sixM, threeM)).toBe(false);                                   // shorter
        expect(canBeParentOf(threeM, { ...sixM, assetId: 'B' })).toBe(false);              // other asset
        expect(canBeParentOf(threeM, { ...sixM, id: 'c' })).toBe(false);                   // itself
        expect(canBeParentOf(threeM, { ...sixM, parentId: 'c' })).toBe(false);             // would loop
        expect(canBeParentOf(threeM, { ...sixM, scheduleType: 'READING', frequencyUnit: 'Hours' })).toBe(false);
    });

    it('SUPERSEDES: the longer plan already covers the scope — nothing appended, occurrence still recorded', () => {
        const merged = mergeIncludedScopes(
            { tasks: [{ sequence: 10, description: 'Inspect bearings' }, { sequence: 20, description: 'Inspect belts' }], inventory: [{ description: 'Oil 20L' }] },
            [{
                scope: { pmId: 'c', code: 'PM-3M', cadence: '3 Months', dueDate: '2026-03-01', mode: 'SUPERSEDES' },
                templates: { tasks: [{ sequence: 10, description: 'Inspect bearings' }], inventory: [{ description: 'Gasket' }] },
            }],
        );
        expect(merged.tasks).toHaveLength(2);                                // no duplicated inspection
        expect(merged.inventory).toHaveLength(1);
        expect(merged.included).toHaveLength(1);                             // but the order records what it satisfied
        expect(includedScopesSuffix(merged.included)).toBe(' (also satisfies PM-3M · 3 Months)');
    });

    it('COMBINES: distinct scope appended after the longer plan, tagged, numbering continued in 10s', () => {
        const merged = mergeIncludedScopes(
            { tasks: [{ sequence: 10, description: 'Change oil' }, { sequence: 20, description: 'Inspect belts' }], inventory: [{ description: 'Oil 20L' }] },
            [{
                scope: { pmId: 'c', code: 'PM-3M', cadence: '3 Months', dueDate: '2026-03-01', mode: 'COMBINES' },
                templates: { tasks: [{ sequence: 10, description: 'Check leaks', instructions: [{ id: 'i', type: 'CHECKBOX', label: 'x' }] }], inventory: [{ description: 'Gasket' }] },
            }],
        );
        expect(merged.tasks.map(t => t.sequence)).toEqual([10, 20, 30]);
        expect(merged.tasks[2].description).toBe('[PM-3M · 3 Months] Check leaks');
        expect(merged.tasks[2].operationNo).toBe('0030');
        expect(merged.tasks[2].instructions).toHaveLength(1);               // the nested task's checklist survives
        expect(merged.inventory.map(p => p.description)).toEqual(['Oil 20L', '[PM-3M · 3 Months] Gasket']);
    });

    it('leaves the longer plan untouched when there is nothing nested', () => {
        const merged = mergeIncludedScopes({ tasks: [{ sequence: 10, description: 'A' }] }, []);
        expect(merged.tasks).toHaveLength(1);
        expect(includedScopesSuffix(merged.included)).toBe('');
    });
});
