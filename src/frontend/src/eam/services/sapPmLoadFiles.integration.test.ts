/**
 * The consultant's SAP PM load files (maintenance plans, measuring points,
 * general task lists) dropped on the Migration Center as they arrive: a label
 * column, "Field" on the header row, six documentation rows under it, SAP
 * field names from IMPTT / MPLA / MPOS / PLKO / PLPO, load rows keyed TMP…/SMP….
 *
 * Fixture = the real workbooks verbatim (sapPmLoadFiles.fixture.ts), defects
 * included — MPOBJ holding "IEQ", MRMIN/MRMAX used as bands, duplicate names.
 */
import { describe, it, expect } from 'vitest';
import { parseImportFile } from './assetTemplates';
import { sapPmLoadFile } from './sapPmLoadFiles.fixture';

describe('Measuring point load file → reading points', () => {
    it('lists the sheets: the sample key is documentation, the data sheet is readings', async () => {
        const res = await parseImportFile(sapPmLoadFile('Measuring_Points'));
        expect(res.sheets?.map(s => `${s.name}:${s.type}`)).toEqual(['_Sample_Key:unknown', 'Measuring Point Data:readings']);
        expect(res.sheet).toBe('Measuring Point Data');
        expect(res.type).toBe('readings');
    });

    it('the six documentation rows under the Field row never become reading points', async () => {
        const res = await parseImportFile(sapPmLoadFile('Measuring_Points'));
        expect(res.rows).toHaveLength(15);
        expect(res.errorCount).toBe(0);
        const names = res.rows.map(r => r.data['pointname']);
        expect(names).not.toContain('Description of Measuring Point');  // Field Description row
        expect(names).not.toContain('CHAR');                            // Data Type row
        expect(names).not.toContain('40');                              // Length row
        // Row numbers are the spreadsheet's: header on row 4, docs on 5–10, data from row 11.
        expect(res.rows[0].rowIndex).toBe(11);
        expect(res.rows[14].rowIndex).toBe(25);
    });

    it('the equipment comes from EQUNR, not from MPOBJ ("IEQ" is an object-type prefix)', async () => {
        const res = await parseImportFile(sapPmLoadFile('Measuring_Points'));
        const tags = res.rows.map(r => r.data['assettag']);
        expect(new Set(tags)).toEqual(new Set(['ES0654503', 'ES0654588']));
        expect(tags.slice(0, 8).every(t => t === 'ES0654503')).toBe(true);   // the pump's eight points
        expect(tags.slice(8).every(t => t === 'ES0654588')).toBe(true);      // the motor's seven
    });

    it('reading type from the characteristic name (MP_VIBRATION → VIBRATION), position kept apart', async () => {
        const res = await parseImportFile(sapPmLoadFile('Measuring_Points'));
        expect(res.rows.map(r => r.data['readingtype'])).toEqual([
            'TEMPERATURE', 'TEMPERATURE', 'VIBRATION', 'VIBRATION', 'VIBRATION', 'VIBRATION', 'VIBRATION', 'VIBRATION',
            'CURRENT', 'VIBRATION', 'VIBRATION', 'VIBRATION', 'VIBRATION', 'VIBRATION', 'VIBRATION',
        ]);
        expect(res.rows[2].data['position']).toBe('3');
        expect(res.rows[2].data['pointname']).toBe('PUMP NDE HORIZONDAL VIBRATION');
    });

    it('unit is the characteristic unit MSEHI, with SAP unit keys made readable', async () => {
        const res = await parseImportFile(sapPmLoadFile('Measuring_Points'));
        expect(res.rows[0].data['unit']).toBe('°C');
        expect(res.rows[2].data['unit']).toBe('mm/s');   // MMS
        expect(res.rows[8].data['unit']).toBe('A');
    });

    it('MRMIN/MRMAX land as the warning band — and every such row says so', async () => {
        const res = await parseImportFile(sapPmLoadFile('Measuring_Points'));
        expect(res.rows[2].data['minwarning']).toBe('5.40');
        expect(res.rows[2].data['maxwarning']).toBe('8.50');
        expect(res.rows[8].data['minwarning']).toBe('0');
        expect(res.rows[8].data['maxwarning']).toBe('2.75');
        for (const r of res.rows) {
            expect(r.warnings.some(w => /MRMIN\/MRMAX/.test(w))).toBe(true);
            expect(r.isValid).toBe(true);
        }
    });

    it('definition-only rows: no date, no value, so nothing is logged as a reading', async () => {
        const res = await parseImportFile(sapPmLoadFile('Measuring_Points'));
        for (const r of res.rows) {
            expect(r.data['date'] ?? '').toBe('');
            expect(r.data['value'] ?? '').toBe('');
            expect(r.errors).toEqual([]);
        }
    });
});

describe('Maintenance plan and task list load files', () => {
    // These objects have no inbound profile yet: IREAMS's PM schedule wants
    // code / assetTag / frequency, the job plan wants operations — the fields
    // are all in these files under MPLA/MPOS/PLKO/PLPO names, but the mapping
    // is not built. Until it is, the sheets must be reported as unrecognised,
    // never mis-imported as something else.
    it('maintenance plan workbook parses without error and reports every sheet as unrecognised', async () => {
        const res = await parseImportFile(sapPmLoadFile('Maintenance_Plan_Item'));
        expect(res.sheets?.map(s => s.name)).toEqual(['_Sample_Key', 'Maintenance Plan', 'Maintenance Items', 'Object List']);
        expect(res.sheets?.every(s => s.type === 'unknown')).toBe(true);
        expect(res.type).toBe('unknown');
    });

    it('general task list workbook parses without error and reports every sheet as unrecognised', async () => {
        const res = await parseImportFile(sapPmLoadFile('General_Task_List'));
        expect(res.sheets?.map(s => s.name)).toEqual(['_Sample_Key', 'Task List Header', 'Operation Overview', 'Maintenance Package', 'Components']);
        expect(res.sheets?.every(s => s.type === 'unknown')).toBe(true);
    });

    it('a re-flattened plan sheet has one Field row: WARPL first, the MMPT cycle fields after it', async () => {
        const res = await parseImportFile(sapPmLoadFile('Maintenance_Plan_Item'), undefined, 'Maintenance Plan');
        // Header detection lands on the Field row (MPLA/MMPT names), so the
        // documentation rows are skipped and only the two plans remain.
        expect(res.headers[0]).toBe('Field');
        expect(res.headers[1]).toBe('WARPL');
        expect(res.headers).toContain('HORIZ');
        expect(res.headers).toContain('ZYKL1');
        expect(res.rows.map(r => r.data['warpl'])).toEqual(['50099001', '50099002']);
    });
});
