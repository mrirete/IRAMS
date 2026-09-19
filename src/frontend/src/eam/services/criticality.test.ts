/**
 * normaliseCriticality — the one reader both the Validate step and the import
 * engine use. It exists because the database column is an A/B/C/D enum and no
 * source system speaks that alphabet: SAP sends an ABC indicator, Maximo sends
 * 1–4, and hand-built sheets say HIGH or LOW. Sending the raw cell to Postgres
 * failed the row, and because a failed row is usually a site or a unit, every
 * asset beneath it failed too.
 *
 * These tests pin the mapping, because it decides what a plant's safety
 * criticality becomes after a migration. Changing a row here changes data.
 */
import { describe, it, expect } from 'vitest';
import { normaliseCriticality } from './assetTemplates';

describe('normaliseCriticality', () => {
    it('passes the stored codes through unchanged and does not call it a mapping', () => {
        for (const code of ['A', 'B', 'C', 'D'] as const) {
            expect(normaliseCriticality(code)).toEqual({ code, mapped: false, input: code });
        }
    });

    it('is case and whitespace insensitive', () => {
        expect(normaliseCriticality('  a  ').code).toBe('A');
        expect(normaliseCriticality('low').code).toBe('D');
        expect(normaliseCriticality('Low_Impact').code).toBe('D');
        expect(normaliseCriticality('NON CRITICAL').code).toBe('D');
        expect(normaliseCriticality('non-critical').code).toBe('D');
    });

    it('reads a numeric priority scale', () => {
        expect(normaliseCriticality(1).code).toBe('A');
        expect(normaliseCriticality('2').code).toBe('B');
        expect(normaliseCriticality(4).code).toBe('D');
    });

    it('reads the common word scales, and reports that it translated', () => {
        expect(normaliseCriticality('CRITICAL')).toMatchObject({ code: 'A', mapped: true });
        expect(normaliseCriticality('HIGH')).toMatchObject({ code: 'B', mapped: true });
        expect(normaliseCriticality('MEDIUM')).toMatchObject({ code: 'C', mapped: true });
        expect(normaliseCriticality('LOW')).toMatchObject({ code: 'D', mapped: true });
    });

    /**
     * Documents a real consequence rather than asserting it is desirable: a
     * plant exporting only HIGH / MEDIUM / LOW lands on B, C, D and NOTHING
     * becomes A. After such a migration the register contains no safety-critical
     * asset, which is a claim about the plant that nobody made deliberately.
     * Callers must surface this as a summary, not bury it per row.
     */
    it('a three-level word scale never produces A', () => {
        const codes = ['HIGH', 'MEDIUM', 'LOW'].map(v => normaliseCriticality(v).code);
        expect(codes).toEqual(['B', 'C', 'D']);
        expect(codes).not.toContain('A');
    });

    it('returns null for a blank cell without calling it an error', () => {
        expect(normaliseCriticality('')).toEqual({ code: null, mapped: false, input: '' });
        expect(normaliseCriticality(null).code).toBeNull();
        expect(normaliseCriticality(undefined).code).toBeNull();
        expect(normaliseCriticality('   ').input).toBe('');
    });

    it('refuses a value it cannot read, and hands the original back for the message', () => {
        const r = normaliseCriticality('BANANA');
        expect(r.code).toBeNull();
        expect(r.mapped).toBe(false);
        expect(r.input).toBe('BANANA');
    });

    it('does not silently accept an out-of-range number', () => {
        // A 1–5 scale is not a 1–4 scale; guessing which end 5 belongs to would
        // be inventing data.
        expect(normaliseCriticality(5).code).toBeNull();
        expect(normaliseCriticality(0).code).toBeNull();
    });
});
