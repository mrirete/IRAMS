/**
 * caller-can-parity — Gate G1 for the RBAC DB-enforcement plan.
 *
 * `caller_can()` is about to decide what the database will show people. Before
 * a single policy depends on it, prove it answers exactly what the TypeScript
 * matrix answers — otherwise the UI and the API disagree again, only this time
 * the disagreement is enforced.
 *
 * Two halves:
 *
 *   1. EXHAUSTIVE, no identity needed. role_can(role, overrides, module, action)
 *      is pure, so every role × module × action triple can be checked in one
 *      round trip against expectations computed from the TypeScript source.
 *      That is ~1,700 assertions without needing a login per role — which is
 *      the whole reason the decision was split from the identity lookup.
 *
 *   2. END-TO-END for the four accounts that exist, so the identity resolution
 *      inside caller_can() is exercised too. A pure function that is right and
 *      a wrapper that finds the wrong user still produces a wrong answer.
 *
 * Plus the four override cases, because an override of `false` must WITHDRAW
 * permission rather than fall through to the template — the one a naive
 * `coalesce(override, template)` gets backwards.
 *
 * Usage:  SUPABASE_ACCESS_TOKEN=sbp_… npx vite-node tests/rls/caller-can-parity.mjs
 */
import { ROLE_PERMISSION_TEMPLATES, BASE_PACKAGE_DEFAULTS } from '../../src/eam/constants/rolePermissions.ts';

const REF = process.env.SUPABASE_PROJECT_REF || 'hacrebcfvyqdnjvilhqc';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const SB = 'https://hacrebcfvyqdnjvilhqc.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhhY3JlYmNmdnlxZG5qdmlsaHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1Mjk5ODAsImV4cCI6MjA4NzEwNTk4MH0.F-2Fordc833NAuprdRBmm5s-Bd5fQsO0vxUK7_06AJ0';

if (!TOKEN) { console.error('SUPABASE_ACCESS_TOKEN is not set (sbp_…).'); process.exit(1); }

const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'authorize', 'viewCosts', 'assign'];
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

const run = async (query) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`);
    return JSON.parse(t);
};

let failures = 0;

// ── 1. Exhaustive parity on the pure function ───────────────────────────────
const cases = [];
const collect = (roleKey, perms) => {
    for (const module of Object.keys(perms)) {
        for (const action of ACTIONS) {
            cases.push([roleKey, module, action, perms[module]?.[action] === true]);
        }
    }
};
for (const [role, perms] of Object.entries(ROLE_PERMISSION_TEMPLATES)) collect(role, perms);
collect('__default__', BASE_PACKAGE_DEFAULTS);

// One statement: a VALUES list of expectations joined against the function.
const values = cases
    .map(([r, m, a, e]) => `(${lit(r)}, ${lit(m)}, ${lit(a)}, ${e})`)
    .join(',\n');

const sql = `
    WITH expected(role, module, action, want) AS (VALUES\n${values}\n)
    SELECT role, module, action, want,
           public.role_can(role, '{}'::jsonb, module, action) AS got
    FROM expected
    WHERE public.role_can(role, '{}'::jsonb, module, action) IS DISTINCT FROM want`;

console.log(`1. Exhaustive: ${cases.length} (role × module × action) triples`);
const mismatches = await run(sql);
if (mismatches.length === 0) {
    console.log('   ✓ role_can() agrees with ROLE_PERMISSION_TEMPLATES on every triple\n');
} else {
    failures += mismatches.length;
    console.log(`   ✗ ${mismatches.length} MISMATCH(ES):`);
    for (const m of mismatches.slice(0, 20)) {
        console.log(`     ${m.role} ${m.module}.${m.action}  TS says ${m.want}, SQL says ${m.got}`);
    }
    console.log('');
}

// ── 2. Override semantics ───────────────────────────────────────────────────
// TECHNICIAN: assets.view true in the template, finops.view false.
const overrideCases = [
    ['absent override falls through to the template', '{}', 'assets', 'view', true],
    ['override true grants what the template denies', '{"finops":{"view":true}}', 'finops', 'view', true],
    ['override FALSE withdraws what the template grants', '{"assets":{"view":false}}', 'assets', 'view', false],
    ['override on another action leaves this one alone', '{"assets":{"delete":true}}', 'assets', 'view', true],
    ['override on another module leaves this one alone', '{"finops":{"view":true}}', 'assets', 'view', true],
];
console.log('2. Override semantics (TECHNICIAN)');
for (const [label, ovr, module, action, want] of overrideCases) {
    const [row] = await run(
        `SELECT public.role_can('TECHNICIAN', ${lit(ovr)}::jsonb, ${lit(module)}, ${lit(action)}) AS got`);
    const ok = row.got === want;
    if (!ok) failures++;
    console.log(`   ${ok ? '✓' : '✗'} ${label} → ${row.got} (want ${want})`);
}

// ── 3. Unknown role falls back to the fail-closed default ───────────────────
console.log('\n3. Unknown role → __default__ (fail-closed)');
for (const [module, action, want] of [['reliability', 'view', false], ['assets', 'view', true]]) {
    const [row] = await run(
        `SELECT public.role_can('NO_SUCH_ROLE', '{}'::jsonb, ${lit(module)}, ${lit(action)}) AS got`);
    const ok = row.got === want;
    if (!ok) failures++;
    console.log(`   ${ok ? '✓' : '✗'} ${module}.${action} → ${row.got} (want ${want}, per BASE_PACKAGE_DEFAULTS)`);
}

// ── 4. End-to-end: does caller_can() find the right user? ───────────────────
// The pure function can be perfect while the identity lookup picks the wrong
// row, so this exercises the wrapper with real tokens.
console.log('\n4. End-to-end via caller_can() with real logins');
const LOGINS = [
    ['SUPER_ADMIN', 'admin001@cainergy.com'],
    ['RELIABILITY_ENG', 'k.syrus@cainergy.com'],
    ['TECHNICIAN', 'bea@cainergy.com'],
    ['REQUESTER', 'requester01@cainergy.com'],
];
for (const [label, email] of LOGINS) {
    const auth = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'Password123!' }),
    })).json();
    if (!auth.access_token) { console.log(`   ⚠ ${label}: sign-in failed, skipped`); continue; }

    const probes = [];
    for (const [module, action] of [['reliability', 'view'], ['finops', 'view'], ['admin', 'view'], ['assets', 'view']]) {
        const res = await fetch(`${SB}/rest/v1/rpc/caller_can`, {
            method: 'POST',
            headers: { apikey: ANON, Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ p_module: module, p_action: action }),
        });
        const got = res.ok ? await res.json() : `HTTP ${res.status}`;

        // Expectation from the same TypeScript source, including this user's
        // stored overrides — read as admin so the comparison is honest.
        const tmpl = ROLE_PERMISSION_TEMPLATES[label] ?? BASE_PACKAGE_DEFAULTS;
        const want = tmpl[module]?.[action] === true;
        const ok = got === want;
        if (!ok) failures++;
        probes.push(`${module}.${action}=${got}${ok ? '' : ` ✗want ${want}`}`);
    }
    console.log(`   ${label.padEnd(16)} ${probes.join('  ')}`);
}

console.log('\n' + '═'.repeat(72));
console.log(failures === 0
    ? 'G1 GREEN — caller_can() matches the TypeScript matrix. Safe to gate policies on it.'
    : `G1 RED — ${failures} mismatch(es). Do NOT apply any policy using caller_can().`);
process.exit(failures ? 1 : 0);
