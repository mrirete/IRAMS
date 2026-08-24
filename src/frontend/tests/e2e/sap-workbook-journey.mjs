/**
 * SAP workbook UAT journey — the full Migration Center walk with SAP
 * field-name sheets, in a real browser against the running app.
 *
 * What the sheet profiles promise: a consultant pastes SAP migration-cockpit
 * sheets (TPLNR/EQUNR/MATNR/IDNRK/MPOBJ headers, title rows and all) into the
 * Migration Center phases and they import with zero column surgery. This
 * script IS that consultant:
 *
 *   Phase 1  Equipment sheet        → asset with EQUNR as equipment number + tag
 *   Phase 3  Material sheet         → inventory item (ERSA→SPARE, ABC A→critical, VERPR cost)
 *            Source List sheet      → preferred supplier created + linked (0296)
 *            Inventory Balance      → opening stock posted as a 561 movement
 *   Phase 4  Equipment BOM sheet    → BOM line linked via the EQUNR reference
 *   Phase 9  Measuring Point sheet  → reading point with alarm limit, NO phantom reading
 *            Measurement Documents  → historical reading logged by EQUNR
 *
 * After every phase the DATABASE is asserted, not the screen. Writes real
 * rows; everything carries the ZZSAPUAT prefix and is deleted afterwards.
 *
 * Usage:  SUPABASE_ACCESS_TOKEN=sbp_… IREAMS_ADMIN_PASSWORD=… \
 *           node tests/e2e/sap-workbook-journey.mjs
 */
import { chromium } from 'playwright';
import * as XLSX from 'xlsx';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const BASE = process.env.BASE || 'https://irams.vercel.app';
const SB = process.env.VITE_SUPABASE_URL || 'https://hacrebcfvyqdnjvilhqc.supabase.co';
const ANON = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhhY3JlYmNmdnlxZG5qdmlsaHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1Mjk5ODAsImV4cCI6MjA4NzEwNTk4MH0.F-2Fordc833NAuprdRBmm5s-Bd5fQsO0vxUK7_06AJ0';
const REF = new URL(SB).hostname.split('.')[0];
const TOK = process.env.SUPABASE_ACCESS_TOKEN;
const ADMIN = { email: 'admin001@cainergy.com', password: process.env.IREAMS_ADMIN_PASSWORD };
const P = 'ZZSAPUAT';

if (!TOK) { console.error('SUPABASE_ACCESS_TOKEN not set — needed to verify and clean up.'); process.exit(1); }
if (!ADMIN.password) { console.error('IREAMS_ADMIN_PASSWORD not set.'); process.exit(1); }

const sql = async (q, tries = 3) => {
    for (let i = 1; ; i++) {
        try {
            const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
                method: 'POST', headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: q }),
            });
            const t = await r.text();
            if (!r.ok) throw new Error(`query failed: ${t.slice(0, 300)}`);
            return JSON.parse(t);
        } catch (e) {
            // Transient network drops are common enough to retry; real SQL
            // errors repeat identically and still surface.
            if (i >= tries) throw e;
            await new Promise(r => setTimeout(r, 2000 * i));
        }
    }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const findings = [];
const pass = (msg) => console.log(`   ✓ ${msg}`);
const fail = (msg) => { console.log(`   ✗ ${msg}`); findings.push(msg); };
const check = (ok, msg) => (ok ? pass(msg) : fail(msg));

// ── The workbooks, exactly as a SAP consultant's sheets look ────────────────
const dir = mkdtempSync(join(tmpdir(), 'zzsapuat-'));
const files = [];
const wbFile = (name, rows) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
    const p = join(dir, name);
    XLSX.writeFile(wb, p);
    files.push(p);
    return p;
};
const TITLE = (t) => [[`Migration object: ${t}`], ['Load in phase order.'], ['Row 4 = SAP field name (keep).']];

