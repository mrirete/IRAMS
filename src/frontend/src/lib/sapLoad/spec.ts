/**
 * SAP load templates — the eight Migration Cockpit objects, as data.
 *
 * This is the OUTBOUND side of the Migration Center. The inbound profiles
 * (assetTemplates.ts SAP_PROFILES) read migration-cockpit-shaped sheets INTO
 * IREAMS; this spec writes IREAMS master data OUT into the same shape so a
 * plant moving onto SAP PM/MM can load it through the Fiori app "Migrate Your
 * Data" (LTMC). One sheet per migration object, SAP field names on row 4,
 * field descriptions on row 5, data (or examples) from row 6.
 *
 * The shape is the consultant's workbook ("SAP Load Templates — E82 / Client
 * 250"), kept field-for-field so a file produced here drops straight into the
 * process they already run. One deliberate addition: TIDNR on the Equipment
 * sheet, because IREAMS carries two equipment identities (tag + equipment
 * number) and the load should keep both — see cmms-migration-center notes.
 */

export type SapObjectKey =
    | 'functionalLocation'
    | 'equipment'
    | 'material'
    | 'equipmentBom'
    | 'measuringPoint'
    | 'measurementDoc'
    | 'sourceList'
    | 'inventoryBalance';

export interface SapField {
    /** SAP field name — the row-4 header the cockpit keys on. */
    name: string;
    /** Row-5 description. Required fields are prefixed "REQUIRED — " on render. */
    description: string;
    required?: boolean;
    /** Column width (characters). */
    width?: number;
    /** SAP field length, when it is worth enforcing. Longer values are clipped and reported. */
    maxLength?: number;
}

export interface SapObjectSpec {
    key: SapObjectKey;
    /** Load order (1..8) — each depends on those above it. */
    order: number;
    /** Sheet name, ≤31 chars. */
    sheet: string;
    /** Row 1. */
    title: string;
    /** Row 2 — the one-line consultant hint. */
    hint: string;
    /** Short label for the UI. */
    label: string;
    fields: SapField[];
    /** Example rows, in field order — the blank template ships with these. */
    examples: (string | number)[][];
}

/** Row 3 on every object sheet. */
export const ROW3_INSTRUCTION =
    'Row 4 = SAP field name (keep). Row 5 = field description. Row 6 = example. Delete rows 5 and 6, then paste your data from row 5 down.';

const F = (name: string, description: string, opts: Omit<SapField, 'name' | 'description'> = {}): SapField =>
    ({ name, description, ...opts });

