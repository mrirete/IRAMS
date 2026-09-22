/**
 * Cockpit source data -> IREAMS import rows.
 *
 * Slice 1 covers the condition history: PM - Measuring point and PM -
 * Measurement document. They are the pair a reliability study is built on —
 * a point is what gets measured, a document is one measurement of it — and
 * they are useless apart, because a measurement document names NO asset.
 * It carries MEASUREMENT_POINT and nothing else, so the only way to know
 * which pump a vibration reading belongs to is to read the point file from
 * the same download and join on it. That join is this module's real work.
 *
 * Output rows use IREAMS's canonical import headers (lowercase, the shape
 * assetTemplates produces and bulkImportService.importReadings consumes), so
 * cockpit data lands through exactly the same path as every other import —
 * no second write path to keep honest.
 *
 * Structures for the other three objects are recognised and reported, not
 * mapped: they belong to the strategy slice.
 */

import {
    parseCsv, parseCockpitCsv, parseCockpitFileName, cockpitFolderName, missingMandatory,
    type CockpitSheet,
} from './dialect';
import { COCKPIT_OBJECTS, structureSpec, findStructures, type CockpitObjectKey } from './structures';
import { parseSapCycle, parseSapCycleText, type Cadence } from '../../eam/lib/sapCycles';

// -- Files in, sheets out ---------------------------------------------------

export interface CockpitFile {
    /** File name, ideally with the folder it came in — that is what names the object. */
    name: string;
    text: string;
}

export interface CockpitSheetRead extends CockpitSheet {
    object: CockpitObjectKey;
    /** The name as given, for reporting. */
    file: string;
}

export interface CockpitIssue {
    level: 'error' | 'warn' | 'info';
    message: string;
    /** How many rows it touches, when it is a per-row condition. */
    count?: number;
}

class Issues {
    private map = new Map<string, CockpitIssue>();
    add(level: CockpitIssue['level'], message: string, countable = true) {
        const k = `${level}|${message}`;
        const cur = this.map.get(k);
        if (cur) { if (countable) cur.count = (cur.count ?? 1) + 1; return; }
        this.map.set(k, { level, message, ...(countable ? { count: 1 } : {}) });
    }
    list(): CockpitIssue[] {
        const order = { error: 0, warn: 1, info: 2 };
        return [...this.map.values()].sort((a, b) => order[a.level] - order[b.level]);
    }
}

/**
 * Which object a file belongs to. The folder decides it ("Source data for
 * PM - Maintenance item/S_OBJ_LIST#FreeText.csv"), because a structure name
 * alone cannot: the item and the plan both have an S_OBJ_LIST, with
 * different keys. A bare file name is only safe when exactly one object
 * claims that structure.
 */
export function objectOfFile(fileName: string): { object: CockpitObjectKey | null; ambiguous: boolean } {
    const named = parseCockpitFileName(fileName);
    if (!named) return { object: null, ambiguous: false };
    const path = fileName.replace(/\\/g, '/');
    for (const o of COCKPIT_OBJECTS) {
        if (path.includes(cockpitFolderName(o.name)) && structureSpec(o.key, named.structure)) {
            return { object: o.key, ambiguous: false };
        }
    }
    const matches = findStructures(named.structure);
    if (matches.length === 1) return { object: matches[0].object, ambiguous: false };
    return { object: null, ambiguous: matches.length > 1 };
}

/**
 * One maintenance package of a strategy, with its cycle.
 *
 * This is the one thing the five PM migration objects do NOT carry. SAP's own
 * documentation for PM - Maintenance plan lists "cycle information for
 * strategy plans" as out of scope — "this is taken from the Maintenance
 * Strategy object" — and there is no migration object for strategies: they
 * are configuration (IP11), created on the target before plans are loaded.
 * So a strategy plan's cadence has to come from the SOURCE system's strategy
 * configuration, as a file of its own alongside the cockpit downloads.
 */
export interface StrategyPackage {
    strat: string;
    /** PAKET (as displayed) or ZAEHL (as stored in T351P) — the package number. */
    paket: string;
    cadence: Cadence | null;
    /** Package short text, when the file carries it (T351X.KTEX1). */
    text: string;
    /** Where the cycle came from — a display value, raw seconds, or the text. */
    from: 'cycle' | 'seconds' | 'text' | 'none';
}

export interface CockpitSet {
    sheets: CockpitSheetRead[];
    /** Strategy packages from a sidecar file (IP11 / T351P export), if one came with the set. */
    strategyPackages: StrategyPackage[];
    issues: CockpitIssue[];
}

