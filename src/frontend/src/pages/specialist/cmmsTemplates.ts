/**
 * cmmsTemplates — downloadable .xlsx templates for the Import CMMS Data wizard.
 *
 * These are NOT the Asset Register's native import template (assetTemplates.ts,
 * ERS_Asset_Import_Template.xlsx). That one speaks the ERS schema and builds
 * the full hierarchy through the module's own importer. These speak the SOURCE
 * system's column names — the exact headers the cmms_analyst agent fingerprints
 * (see agent-run/agents.ts) — so a filled template auto-maps in the wizard.
 * The two Read-me sheets cross-reference each other so users land in the right
 * importer for the job.
 *
 * Data sheet must stay FIRST: the wizard parses only SheetNames[0].
 */
import * as XLSX from 'xlsx';
import { downloadWorkbook } from '../../eam/services/assetTemplates';

export interface CmmsTemplate {
    label: string;
    filename: string;
    build: () => XLSX.WorkBook;
}

function makeWorkbook(
    dataSheetName: string,
    headers: string[],
    exampleRows: (string | number)[][],
    widths: number[],
    readme: string[][],
): XLSX.WorkBook {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...exampleRows]);
    ws['!cols'] = widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, dataSheetName);
    const rm = XLSX.utils.aoa_to_sheet(readme);
    rm['!cols'] = [{ wch: 28 }, { wch: 150 }];
    XLSX.utils.book_append_sheet(wb, rm, 'Read me');
    return wb;
}

const SHARED_FOOTER: string[][] = [
    [''],
    ['The rows on the first sheet are EXAMPLES — delete them before pasting your own data.'],
    ['Keep the data sheet FIRST — the wizard reads only the first sheet of the workbook.'],
    ['Nothing is written until you confirm at the final wizard step; the file itself never leaves your browser.'],
];

