import { describe, it, expect } from 'vitest';
import {
  normalizeContext, mergeTemplate, utilisationOf, deviationFlag, contextCompleteness,
  composeOperatingContext, takeSnapshot, contextChangedSince, type AssetOperatingContext,
} from './operatingContext';
import { parameterTemplateFor, CLASS_PARAMETERS } from './iso14224Parameters';
import { CLASSES, isOtherCode } from './iso14224Taxonomy';

const PUMP = { tag: 'P-101A', name: 'Crude charge pump', description: 'Charges the crude unit from the desalter', criticality: 'A', assetCategory: 'ROTATING', assetClass: 'PUMP', assetType: 'PUMP_CENTRIFUGAL', manufacturer: 'Sulzer', model: 'MSD 6x8' };

describe('parameter templates', () => {
  it('every ISO class has a template with at least one design+operating row', () => {
    for (const c of CLASSES.filter(c => !isOtherCode(c.code))) {
      const t = CLASS_PARAMETERS[c.code];
      expect(t, c.code).toBeDefined();
      expect(t.some(p => p.kind === 'both'), c.code).toBe(true);
      expect(new Set(t.map(p => p.key)).size, `${c.code} duplicate keys`).toBe(t.length);
    }
  });
  it('falls back class → category → generic', () => {
    expect(parameterTemplateFor('PUMP', 'ROTATING').map(p => p.key)).toContain('npsh');
    expect(parameterTemplateFor('ROTATING_OTHER', 'ROTATING').map(p => p.key)).toContain('rated_power');
    expect(parameterTemplateFor(null, null).length).toBeGreaterThan(0);
  });
});

describe('mergeTemplate', () => {
  it('adds template rows, keeps values, drops empty rows of a previous class, keeps valued ones as custom', () => {
    const start = normalizeContext({ parameters: [
      { key: 'flow', label: 'old', unit: 'x', design: 500, operating: 380 },
      { key: 'voltage', label: 'Rated voltage', unit: 'V', design: 415 },   // from a motor template
      { key: 'ip_rating', label: 'IP', unit: '', design: null },            // empty leftover
    ] });
    const merged = mergeTemplate(start, 'PUMP', 'ROTATING');
    const flow = merged.parameters!.find(p => p.key === 'flow')!;
    expect(flow.design).toBe(500);
    expect(flow.label).toBe('Flow rate');           // relabelled from the template
    expect(flow.unit).toBe('m³/h');
    expect(merged.parameters!.find(p => p.key === 'voltage')?.custom).toBe(true);
    expect(merged.parameters!.find(p => p.key === 'ip_rating')).toBeUndefined();
    expect(merged.parameters!.map(p => p.key)).toContain('npsh');
    // template rows first, custom last
    expect(merged.parameters![merged.parameters!.length - 1].key).toBe('voltage');
  });
});

describe('utilisation & deviation', () => {
  it('flags operating above design and far below', () => {
    expect(utilisationOf({ key: 'f', label: '', unit: '', design: 500, operating: 380 })).toBe(76);
    expect(deviationFlag({ key: 'f', label: '', unit: '', design: 100, operating: 105 })).toBe('above_design');
    expect(deviationFlag({ key: 'f', label: '', unit: '', design: 100, operating: 40 })).toBe('far_below_design');
    expect(deviationFlag({ key: 'f', label: '', unit: '', design: 100, operating: 80 })).toBeNull();
    expect(utilisationOf({ key: 'f', label: '', unit: '', design: 0, operating: 5 })).toBeNull();
    expect(utilisationOf({ key: 'f', label: '', unit: '', design: 'CS', operating: null })).toBeNull();
  });
});

