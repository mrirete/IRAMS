/**
 * pidTagExtract — read an as-built P&ID and propose the asset register it implies.
 *
 * WHY THIS EXISTS
 * A CMMS rollout dies on data entry. The customer usually has drawings long
 * before they have a register, and the drawing already carries the two things
 * a register needs most: the tag number (which is the register's real primary
 * key) and what kind of equipment it is. Typing that in by hand for a few
 * hundred tags is the reason so many registers are never finished.
 *
 * Most as-builts are vector PDFs plotted from AutoCAD, which means the tags are
 * real text, not pixels. Pulling them out is deterministic string work — no
 * vision model, no API key, no per-page cost, and the same input always gives
 * the same output. Connectivity is the hard half and is deliberately NOT
 * attempted here (see pidGraph.ts for where topology lives); this module claims
 * only what text can honestly support.
 *
 * WHAT THIS IS NOT
 * It is not an authority on the plant. A drawing can be years out of date, and
 * "as-built" is often aspirational. Everything here is a PROPOSAL for an
 * engineer to confirm — which is why nothing in this file writes, and why
 * `rejected` exists: what was discarded is reported alongside what was kept, so
 * a reviewer can see the decisions rather than trust them.
 *
 * Pure: text in, proposals out. No pdfjs import, no I/O — the caller extracts
 * the text (see ManualService.extractPages for the established pdfjs pattern)
 * and this module decides what it means.
 */

// ── Input ────────────────────────────────────────────────────────────────

/** One text run from a PDF page, as pdfjs yields it. */
export interface PdfTextItem {
    str: string;
    page: number;
    /** Optional page coordinates; used only to report where a tag was found. */
    x?: number;
    y?: number;
}

// ── Output ───────────────────────────────────────────────────────────────

export type TagKind = 'equipment' | 'instrument' | 'valve' | 'line' | 'unknown';

export interface ExtractedTag {
    /** The tag as it will go into the register (most common drawn form). */
    tag: string;
    /** Every distinct spelling seen, e.g. ['P-101', 'P101']. */
    variants: string[];
    kind: TagKind;
    /** Plain-language equipment class, e.g. 'Centrifugal pump'. Undefined when the prefix is unknown. */
    equipmentClass?: string;
    /** How many times it appears; a tag drawn once is a likelier item than one repeated 40 times. */
    occurrences: number;
    pages: number[];
    confidence: 'high' | 'medium' | 'low';
    /** Why it was classified this way — shown to the reviewer, never hidden. */
    reason: string;
}

export interface RejectedText {
    text: string;
    reason: string;
    occurrences: number;
}

export interface ExtractionResult {
    tags: ExtractedTag[];
    /** Text that looked tag-shaped but was deliberately not proposed. */
    rejected: RejectedText[];
    /** The policy actually applied, so the UI can state it rather than imply it. */
    policy: {
        includeInstruments: boolean;
        includeValves: boolean;
    };
    stats: {
        itemsScanned: number;
        pages: number;
        candidates: number;
        proposed: number;
    };
}

// ── Conventions ──────────────────────────────────────────────────────────
// Tag prefixes are plant convention, not standard — ISA 5.1 governs instrument
// letters but equipment prefixes vary by owner, EPC and era. This map is a
// sensible default for oil, gas and process plants; it is exported so a site
// with its own convention can override it rather than fork this file. An
// unknown prefix is reported as `unknown`, never guessed into a class.

