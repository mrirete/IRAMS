/**
 * Gate G4 — is the tenant boundary complete on EVERY table, including the ones
 * that hold no data?
 *
 * G3 (cross-tenant.mjs) borrows a real row, hands it to a probe tenant, and asks
 * whether tenant A can still reach it. That proves the mechanism works, and it
 * proved it on 76 tables. But it can only ever speak about tables it can reach,
 * and it cannot reach two kinds:
 *
 *   • 70 tables are EMPTY — no row to borrow, so no verdict
 *   • 6 tables have NO `id` column — composite primary keys, so the probe, which
 *     addresses rows as `?id=eq.…`, cannot even name them
 *
 * The second kind is the dangerous one, because G3 does not report those as
 * inconclusive. They are absent from its denominator entirely. That is how
 * movement_type_gl_overrides — created by 0262, after 0261's one-shot policy
 * sweep had already run, carrying `USING (true)` — sat in a schema that G3 had
 * just declared green.
 *
 * ── Why this gate is static, and why that is stronger, not weaker ───────────
 * The claim under test is "every tenant-owned table carries the tenant
 * conjunct". That is a fact about pg_policies, not about data. Checking it
 * needs no rows, covers all 152 tables rather than 76, and an empty table
 * cannot hide from it. Seeding the 70 empty tables — buildable; the FK chains
 * are only two deep and the CHECKs are mostly value-lists — would have been the
 * more expensive way to learn less, and would still have missed the six.
 *
 * Empirical and static are complementary, not alternatives. G3 proves the
 * conjunct WORKS. G4 proves every table HAS one. Neither alone is the guarantee
 * the SMB tier rests on.
 *
 * The query lives in the database as public.tenancy_policy_gaps() (0264), not
 * here, so it cannot drift away from the schema it describes.
 *
 * ── --self-test, and why it is not optional ─────────────────────────────────
 * A check that has never gone red is not evidence. Four separate detectors in
 * this workstream returned a confident wrong answer — the silent-success
 * scanner matched a comment, the policy auditor gave three different orphan
 * counts, the structural check reported 617 false violations over one paren.
 * So --self-test opens a transaction, introduces each gap on purpose, confirms
 * the function reports it, and rolls back. It runs before the real check.
 *
 * Usage: SUPABASE_ACCESS_TOKEN=sbp_… node tests/rls/tenant-completeness.mjs
 *        …same… node tests/rls/tenant-completeness.mjs --self-test
 */
const REF = 'hacrebcfvyqdnjvilhqc';
const TOK = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOK) { console.error('SUPABASE_ACCESS_TOKEN is not set (sbp_…).'); process.exit(1); }

const mgmt = async (sql) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
        method: 'POST', headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql }),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`mgmt ${r.status}: ${t.slice(0, 300)}`);
    return JSON.parse(t);
};

// Confirm the function is actually there. Without this, a dropped or never
// applied 0264 would return no rows and read as a pass — a green light from a
// check that is not running is worse than a red one.
const [{ present }] = await mgmt(
    `SELECT count(*)::int AS present FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'tenancy_policy_gaps'`);
if (!present) {
    console.error('G4 CANNOT RUN — public.tenancy_policy_gaps() is missing. Apply migration 0264.');
    process.exit(1);
}

// ── Self-test: can the gate go red at all? ──────────────────────────────────
// Each case is a real gap shape that has occurred or nearly occurred here. All
// inside BEGIN…ROLLBACK, so nothing survives the statement.
if (process.argv.includes('--self-test')) {
    const CASES = [
        ['policy_ungated  — the 0238 OR-defeat bug',
            `CREATE POLICY _g4_probe ON public.work_orders FOR SELECT TO authenticated USING (true);`],
        ['rls_disabled    — RLS switched off on a tenant table',
            `ALTER TABLE public.work_orders DISABLE ROW LEVEL SECURITY;`],
        ['view_unfiltered — a new definer view with no tenant filter',
            `CREATE VIEW public._g4_probe_v AS SELECT id FROM public.work_orders;`],
        ['new table after the sweep — the 0262 case, verbatim',
            `CREATE TABLE public._g4_probe_t (id uuid PRIMARY KEY, company_id uuid);
             ALTER TABLE public._g4_probe_t ENABLE ROW LEVEL SECURITY;
             CREATE POLICY _g4_t_read ON public._g4_probe_t FOR SELECT TO authenticated USING (true);`],
    ];
    let caught = 0;
    console.log('self-test — deliberate gaps, each rolled back:');
    for (const [label, sql] of CASES) {
        const rows = await mgmt(`BEGIN; ${sql} SELECT kind, object_name FROM public.tenancy_policy_gaps(); ROLLBACK;`);
        const ok = Array.isArray(rows) && rows.length > 0;
        if (ok) caught++;
        console.log(`  ${ok ? '✓ caught ' : '✗ MISSED '} ${label}`);
    }
    const residue = await mgmt(`SELECT kind, object_name FROM public.tenancy_policy_gaps()`);
    if (residue.length) { console.error('\n✖ self-test left gaps behind — investigate before trusting this run.'); process.exit(1); }
    if (caught !== CASES.length) {
        console.error(`\n✖ self-test ${caught}/${CASES.length} — the detector is blind to a real gap shape. Fix it before reading the result below.`);
        process.exit(1);
    }
    console.log(`  ${caught}/${CASES.length} detected, nothing left behind — the gate can go red.\n`);
}

const gaps = await mgmt(`SELECT kind, object_name, detail FROM public.tenancy_policy_gaps() ORDER BY kind, object_name`);

// Coverage, for the record: how much of this G3 could have spoken to at all.
const [cov] = await mgmt(`
    WITH t AS (
        SELECT c.relname,
               EXISTS (SELECT 1 FROM information_schema.columns col
                        WHERE col.table_schema='public' AND col.table_name=c.relname AND col.column_name='id') AS has_id
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname='public' AND c.relkind='r'
           AND EXISTS (SELECT 1 FROM information_schema.columns col
                        WHERE col.table_schema='public' AND col.table_name=c.relname AND col.column_name='company_id')
           AND c.relname NOT IN ('users','companies'))
    SELECT count(*)::int AS total, count(*) FILTER (WHERE NOT has_id)::int AS no_id FROM t`);

const byKind = (k) => gaps.filter(g => g.kind === k);
const line = (label, rows) =>
    console.log(`  ${label.padEnd(46)} ${rows.length === 0 ? '0 ✅' : `${rows.length} ❌`}`);

console.log(`scope: ${cov.total} tenant-owned tables — every one of them, empty or not.`);
console.log(`       ${cov.no_id} have no 'id' column and are invisible to G3's row-borrowing probe.\n`);

line('tables with RLS off or zero policies', byKind('rls_disabled'));
line('PERMISSIVE policies with no tenant test', byKind('policy_ungated'));
line('DEFINER views with no tenant filter', byKind('view_unfiltered'));

if (gaps.length) {
    console.log('\nfindings:');
    for (const g of gaps) console.log(`  ${g.kind.padEnd(16)} ${g.object_name.padEnd(48)} ${g.detail}`);
}

console.log('\n' + '═'.repeat(72));
console.log(gaps.length === 0
    ? `G4 GREEN — tenant boundary structurally complete across all ${cov.total} tenant-owned tables.`
    : `G4 RED — ${gaps.length} gap(s). Each one is a cross-tenant door. Do not sell the SMB tier.`);
process.exit(gaps.length ? 1 : 0);
