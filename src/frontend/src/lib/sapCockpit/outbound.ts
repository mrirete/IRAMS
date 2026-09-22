/**
 * IREAMS -> SAP Migration Cockpit source data, in the cockpit's own shape.
 *
 * Slice 3: the way back. After a reliability study has changed what the plant
 * should do, this writes the cockpit's staging structures — the same files,
 * headers verbatim from the registry, the same "Source data for ..." folders —
 * so the ZIP drops straight into the cockpit's upload with nothing reshaped.
 *
 * DELTA BY IDENTITY. The Migration Cockpit CREATES; it does not update. So
 * what goes into the load files is what SAP does not yet have, and what SAP
 * already has is handled by its identity:
 *
 *   - a point, a reading or a schedule that came FROM SAP carries SAP's own id
 *     (source_system / source_ref on points and readings, origin.plan / item /
 *     task_list on schedules). In delta mode those are not loaded again — a
 *     second load would duplicate the plant's data — and a schedule IREAMS
 *     changed is written instead to a hand-over sheet with its SAP keys, for
 *     the planner to apply (IP02 / IA06) or for the live link to carry.
 *   - everything without SAP identity is new to SAP and is loaded, keyed on
 *     IREAMS's own ids, which the cockpit's value mapping turns into SAP
 *     numbers on load.
 *
 * Full mode loads everything, for a plant moving to a NEW SAP system where
 * nothing exists yet.
 *
 * Readiness is driven by the header: every key and mandatory field SAP
 * declared is checked on every row, and clipping to SAP field lengths is
 * reported rather than done silently.
 */

import { renderCockpitCsv, cockpitFolderName, cockpitFileName, renderCsv, missingMandatory, type CockpitColumn } from './dialect';
import { COCKPIT_OBJECT_BY_KEY, columnsOf, structureSpec, type CockpitObjectKey, type CockpitStructureSpec } from './structures';
import type { CockpitIssue } from './inbound';
import type { SapLoadSource, SrcAsset, SrcSchedule, SrcReadingDefinition, SrcReadingLog } from '../sapLoad/build';
import { objectClassOf } from '../../eam/services/hierarchyModel';
import { addCadence, sapCycleUnit, isMeterUnit, type Cadence, type CadenceUnit } from '../../eam/lib/sapCycles';
import { toSapDate, toSapTime } from '../sapLoad/build';
import { SAP_ILART_MAP, SAP_PRIOK_MAP } from '../../eam/services/assetTemplates';

// ── Parameters ───────────────────────────────────────────────────────────────

export interface CockpitExportParams {
    /** delta = only what SAP does not have (default when anything carries SAP identity); full = everything. */
    mode: 'delta' | 'full';
    /** IWERK on every maintenance item. Mandatory in SAP. */
    planningPlant: string;
    /** WERKS on task lists and operations. */
    plant: string;
    /** AUART for items that generate orders. */
    orderType: string;
    /** legacy = EQUNR carries the IREAMS equipment number; internal = the tag is the legacy key. */
    numbering: 'legacy' | 'internal';
    /** The source system these files are for, written onto nothing — used only to decide what "came from SAP" means. */
    sourceSystem?: string;
}

export const defaultExportParams = (): CockpitExportParams => ({
    mode: 'delta', planningPlant: '', plant: '', orderType: 'PM01', numbering: 'legacy', sourceSystem: 'sap_pm',
});

// ── Result ───────────────────────────────────────────────────────────────────

export interface CockpitExportFile {
    object: CockpitObjectKey;
    structure: string;
    /** "Source data for PM - Maintenance plan" */
    folder: string;
    /** "S_MPLA#FreeText_Mandatory.csv" */
    fileName: string;
    text: string;
    rows: number;
}

export interface CockpitHandover {
    folder: string;
    fileName: string;
    text: string;
    rows: number;
}

