import { describe, it, expect } from 'vitest';
import {
  renderBreakdownForPrompt, breakdownCoverage, matchComponent, matchPart, componentLabel, isEmptyBreakdown,
  inferComponentLink, pinFailureMode,
  type AssetBreakdown,
} from './rcmBreakdown';

const B: AssetBreakdown = {
  components: [
    { id: 'c1', tag: 'GT-301-BRG1', name: 'Thrust bearing', level: 'COMPONENT', criticality: 'B', assetClass: 'GEARBOX', depth: 1 },
    { id: 'c2', tag: 'GT-301-LUBE', name: 'Lube oil system', level: 'SUBUNIT', depth: 1 },
    { id: 'c3', tag: 'GT-301-LUBE-P1', name: 'Main lube pump', level: 'COMPONENT', parentId: 'c2', depth: 2 },
  ],
  parts: [
    { id: 'p1', partNumber: 'FLT-0023', description: 'Air inlet filter 24x24x12', qty: 4, uom: 'EA', critical: true },
    { id: 'p2', partNumber: '', description: 'Synthetic turbine oil ISO VG 32', qty: 20, uom: 'LTR', critical: false, replacementIntervalDays: 180 },
  ],
};

describe('renderBreakdownForPrompt', () => {
  it('indents the tree, marks critical spares, and is empty for nothing', () => {
    const t = renderBreakdownForPrompt(B);
    expect(t).toContain('Registered components (3)');
    expect(t).toContain('- GT-301-BRG1 — Thrust bearing [GEARBOX] (crit B)');
    expect(t).toContain('  - GT-301-LUBE-P1 — Main lube pump');   // depth 2 indented
    expect(t).toContain('Bill of materials (2 lines)');
    expect(t).toContain('- FLT-0023 — Air inlet filter 24x24x12 × 4 EA [CRITICAL SPARE]');
    expect(t).toContain('(no part no.) — Synthetic turbine oil ISO VG 32 × 20 LTR (replace every 180 d)');
    expect(renderBreakdownForPrompt(null)).toBe('');
    expect(renderBreakdownForPrompt({ components: [], parts: [] })).toBe('');
    expect(isEmptyBreakdown({ components: [], parts: [] })).toBe(true);
  });
  it('caps the BOM', () => {
    const big = { components: [], parts: Array.from({ length: 80 }, (_, i) => ({ id: `p${i}`, partNumber: `PN-${i}`, description: `Part ${i}`, qty: 1, uom: 'EA', critical: false })) };
    const t = renderBreakdownForPrompt(big, { maxParts: 10 });
    expect(t).toContain('80 lines, first 10 shown');
    expect(t).not.toContain('PN-11 ');
  });
});

describe('breakdownCoverage', () => {
  it('counts modes per component, lists the uncovered, and the unpinned', () => {
    const cov = breakdownCoverage(B, [
      { component_asset_id: 'c1' }, { component_asset_id: 'c1' }, { bom_item_id: 'p1' }, {}, { component_asset_id: 'zzz' },
    ]);
    expect(cov.covered).toEqual([{ component: B.components[0], modeCount: 2 }]);
    expect(cov.uncovered.map(c => c.id)).toEqual(['c2', 'c3']);
    expect(cov.unpinned).toBe(1);
    expect(cov.pct).toBe(33);
    expect(cov.partsReferenced).toBe(1);
    expect(breakdownCoverage(null, [{}]).pct).toBe(0);
  });
});

describe('matching the Specialist answer back', () => {
  it('matches by tag, tag-in-text, then name — and parts by number then description', () => {
    expect(matchComponent('GT-301-BRG1', B)?.id).toBe('c1');
    expect(matchComponent('the thrust bearing', B)?.id).toBe('c1');
    expect(matchComponent('Lube oil system (GT-301-LUBE)', B)?.id).toBe('c2');
    expect(matchComponent('main lube pump', B)?.id).toBe('c3');
    expect(matchComponent('gearbox output shaft', B)).toBeNull();
    expect(matchComponent('', B)).toBeNull();
    expect(matchPart('FLT-0023', B)?.id).toBe('p1');
    expect(matchPart('replace synthetic turbine oil iso vg 32', B)?.id).toBe('p2');
    expect(matchPart('coupling', B)).toBeNull();
  });
  it('ignores the "(parent tag)" suffix the register puts on child names', () => {
    // K-601 walkthrough: "Dry Gas Seal (K-601)" never matched "Dry Gas Seal failure …"
    const K: AssetBreakdown = {
      components: [
        { id: 'dgs', tag: 'K-601-DGS', name: 'Dry Gas Seal (K-601)', level: 'COMPONENT', depth: 1 },
        { id: 'rad', tag: 'K-601-RADBRG', name: 'Radial Bearing (K-601)', level: 'COMPONENT', depth: 1 },
        { id: 'ax', tag: 'K-601-AXBRG', name: 'Thrust Bearing (K-601)', level: 'COMPONENT', depth: 1 },
      ],
      parts: [],
    };
    expect(inferComponentLink(['Dry Gas Seal failure leading to complete gas leakage', 'Seal face wear'], K).component_asset_id).toBe('dgs');
    expect(inferComponentLink(['Degraded thrust bearing performance leading to axial movement'], K).component_asset_id).toBe('ax');
    expect(inferComponentLink(['Radial bearing wear/damage leading to excessive vibration'], K).component_asset_id).toBe('rad');
    expect(inferComponentLink(['Rotor seizes due to bearing failure'], K).component_asset_id).toBeNull(); // which bearing? no guess
    expect(matchComponent('dry gas seal', K)?.id).toBe('dgs');
    expect(matchComponent('Thrust Bearing (K-601)', K)?.id).toBe('ax');
  });
  it('reads a collective or plural register name the way a failure mode says it', () => {
    // GT-301 walkthrough: "Combustion Liner Set" / "HP Turbine Blades" pinned none of 12 modes
    const G: AssetBreakdown = {
      components: [
        { id: 'comb', tag: 'GT-301-COMB', name: 'Combustion Liner Set (GT-301)', level: 'COMPONENT', depth: 1 },
        { id: 'hpt', tag: 'GT-301-HPT', name: 'HP Turbine Blades (GT-301)', level: 'COMPONENT', depth: 1 },
      ],
      parts: [],
    };
    expect(inferComponentLink(['Combustion liner cracking or distortion.'], G).component_asset_id).toBe('comb');
    expect(inferComponentLink(['HP Turbine blade creep.'], G).component_asset_id).toBe('hpt');
    expect(inferComponentLink(['HP turbine blades liberated'], G).component_asset_id).toBe('hpt');
    expect(inferComponentLink(['Lube oil pump cavitation'], G).component_asset_id).toBeNull();
  });
  it('labels a pinned mode', () => {
    expect(componentLabel({ component_asset_id: 'c2' }, B)).toBe('GT-301-LUBE — Lube oil system');
    expect(componentLabel({ bom_item_id: 'p2' }, B)).toBe('Synthetic turbine oil ISO VG 32');
    expect(componentLabel({ bom_item_id: 'p1' }, B)).toBe('FLT-0023 — Air inlet filter 24x24x12');
    expect(componentLabel({}, B)).toBe('');
  });
});

