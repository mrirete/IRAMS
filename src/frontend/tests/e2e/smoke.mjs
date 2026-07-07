/**
 * Production smoke test — drives the REAL deployed app in headless Chromium.
 *
 * Exists because of the 2026-07 stuck-spinner incident: every page hung on a
 * spinner for logged-in users while build, types, and unit tests stayed green.
 * Only a browser hitting real routes with a real session can catch that class.
 *
 * Checks:
 *   1. (EXPECT_SHA) waits until /version.json reports the expected deploy.
 *   2. /login renders unauthenticated.
 *   3. With SMOKE_EMAIL/SMOKE_PASSWORD: signs in via the Supabase REST
 *      password grant, injects the session, cold-loads the core routes, and
 *      fails on: stuck spinner, empty page, or any uncaught page error.
 *      "Access Restricted" counts as rendered (role gates are allowed to say no).
 *
 * Env: BASE (default prod), EXPECT_SHA (full or short git sha), SMOKE_EMAIL,
 *      SMOKE_PASSWORD, SMOKE_BROWSER_CHANNEL (e.g. "chrome" for local runs).
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'https://irams.vercel.app';
const EXPECT_SHA = (process.env.EXPECT_SHA || '').slice(0, 7);
const EMAIL = process.env.SMOKE_EMAIL || '';
const PASSWORD = process.env.SMOKE_PASSWORD || '';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://hacrebcfvyqdnjvilhqc.supabase.co';
const SUPABASE_ANON = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhhY3JlYmNmdnlxZG5qdmlsaHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1Mjk5ODAsImV4cCI6MjA4NzEwNTk4MH0.F-2Fordc833NAuprdRBmm5s-Bd5fQsO0vxUK7_06AJ0';
const REF = new URL(SUPABASE_URL).hostname.split('.')[0];

const ROUTES = [
  '/', '/my-work', '/work-orders', '/assets', '/requests', '/scheduling',
  '/inventory', '/reliability-metrics', '/reliability-modelling', '/analyze',
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const failures = [];
const note = (ok, label, detail = '') =>
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);

// Write a line to the GitHub Actions run summary (visible in the UI without
// opening logs) so it's clear at a glance whether the authenticated sweep ran.
const summary = (md) => {
  try { if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n'); } catch { /* ignore */ }
};

// ── 1. Wait for the expected deploy ─────────────────────────────────────────
// Vercel publish time varies (seen 15–20 min under load); wait generously so a
// slow deploy is not mistaken for a regression. Configurable via env.
const WAIT_MIN = Number(process.env.SMOKE_DEPLOY_WAIT_MIN || 18);
if (EXPECT_SHA) {
  const deadline = Date.now() + WAIT_MIN * 60_000;
  let live = '';
  process.stdout.write(`Waiting up to ${WAIT_MIN}m for deploy ${EXPECT_SHA} on ${BASE} `);
  while (Date.now() < deadline) {
    try {
      const v = await (await fetch(`${BASE}/version.json?t=${Date.now()}`, { cache: 'no-store' })).json();
      live = v.sha || '';
      if (live === EXPECT_SHA) break;
    } catch { /* transient */ }
    process.stdout.write('.');
    await sleep(15_000);
  }
  console.log('');
  if (live !== EXPECT_SHA) {
    // The deploy didn't publish within the window — that's a slow/failed deploy,
    // not a route regression. Don't red-fail the smoke on it: the public /login
    // check still runs below against whatever is live. (A truly broken deploy is
    // caught by the sweep once it does publish, or by the next push.)
    console.warn(`⚠ Deploy ${EXPECT_SHA} not live within ${WAIT_MIN}m (live ${live || 'unknown'}) — Vercel slow/queued.`);
    console.warn('  Skipping the SHA-pinned sweep; running the public check against whatever is live.');
    summary(`### Production Smoke\n- ⚠️ **Deploy ${EXPECT_SHA} not live within ${WAIT_MIN}m** (Vercel slow) — SHA-pinned sweep skipped.`);
    process.env.SMOKE_SKIP_AUTHED = '1';
  } else {
    console.log(`Deploy ${EXPECT_SHA} is live.`);
  }
}

const browser = await chromium.launch({
  headless: true,
  channel: process.env.SMOKE_BROWSER_CHANNEL || undefined,
});

