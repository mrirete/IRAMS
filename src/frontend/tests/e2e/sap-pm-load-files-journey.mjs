/**
 * SAP PM load files — the consultant's Maintenance Plan/Item and General Task
 * List workbooks through Recurring Jobs › Import, in a real browser against
 * the running app. Proves the page handlers the unit tests cannot reach:
 *
 *   1. Equipment sheet (Migration Center)       → two probe assets
 *   2. Maintenance_Plan_Item.xlsx as schedules  → one schedule per item, cadence
 *      from the plan text, origin stamped with plan / task list / strategy
 *   3. General_Task_List.xlsx as job plans      → operations attach by task list;
 *      the annual package becomes a sibling schedule "<code>-12M"
 *   4. The same task list again                 → idempotent: no second sibling
 *
 * The workbooks are the real load files (PM_FILES_DIR) with the equipment
 * numbers, plan, item and task-list keys prefixed ZZSAPPM so every row can be
 * found and deleted afterwards. The DATABASE is asserted, not the screen.
 *
 * Usage:  BASE=http://localhost:5173 PM_FILES_DIR=<dir with the 3 xlsx> \
 *         SUPABASE_ACCESS_TOKEN=sbp_… IREAMS_ADMIN_PASSWORD=… \
 *         node tests/e2e/sap-pm-load-files-journey.mjs
 */
import { chromium } from 'playwright';
import * as XLSX from 'xlsx';
import { mkdtempSync, unlinkSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const BASE = process.env.BASE || 'http://localhost:5173';
const SB = process.env.VITE_SUPABASE_URL || 'https://hacrebcfvyqdnjvilhqc.supabase.co';
const ANON = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhhY3JlYmNmdnlxZG5qdmlsaHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1Mjk5ODAsImV4cCI6MjA4NzEwNTk4MH0.F-2Fordc833NAuprdRBmm5s-Bd5fQsO0vxUK7_06AJ0';
const REF = new URL(SB).hostname.split('.')[0];
const TOK = process.env.SUPABASE_ACCESS_TOKEN;
const ADMIN = { email: 'admin001@cainergy.com', password: process.env.IREAMS_ADMIN_PASSWORD };
const DIR = process.env.PM_FILES_DIR;
const P = 'ZZSAPPM';

if (!TOK) { console.error('SUPABASE_ACCESS_TOKEN not set — needed to verify and clean up.'); process.exit(1); }
if (!ADMIN.password) { console.error('IREAMS_ADMIN_PASSWORD not set.'); process.exit(1); }
if (!DIR) { console.error('PM_FILES_DIR not set — the folder holding the three SAMPLE_Load_File_*.xlsx.'); process.exit(1); }

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

// ── The real load files, keys prefixed so the rows are ours ────────────────
const KEYS = {
    'ES0654503': `${P}-P101`, 'ES0654588': `${P}-M101`,
    '50099001': `${P}-50099001`, '50099002': `${P}-50099002`,
    '60099001': `${P}-60099001`, '60099002': `${P}-60099002`,
    '30009001': `${P}-30009001`, '30009002': `${P}-30009002`,
};
const tmp = mkdtempSync(join(tmpdir(), 'zzsappm-'));
const files = [];
const prefixed = (name) => {
    const wb = XLSX.read(readFileSync(join(DIR, `SAMPLE_Load_File_${name}.xlsx`)), { type: 'buffer' });
    const out = XLSX.utils.book_new();
    for (const s of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[s], { header: 1, defval: '', raw: false })
            .map(r => r.map(c => KEYS[String(c).trim()] ?? c));
        XLSX.utils.book_append_sheet(out, XLSX.utils.aoa_to_sheet(rows), s);
    }
    const p = join(tmp, `${name}.xlsx`);
    writeFileSync(p, XLSX.write(out, { type: "buffer", bookType: "xlsx" }));
    files.push(p);
    return p;
};
const fPlan = prefixed('Maintenance_Plan_Item');
const fTaskList = prefixed('General_Task_List');
const fEquipment = (() => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['Migration object: Equipment'], ['Load after functional locations.'], ['Row 4 = SAP field name (keep).'],
        ['EQUNR', 'EQKTX', 'EQTYP', 'EQART', 'TPLNR', 'HEQUI', 'HERST', 'ABCKZ'],
        [`${P}-P101`, 'UAT centrifugal pump P-101 (SAP PM load)', 'M', 'PUMP', '', '', 'KSB', 'C'],
        [`${P}-M101`, 'UAT pump drive motor M-101 (SAP PM load)', 'M', 'MOTOR', '', '', 'ABB', 'C'],
    ]), 'Sheet1');
    const p = join(tmp, 'equipment.xlsx');
    writeFileSync(p, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    files.push(p);
    return p;
})();

