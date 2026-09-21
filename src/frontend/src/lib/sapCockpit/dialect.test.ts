/**
 * The cockpit dialect, checked against the files SAP actually produced.
 *
 * Every header in structures.ts was copied out of a downloaded CSV, so a
 * round trip through this codec is a real test of the format: parse what SAP
 * wrote, render it back, and the bytes must not move.
 */
import { describe, it, expect } from 'vitest';
import {
    parseCockpitColumn, renderCockpitColumn, parseCockpitFileName, cockpitFileName,
    excelSheetName, cockpitFolderName, parseCsv, renderCsv, parseCockpitCsv,
    renderCockpitCsv, missingMandatory,
} from './dialect';
import {
    COCKPIT_OBJECTS, COCKPIT_OBJECT_BY_KEY, ALL_STRUCTURES, structureSpec, findStructures,
    columnsOf, templateCsv, fileNameOf, type CockpitObjectKey,
} from './structures';

/** Field names of one object's structure, in header order. */
const fields = (object: CockpitObjectKey, structure: string): string[] =>
    columnsOf(structureSpec(object, structure)!).map(c => c.name);

describe('header annotations', () => {
    it('reads key and mandatory off the field name', () => {
        expect(parseCockpitColumn('WARPL(k/*)')).toEqual({ name: 'WARPL', key: true, mandatory: true, raw: 'WARPL(k/*)' });
        expect(parseCockpitColumn('MPTYP(*)')).toEqual({ name: 'MPTYP', key: false, mandatory: true, raw: 'MPTYP(*)' });
        expect(parseCockpitColumn('STRAT')).toEqual({ name: 'STRAT', key: false, mandatory: false, raw: 'STRAT' });
    });

    it('takes a key that is not mandatory, and ignores a flag it does not know', () => {
        expect(parseCockpitColumn('EAMS_OBKNR(k)')).toMatchObject({ name: 'EAMS_OBKNR', key: true, mandatory: false });
        expect(parseCockpitColumn('SOMETHING(z)')).toMatchObject({ name: 'SOMETHING', key: false, mandatory: false });
    });

    it('puts the annotation back exactly as it came', () => {
        for (const raw of ['WARPL(k/*)', 'MPTYP(*)', 'STRAT', 'EAMS_OBKNR(k/*)']) {
            expect(renderCockpitColumn(parseCockpitColumn(raw))).toBe(raw);
        }
    });

    it('builds an annotation for a column that never had a raw header', () => {
        expect(renderCockpitColumn({ name: 'WARPL', key: true, mandatory: true, raw: '' })).toBe('WARPL(k/*)');
        expect(renderCockpitColumn({ name: 'SORTF', key: false, mandatory: false, raw: '' })).toBe('SORTF');
    });
});

describe('file names', () => {
    it('splits structure from mode', () => {
        expect(parseCockpitFileName('S_MPLA#FreeText_Mandatory.csv')).toEqual({ structure: 'S_MPLA', mode: 'FreeText_Mandatory' });
        expect(parseCockpitFileName('S_OBJ_LIST#FreeText.csv')).toEqual({ structure: 'S_OBJ_LIST', mode: 'FreeText' });
    });

    it('survives a path and a missing mode', () => {
        expect(parseCockpitFileName('Source data for PM - Maintenance plan/S_MPOS#FreeText_Mandatory.csv'))
            .toEqual({ structure: 'S_MPOS', mode: 'FreeText_Mandatory' });
        expect(parseCockpitFileName('S_MPLA.csv')).toEqual({ structure: 'S_MPLA', mode: '' });
    });

    it('round trips', () => {
        for (const { spec } of ALL_STRUCTURES) {
            expect(parseCockpitFileName(fileNameOf(spec))).toEqual({ structure: spec.structure, mode: spec.mode });
        }
        expect(cockpitFileName('S_MPLA', '')).toBe('S_MPLA.csv');
    });

    it('names the Excel tab the way Excel does — cut at 31 characters', () => {
        // This is the tab a measurement-document CSV shows when it is opened.
        expect(excelSheetName('S_MEASUREMENT_DOCU', 'FreeText_Mandatory')).toBe('S_MEASUREMENT_DOCU#FreeText_Man');
        expect(excelSheetName('S_MEASUREMENT_DOCU', 'FreeText_Mandatory')).toHaveLength(31);
        expect(excelSheetName('S_MPLA', 'FreeText_Mandatory')).toBe('S_MPLA#FreeText_Mandatory');
    });

    it('names the folder the cockpit names', () => {
        expect(cockpitFolderName('PM - Maintenance plan')).toBe('Source data for PM - Maintenance plan');
    });
});