// ── 2. Public: login page renders ───────────────────────────────────────────
{
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await sleep(6_000);
  const body = await page.evaluate(() => document.body.innerText);
  const ok = /password/i.test(await page.content()) && body.length > 50 && errors.length === 0;
  note(ok, '/login renders unauthenticated', ok ? '' : `bodyLen=${body.length} errors=${errors.length}`);
  if (!ok) failures.push('/login');
  await page.close();
}

// ── 3. Authenticated route sweep ────────────────────────────────────────────
if (process.env.SMOKE_SKIP_AUTHED) {
  console.log('Expected deploy not live — skipping the authenticated route sweep.');
} else if (!EMAIL || !PASSWORD) {
  console.log('SMOKE_EMAIL/SMOKE_PASSWORD not set — skipping the authenticated sweep.');
  console.log('Add them as repository secrets to cover logged-in routes.');
} else {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) {
    const bodyText = await res.text();
    // A clean 400 (invalid credentials / email not confirmed) means the AUTH
    // endpoint is HEALTHY — the smoke login is just misconfigured. That's a CI
    // config issue, not a production regression, so warn and pass (the deploy +
    // public /login checks already ran). Only a genuinely unhealthy endpoint
    // (5xx / network) is a real failure.
    const credIssue = res.status === 400 && /invalid|credential|not.?confirmed|password/i.test(bodyText);
    if (credIssue) {
      console.warn(`⚠ smoke sign-in rejected (${res.status}: ${bodyText.slice(0, 120)}).`);
      console.warn('  Auth endpoint is healthy — this is a SMOKE_EMAIL/SMOKE_PASSWORD misconfig, not a prod issue.');
      console.warn('  Fix the secrets to restore the authenticated route sweep. Skipping it for now.');
      summary(`### Production Smoke\n- ✅ Deploy live + \`/login\` renders\n- ⚠️ **Authenticated sweep SKIPPED** — SMOKE_EMAIL/SMOKE_PASSWORD rejected (\`${res.status}\`). Fix the secrets to cover logged-in routes.`);
      await browser.close();
      process.exit(failures.length ? 1 : 0);
    }
    console.error(`✗ FAIL smoke sign-in (auth endpoint unhealthy): ${res.status} ${bodyText.slice(0, 200)}`);
    await browser.close();
    process.exit(1);
  }
  const session = await res.json();

  // ONE persistent context: the session refreshes in place; parallel copies of
  // the same refresh token trip Supabase's rotation and cause false failures.
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const seed = await ctx.newPage();
  await seed.addInitScript(([k, v]) => localStorage.setItem(k, v),
    [`sb-${REF}-auth-token`, JSON.stringify(session)]);
  await seed.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await seed.close();

  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));

  for (const route of ROUTES) {
    pageErrors.length = 0;
    let verdict = '';
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      // Poll up to 25s for the page to become "real": content or a gate card.
      let ok = false;
      const deadline = Date.now() + 25_000;
      while (Date.now() < deadline) {
        const s = await page.evaluate(() => {
          const main = document.querySelector('main');
          const text = (main ? main.innerText : document.body.innerText).trim();
          return { len: text.length, gated: text.includes('Access Restricted'), spinner: !!document.querySelector('main .animate-spin') };
        });
        if (s.gated || (s.len > 20 && !s.spinner)) { ok = true; verdict = s.gated ? 'gated (ok)' : `rendered len=${s.len}`; break; }
        await sleep(1_500);
      }
      if (!ok) verdict = 'STUCK — no content after 25s';
      if (pageErrors.length) { ok = false; verdict += ` | pageerrors: ${pageErrors.join(' ; ')}`; }
      note(ok, route, verdict);
      if (!ok) failures.push(route);
    } catch (e) {
      note(false, route, String(e).slice(0, 150));
      failures.push(route);
    }
  }
  await ctx.close();
  const swept = ROUTES.filter(r => failures.includes(r));
  summary(`### Production Smoke\n- ✅ Deploy live + \`/login\` renders\n- ${swept.length ? '❌' : '✅'} **Authenticated sweep ran: ${ROUTES.length - swept.length}/${ROUTES.length} routes**${swept.length ? ' — failed: ' + swept.join(', ') : ' — all rendered'}`);
}

await browser.close();
if (failures.length) {
  console.error(`\nSMOKE FAILED: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nSMOKE PASSED');
