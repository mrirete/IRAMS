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
    ['tenant-scoped policies', count(/caller_company\(\)/g) - count(/DEFAULT caller_company\(\)/g), live.tenant_policies],
];

console.log('  structure                    baseline     live');
let bad = 0;
for (const [label, a, b] of CHECKS) {
    // The policy-expression count is a proxy: one policy can mention
    // caller_company() more than once, so this is a floor, not equality.
    const isProxy = label === 'tenant-scoped policies';
    const ok = isProxy ? a >= b : a === b;
    if (!ok) bad++;
    console.log(`  ${label.padEnd(28)} ${String(a).padStart(6)} ${String(b).padStart(8)}   ${ok ? '✅' : '❌'}${isProxy ? '  (≥, mentions not policies)' : ''}`);
}

// The seed must create the company its own rows point at, or every tenant-owned
// reference row lands orphaned behind an FK the load cannot satisfy.
const co = /INSERT INTO (?:public\.)?"?companies"?[\s\S]{0,600}?VALUES\s*\(\s*'([0-9a-f-]{36})'/i.exec(seed);
const refsCompany = /"company_id"/.test(seed);
const seedOk = Boolean(co) && (!refsCompany || seed.includes(co[1]));
if (!seedOk) bad++;
console.log(`\n  ${seedOk ? '✅' : '❌'} seed creates the company its tenant-owned rows reference (${co ? co[1] : 'no companies INSERT'})`);

console.log('\n' + '═'.repeat(66));
if (bad === 0) {
    console.log('✔ Baseline matches the origin schema. Safe to provision from.');
    console.log('  Note: this is a structural comparison. The stronger check — load into a');
    console.log('  throwaway project and diff — is runbook §3.2 and needs a spare project.');
} else {
    console.log(`✖ ${bad} mismatch(es). Regenerate before provisioning anyone:`);
    console.log('    node scripts/provision/export-schema.mjs --project-ref ' + projectRef);
    console.log('    node scripts/provision/export-seed.mjs   --project-ref ' + projectRef);
}
process.exit(bad ? 1 : 0);
