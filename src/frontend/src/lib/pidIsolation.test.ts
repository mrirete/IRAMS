/**
 * Tests for pidIsolation — permit isolation points proposed from the P&ID.
 *
 * The drawing is the production "Demo — Process Unit" topology also used by
 * tests/queryPid.test.ts: P-101 → XV-201 → K-201 → {E-301, E-302} → V-401,
 * with PT-101 on an instrument line. The claims under test are the ones a
 * permit supervisor would make: the right valve, no duplicates, the branch
 * that cannot be isolated is REPORTED, and nothing is ever proposed as
 * already isolated.
 */
import { describe, it, expect } from 'vitest';
import {
    proposeIsolationFromDrawings, drawingsContainingAsset, nodeMatchesAsset, isolationTypeFor,
    type PidDrawing,
} from './pidIsolation';

const EQUIPMENT = [
    { id: 'eq1', type: 'pump', label: 'P-101', assetId: 'a-p101', assetTag: 'P-101' },
    { id: 'eq2', type: 'compressor', label: 'K-201', assetTag: 'K-201' },
    { id: 'eq3', type: 'heat_exchanger', label: 'E-301' },
    { id: 'eq4', type: 'heat_exchanger', label: 'E-302' },
    { id: 'eq5', type: 'separator', label: 'V-401' },
    { id: 'eq6', type: 'transmitter', label: 'PT-101' },
    { id: 'eq7', type: 'valve', label: 'XV-201' },
    { id: 'eq8', type: 'valve', label: 'XV-100' },
];
const CONNECTIONS = [
    { id: 'c0', fromId: 'eq8', toId: 'eq1', type: 'process' },   // XV-100 → P-101 (suction)
    { id: 'c1', fromId: 'eq1', toId: 'eq7', type: 'process' },   // P-101 → XV-201
    { id: 'c2', fromId: 'eq7', toId: 'eq2', type: 'process' },   // XV-201 → K-201
    { id: 'c3', fromId: 'eq2', toId: 'eq3', type: 'process' },
    { id: 'c4', fromId: 'eq2', toId: 'eq4', type: 'process' },
    { id: 'c5', fromId: 'eq3', toId: 'eq5', type: 'process' },
    { id: 'c6', fromId: 'eq4', toId: 'eq5', type: 'process' },
    { id: 'c7', fromId: 'eq6', toId: 'eq1', type: 'instrument' },
];
const DRAWING: PidDrawing = { id: 'pid-1', title: 'Demo — Process Unit', asset_id: null, equipment: EQUIPMENT, connections: CONNECTIONS };

describe('nodeMatchesAsset', () => {
    it('matches by register link, then drawn tag, then label — normalised', () => {
        expect(nodeMatchesAsset(EQUIPMENT[0], 'a-p101', null)).toBe(true);
        expect(nodeMatchesAsset(EQUIPMENT[1], null, 'k201')).toBe(true);      // assetTag, no dash
        expect(nodeMatchesAsset(EQUIPMENT[2], null, 'E-301')).toBe(true);     // label only
        expect(nodeMatchesAsset(EQUIPMENT[2], 'a-other', 'E-999')).toBe(false);
        expect(nodeMatchesAsset(EQUIPMENT[2], null, '')).toBe(false);
    });
});

describe('drawingsContainingAsset', () => {
    it('finds every drawing that shows the asset and ignores the rest', () => {
        const other: PidDrawing = { id: 'pid-2', title: 'Utilities', equipment: [{ id: 'u1', type: 'pump', label: 'P-900' }], connections: [] };
        const hits = drawingsContainingAsset([DRAWING, other], null, 'K-201');
        expect(hits).toHaveLength(1);
        expect(hits[0].drawing.id).toBe('pid-1');
        expect(hits[0].node.id).toBe('eq2');
    });
    it('tolerates malformed JSONB rows', () => {
        const junk: PidDrawing = { id: 'pid-3', title: 'Junk', equipment: [null, 'x', { type: 'pump' }] as unknown[], connections: 'nope' as unknown as unknown[] };
        expect(drawingsContainingAsset([junk], null, 'P-101')).toHaveLength(0);
    });
});

describe('proposeIsolationFromDrawings', () => {
    it('proposes the upstream valve for K-201 and reports nothing unisolated', () => {
        const [r] = proposeIsolationFromDrawings([DRAWING], null, 'K-201');
        expect(r.drawing.title).toBe('Demo — Process Unit');
        expect(r.node.label).toBe('K-201');
        expect(r.proposals.map((p) => p.tagNumber)).toEqual(['XV-201']);
        const p = r.proposals[0];
        expect(p.isolationType).toBe('PROCESS');
        expect(p.method).toBe('LOCK');
        expect(p.normalPosition).toBe('OPEN');
        expect(p.isolatedPosition).toBe('CLOSED');
        expect(p.pidConfigId).toBe('pid-1');
        expect(p.pidNodeId).toBe('eq7');
        expect(r.unisolatedBranches).toHaveLength(0);
    });

    it('proposes the suction valve for P-101 and does not walk past it', () => {
        const [r] = proposeIsolationFromDrawings([DRAWING], 'a-p101', 'P-101');
        expect(r.proposals.map((p) => p.tagNumber)).toEqual(['XV-100']);
    });

    it('reports a branch that leaves the sheet without a valve instead of hiding it', () => {
        // V-401 is fed by E-301 and E-302, each fed by K-201, fed by XV-201:
        // isolable. Add a second feed straight from an unvalved sheet-edge node.
        const withEdge: PidDrawing = {
            ...DRAWING,
            equipment: [...EQUIPMENT, { id: 'eq9', type: 'nozzle', label: 'FROM UNIT 2' }],
            connections: [...CONNECTIONS, { id: 'c8', fromId: 'eq9', toId: 'eq5', type: 'process' }],
        };
        const [r] = proposeIsolationFromDrawings([withEdge], null, 'V-401');
        expect(r.proposals.map((p) => p.tagNumber)).toEqual(['XV-201']);
        expect(r.unisolatedBranches.map((b) => b.label)).toContain('FROM UNIT 2');
    });

    it('returns one entry per drawing that shows the asset, deduplicating valves within each', () => {
        const dup: PidDrawing = {
            id: 'pid-4', title: 'Same pump, two lines',
            equipment: [
                { id: 'p', type: 'pump', label: 'P-101' },
                { id: 'v1', type: 'valve', label: 'XV-7' }, { id: 'v2', type: 'valve', label: 'xv7' },
            ],
            connections: [{ id: 'a', fromId: 'v1', toId: 'p', type: 'process' }, { id: 'b', fromId: 'v2', toId: 'p', type: 'process' }],
        };
        const out = proposeIsolationFromDrawings([DRAWING, dup], null, 'P-101');
        expect(out).toHaveLength(2);
        expect(out[1].proposals).toHaveLength(1);   // XV-7 and xv7 are the same tag
    });

    it('an asset on no drawing yields nothing — never a guess', () => {
        expect(proposeIsolationFromDrawings([DRAWING], null, 'P-999')).toHaveLength(0);
    });
});

describe('isolationTypeFor', () => {
    it('maps drawn component types onto the ISOLATION_TYPE dictionary', () => {
        expect(isolationTypeFor('valve')).toBe('PROCESS');
        expect(isolationTypeFor('control_valve')).toBe('PROCESS');
        expect(isolationTypeFor('breaker')).toBe('ELECTRICAL');
        expect(isolationTypeFor('mcc_bucket')).toBe('ELECTRICAL');
        expect(isolationTypeFor('')).toBe('OTHER');
    });
});
