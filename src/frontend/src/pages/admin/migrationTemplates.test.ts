/**
 * Every template the Migration Center hands out for a source system must
 * import as it arrives — the file a user downloads on a phase is parsed by
 * that phase's importer and lands as the right type. Round trip, not labels.
 */
import { describe, it, expect } from 'vitest';
import { phaseTemplatesFor } from './migrationTemplates';
import { parseImportFile } from '../../eam/services/assetTemplates';

describe('Migration Center templates per source system', () => {
    it('SAP PM: SAP-shaped files where SAP has them, IREAMS templates for the rest', () => {
        const ids = (n: number) => phaseTemplatesFor('sap_pm', n).map(t => t.id);
        expect(ids(1)).toEqual(['sap_cockpit']);
        expect(ids(3)).toEqual(['sap_cockpit']);
        expect(ids(4)).toEqual(['sap_cockpit']);
        expect(ids(6)).toEqual(['sap_maintenance_plan_item', 'sap_general_task_list']);
        expect(ids(9)).toEqual(['sap_measuring_points', 'sap_cockpit']);
        expect(ids(7)).toEqual([]);   // history goes through the wizard, which has its own SAP pair
        expect(ids(2)).toEqual(['ireams_people']);
        expect(ids(5)).toEqual(['ireams_vendor']);
        expect(ids(8)).toEqual(['ireams_failurecodes']);
        expect(ids(10)).toEqual([]);
        expect(ids(11)).toEqual([]);
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

    it('other systems: IREAMS’s own template for every load step, nothing SAP-shaped', () => {
        // A flat Maximo/MaintainX register template belongs to the Import Work
        // History wizard — it has no hierarchy level and would fail step 1's
        // importer. Every step here gets IREAMS's own template instead.
        const expected: Record<number, string[]> = {
            1: ['ireams_asset'], 2: ['ireams_people'], 3: ['ireams_inventory'], 4: ['ireams_bom'], 5: ['ireams_vendor'],
            6: ['ireams_recurring', 'ireams_jobplan'], 7: [], 8: ['ireams_failurecodes'], 9: ['ireams_readings'], 10: [], 11: [],
        };
        for (const source of ['maximo', 'maintainx', 'emaint', 'limble', 'fiix', 'upkeep', 'spreadsheet', 'other']) {
            for (const [phase, ids] of Object.entries(expected)) {
                expect(phaseTemplatesFor(source, Number(phase)).map(t => t.id)).toEqual(ids);
            }
        }
    });

    it('IREAMS templates import as they are downloaded — each step’s importer reads the examples', async () => {
        const cases: [number, string, string][] = [
            [1, 'ireams_asset', 'asset'], [3, 'ireams_inventory', 'inventory'], [4, 'ireams_bom', 'bom'],
            [9, 'ireams_readings', 'readings'], [8, 'ireams_failurecodes', 'failurecodes'],
        ];
        for (const [phase, id, type] of cases) {
            const t = phaseTemplatesFor('fiix', phase).find(x => x.id === id)!;
            const parsed = await parseImportFile(t.file(), type as Parameters<typeof parseImportFile>[1]);
            expect(parsed.type, id).toBe(type);
            expect(parsed.validCount, id).toBeGreaterThan(0);
            expect(parsed.errorCount, id).toBe(0);
        }
    });
});
