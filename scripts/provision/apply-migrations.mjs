#!/usr/bin/env node
/**
 * apply-migrations — the tenant migration runner.
 *
 * Under deployment-per-tenant, every customer gets their own Supabase project
 * and every project replays this repo's migrations. Doing that by hand does
 * not survive customer #2, and the manual route is how migration 0149 came to
 * be half-applied for months. This runner:
 *
 *   • keeps a ledger (public.schema_migrations) in each target project, so the
 *     "remote history is untracked" problem does not follow us into new tenants;
 *   • wraps each migration in a transaction unless the file manages its own or
 *     contains something Postgres refuses to run in one — a failing file rolls
 *     back instead of half-applying;
 *   • records a checksum per migration and refuses to proceed when a file has
 *     changed since it was applied (repo and database have diverged);
 *   • refuses to run when two files claim the same migration number.
 *
 * Usage:
 *   node scripts/provision/apply-migrations.mjs --project-ref <ref> [command]
 *
 * Commands:
 *   --status       Show applied / pending counts and exit (default).
 *   --dry-run      List exactly what would run, with each file's transaction mode.
 *   --apply        Apply every pending migration, in order, stopping at the first failure.
 *   --baseline     Create the ledger and mark ALL current migrations as applied
 *                  WITHOUT executing them. Use this once on a project whose schema
 *                  already exists (the original dev/demo project), so future
 *                  migrations apply incrementally.
 *
 * Auth: set SUPABASE_ACCESS_TOKEN (a personal access token, `sbp_…`).
 *   PowerShell:  $env:SUPABASE_ACCESS_TOKEN = "sbp_..."
 *   bash:        export SUPABASE_ACCESS_TOKEN=sbp_...
 */
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import {
    planMigrations, prepareSql, transactionMode,
} from './migrationPlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(HERE, '../../src/frontend/supabase/migrations');
const API = 'https://api.supabase.com/v1';

const LEDGER_DDL = `
CREATE TABLE IF NOT EXISTS public.schema_migrations (
    name        TEXT PRIMARY KEY,
    checksum    TEXT NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    applied_by  TEXT
);
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_select_schema_migrations ON public.schema_migrations;
CREATE POLICY auth_select_schema_migrations ON public.schema_migrations
    FOR SELECT TO authenticated USING (true);
`;

// ── plumbing ──────────────────────────────────────────────────────────────

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const sqlLiteral = (s) => `'${String(s).replace(/'/g, "''")}'`;

function parseArgs(argv) {
    const args = {
        command: '--status',
        projectRef: process.env.SUPABASE_PROJECT_REF ?? '',
        allowDuplicates: false,
        continueOnError: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--project-ref') args.projectRef = argv[++i] ?? '';
        else if (a === '--allow-duplicates') args.allowDuplicates = true;
        // Diagnostic only: keep going after a failure to enumerate EVERY broken
        // migration in one pass. Never use for real provisioning — later files
        // run against a schema missing whatever the failed ones should have made.
        else if (a === '--continue-on-error') args.continueOnError = true;
        else if (['--status', '--dry-run', '--apply', '--baseline', '--refresh-checksums'].includes(a)) args.command = a;
        else if (a === '--help' || a === '-h') args.command = '--help';
    }
    return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A response that isn't JSON is the gateway talking, not Postgres — an HTML
 * error page from a timeout or rate limit. Replaying 230 migrations back to
 * back hits these occasionally, and because a transient failure early in the
 * run cascades into dozens of bogus "missing relation" errors later, they must
 * be retried rather than reported. A genuine SQL error always returns JSON.
 */
const isTransient = (status, body) =>
    status === 429 || status >= 500 || /^\s*<(!doctype|html|div)/i.test(body);

async function runSql(projectRef, token, query, { retries = 3 } = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
        const res = await fetch(`${API}/projects/${projectRef}/database/query`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
        });
        const text = await res.text();
        if (res.ok) {
            try { return JSON.parse(text); } catch { return []; }
        }
        if (isTransient(res.status, text) && attempt < retries) {
            await sleep(1500 * (attempt + 1)); // 1.5s, 3s, 4.5s
            continue;
        }
        let detail = text;
        try { detail = JSON.parse(text).message ?? text; } catch { /* raw text */ }
        lastErr = new Error(`HTTP ${res.status}: ${detail}`);
        break;
    }
    throw lastErr;
}