describe('contextCompleteness', () => {
  it('needs mode, a setting (medium or environment), and one design+operating pair', () => {
    expect(contextCompleteness(null).complete).toBe(false);
    expect(contextCompleteness(null).missing).toEqual([
      'Operating mode', 'Service medium or environment', 'At least one parameter with design and operating values',
    ]);
    const ok: AssetOperatingContext = {
      mode: 'continuous', service_medium: 'Crude oil',
      parameters: [{ key: 'flow', label: 'Flow', unit: 'm³/h', design: 500, operating: 380 }],
    };
    const r = contextCompleteness(ok);
    expect(r.complete).toBe(true);
    expect(r.filledParameters).toBe(1);
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(100);   // redundancy/utilisation not given
  });
  it('environment alone satisfies the setting requirement', () => {
    const r = contextCompleteness({ mode: 'standby', environment: ['Offshore'], parameters: [{ key: 'flow', label: 'Flow', unit: '', design: 10, operating: 8 }] });
    expect(r.complete).toBe(true);
  });
  it('a design-only row does not satisfy the pair requirement', () => {
    const r = contextCompleteness({ mode: 'standby', service_medium: 'Fire water', parameters: [{ key: 'design_pressure', label: '', unit: 'barg', kind: 'design', design: 16 }] });
    expect(r.complete).toBe(false);
    expect(r.missing).toEqual(['At least one parameter with design and operating values']);
  });
});

describe('composeOperatingContext', () => {
  it('is deterministic and reads like a JA1011 context', () => {
    const ctx: AssetOperatingContext = {
      mode: 'continuous', utilisation_pct: 95, hours_per_year: 8300, redundancy: '2x100',
      environment: ['Outdoor', 'Sour service (H₂S)'], service_medium: 'Crude oil, 32 °API',
      parameters: [
        { key: 'flow', label: 'Flow rate', unit: 'm³/h', design: 500, operating: 380 },
        { key: 'design_pressure', label: 'Design pressure', unit: 'barg', kind: 'design', design: 40 },
        { key: 'fluid', label: 'Fluid', unit: '', kind: 'design', text: true, design: 'Crude' },
        { key: 'speed', label: 'Speed', unit: 'rpm', design: 2980, operating: 3100 },
        { key: 'head', label: 'Head', unit: 'm', design: null, operating: null },
      ],
    };
    const text = composeOperatingContext(PUMP, ctx);
    expect(text).toContain('P-101A — Crude charge pump (Rotating equipment › Pump › Centrifugal), criticality A.');
    expect(text).toContain('Make/model: Sulzer MSD 6x8.');
    expect(text).toContain('Charges the crude unit from the desalter.');
    expect(text).toContain('Operation: Continuous duty, ~95% utilisation, 8,300 h/year, redundancy 2 × 100 % (duty / standby).');
    expect(text).toContain('Service medium: Crude oil, 32 °API.');
    expect(text).toContain('- Flow rate: design 500 m³/h, operating 380 m³/h (76% of design)');
    expect(text).toContain('- Speed: design 2,980 rpm, operating 3,100 rpm (104% of design — ABOVE DESIGN)');
    expect(text).toContain('- Design pressure: 40 barg');
    expect(text).toContain('- Fluid: Crude');
    expect(text).not.toContain('Head');
    expect(composeOperatingContext(PUMP, ctx)).toBe(text);
    expect(text.length).toBeGreaterThanOrEqual(40);
  });
  it('an empty context still names the asset', () => {
    expect(composeOperatingContext({ tag: 'X-1', name: 'Thing' }, null)).toBe('X-1 — Thing.');
  });
  it('takes the duty narrative from the register description, and never repeats the name', () => {
    expect(composeOperatingContext({ tag: 'X-1', name: 'Thing', description: 'Feeds the dryer' }, null))
      .toBe('X-1 — Thing.\nFeeds the dryer.');
    expect(composeOperatingContext({ tag: 'X-1', name: 'Thing', description: 'Thing' }, null)).toBe('X-1 — Thing.');
  });
});

describe('snapshot', () => {
  it('detects later edits to the asset context', () => {
    const snap = takeSnapshot(PUMP, { updated_at: '2026-09-01T00:00:00Z', parameters: [] }, new Date('2026-09-02T00:00:00Z'));
    expect(snap.classification.cls).toBe('PUMP');
    expect(contextChangedSince(snap, { updated_at: '2026-09-01T00:00:00Z' })).toBe(false);
    expect(contextChangedSince(snap, { updated_at: '2026-09-05T00:00:00Z' })).toBe(true);
    expect(contextChangedSince(snap, {})).toBe(false);
    expect(contextChangedSince(null, { updated_at: '2026-09-05T00:00:00Z' })).toBe(false);
    const unsnapped = takeSnapshot(PUMP, null);
    expect(contextChangedSince(unsnapped, { updated_at: '2026-09-05T00:00:00Z' })).toBe(true);
  });
});