/**
 * A file of strategy packages, recognised by its columns rather than its
 * name: STRAT and ZEIEH, a package number (PAKET as IP11 shows it, ZAEHL as
 * table T351P stores it) and a cycle (ZYKL1 as displayed, ZYKZT as T351P
 * stores it — a float in SECONDS). Any export of the strategy from the source
 * system fits, whatever it was called.
 */
export function isStrategyPackageFile(columns: string[]): boolean {
    const c = new Set(columns.map(x => x.trim().toUpperCase()));
    return c.has('STRAT') && c.has('ZEIEH')
        && (c.has('PAKET') || c.has('ZAEHL'))
        && (c.has('ZYKL1') || c.has('ZYKZT') || c.has('KTEX1'));
}

const SECONDS_PER_DAY = 86400;

/** One package row -> its cadence, and where that cadence came from. */
export function strategyPackageOf(r: Record<string, string>): StrategyPackage | null {
    const strat = (r.STRAT ?? '').trim();
    const paket = (r.PAKET ?? r.ZAEHL ?? '').trim().replace(/^0+(?=\d)/, '');
    if (!strat || !paket) return null;
    const text = (r.KTEX1 ?? '').trim();

    // As IP11 displays it: "1" + "MON".
    const shown = parseSapCycle(r.ZYKL1, r.ZEIEH);
    if (shown) return { strat, paket, cadence: shown, text, from: 'cycle' };

    // As T351P stores it: a float in seconds. Expressed in DAYS, exactly,
    // rather than converted to a month or a year with a constant this module
    // would have to assume — 30 days is not "1 month" in SAP's own arithmetic
    // and a wrong constant would drift every schedule by days per year.
    const secs = Number(String(r.ZYKZT ?? '').replace(',', '.'));
    if (Number.isFinite(secs) && secs > 0) {
        const days = secs / SECONDS_PER_DAY;
        return { strat, paket, cadence: { interval: Math.round(days), unit: 'Days' }, text, from: 'seconds' };
    }

    // As the package text says it: "12 MONTH/ 1 YEAR".
    const fromText = parseSapCycleText(text);
    if (fromText) return { strat, paket, cadence: fromText, text, from: 'text' };

    return { strat, paket, cadence: null, text, from: 'none' };
}

/** Read a downloaded set — the CSVs of one or more objects — into sheets. */
export function readCockpitSet(files: CockpitFile[]): CockpitSet {
    const issues = new Issues();
    const sheets: CockpitSheetRead[] = [];
    const strategyPackages: StrategyPackage[] = [];
    for (const f of files) {
        const named = parseCockpitFileName(f.name);
        const { object, ambiguous } = objectOfFile(f.name);
        if (!named || !object) {
            // Not a cockpit structure — but it may be the strategy export the
            // cockpit cannot provide, in which case it is the most valuable
            // file in the set.
            const probe = /\.csv$/i.test(f.name) ? parseCsv(f.text) : [];
            if (probe.length > 0 && isStrategyPackageFile(probe[0])) {
                const cols = probe[0].map(c => c.trim().toUpperCase());
                let unreadable = 0;
                for (const row of probe.slice(1)) {
                    if (!row.some(c => c.trim())) continue;
                    const rec: Record<string, string> = {};
                    cols.forEach((c, i) => { rec[c] = (row[i] ?? '').trim(); });
                    const pkg = strategyPackageOf(rec);
                    if (!pkg) continue;
                    if (!pkg.cadence) unreadable += 1;
                    strategyPackages.push(pkg);
                }
                issues.add('info', `${strategyPackages.length} strategy package(s) read from ${f.name.split(/[\\/]/).pop()} — the cycles the cockpit download cannot carry`, false);
                if (unreadable) issues.add('warn', `${unreadable} strategy package(s) carry no readable cycle (no ZYKL1/ZEIEH, no ZYKZT, no cycle in KTEX1) — steps in those packages import with no cadence`, false);
                continue;
            }
            issues.add('warn', ambiguous
                ? `${named?.structure} belongs to more than one migration object — keep the file in its "Source data for ..." folder so it can be told apart; skipped`
                : `${f.name} is not a migration-cockpit source file — skipped`, false);
            continue;
        }
        const sheet = parseCockpitCsv(f.text, f.name);
        const spec = structureSpec(object, named.structure)!;
        if (sheet.columns.map(c => c.name).join(',') !== spec.header.split(',').map(h => h.replace(/\(.*\)$/, '')).join(',')) {
            issues.add('info', `${named.structure} has a different field list from the template on record — mapped on field name, extra fields ignored`, false);
        }
        // SAP declares its own key and mandatory fields in the header, so this
        // check needs no catalogue and works on every structure, including the
        // ones no mapping has been written for yet.
        const gaps = missingMandatory(sheet);
        for (const g of new Set(gaps.map(x => x.field))) {
            const n = gaps.filter(x => x.field === g).length;
            issues.add('warn', `${named.structure}.${g} is ${gaps.find(x => x.field === g)!.key ? 'a key field' : 'mandatory'} and is blank on ${n} row(s) — SAP will reject them`, false);
        }

        sheets.push({ ...sheet, object, file: f.name });
    }
    return { sheets, strategyPackages, issues: issues.list() };
}

