/**
 * bulkImportService — the rules a CMMS migration depends on.
 *
 * Supabase is mocked at the client boundary so these exercise the ordering and
 * validation logic (topological sort, cycle detection, level legality,
 * per-level criticality, company inheritance) without a database.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Supabase mock ────────────────────────────────────────────────────────────
interface TableState {
    rows: Record<string, unknown>[];
    insertError?: { message: string; code?: string } | null;
}
const db: Record<string, TableState> = {};
const inserted: Record<string, Record<string, unknown>[]> = {};
const updates: Record<string, Record<string, unknown>[]> = {};

const resetDb = () => {
    for (const k of Object.keys(db)) delete db[k];
    for (const k of Object.keys(inserted)) delete inserted[k];
    for (const k of Object.keys(updates)) delete updates[k];
    db.assets = { rows: [] };
    db.cost_centers = { rows: [] };
    db.import_batches = { rows: [], insertError: { message: 'permission denied' } };
    db.reading_definitions = { rows: [] };
    db.reading_logs = { rows: [] };
};

let idSeq = 0;
const nextId = () => `id-${++idSeq}`;

function makeQuery(table: string) {
    const state = () => (db[table] ??= { rows: [] });
    let pendingInsert: Record<string, unknown>[] | null = null;
    let pendingUpdate: Record<string, unknown> | null = null;
    let eqFilter: { col: string; val: unknown } | null = null;

    const applyUpdate = () => {
        const target = state().rows.find(r => !eqFilter || r[eqFilter.col] === eqFilter.val);
        if (target) {
            Object.assign(target, pendingUpdate);
            (updates[table] ??= []).push({ ...pendingUpdate, __id: target.id });
        }
        pendingUpdate = null;
        return { data: null, error: null };
    };

    const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: unknown) => { eqFilter = { col, val }; return builder; },
        order: () => builder,
        // Records the patch and applies it on await, so sync-mode updates are
        // observable. The old no-op stub returned the builder and resolved to
        // `{ error: null }`, which made every update look like it worked.
        update: (patch: Record<string, unknown>) => {
            pendingUpdate = patch;
            return builder;
        },
        // `.in('tag', [...])` — the only filter the service uses for lookups.
        in: (col: string, vals: unknown[]) => {
            const hits = state().rows.filter(r => vals.includes(r[col]));
            return Promise.resolve({ data: hits, error: null });
        },
        insert: (payload: Record<string, unknown> | Record<string, unknown>[]) => {
            pendingInsert = Array.isArray(payload) ? payload : [payload];
            return builder;
        },
        single: () => {
            const err = state().insertError;
            if (err) return Promise.resolve({ data: null, error: err });
            const row = { id: nextId(), ...(pendingInsert?.[0] ?? {}) };
            state().rows.push(row);
            (inserted[table] ??= []).push(row);
            return Promise.resolve({ data: row, error: null });
        },
        then: (resolve: (v: unknown) => unknown) => {
            // Awaiting the builder directly = an update, an insert, or an
            // unfiltered select — in that order of precedence.
            if (pendingUpdate) return resolve(applyUpdate());
            if (!pendingInsert) return resolve({ data: state().rows, error: null });
            const err = state().insertError;
            if (err) return resolve({ data: null, error: err });
            const rows = pendingInsert.map(r => ({ id: nextId(), ...r }));
            rows.forEach(r => { state().rows.push(r); (inserted[table] ??= []).push(r); });
            return resolve({ data: rows, error: null });
        },
    };
    return builder;
}

/** RPC calls the service makes, so the identity-map seeding is observable. */
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
let rpcError: { message: string } | null = null;

vi.mock('../lib/supabase', () => ({
    supabase: {
        from: (table: string) => makeQuery(table),
        auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
        rpc: (fn: string, args: Record<string, unknown>) => {
            rpcCalls.push({ fn, args });
            if (rpcError) return Promise.resolve({ data: null, error: rpcError });
            // The real function returns how many mappings it wrote.
            const pairs = (args?.p_pairs as unknown[]) ?? [];
            return Promise.resolve({ data: pairs.length, error: null });
        },
    },
}));

const { importAssets } = await import('./bulkImportService');

// ── Helpers ──────────────────────────────────────────────────────────────────
type Row = Record<string, string>;
const row = (r: Partial<Row> & { tag: string }): Row => ({
    name: r.tag, hierarchylevel: '', assettype: '', parenttag: '',
    criticality: '', status: '', equipmentnumber: '', serialnumber: '',
    manufacturer: '', model: '', costcenter: '', department: '', location: '',
    description: '', ...r,
} as Row);

