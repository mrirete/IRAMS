import { describe, it, expect } from 'vitest';
import {
  applyMapping, buildDqReport, parseDateCell, parseCostCell,
  guessWoType, guessWoStatus, parseMappingProposal, parseBooleanCell,
  type ImportMapping,
} from './importPipeline';

describe('parseDateCell', () => {
  it('parses ISO strings', () => {
    expect(parseDateCell('2025-05-13')).toMatch(/^2025-05-13T/);
    expect(parseDateCell('2025-05-13T08:30:00Z')).toBe('2025-05-13T08:30:00.000Z');
  });
  it('parses Excel serial numbers', () => {
    // 45000 = 2023-03-15
    expect(parseDateCell(45000)).toMatch(/^2023-03-15T/);
  });
  it('rejects out-of-window serials (plain numbers are not dates)', () => {
    expect(parseDateCell(42)).toBeNull();
    expect(parseDateCell(99999)).toBeNull();
  });
  it('uses DMY by default for ambiguous slash dates', () => {
    expect(parseDateCell('05/03/2025')).toMatch(/^2025-03-05T/);
  });
  it('honours the MDY hint', () => {
    expect(parseDateCell('05/03/2025', 'MDY')).toMatch(/^2025-05-03T/);
  });
  it('detects unambiguous day > 12 regardless of hint', () => {
    expect(parseDateCell('13/05/2025', 'MDY')).toMatch(/^2025-05-13T/);
    expect(parseDateCell('05/13/2025')).toMatch(/^2025-05-13T/);
  });
  it('parses dotted German-style dates', () => {
    expect(parseDateCell('13.05.2025')).toMatch(/^2025-05-13T/);
  });
  it('expands 2-digit years', () => {
    expect(parseDateCell('13/05/25')).toMatch(/^2025-05-13T/);
    expect(parseDateCell('13/05/99')).toMatch(/^1999-05-13T/);
  });
  it('returns null for garbage and blanks', () => {
    expect(parseDateCell('not a date')).toBeNull();
    expect(parseDateCell('')).toBeNull();
    expect(parseDateCell(null)).toBeNull();
  });
});

describe('parseCostCell', () => {
  it('parses plain numbers and numerics', () => {
    expect(parseCostCell(1234.5)).toBe(1234.5);
    expect(parseCostCell('1234.5')).toBe(1234.5);
  });
  it('strips currency symbols and thousands separators', () => {
    expect(parseCostCell('₦1,234.50')).toBe(1234.5);
    expect(parseCostCell('$ 12,345')).toBe(12345);
  });
  it('handles European decimal commas', () => {
    expect(parseCostCell('1.234,50')).toBe(1234.5);
  });
  it('treats parentheses as negative', () => {
    expect(parseCostCell('(500)')).toBe(-500);
  });
  it('returns null for unparseable text', () => {
    expect(parseCostCell('n/a')).toBeNull();
    expect(parseCostCell('')).toBeNull();
  });
});

describe('type/status heuristics', () => {
  it('guesses work types from common vocabulary', () => {
    expect(guessWoType('Preventive')).toBe('PM');
    expect(guessWoType('Condition Monitoring')).toBe('PdM');
    expect(guessWoType('Inspection Round')).toBe('INSPECTION');
    expect(guessWoType('Breakdown')).toBe('CM');
  });
  it('knows SAP vanilla order types (PM01 corrective, PM02 preventive)', () => {
    expect(guessWoType('PM01')).toBe('CM');
    expect(guessWoType('PM02')).toBe('PM');
    // PM03+ are plant-configured (vanilla PM03 = refurbishment) — kept
    // verbatim for value-mapping rather than defaulted wrong.
    expect(guessWoType('PM03')).toBeNull();
    expect(guessWoType('PM05')).toBeNull();
  });
  it('returns null for values it cannot classify — the caller keeps the source value', () => {
    expect(guessWoType('ZM01')).toBeNull();
    expect(guessWoType('Miscellaneous')).toBeNull();
  });
  it('guesses statuses, using the closed date as a tiebreaker', () => {
    expect(guessWoStatus('TECO', false)).toBe('CLOSED');
    expect(guessWoStatus('INPRG', false)).toBe('WIP');
    expect(guessWoStatus('Weird', true)).toBe('CLOSED');
    expect(guessWoStatus('Weird', false)).toBe('OPEN');
  });
});

// ── end-to-end mapping application on a SAP-like export ──────────────────

