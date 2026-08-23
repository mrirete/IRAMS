/**
 * Universal Import/Export Template Service
 * Generates downloadable .xlsx templates for Assets, BOMs, Recurring Jobs,
 * People, Inventory, Work Orders, Locations, Vendors
 * Uses SheetJS (xlsx) for spreadsheet generation
 */
import * as XLSX from 'xlsx';
import type { Asset, BomItem } from '../types';
import { getLevels } from './hierarchyModel';

/** Native browser download — bypasses file-saver for reliable filenames */
function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    // Cleanup after a tick so the download starts
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

/** Convenience: write an XLSX workbook and trigger download */
export function downloadWorkbook(wb: XLSX.WorkBook, filename: string): void {
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    downloadBlob(blob, filename);
}

export type ImportType = 'asset' | 'bom' | 'recurring' | 'people' | 'inventory' | 'workorder' | 'location' | 'vendor' | 'readings' | 'jobplan' | 'failurecodes' | 'unknown';

// ─── Asset Template Columns ─────────────────────────────────────
// hierarchyLevel is what actually places a row in the tree. assetType is the
// equipment kind (PUMP/MOTOR) and only acts as a level fallback when it happens
// to name a level. See the Instructions sheet, generated from the live level
// model so an admin's custom levels are always what the template advertises.
const ASSET_COLUMNS = [
    { header: 'tag', description: 'Unique asset tag identifier (e.g. GT-301)', required: true },
    { header: 'name', description: 'Descriptive name (e.g. Gas Turbine #1)', required: true },
    { header: 'hierarchyLevel', description: 'Where this row sits in the tree — see the Instructions sheet for the valid codes. Leave blank only if assetType is itself a level code.', required: false },
    { header: 'assetType', description: 'Equipment kind / ISO 14224 class: PUMP, MOTOR, COMPRESSOR, VESSEL, VALVE…', required: true },
    { header: 'parentTag', description: 'Parent asset tag for hierarchy placement (leave blank for root). May be an earlier row in this file or an existing asset.', required: false },
    { header: 'equipmentNumber', description: 'Internal Equipment Number (IEN). Leave blank to auto-generate EQ-NNNNNN. Provide to migrate from SAP/Maximo.', required: false },
    { header: 'criticality', description: 'A = Safety Critical, B = Production, C = General, D = Low Impact. Required for equipment-class levels (see Instructions).', required: false },
    { header: 'status', description: 'ACTIVE, MAINTENANCE, STANDBY, DOWN, or DECOMMISSIONED', required: false },
    { header: 'department', description: 'Department name (stored as an asset property)', required: false },
    { header: 'costCenter', description: 'Cost-center code — must match an existing cost centre, otherwise the asset imports without it', required: false },
    { header: 'location', description: 'Physical location description (stored as an asset property)', required: false },
    { header: 'manufacturer', description: 'OEM manufacturer name', required: false },
    { header: 'model', description: 'Model number', required: false },
    { header: 'serialNumber', description: 'Equipment serial number', required: false },
    { header: 'description', description: 'Extended description or notes', required: false },
];

const BOM_COLUMNS = [
    { header: 'assetTag', description: 'Parent asset tag this BOM item belongs to', required: true },
    { header: 'inventoryCode', description: 'Inventory/stock code for this part', required: true },
    { header: 'description', description: 'Part description', required: true },
    { header: 'quantity', description: 'Required quantity (integer)', required: true },
    { header: 'uom', description: 'Unit of measure: EA, SET, MTR, KG, LTR, BOX', required: false },
    { header: 'critical', description: 'Critical spare? YES or NO', required: false },
];

// ─── Sample Data ────────────────────────────────────────────────
const ASSET_EXAMPLES = [
    { tag: 'SITE-HOU', name: 'Houston Production Site', hierarchyLevel: 'SITE', assetType: 'SITE', parentTag: '', equipmentNumber: '', criticality: '', status: 'ACTIVE', department: 'Operations', costCenter: 'CC-001', location: 'Houston, TX', manufacturer: '', model: '', serialNumber: '', description: 'Main production facility' },
    { tag: 'UNIT-300', name: 'Gas Turbine Generation Unit', hierarchyLevel: 'UNIT', assetType: 'UNIT', parentTag: 'SITE-HOU', equipmentNumber: '', criticality: '', status: 'ACTIVE', department: 'Power Generation', costCenter: 'CC-003', location: 'Block 300', manufacturer: '', model: '', serialNumber: '', description: 'Combined cycle power generation' },
    { tag: 'SYS-300-GTG', name: 'Gas Turbine Generator System', hierarchyLevel: 'SYSTEM', assetType: 'SYSTEM', parentTag: 'UNIT-300', equipmentNumber: '', criticality: '', status: 'ACTIVE', department: 'Power Generation', costCenter: 'CC-003', location: 'Block 300', manufacturer: '', model: '', serialNumber: '', description: 'Turbine generator process system' },
    { tag: 'GT-301', name: 'Gas Turbine #1', hierarchyLevel: 'EQUIPMENT', assetType: 'COMPRESSOR', parentTag: 'SYS-300-GTG', equipmentNumber: 'EQ-LEGACY-50291', criticality: 'A', status: 'ACTIVE', department: 'Mechanical', costCenter: 'CC-003', location: 'Block 300 Bay 1', manufacturer: 'GE', model: 'LM2500', serialNumber: 'SN-50291', description: 'Frame 5 gas turbine' },
    { tag: 'GT-301-BRG1', name: 'GT-301 Thrust Bearing', hierarchyLevel: 'COMPONENT', assetType: 'BEARING', parentTag: 'GT-301', equipmentNumber: '', criticality: 'B', status: 'ACTIVE', department: 'Mechanical', costCenter: 'CC-003', location: 'Block 300 Bay 1', manufacturer: 'SKF', model: '7220', serialNumber: '', description: 'Thrust bearing assembly' },
];

const BOM_EXAMPLES = [
    { assetTag: 'GT-301', inventoryCode: 'FLT-0023', description: 'Air Inlet Filter — 24x24x12', quantity: 4, uom: 'EA', critical: 'YES' },
    { assetTag: 'GT-301', inventoryCode: 'BRG-0041', description: 'Thrust Bearing Assembly', quantity: 1, uom: 'EA', critical: 'YES' },
    { assetTag: 'GT-301', inventoryCode: 'LUB-0012', description: 'Synthetic Turbine Oil ISO VG 32', quantity: 20, uom: 'LTR', critical: 'NO' },
];

// ─── Template Generation ────────────────────────────────────────