// ── SAP PM: work-order history (IW38 / IW39 / IW47 layout) ────────────────
const sapWorkOrderHistory: CmmsTemplate = {
    label: 'Work-order history (IW38/IW39)',
    filename: 'IREAMS_SAP_WorkOrderHistory_Template.xlsx',
    build: () => makeWorkbook(
        'Work Order History',
        ['Order', 'Order Type', 'Description', 'Equipment', 'Functional loc.',
            'Basic start date', 'Actual start', 'Actual finish', 'Basic fin. date',
            'Priority', 'System status', 'Breakdown', 'Breakdown dur.', 'Actual work',
            'Total act.costs', 'Damage', 'Cause code', 'Activity'],
        [
            ['4500001231', 'PM01', 'Pump seal leak - replace mechanical seal', 'PMP-101A', 'PLT1-CWS-PMP-101A', '03.02.2025', '10.02.2025', '11.02.2025', '05.02.2025', '1', 'TECO CNF', 'X', 6.5, 9, 1250, 'Leakage', 'Seal wear', 'Replaced mechanical seal'],
            ['4500001248', 'PM02', '6-monthly service - lube oil change and inspection', 'CMP-201', 'PLT1-IAS-CMP-201', '14.03.2025', '14.03.2025', '14.03.2025', '14.03.2025', '3', 'TECO', '', '', 4, 320, '', '', 'Routine service completed'],
            ['4500001305', 'PM03', 'Vibration alert follow-up - bearing check DE side', 'FAN-310', 'PLT1-BLR3-FAN-310', '02.04.2025', '02.04.2025', '04.04.2025', '04.04.2025', '2', 'CLSD CNF', 'X', 12, 14, 2840, 'Vibration', 'Bearing failure', 'Replaced DE bearing, realigned'],
            ['4500001377', 'PM05', 'Statutory inspection - pressure safety valve', 'VSL-120', 'PLT1-IAS-VSL-120', '21.05.2025', '21.05.2025', '21.05.2025', '21.05.2025', '2', 'TECO', '', '', 3, 450, '', '', 'PSV tested and recertified'],
            ['4500001412', 'PM01', 'Area lighting repair - boiler house walkway', '', 'PLT1-BLR3', '09.06.2025', '', '', '', '1', 'REL', '', '', '', '', '', '', ''],
        ],
        [12, 10, 46, 12, 18, 15, 13, 13, 15, 8, 13, 11, 13, 12, 14, 12, 14, 34],
        [
            ['IREAMS — SAP PM work-order history template'],
            [''],
            ['Where the data comes from', 'SAP transaction IW38 or IW39 (order list). ONE ROW PER ORDER — operation/confirmation-level exports (IW47/IW49) carry one row per operation, and surplus rows are reported as duplicates. Set your layout to include the columns on the first sheet, then export to spreadsheet and paste rows under the headers.'],
            [''],
            ['Do not rename headers', 'The Specialist recognises these exact SAP column names and maps them automatically. Extra columns are fine — they are simply left unmapped.'],
            ['Required per row', 'Order (work-order number), Equipment OR Functional loc., a start date. Rows missing any of these are skipped and reported.'],
            ['Equipment', 'Whatever identity your order list carries — the field tag (TechIdentNo.) or the SAP equipment number (EQUNR). Import the equipment register first and orders link to their assets by either one.'],
            ['Functional loc.', 'Orders raised against a position with no equipment (area work) are normal — they link by this column instead of being dropped.'],
            ['Dates', 'DD.MM.YYYY (SAP default). Actual start / Actual finish are the EVENT dates — include them if your layout has them; Basic dates are planning dates and can sit weeks away from the real failure (they distort MTBF and seasonality if used alone).'],
            ['Order Type', 'PM01 = corrective, PM02 = preventive is common — but order types are configured per plant (vanilla PM03 is refurbishment, not predictive). Check your plant’s key; the wizard’s mapping step lets you correct each type before anything imports.'],
            ['System status', 'TECO / CLSD = closed, REL / CRTD = open, in-progress codes = WIP. Full status strings like "TECO CNF PRC" are fine — statuses are matched token by token.'],
            ['Breakdown', 'The MSAUS indicator — X = the equipment lost its function. THE most valuable single column for failure analysis: without it every corrective order counts as a failure, which over-counts MTBF events. Leave blank where not recorded.'],
            ['Breakdown dur.', 'Downtime hours (number). Optional but powers availability and bad-actor analysis.'],
            ['Actual work', 'Actual labour hours from confirmations (IW49 totals). Optional; powers maintainability (MTTR) and crew-load analysis.'],
            ['Malfunction start / end', 'If your layout (or an IW28/IW29 notification export) carries the malfunction window, include those columns too — they auto-map and become the preferred failure-event times over paperwork dates.'],
            ['Total act.costs', 'Number, no currency symbol needed. If you can export labor and material separately, add those columns — the Specialist will pick them up.'],
            ['Damage / Cause code / Activity', 'Failure mode, failure cause and remedy. Optional; from notifications (IW69) if your orders do not carry them. They unlock failure-mode analysis.'],
            ...SHARED_FOOTER,
        ],
    ),
};

