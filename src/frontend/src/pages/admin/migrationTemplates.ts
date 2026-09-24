/**
 * migrationTemplates — which downloadable templates each Migration Center
 * phase offers, per source system.
 *
 * "These files come from: SAP PM" has to change what a user is handed, not
 * only how the batch is named. A SAP shop gets the files a SAP consultant
 * already has: the Migration Cockpit workbook (functional locations,
 * equipment, materials, BOMs, measuring points, readings, source lists,
 * opening stock — one sheet per object, SAP field names on row 4) and the PM
 * load files (maintenance plan/item, general task list, measuring points, in
 * the load-file layout with a "Field" header row). Every one of them imports
 * as it arrives — the round trip is tested in migrationTemplates.test.ts.
 *
 * Every other system — and any SAP step with no SAP file of its own (people,
 * vendors, failure codes) — gets IREAMS's own template for the step: the
 * same file the step's importer offers, with example rows and a Read-me,
 * and it works whatever system the data comes from. Work-order history is
 * the exception: it goes through the Import Work History wizard, which has
 * its own per-system templates.
 */
import { buildSapWorkbook, defaultParams } from '../../lib/sapLoad/build';
import {
    downloadWorkbook, buildAssetTemplate, buildPeopleTemplate, buildInventoryTemplate, buildBOMTemplate,
    buildVendorTemplate, buildRecurringJobTemplate, buildJobPlanTemplate, buildFailureCodesTemplate,
    buildReadingsTemplate,
} from '../../eam/services/assetTemplates';
import { downloadSapPmLoadFile, SAP_PM_LOAD_FILE_LABELS, sapPmLoadFile } from '../../eam/services/sapPmLoadFiles';
import * as XLSX from 'xlsx';

export interface PhaseTemplate {
    /** Stable id for tests and keys. */
    id: string;
    label: string;
    /** What the file covers, shown under the label. */
    hint: string;
    download: () => void;
    /** The same file as the browser would upload it — for tests. */
    file: () => File;
}

const COCKPIT_FILENAME = 'SAP_Load_Templates.xlsx';

function cockpitWorkbook(): XLSX.WorkBook {
    const p = { ...defaultParams(), systemLabel: '' };
    return buildSapWorkbook(null, p, { mode: 'template' });
}

const sapCockpit = (hint: string): PhaseTemplate => ({
    id: 'sap_cockpit',
    label: 'SAP Migration Cockpit workbook',
    hint,
    download: () => downloadWorkbook(cockpitWorkbook(), COCKPIT_FILENAME),
    file: () => {
        const buf = XLSX.write(cockpitWorkbook(), { bookType: 'xlsx', type: 'array' });
        return new File([buf], COCKPIT_FILENAME);
    },
});

const sapLoadFile = (name: 'Maintenance_Plan_Item' | 'Measuring_Points' | 'General_Task_List', hint: string): PhaseTemplate => ({
    id: `sap_${name.toLowerCase()}`,
    label: `SAP ${SAP_PM_LOAD_FILE_LABELS[name]}`,
    hint,
    download: () => downloadSapPmLoadFile(name),
    file: () => sapPmLoadFile(name),
});

const ireams = (id: string, label: string, filename: string, build: () => XLSX.WorkBook, hint: string): PhaseTemplate => ({
    id: `ireams_${id}`,
    label: `IREAMS ${label} template`,
    hint,
    download: () => downloadWorkbook(build(), filename),
    file: () => new File([XLSX.write(build(), { bookType: 'xlsx', type: 'array' })], filename),
});

/** IREAMS's own template for each step — works for any source system. */
const IREAMS_PHASE: Partial<Record<number, PhaseTemplate[]>> = {
    1: [ireams('asset', 'asset register', 'ERS_Asset_Import_Template.xlsx', buildAssetTemplate,
        'Sites, systems and equipment as one tree: hierarchyLevel and parentTag place each row. Example rows and a Read-me sheet included.')],
    2: [ireams('people', 'people', 'ERS_People_Template.xlsx', buildPeopleTemplate,
        'One row per person: type, department, qualifications and hourly rate. Invite them to log in afterwards.')],
    3: [ireams('inventory', 'inventory', 'ERS_Inventory_Template.xlsx', buildInventoryTemplate,
        'Spare parts, unit costs and opening stock; storerooms are created from the storeName column.')],
    4: [ireams('bom', 'bill of materials', 'ERS_BOM_Import_Template.xlsx', buildBOMTemplate,
        'Asset tag + inventory code per line; both registers must already exist.')],
    5: [ireams('vendor', 'vendor', 'ERS_Vendors_Template.xlsx', buildVendorTemplate,
        'Suppliers and contractors your purchase orders and warranties refer to.')],
    6: [
        ireams('recurring', 'PM schedule', 'ERS_Recurring_Jobs_Template.xlsx', buildRecurringJobTemplate,
            'Recurring jobs with their interval and asset. Import these first.'),
        ireams('jobplan', 'job plan', 'ERS_JobPlan_Import_Template.xlsx', buildJobPlanTemplate,
            'The task steps a technician follows; they attach to the schedules by PM code.'),
    ],
    8: [ireams('failurecodes', 'failure-code', 'ERS_FailureCodes_Template.xlsx', buildFailureCodesTemplate,
        'Failure modes, causes and remedies — or use "Export unresolved codes from history" to get your own codes pre-filled.')],
    9: [ireams('readings', 'readings', 'ERS_Readings_Import_Template.xlsx', buildReadingsTemplate,
        'Runtime hours, vibration and temperature logs; reading points are created from the rows.')],
};

/**
 * Templates for one phase of the Migration Center, for the chosen source
 * system. SAP PM gets its own cockpit and load files where SAP has them, and
 * IREAMS's template for the steps SAP has no file for; every other system
 * gets IREAMS's template for each step.
 */
export function phaseTemplatesFor(sourceSystem: string, phase: number): PhaseTemplate[] {
    if (sourceSystem === 'sap_pm') {
        switch (phase) {
            case 1: return [sapCockpit('Drop the whole workbook — the Functional Location and Equipment sheets are picked for this step.')];
            case 3: return [sapCockpit('The Material, Source List and Inventory Balance sheets are picked for this step.')];
            case 4: return [sapCockpit('The Equipment BOM sheet is picked for this step.')];
            case 6: return [
                sapLoadFile('Maintenance_Plan_Item', 'Maintenance Items become PM schedules; the plan sheet in the same workbook supplies the cycle and start date.'),
                sapLoadFile('General_Task_List', 'Operations become job plans on the schedules that use the task list; packages split a strategy plan by cadence; components become planned materials.'),
            ];
            case 9: return [
                sapLoadFile('Measuring_Points', 'Measuring points in the load-file layout: equipment from EQUNR, unit from MSEHI, MRMIN/MRMAX as the warning band.'),
                sapCockpit('The Measuring Point and Measurement Document sheets are picked for this step — points with alarm limits, then history.'),
            ];
            default: return IREAMS_PHASE[phase] ?? [];
        }
    }
    return IREAMS_PHASE[phase] ?? [];
}
