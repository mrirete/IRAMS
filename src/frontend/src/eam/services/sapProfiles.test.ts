import { describe, it, expect } from 'vitest';
import { resolveSapProfile, findHeaderRow, SAP_PROFILES, isDescriptionRow, readingTypeFromCharacteristic, stripCockpitAnnotation } from './assetTemplates';

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

describe('SAP source list (0296)', () => {
  it('recognises the sheet and maps LIFNR to the preferred supplier', () => {
    const p = resolveSapProfile(lower(['MATNR', 'WERKS', 'VDATU', 'BDATU', 'LIFNR', 'EKORG', 'FLIFN']))!;
    expect(p.name).toBe('SAP source list');
    expect(p.aliases['lifnr']).toBe('preferredsupplier');
    const r: Record<string, string> = { code: 'FLT-0023', preferredsupplier: '1000020' };
    p.fixup!(r);
    expect(r.description).toBe('FLT-0023'); // required-field defaults so the row validates
    expect(r.type).toBe('SPARE');
  });
  it('does not shadow the material or stock sheets', () => {
    expect(resolveSapProfile(lower(['MATNR', 'MAKTX', 'LIFNR']))!.name).toBe('SAP material master');
    expect(resolveSapProfile(lower(['MATNR', 'BUDAT', 'MENGE']))!.name).toBe('SAP inventory balances');
  });
});

describe('SAP measuring points — consultant load-file layout', () => {
  const LOAD_FILE_HEADER = ['Field', 'POINT', 'PSORT', 'PTTXT', 'MPOBJ', 'EQUNR', 'TPLNR', 'MPTYP', 'ATNAM', 'MSEHI', 'DECIM', 'INDCT', 'MRMIN', 'MRMAX'];
  it('MSEHI tells the load-file layout from the cockpit sheet (both carry MPOBJ + ATNAM)', () => {
    expect(resolveSapProfile(lower(LOAD_FILE_HEADER))!.name).toBe('SAP measuring points (load file)');
    expect(resolveSapProfile(lower(['MPOBJ', 'MPTYP', 'PSORT', 'PTTXT', 'ATNAM', 'MRNGU']))!.name).toBe('SAP measuring points');
  });
  it('the "Field" label names the header row even when no field is recognisable', () => {
    const rows = [
      ['Information', 'PM - Maintenance Plan'],
      ['Header', 'Basic Data', 'Basic Data'],
      ['Table', 'MPLA', 'MPLA'],
      ['Field', 'WARPL', 'WPTXT'],
      ['Field Description', 'Maintenance Plan', 'MaintPlanText'],
      ['SMP10000001', '50099001', '1M/12M,PUMP P-101,MECH'],
    ];
    expect(findHeaderRow(rows)).toBe(3);
  });
  it('the six documentation rows under the header are never data', () => {
    for (const label of ['Field Description', 'Data Type', 'Length', 'Mandatory', 'BRD', 'ASSIGNED']) {
      expect(isDescriptionRow([label, 'x', 'y'])).toBe(true);
    }
    expect(isDescriptionRow(['TMP01000001', 'MP-00000001', '1'])).toBe(false);
    expect(isDescriptionRow(['SITE-HOU', 'Houston Production Site'])).toBe(false);
  });
  it('fixup: equipment from EQUNR (MPOBJ = "IEQ" is a prefix), type from ATNAM, unit made readable, range as band', () => {
    const p = SAP_PROFILES.find(x => x.name === 'SAP measuring points (load file)')!;
    const r: Record<string, string> = {
      assettag: 'ES0654503', mpobj: 'IEQ', position: '3', pointname: 'PUMP NDE HORIZONDAL VIBRATION',
      atnam: 'MP_VIBRATION', unit: 'MMS', mrmin: '5.40', mrmax: '8.50', counter: '',
    };
    p.fixup!(r);
    expect(r.assettag).toBe('ES0654503');
    expect(r.readingtype).toBe('VIBRATION');
    expect(r.unit).toBe('mm/s');
    expect(r.minwarning).toBe('5.40');
    expect(r.maxwarning).toBe('8.50');
    expect(p.rowWarnings!(r).join(' ')).toMatch(/measurement-range/);
  });
  it('fixup: a real object number resolves; alarm limits beat the range when both are present', () => {
    const p = SAP_PROFILES.find(x => x.name === 'SAP measuring points (load file)')!;
    const r: Record<string, string> = { assettag: '', mpobj: 'IE000000000010004521', atnam: 'YB_HOURS', unit: 'H', counter: 'X', minwarning: '', maxwarning: '7.1', mrmin: '0', mrmax: '20' };
    p.fixup!(r);
    expect(r.assettag).toBe('10004521');
    expect(r.readingtype).toBe('HOURS');
    expect(r.unit).toBe('h');
    expect(r.counter).toBe('YES');
    expect(r.minwarning).toBe('0');      // range fills the gap…
    expect(r.maxwarning).toBe('7.1');    // …but never overrides ATVUP
  });
  it('readingTypeFromCharacteristic strips the customer prefix only', () => {
    expect(readingTypeFromCharacteristic('MP_TEMPERATURE')).toBe('TEMPERATURE');
    expect(readingTypeFromCharacteristic('ZMP_VIBRATION')).toBe('VIBRATION');
    expect(readingTypeFromCharacteristic('YB_HOURS')).toBe('HOURS');
    expect(readingTypeFromCharacteristic('VIBRATION')).toBe('VIBRATION');
    expect(readingTypeFromCharacteristic('mp_current')).toBe('CURRENT');
  });
});