export const EQUIPMENT_PREFIXES: Record<string, string> = {
    P: 'Pump',
    PU: 'Pump',
    PMP: 'Pump',
    K: 'Compressor',
    CMP: 'Compressor',
    // C is a conveyor here, not a compressor: this register already uses C-902
    // for a conveyor and K-601 / CMP-201 for compressors. Sites differ, which
    // is exactly why this map is overridable.
    C: 'Conveyor',
    B: 'Blower',
    E: 'Heat exchanger',
    HX: 'Heat exchanger',
    AC: 'Air cooler',
    F: 'Filter',
    FL: 'Filter',
    H: 'Heater',
    FH: 'Fired heater',
    R: 'Reactor',
    D: 'Drum',
    V: 'Vessel',
    KO: 'Knockout drum',
    S: 'Separator',
    SP: 'Separator',
    T: 'Tower',
    TK: 'Tank',
    CO: 'Column',
    M: 'Motor',
    GT: 'Gas turbine',
    ST: 'Steam turbine',
    G: 'Generator',
    AG: 'Agitator',
    // CV is deliberately absent: it means "control valve" on a process P&ID and
    // "conveyor" in mining. An ambiguous prefix is reported for the engineer to
    // resolve rather than silently resolved one way.
    CR: 'Crusher',
    MI: 'Mill',
    SC: 'Screen',
};

/**
 * Instrument loop prefixes, curated rather than derived.
 *
 * ISA 5.1 grammar (measured variable + function letters) was tried first and is
 * too permissive to be useful: it defines almost every letter, so nearly any
 * two-letter prefix parses as a valid loop and unrecognised site conventions
 * get labelled "instrument" and quietly discarded under a reason that is not
 * true. An explicit list is checkable, matches how equipment and valves are
 * handled here, and lets anything genuinely unknown surface as unknown.
 */
export const INSTRUMENT_PREFIXES = new Set([
    // Pressure
    'PI', 'PT', 'PG', 'PS', 'PIC', 'PIT', 'PDT', 'PDI', 'PDIT', 'PSH', 'PSL', 'PAH', 'PAL',
    // Temperature
    'TI', 'TT', 'TE', 'TW', 'TG', 'TIC', 'TIT', 'TSH', 'TSL', 'TAH', 'TAL',
    // Flow
    'FI', 'FT', 'FE', 'FG', 'FIC', 'FIT', 'FQ', 'FQI', 'FSL', 'FSH', 'FAL',
    // Level
    'LI', 'LT', 'LG', 'LS', 'LIC', 'LIT', 'LAH', 'LAL', 'LSH', 'LSL',
    // Analysis / quality
    'AI', 'AT', 'AE', 'AIT', 'AAH',
    // Speed, vibration, position
    'SI', 'SE', 'SS', 'VI', 'VT', 'VE', 'VSH', 'ZI', 'ZT', 'ZS', 'ZSC', 'ZSO',
    // Hand, weight, moisture, density, radiation
    'HS', 'WI', 'WT', 'MI', 'DI', 'DT', 'RI', 'QI', 'XI', 'XA', 'YI',
]);

/**
 * Valve prefixes worth carrying into a register. Relief devices and actuated
 * valves are maintainable items with their own inspection and test intervals —
 * a PSV especially, since its interval is usually a statutory one. Plain
 * hand-operated block valves are not normally registered and are not listed.
 */
export const VALVE_PREFIXES: Record<string, string> = {
    PSV: 'Pressure safety valve',
    PRV: 'Pressure relief valve',
    RV: 'Relief valve',
    TSV: 'Thermal safety valve',
    XV: 'On/off valve',
    HV: 'Hand control valve',
    MOV: 'Motor operated valve',
    SDV: 'Shutdown valve',
    ESV: 'Emergency shutdown valve',
    ESDV: 'Emergency shutdown valve',
    BDV: 'Blowdown valve',
    PV: 'Control valve',
    FV: 'Control valve',
    LV: 'Control valve',
    TV: 'Control valve',
};

