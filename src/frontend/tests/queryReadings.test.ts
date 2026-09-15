/**
 * Tests for the query_readings tool's database path
 * (supabase/functions/agent-run/tools.ts).
 *
 * readingsSummary.test.ts covers the arithmetic. This covers the half that
 * talks to Supabase: asset resolution, which tags are read, where the bands
 * come from (a reading definition linked by sensor_tag beats the projection's
 * alarm line), the manual-rounds fallback when there is no live feed, and how
 * the tool degrades on a tenant where 0362 is not applied yet.
 *
 * The fake client records every call and answers from a per-table script, so
 * a change to the query shape shows up here as a failure rather than passing
 * against a mock that accepts everything.
 */
import { describe, it, expect } from 'vitest';
import { TOOLS } from '../supabase/functions/agent-run/tools.ts';
import type { ToolContext } from '../supabase/functions/agent-run/types.ts';

const queryReadings = TOOLS['query_readings'];

// ── Fake Supabase ────────────────────────────────────────────────────────
type Call = { table: string; ops: Array<[string, unknown[]]> };
type Script = {
    tables: Record<string, (c: Call) => unknown[]>;
    rpc?: (name: string, args: Record<string, unknown>) => { data: unknown; error: { message: string } | null };
};

function fakeDb(script: Script, calls: Call[] = []) {
    const builder = (table: string) => {
        const call: Call = { table, ops: [] };
        calls.push(call);
        const b: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'ilike', 'in', 'gte', 'lte', 'not', 'order', 'limit']) {
            b[m] = (...a: unknown[]) => { call.ops.push([m, a]); return b; };
        }
        (b as { then: unknown }).then = (res: (v: unknown) => void) => {
            const fn = script.tables[table];
            res(fn ? { data: fn(call), error: null } : { data: [], error: null });
        };
        return b;
    };
    return {
        from: builder,
        rpc: (name: string, args: Record<string, unknown>) => {
            calls.push({ table: `rpc:${name}`, ops: [['args', [args]]] });
            return Promise.resolve(script.rpc ? script.rpc(name, args) : { data: [], error: null });
        },
    };
}

const ctx = (db: unknown): ToolContext => ({ db, proposals: [], sources: [] });
const ASSET = { id: 'a-1', tag: 'B-101', name: 'Boiler 1' };

/** 24 hourly RPC rows, rising 530 → 553 °C, in sem_readings_window's column names. */
const risingRows = Array.from({ length: 24 }, (_, i) => ({
    bucket_ts: new Date(Date.parse('2026-09-14T00:00:00Z') + i * 3_600_000).toISOString(),
    n: 60, min_value: 530 + i - 0.5, avg_value: 530 + i, max_value: 530 + i + 0.5, last_value: 530 + i, source: 'raw',
}));

// ── Tests ────────────────────────────────────────────────────────────────
describe('query_readings — asset resolution', () => {
    it('reports not-found instead of guessing', async () => {
        const db = fakeDb({ tables: { assets: () => [] } });
        const r = await queryReadings.run({ asset_tag: 'NOPE' }, ctx(db));
        expect((r.data as { found: boolean }).found).toBe(false);
        expect(r.warnings?.[0]).toMatch(/No matching asset/);
    });

    it('resolves by tag case-insensitively and by id', async () => {
        const calls: Call[] = [];
        const db = fakeDb({ tables: { assets: () => [ASSET] } }, calls);
        await queryReadings.run({ asset_tag: 'b-101' }, ctx(db));
        expect(calls[0].ops.some(([m, a]) => m === 'ilike' && a[0] === 'tag' && a[1] === 'b-101')).toBe(true);
        const calls2: Call[] = [];
        const db2 = fakeDb({ tables: { assets: () => [ASSET] } }, calls2);
        await queryReadings.run({ asset_id: 'a-1' }, ctx(db2));
        expect(calls2[0].ops.some(([m, a]) => m === 'eq' && a[0] === 'id' && a[1] === 'a-1')).toBe(true);
    });
});