const SAP_HEADERS = ['Order', 'Order Type', 'Description', 'Equipment', 'Basic start date', 'Basic fin. date', 'Total act.costs', 'System status'];
const SAP_MAPPING: ImportMapping = {
  file_kind: 'work_orders',
  source_system_guess: 'sap_pm',
  confidence: 0.9,
  asset_fields: { tag: null, name: null },
  wo_fields: {
    wo_number: 'Order', title: 'Description', type: 'Order Type',
    status: 'System status', asset_tag: 'Equipment',
    created_at: 'Basic start date', closed_at: 'Basic fin. date',
    total_cost: 'Total act.costs',
  },
  value_maps: {
    type: { PM01: 'CM', PM02: 'PM' },
    status: { TECO: 'CLOSED', REL: 'OPEN' },
  },
  date_format: 'DMY',
};

const SAP_ROWS: unknown[][] = [
  ['4000001', 'PM01', 'Pump seal failure', 'P-101', '13/01/2025', '15/01/2025', '₦250,000', 'TECO'],
  ['4000002', 'PM02', 'Monthly lube round', 'P-101', '01/02/2025', '01/02/2025', '15,000', 'TECO'],
  ['4000003', 'PM01', 'Motor overload trip', 'M-201', '20/02/2025', '', '80,000', 'REL'],
  ['4000001', 'PM01', 'Duplicate order row', 'P-101', '13/01/2025', '', '0', 'TECO'],
  ['4000004', 'PM01', 'No date on this one', 'P-101', '', '', '5,000', 'TECO'],
  ['', '', '', '', '', '', '', ''],
];

describe('applyMapping (SAP-like work-order history)', () => {
  const applied = applyMapping(SAP_HEADERS, SAP_ROWS, SAP_MAPPING);

  it('derives distinct assets from the WO rows', () => {
    expect(applied.assets.map((a) => a.tag).sort()).toEqual(['M-201', 'P-101']);
  });
  it('imports valid WOs and applies value maps', () => {
    expect(applied.workOrders).toHaveLength(3);
    const wo1 = applied.workOrders.find((w) => w.wo_number === '4000001')!;
    expect(wo1.type).toBe('CM');
    expect(wo1.status).toBe('CLOSED');
    expect(wo1.created_at).toMatch(/^2025-01-13T/);
    expect(wo1.material_cost).toBe(250000); // total-cost fallback slot
    expect(wo1.labor_cost).toBe(0);
  });
  it('skips duplicates and undated rows with issues', () => {
    expect(applied.skippedRows).toBe(2);
    const kinds = applied.issues.map((i) => i.kind);
    expect(kinds).toContain('duplicate_wo');
    expect(kinds).toContain('missing_date');
  });
  it('keeps open work OPEN via the status value map', () => {
    const wo3 = applied.workOrders.find((w) => w.wo_number === '4000003')!;
    expect(wo3.status).toBe('OPEN');
    expect(wo3.closed_at).toBeNull();
  });
});

describe('buildDqReport', () => {
  const applied = applyMapping(SAP_HEADERS, SAP_ROWS, SAP_MAPPING);
  const report = buildDqReport(applied);

  it('counts totals and coverage', () => {
    expect(report.totals.work_orders).toBe(3);
    expect(report.totals.assets).toBe(2);
    expect(report.coverage.cost_pct).toBe(100);
    expect(report.coverage.failure_code_pct).toBe(0);
  });
  it('warns about short history spans', () => {
    expect(report.date_range.months).toBeLessThan(12);
    expect(report.warnings.some((w) => w.includes('months'))).toBe(true);
  });
  it('warns about missing failure coding', () => {
    expect(report.warnings.some((w) => w.toLowerCase().includes('failure coding'))).toBe(true);
  });
});

describe('parseMappingProposal', () => {
  it('extracts the fenced mapping and strips it from prose', () => {
    const answer = 'This looks like a SAP IW38 export.\n```import-mapping\n' +
      JSON.stringify(SAP_MAPPING) + '\n```\nLet me know.';
    const { prose, mapping } = parseMappingProposal(answer);
    expect(mapping).not.toBeNull();
    expect(mapping!.file_kind).toBe('work_orders');
    expect(mapping!.wo_fields.wo_number).toBe('Order');
    expect(prose).not.toContain('import-mapping');
  });
  it('returns null mapping on malformed JSON without losing prose', () => {
    const { prose, mapping } = parseMappingProposal('Text\n```import-mapping\n{broken\n```');
    expect(mapping).toBeNull();
    expect(prose).toBe('Text');
  });
  it('returns null mapping when no block exists', () => {
    expect(parseMappingProposal('just prose').mapping).toBeNull();
  });
});

