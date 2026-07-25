#!/usr/bin/env node
/**
 * load-baseline — apply a generated baseline schema to a project, and prove it.
 *
 * Sends the file section by section (splitting on the generator's section
 * banners) rather than as one enormous statement, so a failure names the
 * section it came from and the payload stays under gateway limits.
 *
 * Usage:
 *   node scripts/provision/load-baseline.mjs --project-ref <ref> [--file <path>]
 *   node scripts/provision/load-baseline.mjs --project-ref <ref> --census
 *
 * --census prints a catalog census (object counts) instead of loading, so the
 * same command can be run against the origin and a freshly loaded project and
 * the two compared. Auth: SUPABASE_ACCESS_TOKEN.
 */
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const API = 'https://api.supabase.com/v1';

export const CENSUS_SQL = `
SELECT
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE c.relkind='r' AND n.nspname='public')                                    AS tables,
  (SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
     JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE c.relkind='r' AND n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped) AS columns,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public')                                                      AS functions,
  (SELECT count(*) FROM pg_indexes WHERE schemaname='public')                       AS indexes,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public')                      AS policies,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE c.relkind='v' AND n.nspname='public')                                    AS views,
  (SELECT count(*) FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid
     JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND NOT tg.tgisinternal)                              AS triggers,
  (SELECT count(*) FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
     JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')          AS constraints,
  (SELECT count(DISTINCT t.typname) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
     JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public')                  AS enum_types,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE c.relkind='r' AND n.nspname='public' AND c.relrowsecurity)               AS rls_enabled;
`;

function parseArgs(argv) {
    const args = {
        projectRef: process.env.SUPABASE_PROJECT_REF ?? '',
        file: resolve(REPO, 'src/frontend/supabase/baseline/schema.sql'),
        census: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--project-ref') args.projectRef = argv[++i] ?? '';
        else if (a === '--file') args.file = resolve(process.cwd(), argv[++i] ?? '');
        else if (a === '--census') args.census = true;
    }
    return args;
}

async function runSql(projectRef, token, query) {
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

/**
 * Split the generated file on its section banners, keeping each title.
 *
 * A file with no banners (the seed file) is a flat list of one-line
 * statements; it is batched instead, so a single bad row fails only its own
 * batch and the report names which one.
 */
export function splitSections(sql, batchSize = 120) {
    const parts = sql.split(/-- ══+\n-- (.+)\n-- ══+\n/);

    if (parts.length === 1) {
        const lines = sql.split('\n').filter((l) => l.trim() && !l.trim().startsWith('--'));
        const out = [];
        for (let i = 0; i < lines.length; i += batchSize) {
            const batch = lines.slice(i, i + batchSize);
            out.push({
                title: `Statements ${i + 1}-${Math.min(i + batchSize, lines.length)}`,
                sql: batch.join('\n'),
            });
        }
        return out;
    }

    const out = [];
    // parts[0] is the preamble (SET check_function_bodies etc.)
    if (parts[0]?.trim()) out.push({ title: 'Preamble', sql: parts[0] });
    for (let i = 1; i < parts.length; i += 2) {
        const title = parts[i];
        const body = parts[i + 1] ?? '';
        if (body.trim()) out.push({ title, sql: body });
    }
    return out;
}

async function main() {
    const { projectRef, file, census } = parseArgs(process.argv.slice(2));
    const token = process.env.SUPABASE_ACCESS_TOKEN;
    if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is not set.');
    if (!projectRef) throw new Error('Pass --project-ref <ref>.');

    if (census) {
        const [row] = await runSql(projectRef, token, CENSUS_SQL);
        console.log(JSON.stringify(row ?? {}, null, 2));
        return;
    }

    const sql = await readFile(file, 'utf8');
    const sections = splitSections(sql);
    // A banner-less file is the seed (a flat statement list). Suppress triggers
    // while loading it: the audit trigger would otherwise record the seeding
    // itself, so a brand-new tenant would open with a few hundred meaningless
    // audit rows. This is what pg_dump does when restoring data.
    const isDataLoad = !/-- ══+\n/.test(sql);
    console.log(`Loading ${sections.length} section(s) from ${file} into ${projectRef}` +
        `${isDataLoad ? ' (triggers suppressed)' : ''}\n`);

    const preamble = 'SET check_function_bodies = off;\n' +
        (isDataLoad ? 'SET session_replication_role = replica;\n' : '');
    let failed = 0;
    for (const s of sections) {
        process.stdout.write(`  ${s.title.padEnd(22)}`);
        try {
            // Re-send the preamble with every section: each Management API call
            // is its own session, so the SET does not otherwise carry over.
            await runSql(projectRef, token, preamble + s.sql);
            console.log('ok');
        } catch (e) {
            failed += 1;
            console.log('FAILED');
            console.error(`      ${e.message}`);
        }
    }

    if (failed) {
        console.error(`\n✖ ${failed} section(s) failed.`);
        process.exitCode = 1;
    } else {
        console.log('\n✔ Baseline loaded.');
    }
}

// Only run when invoked directly, so tests can import the helpers.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
    main().catch((e) => {
        console.error(`\n✖ ${e.message}`);
        process.exitCode = 1;
    });
}