// ── SAP PM: equipment register (IH06 / IE05 layout) ───────────────────────
const sapEquipmentRegister: CmmsTemplate = {
    label: 'Equipment register (IH06/IE05)',
    filename: 'IREAMS_SAP_EquipmentRegister_Template.xlsx',
    build: () => makeWorkbook(
        'Equipment List',
        ['Equipment', 'TechIdentNo.', 'Functional loc.', 'Description of technical object', 'Object type',
            'Manufacturer of asset', 'Model number', 'ManufSerialNumber', 'ABC indic.'],
        [
            ['10004521', 'PMP-101A', 'PLT1-CWS-PMP-101A', 'Centrifugal pump - cooling water train A', 'PUMP', 'KSB', 'Etanorm 065-050', 'KSB-2019-04471', 'A'],
            ['10004736', 'CMP-201', 'PLT1-IAS-CMP-201', 'Reciprocating air compressor - instrument air', 'COMPRESSOR', 'Atlas Copco', 'GA 75 VSD+', 'ACP-2021-11832', 'B'],
            ['10005012', 'FAN-310', 'PLT1-BLR3-FAN-310', 'Induced draft fan - boiler no. 3', 'FAN', 'Howden', 'HV-900', 'HWD-2018-00291', 'A'],
            ['10005288', 'VSL-120', 'PLT1-IAS-VSL-120', 'Air receiver vessel 5 m3', 'VESSEL', 'CIRCOR', 'AR-5000', 'CIR-2017-33810', 'C'],
            ['10005417', 'MTR-415', 'PLT1-CNV-MTR-415', 'Electric motor 75 kW - conveyor drive', 'MOTOR', 'WEG', 'W22 280S/M', 'WEG-2020-77452', 'B'],
        ],
        [12, 13, 20, 44, 14, 20, 18, 18, 10],
        [
            ['IREAMS — SAP equipment register template'],
            [''],
            ['Where the data comes from', 'SAP transaction IH06 (functional location / equipment structure) or IE05 (equipment list). Export the list to spreadsheet and paste rows under the headers on the first sheet.'],
            [''],
            ['TWO IDENTITIES, both kept', 'SAP equipment carries two identities and IREAMS stores both. Equipment = the SAP equipment number (EQUNR) — the system’s own id, long digits under internal numbering. TechIdentNo. = the technical identification number (TIDNR) — the tag painted on the machine and written on the P&ID. TechIdentNo. becomes the IREAMS asset tag; Equipment is kept as the Equipment Number, and work-order history links by either one.'],
            ['External numbering?', 'If your plant uses external numbering (Equipment already IS the field tag, e.g. PMP-101A) or does not maintain TIDNR, leave TechIdentNo. blank — the Equipment value then serves as both identities.'],
            ['Functional loc.', 'The FL path (TPLNR) the equipment is installed at. Optional; kept as a reference property on the asset — this import does not build the tree (see below).'],
            [''],
            ['Do not rename headers', 'The Specialist recognises these SAP column names and maps them automatically.'],
            ['Required per row', 'Equipment. TechIdentNo. is strongly recommended under internal numbering — without it, assets are named by their EQUNR digits, which nobody in the field recognises. Everything else is optional but improves the assessment.'],
            ['ABC indic.', 'Criticality A / B / C / D. If your plant does not maintain the ABC indicator, leave it blank — assets import unranked.'],
            ['Object type', 'Free text; becomes the asset category (PUMP, MOTOR, VESSEL, ...).'],
            [''],
            ['This import creates a FLAT equipment list', 'It exists to anchor work-order history for reliability analysis. To migrate a full hierarchy (site → unit → system → equipment, parent links, functional locations), use the Asset Register’s own import instead: Assets › Import › Download Template (ERS_Asset_Import_Template.xlsx). Both importers keep the same two identities, so you can build the tree there first and still import history here.'],
            ['Import order', 'Register FIRST, then the work-order history — orders link to assets by the Equipment column (tag or equipment number, both match).'],
            ...SHARED_FOOTER,
        ],
    ),
};

