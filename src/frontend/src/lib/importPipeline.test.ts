import { describe, it, expect } from 'vitest';
import {
  applyMapping, buildDqReport, parseDateCell, parseCostCell,
  guessWoType, guessWoStatus, parseMappingProposal,
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
