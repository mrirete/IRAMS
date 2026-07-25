/**
 * migrationPlan — pure planning logic for the tenant migration runner.
 *
 * Under deployment-per-tenant (one Supabase project per customer), every new
 * customer replays this repo's migrations from 0000. Two lessons are encoded
 * here, both learned the hard way in this codebase:
 *
 *   1. AUTO-WRAP IN A TRANSACTION. Migration 0149 was not transaction-wrapped
 *      and the Supabase SQL editor runs statement-by-statement, so it failed
 *      halfway and left ers_rag_documents missing for months without a single
 *      error surfacing. A file that fails must roll back, not half-apply.
 *   2. CATCH DUPLICATE NUMBERS. Parallel work sessions have grabbed the same
 *      migration number more than once (0210 was double-booked). Two files
 *      claiming one number means one silently never runs on a fresh project.
 *
 * No I/O here — file names and contents in, a plan out.
 */

/** `0221_writeback.sql` → matches; `master_seed.sql` → does not. */
export const MIGRATION_FILE_RE = /^(\d{4})_(.+)\.sql$/i;

/**
 * Statements Postgres refuses to run inside an explicit transaction block.
 * A file containing any of these is applied unwrapped and flagged.
 */
const NON_TRANSACTIONAL = /\b(CONCURRENTLY|CREATE\s+DATABASE|DROP\s+DATABASE|VACUUM|CREATE\s+TABLESPACE|ALTER\s+SYSTEM)\b/i;

/**
 * Blank out dollar-quoted bodies ($$ … $$, $tag$ … $tag$) so keywords inside
 * function definitions aren't mistaken for top-level statements. Without this,
 * the `BEGIN` opening a PL/pgSQL body reads as a transaction start — which is
 * exactly the trap 0149 contains.
 */
export function stripDollarQuoted(sql) {
    let out = '';
    let i = 0;
    while (i < sql.length) {
        const rest = sql.slice(i);
        const m = /\$([A-Za-z_]\w*)?\$/.exec(rest);
        if (!m) {
            out += rest;
            break;
        }
        const start = i + m.index;
        const tag = m[0];
        out += sql.slice(i, start) + ' ';
        const end = sql.indexOf(tag, start + tag.length);
        if (end === -1) break; // unterminated quote — drop the remainder
        i = end + tag.length;
    }
    return out;
}

/** Does the file already manage its own transaction? */
export function hasExplicitTransaction(sql) {
    return /^\s*BEGIN\s*(;|\s+TRANSACTION|\s+WORK)/im.test(stripDollarQuoted(sql));
}

/** Can this file legally be wrapped in BEGIN/COMMIT? */
export function canWrapInTransaction(sql) {
    return !NON_TRANSACTIONAL.test(stripDollarQuoted(sql));
}

export function needsTransactionWrap(sql) {
    return !hasExplicitTransaction(sql) && canWrapInTransaction(sql);
}

/** The SQL actually sent to the database, wrapped when it is safe to do so. */
export function prepareSql(sql) {
    return needsTransactionWrap(sql) ? `BEGIN;\n${sql}\nCOMMIT;` : sql;
}

/** Classify how a file will be executed — surfaced in --dry-run output. */
export function transactionMode(sql) {
    if (hasExplicitTransaction(sql)) return 'self-managed';
    if (!canWrapInTransaction(sql)) return 'unwrapped';
    return 'auto-wrapped';
}

export function parseMigrationName(file) {
    const m = MIGRATION_FILE_RE.exec(file);
    if (!m) return null;
    return { file, number: Number(m[1]), slug: m[2] };
}

/** Numbered migrations only, in numeric order. Non-migration .sql is ignored. */
export function orderMigrations(files) {
    return files
        .map(parseMigrationName)
        .filter(Boolean)
        .sort((a, b) => a.number - b.number || a.file.localeCompare(b.file));
}

/** Files ignored because they are not numbered migrations (seeds, cleanups). */
export function ignoredFiles(files) {
    return files.filter((f) => f.toLowerCase().endsWith('.sql') && !MIGRATION_FILE_RE.test(f));
}

/** Two files claiming the same number — one of them will never run. */
export function findDuplicateNumbers(files) {
    const byNumber = new Map();
    for (const m of orderMigrations(files)) {
        const list = byNumber.get(m.number) ?? [];
        list.push(m.file);
        byNumber.set(m.number, list);
    }
    return [...byNumber.entries()]
        .filter(([, list]) => list.length > 1)
        .map(([number, list]) => ({ number, files: list }));
}

/**
 * Build the execution plan.
 * @param files     every filename in the migrations directory
 * @param applied   ledger rows already applied: [{ name, checksum }]
 * @param checksums current checksum per filename: { [file]: sha256 }
 */
export function planMigrations(files, applied = [], checksums = {}) {
    const ordered = orderMigrations(files);
    const appliedByName = new Map(applied.map((a) => [a.name, a]));

    const pending = ordered.filter((m) => !appliedByName.has(m.file));

    // A migration whose content changed after it was applied: the deployed
    // database and the repo have diverged. Never silently re-run it.
    const drifted = ordered
        .filter((m) => appliedByName.has(m.file))
        .filter((m) => {
            const rec = appliedByName.get(m.file);
            const now = checksums[m.file];
            return rec?.checksum && now && rec.checksum !== now;
        })
        .map((m) => m.file);

    return {
        ordered,
        pending,
        appliedCount: ordered.length - pending.length,
        /** Every collision in the repo — reported for visibility. */
        duplicates: findDuplicateNumbers(files),
        /**
         * Collisions among files that are about to RUN. Only these can
         * actually misorder an apply: on a baselined project the historical
         * collisions are already applied and cannot replay.
         */
        pendingDuplicates: findDuplicateNumbers(pending.map((m) => m.file)),
        ignored: ignoredFiles(files),
        drifted,
    };
}
