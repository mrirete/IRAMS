/**
 * audit-policies — does the repo describe the database's actual security posture?
 *
 * Migrations are supposed to BE the record of what RLS looks like in production.
 * On 2026-08-02 they weren't: `p2_select_error_logs` and `p2_select_audit_logs`
 * existed in the database, appeared in no migration file, and silently defeated
 * migration 0238 — which applied cleanly, logged "ok", and changed nothing.
 * RLS is permissive, so an unknown `USING (true)` beside your new admin-only
 * policy grants exactly what it granted before, and `DROP POLICY IF EXISTS`
 * only removes the name you happened to think of.
 *
 * This replays every migration in order (CREATE POLICY / DROP POLICY / ENABLE |
 * DISABLE ROW LEVEL SECURITY), builds the posture the repo *claims*, and diffs
 * it against what the database actually has.
 *
 * Four findings, worst first:
 *
 *   RLS DISABLED   the table has no row protection at all. Policies on it are
 *                  decoration; every authenticated user reads everything.
 *   ORPHAN POLICY  live in the database, absent from every migration. Nobody
 *                  reviewed it, and it will defeat the next policy you write.
 *   MISSING POLICY the repo creates it, the database doesn't have it. Someone
 *                  dropped it by hand, or a migration never ran.
 *   NO POLICIES    RLS on, zero policies = deny-all. Usually a mistake, and it
 *                  fails closed so it can sit unnoticed until a feature breaks.
 *
 * Read-only. Needs SUPABASE_ACCESS_TOKEN (sbp_…).
 *
 * Usage:
 *   node scripts/provision/audit-policies.mjs --project-ref <ref> [--strict]
 *   --strict exits 1 on any orphan or disabled table (for CI).
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(HERE, '../../src/frontend/supabase/migrations');

const STRICT = process.argv.includes('--strict');
const refFlag = process.argv.indexOf('--project-ref');
const PROJECT_REF = (refFlag >= 0 ? process.argv[refFlag + 1] : '') || process.env.SUPABASE_PROJECT_REF || '';
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

// ── What the repo claims ────────────────────────────────────────────────────
// Replayed in filename order so a policy created in 0100 and dropped in 0200 is
// correctly absent at the end. Grepping for CREATE alone would call that an
// expected policy and mask a real deletion.

const ident = String.raw`(?:"([^"]+)"|([A-Za-z0-9_]+))`;
const tbl = String.raw`(?:public\.)?(?:"([^"]+)"|([A-Za-z0-9_]+))`;
const pick = (a, b) => a ?? b;

async function claimedPosture() {
    const files = (await readdir(MIGRATIONS_DIR)).filter(f => f.toLowerCase().endsWith('.sql')).sort();
    const policies = new Map();   // "table.policy" → file that last created it
    const rlsState = new Map();   // table → 'enabled' | 'disabled' (last statement wins)
    const dynamic = new Map();    // policy-name pattern → file that generates it

    for (const file of files) {
        const raw = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
        // Strip SQL comments first. Migrations here routinely document their own
        // rollback as `-- DROP POLICY IF EXISTS "x" ON y;`, and parsing that as
        // a real DROP deletes a live, correctly-created policy from the expected
        // set — which then shows up as an orphan. 0197's rollback note did
        // exactly that. (Second time today a comment has fooled a parser; the
        // silent-success scanner had the same bug.)
        const sql = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');

        // Apply CREATE and DROP in SOURCE ORDER. Handling all creates then all
        // drops looks equivalent and is not: `DROP POLICY IF EXISTS x; CREATE
        // POLICY x;` — the single most common shape in this repo — would net to
        // "absent" and report a live, correctly-created policy as an orphan.
        const stmts = [
            ...[...sql.matchAll(new RegExp(String.raw`CREATE\s+POLICY\s+${ident}\s+ON\s+${tbl}`, 'gi'))]
                .map(m => ({ at: m.index, op: 'create', key: `${pick(m[3], m[4])}.${pick(m[1], m[2])}` })),
            ...[...sql.matchAll(new RegExp(String.raw`DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?${ident}\s+ON\s+${tbl}`, 'gi'))]
                .map(m => ({ at: m.index, op: 'drop', key: `${pick(m[3], m[4])}.${pick(m[1], m[2])}` })),
        ].sort((a, b) => a.at - b.at);

        for (const s of stmts) {
            if (s.op === 'create') policies.set(s.key, file);
            else policies.delete(s.key);
        }
        for (const m of sql.matchAll(new RegExp(String.raw`ALTER\s+TABLE\s+${tbl}\s+(ENABLE|DISABLE)\s+ROW\s+LEVEL\s+SECURITY`, 'gi'))) {
            rlsState.set(pick(m[1], m[2]), m[3].toLowerCase() === 'enable' ? 'enabled' : 'disabled');
        }

        // ── Policies generated by PL/pgSQL loops ────────────────────────────
        // 21 migrations build policies with EXECUTE format(...) over a table
        // array. Those policies ARE authored and reviewed; they simply are not
        // literal CREATE POLICY text. Ignoring that produced a first run
        // claiming 465 orphans, nearly all of which were 0186's deliberate
        // phase-2 hardening — a false alarm big enough to bury the real ones.
        //
        // Two shapes appear:
        //   'p2_select_' || t                 → prefix, table-suffixed name
        //   CREATE POLICY "authenticated_access" ON public.%I   → constant name
        //   'p2_select_' || t              → concatenated prefix
        for (const m of sql.matchAll(/'([a-z0-9_]+_)'\s*\|\|\s*\w+/gi)) {
            dynamic.set(`prefix:${m[1]}`, file);
        }
        //   CREATE POLICY "auth_select_%s" ON %I …   → format-substituted suffix
        for (const m of sql.matchAll(/CREATE\s+POLICY\s+"?([a-z0-9_]+_)%[sI]"?/gi)) {
            dynamic.set(`prefix:${m[1]}`, file);
        }
        //   CREATE POLICY "authenticated_access" ON public.%I …   → constant name
        for (const m of sql.matchAll(/CREATE\s+POLICY\s+(?:"([^"%]+)"|([A-Za-z0-9_]+))\s+ON\s+(?:public\.)?%I/gi)) {
            dynamic.set(`name:${pick(m[1], m[2])}`, file);
        }
    }
    return { policies, rlsState, dynamic, fileCount: files.length };
}

/** Is this live policy explained by a generated pattern? */
function generatedBy(policy, dynamic) {
    const exact = dynamic.get(`name:${policy.policyname}`);
    if (exact) return exact;
    for (const [key, file] of dynamic) {
        if (!key.startsWith('prefix:')) continue;
        const prefix = key.slice('prefix:'.length);
        // 'p2_select_' || t  produces exactly  p2_select_<table>
        if (policy.policyname === `${prefix}${policy.tablename}`) return file;
    }
    return null;
}