export function downloadAssetTemplate(): void {
    const wb = XLSX.utils.book_new();

    // Sheet 1 — Assets Data
    const dataHeaders = ASSET_COLUMNS.map(c => c.header);
    const dataRows = ASSET_EXAMPLES.map(ex => dataHeaders.map(h => (ex as any)[h] ?? ''));
    const ws = XLSX.utils.aoa_to_sheet([dataHeaders, ...dataRows]);

    // Set column widths
    ws['!cols'] = dataHeaders.map(h => ({ wch: Math.max(h.length + 4, 18) }));
    XLSX.utils.book_append_sheet(wb, ws, 'Assets');

    // Sheet 2 — Instructions. The level table is generated from the live
    // hierarchy model (hierarchy_config, admin-editable) rather than hardcoded,
    // so the template can never advertise levels the importer would reject.
    const levels = getLevels();
    const levelCodes = levels.map(l => l.code).join(', ');
    const mandatoryCrit = levels.filter(l => l.criticality === 'mandatory').map(l => l.code);

    const instrData = [
        ['Column', 'Required', 'Description', 'Valid Values'],
        ...ASSET_COLUMNS.map(c => [
            c.header,
            c.required ? 'YES' : 'no',
            c.description,
            c.header === 'criticality' ? `A, B, C, D — mandatory for: ${mandatoryCrit.join(', ')}` :
                c.header === 'status' ? 'ACTIVE, MAINTENANCE, STANDBY, DOWN, DECOMMISSIONED' :
                    c.header === 'hierarchyLevel' ? levelCodes :
                        c.header === 'assetType' ? 'PUMP, MOTOR, COMPRESSOR, VESSEL, VALVE, HEAT_EXCHANGER, BEARING… (or a level code)' :
                            c.header === 'equipmentNumber' ? 'Leave blank for auto-generation (EQ-NNNNNN) or provide existing IEN from SAP/Maximo' : ''
        ]),
        [],
        ['Hierarchy Levels — the shape of your register'],
        ['Level', 'Label', 'Object class', 'Numbering', 'Criticality', 'Allowed child levels'],
        ...levels.map(l => [
            l.code,
            l.label,
            l.objectClass === 'FLOC' ? 'Functional location' : 'Equipment',
            l.numbering === 'FL' ? 'FL-NNNNNN' : l.numbering === 'EQ' ? 'EQ-NNNNNN' : 'none',
            l.criticality === 'mandatory' ? 'REQUIRED' : 'optional',
            (l.allowedChildCodes ?? []).join(', ') || '(none — leaf level)',
        ]),
        [],
        ['How parents work'],
        ['• parentTag may point at an earlier row in this file, or at an asset that already exists in ERS.'],
        ['• Rows are sorted automatically, so a child may appear above its parent in the sheet.'],
        ['• A parent tag that exists nowhere is reported as a failed row — nothing is guessed.'],
        ['• A child level must be allowed under its parent level (see the table above), or the row fails.'],
        ['• Circular parent references (A → B → A) are detected and reported.'],
        ['• If you leave tag blank the system auto-numbers it — but such a row cannot be used as a parentTag.'],
        [],
        ['Functional locations vs equipment'],
        ['• Functional-location levels describe the position in the plant (functional location). They get FL- numbers.'],
        ['• Equipment levels describe the maintainable item itself (equipment record). They get EQ- numbers.'],
        ['• Import the whole tree from this one sheet — locations and equipment are rows at different levels.'],
        [],
        ['Internal Equipment Number (IEN)'],
        ['The equipmentNumber column is the Internal Equipment Number (IEN).'],
        ['• Leave blank: The system auto-generates a unique EQ-NNNNNN number on import.'],
        ['• Provide a value: Use this to migrate existing equipment numbers from SAP, Maximo, or other EAM systems.'],
        ['• The IEN uniquely identifies a physical asset. The tag (Functional Location) identifies the position.'],
        ['• When equipment is replaced, the tag stays but a new IEN is generated for the replacement asset.'],
    ];
    const instrWs = XLSX.utils.aoa_to_sheet(instrData);
    instrWs['!cols'] = [{ wch: 20 }, { wch: 22 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, instrWs, 'Instructions');

    downloadWorkbook(wb, 'ERS_Asset_Import_Template.xlsx');
}

export function downloadBOMTemplate(): void {
    const wb = XLSX.utils.book_new();

    // Sheet 1 — BOM Data
    const dataHeaders = BOM_COLUMNS.map(c => c.header);
    const dataRows = BOM_EXAMPLES.map(ex => dataHeaders.map(h => (ex as any)[h] ?? ''));
    const ws = XLSX.utils.aoa_to_sheet([dataHeaders, ...dataRows]);
    ws['!cols'] = dataHeaders.map(h => ({ wch: Math.max(h.length + 4, 16) }));
    XLSX.utils.book_append_sheet(wb, ws, 'BOM Items');

    // Sheet 2 — Instructions
    const instrData = [
        ['Column', 'Required', 'Description', 'Valid Values'],
        ...BOM_COLUMNS.map(c => [
            c.header,
            c.required ? 'YES' : 'no',
            c.description,
            c.header === 'uom' ? 'EA, SET, MTR, KG, LTR, BOX, PCE' :
                c.header === 'critical' ? 'YES, NO' : ''
        ]),
    ];
    const instrWs = XLSX.utils.aoa_to_sheet(instrData);
    instrWs['!cols'] = [{ wch: 18 }, { wch: 10 }, { wch: 50 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, instrWs, 'Instructions');

    downloadWorkbook(wb, 'ERS_BOM_Import_Template.xlsx');
}

// ─── Recurring Job Template ─────────────────────────────────────
const RECURRING_JOB_COLUMNS = [
    { header: 'code', description: 'Unique PM code (e.g. PM-GT301-OIL)', required: true },
    { header: 'description', description: 'Job description', required: true },
    { header: 'assetTag', description: 'Target equipment tag (must exist in Assets)', required: true },
    { header: 'scheduleType', description: 'TIME or READING', required: true },
    { header: 'frequencyInterval', description: 'Interval value (e.g. 3)', required: true },
    { header: 'frequencyUnit', description: 'Months, Weeks, Days, Hours, KM, Cycles', required: true },
    { header: 'priority', description: 'EMERGENCY, HIGH, MEDIUM, LOW', required: false },
    { header: 'jobType', description: 'PM, PdM, INSPECTION, CM', required: false },
    { header: 'rcmStrategy', description: 'TIME_DIRECTED, CONDITION_DIRECTED, FAILURE_FINDING, RUN_TO_FAILURE', required: false },
    { header: 'estDuration', description: 'Estimated duration in hours', required: false },
    { header: 'costCenter', description: 'Cost center code', required: false },
    { header: 'department', description: 'Department name', required: false },
    { header: 'nextDueDate', description: 'Next due date (YYYY-MM-DD)', required: false },
    { header: 'leadTimeDays', description: 'Days before due date to generate WO', required: false },
];

const RECURRING_JOB_EXAMPLES = [
    { code: 'PM-GT301-OIL', description: 'Gas Turbine Oil Change', assetTag: 'GT-301', scheduleType: 'TIME', frequencyInterval: 3, frequencyUnit: 'Months', priority: 'HIGH', jobType: 'PM', rcmStrategy: 'TIME_DIRECTED', estDuration: 4, costCenter: 'CC-003', department: 'Mechanical', nextDueDate: '2026-04-15', leadTimeDays: 7 },
    { code: 'PM-GT301-VIB', description: 'Vibration Analysis — Gas Turbine', assetTag: 'GT-301', scheduleType: 'TIME', frequencyInterval: 1, frequencyUnit: 'Months', priority: 'MEDIUM', jobType: 'PdM', rcmStrategy: 'CONDITION_DIRECTED', estDuration: 2, costCenter: 'CC-003', department: 'Reliability', nextDueDate: '2026-04-01', leadTimeDays: 3 },
    { code: 'INS-P101-THK', description: 'Thickness Measurement — Process Pipe', assetTag: 'P-101', scheduleType: 'TIME', frequencyInterval: 6, frequencyUnit: 'Months', priority: 'MEDIUM', jobType: 'INSPECTION', rcmStrategy: 'TIME_DIRECTED', estDuration: 1, costCenter: 'CC-005', department: 'Inspection', nextDueDate: '2026-07-01', leadTimeDays: 14 },
];

export function downloadRecurringJobTemplate(): void {
    const wb = XLSX.utils.book_new();
    const dataHeaders = RECURRING_JOB_COLUMNS.map(c => c.header);
    const dataRows = RECURRING_JOB_EXAMPLES.map(ex => dataHeaders.map(h => (ex as any)[h] ?? ''));
    const ws = XLSX.utils.aoa_to_sheet([dataHeaders, ...dataRows]);
    ws['!cols'] = dataHeaders.map(h => ({ wch: Math.max(h.length + 4, 18) }));
    XLSX.utils.book_append_sheet(wb, ws, 'Recurring Jobs');

    const instrData = [
        ['Column', 'Required', 'Description', 'Valid Values'],
        ...RECURRING_JOB_COLUMNS.map(c => [
            c.header,
            c.required ? 'YES' : 'no',
            c.description,
            c.header === 'scheduleType' ? 'TIME, READING' :
                c.header === 'priority' ? 'EMERGENCY, HIGH, MEDIUM, LOW' :
                    c.header === 'jobType' ? 'PM, PdM, INSPECTION, CM' :
                        c.header === 'rcmStrategy' ? 'TIME_DIRECTED, CONDITION_DIRECTED, FAILURE_FINDING, RUN_TO_FAILURE' :
                            c.header === 'frequencyUnit' ? 'Months, Weeks, Days, Hours, KM, Cycles' : ''
        ]),
    ];
    const instrWs = XLSX.utils.aoa_to_sheet(instrData);
    instrWs['!cols'] = [{ wch: 20 }, { wch: 10 }, { wch: 55 }, { wch: 50 }];
    XLSX.utils.book_append_sheet(wb, instrWs, 'Instructions');

    downloadWorkbook(wb, 'ERS_Recurring_Jobs_Template.xlsx');
}

// ─── People / Contacts Template ─────────────────────────────────
const PEOPLE_COLUMNS = [
    { header: 'code', description: 'Employee or contractor ID (unique)', required: true },
    { header: 'name', description: 'Full display name', required: true },
    { header: 'email', description: 'Email address (unique)', required: true },
    { header: 'type', description: 'INTERNAL, TECHNICIAN, CONTRACTOR, VENDOR', required: true },
    { header: 'title', description: 'Job title (e.g. Sr. Mechanical Engineer)', required: false },
    { header: 'phone', description: 'Phone number', required: false },
    { header: 'mobile', description: 'Mobile number', required: false },
    { header: 'department', description: 'Department name', required: false },
    { header: 'orgUnit', description: 'Organization unit name (auto-links M2M)', required: false },
    { header: 'costCenter', description: 'Cost center code', required: false },
    { header: 'hourlyRate', description: 'Labour rate per hour', required: false },
    { header: 'currency', description: 'Rate currency (default USD)', required: false },
    { header: 'qualifications', description: 'Semicolon-separated list of qualifications', required: false },
];

const PEOPLE_EXAMPLES = [
    { code: 'EMP-001', name: 'John Smith', email: 'john.smith@company.com', type: 'INTERNAL', title: 'Sr. Reliability Engineer', phone: '+1-555-0101', mobile: '+1-555-0102', department: 'Reliability', orgUnit: 'Maintenance Team A', costCenter: 'CC-003', hourlyRate: 85, currency: 'USD', qualifications: 'API 510;API 570;CMRP' },
    { code: 'EMP-002', name: 'Sarah Johnson', email: 'sarah.j@company.com', type: 'TECHNICIAN', title: 'Mechanical Technician', phone: '+1-555-0201', mobile: '+1-555-0202', department: 'Mechanical', orgUnit: 'Maintenance Team A', costCenter: 'CC-003', hourlyRate: 55, currency: 'USD', qualifications: 'Millwright;Confined Space' },
    { code: 'CON-001', name: 'Apex Services LLC', email: 'contact@apexservices.com', type: 'CONTRACTOR', title: 'Insulation Contractor', phone: '+1-555-0301', mobile: '', department: '', orgUnit: '', costCenter: 'CC-009', hourlyRate: 120, currency: 'USD', qualifications: '' },
];

export function downloadPeopleTemplate(): void {
    const wb = XLSX.utils.book_new();
    const dataHeaders = PEOPLE_COLUMNS.map(c => c.header);
    const dataRows = PEOPLE_EXAMPLES.map(ex => dataHeaders.map(h => (ex as any)[h] ?? ''));
    const ws = XLSX.utils.aoa_to_sheet([dataHeaders, ...dataRows]);
    ws['!cols'] = dataHeaders.map(h => ({ wch: Math.max(h.length + 4, 18) }));
    XLSX.utils.book_append_sheet(wb, ws, 'People');

    const instrData = [
        ['Column', 'Required', 'Description', 'Valid Values'],
        ...PEOPLE_COLUMNS.map(c => [
            c.header, c.required ? 'YES' : 'no', c.description,
            c.header === 'type' ? 'INTERNAL, TECHNICIAN, CONTRACTOR, VENDOR' : ''
        ]),
    ];
    const instrWs = XLSX.utils.aoa_to_sheet(instrData);
    instrWs['!cols'] = [{ wch: 18 }, { wch: 10 }, { wch: 55 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, instrWs, 'Instructions');

    downloadWorkbook(wb, 'ERS_People_Template.xlsx');
}

// ─── Inventory / Parts Template ─────────────────────────────────
const INVENTORY_COLUMNS = [
    { header: 'code', description: 'Stock/part code (unique)', required: true },
    { header: 'description', description: 'Part description', required: true },
    { header: 'type', description: 'SPARE, CONSUMABLE, TOOL, MATERIAL', required: true },
    { header: 'uom', description: 'Unit of measure: EA, SET, MTR, KG, LTR, BOX', required: true },
    { header: 'itemCost', description: 'Unit cost', required: true },
    { header: 'minLevel', description: 'Reorder point (min stock)', required: false },
    { header: 'maxLevel', description: 'Maximum stock level', required: false },
    { header: 'qtyOnHand', description: 'Initial quantity (creates OPENING_BALANCE txn)', required: false },
    { header: 'storeName', description: 'Warehouse / store name', required: false },
    { header: 'binLocation', description: 'Bin location code (e.g. C2-01-4-2)', required: false },
    { header: 'manufacturer', description: 'OEM manufacturer name', required: false },
    { header: 'isCritical', description: 'Critical spare? YES or NO', required: false },
    { header: 'assetTag', description: 'BOM link — asset this part belongs to', required: false },
    { header: 'preferredSupplier', description: 'Vendor name or code', required: false },
];

const INVENTORY_EXAMPLES = [
    { code: 'FLT-0023', description: 'Air Inlet Filter — 24x24x12', type: 'SPARE', uom: 'EA', itemCost: 245.00, minLevel: 4, maxLevel: 16, qtyOnHand: 8, storeName: 'Main Store', binLocation: 'C2-01-4-2', manufacturer: 'Donaldson', isCritical: 'YES', assetTag: 'GT-301', preferredSupplier: 'FilterPro Inc' },
    { code: 'BRG-0041', description: 'Thrust Bearing Assembly', type: 'SPARE', uom: 'EA', itemCost: 12500.00, minLevel: 1, maxLevel: 3, qtyOnHand: 2, storeName: 'Main Store', binLocation: 'A1-02-1-1', manufacturer: 'SKF', isCritical: 'YES', assetTag: 'GT-301', preferredSupplier: 'SKF Distribution' },
    { code: 'LUB-0012', description: 'Synthetic Turbine Oil ISO VG 32', type: 'CONSUMABLE', uom: 'LTR', itemCost: 18.50, minLevel: 40, maxLevel: 200, qtyOnHand: 100, storeName: 'Chemical Store', binLocation: 'D1-05-2-1', manufacturer: 'Mobil', isCritical: 'NO', assetTag: '', preferredSupplier: 'LubeSupply Co' },
];

export function downloadInventoryTemplate(): void {
    const wb = XLSX.utils.book_new();
    const dataHeaders = INVENTORY_COLUMNS.map(c => c.header);
    const dataRows = INVENTORY_EXAMPLES.map(ex => dataHeaders.map(h => (ex as any)[h] ?? ''));
    const ws = XLSX.utils.aoa_to_sheet([dataHeaders, ...dataRows]);
    ws['!cols'] = dataHeaders.map(h => ({ wch: Math.max(h.length + 4, 16) }));
    XLSX.utils.book_append_sheet(wb, ws, 'Inventory');

    const instrData = [
        ['Column', 'Required', 'Description', 'Valid Values'],
        ...INVENTORY_COLUMNS.map(c => [
            c.header, c.required ? 'YES' : 'no', c.description,
            c.header === 'type' ? 'SPARE, CONSUMABLE, TOOL, MATERIAL' :
                c.header === 'uom' ? 'EA, SET, MTR, KG, LTR, BOX, PCE' :
                    c.header === 'isCritical' ? 'YES, NO' : ''
        ]),
    ];
    const instrWs = XLSX.utils.aoa_to_sheet(instrData);
    instrWs['!cols'] = [{ wch: 18 }, { wch: 10 }, { wch: 55 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, instrWs, 'Instructions');

    downloadWorkbook(wb, 'ERS_Inventory_Template.xlsx');
}

// ─── Work Order Template ────────────────────────────────────────
const WORK_ORDER_COLUMNS = [
    { header: 'woNumber', description: 'Work order number (unique)', required: true },
    { header: 'description', description: 'WO description', required: true },
    { header: 'assetTag', description: 'Equipment tag (must exist)', required: true },
    { header: 'type', description: 'CM, PM, PdM, INSPECTION, SAFETY', required: true },
    { header: 'priority', description: 'EMERGENCY, HIGH, MEDIUM, LOW', required: true },
    { header: 'status', description: 'OPEN, IN_PROGRESS, COMPLETED, TECO', required: false },
    { header: 'assignedTo', description: 'Person code or name', required: false },
    { header: 'dueDate', description: 'Due date (YYYY-MM-DD)', required: false },
    { header: 'estDuration', description: 'Estimated hours', required: false },
    { header: 'costCenter', description: 'Cost center code', required: false },
    { header: 'failureCode', description: 'Failure mode code (required for TECO)', required: false },
    { header: 'department', description: 'Department name', required: false },
];

const WORK_ORDER_EXAMPLES = [
    { woNumber: 'WO-2026-0001', description: 'Replace Air Inlet Filters', assetTag: 'GT-301', type: 'PM', priority: 'HIGH', status: 'OPEN', assignedTo: 'EMP-001', dueDate: '2026-04-15', estDuration: 4, costCenter: 'CC-003', failureCode: '', department: 'Mechanical' },
    { woNumber: 'WO-2026-0002', description: 'Bearing Vibration Investigation', assetTag: 'GT-301', type: 'PdM', priority: 'EMERGENCY', status: 'IN_PROGRESS', assignedTo: 'EMP-002', dueDate: '2026-03-20', estDuration: 8, costCenter: 'CC-003', failureCode: '', department: 'Reliability' },
    { woNumber: 'WO-2026-0003', description: 'Annual Safety Valve Inspection', assetTag: 'PSV-101', type: 'INSPECTION', priority: 'MEDIUM', status: 'OPEN', assignedTo: '', dueDate: '2026-06-01', estDuration: 2, costCenter: 'CC-005', failureCode: '', department: 'Inspection' },
];

export function downloadWorkOrderTemplate(): void {
    const wb = XLSX.utils.book_new();
    const dataHeaders = WORK_ORDER_COLUMNS.map(c => c.header);
    const dataRows = WORK_ORDER_EXAMPLES.map(ex => dataHeaders.map(h => (ex as any)[h] ?? ''));
    const ws = XLSX.utils.aoa_to_sheet([dataHeaders, ...dataRows]);
    ws['!cols'] = dataHeaders.map(h => ({ wch: Math.max(h.length + 4, 18) }));
    XLSX.utils.book_append_sheet(wb, ws, 'Work Orders');

    const instrData = [
        ['Column', 'Required', 'Description', 'Valid Values'],
        ...WORK_ORDER_COLUMNS.map(c => [
            c.header, c.required ? 'YES' : 'no', c.description,
            c.header === 'type' ? 'CM, PM, PdM, INSPECTION, SAFETY' :
                c.header === 'priority' ? 'EMERGENCY, HIGH, MEDIUM, LOW' :
                    c.header === 'status' ? 'OPEN, IN_PROGRESS, COMPLETED, TECO' : ''
        ]),
    ];
    const instrWs = XLSX.utils.aoa_to_sheet(instrData);
    instrWs['!cols'] = [{ wch: 18 }, { wch: 10 }, { wch: 55 }, { wch: 45 }];
    XLSX.utils.book_append_sheet(wb, instrWs, 'Instructions');

    downloadWorkbook(wb, 'ERS_Work_Orders_Template.xlsx');
}

// ─── Readings / Meter History Template ──────────────────────────
// Historical meter + condition readings from the outgoing CMMS. Reading points
// (reading_definitions) are created on demand per asset+type, so a migration
// only needs the raw log.
const READINGS_COLUMNS = [
    { header: 'assetTag', description: 'Asset tag this reading belongs to (must already exist)', required: true },
    { header: 'readingType', description: 'HOURS, KM, TEMPERATURE, VIBRATION or PRESSURE', required: true },
    { header: 'date', description: 'Reading date — yyyy-mm-dd (or any Excel date cell)', required: true },
    { header: 'value', description: 'Numeric reading value', required: true },
    { header: 'unit', description: 'Unit of measure (hrs, km, °C, mm/s, bar)', required: false },
    { header: 'notes', description: 'Optional comment carried onto the reading', required: false },
];

const READINGS_EXAMPLES = [
    { assetTag: 'GT-301', readingType: 'HOURS', date: '2026-01-31', value: '48210', unit: 'hrs', notes: 'Month-end counter read' },
    { assetTag: 'GT-301', readingType: 'VIBRATION', date: '2026-02-14', value: '4.2', unit: 'mm/s', notes: 'Route 12 — DE bearing' },
    { assetTag: 'GT-301', readingType: 'TEMPERATURE', date: '2026-02-14', value: '72.5', unit: '°C', notes: '' },
];

export function downloadReadingsTemplate(): void {
    const wb = XLSX.utils.book_new();
    const dataHeaders = READINGS_COLUMNS.map(c => c.header);
    const dataRows = READINGS_EXAMPLES.map(ex => dataHeaders.map(h => (ex as any)[h] ?? ''));
    const ws = XLSX.utils.aoa_to_sheet([dataHeaders, ...dataRows]);
    ws['!cols'] = dataHeaders.map(h => ({ wch: Math.max(h.length + 4, 16) }));
    XLSX.utils.book_append_sheet(wb, ws, 'Readings');

    const instrData = [
        ['Column', 'Required', 'Description', 'Valid Values'],
        ...READINGS_COLUMNS.map(c => [
            c.header, c.required ? 'YES' : 'no', c.description,
            c.header === 'readingType' ? READING_TYPES.join(', ') : ''
        ]),
        [],
        ['How this import works'],
        ['• Import your assets FIRST — a reading whose assetTag is unknown is reported as a failed row.'],
        ['• A reading point is created automatically the first time an asset+readingType pair appears.'],
        ['• Alarm limits are NOT set by this import. Add them afterwards on the asset\'s Readings tab.'],
        ['• This is for HISTORY. Live sensor feeds belong in Admin › Connector Hub.'],
    ];
    const instrWs = XLSX.utils.aoa_to_sheet(instrData);
    instrWs['!cols'] = [{ wch: 15 }, { wch: 10 }, { wch: 60 }, { wch: 45 }];
    XLSX.utils.book_append_sheet(wb, instrWs, 'Instructions');

    downloadWorkbook(wb, 'ERS_Readings_Import_Template.xlsx');
}

// ─── Failure-Code Catalog Template ──────────────────────────────
// The codes a CMMS history refers to. Without them, imported failure codes are
// free text that resolves to nothing in the semantic layer — the analytics
// count the record as "coded" while the code itself decodes to blank.
export const CODE_CATEGORIES = [
    'FAILURE_MODE', 'FAILURE_CAUSE', 'FAULT_TYPE', 'REMEDY_CODE', 'WORK_TYPE', 'PRIORITY',
];

const FAILURE_CODE_COLUMNS = [
    { header: 'category', description: `Which catalog this belongs to: ${CODE_CATEGORIES.join(', ')}`, required: true },
    { header: 'code', description: 'The code exactly as it appears in your maintenance history', required: true },
    { header: 'description', description: 'What the code means, in the words a planner would use', required: true },
    { header: 'active', description: 'YES (default) or NO to load a retired code for history only', required: false },
];

const FAILURE_CODE_EXAMPLES = [
    { category: 'FAILURE_MODE', code: 'VIB', description: 'Abnormal vibration', active: 'YES' },
    { category: 'FAILURE_MODE', code: 'Bearing Failure', description: 'Bearing failure (legacy free-text code)', active: 'YES' },
    { category: 'FAILURE_CAUSE', code: 'LUBR-DEGRAD', description: 'Lubricant degradation', active: 'YES' },
    { category: 'REMEDY_CODE', code: 'RPL', description: 'Replace', active: 'YES' },
];

export function downloadFailureCodesTemplate(): void {
    const wb = XLSX.utils.book_new();
    const dataHeaders = FAILURE_CODE_COLUMNS.map(c => c.header);
    const dataRows = FAILURE_CODE_EXAMPLES.map(ex => dataHeaders.map(h => (ex as any)[h] ?? ''));
    const ws = XLSX.utils.aoa_to_sheet([dataHeaders, ...dataRows]);
    ws['!cols'] = dataHeaders.map(h => ({ wch: Math.max(h.length + 4, 20) }));
    XLSX.utils.book_append_sheet(wb, ws, 'Codes');

    const instrData = [
        ['Column', 'Required', 'Description'],
        ...FAILURE_CODE_COLUMNS.map(c => [c.header, c.required ? 'YES' : 'no', c.description]),
        [],
        ['Why this matters'],
        ['• Imported failure codes are stored as written — nothing rejects an unknown code.'],
        ['• But an uncatalogued code resolves to blank in reporting, so the record counts as'],
        ['  "coded" while showing no failure mode. That silently inflates coverage figures.'],
        ['• Load your own catalog here and the history you already imported starts resolving.'],
        [],
        ['Getting your codes'],
        ['• Admin › Migration Center can export every unresolved code already in your history,'],
        ['  pre-filled into this format — complete the descriptions and import it back.'],
        ['• Codes are matched EXACTLY, including case and spacing, so paste them unchanged.'],
        ['• Re-importing a code updates its description rather than duplicating it.'],
    ];
    const instrWs = XLSX.utils.aoa_to_sheet(instrData);
    instrWs['!cols'] = [{ wch: 16 }, { wch: 10 }, { wch: 80 }];
    XLSX.utils.book_append_sheet(wb, instrWs, 'Instructions');

    downloadWorkbook(wb, 'ERS_FailureCodes_Template.xlsx');
}

/** Build a pre-filled catalog sheet from codes found in the user's own history. */
export function downloadUnresolvedCodes(rows: { category: string; code: string; uses: number }[]): void {
    const wb = XLSX.utils.book_new();
    const headers = FAILURE_CODE_COLUMNS.map(c => c.header);
    const data = rows.map(r => [r.category, r.code, '', 'YES']);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length + 4, 24) }));
    XLSX.utils.book_append_sheet(wb, ws, 'Codes');

    const usage = XLSX.utils.aoa_to_sheet([
        ['Category', 'Code', 'Times used in your history'],
        ...rows.map(r => [r.category, r.code, r.uses]),
        [],
        ['Fill in the description column on the Codes sheet, then import it from'],
        ['Admin › Migration Center → Failure-code catalogs.'],
    ]);
    usage['!cols'] = [{ wch: 18 }, { wch: 30 }, { wch: 26 }];
    XLSX.utils.book_append_sheet(wb, usage, 'Usage');

    downloadWorkbook(wb, 'ERS_UnresolvedCodes.xlsx');
}

