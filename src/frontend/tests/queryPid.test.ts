/**
 * Tests for the query_pid tool's database path
 * (supabase/functions/agent-run/tools.ts).
 *
 * pidGraph.test.ts covers the traversal engine in isolation. This file covers
 * the half that talks to Supabase — drawing lookup, disambiguation between
 * several drawings, the sem_asset_health join, and what the tool says when the
 * data is thin. That path had never executed before these tests: the engine
 * being correct says nothing about the tool asking the right questions.
 *
 * The fixture is the real row from ers_pid_configurations in the production
 * project (read 2026-07-27), not an invented one — same ids, same topology,
 * same missing asset tags. A drawing whose components carry no assetTag is the
 * actual state of the only P&ID that exists, so the "nothing is linked" path
 * below is the first thing a real user will hit, not an edge case.
 *
 * The fake Supabase client implements only the chain query_pid uses:
 *   .from(t).select(c)[.ilike(col, pat)].limit(n)
 *   .from(t).select(c).in(col, values)
 * Anything else is deliberately absent so a future change to the query shows up
 * here as a failure rather than passing against a mock that accepts everything.
 */
import { describe, it, expect } from 'vitest';
import { TOOLS } from '../supabase/functions/agent-run/tools.ts';
import type { ToolContext, ToolResult } from '../supabase/functions/agent-run/types.ts';

const queryPid = TOOLS['query_pid'];

// ── The production row ───────────────────────────────────────────────────
// P-101 -> XV-201 -> K-201 -> {E-301, E-302} -> V-401, plus PT-101 attached to
// P-101 by an instrument line (never a flow path).

const DEMO_EQUIPMENT = [
    { x: 120, y: 250, id: 'eq1', type: 'pump', label: 'P-101', woCount: 8, criticality: 'A' },
    { x: 300, y: 250, id: 'eq2', type: 'compressor', label: 'K-201', woCount: 12, criticality: 'A' },
    { x: 480, y: 180, id: 'eq3', type: 'heat_exchanger', label: 'E-301', woCount: 3, criticality: 'B' },
    { x: 480, y: 320, id: 'eq4', type: 'heat_exchanger', label: 'E-302', woCount: 2, criticality: 'B' },
    { x: 660, y: 250, id: 'eq5', type: 'separator', label: 'V-401', woCount: 1, criticality: 'B' },
    { x: 120, y: 150, id: 'eq6', type: 'transmitter', label: 'PT-101', criticality: 'C' },
    { x: 210, y: 250, id: 'eq7', type: 'valve', label: 'XV-201', woCount: 5, criticality: 'B' },
];

const DEMO_CONNECTIONS = [
    { id: 'c1', fromId: 'eq1', toId: 'eq7', type: 'process' },
    { id: 'c2', fromId: 'eq7', toId: 'eq2', type: 'process' },
    { id: 'c3', fromId: 'eq2', toId: 'eq3', type: 'process' },
    { id: 'c4', fromId: 'eq2', toId: 'eq4', type: 'process' },
    { id: 'c5', fromId: 'eq3', toId: 'eq5', type: 'process' },
    { id: 'c6', fromId: 'eq4', toId: 'eq5', type: 'process' },
    { id: 'c7', fromId: 'eq6', toId: 'eq1', type: 'instrument' },
];

const DEMO_ROW = {
    id: 'pid-demo-1',
    title: 'Demo — Process Unit',
    asset_id: null,
    equipment: DEMO_EQUIPMENT,
    connections: DEMO_CONNECTIONS,
    updated_at: '2026-05-20T00:00:00Z',
};

/** The same drawing with its components linked to real register tags. */
const TAGGED_ROW = {
    ...DEMO_ROW,
    id: 'pid-tagged-1',
    title: 'Gas Compression Train',
    equipment: DEMO_EQUIPMENT.map((e) => {
        const tags: Record<string, string> = { eq1: 'P-101-A', eq2: 'K-601', eq3: 'E-605', eq5: 'V-602' };
        return tags[e.id] ? { ...e, assetTag: tags[e.id] } : e;
    }),
};