// ── What the database actually has ──────────────────────────────────────────

async function livePosture() {
    const pols = await runSql(`
        SELECT tablename, policyname, cmd, qual, with_check
        FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname`);
    const tables = await runSql(`
        SELECT c.relname AS tablename, c.relrowsecurity AS rls_enabled
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`);
    return { pols, tables };
}

// ── Compare ─────────────────────────────────────────────────────────────────

const claimed = await claimedPosture();
const live = await livePosture();

console.log(`Policy audit — ${PROJECT_REF}`);
console.log(`Replayed ${claimed.fileCount} migration(s) → ${claimed.policies.size} policy/policies expected`);
console.log(`Database has ${live.pols.length} policy/policies across ${live.tables.length} table(s)\n`);

const liveKeys = new Set(live.pols.map(p => `${p.tablename}.${p.policyname}`));
const unaccounted = live.pols.filter(p => !claimed.policies.has(`${p.tablename}.${p.policyname}`));
const generated = unaccounted.filter(p => generatedBy(p, claimed.dynamic));
const orphans = unaccounted.filter(p => !generatedBy(p, claimed.dynamic));
const missing = [...claimed.policies.entries()].filter(([k]) => !liveKeys.has(k));

console.log(`Of ${unaccounted.length} not matched literally, ${generated.length} come from EXECUTE format loops (accounted for)\n`);