async function readLedger(projectRef, token) {
    try {
        const rows = await runSql(
            projectRef, token,
            'SELECT name, checksum FROM public.schema_migrations ORDER BY name',
        );
        return { exists: true, rows: Array.isArray(rows) ? rows : [] };
    } catch (e) {
        // Ledger table absent — a project that has never been through this runner.
        if (/schema_migrations|does not exist|relation/i.test(String(e))) {
            return { exists: false, rows: [] };
        }
        throw e;
    }
}

async function loadMigrations() {
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.toLowerCase().endsWith('.sql'));
    const contents = {};
    const checksums = {};
    for (const f of files) {
        const sql = await readFile(join(MIGRATIONS_DIR, f), 'utf8');
        contents[f] = sql;
        checksums[f] = sha256(sql);
    }
    return { files, contents, checksums };
}

// ── commands ──────────────────────────────────────────────────────────────

/**
 * @param forExecution  true when the command actually runs SQL. Duplicate
 *   numbers are irrelevant to --baseline (nothing executes) but matter on a
 *   fresh project, where they decide the order files replay in.
 */
function reportBlockers(plan, { forExecution, allowDuplicates }) {
    let blocked = false;
    if (plan.duplicates.length) {
        // Only collisions among PENDING files can misorder this run; historical
        // ones on a baselined project are already applied and cannot replay.
        const fatal = forExecution && plan.pendingDuplicates.length > 0 && !allowDuplicates;
        blocked = blocked || fatal;
        const mark = fatal ? '✖' : '⚠';
        console.error(`\n${mark} ${plan.duplicates.length} duplicate migration number(s) in the repo — on a FRESH project their replay order is decided by filename, which may not match the order they were originally applied:`);
        for (const d of plan.duplicates) console.error(`    ${String(d.number).padStart(4, '0')}: ${d.files.join('  vs  ')}`);
        if (fatal) {
            console.error(`\n  ${plan.pendingDuplicates.length} of these are PENDING and would run now.`);
            console.error('  Before onboarding a real customer, replay the full set onto a scratch project to prove the order works,');
            console.error('  then re-run with --allow-duplicates (or renumber the offending files).');
        } else if (forExecution) {
            console.error('  None are pending, so this run is unaffected.');
        }
    }
    if (plan.drifted.length) {
        blocked = true;
        console.error('\n✖ Applied migrations whose content has since changed (repo and database have diverged):');
        for (const f of plan.drifted) console.error(`    ${f}`);
        console.error('  Add a forward migration instead of editing an applied one, or re-baseline deliberately.');
    }
    return blocked;
}