describe('CSV as text', () => {
    it('keeps SAP keys and dates as written', () => {
        const rows = parseCsv('WARPL,STADT\r\n0000000123,01.02.2026');
        expect(rows[1]).toEqual(['0000000123', '01.02.2026']);
    });

    it('handles quotes, embedded commas and newlines', () => {
        const text = 'A,B\r\n"one, two","he said ""hi"""\r\n"line\nbreak",plain';
        expect(parseCsv(text)).toEqual([
            ['A', 'B'],
            ['one, two', 'he said "hi"'],
            ['line\nbreak', 'plain'],
        ]);
    });

    it('tolerates LF endings and a BOM', () => {
        expect(parseCsv('﻿A,B\nc,d')).toEqual([['A', 'B'], ['c', 'd']]);
    });

    it('quotes only what has to be quoted', () => {
        expect(renderCsv([['plain', 'one, two', 'say "hi"', ' padded ']]))
            .toBe('plain,"one, two","say ""hi"""," padded "');
    });

    it('round trips anything awkward', () => {
        const grid = [['A', 'B'], ['one, two', 'he said "hi"'], ['line\nbreak', '']];
        expect(parseCsv(renderCsv(grid))).toEqual(grid);
    });
});

describe('the registry is what SAP handed out', () => {
    it('parses every header and finds the declared keys', () => {
        const keysOf = (object: CockpitObjectKey, structure: string) =>
            columnsOf(structureSpec(object, structure)!).filter(c => c.key).map(c => c.name);

        expect(keysOf('measurementDocument', 'S_MEASUREMENT_DOCU')).toEqual(['MEASUREMENT_DOCUMENT']);
        expect(keysOf('measuringPoint', 'S_HEADER')).toEqual(['MEAS_POINT']);
        expect(keysOf('maintenancePlan', 'S_MPLA')).toEqual(['WARPL']);
        expect(keysOf('maintenancePlan', 'S_MPOS')).toEqual(['WARPL', 'WPPOS']);
        expect(keysOf('maintenancePlan', 'S_OBJ_LIST')).toEqual(['WARPL', 'WPPOS', 'EAMS_OBKNR']);
    });

    it('carries the mandatory fields the load will refuse without', () => {
        const mand = (object: CockpitObjectKey, structure: string) =>
            columnsOf(structureSpec(object, structure)!).filter(c => c.mandatory).map(c => c.name);

        expect(mand('maintenancePlan', 'S_MPLA')).toEqual(['WARPL', 'MPTYP']);
        expect(mand('maintenancePlan', 'S_MPOS')).toEqual(['WARPL', 'WPPOS', 'PSTXT', 'IWERK']);
        expect(mand('measurementDocument', 'S_MEASUREMENT_DOCU')).toEqual(['MEASUREMENT_DOCUMENT']);
        // A point must say what it measures and what it hangs on.
        expect(mand('measuringPoint', 'S_HEADER'))
            .toEqual(['MEAS_POINT', 'MEASUREMENT_POINT_TYPE', 'OBJECT_TYPE', 'MEAS_POINT_OBJ_NO']);
    });

    it('keeps the field names that differ from the consultant load files', () => {
        const mpos = fields('maintenancePlan', 'S_MPOS');
        expect(mpos).toContain('WPPOS');      // the load files call this WAPOS
        expect(mpos).not.toContain('WAPOS');

        const doc = fields('measurementDocument', 'S_MEASUREMENT_DOCU');
        expect(doc).toContain('MEASUREMENT_POINT');   // the load files call this MPOBJ
        expect(doc).toContain('READING_DATE');        // ... and this IDATE
        expect(doc).not.toContain('MPOBJ');

        // The load files crammed the object TYPE ("IEQ") into the field that
        // should hold the object NUMBER. The cockpit keeps them apart, and
        // takes an external key as a third way in.
        const point = fields('measuringPoint', 'S_HEADER');
        expect(point).toEqual(expect.arrayContaining(['OBJECT_TYPE', 'MEAS_POINT_OBJ_NO', 'OBJECT_KEY_EXTERN']));
        expect(point).not.toContain('MPOBJ');
    });

    it('holds the measurement RANGE on a point, not an alarm band', () => {
        const point = fields('measuringPoint', 'S_HEADER');
        expect(point).toEqual(expect.arrayContaining(['MRMIC', 'MRMAC']));
        // No warning/critical pair anywhere on the point: SAP keeps limits on
        // the classification characteristic (ATNAM), so IREAMS bands have no
        // column here to travel in.
        expect(point.filter(f => /ATVLO|ATVUP|WARN|CRIT/.test(f))).toEqual([]);
        expect(point).toContain('ATNAM');
    });

    it('template in, template out, byte for byte', () => {
        for (const { spec } of ALL_STRUCTURES) {
            const parsed = parseCockpitCsv(templateCsv(spec), fileNameOf(spec));
            expect(parsed.structure).toBe(spec.structure);
            expect(parsed.mode).toBe(spec.mode);
            expect(parsed.rows).toEqual([]);
            expect(renderCockpitCsv(parsed)).toBe(spec.header);
        }
    });

    it('lists the predecessors the cockpit lists, and no more', () => {
        const plan = COCKPIT_OBJECT_BY_KEY.maintenancePlan;
        expect(plan.predecessors).toHaveLength(plan.predecessorCount);
        expect(plan.predecessors).toContain('PM - Measuring point');
        // A measurement document needs its point loaded first; the list itself
        // has not been read off the cockpit, so only the count is recorded.
        expect(COCKPIT_OBJECT_BY_KEY.measurementDocument.predecessorCount).toBe(1);
        expect(COCKPIT_OBJECT_BY_KEY.measurementDocument.predecessors).toBeUndefined();
    });

    it('names each object the way its ZIP is named', () => {
        expect(COCKPIT_OBJECTS.map(o => cockpitFolderName(o.name))).toEqual([
            'Source data for PM - Measuring point',
            'Source data for PM - Measurement document',
            'Source data for PM - General maintenance task list',
            'Source data for PM - Maintenance item',
            'Source data for PM - Maintenance plan',
        ]);
    });

    it('keeps the task list keyed group/counter, all the way down', () => {
        // Every structure of the object hangs off PLNNR + PLNAL, which is the
        // same pair a maintenance item points at through PLNTY/PLNNR/PLNAL.
        for (const spec of COCKPIT_OBJECT_BY_KEY.generalTaskList.structures) {
            expect(columnsOf(spec).slice(0, 2).map(c => c.name)).toEqual(['PLNNR', 'PLNAL']);
        }
        expect(fields('maintenanceItem', 'S_ITEM')).toEqual(expect.arrayContaining(['PLNTY', 'PLNNR', 'PLNAL']));
    });

    it('carries the cadence on the package, not the operation', () => {
        // A step's package is what makes it quarterly or yearly; the operation
        // itself says nothing about when it runs.
        expect(fields('generalTaskList', 'S_MPACK')).toEqual(['PLNNR', 'PLNAL', 'VORNR', 'STRAT', 'PAKET']);
        const ops = fields('generalTaskList', 'S_OPERATIONS');
        expect(ops).toEqual(expect.arrayContaining(['ARBEI', 'ARBEH', 'ANZZL', 'STEUS', 'LTXA1']));
        expect(ops.filter(f => /PAKET|STRAT|ZYKL/.test(f))).toEqual([]);
    });

    it('takes a key that SAP did not mark mandatory', () => {
        // S_PRTS is the one place in the object where PLNNR is (k) alone.
        const prts = columnsOf(structureSpec('generalTaskList', 'S_PRTS')!);
        expect(prts[0]).toMatchObject({ name: 'PLNNR', key: true, mandatory: false });
        expect(prts[1]).toMatchObject({ name: 'PLNAL', key: true, mandatory: true });
    });

    it('scopes a structure to its object, because the names are not unique', () => {
        // "S_HEADER" says nothing on its own — only the folder it arrived in
        // decides which object it belongs to.
        expect(structureSpec('measuringPoint', 'S_HEADER')).toBeDefined();
        expect(structureSpec('maintenancePlan', 'S_HEADER')).toBeUndefined();
        expect(findStructures('S_HEADER').map(s => s.object)).toEqual(['measuringPoint']);
        expect(findStructures('S_MPOS').map(s => s.object)).toEqual(['maintenancePlan']);
        expect(findStructures('S_NOT_A_THING')).toEqual([]);
    });

    it('keeps the two S_OBJ_LIST files apart — same name, different key', () => {
        expect(findStructures('S_OBJ_LIST').map(s => s.object)).toEqual(['maintenanceItem', 'maintenancePlan']);

        const itemKeys = columnsOf(structureSpec('maintenanceItem', 'S_OBJ_LIST')!).filter(c => c.key).map(c => c.name);
        const planKeys = columnsOf(structureSpec('maintenancePlan', 'S_OBJ_LIST')!).filter(c => c.key).map(c => c.name);
        expect(itemKeys).toEqual(['WAPOS', 'EAMS_OBKNR']);
        expect(planKeys).toEqual(['WARPL', 'WPPOS', 'EAMS_OBKNR']);

        // Eight fields against nine: feeding one load the other's file fails.
        expect(fields('maintenanceItem', 'S_OBJ_LIST')).toHaveLength(8);
        expect(fields('maintenancePlan', 'S_OBJ_LIST')).toHaveLength(9);
    });

    it('names the item key WAPOS and the plan-bound one WPPOS', () => {
        const item = fields('maintenanceItem', 'S_ITEM');
        expect(item[0]).toBe('WAPOS');
        expect(item).not.toContain('WARPL');   // an item loads without a plan
        expect(item).not.toContain('WPPOS');
        expect(fields('maintenancePlan', 'S_MPOS')).toEqual(expect.arrayContaining(['WARPL', 'WPPOS']));

        // The description is mandatory on the plan's item rows and optional
        // on the standalone object — the same field, two different rules.
        const mandatory = (object: CockpitObjectKey, structure: string) =>
            columnsOf(structureSpec(object, structure)!).filter(c => c.mandatory).map(c => c.name);
        expect(mandatory('maintenancePlan', 'S_MPOS')).toContain('PSTXT');
        expect(mandatory('maintenanceItem', 'S_ITEM')).toEqual(['WAPOS', 'IWERK']);
    });

    it('carries the strategy and category the plan-bound item has no room for', () => {
        const item = fields('maintenanceItem', 'S_ITEM');
        expect(item).toEqual(expect.arrayContaining(['MITYP', 'WSTRA', 'NRANGE_IND']));
        expect(fields('maintenancePlan', 'S_MPOS')).not.toContain('WSTRA');
    });
});

