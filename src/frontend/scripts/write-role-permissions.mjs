/**
 * Rewrite the generated seed block inside the role_permissions migration.
 *
 * Run after editing ROLE_PERMISSION_TEMPLATES:
 *   npm run gen:role-permissions
 *
 * If you forget, rolePermissionsMirror.test.ts fails with the diff — the
 * database mirror is not allowed to drift from the TypeScript source.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { generateSeedSql, extractSeed, migrationFile } from './gen-role-permissions.mjs';

const MIGRATION_FILE = migrationFile();

const sql = readFileSync(MIGRATION_FILE, 'utf8');
const current = extractSeed(sql);
if (current === null) {
    console.error(`✗ ${MIGRATION_FILE} has no generated-seed markers.`);
    process.exit(1);
}

const next = generateSeedSql();
if (current === next) {
    console.log('✓ already up to date');
} else {
    writeFileSync(MIGRATION_FILE, sql.replace(current, next), 'utf8');
    console.log(`✓ regenerated the seed in ${MIGRATION_FILE}`);
}
