/**
 * Tests for pidTagExtract — deriving a proposed asset register from the text
 * layer of an as-built P&ID.
 *
 * The fixtures use this plant's own conventions rather than textbook ones:
 * duty/standby pairs written P-101-A / P-101-B, compressors as K-xxx and
 * CMP-xxx, conveyors as C-xxx, and the tags from the "Demo — Process Unit"
 * drawing that actually exists in ers_pid_configurations. Testing against the
 * house style is the point — a extractor that only handles ISA examples would
 * pass a prettier test suite and fail on the customer's first drawing.
 *
 * The rule under test throughout: never invent an asset. Missing five items an
 * engineer then adds beats importing fifty pipe segments, because nobody audits
 * the extra rows back out.
 */
import { describe, it, expect } from 'vitest';
import {
    extractPidTags,
    toAssetImportRows,
    EQUIPMENT_PREFIXES,
    type PdfTextItem,
} from './pidTagExtract';

/** Build a page's worth of text runs the way pdfjs hands them over. */
const page = (n: number, ...strings: string[]): PdfTextItem[] =>
    strings.map((str, i) => ({ str, page: n, x: 100, y: 700 - i * 12 }));

/** A realistic single-sheet drawing: equipment, lines, instruments, furniture. */
const SHEET_1: PdfTextItem[] = page(
    1,
    'GAS COMPRESSION TRAIN',
    'P&ID  DWG No. 12-3456  REV C',
    'SHEET 1 OF 3',
    'P-101-A', 'P-101-B',
    'K-601',
    'E-605',
    'V-602',
    'C-902',
    '6"-P-1501-A1A',
    '150MM-CWS-1002',
    'PT-101', 'FIC-205', 'LG-602',
    'PSV-610',
    'XV-201',
    'NOTE 3',
    '14/02/2026',
);

describe('extractPidTags — what it proposes', () => {
    it('finds the equipment and names the class from the tag prefix', () => {
        const { tags } = extractPidTags(SHEET_1);
        const byTag = Object.fromEntries(tags.map((t) => [t.tag, t]));

        expect(byTag['P-101-A'].equipmentClass).toBe('Pump');
        expect(byTag['K-601'].equipmentClass).toBe('Compressor');
        expect(byTag['E-605'].equipmentClass).toBe('Heat exchanger');
        expect(byTag['V-602'].equipmentClass).toBe('Vessel');
    });

    it('keeps a duty/standby pair as two separate assets', () => {
        const { tags } = extractPidTags(SHEET_1);
        const pumps = tags.filter((t) => t.tag.startsWith('P-101'));
        expect(pumps.map((p) => p.tag)).toEqual(['P-101-A', 'P-101-B']);
    });

    it('reads C-902 as a conveyor, following this register rather than the textbook', () => {
        const { tags } = extractPidTags(SHEET_1);
        expect(tags.find((t) => t.tag === 'C-902')?.equipmentClass).toBe('Conveyor');
    });

    it('records which pages a tag appears on', () => {
        const { tags } = extractPidTags([...SHEET_1, ...page(3, 'K-601')]);
        expect(tags.find((t) => t.tag === 'K-601')?.pages).toEqual([1, 3]);
    });
});