const assetRows = () => inserted.assets ?? [];
const byTag = (tag: string) => assetRows().find(a => a.tag === tag);
const outcomeFor = (res: { outcomes: { key?: string; status: string; reason?: string }[] }, key: string) =>
    res.outcomes.find(o => o.key === key);

beforeEach(() => { resetDb(); idSeq = 0; rpcCalls.length = 0; rpcError = null; });

// ── Tests ────────────────────────────────────────────────────────────────────

describe('level resolution', () => {
    it('uses hierarchyLevel over assetType, so a PUMP at SYSTEM level stays a SYSTEM', async () => {
        const res = await importAssets([row({ tag: 'S1', hierarchylevel: 'SYSTEM', assettype: 'PUMP' })]);
        expect(res.inserted).toBe(1);
        expect(byTag('S1')?.hierarchy_level).toBe('SYSTEM');
        // assetType survives as the equipment kind, not the level.
        expect(byTag('S1')?.asset_type_code).toBe('PUMP');
    });

    it('falls back to assetType when it names a level', async () => {
        const res = await importAssets([row({ tag: 'ST1', assettype: 'SITE' })]);
        expect(res.inserted).toBe(1);
        expect(byTag('ST1')?.hierarchy_level).toBe('SITE');
    });

    it('fails the row when neither names a known level — no silent EQUIPMENT collapse', async () => {
        const res = await importAssets([row({ tag: 'X1', assettype: 'WIDGET' })]);
        expect(res.inserted).toBe(0);
        expect(res.failed).toBe(1);
        expect(outcomeFor(res, 'X1')?.reason).toMatch(/Unknown hierarchy level/);
    });

    it('preserves AREA, SUBSYSTEM and COMPONENT (unreachable under the old fallback)', async () => {
        const res = await importAssets([
            row({ tag: 'A1', hierarchylevel: 'AREA' }),
            row({ tag: 'SS1', hierarchylevel: 'SUBSYSTEM', criticality: 'B' }),
            row({ tag: 'C1', hierarchylevel: 'COMPONENT', criticality: 'C' }),
        ]);
        expect(res.inserted).toBe(3);
        expect(byTag('A1')?.hierarchy_level).toBe('AREA');
        expect(byTag('SS1')?.hierarchy_level).toBe('SUBSYSTEM');
        expect(byTag('C1')?.hierarchy_level).toBe('COMPONENT');
    });
});

describe('parent ordering', () => {
    it('links a child that appears ABOVE its parent in the file', async () => {
        // Fully reversed SITE → UNIT → SYSTEM → EQUIPMENT chain.
        const res = await importAssets([
            row({ tag: 'GT-1', hierarchylevel: 'EQUIPMENT', criticality: 'A', parenttag: 'SYS-1' }),
            row({ tag: 'SYS-1', hierarchylevel: 'SYSTEM', parenttag: 'U-1' }),
            row({ tag: 'U-1', hierarchylevel: 'UNIT', parenttag: 'SITE-1' }),
            row({ tag: 'SITE-1', hierarchylevel: 'SITE' }),
        ]);
        expect(res.inserted).toBe(4);
        expect(byTag('SITE-1')?.parent_id).toBeNull();
        expect(byTag('U-1')?.parent_id).toBe(byTag('SITE-1')?.id);
        expect(byTag('SYS-1')?.parent_id).toBe(byTag('U-1')?.id);
        expect(byTag('GT-1')?.parent_id).toBe(byTag('SYS-1')?.id);
    });

    it('resolves a parent that already exists in the database', async () => {
        db.assets.rows.push({ id: 'existing-1', tag: 'SYS-DB', hierarchy_level: 'SYSTEM', company_id: null });
        const res = await importAssets([
            row({ tag: 'GT-2', hierarchylevel: 'EQUIPMENT', criticality: 'A', parenttag: 'SYS-DB' }),
        ]);
        expect(res.inserted).toBe(1);
        expect(byTag('GT-2')?.parent_id).toBe('existing-1');
    });

    it('fails rows whose parent exists nowhere rather than orphaning them at root', async () => {
        const res = await importAssets([
            row({ tag: 'GT-3', hierarchylevel: 'EQUIPMENT', criticality: 'A', parenttag: 'NOPE' }),
        ]);
        expect(res.failed).toBe(1);
        expect(outcomeFor(res, 'GT-3')?.reason).toMatch(/not found/);
    });

    it('detects circular parent references', async () => {
        const res = await importAssets([
            row({ tag: 'A', hierarchylevel: 'SYSTEM', parenttag: 'B' }),
            row({ tag: 'B', hierarchylevel: 'SYSTEM', parenttag: 'A' }),
        ]);
        expect(res.inserted).toBe(0);
        expect(res.failed).toBe(2);
        expect(outcomeFor(res, 'A')?.reason).toMatch(/Circular/);
    });
});

