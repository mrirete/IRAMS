/**
 * SAP S/4HANA Migration Cockpit — the staging-table dialect.
 *
 * The cockpit's "Download source data" hands back one ZIP per migration
 * object, holding a README and one CSV per staging STRUCTURE:
 *
 *     Source data for PM - Maintenance plan.zip
 *       - S_MPLA#FreeText_Mandatory.csv      <- plan header
 *       - S_MPOS#FreeText_Mandatory.csv      <- maintenance items
 *       - S_OBJ_LIST#FreeText.csv            <- the item's object list
 *
 * This is the THIRD SAP shape IREAMS reads, and the only one SAP itself
 * writes. The other two are consultant workbooks: the E82 cockpit workbook
 * (SAP field names on row 4, descriptions on row 5) and the PM load files
 * (labels down column A, a row labelled "Field" carrying the field names).
 * Both of those were somebody's transcription of this one. Three things here
 * are genuinely different, and each breaks a parser written for the others:
 *
 *  1. The header carries ANNOTATIONS — "WARPL(k/*)" is the field WARPL, part
 *     of the key, mandatory. Matching a header list against "warpl" fails.
 *  2. Field names are not always the ABAP ones. The maintenance item's number
 *     is WPPOS here and WAPOS in the load files; measurement documents use
 *     readable English (MEASUREMENT_POINT, READING_DATE) where the load files
 *     use MPOBJ and IDATE.
 *  3. The file name is the contract: <structure>#<mode>.csv. Mode is
 *     FreeText_Mandatory (the mandatory subset) or FreeText (every field).
 *     Opening one in Excel names the tab after the file and truncates at 31
 *     characters, which is why a measurement-document CSV shows on screen as
 *     the tab "S_MEASUREMENT_DOCU#FreeText_Man".
 *
 * Everything stays a STRING end to end. SAP keys are zero-padded (WARPL
 * "0000000123", EQUNR "000000000010004711") and dates are DD.MM.YYYY; handing
 * these to a spreadsheet reader silently eats the zeros and reinterprets the
 * dates, so this module never goes near one.
 */

// -- Columns ----------------------------------------------------------------

export interface CockpitColumn {
    /** Field name, annotation stripped — "WARPL". */
    name: string;
    /** Part of the structure's key. */
    key: boolean;
    /** Mandatory for the load. */
    mandatory: boolean;
    /** The header cell exactly as SAP wrote it — "WARPL(k/*)". */
    raw: string;
}

/** "WARPL(k/*)" -> key + mandatory. "MPTYP(*)" -> mandatory. "STRAT" -> neither. */
export function parseCockpitColumn(raw: string): CockpitColumn {
    const cell = raw.trim();
    const m = /^(.*?)\(([^()]*)\)$/.exec(cell);
    if (!m) return { name: cell, key: false, mandatory: false, raw: cell };
    const flags = m[2].split('/').map(f => f.trim().toLowerCase());
    return {
        name: m[1].trim(),
        key: flags.includes('k'),
        mandatory: flags.includes('*'),
        raw: cell,
    };
}

/** The header cell for a column — the annotation goes back exactly as it came. */
export const renderCockpitColumn = (c: CockpitColumn): string =>
    c.raw || c.name + (c.key && c.mandatory ? '(k/*)' : c.key ? '(k)' : c.mandatory ? '(*)' : '');

// -- File names -------------------------------------------------------------

export interface CockpitFileName {
    /** Staging structure — "S_MPLA". */
    structure: string;
    /** "FreeText_Mandatory" (mandatory fields only) or "FreeText" (all of them). */
    mode: string;
}

/** "S_MPLA#FreeText_Mandatory.csv" -> { structure, mode }. */
export function parseCockpitFileName(fileName: string): CockpitFileName | null {
    const base = fileName.split(/[\\/]/).pop() ?? '';
    const stem = base.replace(/\.csv$/i, '');
    if (!stem) return null;
    const hash = stem.indexOf('#');
    return hash < 0
        ? { structure: stem, mode: '' }
        : { structure: stem.slice(0, hash), mode: stem.slice(hash + 1) };
}