describe('extractPidTags — what it refuses to propose', () => {
    it('drops pipe line numbers, with the reason recorded', () => {
        const { tags, rejected } = extractPidTags(SHEET_1);
        expect(tags.map((t) => t.tag)).not.toContain('6"-P-1501-A1A');
        expect(rejected.some((r) => /line number/i.test(r.reason))).toBe(true);
    });

    it('is not fooled by a line number written without a size', () => {
        const { tags } = extractPidTags(page(1, '1501-P-A1A'));
        expect(tags).toHaveLength(0);
    });

    it('flags a pipe spec suffix rather than trusting it as equipment', () => {
        const { tags } = extractPidTags(page(1, 'P-1501-A1A'));
        expect(tags[0].confidence).toBe('low');
        expect(tags[0].reason).toMatch(/pipe specification/i);
    });

    it('ignores title block furniture, revisions and dates', () => {
        const { tags } = extractPidTags(SHEET_1);
        const proposed = tags.map((t) => t.tag);
        for (const noise of ['REV', 'SHEET', 'NOTE', '14/02/2026', 'DWG']) {
            expect(proposed).not.toContain(noise);
        }
    });

    it('reports an unrecognised prefix as something to teach it, not as an asset', () => {
        const { tags, rejected } = extractPidTags(page(1, 'ZQ-880'));
        expect(tags).toHaveLength(0);
        const r = rejected.find((x) => x.text === 'ZQ-880');
        expect(r?.reason).toMatch(/Unrecognised prefix "ZQ"/);
        expect(r?.reason).toMatch(/add it to the site's convention/i);
    });

    it('refuses to resolve a genuinely ambiguous prefix', () => {
        // CV is a control valve in process plants and a conveyor in mining.
        const { tags, rejected } = extractPidTags(page(1, 'CV-300'));
        expect(tags).toHaveLength(0);
        expect(rejected[0].reason).toMatch(/Unrecognised prefix "CV"/);
        expect(EQUIPMENT_PREFIXES['CV']).toBeUndefined();
    });
});

describe('extractPidTags — policy on instruments and valves', () => {
    it('leaves instrument loops out by default, and says so', () => {
        const { tags, rejected, policy } = extractPidTags(SHEET_1);
        expect(policy.includeInstruments).toBe(false);
        expect(tags.map((t) => t.tag)).not.toContain('PT-101');
        expect(rejected.find((r) => r.text === 'PT-101')?.reason).toMatch(/excluded by the current policy/i);
    });

    it('includes instrument loops when the site asks for them', () => {
        const { tags } = extractPidTags(SHEET_1, { includeInstruments: true });
        const instruments = tags.filter((t) => t.kind === 'instrument').map((t) => t.tag);
        expect(instruments).toEqual(expect.arrayContaining(['PT-101', 'FIC-205', 'LG-602']));
    });

    it('proposes relief and actuated valves, which carry test intervals', () => {
        const { tags } = extractPidTags(SHEET_1);
        const psv = tags.find((t) => t.tag === 'PSV-610');
        expect(psv?.kind).toBe('valve');
        expect(psv?.equipmentClass).toBe('Pressure safety valve');
        expect(tags.find((t) => t.tag === 'XV-201')?.kind).toBe('valve');
    });

    it('holds valves at medium confidence, because not every site registers them', () => {
        const { tags } = extractPidTags(SHEET_1);
        expect(tags.find((t) => t.tag === 'PSV-610')?.confidence).toBe('medium');
    });

    it('drops valves entirely when the site does not register them', () => {
        const { tags } = extractPidTags(SHEET_1, { includeValves: false });
        expect(tags.some((t) => t.kind === 'valve')).toBe(false);
    });

    it('does not mistake a two-letter machine prefix for an instrument loop', () => {
        // GT and ST would parse as measured-variable + function under ISA rules.
        const { tags } = extractPidTags(page(1, 'GT-301', 'ST-410', 'TK-01'));
        expect(tags.map((t) => `${t.tag}=${t.equipmentClass}`))
            .toEqual(['GT-301=Gas turbine', 'ST-410=Steam turbine', 'TK-01=Tank']);
        expect(tags.every((t) => t.kind === 'equipment')).toBe(true);
    });
});

describe('extractPidTags — the same item drawn twice', () => {
    it('merges spellings of one tag and keeps the commonest for the register', () => {
        const { tags } = extractPidTags(page(1, 'P-101', 'P101', 'P-101'));
        expect(tags).toHaveLength(1);
        expect(tags[0].tag).toBe('P-101');
        expect(tags[0].variants).toEqual(['P-101', 'P101']);
        expect(tags[0].occurrences).toBe(3);
    });

    it('lowers confidence when a tag is drawn inconsistently, and explains why', () => {
        const { tags } = extractPidTags(page(1, 'P-101', 'P101'));
        expect(tags[0].confidence).toBe('medium');
        expect(tags[0].reason).toMatch(/drawn inconsistently/i);
    });

    it('doubts a token repeated far too often to be one machine', () => {
        const many = page(1, ...Array.from({ length: 20 }, () => 'E-605'));
        const { tags } = extractPidTags(many);
        expect(tags[0].confidence).toBe('low');
        expect(tags[0].reason).toMatch(/service code/i);
    });
});

describe('extractPidTags — the drawing that actually exists', () => {
    // Tags from "Demo — Process Unit" in ers_pid_configurations.
    const DEMO = page(1, 'P-101', 'K-201', 'E-301', 'E-302', 'V-401', 'PT-101', 'XV-201');

    it('proposes the five machines and the valve, not the transmitter', () => {
        const { tags } = extractPidTags(DEMO);
        expect(tags.map((t) => t.tag)).toEqual(['E-301', 'E-302', 'K-201', 'P-101', 'V-401', 'XV-201']);
    });

    it('reports honest counts of what it scanned and proposed', () => {
        const { stats } = extractPidTags(DEMO);
        expect(stats.itemsScanned).toBe(7);
        expect(stats.pages).toBe(1);
        expect(stats.proposed).toBe(6); // PT-101 excluded by policy
    });
});

describe('extractPidTags — genuine pdfjs output', () => {
    /**
     * Not hand-written: a vector PDF was generated with a P&ID-style text layer,
     * opened with pdfjs, and its text runs captured verbatim — coordinates and
     * all. pdfjs splits a drawn line into one run per token and reports position
     * in transform[4]/[5], and this is what that actually looks like. A fixture
     * invented by hand would not have caught, for instance, that a date leads
     * with digits and a separator exactly like a line number does.
     */
    const FROM_PDFJS: PdfTextItem[] = [
        { str: 'GAS COMPRESSION TRAIN', page: 1, x: 60, y: 720 },
        { str: 'P&ID DWG No. 12-3456 REV C', page: 1, x: 60, y: 696 },
        { str: 'SHEET 1 OF 3', page: 1, x: 60, y: 672 },
        { str: 'P-101-A', page: 1, x: 60, y: 648 },
        { str: 'P-101-B', page: 1, x: 114.024, y: 648 },
        { str: 'K-601', page: 1, x: 168.048, y: 648 },
        { str: 'E-605', page: 1, x: 60, y: 624 },
        { str: 'V-602', page: 1, x: 102.024, y: 624 },
        { str: 'C-902', page: 1, x: 144.048, y: 624 },
        { str: '6"-P-1501-A1A', page: 1, x: 60, y: 600 },
        { str: '150MM-CWS-1002', page: 1, x: 150.3, y: 600 },
        { str: 'PT-101', page: 1, x: 60, y: 576 },
        { str: 'FIC-205', page: 1, x: 109.356, y: 576 },
        { str: 'LG-602', page: 1, x: 162.708, y: 576 },
        { str: 'PSV-610', page: 1, x: 60, y: 552 },
        { str: 'XV-201', page: 1, x: 118.032, y: 552 },
        { str: 'NOTE 3', page: 1, x: 60, y: 528 },
        { str: '14/02/2026', page: 1, x: 113.352, y: 528 },
    ];

    it('reads a real drawing down to the right eight assets', () => {
        const { tags } = extractPidTags(FROM_PDFJS);
        expect(tags.map(t => t.tag)).toEqual([
            'C-902', 'E-605', 'K-601', 'P-101-A', 'P-101-B', 'PSV-610', 'V-602', 'XV-201',
        ]);
    });

    it('does not accuse the revision date of being a pipe line', () => {
        const { rejected } = extractPidTags(FROM_PDFJS);
        expect(rejected.some(r => r.text === '14/02/2026')).toBe(false);
    });

    it('discards both line numbers and the drawing number', () => {
        const { tags } = extractPidTags(FROM_PDFJS);
        const proposed = tags.map(t => t.tag);
        for (const notAnAsset of ['6"-P-1501-A1A', '150MM-CWS-1002', '12-3456']) {
            expect(proposed).not.toContain(notAnAsset);
        }
    });
});

describe('toAssetImportRows — handing over to the importer', () => {
    const result = extractPidTags(SHEET_1);
    const opts = { systemTag: 'SYS-COMP-01', systemName: 'Gas Compression Train', createSystem: true };

    it('emits rows in the shape importAssets consumes', () => {
        const rows = toAssetImportRows(result, opts);
        const pump = rows.find((r) => r.tag === 'P-101-A')!;
        expect(pump.hierarchylevel).toBe('EQUIPMENT');
        expect(pump.parenttag).toBe('SYS-COMP-01');
        expect(pump.name).toBe('Pump P-101-A');
    });

    it('creates the parent system first, at SYSTEM level', () => {
        const rows = toAssetImportRows(result, opts);
        expect(rows[0]).toMatchObject({ tag: 'SYS-COMP-01', hierarchylevel: 'SYSTEM' });
    });

    it('omits the system row when it already exists', () => {
        const rows = toAssetImportRows(result, { ...opts, createSystem: false });
        expect(rows.some((r) => r.hierarchylevel === 'SYSTEM')).toBe(false);
    });

    it('leaves criticality unset unless the reviewer chose one', () => {
        const rows = toAssetImportRows(result, opts);
        expect(rows.every((r) => r.criticality === undefined)).toBe(true);

        const withCrit = toAssetImportRows(result, { ...opts, defaultCriticality: 'B' });
        expect(withCrit.every((r) => r.criticality === 'B')).toBe(true);
    });

    it('carries the reason into the description, so the register records its provenance', () => {
        const rows = toAssetImportRows(result, opts);
        expect(rows.find((r) => r.tag === 'K-601')!.description).toMatch(/From P&ID/);
    });

    it('excludes low-confidence proposals by default', () => {
        const noisy = extractPidTags(page(1, 'P-1501-A1A', 'K-601'));
        const rows = toAssetImportRows(noisy, opts);
        expect(rows.map((r) => r.tag)).not.toContain('P-1501-A1A');
        expect(rows.map((r) => r.tag)).toContain('K-601');
    });

    it('can be asked for everything, including the doubtful rows', () => {
        const noisy = extractPidTags(page(1, 'P-1501-A1A', 'K-601'));
        const rows = toAssetImportRows(noisy, { ...opts, minConfidence: 'low' });
        expect(rows.map((r) => r.tag)).toContain('P-1501-A1A');
    });
});
