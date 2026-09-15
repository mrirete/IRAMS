/**
 * pidTagExtract against a REAL drawing set — Pahala WWTP (County of Hawaii,
 * submitted to US EPA July 2021; a federal-record public document). The
 * fixture is the pdfjs text layer of three sheets, vendored verbatim in
 * tests/fixtures/pahala-wwtp-sheets.json with its provenance.
 *
 * Why this file exists next to the synthetic tests: the synthetic sheets use
 * this product's own tag conventions and pass beautifully. A real municipal
 * drawing set uses ISA bubbles whose function letters (LSH) and loop numbers
 * (401) are SEPARATE text runs, panel tags in a comma style (600,204B), and
 * sheet references that look exactly like equipment tags (P-601 is a drawing
 * number here, not a pump). Recording what the extractor actually does on
 * that — including what it misses and what it wrongly accepts — is the
 * honest number to put in front of a customer.
 *
 * The rule being enforced is the extractor's own: never invent. Every tag it
 * returns must appear verbatim (or as a listed variant) in the text layer.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractPidTags, type PdfTextItem } from './pidTagExtract';

const fixture = JSON.parse(readFileSync(resolve(__dirname, '../../tests/fixtures/pahala-wwtp-sheets.json'), 'utf8')) as {
    source: string; items: PdfTextItem[];
};
const page = (n: number) => fixture.items.filter((i) => i.page === n);
const runs = (n: number) => new Set(page(n).map((i) => i.str.trim()));

describe('pidTagExtract on the Pahala WWTP text layer', () => {
    it('the fixture is what it says it is', () => {
        expect(fixture.source).toMatch(/Pahala/);
        expect(page(21).length).toBeGreaterThan(150);
        expect(page(22).length).toBeGreaterThan(150);
        expect(page(24).length).toBeGreaterThan(150);
    });

    it('never invents: every returned tag or variant appears inside some run of the text layer', () => {
        for (const p of [21, 22, 24]) {
            const r = extractPidTags(page(p), { includeInstruments: true, includeValves: true });
            const text = page(p).map((i) => i.str.toUpperCase());
            for (const t of r.tags) {
                const hit = [t.tag, ...t.variants].some((v) => text.some((s) => s.includes(v.toUpperCase())));
                expect(hit, `${t.tag} on page ${p} is not in the text layer`).toBe(true);
            }
        }
    });

    it('P-401.DWG (page 21): "REF SHT P-204" is a sheet cross-reference, rejected with that reason', () => {
        // First run against this set returned P-204 as a pump. The run is
        // "REF SHT P-204" — a pointer to another sheet. Now rejected, and the
        // reviewer sees why in the rejected list.
        const r = extractPidTags(page(21), { includeInstruments: true, includeValves: true });
        expect(r.tags.some((t) => t.tag === 'P-204')).toBe(false);
        expect(r.tags.some((t) => t.tag === 'P-501')).toBe(false);   // "REF SHT P-501" too
        const rej = r.rejected.find((x) => x.text === 'P-204');
        expect(rej?.reason).toMatch(/sheet cross-reference/i);
    });

    it('P-501.DWG (page 22): the sheet\'s own number in the title block is not a pump', () => {
        // "FILENAME: P-501.DWG" names the sheet; a bare "P-501" sits in the
        // title block. Before the fix every sheet gained one phantom pump.
        const r = extractPidTags(page(22), { includeInstruments: true, includeValves: true });
        expect(r.tags.filter((t) => t.kind === 'equipment')).toHaveLength(0);
        const rej = r.rejected.find((x) => x.text === 'P-501');
        expect(rej?.reason).toMatch(/own drawing number/i);
    });

    it('P-602.DWG (page 24): comma-style panel tags are a known miss; bare P-601 / P-603 remain a known false positive', () => {
        // Hand count from the text layer: 17 distinct comma-style panel/loop
        // tags (MCP 600,101; 600,204B …). The extractor's grammar is dash/plain
        // (P-101, P101); the comma style is a Hawaiian-county convention it
        // does not know. It must find NONE of them rather than mangle them —
        // 0 recall on this family is the honest baseline to beat.
        const r = extractPidTags(page(24), { includeInstruments: true, includeValves: true });
        expect(r.tags.filter((t) => /\d{3},\d{3}/.test(t.tag))).toHaveLength(0);
        // The sheet's own number (P-602) is rejected. P-601 and P-603 are
        // drawn bare next to "GEN CONTROL PANEL" / "BULK TANK PANEL" — almost
        // certainly references to those sheets, but nothing on the run says
        // so, and the extractor does not guess. Pinned as the remaining false
        // positives so a future layout rule shows up as a green change.
        expect(r.tags.some((t) => t.tag === 'P-602')).toBe(false);
        expect(r.tags.filter((t) => /^P-60[13]$/.test(t.tag)).map((t) => t.tag).sort()).toEqual(['P-601', 'P-603']);
    });

    it('P-401.DWG (page 21): split ISA bubbles (LSH + 401 as separate runs) are not joined', () => {
        // The bubble reads "LSH / 401" on the sheet; pdfjs hands over 'LSH' and
        // '401' as two runs. Joining them needs layout (x/y adjacency) the
        // extractor does not attempt, so it must return no instrument for the
        // loop rather than a guessed 'LSH-401'.
        const r = extractPidTags(page(21), { includeInstruments: true, includeValves: true });
        expect(r.tags.some((t) => /^LSH-?401$/.test(t.tag))).toBe(false);
        // …and the bare function letters must not be promoted to tags either.
        expect(r.tags.some((t) => ['LSH', 'LAH', 'LAL', 'FIT', 'LCH', 'LCL'].includes(t.tag))).toBe(false);
    });
});