export const cockpitFileName = (structure: string, mode: string): string =>
    `${structure}${mode ? `#${mode}` : ''}.csv`;

/**
 * What Excel calls the tab when one of these CSVs is opened — the file stem,
 * cut to the 31-character sheet-name limit. Worth having: it is how the file
 * names itself on screen, so a tab a user is looking at can be matched back
 * to the structure it came from.
 */
export const excelSheetName = (structure: string, mode: string): string =>
    `${structure}${mode ? `#${mode}` : ''}`.slice(0, 31);

/** The folder (and ZIP) the cockpit puts an object's CSVs in. */
export const cockpitFolderName = (objectName: string): string => `Source data for ${objectName}`;

// -- CSV, kept as text ------------------------------------------------------

/** RFC 4180, every cell a string. Tolerates CRLF, LF and a UTF-8 BOM. */
export function parseCsv(text: string): string[][] {
    // 0xFEFF is the byte-order mark. Tested by code point rather than written
    // into a regex: as a literal it is invisible in source and easily lost.
    const s = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < s.length; i += 1) {
        const c = s[i];
        if (quoted) {
            if (c !== '"') { cell += c; continue; }
            if (s[i + 1] === '"') { cell += '"'; i += 1; continue; }
            quoted = false;
            continue;
        }
        if (c === '"' && cell === '') { quoted = true; continue; }
        if (c === ',') { row.push(cell); cell = ''; continue; }
        if (c === '\r') continue;
        if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
        cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
}

const csvCell = (v: string): string =>
    /[",\r\n]/.test(v) || v !== v.trim() ? `"${v.replace(/"/g, '""')}"` : v;

/** CRLF, per RFC 4180 — what Excel and the cockpit's own upload both expect. */
export const renderCsv = (rows: string[][]): string =>
    rows.map(r => r.map(csvCell).join(',')).join('\r\n');

// -- Sheets -----------------------------------------------------------------

export interface CockpitSheet {
    structure: string;
    mode: string;
    columns: CockpitColumn[];
    /** One entry per data row, keyed by field name (annotation stripped). */
    rows: Record<string, string>[];
}

/**
 * A downloaded template is a header and nothing else; a filled one has rows
 * under it. Both parse. Short rows fill blank, long rows keep only the cells
 * the header names.
 */
export function parseCockpitCsv(text: string, fileName = ''): CockpitSheet {
    const grid = parseCsv(text);
    const columns = (grid[0] ?? []).map(parseCockpitColumn).filter(c => c.name);
    const named = parseCockpitFileName(fileName);
    const rows = grid.slice(1)
        .filter(r => r.some(c => c.trim() !== ''))
        .map(r => {
            const row: Record<string, string> = {};
            columns.forEach((c, i) => { row[c.name] = (r[i] ?? '').trim(); });
            return row;
        });
    return { structure: named?.structure ?? '', mode: named?.mode ?? '', columns, rows };
}

export const renderCockpitCsv = (sheet: Pick<CockpitSheet, 'columns' | 'rows'>): string =>
    renderCsv([
        sheet.columns.map(renderCockpitColumn),
        ...sheet.rows.map(r => sheet.columns.map(c => r[c.name] ?? '')),
    ]);

// -- What the header itself tells us ----------------------------------------

export interface CockpitGap {
    /** Spreadsheet row number — the header is row 1, so data starts at 2. */
    row: number;
    field: string;
    key: boolean;
}

/**
 * Blank cells in fields SAP declared key or mandatory. The declaration is in
 * the header, so this needs no catalogue and no release-specific knowledge:
 * it is the cheapest check that a file we emit will load at all.
 */
export function missingMandatory(sheet: Pick<CockpitSheet, 'columns' | 'rows'>): CockpitGap[] {
    const required = sheet.columns.filter(c => c.key || c.mandatory);
    const gaps: CockpitGap[] = [];
    sheet.rows.forEach((r, i) => {
        for (const c of required) {
            if (!(r[c.name] ?? '').trim()) gaps.push({ row: i + 2, field: c.name, key: c.key });
        }
    });
    return gaps;
}
