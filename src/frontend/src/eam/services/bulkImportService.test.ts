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

const resetDb = () => {
    for (const k of Object.keys(db)) delete db[k];
    for (const k of Object.keys(inserted)) delete inserted[k];
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

    const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        update: () => builder,
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
            // Awaiting the builder directly = an insert, or an unfiltered select.
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

vi.mock('../lib/supabase', () => ({
    supabase: {
        from: (table: string) => makeQuery(table),
        auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
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

beforeEach(() => { resetDb(); idSeq = 0; });

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
