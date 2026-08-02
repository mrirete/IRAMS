/**
 * The database mirror of the permission matrix must not drift.
 *
 * `role_permissions` exists so RLS can consult the same matrix the admin UI
 * edits. That only holds while the seed matches ROLE_PERMISSION_TEMPLATES — and
 * a mirror that silently falls behind is worse than no mirror, because policies
 * would then enforce a policy nobody wrote.
 *
 * Edit a role template without running `npm run gen:role-permissions` and this
 * fails with the diff.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateSeedSql, extractSeed, migrationFile, DEFAULT_ROLE_KEY } from '../../scripts/gen-role-permissions.mjs';
import { ROLE_PERMISSION_TEMPLATES, BASE_PACKAGE_DEFAULTS } from '../eam/constants/rolePermissions';

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), '../..');
// Resolved, not hard-coded: a matrix change adds a reseed migration rather
// than editing an applied one, so the newest file with the markers is the
// authority.
const MIGRATION = join(FRONTEND, (() => { const cwd = process.cwd(); process.chdir(FRONTEND); try { return migrationFile(); } finally { process.chdir(cwd); } })());

describe('role_permissions mirror', () => {
    const sql = readFileSync(MIGRATION, 'utf8');

    it('the migration carries a generated seed block', () => {
        expect(extractSeed(sql), 'generated-seed markers are missing from 0241').not.toBeNull();
    });

    it('matches ROLE_PERMISSION_TEMPLATES exactly', () => {
        expect(
            extractSeed(sql),
            'The seed in 0241 is stale. Run `npm run gen:role-permissions` and commit the result — ' +
            'otherwise RLS enforces a matrix that no longer matches the one admins edit.',
        ).toBe(generateSeedSql());
    });

    it('seeds every role, plus the fail-closed default', () => {
        const seed = extractSeed(sql)!;
        for (const role of Object.keys(ROLE_PERMISSION_TEMPLATES)) {
            expect(seed, `role ${role} is absent from the seed`).toContain(`('${role}', `);
        }
        // Roles with no template fall back to this; without it they would get a
        // silent "no permissions anywhere" rather than the intended baseline.
        expect(seed).toContain(`('${DEFAULT_ROLE_KEY}', `);
    });

    it('emits only true flags, and never spendingLimit', () => {
        const seed = extractSeed(sql)!;
        // spendingLimit is a number, not a permission — approval limits are
        // application logic, and a row here would read as "permitted".
        expect(seed).not.toContain("'spendingLimit'");

        // TECHNICIAN has analytics: NO_ACCESS_PERM — every flag false, so the
        // role/module pair must not appear at all.
        expect(seed).not.toContain("('TECHNICIAN', 'analytics'");
        // …while a permitted one must.
        expect(seed).toContain("('TECHNICIAN', 'assets', 'view')");
    });

    it('carries the Specialist ruling: every role can view reliability', () => {
        const seed = extractSeed(sql)!;
        for (const role of Object.keys(ROLE_PERMISSION_TEMPLATES)) {
            expect(seed, `${role} cannot view reliability — the Specialist is meant to be open to all roles`)
                .toContain(`('${role}', 'reliability', 'view')`);
        }
    });

    it('BASE_PACKAGE_DEFAULTS stays fail-closed on the premium modules', () => {
        // Unknown/custom roles must not inherit reliability, integrity, finops
        // or admin by accident.
        for (const mod of ['reliability', 'integrity', 'sustain', 'finops', 'admin', 'analytics']) {
            expect((BASE_PACKAGE_DEFAULTS as Record<string, { view: boolean }>)[mod]?.view,
                `BASE_PACKAGE_DEFAULTS.${mod}.view should be false (fail-closed)`).toBe(false);
        }
    });
});
