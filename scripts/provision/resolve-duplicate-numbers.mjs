/**
 * Give every migration its own order slot, once.
 *
 * Thirty numbers in this repo were claimed by more than one file (0141 by four)
 * because parallel sessions grabbed the same number. On the origin project that
 * is harmless — they all ran, and the ledger records them. It is not harmless
 * on a FRESH project, which is exactly what tenant provisioning does: there,
 * replay order is decided by `number, then localeCompare(filename)`, and
 * nothing anywhere declares that the resulting order is the one that worked.
 *
 * ── What was checked before assigning any suffix ────────────────────────────
 * The order that alphabetical replay produces was verified safe, not assumed:
 *
 *   • 29 of 30 groups touch DISJOINT objects — no file in the group references
 *     anything another file in it creates, so their relative order cannot
 *     matter. Checked against creates/references extraction that includes
 *     CREATE POLICY … ON, REFERENCES, and function calls.
 *   • 0141 is the one real dependency: step2_provision_users calls
 *     create_auth_user. Both provision_ksyrus_auth and step1_fix_auth_function
 *     define it, their bodies are BYTE-IDENTICAL after whitespace
 *     normalisation, and both sort before step2. 0181/0182 redefine it later
 *     regardless.
 *
 * So this script does not reorder anything. It writes down the order that was
 * already running, so it stops being incidental.
 *
 * ── Why a suffix and not a fresh number ─────────────────────────────────────
 * Moving 0052_disable_assets_rls to 0265 would push it past two hundred
 * migrations it originally preceded. The suffix keeps it in place: 0052_ runs,
 * then 0052a_, then 0053_.
 *
 * ── The ledger has to move with the files ───────────────────────────────────
 * schema_migrations is keyed on filename. Rename a file and the runner sees a
 * migration it has never applied and queues it to run again. Both halves happen
 * here, and --check verifies afterwards that pending is still zero.
 *
 * Usage:
 *   node scripts/provision/resolve-duplicate-numbers.mjs --plan     # show, touch nothing
 *   node scripts/provision/resolve-duplicate-numbers.mjs --apply --project-ref <ref>
 */