// -- Values -----------------------------------------------------------------

/** DD.MM.YYYY (SAP) or YYYY-MM-DD (already ISO) -> YYYY-MM-DD. Blank if neither. */
export function fromSapDate(v: string): string {
    const s = (v ?? '').trim();
    const dmy = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s);
    if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(s);       // SAP also writes YYYYMMDD
    return compact ? `${compact[1]}-${compact[2]}-${compact[3]}` : '';
}

/** HH:MM:SS / HH:MM -> HH:MM:SS. Blank stays blank. */
export function fromSapTime(v: string): string {
    const s = (v ?? '').trim();
    if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return '';
    const parts = s.split(':');
    while (parts.length < 3) parts.push('00');
    return parts.map(p => p.padStart(2, '0')).join(':');
}

/**
 * A number as SAP may have written it. "4,2" is four point two — a decimal
 * comma, which every European SAP user has. Exactly three digits after the
 * comma is the one ambiguous case ("1,234" is as likely a thousand as it is
 * 1.234), and that is left alone rather than guessed at: it then fails as
 * non-numeric and the row is reported, which is the safe way to be wrong.
 */
export function fromSapNumber(v: string): string {
    const s = (v ?? '').trim();
    if (!/^-?\d+,\d+$/.test(s)) return s;
    return /^-?\d+,\d{3}$/.test(s) ? s : s.replace(',', '.');
}

/** True for a value this module refuses to read as a number, on purpose. */
export const isAmbiguousNumber = (v: string): boolean => /^-?\d+,\d{3}$/.test((v ?? '').trim());

/**
 * Leading zeros off an all-digit key. SAP pads internal numbers ("EQUNR
 * 000000000010004711", measuring point "000000090000001") and pads them
 * differently in different files, so the same object can appear padded on one
 * sheet and bare on another. Anything that is not all digits — a real tag, an
 * external key — is left exactly as it is.
 */
const unpad = (raw: string): string => {
    const s = (raw ?? '').trim();
    // The lookahead keeps the last digit: "0" stays "0", never "".
    return /^0*\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '') : s;
};

/**
 * The tag to look an asset up by. IREAMS stores the equipment number unpadded
 * and resolves a tag OR an equipment number.
 */
export const assetTagOf = (raw: string): string => unpad(raw);

/**
 * A measuring-point number, as both files must agree on it. The point file
 * and the document file are separate downloads and need not pad alike, so
 * both sides are unpadded before they are matched.
 */
export const pointKeyOf = (raw: string): string => unpad(raw);

/**
 * SAP unit keys that would read as nonsense on a Readings tab. Anything not
 * listed passes through untouched. Mirrors assetTemplates' SAP_UNIT_MAP so
 * the two import routes name a unit the same way.
 */
const SAP_UNITS: Record<string, string> = { MMS: 'mm/s', GC: '°C', HRS: 'h', H: 'h', KMH: 'km/h', KPA: 'kPa', BAR: 'bar' };

export function unitOf(raw: string): string {
    const u = (raw ?? '').trim();
    return u ? SAP_UNITS[u.toUpperCase()] ?? u : '';
}

/** MP_VIBRATION -> VIBRATION, ZMP_TEMPERATURE -> TEMPERATURE. */
export function readingTypeOf(atnam: string): string {
    return (atnam ?? '').trim().toUpperCase().replace(/^[A-Z0-9]{1,3}_(?:MP_)?/, '').replace(/^MP_/, '');
}

// -- Points and documents ---------------------------------------------------

