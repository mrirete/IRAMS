#!/usr/bin/env node
/**
 * Seed real boiler signal history onto one asset — the demo/test feed for the
 * signal-grounded Specialist (migration 0362, query_readings tool).
 *
 * DATASET
 *   "A long-tailed distribution time-series dataset in boiler equipment" — a
 *   coal-fired circulating-fluidised-bed boiler at Zhejiang Xin'an Chemical,
 *   China. 30 DCS tags (furnace pressures, drum pressure, flue/air/steam
 *   temperatures, air flows, O₂, ID-fan current and vibration, bed
 *   differential pressures, desuperheater spray flow, main steam flow) at
 *   5-second intervals, 2022-03-27 14:28 → 2022-04-01 14:28 (86 400 rows).
 *   Abnormal operation = outlet steam temperature (TE_8332A) outside
 *   530–545 °C (8.6 % of rows).
 *     Hu, W., Jiang, A., Chen, K., Zheng, J., Shang, W. & Cao, Z. (2025).
 *     Sci Data 12:742. https://doi.org/10.1038/s41597-025-05096-4
 *   Data: figshare doi:10.6084/m9.figshare.28868849 — public, CC0, no login:
 *     https://ndownloader.figshare.com/files/53975387  (xinan_completed_data.csv.zip)
 *   Legend (Table 1 + inferred units + the paper's band): scripts/boiler-columns.json.
 *
 * WHAT IT WRITES
 *   • ers_sensor_reading_points — one row per (tag, step) after averaging the
 *     5 s samples into --step-minutes buckets (default 1 → ~7 200 rows per
 *     tag, ~216k for all 30 tags; use --tags to load fewer).
 *   • ers_sensor_readings — the 50-point projection Predict reads, with
 *     alarm_low/high from the legend's band where it has one (TE_8332A), else
 *     the 1st/99th percentile of the loaded series (an envelope, not a limit).
 *   • then calls ers_rollup_my_reading_points() so 30/90-day windows work
 *     without waiting for the hourly cron.
 *   Timestamps are shifted so the series ENDS at --end (default: now), so a
 *   "last 7 days" question has an answer today.
 *
 * RUN (PowerShell, from repo root; provision the asset first with
 * scripts/provision-boiler-demo.mjs):
 *   $env:SEED_EMAIL="you@company.com"; $env:SEED_PASSWORD="…"
 *   node scripts/seed-boiler-history.mjs --csv C:\data\boiler\xinan_completed_data.csv --asset B-301
 * OPTIONS
 *   --columns path      legend (default scripts/boiler-columns.json)
 *   --tags a,b,c        only these columns (case-insensitive, suffix stripped)
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
const COLUMNS = arg('--columns', 'scripts/boiler-columns.json');
const ASSET_TAG = arg('--asset');
const STEP_MIN = Math.max(1, Number(arg('--step-minutes', '1')) || 1);
const END = arg('--end') ? new Date(arg('--end')) : new Date();
const ONLY = arg('--tags') ? new Set(arg('--tags').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) : null;
const CLEAN = has('--clean');
/** Skip the 216k-row points pass and only rewrite the projection (bands, last-50, trend). */
const PROJECTION_ONLY = has('--projection-only');
/**
 * Alarm lines on tags the legend does not band. Default: NONE — a percentile
 * of normal operation is an envelope, not a limit, and the alert scan's
 * "approaching" deadband turns an envelope into an alarm on every tag that
 * merely sits near its own p99 (15 false alerts on the first demo run).
 * --envelope-bands restores the p1/p99 behaviour if you want the twin's
 * deviation score to have something to work with.
 */
const ENVELOPE_BANDS = has('--envelope-bands');
const SOURCE = 'csv';   // the writer label 0236 reserves for file loads
/**
 * Optional, DEMO ONLY: --inject-fault TAG:+8%:3h multiplies the last 3 hours of
 * TAG by 1.08 before writing, so the regime detector has something to catch
 * on a record of a healthy plant. Every injected point is written with
 * source 'csv-injected' — visible in the table, removed by --clean, and never
 * mistaken for the dataset. The projection row for that tag is also updated.
 */
const INJECT = (() => {
    const v = arg('--inject-fault');
    if (!v) return null;
    const m = /^([^:]+):([+-]?\d+(?:\.\d+)?)%:(\d+(?:\.\d+)?)h$/i.exec(v.trim());
    if (!m) fail('--inject-fault expects TAG:+8%:3h');
    return { tag: m[1], factor: 1 + Number(m[2]) / 100, hours: Number(m[3]) };
})();

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
    const { error: e1, count } = await sb.from('ers_sensor_reading_points').delete({ count: 'exact' }).eq('asset_id', asset.id).in('source', [SOURCE, 'csv-injected']);
    if (e1) fail(`delete points: ${e1.message}`);
    const { error: e2 } = await sb.from('ers_sensor_readings').delete().eq('asset_id', asset.id);
    if (e2) fail(`delete projection: ${e2.message}`);
    const { error: e3 } = await sb.from('ers_reading_rollups_hourly').delete().eq('asset_id', asset.id);
    if (e3 && !/permission|policy/i.test(e3.message)) console.warn(`rollups not deleted (${e3.message}) — the hourly cron will overwrite them`);
    // A policy-filtered delete is reported as success with 0 rows. If points
    // are still visible after "deleting", say so and fail — a re-seed on top
    // doubles the series (burned 2026-09-24, fixed by the 0390 delete policy).
    const { count: left } = await sb.from('ers_sensor_reading_points').select('id', { count: 'exact', head: true }).eq('asset_id', asset.id).in('source', [SOURCE, 'csv-injected']);
    if ((count ?? 0) === 0 && (left ?? 0) > 0) fail(`--clean removed nothing but ${left} seeded points remain — the caller may not delete them (apply 0390 or clean as service role).`);
    console.log(`Removed ${count ?? '?'} seeded points for ${asset.tag}${left ? ` (${left} remain)` : ''}.`);
    process.exit(0);
}