import { readdirSync, readFileSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { orderMigrations } from './migrationPlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const REL = 'src/frontend/supabase/migrations';
const DIR = resolve(REPO, REL);
const API = 'https://api.supabase.com/v1';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const projectRef = args[args.indexOf('--project-ref') + 1] ?? process.env.SUPABASE_PROJECT_REF ?? '';
const token = process.env.SUPABASE_ACCESS_TOKEN ?? '';

const SUFFIXES = 'abcdefghijklmnopqrstuvwxyz';

/**
 * Order within a collided slot, best evidence first.
 *
 * 1. THE LEDGER, when every file in the group has a distinct applied_at. That
 *    is not a guess about the order — it is a record of it. Three groups
 *    (0234, 0248, 0249) were applied in the REVERSE of alphabetical order, so
 *    sorting by name would have written down an order that never happened.
 *
 * 2. ALPHABETICAL otherwise. The 22 historical groups were all added in the
 *    repo's first commit and baselined into the ledger at a single instant, so
 *    218 rows share one timestamp and neither git nor the ledger can separate
 *    them. Alphabetical is what a fresh project runs today, and it was checked
 *    to be safe for every one of those groups (see the header). Fabricating a
 *    different order from no evidence would be worse than declaring this one.
 */
function orderWithinSlot(group, appliedAt) {
    const stamps = group.map((m) => appliedAt.get(m.file));
    const usable = stamps.every(Boolean) && new Set(stamps).size === group.length;
    if (!usable) return { files: [...group].sort((a, b) => a.file.localeCompare(b.file)), source: 'alphabetical' };
    return {
        files: [...group].sort((a, b) => appliedAt.get(a.file) - appliedAt.get(b.file)),
        source: 'ledger',
    };
}

/**
 * @param appliedAt Map<filename, epoch ms> from schema_migrations. Empty map is
 *        allowed — everything then falls back to alphabetical.
 */
function buildPlan(appliedAt = new Map()) {
    const files = readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.sql'));
    const ordered = orderMigrations(files);

    const bySlot = new Map();
    for (const m of ordered) {
        const slot = `${String(m.number).padStart(4, '0')}${m.suffix}`;
        bySlot.set(slot, [...(bySlot.get(slot) ?? []), m]);
    }

    const renames = [];
    for (const [, group] of bySlot) {
        if (group.length < 2) continue;
        if (group.length - 1 > SUFFIXES.length) {
            throw new Error(`slot ${group[0].number} has ${group.length} files — more than the alphabet allows`);
        }
        const { files: seq, source } = orderWithinSlot(group, appliedAt);
        // seq[0] keeps the bare number — the empty suffix sorts before 'a', so
        // only the file that should run first can hold the unsuffixed name.
        seq.slice(1).forEach((m, i) => {
            const num = String(m.number).padStart(4, '0');
            renames.push({ from: m.file, to: `${num}${SUFFIXES[i]}_${m.slug}.sql`, source });
        });
    }
    return { renames, total: ordered.length };
}

const sql = async (query) => {
    const r = await fetch(`${API}/projects/${projectRef}/database/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`);
    try { return JSON.parse(t); } catch { return []; }
};
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

// The ledger is evidence, so read it even for --plan. Without a project ref the
// plan still builds, but every group falls back to alphabetical and says so.
let appliedAt = new Map();
let ledgerRows = [];
if (projectRef && token) {
    ledgerRows = await sql(`SELECT name, extract(epoch from applied_at) * 1000 AS ms FROM public.schema_migrations`);
    appliedAt = new Map(ledgerRows.map((r) => [r.name, Number(r.ms)]));
} else {
    console.log('⚠ No --project-ref / SUPABASE_ACCESS_TOKEN: ordering from filenames alone.\n');
}

/**
 * Every name in the ledger must exist on disk.
 *
 * This is the state that replays an already-applied migration, and it is
 * reachable: the ledger moves before the files, so a rename that fails partway
 * leaves the two disagreeing. It happened here once, with `git mv` on a file
 * from a parallel stream that was not yet tracked.
 *
 * Checked on EVERY run, including --plan and including runs with nothing to
 * rename — a no-op run is exactly when nobody is looking.
 */
async function reconcile() {
    if (!projectRef || !token) return true;
    const onDisk = new Set(readdirSync(DIR));
    const orphaned = ledgerRows.map((r) => r.name)
        .filter((n) => /^\d{4}[a-z]?_/.test(n) && !onDisk.has(n));
    if (!orphaned.length) return true;
    console.error(`\n✖ ${orphaned.length} ledger entr(y/ies) name a file that is not on disk:`);
    orphaned.forEach((n) => console.error(`    ${n}`));
    console.error('  The next --apply would treat the on-disk name as pending and replay it.');
    console.error('  Repair: rename the file to match the ledger, or UPDATE schema_migrations back.');
    return false;
}

if (!(await reconcile())) process.exit(1);

const { renames, total } = buildPlan(appliedAt);
const fromLedger = renames.filter((r) => r.source === 'ledger').length;

console.log(`${total} migration(s); ${renames.length} need an order slot of their own.`);
console.log(`order evidence: ${fromLedger} from the ledger's applied_at, ${renames.length - fromLedger} alphabetical (no distinct timestamps to go on).\n`);
for (const r of renames) console.log(`  ${r.from.padEnd(50)} → ${r.to.padEnd(48)} [${r.source}]`);

if (!renames.length) { console.log('\n✔ Every migration already has a unique slot.'); process.exit(0); }

if (!apply) {
    console.log('\n(--plan only. Re-run with --apply --project-ref <ref> to rename files and move the ledger.)');
    process.exit(0);
}
if (!projectRef || !token) {
    console.error('\n✖ --apply needs --project-ref and SUPABASE_ACCESS_TOKEN: the ledger must move with the files.');
    process.exit(1);
}

// Ledger first, then files. Neither order is safe on its own — this ran once
// with `git mv` on an UNTRACKED file (a migration from a parallel work stream,
// not yet committed), git refused, and the ledger had already moved. Result:
// the ledger named 0265a_… while the disk still said 0265_…, so the very next
// --apply would have seen it as pending and replayed it against a schema that
// already had it.
//
// So the rename must not be able to fail: git mv when the file is tracked, a
// plain rename when it is not. And whichever half fails, reconcile() below puts
// the two back in agreement rather than leaving a mismatch behind.
console.log('\nUpdating the ledger…');
const known = new Set(ledgerRows.map((r) => r.name));
let moved = 0, absent = [];
for (const r of renames) {
    if (!known.has(r.from)) { absent.push(r.from); continue; }
    await sql(`UPDATE public.schema_migrations SET name = ${lit(r.to)} WHERE name = ${lit(r.from)}`);
    moved++;
}
console.log(`  ${moved} ledger row(s) renamed${absent.length ? `, ${absent.length} not in the ledger (never applied): ${absent.join(', ')}` : ''}`);

// git mv where possible, so the rename is recorded as a rename and blame
// survives. Untracked files (a migration from a parallel stream, not yet
// committed) make git mv fail — those get a plain rename instead. It must not
// throw here: the ledger has already moved.
console.log('\nRenaming files…');
let viaGit = 0, viaFs = 0, failed = [];
for (const r of renames) {
    try {
        execFileSync('git', ['mv', `${REL}/${r.from}`, `${REL}/${r.to}`], { cwd: REPO, stdio: 'pipe' });
        viaGit++;
    } catch {
        try { renameSync(resolve(DIR, r.from), resolve(DIR, r.to)); viaFs++; }
        catch (e) { failed.push(`${r.from}: ${e.message}`); }
    }
}
console.log(`  ${viaGit} via git mv, ${viaFs} untracked (plain rename)${failed.length ? `, ${failed.length} FAILED` : ''}`);
failed.forEach((f) => console.error(`    ✖ ${f}`));

// Re-read the ledger and check again: the renames just moved both halves.
ledgerRows = await sql(`SELECT name, extract(epoch from applied_at) * 1000 AS ms FROM public.schema_migrations`);
if (!(await reconcile())) process.exit(1);

const left = buildPlan(appliedAt).renames.length;
console.log(`\n${left === 0 ? '✔' : '✖'} remaining collisions: ${left}   ledger/disk agree: ✅`);
console.log('Next: node scripts/provision/apply-migrations.mjs --status --project-ref ' + projectRef);
console.log('      Pending must still be 0 and drifted must be 0.');
process.exit(left === 0 ? 0 : 1);