async function main() {
    const { command, projectRef, allowDuplicates, continueOnError } = parseArgs(process.argv.slice(2));

    if (command === '--help') {
        console.log(await readFile(fileURLToPath(import.meta.url), 'utf8').then((s) => s.split('*/')[0]));
        return;
    }

    const token = process.env.SUPABASE_ACCESS_TOKEN;
    if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is not set (a personal access token, sbp_…).');
    if (!projectRef) throw new Error('Pass --project-ref <ref> (or set SUPABASE_PROJECT_REF).');

    const { files, contents, checksums } = await loadMigrations();
    const ledger = await readLedger(projectRef, token);
    const plan = planMigrations(files, ledger.rows, checksums);

    console.log(`Project      ${projectRef}`);
    console.log(`Migrations   ${plan.ordered.length} numbered file(s)${plan.ignored.length ? `, ignoring ${plan.ignored.join(', ')}` : ''}`);
    console.log(`Ledger       ${ledger.exists ? `present — ${plan.appliedCount} applied` : 'ABSENT (project has never been through this runner)'}`);
    console.log(`Pending      ${plan.pending.length}`);

    const blocked = reportBlockers(plan, { forExecution: command === '--apply', allowDuplicates });

    if (command === '--status') {
        if (!ledger.exists) {
            console.log('\nNext: --baseline on a project that already has this schema, or --apply on an empty one.');
        }
        process.exitCode = blocked ? 1 : 0;
        return;
    }

    if (blocked && command === '--apply') {
        throw new Error('Refusing to apply while the blockers above are unresolved.');
    }

    if (command === '--dry-run') {
        console.log('\nWould apply, in order:');
        for (const m of plan.pending) {
            console.log(`  ${m.file.padEnd(46)} ${transactionMode(contents[m.file])}`);
        }
        if (!plan.pending.length) console.log('  (nothing pending)');
        return;
    }

    if (command === '--refresh-checksums') {
        // For deliberate edits to already-applied migrations (repairs, guards).
        // Re-records their checksums so drift detection stops flagging them.
        // Executes nothing — the database is assumed already correct.
        if (!plan.drifted.length) {
            console.log('\n✔ No drifted migrations — nothing to refresh.');
            return;
        }
        console.log(`\nRe-recording ${plan.drifted.length} edited migration(s) — no SQL is executed:`);
        for (const file of plan.drifted) {
            await runSql(projectRef, token, `
                UPDATE public.schema_migrations
                   SET checksum = ${sqlLiteral(checksums[file])}, applied_by = 'refresh-checksums'
                 WHERE name = ${sqlLiteral(file)};`);
            console.log(`    ${file}`);
        }
        console.log('\n✔ Ledger updated.');
        return;
    }

    if (command === '--baseline') {
        if (ledger.exists && plan.appliedCount > 0) {
            console.log('\nLedger already populated — nothing to baseline.');
            return;
        }
        console.log('\nBaselining: recording every migration as applied WITHOUT executing it.');
        await runSql(projectRef, token, LEDGER_DDL);
        const values = plan.ordered
            .map((m) => `(${sqlLiteral(m.file)}, ${sqlLiteral(checksums[m.file])}, 'baseline')`)
            .join(',\n  ');
        if (values) {
            await runSql(projectRef, token, `
                INSERT INTO public.schema_migrations (name, checksum, applied_by)
                VALUES\n  ${values}
                ON CONFLICT (name) DO NOTHING;`);
        }
        console.log(`✔ Baselined ${plan.ordered.length} migration(s). Future runs apply only what is new.`);
        return;
    }

    // --apply
    if (!plan.pending.length) {
        console.log('\n✔ Nothing pending — the project is up to date.');
        return;
    }
    console.log(`\nApplying ${plan.pending.length} migration(s)…\n`);
    await runSql(projectRef, token, LEDGER_DDL);

    let applied = 0;
    const failures = [];
    for (const m of plan.pending) {
        const sql = contents[m.file];
        const mode = transactionMode(sql);
        process.stdout.write(`  ${m.file.padEnd(46)} ${mode.padEnd(13)} `);
        try {
            await runSql(projectRef, token, prepareSql(sql));
            await runSql(projectRef, token, `
                INSERT INTO public.schema_migrations (name, checksum, applied_by)
                VALUES (${sqlLiteral(m.file)}, ${sqlLiteral(checksums[m.file])}, 'apply-migrations')
                ON CONFLICT (name) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = NOW();`);
            applied += 1;
            console.log('ok');
        } catch (e) {
            console.log('FAILED');
            // A failed migration is NOT recorded in the ledger — it stays
            // pending so a fixed version applies on the next run.
            failures.push({ file: m.file, mode, error: e.message });
            if (!continueOnError) {
                console.error(`\n✖ ${m.file} failed and was rolled back${mode === 'unwrapped' ? ' — EXCEPT: this file ran unwrapped, so inspect the schema before retrying' : ''}.`);
                console.error(`  ${e.message}`);
                console.error(`\nApplied ${applied} migration(s) before stopping. Fix the file and re-run --apply to continue from here.`);
                process.exitCode = 1;
                return;
            }
        }
    }

    console.log(`\n✔ Applied ${applied} migration(s).`);
    if (failures.length) {
        console.error(`\n✖ ${failures.length} migration(s) FAILED and remain pending:`);
        for (const f of failures) {
            const firstLine = String(f.error).split('\n').find((l) => /ERROR|error/.test(l)) ?? String(f.error).split('\n')[0];
            console.error(`    ${f.file}`);
            console.error(`      ${firstLine.trim().slice(0, 160)}`);
        }
        console.error('\n  Note: with --continue-on-error, later migrations ran against a schema missing');
        console.error('  whatever the failed ones should have created, so some of these are knock-on effects.');
        process.exitCode = 1;
    }
}

main().catch((e) => {
    console.error(`\n✖ ${e.message}`);
    process.exitCode = 1;
});