// ─── Job Plan / Task List Template ──────────────────────────────
// One row per OPERATION. Rows are grouped by pmCode into the job plan of an
// existing PM schedule — SAP task-list operations (PLPO) and Maximo job-plan
// tasks (JOBTASK) both export in this shape.
const JOB_PLAN_COLUMNS = [
    { header: 'pmCode', description: 'Code of the PM schedule this operation belongs to — must already exist', required: true },
    { header: 'operationNo', description: 'Operation number (0010, 0020…). Blank numbers are assigned in sheet order.', required: false },
    { header: 'description', description: 'What the technician does at this step', required: true },
    { header: 'longText', description: 'Detailed instruction — becomes the step’s procedure text', required: false },
    { header: 'estHours', description: 'Planned duration for this operation, in hours', required: false },
    { header: 'workCentre', description: 'Work-centre code responsible — must match an existing work centre', required: false },
    { header: 'controlKey', description: 'PM01 (internal) or PM02 (external). Defaults to PM01.', required: false },
    { header: 'craft', description: 'Craft / trade required (MECH, ELEC, INST…)', required: false },
    { header: 'numPersons', description: 'How many people the operation needs', required: false },
];

const JOB_PLAN_EXAMPLES = [
    { pmCode: 'PM-65320', operationNo: '0010', description: 'Isolate and lock out the pump', longText: 'Apply LOTO per site procedure. Verify zero energy before proceeding.', estHours: 0.5, workCentre: 'MECH', controlKey: 'PM01', craft: 'MECH', numPersons: 2 },
    { pmCode: 'PM-65320', operationNo: '0020', description: 'Inspect mechanical seal for leakage', longText: 'Check seal faces and flush lines. Record any weeping.', estHours: 1, workCentre: 'MECH', controlKey: 'PM01', craft: 'MECH', numPersons: 1 },
    { pmCode: 'PM-65320', operationNo: '0030', description: 'Record bearing temperature and vibration', longText: 'Take readings at DE and NDE bearings.', estHours: 0.5, workCentre: 'COND', controlKey: 'PM01', craft: 'INST', numPersons: 1 },
];