describe('Migration Cockpit sheets', () => {
  // The cockpit annotates its headers — "EQUNR(k/*)" key + mandatory,
  // "EQTYP(*)" mandatory, "STRAT(k)" key — and names the register differently
  // from the tables: EXTERNAL_NUMBER / KTX01 on a location, TECHID for the tag.
  const norm = (h: string[]) => h.map(x => stripCockpitAnnotation(x).toLowerCase());

  it('strips the key / mandatory annotation and nothing else', () => {
    expect(stripCockpitAnnotation('EQUNR(k/*)')).toBe('EQUNR');
    expect(stripCockpitAnnotation('EQTYP(*)')).toBe('EQTYP');
    expect(stripCockpitAnnotation('STRAT(k)')).toBe('STRAT');
    expect(stripCockpitAnnotation('EQKTX')).toBe('EQKTX');
    expect(stripCockpitAnnotation('Equipment (tag)')).toBe('Equipment (tag)');
  });

  it('reads S_EQUI as equipment, with TECHID as the tag', () => {
    const p = resolveSapProfile(norm(['EQUNR(k/*)', 'NRANGE_IND', 'EQTYP(*)', 'DATAB(*)', 'EQKTX', 'EQART', 'TPLNR', 'HEQUI', 'TECHID']))!;
    expect(p.name).toBe('SAP equipment');
    expect(p.aliases['techid']).toBe('tag');
    const r: Record<string, string> = { equipmentnumber: '10004711', name: 'Feed pump', tag: 'P-101A' };
    p.fixup!(r);
    expect(r.tag).toBe('P-101A');
    expect(r.hierarchylevel).toBe('EQUIPMENT');
  });

  it('warns when a cost centre is Excel’s rendering of a number, not a cost centre', () => {
    const p = SAP_PROFILES.find(x => x.name === 'SAP equipment')!;
    expect(p.rowWarnings!({ costcenter: '1.7E+07' })).toHaveLength(1);
    expect(p.rowWarnings!({ costcenter: '1710000012' })).toHaveLength(0);
  });

  it('reads S_FUN_LOCATION by its cockpit key, not the table name', () => {
    const p = resolveSapProfile(norm(['EXTERNAL_NUMBER(k/*)', 'TPLKZ(*)', 'FLTYP(*)', 'ALKEY', 'KTX01', 'EQART', 'TPLMA', 'ABCKZ']))!;
    expect(p.name).toBe('SAP functional locations (cockpit)');
    expect(p.aliases['external_number']).toBe('tag');
    expect(p.aliases['ktx01']).toBe('name');
    expect(p.aliases['tplma']).toBe('parenttag');
    // The table-name shape still resolves to the older profile.
    expect(resolveSapProfile(norm(['TPLNR', 'PLTXT', 'TPLMA']))!.name).toBe('SAP functional locations');
  });

  it('finds the header row of a cockpit sheet even though every cell is annotated', () => {
    const rows = [
      ['EXTERNAL_NUMBER(k/*)', 'TPLKZ(*)', 'FLTYP(*)', 'ALKEY', 'KTX01', 'TPLMA'],
      ['SITE-HOU', 'YB01', 'M', '', 'Houston site', ''],
    ];
    expect(findHeaderRow(rows)).toBe(0);
  });
});

describe('S_TEXTS_FL → the asset description', () => {
  it('fills description from the sibling text sheet, first language wins, never over a value already there', () => {
    const p = SAP_PROFILES.find(x => x.name === 'SAP functional locations (cockpit)')!;
    const rows: Record<string, string>[] = [
      { tag: 'SYS-300-BLR', name: 'Boiler system' },
      { tag: 'SYS-300-FWS', name: 'Feedwater system', description: 'kept' },
      { tag: 'SYS-300-NIL', name: 'No text' },
    ];
    p.enrich!(rows, {
      sheet: sig => sig.join(',') === 'external_number,spras,longtext' ? [
        { external_number: 'SYS-300-BLR', spras: 'EN', longtext: 'Two-drum water-tube boiler' },
        { external_number: 'SYS-300-BLR', spras: 'DE', longtext: 'Zweitrommel-Wasserrohrkessel' },
        { external_number: 'SYS-300-FWS', spras: 'EN', longtext: 'ignored' },
      ] : null,
    });
    expect(rows[0].description).toBe('Two-drum water-tube boiler');
    expect(rows[1].description).toBe('kept');
    expect(rows[2].description).toBeUndefined();
  });
  it('leaves rows alone when the workbook has no text sheet', () => {
    const p = SAP_PROFILES.find(x => x.name === 'SAP functional locations (cockpit)')!;
    const rows = [{ tag: 'SYS-300-BLR', name: 'Boiler system' }];
    p.enrich!(rows, { sheet: () => null });
    expect(rows[0]).toEqual({ tag: 'SYS-300-BLR', name: 'Boiler system' });
  });
});
