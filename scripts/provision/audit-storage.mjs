/**
 * audit-storage — is any bucket public, and is any object outside its tenant?
 *
 * The companion to audit-policies.mjs, for the half of the data that does not
 * live in a table. On 2026-08-07 all four buckets carried `public = true`:
 * plant P&ID diagrams, work-order documents, JSA sign-off signatures and
 * employee photographs were served to anyone holding a URL, with no JWT and no
 * RLS involved. 0281 closed that and keyed objects `<company_id>/<file>`.
 *
 * A fix with no recurring check behind it is luck, not a control. This script
 * is the artefact an auditor samples — ISO 27001 A.8.3 / A.5.15, SOC 2 CC6.1,
 * GDPR Art. 32.
 *
 * Three findings, worst first:
 *
 *   PUBLIC BUCKET    objects readable with no authentication at all. Always a
 *                    live exposure, never a readiness gap.
 *   UNSCOPED OBJECT  no `<company_id>/` prefix. Readable only by the origin
 *                    tenant (0281), so it is a availability bug for everyone
 *                    else and a migration leftover — expected to be non-zero
 *                    until pre-0281 objects age out, hence --max-legacy.
 *   ORPHAN TENANT    prefixed with a company_id that no longer exists. Nobody
 *                    can read it; it is dead weight holding customer data.
 *
 * Read-only. Needs SUPABASE_ACCESS_TOKEN (sbp_…).
 *
 * Usage:
 *   node scripts/provision/audit-storage.mjs --project-ref <ref> [--strict]
 *   --strict exits 1 on any public bucket or orphan tenant (for CI).
 *   --max-legacy N tolerates N unscoped legacy objects (default: unlimited).
 */

const STRICT = process.argv.includes('--strict');
const refFlag = process.argv.indexOf('--project-ref');
const PROJECT_REF = (refFlag >= 0 ? process.argv[refFlag + 1] : '') || process.env.SUPABASE_PROJECT_REF || '';
const legacyFlag = process.argv.indexOf('--max-legacy');
const MAX_LEGACY = legacyFlag >= 0 ? Number(process.argv[legacyFlag + 1]) : Infinity;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!TOKEN) { console.error('SUPABASE_ACCESS_TOKEN is not set (a personal access token, sbp_…).'); process.exit(1); }
if (!PROJECT_REF) { console.error('Pass --project-ref <ref> (or set SUPABASE_PROJECT_REF).'); process.exit(1); }

const runSql = async (query) => {
    const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`query failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
};

const BUCKETS = ['avatars', 'assets', 'pid-diagrams', 'work-order-docs'];
const bucketList = BUCKETS.map(b => `'${b}'`).join(', ');

const findings = [];

// ── 1. Public buckets ───────────────────────────────────────────────────────
const publicBuckets = await runSql(`
    SELECT id, name, public FROM storage.buckets WHERE public IS TRUE ORDER BY id
`);
for (const b of publicBuckets) {
    findings.push({ level: 'PUBLIC BUCKET', detail: `${b.name} — objects readable without authentication` });
}

// ── 2. Objects with no tenant folder ────────────────────────────────────────
// Split on the first slash. An object named `foo.jpg` has no tenant; one named
// `<uuid>/foo.jpg` does.
const unscoped = await runSql(`
    SELECT bucket_id, count(*)::int AS n
      FROM storage.objects
     WHERE bucket_id IN (${bucketList})
       AND position('/' in name) = 0
     GROUP BY bucket_id
     ORDER BY bucket_id
`);
const legacyTotal = unscoped.reduce((sum, r) => sum + r.n, 0);
for (const r of unscoped) {
    findings.push({ level: 'UNSCOPED OBJECT', detail: `${r.bucket_id} — ${r.n} object(s) with no <company_id>/ prefix (pre-0281)` });
}

// ── 3. Objects prefixed with a company that no longer exists ────────────────
const orphans = await runSql(`
    SELECT o.bucket_id, split_part(o.name, '/', 1) AS company, count(*)::int AS n
      FROM storage.objects o
     WHERE o.bucket_id IN (${bucketList})
       AND position('/' in o.name) > 0
       -- Only consider well-formed UUID prefixes; anything else is a legacy
       -- object that merely happens to contain a slash.
       AND split_part(o.name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND NOT EXISTS (
             SELECT 1 FROM public.companies c
              WHERE c.id = split_part(o.name, '/', 1)::uuid
           )
     GROUP BY o.bucket_id, company
     ORDER BY o.bucket_id
`);
for (const r of orphans) {
    findings.push({ level: 'ORPHAN TENANT', detail: `${r.bucket_id} — ${r.n} object(s) under company ${r.company}, which no longer exists` });
}

// ── Report ──────────────────────────────────────────────────────────────────
const bad = findings.filter(f => f.level === 'PUBLIC BUCKET' || f.level === 'ORPHAN TENANT');

if (!findings.length) {
    console.log(`✓ storage clean — ${BUCKETS.length} buckets private, every object tenant-scoped.`);
} else {
    for (const f of findings) console.log(`${f.level.padEnd(16)} ${f.detail}`);
    console.log('');
    console.log(`${bad.length} blocking finding(s), ${legacyTotal} legacy unscoped object(s).`);
}

if (STRICT && bad.length) {
    console.error('\n--strict: blocking findings present.');
    process.exit(1);
}
if (STRICT && legacyTotal > MAX_LEGACY) {
    console.error(`\n--strict: ${legacyTotal} unscoped objects exceeds --max-legacy ${MAX_LEGACY}.`);
    process.exit(1);
}