export function downloadJobPlanTemplate(): void {
    const wb = XLSX.utils.book_new();
    const dataHeaders = JOB_PLAN_COLUMNS.map(c => c.header);
    const dataRows = JOB_PLAN_EXAMPLES.map(ex => dataHeaders.map(h => (ex as any)[h] ?? ''));
    const ws = XLSX.utils.aoa_to_sheet([dataHeaders, ...dataRows]);
    ws['!cols'] = dataHeaders.map(h => ({ wch: Math.max(h.length + 4, 16) }));
    XLSX.utils.book_append_sheet(wb, ws, 'Job Plan');

    const instrData = [
        ['Column', 'Required', 'Description'],
        ...JOB_PLAN_COLUMNS.map(c => [c.header, c.required ? 'YES' : 'no', c.description]),
        [],
        ['How this import works'],
        ['• Import your PM schedules FIRST — an operation whose pmCode is unknown is reported as failed.'],
        ['• All rows sharing a pmCode become the ordered job plan for that schedule.'],
        ['• Re-importing a pmCode REPLACES that schedule’s job plan; other schedules are untouched.'],
        ['• Operations are sorted by operationNo, then by their order in the sheet.'],
        ['• longText becomes the step’s procedure block, which is what a technician reads on the work order.'],
        [],
        ['What ERS cannot store yet'],
        ['• Planner group, task-list usage and plant — no destination.'],
        ['• Per-operation cost centre — PM schedules have no cost-centre column.'],
        ['• Operation material lists — import spare parts against the asset BOM instead.'],
    ];
    const instrWs = XLSX.utils.aoa_to_sheet(instrData);
    instrWs['!cols'] = [{ wch: 16 }, { wch: 10 }, { wch: 78 }];
    XLSX.utils.book_append_sheet(wb, instrWs, 'Instructions');

    downloadWorkbook(wb, 'ERS_JobPlan_Import_Template.xlsx');
}

