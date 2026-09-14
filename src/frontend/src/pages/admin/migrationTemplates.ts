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
 * Other systems export flat lists; they get the register/history pair the
 * CMMS Import Wizard already offers for that system, and the hierarchy is
 * built with IREAMS's own asset template inside the importer.
 */
import { buildSapWorkbook, defaultParams } from '../../lib/sapLoad/build';
import { downloadWorkbook } from '../../eam/services/assetTemplates';
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

/**
 * Templates for one phase of the Migration Center, for the chosen source
 * system. Only SAP PM has files shaped for these phases. Maximo, MaintainX
 * and the rest export flat lists that the CMMS Import Wizard (phase 7) maps
 * with its own per-system templates; their register is built here with the
 * IREAMS asset template inside the importer — a flat wizard template has no
 * hierarchy level and would fail this phase's importer.
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
            default: return [];
        }
    }
    return [];
}
