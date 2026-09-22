/**
 * Readiness, for people.
 *
 * The builders report in SAP's terms — "S_HEADER.PTTXT longer than SAP's 40
 * characters" — because that is the exact truth and a consultant needs it. A
 * planner reading a page needs the same facts in a different order: what
 * blocks the load, what to glance at, what is merely useful to know; each with
 * a plain name first and the SAP code second; and nine near-identical
 * "longer than" lines folded into one.
 *
 * This is a pure view over the issues. It changes no message the builders
 * make and drops nothing: every issue lands in exactly one group, and the
 * folded ones keep their detail.
 */

export interface RawIssue {
    level: 'error' | 'warn' | 'info';
    message: string;
    count?: number;
    /** The E82 builder's per-object tag; the cockpit builder puts the structure in the message instead. */
    object?: string;
}

export interface ViewItem {
    level: 'error' | 'warn' | 'info';
    /** Plain-English headline. */
    title: string;
    /** What to do about it, when there is something to do. */
    action?: string;
    /** SAP field or structure, shown as a small tag. */
    code?: string;
    rows?: number;
    /** Folded detail lines (one per field), for the "longer than" group. */
    details?: string[];
}

export interface ReadinessView {
    mustFix: ViewItem[];
    check: ViewItem[];
    notes: ViewItem[];
    /** A one-line verdict for the top of the page. */
    verdict: 'ready' | 'attention' | 'blocked' | 'empty';
}

/** SAP field codes -> what a planner calls them. Unknown codes fall back to the code. */
export const FIELD_LABELS: Record<string, string> = {
    PTTXT: 'Point description', ATNAM: 'Characteristic name', MRNGU: 'Unit', MEASUREMENT_POINT_TYPE: 'Measuring-point category',
    MEAS_POINT_OBJ_NO: 'Object number', SHORT_TEXT: 'Short text', KTEXT: 'Task list description', LTXA1: 'Step description',
    WARPL: 'Plan number', WPTXT: 'Plan description', PSTXT: 'Item description', MI_TEXT: 'Item text', WAPOS: 'Item number',
    PLNNR: 'Task list group', IWERK: 'Planning plant', WERKS: 'Plant', EQUNR: 'Equipment number', TPLNR: 'Functional location',
    PLTXT: 'Location description', EQART: 'Equipment type', EQKTX: 'Equipment description', MATNR: 'Material number',
    MAKTX: 'Material description', MEINS: 'Unit of measure', LGORT: 'Storage location', LIFNR: 'Vendor number',
    D_CODE: 'Damage code', CAUSE_CODE: 'Cause code', ACT_CODE: 'Activity code', DL_CODE: 'Object-part code',
    CODGR: 'Catalogue code group', POTX1: 'BOM item text', ABLES: 'Read by',
};

export const label = (code: string): string => FIELD_LABELS[code] ?? code;

const OBJECT_LABELS: Record<string, string> = {
    functionalLocation: 'Functional locations', equipment: 'Equipment', material: 'Materials', equipmentBom: 'Equipment BOMs',
    measuringPoint: 'Measuring points', measurementDoc: 'Measurement documents', sourceList: 'Source lists',
    inventoryBalance: 'Opening stock', orderHistory: 'Order history (hand-over)', openNotification: 'Open work at cutover', general: '',
    S_HEADER: 'Measuring points', S_MEASUREMENT_DOCU: 'Measurement documents', S_TASKLIST_HDR: 'Task lists', S_OPERATIONS: 'Task-list steps',
    S_COMPONENTS: 'Planned parts', S_MPACK: 'Strategy packages', S_MPLA: 'Maintenance plans', S_MPOS: 'Maintenance items',
    S_OBJ_LIST: 'Object lists', S_ITEM: 'Maintenance items',
};

const CLIP = /^(?:(S_[A-Z_]+)\.)?([A-Z_]+) longer than SAP's (\d+) characters — clipped;(.*)$/;
const BLANK = /^(?:(S_[A-Z_]+)\.)?([A-Z_]+) is (a key field|mandatory) and is blank(?: on (\d+) row\(s\))? — SAP will reject/;

/** Fold raw issues into the three groups a person acts on. */
export function readinessView(issues: RawIssue[], totalRows: number): ReadinessView {
    const mustFix: ViewItem[] = [];
    const check: ViewItem[] = [];
    const notes: ViewItem[] = [];

    // "Longer than" lines fold into one item per level, with a line per field.
    const clips: { level: RawIssue['level']; details: string[]; rows: number; catalog: boolean }[] = [];
    const clipFor = (level: RawIssue['level'], catalog: boolean) => {
        let c = clips.find(x => x.level === level && x.catalog === catalog);
        if (!c) { c = { level, details: [], rows: 0, catalog }; clips.push(c); }
        return c;
    };

    for (const i of issues) {
        const clip = CLIP.exec(i.message);
        if (clip) {
            const [, structure, field, max, rest] = clip;
            const catalog = /catalog codes in QS41/.test(rest);
            const where = OBJECT_LABELS[structure ?? i.object ?? ''] || '';
            const c = clipFor(i.level, catalog);
            c.details.push(`${label(field)} (${field})${where ? ` on ${where.toLowerCase()}` : ''}: over ${max} characters${i.count ? `, ${i.count} row(s)` : ''}`);
            c.rows += i.count ?? 1;
            continue;
        }
        const blank = BLANK.exec(i.message);
        if (blank) {
            const [, structure, field, kind, rows] = blank;
            const where = OBJECT_LABELS[structure ?? ''] || '';
            mustFix.push({
                level: 'error',
                title: `${label(field)} is missing${where ? ` on ${where.toLowerCase()}` : ''} — SAP will reject those rows`,
                action: kind === 'a key field' ? 'Every row needs it; it is how SAP tells the rows apart.' : 'Fill it in IREAMS, or set it in the cockpit’s value mapping before loading.',
                code: field,
                rows: rows ? Number(rows) : i.count,
            });
            continue;
        }
        const item: ViewItem = { level: i.level, title: i.message, rows: i.count, code: i.object && i.object !== 'general' ? OBJECT_LABELS[i.object] ?? i.object : undefined };
        (i.level === 'error' ? mustFix : i.level === 'warn' ? check : notes).push(item);
    }

    for (const c of clips) {
        const item: ViewItem = c.catalog
            ? {
                level: c.level,
                title: 'Catalogue codes are longer than SAP’s 4 characters — they will be cut short',
                action: 'Define 4-character codes in QS41 and map the IREAMS codes to them in the cockpit’s value mapping; the full codes are on the order-history sheet.',
                rows: c.rows, details: c.details,
            }
            : {
                level: c.level,
                title: 'Some text is longer than SAP allows — it will be shortened',
                action: 'Check that the shortened descriptions still read sensibly, or shorten them in IREAMS first.',
                rows: c.rows, details: c.details,
            };
        (c.level === 'error' ? mustFix : c.level === 'warn' ? check : notes).push(item);
    }

    const verdict: ReadinessView['verdict'] = totalRows === 0 ? 'empty' : mustFix.length ? 'blocked' : check.length ? 'attention' : 'ready';
    return { mustFix, check, notes, verdict };
}
