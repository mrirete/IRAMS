import { describe, it, expect } from 'vitest';
import { rollupHierarchy, redundancyGroupsFromRbdModels, type RollupInput } from './rollup';

// SYSTEM S1 with three monitored pumps: A (degraded, crit A), B (healthy
// standby twin of A), C (healthy, series).
const assets: RollupInput[] = [
    { id: 's1', name: 'Cooling System', parentId: null, hierarchyLevel: 'SYSTEM', criticality: 'A' },
    { id: 'pa', name: 'Pump A', parentId: 's1', hierarchyLevel: 'EQUIPMENT', criticality: 'A' },
    { id: 'pb', name: 'Pump B', parentId: 's1', hierarchyLevel: 'EQUIPMENT', criticality: 'A' },
    { id: 'pc', name: 'Pump C', parentId: 's1', hierarchyLevel: 'EQUIPMENT', criticality: 'B' },
];
const health = new Map([['pa', 40], ['pb', 95], ['pc', 90]]);

describe('redundancyGroupsFromRbdModels', () => {
    it('extracts parallel groups with ≥2 linked blocks and ignores series/unlinked', () => {
        const groups = redundancyGroupsFromRbdModels([{
            blocks: [
                { id: 'b1', assetId: 'pa' },
                { id: 'b2', assetId: 'pb' },
                { id: 'b3' },                    // unlinked
                { id: 'b4', assetId: 'pc' },
            ],
            groups: [
                { type: 'parallel', label: 'Cooling (Redundant)', blocks: ['b1', 'b2', 'b3'] },
                { type: 'series', label: 'Main Train', blocks: ['b4'] },
                { type: 'parallel', label: 'Half-linked', blocks: ['b3', 'b4'] }, // only 1 linked
            ],
        }]);
        expect(groups).toHaveLength(1);
        expect(groups[0]).toEqual({ memberAssetIds: ['pa', 'pb'], label: 'Cooling (Redundant)' });
    });
});

describe('rollupHierarchy with redundancy', () => {
    it('a degraded pump with a healthy standby twin stops being the weakest link', () => {
        const without = rollupHierarchy(assets, health);
        const withRbd = rollupHierarchy(assets, health, [
            { memberAssetIds: ['pa', 'pb'], label: 'Cooling (Redundant)' },
        ]);

        const s1NoRbd = without.find(n => n.id === 's1')!;
        const s1Rbd = withRbd.find(n => n.id === 's1')!;

        // Series view: worst link is Pump A at 40 and it drags the system.
        expect(s1NoRbd.worst?.id).toBe('pa');

        // Redundancy view: A∥B combine to 100×(1−0.6×0.05) = 97 — the pair is
        // no longer the weakest link, and system health improves markedly.
        expect(s1Rbd.worst?.id).not.toBe('pa');
        expect(s1Rbd.health).toBeGreaterThan(s1NoRbd.health + 10);
        const combined = s1Rbd.offenders.find(o => o.id.startsWith('rbd-'));
        expect(combined?.health).toBe(97);
        expect(combined?.criticality).toBe('A'); // highest member criticality kept

        // monitored count still reports real equipment, not collapsed entries
        expect(s1Rbd.monitored).toBe(3);
    });

    it('groups whose members are not both under the node pass through untouched', () => {
        const withForeign = rollupHierarchy(assets, health, [
            { memberAssetIds: ['pa', 'zz-not-here'], label: 'Elsewhere' },
        ]);
        const s1 = withForeign.find(n => n.id === 's1')!;
        expect(s1.worst?.id).toBe('pa'); // unchanged — no valid pair inside the node
    });
});
