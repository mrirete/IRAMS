/**
 * Gate G0 — does a real token carry its tenant, and does a tenantless one deny?
 *
 * Tenancy is about to become a predicate on every table. Before any policy
 * depends on it, prove three things against real sign-ins:
 *
 *   1. every user resolves to a company (no NULLs left behind by the backfill)
 *   2. a freshly minted token carries app_metadata.company_id, and
 *      caller_company() reads it back as that company
 *   3. a user WITHOUT a company resolves to NULL — fail-closed, verified rather
 *      than assumed, because "it would surely deny" is how leaks ship
 *
 * Point 3 is the one worth the effort. A NULL that quietly matched everything
 * would be invisible until a second tenant existed, by which time it is a
 * breach rather than a bug.
 *
 * Usage: SUPABASE_ACCESS_TOKEN=sbp_… npx vite-node tests/rls/tenant-identity.mjs
 */
const SB = 'https://hacrebcfvyqdnjvilhqc.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhhY3JlYmNmdnlxZG5qdmlsaHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1Mjk5ODAsImV4cCI6MjA4NzEwNTk4MH0.F-2Fordc833NAuprdRBmm5s-Bd5fQsO0vxUK7_06AJ0';
const REF = 'hacrebcfvyqdnjvilhqc';
const TOK = process.env.SUPABASE_ACCESS_TOKEN;

if (!TOK) { console.error('SUPABASE_ACCESS_TOKEN is not set (sbp_…).'); process.exit(1); }

const mgmt = async (sql) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
        method: 'POST', headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql }),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`mgmt ${r.status}: ${t.slice(0, 200)}`);
    return JSON.parse(t);
};

const signIn = async (email) => {
    const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'Password123!' }),
    });
    return r.ok ? (await r.json()).access_token : null;
};

/** Decode a JWT payload without verifying — we only want to read the claims. */
const claims = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString('utf8'));

/** Ask the database what IT thinks the caller's tenant is, using the real token. */
const callerCompanyAs = async (jwt) => {
    const r = await fetch(`${SB}/rest/v1/rpc/caller_company`, {
        method: 'POST',
        headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        body: '{}',
    });
    return r.ok ? await r.json() : `HTTP ${r.status}`;
};

let bad = 0;
const ROLES = [
    ['SUPER_ADMIN', 'admin001@cainergy.com'],
    ['RELIABILITY_ENG', 'k.syrus@cainergy.com'],
    ['TECHNICIAN', 'bea@cainergy.com'],
    ['REQUESTER', 'requester01@cainergy.com'],
];

// ── 1. Backfill completeness ────────────────────────────────────────────────
const [counts] = await mgmt(
    `SELECT count(*) AS total, count(*) FILTER (WHERE company_id IS NULL) AS orphans FROM public.users`);
console.log(`1. users with no company: ${counts.orphans} of ${counts.total} ${counts.orphans === '0' || counts.orphans === 0 ? '✅' : '❌'}`);
if (Number(counts.orphans) !== 0) bad++;

const [co] = await mgmt(`SELECT id, name FROM public.companies WHERE active IS TRUE ORDER BY created_at ASC LIMIT 1`);
console.log(`   tenant: ${co.name} (${co.id})\n`);

// ── 2. The claim reaches a real token ───────────────────────────────────────
console.log('2. token carries the tenant, and the database reads it back');
for (const [label, email] of ROLES) {
    const jwt = await signIn(email);
    if (!jwt) { console.log(`   ⚠ ${label}: sign-in failed`); bad++; continue; }
    const c = claims(jwt);
    const inToken = c?.app_metadata?.company_id ?? null;
    const fromDb = await callerCompanyAs(jwt);
    const ok = inToken === co.id && fromDb === co.id;
    if (!ok) bad++;
    console.log(`   ${ok ? '✓' : '✗'} ${label.padEnd(16)} claim=${inToken ? inToken.slice(0, 8) + '…' : 'MISSING'}  caller_company()=${fromDb ? String(fromDb).slice(0, 8) + '…' : 'NULL'}`);
}

// ── 3. Fail-closed for a user with no tenant ────────────────────────────────
// Temporarily clear one test user's company, sign in fresh, and confirm the
// claim is absent and caller_company() is NULL. Restored in the finally block.
console.log('\n3. a user with no company resolves to NULL (fail-closed)');
const SUBJECT = 'requester01@cainergy.com';
const [before] = await mgmt(`SELECT company_id FROM public.users WHERE email = '${SUBJECT}'`);
try {
    await mgmt(`UPDATE public.users SET company_id = NULL WHERE email = '${SUBJECT}'`);
    const jwt = await signIn(SUBJECT);
    const inToken = jwt ? (claims(jwt)?.app_metadata?.company_id ?? null) : 'no-token';
    const fromDb = jwt ? await callerCompanyAs(jwt) : 'no-token';
    const ok = !inToken && (fromDb === null || fromDb === '');
    if (!ok) bad++;
    console.log(`   ${ok ? '✓' : '✗'} claim=${inToken || 'absent'}  caller_company()=${fromDb === null ? 'NULL' : fromDb}`);
} finally {
    await mgmt(`UPDATE public.users SET company_id = '${before.company_id}' WHERE email = '${SUBJECT}'`);
    const [after] = await mgmt(`SELECT company_id FROM public.users WHERE email = '${SUBJECT}'`);
    console.log(`   restored: ${after.company_id === before.company_id ? 'OK ✅' : 'MISMATCH ⚠'}`);
}

console.log('\n' + '═'.repeat(64));
console.log(bad === 0
    ? 'G0 GREEN — every user has a tenant, tokens carry it, tenantless denies.'
    : `G0 RED — ${bad} problem(s). Do not build on caller_company() yet.`);
process.exit(bad ? 1 : 0);
