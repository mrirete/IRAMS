import { describe, it, expect } from 'vitest';
import { absorptionWindowDays, canBeParentOf, includedScopesSuffix, isAbsorbedBy, mergeIncludedScopes } from './pmHierarchy';

const threeM = { id: 'c', assetId: 'A', frequencyInterval: 3, frequencyUnit: 'Months', leadTimeDays: 7 };
const sixM = { id: 'p', assetId: 'A', frequencyInterval: 6, frequencyUnit: 'Months', leadTimeDays: 14 };

describe('pmHierarchy — the 6-monthly absorbs the 3-monthly', () => {
    it('absorbs within the child lead-time window, not only on the exact day', () => {
        expect(absorptionWindowDays(threeM)).toBe(7);
        expect(isAbsorbedBy('2026-03-01', '2026-03-01', 7)).toBe(true);
        expect(isAbsorbedBy('2026-03-01', '2026-03-06', 7)).toBe(true);   // parent a few days later (catch-up drift)
        expect(isAbsorbedBy('2026-03-01', '2026-02-24', 7)).toBe(true);   // parent a few days earlier
        expect(isAbsorbedBy('2026-03-01', '2026-03-09', 7)).toBe(false);
    });

    it('a daily round (lead clamped to 0) needs the exact day', () => {
        const daily = { frequencyInterval: 1, frequencyUnit: 'Days', leadTimeDays: 7 };
        expect(absorptionWindowDays(daily)).toBe(0);
        expect(isAbsorbedBy('2026-03-01', '2026-03-02', absorptionWindowDays(daily))).toBe(false);
    });

    it('a parent must be the same asset, longer cadence, time-based, not itself, no cycle', () => {
        expect(canBeParentOf(threeM, sixM)).toBe(true);
        expect(canBeParentOf(sixM, threeM)).toBe(false);                                   // shorter
        expect(canBeParentOf(threeM, { ...sixM, assetId: 'B' })).toBe(false);              // other asset
        expect(canBeParentOf(threeM, { ...sixM, id: 'c' })).toBe(false);                   // itself
        expect(canBeParentOf(threeM, { ...sixM, parentId: 'c' })).toBe(false);             // would loop
        expect(canBeParentOf(threeM, { ...sixM, scheduleType: 'READING', frequencyUnit: 'Hours' })).toBe(false);
    });

    it('merges child steps after the parent, tagged, numbering continued in 10s', () => {
        const merged = mergeIncludedScopes(
            { tasks: [{ sequence: 10, description: 'Change oil' }, { sequence: 20, description: 'Inspect belts' }], inventory: [{ description: 'Oil 20L' }] },
            [{
                scope: { pmId: 'c', code: 'PM-3M', cadence: '3 Months', dueDate: '2026-03-01' },
                templates: { tasks: [{ sequence: 10, description: 'Check leaks', instructions: [{ id: 'i', type: 'CHECKBOX', label: 'x' }] }], inventory: [{ description: 'Gasket' }] },
            }],
        );
        expect(merged.tasks.map(t => t.sequence)).toEqual([10, 20, 30]);
        expect(merged.tasks[2].description).toBe('[PM-3M · 3 Months] Check leaks');
        expect(merged.tasks[2].operationNo).toBe('0030');
        expect(merged.tasks[2].instructions).toHaveLength(1);               // the child's checklist survives
        expect(merged.inventory.map(p => p.description)).toEqual(['Oil 20L', '[PM-3M · 3 Months] Gasket']);
        expect(merged.included).toHaveLength(1);
        expect(includedScopesSuffix(merged.included)).toBe(' (incl. PM-3M · 3 Months)');
    });

    it('leaves the parent plan untouched when there is nothing to include', () => {
        const merged = mergeIncludedScopes({ tasks: [{ sequence: 10, description: 'A' }] }, []);
        expect(merged.tasks).toHaveLength(1);
        expect(includedScopesSuffix(merged.included)).toBe('');
    });
});
