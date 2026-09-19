/**
 * What the Validate step must catch BEFORE the import engine runs.
 *
 * The migration failure these guard against: one bad row that is a site or a
 * unit does not fail alone. Everything hanging beneath it fails too, with
 * "parent was not imported, so this row has nowhere to hang". So a row the
 * engine will reject has to be rejected at Validate, where the operator can
 * still fix the file, not after a partial write.
 */
import { describe, it, expect } from 'vitest';
import { parseImportFile } from './assetTemplates';

const csv = (body: string) => new File([body], 'assets.csv', { type: 'text/csv' });
const rowFor = (res: Awaited<ReturnType<typeof parseImportFile>>, tag: string) =>
    res.rows.find(r => (r.data['tag'] || '').toUpperCase() === tag)!;

describe('asset import validation', () => {
    it('rejects an unreadable criticality on a level that requires one', async () => {
        const res = await parseImportFile(csv(
            'tag,name,hierarchyLevel,criticality\n' +
            'P-1,Pump,EQUIPMENT,BANANA\n'
        ), 'asset');
        const row = rowFor(res, 'P-1');
        expect(row.isValid).toBe(false);
        expect(row.errors.join(' ')).toMatch(/not one of A, B, C, D/i);
    });

    /**
     * The regression this test exists for. hierarchyLevel is NOT a required
     * column — the template says to leave it blank when assetType already names
     * a level. The first version of this check read the hierarchyLevel cell
     * directly, so a row of this shape was ticked green here and failed at
     * import, which is precisely the behaviour the work was removing.
     */
    it('applies that check when the level comes from assetType instead', async () => {
        const res = await parseImportFile(csv(
            'tag,name,assetType,criticality\n' +
            'P-2,Pump,EQUIPMENT,BANANA\n'
        ), 'asset');
        const row = rowFor(res, 'P-2');
        expect(row.isValid).toBe(false);
        expect(row.errors.join(' ')).toMatch(/not one of A, B, C, D/i);
    });

    it('translates a readable synonym and lets the row through as a warning', async () => {
        const res = await parseImportFile(csv(
            'tag,name,hierarchyLevel,criticality\n' +
            'P-3,Pump,EQUIPMENT,HIGH\n'
        ), 'asset');
        const row = rowFor(res, 'P-3');
        expect(row.isValid).toBe(true);
        expect(row.errors).toHaveLength(0);
        expect(row.warnings.join(' ')).toMatch(/read as B/);
    });

    it('rejects a child placed under a parent that cannot hold it', async () => {
        // SITE may contain AREA or UNIT, never SYSTEM.
        const res = await parseImportFile(csv(
            'tag,name,hierarchyLevel,parentTag,criticality\n' +
            'S-1,Site,SITE,,\n' +
            'SYS-1,System,SYSTEM,S-1,\n'
        ), 'asset');
        const child = rowFor(res, 'SYS-1');
        expect(child.isValid).toBe(false);
        expect(child.errors.join(' ')).toMatch(/cannot sit under SITE/i);
        // the parent itself is fine
        expect(rowFor(res, 'S-1').isValid).toBe(true);
    });

    it('accepts a legal tree', async () => {
        const res = await parseImportFile(csv(
            'tag,name,hierarchyLevel,parentTag,criticality\n' +
            'S-2,Site,SITE,,\n' +
            'U-2,Unit,UNIT,S-2,\n' +
            'SYS-2,System,SYSTEM,U-2,\n' +
            'P-4,Pump,EQUIPMENT,SYS-2,A\n'
        ), 'asset');
        expect(res.rows.every(r => r.isValid)).toBe(true);
        expect(res.errorCount).toBe(0);
    });

    it('leaves a blank criticality alone where the level does not require one', async () => {
        const res = await parseImportFile(csv(
            'tag,name,hierarchyLevel,criticality\n' +
            'S-3,Site,SITE,\n'
        ), 'asset');
        const row = rowFor(res, 'S-3');
        expect(row.isValid).toBe(true);
        expect(row.warnings.join(' ')).not.toMatch(/criticality/i);
    });
});
