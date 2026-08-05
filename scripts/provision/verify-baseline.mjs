/**
 * Does the baseline still describe the origin schema?
 *
 * New tenants are NOT built by replaying migration history — that was tried and
 * failed (runbook §6). They load `baseline/schema.sql` + `baseline/seed.sql`.
 * Which means the baseline, not the migrations directory, is what a customer
 * actually gets, and a stale baseline ships a stale product.
 *
 * It went stale exactly that way once: generated 2026-08-01, then RBAC gating
 * (0241–0257) and tenancy (0258–0264) landed on top of it. For four days the
 * baseline would have provisioned a customer with no tenant isolation and
 * almost no write gating — `caller_company` appeared zero times in it. Nothing
 * failed, nothing warned; the file simply described an older database.
 *
 * So this compares the two and refuses to be quiet about a difference.
 *
 * ── The index count looks wrong and is not ──────────────────────────────────
 * pg_indexes reports 688; the baseline emits 479 CREATE INDEX. The 209
 * difference is indexes Postgres creates implicitly for PRIMARY KEY and UNIQUE
 * constraints, which the exporter emits as ADD CONSTRAINT instead — emitting
 * both would create each of them twice. So the comparison is against
 * STANDALONE indexes, not the raw catalog count. Comparing the raw number
 * gives a confident false alarm, which is what it did on the first run here.
 *
 * Usage: SUPABASE_ACCESS_TOKEN=sbp_… node scripts/provision/verify-baseline.mjs --project-ref <ref>
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = resolve(HERE, '../../src/frontend/supabase/baseline');
const args = process.argv.slice(2);
const projectRef = args[args.indexOf('--project-ref') + 1] ?? process.env.SUPABASE_PROJECT_REF ?? '';
const token = process.env.SUPABASE_ACCESS_TOKEN ?? '';
if (!projectRef || !token) {
    console.error('Need --project-ref <ref> and SUPABASE_ACCESS_TOKEN.');
    process.exit(1);
}

const sql = async (query) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`);
    return JSON.parse(t);
};

const schema = readFileSync(`${BASE}/schema.sql`, 'utf8');
const seed = readFileSync(`${BASE}/seed.sql`, 'utf8');
const count = (re) => (schema.match(re) || []).length;
/** Collapse whitespace and drop parens — the exporter re-parenthesises freely. */
const norm = (x) => String(x ?? '').replace(/\s+/g, ' ').replace(/[()]/g, '').trim().toLowerCase();

const [live] = await sql(`SELECT
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r')::int AS tables,
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public')::int AS policies,
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'v')::int AS views,
    -- standalone only: constraint-backed indexes ship as ADD CONSTRAINT
    (SELECT count(*) FROM pg_index i
       JOIN pg_class c ON c.oid = i.indexrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = i.indexrelid))::int AS indexes,
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'company_id')::int AS company_cols,
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'company_id'
        AND column_default LIKE '%caller_company%')::int AS company_defaults,
    (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public'
        AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%caller_company%')::int AS tenant_policies`);

const CHECKS = [
    ['tables', count(/^CREATE TABLE /gm), live.tables],
    ['policies', count(/^CREATE POLICY /gm), live.policies],
    ['views', count(/^CREATE (OR REPLACE )?VIEW /gm), live.views],
    ['standalone indexes', count(/^CREATE (UNIQUE )?INDEX /gm), live.indexes],
    ['company_id columns', count(/\bcompany_id uuid\b/g), live.company_cols],
    ['company_id defaults', count(/DEFAULT caller_company\(\)/g), live.company_defaults],
];

console.log('  structure                    baseline     live');
let bad = 0;
for (const [label, a, b] of CHECKS) {
    const ok = a === b;
    if (!ok) bad++;
    console.log(`  ${label.padEnd(28)} ${String(a).padStart(6)} ${String(b).padStart(8)}   ${ok ? '✅' : '❌'}`);
}

// ── Policy fidelity, predicate by predicate ─────────────────────────────────
// Counting policies only proves none went missing. It says nothing about
// whether each one still MEANS what it did — and the tenant boundary is
// nothing but 464 predicates. A truncated or mis-escaped USING clause would
// keep the count intact and hand a customer a policy that filters differently.
//
// The name pattern must handle quoted names containing spaces ("Allow all for
// authenticated"). A pattern of [^"\s]+ silently skips 19 policies and reports
// them as absent — which it did, before this was written down.
const filePolicies = new Map();
for (const m of schema.matchAll(
    /CREATE POLICY\s+(?:"([^"]+)"|([A-Za-z_]\w*))\s+ON\s+(?:public\.)?"?(\w+)"?([\s\S]*?);\s*(?=\n|$)/g)) {
    const [, quoted, bare, table, rest] = m;
    const using = /USING\s*\(([\s\S]*?)\)\s*(?:WITH CHECK|$)/i.exec(rest);
    const check = /WITH CHECK\s*\(([\s\S]*)\)\s*$/i.exec(rest);
    filePolicies.set(`${table}.${quoted ?? bare}`, { using: norm(using?.[1]), check: norm(check?.[1]) });
}

const livePolicies = await sql(
    `SELECT tablename || '.' || policyname AS k, qual, with_check FROM pg_policies WHERE schemaname = 'public'`);