// ─── Purchase-Order Line Items Template ─────────────────────────
// Not a BulkImportModal type — PO lines are imported into one open order
// from its Items tab, so this is a standalone template + the columns the
// importer reads.
export const PO_ITEM_COLUMNS = [
    { header: 'description', description: 'What is being bought (free text)', required: true },
    { header: 'qty', description: 'Quantity ordered', required: true },
    { header: 'unitCost', description: 'Cost per unit — defaults to the linked stock item’s cost when blank', required: false },
    { header: 'uom', description: 'Unit of measure: EA, SET, MTR, KG, LTR, BOX', required: false },
    { header: 'inventoryCode', description: 'Stock code to link this line to an inventory item', required: false },
    { header: 'woNumber', description: 'Work order this line is charged to', required: false },
    { header: 'glCode', description: 'GL / cost-centre code', required: false },
];

const PO_ITEM_EXAMPLES = [
    { description: 'Air Inlet Filter — 24x24x12', qty: 4, unitCost: 85.5, uom: 'EA', inventoryCode: 'FLT-0023', woNumber: '', glCode: 'CC-003' },
    { description: 'Thrust Bearing Assembly', qty: 1, unitCost: 2400, uom: 'EA', inventoryCode: 'BRG-0041', woNumber: 'WO-1042', glCode: 'CC-003' },
    { description: 'Contractor day rate — alignment', qty: 2, unitCost: 650, uom: 'EA', inventoryCode: '', woNumber: 'WO-1042', glCode: 'CC-010' },
];

export function downloadPOItemsTemplate(): void {
    const wb = XLSX.utils.book_new();
    const dataHeaders = PO_ITEM_COLUMNS.map(c => c.header);
    const dataRows = PO_ITEM_EXAMPLES.map(ex => dataHeaders.map(h => (ex as any)[h] ?? ''));
    const ws = XLSX.utils.aoa_to_sheet([dataHeaders, ...dataRows]);
    ws['!cols'] = dataHeaders.map(h => ({ wch: Math.max(h.length + 4, 18) }));
    XLSX.utils.book_append_sheet(wb, ws, 'Line Items');

    const instrData = [
        ['Column', 'Required', 'Description'],
        ...PO_ITEM_COLUMNS.map(c => [c.header, c.required ? 'YES' : 'no', c.description]),
        [],
        ['Notes'],
        ['• Lines are ADDED to the purchase order you are editing — nothing is replaced.'],
        ['• inventoryCode links the line to stock, so receiving it moves quantity on hand.'],
        ['• An inventoryCode that matches nothing still imports as a free-text line, and is reported.'],
        ['• Nothing is saved until you save the purchase order.'],
    ];
    const instrWs = XLSX.utils.aoa_to_sheet(instrData);
    instrWs['!cols'] = [{ wch: 18 }, { wch: 10 }, { wch: 70 }];
    XLSX.utils.book_append_sheet(wb, instrWs, 'Instructions');

    downloadWorkbook(wb, 'ERS_PO_LineItems_Template.xlsx');
}

/** Parse a PO line-item sheet into lowercase-keyed rows (headers as shipped). */
export function parsePOItemsFile(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const wb = XLSX.read(new Uint8Array(e.target!.result as ArrayBuffer), { type: 'array' });
                const ws = wb.Sheets[wb.SheetNames[0]];
                const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
                if (raw.length < 2) return resolve({ headers: [], rows: [] });
                const headers = (raw[0] as string[]).map(h => String(h || '').trim());
                const lower = headers.map(h => h.toLowerCase());
                const rows = raw.slice(1)
                    .filter(r => r.some(c => c !== undefined && c !== null && c !== ''))
                    .map((r, idx) => {
                        const o: Record<string, string> = { __row: String(idx + 2) };
                        lower.forEach((h, i) => { o[h] = String(r[i] ?? '').trim(); });
                        return o;
                    });
                resolve({ headers, rows });
            } catch (err) { reject(err); }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsArrayBuffer(file);
    });
}

// ─── Vendor / Supplier Template ─────────────────────────────────
const VENDOR_COLUMNS = [
    { header: 'code', description: 'Vendor code (unique)', required: true },
    { header: 'name', description: 'Company name', required: true },
    { header: 'email', description: 'Email address (unique)', required: true },
    { header: 'contactPerson', description: 'Primary contact name', required: false },
    { header: 'phone', description: 'Phone number', required: false },
    { header: 'address', description: 'Full address', required: false },
    { header: 'paymentTerms', description: 'NET30, NET60, COD', required: false },
    { header: 'category', description: 'PARTS, SERVICES, CONTRACTOR', required: false },
    { header: 'currency', description: 'Default currency (USD, EUR, GBP)', required: false },
];

const VENDOR_EXAMPLES = [
    { code: 'VND-001', name: 'FilterPro Inc', email: 'sales@filterpro.com', contactPerson: 'Mike Chen', phone: '+1-555-0401', address: '100 Industrial Blvd, Dallas TX', paymentTerms: 'NET30', category: 'PARTS', currency: 'USD' },
    { code: 'VND-002', name: 'SKF Distribution', email: 'orders@skf.com', contactPerson: 'Anna Berg', phone: '+46-31-337-1000', address: 'Gothenburg, Sweden', paymentTerms: 'NET60', category: 'PARTS', currency: 'USD' },
    { code: 'VND-003', name: 'Apex Field Services', email: 'dispatch@apexfs.com', contactPerson: 'Tom Baker', phone: '+1-555-0501', address: '200 Service Way, Houston TX', paymentTerms: 'NET30', category: 'SERVICES', currency: 'USD' },
];