// ── Browser helpers ─────────────────────────────────────────────────────────
const bodyText = (page) => page.evaluate(() => document.body.innerText || '');
async function clickButton(page, re) {
    return page.evaluate((src) => {
        const r = new RegExp(src, 'i');
        const b = [...document.querySelectorAll('button')].find(x => r.test(x.textContent || '') && !x.disabled);
        if (!b) return false; b.click(); return true;
    }, re.source);
}
async function runModal(page, file, label, typeCard) {
    if (typeCard) {
        for (let i = 0; i < 10 && !(await clickButton(page, typeCard)); i++) await sleep(1000);
        await sleep(800);
    }
    await page.setInputFiles('input[type="file"]', file);
    let text = '';
    for (let i = 0; i < 20; i++) {
        await sleep(1500);
        text = await bodyText(page);
        if (/Import \d+ of \d+/i.test(text)) break;
    }
    if (!/Import \d+ of \d+/i.test(text)) {
        if (/Missing required|Errors/i.test(text)) throw new Error(`${label}: validation blocked the sheet`);
        throw new Error(`${label}: never reached the validate step`);
    }
    await clickButton(page, /Import \d+ of \d+/);
    for (let i = 0; i < 30; i++) {
        await sleep(1500);
        text = await bodyText(page);
        if (/Import Complete|finished with issues/i.test(text)) break;
    }
    if (!/Import Complete|finished with issues/i.test(text)) throw new Error(`${label}: import never completed`);
    console.log(`   → ${label}: ${/finished with issues/i.test(text) ? 'finished WITH ISSUES' : 'complete'}`);
    return text;
}
async function openPhase(page, buttonRe) {
    await page.goto(`${BASE}/admin/migration`, { waitUntil: 'domcontentloaded' });
    await sleep(5000);
    if (!(await clickButton(page, buttonRe))) throw new Error(`phase button /${buttonRe.source}/ not found or locked`);
    await sleep(2000);
}
async function openRecurringImport(page) {
    await page.goto(`${BASE}/recurring-work?action=import`, { waitUntil: 'domcontentloaded' });
    await sleep(6000);
}

const cleanup = async () => sql(`
    WITH aa AS (SELECT id FROM assets WHERE tag LIKE '${P}%' OR equipment_number LIKE '${P}%'),
         d1 AS (DELETE FROM recurring_work WHERE code LIKE '${P}%' OR asset_id IN (SELECT id::text FROM aa) RETURNING 1),
         d2 AS (DELETE FROM reading_definitions WHERE asset_id IN (SELECT id FROM aa) RETURNING 1),
         d3 AS (DELETE FROM assets WHERE id IN (SELECT id FROM aa) RETURNING 1)
    SELECT (SELECT count(*) FROM d1) + (SELECT count(*) FROM d2) + (SELECT count(*) FROM d3) AS removed`);

const pre = await sql(`SELECT (SELECT count(*) FROM assets WHERE tag LIKE '${P}%') + (SELECT count(*) FROM recurring_work WHERE code LIKE '${P}%') AS n`);
if (Number(pre[0].n) > 0) { console.log(`⚠ ${pre[0].n} leftover row(s) from a previous run — sweeping first`); await cleanup(); }

