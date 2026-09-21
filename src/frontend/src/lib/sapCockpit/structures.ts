/**
 * The PM migration objects, as the cockpit itself describes them.
 *
 * Every `header` below is the first line of a CSV the S/4HANA Migration
 * Cockpit produced — copied byte for byte, annotations and all. That makes
 * this file the contract: parse a header out of it and you have SAP's own
 * field list, its key fields and its mandatory fields, with nothing
 * transcribed by hand. Emit a file from it and the cockpit gets back exactly
 * the shape it handed out.
 *
 * Received 2026-09-21: PM - Measurement document, PM - Maintenance plan,
 * PM - Measuring point. The rest of the reliability set follows.
 *
 * A structure belongs to its OBJECT, never to the catalogue at large, and the
 * names are neither unique nor a promise about the shape. The measuring point
 * calls its only structure "S_HEADER". Both the maintenance plan and the
 * maintenance item have an "S_OBJ_LIST", and they are NOT the same file: the
 * plan's is keyed WARPL + WPPOS + EAMS_OBKNR, the item's WAPOS + EAMS_OBKNR.
 * Hand one to the other's load and it fails. So every lookup here is scoped
 * by object key, and a bare structure name answers with all of its matches.
 *
 * LOAD ORDER IS THE WHOLE GAME. The cockpit lists "predecessor objects" per
 * object: everything that must already be in the system, because the loaded
 * record points at it. A measurement document is worthless without its
 * measuring point; a maintenance item points at equipment, a work centre and
 * a task list. `predecessors` records what the cockpit says, and nothing is
 * inferred — where the list has not been seen, only the count is here.
 */

import { parseCockpitColumn, cockpitFileName, type CockpitColumn } from './dialect';

export type CockpitObjectKey =
    | 'measurementDocument'
    | 'maintenancePlan'
    | 'maintenanceItem'
    | 'generalTaskList'
    | 'measuringPoint';

export interface CockpitStructureSpec {
    /** Staging structure name — the CSV file stem. */
    structure: string;
    /** The download mode this header came from. */
    mode: 'FreeText_Mandatory' | 'FreeText';
    /** Header line, verbatim from the cockpit. */
    header: string;
    /** What the structure holds, in plain words. */
    note: string;
}

export interface CockpitObjectSpec {
    key: CockpitObjectKey;
    /** The object's name in the cockpit — the ZIP is "Source data for <name>.zip". */
    name: string;
    /** How many objects the cockpit says must be loaded first. */
    predecessorCount: number;
    /** The predecessor list, where it has actually been read off the cockpit. */
    predecessors?: string[];
    structures: CockpitStructureSpec[];
}

