import { describe, it, expect } from 'vitest';
import { resolveSapProfile, findHeaderRow, SAP_PROFILES } from './assetTemplates';

const lower = (h: string[]) => h.map(x => x.toLowerCase());

describe('resolveSapProfile', () => {
  it('recognises each migration-object sheet by its SAP field names', () => {
    expect(resolveSapProfile(lower(['TPLNR', 'PLTXT', 'FLTYP', 'TPLMA', 'EQART', 'ABCKZ']))!.name).toBe('SAP functional locations');
    expect(resolveSapProfile(lower(['EQUNR', 'EQKTX', 'EQTYP', 'EQART', 'TPLNR', 'HEQUI', 'HERST']))!.name).toBe('SAP equipment');
    expect(resolveSapProfile(lower(['MATNR', 'MAKTX', 'MTART', 'MEINS', 'VERPR']))!.name).toBe('SAP material master');
    expect(resolveSapProfile(lower(['EQUNR', 'STLAN', 'POSNR', 'IDNRK', 'MENGE', 'MEINS']))!.name).toBe('SAP equipment BOM');
    expect(resolveSapProfile(lower(['MPOBJ', 'MPTYP', 'PSORT', 'PTTXT', 'ATNAM', 'MRNGU']))!.name).toBe('SAP measuring points');
    expect(resolveSapProfile(lower(['POINT', 'MPOBJ', 'PSORT', 'IDATE', 'ITIME', 'READG', 'CNTRR']))!.name).toBe('SAP measurement documents');
    expect(resolveSapProfile(lower(['MATNR', 'WERKS', 'LGORT', 'MENGE', 'BUDAT', 'BWART']))!.name).toBe('SAP inventory balances');
  });
  it('does not fire on ERS-native or unknown sheets', () => {
    expect(resolveSapProfile(['tag', 'name', 'hierarchylevel'])).toBeNull();
    expect(resolveSapProfile(['foo', 'bar'])).toBeNull();
  });
});

describe('findHeaderRow', () => {
  it('skips the workbook title and hint rows above the SAP field-name row', () => {
    const rows = [
      ['Migration object: Equipment'],
      ['Load after functional locations. Leave EQUNR blank…'],
      ['Row 4 = SAP field name (keep).'],
      ['EQUNR', 'EQKTX', 'EQTYP', 'EQART', 'TPLNR'],
      ['2000001222', 'Pump', 'M', 'PUMP', 'SITE-HOU-U300'],
    ];
    expect(findHeaderRow(rows)).toBe(3);
  });
  it('returns 0 for a normal template with headers in row 1', () => {
    expect(findHeaderRow([['tag', 'name', 'hierarchyLevel'], ['GT-301', 'Turbine', 'EQUIPMENT']])).toBe(0);
  });
});

const fixupOf = (name: string) => SAP_PROFILES.find(p => p.name === name)!.fixup!;

describe('profile fixups', () => {
  it('equipment: tag falls back to EQUNR; level defaults to EQUIPMENT', () => {
    const r: Record<string, string> = { equipmentnumber: '10004521', name: 'Pump', tag: '' };
    fixupOf('SAP equipment')(r);
    expect(r.tag).toBe('10004521');
    expect(r.hierarchylevel).toBe('EQUIPMENT');
  });
  it('material: MTART and ABC translate; price control honoured', () => {
    const r: Record<string, string> = { code: 'FLT-0023', type: 'ERSA', iscritical: 'A', vprsv: 'S', stprs: '245.00', itemcost: '' };
    fixupOf('SAP material master')(r);
    expect(r.type).toBe('SPARE');
    expect(r.iscritical).toBe('YES');
    expect(r.itemcost).toBe('245.00');
  });
  it('BOM: description falls back to the component code', () => {
    const r: Record<string, string> = { assettag: 'EQ-000101', inventorycode: 'FLT-0023', description: '', quantity: '' };
    fixupOf('SAP equipment BOM')(r);
    expect(r.description).toBe('FLT-0023');
    expect(r.quantity).toBe('1');
  });
  it('measurement doc: counters land as the value', () => {
    const r: Record<string, string> = { assettag: 'EQ-000101', readingtype: 'RUNHOURS', value: '', cntrr: '48210' };
    fixupOf('SAP measurement documents')(r);
    expect(r.value).toBe('48210');
  });
});
