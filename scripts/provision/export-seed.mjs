#!/usr/bin/env node
/**
 * export-seed — export REFERENCE data (not customer data) as a seed file.
 *
 * The baseline schema gives a new tenant correct but empty tables. The app
 * needs its reference layer to function: ISO 14224 codes, status dictionaries,
 * numbering/hierarchy config, notification rules, audit templates.
 *
 * SAFETY: the allowlist below is explicit and ordered. Anything not named here
 * is NOT exported — assets, work orders, users, contacts, RCA investigations,
 * sensor readings, logs and every other operational table stay behind. Adding
 * a table here means asserting it contains no customer-specific data.
 *
 * `schema_migrations` is deliberately excluded: each project owns its own
 * migration ledger, and copying one would make a fresh tenant believe it had
 * already applied everything.
 *
 * Usage:
 *   node scripts/provision/export-seed.mjs --project-ref <ref> [--out <path>]
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const API = 'https://api.supabase.com/v1';

/**
 * Ordered so parents precede children (FKs resolve). Each entry is a table
 * whose contents are configuration or standards reference, never customer data.
 */
export const SEED_TABLES = [
    // Org spine — the single default company a tenant starts from.
    'companies',
    // Codes and vocabularies.
    'dictionaries',
    'reference_codes',
    'tax_codes',
    'ers_rca_cause_taxonomy',
    'manufacturers',
    // Configuration singletons.
    'hierarchy_config',
    'numbering_config',
    // Messaging / notification configuration.
    'notification_channels',
    'notification_rules',
    'message_templates',
    // Data-catalog annotations for the semantic layer.
    'semantic_catalog',
    // Audit templates (parent → section → question).
    'audit_templates',
    'audit_template_sections',
    'audit_template_questions',
];

function parseArgs(argv) {
    const args = {
        projectRef: process.env.SUPABASE_PROJECT_REF ?? '',
        out: resolve(REPO, 'src/frontend/supabase/baseline/seed.sql'),
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--project-ref') args.projectRef = argv[++i] ?? '';
        else if (a === '--out') args.out = resolve(process.cwd(), argv[++i] ?? '');
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
        throw new Error(String(detail).replace(/\s+/g, ' ').slice(0, 300));
    }
    try {
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
}

/** Real (non-generated) columns, in attribute order. */
async function columnsOf(projectRef, token, table) {
    const rows = await q(projectRef, token, `
        SELECT a.attname
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = '${table}'
          AND a.attnum > 0 AND NOT a.attisdropped
          AND a.attgenerated = ''   -- generated columns compute themselves
        ORDER BY a.attnum;`);
    return rows.map((r) => r.attname);
}

/**
 * Let Postgres build the INSERT statements, rendering each value with its own
 * `::text` cast.
 *
 * NOT row_to_json: that renders a text[] as a JSON array (["a","b"]), which
 * Postgres cannot parse back into an array literal — it wants {a,b}. Each
 * type's ::text form is by definition the representation its input parser
 * accepts, so casting per column round-trips arrays, jsonb, enums, bytea and
 * timestamps alike. quote_nullable yields the bare token NULL for nulls.
 */
const insertsFor = (table, cols) => {
    const colList = cols.map((c) => `"${c}"`).join(', ');
    const valExpr = cols.map((c) => `quote_nullable(t."${c}"::text)`).join(', ');
    return `
SELECT format(
    'INSERT INTO public.%I (%s) VALUES (%s) ON CONFLICT DO NOTHING;',
    '${table}',
    ${quoteLiteral(colList)},
    concat_ws(', ', ${valExpr})
) AS stmt
FROM public.${table} t;`;
};

const quoteLiteral = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function main() {
    const { projectRef, out } = parseArgs(process.argv.slice(2));
    const token = process.env.SUPABASE_ACCESS_TOKEN;
    if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is not set.');
    if (!projectRef) throw new Error('Pass --project-ref <ref>.');

    console.log(`Exporting reference data from ${projectRef}…`);

    const parts = [
        `-- IREAMS baseline reference data — generated from project ${projectRef} on ${new Date().toISOString().slice(0, 10)}`,
        `-- Generated by scripts/provision/export-seed.mjs. Reference/configuration rows ONLY —`,
        `-- no assets, work orders, users, contacts, investigations, readings or logs.`,
        `-- Idempotent: every statement is ON CONFLICT DO NOTHING.`,
        ``,
    ];

    let total = 0;
    for (const table of SEED_TABLES) {
        process.stdout.write(`  ${table.padEnd(28)}`);
        try {
            const cols = await columnsOf(projectRef, token, table);
            if (cols.length === 0) { console.log('skipped (no such table)'); continue; }
            const rows = await q(projectRef, token, insertsFor(table, cols));
            const stmts = rows.map((r) => r.stmt).filter(Boolean);
            total += stmts.length;
            console.log(`${stmts.length} row(s)`);
            if (stmts.length) {
                parts.push(`-- ── ${table} (${stmts.length}) ──`, ...stmts, '');
            }
        } catch (e) {
            // A table missing on this project is not fatal — report and continue.
            console.log(`skipped (${e.message.slice(0, 80)})`);
        }
    }

    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, parts.join('\n'), 'utf8');
    console.log(`\n✔ Wrote ${out} — ${total} row(s) across ${SEED_TABLES.length} table(s)`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
    main().catch((e) => {
        console.error(`\n✖ ${e.message}`);
        process.exitCode = 1;
    });
}
