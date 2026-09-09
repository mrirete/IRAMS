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
    toSapDate, toSapTime, isoTime, workBucket, sapPriority, type SapLoadSource, type SapTargetParams,
} from './build';
import { SAP_OBJECTS, SAP_OBJECT_BY_KEY, fieldDescription } from './spec';

const col = (key: keyof typeof SAP_OBJECT_BY_KEY, name: string): number => {
    const i = SAP_OBJECT_BY_KEY[key].fields.findIndex(f => f.name === name);
    if (i < 0) throw new Error(`${key} has no field ${name}`);
    return i;
};

function fixture(): SapLoadSource {
    return {
        companies: [{ id: 'co1', code: '1030', name: 'Relantern Energy', currency: 'USD' }],
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
        users: [{ id: 'u1', username: 'j.tech', email: 'j.tech@example.com' }, { id: 'u2', email: 'planner.person@example.com' }],
        workOrders: [
            { id: 'w1', wo_number: 'WO-2025-00412', title: 'Pump seal leak - replace mechanical seal', status: 'CLOSED', type: 'CM', priority_code: 'EMERGENCY', asset_id: 'pump', work_center_id: 'wc1', cost_center_id: 'cc1', created_at: '2025-02-03T05:00:00Z', date_due_start: '2025-02-03', due_date: '2025-02-05', closed_at: '2025-02-11T16:00:00Z', frozen_labor_cost: 850, frozen_material_cost: 400, total_actual_cost: 1250, actual_downtime_hrs: 6.5, actual_duration_hrs: 9, breakdown: true, malfunction_start: '2025-02-03T06:40:00Z', malfunction_end: '2025-02-03T13:10:00Z', created_by: 'u1' },
            { id: 'w2', wo_number: 'WO-2025-00488', title: '6-monthly service', status: 'TECO', type: 'PM', priority_code: 'LOW', asset_id: 'pump', created_at: '2025-03-14T08:00:00Z', closed_at: '2025-03-14T12:00:00Z', frozen_labor_cost: 320, actual_duration_hrs: 4, created_by: 'u2' },
            { id: 'w3', wo_number: 'WO-2025-00500', title: 'Duplicate request', status: 'CANCELLED', type: 'CM', asset_id: 'pump', created_at: '2025-04-01T08:00:00Z' },
            { id: 'w4', wo_number: 'WO-2026-01002', title: 'Motor tripping on overload - investigate the drive and the protection relay settings', description: 'Trips within 10 min of start.', status: 'WIP', type: 'CM', priority_code: 'HIGH', asset_id: 'motor', created_at: '2026-06-09T07:15:00Z', date_due_start: '2026-06-09', due_date: '2026-06-11', total_actual_cost: 120, breakdown: true, malfunction_start: '2026-06-09T06:50:00Z', created_by: 'u1', parent_wo_id: 'w1' },
            { id: 'w5', wo_number: 'WO-2026-01031', title: 'Quarterly lube - conveyor drive gearbox', status: 'OPEN', type: 'INSPECTION', priority_code: 'P3', asset_id: 'loose', created_at: '2026-09-01T08:00:00Z', due_date: '2026-09-19' },
            { id: 'w6', wo_number: 'WO-2026-01040', title: 'Status nobody recognises', status: 'FOOBAR', type: 'ODDJOB', asset_id: null, created_at: '2026-09-02T08:00:00Z' },
        ],
        woFailureData: [
            { wo_id: 'w1', failure_mode_code: 'LEAK', failure_cause_code: 'WEAR', remedy_code: 'REPLACED', object_part: 'SEAL' },
            { wo_id: 'w4', failure_mode_code: 'TRIP', caused_by_wo_id: 'w1' },
            { wo_id: 'w3', caused_by_wo_id: 'w1' },
        ],
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
    it('has the ten objects in load order with unique sheet names ≤ 31 chars', () => {
        expect(SAP_OBJECTS.map(o => o.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        const names = SAP_OBJECTS.map(o => o.sheet);
        expect(new Set(names).size).toBe(10);
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
        expect(isoTime('2025-02-03T06:40:00Z')).toBe('06:40:00');
        expect(isoTime('2025-02-03')).toBe('');
    });
    it('work types and priorities collapse onto SAP vocabularies', () => {
        expect(workBucket('CM')).toBe('corrective');
        expect(workBucket('INSPECTION')).toBe('preventive');
        expect(workBucket('PdM')).toBe('predictive');
        expect(workBucket('ODDJOB')).toBeNull();
        expect(sapPriority('EMERGENCY')).toBe('1');
        expect(sapPriority('High')).toBe('2');
        expect(sapPriority('P3')).toBe('3');
        expect(sapPriority('LOW')).toBe('4');
        expect(sapPriority('whatever')).toBe('');
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

    it('order history: done and void orders only, in SAP field names, with codes filed under the configured groups', () => {
        const rows = res.objects.orderHistory;
        expect(rows.map(r => r[col('orderHistory', 'AUFNR')])).toEqual(['WO-2025-00412', 'WO-2025-00488', 'WO-2025-00500']);
        const w1 = rows[0], w2 = rows[1], w3 = rows[2];
        expect(w1[col('orderHistory', 'AUART')]).toBe('PM01');
        expect(w1[col('orderHistory', 'EQUNR')]).toBe('EQ-000101');
        expect(w1[col('orderHistory', 'TIDNR')]).toBe('PMP-101A');
        expect(w1[col('orderHistory', 'TPLNR')]).toBe('SITE-HOU-U300');
        expect(w1[col('orderHistory', 'PRIOK')]).toBe('1');
        expect(w1[col('orderHistory', 'LEGACY_STATUS')]).toBe('CLOSED');
        expect(w1[col('orderHistory', 'STTXT')]).toBe('CLSD');
        expect(w1[col('orderHistory', 'ERDAT')]).toBe('03.02.2025');
        expect(w1[col('orderHistory', 'GETRI')]).toBe('11.02.2025');
        expect(w1[col('orderHistory', 'MSAUS')]).toBe('X');
        expect(w1[col('orderHistory', 'AUSVN')]).toBe('03.02.2025');
        expect(w1[col('orderHistory', 'AUZTV')]).toBe('06:40:00');
        expect(w1[col('orderHistory', 'AUZTB')]).toBe('13:10:00');
        expect(w1[col('orderHistory', 'AUSZT')]).toBe(6.5);
        expect(w1[col('orderHistory', 'ISMNW')]).toBe(9);
        expect(w1[col('orderHistory', 'KOSTL')]).toBe('MNT-300');
        expect(w1[col('orderHistory', 'GEWRK')]).toBe('MECH-01');
        expect(w1[col('orderHistory', 'FEGRP')]).toBe('YB-DAM');
        expect(w1[col('orderHistory', 'FECOD')]).toBe('LEAK');
        expect(w1[col('orderHistory', 'OTEIL')]).toBe('SEAL');
        expect(w1[col('orderHistory', 'URCOD')]).toBe('WEAR');
        expect(w1[col('orderHistory', 'MNCOD')]).toBe('REPLACED');      // the extract keeps the full IREAMS code
        expect(w1[col('orderHistory', 'COST_TOTAL')]).toBe(1250);
        expect(w1[col('orderHistory', 'WAERS')]).toBe('USD');
        expect(w1[col('orderHistory', 'QMNAM')]).toBe('j.tech');
        expect(w2[col('orderHistory', 'AUART')]).toBe('PM02');
        expect(w2[col('orderHistory', 'STTXT')]).toBe('TECO');
        expect(w2[col('orderHistory', 'PRIOK')]).toBe('4');
        expect(w2[col('orderHistory', 'MSAUS')]).toBe('');
        expect(w2[col('orderHistory', 'FEGRP')]).toBe('');
        expect(w2[col('orderHistory', 'COST_TOTAL')]).toBe(320);       // labour + material when no total is stored
        expect(w2[col('orderHistory', 'QMNAM')]).toBe('planner.pers');  // email local part, clipped to 12
        expect(w3[col('orderHistory', 'STTXT')]).toBe('DLFL');
        expect(w3[col('orderHistory', 'CAUSED_BY_AUFNR')]).toBe('WO-2025-00412');
        expect(res.issues.some(i => i.object === 'orderHistory' && /reference extract/.test(i.message))).toBe(true);
    });

    it('open notifications: open and unknown-status orders, typed by breakdown and work type, with the follow-on order type', () => {
        const rows = res.objects.openNotification;
        expect(rows.map(r => r[col('openNotification', 'LEGACY_NOTIF')])).toEqual(['WO-2026-01002', 'WO-2026-01031', 'WO-2026-01040']);
        const w4 = rows[0], w5 = rows[1], w6 = rows[2];
        expect(w4[col('openNotification', 'NOTIF_TYPE')]).toBe('M2');
        expect(w4[col('openNotification', 'SHORT_TEXT')]).toHaveLength(40);
        expect(w4[col('openNotification', 'LONG_TEXT')]).toBe('Trips within 10 min of start.');
        expect(w4[col('openNotification', 'EQUIPMENT')]).toBe('EQ-000102');
        expect(w4[col('openNotification', 'FUNCT_LOC')]).toBe('SITE-HOU-U300');
        expect(w4[col('openNotification', 'PRIORITY')]).toBe('2');
        expect(w4[col('openNotification', 'NOTIF_DATE')]).toBe('09.06.2026');
        expect(w4[col('openNotification', 'NOTIFTIME')]).toBe('07:15:00');
        expect(w4[col('openNotification', 'BREAKDOWN')]).toBe('X');
        expect(w4[col('openNotification', 'STRMLFNDATE')]).toBe('09.06.2026');
        expect(w4[col('openNotification', 'PLANPLANT')]).toBe('102A');
        expect(w4[col('openNotification', 'D_CODEGRP')]).toBe('YB-DAM');
        expect(w4[col('openNotification', 'D_CODE')]).toBe('TRIP');
        // the LOAD sheet clips to SAP's 4-character catalog code and says how to map
        const r3 = buildSapLoad({ ...fixture(), woFailureData: [{ wo_id: 'w4', failure_mode_code: 'OVERLOAD_TRIP' }] }, params());
        expect(r3.objects.openNotification[0][col('openNotification', 'D_CODE')]).toBe('OVER');
        expect(r3.issues.some(i => i.object === 'openNotification' && /QS41/.test(i.message))).toBe(true);
        expect(w4[col('openNotification', 'LEGACY_ORDER_TYPE')]).toBe('PM01');
        expect(w5[col('openNotification', 'NOTIF_TYPE')]).toBe('M1');
        expect(w5[col('openNotification', 'PRIORITY')]).toBe('3');
        expect(w5[col('openNotification', 'LEGACY_ORDER_TYPE')]).toBe('PM02');
        expect(w5[col('openNotification', 'FUNCT_LOC')]).toBe('');                 // CMP-201 has no position
        expect(w6[col('openNotification', 'EQUIPMENT')]).toBe('');
        expect(w6[col('openNotification', 'LEGACY_STATUS')]).toBe('FOOBAR');
        expect(res.issues.some(i => i.object === 'openNotification' && i.level === 'warn' && /posted cost/.test(i.message))).toBe(true);
        expect(res.issues.some(i => i.object === 'openNotification' && /does not recognise/.test(i.message))).toBe(true);
        expect(res.issues.some(i => i.object === 'general' && /no asset/.test(i.message))).toBe(true);
    });

    it('order and notification types follow the parameters', () => {
        const r2 = buildSapLoad(fixture(), params({ orderTypes: { corrective: 'YA01', preventive: 'YA02', predictive: 'YA03' }, notificationTypes: { corrective: 'Y1', preventive: 'Y2' } }));
        expect(r2.objects.orderHistory[0][col('orderHistory', 'AUART')]).toBe('YA01');
        expect(r2.objects.openNotification[1][col('openNotification', 'NOTIF_TYPE')]).toBe('Y2');
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
        expect(wb.SheetNames[wb.SheetNames.length - 1]).toBe('Readiness');
        const eq = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets['2 Equipment'], { header: 1 });
        expect(eq[3][0]).toBe('EQUNR');
        expect(eq.slice(4).map(r => r[col('equipment', 'TIDNR')]).sort()).toEqual(['CMP-201', 'PMP-101A', 'PMP-101A-M']);
        const ready = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets['Readiness'], { header: 1 });
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
