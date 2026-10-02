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
import type { SapLoadSource, SrcAsset, SrcSchedule } from '../sapLoad/build';
import { objectClassOf } from '../../eam/services/hierarchyModel';
import { addCadence, sapCycleUnit, isMeterUnit, type Cadence, type CadenceUnit } from '../../eam/lib/sapCycles';
import { toSapDate } from '../sapLoad/build';
import { SAP_ILART_MAP, SAP_PRIOK_MAP } from '../../eam/services/assetTemplates';
import { scheduleChange, cadenceText, revisionText, type ScheduleChange } from './handover';

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
    /**
     * MEASUREMENT_POINT_TYPE on every point — SAP's measuring-point category,
     * mandatory, and pure configuration: IREAMS has no field for it because
     * it means nothing outside SAP. One value for the whole load.
     */
    measuringPointCategory?: string;
    /** The source system these files are for, written onto nothing — used only to decide what "came from SAP" means. */
    sourceSystem?: string;
    /**
     * Send one study's outcome rather than the whole register. A schedule
     * belongs to a study through the provenance stamped on it when the study
     * created it (origin.study_id for RCM; origin.source for a Weibull-derived
     * schedule). Points and readings are condition data, not a study's output,
     * and are left out of a study-scoped send.
     */
    scope?: { studyId?: string; source?: string };
    /**
     * The register itself — PM - Functional location and PM - Equipment —
     * in the same ZIP, ahead of everything that points at it. Default on.
     * Off when SAP already holds the register and only condition data or
     * strategy is being sent; a study-scoped send never includes it.
     */
    register?: boolean;
    /** SWERK on every location and equipment. Falls back to the planning plant. */
    maintenancePlant?: string;
    /** INGRP. */
    plannerGroup?: string;
    /** BUKRS when the asset's company has no code of its own. */
    companyCode?: string;
    /** FLTYP on every functional location (M = technical system). Mandatory. */
    flCategory?: string;
    /** TPLKZ on every functional location — the structure indicator that must permit the tag format. Mandatory. */
    structureIndicator?: string;
    /** EQTYP on every equipment (M = machine). Mandatory. */
    equipmentCategory?: string;
    /**
     * DATAB, the valid-from date SAP wants on every equipment, when the asset
     * has no acquisition date of its own. Any of YYYYMMDD, YYYY-MM-DD or
     * DD.MM.YYYY; written as YYYYMMDD. Defaults to today.
     */
    validFrom?: string;
    /** SPRAS on every long text — the language key the texts are written in. Defaults to EN. */
    language?: string;
}

/** One group of schedules that a study produced, as the page lists them. */
export interface StudyGroup {
    /** Stable key for the scope: "study:<id>" or "source:<name>". */
    key: string;
    label: string;
    schedules: number;
    scope: NonNullable<CockpitExportParams['scope']>;
}

const SOURCE_LABELS: Record<string, string> = {
    weibull_analysis: 'Weibull analyses (schedules created from fits)',
    rcm: 'RCM studies',
};

/** The studies whose schedules are in the register, from the schedules' own provenance. */
export function studiesIn(src: SapLoadSource): StudyGroup[] {
    const groups = new Map<string, StudyGroup>();
    for (const pm of src.schedules ?? []) {
        const o = (pm.origin ?? {}) as Record<string, unknown>;
        const studyId = s(o.study_id);
        const source = s(o.source);
        if (studyId) {
            const key = `study:${studyId}`;
            const g = groups.get(key) ?? { key, label: `${s(o.study_title) || 'Study'}${o.study_revision ? ` (rev ${s(o.study_revision)})` : ''}`, schedules: 0, scope: { studyId } };
            g.schedules += 1; groups.set(key, g);
        } else if (source && source !== 'sap_pm' && source !== 'sap_load_file') {
            const key = `source:${source}`;
            const g = groups.get(key) ?? { key, label: SOURCE_LABELS[source] ?? source, schedules: 0, scope: { source } };
            g.schedules += 1; groups.set(key, g);
        }
    }
    return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}