export const COCKPIT_OBJECTS: CockpitObjectSpec[] = [
    {
        key: 'measuringPoint',
        name: 'PM - Measuring point',
        // Loads before measurement documents: a document is a reading at a
        // point, and the point number is what it carries.
        predecessorCount: 4,
        structures: [
            {
                structure: 'S_HEADER',
                mode: 'FreeText_Mandatory',
                note: 'The point definition. OBJECT_TYPE + MEAS_POINT_OBJ_NO say what it sits on (IEQ equipment / IFL functional location) — and OBJECT_KEY_EXTERN takes the external key instead, which is how a point reaches equipment whose SAP number does not exist yet. IS_COUNTER splits a counter from a plain point; ATNAM is the classification characteristic IREAMS reads its reading type from; CODGR/CDSUF name the catalogue the VALUATION_CODE on a measurement document must come from. MRMIC/MRMAC are the measurement RANGE, not alarm limits.',
                header: 'MEAS_POINT(k/*),MEASUREMENT_POINT_TYPE(*),PSORT,PTTXT,OBJECT_TYPE(*),MEAS_POINT_OBJ_NO(*),LONGTEXT,LONGTEXT_LANG,IS_COUNTER,BEGRU,EXPON,DECIM,CODGR,CDSUF,ATNAM,DESIC,INDRV,CJUMC,PYEAC,DSTXT,MRMIC,MRMAC,OBJECT_KEY_EXTERN,OBJECT_TEXT,IV_SOURCE_POINT,IV_START_DATE,IV_START_TIME,IV_END_DATE,IV_END_TIME,IV_TRANSFER_MODE,START_POINT,END_POINT,LINEAR_LENGTH,LINEAR_UNIT,FIRST_OFFSET_TYPE_CODE,FIRST_OFFSET_VALUE,FIRST_OFFSET_UNIT,SECOND_OFFSET_TYPE_CODE,SECOND_OFFSET_VALUE,SECOND_OFFSET_UNIT,MARKER_START_POINT,MARKER_DISTANCE_START_POINT,MARKER_END_POINT,MARKER_DISTANCE_END_POINT,MARKER_DISTANCE_UNIT',
            },
        ],
    },
    {
        key: 'measurementDocument',
        name: 'PM - Measurement document',
        // The one predecessor is the measuring point: a document is a reading
        // AT a point, and the point number is what it carries.
        predecessorCount: 1,
        structures: [
            {
                structure: 'S_MEASUREMENT_DOCU',
                mode: 'FreeText_Mandatory',
                note: 'One row per reading. IREAMS reading_logs map here almost field for field; the linear-referencing block (START_POINT onward) is for pipelines and roads and stays blank for rotating equipment.',
                header: 'MEASUREMENT_DOCUMENT(k/*),MEASUREMENT_POINT,READING_DATE,READING_TIME,SHORT_TEXT,READ_BY,ORIGIN_INDICATOR,READING_AFTER_ACTION,READING,DIFFERENCE_READING,VALUATION_CODE,LONGTEXT_LANG,LONG_TEXT,START_POINT,END_POINT,LINEAR_LENGTH,LINEAR_UNIT,FIRST_OFFSET_TYPE_CODE,FIRST_OFFSET_VALUE,FIRST_OFFSET_UNIT,SECOND_OFFSET_TYPE_CODE,SECOND_OFFSET_VALUE,SECOND_OFFSET_UNIT,MARKER_START_POINT,MARKER_DISTANCE_START_POINT,MARKER_END_POINT,MARKER_DISTANCE_END_POINT,MARKER_DISTANCE_UNIT',
            },
        ],
    },
    {
        key: 'generalTaskList',
        name: 'PM - General maintenance task list',
        predecessorCount: 5,
        structures: [
            {
                structure: 'S_TASKLIST_HDR',
                mode: 'FreeText_Mandatory',
                note: 'The list itself, keyed group + counter (PLNNR/PLNAL) — the same pair an item points at through PLNTY/PLNNR/PLNAL. STRAT names the strategy whose packages the operations are scheduled by; VERWE is the usage, STATU the release status, and ANLZU the system condition the work needs.',
                header: 'PLNNR(k/*),PLNAL(k/*),ANDAT,DATUV,KTEXT,WERKS(*),ARBPL,ARBPL_WERK,VERWE,STATU,STRAT,VAGRP,ANLZU,ISTRU,TDLINE',
            },
            {
                structure: 'S_OPERATIONS',
                mode: 'FreeText_Mandatory',
                note: 'The steps. ARBEI/ARBEH is the work and its unit, ANZZL the number of people, DAUNO/DAUNE the duration, STEUS the control key that decides internal or external execution. EQUNR_OP/TPLNR_OP let one step target a different object from the header. The purchasing block (INFNR, LIFNR, EBELN, SAKTO...) is for externally executed steps.',
                header: 'PLNNR(k/*),PLNAL(k/*),VORNR(k/*),ARBPL,WERKS,STEUS,LTXA1,AUFKT,EQUNR_OP,TPLNR_OP,INDET,ARBEI,ARBEH,LARNT,ANZZL,DAUNO,DAUNE,PRZNT,BMVRG,BMEIH,SORTL,PREIS,WAERS,PEINH,INFNR,LIFNR,PLIFZ,EBELN,EBELP,SAKTO,MATKL,EKGRP,EKORG,EXECUTION_STAGE,VERTN,TDLINE',
            },
            {
                structure: 'S_SUBOPERATIONS',
                mode: 'FreeText',
                note: 'Steps within a step — the operation fields again, plus UVORN.',
                header: 'PLNNR(k/*),PLNAL(k/*),VORNR(k/*),UVORN(k/*),ARBPL,WERKS,STEUS,LTXA1,AUFKT,EQUNR_OP,TPLNR_OP,INDET,ARBEI,ARBEH,LARNT,ANZZL,DAUNO,DAUNE,PRZNT,BMVRG,BMEIH,SORTL,PREIS,WAERS,PEINH,INFNR,LIFNR,PLIFZ,EBELN,EBELP,SAKTO,MATKL,EKGRP,EKORG,EXECUTION_STAGE,VERTN,TDLINE',
            },
            {
                structure: 'S_MPACK',
                mode: 'FreeText',
                note: 'THE CADENCE. Which strategy package each operation belongs to — a step in the 3-month package runs quarterly, one in the 12-month package yearly, off a single task list. This is the file IREAMS already splits a strategy schedule by, one schedule per package.',
                header: 'PLNNR(k/*),PLNAL(k/*),VORNR(k/*),STRAT(k),PAKET(k)',
            },
            {
                structure: 'S_COMPONENTS',
                mode: 'FreeText',
                note: 'Planned materials per step — part, quantity, unit, backflush flag, unloading point and goods recipient. These become the planned parts on a generated order.',
                header: 'PLNNR(k/*),PLNAL(k/*),VORNR(k/*),IDNRK(k),MENGE,MEINS,RGEKZ,ABLAD,WEMPF',
            },
            {
                structure: 'S_PRTS',
                mode: 'FreeText',
                note: 'Production resources and tools per step, and the document links (DOKAR/DOKNR/DOKTL/DOKVR) — the route by which a procedure or drawing travels with the task. Note PLNNR is key but NOT mandatory here, unlike every other structure in this object.',
                header: 'PLNNR(k),PLNAL(k/*),VORNR(k/*),PSNFH(k/*),FHMAR,MATNR,FHWRK,STEUF,MGVGW,MGEINH,SFHNR,DOKAR,DOKNR,DOKTL,DOKVR,EQUNR_REF,EQPNT',
            },
            {
                structure: 'S_SPACK_OUTLINE',
                mode: 'FreeText',
                note: 'External service package: the outline hierarchy for a step done by a contractor.',
                header: 'PLNNR(k/*),PLNAL(k/*),VORNR(k/*),OUTLINE(k/*),PARENT_OUTLINE,OUTLINE_LEVEL_NAME,SHORT_TEXT',
            },
            {
                structure: 'S_SPACK_LINES',
                mode: 'FreeText',
                note: 'Service lines under a step — description, quantity, unit and gross price.',
                header: 'PLNNR(k/*),PLNAL(k/*),VORNR(k/*),SRV_LINE(k/*),SHORT_TEXT,QUANTITY,UOM,GROSS_PRICE,PRICE_UNIT',
            },
            {
                structure: 'S_SPACK_SRV_OUT',
                mode: 'FreeText',
                note: 'Service lines placed within an outline level.',
                header: 'PLNNR(k/*),PLNAL(k/*),VORNR(k/*),OUTLINE(k/*),SRV_LINE(k/*),SHORT_TEXT,QUANTITY,UOM,GROSS_PRICE,PRICE_UNIT',
            },
            {
                structure: 'S_SPACK_LIMITS',
                mode: 'FreeText',
                note: 'Value limits on unplanned services for a step.',
                header: 'PLNNR(k/*),PLNAL(k/*),VORNR(k/*),OVERALL_LIMIT,EXP_VALUE',
            },
            {
                structure: 'S_SPACK_CONTR_LIMIT',
                mode: 'FreeText',
                note: 'Limits drawn against a specific contract and contract item.',
                header: 'PLNNR(k/*),PLNAL(k/*),VORNR(k/*),CONTRACT(k/*),CONTRACT_ITEM(k/*),LIMIT,NO_LIMIT',
            },
        ],
    },
    {
        key: 'maintenanceItem',
        name: 'PM - Maintenance item',
        predecessorCount: 6,
        structures: [
            {
                structure: 'S_ITEM',
                mode: 'FreeText_Mandatory',
                note: 'A maintenance item on its own — no WARPL, because it is not tied to a plan at load time. Its key is WAPOS (the plan object calls the same thing WPPOS), and PSTXT is NOT mandatory here though it is on S_MPOS. MITYP is the item category and WSTRA names a strategy the item follows directly. This is the route for "the scope changed, the plan stays": add items to a plan SAP already has, rather than reloading the plan.',
                header: 'WAPOS(k/*),NRANGE_IND,PSTXT,MITYP,WSTRA,TPLNR,EQUNR,BAUTL,IWERK(*),AUART,QMART,GEWRK,WERGW,WPGRP,ILART,GSBER,PRIOK,NO_AUFRELKZ,TASK_DETERMINE,MAINTCMPLNCCALCULATIONMETHOD,MAINTCMPLNCSTRTDTEOFFSETINDAYS,MAINTCMPLNCENDDATEOFFSETINDAYS,PLNTY,PLNNR,PLNAL,APFKT,ANLZU,MI_TEXT',
            },
            {
                structure: 'S_OBJ_LIST',
                mode: 'FreeText',
                note: 'The item’s object list, keyed on WAPOS alone. The maintenance plan has a structure of the same name with a different key (WARPL + WPPOS + EAMS_OBKNR) — the two files are not interchangeable.',
                header: 'WAPOS(k/*),EAMS_OBKNR(k/*),SORTF,SERNR,MATNR,EQUNR,TPLNR,BAUTL',
            },
        ],
    },
    {
        key: 'maintenancePlan',
        name: 'PM - Maintenance plan',
        predecessorCount: 9,
        predecessors: [
            'PM - Equipment',
            'PM - Equipment task list',
            'PM - Functional location',
            'PM - Functional location task list',
            'PM - General maintenance task list',
            'PM - Maintenance item',
            'PM - Measurement document',
            'PM - Measuring point',
            'Work center/Resource',
        ],
        structures: [
            {
                structure: 'S_MPLA',
                mode: 'FreeText_Mandatory',
                note: 'Plan header: what drives the schedule. ZYKL1/OFFS1/ZEIEH is a single-cycle plan (an exact cadence); STRAT names a strategy instead, and then the cadence lives in the task-list packages. HORIZ/HORIZ_DAYS is the call horizon, ABRHO/HUNIT the scheduling period, and the shift factors (VSPOS/TOPOS/VSNEG/TONEG, SFAKT) decide how the next call moves when a job is done early or late.',
                header: 'WARPL(k/*),NRANGE_IND,MPTYP(*),STRAT,WPTXT,VSPOS,TOPOS,VSNEG,TONEG,SFAKT,FABKL,HORIZ,HORIZ_DAYS,HORIZ_QUALIFIER,ABRHO,HUNIT,CALL_CONFIRM,STADT,STICH,SZAEH,PLAN_SORT,BEGRU,ZYKL1,OFFS1,ZEIEH,PAK_TEXT,POINT,MP_TEXT',
            },
            {
                structure: 'S_MPOS',
                mode: 'FreeText_Mandatory',
                note: 'Maintenance items: what the plan is FOR. One item per object + task list; this is the row that maps to an IREAMS schedule. Note WPPOS, not the load files’ WAPOS. MAINTCMPLNC* is S/4’s maintenance-compliance window and lines up with the compliance definition IREAMS already keeps.',
                header: 'WARPL(k/*),WPPOS(k/*),PSTXT(*),TPLNR,EQUNR,BAUTL,IWERK(*),AUART,QMART,GEWRK,WERGW,WPGRP,ILART,GSBER,PRIOK,NO_AUFRELKZ,TASK_DETERMINE,MAINTCMPLNCCALCULATIONMETHOD,MAINTCMPLNCSTRTDTEOFFSETINDAYS,MAINTCMPLNCENDDATEOFFSETINDAYS,PLNTY,PLNNR,PLNAL,APFKT,ANLZU,MI_TEXT',
            },
            {
                structure: 'S_OBJ_LIST',
                mode: 'FreeText',
                note: 'The item’s object list — every further asset one item covers. This is how one schedule serves many assets, which IREAMS already models on a schedule’s Assets tab.',
                header: 'WARPL(k/*),WPPOS(k/*),EAMS_OBKNR(k/*),SORTF,SERNR,MATNR,EQUNR,TPLNR,BAUTL',
            },
        ],
    },
];

