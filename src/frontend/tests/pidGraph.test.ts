/**
 * Tests for the P&ID graph serialiser and traversal
 * (supabase/functions/agent-run/pidGraph.ts).
 *
 * Lives under tests/ rather than src/ because it exercises Edge Function code,
 * not application code. vitest picks it up (tests/**), tsc does not (tsconfig
 * includes only src) — the same arrangement migrationPlan.test.ts uses.
 *
 * The fixture is the DEXPIEX01 flowsheet from the ChatP&ID study
 * (arXiv:2603.22528, Fig. 5), reduced to the topology their reference answers
 * turn on. Using their drawing means the expected results below are the
 * paper's own published answers, not ones invented to fit the implementation.
 */
import { describe, it, expect } from 'vitest';
import {
    buildPidGraph,
    serializePidGraph,
    estimateTokens,
    walk,
    tracePath,
    findIsolationPoints,
    type PidNodeInput,
    type PidEdgeInput,
    type AssetFacts,
} from '../supabase/functions/agent-run/pidGraph.ts';

// ── Fixture ──────────────────────────────────────────────────────────────
// P4711 -> H1007 -> HV4750.01 -> T4750 -> 66KL21 -> 75SA21 -> 73KH12 -> P4712
// plus the recirculation loop T4750 <- PV4712.02 <- H1008 <- (tee off P4712)
// and a temperature instrument attached to the tank.

const eq = (id: string, type: string, label: string, extra: Partial<PidNodeInput> = {}): PidNodeInput =>
    ({ id, type, label, ...extra });

const EQUIPMENT: PidNodeInput[] = [
    eq('n1', 'pump', 'P4711', { assetTag: 'P4711', criticality: 'A' }),
    eq('n2', 'heat_exchanger', 'H1007'),
    eq('n3', 'valve', 'HV4750.01'),
    eq('n4', 'tank', 'T4750', { assetTag: 'T4750', healthIndex: 72 }),
    eq('n5', 'valve', '66KL21'),
    eq('n6', 'valve', '75SA21'),
    eq('n7', 'valve', '73KH12'),
    eq('n8', 'pump', 'P4712', { assetTag: 'P4712' }),
    eq('n9', 'heat_exchanger', 'H1008'),
    eq('n10', 'valve', 'PV4712.02'),
    eq('n11', 'transmitter', 'TICSA4750.03'),
];

const conn = (id: string, fromId: string, toId: string, type = 'process'): PidEdgeInput =>
    ({ id, fromId, toId, type });

const CONNECTIONS: PidEdgeInput[] = [
    conn('e1', 'n1', 'n2'),
    conn('e2', 'n2', 'n3'),
    conn('e3', 'n3', 'n4'),
    conn('e4', 'n4', 'n5'),
    conn('e5', 'n5', 'n6'),
    conn('e6', 'n6', 'n7'),
    conn('e7', 'n7', 'n8'),
    conn('e8', 'n8', 'n9'),      // tee to the recirculation loop
    conn('e9', 'n9', 'n10'),
    conn('e10', 'n10', 'n4'),    // back to the tank — a cycle, by design
    conn('e11', 'n11', 'n4', 'signal'),
];

const build = () => buildPidGraph(EQUIPMENT, CONNECTIONS);

// ── buildPidGraph ────────────────────────────────────────────────────────

describe('buildPidGraph', () => {
    it('indexes every node and edge', () => {
        const g = build();
        expect(g.nodes.size).toBe(11);
        expect(g.edges.size).toBe(11);
        expect(g.danglingEdgeIds).toEqual([]);
    });

    it('separates process flow from instrument attachments', () => {
        const g = build();
        const tank = g.nodes.get('n4')!;
        // Fed by HV4750.01 and by the recirculation return PV4712.02.
        expect(tank.inbound).toEqual(['e3', 'e10']);
        expect(tank.outbound).toEqual(['e4']);
        // The temperature transmitter is context, never a flow path.
        expect(tank.attached).toEqual(['e11']);
    });

    it('drops edges pointing at deleted components rather than throwing', () => {
        // The editor allows deleting a node while its connections survive in
        // JSONB, so this is a normal state of stored data.
        const g = buildPidGraph(EQUIPMENT, [...CONNECTIONS, conn('e99', 'n4', 'ghost')]);
        expect(g.danglingEdgeIds).toEqual(['e99']);
        expect(g.edges.has('e99')).toBe(false);
    });

    it('survives empty input', () => {
        const g = buildPidGraph([], []);
        expect(g.nodes.size).toBe(0);
        expect(serializePidGraph(g)).toContain('no process connections drawn');
    });
});

// ── serializePidGraph ────────────────────────────────────────────────────