export const SAP_OBJECTS: SapObjectSpec[] = [
    {
        key: 'functionalLocation', order: 1, sheet: '1 FunctionalLocation', label: 'Functional Location',
        title: 'Migration object: Functional Location',
        hint: 'Load first. Parents before children. Structure indicator must permit your label format.',
        fields: [
            F('TPLNR', 'Functional location label', { required: true, width: 24, maxLength: 30 }),
            F('PLTXT', 'Description', { required: true, width: 34, maxLength: 40 }),
            F('FLTYP', 'Functional location category (M = technical system)', { required: true, width: 12 }),
            F('TPLKZ', 'Structure indicator', { required: true, width: 12 }),
            F('TPLMA', 'Superior functional location', { width: 22, maxLength: 30 }),
            F('EQART', 'Type of technical object', { width: 14, maxLength: 10 }),
            F('SWERK', 'Maintenance plant', { required: true, width: 12 }),
            F('IWERK', 'Planning plant', { required: true, width: 12 }),
            F('INGRP', 'Planner group', { width: 10, maxLength: 3 }),
            F('KOSTL', 'Cost centre', { width: 12, maxLength: 10 }),
            F('BUKRS', 'Company code', { width: 10, maxLength: 4 }),
            F('KOKRS', 'Controlling area', { width: 12, maxLength: 4 }),
            F('ABCKZ', 'ABC indicator', { width: 10, maxLength: 1 }),
            F('BEBER', 'Plant section', { width: 10, maxLength: 3 }),
            F('STORT', 'Location', { width: 18, maxLength: 10 }),
            F('GEWRK', 'Main work centre', { width: 14, maxLength: 8 }),
            F('BEGRU', 'Authorisation group', { width: 12, maxLength: 4 }),
        ],
        examples: [
            ['SITE-HOU', 'Houston Production Site', 'M', 'YB01', '', 'SITE', '102A', '102A', '', '', '1030', 'A000', '', '', 'Houston TX', '', ''],
            ['SITE-HOU-U300', 'Gas Turbine Generation Unit', 'M', 'YB01', 'SITE-HOU', 'UNIT', '102A', '102A', '', '', '1030', 'A000', '', '', 'Block 300', '', ''],
        ],
    },
    {
        key: 'equipment', order: 2, sheet: '2 Equipment', label: 'Equipment',
        title: 'Migration object: Equipment',
        hint: 'Load after functional locations. Leave EQUNR blank for internal numbering, or supply it to preserve legacy numbers.',
        fields: [
            F('EQUNR', 'Equipment number — blank for internal numbering', { width: 16, maxLength: 18 }),
            F('TIDNR', 'Technical identification number — the field tag on the machine and the P&ID', { width: 16, maxLength: 25 }),
            F('EQKTX', 'Equipment description', { required: true, width: 34, maxLength: 40 }),
            F('EQTYP', 'Equipment category (M = machine)', { required: true, width: 12 }),
            F('EQART', 'Type of technical object', { width: 14, maxLength: 10 }),
            F('TPLNR', 'Functional location — the position tag', { width: 22, maxLength: 30 }),
            F('HEQUI', 'Superior equipment', { width: 16, maxLength: 18 }),
            F('HERST', 'Manufacturer of asset', { width: 18, maxLength: 30 }),
            F('TYPBZ', 'Model number', { width: 18, maxLength: 20 }),
            F('SERGE', 'Manufacturer serial number', { width: 18, maxLength: 30 }),
            F('BAUJJ', 'Year of construction (YYYY)', { width: 10, maxLength: 4 }),
            F('INVNR', 'Inventory number', { width: 12, maxLength: 25 }),
            F('SWERK', 'Maintenance plant', { required: true, width: 12 }),
            F('IWERK', 'Planning plant', { required: true, width: 12 }),
            F('INGRP', 'Planner group', { width: 10, maxLength: 3 }),
            F('KOSTL', 'Cost centre', { width: 12, maxLength: 10 }),
            F('BUKRS', 'Company code', { width: 10, maxLength: 4 }),
            F('ABCKZ', 'ABC indicator (A/B/C/D)', { width: 10, maxLength: 1 }),
            F('BEBER', 'Plant section', { width: 10, maxLength: 3 }),
            F('STORT', 'Location', { width: 18, maxLength: 10 }),
            F('GEWRK', 'Main work centre', { width: 14, maxLength: 8 }),
            F('ANSDT', 'Acquisition date (DD.MM.YYYY)', { width: 14 }),
            F('ANSWT', 'Acquisition value', { width: 14 }),
        ],
        examples: [
            ['2000001222', 'PMP-101A', 'Centrifugal pump - cooling water', 'M', 'PUMP', 'SITE-HOU-U300', '', 'KSB', 'Etanorm 065-050', 'KSB-2019-04471', '2019', '', '102A', '102A', '', '', '1030', 'A', '', 'Block 300', '', '', ''],
        ],
    },
    {
        key: 'material', order: 3, sheet: '3 Material', label: 'Material',
        title: 'Migration object: Product (Material)',
        hint: 'Material type drives number range, valuation and which views are permitted. Map SPARE to ERSA, CONSUMABLE to VERB, TOOL to HIBE, MATERIAL to ROH.',
        fields: [
            F('MATNR', 'Material number', { required: true, width: 16, maxLength: 40 }),
            F('MAKTX', 'Material description', { required: true, width: 34, maxLength: 40 }),
            F('MTART', 'Material type', { required: true, width: 10 }),
            F('MATKL', 'Material group', { required: true, width: 12, maxLength: 9 }),
            F('MEINS', 'Base unit of measure', { required: true, width: 10, maxLength: 3 }),
            F('BISMT', 'Old / legacy material number', { width: 16, maxLength: 40 }),
            F('MFRNR', 'Manufacturer (business partner)', { width: 18, maxLength: 10 }),
            F('MFRPN', 'Manufacturer part number', { width: 18, maxLength: 40 }),
            F('WERKS', 'Plant', { required: true, width: 8 }),
            F('DISMM', 'MRP type (VB = reorder point)', { width: 10 }),
            F('DISPO', 'MRP controller', { width: 10, maxLength: 3 }),
            F('MINBE', 'Reorder point', { width: 10 }),
            F('MABST', 'Maximum stock level', { width: 12 }),
            F('EKGRP', 'Purchasing group', { width: 10, maxLength: 3 }),
            F('MAABC', 'ABC indicator — usable as critical-spare flag', { width: 10, maxLength: 1 }),
            F('LGORT', 'Storage location', { width: 10, maxLength: 4 }),
            F('LGPBE', 'Storage bin', { width: 12, maxLength: 10 }),
            F('BWKEY', 'Valuation area', { required: true, width: 10 }),
            F('BKLAS', 'Valuation class', { required: true, width: 10 }),
            F('VPRSV', 'Price control (S or V)', { required: true, width: 10 }),
            F('STPRS', 'Standard price — when VPRSV = S', { width: 14 }),
            F('VERPR', 'Moving average price — when VPRSV = V', { width: 14 }),
            F('PEINH', 'Price unit', { required: true, width: 8 }),
        ],
        examples: [
            ['FLT-0023', 'Air Inlet Filter 24x24x12', 'ERSA', 'YBSPARE', 'EA', '', '', '', '102A', 'VB', '001', 4, 16, '001', 'A', '0001', 'C2-01-4-2', '102A', '3040', 'V', '', 245.0, 1],
            ['LUB-0012', 'Synthetic Turbine Oil ISO 32', 'VERB', 'YBCONS', 'L', '', '', '', '102A', 'VB', '001', 40, 200, '001', 'C', '0001', 'D1-05-2-1', '102A', '3030', 'V', '', 18.5, 1],
        ],
    },
    {
        key: 'equipmentBom', order: 4, sheet: '4 EquipmentBOM', label: 'Equipment BOM',
        title: 'Migration object: Equipment Bill of Material',
        hint: 'Header and items load together. BOM usage 4 is the maintenance usage. Components must already exist as materials.',
        fields: [
            F('EQUNR', 'Equipment the BOM belongs to', { required: true, width: 16, maxLength: 18 }),
            F('STLAN', 'BOM usage (4 = maintenance)', { required: true, width: 10 }),
            F('STLAL', 'Alternative BOM', { width: 10 }),
            F('BMENG', 'Base quantity of the header', { required: true, width: 10 }),
            F('BMEIN', 'Base unit of the header', { required: true, width: 10, maxLength: 3 }),
            F('STKTX', 'BOM header text', { width: 34, maxLength: 40 }),
            F('POSNR', 'Item number (0010, 0020 …)', { required: true, width: 10 }),
            F('POSTP', 'Item category (L stock, N non-stock, T text)', { required: true, width: 10 }),
            F('IDNRK', 'Component material', { required: true, width: 16, maxLength: 40 }),
            F('MENGE', 'Component quantity', { required: true, width: 10 }),
            F('MEINS', 'Component unit of measure', { required: true, width: 10, maxLength: 3 }),
            F('POTX1', 'Item text line 1 — use for non-stock or notes', { width: 34, maxLength: 40 }),
            F('SANKA', 'Costing relevance', { width: 10 }),
            F('AUSCH', 'Component scrap in percent', { width: 10 }),
        ],
        examples: [
            ['EQ-000101', '4', '01', 1, 'EA', 'Gas turbine GT-301 maintenance BOM', '0010', 'L', 'FLT-0023', 4, 'EA', 'Critical spare', '', ''],
            ['EQ-000101', '4', '01', 1, 'EA', '', '0020', 'L', 'BRG-0041', 1, 'EA', 'Critical spare', '', ''],
        ],
    },
    {
        key: 'measuringPoint', order: 5, sheet: '5 MeasuringPoint', label: 'Measuring Point',
        title: 'Migration object: Measuring Point',
        hint: 'Create the characteristics in CT04 first. Set the counter indicator for HOURS and KM so counter-based plans can schedule.',
        fields: [
            F('MPOBJ', 'Reference object — equipment number', { required: true, width: 16 }),
            F('MPTYP', 'Measuring point category', { width: 10, maxLength: 1 }),
            F('PSORT', 'Position / identification at the object', { required: true, width: 14, maxLength: 20 }),
            F('PTTXT', 'Measuring point description', { required: true, width: 34, maxLength: 40 }),
            F('ATNAM', 'Characteristic name (CT04)', { required: true, width: 16, maxLength: 30 }),
            F('MRNGU', 'Unit of measurement', { required: true, width: 10, maxLength: 3 }),
            F('INDCT', 'Counter indicator — X for a counter', { width: 10 }),
            F('DECIM', 'Decimal places', { width: 8 }),
            F('MRMIN', 'Lower measurement range limit', { width: 12 }),
            F('MRMAX', 'Upper measurement range limit', { width: 12 }),
            F('ATVLO', 'Lower alarm limit', { width: 12 }),
            F('ATVUP', 'Upper alarm limit', { width: 12 }),
            F('CYCLE', 'Annual estimate for a counter', { width: 14 }),
        ],
        examples: [
            ['EQ-000101', '', 'RUNHOURS', 'Turbine running hours', 'YB_HOURS', 'hrs', 'X', 0, '', '', '', '', 8000],
            ['EQ-000101', '', 'VIB-DE', 'Drive end bearing vibration', 'YB_VIBRATION', 'mm/s', '', 1, 0, 20, '', 7.1, ''],
        ],
    },
    {
        key: 'measurementDoc', order: 6, sheet: '6 MeasurementDoc', label: 'Measurement Document',
        title: 'Measurement documents — historical readings',
        hint: 'No standard migration object on every release. Load with BAPI_MEASUREMENTDOCUM_CREATE, an LSMW recording over IK11, or accept that history starts at go-live.',
        fields: [
            F('POINT', 'Measuring point number — blank when loading by object and position', { width: 14 }),
            F('MPOBJ', 'Reference object — equipment', { width: 16 }),
            F('PSORT', 'Position, if loading by object and position', { width: 14, maxLength: 20 }),
            F('IDATE', 'Date of measurement (DD.MM.YYYY)', { required: true, width: 14 }),
            F('ITIME', 'Time of measurement (HH:MM:SS)', { width: 12 }),
            F('READG', 'Measured value — for measuring points', { width: 14 }),
            F('RECDV', 'Counter reading difference — for counters', { width: 14 }),
            F('CNTRR', 'Total counter reading', { width: 14 }),
            F('MRNGU', 'Unit', { width: 8, maxLength: 3 }),
            F('MDTXT', 'Short text', { width: 30, maxLength: 40 }),
            F('ABLES', 'Read by', { width: 14, maxLength: 12 }),
        ],
        examples: [
            ['', 'EQ-000101', 'RUNHOURS', '31.01.2026', '23:59:00', '', '', 48210, 'hrs', 'Month-end counter read', ''],
            ['', 'EQ-000101', 'VIB-DE', '14.02.2026', '09:15:00', 4.2, '', '', 'mm/s', 'Route 12 DE bearing', ''],
        ],
    },
    {
        key: 'sourceList', order: 7, sheet: '7 SourceList', label: 'Source List',
        title: 'Migration object: Source List — preferred supplier',
        hint: 'Only needed where a preferred supplier matters. The alternative is a purchasing info record.',
        fields: [
            F('MATNR', 'Material number', { required: true, width: 16, maxLength: 40 }),
            F('WERKS', 'Plant', { required: true, width: 8 }),
            F('VDATU', 'Valid from (DD.MM.YYYY)', { required: true, width: 14 }),
            F('BDATU', 'Valid to (DD.MM.YYYY)', { required: true, width: 14 }),
            F('LIFNR', 'Supplier', { required: true, width: 14, maxLength: 10 }),
            F('EKORG', 'Purchasing organisation', { required: true, width: 12, maxLength: 4 }),
            F('FLIFN', 'Fixed supplier indicator — X', { width: 10 }),
            F('AUTET', 'MRP relevance', { width: 10 }),
        ],
        examples: [
            ['FLT-0023', '102A', '01.01.2026', '31.12.9999', '1000020', '1030', 'X', '1'],
        ],
    },
    {
        key: 'inventoryBalance', order: 8, sheet: '8 InventoryBalance', label: 'Inventory Balance',
        title: 'Migration object: Inventory Balance — opening stock',
        hint: 'Stock is transactional, never master data. This posts an opening balance. The alternative is a 561 goods movement in MIGO.',
        fields: [
            F('MATNR', 'Material number', { required: true, width: 16, maxLength: 40 }),
            F('WERKS', 'Plant', { required: true, width: 8 }),
            F('LGORT', 'Storage location', { required: true, width: 10, maxLength: 4 }),
            F('BWTAR', 'Valuation type — only for split-valuated materials', { width: 14 }),
            F('CHARG', 'Batch — only for batch-managed materials', { width: 14 }),
            F('MENGE', 'Quantity', { required: true, width: 10 }),
            F('MEINS', 'Unit of measure', { required: true, width: 10, maxLength: 3 }),
            F('BUDAT', 'Posting date (DD.MM.YYYY)', { required: true, width: 14 }),
            F('BWART', 'Movement type (561 = initial stock)', { required: true, width: 12 }),
        ],
        examples: [
            ['FLT-0023', '102A', '0001', '', '', 8, 'EA', '17.08.2026', '561'],
            ['1000000001', '102A', '0001', 'REFURB', '', 3, 'EA', '17.08.2026', '561'],
        ],
    },
];

export const SAP_OBJECT_BY_KEY: Record<SapObjectKey, SapObjectSpec> = Object.fromEntries(
    SAP_OBJECTS.map(o => [o.key, o]),
) as Record<SapObjectKey, SapObjectSpec>;

/** Rendered row-5 text: required fields say so in the cell itself (no colour needed). */
export function fieldDescription(f: SapField): string {
    return f.required ? `REQUIRED — ${f.description}` : f.description;
}