console.log(`SAP PM load-file journey (${BASE})\n`);
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

    // ── 1. Probe assets ────────────────────────────────────────────────────
    console.log('1 — Equipment sheet → two probe assets');
    await openPhase(page, /Import assets/);
    await runModal(page, fEquipment, 'equipment');
    const a = await sql(`SELECT id, tag FROM assets WHERE tag IN ('${P}-P101', '${P}-M101') ORDER BY tag`);
    check(a.length === 2, `both probe assets landed (${a.map(x => x.tag).join(', ')})`);
    const pumpId = a.find(x => x.tag === `${P}-P101`)?.id;

    // ── 2. Maintenance plan workbook → schedules ───────────────────────────
    console.log('\n2 — Maintenance_Plan_Item.xlsx → PM schedules (Recurring Jobs › Import › Recurring Jobs)');
    await openRecurringImport(page);
    const t2 = await runModal(page, fPlan, 'maintenance items', /Recurring Jobs/);
    const s = await sql(`SELECT code, asset_id, schedule_type, frequency_interval, frequency_unit, job_type, priority_code,
                                next_due_date::date::text AS due, origin
                         FROM recurring_work WHERE code LIKE '${P}-600%' ORDER BY code`);
    check(s.length === 2, `two schedules landed, one per maintenance item (${s.map(x => x.code).join(', ')})`);
    const pump = s.find(x => x.code === `${P}-60099001`);
    if (pump) {
        check(pump.asset_id === pumpId, 'schedule sits on the pump resolved by EQUNR');
        check(pump.schedule_type === 'TIME' && Number(pump.frequency_interval) === 1 && /^months$/i.test(pump.frequency_unit),
            `cadence 1 month from the plan text "1M/12M,…" (${pump.frequency_interval} ${pump.frequency_unit})`);
        check(pump.due === '2026-11-01', `next due = start of cycle + 1 month (${pump.due})`);
        check(pump.job_type === 'Preventive', `ILART 002 → ${pump.job_type}`);
        const o = pump.origin || {};
        check(o.source === 'sap_load_file' && o.task_list === `${P}-30009001/01`, `origin carries the task list (${o.task_list})`);
        check(o.strategy === 'MONWOH' && o.cadence_from === 'plan_text', `origin says strategy ${o.strategy}, cadence from ${o.cadence_from}`);
    }
    check(/work centre "MNMEC-PP" not found/i.test(t2), 'unknown SAP work centre reported, not silently dropped');

    // ── 3. Task list workbook → job plans, split by package ────────────────
    console.log('\n3 — General_Task_List.xlsx → job plans (operations attach by task list; annual package splits)');
    await openRecurringImport(page);
    const t3 = await runModal(page, fTaskList, 'task list operations', /Job Plans/);
    const j = await sql(`SELECT code, frequency_interval, frequency_unit, origin,
                                jsonb_array_length(COALESCE(templates->'tasks', '[]'::jsonb)) AS n_tasks,
                                (SELECT string_agg(t->>'operationNo', ',' ORDER BY (t->>'sequence')::int) FROM jsonb_array_elements(COALESCE(templates->'tasks', '[]'::jsonb)) t) AS ops
                         FROM recurring_work WHERE code LIKE '${P}-60099001%' ORDER BY code`);
    check(j.length === 2, `the pump item became two schedules: ${j.map(x => x.code).join(', ')}`);
    const base = j.find(x => x.code === `${P}-60099001`), sib = j.find(x => x.code === `${P}-60099001-12M`);
    check(!!base && Number(base.n_tasks) === 2 && base.ops === '0010,0020', `monthly schedule holds operations ${base?.ops}`);
    check(!!sib && Number(sib.n_tasks) === 1 && sib.ops === '0030', `annual sibling holds operation ${sib?.ops}`);
    check(!!sib && Number(sib.frequency_interval) === 12 && /^months$/i.test(sib.frequency_unit), `sibling cadence 12 months (${sib?.frequency_interval} ${sib?.frequency_unit})`);
    check(!!sib && sib.origin?.split_from === `${P}-60099001` && sib.origin?.package === '12', `sibling origin: split from ${sib?.origin?.split_from}, package ${sib?.origin?.package}`);
    check(/became its own schedule/i.test(t3), 'the split is explained on the completion screen');
    const m = await sql(`SELECT count(*) AS n FROM recurring_work WHERE code LIKE '${P}-60099002%'`);
    check(Number(m[0].n) === 2, `the motor item split the same way (${m[0].n} schedules)`);

    // ── 4. Same task list again → idempotent ───────────────────────────────
    console.log('\n4 — the same task list again → no duplicate siblings');
    await openRecurringImport(page);
    await runModal(page, fTaskList, 'task list operations (again)', /Job Plans/);
    const again = await sql(`SELECT code, (SELECT string_agg(t->>'operationNo', ',' ORDER BY (t->>'sequence')::int)
                                            FROM jsonb_array_elements(COALESCE(templates->'tasks', '[]'::jsonb)) t) AS ops
                             FROM recurring_work WHERE code LIKE '${P}-600%' ORDER BY code`);
    check(again.length === 4, `still four schedules after re-import (${again.map(x => x.code).join(', ')})`);
    const sib2 = again.find(x => x.code === `${P}-60099001-12M`);
    check(sib2?.ops === '0030', `the sibling still holds only its own operation (${sib2?.ops})`);
    check(again.find(x => x.code === `${P}-60099001`)?.ops === '0010,0020', 'the base still holds the monthly operations');

    await ctx.close();
} catch (e) {
    fail(e.message);
} finally {
    await browser.close();
    try {
        const gone = await cleanup();
        console.log(`\ncleanup: removed ${gone[0].removed} row(s) carrying the ${P} prefix`);
    } catch (e) {
        findings.push(`cleanup failed: ${e.message} — ${P}% rows may remain`);
    }
    for (const f of files) { try { unlinkSync(f); } catch { /* ignore */ } }
    const left = await sql(`SELECT (SELECT count(*) FROM assets WHERE tag LIKE '${P}%') + (SELECT count(*) FROM recurring_work WHERE code LIKE '${P}%') AS n`);
    if (String(left[0].n) !== '0') findings.push(`${left[0].n} leftover row(s) after cleanup`);
}

console.log(findings.length ? `\n${findings.length} finding(s):\n - ${findings.join('\n - ')}` : '\nAll checks passed.');
process.exit(findings.length ? 1 : 0);
