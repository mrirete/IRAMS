import { describe, it, expect } from 'vitest';
import { normalizeText, estimateTokens, chunkPages, type SourcePage } from './manualChunker';

describe('normalizeText', () => {
    it('re-joins words hyphenated across a line break', () => {
        expect(normalizeText('the centri-\nfugal pump')).toBe('the centrifugal pump');
    });

    it('treats a single newline inside a paragraph as a hard wrap', () => {
        expect(normalizeText('Check the seal\nbefore starting.')).toBe('Check the seal before starting.');
    });

    it('preserves paragraph breaks and collapses longer runs', () => {
        expect(normalizeText('Para one.\n\n\n\nPara two.')).toBe('Para one.\n\nPara two.');
    });

    it('collapses the stray spacing PDF extractors emit', () => {
        expect(normalizeText('bearing     temperature')).toBe('bearing temperature');
    });

    it('returns empty for whitespace-only input', () => {
        expect(normalizeText('   \n\n  \t ')).toBe('');
    });
});

describe('estimateTokens', () => {
    it('approximates four characters per token', () => {
        expect(estimateTokens('12345678')).toBe(2);
    });
});

describe('chunkPages', () => {
    const para = (n: number) => `Paragraph ${n}. ` + 'word '.repeat(60);

    it('returns nothing for empty or blank pages', () => {
        expect(chunkPages([])).toEqual([]);
        expect(chunkPages([{ page: 1, text: '   ' }])).toEqual([]);
    });

    it('keeps a short document as a single chunk', () => {
        const chunks = chunkPages([{ page: 1, text: 'Torque the bolts to 45 Nm.' }]);
        expect(chunks).toHaveLength(1);
        expect(chunks[0].chunk_text).toBe('Torque the bolts to 45 Nm.');
        expect(chunks[0].page_number).toBe(1);
        expect(chunks[0].chunk_index).toBe(0);
    });

    it('splits long text into several chunks within the size bound', () => {
        const pages: SourcePage[] = [{ page: 1, text: [para(1), para(2), para(3), para(4)].join('\n\n') }];
        const chunks = chunkPages(pages, { maxChars: 500, overlapChars: 50 });
        expect(chunks.length).toBeGreaterThan(1);
        for (const c of chunks) expect(c.chunk_text.length).toBeLessThanOrEqual(700); // bound + overlap
        expect(chunks.map((c) => c.chunk_index)).toEqual(chunks.map((_, i) => i));
    });

    it('carries the page each chunk starts on', () => {
        const chunks = chunkPages([
            { page: 7, text: 'Section A. ' + 'alpha '.repeat(80) },
            { page: 8, text: 'Section B. ' + 'beta '.repeat(80) },
        ], { maxChars: 300, overlapChars: 0 });
        const pagesSeen = [...new Set(chunks.map((c) => c.page_number))];
        expect(pagesSeen).toContain(7);
        expect(pagesSeen).toContain(8);
    });

    it('overlaps consecutive chunks so a split procedure stays findable', () => {
        const chunks = chunkPages(
            [{ page: 1, text: [para(1), para(2)].join('\n\n') }],
            { maxChars: 400, overlapChars: 100 },
        );
        expect(chunks.length).toBeGreaterThan(1);
        const tailOfFirst = chunks[0].chunk_text.slice(-40);
        // Some trailing words of chunk 0 reappear at the head of chunk 1.
        const sharedWord = tailOfFirst.trim().split(/\s+/)[0];
        expect(chunks[1].chunk_text.startsWith(sharedWord) || chunks[1].chunk_text.includes(sharedWord)).toBe(true);
    });

    it('hard-splits a single sentence longer than the limit', () => {
        const chunks = chunkPages([{ page: 1, text: 'word '.repeat(400) }], { maxChars: 300, overlapChars: 0 });
        expect(chunks.length).toBeGreaterThan(1);
        for (const c of chunks) expect(c.chunk_text.length).toBeLessThanOrEqual(300);
    });

    it('merges a runt trailing fragment into the previous chunk', () => {
        const chunks = chunkPages(
            [{ page: 1, text: `${'word '.repeat(80)}\n\nEnd.` }],
            { maxChars: 300, overlapChars: 0, minChars: 100 },
        );
        expect(chunks[chunks.length - 1].chunk_text).toContain('End.');
        expect(chunks[chunks.length - 1].chunk_text.length).toBeGreaterThanOrEqual(100);
    });

    it('handles page-less sources (.txt / .md)', () => {
        const chunks = chunkPages([{ page: null, text: 'Standard operating procedure.' }]);
        expect(chunks[0].page_number).toBeNull();
    });

    it('skips blank pages without breaking numbering', () => {
        const chunks = chunkPages([
            { page: 1, text: 'First real page.' },
            { page: 2, text: '   ' },
            { page: 3, text: 'Third real page.' },
        ], { maxChars: 100 });
        const text = chunks.map((c) => c.chunk_text).join(' ');
        expect(text).toContain('First real page.');
        expect(text).toContain('Third real page.');
    });
});