// ── IBM Maximo: work-order history (Work Order Tracking download) ─────────
const maximoWorkOrderHistory: CmmsTemplate = {
    label: 'Work-order history (WO Tracking)',
    filename: 'IREAMS_Maximo_WorkOrderHistory_Template.xlsx',
    build: () => makeWorkbook(
        'Work Order History',
        ['WONUM', 'DESCRIPTION', 'WORKTYPE', 'STATUS', 'WOPRIORITY', 'SITEID',
            'ASSETNUM', 'LOCATION', 'REPORTDATE', 'ACTSTART', 'ACTFINISH',
            'ACTLABHRS', 'ACTLABCOST', 'ACTMATCOST', 'PROBLEMCODE'],
        [
            ['1001', 'Pump seal leak - replace mechanical seal', 'CM', 'CLOSE', '1', 'HOU', '11450', 'CWS-PMP-101A', '2025-02-03', '2025-02-10', '2025-02-11', 9, 850, 400, 'LEAK'],
            ['1002', '6-monthly service - lube oil and filters', 'PM', 'COMP', '3', 'HOU', '11487', 'IAS-CMP-201', '2025-03-14', '2025-03-14', '2025-03-14', 4, 320, 0, ''],
            ['1003', 'Vibration alert - DE bearing check', 'PDM', 'CLOSE', '2', 'HOU', '11502', 'BLR3-FAN-310', '2025-04-02', '2025-04-02', '2025-04-04', 14, 1200, 1640, 'VIB'],
            ['1004', 'Walkway lighting repair - boiler house', 'CM', 'COMP', '2', 'HOU', '', 'BLR3', '2025-05-21', '2025-05-21', '2025-05-21', 2, 180, 45, ''],
            ['1005', 'Motor tripping on overload - investigate', 'EM', 'INPRG', '1', 'HOU', '11529', 'CNV-MTR-415', '2025-06-09', '2025-06-09', '', '', '', '', ''],
        ],
        [10, 44, 10, 9, 10, 8, 11, 16, 13, 13, 13, 11, 12, 12, 13],
        [
            ['IREAMS — Maximo work-order history template'],
            [''],
            ['Where the data comes from', 'Maximo: Work Order Tracking → filter your orders → Download (CSV). ONE ROW PER WORK ORDER — not per task/labor transaction.'],
            [''],
            ['Do not rename headers', 'The Specialist recognises these Maximo column names and maps them automatically. Extra columns are fine — they are left unmapped.'],
            ['Required per row', 'WONUM, ASSETNUM or LOCATION, REPORTDATE. Rows missing any of these are skipped and reported.'],
            ['ASSETNUM / LOCATION', 'Maximo’s two identities: ASSETNUM is the object, LOCATION the operating position. Orders carrying only a LOCATION (area work) link by it instead of being dropped. Import the asset register first so orders land on existing assets.'],
            ['SITEID', 'WONUM is unique per site. If your export spans multiple sites, either import one site at a time or prefix WONUM with the site (HOU-1001) — repeated WONUMs across sites are otherwise reported as duplicates.'],
            ['STATUS', 'COMP / CLOSE = closed, CAN = cancelled, WAPPR / APPR = open, INPRG = in progress.'],
            ['WORKTYPE', 'CM / EM = corrective, PM = preventive, PDM = predictive. Other values default to corrective.'],
            ['Dates', 'ACTSTART / ACTFINISH are the event dates — REPORTDATE alone works but planning lag distorts failure timing.'],
            ['Costs / hours', 'ACTLABCOST / ACTMATCOST as plain numbers — the single most valuable input for money-ranked findings. ACTLABHRS (actual labour hours) powers maintainability and crew-load analysis.'],
            ...SHARED_FOOTER,
        ],
    ),
};