// ── two SAP identities: EQUNR + TIDNR on an equipment register ───────────

const IE05_HEADERS = ['Equipment', 'TechIdentNo.', 'Functional loc.', 'Description of technical object', 'Object type', 'ABC indic.'];
const IE05_MAPPING: ImportMapping = {
  file_kind: 'assets',
  source_system_guess: 'sap_pm',
  confidence: 0.9,
  asset_fields: {
    tag: 'TechIdentNo.', equipment_number: 'Equipment', functional_location: 'Functional loc.',
    name: 'Description of technical object', asset_category: 'Object type',
    criticality: 'ABC indic.',
  },
  wo_fields: {},
  value_maps: {},
};

describe('applyMapping (SAP register with internal numbering)', () => {
  const applied = applyMapping(IE05_HEADERS, [
    ['10004521', 'PMP-101A', 'PLT1-CWS-PMP-101A', 'Centrifugal pump', 'PUMP', 'A'],
    ['10004736', '', '', 'Air compressor - no TIDNR maintained', 'COMPRESSOR', 'B'],
  ], IE05_MAPPING);

  it('keeps both identities: TIDNR as tag, EQUNR as equipment number', () => {
    const pump = applied.assets.find((a) => a.tag === 'PMP-101A')!;
    expect(pump.equipment_number).toBe('10004521');
    expect(pump.functional_location).toBe('PLT1-CWS-PMP-101A');
  });
  it('falls back to EQUNR as the tag when TIDNR is blank (external numbering)', () => {
    const comp = applied.assets.find((a) => a.equipment_number === '10004736')!;
    expect(comp.tag).toBe('10004736');
    expect(applied.skippedRows).toBe(0);
  });
  it('warns when most tags are bare EQUNR digit runs', () => {
    const numericOnly = applyMapping(IE05_HEADERS, [
      ['10004521', '', '', 'Pump', 'PUMP', 'A'],
      ['10004736', '', '', 'Compressor', 'COMPRESSOR', 'B'],
    ], { ...IE05_MAPPING, asset_fields: { tag: 'Equipment', name: 'Description of technical object' } });
    const report = buildDqReport(numericOnly);
    expect(report.warnings.some((w) => w.includes('EQUNR'))).toBe(true);
  });
  it('does not warn when TIDNR tags are present', () => {
    expect(buildDqReport(applied).warnings.some((w) => w.includes('EQUNR'))).toBe(false);
  });
});

// ── Maximo shape: ASSETNUM/LOCATION duality, CAN status, multi-token SAP ──

const MAXIMO_HEADERS = ['WONUM', 'DESCRIPTION', 'WORKTYPE', 'STATUS', 'ASSETNUM', 'LOCATION', 'REPORTDATE', 'ACTFINISH'];
const MAXIMO_MAPPING: ImportMapping = {
  file_kind: 'work_orders',
  source_system_guess: 'maximo',
  confidence: 0.9,
  asset_fields: {},
  wo_fields: {
    wo_number: 'WONUM', title: 'DESCRIPTION', type: 'WORKTYPE', status: 'STATUS',
    asset_tag: 'ASSETNUM', asset_location: 'LOCATION',
    created_at: 'REPORTDATE', closed_at: 'ACTFINISH',
  },
  value_maps: { type: { CM: 'CM', PM: 'PM' }, status: { CLOSE: 'CLOSED', COMP: 'CLOSED' } },
  date_format: 'ISO',
};

describe('applyMapping (Maximo: location fallback + CAN status)', () => {
  const applied = applyMapping(MAXIMO_HEADERS, [
    ['1001', 'Pump seal leak', 'CM', 'CLOSE', '11450', 'CWS-PMP-101A', '2025-02-03', '2025-02-05'],
    ['1004', 'Walkway lighting - boiler house', 'CM', 'COMP', '', 'BLR3', '2025-05-21', '2025-05-21'],
    ['1007', 'Cancelled duplicate request', 'CM', 'CAN', '11450', 'CWS-PMP-101A', '2025-06-01', ''],
  ], MAXIMO_MAPPING);

  it('links a location-only WO by LOCATION instead of dropping it', () => {
    expect(applied.workOrders).toHaveLength(3);
    const areaWo = applied.workOrders.find((w) => w.wo_number === '1004')!;
    expect(areaWo.asset_tag).toBe('BLR3');
    expect(applied.issues.some((i) => i.kind === 'linked_by_location')).toBe(true);
    // the position-level draft carries its location reference
    expect(applied.assets.find((a) => a.tag === 'BLR3')!.functional_location).toBe('BLR3');
  });
  it('captures LOCATION as functional_location on asset-linked WOs too', () => {
    expect(applied.assets.find((a) => a.tag === '11450')!.functional_location).toBe('CWS-PMP-101A');
  });
  it('maps bare CAN to CANCELLED (token-exact, not substring)', () => {
    expect(applied.workOrders.find((w) => w.wo_number === '1007')!.status).toBe('CANCELLED');
    expect(guessWoStatus('SCAN PENDING', false)).not.toBe('CANCELLED');
  });
});

