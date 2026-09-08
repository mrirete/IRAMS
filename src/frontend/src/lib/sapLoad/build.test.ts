/**
 * SAP load builder — the mapping rules, and the round trip.
 *
 * Part 1 checks each object's rows against the consultant's workbook shape.
 * Part 2 writes the generated sheets into a real XLSX and drives them back
 * through parseImportFile: the inbound SAP profiles must recognise what the
 * outbound builder writes, or the two halves of the Migration Center have
 * drifted apart.
 */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseImportFile } from '../../eam/services/assetTemplates';
import {
    buildSapLoad, buildSapWorkbook, defaultParams, suggestStorageLocations, materialBucket,
    toSapDate, toSapTime, type SapLoadSource, type SapTargetParams,
} from './build';
import { SAP_OBJECTS, SAP_OBJECT_BY_KEY, fieldDescription } from './spec';

const col = (key: keyof typeof SAP_OBJECT_BY_KEY, name: string): number => {
    const i = SAP_OBJECT_BY_KEY[key].fields.findIndex(f => f.name === name);
    if (i < 0) throw new Error(`${key} has no field ${name}`);
    return i;
};

function fixture(): SapLoadSource {
    return {
        companies: [{ id: 'co1', code: '1030', name: 'Relantern Energy' }],
        costCenters: [{ id: 'cc1', code: 'MNT-300', company_code: '1030', controlling_area: 'A000' }],
        workCenters: [{ id: 'wc1', code: 'MECH-01' }],
        vendors: [{ id: 'v1', code: '1000020', name: 'KSB Service' }, { id: 'v2', code: null, name: 'No-code Supplies' }],
        assets: [
            { id: 'site', tag: 'SITE-HOU', name: 'Houston Production Site', hierarchy_level: 'SITE', properties: { location: 'Houston TX' } },
            { id: 'unit', tag: 'SITE-HOU-U300', name: 'Gas Turbine Generation Unit', hierarchy_level: 'UNIT', parent_id: 'site', cost_center_id: 'cc1' },
            { id: 'pump', tag: 'PMP-101A', name: 'Centrifugal pump - cooling water train A with a very long description indeed', hierarchy_level: 'EQUIPMENT', parent_id: 'unit', equipment_number: 'EQ-000101', criticality: 'A', manufacturer: 'KSB', model: 'Etanorm 065-050', serial_number: 'KSB-2019-04471', asset_class: 'PUMP', company_id: 'co1', cost_center_id: 'cc1', responsible_work_center_id: 'wc1' },
            { id: 'motor', tag: 'PMP-101A-M', name: 'Drive motor 45 kW', hierarchy_level: 'SUBUNIT', parent_id: 'pump', equipment_number: 'EQ-000102', criticality: 'B', asset_class: 'MOTOR' },
            { id: 'loose', tag: 'CMP-201', name: 'Compressor with no position', hierarchy_level: 'EQUIPMENT', equipment_number: 'EQ-000103' },
        ],
        assetFinancials: [{ asset_id: 'pump', acquisition_cost: 48500, acquisition_date: '2019-06-15' }],
        inventoryItems: [
            { id: 'i1', part_number: 'FLT-0023', material_number: 'MAT-000001', description: 'Air Inlet Filter 24x24x12', type: 'SPARE', uom: 'EA', min_level: 4, max_level: 16, is_critical: true, unit_cost: 245, preferred_vendor_id: 'v1' },
            { id: 'i2', part_number: 'LUB-0012', description: 'Synthetic Turbine Oil ISO 32', type: 'CONSUMABLE', uom: 'L', min_level: 0, max_level: 200, unit_cost: 18.5, preferred_vendor_id: 'v2' },
            { id: 'i3', part_number: 'OLD-0001', description: 'Retired item', type: 'SPARE', uom: 'EA', is_active: false, unit_cost: 1 },
        ],
        stores: [{ id: 'st1', name: 'Main Store', code: null }, { id: 'st2', name: 'Spares Container A', code: 'CNTA' }],
        stock: [
            { item_id: 'i1', location_id: 'st1', quantity: 8, bin_location: 'C2-01-4-2' },
            { item_id: 'i2', location_id: 'st2', quantity: 120, bin_location: 'D1-05-2-1' },
            { item_id: 'i2', location_id: 'st1', quantity: 0 },
        ],
        bomLines: [
            { id: 'b1', asset_id: 'pump', inventory_item_id: 'i1', description: 'Air inlet filter', quantity: 4, uom: 'EA', is_critical: true, created_at: '2026-01-01' },
            { id: 'b2', asset_id: 'pump', part_number: 'GSK-9', description: 'Casing gasket set', quantity: 1, uom: 'EA', created_at: '2026-01-02' },
            { id: 'b3', asset_id: 'unit', inventory_item_id: 'i2', description: 'Oil', quantity: 40, uom: 'L' },
        ],
        readingDefinitions: [
            { id: 'd1', asset_id: 'pump', reading_type_code: 'HOURS', name: 'Pump running hours', unit: 'hrs', category: 'METER' },
            { id: 'd2', asset_id: 'pump', reading_type_code: 'VIBRATION', name: 'Drive end bearing vibration', unit: 'mm/s', category: 'CONDITION', min_warning: 0, max_warning: 7.1, max_critical: 11.2 },
        ],
        readingLogs: [
            { id: 'l1', definition_id: 'd1', asset_id: 'pump', reading_date: '2026-01-31', reading_time: '23:59', reading_value: 48210, delta: 610, entered_by: 'j.tech' },
            { id: 'l2', definition_id: 'd2', asset_id: 'pump', reading_date: '2026-02-14', reading_time: '09:15:00', reading_value: 4.2, comments: 'Route 12 DE bearing' },
            { id: 'l3', definition_id: 'd1', asset_id: 'pump', reading_date: '2025-12-31', reading_value: 47600, is_active: false },
        ],
        workOrderCount: 1234,
    };
}