export const COCKPIT_OBJECT_BY_KEY: Record<CockpitObjectKey, CockpitObjectSpec> =
    Object.fromEntries(COCKPIT_OBJECTS.map(o => [o.key, o])) as Record<CockpitObjectKey, CockpitObjectSpec>;

/** Every structure, each carrying the object it belongs to. */
export const ALL_STRUCTURES: { object: CockpitObjectKey; spec: CockpitStructureSpec }[] =
    COCKPIT_OBJECTS.flatMap(o => o.structures.map(spec => ({ object: o.key, spec })));

/**
 * A structure within its object. Scoped, because the names are not unique:
 * the measuring point's only structure is "S_HEADER", and any object may
 * call one of its own the same thing.
 */
export const structureSpec = (object: CockpitObjectKey, structure: string): CockpitStructureSpec | undefined =>
    COCKPIT_OBJECT_BY_KEY[object]?.structures.find(s => s.structure === structure.toUpperCase());

/**
 * Every object that has a structure of this name. A file on its own says
 * only "S_HEADER"; which object it belongs to is the caller's question to
 * answer — from the folder it came in, or by asking.
 */
export const findStructures = (structure: string): { object: CockpitObjectKey; spec: CockpitStructureSpec }[] =>
    ALL_STRUCTURES.filter(s => s.spec.structure === structure.toUpperCase());

/** SAP's own field list for a structure: names, keys, mandatory flags. */
export const columnsOf = (spec: CockpitStructureSpec): CockpitColumn[] =>
    spec.header.split(',').map(parseCockpitColumn);

/** The empty template, byte-identical to the one the cockpit hands out. */
export const templateCsv = (spec: CockpitStructureSpec): string => spec.header;

export const fileNameOf = (spec: CockpitStructureSpec): string =>
    cockpitFileName(spec.structure, spec.mode);
