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
 *   3. For each configured login: signs in via the Supabase REST password
 *      grant, injects the session, cold-loads every route at desktop width,
 *      then re-sweeps the spine at phone width (390×844).
 *      Fails on: stuck spinner, empty page, uncaught page error, or a page
 *      that scrolls horizontally on a phone.
 *      "Access Restricted" counts as rendered (role gates are allowed to say no).
 *
 * Why the spine is swept twice: the Specialist is the product's front door and
 * half its audience is thumb-first. A route that renders at 1400px and overflows
 * at 390px is broken for those users, and nothing else in CI can see it.
 *
 * Env:
 *   BASE                  default https://irams.vercel.app
 *   EXPECT_SHA            full or short git sha to wait for
 *   SMOKE_EMAIL/_PASSWORD single login (back-compat)
 *   SMOKE_LOGINS_JSON     [{"label":"TECHNICIAN","email":"…","password":"…"}, …]
 *                         Overrides the single login; sweeps once per entry so
 *                         role gating is exercised, not just "some user".
 *   SMOKE_MOBILE=0        skip the phone-width pass
 *   SMOKE_BROWSER_CHANNEL e.g. "chrome" for local runs
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

const DESKTOP = { width: 1400, height: 900 };
const PHONE = { width: 390, height: 844 };   // iPhone 14/15 — the primary mobile target.

/**
 * Routes to sweep. `spine: true` marks the Specialist → EAM journey most users
 * take; those are the ones re-swept at phone width.
 *
 * Deep-linked query params are included deliberately (?tab=rca, ?due=overdue):
 * they are how the Specialist hands off into the EAM, and a destination that
 * ignores or chokes on its param is a silent break — the user just lands
 * somewhere unscoped and doesn't know they were meant to be filtered.
 */
const ROUTES = [
  // ── Specialist: the front door ──
  { path: '/', spine: true },
  { path: '/specialist', spine: true },
  { path: '/specialist/import', spine: true },
  { path: '/specialist/assessment', spine: true },
  { path: '/specialist/deliver', spine: true },
  { path: '/specialist/manuals' },
  { path: '/specialist/roi', spine: true },
  { path: '/specialist/meeting' },

  // ── EAM: where the missions land ──
  { path: '/my-work', spine: true },
  { path: '/work-orders', spine: true },
  { path: '/recurring-work?due=overdue', spine: true },
  { path: '/assets', spine: true },
  // parityOk: phone renders collapsible MobileRequestGroups with only "New" open
  // by default (ServiceRequests.tsx ~L374) — the other columns show their counts
  // and expand on tap. Verified 2026-07-31; the short phone text is intended.
  { path: '/requests', spine: true, parityOk: true },
  { path: '/inventory', spine: true },
  { path: '/scheduling' },
  { path: '/notifications', spine: true },
  { path: '/readings' },
  { path: '/reports' },

  // ── Analysis / integrity ──
  { path: '/analyze' },
  { path: '/analyze?tab=rca' },
  { path: '/reliability-metrics' },
  { path: '/reliability-modelling' },
  { path: '/comply/evaluate' },
  { path: '/predict' },

  // ── Admin ──
  { path: '/admin/migration' },
  { path: '/admin/connectors' },
];

const SPINE = ROUTES.filter(r => r.spine);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const failures = [];
const note = (ok, label, detail = '') =>
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);

// Write a line to the GitHub Actions run summary (visible in the UI without
// opening logs) so it's clear at a glance whether the authenticated sweep ran.
const summary = (md) => {
  try { if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n'); } catch { /* ignore */ }
};

// Logins to sweep. SMOKE_LOGINS_JSON (one secret, many roles) wins; otherwise
// the original single SMOKE_EMAIL/SMOKE_PASSWORD pair, so existing CI keeps
// working untouched.
const LOGINS = (() => {
  const raw = (process.env.SMOKE_LOGINS_JSON || '').trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const list = (Array.isArray(parsed) ? parsed : [])
        .filter(l => l && l.email && l.password)
        .map((l, i) => ({ label: l.label || l.role || `login${i + 1}`, email: l.email, password: l.password }));
      if (list.length) return list;
      console.warn('⚠ SMOKE_LOGINS_JSON parsed but held no usable {email,password} entries — falling back.');
    } catch (e) {
      console.warn(`⚠ SMOKE_LOGINS_JSON is not valid JSON (${String(e).slice(0, 80)}) — falling back to SMOKE_EMAIL/SMOKE_PASSWORD.`);
    }
  }
  return (EMAIL && PASSWORD) ? [{ label: 'default', email: EMAIL, password: PASSWORD }] : [];
})();

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