function params(over: Partial<SapTargetParams> = {}): SapTargetParams {
    const src = fixture();
    return {
        ...defaultParams(),
        systemLabel: 'E82 / Client 250',
        postingDate: '17.08.2026',
        sourceListValidFrom: '01.01.2026',
        storageLocations: suggestStorageLocations(src.stores),
        ...over,
    };
}

describe('spec — the workbook shape', () => {
    it('has the eight objects in load order with unique sheet names ≤ 31 chars', () => {
        expect(SAP_OBJECTS.map(o => o.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
        const names = SAP_OBJECTS.map(o => o.sheet);
        expect(new Set(names).size).toBe(8);
        names.forEach(n => expect(n.length).toBeLessThanOrEqual(31));
    });
    it('every example row has exactly one cell per field', () => {
        for (const o of SAP_OBJECTS) o.examples.forEach(r => expect(r.length, o.key).toBe(o.fields.length));
    });
    it('required fields say so in the description cell', () => {
        expect(fieldDescription({ name: 'TPLNR', description: 'Functional location label', required: true })).toBe('REQUIRED — Functional location label');
        expect(fieldDescription({ name: 'BEBER', description: 'Plant section' })).toBe('Plant section');
    });
});

describe('helpers', () => {
    it('dates and times take SAP shape', () => {
        expect(toSapDate('2026-01-31')).toBe('31.01.2026');
        expect(toSapDate('2026-01-31T10:00:00Z')).toBe('31.01.2026');
        expect(toSapDate(null)).toBe('');
        expect(toSapTime('23:59')).toBe('23:59:00');
        expect(toSapTime('9:15:00')).toBe('09:15:00');
    });
    it('storage locations: own short code first, then 0001…', () => {
        const map = suggestStorageLocations([{ id: 'a', name: 'Main Store' }, { id: 'b', name: 'Spares Container A', code: 'CNTA' }, { id: 'c', name: 'Yard', code: 'TOO-LONG' }]);
        expect(map).toEqual({ a: '0001', b: 'CNTA', c: '0002' });
    });
    it('inventory types collapse onto the four workbook buckets', () => {
        expect(materialBucket('SPARE')).toBe('SPARE');
        expect(materialBucket('lubricant')).toBe('CONSUMABLE');
        expect(materialBucket('TOOL')).toBe('TOOL');
        expect(materialBucket('NLAG')).toBe('MATERIAL');
        expect(materialBucket('SERVICE')).toBeNull();
    });
});

describe('buildSapLoad — mapping', () => {
    const res = buildSapLoad(fixture(), params());

    it('functional locations: FLOC levels only, parents first, TPLMA from the parent', () => {
        const rows = res.objects.functionalLocation;
        expect(rows.map(r => r[col('functionalLocation', 'TPLNR')])).toEqual(['SITE-HOU', 'SITE-HOU-U300']);
        const unit = rows[1];
        expect(unit[col('functionalLocation', 'TPLMA')]).toBe('SITE-HOU');
        expect(unit[col('functionalLocation', 'EQART')]).toBe('UNIT');
        expect(unit[col('functionalLocation', 'KOSTL')]).toBe('MNT-300');
        expect(unit[col('functionalLocation', 'BUKRS')]).toBe('1030');
        expect(unit[col('functionalLocation', 'FLTYP')]).toBe('M');
        expect(unit[col('functionalLocation', 'TPLKZ')]).toBe('YB01');
        expect(rows[0][col('functionalLocation', 'STORT')]).toBe('Houston TX');
    });

    it('equipment: both identities, position from the nearest FLOC, superior equipment by the same key as EQUNR', () => {
        const rows = res.objects.equipment;
        const byTag = Object.fromEntries(rows.map(r => [r[col('equipment', 'TIDNR')], r]));
        const pump = byTag['PMP-101A'], motor = byTag['PMP-101A-M'], loose = byTag['CMP-201'];
        expect(pump[col('equipment', 'EQUNR')]).toBe('EQ-000101');
        expect(pump[col('equipment', 'TPLNR')]).toBe('SITE-HOU-U300');
        expect(pump[col('equipment', 'HEQUI')]).toBe('');
        expect(pump[col('equipment', 'EQKTX')]).toHaveLength(40);           // clipped
        expect(pump[col('equipment', 'EQART')]).toBe('PUMP');
        expect(pump[col('equipment', 'ABCKZ')]).toBe('A');
        expect(pump[col('equipment', 'GEWRK')]).toBe('MECH-01');
        expect(pump[col('equipment', 'ANSDT')]).toBe('15.06.2019');
        expect(pump[col('equipment', 'ANSWT')]).toBe(48500);
        expect(pump[col('equipment', 'BAUJJ')]).toBe('2019');
        // motor sits under the pump: TPLNR walks THROUGH the pump to the unit; HEQUI = pump's EQUNR
        expect(motor[col('equipment', 'TPLNR')]).toBe('SITE-HOU-U300');
        expect(motor[col('equipment', 'HEQUI')]).toBe('EQ-000101');
        expect(loose[col('equipment', 'TPLNR')]).toBe('');
        expect(res.issues.some(i => i.object === 'equipment' && /no functional location above/.test(i.message))).toBe(true);
        expect(res.issues.some(i => i.object === 'equipment' && /EQKTX longer/.test(i.message))).toBe(true);
    });

    it('equipment: internal numbering blanks EQUNR and keys dependents on the tag', () => {
        const r2 = buildSapLoad(fixture(), params({ numbering: 'internal' }));
        const pump = r2.objects.equipment.find(r => r[col('equipment', 'TIDNR')] === 'PMP-101A')!;
        expect(pump[col('equipment', 'EQUNR')]).toBe('');
        const motor = r2.objects.equipment.find(r => r[col('equipment', 'TIDNR')] === 'PMP-101A-M')!;
        expect(motor[col('equipment', 'HEQUI')]).toBe('PMP-101A');
        expect(r2.objects.equipmentBom[0][col('equipmentBom', 'EQUNR')]).toBe('PMP-101A');
        expect(r2.objects.measuringPoint[0][col('measuringPoint', 'MPOBJ')]).toBe('PMP-101A');
    });

    it('material: type → MTART/MATKL/BKLAS, ABC from critical flag, price under the chosen control, inactive skipped', () => {
        const rows = res.objects.material;
        expect(rows.map(r => r[col('material', 'MATNR')])).toEqual(['FLT-0023', 'LUB-0012']);
        const filt = rows[0], oil = rows[1];
        expect(filt[col('material', 'MTART')]).toBe('ERSA');
        expect(filt[col('material', 'MATKL')]).toBe('YBSPARE');
        expect(filt[col('material', 'BKLAS')]).toBe('3040');
        expect(filt[col('material', 'MAABC')]).toBe('A');
        expect(filt[col('material', 'BISMT')]).toBe('MAT-000001');
        expect(filt[col('material', 'DISMM')]).toBe('VB');
        expect(filt[col('material', 'MINBE')]).toBe(4);
        expect(filt[col('material', 'LGORT')]).toBe('0001');
        expect(filt[col('material', 'LGPBE')]).toBe('C2-01-4-2');
        expect(filt[col('material', 'VPRSV')]).toBe('V');
        expect(filt[col('material', 'VERPR')]).toBe(245);
        expect(filt[col('material', 'STPRS')]).toBe('');
        expect(oil[col('material', 'MTART')]).toBe('VERB');
        expect(oil[col('material', 'BKLAS')]).toBe('3030');
        expect(oil[col('material', 'DISMM')]).toBe('ND');           // no reorder point
        expect(oil[col('material', 'LGORT')]).toBe('CNTA');        // the store that holds the stock
        expect(oil[col('material', 'MAABC')]).toBe('');
        const standard = buildSapLoad(fixture(), params({ priceControl: 'S' }));
        expect(standard.objects.material[0][col('material', 'STPRS')]).toBe(245);
        expect(standard.objects.material[0][col('material', 'VERPR')]).toBe('');
    });

    it('equipment BOM: 0010/0020 items, L for materials, T with text for unlinked lines, FLOC BOMs reported', () => {
        const rows = res.objects.equipmentBom;
        expect(rows).toHaveLength(2);
        expect(rows.map(r => r[col('equipmentBom', 'POSNR')])).toEqual(['0010', '0020']);
        expect(rows[0][col('equipmentBom', 'EQUNR')]).toBe('EQ-000101');
        expect(rows[0][col('equipmentBom', 'STLAN')]).toBe('4');
        expect(rows[0][col('equipmentBom', 'STKTX')]).toBe('PMP-101A maintenance BOM');
        expect(rows[0][col('equipmentBom', 'POSTP')]).toBe('L');
        expect(rows[0][col('equipmentBom', 'IDNRK')]).toBe('FLT-0023');
        expect(rows[0][col('equipmentBom', 'MENGE')]).toBe(4);
        expect(rows[0][col('equipmentBom', 'POTX1')]).toBe('Critical spare');
        expect(rows[1][col('equipmentBom', 'POSTP')]).toBe('T');
        expect(rows[1][col('equipmentBom', 'IDNRK')]).toBe('');
        expect(rows[1][col('equipmentBom', 'POTX1')]).toBe('Casing gasket set');
        expect(rows[1][col('equipmentBom', 'STKTX')]).toBe('');
        expect(res.issues.some(i => i.object === 'equipmentBom' && /functional locations/.test(i.message))).toBe(true);
    });

    it('measuring points: METER = counter with X, condition points carry the warning band as alarm limits', () => {
        const rows = res.objects.measuringPoint;
        expect(rows).toHaveLength(2);
        const hours = rows[0], vib = rows[1];
        expect(hours[col('measuringPoint', 'MPOBJ')]).toBe('EQ-000101');
        expect(hours[col('measuringPoint', 'PSORT')]).toBe('HOURS');
        expect(hours[col('measuringPoint', 'ATNAM')]).toBe('YB_HOURS');
        expect(hours[col('measuringPoint', 'INDCT')]).toBe('X');
        expect(hours[col('measuringPoint', 'DECIM')]).toBe(0);
        expect(hours[col('measuringPoint', 'ATVUP')]).toBe('');
        expect(vib[col('measuringPoint', 'INDCT')]).toBe('');
        expect(vib[col('measuringPoint', 'ATVLO')]).toBe(0);
        expect(vib[col('measuringPoint', 'ATVUP')]).toBe(7.1);
        expect(vib[col('measuringPoint', 'MRMAX')]).toBe('');       // range left blank on purpose
        expect(vib[col('measuringPoint', 'DECIM')]).toBe(1);
        expect(res.issues.some(i => i.object === 'measuringPoint' && /critical band/.test(i.message))).toBe(true);
    });

    it('measurement documents: counters in CNTRR/RECDV, conditions in READG, SAP dates, inactive readings dropped', () => {
        const rows = res.objects.measurementDoc;
        expect(rows).toHaveLength(2);
        const hours = rows[0], vib = rows[1];
        expect(hours[col('measurementDoc', 'POINT')]).toBe('');
        expect(hours[col('measurementDoc', 'MPOBJ')]).toBe('EQ-000101');
        expect(hours[col('measurementDoc', 'PSORT')]).toBe('HOURS');
        expect(hours[col('measurementDoc', 'IDATE')]).toBe('31.01.2026');
        expect(hours[col('measurementDoc', 'ITIME')]).toBe('23:59:00');
        expect(hours[col('measurementDoc', 'CNTRR')]).toBe(48210);
        expect(hours[col('measurementDoc', 'RECDV')]).toBe(610);
        expect(hours[col('measurementDoc', 'READG')]).toBe('');
        expect(hours[col('measurementDoc', 'ABLES')]).toBe('j.tech');
        expect(vib[col('measurementDoc', 'READG')]).toBe(4.2);
        expect(vib[col('measurementDoc', 'CNTRR')]).toBe('');
        expect(vib[col('measurementDoc', 'MDTXT')]).toBe('Route 12 DE bearing');
        expect(res.issues.some(i => i.object === 'measurementDoc' && /inactive/.test(i.message))).toBe(true);
    });

    it('source list: one row per preferred supplier with a vendor code; codeless vendors are an error, not a blank', () => {
        const rows = res.objects.sourceList;
        expect(rows).toHaveLength(1);
        expect(rows[0]).toEqual(['FLT-0023', '102A', '01.01.2026', '31.12.9999', '1000020', '1030', 'X', '1']);
        expect(res.skipped.sourceList).toBe(1);
        expect(res.issues.some(i => i.object === 'sourceList' && i.level === 'error')).toBe(true);
    });

    it('inventory balance: one 561 per store holding quantity, zero lines dropped', () => {
        const rows = res.objects.inventoryBalance;
        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual(['FLT-0023', '102A', '0001', '', '', 8, 'EA', '17.08.2026', '561']);
        expect(rows[1]).toEqual(['LUB-0012', '102A', 'CNTA', '', '', 120, 'L', '17.08.2026', '561']);
    });

    it('a placeholder unit ("—") is treated as no unit: MRNGU blank and an error raised', () => {
        const src = fixture();
        src.readingDefinitions.push({ id: 'd3', asset_id: 'pump', reading_type_code: 'CSA', name: 'Current signature', unit: '—', category: 'CONDITION' });
        const r2 = buildSapLoad(src, params());
        const row = r2.objects.measuringPoint.find(r => r[col('measuringPoint', 'PSORT')] === 'CSA')!;
        expect(row[col('measuringPoint', 'MRNGU')]).toBe('');
        expect(r2.issues.some(i => i.object === 'measuringPoint' && i.level === 'error' && /no unit/.test(i.message))).toBe(true);
    });

    it('a store without an LGORT is an error on both material and balance', () => {
        const r2 = buildSapLoad(fixture(), params({ storageLocations: {} }));
        expect(r2.issues.filter(i => i.level === 'error' && /storage location/.test(i.message)).map(i => i.object).sort())
            .toEqual(['inventoryBalance', 'material']);
    });

    it('work orders are named as not loadable, with the count', () => {
        expect(res.issues.find(i => i.object === 'general' && /work order/.test(i.message))?.message).toContain('1,234');
    });

    it('every exported row has exactly one cell per field', () => {
        for (const o of SAP_OBJECTS) res.objects[o.key].forEach(r => expect(r.length, o.key).toBe(o.fields.length));
    });
});

describe('workbook rendering', () => {
    it('template mode reproduces the consultant workbook: read-me + 8 sheets, field names on row 4, descriptions on row 5, examples from row 6', () => {
        const wb = buildSapWorkbook(null, params(), { mode: 'template' });
        expect(wb.SheetNames).toEqual(['0 Read me', ...SAP_OBJECTS.map(o => o.sheet)]);
        const fl = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets['1 FunctionalLocation'], { header: 1 });
        expect(fl[0][0]).toBe('Migration object: Functional Location');
        expect(fl[3]).toEqual(SAP_OBJECT_BY_KEY.functionalLocation.fields.map(f => f.name));
        expect(String(fl[4][0])).toMatch(/^REQUIRED — /);
        expect(fl[5][0]).toBe('SITE-HOU');
        const readme = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['0 Read me'], { header: 1 });
        expect(readme[0][0]).toBe('SAP Load Templates — E82 / Client 250');
        expect(readme.some(r => r[0] === 'Load order')).toBe(true);
    });

    it('filled mode puts data on row 5 and adds a readiness sheet', () => {
        const res = buildSapLoad(fixture(), params());
        const wb = buildSapWorkbook(res, params(), { mode: 'filled' });
        expect(wb.SheetNames[wb.SheetNames.length - 1]).toBe('9 Readiness');
        const eq = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets['2 Equipment'], { header: 1 });
        expect(eq[3][0]).toBe('EQUNR');
        expect(eq.slice(4).map(r => r[col('equipment', 'TIDNR')]).sort()).toEqual(['CMP-201', 'PMP-101A', 'PMP-101A-M']);
        const ready = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets['9 Readiness'], { header: 1 });
        expect(ready[3]).toEqual(['Object', 'Level', 'Rows affected', 'Finding']);
        expect(ready.length).toBeGreaterThan(5);
    });

    it('a subset of objects renders only those sheets', () => {
        const wb = buildSapWorkbook(null, params(), { mode: 'template', objects: ['material'] });
        expect(wb.SheetNames).toEqual(['0 Read me', '3 Material']);
    });
});