export interface ExtractOptions {
    /**
     * Instruments are excluded by default. Many registers do want them (a
     * calibration programme needs them), but silently creating a hundred
     * transmitters for a site that manages instruments elsewhere is worse than
     * asking. Either way the count is reported.
     */
    includeInstruments?: boolean;
    /** Actuated and relief valves. Included by default: they carry test intervals. */
    includeValves?: boolean;
    /** Override or extend the equipment prefix convention for this site. */
    equipmentPrefixes?: Record<string, string>;
    /**
     * A tag repeated more than this many times is more likely a line service
     * code or a note reference than one machine. It is still proposed, but at
     * reduced confidence with the reason stated.
     */
    repeatSuspicionThreshold?: number;
}

// ── Recognition ──────────────────────────────────────────────────────────

/**
 * Tag shape: 1-4 letters, 1-5 digits, then any number of trailing parts.
 *
 * The trailing parts matter: this register tags a duty/standby pair as
 * P-101-A and P-101-B, and drills further down as P-101-A-BRG-DE. An earlier
 * draft treated any multi-hyphen token as a line number and would have thrown
 * away every one of those.
 */
const TAG_SHAPE = /^([A-Z]{1,4})[\s\-_/]?(\d{1,5})((?:[\s\-_/][A-Z0-9]{1,6})*[A-Z]{0,2})$/;

/** A pipe spec suffix (A1A, C2B) — the tell that a token is a line, not a machine. */
const PIPE_SPEC_SUFFIX = /^[A-Z]\d[A-Z]$/;

/**
 * A pipe line number rather than an equipment tag. Line numbers are the single
 * biggest source of false assets — a 40-line drawing yields 40 tag-shaped
 * strings that are not equipment.
 *
 * Detection keys on the SIZE, which a line number on a P&ID essentially always
 * carries and an equipment tag never does. Counting hyphens was tried first and
 * is wrong: it cannot tell 6"-P-1501-A1A from P-101-A.
 */
