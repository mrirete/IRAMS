#!/usr/bin/env node
/**
 * Provision the boiler demo — the register, reading points and P&ID that the
 * Coal-Fired Boiler dataset (scripts/seed-boiler-history.mjs) hangs off.
 *
 * WHAT IT CREATES (idempotent — re-running finds what exists by tag/title)
 *   SYS-300-BLR   SYSTEM     "Coal-fired boiler train"        under UNIT-300 Power Generation
 *   B-301         EQUIPMENT  "Coal-fired CFB boiler B-301"    HEATER_BOILER, criticality A
 *                            properties.predict.regime = { loadTag: 'ZZQBCHLL' } — main steam
 *                            flow is the duty, so every other point is judged at this load
 *   16 COMPONENTs under B-301 from the process flow diagram (furnace, cyclones,
 *                 loop seal, superheaters, desuperheaters, economisers, air
 *                 preheaters, fans, ID fan, coal feeder, chimney)
 *   30 reading_definitions on B-301, one per DCS tag, linked by sensor_tag so
 *                 the live series carries the definition's band (TE_8332A gets
 *                 the paper's 530–545 °C normal range)
 *   1 P&ID in ers_pid_configurations drawn from Fig. 3 of the paper — so
 *                 query_pid, the permit's "Propose from P&ID" and the Drawings
 *                 card all have something real to walk
 *
 * All 30 tags live on B-301 itself (one asset, one load tag) — the regime
 * detector needs the load and the point on the same asset. The components
 * exist for the breakdown, the P&ID and FMEA work, not for signals.
 *
 * RUN (PowerShell, from repo root):
 *   $env:SEED_EMAIL="admin@…"; $env:SEED_PASSWORD="…"
 *   node scripts/provision-boiler-demo.mjs            # create
 *   node scripts/provision-boiler-demo.mjs --clean    # remove everything it created
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const envText = (() => {
    for (const p of ['.env.local', '.env', 'src/frontend/.env.local', 'src/frontend/.env']) {
        try { return readFileSync(p, 'utf8'); } catch { /* next */ }
    }
    return '';
})();
const envVal = (k) => (envText.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] || process.env[k] || '').trim().replace(/^["']|["']$/g, '');
const URL = envVal('VITE_SUPABASE_URL');
const ANON = envVal('VITE_SUPABASE_ANON_KEY');
const EMAIL = process.env.SEED_EMAIL || '';
const PASSWORD = process.env.SEED_PASSWORD || '';
const CLEAN = process.argv.includes('--clean');
const LEGEND = JSON.parse(readFileSync('scripts/boiler-columns.json', 'utf8'));

const fail = (m) => { console.error(`✖ ${m}`); process.exit(1); };
if (!URL || !ANON) fail('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not found');
if (!EMAIL || !PASSWORD) fail('Set SEED_EMAIL and SEED_PASSWORD');

const sb = createClient(URL, ANON, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
if (authErr) fail(`Login failed: ${authErr.message}`);

const SYSTEM_TAG = 'SYS-300-BLR', BOILER_TAG = 'B-301', PID_TITLE = 'B-301 coal-fired CFB boiler — steam generation';

const COMPONENTS = [
    ['FURN-301', 'Furnace (circulating fluidised bed)', 'PRESSURE_VESSEL'],
    ['CYC-301A', 'Left cyclone separator', 'PRESSURE_VESSEL'],
    ['CYC-301B', 'Right cyclone separator', 'PRESSURE_VESSEL'],
    ['LS-301', 'Loop seal (reclaimer)', 'PRESSURE_VESSEL'],
    ['SH-301', 'High-temperature superheater', 'HEAT_EXCHANGER'],
    ['SH-302', 'Low-temperature superheater', 'HEAT_EXCHANGER'],
    ['DSH-301', 'Primary desuperheater', 'HEAT_EXCHANGER'],
    ['DSH-302', 'Secondary desuperheater', 'HEAT_EXCHANGER'],
    ['ECO-301', 'Upper-stage economiser', 'HEAT_EXCHANGER'],
    ['ECO-302', 'Lower-stage economiser', 'HEAT_EXCHANGER'],
    ['APH-301', 'Primary air preheater', 'HEAT_EXCHANGER'],
    ['APH-302', 'Secondary air preheater', 'HEAT_EXCHANGER'],
    ['FAN-301', 'Primary air fan', 'FAN_BLOWER'],
    ['FAN-302', 'Secondary air fan', 'FAN_BLOWER'],
    ['FAN-303', 'Induced draft fan (ventilator) YFJ3', 'FAN_BLOWER'],
    ['CF-301', 'Coal feeder', 'CONVEYOR'],
    ['STK-301', 'Chimney', 'PRESSURE_VESSEL'],
];

// ── P&ID from Fig. 3 — nodes on a coarse grid, edges as drawn ─────────────
const N = (id, type, label, x, y, assetTag) => ({ id, type, label, x, y, ...(assetTag ? { assetTag } : {}) });
const PID_EQUIPMENT = [
    N('coalbin', 'tank', 'Coal bin', 60, 80),
    N('feeder', 'motor', 'CF-301 Coal feeder', 60, 200, 'CF-301'),
    N('furnace', 'vessel', 'B-301 Furnace', 220, 260, 'B-301'),
    N('cycA', 'separator', 'CYC-301A Cyclone L', 360, 120, 'CYC-301A'),
    N('cycB', 'separator', 'CYC-301B Cyclone R', 440, 120, 'CYC-301B'),
    N('loopseal', 'vessel', 'LS-301 Loop seal', 400, 240, 'LS-301'),
    N('shHT', 'heat_exchanger', 'SH-301 HT superheater', 620, 80, 'SH-301'),
    N('shLT', 'heat_exchanger', 'SH-302 LT superheater', 620, 160, 'SH-302'),
    N('ecoU', 'heat_exchanger', 'ECO-301 Upper economiser', 620, 240, 'ECO-301'),
    N('ecoL', 'heat_exchanger', 'ECO-302 Lower economiser', 620, 320, 'ECO-302'),
    N('aphP', 'heat_exchanger', 'APH-301 Primary air preheater', 620, 400, 'APH-301'),
    N('aphS', 'heat_exchanger', 'APH-302 Secondary air preheater', 620, 480, 'APH-302'),
    N('dsh1', 'heat_exchanger', 'DSH-301 Primary desuperheater', 820, 160, 'DSH-301'),
    N('dsh2', 'heat_exchanger', 'DSH-302 Secondary desuperheater', 820, 80, 'DSH-302'),
    N('tv8329', 'valve', 'TV_8329ZC spray valve', 900, 200),
    N('tvSec', 'valve', 'TV-8330 spray valve', 900, 40),
    N('xvSW', 'valve', 'XV-303 Spray water isolation', 980, 120),
    N('xvMS', 'valve', 'XV-302 Main steam isolation', 980, 80),
    N('xvFW', 'valve', 'XV-301 Feedwater isolation', 820, 320),
    N('fanP', 'compressor', 'FAN-301 Primary fan', 820, 400, 'FAN-301'),
    N('fanS', 'compressor', 'FAN-302 Secondary fan', 820, 480, 'FAN-302'),
    N('dmpIn', 'valve', 'DMP-303A ID fan inlet damper', 700, 560),
    N('fanID', 'compressor', 'FAN-303 ID fan (ventilator)', 820, 560, 'FAN-303'),
    N('dmpOut', 'valve', 'DMP-303B ID fan outlet damper', 940, 560),
    N('stack', 'column', 'STK-301 Chimney', 1040, 520, 'STK-301'),
    N('te8332', 'transmitter', 'TE_8332A outlet steam temp', 700, 20),
    N('yfj3', 'transmitter', 'YFJ3_AI ID fan current', 820, 620),
    N('pt8313', 'transmitter', 'PT_8313A-F furnace pressure', 220, 180),
];
const E = (id, fromId, toId, type = 'process') => ({ id, fromId, toId, type });
const PID_CONNECTIONS = [
    // solids loop
    E('c01', 'coalbin', 'feeder'), E('c02', 'feeder', 'furnace'),
    E('c03', 'furnace', 'cycA'), E('c04', 'furnace', 'cycB'),
    E('c05', 'cycA', 'loopseal'), E('c06', 'cycB', 'loopseal'), E('c07', 'loopseal', 'furnace'),
    // flue gas
    E('c08', 'cycA', 'shHT'), E('c09', 'cycB', 'shHT'), E('c10', 'shHT', 'shLT'), E('c11', 'shLT', 'ecoU'),
    E('c12', 'ecoU', 'ecoL'), E('c13', 'ecoL', 'aphP'), E('c14', 'ecoL', 'aphS'),
    E('c15', 'aphP', 'dmpIn'), E('c16', 'aphS', 'dmpIn'), E('c17', 'dmpIn', 'fanID'), E('c18', 'fanID', 'dmpOut'), E('c19', 'dmpOut', 'stack'),
    // water / steam
    E('c20', 'xvFW', 'ecoL'), E('c21', 'ecoU', 'furnace'), E('c22', 'furnace', 'shLT'), E('c23', 'shLT', 'dsh1'),
    E('c24', 'dsh1', 'shHT'), E('c25', 'shHT', 'dsh2'), E('c26', 'dsh2', 'xvMS'),
    // spray water
    E('c27', 'xvSW', 'tv8329'), E('c28', 'tv8329', 'dsh1'), E('c29', 'xvSW', 'tvSec'), E('c30', 'tvSec', 'dsh2'),
    // combustion air
    E('c31', 'fanP', 'aphP'), E('c32', 'aphP', 'furnace'), E('c33', 'fanS', 'aphS'), E('c34', 'aphS', 'furnace'),
    // instruments
    E('i01', 'te8332', 'shHT', 'instrument'), E('i02', 'yfj3', 'fanID', 'instrument'), E('i03', 'pt8313', 'furnace', 'instrument'),
];

// ── helpers ────────────────────────────────────────────────────────────────
async function findAsset(tag) {
    const { data, error } = await sb.from('assets').select('id, tag, name, parent_id').ilike('tag', tag).limit(1);
    if (error) fail(`assets ${tag}: ${error.message}`);
    return data?.[0] ?? null;
}
async function ensureAsset(row) {
    const existing = await findAsset(row.tag);
    if (existing) { console.log(`  = ${row.tag} exists`); return existing; }
    const { data, error } = await sb.from('assets').insert(row).select('id, tag, name, parent_id').single();
    if (error) fail(`insert ${row.tag}: ${error.message}`);
    console.log(`  + ${row.tag} ${row.name}`);
    return data;
}

// ── clean ──────────────────────────────────────────────────────────────────
if (CLEAN) {
    const boiler = await findAsset(BOILER_TAG);
    if (boiler) {
        await sb.from('ers_pid_configurations').delete().eq('title', PID_TITLE);
        await sb.from('reading_definitions').delete().eq('asset_id', boiler.id);
        await sb.from('ers_sensor_reading_points').delete().eq('asset_id', boiler.id);
        await sb.from('ers_sensor_readings').delete().eq('asset_id', boiler.id);
        await sb.from('ers_prediction_alerts').delete().eq('asset_id', boiler.id);
        await sb.from('ers_twin_states').delete().eq('asset_id', boiler.id);
        const { error: e1 } = await sb.from('assets').delete().eq('parent_id', boiler.id);
        if (e1) fail(`delete components: ${e1.message}`);
        const { error: e2 } = await sb.from('assets').delete().eq('id', boiler.id);
        if (e2) fail(`delete boiler: ${e2.message}`);
    }
    const sys = await findAsset(SYSTEM_TAG);
    if (sys) { const { error } = await sb.from('assets').delete().eq('id', sys.id); if (error) fail(`delete system: ${error.message}`); }
    console.log('Boiler demo removed.');
    process.exit(0);
}

// ── create ─────────────────────────────────────────────────────────────────
const unit = await findAsset('UNIT-300');
if (!unit) fail('UNIT-300 (Power Generation) not found — this script expects the showcase tenant.');

console.log('Register:');
const sys = await ensureAsset({ tag: SYSTEM_TAG, name: 'Coal-fired boiler train', hierarchy_level: 'SYSTEM', status_code: 'ACTIVE', criticality: 'A', parent_id: unit.id });
const boiler = await ensureAsset({
    tag: BOILER_TAG, name: 'Coal-fired CFB boiler B-301', hierarchy_level: 'EQUIPMENT', status_code: 'ACTIVE', criticality: 'A',
    parent_id: sys.id, asset_class: 'HEATER_BOILER', manufacturer: 'Zhejiang Xin\'an (site data)',
    properties: {
        description: 'Coal-fired circulating-fluidised-bed steam boiler. Signals: 30 DCS tags, 5 s, 2022-03-27 → 04-01 (Hu et al. 2025, figshare CC0), time-shifted to end today.',
        predict: { regime: { loadTag: 'ZZQBCHLL', baselineDays: 30, degree: 1, excludeTags: ['TV_8329ZC'] } },
    },
    operating_context: {
        mode: 'continuous', utilisation_pct: 95, hours_per_year: 8300, starts_per_year: 6, redundancy: 'none',
        environment: ['dust', 'high_temperature'], service_medium: 'steam',
        parameters: [
            { key: 'steam_flow', label: 'Main steam flow', unit: 't/h', design: 75, operating: 61 },
            { key: 'steam_temp', label: 'Main steam temperature', unit: '°C', design: 540, operating: 538 },
            { key: 'drum_pressure', label: 'Drum pressure', unit: 'MPa', design: 10.5, operating: 9.7 },
        ],
        updated_at: new Date().toISOString(),
    },
});
// Re-assert the regime config on an existing boiler (idempotent re-run keeps it current).
await sb.from('assets').update({ properties: { description: 'Coal-fired circulating-fluidised-bed steam boiler. Signals: 30 DCS tags, 5 s, 2022-03-27 → 04-01 (Hu et al. 2025, figshare CC0), time-shifted to end today.', predict: { regime: { loadTag: 'ZZQBCHLL', baselineDays: 30, degree: 1, excludeTags: ['TV_8329ZC'] } } } }).eq('id', boiler.id);

for (const [tag, name, cls] of COMPONENTS) {
    await ensureAsset({ tag, name, hierarchy_level: 'COMPONENT', status_code: 'ACTIVE', criticality: tag.startsWith('FAN-303') || tag.startsWith('SH-') ? 'A' : 'B', parent_id: boiler.id, asset_class: cls });
}

console.log('Reading points:');
const { data: defs } = await sb.from('reading_definitions').select('sensor_tag').eq('asset_id', boiler.id);
const have = new Set((defs ?? []).map((d) => (d.sensor_tag ?? '').toLowerCase()));
let added = 0;
for (const [code, d] of Object.entries(LEGEND.columns)) {
    if (have.has(code.toLowerCase())) continue;
    const row = {
        asset_id: boiler.id, reading_type_code: code, name: `${code} — ${d.description}`, unit: d.unit ?? null, category: 'CONDITION',
        sensor_tag: code, is_active: true,
        min_warning: d.warn_low ?? null, max_warning: d.warn_high ?? null, min_critical: d.crit_low ?? null, max_critical: d.crit_high ?? null,
        limit_source: d.band_source ?? null,
    };
    const { error } = await sb.from('reading_definitions').insert(row);
    if (error) fail(`definition ${code}: ${error.message}`);
    added++;
}
console.log(`  + ${added} definitions (${have.size} existed)`);

console.log('P&ID:');
const { data: pids } = await sb.from('ers_pid_configurations').select('id').eq('title', PID_TITLE).limit(1);
if (pids?.length) {
    const { error } = await sb.from('ers_pid_configurations').update({ asset_id: boiler.id, equipment: PID_EQUIPMENT, connections: PID_CONNECTIONS, updated_at: new Date().toISOString() }).eq('id', pids[0].id);
    if (error) fail(`pid update: ${error.message}`);
    console.log(`  = updated ${PID_TITLE}`);
} else {
    const { error } = await sb.from('ers_pid_configurations').insert({ title: PID_TITLE, asset_id: boiler.id, equipment: PID_EQUIPMENT, connections: PID_CONNECTIONS, show_heat_map: false, created_by: EMAIL });
    if (error) fail(`pid insert: ${error.message}`);
    console.log(`  + ${PID_TITLE} (${PID_EQUIPMENT.length} nodes, ${PID_CONNECTIONS.length} edges)`);
}

console.log(`\nDone. Boiler ${boiler.tag} = ${boiler.id}. Next: node scripts/seed-boiler-history.mjs --csv <xinan_completed_data.csv> --asset ${BOILER_TAG}`);
