import { describe, it, expect } from 'vitest';
import { computeRegisterQuality, type RegisterAssetRow } from './registerQuality';

const asset = (over: Partial<RegisterAssetRow> & { id: string; tag: string }): RegisterAssetRow => ({
    parent_id: null, criticality: 'C', manufacturer: null, model: null, ...over,
});

describe('computeRegisterQuality', () => {
    it('scores a defaulted flat import near zero and names the dump', () => {
        // The import wizard's signature: flat hierarchy, everything 'C', no nameplate.
        const assets = Array.from({ length: 10 }, (_, i) => asset({ id: `${i}`, tag: `P-${i}` }));
        const q = computeRegisterQuality(assets, []);
        expect(q.structuredPct).toBe(0);
        expect(q.criticalitySpreadPct).toBe(0);
        expect(q.dominantCriticality).toEqual({ value: 'C', pct: 100 });
        expect(q.nameplatePct).toBe(0);
        expect(q.healthPct).toBeLessThanOrEqual(40); // only collision-free + linkage score
    });

    it('scores a structured, ranked, nameplated register high', () => {
        const assets: RegisterAssetRow[] = [
            asset({ id: '1', tag: 'AREA-1' }), // one legitimate root
            ...Array.from({ length: 9 }, (_, i) => asset({
                id: `${i + 2}`, tag: `P-10${i}`, parent_id: '1',
                criticality: i < 3 ? 'A' : i < 6 ? 'B' : 'C',
                manufacturer: 'Flowserve', model: 'ANSI 3196',
            })),
        ];
        const q = computeRegisterQuality(assets, [{ asset_id: '2' }, { asset_id: '3' }]);
        expect(q.structuredPct).toBe(90);
        expect(q.criticalitySpreadPct).toBeGreaterThanOrEqual(60);
        expect(q.nameplatePct).toBe(90);
        expect(q.woLinkedPct).toBe(100);
        expect(q.healthPct).toBeGreaterThanOrEqual(85);
    });

    it('finds normalized tag collisions the DB unique constraint cannot', () => {
        const assets = [
            asset({ id: '1', tag: 'P-101' }),
            asset({ id: '2', tag: 'P101' }),
            asset({ id: '3', tag: 'p 101' }),
            asset({ id: '4', tag: 'K-201' }),
        ];
        const q = computeRegisterQuality(assets, []);
        expect(q.tagCollisionCount).toBe(2); // three tags, one physical asset → two extras
        expect(q.tagCollisionExamples[0]).toEqual(['P-101', 'P101', 'p 101']);
    });

    it('measures unlinked work-order history against the register', () => {
        const assets = [asset({ id: '1', tag: 'P-101' })];
        const wos = [{ asset_id: '1' }, { asset_id: 'ghost' }, { asset_id: null }, { asset_id: '1' }];
        const q = computeRegisterQuality(assets, wos);
        expect(q.woLinkedPct).toBe(50);
        expect(q.woUnlinkedCount).toBe(2);
    });

    it('returns zero health for an empty register instead of dividing by zero', () => {
        const q = computeRegisterQuality([], []);
        expect(q.healthPct).toBe(0);
        expect(q.assetCount).toBe(0);
    });
});