export interface CockpitExport {
    files: CockpitExportFile[];
    /** Schedules SAP already has, that IREAMS may have changed — not loaded. */
    handover: CockpitHandover | null;
    issues: CockpitIssue[];
    /** Rows per object, for the page. */
    counts: Record<CockpitObjectKey, number>;
    /** What delta mode kept out because SAP has it. */
    alreadyInSap: { points: number; readings: number; schedules: number };
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

const s = (v: unknown): string => (v == null ? '' : String(v)).trim();

/** SAP field lengths worth enforcing on the load — the cockpit rejects longer values. */
const LENGTHS: Record<string, number> = {
    PTTXT: 40, SHORT_TEXT: 40, PSTXT: 40, WPTXT: 40, KTEXT: 40, LTXA1: 40, MI_TEXT: 40,
    PLNNR: 8, WARPL: 12, WAPOS: 16, ATNAM: 30, CODGR: 8,
};

/** IREAMS cadence unit -> SAP time unit key. Meters have no time unit. */
const SAP_UNIT: Record<CadenceUnit, string> = { Days: 'TAG', Weeks: 'WCH', Months: 'MON', Years: 'JHR', Hours: 'H', KM: 'KM', Cycles: '' };

/**
 * Inverse of a code map, keeping the FIRST SAP code for a value. Two ILART
 * codes both mean PM (002 and 004); the vanilla one is 002, and a naive
 * inverse would pick whichever came last.
 */
const invert = (m: Record<string, string>): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [code, meaning] of Object.entries(m)) if (!(meaning in out)) out[meaning] = code;
    return out;
};
const ILART_OF = invert(SAP_ILART_MAP);
const PRIOK_OF = invert(SAP_PRIOK_MAP);

/** A sheet under construction: rows by field name, rendered against the registry header. */
class Sheet {
    readonly columns: CockpitColumn[];
    readonly rows: Record<string, string>[] = [];
    constructor(readonly object: CockpitObjectKey, readonly spec: CockpitStructureSpec, private issues: Issues) {
        this.columns = columnsOf(spec);
    }
    /** Add a row, clipping to SAP lengths and reporting every clip once per field. */
    add(row: Record<string, string>) {
        const out: Record<string, string> = {};
        for (const c of this.columns) {
            let v = s(row[c.name]);
            const max = LENGTHS[c.name];
            if (max && v.length > max) {
                this.issues.add('warn', `${this.spec.structure}.${c.name} longer than SAP's ${max} characters — clipped; check the clipped values read sensibly`);
                v = v.slice(0, max);
            }
            out[c.name] = v;
        }
        this.rows.push(out);
    }
    file(): CockpitExportFile | null {
        if (this.rows.length === 0) return null;
        for (const g of missingMandatory(this)) {
            this.issues.add('error', `${this.spec.structure}.${g.field} is ${g.key ? 'a key field' : 'mandatory'} and is blank — SAP will reject the row`);
        }
        return {
            object: this.object,
            structure: this.spec.structure,
            folder: cockpitFolderName(COCKPIT_OBJECT_BY_KEY[this.object].name),
            fileName: cockpitFileName(this.spec.structure, this.spec.mode),
            text: renderCockpitCsv(this),
            rows: this.rows.length,
        };
    }
}

// ── The build ────────────────────────────────────────────────────────────────