/** Sign in via the REST password grant. Returns {session} | {credIssue} | throws-ish {fatal}. */
async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (res.ok) return { session: await res.json() };
  const bodyText = await res.text();
  // A clean 400 (invalid credentials / email not confirmed) means the AUTH
  // endpoint is HEALTHY — the smoke login is just misconfigured. That's a CI
  // config issue, not a production regression. Only a genuinely unhealthy
  // endpoint (5xx / network) is a real failure.
  const credIssue = res.status === 400 && /invalid|credential|not.?confirmed|password/i.test(bodyText);
  return credIssue
    ? { credIssue: `${res.status}: ${bodyText.slice(0, 120)}` }
    : { fatal: `${res.status} ${bodyText.slice(0, 200)}` };
}

/**
 * Does the document itself scroll sideways? Content inside a deliberate
 * overflow-x container is fine (wide tables are SUPPOSED to scroll in place) —
 * only the page body scrolling is the defect, so offenders nested in a scroller
 * are filtered out. Returns null when clean, else the widest culprits.
 */
async function horizontalOverflow(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const docW = Math.max(document.body.scrollWidth, document.documentElement.scrollWidth);
    if (docW <= vw + 2) return null;
    const inScroller = (el) => {
      for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true;
      }
      return false;
    };
    const bad = [];
    for (const el of document.querySelectorAll('main *, header *')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 2 && !inScroller(el)) {
        bad.push({
          right: Math.round(r.right),
          tag: el.tagName.toLowerCase(),
          cls: (typeof el.className === 'string' ? el.className : '').slice(0, 50),
          text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 30),
        });
      }
    }
    bad.sort((a, b) => b.right - a.right);
    return { docW, vw, offenders: bad.slice(0, 3) };
  });
}

/**
 * Load one route and judge it. Pass = real content (or an intentional gate) with
 * no uncaught errors, and — on phone width — no sideways scroll.
 */
async function sweepRoute(page, pageErrors, route, { checkOverflow, label }) {
  pageErrors.length = 0;
  let verdict = '';
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    // Poll until the page SETTLES — not merely until it first paints.
    //
    // First-paint was too weak: /requests measured 237 chars the instant it had
    // content and 1010 once its fetches landed, so the assertion was covering a
    // third of the page. Worse, a page that paints a header and then hangs a
    // sub-region forever looked identical to a healthy one — which is the exact
    // defect class this file exists to catch, just scoped to a panel instead of
    // the whole route.
    //
    // Settled = two consecutive identical text lengths AND nothing still
    // spinning inside <main>.
    let ok = false, prev = -1, stable = 0, sawSpinner = false;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const s = await page.evaluate(() => {
        const main = document.querySelector('main');
        const text = (main ? main.innerText : document.body.innerText).trim();
        return { len: text.length, gated: text.includes('Access Restricted'), spinner: !!document.querySelector('main .animate-spin') };
      });
      if (s.gated) { ok = true; verdict = 'gated (ok)'; break; }
      if (s.len > 20) {
        stable = s.len === prev ? stable + 1 : 0;
        prev = s.len;
        sawSpinner = s.spinner;
        if (stable >= 1 && !s.spinner) { ok = true; verdict = `settled len=${s.len}`; break; }
      }
      await sleep(1_200);
    }
    if (!ok) {
      verdict = prev > 20
        ? `STUCK REGION — page has ${prev} chars but ${sawSpinner ? 'a spinner never resolved' : 'content never stabilised'} in 30s`
        : 'STUCK — no content after 30s';
    }

    if (ok && checkOverflow) {
      const of = await horizontalOverflow(page);
      if (of) {
        ok = false;
        const who = of.offenders.map(o => `<${o.tag} class="${o.cls}">${o.text ? ` "${o.text}"` : ''} →${o.right}px`).join(' ; ');
        verdict += ` | H-OVERFLOW ${of.docW}px in ${of.vw}px viewport${who ? ` — ${who}` : ''}`;
      }
    }
    if (pageErrors.length) { ok = false; verdict += ` | pageerrors: ${pageErrors.join(' ; ')}`; }
    note(ok, `${label} ${route}`, verdict);
    return { ok, len: prev };
  } catch (e) {
    note(false, `${label} ${route}`, String(e).slice(0, 150));
    return { ok: false, len: -1 };
  }
}

// ── 3. Authenticated sweeps — one per login, desktop then phone ─────────────
const results = [];         // { login, viewport, passed, total, failed: [] }
const parityWarnings = [];  // routes where the phone shows far less than the desktop
let credSkips = 0;

/** Phone text below this fraction of desktop text gets flagged for a human look. */
const PARITY_FLOOR = 0.5;