const fEquipment = wbFile('equipment.xlsx', [
    ...TITLE('Equipment'),
    ['EQUNR', 'EQKTX', 'EQTYP', 'EQART', 'TPLNR', 'HEQUI', 'HERST', 'TYPBZ', 'SERGE', 'ABCKZ'],
    [`${P}-9001`, 'UAT probe pump (SAP sheet)', 'M', 'PUMP', '', '', 'KSB', 'Etanorm', `${P}-SN-1`, 'C'],
]);
const fMaterial = wbFile('material.xlsx', [
    ...TITLE('Product (Material)'),
    ['MATNR', 'MAKTX', 'MTART', 'MEINS', 'MFRNR', 'MINBE', 'MABST', 'MAABC', 'LGORT', 'LGPBE', 'VPRSV', 'STPRS', 'VERPR'],
    [`${P}-FLT`, 'UAT probe filter (SAP sheet)', 'ERSA', 'EA', 'Donaldson', '4', '16', 'A', `${P}-STORE`, 'C2-01', 'V', '', '245.00'],
]);
const fSourceList = wbFile('sourcelist.xlsx', [
    ...TITLE('Source List'),
    ['MATNR', 'WERKS', 'VDATU', 'BDATU', 'LIFNR', 'EKORG'],
    [`${P}-FLT`, '102A', '01.01.2026', '31.12.9999', `${P}-VEND`, '1030'],
]);
const fStock = wbFile('stock.xlsx', [
    ...TITLE('Inventory Balance'),
    ['MATNR', 'WERKS', 'LGORT', 'MENGE', 'MEINS', 'BUDAT', 'BWART'],
    [`${P}-FLT`, '102A', `${P}-STORE`, '8', 'EA', '17.08.2026', '561'],
]);
const fBom = wbFile('bom.xlsx', [
    ...TITLE('Equipment Bill of Material'),
    ['EQUNR', 'STLAN', 'POSNR', 'POSTP', 'IDNRK', 'MENGE', 'MEINS', 'POTX1'],
    [`${P}-9001`, '4', '0010', 'L', `${P}-FLT`, '4', 'EA', 'UAT critical spare'],
]);
const fMeasPoint = wbFile('measpoint.xlsx', [
    ...TITLE('Measuring Point'),
    ['MPOBJ', 'PSORT', 'PTTXT', 'ATNAM', 'MRNGU', 'ATVUP'],
    [`${P}-9001`, `${P}-VIB`, 'UAT DE bearing vibration', 'YB_VIB', 'mm/s', '7.1'],
]);
const fMeasDoc = wbFile('measdoc.xlsx', [
    ...TITLE('Measurement documents'),
    ['POINT', 'MPOBJ', 'PSORT', 'IDATE', 'ITIME', 'READG', 'CNTRR', 'MRNGU', 'MDTXT'],
    ['', `${P}-9001`, `${P}-VIB`, '14.02.2026', '09:15:00', '4.2', '', 'mm/s', 'UAT route reading'],
]);

// ── Browser helpers ─────────────────────────────────────────────────────────
async function runModal(page, file, label) {
    await page.setInputFiles('input[type="file"]', file);
    let text = '';
    for (let i = 0; i < 20; i++) {
        await sleep(1500);
        text = await page.evaluate(() => document.body.innerText || '');
        if (/Import \d+ of \d+/i.test(text)) break;
    }
    if (!/Import \d+ of \d+/i.test(text)) {
        if (/Missing required|Errors/i.test(text)) throw new Error(`${label}: validation blocked the sheet`);
        throw new Error(`${label}: never reached the validate step`);
    }
    await page.evaluate(() => [...document.querySelectorAll('button')]
        .find(b => /Import \d+ of \d+/i.test(b.textContent || '') && !b.disabled)?.click());
    for (let i = 0; i < 30; i++) {
        await sleep(1500);
        text = await page.evaluate(() => document.body.innerText || '');
        if (/Import Complete|finished with issues/i.test(text)) break;
    }
    if (!/Import Complete|finished with issues/i.test(text)) throw new Error(`${label}: import never completed`);
    const issues = /finished with issues/i.test(text);
    console.log(`   → ${label}: ${issues ? 'finished WITH ISSUES' : 'complete'}`);
    return text;
}

async function openPhase(page, buttonRe) {
    await page.goto(`${BASE}/admin/migration`, { waitUntil: 'domcontentloaded' });
    await sleep(5000);
    const clicked = await page.evaluate((reSrc) => {
        const re = new RegExp(reSrc, 'i');
        const b = [...document.querySelectorAll('button')].find(x => re.test(x.textContent || '') && !x.disabled);
        if (!b) return false;
        b.click();
        return true;
    }, buttonRe);
    if (!clicked) throw new Error(`phase button /${buttonRe}/ not found or locked`);
    await sleep(2000);
}

// ── Nothing left over from a previous run ───────────────────────────────────
const pre = await sql(`SELECT
    (SELECT count(*) FROM assets WHERE tag LIKE '${P}%') +
    (SELECT count(*) FROM inventory_items WHERE part_number LIKE '${P}%') +
    (SELECT count(*) FROM vendors WHERE code LIKE '${P}%' OR name LIKE '${P}%') AS n`);
if (Number(pre[0].n) > 0) console.log(`⚠ ${pre[0].n} leftover row(s) from a previous run — cleanup will sweep them\n`);

