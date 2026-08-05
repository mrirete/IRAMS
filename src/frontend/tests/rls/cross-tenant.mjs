/**
 * Gate G3 — can one tenant reach another's data? The answer must be no, on
 * every table, for reads AND writes.
 *
 * This is the test the SMB tier rests on. Every other gate in this workstream
 * has an acceptable partial result; this one does not. A single table missing
 * its tenant conjunct is a cross-customer breach, and it stays invisible until
 * the day a second customer exists — by which point it is an incident.
 *
 * ── Probing 150 tables without knowing 150 schemas ──────────────────────────
 * Seeding a valid row per table would mean satisfying 150 different sets of
 * NOT NULLs and foreign keys. Instead it borrows a row that already exists,
 * reassigns it to a probe tenant, asks whether tenant A can still see or change
 * it, and hands it back.
 *
 * ── Why the flip and restore are bulk operations ────────────────────────────
 * The first version did flip/probe/restore per table — roughly 500 Management
 * API calls — and the API returned 502 partway through, leaving a `warranties`
 * row stranded in the probe tenant. A test that corrupts data when it fails is
 * worse than no test. Now: one statement flips every table, the probes go over
 * PostgREST (a different, more tolerant endpoint), one statement restores, and
 * the restore runs whatever happens, including on a thrown error.
 *
 * ── Why SUPER_ADMIN is the prober ───────────────────────────────────────────
 * They hold every role permission, so a denial cannot be RBAC doing the work —
 * it isolates tenancy. Probing as a technician would prove nothing: their reads
 * are already blocked on half these tables for role reasons.
 *
 * Tables with no rows yield no verdict and are reported INCONCLUSIVE rather
 * than counted as passes.
 *
 * ── What this gate structurally CANNOT see — run G4 as well ─────────────────
 * Two blind spots, and only the first is visible in the output:
 *
 *   • empty tables — no row to borrow, reported inconclusive (70 of them)
 *   • tables with NO `id` column — composite primary keys, so a probe that
 *     addresses rows as `?id=eq.…` cannot name them. These were silently
 *     absent from the denominator entirely until this was written down.
 *
 * movement_type_gl_overrides sat in both: created by 0262 AFTER 0261's one-shot
 * policy sweep, carrying `USING (true)`, in a schema this gate had just called
 * green. tests/rls/tenant-completeness.mjs (G4) is the complement — it proves
 * statically, over all 152 tables, that each one HAS the conjunct. This gate
 * proves the conjunct WORKS. Neither alone is the guarantee.
 *
 * Usage: SUPABASE_ACCESS_TOKEN=sbp_… npx vite-node tests/rls/cross-tenant.mjs
 */
const SB = 'https://hacrebcfvyqdnjvilhqc.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhhY3JlYmNmdnlxZG5qdmlsaHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1Mjk5ODAsImV4cCI6MjA4NzEwNTk4MH0.F-2Fordc833NAuprdRBmm5s-Bd5fQsO0vxUK7_06AJ0';
const REF = 'hacrebcfvyqdnjvilhqc';
const TOK = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOK) { console.error('SUPABASE_ACCESS_TOKEN is not set (sbp_…).'); process.exit(1); }

const TENANT_B = '00000000-0000-0000-0000-00000000b000';

/** Retries 5xx — the Management API is flaky under load, and the restore must not be the thing that fails. */
const mgmt = async (sql, tries = 4) => {
    for (let i = 0; i < tries; i++) {
        const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
            method: 'POST', headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: sql }),
        });
        const t = await r.text();
        if (r.ok) return JSON.parse(t);
        if (r.status < 500) throw new Error(`mgmt ${r.status}: ${t.slice(0, 200)}`);
        await new Promise(s => setTimeout(s, 1500 * (i + 1)));
    }
    throw new Error('mgmt: gave up after retries');
};