export function downloadVendorTemplate(): void {
    const wb = XLSX.utils.book_new();
    const dataHeaders = VENDOR_COLUMNS.map(c => c.header);
    const dataRows = VENDOR_EXAMPLES.map(ex => dataHeaders.map(h => (ex as any)[h] ?? ''));
    const ws = XLSX.utils.aoa_to_sheet([dataHeaders, ...dataRows]);
    ws['!cols'] = dataHeaders.map(h => ({ wch: Math.max(h.length + 4, 16) }));
    XLSX.utils.book_append_sheet(wb, ws, 'Vendors');

    const instrData = [
        ['Column', 'Required', 'Description', 'Valid Values'],
        ...VENDOR_COLUMNS.map(c => [
            c.header, c.required ? 'YES' : 'no', c.description,
            c.header === 'paymentTerms' ? 'NET30, NET60, COD' :
                c.header === 'category' ? 'PARTS, SERVICES, CONTRACTOR' : ''
        ]),
    ];
    const instrWs = XLSX.utils.aoa_to_sheet(instrData);
    instrWs['!cols'] = [{ wch: 18 }, { wch: 10 }, { wch: 50 }, { wch: 35 }];
    XLSX.utils.book_append_sheet(wb, instrWs, 'Instructions');

    downloadWorkbook(wb, 'ERS_Vendors_Template.xlsx');
}

// ─── Asset Data Export ──────────────────────────────────────────

