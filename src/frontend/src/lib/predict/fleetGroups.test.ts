import { describe, it, expect } from 'vitest';
import { groupFleet, groupMatches, matchingParts } from './fleetGroups';
import type { FleetAssetHealth } from '../../types/intelligence';

const row = (p: Partial<FleetAssetHealth> & { asset_id: string }): FleetAssetHealth => ({
    asset_name: p.asset_id, unit: 'Compression Train A', criticality: 'A', health_index: 90, rul_days: 200, active_alerts: 0, level: 'equipment', ...p,
});
const fleet = [
    row({ asset_id: 'k601', tag: 'K-601', asset_name: 'K-601 — Gas Compressor', health_index: 88 }),
    row({ asset_id: 'k601-dgs', tag: 'K-601-DGS', asset_name: 'K-601-DGS — Dry Gas Seal', health_index: 85, level: 'component', parent_id: 'k601' }),
    row({ asset_id: 'k601-rad', tag: 'K-601-RADBRG', asset_name: 'K-601-RADBRG — Radial Bearing', health_index: 87, level: 'component', parent_id: 'k601' }),
    row({ asset_id: 'p101', tag: 'P-101-A', asset_name: 'P-101-A — Primary Feed Pump A', health_index: 86 }),
    row({ asset_id: 'x-brg', tag: 'X-9-BRG', asset_name: 'X-9-BRG — Bearing', health_index: 60, level: 'component', parent_id: 'x9-not-monitored' }),
];

describe('groupFleet', () => {
    it('machines are cards; their parts fold under them, weakest first', () => {
        const g = groupFleet(fleet);
        expect(g.map(x => x.head.tag)).toEqual(['K-601', 'P-101-A', 'X-9-BRG']);
        expect(g[0].parts.map(p => p.tag)).toEqual(['K-601-DGS', 'K-601-RADBRG']);
        expect(g[0].weakestPart?.tag).toBe('K-601-DGS');   // 85 < the machine's 88
        expect(g[1].parts).toEqual([]);
    });

    it('a part with no monitored machine stands on its own, labelled as a part', () => {
        const g = groupFleet(fleet);
        expect(g[2].orphanPart).toBe(true);
        expect(g[2].parts).toEqual([]);
    });

    it('no weakest part when every part is at least as healthy as the machine', () => {
        const g = groupFleet([fleet[0], { ...fleet[1], health_index: 95 }]);
        expect(g[0].weakestPart).toBeNull();
    });

    it('search reaches the parts: "dgs" finds K-601 and expands the seal', () => {
        const g = groupFleet(fleet);
        expect(groupMatches(g[0], 'dgs')).toBe(true);
        expect(groupMatches(g[1], 'dgs')).toBe(false);
        expect(matchingParts(g[0], 'dgs').map(p => p.tag)).toEqual(['K-601-DGS']);
        expect(matchingParts(g[0], '')).toEqual([]);
    });
});