describe('integrity rules', () => {
    it('rejects a child level that is not allowed under its parent', async () => {
        // SITE allows AREA/UNIT — never EQUIPMENT directly.
        const res = await importAssets([
            row({ tag: 'SITE-2', hierarchylevel: 'SITE' }),
            row({ tag: 'GT-4', hierarchylevel: 'EQUIPMENT', criticality: 'A', parenttag: 'SITE-2' }),
        ]);
        expect(res.inserted).toBe(1);
        expect(outcomeFor(res, 'GT-4')?.reason).toMatch(/cannot sit under SITE/);
    });

    it('requires criticality where the level says mandatory — no blanket C default', async () => {
        const res = await importAssets([row({ tag: 'GT-5', hierarchylevel: 'EQUIPMENT' })]);
        expect(res.failed).toBe(1);
        expect(outcomeFor(res, 'GT-5')?.reason).toMatch(/Criticality is required/);
    });

    it('leaves criticality null where the level says optional', async () => {
        const res = await importAssets([row({ tag: 'SITE-3', hierarchylevel: 'SITE' })]);
        expect(res.inserted).toBe(1);
        expect(byTag('SITE-3')?.criticality).toBeNull();
    });

    it('flags duplicate tags within the file (assets.tag is globally unique)', async () => {
        const res = await importAssets([
            row({ tag: 'DUP', hierarchylevel: 'SITE' }),
            row({ tag: 'DUP', hierarchylevel: 'SITE' }),
        ]);
        expect(res.inserted).toBe(1);
        expect(res.failed).toBe(1);
    });

    it('skips tags that already exist instead of failing — re-runs are idempotent', async () => {
        db.assets.rows.push({ id: 'existing-2', tag: 'SITE-4', hierarchy_level: 'SITE', company_id: null });
        const res = await importAssets([row({ tag: 'SITE-4', hierarchylevel: 'SITE' })]);
        expect(res.inserted).toBe(0);
        expect(res.skipped).toBe(1);
        expect(outcomeFor(res, 'SITE-4')?.reason).toMatch(/already exists/);
    });
});