// ── Round trip: what the builder writes, the SAP import profiles must read ──

function asFile(sheetName: string, wb: XLSX.WorkBook): File {
    const one = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(one, wb.Sheets[sheetName], 'Sheet1');
    const buf = XLSX.write(one, { bookType: 'xlsx', type: 'array' });
    return new File([buf], `${sheetName}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

describe('round trip — filled sheets parse through the inbound SAP profiles', () => {
    const res = buildSapLoad(fixture(), params());
    const wb = buildSapWorkbook(res, params(), { mode: 'filled' });

    it('functional locations → asset rows with parent tags', async () => {
        const r = await parseImportFile(asFile('1 FunctionalLocation', wb));
        expect(r.type).toBe('asset');
        expect(r.validCount).toBe(2);
        expect(r.rows[1].data['tag']).toBe('SITE-HOU-U300');
        expect(r.rows[1].data['parenttag']).toBe('SITE-HOU');
    });

    it('equipment → asset rows keeping both identities and the position', async () => {
        const r = await parseImportFile(asFile('2 Equipment', wb));
        expect(r.type).toBe('asset');
        expect(r.validCount).toBe(3);
        const pump = r.rows.find(x => x.data['tag'] === 'PMP-101A')!;
        expect(pump.data['equipmentnumber']).toBe('EQ-000101');
        expect(pump.data['parenttag']).toBe('SITE-HOU-U300');
        const motor = r.rows.find(x => x.data['tag'] === 'PMP-101A-M')!;
        expect(motor.data['parenttag']).toBe('EQ-000101');   // HEQUI wins over TPLNR, resolved by equipment number
    });

    it('material → inventory rows with type, criticality and price translated back', async () => {
        const r = await parseImportFile(asFile('3 Material', wb));
        expect(r.type).toBe('inventory');
        expect(r.validCount).toBe(2);
        expect(r.rows[0].data['type']).toBe('SPARE');
        expect(r.rows[0].data['iscritical']).toBe('YES');
        expect(r.rows[0].data['itemcost']).toBe('245');
        expect(r.rows[1].data['type']).toBe('CONSUMABLE');
    });

    it('equipment BOM → bom rows keyed by EQUNR', async () => {
        const r = await parseImportFile(asFile('4 EquipmentBOM', wb));
        expect(r.type).toBe('bom');
        expect(r.rows[0].data['assettag']).toBe('EQ-000101');
        expect(r.rows[0].data['inventorycode']).toBe('FLT-0023');
    });

    it('measuring points and documents → readings rows', async () => {
        const mp = await parseImportFile(asFile('5 MeasuringPoint', wb));
        expect(mp.type).toBe('readings');
        expect(mp.validCount).toBe(2);
        expect(mp.rows[1].data['maxwarning']).toBe('7.1');
        const md = await parseImportFile(asFile('6 MeasurementDoc', wb));
        expect(md.type).toBe('readings');
        expect(md.validCount).toBe(2);
        expect(md.rows[0].data['value']).toBe('48210');        // counter total read back from CNTRR
        expect(md.rows[1].data['value']).toBe('4.2');
    });

    it('source list and inventory balance → inventory rows', async () => {
        const sl = await parseImportFile(asFile('7 SourceList', wb));
        expect(sl.type).toBe('inventory');
        expect(sl.rows[0].data['preferredsupplier']).toBe('1000020');
        const ib = await parseImportFile(asFile('8 InventoryBalance', wb));
        expect(ib.type).toBe('inventory');
        expect(ib.validCount).toBe(2);
        expect(ib.rows[0].data['qtyonhand']).toBe('8');
    });
});
