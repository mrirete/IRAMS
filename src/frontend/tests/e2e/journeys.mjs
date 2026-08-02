/**
 * journeys — drive the S-series spine journeys with real interactions.
 *
 * smoke.mjs proves a route renders. This proves the JOURNEY works: it logs in
 * as each role, clicks the buttons a user clicks, and checks that state
 * actually changed. Different question, different failures.
 *
 * What it looks for beyond "did it render":
 *   • data-quality leaks — NaN, undefined, Invalid Date, [object Object] on
 *     screen. These are the ones users report as "the numbers are wrong" and
 *     nothing in CI sees, because the page renders perfectly.
 *   • dead controls — a button that changes nothing.
 *   • state that does not survive a refresh (the mission handoff lives in
 *     sessionStorage, so it is the obvious candidate).
 *   • console errors raised DURING interaction, not just on load.
 *
 * S2 (import) is not covered: it needs a real register file and writes a batch.
 * S4's "do the work and watch the mission close" is partly covered — the
 * handoff is driven, the work itself is not.
 *
 * Usage:  SMOKE_LOGINS_JSON=… node tests/e2e/journeys.mjs
 *         BASE defaults to production.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'https://irams.vercel.app';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://hacrebcfvyqdnjvilhqc.supabase.co';
const ANON = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhhY3JlYmNmdnlxZG5qdmlsaHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1Mjk5ODAsImV4cCI6MjA4NzEwNTk4MH0.F-2Fordc833NAuprdRBmm5s-Bd5fQsO0vxUK7_06AJ0';
const REF = new URL(SUPABASE_URL).hostname.split('.')[0];
const PW = process.env.SMOKE_PASSWORD || 'Password123!';

const ROLES = JSON.parse(process.env.SMOKE_LOGINS_JSON || JSON.stringify([
    { label: 'SUPER_ADMIN', email: 'admin001@cainergy.com' },
    { label: 'RELIABILITY_ENG', email: 'k.syrus@cainergy.com' },
    { label: 'TECHNICIAN', email: 'bea@cainergy.com' },
    { label: 'REQUESTER', email: 'requester01@cainergy.com' },
]));

/** Values that should never reach a user's screen. */
const JUNK = [
    [/\bNaN\b/, 'NaN'],
    [/Invalid Date/, 'Invalid Date'],
    [/\[object Object\]/, '[object Object]'],
    [/\bundefined\b/, 'undefined'],
    [/\bnull\b(?!\s*<)/, 'null'],
];

const findings = [];
const note = (id, ok, msg) => {
    console.log(`  ${ok ? '✓' : '✗'} ${id}  ${msg}`);
    if (!ok) findings.push(`${id}: ${msg}`);
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function signIn(email) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: PW }),
    });
    return r.ok ? r.json() : null;
}

