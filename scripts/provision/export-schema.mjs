#!/usr/bin/env node
/**
 * export-schema — generate a baseline schema file from a live project.
 *
 * WHY: replaying this repo's 230 migrations onto a fresh project fails (43 of
 * them — see docs/Tenant-Provisioning-Runbook.md §6). The standard fix is to
 * squash history into a single schema dump and provision new tenants from
 * that. `supabase db dump` runs pg_dump inside Docker, which isn't available
 * here, so this asks Postgres to emit its own DDL over the Management API
 * instead: pg_get_functiondef / pg_get_indexdef / pg_get_constraintdef /
 * pg_get_triggerdef / pg_get_viewdef, plus catalog reads for the rest.
 *
 * Emission order matters and mirrors pg_dump:
 *   extensions → enum types → sequences → functions → tables → constraints
 *   → indexes → views → triggers → RLS + policies → grants → comments
 * `check_function_bodies = off` is set first so functions can be created
 * before the tables they reference.
 *
 * Usage:
 *   node scripts/provision/export-schema.mjs --project-ref <ref> \
 *        [--out src/frontend/supabase/baseline/schema.sql] [--schema public]
 *
 * Auth: SUPABASE_ACCESS_TOKEN (sbp_…).
 *
 * NOT a pg_dump replacement in general — it targets what this application
 * uses. Always verify with `--verify` against a scratch project (see the
 * runbook) rather than trusting it blind.
 */
import { writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const API = 'https://api.supabase.com/v1';

/** Supabase-managed schemas: never emitted — the platform owns them. */
const MANAGED_EXTENSIONS = new Set(['plpgsql', 'supabase_vault', 'pg_stat_statements']);

function parseArgs(argv) {
    const args = {
        projectRef: process.env.SUPABASE_PROJECT_REF ?? '',
        out: resolve(REPO, 'src/frontend/supabase/baseline/schema.sql'),
        schema: 'public',
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--project-ref') args.projectRef = argv[++i] ?? '';
        else if (a === '--out') args.out = resolve(process.cwd(), argv[++i] ?? '');
        else if (a === '--schema') args.schema = argv[++i] ?? 'public';
    }
    return args;
}

async function q(projectRef, token, query) {
    const res = await fetch(`${API}/projects/${projectRef}/database/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
    });
    const text = await res.text();
    if (!res.ok) {
        let detail = text;
        try { detail = JSON.parse(text).message ?? text; } catch { /* raw */ }
        throw new Error(`HTTP ${res.status}: ${String(detail).slice(0, 400)}`);
    }
    try {
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
}

const section = (title) => `\n-- ══════════════════════════════════════════════\n-- ${title}\n-- ══════════════════════════════════════════════\n`;

// ── extractors ────────────────────────────────────────────────────────────

async function extensions(p, t) {
    const rows = await q(p, t, `
        SELECT e.extname, n.nspname AS schema
        FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
        ORDER BY e.extname;`);
    return rows
        .filter((r) => !MANAGED_EXTENSIONS.has(r.extname))
        .map((r) => `CREATE EXTENSION IF NOT EXISTS "${r.extname}" WITH SCHEMA ${r.schema};`)
        .join('\n');
}

async function enumTypes(p, t, schema) {
    const rows = await q(p, t, `
        SELECT t.typname,
               string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder) AS labels
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE n.nspname = '${schema}'
        GROUP BY t.typname ORDER BY t.typname;`);
    return rows.map((r) => `DO $$ BEGIN
    CREATE TYPE ${schema}.${r.typname} AS ENUM (${r.labels});
EXCEPTION WHEN duplicate_object THEN NULL; END $$;`).join('\n');
}

async function sequences(p, t, schema) {
    // ALL sequences, deliberately. An earlier version excluded auto-dependent
    // ('a' in pg_depend) sequences on the theory that serial/identity
    // sequences "are created with their table and would collide" — but THIS
    // exporter never renders SERIAL: every column comes out as an explicit
    // `integer DEFAULT nextval('…_seq')`, which creates nothing. So owned
    // sequences (e.g. hierarchy_config_id_seq, attached via OWNED BY in 0273)
    // were skipped here AND not created by the table DDL, and the first real
    // load into an empty project died at CREATE TABLE with "relation
    // …_id_seq does not exist" — invisible to verify-baseline, which checks
    // content, not execution order. IF NOT EXISTS keeps the emission safe even
    // if a future generator change reintroduces serial-style DDL.
    const rows = await q(p, t, `
        SELECT c.relname
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'S' AND n.nspname = '${schema}'
        ORDER BY c.relname;`);
    return rows.map((r) => `CREATE SEQUENCE IF NOT EXISTS ${schema}.${r.relname};`).join('\n');
}

async function functions(p, t, schema) {
    const rows = await q(p, t, `
        SELECT pg_get_functiondef(pr.oid) AS def
        FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
        WHERE n.nspname = '${schema}'
          AND pr.prokind IN ('f','p')
          -- skip functions owned by an extension; CREATE EXTENSION makes them
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = pr.oid AND d.deptype = 'e')
        ORDER BY pr.proname;`);
    return rows.map((r) => `${r.def};`).join('\n\n');
}

async function tables(p, t, schema) {
    const rows = await q(p, t, `
        SELECT c.relname AS table_name,
               string_agg(
                   '    ' || quote_ident(a.attname) || ' ' ||
                   format_type(a.atttypid, a.atttypmod) ||
                   CASE WHEN a.attidentity IN ('a','d')
                        THEN ' GENERATED ' || CASE a.attidentity WHEN 'a' THEN 'ALWAYS' ELSE 'BY DEFAULT' END || ' AS IDENTITY'
                        WHEN a.attgenerated = 's'
                        THEN ' GENERATED ALWAYS AS (' || pg_get_expr(ad.adbin, ad.adrelid) || ') STORED'
                        WHEN ad.adbin IS NOT NULL
                        THEN ' DEFAULT ' || pg_get_expr(ad.adbin, ad.adrelid)
                        ELSE '' END ||
                   CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END,
                   E',\\n' ORDER BY a.attnum
               ) AS cols
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
        LEFT JOIN pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
        WHERE c.relkind = 'r' AND n.nspname = '${schema}'
        GROUP BY c.relname ORDER BY c.relname;`);
    return rows.map((r) => `CREATE TABLE IF NOT EXISTS ${schema}.${r.table_name} (\n${r.cols}\n);`).join('\n\n');
}

async function constraints(p, t, schema) {
    // PK/UNIQUE/CHECK first, then FK — FKs need their target tables' keys.
    const rows = await q(p, t, `
        SELECT c.relname AS table_name, con.conname, pg_get_constraintdef(con.oid) AS def,
               CASE con.contype WHEN 'f' THEN 2 ELSE 1 END AS phase
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = '${schema}' AND con.contype IN ('p','u','c','f')
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = con.oid AND d.deptype = 'e')
        ORDER BY phase, c.relname, con.conname;`);
    return rows.map((r) => `DO $$ BEGIN
    ALTER TABLE ${schema}.${r.table_name} ADD CONSTRAINT ${r.conname} ${r.def};
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;`).join('\n');
}

async function indexes(p, t, schema) {
    // Constraint-backed indexes are created by the constraint itself.
    const rows = await q(p, t, `
        SELECT indexdef
        FROM pg_indexes i
        WHERE i.schemaname = '${schema}'
          AND NOT EXISTS (
              SELECT 1 FROM pg_constraint con
              JOIN pg_class ic ON ic.oid = con.conindid
              WHERE ic.relname = i.indexname
          )
        ORDER BY i.tablename, i.indexname;`);
    return rows
        .map((r) => r.indexdef.replace(/^CREATE (UNIQUE )?INDEX /i, (m, u) => `CREATE ${u ?? ''}INDEX IF NOT EXISTS `))
        .map((d) => `${d};`)
        .join('\n');
}

async function views(p, t, schema) {
    // Emitted in TOPOLOGICAL order (referenced views first), not alphabetical.
    // An earlier version ordered by dependent-COUNT descending — a one-level
    // heuristic that ties every link of a chain A→B→C at count 1 and lets the
    // alphabetical tiebreak emit B before C. The first real load into an empty
    // project died exactly there: a sem_* view referencing sem_wo_receiver,
    // which sorts later. Depth = longest path to a view with no view
    // dependencies; emit ascending. Views cannot be cyclic, so the recursion
    // terminates.
    const rows = await q(p, t, `
        WITH RECURSIVE edges AS (
            SELECT DISTINCT dc.oid AS view_oid, d.refobjid AS ref_oid
            FROM pg_depend d
            JOIN pg_rewrite rw ON rw.oid = d.objid
            JOIN pg_class dc ON dc.oid = rw.ev_class
            JOIN pg_class rc ON rc.oid = d.refobjid
            JOIN pg_namespace n ON n.oid = dc.relnamespace
            WHERE dc.relkind = 'v' AND rc.relkind = 'v'
              AND dc.oid <> d.refobjid AND n.nspname = '${schema}'
        ),
        depth (view_oid, d) AS (
            SELECT c.oid, 0
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind = 'v' AND n.nspname = '${schema}'
              AND NOT EXISTS (SELECT 1 FROM edges e WHERE e.view_oid = c.oid)
            UNION ALL
            SELECT e.view_oid, dp.d + 1
            FROM edges e JOIN depth dp ON dp.view_oid = e.ref_oid
        )
        SELECT c.relname AS view_name,
               pg_get_viewdef(c.oid, true) AS def,
               COALESCE((SELECT option_value FROM pg_options_to_table(c.reloptions)
                         WHERE option_name = 'security_invoker'), 'false') AS security_invoker
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN (SELECT view_oid, max(d) AS d FROM depth GROUP BY view_oid) dd ON dd.view_oid = c.oid
        WHERE c.relkind = 'v' AND n.nspname = '${schema}'
        ORDER BY COALESCE(dd.d, 0), c.relname;`);
    return rows.map((r) => {
        const opts = String(r.security_invoker) === 'true' ? ' WITH (security_invoker = true)' : '';
        return `CREATE OR REPLACE VIEW ${schema}.${r.view_name}${opts} AS\n${r.def}`;
    }).join('\n\n');
}

async function triggers(p, t, schema) {
    const rows = await q(p, t, `
        SELECT tg.tgname, c.relname AS table_name, pg_get_triggerdef(tg.oid) AS def
        FROM pg_trigger tg
        JOIN pg_class c ON c.oid = tg.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = '${schema}' AND NOT tg.tgisinternal
        ORDER BY c.relname, tg.tgname;`);
    return rows.map((r) =>
        `DROP TRIGGER IF EXISTS ${r.tgname} ON ${schema}.${r.table_name};\n${r.def};`).join('\n');
}

async function rlsAndPolicies(p, t, schema) {
    const enabled = await q(p, t, `
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname = '${schema}' AND c.relrowsecurity
        ORDER BY c.relname;`);
    const pol = await q(p, t, `
        SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
        FROM pg_policies WHERE schemaname = '${schema}'
        ORDER BY tablename, policyname;`);

    const enableSql = enabled.map((r) => `ALTER TABLE ${schema}.${r.relname} ENABLE ROW LEVEL SECURITY;`).join('\n');
    const polSql = pol.map((r) => {
        const roles = String(r.roles ?? '{}').replace(/^\{|\}$/g, '');
        const to = roles ? ` TO ${roles}` : '';
        const perm = String(r.permissive).toUpperCase() === 'PERMISSIVE' ? '' : ' AS RESTRICTIVE';
        const using = r.qual ? `\n    USING (${r.qual})` : '';
        const check = r.with_check ? `\n    WITH CHECK (${r.with_check})` : '';
        return `DROP POLICY IF EXISTS ${JSON.stringify(r.policyname)} ON ${schema}.${r.tablename};\n` +
            `CREATE POLICY ${JSON.stringify(r.policyname)} ON ${schema}.${r.tablename}${perm} FOR ${r.cmd}${to}${using}${check};`;
    }).join('\n');

    return [enableSql, polSql].filter(Boolean).join('\n\n');
}

async function grants(p, t, schema) {
    const rows = await q(p, t, `
        SELECT grantee, table_name, string_agg(DISTINCT privilege_type, ', ') AS privs
        FROM information_schema.role_table_grants
        WHERE table_schema = '${schema}' AND grantee IN ('anon','authenticated','service_role')
        GROUP BY grantee, table_name ORDER BY table_name, grantee;`);
    return rows.map((r) => `GRANT ${r.privs} ON ${schema}.${r.table_name} TO ${r.grantee};`).join('\n');
}

// ── main ──────────────────────────────────────────────────────────────────

async function main() {
    const { projectRef, out, schema } = parseArgs(process.argv.slice(2));
    const token = process.env.SUPABASE_ACCESS_TOKEN;
    if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is not set.');
    if (!projectRef) throw new Error('Pass --project-ref <ref>.');

    console.log(`Exporting schema "${schema}" from ${projectRef}…`);

    const steps = [
        ['Extensions', extensions],
        ['Enum types', enumTypes],
        ['Sequences', sequences],
        ['Functions', functions],
        ['Tables', tables],
        ['Constraints', constraints],
        ['Indexes', indexes],
        ['Views', views],
        ['Triggers', triggers],
        ['Row Level Security', rlsAndPolicies],
        ['Grants', grants],
    ];

    const parts = [
        `-- IREAMS baseline schema — generated from project ${projectRef} on ${new Date().toISOString().slice(0, 10)}`,
        `-- Generated by scripts/provision/export-schema.mjs. Do not hand-edit;`,
        `-- re-export instead. New tenants load this INSTEAD of replaying migration`,
        `-- history (see docs/Tenant-Provisioning-Runbook.md §6).`,
        ``,
        `SET check_function_bodies = off;`,
        ``,
    ];

    for (const [title, fn] of steps) {
        process.stdout.write(`  ${title.padEnd(20)}`);
        const sql = await fn(projectRef, token, schema);
        const count = sql ? sql.split('\n').filter((l) => l.trim()).length : 0;
        console.log(sql ? `${count} line(s)` : 'none');
        if (sql) parts.push(section(title), sql, '');
    }

    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, parts.join('\n'), 'utf8');
    console.log(`\n✔ Wrote ${out}`);

    // ── Staleness stamp ─────────────────────────────────────────────────────
    // The baseline went stale silently TWICE (§3.2a of the runbook: 2026-08-01
    // missing RBAC+tenancy; 2026-08-15 missing 0283–0292). This stamp records
    // the highest migration number the export absorbs; apply-migrations.mjs
    // --baseline REFUSES when the repo has newer migrations, so a stale
    // baseline can never again be silently marked as covering them.
    // The stamp comes from the ORIGIN'S LEDGER, not the repo listing: a repo
    // file that hasn't been applied to the origin is not in this export, so
    // repo-max would overstate what the baseline absorbs.
    const migDir = resolve(dirname(out), '../migrations');
    const nums = (await readdir(migDir))
        .map((f) => /^(\d{4})[a-z]?_/.exec(f)?.[1])
        .filter(Boolean)
        .map(Number);
    const repoMax = String(Math.max(...nums)).padStart(4, '0');
    let absorbs = null;
    try {
        const led = await q(projectRef, token,
            `SELECT max(substring(name from '^[0-9]{4}')) AS m FROM public.schema_migrations;`);
        absorbs = led?.[0]?.m || null;
    } catch { /* no ledger on origin */ }
    if (!absorbs) {
        console.warn(`⚠ Origin has no schema_migrations ledger — stamping repo max ${repoMax} on trust.`);
        absorbs = repoMax;
    } else if (repoMax > absorbs) {
        console.warn(`⚠ Repo has migrations up to ${repoMax} but the origin has only applied ≤ ${absorbs}.`);
        console.warn(`  This baseline absorbs ≤ ${absorbs}; apply the pending migrations to the origin and re-export.`);
    }
    const stamp = resolve(dirname(out), 'ABSORBS');
    await writeFile(stamp, `${absorbs}\nexported ${new Date().toISOString()} from ${projectRef} (origin ledger max; repo max ${repoMax})\n`, 'utf8');
    console.log(`✔ Stamped ${stamp} — baseline absorbs migrations ≤ ${absorbs}`);
}

main().catch((e) => {
    console.error(`\n✖ ${e.message}`);
    process.exitCode = 1;
});
