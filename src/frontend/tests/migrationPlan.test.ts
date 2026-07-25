/**
 * Tests for the tenant migration planner (scripts/provision/migrationPlan.mjs).
 *
 * Lives under tests/ rather than src/ because it exercises a build script, not
 * application code. vitest picks it up (tests/**), tsc does not (tsconfig
 * includes only src), so importing the plain .mjs module is clean.
 */
import { describe, it, expect } from 'vitest';
// @ts-nocheck — plain JS module, no type declarations
import {
    stripDollarQuoted, hasExplicitTransaction, canWrapInTransaction,
    needsTransactionWrap, prepareSql, transactionMode,
    orderMigrations, ignoredFiles, findDuplicateNumbers, planMigrations,
} from '../../../scripts/provision/migrationPlan.mjs';

describe('stripDollarQuoted', () => {
    it('blanks out a $$ function body', () => {
        const sql = "CREATE FUNCTION f() AS $$ BEGIN RETURN 1; END $$ LANGUAGE plpgsql;";
        expect(stripDollarQuoted(sql)).not.toContain('RETURN 1');
        expect(stripDollarQuoted(sql)).toContain('CREATE FUNCTION');
    });

    it('handles tagged dollar quotes', () => {
        const sql = "DO $do$ BEGIN PERFORM 1; END $do$;";
        expect(stripDollarQuoted(sql)).not.toContain('PERFORM');
    });

    it('leaves ordinary SQL untouched', () => {
        expect(stripDollarQuoted('SELECT 1;')).toBe('SELECT 1;');
    });
});

describe('transaction detection', () => {
    it('does NOT mistake a PL/pgSQL BEGIN for a transaction (the 0149 trap)', () => {
        // 0149's shape: no transaction, but BEGIN appears inside a function body.
        const sql = [
            'CREATE TABLE a (id int);',
            'CREATE OR REPLACE FUNCTION t() RETURNS trigger AS $$',
            'BEGIN',
            '  NEW.updated_at = NOW();',
            '  RETURN NEW;',
            'END;',
            '$$ LANGUAGE plpgsql;',
            'CREATE TABLE b (id int);',
        ].join('\n');
        expect(hasExplicitTransaction(sql)).toBe(false);
        expect(needsTransactionWrap(sql)).toBe(true);
        expect(transactionMode(sql)).toBe('auto-wrapped');
    });

    it('recognises a file that manages its own transaction', () => {
        const sql = 'BEGIN;\nCREATE TABLE x (id int);\nCOMMIT;';
        expect(hasExplicitTransaction(sql)).toBe(true);
        expect(needsTransactionWrap(sql)).toBe(false);
        expect(transactionMode(sql)).toBe('self-managed');
    });

    it('refuses to wrap statements Postgres rejects inside a transaction', () => {
        const sql = 'CREATE INDEX CONCURRENTLY idx ON t (c);';
        expect(canWrapInTransaction(sql)).toBe(false);
        expect(needsTransactionWrap(sql)).toBe(false);
        expect(transactionMode(sql)).toBe('unwrapped');
    });

    it('ignores CONCURRENTLY appearing only inside a function body', () => {
        const sql = "CREATE FUNCTION f() AS $$ -- CREATE INDEX CONCURRENTLY note $$ LANGUAGE sql;";
        expect(canWrapInTransaction(sql)).toBe(true);
    });

    it('prepareSql wraps only when needed', () => {
        expect(prepareSql('CREATE TABLE x (id int);')).toBe('BEGIN;\nCREATE TABLE x (id int);\nCOMMIT;');
        expect(prepareSql('BEGIN;\nSELECT 1;\nCOMMIT;')).toBe('BEGIN;\nSELECT 1;\nCOMMIT;');
        expect(prepareSql('CREATE INDEX CONCURRENTLY i ON t (c);')).toBe('CREATE INDEX CONCURRENTLY i ON t (c);');
    });
});

describe('ordering and filtering', () => {
    const files = ['0010_b.sql', '0002_a.sql', 'master_seed.sql', '0100_c.sql', 'cleanup_finops.sql', 'notes.md'];

    it('orders numerically, not lexicographically', () => {
        expect(orderMigrations(files).map((m) => m.file)).toEqual(['0002_a.sql', '0010_b.sql', '0100_c.sql']);
    });

    it('ignores unnumbered .sql files and non-sql entirely', () => {
        expect(ignoredFiles(files).sort()).toEqual(['cleanup_finops.sql', 'master_seed.sql']);
    });
});

describe('findDuplicateNumbers', () => {
    it('catches two files claiming one number', () => {
        const dupes = findDuplicateNumbers(['0210_integrity.sql', '0210_jsa.sql', '0211_ok.sql']);
        expect(dupes).toHaveLength(1);
        expect(dupes[0].number).toBe(210);
        expect(dupes[0].files).toEqual(['0210_integrity.sql', '0210_jsa.sql']);
    });

    it('reports none when numbering is clean', () => {
        expect(findDuplicateNumbers(['0001_a.sql', '0002_b.sql'])).toEqual([]);
    });
});

describe('planMigrations', () => {
    const files = ['0001_a.sql', '0002_b.sql', '0003_c.sql'];
    const checksums = { '0001_a.sql': 'aaa', '0002_b.sql': 'bbb', '0003_c.sql': 'ccc' };

    it('treats everything as pending on a fresh project', () => {
        const plan = planMigrations(files, [], checksums);
        expect(plan.pending.map((m) => m.file)).toEqual(files);
        expect(plan.appliedCount).toBe(0);
    });

    it('returns only what is new once some are applied', () => {
        const plan = planMigrations(files, [
            { name: '0001_a.sql', checksum: 'aaa' },
            { name: '0002_b.sql', checksum: 'bbb' },
        ], checksums);
        expect(plan.pending.map((m) => m.file)).toEqual(['0003_c.sql']);
        expect(plan.appliedCount).toBe(2);
    });

    it('flags an applied migration whose content later changed', () => {
        const plan = planMigrations(files, [
            { name: '0001_a.sql', checksum: 'OLD-HASH' },
        ], checksums);
        expect(plan.drifted).toEqual(['0001_a.sql']);
    });

    it('does not flag drift when the ledger has no checksum', () => {
        const plan = planMigrations(files, [{ name: '0001_a.sql', checksum: '' }], checksums);
        expect(plan.drifted).toEqual([]);
    });

    it('surfaces duplicates through the plan', () => {
        const plan = planMigrations(['0005_x.sql', '0005_y.sql'], [], {});
        expect(plan.duplicates).toHaveLength(1);
        expect(plan.pendingDuplicates).toHaveLength(1); // fresh project: both would run
    });

    it('separates historical duplicates from ones that would actually run', () => {
        // Both collide, but both are already applied — this run cannot misorder.
        const plan = planMigrations(
            ['0005_x.sql', '0005_y.sql', '0006_new.sql'],
            [{ name: '0005_x.sql', checksum: '' }, { name: '0005_y.sql', checksum: '' }],
            {},
        );
        expect(plan.duplicates).toHaveLength(1);
        expect(plan.pendingDuplicates).toHaveLength(0);
        expect(plan.pending.map((m) => m.file)).toEqual(['0006_new.sql']);
    });
});
