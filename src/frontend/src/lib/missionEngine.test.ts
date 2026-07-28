import { describe, it, expect } from 'vitest';
import { computeMissions, type MissionInputs } from './missionEngine';

const INP: MissionInputs = {
    overduePmCount: 2,
    overduePmTags: ['P-101-A'],
    topOpenAssets: [{ tag: 'GT-301', open: 3 }, { tag: 'K-601', open: 0 }],
    pendingProposals: 1,
};

describe('computeMissions', () => {
    it('creates missions with live counts and snapshots the baseline on first compute', () => {
        const { missions, baseline } = computeMissions(INP, null);
        expect(missions.map((m) => m.id)).toEqual(['overdue-pm', 'open-wo:GT-301', 'proposals']);
        expect(missions[0].text).toContain('2 overdue PM programmes');
        expect(missions[0].text).toContain('P-101-A');
        expect(baseline).toEqual({ 'overdue-pm': 2, 'open-wo:GT-301': 3, 'open-wo:K-601': 0, proposals: 1 });
        expect(missions.every((m) => !m.done)).toBe(true);
    });

    it('auto-completes a mission when the underlying work is actually done', () => {
        const first = computeMissions(INP, null);
        // PMs cleared + proposals decided since the baseline was taken:
        const later = computeMissions(
            { ...INP, overduePmCount: 0, pendingProposals: 0 },
            first.baseline,
        );
        const overdue = later.missions.find((m) => m.id === 'overdue-pm')!;
        expect(overdue.done).toBe(true);
        expect(overdue.text).toContain('cleared');
        expect(overdue.text).toContain('2 at the start');
        expect(later.missions.find((m) => m.id === 'proposals')!.done).toBe(true);
        expect(later.missions.find((m) => m.id === 'open-wo:GT-301')!.done).toBe(false);
    });

    it('never invents a mission where the baseline had no work to do', () => {
        const clean = computeMissions(
            { overduePmCount: 0, overduePmTags: [], topOpenAssets: [{ tag: 'K-601', open: 0 }], pendingProposals: 0 },
            null,
        );
        expect(clean.missions).toHaveLength(0);
    });

    it('keeps a completed mission completed even if the baseline said more', () => {
        // WOs closed one by one: 3 → 1 → 0 across loads, same baseline throughout.
        const b = computeMissions(INP, null).baseline;
        const mid = computeMissions({ ...INP, topOpenAssets: [{ tag: 'GT-301', open: 1 }, { tag: 'K-601', open: 0 }] }, b);
        expect(mid.missions.find((m) => m.id === 'open-wo:GT-301')!.current).toBe(1);
        const end = computeMissions({ ...INP, topOpenAssets: [{ tag: 'GT-301', open: 0 }, { tag: 'K-601', open: 0 }] }, b);
        expect(end.missions.find((m) => m.id === 'open-wo:GT-301')!.done).toBe(true);
    });
});