function looksLikeLineNumber(text: string): boolean {
    if (/["″]/.test(text)) return true;                      // 6"-P-1501
    if (/^\d+\s*(IN|MM)\b/i.test(text)) return true;         // 150MM-CWS-1002
    if (/\bNPS\b|\bDN\d/i.test(text)) return true;
    if (/^\d+[-/]/.test(text)) return true;                  // 1501-P-A1A: leads with the line number
    return false;
}

/** Drawing furniture: revisions, sheet references, notes, dates, title block. */
function looksLikeDrawingFurniture(text: string): boolean {
    if (/^(REV|SH|SHT|SHEET|DWG|DRG|NO|NOTE|NOTES|DATE|SCALE|APP|APPD|CHK|CHKD|BY|OF)\b/i.test(text)) return true;
    if (/\b(SHEET|CONTINUED|REFERENCE|TYPICAL|TYP|DETAIL|SEE DWG)\b/i.test(text)) return true;
    if (/^\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}$/.test(text)) return true;   // a date
    if (/^[A-Z]$/.test(text)) return true;                              // a lone revision letter
    return false;
}

interface Candidate {
    raw: string;
    prefix: string;
    number: string;
    suffix: string;
    page: number;
}

/** Normalised identity: P-101, P101 and P 101 are one item drawn three ways. */
const identityOf = (c: Candidate) => `${c.prefix}${c.number}${c.suffix.replace(/[\s\-_/]/g, '')}`;

/** The trailing part of a tag, e.g. 'A' from P-101-A or 'A1A' from P-1501-A1A. */
const lastSegment = (suffix: string) => suffix.split(/[\s\-_/]/).filter(Boolean).pop() ?? '';

function classify(
    c: Candidate,
    equipmentPrefixes: Record<string, string>,
): { kind: TagKind; equipmentClass?: string; reason: string } {
    const p = c.prefix;

    // Valves and relief devices first: several share a first letter with a
    // measured variable (PV is a control valve, not a pressure something).
    if (VALVE_PREFIXES[p]) {
        return { kind: 'valve', equipmentClass: VALVE_PREFIXES[p], reason: `"${p}" is a valve prefix` };
    }

    // An equipment prefix is a single- or double-letter machine code. Check it
    // before the instrument rule so a two-letter machine (TK, GT) is not read
    // as a measured-variable + function pair.
    if (equipmentPrefixes[p]) {
        return { kind: 'equipment', equipmentClass: equipmentPrefixes[p], reason: `"${p}" is an equipment prefix` };
    }

    // Instrument loops are matched against the known list, not parsed: see the
    // note on INSTRUMENT_PREFIXES for why grammar was rejected.
    if (INSTRUMENT_PREFIXES.has(p)) {
        return { kind: 'instrument', reason: `"${p}" is an instrument loop prefix` };
    }

    return { kind: 'unknown', reason: `"${p}" is not a prefix this site's convention recognises` };
}

/**
 * Find the equipment a drawing declares.
 *
 * Deliberately conservative: anything not confidently a machine is either
 * classified as an instrument or valve (subject to policy) or dropped into
 * `rejected` with a reason. A register that is missing five items an engineer
 * then adds is a better outcome than one carrying fifty pipe segments as
 * assets, because nobody ever audits the extra rows back out.
 */
export function extractPidTags(items: PdfTextItem[], opts: ExtractOptions = {}): ExtractionResult {
    const includeInstruments = opts.includeInstruments ?? false;
    const includeValves = opts.includeValves ?? true;
    const equipmentPrefixes = opts.equipmentPrefixes ?? EQUIPMENT_PREFIXES;
    const repeatThreshold = opts.repeatSuspicionThreshold ?? 12;

    const rejects = new Map<string, RejectedText>();
    const reject = (text: string, reason: string) => {
        const cur = rejects.get(text);
        if (cur) cur.occurrences += 1;
        else rejects.set(text, { text, reason, occurrences: 1 });
    };

    const byIdentity = new Map<string, { cands: Candidate[]; pages: Set<number> }>();
    const pages = new Set<number>();
    let candidates = 0;

    for (const item of items) {
        pages.add(item.page);
        // A single text run can hold several tags ("P-101A P-101B"); split on
        // whitespace but keep hyphens, which are part of the tag.
        for (const token of String(item.str ?? '').split(/[\s,;|]+/)) {
            const text = token.trim().replace(/[.:()[\]]+$/g, '').toUpperCase();
            if (text.length < 2 || text.length > 12) continue;

            // Furniture first: a date like 14/02/2026 leads with digits and a
            // separator, so the line-number rule would otherwise claim it and
            // report a reason that is not true.
            if (looksLikeDrawingFurniture(text)) continue;
            if (looksLikeLineNumber(text)) {
                if (TAG_SHAPE.test(text) || /\d/.test(text)) reject(text, 'Reads as a pipe line number, not an item of equipment');
                continue;
            }

            const m = TAG_SHAPE.exec(text);
            if (!m) continue;

            candidates += 1;
            const cand: Candidate = { raw: text, prefix: m[1], number: m[2], suffix: m[3] ?? '', page: item.page };
            const id = identityOf(cand);
            const entry = byIdentity.get(id) ?? { cands: [], pages: new Set<number>() };
            entry.cands.push(cand);
            entry.pages.add(item.page);
            byIdentity.set(id, entry);
        }
    }

    const tags: ExtractedTag[] = [];

    for (const [, entry] of byIdentity) {
        const first = entry.cands[0];
        const { kind, equipmentClass, reason } = classify(first, equipmentPrefixes);
        const occurrences = entry.cands.length;

        // Most common drawn spelling wins, so the register matches the drawing.
        const spellingCounts = new Map<string, number>();
        for (const c of entry.cands) spellingCounts.set(c.raw, (spellingCounts.get(c.raw) ?? 0) + 1);
        const variants = [...spellingCounts.keys()].sort();
        const tag = [...spellingCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];

        if (kind === 'instrument' && !includeInstruments) {
            reject(tag, 'Instrument loop — excluded by the current policy');
            continue;
        }
        if (kind === 'valve' && !includeValves) {
            reject(tag, 'Valve — excluded by the current policy');
            continue;
        }
        if (kind === 'unknown') {
            // Surfaced, not silently dropped: an unrecognised prefix is usually
            // a site convention this map has not been taught yet.
            reject(tag, `Unrecognised prefix "${first.prefix}" — add it to the site's convention to import these`);
            continue;
        }

        let confidence: ExtractedTag['confidence'] = 'high';
        const notes = [reason];
        if (PIPE_SPEC_SUFFIX.test(lastSegment(first.suffix))) {
            confidence = 'low';
            notes.push(`ends in "${lastSegment(first.suffix)}", which reads as a pipe specification rather than an item suffix`);
        } else if (occurrences > repeatThreshold) {
            confidence = 'low';
            notes.push(`appears ${occurrences} times, which is more typical of a service code than one machine`);
        } else if (variants.length > 1) {
            confidence = 'medium';
            notes.push(`drawn inconsistently as ${variants.join(' / ')}`);
        } else if (kind === 'valve') {
            confidence = 'medium';
            notes.push('valves are proposed for review because not every site registers them');
        }

        tags.push({
            tag,
            variants,
            kind,
            equipmentClass,
            occurrences,
            pages: [...entry.pages].sort((a, b) => a - b),
            confidence,
            reason: notes.join('; '),
        });
    }

    tags.sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true }));

    return {
        tags,
        rejected: [...rejects.values()].sort((a, b) => b.occurrences - a.occurrences || a.text.localeCompare(b.text)),
        policy: { includeInstruments, includeValves },
        stats: { itemsScanned: items.length, pages: pages.size, candidates, proposed: tags.length },
    };
}

