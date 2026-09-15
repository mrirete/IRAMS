#!/usr/bin/env node
/**
 * Seed real boiler signal history onto one asset — the demo/test feed for the
 * signal-grounded Specialist (migration 0362, query_readings tool).
 *
 * DATASET
 *   "Time-Series of Industrial Boiler Operations" — a coal-fired boiler at a
 *   chemical plant in Zhejiang, China. 5-second samples over 5 days
 *   (2022-03-27 → 2022-04-01), 65 columns of pressure / temperature / flow /
 *   O₂. Abnormal operation = outlet steam temperature outside 530–545 °C
 *   (8.6 % of rows). Licence CC BY 4.0 — attribution:
 *     Hu, W., Jiang, A., Chen, K., Zheng, J., Shang, W. & Cao, Z. (2025).
 *     A long-tailed distribution time-series dataset in boiler equipment.
 *     Sci Data 12:742. https://doi.org/10.1038/s41597-025-05096-4
 *     Kaggle mirror: nikitamanaenkov/time-series-of-industrial-boiler-operations
 *   Kaggle needs a (free) account, so the CSV is NOT vendored — download
 *   data.csv (+ columns.csv, the legend) and point this script at them.
 *
 * WHAT IT WRITES
 *   • ers_sensor_reading_points — one row per (tag, step) after averaging the
 *     5 s samples into --step-minutes buckets (default 1 → ~7 200 rows per
 *     tag, ~470k for all 65 tags; use --tags to load fewer).
 *   • ers_sensor_readings — the 50-point projection Predict reads, with
 *     alarm_low/high at the 1st/99th percentile of the loaded series unless
 *     the tag is the outlet steam temperature, which gets the paper's band.
 *   • then calls ers_rollup_my_reading_points() so 30/90-day windows work
 *     without waiting for the hourly cron.
 *   Timestamps are shifted so the series ENDS at --end (default: now), so a
 *   "last 7 days" question has an answer today.
 *
 * RUN (PowerShell, from repo root):
 *   $env:SEED_EMAIL="you@company.com"; $env:SEED_PASSWORD="…"
 *   node scripts/seed-boiler-history.mjs --csv C:\data\boiler\data.csv --columns C:\data\boiler\columns.csv --asset B-101
 * OPTIONS
 *   --tags a,b,c        only these columns (case-insensitive)
 *   --step-minutes 1    averaging window (5 → 1 440 rows/tag)
 *   --end 2026-09-15T00:00:00Z
 *   --clean             delete this asset's seeded points + projection rows and exit
 *
 * The password is read from the env only; nothing is stored or printed.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

// ── Env (same lookup as seed-demo-history.mjs) ─────────────────────────────
const envText = (() => {
    for (const p of ['.env.local', '.env', 'src/frontend/.env.local', 'src/frontend/.env', '../.env.local', '../.env']) {
        try { return readFileSync(p, 'utf8'); } catch { /* next */ }
    }
    return '';
})();
const envVal = (k) => (envText.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] || process.env[k] || '').trim().replace(/^["']|["']$/g, '');
const URL = envVal('VITE_SUPABASE_URL');
const ANON = envVal('VITE_SUPABASE_ANON_KEY');
const EMAIL = process.env.SEED_EMAIL || '';
const PASSWORD = process.env.SEED_PASSWORD || '';

// ── Args ───────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (k, d = '') => { const i = argv.indexOf(k); return i >= 0 ? (argv[i + 1] ?? d) : d; };
const has = (k) => argv.includes(k);
const CSV = arg('--csv');
const COLUMNS = arg('--columns');
const ASSET_TAG = arg('--asset');
const STEP_MIN = Math.max(1, Number(arg('--step-minutes', '1')) || 1);
const END = arg('--end') ? new Date(arg('--end')) : new Date();
const ONLY = arg('--tags') ? new Set(arg('--tags').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) : null;
const CLEAN = has('--clean');
const SOURCE = 'csv';   // the writer label 0236 reserves for file loads

if (!URL || !ANON) fail('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not found in .env.local');
if (!EMAIL || !PASSWORD) fail('Set SEED_EMAIL and SEED_PASSWORD in the environment.');
if (!ASSET_TAG) fail('Pass --asset <tag> (the register asset to attach the series to).');
if (!CLEAN && !CSV) fail('Pass --csv <path to data.csv>.');

function fail(msg) { console.error(`✖ ${msg}`); process.exit(1); }

// ── Main ───────────────────────────────────────────────────────────────────
const sb = createClient(URL, ANON, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
if (authErr) fail(`Login failed: ${authErr.message}`);

const { data: assets, error: aErr } = await sb.from('assets').select('id, tag, name').ilike('tag', ASSET_TAG).limit(1);
if (aErr) fail(`assets: ${aErr.message}`);
if (!assets?.length) fail(`No asset with tag ${ASSET_TAG} visible to ${EMAIL}. Create it first (Assets → Add).`);
const asset = assets[0];
console.log(`Asset ${asset.tag} — ${asset.name} (${asset.id})`);

if (CLEAN) {
    const { error: e1, count } = await sb.from('ers_sensor_reading_points').delete({ count: 'exact' }).eq('asset_id', asset.id).eq('source', SOURCE);
    if (e1) fail(`delete points: ${e1.message}`);
    const { error: e2 } = await sb.from('ers_sensor_readings').delete().eq('asset_id', asset.id);
    if (e2) fail(`delete projection: ${e2.message}`);
    const { error: e3 } = await sb.from('ers_reading_rollups_hourly').delete().eq('asset_id', asset.id);
    if (e3 && !/permission|policy/i.test(e3.message)) console.warn(`rollups not deleted (${e3.message}) — the hourly cron will overwrite them`);
    console.log(`Removed ${count ?? '?'} seeded points for ${asset.tag}.`);
    process.exit(0);
}

// Legend: columns.csv is "code,description,unit" (or similar) — best effort.
const legend = new Map();
if (COLUMNS) {
    for (const line of readFileSync(COLUMNS, 'utf8').split(/\r?\n/).slice(1)) {
        const cells = splitCsv(line);
        if (cells.length >= 2 && cells[0]) legend.set(cells[0].trim().toLowerCase(), { description: cells[1]?.trim() ?? '', unit: cells[2]?.trim() ?? '' });
    }
    console.log(`Legend: ${legend.size} columns described.`);
}

// ── Pass 1: stream the CSV, average into step buckets per tag ──────────────
console.log(`Reading ${CSV} …`);
const rl = createInterface({ input: createReadStream(CSV, 'utf8'), crlfDelay: Infinity });
let header = null, tsIdx = -1, rows = 0, firstTs = null, lastTs = null;
/** tag → Map<bucketMs, {sum, n}> */
const series = new Map();
let tagIdx = [];

for await (const line of rl) {
    if (!line.trim()) continue;
    const cells = splitCsv(line);
    if (!header) {
        header = cells.map((c) => c.trim());
        tsIdx = header.findIndex((h) => /^(time|timestamp|date|datetime|ts)$/i.test(h) || /time/i.test(h));
        if (tsIdx < 0) tsIdx = 0;
        tagIdx = header.map((h, i) => i).filter((i) => i !== tsIdx && (!ONLY || ONLY.has(header[i].toLowerCase())));
        if (!tagIdx.length) fail(`No data columns selected. Header: ${header.join(', ')}`);
        for (const i of tagIdx) series.set(header[i], new Map());
        console.log(`Timestamp column: "${header[tsIdx]}"; ${tagIdx.length} tags.`);
        continue;
    }
    const t = Date.parse(cells[tsIdx]);
    if (Number.isNaN(t)) continue;
    if (firstTs === null || t < firstTs) firstTs = t;
    if (lastTs === null || t > lastTs) lastTs = t;
    const bucket = Math.floor(t / (STEP_MIN * 60_000)) * STEP_MIN * 60_000;
    for (const i of tagIdx) {
        const v = Number(cells[i]);
        if (!Number.isFinite(v)) continue;
        const m = series.get(header[i]);
        const cur = m.get(bucket);
        if (cur) { cur.sum += v; cur.n += 1; } else m.set(bucket, { sum: v, n: 1 });
    }
    rows++;
}
if (!rows || firstTs === null) fail('No parsable rows.');
const shiftMs = END.getTime() - lastTs;
console.log(`${rows} samples, ${new Date(firstTs).toISOString()} → ${new Date(lastTs).toISOString()}; shifting by ${(shiftMs / 86_400_000).toFixed(1)} days so it ends ${END.toISOString()}.`);

// ── Pass 2: write points in batches ────────────────────────────────────────
let written = 0;
const BATCH = 1000;
for (const [tag, m] of series) {
    const unit = legend.get(tag.toLowerCase())?.unit || null;
    const pts = [...m.entries()].sort((a, b) => a[0] - b[0]).map(([b, agg]) => ({
        asset_id: asset.id, tag, ts: new Date(b + shiftMs).toISOString(),
        value: round6(agg.sum / agg.n), unit, source: SOURCE,
    }));
    for (let i = 0; i < pts.length; i += BATCH) {
        const { error } = await sb.from('ers_sensor_reading_points')
            .upsert(pts.slice(i, i + BATCH), { onConflict: 'asset_id,tag,ts', ignoreDuplicates: true });
        if (error) fail(`points ${tag}: ${error.message}`);
        written += Math.min(BATCH, pts.length - i);
    }
    process.stdout.write(`  ${tag}: ${pts.length} points\n`);
}
console.log(`Wrote ${written} points.`);

// ── Pass 3: the 50-point projection Predict reads ──────────────────────────
const { data: existing } = await sb.from('ers_sensor_readings').select('id, tag').eq('asset_id', asset.id);
const idByTag = new Map((existing ?? []).map((r) => [r.tag.toLowerCase(), r.id]));
for (const [tag, m] of series) {
    const vals = [...m.entries()].sort((a, b) => a[0] - b[0]).map(([, agg]) => round6(agg.sum / agg.n));
    if (!vals.length) continue;
    const sorted = [...vals].sort((a, b) => a - b);
    const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    const isOutletSteam = /outlet.*steam.*temp|boiler_outlet_steam/i.test(tag);
    const row = {
        asset_id: asset.id, tag,
        unit: legend.get(tag.toLowerCase())?.unit || '',
        current_value: vals[vals.length - 1],
        trend: vals.length > 1 ? (vals.at(-1) > vals.at(-2) ? 'rising' : vals.at(-1) < vals.at(-2) ? 'falling' : 'stable') : null,
        alarm_low: isOutletSteam ? 530 : round6(q(0.01)),
        alarm_high: isOutletSteam ? 545 : round6(q(0.99)),
        readings: vals.slice(-50),
    };
    const id = idByTag.get(tag.toLowerCase());
    const { error } = id
        ? await sb.from('ers_sensor_readings').update(row).eq('id', id)
        : await sb.from('ers_sensor_readings').insert(row);
    if (error) fail(`projection ${tag}: ${error.message}`);
}
console.log(`Projection updated for ${series.size} tags.`);

// ── Pass 4: rollups for the loaded span (tenant-scoped) ────────────────────
const spanHours = Math.ceil((END.getTime() - (firstTs + shiftMs)) / 3_600_000) + 2;
const { data: rolled, error: rErr } = await sb.rpc('ers_rollup_my_reading_points', { p_hours: spanHours });
if (rErr) console.warn(`Rollup skipped (${rErr.message}) — is 0362 applied? The hourly cron will catch up only the trailing 3 h.`);
else console.log(`Rolled up ${rolled} hourly rows over ${spanHours} h.`);

console.log(`\nDone. Try: "How has ${series.keys().next().value} on ${asset.tag} behaved over the last 7 days?"`);

// ── Helpers ────────────────────────────────────────────────────────────────
function round6(v) { return Math.round(v * 1e6) / 1e6; }
/** Minimal CSV splitter: handles quoted cells with commas; no embedded newlines. */
function splitCsv(line) {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
        else if (c === ',' && !q) { out.push(cur); cur = ''; }
        else cur += c;
    }
    out.push(cur);
    return out;
}