const HEALTH_ROWS = [
    { asset_tag: 'K-601', criticality: 'A', mtbf_days: 210, open_wo_count: 3, failure_events_12mo: 2, overdue_pm_count: 1 },
    { asset_tag: 'P-101-A', criticality: 'A', mtbf_days: 430, open_wo_count: 0, failure_events_12mo: 1, overdue_pm_count: 0 },
    { asset_tag: 'E-605', criticality: 'B', mtbf_days: 900, open_wo_count: 1, failure_events_12mo: 0, overdue_pm_count: 0 },
    // V-602 deliberately absent: a tagged component with no health row must not
    // invent one.
];

// ── Fake Supabase client ─────────────────────────────────────────────────

interface FakeOpts {
    /** Force a query error on this table, to prove the tool surfaces it. */
    errorOn?: string;
}

function fakeDb(tables: Record<string, unknown[]>, opts: FakeOpts = {}) {
    const calls: { table: string; op: string; args: unknown[] }[] = [];

    const client = {
        calls,
        from(table: string) {
            let rows = [...(tables[table] ?? [])] as Record<string, unknown>[];
            const fail = opts.errorOn === table;
            const result = () =>
                fail
                    ? { data: null, error: { message: `boom on ${table}` } }
                    : { data: rows, error: null };

            const builder: Record<string, unknown> = {
                select(cols: string) {
                    calls.push({ table, op: 'select', args: [cols] });
                    return builder;
                },
                ilike(col: string, pattern: string) {
                    calls.push({ table, op: 'ilike', args: [col, pattern] });
                    const needle = pattern.replace(/%/g, '').toLowerCase();
                    rows = rows.filter((r) => String(r[col] ?? '').toLowerCase().includes(needle));
                    return builder;
                },
                in(col: string, values: unknown[]) {
                    calls.push({ table, op: 'in', args: [col, values] });
                    rows = rows.filter((r) => values.includes(r[col]));
                    return builder;
                },
                limit(n: number) {
                    calls.push({ table, op: 'limit', args: [n] });
                    const r = result();
                    return Promise.resolve(r.data ? { ...r, data: r.data.slice(0, n) } : r);
                },
                // Chains that are awaited without a terminal .limit().
                then(resolve: (v: unknown) => unknown) {
                    return Promise.resolve(result()).then(resolve);
                },
            };
            return builder;
        },
    };
    return client;
}

function ctxWith(tables: Record<string, unknown[]>, opts: FakeOpts = {}) {
    const db = fakeDb(tables, opts);
    const ctx: ToolContext = { db, proposals: [], sources: [] };
    return { ctx, db };
}

const run = (args: Record<string, unknown>, tables: Record<string, unknown[]>, opts: FakeOpts = {}) => {
    const { ctx, db } = ctxWith(tables, opts);
    return queryPid.run(args, ctx).then((res: ToolResult) => ({ res, ctx, db }));
};

const ONE_DRAWING = { ers_pid_configurations: [DEMO_ROW], sem_asset_health: HEALTH_ROWS };

// ── Finding the drawing ──────────────────────────────────────────────────