describe('field carry-through', () => {
    it('persists the fields the old path dropped', async () => {
        const res = await importAssets([row({
            tag: 'GT-6', hierarchylevel: 'EQUIPMENT', assettype: 'COMPRESSOR', criticality: 'A',
            equipmentnumber: 'EQ-SAP-50291', serialnumber: 'SN-1', manufacturer: 'GE', model: 'LM2500',
            department: 'Mechanical', location: 'Bay 1', description: 'Frame 5',
        })]);
        expect(res.inserted).toBe(1);
        const a = byTag('GT-6')!;
        expect(a.equipment_number).toBe('EQ-SAP-50291');
        expect(a.serial_number).toBe('SN-1');
        expect(a.model).toBe('LM2500');
        expect(a.properties).toMatchObject({ department: 'Mechanical', location: 'Bay 1', description: 'Frame 5' });
    });

    it('does not stuff assetType into a blank model', async () => {
        await importAssets([row({ tag: 'GT-7', hierarchylevel: 'EQUIPMENT', assettype: 'PUMP', criticality: 'B' })]);
        expect(byTag('GT-7')?.model).toBeNull();
    });

    it('inherits company_id from the resolved parent', async () => {
        db.assets.rows.push({ id: 'p-1', tag: 'SYS-CO', hierarchy_level: 'SYSTEM', company_id: 'co-9' });
        await importAssets([row({ tag: 'GT-8', hierarchylevel: 'EQUIPMENT', criticality: 'A', parenttag: 'SYS-CO' })]);
        expect(byTag('GT-8')?.company_id).toBe('co-9');
    });

    // Since the shared-DB tenancy work, company_id defaults to caller_company()
    // and every insert policy carries WITH CHECK (company_id = caller_company()).
    // An explicit null suppresses the default AND evaluates the check to NULL,
    // which Postgres rejects — so sending one does not import an untenanted row,
    // it refuses the row. The key must be ABSENT, not null.
    it('never sends an explicit null company_id — it omits the key so the default applies', async () => {
        await importAssets([row({ tag: 'SITE-ROOT', hierarchylevel: 'SITE' })]);
        const sent = byTag('SITE-ROOT')!;
        expect(sent).toBeDefined();
        expect('company_id' in sent).toBe(false);
    });

    it('omits company_id when the parent resolves without one', async () => {
        db.assets.rows.push({ id: 'p-2', tag: 'SYS-NOCO', hierarchy_level: 'SYSTEM', company_id: null });
        await importAssets([row({ tag: 'GT-11', hierarchylevel: 'EQUIPMENT', criticality: 'A', parenttag: 'SYS-NOCO' })]);
        expect('company_id' in byTag('GT-11')!).toBe(false);
    });

    it('sends no null company_id anywhere in a mixed hierarchy import (regression)', async () => {
        await importAssets([
            row({ tag: 'SITE-M', hierarchylevel: 'SITE' }),
            row({ tag: 'U-M', hierarchylevel: 'UNIT', parenttag: 'SITE-M' }),
            row({ tag: 'GT-M', hierarchylevel: 'EQUIPMENT', criticality: 'A', parenttag: 'U-M' }),
        ]);
        const nulls = (inserted.assets ?? []).filter(r => 'company_id' in r && r.company_id === null);
        expect(nulls).toEqual([]);
    });

    it('resolves a cost-centre code to its id, and notes a miss without failing the row', async () => {
        db.cost_centers.rows.push({ id: 'cc-1', code: 'CC-003' });
        const hit = await importAssets([row({ tag: 'GT-9', hierarchylevel: 'EQUIPMENT', criticality: 'A', costcenter: 'CC-003' })]);
        expect(hit.inserted).toBe(1);
        expect(byTag('GT-9')?.cost_center_id).toBe('cc-1');

        const miss = await importAssets([row({ tag: 'GT-10', hierarchylevel: 'EQUIPMENT', criticality: 'A', costcenter: 'NOPE' })]);
        expect(miss.inserted).toBe(1);
        expect(byTag('GT-10')?.cost_center_id).toBeNull();
        expect(miss.notes?.join(' ')).toMatch(/NOPE/);
    });
});

describe('provenance batching', () => {
    it('still imports when import_batches is refused (non-admin), with a note', async () => {
        const res = await importAssets([row({ tag: 'SITE-5', hierarchylevel: 'SITE' })], { withBatch: true });
        expect(res.inserted).toBe(1);
        expect(byTag('SITE-5')?.import_batch_id).toBeNull();
        expect(res.notes?.join(' ')).toMatch(/Provenance batch not recorded/);
    });

    it('stamps the batch id when the batch is created', async () => {
        db.import_batches.insertError = null;
        const res = await importAssets([row({ tag: 'SITE-6', hierarchylevel: 'SITE' })], { withBatch: true });
        expect(res.inserted).toBe(1);
        expect(byTag('SITE-6')?.import_batch_id).toBeTruthy();
    });
});