describe('query_readings — live feed', () => {
    const script: Script = {
        tables: {
            assets: () => [ASSET],
            ers_sensor_readings: () => [{ tag: 'BOILER_OUTLET_STEAM_TEMP', unit: '°C', alarm_low: 520, alarm_high: 560 }],
            reading_definitions: () => [{
                id: 'd-1', name: 'Outlet steam temperature', unit: '°C', sensor_tag: 'boiler_outlet_steam_temp', reading_type_code: null,
                min_warning: 530, max_warning: 545, min_critical: 525, max_critical: 550,
            }],
        },
        rpc: (name) => (name === 'sem_readings_window' ? { data: risingRows, error: null } : { data: [], error: null }),
    };

    it('reads the window through sem_readings_window and summarises it', async () => {
        const calls: Call[] = [];
        const c = ctx(fakeDb(script, calls));
        const r = await queryReadings.run({ asset_tag: 'B-101', window: '24h' }, c);
        const data = r.data as { found: boolean; window: { label: string }; series: Array<Record<string, unknown>> };
        expect(data.found).toBe(true);
        expect(data.window.label).toBe('24h');
        expect(data.series).toHaveLength(1);
        const s = data.series[0];
        expect(s.source).toBe('sensor');
        expect(s.direction).toBe('rising');
        expect(s.n_points).toBe(24 * 60);
        // Bands came from the linked definition, not the projection's alarm line.
        expect(s.bands).toEqual({ warn_low: 530, warn_high: 545, crit_low: 525, crit_high: 550 });
        expect((s.excursions as { crit_high: number }).crit_high).toBeGreaterThan(0);
        // RPC was asked for exactly this asset+tag.
        const rpc = calls.find((x) => x.table === 'rpc:sem_readings_window');
        expect(rpc).toBeTruthy();
        const args = rpc!.ops[0][1][0] as Record<string, unknown>;
        expect(args.p_asset_id).toBe('a-1');
        expect(args.p_tag).toBe('BOILER_OUTLET_STEAM_TEMP');
        // Citations name the history table.
        expect(r.sources[0].kind).toBe('ers_sensor_reading_points');
        expect(c.sources).toHaveLength(1);
        // Default 24 buckets came back for plotting.
        expect((s.buckets as unknown[]).length).toBe(24);
        // No manual fallback was attempted: the definition is covered by the live tag.
        expect(calls.some((x) => x.table === 'reading_logs')).toBe(false);
    });

    it('max_points 0 returns summaries only', async () => {
        const r = await queryReadings.run({ asset_tag: 'B-101', max_points: 0 }, ctx(fakeDb(script)));
        const s = (r.data as { series: Array<Record<string, unknown>> }).series[0];
        expect(s.buckets).toBeUndefined();
        expect(s.headline).toMatch(/rising/);
    });

    it('a tag filter with no match says so rather than returning everything', async () => {
        const r = await queryReadings.run({ asset_tag: 'B-101', tag: 'vibration' }, ctx(fakeDb(script)));
        expect((r.data as { series: unknown[] }).series).toHaveLength(0);
        expect(r.warnings?.some((w) => /matches 'vibration'/.test(w))).toBe(true);
    });

    it('falls back to the projection alarm line as the critical band when no definition is linked', async () => {
        const noDef: Script = { ...script, tables: { ...script.tables, reading_definitions: () => [] } };
        const r = await queryReadings.run({ asset_tag: 'B-101' }, ctx(fakeDb(noDef)));
        const s = (r.data as { series: Array<Record<string, unknown>> }).series[0];
        expect(s.bands).toEqual({ crit_low: 520, crit_high: 560 });
    });

    it('degrades honestly when 0362 is not applied (RPC error)', async () => {
        const broken: Script = { ...script, rpc: () => ({ data: null, error: { message: 'function sem_readings_window does not exist' } }) };
        const r = await queryReadings.run({ asset_tag: 'B-101' }, ctx(fakeDb(broken)));
        const s = (r.data as { series: Array<Record<string, unknown>> }).series[0];
        expect(s.n_buckets).toBe(0);
        expect(s.direction).toBe('unknown');
        expect(r.warnings?.some((w) => /Signal history unavailable/.test(w))).toBe(true);
    });
});