const inScope = (pm: SrcSchedule, scope: CockpitExportParams['scope']): boolean => {
    if (!scope || (!scope.studyId && !scope.source)) return true;
    const o = (pm.origin ?? {}) as Record<string, unknown>;
    if (scope.studyId) return s(o.study_id) === scope.studyId;
    return s(o.source) === scope.source;
};

export const defaultExportParams = (): CockpitExportParams => ({
    mode: 'delta', planningPlant: '', plant: '', orderType: 'PM01', numbering: 'legacy', sourceSystem: 'sap_pm',
    register: true, flCategory: 'M', equipmentCategory: 'M', structureIndicator: '', language: 'EN',
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
    /** Schedules SAP already has, that IREAMS changed — not loaded, handed to the planner. */
    handover: CockpitHandover | null;
    /** The same schedules as objects, for the page: keys, SAP vs IREAMS cadence, revisions, sync state. */
    changes: ScheduleChange[];
    /** Schedule ids in this send — loaded ones and handed-over ones — for the sync stamp. */
    sentScheduleIds: string[];
    /** SAP-origin schedules left out because SAP already has every change (confirmed), or nothing changed. */
    inSyncSchedules: number;
    issues: CockpitIssue[];
    /** Rows per object, for the page. */
    counts: Record<CockpitObjectKey, number>;
    /** What delta mode kept out because SAP has it. */
    alreadyInSap: { points: number; readings: number; schedules: number; assets: number };
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

/**
 * SAP's internal date: YYYYMMDD, no separators. The dotted DD.MM.YYYY is a
 * display format — a user's logon setting — and the cockpit's staging fields
 * are DATS: the sample S_EQUI received held DATAB and INBDT as eight-digit
 * numbers (which is why Excel showed them as 2E+07). Takes ISO, dotted or
 * already-compact input; anything else passes through for SAP to reject.
 */
export function cockpitDate(v: string | null | undefined): string {
    const x = s(v);
    if (!x) return '';
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(x);
    if (iso) return `${iso[1]}${iso[2]}${iso[3]}`;
    const dmy = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(x);
    if (dmy) return `${dmy[3]}${dmy[2]}${dmy[1]}`;
    return x;
}

/** SAP's internal time: HHMMSS, no separators. Takes HH:MM, HH:MM:SS or HHMMSS. */
export function cockpitTime(v: string | null | undefined): string {
    const x = s(v);
    if (!x) return '';
    if (/^\d{6}$/.test(x)) return x;
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(x);
    return m ? `${m[1].padStart(2, '0')}${m[2]}${m[3] ?? '00'}` : x;
}

const todayCockpitDate = (d = new Date()): string =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

/** SAP field lengths worth enforcing on the load — the cockpit rejects longer values. */
const LENGTHS: Record<string, number> = {
    PTTXT: 40, SHORT_TEXT: 40, PSTXT: 40, WPTXT: 40, KTEXT: 40, LTXA1: 40, MI_TEXT: 40,
    PLNNR: 8, WARPL: 12, WAPOS: 16, ATNAM: 30, CODGR: 8,
    // The register.
    EXTERNAL_NUMBER: 30, TPLNR: 30, TPLMA: 30, TPLKZ: 5, KTX01: 40,
    EQUNR: 18, HEQUI: 18, EQKTX: 40, TECHID: 25, EQART: 10,
    HERST: 30, TYPBZ: 20, SERGE: 30, INVNR: 25, BAUJJ: 4,
    STORT: 10, INGRP: 3, KOSTL: 10, BUKRS: 4, ABCKZ: 1, ARBPL_ORG: 8, WERGW: 4, SWERK: 4, IWERK: 4,
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
        if (this.spec.provisional) {
            this.issues.add('warn', `${this.spec.structure} is written from a header IREAMS has not seen on a cockpit download: ${this.spec.provisional} Run Simulate in the cockpit before loading: an unknown column is rejected there, before anything is written.`, false);
        }
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
    const alreadyInSap = { points: 0, readings: 0, schedules: 0, assets: 0 };
    const studyScoped = !!(params.scope && (params.scope.studyId || params.scope.source));

    const sheet = (object: CockpitObjectKey, structure: string) => new Sheet(object, structureSpec(object, structure)!, issues);

    // What SAP already knows an asset as. An equipment imported from a SAP
    // sheet keeps its EQUNR in erp_object_map under the system "SAP"; that is
    // both the sign SAP has it and the key every dependent row must carry.
    const sapKeyOf = new Map<string, string>();
    for (const x of src.externalIds ?? []) {
        if (x.entity_type === 'asset' && /^SAP/i.test(s(x.system)) && s(x.external_key)) sapKeyOf.set(x.entity_id, s(x.external_key));
    }

    // Assets by id, with their SAP reference and object type.
    const assetById = new Map(src.assets.map(a => [a.id, a]));
    const objectOf = (a: SrcAsset | undefined): { type: 'IEQ' | 'IFL' | ''; ref: string } => {
        if (!a) return { type: '', ref: '' };
        const cls = objectClassOf(a);
        if (cls === 'FLOC') return { type: 'IFL', ref: s(a.tag) };
        if (cls === 'EQUIPMENT') return { type: 'IEQ', ref: sapKeyOf.get(a.id) || (params.numbering === 'legacy' ? (s(a.equipment_number) || s(a.tag)) : s(a.tag)) };
        return { type: '', ref: '' };
    };
    const workCentreCode = new Map(src.workCenters.map(w => [w.id, s(w.code)]));

    // ── The register: functional locations, then equipment ──────────────────
    // Loads first; every other object points at it. A study's outcome is
    // strategy, not the register, so a study-scoped send leaves it out. In
    // delta mode an asset SAP already knows (sapKeyOf) is not loaded again.
    const flocs = sheet('functionalLocation', 'S_FUN_LOCATION');
    // The register's description — what the Assets module calls Description,
    // kept in properties.description and read by RCM as the duty narrative —
    // is a long text to SAP, one row per location and language.
    const flTexts = sheet('functionalLocation', 'S_TEXTS_FL');
    const equi = sheet('equipment', 'S_EQUI');
    const eqTexts = sheet('equipment', 'S_TEXTS_EQUI');
    const descriptionOf = (a: SrcAsset): string => s((a.properties as Record<string, unknown> | null)?.description);
    if (params.register !== false && !studyScoped) {
        const parentOf = (a: SrcAsset): SrcAsset | undefined => (a.parent_id ? assetById.get(a.parent_id) : undefined);
        const depthOf = (a: SrcAsset): number => {
            let d = 0; let cur: SrcAsset | undefined = a; const seen = new Set<string>();
            while (cur && cur.parent_id && !seen.has(cur.id)) { seen.add(cur.id); cur = assetById.get(cur.parent_id); d += 1; }
            return d;
        };
        /** Nearest functional location above an asset, through any superior equipment. */
        const flocAbove = (a: SrcAsset): SrcAsset | undefined => {
            let cur = parentOf(a); const seen = new Set<string>();
            while (cur && !seen.has(cur.id)) { if (objectClassOf(cur) === 'FLOC') return cur; seen.add(cur.id); cur = parentOf(cur); }
            return undefined;
        };
        const byDepth = (a: SrcAsset, b: SrcAsset) => depthOf(a) - depthOf(b) || s(a.tag).localeCompare(s(b.tag));
        const costCentreCode = new Map(src.costCenters.map(c => [c.id, s(c.code)]));
        const company = new Map(src.companies.map(c => [c.id, c]));
        const financial = new Map<string, SapLoadSource['assetFinancials'][number]>();
        for (const f of src.assetFinancials) if (!financial.has(f.asset_id)) financial.set(f.asset_id, f);
        const swerk = s(params.maintenancePlant) || s(params.planningPlant);
        const wergw = s(params.plant) || swerk;
        /** The fields a location and an equipment share: where it is, who plans it, who pays. */
        const common = (a: SrcAsset): Record<string, string> => {
            const arbpl = workCentreCode.get(s(a.responsible_work_center_id)) ?? '';
            return {
                SWERK: swerk, IWERK: s(params.planningPlant), INGRP: s(params.plannerGroup),
                KOSTL: a.cost_center_id ? (costCentreCode.get(a.cost_center_id) ?? '') : '',
                BUKRS: (a.company_id && s(company.get(a.company_id)?.code)) || s(params.companyCode),
                ABCKZ: s(a.criticality).toUpperCase().slice(0, 1),
                STORT: s((a.properties as Record<string, unknown> | null)?.location),
                ARBPL_ORG: arbpl, WERGW: arbpl ? wergw : '',
            };
        };

        const flocList = src.assets.filter(a => objectClassOf(a) === 'FLOC').sort(byDepth);
        const eqList = src.assets.filter(a => objectClassOf(a) === 'EQUIPMENT').sort(byDepth);
        // A location with equipment under it must allow installation (IEQUI),
        // or the equipment rows that name it as TPLNR fail to load.
        const hosts = new Set(eqList.map(e => flocAbove(e)?.id).filter((id): id is string => !!id));
        const unclassified = src.assets.length - flocList.length - eqList.length;
        if (unclassified > 0) issues.add('warn', `${unclassified} asset(s) have a hierarchy level that is neither a functional location nor equipment — not exported; fix the level in the Asset Register`, false);

        for (const a of flocList) {
            if (!s(a.tag)) { issues.add('warn', 'functional location(s) have no tag — not exported'); continue; }
            if (delta && sapKeyOf.has(a.id)) { alreadyInSap.assets += 1; continue; }
            const parent = parentOf(a);
            if (parent && objectClassOf(parent) !== 'FLOC') issues.add('warn', 'functional location(s) sit under equipment — SAP allows only a functional location above a functional location; TPLMA left blank');
            flocs.add({
                EXTERNAL_NUMBER: s(a.tag),
                TPLKZ: s(params.structureIndicator), FLTYP: s(params.flCategory),
                KTX01: s(a.name) || s(a.tag),
                EQART: s(a.hierarchy_level).toUpperCase(),
                TPLMA: parent && objectClassOf(parent) === 'FLOC' ? s(parent.tag) : '',
                IEQUI: hosts.has(a.id) ? 'X' : '',
                ...common(a),
            });
            const text = descriptionOf(a);
            if (text) flTexts.add({ EXTERNAL_NUMBER: s(a.tag), SPRAS: s(params.language) || 'EN', TEXT_DESCR: s(a.name) || s(a.tag), LONGTEXT: text });
        }

        let noPosition = 0;
        for (const a of eqList) {
            if (!s(a.tag) && !s(a.name)) { issues.add('warn', 'equipment with neither tag nor name — not exported'); continue; }
            if (delta && sapKeyOf.has(a.id)) { alreadyInSap.assets += 1; continue; }
            const parent = parentOf(a);
            const floc = flocAbove(a);
            if (!floc) noPosition += 1;
            const fin = financial.get(a.id);
            const props = (a.properties ?? {}) as Record<string, unknown>;
            const year = s(props.constructionYear ?? props.construction_year ?? props.yearBuilt) || (/^(\d{4})/.exec(s(fin?.acquisition_date))?.[1] ?? '');
            const cost = s(fin?.acquisition_cost);
            equi.add({
                EQUNR: objectOf(a).ref,
                // SAP Help: X = internal numbering (EQUNR is a legacy key the
                // cockpit maps on load); blank = external (EQUNR IS the number).
                NRANGE_IND: params.numbering === 'internal' ? 'X' : '',
                EQTYP: s(params.equipmentCategory),
                DATAB: cockpitDate(fin?.acquisition_date) || cockpitDate(params.validFrom) || todayCockpitDate(),
                EQKTX: s(a.name) || s(a.tag),
                TECHID: s(a.tag),
                EQART: s(a.asset_class || a.asset_type_code).toUpperCase(),
                HERST: s(a.manufacturer), TYPBZ: s(a.model), SERGE: s(a.serial_number), BAUJJ: year,
                INVNR: s(props.inventoryNumber ?? props.inventory_number),
                TPLNR: floc ? s(floc.tag) : '',
                HEQUI: parent && objectClassOf(parent) === 'EQUIPMENT' ? objectOf(parent).ref : '',
                ANSDT: cockpitDate(fin?.acquisition_date), ANSWT: cost,
                WAERS: cost ? s(company.get(s(a.company_id))?.currency) : '',
                ...common(a),
            });
            const text = descriptionOf(a);
            if (text) eqTexts.add({ EQUNR: objectOf(a).ref, SPRAS: s(params.language) || 'EN', TEXT_DESCR: s(a.name) || s(a.tag), LONGTEXT: text });
        }

        if (eqList.length && !flocList.length) issues.add('error', 'no functional locations — every equipment row loads without a position (TPLNR blank). Give the register a site/unit/system tree first.', false);
        if (noPosition) issues.add('warn', `${noPosition} equipment row(s) have no functional location above them — TPLNR blank; SAP accepts them but they will not appear in the location structure`, false);
        if ((flocs.rows.length && (!s(params.structureIndicator) || !s(params.flCategory))) || (equi.rows.length && !s(params.equipmentCategory))) {
            issues.add('info', 'The structure indicator (TPLKZ), location category (FLTYP) and equipment category (EQTYP) are SAP configuration — set them once in the SAP values above and every row gets them.', false);
        }
        if (equi.rows.length && params.numbering === 'internal') issues.add('info', 'EQUNR carries the tag as a legacy key (NRANGE_IND X): the cockpit assigns SAP numbers on load, and the points and items in this ZIP reference equipment by the same key, so one load in the cockpit’s order resolves them.', false);
        if (equi.rows.length && params.numbering === 'legacy') issues.add('info', 'EQUNR carries the IREAMS equipment number as the SAP number (NRANGE_IND blank = external numbering); switch to internal numbering if these are not valid SAP equipment numbers. TECHID carries the field tag either way.', false);
        if (equi.rows.length && !src.assetFinancials.length) issues.add('info', 'DATAB (valid-from) is mandatory on equipment and no asset carries an acquisition date — today’s date is written. Set the acquisition date on the asset where the real date matters.', false);
    }

    // ── Measuring points ─────────────────────────────────────────────────────
    const points = sheet('measuringPoint', 'S_HEADER');
    /** MEAS_POINT key per definition id — what a document refers to. */
    const pointKey = new Map<string, string>();
    for (const d of src.readingDefinitions) {
        if (d.is_active === false) continue;
        const key = fromSap(d.source_system) && s(d.source_ref) ? s(d.source_ref) : d.id;
        pointKey.set(d.id, key);
        if (studyScoped) continue;                 // a study's outcome is strategy, not condition data
        if (delta && fromSap(d.source_system)) { alreadyInSap.points += 1; continue; }
        const obj = objectOf(assetById.get(d.asset_id));
        if (!obj.type) { issues.add('warn', 'measuring point(s) sit on an asset that is neither equipment nor a functional location — not exported'); continue; }
        points.add({
            MEAS_POINT: key,
            MEASUREMENT_POINT_TYPE: s(params.measuringPointCategory),
            PSORT: '',
            PTTXT: s(d.name),
            OBJECT_TYPE: obj.type,
            MEAS_POINT_OBJ_NO: obj.ref,
            IS_COUNTER: (d.category || '').toUpperCase() === 'METER' ? 'X' : '',
            ATNAM: s(d.reading_type_code),
            DECIM: '',
        });
    }
    if (points.rows.length && !s(params.measuringPointCategory)) {
        issues.add('info', 'The measuring-point category (MEASUREMENT_POINT_TYPE) is SAP configuration, not something IREAMS knows — set it once in the SAP values above and every point gets it.', false);
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
        if (studyScoped) continue;
        if (delta && fromSap(l.source_system)) { alreadyInSap.readings += 1; continue; }
        const key = pointKey.get(l.definition_id);
        if (!key) { issues.add('warn', 'reading(s) belong to a point that is inactive or missing — not exported'); continue; }
        if (l.reading_value == null || l.reading_value === '') continue;
        docs.add({
            MEASUREMENT_DOCUMENT: fromSap(l.source_system) && s(l.source_ref) ? s(l.source_ref) : l.id,
            MEASUREMENT_POINT: key,
            READING_DATE: cockpitDate(l.reading_date),
            READING_TIME: cockpitTime(l.reading_time ?? ''),
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
    const changes: ScheduleChange[] = [];
    const sentScheduleIds: string[] = [];
    let inSyncSchedules = 0;

    const invByKey = new Map<string, string>();
    for (const i of src.inventoryItems) { invByKey.set(i.id, s(i.material_number) || s(i.part_number)); }

    let listSeq = 0;
    for (const pm of src.schedules ?? []) {
        if (pm.active === false || (pm.status && !/ACTIVE|DRAFT|PAUSED/i.test(pm.status))) continue;
        if (!inScope(pm, params.scope)) continue;
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
            // Only what IREAMS changed and SAP has not confirmed goes to the
            // planner. Unchanged, or confirmed since the last change, is in sync.
            const ch = scheduleChange(pm);
            if (ch.inSync) { inSyncSchedules += 1; continue; }
            changes.push(ch);
            sentScheduleIds.push(pm.id);
            handover.push({
                IREAMS_CODE: code, TITLE: title, WARPL: sapPlan, WPPOS: sapItem, PLNNR_PLNAL: sapList, OBJECT: obj.ref,
                SAP_CYCLE: cadenceText(ch.sapCadence), IREAMS_CYCLE: cadenceText(ch.cadence),
                CHANGES: ch.revisions.map(revisionText).join(' | '),
                STUDY: ch.study ? (ch.study.title || ch.study.id) : '',
                STEPS: String(tasks.length), NEXT_DUE: toSapDate(s(pm.next_due_date).slice(0, 10)),
                LAST_SENT: ch.sync.sentAt ? ch.sync.sentAt.slice(0, 10) : '',
                NOTE: 'SAP already has this plan. Apply the change in IP02 (plan cycle) / IA06 (task list), then mark it confirmed in IREAMS — or let the live link carry it.',
            });
            continue;
        }
        sentScheduleIds.push(pm.id);
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
            STADT: start ? cockpitDate(start) : '',
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
    // In the cockpit's load order: the register, then what sits on it.
    const files = [flocs, flTexts, equi, eqTexts, points, docs, hdr, ops, comps, mpla, mpos, objl].map(x => x.file()).filter((f): f is CockpitExportFile => !!f);
    const counts = Object.fromEntries((Object.keys(COCKPIT_OBJECT_BY_KEY) as CockpitObjectKey[]).map(k => [k, files.filter(f => f.object === k).reduce((n, f) => n + f.rows, 0)])) as Record<CockpitObjectKey, number>;

    let ho: CockpitHandover | null = null;
    if (handover.length) {
        const cols = ['IREAMS_CODE', 'TITLE', 'WARPL', 'WPPOS', 'PLNNR_PLNAL', 'OBJECT', 'SAP_CYCLE', 'IREAMS_CYCLE', 'CHANGES', 'STUDY', 'STEPS', 'NEXT_DUE', 'LAST_SENT', 'NOTE'];
        ho = {
            folder: 'Hand-over (not loaded)',
            fileName: 'IREAMS_changes_for_SAP.csv',
            text: renderCsv([cols, ...handover.map(r => cols.map(c => r[c] ?? ''))]),
            rows: handover.length,
        };
        issues.add('info', `${handover.length} schedule(s) SAP already has were changed by IREAMS — they are on the hand-over sheet with what SAP holds, what IREAMS holds now and why, for the planner to apply in IP02 / IA06 and then confirm here`, false);
    }
    if (inSyncSchedules) issues.add('info', `${inSyncSchedules} schedule(s) SAP already has are in sync — unchanged, or confirmed since the last change — and are not sent.`, false);
    if (delta && (alreadyInSap.points || alreadyInSap.readings || alreadyInSap.assets)) {
        issues.add('info', `${alreadyInSap.assets} asset(s), ${alreadyInSap.points} point(s) and ${alreadyInSap.readings} reading(s) came from SAP and are not loaded again (delta mode).`, false);
    }
    if (files.length === 0 && !ho) issues.add('warn', 'Nothing to export: no assets, active points, readings or schedules that SAP does not already have.', false);

    return { files, handover: ho, changes, sentScheduleIds, inSyncSchedules, issues: issues.list(), counts, alreadyInSap };
}

/** Entries for a single ZIP laid out exactly as the cockpit lays out a download. */
export function exportZipEntries(x: CockpitExport): { name: string; text: string }[] {
    const entries = x.files.map(f => ({ name: `${f.folder}/${f.fileName}`, text: f.text }));
    if (x.handover) entries.push({ name: `${x.handover.folder}/${x.handover.fileName}`, text: x.handover.text });
    return entries;
}