// ── IBM Maximo: asset register (Assets application download) ──────────────
const maximoAssetRegister: CmmsTemplate = {
    label: 'Asset register (Assets app)',
    filename: 'IREAMS_Maximo_AssetRegister_Template.xlsx',
    build: () => makeWorkbook(
        'Asset List',
        ['ASSETNUM', 'DESCRIPTION', 'ASSETTYPE', 'LOCATION', 'SITEID',
            'MANUFACTURER', 'SERIALNUM', 'PRIORITY'],
        [
            ['11450', 'Centrifugal pump - cooling water train A', 'PUMP', 'CWS-PMP-101A', 'HOU', 'KSB', 'KSB-2019-04471', '1'],
            ['11487', 'Reciprocating air compressor - instrument air', 'COMPRESSOR', 'IAS-CMP-201', 'HOU', 'Atlas Copco', 'ACP-2021-11832', '2'],
            ['11502', 'Induced draft fan - boiler no. 3', 'FAN', 'BLR3-FAN-310', 'HOU', 'Howden', 'HWD-2018-00291', '1'],
            ['11529', 'Electric motor 75 kW - conveyor drive', 'MOTOR', 'CNV-MTR-415', 'HOU', 'WEG', 'WEG-2020-77452', '2'],
        ],
        [11, 44, 14, 16, 8, 20, 18, 10],
        [
            ['IREAMS — Maximo asset register template'],
            [''],
            ['Where the data comes from', 'Maximo: Assets application → filter → Download (CSV). Paste rows under the headers on the first sheet.'],
            [''],
            ['TWO IDENTITIES, both kept', 'ASSETNUM is Maximo’s object id — often autonumbered digits — and LOCATION is the operating position (the tag people actually use). ASSETNUM becomes the IREAMS asset tag and LOCATION is kept as the functional-location reference; work-order history links by either. If your ASSETNUMs are bare digit runs, the import will warn — consider using the location or alias column as the tag instead (the wizard’s mapping step lets you swap them).'],
            ['Required per row', 'ASSETNUM. Everything else is optional but improves the assessment.'],
            ['PRIORITY', 'Asset priority 1-4 → criticality A-D (1 = most critical). Leave blank to import unranked.'],
            [''],
            ['This import creates a FLAT asset list', 'To build a full hierarchy (sites, systems, parent links), use the Asset Register’s own import instead: Assets › Import › Download Template. Both match on the same identities.'],
            ['Import order', 'Register FIRST, then the work-order history.'],
            ...SHARED_FOOTER,
        ],
    ),
};

// ── MaintainX: work-order history + asset export ──────────────────────────
const maintainxWorkOrderHistory: CmmsTemplate = {
    label: 'Work-order history (Reporting export)',
    filename: 'IREAMS_MaintainX_WorkOrderHistory_Template.xlsx',
    build: () => makeWorkbook(
        'Work Order History',
        ['Work Order ID', 'Title', 'Description', 'Status', 'Priority',
            'Asset', 'Location', 'Categories', 'Created On', 'Completed On',
            'Time Spent (Hours)', 'Labor Cost', 'Parts Cost', 'Downtime (Hours)'],
        [
            ['2201', 'Pump seal leak - replace mechanical seal', 'Seal replaced, aligned, test run OK', 'Done', 'High', 'PMP-101A', 'Cooling Water', 'Reactive', '2025-02-03', '2025-02-05', 9, 850, 400, 6.5],
            ['2202', '6-monthly compressor service', 'Lube oil change and inspection', 'Done', 'Medium', 'CMP-201', 'Compressor House', 'Preventive', '2025-03-14', '2025-03-14', 4, 320, 0, ''],
            ['2203', 'Vibration alert - check DE bearing', 'DE bearing replaced and realigned', 'Done', 'High', 'FAN-310', 'Boiler 3', 'Reactive', '2025-04-02', '2025-04-04', 14, 1200, 1640, 12],
            ['2204', 'Motor tripping on overload', 'Under investigation', 'In Progress', 'High', 'MTR-415', 'Conveyor Bay', 'Reactive', '2025-06-09', '', '', '', '', ''],
        ],
        [13, 40, 40, 11, 9, 12, 16, 12, 12, 13, 15, 11, 11, 14],
        [
            ['IREAMS — MaintainX work-order history template'],
            [''],
            ['Where the data comes from', 'MaintainX: Reporting → Work Orders → Export CSV. One row per work order.'],
            [''],
            ['Required per row', 'Work Order ID, Asset, Created On. Rows missing any of these are skipped and reported.'],
            ['Status', 'Done / Complete = closed, In Progress / On Hold = in progress, Open = open.'],
            ['Categories', 'Reactive = corrective, Preventive = preventive; other wording also works — the Specialist translates it.'],
            ['Labor Cost / Parts Cost', 'Plain numbers — the single most valuable input for money-ranked findings. If your plan exports only a combined total, put it in one column named Total Cost instead; it maps automatically.'],
            ['Time Spent (Hours)', 'Actual labour hours. Optional; powers maintainability (MTTR) and crew-load analysis.'],
            ['Downtime (Hours)', 'How long the equipment was actually down. Optional; powers availability and bad-actor analysis.'],
            ...SHARED_FOOTER,
        ],
    ),
};

