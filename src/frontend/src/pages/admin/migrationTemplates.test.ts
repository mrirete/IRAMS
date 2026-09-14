/**
 * Every template the Migration Center hands out for a source system must
 * import as it arrives — the file a user downloads on a phase is parsed by
 * that phase's importer and lands as the right type. Round trip, not labels.
 */
import { describe, it, expect } from 'vitest';
import { phaseTemplatesFor } from './migrationTemplates';
import { parseImportFile } from '../../eam/services/assetTemplates';

describe('Migration Center templates per source system', () => {
    it('SAP PM: each phase offers SAP-shaped files; other phases offer none', () => {
        const ids = (n: number) => phaseTemplatesFor('sap_pm', n).map(t => t.id);
        expect(ids(1)).toEqual(['sap_cockpit']);
        expect(ids(3)).toEqual(['sap_cockpit']);
        expect(ids(4)).toEqual(['sap_cockpit']);
        expect(ids(6)).toEqual(['sap_maintenance_plan_item', 'sap_general_task_list']);
        expect(ids(9)).toEqual(['sap_measuring_points', 'sap_cockpit']);
        expect(ids(7)).toEqual([]);   // history goes through the wizard, which has its own SAP pair
        expect(ids(8)).toEqual([]);
    });

    it('SAP cockpit workbook: the phase importers pick their sheets and read the examples', async () => {
        const file = phaseTemplatesFor('sap_pm', 1)[0].file();
        const assets = await parseImportFile(file, 'asset');
        expect(assets.type).toBe('asset');
        expect(assets.validCount).toBeGreaterThan(0);
        expect(assets.errorCount).toBe(0);
        const types = new Set(assets.sheets?.map(s => s.type));
        expect(types).toContain('asset');
        expect(types).toContain('inventory');
        expect(types).toContain('bom');
        expect(types).toContain('readings');
        const inv = await parseImportFile(file, 'inventory');
        expect(inv.type).toBe('inventory');
        expect(inv.errorCount).toBe(0);
        const bom = await parseImportFile(file, 'bom');
        expect(bom.type).toBe('bom');
        expect(bom.errorCount).toBe(0);
        const rd = await parseImportFile(file, 'readings');
        expect(rd.type).toBe('readings');
        expect(rd.errorCount).toBe(0);
    });

    it('SAP PM load files: schedules, job plans and measuring points land as their types with no errors', async () => {
        const [plan, taskList] = phaseTemplatesFor('sap_pm', 6);
        const p = await parseImportFile(plan.file(), 'recurring');
        expect(p.type).toBe('recurring');
        expect(p.validCount).toBe(2);
        expect(p.errorCount).toBe(0);
        const t = await parseImportFile(taskList.file(), 'jobplan');
        expect(t.type).toBe('jobplan');
        expect(t.validCount).toBe(6);
        expect(t.errorCount).toBe(0);
        const [points] = phaseTemplatesFor('sap_pm', 9);
        const m = await parseImportFile(points.file(), 'readings');
        expect(m.type).toBe('readings');
        expect(m.validCount).toBe(15);
        expect(m.errorCount).toBe(0);
    });

    it('other systems: nothing SAP-shaped, and no flat wizard template on a hierarchy phase', () => {
        // A Maximo/MaintainX register template belongs to the CMMS Import Wizard:
        // it is flat, has no hierarchy level, and would fail this phase's
        // importer. Those systems keep the IREAMS asset template inside the importer.
        for (const source of ['maximo', 'maintainx', 'emaint', 'limble', 'fiix', 'upkeep', 'spreadsheet', 'other']) {
            for (const phase of [1, 3, 4, 6, 7, 8, 9]) {
                expect(phaseTemplatesFor(source, phase)).toEqual([]);
            }
        }
    });
});