export function exportAssetsToXLSX(assets: Asset[], filename: string = 'ERS_Asset_Export.xlsx'): void {
    const wb = XLSX.utils.book_new();

    // Build hierarchy path for each asset
    const assetMap = new Map(assets.map(a => [a.id, a]));
    const getPath = (a: Asset): string => {
        const parts: string[] = [a.tag];
        let curr = a;
        let depth = 0;
        while (curr.parentId && depth < 10) {
            const parent = assetMap.get(curr.parentId);
            if (parent) {
                parts.unshift(parent.tag);
                curr = parent;
            } else break;
            depth++;
        }
        return parts.join(' → ');
    };

    const rows = assets.map(a => ({
        Tag: a.tag,
        Name: a.name,
        'Equipment Number': a.equipmentNumber || '',
        'Equipment Generation': a.equipmentGeneration ?? 1,
        Type: a.assetType || a.category || '',
        'Parent Tag': a.parentId ? (assetMap.get(a.parentId)?.tag || '') : '',
        'Hierarchy Path': getPath(a),
        Criticality: a.criticality || '',
        Status: a.status,
        Department: a.department || '',
        'Cost Center': a.costCenter || '',
        Location: a.location || '',
        Manufacturer: a.manufacturer || '',
        Model: a.model || '',
        'Serial Number': a.serialNumber || '',
        'Health Score': a.healthScore ?? '',
        Description: a.description || a.name,
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = Object.keys(rows[0] || {}).map(k => ({ wch: Math.max(k.length + 2, 14) }));
    XLSX.utils.book_append_sheet(wb, ws, 'Assets');

    downloadWorkbook(wb, filename);
}

export function exportAssetsToCSV(assets: Asset[], filename: string = 'ERS_Asset_Export.csv'): void {
    const wb = XLSX.utils.book_new();
    const assetMap = new Map(assets.map(a => [a.id, a]));

    const rows = assets.map(a => ({
        tag: a.tag,
        name: a.name,
        equipmentNumber: a.equipmentNumber || '',
        equipmentGeneration: a.equipmentGeneration ?? 1,
        assetType: a.assetType || a.category || '',
        parentTag: a.parentId ? (assetMap.get(a.parentId)?.tag || '') : '',
        criticality: a.criticality || '',
        status: a.status,
        department: a.department || '',
        costCenter: a.costCenter || '',
        location: a.location || '',
        manufacturer: a.manufacturer || '',
        model: a.model || '',
        serialNumber: a.serialNumber || '',
        healthScore: a.healthScore ?? '',
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Assets');
    const wbout = XLSX.write(wb, { bookType: 'csv', type: 'array' });
    const blob = new Blob([wbout], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, filename);
}

// ─── Bulk Import Parsing ────────────────────────────────────────

export interface ParsedRow {
    rowIndex: number;
    data: Record<string, string>;
    errors: string[];
    warnings: string[];
    isValid: boolean;
}

export interface ParseResult {
    type: ImportType;
    headers: string[];
    rows: ParsedRow[];
    validCount: number;
    errorCount: number;
}

/** Reading types that have seeded reference codes. */
export const READING_TYPES = ['HOURS', 'KM', 'TEMPERATURE', 'VIBRATION', 'PRESSURE'];

// ─── SAP migration-workbook profiles ────────────────────────────────────────
// A consultant migrating out of SAP arrives with migration-cockpit-style
// sheets whose headers are SAP FIELD NAMES (TPLNR, EQUNR, MATNR, IDNRK…).
// These profiles let those sheets import DIRECTLY into the module importers —
// no column surgery. A profile is matched by signature (all headers present),
// then its aliases rewrite headers to the canonical template names before
// validation, and its fixup patches per-row gaps (e.g. tag ← EQUNR when no
// TIDNR column exists).
//
// Aliases are PER-SHEET, not global, because SAP reuses field names with
// different roles: TPLNR is the row's own tag on a functional-location sheet
// but the PARENT position on an equipment sheet. When two SAP columns alias
// to one target (TPLNR + HEQUI → parentTag), the last NON-EMPTY value wins —
// sheet order puts the more specific column later.
export interface SapSheetProfile {
    name: string;
    type: ImportType;
    /** All of these (lowercased SAP field names) must be present to match. */
    signature: string[];
    /** lowercased SAP header → canonical lowercased template header. */
    aliases: Record<string, string>;
    /** Per-row patch after aliasing, before validation. */
    fixup?: (r: Record<string, string>) => void;
}

const SAP_MTART_MAP: Record<string, string> = {
    ERSA: 'SPARE', VERB: 'CONSUMABLE', HIBE: 'CONSUMABLE', FHMI: 'TOOL', UNBW: 'MATERIAL', NLAG: 'MATERIAL',
};

export const SAP_PROFILES: SapSheetProfile[] = [
    {
        // Equipment BOM: EQUNR is the parent equipment here, IDNRK the component.
        name: 'SAP equipment BOM', type: 'bom',
        signature: ['equnr', 'idnrk'],
        aliases: { equnr: 'assettag', idnrk: 'inventorycode', menge: 'quantity', meins: 'uom', potx1: 'description' },
        fixup: (r) => {
            if (!r['description']) r['description'] = r['inventorycode'] || '';
            if (!r['quantity']) r['quantity'] = '1';
        },
    },
    {
        // Measurement documents (historical readings): one row per reading.
        name: 'SAP measurement documents', type: 'readings',
        signature: ['mpobj', 'idate'],
        aliases: { mpobj: 'assettag', psort: 'readingtype', idate: 'date', readg: 'value', mrngu: 'unit', mdtxt: 'notes' },
        fixup: (r) => {
            if (!r['value'] && r['cntrr']) r['value'] = r['cntrr'];       // counters carry the total reading
            if (!r['readingtype'] && r['point']) r['readingtype'] = r['point'];
        },
    },
    {
        // Measuring points: definition-only rows (no date/value) — they create
        // or update reading points with unit + alarm limits.
        name: 'SAP measuring points', type: 'readings',
        signature: ['mpobj', 'atnam'],
        aliases: { mpobj: 'assettag', psort: 'readingtype', pttxt: 'pointname', mrngu: 'unit', atvlo: 'minwarning', atvup: 'maxwarning', indct: 'counter' },
        fixup: (r) => {
            if (!r['readingtype'] && r['atnam']) r['readingtype'] = r['atnam'];
        },
    },
    {
        // Material master → inventory items.
        name: 'SAP material master', type: 'inventory',
        signature: ['matnr', 'maktx'],
        aliases: {
            matnr: 'code', maktx: 'description', mtart: 'type', meins: 'uom',
            mfrnr: 'manufacturer', mfrpn: 'model', minbe: 'minlevel', mabst: 'maxlevel',
            lgort: 'storename', lgpbe: 'binlocation', maabc: 'iscritical', verpr: 'itemcost',
        },
        fixup: (r) => {
            const t = (r['type'] || '').toUpperCase();
            if (SAP_MTART_MAP[t]) r['type'] = SAP_MTART_MAP[t];
            const abc = (r['iscritical'] || '').toUpperCase();
            if (abc) r['iscritical'] = abc === 'A' ? 'YES' : 'NO';
            // Price control: S = standard price (STPRS), V = moving average (VERPR).
            if ((r['vprsv'] || '').toUpperCase() === 'S' && r['stprs']) r['itemcost'] = r['stprs'];
            if (!r['itemcost']) r['itemcost'] = r['stprs'] || '0';
        },
    },
    {
        // Opening stock (561-style balances). Creates items with an opening
        // balance; items already loaded via the material sheet are reported
        // as existing (post their stock through the material sheet instead).
        name: 'SAP inventory balances', type: 'inventory',
        signature: ['matnr', 'budat'],
        aliases: { matnr: 'code', menge: 'qtyonhand', meins: 'uom', lgort: 'storename' },
        fixup: (r) => {
            if (!r['description']) r['description'] = `${r['code'] || 'Item'} (opening stock)`;
            if (!r['type']) r['type'] = 'SPARE';
            if (!r['uom']) r['uom'] = 'EA';
            if (!r['itemcost']) r['itemcost'] = '0';
        },
    },
    {
        // Equipment master. TPLNR/HEQUI both alias to parentTag — HEQUI sits
        // later in the sheet, so a superior equipment wins over the position.
        name: 'SAP equipment', type: 'asset',
        signature: ['equnr', 'eqktx'],
        aliases: {
            equnr: 'equipmentnumber', eqktx: 'name', tidnr: 'tag', eqart: 'assettype',
            tplnr: 'parenttag', hequi: 'parenttag', herst: 'manufacturer', typbz: 'model',
            serge: 'serialnumber', abckz: 'criticality', kostl: 'costcenter', stort: 'location',
        },
        fixup: (r) => {
            if (!r['tag']) r['tag'] = r['equipmentnumber'] || '';  // external numbering / no TIDNR column
            if (!r['hierarchylevel']) r['hierarchylevel'] = 'EQUIPMENT';
        },
    },
    {
        // Functional locations. EQART carries SITE/UNIT/SYSTEM in FL exports,
        // which resolves the hierarchy level via the assetType fallback.
        name: 'SAP functional locations', type: 'asset',
        signature: ['tplnr', 'pltxt'],
        aliases: {
            tplnr: 'tag', pltxt: 'name', tplma: 'parenttag', eqart: 'assettype',
            abckz: 'criticality', kostl: 'costcenter', stort: 'location',
        },
    },
];

/** Match a SAP sheet profile: every signature header present. Order matters —
 *  more specific signatures (BOM before Equipment) are listed first. */
export function resolveSapProfile(headersLower: string[]): SapSheetProfile | null {
    const set = new Set(headersLower);
    for (const p of SAP_PROFILES) {
        if (p.signature.every(h => set.has(h))) return p;
    }
    return null;
}

/**
 * SAP-style workbooks put a title, a hint line and the field-name row above
 * the data ("Row 4 = SAP field name"). Find the real header row: the first
 * row (scanning a handful) where ≥3 cells are recognisable header names —
 * canonical template headers or SAP field names. Falls back to row 0.
 */
export function findHeaderRow(rawRows: unknown[][], maxScan = 8): number {
    const known = new Set<string>();
    for (const p of SAP_PROFILES) {
        p.signature.forEach(h => known.add(h));
        Object.keys(p.aliases).forEach(h => known.add(h));
    }
    Object.values(REQUIRED_FIELDS).flat().forEach(h => known.add(h));
    ['assettag', 'readingtype', 'itemcost', 'qtyonhand', 'equipmentnumber', 'hierarchylevel',
        'parenttag', 'serialnumber', 'inventorycode', 'manufacturer', 'model'].forEach(h => known.add(h));

    for (let i = 0; i < Math.min(maxScan, rawRows.length); i++) {
        const hits = new Set(
            (rawRows[i] ?? []).map(c => String(c ?? '').trim().toLowerCase()).filter(c => known.has(c)),
        );
        if (hits.size >= 3) return i;
    }
    return 0;
}

// Header signature map for auto-detection
const TYPE_SIGNATURES: { type: ImportType; required: string[]; distinguisher: string[] }[] = [
    { type: 'bom', required: ['assettag', 'inventorycode'], distinguisher: ['inventorycode'] },
    { type: 'recurring', required: ['code', 'assettag', 'scheduletype'], distinguisher: ['scheduletype', 'frequencyinterval'] },
    { type: 'failurecodes', required: ['category', 'code', 'description'], distinguisher: ['category'] },
    { type: 'jobplan', required: ['pmcode', 'description'], distinguisher: ['operationno', 'pmcode'] },
    { type: 'readings', required: ['assettag', 'readingtype'], distinguisher: ['readingtype'] },
    { type: 'workorder', required: ['wonumber', 'assettag'], distinguisher: ['wonumber'] },
    { type: 'vendor', required: ['code', 'name', 'email'], distinguisher: ['paymentterms', 'contactperson'] },
    { type: 'inventory', required: ['code', 'description', 'uom'], distinguisher: ['itemcost', 'binlocation', 'qtyonhand'] },
    { type: 'location', required: ['tag', 'name', 'locationtype'], distinguisher: ['locationtype', 'gpslat'] },
    { type: 'people', required: ['code', 'name', 'email'], distinguisher: ['hourlyrate', 'qualifications', 'orgunit'] },
    { type: 'asset', required: ['tag', 'name'], distinguisher: ['assettype', 'hierarchylevel', 'serialnumber'] },
];

// Required fields per type (lowercase). Assets no longer require assetType —
// hierarchyLevel or assetType must resolve to a level, which the import engine
// checks against the live level model (a template can't encode that rule).
const REQUIRED_FIELDS: Record<ImportType, string[]> = {
    asset: ['tag', 'name'],
    bom: ['assettag', 'inventorycode', 'description', 'quantity'],
    recurring: ['code', 'description', 'assettag', 'scheduletype', 'frequencyinterval', 'frequencyunit'],
    people: ['code', 'name', 'email', 'type'],
    inventory: ['code', 'description', 'type', 'uom', 'itemcost'],
    workorder: ['wonumber', 'description', 'assettag', 'type', 'priority'],
    location: ['tag', 'name', 'locationtype'],
    vendor: ['code', 'name', 'email'],
    readings: ['assettag', 'readingtype', 'date', 'value'],
    jobplan: ['pmcode', 'description'],
    failurecodes: ['category', 'code', 'description'],
    unknown: [],
};

/**
 * Excel serial / ISO / d-m-y → ISO date string. Excel stores dates as days
 * since 1899-12-30 when a cell is date-formatted, so a raw parse yields "45678".
 */
export function parseDateValue(raw: string): string | null {
    const v = String(raw ?? '').trim();
    if (!v) return null;

    if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
        const d = new Date(v);
        return isNaN(d.getTime()) ? null : v.slice(0, 10);
    }
    // Excel serial
    if (/^\d+(\.\d+)?$/.test(v)) {
        const serial = Number(v);
        if (serial > 0 && serial < 100000) {
            const ms = Math.round((serial - 25569) * 86400 * 1000);
            const d = new Date(ms);
            return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
        }
        return null;
    }
    // d/m/y or m/d/y — ambiguous; prefer d/m/y when the first part can't be a month
    const m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
    if (m) {
        let [, a, b, y] = m;
        let day = Number(a), month = Number(b);
        if (day <= 12 && month > 12) { const t = day; day = month; month = t; }
        const year = Number(y.length === 2 ? `20${y}` : y);
        const d = new Date(Date.UTC(year, month - 1, day));
        return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    }
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function detectImportType(headers: string[]): ImportType {
    const lc = new Set(headers.map(h => h.toLowerCase()));

    for (const sig of TYPE_SIGNATURES) {
        const hasRequired = sig.required.every(h => lc.has(h));
        const hasDistinguisher = sig.distinguisher.some(h => lc.has(h));
        if (hasRequired && hasDistinguisher) return sig.type;
    }

    // Fallback: broader checks
    if (lc.has('tag') && lc.has('name')) return 'asset';
    if (lc.has('assettag') && lc.has('inventorycode')) return 'bom';
    return 'unknown';
}

export function parseImportFile(file: File, forceType?: ImportType): Promise<ParseResult> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target!.result as ArrayBuffer);
                const wb = XLSX.read(data, { type: 'array' });
                const sheetName = wb.SheetNames[0];
                const ws = wb.Sheets[sheetName];
                const rawRows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

                if (rawRows.length < 2) {
                    resolve({ type: 'unknown', headers: [], rows: [], validCount: 0, errorCount: 0 });
                    return;
                }

                // SAP-style workbooks carry title/hint rows above the header row.
                const headerRowIdx = findHeaderRow(rawRows);
                const headers = (rawRows[headerRowIdx] as string[]).map(h => String(h || '').trim());
                const headersLower = headers.map(h => h.toLowerCase());
                // SAP field-name sheets rewrite to canonical headers via profile.
                const sapProfile = resolveSapProfile(headersLower);
                const keys = sapProfile ? headersLower.map(h => sapProfile.aliases[h] ?? h) : headersLower;
                const dataRows = rawRows.slice(headerRowIdx + 1).filter(r => r.some(cell => cell !== undefined && cell !== null && cell !== ''));

                const type = forceType || sapProfile?.type || detectImportType(keys);
                const requiredFields = REQUIRED_FIELDS[type] || [];

                const seenKeys = new Set<string>(); // For duplicate detection

                const parsedRows: ParsedRow[] = dataRows.map((row, idx) => {
                    const rowData: Record<string, string> = {};
                    keys.forEach((h, i) => {
                        const v = String(row[i] ?? '').trim();
                        // Two SAP columns may alias to one target (TPLNR + HEQUI →
                        // parentTag): last NON-EMPTY wins; never blank an earlier value.
                        if (v || !(h in rowData)) rowData[h] = v;
                    });
                    if (sapProfile?.fixup) sapProfile.fixup(rowData);

                    const errors: string[] = [];
                    const warnings: string[] = [];

                    // A measuring-point sheet defines reading points without logging
                    // a reading — date/value are only required on actual readings.
                    const definitionOnly = type === 'readings' && !rowData['date'] && !rowData['value']
                        && !!(rowData['pointname'] || rowData['minwarning'] || rowData['maxwarning'] || rowData['counter']);

                    // Required field check
                    requiredFields.forEach(f => {
                        if (definitionOnly && (f === 'date' || f === 'value')) return;
                        if (!rowData[f]) errors.push(`Missing required: ${f}`);
                    });

                    // Type-specific validation
                    switch (type) {
                        case 'asset': {
                            const tag = rowData['tag'];
                            if (tag && seenKeys.has(tag.toUpperCase())) errors.push(`Duplicate tag: ${tag}`);
                            if (tag) seenKeys.add(tag.toUpperCase());
                            const crit = rowData['criticality'];
                            if (crit && !['A', 'B', 'C', 'D'].includes(crit.toUpperCase())) warnings.push(`Invalid criticality "${crit}"`);
                            const status = rowData['status'];
                            if (status && !['ACTIVE', 'OPERATING', 'MAINTENANCE', 'STANDBY', 'DOWN', 'DECOMMISSIONED'].includes(status.toUpperCase())) warnings.push(`Invalid status "${status}"`);
                            // The level must resolve here or the row can't be placed. Deeper
                            // rules (parent legality, per-level criticality) need the whole
                            // file plus the DB, so the import engine owns those.
                            if (!rowData['hierarchylevel'] && !rowData['assettype']) {
                                errors.push('Missing hierarchyLevel (or an assetType naming a level)');
                            }
                            if (tag && rowData['parenttag'] && rowData['parenttag'].toUpperCase() === tag.toUpperCase()) {
                                errors.push('parentTag cannot be the row\'s own tag');
                            }
                            break;
                        }
                        case 'failurecodes': {
                            const cat = (rowData['category'] || '').toUpperCase();
                            if (cat && !CODE_CATEGORIES.includes(cat)) {
                                errors.push(`Unknown category "${rowData['category']}" — expected one of ${CODE_CATEGORIES.join(', ')}`);
                            }
                            const dupKey = `${cat}|${rowData['code']}`;
                            if (rowData['code'] && seenKeys.has(dupKey)) errors.push(`Duplicate ${cat} code "${rowData['code']}" in this file`);
                            if (rowData['code']) seenKeys.add(dupKey);
                            break;
                        }
                        case 'jobplan': {
                            const hrs = rowData['esthours'];
                            if (hrs && isNaN(Number(hrs))) errors.push('estHours must be a number');
                            const np = rowData['numpersons'];
                            if (np && isNaN(Number(np))) errors.push('numPersons must be a number');
                            const ck = rowData['controlkey'];
                            if (ck && !['PM01', 'PM02'].includes(ck.toUpperCase())) {
                                warnings.push(`Unusual controlKey "${ck}" — expected PM01 or PM02`);
                            }
                            break;
                        }
                        case 'readings': {
                            if (rowData['date'] && !parseDateValue(rowData['date'])) {
                                errors.push(`Unrecognised date "${rowData['date']}"`);
                            }
                            const val = rowData['value'];
                            if (val && isNaN(Number(val))) errors.push('value must be a number');
                            const rt = rowData['readingtype'];
                            if (rt && !READING_TYPES.includes(rt.toUpperCase())) {
                                warnings.push(`Unknown readingType "${rt}" — it will still import`);
                            }
                            break;
                        }
                        case 'bom': {
                            const qty = rowData['quantity'];
                            if (qty && isNaN(Number(qty))) errors.push(`Quantity must be a number`);
                            break;
                        }
                        case 'recurring': {
                            const code = rowData['code'];
                            if (code && seenKeys.has(code.toUpperCase())) errors.push(`Duplicate code: ${code}`);
                            if (code) seenKeys.add(code.toUpperCase());
                            const st = rowData['scheduletype'];
                            if (st && !['TIME', 'READING'].includes(st.toUpperCase())) errors.push(`scheduleType must be TIME or READING`);
                            const fi = rowData['frequencyinterval'];
                            if (fi && (isNaN(Number(fi)) || Number(fi) <= 0)) errors.push(`frequencyInterval must be > 0`);
                            break;
                        }
                        case 'people': {
                            const code = rowData['code'];
                            if (code && seenKeys.has(code.toUpperCase())) errors.push(`Duplicate code: ${code}`);
                            if (code) seenKeys.add(code.toUpperCase());
                            const email = rowData['email'];
                            if (email && !email.includes('@')) errors.push(`Invalid email format`);
                            const pType = rowData['type'];
                            if (pType && !['INTERNAL', 'TECHNICIAN', 'CONTRACTOR', 'VENDOR'].includes(pType.toUpperCase())) warnings.push(`Invalid type "${pType}"`);
                            break;
                        }
                        case 'inventory': {
                            const code = rowData['code'];
                            if (code && seenKeys.has(code.toUpperCase())) errors.push(`Duplicate code: ${code}`);
                            if (code) seenKeys.add(code.toUpperCase());
                            const cost = rowData['itemcost'];
                            if (cost && isNaN(Number(cost))) errors.push(`itemCost must be a number`);
                            if (cost && Number(cost) < 0) errors.push(`itemCost cannot be negative`);
                            const qty = rowData['qtyonhand'];
                            if (qty && isNaN(Number(qty))) errors.push(`qtyOnHand must be a number`);
                            break;
                        }
                        case 'workorder': {
                            const wo = rowData['wonumber'];
                            if (wo && seenKeys.has(wo.toUpperCase())) errors.push(`Duplicate WO: ${wo}`);
                            if (wo) seenKeys.add(wo.toUpperCase());
                            const woType = rowData['type'];
                            if (woType && !['CM', 'PM', 'PDM', 'INSPECTION', 'SAFETY'].includes(woType.toUpperCase())) warnings.push(`Invalid WO type "${woType}"`);
                            const pri = rowData['priority'];
                            if (pri && !['EMERGENCY', 'HIGH', 'MEDIUM', 'LOW'].includes(pri.toUpperCase())) warnings.push(`Invalid priority "${pri}"`);
                            break;
                        }
                        case 'location': {
                            const tag = rowData['tag'];
                            if (tag && seenKeys.has(tag.toUpperCase())) errors.push(`Duplicate tag: ${tag}`);
                            if (tag) seenKeys.add(tag.toUpperCase());
                            const lt = rowData['locationtype'];
                            if (lt && !['SITE', 'AREA', 'BUILDING', 'FLOOR', 'ROOM'].includes(lt.toUpperCase())) warnings.push(`Invalid locationType "${lt}"`);
                            break;
                        }
                        case 'vendor': {
                            const code = rowData['code'];
                            if (code && seenKeys.has(code.toUpperCase())) errors.push(`Duplicate code: ${code}`);
                            if (code) seenKeys.add(code.toUpperCase());
                            const email = rowData['email'];
                            if (email && !email.includes('@')) errors.push(`Invalid email format`);
                            break;
                        }
                    }

                    return {
                        rowIndex: idx + 2,
                        data: rowData,
                        errors,
                        warnings,
                        isValid: errors.length === 0,
                    };
                });

                resolve({
                    type,
                    headers,
                    rows: parsedRows,
                    validCount: parsedRows.filter(r => r.isValid).length,
                    errorCount: parsedRows.filter(r => !r.isValid).length,
                });
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsArrayBuffer(file);
    });
}

export {
    ASSET_COLUMNS, BOM_COLUMNS, RECURRING_JOB_COLUMNS, PEOPLE_COLUMNS,
    INVENTORY_COLUMNS, WORK_ORDER_COLUMNS, VENDOR_COLUMNS, READINGS_COLUMNS, JOB_PLAN_COLUMNS, FAILURE_CODE_COLUMNS,
};