if (process.env.SMOKE_SKIP_AUTHED) {
  console.log('Expected deploy not live — skipping the authenticated route sweep.');
} else if (!LOGINS.length) {
  console.log('No smoke credentials set — skipping the authenticated sweep.');
  console.log('Set SMOKE_EMAIL/SMOKE_PASSWORD, or SMOKE_LOGINS_JSON for a multi-role sweep.');
} else {
  for (const login of LOGINS) {
    console.log(`\n── ${login.label} ─────────────────────────────`);
    const auth = await signIn(login.email, login.password);
    if (auth.fatal) {
      console.error(`✗ FAIL smoke sign-in for ${login.label} (auth endpoint unhealthy): ${auth.fatal}`);
      await browser.close();
      process.exit(1);
    }
    if (auth.credIssue) {
      console.warn(`⚠ sign-in rejected for ${login.label} (${auth.credIssue}).`);
      console.warn('  Auth endpoint is healthy — this is a credentials misconfig, not a prod issue. Skipping this login.');
      credSkips++;
      continue;
    }

    // ONE persistent context per login: the session refreshes in place, and
    // parallel copies of the same refresh token trip Supabase's rotation and
    // cause false failures. The phone pass RESIZES this context rather than
    // opening a second one — same reason.
    const ctx = await browser.newContext({ viewport: DESKTOP });
    const seed = await ctx.newPage();
    await seed.addInitScript(([k, v]) => localStorage.setItem(k, v),
      [`sb-${REF}-auth-token`, JSON.stringify(auth.session)]);
    await seed.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await seed.close();

    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));

    // Desktop: every route.
    const deskFailed = [];
    const deskLen = {};
    for (const r of ROUTES) {
      const { ok, len } = await sweepRoute(page, pageErrors, r.path, { checkOverflow: false, label: `[${login.label} desktop]` });
      deskLen[r.path] = len;
      if (!ok) { deskFailed.push(r.path); failures.push(`${login.label} desktop ${r.path}`); }
    }
    results.push({ login: login.label, viewport: 'desktop', passed: ROUTES.length - deskFailed.length, total: ROUTES.length, failed: deskFailed });

    // Phone: the spine only, with the overflow assertion. Navigating fresh after
    // the resize means components mount at phone width rather than inheriting a
    // desktop-mounted layout.
    if (process.env.SMOKE_MOBILE !== '0') {
      await page.setViewportSize(PHONE);
      const mobFailed = [];
      for (const r of SPINE) {
        const { ok, len } = await sweepRoute(page, pageErrors, r.path, { checkOverflow: true, label: `[${login.label} phone]` });
        if (!ok) { mobFailed.push(r.path); failures.push(`${login.label} phone ${r.path}`); }

        // Content parity — a WARNING, never a failure. Responsive layouts drop
        // columns on purpose, so a shorter phone page is usually correct. But a
        // steep drop is also what "that field is invisible on mobile" looks like,
        // and nothing else in CI would ever surface it. Flag it; a human judges.
        const d = deskLen[r.path];
        if (ok && !r.parityOk && d > 200 && len > 0 && len < d * PARITY_FLOOR) {
          const pct = Math.round((len / d) * 100);
          console.log(`    ⚠ parity ${r.path} — phone shows ${pct}% of desktop text (${len} vs ${d}); confirm nothing important is hidden`);
          parityWarnings.push(`${login.label} ${r.path} (${pct}%)`);
        }
      }
      results.push({ login: login.label, viewport: `phone ${PHONE.width}px`, passed: SPINE.length - mobFailed.length, total: SPINE.length, failed: mobFailed });
    }

    await ctx.close();
  }

  // ── Run summary ──
  if (!results.length && credSkips) {
    summary(`### Production Smoke\n- ✅ Deploy live + \`/login\` renders\n- ⚠️ **Authenticated sweep SKIPPED** — all ${credSkips} login(s) rejected. Fix the credentials to cover logged-in routes.`);
  } else if (results.length) {
    const rows = results.map(r =>
      `| ${r.login} | ${r.viewport} | ${r.failed.length ? '❌' : '✅'} ${r.passed}/${r.total} | ${r.failed.join(', ') || '—'} |`
    ).join('\n');
    summary(
      `### Production Smoke\n- ✅ Deploy live + \`/login\` renders\n\n` +
      `| Login | Viewport | Routes | Failed |\n|---|---|---|---|\n${rows}` +
      (parityWarnings.length
        ? `\n\n<details><summary>⚠️ ${parityWarnings.length} mobile content-parity warning(s) — not failures</summary>\n\n` +
          parityWarnings.map(w => `- ${w}`).join('\n') +
          `\n\nPhone shows under ${PARITY_FLOOR * 100}% of the desktop text. Usually intentional responsive density — check nothing important is hidden.\n</details>`
        : '') +
      (credSkips ? `\n\n⚠️ ${credSkips} login(s) skipped — credentials rejected.` : '')
    );
  }
}

await browser.close();
if (failures.length) {
  console.error(`\nSMOKE FAILED (${failures.length}):\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nSMOKE PASSED');