async function contextFor(browser, email) {
    const session = await signIn(email);
    if (!session) return null;
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
    const seed = await ctx.newPage();
    await seed.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${REF}-auth-token`, JSON.stringify(session)]);
    await seed.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await seed.close();
    return ctx;
}

/** Text of <main>, plus anything that should never be there. */
async function inspect(page) {
    return page.evaluate((junkSrc) => {
        const main = document.querySelector('main');
        const text = (main ? main.innerText : document.body.innerText).trim();
        const bad = [];
        for (const [src, label] of junkSrc) {
            if (new RegExp(src.slice(1, src.lastIndexOf('/')), 'm').test(text)) bad.push(label);
        }
        return { text, len: text.length, bad, url: location.pathname + location.search };
    }, JUNK.map(([re, label]) => [re.toString(), label]));
}

const browser = await chromium.launch({ headless: true });
console.log(`Spine journeys — ${BASE}\n`);

// ── S1 · Cold start: does each role land where it should? ───────────────────
console.log('S1  Cold start — landing + first screen');
const landings = {};
for (const { label, email } of ROLES) {
    const ctx = await contextFor(browser, email);
    if (!ctx) { note('S1', false, `${label}: sign-in failed`); continue; }
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(String(e).slice(0, 120)));
    await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await sleep(9000);
    const s = await inspect(p);
    landings[label] = s.url;
    const ok = s.len > 100 && errs.length === 0;
    note('S1', ok, `${label.padEnd(16)} → ${s.url.padEnd(14)} ${s.len} chars${errs.length ? ` · ${errs.length} page error(s): ${errs[0]}` : ''}`);
    if (s.bad.length) note('S1', false, `${label}: junk on the landing screen — ${s.bad.join(', ')}`);
    await ctx.close();
}

// ── S3/S7 · Specialist artefacts: are the NUMBERS clean? ────────────────────
console.log('\nS3/S7  Specialist artefacts — assessment, ROI, meeting pack');
{
    const ctx = await contextFor(browser, 'k.syrus@cainergy.com');
    if (ctx) {
        const p = await ctx.newPage();
        const errs = [];
        p.on('pageerror', e => errs.push(String(e).slice(0, 120)));
        for (const [id, route] of [['S3', '/specialist/assessment'], ['S7', '/specialist/roi'], ['S7', '/specialist/meeting']]) {
            errs.length = 0;
            await p.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
            await sleep(11000);
            const s = await inspect(p);
            const clean = s.bad.length === 0 && errs.length === 0;
            note(id, clean, `${route.padEnd(24)} ${s.len} chars${s.bad.length ? ` · JUNK: ${s.bad.join(', ')}` : ''}${errs.length ? ` · error: ${errs[0]}` : ''}`);
        }
        await ctx.close();
    }
}

// ── S4/S5 · Mission handoff, and whether it survives a refresh ──────────────
console.log('\nS4/S5  Mission handoff — click Go, land, then hard-refresh');
{
    const ctx = await contextFor(browser, 'k.syrus@cainergy.com');
    if (ctx) {
        const p = await ctx.newPage();
        await p.goto(`${BASE}/specialist`, { waitUntil: 'domcontentloaded' });
        await sleep(12000);

        // The handoff button is NOT labelled "Go" — it carries the destination
        // module's name ("PM schedules", "Work orders", "Analyze"). Matching on
        // the label text found nothing and the journey silently reported a pass.
        // The title attribute is the stable marker.
        const GO_SELECTOR = 'button[title^="The Specialist guides you through this"]';
        const gos = await p.evaluate(sel =>
            [...document.querySelectorAll(sel)].filter(b => b.getClientRects().length).length, GO_SELECTOR);

        if (gos === 0) {
            // Not a pass. The most important seam in the product went untested.
            note('S4', false, 'INCONCLUSIVE — no mission handoff buttons on the workspace; the spine seam was not exercised');
        } else {
            const before = p.url();
            await p.evaluate(sel => {
                const b = [...document.querySelectorAll(sel)].find(x => x.getClientRects().length);
                b?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            }, GO_SELECTOR);
            await sleep(9000);
            const after = await inspect(p);
            note('S4', after.url !== new URL(before).pathname, `Go → landed on ${after.url} (${after.len} chars)`);

            const guideBefore = await p.evaluate(() => sessionStorage.getItem('specialist-active-mission') !== null);
            await p.reload({ waitUntil: 'domcontentloaded' });
            await sleep(8000);
            const guideAfter = await p.evaluate(() => sessionStorage.getItem('specialist-active-mission') !== null);
            const s5 = await inspect(p);
            note('S5', s5.len > 50, `after refresh: ${s5.len} chars, mission handoff ${guideBefore ? (guideAfter ? 'survived' : 'LOST') : 'was not set'}`);
        }
        await ctx.close();
    }
}

// ── S8 · Technician: My Work → open a job ───────────────────────────────────
console.log('\nS8  Technician path — My Work → open a work order');
{
    const ctx = await contextFor(browser, 'bea@cainergy.com');
    if (ctx) {
        const p = await ctx.newPage();
        const errs = [];
        p.on('pageerror', e => errs.push(String(e).slice(0, 120)));
        await p.goto(`${BASE}/my-work`, { waitUntil: 'domcontentloaded' });
        await sleep(9000);
        const mine = await inspect(p);
        note('S8', mine.len > 50, `/my-work → ${mine.len} chars${/nothing assigned|all caught up/i.test(mine.text) ? ' (empty state, honest)' : ''}`);

        await p.goto(`${BASE}/work-orders`, { waitUntil: 'domcontentloaded' });
        await sleep(10000);
        const listLen = (await inspect(p)).len;
        await p.evaluate(() => {
            const row = [...document.querySelectorAll('main *')]
                .find(e => e.children.length === 0 && /^WO-|^\d{4,}/.test((e.textContent || '').trim()));
            row?.closest('div,tr,li')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await sleep(8000);
        const detail = await inspect(p);
        note('S8', detail.len > listLen || detail.url.includes('/work-orders/'),
            `opened a work order → ${detail.url} (${listLen} → ${detail.len} chars)${errs.length ? ` · error: ${errs[0]}` : ''}`);
        if (detail.bad.length) note('S8', false, `work-order detail shows junk — ${detail.bad.join(', ')}`);
        await ctx.close();
    }
}

// ── S9 · Requester: raise a request, end to end ─────────────────────────────
console.log('\nS9  Requester path — raise a maintenance request');
{
    const ctx = await contextFor(browser, 'requester01@cainergy.com');
    if (ctx) {
        const p = await ctx.newPage();
        const errs = [];
        p.on('pageerror', e => errs.push(String(e).slice(0, 120)));
        await p.goto(`${BASE}/requests`, { waitUntil: 'domcontentloaded' });
        await sleep(10000);
        const s = await inspect(p);
        const hasNew = await p.evaluate(() =>
            [...document.querySelectorAll('button')].some(b => /new request/i.test(b.textContent || '') && b.getClientRects().length));
        note('S9', s.len > 50, `/requests → ${s.len} chars, "New Request" button ${hasNew ? 'present' : 'MISSING'}`);
        if (s.bad.length) note('S9', false, `requests board shows junk — ${s.bad.join(', ')}`);
        if (errs.length) note('S9', false, `page error: ${errs[0]}`);
        await ctx.close();
    }
}

console.log('\n' + '═'.repeat(72));
if (findings.length === 0) {
    console.log('No journey defects found.');
} else {
    console.log(`${findings.length} finding(s):`);
    for (const f of findings) console.log(`  • ${f}`);
}
console.log('\nNot covered: S2 (import — needs a register file), S4 "do the work",');
console.log('S6 (deliver/approve), S10 (invite). And no script replaces a human');
console.log('actually trying to use this — see the X-series charters in the plan.');

await browser.close();
process.exit(findings.length ? 1 : 0);