describe('query_readings — manual rounds fallback', () => {
    const script: Script = {
        tables: {
            assets: () => [ASSET],
            ers_sensor_readings: () => [],
            reading_definitions: () => [{
                id: 'd-vib', name: 'DE bearing vibration', unit: 'mm/s', sensor_tag: null, reading_type_code: 'VIB',
                min_warning: null, max_warning: 4.5, min_critical: null, max_critical: 7.1,
            }],
            reading_logs: () => [0, 7, 14, 21, 28].map((d) => ({
                definition_id: 'd-vib',
                reading_date: new Date(Date.now() - (30 - d) * 86_400_000).toISOString().slice(0, 10),
                reading_time: '08:00:00',
                reading_value: 4 + d * 0.05,
            })),
        },
    };

    it('reads reading_logs when there is no live feed and labels the series manual', async () => {
        const calls: Call[] = [];
        const c = ctx(fakeDb(script, calls));
        const r = await queryReadings.run({ asset_tag: 'B-101', window: '30d' }, c);
        const s = (r.data as { series: Array<Record<string, unknown>> }).series[0];
        expect(s.source).toBe('manual');
        expect(s.tag).toBe('DE bearing vibration');
        expect(s.n_points).toBe(5);
        expect(s.direction).toBe('rising');
        expect((s.excursions as { warn_high: number }).warn_high).toBe(3);
        expect(r.sources[0].kind).toBe('reading_logs');
        expect(r.warnings?.some((w) => /Manual Condition Data only/.test(w))).toBe(true);
        // No RPC call was made: nothing live to read.
        expect(calls.some((x) => x.table.startsWith('rpc:'))).toBe(false);
        // The logs query was scoped to the asset and the window.
        const logs = calls.find((x) => x.table === 'reading_logs')!;
        expect(logs.ops.some(([m, a]) => m === 'eq' && a[0] === 'asset_id' && a[1] === 'a-1')).toBe(true);
        expect(logs.ops.some(([m, a]) => m === 'gte' && a[0] === 'reading_date')).toBe(true);
    });

    it('an asset with no points at all says so', async () => {
        const empty: Script = { tables: { assets: () => [ASSET], ers_sensor_readings: () => [], reading_definitions: () => [] } };
        const r = await queryReadings.run({ asset_tag: 'B-101' }, ctx(fakeDb(empty)));
        expect((r.data as { series: unknown[] }).series).toHaveLength(0);
        expect(r.warnings?.[0]).toMatch(/No reading points/);
        expect(r.sources[0].label).toMatch(/no reading points/);
    });
});

describe('get_asset_context — the 7-day lines', () => {
    it('adds recent_signals_7d without breaking the context when the RPC is missing', async () => {
        const getAssetContext = TOOLS['get_asset_context'];
        const db = fakeDb({
            tables: {
                assets: (c) => (c.ops.some(([m]) => m === 'in') ? [] : [{ ...ASSET, hierarchy_level: 'EQUIPMENT', criticality: 'A', asset_class: 'BO', operating_context: {}, properties: {} }]),
                ers_sensor_readings: () => [{ tag: 'FURNACE_PRESSURE', unit: 'bar', alarm_low: null, alarm_high: null }],
                reading_definitions: () => [],
                reference_codes_effective: () => [],
                asset_bom: () => [],
                sem_rcm_coverage: () => [],
            },
            rpc: () => ({ data: null, error: { message: 'function sem_readings_window does not exist' } }),
        });
        // maybeSingle is used by get_asset_context; the fake builder needs it.
        const orig = db.from;
        (db as { from: unknown }).from = (t: string) => {
            const b = orig(t) as Record<string, unknown>;
            b.maybeSingle = () => ({ then: (res: (v: unknown) => void) => (b as { then: (r: (v: { data: unknown[] }) => void) => void }).then((v) => res({ data: v.data?.[0] ?? null, error: null })) });
            return b;
        };
        const r = await getAssetContext.run({ asset_tag: 'B-101' }, ctx(db));
        const data = r.data as { found: boolean; recent_signals_7d: Array<Record<string, unknown>> };
        expect(data.found).toBe(true);
        expect(data.recent_signals_7d).toHaveLength(1);
        expect(data.recent_signals_7d[0].tag).toBe('FURNACE_PRESSURE');
        expect(data.recent_signals_7d[0].direction).toBe('unknown');
        expect(r.warnings?.some((w) => /Signal history unavailable/.test(w))).toBe(true);
    });
});
