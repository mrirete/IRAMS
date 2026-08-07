/**
 * S2 — the import journey, and whether the success screen tells the truth.
 *
 * This is the first thing a new customer does, and it has never been tested.
 * It is also the exact shape of the defect this codebase has shipped four
 * times: a screen reading "Import Complete! 5 items" while the database
 * received nothing. `scan-silent-success.mjs` exists because of those.
 *
 * So the assertion that matters is not "did the wizard finish" — it is:
 *
 *     do the counts on the done screen match rows ACTUALLY in the database?
 *
 * Everything else here is scaffolding to get to that question.
 *
 * The wizard is upload → AI proposes a column mapping → human confirms →
 * deterministic apply → quality review → commit. The AI step degrades to manual
 * mapping if the agent is unavailable, so a failure there is reported rather
 * than silently passed.
 *
 * Writes real rows, then deletes them. Every tag and WO number carries the
 * ZZIMPORTTEST- prefix so cleanup is exact and anything left behind is obvious.
 *
 * Usage:  SUPABASE_ACCESS_TOKEN=sbp_… node tests/e2e/import-journey.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const BASE = process.env.BASE || 'https://irams.vercel.app';
const SB = process.env.VITE_SUPABASE_URL || 'https://hacrebcfvyqdnjvilhqc.supabase.co';
const ANON = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhhY3JlYmNmdnlxZG5qdmlsaHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1Mjk5ODAsImV4cCI6MjA4NzEwNTk4MH0.F-2Fordc833NAuprdRBmm5s-Bd5fQsO0vxUK7_06AJ0';
const REF = new URL(SB).hostname.split('.')[0];
const PROJECT = process.env.SUPABASE_PROJECT_REF || REF;
const TOK = process.env.SUPABASE_ACCESS_TOKEN;
// Only an admin can commit — import_batches is admin-only by RLS.
const ADMIN = { email: 'admin001@cainergy.com', password: process.env.IREAMS_ADMIN_PASSWORD };

const PREFIX = 'ZZIMPORTTEST';
const N_ASSETS = 4;
const N_WOS = 6;

if (!TOK) { console.error('SUPABASE_ACCESS_TOKEN is not set — needed to verify and clean up.'); process.exit(1); }

const sql = async (q) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
        method: 'POST', headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`query failed: ${t.slice(0, 200)}`);
    return JSON.parse(t);
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const findings = [];

// ── A register + history file, headers named exactly as the canonical fields ─
// Deliberately unambiguous: the point of this test is the COMMIT, not whether
// the mapper can guess an obscure SAP column name.
const rows = [['tag', 'name', 'criticality', 'manufacturer', 'wo_number', 'title', 'type', 'status', 'created_at', 'total_cost']];
for (let i = 0; i < N_WOS; i++) {
    const a = i % N_ASSETS;
    rows.push([
        `${PREFIX}-A${a}`, `Import probe asset ${a}`, 'C', 'ProbeCo',
        `${PREFIX}-WO${i}`, `Probe work order ${i}`, 'CM', 'CLOSED',
        '2026-01-15', String(100 + i),
    ]);
}
const csv = rows.map(r => r.join(',')).join('\n');
const file = join(tmpdir(), `${PREFIX}.csv`);
writeFileSync(file, csv, 'utf8');
console.log(`S2 — import journey (${BASE})`);
console.log(`file: ${N_WOS} work orders across ${N_ASSETS} assets, all prefixed ${PREFIX}\n`);

// Nothing from a previous run should be present.
const pre = await sql(`SELECT
    (SELECT count(*) FROM assets      WHERE tag       LIKE '${PREFIX}%') AS assets,
    (SELECT count(*) FROM work_orders WHERE wo_number LIKE '${PREFIX}%') AS wos`);
console.log(`before: ${pre[0].assets} assets, ${pre[0].wos} work orders with that prefix`);

const browser = await chromium.launch({ headless: true });
let done = null;

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

    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(String(e).slice(0, 140)));

    await p.goto(`${BASE}/specialist/import`, { waitUntil: 'domcontentloaded' });
    await sleep(8000);

    console.log('\n1. upload');
    await p.setInputFiles('input[type="file"]', file);
    // The AI mapping call can take a while; poll for the step to advance.
    let stepText = '';
    for (let i = 0; i < 40; i++) {
        await sleep(3000);
        stepText = await p.evaluate(() => document.querySelector('main')?.innerText || '');
        if (/Apply mapping & review/i.test(stepText)) break;
    }
    const reachedMap = /Apply mapping & review/i.test(stepText);
    console.log(`   → mapping step reached: ${reachedMap ? 'yes' : 'NO'}`);
    if (/could not produce a mapping|unavailable right now/i.test(stepText)) {
        console.log('   ⚠ the Specialist could not map automatically — manual mapping needed, journey stops here');
        findings.push('S2: automatic column mapping unavailable');
    }
    if (!reachedMap) throw new Error('never reached the mapping step');

    console.log('2. apply mapping → review');
    await p.evaluate(() => [...document.querySelectorAll('button')]
        .find(b => /Apply mapping & review/i.test(b.textContent || ''))?.click());
    await sleep(9000);

    console.log('3. commit');
    const committed = await p.evaluate(() => {
        const b = [...document.querySelectorAll('button')]
            .find(x => /commit|import|finish/i.test(x.textContent || '') && !x.disabled && x.getClientRects().length);
        if (!b) return null;
        b.click();
        return (b.textContent || '').trim();
    });
    console.log(`   → clicked: ${committed ?? 'NO COMMIT BUTTON FOUND'}`);
    if (!committed) throw new Error('no commit button');
    await sleep(15000);

    done = await p.evaluate(() => document.querySelector('main')?.innerText || '');
    const m = /(\d+)\s+work orders and\s+(\d+)\s+new assets imported/i.exec(done);
    console.log(`\n4. done screen says: ${m ? `${m[1]} work orders, ${m[2]} new assets` : '(counts not found)'}`);
    if (errs.length) findings.push(`S2: page error during import — ${errs[0]}`);

    // ── The assertion this whole file exists for ────────────────────────────
    const post = await sql(`SELECT
        (SELECT count(*) FROM assets      WHERE tag       LIKE '${PREFIX}%') AS assets,
        (SELECT count(*) FROM work_orders WHERE wo_number LIKE '${PREFIX}%') AS wos`);
    const dbAssets = Number(post[0].assets) - Number(pre[0].assets);
    const dbWos = Number(post[0].wos) - Number(pre[0].wos);
    console.log(`   database actually has:  ${dbWos} work orders, ${dbAssets} new assets`);

    if (!m) {
        findings.push('S2: could not read the counts off the done screen');
    } else {
        const claimedWos = Number(m[1]), claimedAssets = Number(m[2]);
        if (claimedWos !== dbWos) findings.push(`S2 SILENT SUCCESS: screen claims ${claimedWos} work orders, database has ${dbWos}`);
        if (claimedAssets !== dbAssets) findings.push(`S2 SILENT SUCCESS: screen claims ${claimedAssets} new assets, database has ${dbAssets}`);
        if (claimedWos === dbWos && claimedAssets === dbAssets) {
            console.log('\n   ✓ the screen and the database agree');
        }
    }
    if (dbWos !== N_WOS) findings.push(`S2: file had ${N_WOS} work orders, ${dbWos} landed`);

    await ctx.close();
} catch (e) {
    findings.push(`S2: ${e.message}`);
    console.log(`\n   ✗ ${e.message}`);
} finally {
    await browser.close();
    try { unlinkSync(file); } catch { /* ignore */ }

    // Always clean up, even if the journey failed part-way.
    const gone = await sql(`
        WITH w AS (DELETE FROM work_orders WHERE wo_number LIKE '${PREFIX}%' RETURNING 1),
             a AS (DELETE FROM assets      WHERE tag       LIKE '${PREFIX}%' RETURNING 1)
        SELECT (SELECT count(*) FROM w) AS wos, (SELECT count(*) FROM a) AS assets`);
    console.log(`\ncleanup: removed ${gone[0].wos} work order(s), ${gone[0].assets} asset(s)`);
    await sql(`DELETE FROM import_batches WHERE file_name LIKE '${PREFIX}%'`).catch(() => {});
}

console.log('\n' + '═'.repeat(64));
if (findings.length === 0) console.log('S2 PASSED — import writes what it claims to write.');
else { console.log(`${findings.length} finding(s):`); findings.forEach(f => console.log(`  • ${f}`)); }
process.exit(findings.length ? 1 : 0);