describe('query_pid — locating a drawing', () => {
    it('reads the P&ID table with the columns it needs', async () => {
        const { db } = await run({ operation: 'overview' }, ONE_DRAWING);
        const select = db.calls.find((c) => c.table === 'ers_pid_configurations' && c.op === 'select');
        expect(select).toBeDefined();
        for (const col of ['id', 'title', 'equipment', 'connections']) {
            expect(String(select!.args[0])).toContain(col);
        }
    });

    it('says no drawings exist rather than returning an empty graph', async () => {
        const { res } = await run({ operation: 'overview' }, { ers_pid_configurations: [] });
        expect((res.data as { found: boolean }).found).toBe(false);
        expect(res.warnings?.[0]).toContain('No P&IDs have been drawn yet');
    });

    it('reports the title that matched nothing, so the user can correct it', async () => {
        const { res } = await run({ operation: 'overview', pid_title: 'Crude Unit' }, ONE_DRAWING);
        expect((res.data as { found: boolean }).found).toBe(false);
        expect(res.warnings?.[0]).toContain('Crude Unit');
    });

    it('asks which drawing when several exist and none was named', async () => {
        const { res } = await run({ operation: 'overview' }, {
            ers_pid_configurations: [DEMO_ROW, TAGGED_ROW],
        });
        const data = res.data as { needs_selection: boolean; drawings: string[] };
        expect(data.needs_selection).toBe(true);
        expect(data.drawings).toEqual(['Demo — Process Unit', 'Gas Compression Train']);
    });

    it('matches a named drawing case-insensitively on a substring', async () => {
        const { res } = await run({ operation: 'overview', pid_title: 'compression' }, {
            ers_pid_configurations: [DEMO_ROW, TAGGED_ROW],
            sem_asset_health: HEALTH_ROWS,
        });
        expect((res.data as { pid: string }).pid).toBe('Gas Compression Train');
    });

    it('surfaces a database error instead of reporting an empty drawing', async () => {
        await expect(
            run({ operation: 'overview' }, ONE_DRAWING, { errorOn: 'ers_pid_configurations' }),
        ).rejects.toThrow(/ers_pid_configurations query failed/);
    });
});

// ── Overview + the health join ───────────────────────────────────────────

describe('query_pid — overview', () => {
    it('serialises the stored drawing with its real component and edge counts', async () => {
        const { res } = await run({ operation: 'overview' }, ONE_DRAWING);
        const data = res.data as { component_count: number; connection_count: number; graph: string };
        expect(data.component_count).toBe(7);
        expect(data.connection_count).toBe(7);
        expect(data.graph).toContain('P-101 -> XV-201');
        expect(data.graph).toContain('XV-201 -> K-201');
        expect(data.graph).toContain('PT-101 -instrument- P-101');
    });

    it('warns that nothing is linked to the register when no component is tagged', async () => {
        const { res } = await run({ operation: 'overview' }, ONE_DRAWING);
        expect((res.data as { assets_linked: number }).assets_linked).toBe(0);
        expect(res.warnings?.join(' ')).toMatch(/No component on this drawing is linked to the asset register/i);
        expect(res.warnings?.join(' ')).toMatch(/Link them in the P&ID editor/i);
    });

    it('does not query health at all when there is nothing to join on', async () => {
        const { db } = await run({ operation: 'overview' }, ONE_DRAWING);
        expect(db.calls.some((c) => c.table === 'sem_asset_health')).toBe(false);
    });

    it('joins live health for tagged components, querying exactly their tags', async () => {
        const { res, db } = await run({ operation: 'overview', pid_title: 'Gas' }, {
            ers_pid_configurations: [TAGGED_ROW],
            sem_asset_health: HEALTH_ROWS,
        });
        const inCall = db.calls.find((c) => c.table === 'sem_asset_health' && c.op === 'in');
        expect(inCall!.args[0]).toBe('asset_tag');
        expect(inCall!.args[1]).toEqual(['P-101-A', 'K-601', 'E-605', 'V-602']);

        const data = res.data as { assets_linked: number; graph: string };
        expect(data.assets_linked).toBe(3); // V-602 has no health row
        expect(data.graph).toContain('MTBF 210d');
        expect(data.graph).toContain('3 open WO');
        expect(res.warnings).toBeUndefined();
    });

    it('cites the drawing, and each asset whose health it used', async () => {
        const { res, ctx } = await run({ operation: 'overview', pid_title: 'Gas' }, {
            ers_pid_configurations: [TAGGED_ROW],
            sem_asset_health: HEALTH_ROWS,
        });
        expect(res.sources.some((s) => s.kind === 'pid')).toBe(true);
        expect(ctx.sources.filter((s) => s.kind === 'assets').map((s) => s.ref).sort())
            .toEqual(['E-605', 'K-601', 'P-101-A']);
    });

    it('topology mode costs fewer tokens than graph mode', async () => {
        const { res: graph } = await run({ operation: 'overview', detail: 'graph' }, ONE_DRAWING);
        const { res: topo } = await run({ operation: 'overview', detail: 'topology' }, ONE_DRAWING);
        expect((topo.data as { approx_tokens: number }).approx_tokens)
            .toBeLessThan((graph.data as { approx_tokens: number }).approx_tokens);
    });
});