export interface PointRef {
    /** MEAS_POINT — the key a measurement document refers to. */
    point: string;
    assetTag: string;
    readingType: string;
    pointName: string;
    isCounter: boolean;
}

export interface ReadingImport {
    /** Canonical IREAMS import rows — definition rows first, then readings. */
    rows: Record<string, string>[];
    issues: CockpitIssue[];
    points: Map<string, PointRef>;
    /** Rows that could not be mapped at all. */
    skipped: number;
}

const sheetOf = (set: CockpitSet, object: CockpitObjectKey, structure: string): CockpitSheetRead | undefined =>
    set.sheets.find(s => s.object === object && s.structure === structure);

/**
 * Measuring points and measurement documents -> reading rows.
 *
 * A point row carries no date and no value, which is how importReadings
 * tells "create the point" from "record a reading".
 */
export function toReadingRows(set: CockpitSet): ReadingImport {
    const issues = new Issues();
    const rows: Record<string, string>[] = [];
    const points = new Map<string, PointRef>();
    let skipped = 0;

    const pointSheet = sheetOf(set, 'measuringPoint', 'S_HEADER');
    const docSheet = sheetOf(set, 'measurementDocument', 'S_MEASUREMENT_DOCU');

    // -- points
    for (const r of pointSheet?.rows ?? []) {
        const objNo = r.OBJECT_KEY_EXTERN?.trim() || r.MEAS_POINT_OBJ_NO?.trim() || '';
        const assetTag = assetTagOf(objNo);
        const readingType = r.ATNAM ? readingTypeOf(r.ATNAM)
            : (r.PSORT && isNaN(Number(r.PSORT)) ? r.PSORT.trim().toUpperCase() : '');
        const key = pointKeyOf(r.MEAS_POINT ?? '');

        if (!assetTag) {
            issues.add('error', 'measuring point(s) name no object — OBJECT_KEY_EXTERN and MEAS_POINT_OBJ_NO are both blank; skipped');
            skipped += 1;
            continue;
        }
        if (!readingType) {
            issues.add('error', `measuring point(s) give no characteristic (ATNAM) and no usable sort field (PSORT), so IREAMS cannot tell what is being measured; skipped`);
            skipped += 1;
            continue;
        }
        const type = (r.OBJECT_TYPE || '').trim().toUpperCase();
        if (type && type !== 'IEQ' && type !== 'IFL') {
            issues.add('warn', `OBJECT_TYPE "${type}" is neither equipment (IEQ) nor functional location (IFL) — the point is matched on the object key alone`);
        }

        const ref: PointRef = {
            point: key,
            assetTag,
            readingType,
            pointName: (r.PTTXT || '').trim(),
            isCounter: /^x$/i.test((r.IS_COUNTER || '').trim()),
        };
        if (!key) {
            // The row still makes a reading point, but no document can reach
            // it: MEAS_POINT is what a document refers to.
            issues.add('warn', 'measuring point(s) have a blank MEAS_POINT — SAP declares it key and mandatory, and no measurement document can be matched to them');
        } else if (points.has(key)) {
            issues.add('warn', `measuring point number(s) appear more than once — the later row wins, and any document naming one may land on the wrong point (first seen: ${points.get(key)!.pointName || points.get(key)!.readingType})`);
        }
        if (key) points.set(key, ref);

        const row: Record<string, string> = { assettag: assetTag, readingtype: readingType };
        if (ref.pointName) row.pointname = ref.pointName;
        if (ref.isCounter) row.counter = 'X';
        // SAP's number for the point (0382): what the export names it by, so
        // SAP never gets the same point created twice.
        if (key) { row.sourceref = key; row.sourcesystem = 'sap_pm'; }
        // MRNGU only appears in the FreeText (all fields) download; the
        // mandatory subset has no unit at all.
        const unit = unitOf(r.MRNGU || r.MSEHI || '');
        if (unit) row.unit = unit;
        rows.push(row);

        if (r.MRMIC?.trim() || r.MRMAC?.trim()) {
            issues.add('info', 'MRMIC / MRMAC on a point are SAP’s measurement RANGE — the values a reading may take, not an alarm band. They are NOT imported as warning limits; set alarm limits on the Readings tab.');
        }
        if (r.CODGR?.trim()) {
            issues.add('info', `valuation codes on these points come from catalogue code group ${r.CODGR.trim()} — map them to IREAMS findings before the documents mean anything`);
        }
    }

    if (pointSheet && !rows.some(r => r.unit)) {
        issues.add('warn', 'No unit on any measuring point — the mandatory template has no unit column at all, because SAP takes it from the characteristic. Points import without one; set the unit on each Readings point, or download the object in FreeText (all fields) mode, which carries MRNGU.', false);
    }

    // -- documents
    if (docSheet && !pointSheet) {
        issues.add('error', 'Measurement documents are in this set but the measuring points are not. A document names only its MEASUREMENT_POINT, never an asset, so nothing can say which equipment these readings belong to — add "Source data for PM - Measuring point" and import them together.', false);
        skipped += docSheet.rows.length;
        return { rows, issues: issues.list(), points, skipped };
    }

    const seenDocs = new Set<string>();
    for (const r of docSheet?.rows ?? []) {
        const docId = (r.MEASUREMENT_DOCUMENT || '').trim();
        if (docId) {
            if (seenDocs.has(docId)) {
                issues.add('warn', 'measurement document number(s) appear more than once in this file — each occurrence is imported as its own reading');
            }
            seenDocs.add(docId);
        }
        const ref = points.get(pointKeyOf(r.MEASUREMENT_POINT ?? ''));
        if (!ref) {
            issues.add('error', `measurement document(s) refer to a measuring point that is not in this set — the asset cannot be known; skipped`);
            skipped += 1;
            continue;
        }
        const date = fromSapDate(r.READING_DATE || '');
        const value = fromSapNumber(r.READING || '');
        if (!date) { issues.add('error', 'measurement document(s) have no readable READING_DATE; skipped'); skipped += 1; continue; }
        if (isAmbiguousNumber(r.READING || '')) {
            issues.add('error', `READING "${(r.READING || '').trim()}" could be a decimal comma or a thousands separator — IREAMS will not guess which, and a wrong guess moves the reading by a factor of a thousand. Re-export with a decimal point; skipped`);
            skipped += 1;
            continue;
        }
        if (value === '' || isNaN(Number(value))) { issues.add('error', 'measurement document(s) have no numeric READING; skipped'); skipped += 1; continue; }

        const row: Record<string, string> = {
            assettag: ref.assetTag,
            readingtype: ref.readingType,
            date,
            value,
        };
        if (ref.pointName) row.pointname = ref.pointName;
        const time = fromSapTime(r.READING_TIME || '');
        if (time) row.time = time;
        const delta = fromSapNumber(r.DIFFERENCE_READING || '');
        if (delta !== '' && !isNaN(Number(delta))) row.delta = delta;
        const notes = (r.SHORT_TEXT || '').trim() || (r.LONG_TEXT || '').trim();
        if (notes) row.notes = notes;
        if (r.READ_BY?.trim()) row.enteredby = r.READ_BY.trim();
        if (r.VALUATION_CODE?.trim()) row.valuationcode = r.VALUATION_CODE.trim();
        // SAP's own id for this reading, carried through so importing the same
        // export twice inserts nothing the second time (0381).
        if (docId) { row.sourceref = docId; row.sourcesystem = 'sap_pm'; }
        rows.push(row);

        if (/^x$/i.test((r.READING_AFTER_ACTION || '').trim())) {
            issues.add('info', 'reading(s) were taken after a counter was reset or replaced (READING_AFTER_ACTION) — in IREAMS that is a meter change, which supersedes earlier readings; check the affected points after import');
        }
    }

    // Each reading carries SAP's document number, which is what makes a repeat
    // import a no-op (0381). A document with no number has nothing to key on,
    // so those — and only those — can be imported twice.
    const readings = rows.filter(r => r.value);
    const unguarded = readings.filter(r => !r.sourceref).length;
    if (unguarded > 0) {
        issues.add('warn', `${unguarded} reading(s) carry no MEASUREMENT_DOCUMENT number. Every other reading here is keyed on its SAP document and cannot be imported twice; these have nothing to key on, so importing this file again would duplicate them.`, false);
    } else if (readings.length) {
        issues.add('info', 'Each reading is keyed on its SAP measurement-document number — importing this download again inserts nothing.', false);
    }

    // -- everything else in the set
    for (const s of set.sheets) {
        if (s.object === 'measuringPoint' || s.object === 'measurementDocument') continue;
        if (s.rows.length) {
            issues.add('info', `${s.structure} holds ${s.rows.length} row(s) of maintenance strategy — not part of the condition-history import`, false);
        }
    }

    return { rows, issues: issues.list(), points, skipped };
}