describe('filled sheets', () => {
    const spec = structureSpec('maintenancePlan', 'S_OBJ_LIST')!;
    const filled = `${spec.header}\r\n0000000123,0010,1,10,,,000000000010004711,,\r\n0000000123,0010,2,20,,,000000000010004712,,`;

    it('reads rows by field name, annotation stripped', () => {
        const sheet = parseCockpitCsv(filled, fileNameOf(spec));
        expect(sheet.rows).toHaveLength(2);
        expect(sheet.rows[0]).toMatchObject({ WARPL: '0000000123', WPPOS: '0010', EAMS_OBKNR: '1', EQUNR: '000000000010004711' });
        expect(sheet.rows[1].SORTF).toBe('20');
    });

    it('renders back what it read', () => {
        expect(renderCockpitCsv(parseCockpitCsv(filled, fileNameOf(spec)))).toBe(filled);
    });

    it('reports blank key and mandatory cells, and only those', () => {
        const sheet = parseCockpitCsv(`${spec.header}\r\n0000000123,,3,,,,,,`, fileNameOf(spec));
        const gaps = missingMandatory(sheet);
        expect(gaps).toEqual([{ row: 2, field: 'WPPOS', key: true }]);
    });

    it('counts rows the way a spreadsheet does', () => {
        const mpos = structureSpec('maintenancePlan', 'S_MPOS')!;
        const sheet = parseCockpitCsv(`${mpos.header}\r\n0000000123,0010,Weekly check,,,,1030\r\n0000000124,0010,,,,,1030`, fileNameOf(mpos));
        expect(missingMandatory(sheet)).toEqual([{ row: 3, field: 'PSTXT', key: false }]);
    });
});