describe('serializePidGraph', () => {
    it('renders components and directional flow', () => {
        const text = serializePidGraph(build(), { title: 'DEXPIEX01' });
        expect(text).toContain('P&ID: DEXPIEX01');
        expect(text).toContain('11 components, 11 connections');
        expect(text).toContain('- P4711 -> H1007');
        expect(text).toContain('- HV4750.01 -> T4750');
    });

    it('keeps instrument edges out of the process-flow section', () => {
        const text = serializePidGraph(build());
        const flow = text.slice(text.indexOf('PROCESS FLOW'), text.indexOf('INSTRUMENT'));
        expect(flow).not.toContain('TICSA4750.03');
        expect(text).toContain('- TICSA4750.03 -signal- T4750');
    });

    it('topology mode drops attributes and non-flow edges', () => {
        const g = build();
        const topo = serializePidGraph(g, { mode: 'topology' });
        expect(topo).toContain('- T4750 (tank)');
        expect(topo).not.toContain('criticality');
        expect(topo).not.toContain('INSTRUMENT');
        // Cheaper is the whole point of the mode.
        expect(topo.length).toBeLessThan(serializePidGraph(g, { mode: 'graph' }).length);
    });

    it('prefers live asset health over the value cached on the drawing', () => {
        const facts = new Map<string, AssetFacts>([
            ['T4750', {
                asset_tag: 'T4750', criticality: 'A', mtbf_days: 210,
                failure_events_12mo: 3, open_wo_count: 2, overdue_pm_count: 1,
            }],
        ]);
        const text = serializePidGraph(build(), { facts });
        expect(text).toContain('MTBF 210d');
        expect(text).toContain('3 failures/12mo');
        expect(text).toContain('1 overdue PM');
        // The stale healthIndex from the editor must not appear alongside it.
        expect(text).not.toContain('health 72%');
    });

    it('falls back to the drawing when no health row joins', () => {
        expect(serializePidGraph(build())).toContain('health 72%');
    });

    it('flags omitted dangling connections instead of hiding them', () => {
        const g = buildPidGraph(EQUIPMENT, [...CONNECTIONS, conn('e99', 'n4', 'ghost')]);
        expect(serializePidGraph(g)).toContain('1 connection(s) reference deleted components');
    });

    it('stays within a few hundred tokens for a drawing this size', () => {
        // The paper's conceptual graph cost ~7K tokens for a full page; an
        // 11-node extract should be far below that. Guards against a future
        // change quietly reintroducing verbose metadata.
        expect(estimateTokens(serializePidGraph(build()))).toBeLessThan(500);
    });
});

// ── walk ─────────────────────────────────────────────────────────────────

describe('walk', () => {
    it('finds everything upstream, nearest first', () => {
        const up = walk(build(), 'n4', 'up');
        const labels = up.map((n) => n.label);
        expect(labels).toContain('HV4750.01');
        expect(labels).toContain('H1007');
        expect(labels).toContain('P4711');
        // Immediate feeds come before the equipment behind them.
        expect(up.find((n) => n.label === 'HV4750.01')!.depth).toBe(1);
        expect(up.find((n) => n.label === 'P4711')!.depth).toBe(3);
    });

    it('terminates on a recirculation loop', () => {
        // T4750 -> ... -> P4712 -> H1008 -> PV4712.02 -> T4750 is a cycle.
        const down = walk(build(), 'n4', 'down');
        expect(down.map((n) => n.id)).not.toContain('n4');
        expect(down.length).toBeLessThan(EQUIPMENT.length);
    });

    it('respects maxDepth', () => {
        expect(walk(build(), 'n4', 'up', 1).map((n) => n.label)).toEqual(['HV4750.01', 'PV4712.02']);
    });

    it('returns nothing for an unknown node', () => {
        expect(walk(build(), 'nope', 'up')).toEqual([]);
    });
});

// ── tracePath ────────────────────────────────────────────────────────────

describe('tracePath', () => {
    it('reproduces the study\'s reference answer for T4750 -> P4712', () => {
        // App. Table 1: "T4750 -> 66KL21 -> 75SA21 -> 73KH12 -> P4712"
        const path = tracePath(build(), 'n4', 'n8');
        expect(path?.map((n) => n.label)).toEqual(['T4750', '66KL21', '75SA21', '73KH12', 'P4712']);
    });

    it('reproduces the reference answer for P4711 -> T4750', () => {
        // App. Table 1: "P4711 -> H1007 -> HV4750.01 -> T4750"
        const path = tracePath(build(), 'n1', 'n4');
        expect(path?.map((n) => n.label)).toEqual(['P4711', 'H1007', 'HV4750.01', 'T4750']);
    });

    it('follows flow direction — the reverse route does not exist', () => {
        expect(tracePath(build(), 'n4', 'n1')).toBeNull();
    });

    it('returns the node itself for a zero-length trace', () => {
        expect(tracePath(build(), 'n4', 'n4')?.map((n) => n.label)).toEqual(['T4750']);
    });

    it('returns null for unknown endpoints', () => {
        expect(tracePath(build(), 'n1', 'ghost')).toBeNull();
    });
});

// ── findIsolationPoints ──────────────────────────────────────────────────

describe('findIsolationPoints', () => {
    it('reproduces the study\'s isolation answer for T4750', () => {
        // App. Table 1: "Shut the main feed globe valve (HV4750.01). Close the
        // DN50 globe valve on the recirculation line (PV4712.02)."
        const { valves } = findIsolationPoints(build(), 'n4');
        expect(valves.map((v) => v.label).sort()).toEqual(['HV4750.01', 'PV4712.02']);
    });

    it('stops at the first valve on a branch, not the furthest', () => {
        // Closing something upstream of HV4750.01 would strand H1007 and P4711
        // inside the isolation boundary.
        const { valves } = findIsolationPoints(build(), 'n4');
        expect(valves.map((v) => v.label)).not.toContain('66KL21');
        expect(valves.length).toBe(2);
    });

    it('reports an inlet that no valve can isolate', () => {
        // Feed the tank directly from a pump with no valve between.
        const g = buildPidGraph(
            [...EQUIPMENT, eq('n12', 'pump', 'P9999')],
            [...CONNECTIONS, conn('e12', 'n12', 'n4')],
        );
        const { valves, unisolatedBranches } = findIsolationPoints(g, 'n4');
        expect(valves.map((v) => v.label).sort()).toEqual(['HV4750.01', 'PV4712.02']);
        // Silently returning only the two valves would be the dangerous answer.
        expect(unisolatedBranches.map((b) => b.label)).toContain('P9999');
    });

    it('returns empty for an unknown node', () => {
        expect(findIsolationPoints(build(), 'ghost').valves).toEqual([]);
    });
});
