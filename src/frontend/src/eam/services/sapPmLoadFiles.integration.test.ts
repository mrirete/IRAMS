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
import { sapPmLoadFile, sapPmLoadFileFrom, SAP_PM_LOAD_FILES } from './sapPmLoadFiles.fixture';

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

describe('Maintenance plan workbook → PM schedules (one per maintenance item)', () => {
    it('the Items sheet is the schedule sheet; the plan sheet and object list are its context', async () => {
        const res = await parseImportFile(sapPmLoadFile('Maintenance_Plan_Item'));
        expect(res.sheets?.map(s => `${s.name}:${s.type}`)).toEqual([
            '_Sample_Key:unknown', 'Maintenance Plan:unknown', 'Maintenance Items:recurring', 'Object List:unknown',
        ]);
        expect(res.sheet).toBe('Maintenance Items');
        expect(res.type).toBe('recurring');
        expect(res.rows).toHaveLength(2);
        expect(res.errorCount).toBe(0);
        expect(res.rows.map(r => r.rowIndex)).toEqual([11, 12]);
    });

    it('item → schedule: code, text, equipment, job type, work centre, task list reference', async () => {
        const res = await parseImportFile(sapPmLoadFile('Maintenance_Plan_Item'));
        const pump = res.rows[0].data, motor = res.rows[1].data;
        expect(pump['code']).toBe('60099001');
        expect(pump['description']).toBe('PUMP P-101 PREVENTIVE MAINTENANCE');
        expect(pump['assettag']).toBe('ES0654503');           // EQUNR, TPLNR blank
        expect(pump['jobtype']).toBe('PM');                   // ILART 002
        expect(pump['workcentre']).toBe('MNMEC-PP');
        expect(pump['ordertype']).toBe('PM02');
        expect(pump['tasklist']).toBe('30009001/01');         // PLNNR/PLNAL — the job-plan key
        expect(pump['plan']).toBe('50099001');
        expect(pump['priority']).toBeUndefined();             // PRIOK blank on all three PRIOK columns
        expect(motor['code']).toBe('60099002');
        expect(motor['assettag']).toBe('ES0654588');
        expect(motor['tasklist']).toBe('30009002/01');
    });

    it('cadence and start come from the plan sheet of the same workbook, joined on WARPL', async () => {
        const res = await parseImportFile(sapPmLoadFile('Maintenance_Plan_Item'));
        const pump = res.rows[0];
        // Strategy plan (MONWOH, cycle block empty): the cadence is read from the
        // consultant's "1M/12M" shorthand at the head of the plan text — flagged.
        expect(pump.data['strategy']).toBe('MONWOH');
        expect(pump.data['scheduletype']).toBe('TIME');
        expect(pump.data['frequencyinterval']).toBe('1');
        expect(pump.data['frequencyunit']).toBe('Months');
        expect(pump.data['nextduedate']).toBe('2026-11-01');  // STADT 01.10.2026 + 1 month
        expect(pump.warnings.some(w => /read from the plan text "1M\/12M,PUMP P-101,MECH"/.test(w))).toBe(true);
        expect(pump.isValid).toBe(true);
    });

    it('a single-cycle plan gives an exact cadence and no warning', async () => {
        const rows = SAP_PM_LOAD_FILES['Maintenance_Plan_Item'];
        const planHdr = rows['Maintenance Plan'][3];
        const plan = rows['Maintenance Plan'].map(r => [...r]);
        const set = (row: string[], field: string, v: string) => { row[planHdr.indexOf(field)] = v; };
        set(plan[10], 'STRAT', ''); set(plan[10], 'ZYKL1', '3'); set(plan[10], 'ZEIEH', 'MON'); set(plan[10], 'WPTXT', 'PUMP P-101 QUARTERLY');
        const file = sapPmLoadFileFrom({ ...rows, 'Maintenance Plan': plan });
        const res = await parseImportFile(file);
        expect(res.rows[0].data['frequencyinterval']).toBe('3');
        expect(res.rows[0].data['frequencyunit']).toBe('Months');
        expect(res.rows[0].data['nextduedate']).toBe('2027-01-01');
        expect(res.rows[0].warnings.some(w => /plan text/.test(w))).toBe(false);
    });

    it('without the plan sheet the item still parses but says the cadence is unknown', async () => {
        const rows = SAP_PM_LOAD_FILES['Maintenance_Plan_Item'];
        const { 'Maintenance Plan': _plan, ...rest } = rows;
        const res = await parseImportFile(sapPmLoadFileFrom(rest));
        expect(res.type).toBe('recurring');
        expect(res.rows[0].isValid).toBe(false);
        expect(res.rows[0].errors).toContain('Missing required: frequencyinterval');
        expect(res.rows[0].warnings.some(w => /No Maintenance Plan sheet/.test(w))).toBe(true);
    });
});

describe('General task list workbook → job plans (operations with their package cadence)', () => {
    it('the Operation Overview is the job-plan sheet; header, package and component sheets are context', async () => {
        const res = await parseImportFile(sapPmLoadFile('General_Task_List'));
        expect(res.sheets?.map(s => `${s.name}:${s.type}`)).toEqual([
            '_Sample_Key:unknown', 'Task List Header:unknown', 'Operation Overview:jobplan', 'Maintenance Package:unknown', 'Components:unknown',
        ]);
        expect(res.type).toBe('jobplan');
        expect(res.rows).toHaveLength(6);
        expect(res.errorCount).toBe(0);
    });

    it('operation → job-plan step keyed by task list group/counter, with hours, work centre, control key, people', async () => {
        const res = await parseImportFile(sapPmLoadFile('General_Task_List'));
        const op = res.rows[0].data;
        expect(op['pmcode']).toBe('30009001/01');
        expect(op['operationno']).toBe('0010');
        expect(op['description']).toBe('MONTHLY VISUAL AND LEAK CHECK');
        expect(op['esthours']).toBe('0.5');                   // ARBEI 0.5 ARBEH H
        expect(op['workcentre']).toBe('MNMEC-PP');
        expect(op['controlkey']).toBe('PM01');                // INT
        expect(op['numpersons']).toBe('1');
        expect(res.rows.map(r => r.data['pmcode'])).toEqual([
            '30009001/01', '30009001/01', '30009001/01', '30009002/01', '30009002/01', '30009002/01',
        ]);
    });

    it('each operation carries its strategy package cadence from the package sheet', async () => {
        const res = await parseImportFile(sapPmLoadFile('General_Task_List'));
        const cadences = res.rows.map(r => `${r.data['package']}:${r.data['frequencyinterval']} ${r.data['frequencyunit']}`);
        expect(cadences).toEqual(['1:1 Months', '1:1 Months', '12:12 Months', '1:1 Months', '1:1 Months', '12:12 Months']);
        expect(res.rows[2].data['packagetext']).toBe('12 MONTH/ 1 YEAR');
        expect(res.rows[2].data['strategy']).toBe('MONWOH');
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