export function buildCockpitExport(src: SapLoadSource, params: CockpitExportParams): CockpitExport {
    const issues = new Issues();
    const fromSap = (sys: string | null | undefined) => !!sys && sys === (params.sourceSystem || 'sap_pm');
    const delta = params.mode === 'delta';
    const alreadyInSap = { points: 0, readings: 0, schedules: 0 };

    const sheet = (object: CockpitObjectKey, structure: string) => new Sheet(object, structureSpec(object, structure)!, issues);

    // Assets by id, with their SAP reference and object type.
    const assetById = new Map(src.assets.map(a => [a.id, a]));
    const objectOf = (a: SrcAsset | undefined): { type: 'IEQ' | 'IFL' | ''; ref: string } => {
        if (!a) return { type: '', ref: '' };
        const cls = objectClassOf(a);
        if (cls === 'FLOC') return { type: 'IFL', ref: s(a.tag) };
        if (cls === 'EQUIPMENT') return { type: 'IEQ', ref: params.numbering === 'legacy' ? (s(a.equipment_number) || s(a.tag)) : s(a.tag) };
        return { type: '', ref: '' };
    };
    const workCentreCode = new Map(src.workCenters.map(w => [w.id, s(w.code)]));

    // ── Measuring points ─────────────────────────────────────────────────────
    const points = sheet('measuringPoint', 'S_HEADER');
    /** MEAS_POINT key per definition id — what a document refers to. */
    const pointKey = new Map<string, string>();
    for (const d of src.readingDefinitions) {
        if (d.is_active === false) continue;
        const key = fromSap(d.source_system) && s(d.source_ref) ? s(d.source_ref) : d.id;
        pointKey.set(d.id, key);
        if (delta && fromSap(d.source_system)) { alreadyInSap.points += 1; continue; }
        const obj = objectOf(assetById.get(d.asset_id));
        if (!obj.type) { issues.add('warn', 'measuring point(s) sit on an asset that is neither equipment nor a functional location — not exported'); continue; }
        points.add({
            MEAS_POINT: key,
            MEASUREMENT_POINT_TYPE: (d.category || '').toUpperCase() === 'METER' ? '' : '',
            PSORT: '',
            PTTXT: s(d.name),
            OBJECT_TYPE: obj.type,
            MEAS_POINT_OBJ_NO: obj.ref,
            IS_COUNTER: (d.category || '').toUpperCase() === 'METER' ? 'X' : '',
            ATNAM: s(d.reading_type_code),
            DECIM: '',
        });
    }
    if (points.rows.length) {
        issues.add('info', 'MEASUREMENT_POINT_TYPE is mandatory and is client configuration (the measuring-point category) — fill it in the cockpit’s value mapping or set a default before loading.', false);
        if (src.readingDefinitions.some(d => d.unit)) {
            issues.add('info', 'The mandatory measuring-point template carries no unit column; SAP takes the unit from the characteristic (ATNAM). Units set in IREAMS do not travel — configure the characteristics with their units before the load.', false);
        }
        if (src.readingDefinitions.some(d => d.min_warning != null || d.max_warning != null)) {
            issues.add('info', 'Alarm bands set in IREAMS are not exported: SAP keeps limits on the characteristic, and MRMIC/MRMAC on a point are the measurement RANGE, not an alarm — writing a band there would make SAP reject healthy readings.', false);
        }
    }

    // ── Measurement documents ────────────────────────────────────────────────
    const docs = sheet('measurementDocument', 'S_MEASUREMENT_DOCU');
    for (const l of src.readingLogs) {
        if (l.is_active === false) continue;
        if (delta && fromSap(l.source_system)) { alreadyInSap.readings += 1; continue; }
        const key = pointKey.get(l.definition_id);
        if (!key) { issues.add('warn', 'reading(s) belong to a point that is inactive or missing — not exported'); continue; }
        if (l.reading_value == null || l.reading_value === '') continue;
        docs.add({
            MEASUREMENT_DOCUMENT: fromSap(l.source_system) && s(l.source_ref) ? s(l.source_ref) : l.id,
            MEASUREMENT_POINT: key,
            READING_DATE: toSapDate(l.reading_date),
            READING_TIME: toSapTime(l.reading_time ?? ''),
            SHORT_TEXT: s(l.comments),
            READ_BY: s(l.entered_by),
            READING: s(l.reading_value),
            DIFFERENCE_READING: s(l.delta),
            VALUATION_CODE: s(l.valuation_code),
        });
    }
    if (docs.rows.some(r => r.VALUATION_CODE)) {
        issues.add('info', 'Valuation codes are IREAMS’s finding codes (OK, NOISE, VIBR...). SAP takes them from the catalogue named on the point (CODGR) — define them there, or map them in the cockpit.', false);
    }

    // ── Schedules -> task lists, items, plans ───────────────────────────────
    const hdr = sheet('generalTaskList', 'S_TASKLIST_HDR');
    const ops = sheet('generalTaskList', 'S_OPERATIONS');
    const comps = sheet('generalTaskList', 'S_COMPONENTS');
    const mpla = sheet('maintenancePlan', 'S_MPLA');
    const mpos = sheet('maintenancePlan', 'S_MPOS');
    const objl = sheet('maintenancePlan', 'S_OBJ_LIST');
    const handover: Record<string, string>[] = [];

    const invByKey = new Map<string, string>();
    for (const i of src.inventoryItems) { invByKey.set(i.id, s(i.material_number) || s(i.part_number)); }

    let listSeq = 0;
    for (const pm of src.schedules ?? []) {
        if (pm.active === false || (pm.status && !/ACTIVE|DRAFT|PAUSED/i.test(pm.status))) continue;
        const origin = (pm.origin ?? {}) as Record<string, unknown>;
        const sapPlan = s(origin.plan), sapItem = s(origin.item), sapList = s(origin.task_list);
        const inSap = !!(sapPlan || sapItem || sapList);
        const code = s(pm.code) || pm.id;
        const title = s(pm.title) || s(pm.description) || code;
        const asset = assetById.get(s(pm.asset_id) || (pm.assigned_assets?.[0]?.assetId ?? ''));
        const obj = objectOf(asset);
        const unit = sapCycleUnit(pm.frequency_unit ?? '');
        const interval = Number(pm.frequency_interval ?? 0);
        const cadence: Cadence | null = unit && interval > 0 ? { interval, unit } : null;
        const tasks = (pm.templates?.tasks ?? []) as Record<string, unknown>[];
        const inventory = (pm.templates?.inventory ?? []) as Record<string, unknown>[];

        if (delta && inSap) {
            alreadyInSap.schedules += 1;
            handover.push({
                IREAMS_CODE: code, TITLE: title, WARPL: sapPlan, WPPOS: sapItem, PLNNR_PLNAL: sapList,
                OBJECT: obj.ref, CYCLE: cadence ? `${cadence.interval} ${SAP_UNIT[cadence.unit]}` : '',
                STEPS: String(tasks.length), NEXT_DUE: toSapDate(s(pm.next_due_date).slice(0, 10)),
                NOTE: 'SAP already has this plan. Apply any change IREAMS made in IP02 (plan) / IA06 (task list), or let the live link carry it.',
            });
            continue;
        }
        if (!obj.type) { issues.add('warn', `schedule(s) have no equipment or functional location to schedule against — not exported`); continue; }
        if (!cadence) { issues.add('error', `schedule(s) have no cadence IREAMS can express as a SAP cycle — not exported`); continue; }

        // Task list — only when the schedule has steps.
        let plnnr = '', plnal = '01';
        if (tasks.length) {
            if (sapList) { [plnnr, plnal] = sapList.split('/'); plnal = (plnal || '01').padStart(2, '0'); }
            else { listSeq += 1; plnnr = `IR${String(listSeq).padStart(6, '0')}`; }
            hdr.add({ PLNNR: plnnr, PLNAL: plnal, KTEXT: title, WERKS: params.plant, ARBPL: workCentreCode.get(s(pm.work_center_id)) ?? '', ANLZU: '', STATU: '4', VERWE: '4' });
            tasks
                .slice()
                .sort((a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0))
                .forEach((t, i) => {
                    const vornr = String((i + 1) * 10).padStart(4, '0');
                    const hours = Number(t.estHours ?? 0);
                    ops.add({
                        PLNNR: plnnr, PLNAL: plnal, VORNR: vornr,
                        ARBPL: workCentreCode.get(s(pm.work_center_id)) ?? '', WERKS: params.plant, STEUS: 'PM01',
                        LTXA1: s(t.description) || s(t.title) || `Step ${i + 1}`,
                        ARBEI: hours > 0 ? String(hours) : '', ARBEH: hours > 0 ? 'H' : '',
                        ANZZL: hours > 0 ? '1' : '',
                        TDLINE: s(t.longText ?? t.notes ?? ''),
                    });
                });
            for (const p of inventory) {
                const code = invByKey.get(s(p.inventoryId)) || '';
                if (!code) { issues.add('info', 'planned part(s) with no material number are not exported as components — SAP components need a material'); continue; }
                const taskIdx = tasks.findIndex(t => s(t.id) === s(p.jobTaskId));
                comps.add({ PLNNR: plnnr, PLNAL: plnal, VORNR: String(((taskIdx < 0 ? 0 : taskIdx) + 1) * 10).padStart(4, '0'), IDNRK: code, MENGE: s(p.estQty), MEINS: s(p.uom) });
            }
        }

        // Plan + item. A meter cadence has no time cycle: the plan is driven by
        // a measuring point, and the cycle goes with the point's unit.
        // In full mode a schedule that came from SAP keeps SAP's own plan and
        // item numbers as its keys, so the load recreates what SAP had.
        const warpl = sapPlan || code;
        const wppos = sapItem || '0010';
        const meter = isMeterUnit(cadence.unit);
        const nextDue = s(pm.next_due_date).slice(0, 10);
        const start = !meter && nextDue ? addCadence(nextDue, { interval: -cadence.interval, unit: cadence.unit }) : null;
        mpla.add({
            WARPL: warpl, MPTYP: 'PM', WPTXT: title,
            ZYKL1: String(cadence.interval), ZEIEH: SAP_UNIT[cadence.unit],
            STADT: start ? toSapDate(start) : '',
            HORIZ: '', CALL_CONFIRM: '',
        });
        if (meter) issues.add('warn', `schedule(s) run on a meter (${cadence.unit}) — exported with the cycle in that unit; SAP needs the plan tied to a counter measuring point (POINT), which must be set on load`);
        mpos.add({
            WARPL: warpl, WPPOS: wppos, PSTXT: title,
            [obj.type === 'IEQ' ? 'EQUNR' : 'TPLNR']: obj.ref,
            IWERK: params.planningPlant, AUART: params.orderType,
            GEWRK: workCentreCode.get(s(pm.work_center_id)) ?? '', WERGW: params.plant,
            ILART: ILART_OF[s(pm.job_type).toUpperCase()] ?? '',
            PRIOK: PRIOK_OF[s(pm.priority_code).toUpperCase()] ?? '',
            PLNTY: plnnr ? 'A' : '', PLNNR: plnnr, PLNAL: plnnr ? plnal : '',
        });
        const extra = (pm.assigned_assets ?? []).map(a => assetById.get(s(a.assetId))).filter((a): a is SrcAsset => !!a && a.id !== asset?.id);
        extra.forEach((a, i) => {
            const o = objectOf(a);
            if (!o.type) return;
            objl.add({ WARPL: warpl, WPPOS: wppos, EAMS_OBKNR: String(i + 1), [o.type === 'IEQ' ? 'EQUNR' : 'TPLNR']: o.ref });
        });
    }
    if (mpla.rows.length && !params.planningPlant) issues.add('error', 'IWERK (planning plant) is mandatory on every maintenance item and is not set — set it in the target parameters', false);
    if (mpla.rows.length) issues.add('info', 'Plans are exported as single-cycle plans (ZYKL1/ZEIEH, STRAT blank): an exact cadence, no strategy needed in the target. STADT is the next due date less one cycle, so the first call falls on the next due date.', false);
    if (mpla.rows.length && params.numbering === 'internal') issues.add('info', 'WARPL and PLNNR carry IREAMS codes as legacy keys; the cockpit’s value mapping assigns SAP numbers on load.', false);

    // ── Assemble ─────────────────────────────────────────────────────────────
    const files = [points, docs, hdr, ops, comps, mpla, mpos, objl].map(x => x.file()).filter((f): f is CockpitExportFile => !!f);
    const counts = Object.fromEntries((Object.keys(COCKPIT_OBJECT_BY_KEY) as CockpitObjectKey[]).map(k => [k, files.filter(f => f.object === k).reduce((n, f) => n + f.rows, 0)])) as Record<CockpitObjectKey, number>;

    let ho: CockpitHandover | null = null;
    if (handover.length) {
        const cols = ['IREAMS_CODE', 'TITLE', 'WARPL', 'WPPOS', 'PLNNR_PLNAL', 'OBJECT', 'CYCLE', 'STEPS', 'NEXT_DUE', 'NOTE'];
        ho = {
            folder: 'Hand-over (not loaded)',
            fileName: 'IREAMS_changes_for_SAP.csv',
            text: renderCsv([cols, ...handover.map(r => cols.map(c => r[c] ?? ''))]),
            rows: handover.length,
        };
        issues.add('info', `${handover.length} schedule(s) already exist in SAP and are not loaded again — they are listed on the hand-over sheet with their SAP keys, for the planner to apply in IP02 / IA06 or for the live link to carry`, false);
    }
    if (delta && (alreadyInSap.points || alreadyInSap.readings)) {
        issues.add('info', `${alreadyInSap.points} point(s) and ${alreadyInSap.readings} reading(s) came from SAP and are not loaded again (delta mode).`, false);
    }
    if (files.length === 0 && !ho) issues.add('warn', 'Nothing to export: no active points, readings or schedules that SAP does not already have.', false);

    return { files, handover: ho, issues: issues.list(), counts, alreadyInSap };
}

/** Entries for a single ZIP laid out exactly as the cockpit lays out a download. */
export function exportZipEntries(x: CockpitExport): { name: string; text: string }[] {
    const entries = x.files.map(f => ({ name: `${f.folder}/${f.fileName}`, text: f.text }));
    if (x.handover) entries.push({ name: `${x.handover.folder}/${x.handover.fileName}`, text: x.handover.text });
    return entries;
}