// A table only matters here if the repo ever mentioned it — Supabase's own
// internal tables are not this repo's business.
const known = new Set([...claimed.policies.keys()].map(k => k.split('.')[0]).concat([...claimed.rlsState.keys()]));
const disabled = live.tables.filter(t => known.has(t.tablename) && !t.rls_enabled);
const policedTables = new Set(live.pols.map(p => p.tablename));
const denyAll = live.tables.filter(t => t.rls_enabled && known.has(t.tablename) && !policedTables.has(t.tablename));

const section = (title, rows, render) => {
    console.log(`── ${title}: ${rows.length}`);
    if (!rows.length) console.log('   none');
    rows.forEach(render);
    console.log('');
};

section('RLS DISABLED (no row protection at all — policies on these are decoration)', disabled,
    (t) => console.log(`   ✗ ${t.tablename}`));

section('ORPHAN policies (live in the database, in no migration)', orphans, (p) => {
    const q = (p.qual ?? p.with_check ?? '').toString().slice(0, 60);
    const open = /^true$/i.test((p.qual ?? '').toString().trim());
    console.log(`   ${open ? '✗' : '·'} ${p.tablename}.${p.policyname}  ${p.cmd}  ${q}${open ? '   ← PERMISSIVE, will defeat any policy you add' : ''}`);
});

// Mostly benign: the hardening migrations (0111/0112/0150/0155/0186) wipe every
// existing policy on a table inside a loop before recreating their own. That
// drop is dynamic, so this replay cannot see it and still expects the original.
// Read this list for names you do NOT recognise, not as a defect count.
section('MISSING policies (in a migration, not in the database — mostly superseded by later hardening loops)', missing,
    ([k, file]) => console.log(`   · ${k}   (from ${file})`));

section('RLS on but NO policies (deny-all — usually unintended)', denyAll,
    (t) => console.log(`   · ${t.tablename}`));

// ── Per-row function calls ──────────────────────────────────────────────────
// A STABLE function called bare in a policy is evaluated ONCE PER ROW; Postgres
// does not hoist it, even with constant arguments. Wrapping it in an
// uncorrelated scalar subquery — USING ((SELECT f())) — makes it an InitPlan,
// evaluated once. Measured on 200k rows: is_admin() bare 3,013 ms vs 20 ms
// wrapped; caller_can() bare 18,969 ms vs 33 ms (0243).
//
// Invisible on small tables, which is exactly why it needs a detector: the
// symptom only appears once a customer has real data.
const FN = /\b(is_admin|caller_can|caller_can_view_all_requests|caller_work_centers|caller_user_id)\s*\(/;

// Remove already-wrapped calls before looking for bare ones. The pattern has to
// account for the function's OWN parentheses — `[^)]*` stops at the first `)`,
// which is the inner one, so `(SELECT is_admin())` was only half-stripped and
// the finding got attributed to the wrong function.
const stripWrapped = (expr) => expr.replace(/\(\s*SELECT\s+[^()]*\([^()]*\)[^()]*\)/gi, '');

const perRow = live.pols
    .map(p => ({ p, bare: stripWrapped(`${p.qual ?? ''} ${p.with_check ?? ''}`) }))
    .filter(({ bare }) => FN.test(bare));

section('PER-ROW function calls in policies (wrap in (SELECT …) — see 0243)', perRow, ({ p, bare }) => {
    const which = FN.exec(bare)?.[1];
    console.log(`   ✗ ${p.tablename}.${p.policyname}  ${p.cmd}  calls ${which}() bare`);
});

const blocking = disabled.length + orphans.filter(p => /^true$/i.test((p.qual ?? '').toString().trim())).length;
console.log('═'.repeat(72));
console.log(blocking === 0
    ? 'No disabled tables and no permissive orphans. The repo describes the database.'
    : `${blocking} blocking finding(s): the repo does NOT describe the database. Capture or remove each before writing new policies.`);

process.exit(STRICT && blocking > 0 ? 1 : 0);