const maintainxAssetRegister: CmmsTemplate = {
    label: 'Asset register (Assets export)',
    filename: 'IREAMS_MaintainX_AssetRegister_Template.xlsx',
    build: () => makeWorkbook(
        'Asset List',
        ['Name', 'Description', 'Location', 'Parent Asset', 'Manufacturer', 'Model', 'Serial Number', 'Criticality'],
        [
            ['PMP-101A', 'Centrifugal pump - cooling water train A', 'Cooling Water', '', 'KSB', 'Etanorm 065-050', 'KSB-2019-04471', 'High'],
            ['CMP-201', 'Reciprocating air compressor - instrument air', 'Compressor House', '', 'Atlas Copco', 'GA 75 VSD+', 'ACP-2021-11832', 'Medium'],
            ['MTR-415', 'Electric motor 75 kW - conveyor drive', 'Conveyor Bay', '', 'WEG', 'W22 280S/M', 'WEG-2020-77452', 'Medium'],
        ],
        [14, 44, 16, 14, 20, 18, 18, 11],
        [
            ['IREAMS — MaintainX asset register template'],
            [''],
            ['Where the data comes from', 'MaintainX: Assets → ⋯ → Export. Paste rows under the headers on the first sheet.'],
            ['Required per row', 'Name (the unique asset). Everything else is optional but improves the assessment.'],
            ['Criticality', 'High / Medium / Low map to A / B / C. Leave blank to import unranked.'],
            [''],
            ['This import creates a FLAT asset list', 'To build a full hierarchy, use the Asset Register’s own import instead: Assets › Import › Download Template. Both match on the same name/tag.'],
            ['Import order', 'Register FIRST, then the work-order history — orders link to assets by name.'],
            ...SHARED_FOOTER,
        ],
    ),
};

// ── Generic spreadsheet (no CMMS) ─────────────────────────────────────────
const genericWorkOrderHistory: CmmsTemplate = {
    label: 'Work-order history (blank)',
    filename: 'IREAMS_WorkOrderHistory_Template.xlsx',
    build: () => makeWorkbook(
        'Work Order History',
        ['WO Number', 'Title', 'Asset Tag', 'Work Type', 'Status', 'Priority',
            'Date Raised', 'Date Completed', 'Labor Cost', 'Material Cost',
            'Labor Hours', 'Breakdown', 'Downtime Hours', 'Failure Mode', 'Failure Cause', 'Remedy'],
        [
            ['WO-0001', 'Pump seal leak - replace mechanical seal', 'PMP-101A', 'CM', 'CLOSED', 'HIGH', '2025-02-03', '2025-02-05', 850, 400, 9, 'YES', 6.5, 'Leakage', 'Seal wear', 'Replaced mechanical seal'],
            ['WO-0002', '6-monthly service - lube oil change', 'CMP-201', 'PM', 'CLOSED', 'MEDIUM', '2025-03-14', '2025-03-14', 320, 0, 4, 'NO', '', '', '', 'Routine service completed'],
            ['WO-0003', 'Vibration alert - bearing check DE side', 'FAN-310', 'PdM', 'CLOSED', 'HIGH', '2025-04-02', '2025-04-04', 1200, 1640, 14, 'YES', 12, 'Vibration', 'Bearing failure', 'Replaced DE bearing, realigned'],
        ],
        [12, 44, 12, 11, 10, 10, 14, 16, 11, 13, 12, 11, 15, 13, 14, 32],
        [
            ['IREAMS — work-order history template (any CMMS or paper records)'],
            [''],
            ['One row per work order', 'Fill from any source — an old CMMS export, a maintenance log, even paper records typed up.'],
            ['Required per row', 'WO Number, Asset Tag, Date Raised. Rows missing any of these are skipped and reported.'],
            ['Work Type', 'CM (corrective), PM (preventive), PdM (predictive), INSPECTION, SAFETY. Your own wording also works — the Specialist translates it.'],
            ['Status', 'CLOSED, OPEN, WIP, CANCELLED. Historical exports are mostly CLOSED.'],
            ['Dates', 'ISO (2025-02-03) is safest; DD/MM/YYYY also works.'],
            ['Costs / Downtime / Labor Hours', 'Plain numbers (currency symbols and 1.234,56-style separators are handled). Optional, but cost data is the single most valuable input for money-ranked findings; labor hours power maintainability analysis.'],
            ['Only a combined cost figure?', 'Replace the two cost columns with a single one named Total Cost — it maps automatically and is used whenever labor/material are not given separately.'],
            ['Breakdown', 'YES = the equipment lost its function, NO = planned/non-failure work, blank = not recorded. Without it, every corrective order counts as a failure — which over-counts.'],
            ['Failure Mode / Cause / Remedy', 'Optional; unlocks failure-mode analysis.'],
            ...SHARED_FOOTER,
        ],
    ),
};

