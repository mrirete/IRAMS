/**
 * Tests for registerReconcile — drawing tags vs the existing register.
 */
import { describe, it, expect } from 'vitest';
import { reconcileWithRegister, type RegisterAsset } from './registerReconcile';
import type { ExtractedTag } from './pidTagExtract';

const tag = (t: string, variants: string[] = []): ExtractedTag =>
    ({ tag: t, variants: [t, ...variants], kind: 'equipment', confidence: 'high', occurrences: 1, pages: [1] } as unknown as ExtractedTag);

const REGISTER: RegisterAsset[] = [
    { id: 'sys', tag: 'U-100', name: 'Compression unit', parentId: null, hierarchyLevel: 'SYSTEM' },
    { id: 'a1', tag: 'P-101A', parentId: 'sys' },
    { id: 'a2', tag: 'K-601', parentId: 'sys' },
    { id: 'a3', tag: 'E-605', parentId: 'sys' },      // in the register, not on the drawing
    { id: 'a4', tag: 'P-900', parentId: 'other' },    // another system — never "register only" here
];

describe('reconcileWithRegister', () => {
    it('splits the drawing into matched / new, and lists the system children the drawing missed', () => {
        const r = reconcileWithRegister([tag('P-101A'), tag('K-601'), tag('V-602')], REGISTER, { systemTag: 'U-100' });
        expect(r.matched.map((m) => m.asset.id)).toEqual(['a1', 'a2']);
        expect(r.newTags.map((t) => t.tag)).toEqual(['V-602']);
        expect(r.systemAsset?.id).toBe('sys');
        expect(r.registerOnly.map((a) => a.tag)).toEqual(['E-605']);
    });

    it('matches through variants and ignores punctuation/case', () => {
        const r = reconcileWithRegister([tag('P101A', ['P-101-A'])], REGISTER);
        expect(r.matched).toHaveLength(1);
        expect(r.matched[0].asset.tag).toBe('P-101A');
    });

    it('without a known system, registerOnly is empty rather than the whole plant', () => {
        const r = reconcileWithRegister([tag('P-101A')], REGISTER, { systemTag: 'U-999' });
        expect(r.systemAsset).toBeNull();
        expect(r.registerOnly).toHaveLength(0);
    });

    it('empty inputs are fine', () => {
        const r = reconcileWithRegister([], [], {});
        expect(r.matched).toHaveLength(0);
        expect(r.newTags).toHaveLength(0);
        expect(r.registerOnly).toHaveLength(0);
    });
});