// Legend: scripts/boiler-columns.json (Table 1 of the paper + inferred units +
// the paper's own band on the outlet steam temperature), or a
// "code,description,unit" CSV. Tags are matched after stripping the DCS
// suffix (".AV_0#") so the register carries PT_8313A, not PT_8313A.AV_0#.
const legend = new Map();
let stripSuffix = '';
if (COLUMNS) {
    try {
        const raw = readFileSync(COLUMNS, 'utf8');
        if (COLUMNS.endsWith('.json')) {
            const j = JSON.parse(raw);
            stripSuffix = j._strip_suffix || '';
            for (const [code, d] of Object.entries(j.columns || {})) legend.set(code.toLowerCase(), d);
        } else {
            for (const line of raw.split(/\r?\n/).slice(1)) {
                const cells = splitCsv(line);
                if (cells.length >= 2 && cells[0]) legend.set(cells[0].trim().toLowerCase(), { description: cells[1]?.trim() ?? '', unit: cells[2]?.trim() ?? '' });
            }
        }
        console.log(`Legend: ${legend.size} columns described (${COLUMNS}).`);
    } catch (e) {
        console.warn(`Legend not read (${e.message}) — tags will carry no units.`);
    }
}
const cleanTag = (h) => (stripSuffix && h.endsWith(stripSuffix) ? h.slice(0, -stripSuffix.length) : h).trim();

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
        header = cells.map((c) => cleanTag(c.trim()));
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
if (PROJECTION_ONLY) console.log('--projection-only: leaving ers_sensor_reading_points as it is.');
const injectFrom = INJECT ? END.getTime() - INJECT.hours * 3_600_000 : null;
if (INJECT) {
    const m = [...series.keys()].find((t) => t.toLowerCase() === INJECT.tag.toLowerCase());
    if (!m) fail(`--inject-fault: tag ${INJECT.tag} is not in the file`);
    INJECT.tag = m;
    console.log(`⚠ DEMO FAULT: ${m} × ${INJECT.factor} for the last ${INJECT.hours} h (source 'csv-injected').`);
}
for (const [tag, m] of series) {
    if (PROJECTION_ONLY) break;
    const unit = legend.get(tag.toLowerCase())?.unit || null;
    const injectHere = INJECT && tag === INJECT.tag;
    const pts = [...m.entries()].sort((a, b) => a[0] - b[0]).map(([b, agg]) => {
        const ts = b + shiftMs;
        const injected = injectHere && ts >= injectFrom;
        return {
            asset_id: asset.id, tag, ts: new Date(ts).toISOString(),
            value: round6((agg.sum / agg.n) * (injected ? INJECT.factor : 1)), unit,
            source: injected ? 'csv-injected' : SOURCE,
        };
    });
    // Re-running with an injection must overwrite, not skip, the affected rows.
    if (injectHere) {
        const { error } = await sb.from('ers_sensor_reading_points').delete().eq('asset_id', asset.id).eq('tag', tag).gte('ts', new Date(injectFrom).toISOString());
        if (error) fail(`clear injected window ${tag}: ${error.message}`);
    }
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
    const injectHere = INJECT && tag === INJECT.tag;
    const vals = [...m.entries()].sort((a, b) => a[0] - b[0]).map(([b, agg]) => round6((agg.sum / agg.n) * (injectHere && b + shiftMs >= injectFrom ? INJECT.factor : 1)));
    if (!vals.length) continue;
    const sorted = [...vals].sort((a, b) => a - b);
    const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    const leg = legend.get(tag.toLowerCase()) || {};
    const row = {
        asset_id: asset.id, tag,
        unit: legend.get(tag.toLowerCase())?.unit || '',
        current_value: vals[vals.length - 1],
        trend: vals.length > 1 ? (vals.at(-1) > vals.at(-2) ? 'rising' : vals.at(-1) < vals.at(-2) ? 'falling' : 'stable') : null,
        // The alarm line Predict reads: the paper's band where it has one;
        // otherwise nothing (or the p1/p99 envelope with --envelope-bands).
        alarm_low: leg.crit_low ?? (ENVELOPE_BANDS ? round6(q(0.01)) : null),
        alarm_high: leg.crit_high ?? (ENVELOPE_BANDS ? round6(q(0.99)) : null),
        // Deadband / persistence (0205) live on the reading DEFINITION, which
        // provision-boiler-demo.mjs writes from the legend and the live loader
        // merges through sensor_tag — not on this projection row.
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