const genericAssetRegister: CmmsTemplate = {
    label: 'Asset register (blank)',
    filename: 'IREAMS_AssetRegister_Template.xlsx',
    build: () => makeWorkbook(
        'Asset Register',
        ['Asset Tag', 'Asset Name', 'Category', 'Manufacturer', 'Model', 'Serial Number', 'Criticality'],
        [
            ['PMP-101A', 'Centrifugal pump - cooling water train A', 'PUMP', 'KSB', 'Etanorm 065-050', 'KSB-2019-04471', 'A'],
            ['CMP-201', 'Reciprocating air compressor - instrument air', 'COMPRESSOR', 'Atlas Copco', 'GA 75 VSD+', 'ACP-2021-11832', 'B'],
            ['MTR-415', 'Electric motor 75 kW - conveyor drive', 'MOTOR', 'WEG', 'W22 280S/M', 'WEG-2020-77452', 'B'],
        ],
        [12, 44, 14, 20, 18, 18, 11],
        [
            ['IREAMS — asset register template (any CMMS or paper records)'],
            [''],
            ['Required per row', 'Asset Tag (unique). Everything else is optional but improves the assessment.'],
            ['Criticality', 'A / B / C / D (A = most critical). Leave blank to import unranked.'],
            [''],
            ['This import creates a FLAT equipment list', 'To build a full hierarchy (sites, units, systems, parent links), use the Asset Register’s own import instead: Assets › Import › Download Template. Both match on the same tag.'],
            ['Import order', 'Register FIRST, then the work-order history — orders link to assets by tag.'],
            ...SHARED_FOOTER,
        ],
    ),
};

/** Templates offered per source system; sources without one fall back to the generic pair. */
const TEMPLATES: Record<string, CmmsTemplate[]> = {
    sap_pm: [sapWorkOrderHistory, sapEquipmentRegister],
    maximo: [maximoWorkOrderHistory, maximoAssetRegister],
    maintainx: [maintainxWorkOrderHistory, maintainxAssetRegister],
    spreadsheet: [genericWorkOrderHistory, genericAssetRegister],
};

export function templatesForSource(sourceSystem: string): CmmsTemplate[] {
    return TEMPLATES[sourceSystem] ?? TEMPLATES.spreadsheet;
}

export function downloadCmmsTemplate(t: CmmsTemplate): void {
    downloadWorkbook(t.build(), t.filename);
}