describe('multi-token SAP system status', () => {
  it('matches value_maps token-wise on combined status strings', () => {
    const applied = applyMapping(SAP_HEADERS, [
      ['4000010', 'PM01', 'Combined status row', 'P-101', '13/01/2025', '15/01/2025', '100', 'TECO CNF PRC SETC'],
      ['4000011', 'PM01', 'Open combined row', 'M-201', '20/02/2025', '', '50', 'REL CNF PRT'],
    ], SAP_MAPPING);
    expect(applied.workOrders.find((w) => w.wo_number === '4000010')!.status).toBe('CLOSED');
    expect(applied.workOrders.find((w) => w.wo_number === '4000011')!.status).toBe('OPEN');
  });
});

// ── slice 2: breakdown indicator, labor hours, malfunction window ────────

describe('parseBooleanCell (breakdown indicator)', () => {
  it('reads SAP X and common yes/no vocabularies', () => {
    expect(parseBooleanCell('X')).toBe(true);
    expect(parseBooleanCell('yes')).toBe(true);
    expect(parseBooleanCell('1')).toBe(true);
    expect(parseBooleanCell('N')).toBe(false);
    expect(parseBooleanCell('FALSE')).toBe(false);
  });
  it('keeps not-recorded as null — never collapses to false', () => {
    expect(parseBooleanCell('')).toBeNull();
    expect(parseBooleanCell(null)).toBeNull();
    expect(parseBooleanCell('maybe')).toBeNull();
  });
});

describe('applyMapping (reliability fields)', () => {
  const HEADERS = ['Order', 'Equipment', 'Basic start date', 'Breakdown', 'Actual work', 'Malfunction start', 'Malfunction end'];
  const MAPPING: ImportMapping = {
    file_kind: 'work_orders', source_system_guess: 'sap_pm', confidence: 0.9,
    asset_fields: {},
    wo_fields: {
      wo_number: 'Order', asset_tag: 'Equipment', created_at: 'Basic start date',
      breakdown: 'Breakdown', labor_hours: 'Actual work',
      malfunction_start: 'Malfunction start', malfunction_end: 'Malfunction end',
    },
    value_maps: {}, date_format: 'DMY',
  };
  const applied = applyMapping(HEADERS, [
    ['4000020', 'P-101', '13/01/2025', 'X', '9', '13/01/2025', '15/01/2025'],
    ['4000021', 'P-101', '01/02/2025', '', '', '', ''],
    ['4000022', 'M-201', '20/02/2025', 'X', '4', '21/02/2025', '20/02/2025'],
  ], MAPPING);

  it('carries breakdown, labor hours and the malfunction window', () => {
    const wo = applied.workOrders.find((w) => w.wo_number === '4000020')!;
    expect(wo.breakdown).toBe(true);
    expect(wo.labor_hours).toBe(9);
    expect(wo.malfunction_start).toMatch(/^2025-01-13T/);
    expect(wo.malfunction_end).toMatch(/^2025-01-15T/);
  });
  it('keeps unrecorded breakdown as null', () => {
    expect(applied.workOrders.find((w) => w.wo_number === '4000021')!.breakdown).toBeNull();
  });
  it('drops an inverted malfunction window with an issue', () => {
    const wo = applied.workOrders.find((w) => w.wo_number === '4000022')!;
    expect(wo.malfunction_start).toBeNull();
    expect(wo.malfunction_end).toBeNull();
    expect(applied.issues.some((i) => i.kind === 'bad_malfunction_window')).toBe(true);
  });
  it('reports breakdown and labor-hours coverage', () => {
    const report = buildDqReport(applied);
    expect(report.coverage.breakdown_pct).toBe(67); // 2 of 3 recorded
    expect(report.coverage.labor_hours_pct).toBe(67);
  });
  it('warns when no breakdown indicator exists at all', () => {
    const bare = applyMapping(HEADERS, [['4000030', 'P-101', '13/01/2025', '', '', '', '']], MAPPING);
    expect(buildDqReport(bare).warnings.some((w) => w.includes('breakdown indicator'))).toBe(true);
  });
});
