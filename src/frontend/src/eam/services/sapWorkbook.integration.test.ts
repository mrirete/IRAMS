/**
 * Parse-level integration: real XLSX workbooks shaped EXACTLY like a SAP
 * migration-cockpit workbook (title row, hint rows, SAP field-name headers,
 * then data) driven through parseImportFile — testing header-row detection,
 * sheet-profile resolution, aliasing, fixups and validation TOGETHER.
 */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseImportFile } from './assetTemplates';

function sapFile(name: string, rows: (string | number)[][]): File {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return new File([buf], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

const TITLE_ROWS = (title: string) => [
    [`Migration object: ${title}`],
    ['Load first. Parents before children.'],
    ['Row 4 = SAP field name (keep). Delete rows 5 and 6, then paste your data.'],
];

describe('SAP workbook → parseImportFile (integration)', () => {
    it('Functional Location sheet: detects asset type through the title rows', async () => {
        const f = sapFile('floc.xlsx', [
            ...TITLE_ROWS('Functional Location'),
            ['TPLNR', 'PLTXT', 'FLTYP', 'TPLKZ', 'TPLMA', 'EQART', 'SWERK', 'IWERK', 'ABCKZ'],
            ['SITE-HOU', 'Houston Production Site', 'M', 'YB01', '', 'SITE', '102A', '102A', ''],
            ['SITE-HOU-U300', 'Gas Turbine Generation Unit', 'M', 'YB01', 'SITE-HOU', 'UNIT', '102A', '102A', ''],
        ]);
        const res = await parseImportFile(f);
        expect(res.type).toBe('asset');
        expect(res.validCount).toBe(2);
        const r = res.rows[1].data;
        expect(r['tag']).toBe('SITE-HOU-U300');
        expect(r['parenttag']).toBe('SITE-HOU');
        expect(r['assettype']).toBe('UNIT');
    });

    it('Equipment sheet: EQUNR becomes equipment number AND the tag fallback; TPLNR the parent', async () => {
        const f = sapFile('equipment.xlsx', [
            ...TITLE_ROWS('Equipment'),
            ['EQUNR', 'EQKTX', 'EQTYP', 'EQART', 'TPLNR', 'HEQUI', 'HERST', 'TYPBZ', 'SERGE', 'SWERK', 'IWERK', 'ABCKZ'],
            ['2000001222', 'Centrifugal pump - cooling water', 'M', 'PUMP', 'SITE-HOU-U300', '', 'KSB', 'Etanorm', 'KSB-2019-04471', '102A', '102A', 'A'],
        ]);
        const res = await parseImportFile(f);
        expect(res.type).toBe('asset');
        expect(res.validCount).toBe(1);
        const r = res.rows[0].data;
        expect(r['equipmentnumber']).toBe('2000001222');
        expect(r['tag']).toBe('2000001222');            // no TIDNR column → EQUNR serves as tag
        expect(r['parenttag']).toBe('SITE-HOU-U300');   // position; empty HEQUI must not blank it
        expect(r['hierarchylevel']).toBe('EQUIPMENT');
        expect(r['manufacturer']).toBe('KSB');
        expect(r['serialnumber']).toBe('KSB-2019-04471');
    });

    it('Material sheet: MTART/ABC/price-control translate', async () => {
        const f = sapFile('material.xlsx', [
            ...TITLE_ROWS('Product (Material)'),
            ['MATNR', 'MAKTX', 'MTART', 'MATKL', 'MEINS', 'MFRNR', 'WERKS', 'MINBE', 'MABST', 'MAABC', 'LGORT', 'LGPBE', 'VPRSV', 'STPRS', 'VERPR', 'PEINH'],
            ['FLT-0023', 'Air Inlet Filter 24x24', 'ERSA', 'YBSPARE', 'EA', 'Donaldson', '102A', '4', '16', 'A', '0001', 'C2-01-4-2', 'V', '', '245.00', '1'],
            ['LUB-0012', 'Synthetic Turbine Oil', 'VERB', 'YBCONS', 'L', '', '102A', '40', '200', 'C', '0001', 'D1-05-2-1', 'S', '18.50', '', '1'],
        ]);
        const res = await parseImportFile(f);
        expect(res.type).toBe('inventory');
        expect(res.validCount).toBe(2);
        const filt = res.rows[0].data, oil = res.rows[1].data;
        expect(filt['code']).toBe('FLT-0023');
        expect(filt['type']).toBe('SPARE');          // ERSA
        expect(filt['iscritical']).toBe('YES');      // ABC A
        expect(filt['itemcost']).toBe('245.00');     // VPRSV=V → VERPR
        expect(oil['type']).toBe('CONSUMABLE');      // VERB
        expect(oil['itemcost']).toBe('18.50');       // VPRSV=S → STPRS
        expect(oil['binlocation']).toBe('D1-05-2-1');
    });

    it('Equipment BOM sheet: EQUNR is the parent asset link; blank text falls back to component code', async () => {
        const f = sapFile('bom.xlsx', [
            ...TITLE_ROWS('Equipment Bill of Material'),
            ['EQUNR', 'STLAN', 'STLAL', 'BMENG', 'BMEIN', 'STKTX', 'POSNR', 'POSTP', 'IDNRK', 'MENGE', 'MEINS', 'POTX1'],
            ['EQ-000101', '4', '01', '1', 'EA', 'GT-301 maintenance BOM', '0010', 'L', 'FLT-0023', '4', 'EA', 'Critical spare'],
            ['EQ-000101', '4', '01', '1', 'EA', '', '0020', 'L', 'BRG-0041', '1', 'EA', ''],
        ]);
        const res = await parseImportFile(f);
        expect(res.type).toBe('bom');
        expect(res.validCount).toBe(2);
        expect(res.rows[0].data['assettag']).toBe('EQ-000101');
        expect(res.rows[0].data['inventorycode']).toBe('FLT-0023');
        expect(res.rows[0].data['description']).toBe('Critical spare');
        expect(res.rows[1].data['description']).toBe('BRG-0041'); // POTX1 blank → component code
    });

    it('Measuring Point sheet: definition-only rows validate WITHOUT date/value', async () => {
        const f = sapFile('measpoint.xlsx', [
            ...TITLE_ROWS('Measuring Point'),
            ['MPOBJ', 'MPTYP', 'PSORT', 'PTTXT', 'ATNAM', 'MRNGU', 'INDCT', 'DECIM', 'MRMIN', 'MRMAX', 'ATVLO', 'ATVUP', 'CYCLE'],
            ['EQ-000101', '', 'RUNHOURS', 'Turbine running hours', 'YB_HOURS', 'hrs', 'X', '0', '', '', '', '', '8000'],
            ['EQ-000101', '', 'VIB-DE', 'Drive end bearing vibration', 'YB_VIBRATION', 'mm/s', '', '1', '0', '20', '', '7.1', ''],
        ]);
        const res = await parseImportFile(f);
        expect(res.type).toBe('readings');
        expect(res.validCount).toBe(2);   // no "Missing required: date/value"
        const vib = res.rows[1].data;
        expect(vib['assettag']).toBe('EQ-000101');
        expect(vib['readingtype']).toBe('VIB-DE');
        expect(vib['pointname']).toBe('Drive end bearing vibration');
        expect(vib['maxwarning']).toBe('7.1');  // ATVUP alarm limit
    });

    it('Measurement Document sheet: counters land as values', async () => {
        const f = sapFile('measdoc.xlsx', [
            ...TITLE_ROWS('Measurement documents'),
            ['POINT', 'MPOBJ', 'PSORT', 'IDATE', 'ITIME', 'READG', 'RECDV', 'CNTRR', 'MRNGU', 'MDTXT'],
            ['', 'EQ-000101', 'RUNHOURS', '31.01.2026', '23:59:00', '', '', '48210', 'hrs', 'Month-end counter read'],
            ['', 'EQ-000101', 'VIB-DE', '14.02.2026', '09:15:00', '4.2', '', '', 'mm/s', 'Route 12 DE bearing'],
        ]);
        const res = await parseImportFile(f);
        expect(res.type).toBe('readings');
        expect(res.validCount).toBe(2);
        expect(res.rows[0].data['value']).toBe('48210');  // CNTRR → value
        expect(res.rows[1].data['value']).toBe('4.2');    // READG stays
        expect(res.rows[0].data['readingtype']).toBe('RUNHOURS');
    });

    it('Source List sheet: LIFNR becomes the preferred supplier on a valid row', async () => {
        const f = sapFile('sourcelist.xlsx', [
            ...TITLE_ROWS('Source List'),
            ['MATNR', 'WERKS', 'VDATU', 'BDATU', 'LIFNR', 'EKORG', 'FLIFN', 'AUTET'],
            ['FLT-0023', '102A', '01.01.2026', '31.12.9999', '1000020', '1030', 'X', '1'],
        ]);
        const res = await parseImportFile(f);
        expect(res.type).toBe('inventory');
        expect(res.validCount).toBe(1);
        expect(res.rows[0].data['code']).toBe('FLT-0023');
        expect(res.rows[0].data['preferredsupplier']).toBe('1000020');
    });

    it('Inventory Balance sheet: opening quantities validate as inventory rows', async () => {
        const f = sapFile('stock.xlsx', [
            ...TITLE_ROWS('Inventory Balance'),
            ['MATNR', 'WERKS', 'LGORT', 'BWTAR', 'CHARG', 'MENGE', 'MEINS', 'BUDAT', 'BWART'],
            ['FLT-0023', '102A', '0001', '', '', '8', 'EA', '17.08.2026', '561'],
        ]);
        const res = await parseImportFile(f);
        expect(res.type).toBe('inventory');
        expect(res.validCount).toBe(1);
        expect(res.rows[0].data['qtyonhand']).toBe('8');
        expect(res.rows[0].data['storename']).toBe('0001');
    });

    it('ERS-native templates still parse unchanged (no profile interference)', async () => {
        const f = sapFile('native.xlsx', [
            ['tag', 'name', 'hierarchyLevel', 'assetType', 'parentTag'],
            ['GT-301', 'Gas Turbine #1', 'EQUIPMENT', 'COMPRESSOR', ''],
        ]);
        const res = await parseImportFile(f);
        expect(res.type).toBe('asset');
        expect(res.validCount).toBe(1);
        expect(res.rows[0].data['tag']).toBe('GT-301');
    });
});