// ── Sync mode (Tier-1 inbound master data) ───────────────────────────────────
// A one-time migration and a repeatable master-data feed want opposite things
// from a row that already exists, so the behaviour is a mode rather than a
// guess. These pin both halves.
describe('sync mode', () => {
    const seedExisting = () => {
        db.assets.rows.push({
            id: 'ex-1', tag: 'PMP-1', hierarchy_level: 'EQUIPMENT', company_id: 'co-1',
            name: 'Old name', manufacturer: 'OldCo', criticality: 'C',
            serial_number: 'SN-OLD', cost_center_id: 'cc-old',
        });
    };

    it('leaves an existing row untouched by default — a re-run must not overwrite the app', async () => {
        seedExisting();
        const res = await importAssets([row({ tag: 'PMP-1', hierarchylevel: 'EQUIPMENT', criticality: 'A', name: 'New name' })]);
        expect(res.skipped).toBe(1);
        expect(res.updated).toBe(0);
        expect(updates.assets ?? []).toEqual([]);
        expect(db.assets.rows.find(r => r.id === 'ex-1')?.name).toBe('Old name');
    });

    it('updates the existing row in sync mode, and counts it apart from inserts', async () => {
        seedExisting();
        const res = await importAssets(
            [row({ tag: 'PMP-1', hierarchylevel: 'EQUIPMENT', criticality: 'A', name: 'New name', manufacturer: 'NewCo' })],
            { mode: 'sync' },
        );
        expect(res.updated).toBe(1);
        expect(res.inserted).toBe(0);
        expect(res.skipped).toBe(0);
        const after = db.assets.rows.find(r => r.id === 'ex-1')!;
        expect(after.name).toBe('New name');
        expect(after.manufacturer).toBe('NewCo');
        expect(after.criticality).toBe('A');
    });

    // The reason this is an UPDATE of provided columns and not an upsert.
    it('never blanks a column the file does not carry', async () => {
        seedExisting();
        await importAssets(
            [row({ tag: 'PMP-1', hierarchylevel: 'EQUIPMENT', manufacturer: 'NewCo' })],
            { mode: 'sync' },
        );
        const after = db.assets.rows.find(r => r.id === 'ex-1')!;
        expect(after.serial_number).toBe('SN-OLD');   // absent from the file
        expect(after.criticality).toBe('C');          // absent from the file
        expect(after.cost_center_id).toBe('cc-old');  // absent from the file
    });

    it('never moves a record between tenants, whatever the file says', async () => {
        seedExisting();
        await importAssets([row({ tag: 'PMP-1', hierarchylevel: 'EQUIPMENT', name: 'X' })], { mode: 'sync' });
        const patch = (updates.assets ?? [])[0] ?? {};
        expect('company_id' in patch).toBe(false);
        expect(db.assets.rows.find(r => r.id === 'ex-1')?.company_id).toBe('co-1');
    });

    // Re-parenting under a nightly feed would reorder the tree beneath work
    // orders that reference it — a deliberate act, not an import side effect.
    it('never re-parents or re-levels an existing record', async () => {
        seedExisting();
        await importAssets([row({ tag: 'PMP-1', hierarchylevel: 'SITE', name: 'X' })], { mode: 'sync' });
        const patch = (updates.assets ?? [])[0] ?? {};
        expect('hierarchy_level' in patch).toBe(false);
        expect('parent_id' in patch).toBe(false);
    });

    it('reports a row it could not change rather than claiming an update', async () => {
        seedExisting();
        // name: '' matters — the row() helper defaults name to the tag, which
        // would itself be a change and make this assert nothing.
        const res = await importAssets([row({ tag: 'PMP-1', hierarchylevel: 'EQUIPMENT', name: '' })], { mode: 'sync' });
        expect(res.updated).toBe(0);
        expect(res.skipped).toBe(1);
        expect(outcomeFor(res, 'PMP-1')?.reason).toMatch(/nothing to change/i);
    });

    // A re-run where every row already exists is the normal shape of a sync,
    // and there is nothing to insert — so nothing may short-circuit first.
    it('still applies updates when the file contains no new rows at all', async () => {
        seedExisting();
        db.assets.rows.push({ id: 'ex-2', tag: 'PMP-2', hierarchy_level: 'EQUIPMENT', company_id: 'co-1', name: 'Old 2' });
        const res = await importAssets([
            row({ tag: 'PMP-1', hierarchylevel: 'EQUIPMENT', name: 'A' }),
            row({ tag: 'PMP-2', hierarchylevel: 'EQUIPMENT', name: 'B' }),
        ], { mode: 'sync' });
        expect(res.updated).toBe(2);
        expect(res.inserted).toBe(0);
    });

    it('handles a file that mixes new rows with existing ones', async () => {
        seedExisting();
        const res = await importAssets([
            row({ tag: 'PMP-1', hierarchylevel: 'EQUIPMENT', name: 'Updated' }),
            row({ tag: 'PMP-NEW', hierarchylevel: 'EQUIPMENT', criticality: 'B' }),
        ], { mode: 'sync' });
        expect(res.updated).toBe(1);
        expect(res.inserted).toBe(1);
        expect(byTag('PMP-NEW')).toBeDefined();
    });
});