const absent = [], mismatched = [];
for (const p of livePolicies) {
    const f = filePolicies.get(p.k);
    if (!f) { absent.push(p.k); continue; }
    const lu = norm(p.qual), lw = norm(p.with_check);
    // Substring either way: the exporter reformats and re-parenthesises, so
    // require the predicate's content to survive, not its byte layout.
    const usingOk = !lu || f.using.includes(lu) || lu.includes(f.using);
    const checkOk = !lw || f.check.includes(lw) || lw.includes(f.check);
    if (!usingOk || !checkOk) mismatched.push(p.k);
}
// ── Constraint fidelity ─────────────────────────────────────────────────────
// Counting tables and policies missed an entire migration. 0265/0266 rewrote 26
// UNIQUE constraints to include company_id and this script reported "matches",
// because it never looked at constraints — the baseline still said
// UNIQUE (tag), which is the narrow key that stops two customers from both
// having an asset P-101. Exactly the staleness this exists to catch.
//
// pg_get_constraintdef is what the exporter emits, so a faithful export means
// the definition text matches. Compared by name, so a renamed constraint shows
// up as one missing and one extra rather than silently passing.
const liveConstraints = await sql(`
    SELECT c.conname AS name, pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class t     ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public' AND c.contype IN ('u', 'c', 'f', 'p')`);

const fileConstraints = new Map();
for (const m of schema.matchAll(/ADD CONSTRAINT\s+"?([\w]+)"?\s+([\s\S]*?);\s*(?=\n|$)/g)) {
    fileConstraints.set(m[1], norm(m[2]));
}
const conAbsent = [], conChanged = [];
for (const c of liveConstraints) {
    const f = fileConstraints.get(c.name);
    if (f === undefined) { conAbsent.push(c.name); continue; }
    const want = norm(c.def);
    if (f !== want && !f.includes(want) && !want.includes(f)) conChanged.push(c.name);
}
const uniqLive = liveConstraints.filter((c) => /^UNIQUE/.test(c.def)).length;
const uniqTenantLive = liveConstraints.filter((c) => /^UNIQUE/.test(c.def) && /company_id/.test(c.def)).length;
let uniqTenantFile = 0;
for (const [, d] of fileConstraints) if (/^unique/.test(d) && /company_id/.test(d)) uniqTenantFile++;

if (conAbsent.length) bad++;
if (conChanged.length) bad++;
if (uniqTenantFile !== uniqTenantLive) bad++;
console.log(`\n  constraint fidelity (${liveConstraints.length} live, ${fileConstraints.size} parsed)`);
console.log(`  ${conAbsent.length ? '❌' : '✅'} absent from baseline    ${conAbsent.length}${conAbsent.length ? '  ' + conAbsent.slice(0, 4).join(', ') : ''}`);
console.log(`  ${conChanged.length ? '❌' : '✅'} definition changed      ${conChanged.length}${conChanged.length ? '  ' + conChanged.slice(0, 4).join(', ') : ''}`);
console.log(`  ${uniqTenantFile === uniqTenantLive ? '✅' : '❌'} tenant-scoped UNIQUE    ${uniqTenantFile} of ${uniqTenantLive} (of ${uniqLive} unique constraints)`);

const tenantLive = livePolicies.filter((p) => /caller_company/.test(`${p.qual ?? ''}${p.with_check ?? ''}`)).length;
let tenantFile = 0;
for (const [, v] of filePolicies) if (/caller_company/.test(v.using + v.check)) tenantFile++;

if (absent.length) bad++;
if (mismatched.length) bad++;
if (tenantFile !== tenantLive) bad++;
console.log(`\n  policy fidelity (${livePolicies.length} live, ${filePolicies.size} parsed)`);
console.log(`  ${absent.length ? '❌' : '✅'} absent from baseline    ${absent.length}${absent.length ? '  ' + absent.slice(0, 4).join(', ') : ''}`);
console.log(`  ${mismatched.length ? '❌' : '✅'} predicate changed       ${mismatched.length}${mismatched.length ? '  ' + mismatched.slice(0, 4).join(', ') : ''}`);
console.log(`  ${tenantFile === tenantLive ? '✅' : '❌'} tenant-scoped policies  ${tenantFile} of ${tenantLive} survived export`);

// The seed must create the company its own rows point at, or every tenant-owned
// reference row lands orphaned behind an FK the load cannot satisfy.
const co = /INSERT INTO (?:public\.)?"?companies"?[\s\S]{0,600}?VALUES\s*\(\s*'([0-9a-f-]{36})'/i.exec(seed);
const refsCompany = /"company_id"/.test(seed);
const seedOk = Boolean(co) && (!refsCompany || seed.includes(co[1]));
if (!seedOk) bad++;
console.log(`\n  ${seedOk ? '✅' : '❌'} seed creates the company its tenant-owned rows reference (${co ? co[1] : 'no companies INSERT'})`);

console.log('\n' + '═'.repeat(66));
if (bad === 0) {
    console.log('✔ Baseline CONTENT matches the origin: every object, every policy predicate.');
    console.log('');
    console.log('  What this does NOT prove: that schema.sql REPLAYS cleanly into an empty');
    console.log('  project. Content fidelity and execution order are different failures —');
    console.log('  a file can describe the schema perfectly and still fail on the way in if');
    console.log('  something is emitted before what it depends on. Only a real load catches');
    console.log('  that, and it needs a throwaway project (runbook §3.2).');
    console.log('  Last full load: 2026-07-25, which predates tenancy.');
} else {
    console.log(`✖ ${bad} mismatch(es). Regenerate before provisioning anyone:`);
    console.log('    node scripts/provision/export-schema.mjs --project-ref ' + projectRef);
    console.log('    node scripts/provision/export-seed.mjs   --project-ref ' + projectRef);
}
process.exit(bad ? 1 : 0);