// ── Handing over to the importer ─────────────────────────────────────────

/** A row in the shape `bulkImportService.importAssets` consumes. */
export type ImportRow = Record<string, string>;

export interface ToRowsOptions {
    /** Tag for the SYSTEM the drawing represents; every item is parented to it. */
    systemTag: string;
    /** Human name for that system, e.g. 'Gas Compression Train'. */
    systemName: string;
    /** Emit the parent SYSTEM row too. Off when the system already exists. */
    createSystem?: boolean;
    /** Criticality is an engineering judgement — only set it if the reviewer chose one. */
    defaultCriticality?: string;
    /** Skip anything below this confidence. Default keeps high and medium. */
    minConfidence?: 'high' | 'medium' | 'low';
}

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 } as const;

/**
 * Turn confirmed extractions into import rows.
 *
 * Everything lands as EQUIPMENT under one SYSTEM, because that is all a drawing
 * honestly supports. Component-level breakdown (bearings, seals) comes from a
 * maintainable-item study, and parenting an instrument to the machine it
 * watches would be a guess: loop numbers follow the process line at least as
 * often as the equipment.
 */
export function toAssetImportRows(result: ExtractionResult, opts: ToRowsOptions): ImportRow[] {
    const min = CONFIDENCE_RANK[opts.minConfidence ?? 'medium'];
    const rows: ImportRow[] = [];

    if (opts.createSystem) {
        rows.push({
            tag: opts.systemTag,
            name: opts.systemName,
            hierarchylevel: 'SYSTEM',
            description: 'Created from an as-built P&ID',
            ...(opts.defaultCriticality ? { criticality: opts.defaultCriticality } : {}),
        });
    }

    for (const t of result.tags) {
        if (CONFIDENCE_RANK[t.confidence] < min) continue;
        rows.push({
            tag: t.tag,
            name: t.equipmentClass ? `${t.equipmentClass} ${t.tag}` : t.tag,
            hierarchylevel: 'EQUIPMENT',
            parenttag: opts.systemTag,
            description: `From P&ID (${t.reason})`,
            ...(opts.defaultCriticality ? { criticality: opts.defaultCriticality } : {}),
        });
    }

    return rows;
}