const signIn = async (email) => {
    const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'Password123!' }),
    });
    return r.ok ? (await r.json()).access_token : null;
};
const asUser = (jwt) => ({ apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' });

const [tenantA] = await mgmt(`SELECT id, name FROM companies WHERE active IS TRUE AND id <> '${TENANT_B}' ORDER BY created_at ASC LIMIT 1`);
const jwt = await signIn('admin001@cainergy.com');
if (!jwt) { console.error('SUPER_ADMIN sign-in failed'); process.exit(1); }

// Every tenant-owned table. users/companies are deliberately not tenant-gated
// (gating users would break the login path that resolves the tenant).
const TABLES = `
    SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='public' AND c.relkind='r'
       AND EXISTS (SELECT 1 FROM information_schema.columns col
                    WHERE col.table_schema='public' AND col.table_name=c.relname AND col.column_name='company_id')
       AND EXISTS (SELECT 1 FROM information_schema.columns col
                    WHERE col.table_schema='public' AND col.table_name=c.relname AND col.column_name='id')
       AND c.relname NOT IN ('users','companies','numbering_config_overrides')`;

console.log(`tenant A: ${tenantA.name} (${tenantA.id.slice(0, 8)}…)`);
console.log(`prober  : admin001 / SUPER_ADMIN — every role permission, so any denial below is tenancy\n`);

let readLeaks = [], writeLeaks = [], probes = [];

try {
    await mgmt(`INSERT INTO companies (id, code, name, active)
                VALUES ('${TENANT_B}', 'PROBE', '__cross_tenant_probe__', true)
                ON CONFLICT (id) DO NOTHING`);

    // One statement: hand one row per table to the probe tenant.
    await mgmt(`
DO $$
DECLARE r record;
BEGIN
    FOR r IN ${TABLES} LOOP
        EXECUTE format(
            'UPDATE public.%I SET company_id = %L WHERE id = (SELECT id FROM public.%I WHERE company_id = %L LIMIT 1)',
            r.t, '${TENANT_B}', r.t, '${tenantA.id}');
    END LOOP;
END $$;`);

    // Which tables actually got one (i.e. had a row to borrow)?
    const list = await mgmt(`
        SELECT t, id FROM (
          ${(await mgmt(TABLES)).map(r => `SELECT '${r.t}' AS t, (SELECT id::text FROM public.${r.t} WHERE company_id='${TENANT_B}' LIMIT 1) AS id`).join(' UNION ALL ')}
        ) q WHERE id IS NOT NULL ORDER BY t`);
    probes = list;

    // Probe over PostgREST — no Management API in this loop.
    for (const { t, id } of probes) {
        const rd = await fetch(`${SB}/rest/v1/${t}?select=id&id=eq.${id}`, { headers: asUser(jwt) });
        const rows = rd.ok ? await rd.json() : [];
        if (Array.isArray(rows) && rows.length > 0) readLeaks.push(t);

        // Same-value write. .select() makes the affected-row count observable —
        // an RLS USING clause refuses by filtering, silently, without an error.
        const wr = await fetch(`${SB}/rest/v1/${t}?id=eq.${id}&select=id`, {
            method: 'PATCH', headers: { ...asUser(jwt), Prefer: 'return=representation' },
            body: JSON.stringify({ company_id: TENANT_B }),
        });
        const wrote = wr.ok ? await wr.json() : [];
        if (Array.isArray(wrote) && wrote.length > 0) writeLeaks.push(t);
    }
} finally {
    // Runs on success, failure, or throw. Sweeps by company_id, so it does not
    // depend on remembering which rows were touched.
    const all = (await mgmt(TABLES)).map(r => r.t);
    await mgmt(`
DO $$
DECLARE r record;
BEGIN
    FOR r IN (SELECT unnest(ARRAY[${all.map(t => `'${t}'`).join(',')}]) AS t) LOOP
        EXECUTE format('UPDATE public.%I SET company_id = %L WHERE company_id = %L', r.t, '${tenantA.id}', '${TENANT_B}');
    END LOOP;
END $$;`);
    const union = all.map(t => `SELECT '${t}' AS t, count(*)::int n FROM public.${t} WHERE company_id='${TENANT_B}'`).join(' UNION ALL ');
    const stray = await mgmt(`SELECT * FROM (${union}) q WHERE n > 0`);
    await mgmt(`DELETE FROM companies WHERE id = '${TENANT_B}'`);
    console.log(`teardown: stray rows left in the probe tenant: ${stray.length ? '❌ ' + JSON.stringify(stray) : '0 ✅'}\n`);
    if (stray.length) readLeaks.push('__teardown_incomplete__');
}

const all = (await mgmt(TABLES)).map(r => r.t);
const inconclusive = all.filter(t => !probes.some(p => p.t === t));

// Tables this gate cannot address at all. Reporting them matters more than it
// looks: excluded from `all`, they were excluded from the denominator too, so
// "76 of 146" quietly described a smaller universe than "every tenant table".
const unreachable = await mgmt(`
    SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='public' AND c.relkind='r'
       AND EXISTS (SELECT 1 FROM information_schema.columns col
                    WHERE col.table_schema='public' AND col.table_name=c.relname AND col.column_name='company_id')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns col
                        WHERE col.table_schema='public' AND col.table_name=c.relname AND col.column_name='id')
       AND c.relname NOT IN ('users','companies')
     ORDER BY c.relname`);

console.log(`tables probed: ${probes.length} of ${all.length}   (${inconclusive.length} empty — no verdict)`);
console.log(`plus ${unreachable.length} table(s) this gate cannot address at all (no 'id' column): ${unreachable.map(r => r.t).join(', ')}`);
console.log(`→ those are G4's job: node tests/rls/tenant-completeness.mjs --self-test\n`);
console.log(`cross-tenant READS  : ${readLeaks.length === 0 ? '0 ✅' : `${readLeaks.length} ❌  ${readLeaks.join(', ')}`}`);
console.log(`cross-tenant WRITES : ${writeLeaks.length === 0 ? '0 ✅' : `${writeLeaks.length} ❌  ${writeLeaks.join(', ')}`}`);

const failed = readLeaks.length + writeLeaks.length;
console.log('\n' + '═'.repeat(70));
console.log(failed === 0
    ? `G3 GREEN — ${probes.length} tables probed, zero cross-tenant reads, zero cross-tenant writes.`
    : `G3 RED — ${failed} finding(s). The SMB tier is NOT safe to sell.`);
if (inconclusive.length) {
    console.log(`\n${inconclusive.length} empty table(s), so no verdict — seed before trusting a clean run:`);
    console.log('  ' + inconclusive.slice(0, 20).join(', ') + (inconclusive.length > 20 ? ', …' : ''));
}
process.exit(failed ? 1 : 0);