// ── Traversal through the tool ───────────────────────────────────────────

describe('query_pid — traversal on the stored drawing', () => {
    it('traces the flow path from the pump to the separator', async () => {
        const { res } = await run({ operation: 'trace', from: 'P-101', to: 'V-401' }, ONE_DRAWING);
        const data = res.data as { connected: boolean; path: string[] };
        expect(data.connected).toBe(true);
        expect(data.path[0]).toContain('P-101');
        expect(data.path[data.path.length - 1]).toContain('V-401');
        expect(data.path.join(' ')).toContain('XV-201');
    });

    it('will not route through an instrument line', async () => {
        // PT-101 is wired to P-101, but signal wire carries no fluid.
        const { res } = await run({ operation: 'trace', from: 'PT-101', to: 'V-401' }, ONE_DRAWING);
        expect((res.data as { connected: boolean }).connected).toBe(false);
        expect(res.warnings?.join(' ')).toMatch(/No process path/);
    });

    it('lists everything upstream of the separator, instruments excluded', async () => {
        const { res } = await run({ operation: 'upstream', component: 'V-401' }, ONE_DRAWING);
        const labels = (res.data as { components: { label: string }[] }).components.map((c) => c.label);
        expect(labels.sort()).toEqual(['E-301', 'E-302', 'K-201', 'P-101', 'XV-201']);
        expect(labels).not.toContain('PT-101');
    });

    it('names the valve that isolates the compressor, and who governs', async () => {
        const { res } = await run({ operation: 'isolate', component: 'K-201' }, ONE_DRAWING);
        const data = res.data as { close_valves: string[]; unisolated_inlets: string[] };
        expect(data.close_valves).toEqual(['XV-201']);
        expect(data.unisolated_inlets).toEqual([]);
        expect(res.warnings?.join(' ')).toMatch(/isolation procedure and a physical walk-down govern/i);
    });

    it('admits when no valve protects a component', async () => {
        const { res } = await run({ operation: 'isolate', component: 'P-101' }, ONE_DRAWING);
        expect((res.data as { close_valves: string[] }).close_valves).toEqual([]);
        expect(res.warnings?.join(' ')).toMatch(/No isolating valve is drawn upstream of P-101/);
    });

    it('resolves a component by its asset tag, not just its drawn label', async () => {
        const { res } = await run({ operation: 'upstream', component: 'K-601', pid_title: 'Gas' }, {
            ers_pid_configurations: [TAGGED_ROW],
            sem_asset_health: HEALTH_ROWS,
        });
        expect((res.data as { component: string }).component).toBe('K-201');
    });

    it('lists what is on the drawing when asked about something that is not', async () => {
        const { res } = await run({ operation: 'upstream', component: 'P-999' }, ONE_DRAWING);
        expect((res.data as { found: boolean }).found).toBe(false);
        expect(res.warnings?.[0]).toContain('P-999');
        expect(res.warnings?.[0]).toContain('K-201');
    });

    it('tolerates a connection left behind by a deleted component', async () => {
        // Normal editor state: delete a node, its connections survive in JSONB.
        const orphaned = {
            ...DEMO_ROW,
            equipment: DEMO_EQUIPMENT.filter((e) => e.id !== 'eq4'),
        };
        const { res } = await run({ operation: 'overview' }, { ers_pid_configurations: [orphaned] });
        const data = res.data as { component_count: number; graph: string };
        expect(data.component_count).toBe(6);
        expect(data.graph).toContain('reference deleted components');
        expect(data.graph).not.toContain('E-302');
    });
});
