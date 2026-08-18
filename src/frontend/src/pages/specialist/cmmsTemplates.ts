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
        ['Order', 'Order Type', 'Description', 'Equipment',
            'Basic start date', 'Basic fin. date', 'Priority', 'System status',
            'Breakdown dur.', 'Total act.costs', 'Damage', 'Cause code', 'Activity'],
        [
            ['4500001231', 'PM01', 'Pump seal leak - replace mechanical seal', 'PMP-101A', '03.02.2025', '05.02.2025', '1', 'TECO', 6.5, 1250, 'Leakage', 'Seal wear', 'Replaced mechanical seal'],
            ['4500001248', 'PM02', '6-monthly service - lube oil change and inspection', 'CMP-201', '14.03.2025', '14.03.2025', '3', 'TECO', '', 320, '', '', 'Routine service completed'],
            ['4500001305', 'PM03', 'Vibration alert follow-up - bearing check DE side', 'FAN-310', '02.04.2025', '04.04.2025', '2', 'CLSD', 12, 2840, 'Vibration', 'Bearing failure', 'Replaced DE bearing, realigned'],
            ['4500001377', 'PM05', 'Statutory inspection - pressure safety valve', 'VSL-120', '21.05.2025', '21.05.2025', '2', 'TECO', '', 450, '', '', 'PSV tested and recertified'],
            ['4500001412', 'PM01', 'Motor tripping on overload - investigate', 'MTR-415', '09.06.2025', '', '1', 'REL', '', '', '', '', ''],
        ],
        [12, 10, 46, 12, 15, 15, 8, 13, 13, 14, 12, 14, 34],
        [
            ['IREAMS — SAP PM work-order history template'],
            [''],
            ['Where the data comes from', 'SAP transaction IW38 or IW39 (order list); IW47/IW49 for confirmations. Set your layout to include the columns on the first sheet, then export to spreadsheet and paste rows under the headers.'],
            [''],
            ['Do not rename headers', 'The Specialist recognises these exact SAP column names and maps them automatically. Extra columns are fine — they are simply left unmapped.'],
            ['Required per row', 'Order (work-order number), Equipment (tag), Basic start date. Rows missing any of these are skipped and reported.'],
            ['Dates', 'DD.MM.YYYY (SAP default), e.g. 03.02.2025. DD/MM/YYYY and ISO (2025-02-03) also work.'],
            ['Order Type', 'PM01 = corrective, PM02 = preventive, PM03 = predictive, PM05 = inspection. Other values default to corrective.'],
            ['System status', 'TECO / CLSD = closed, REL / CRTD = open, in-progress codes = WIP.'],
            ['Breakdown dur.', 'Downtime hours (number). Optional but powers availability and bad-actor analysis.'],
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
        ['Equipment', 'Description of technical object', 'Object type',
            'Manufacturer of asset', 'Model number', 'ManufSerialNumber', 'ABC indic.'],
        [
            ['PMP-101A', 'Centrifugal pump - cooling water train A', 'PUMP', 'KSB', 'Etanorm 065-050', 'KSB-2019-04471', 'A'],
            ['CMP-201', 'Reciprocating air compressor - instrument air', 'COMPRESSOR', 'Atlas Copco', 'GA 75 VSD+', 'ACP-2021-11832', 'B'],
            ['FAN-310', 'Induced draft fan - boiler no. 3', 'FAN', 'Howden', 'HV-900', 'HWD-2018-00291', 'A'],
            ['VSL-120', 'Air receiver vessel 5 m3', 'VESSEL', 'CIRCOR', 'AR-5000', 'CIR-2017-33810', 'C'],
            ['MTR-415', 'Electric motor 75 kW - conveyor drive', 'MOTOR', 'WEG', 'W22 280S/M', 'WEG-2020-77452', 'B'],
        ],
        [12, 44, 14, 20, 18, 18, 10],
        [
            ['IREAMS — SAP equipment register template'],
            [''],
            ['Where the data comes from', 'SAP transaction IH06 (functional location / equipment structure) or IE05 (equipment list). Export the list to spreadsheet and paste rows under the headers on the first sheet.'],
            [''],
            ['Do not rename headers', 'The Specialist recognises these SAP column names and maps them automatically.'],
            ['Required per row', 'Equipment (the unique tag). Rows without it are skipped and reported. Everything else is optional but improves the assessment.'],
            ['ABC indic.', 'Criticality A / B / C / D. If your plant does not maintain the ABC indicator, leave it blank — assets import unranked.'],
            ['Object type', 'Free text; becomes the asset category (PUMP, MOTOR, VESSEL, ...).'],
            [''],
            ['This import creates a FLAT equipment list', 'It exists to anchor work-order history for reliability analysis. To migrate a full hierarchy (site → unit → system → equipment, parent links, functional locations, equipment numbers), use the Asset Register’s own import instead: Assets › Import › Download Template (ERS_Asset_Import_Template.xlsx). Both importers match on the same tag, so you can build the tree there first and still import history here.'],
            ['Import order', 'Register FIRST, then the work-order history — orders link to assets by the Equipment tag.'],
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
            'Downtime Hours', 'Failure Mode', 'Failure Cause', 'Remedy'],
        [
            ['WO-0001', 'Pump seal leak - replace mechanical seal', 'PMP-101A', 'CM', 'CLOSED', 'HIGH', '2025-02-03', '2025-02-05', 850, 400, 6.5, 'Leakage', 'Seal wear', 'Replaced mechanical seal'],
            ['WO-0002', '6-monthly service - lube oil change', 'CMP-201', 'PM', 'CLOSED', 'MEDIUM', '2025-03-14', '2025-03-14', 320, 0, '', '', '', 'Routine service completed'],
            ['WO-0003', 'Vibration alert - bearing check DE side', 'FAN-310', 'PdM', 'CLOSED', 'HIGH', '2025-04-02', '2025-04-04', 1200, 1640, 12, 'Vibration', 'Bearing failure', 'Replaced DE bearing, realigned'],
        ],
        [12, 44, 12, 11, 10, 10, 14, 16, 11, 13, 15, 13, 14, 32],
        [
            ['IREAMS — work-order history template (any CMMS or paper records)'],
            [''],
            ['One row per work order', 'Fill from any source — an old CMMS export, a maintenance log, even paper records typed up.'],
            ['Required per row', 'WO Number, Asset Tag, Date Raised. Rows missing any of these are skipped and reported.'],
            ['Work Type', 'CM (corrective), PM (preventive), PdM (predictive), INSPECTION, SAFETY. Your own wording also works — the Specialist translates it.'],
            ['Status', 'CLOSED, OPEN, WIP, CANCELLED. Historical exports are mostly CLOSED.'],
            ['Dates', 'ISO (2025-02-03) is safest; DD/MM/YYYY also works.'],
            ['Costs / Downtime', 'Plain numbers. Optional, but cost data is the single most valuable input for money-ranked findings.'],
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
    spreadsheet: [genericWorkOrderHistory, genericAssetRegister],
};

export function templatesForSource(sourceSystem: string): CmmsTemplate[] {
    return TEMPLATES[sourceSystem] ?? TEMPLATES.spreadsheet;
}

export function downloadCmmsTemplate(t: CmmsTemplate): void {
    downloadWorkbook(t.build(), t.filename);
}