describe('inferring the pin from the failure mode text', () => {
  const G: AssetBreakdown = {
    components: [
      { id: 'v', tag: 'GT-1-FCV', name: 'Valve', level: 'COMPONENT', depth: 1 },
      { id: 'cv', tag: 'GT-1-CV', name: 'Control valve', level: 'COMPONENT', depth: 1 },
      { id: 'fcv', tag: 'GT-1-FCV1', name: 'Fuel control valve', level: 'COMPONENT', depth: 1 },
      { id: 'ign', tag: 'GT-1-IGN', name: 'Ignitor plug', level: 'COMPONENT', depth: 1 },
      { id: 'noz', tag: 'GT-1-NZ', name: 'Fuel nozzle', level: 'COMPONENT', depth: 1 },
    ],
    parts: [
      { id: 'p1', partNumber: 'FLT-0023', description: 'Air inlet filter', qty: 1, uom: 'EA', critical: false },
    ],
  };
  it('pins to the longest whole-word component mention', () => {
    expect(inferComponentLink(['Fuel Control Valve stuck closed'], G).component_asset_id).toBe('fcv');
    expect(inferComponentLink(['Control valve leaks past the seat'], G).component_asset_id).toBe('cv');
    expect(inferComponentLink(['Ignitor Plug failure'], G).component_asset_id).toBe('ign');
    expect(inferComponentLink(['Fuel Nozzle / Atomizer clogged'], G).component_asset_id).toBe('noz');
    expect(inferComponentLink(['', 'wear on the GT-1-IGN electrode'], G).component_asset_id).toBe('ign');
  });
  it('does not match inside longer words, short names, or empty breakdowns', () => {
    expect(inferComponentLink(['Valves galore'], G).component_asset_id).toBeNull();
    expect(inferComponentLink(['Shaft seal leaking'], G)).toEqual({ component_asset_id: null, bom_item_id: null });
    expect(inferComponentLink(['Fuel control valve stuck'], { components: [], parts: [] })).toEqual({ component_asset_id: null, bom_item_id: null });
    expect(inferComponentLink([null, undefined], G)).toEqual({ component_asset_id: null, bom_item_id: null });
  });
  it('falls back to a BOM line, and components win over parts', () => {
    expect(inferComponentLink(['Air inlet filter blocked'], G).bom_item_id).toBe('p1');
    expect(inferComponentLink(['FLT-0023 torn'], G).bom_item_id).toBe('p1');
    expect(inferComponentLink(['Fuel nozzle blocked by air inlet filter debris'], G)).toEqual({ component_asset_id: 'noz', bom_item_id: null });
  });
  it('pinFailureMode keeps an explicit pin and only fills an empty one, recording where the pin came from', () => {
    const explicit = pinFailureMode({ failure_mode_description: 'Ignitor plug failure', component_asset_id: 'v' }, G);
    expect(explicit.component_asset_id).toBe('v');
    expect(explicit.component_link_source).toBe('specialist');
    expect(pinFailureMode({ failure_mode_description: 'x', bom_item_id: 'p1' }, G, 'import').component_link_source).toBe('import');
    expect(pinFailureMode({ failure_mode_description: 'x', bom_item_id: 'p1', component_link_source: 'manual' }, G).component_link_source).toBe('manual');
    const inferred = pinFailureMode({ failure_mode_description: 'Ignitor plug failure' }, G);
    expect(inferred.component_asset_id).toBe('ign');
    expect(inferred.component_link_source).toBe('text');
    const untouched = { failure_mode_description: 'Shaft seal leaking' };
    expect(pinFailureMode(untouched, G)).toBe(untouched);
  });
});