console.log(`SAP workbook UAT journey (${BASE})\n`);
const browser = await chromium.launch({ headless: true });

try {
    const auth = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify(ADMIN),
    })).json();
    if (!auth.access_token) throw new Error('admin sign-in failed');

    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    const seed = await ctx.newPage();
    await seed.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${REF}-auth-token`, JSON.stringify(auth)]);
    await seed.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await seed.close();
    const page = await ctx.newPage();
    page.on('pageerror', e => findings.push(`pageerror: ${String(e).slice(0, 120)}`));

    // ── Phase 1: Equipment sheet ────────────────────────────────────────────
    console.log('Phase 1 — Equipment sheet (EQUNR headers)');
    await openPhase(page, 'Import assets');
    await runModal(page, fEquipment, 'equipment');
    const a = await sql(`SELECT tag, equipment_number, manufacturer, hierarchy_level, criticality
                         FROM assets WHERE equipment_number = '${P}-9001'`);
    check(a.length === 1, 'asset row landed');
    if (a.length === 1) {
        check(a[0].tag === `${P}-9001`, `EQUNR became the tag (no TIDNR column): ${a[0].tag}`);
        check(a[0].manufacturer === 'KSB', 'HERST → manufacturer');
        check(a[0].hierarchy_level === 'EQUIPMENT', 'level defaulted to EQUIPMENT');
    }

    // ── Phase 3: Material, then Source List, then Opening Stock ────────────
    console.log('\nPhase 3 — Material sheet');
    await page.goto(`${BASE}/inventory?action=import`, { waitUntil: 'domcontentloaded' });
    await sleep(6000);
    await runModal(page, fMaterial, 'material');
    const m = await sql(`SELECT id, type, is_critical, unit_cost FROM inventory_items WHERE part_number = '${P}-FLT'`);
    check(m.length === 1, 'inventory item landed');
    if (m.length === 1) {
        check(m[0].type === 'SPARE', 'MTART ERSA → SPARE');
        check(m[0].is_critical === true, 'ABC A → critical');
        check(Number(m[0].unit_cost) === 245, 'VPRSV=V → VERPR price 245');
    }

    console.log('\nPhase 3 — Source List sheet (preferred supplier)');
    await page.goto(`${BASE}/inventory?action=import`, { waitUntil: 'domcontentloaded' });
    await sleep(6000);
    await runModal(page, fSourceList, 'source list');
    const v = await sql(`SELECT ii.preferred_vendor_id, ve.name FROM inventory_items ii
                         LEFT JOIN vendors ve ON ve.id = ii.preferred_vendor_id
                         WHERE ii.part_number = '${P}-FLT'`);
    check(v.length === 1 && !!v[0].preferred_vendor_id, 'preferred supplier linked (0296)');
    check(v.length === 1 && v[0].name === `${P}-VEND`, `vendor auto-created from LIFNR: ${v[0]?.name}`);

    console.log('\nPhase 3 — Inventory Balance sheet (opening stock, 561)');
    await page.goto(`${BASE}/inventory?action=import`, { waitUntil: 'domcontentloaded' });
    await sleep(6000);
    await runModal(page, fStock, 'opening stock');
    const s = await sql(`SELECT ii.stock_on_hand,
                         (SELECT movement_type FROM inventory_transactions t WHERE t.item_id = ii.id ORDER BY timestamp DESC LIMIT 1) AS mt,
                         (SELECT quantity FROM inventory_transactions t WHERE t.item_id = ii.id ORDER BY timestamp DESC LIMIT 1) AS qty
                         FROM inventory_items ii WHERE ii.part_number = '${P}-FLT'`);
    check(s.length === 1 && Number(s[0].stock_on_hand) === 8, `opening stock on hand = ${s[0]?.stock_on_hand}`);
    check(s.length === 1 && s[0].mt === '561', `movement type = ${s[0]?.mt} (SAP opening-balance vocabulary)`);

    // ── Phase 4: BOM sheet, linked via EQUNR ────────────────────────────────
    console.log('\nPhase 4 — Equipment BOM sheet (EQUNR reference)');
    await openPhase(page, 'Import bills of materials');
    await runModal(page, fBom, 'bom');
    const b = await sql(`SELECT ab.quantity, ab.inventory_item_id FROM asset_bom ab
                         JOIN assets a2 ON a2.id = ab.asset_id
                         WHERE a2.equipment_number = '${P}-9001'`);
    check(b.length === 1, 'BOM line landed on the asset RESOLVED BY EQUNR');
    check(b.length === 1 && !!b[0].inventory_item_id, 'component linked to the material (IDNRK)');

    // ── Phase 9: Measuring point (definition-only), then history ───────────
    console.log('\nPhase 9 — Measuring Point sheet (definition-only)');
    await openPhase(page, 'Import meter');
    await runModal(page, fMeasPoint, 'measuring point');
    const d = await sql(`SELECT rd.name, rd.unit, rd.max_warning,
                         (SELECT count(*) FROM reading_logs rl WHERE rl.definition_id = rd.id) AS logs
                         FROM reading_definitions rd JOIN assets a3 ON a3.id = rd.asset_id
                         WHERE a3.equipment_number = '${P}-9001'`);
    check(d.length === 1, 'reading point created (asset resolved by EQUNR)');
    if (d.length === 1) {
        check(d[0].name === 'UAT DE bearing vibration', 'PTTXT → point name');
        check(Number(d[0].max_warning) === 7.1, 'ATVUP → alarm limit 7.1');
        check(Number(d[0].logs) === 0, 'definition-only: no phantom reading logged');
    }

    console.log('\nPhase 9 — Measurement Documents sheet (history)');
    await openPhase(page, 'Import meter');
    await runModal(page, fMeasDoc, 'measurement docs');
    const l = await sql(`SELECT rl.reading_value FROM reading_logs rl
                         JOIN assets a4 ON a4.id = rl.asset_id
                         WHERE a4.equipment_number = '${P}-9001'`);
    check(l.length === 1 && Number(l[0].reading_value) === 4.2, `historical reading logged: ${l[0]?.reading_value}`);

    await ctx.close();
} catch (e) {
    fail(e.message);
} finally {
    await browser.close();
    files.forEach(f => { try { unlinkSync(f); } catch { /* ignore */ } });

    // ── Cleanup, FK order, always ───────────────────────────────────────────
    const gone = await sql(`
        WITH it AS (SELECT id FROM inventory_items WHERE part_number LIKE '${P}%'),
             aa AS (SELECT id FROM assets WHERE tag LIKE '${P}%' OR equipment_number LIKE '${P}%'),
             d1 AS (DELETE FROM inventory_transactions WHERE item_id IN (SELECT id FROM it) RETURNING 1),
             d2 AS (DELETE FROM inventory_stock WHERE item_id IN (SELECT id FROM it) RETURNING 1),
             d3 AS (DELETE FROM asset_bom WHERE asset_id IN (SELECT id FROM aa) RETURNING 1),
             d4 AS (DELETE FROM reading_logs WHERE asset_id IN (SELECT id FROM aa) RETURNING 1),
             d5 AS (DELETE FROM reading_definitions WHERE asset_id IN (SELECT id FROM aa) RETURNING 1),
             d6 AS (DELETE FROM assets WHERE id IN (SELECT id FROM aa) RETURNING 1),
             d7 AS (DELETE FROM inventory_items WHERE id IN (SELECT id FROM it) RETURNING 1),
             d8 AS (DELETE FROM inventory_locations WHERE name LIKE '${P}%' OR code LIKE '${P}%' RETURNING 1),
             d9 AS (DELETE FROM vendors WHERE name LIKE '${P}%' OR code LIKE '${P}%' RETURNING 1)
        SELECT (SELECT count(*) FROM d1)+(SELECT count(*) FROM d2)+(SELECT count(*) FROM d3)
             + (SELECT count(*) FROM d4)+(SELECT count(*) FROM d5)+(SELECT count(*) FROM d6)
             + (SELECT count(*) FROM d7)+(SELECT count(*) FROM d8)+(SELECT count(*) FROM d9) AS removed`).catch((e) => {
        findings.push(`cleanup failed: ${e.message} — ${P}% rows may remain`);
        return [{ removed: '?' }];
    });
    console.log(`\ncleanup: removed ${gone[0].removed} row(s) carrying the ${P} prefix`);
    const left = await sql(`SELECT
        (SELECT count(*) FROM assets WHERE tag LIKE '${P}%') +
        (SELECT count(*) FROM inventory_items WHERE part_number LIKE '${P}%') +
        (SELECT count(*) FROM vendors WHERE code LIKE '${P}%' OR name LIKE '${P}%') AS n`).catch(() => [{ n: '?' }]);
    console.log(`leftovers: ${left[0].n}`);
    if (String(left[0].n) !== '0') findings.push(`${left[0].n} leftover row(s) after cleanup`);
}

console.log('\n' + '═'.repeat(64));
if (findings.length === 0) console.log('SAP WORKBOOK JOURNEY PASSED — every sheet imported and verified in the DB.');
else { console.log(`${findings.length} finding(s):`); findings.forEach(f => console.log(`  • ${f}`)); }
process.exit(findings.length ? 1 : 0);