// ── External id capture (Tier-1 inbound identity layer) ──────────────────────
// A foreign CMMS export carries the ids THEIR system knows these assets by.
// Used to match a row and then dropped, a later integration has to rediscover
// the same mapping by name — which breaks the first time something is renamed.
describe('external id capture', () => {
    const mapCall = () => rpcCalls.find(c => c.fn === 'ers_map_external_ids');

    it('records their equipment numbers when the file came from a foreign CMMS', async () => {
        const res = await importAssets(
            [row({ tag: 'GT-20', hierarchylevel: 'EQUIPMENT', criticality: 'A', equipmentnumber: 'EQ-1001' })],
            { sourceSystem: 'sap_pm' },
        );
        expect(res.inserted).toBe(1);
        const call = mapCall()!;
        expect(call).toBeDefined();
        expect(call.args.p_entity_type).toBe('asset');
        expect(call.args.p_system).toBe('SAP');
        expect(call.args.p_pairs).toEqual([{ entity_id: byTag('GT-20')!.id, external_key: 'EQ-1001' }]);
    });

    // A hand-keyed sheet has no stable identity on the other side to map to.
    it('records nothing for a spreadsheet', async () => {
        await importAssets(
            [row({ tag: 'GT-21', hierarchylevel: 'EQUIPMENT', criticality: 'A', equipmentnumber: 'EQ-1002' })],
            { sourceSystem: 'spreadsheet' },
        );
        expect(mapCall()).toBeUndefined();
    });

    it('records nothing when no source system is given at all (unchanged default)', async () => {
        await importAssets([row({ tag: 'GT-22', hierarchylevel: 'EQUIPMENT', criticality: 'A', equipmentnumber: 'EQ-1003' })]);
        expect(mapCall()).toBeUndefined();
    });

    it('skips rows with no external id rather than mapping a blank', async () => {
        await importAssets([
            row({ tag: 'GT-23', hierarchylevel: 'EQUIPMENT', criticality: 'A', equipmentnumber: 'EQ-1004' }),
            row({ tag: 'GT-24', hierarchylevel: 'EQUIPMENT', criticality: 'A' }),
        ], { sourceSystem: 'maximo' });
        const pairs = mapCall()!.args.p_pairs as { external_key: string }[];
        expect(pairs).toHaveLength(1);
        expect(pairs[0].external_key).toBe('EQ-1004');
    });

    it('does not call out at all when nothing in the file carries an id', async () => {
        await importAssets([row({ tag: 'GT-25', hierarchylevel: 'EQUIPMENT', criticality: 'A' })], { sourceSystem: 'sap_pm' });
        expect(mapCall()).toBeUndefined();
    });

    it('maps each vendor to its own system name', async () => {
        await importAssets([row({ tag: 'GT-26', hierarchylevel: 'EQUIPMENT', criticality: 'A', equipmentnumber: 'X1' })], { sourceSystem: 'maintainx' });
        expect(mapCall()!.args.p_system).toBe('MAINTAINX');
    });

    // The import is the point; the mapping is provenance and can be rebuilt
    // from the same file, so it must never be able to fail the run.
    it('still imports, with a note, when the mapping call fails', async () => {
        rpcError = { message: 'permission denied' };
        const res = await importAssets(
            [row({ tag: 'GT-27', hierarchylevel: 'EQUIPMENT', criticality: 'A', equipmentnumber: 'EQ-9' })],
            { sourceSystem: 'sap_pm' },
        );
        expect(res.inserted).toBe(1);
        expect(res.failed).toBe(0);
        expect(res.notes?.join(' ')).toMatch(/External ids not recorded/);
    });

    it('records the real source system on the batch instead of always saying spreadsheet', async () => {
        db.import_batches.insertError = null;
        await importAssets([row({ tag: 'GT-28', hierarchylevel: 'EQUIPMENT', criticality: 'A' })], { withBatch: true, sourceSystem: 'sap_pm' });
        expect((inserted.import_batches ?? [])[0]?.source_system).toBe('sap_pm');
    });

    // Sync mode touches rows that already exist; their ids are just as worth
    // keeping as a new row's.
    it('maps existing rows too on a sync run', async () => {
        db.assets.rows.push({ id: 'ex-9', tag: 'GT-29', hierarchy_level: 'EQUIPMENT', company_id: 'co-1', name: 'Old' });
        await importAssets(
            [row({ tag: 'GT-29', hierarchylevel: 'EQUIPMENT', name: 'New', equipmentnumber: 'EQ-77' })],
            { sourceSystem: 'sap_pm', mode: 'sync' },
        );
        expect(mapCall()!.args.p_pairs).toEqual([{ entity_id: 'ex-9', external_key: 'EQ-77' }]);
    });
});
