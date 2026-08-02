/**
 * gen-role-permissions — emit the SQL seed for the `role_permissions` mirror.
 *
 * ROLE_PERMISSION_TEMPLATES stays the single source of truth. This turns it into
 * rows so RLS can consult it, and a test regenerates and compares so the two can
 * never quietly disagree — edit a template without regenerating and CI fails
 * with the diff.
 *
 * Only TRUE flags become rows: presence means permitted, absence means not.
 * `spendingLimit` is a number rather than a permission and is deliberately
 * skipped — approval limits are enforced in application logic, not RLS.
 *
 * Pure module — no CLI side effects, so vitest can import it. Regenerate the
 * migration with `npm run gen:role-permissions`; the drift guard lives in
 * src/lib/rolePermissionsMirror.test.ts.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROLE_PERMISSION_TEMPLATES, BASE_PACKAGE_DEFAULTS } from '../src/eam/constants/rolePermissions.ts';

/** Role name used for anyone whose role has no template (fail-closed baseline). */
export const DEFAULT_ROLE_KEY = '__default__';

export const BEGIN_MARK = '-- ── BEGIN GENERATED SEED (scripts/gen-role-permissions.mjs) ──';
export const END_MARK = '-- ── END GENERATED SEED ──';

/** Permission flags that are booleans; anything else is not an RLS concern. */
const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'authorize', 'viewCosts', 'assign'];

/** Deterministic: sorted, so a regenerated file diffs cleanly against the committed one. */
export function generateSeedSql() {
    const rows = [];
    const add = (role, perms) => {
        for (const module of Object.keys(perms).sort()) {
            for (const action of ACTIONS) {
                if (perms[module]?.[action] === true) rows.push([role, module, action]);
            }
        }
    };

    for (const role of Object.keys(ROLE_PERMISSION_TEMPLATES).sort()) {
        add(role, ROLE_PERMISSION_TEMPLATES[role]);
    }
    add(DEFAULT_ROLE_KEY, BASE_PACKAGE_DEFAULTS);

    const values = rows
        .map(([r, m, a]) => `    ('${r}', '${m}', '${a}')`)
        .join(',\n');

    return [
        BEGIN_MARK,
        `-- ${rows.length} permitted (role, module, action) triples. Do not hand-edit.`,
        'DELETE FROM public.role_permissions;',
        'INSERT INTO public.role_permissions (role, module, action) VALUES',
        values + ';',
        END_MARK,
    ].join('\n');
}

/** Pull the generated block out of a migration file, for comparison. */
export function extractSeed(sql) {
    const a = sql.indexOf(BEGIN_MARK);
    const b = sql.indexOf(END_MARK);
    if (a < 0 || b < 0) return null;
    return sql.slice(a, b + END_MARK.length).replace(/\r\n/g, '\n');
}

/**
 * The migration carrying the generated block — the NEWEST one that has the
 * markers, not a fixed filename.
 *
 * The seed lives in a migration, and migrations are immutable once applied: the
 * runner refuses to proceed when an applied file's checksum changes. So a matrix
 * edit cannot rewrite 0241 in place; it adds a reseed migration instead, and
 * this resolves to whichever is latest.
 */
export function migrationFile() {
    const dir = 'supabase/migrations';
    const withMarkers = readdirSync(dir)
        .filter(f => f.endsWith('.sql'))
        .sort()
        .filter(f => readFileSync(join(dir, f), 'utf8').includes(BEGIN_MARK));
    if (!withMarkers.length) throw new Error('no migration carries the generated-seed markers');
    return join(dir, withMarkers[withMarkers.length - 1]).replace(/\\/g, '/');
}
