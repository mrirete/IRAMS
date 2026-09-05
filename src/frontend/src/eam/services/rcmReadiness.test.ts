import { describe, it, expect } from 'vitest';
import { assessStudyData } from './rcmReadiness';
import type { RCMStudy, RCMFailureMode } from './RCMService';

const study = { id: 's1', title: 'GT-301 driver', asset_id: '56a0bd92-9d57-58bc-8764-23c11d1f23e6', operating_context: 'x'.repeat(50) } as RCMStudy;
const fm = (over: Partial<RCMFailureMode>): RCMFailureMode => ({ id: Math.random().toString(36).slice(2), function_id: 'f1', failure_mode_description: 'Seal leak', ...over } as RCMFailureMode);
const breakdown = {
  components: [
    { id: 'c1', tag: 'GT-301-LUBE', name: 'Lube', level: 'SUBUNIT', depth: 1 },
    { id: 'c2', tag: 'GT-301-BRG1', name: 'Bearing', level: 'COMPONENT', depth: 2 },
  ],
  parts: [],
};

describe('assessStudyData — component coverage (0318)', () => {
  it('adds no coverage item when the register has no components', () => {
    const r = assessStudyData(study, [], [fm({})], { components: [], parts: [] });
    expect(r.items.find(i => i.id === 'coverage')).toBeUndefined();
    expect(assessStudyData(study, [], [fm({})]).items.find(i => i.id === 'coverage')).toBeUndefined();
  });
  it('is a recommended item — unmet while a component has no mode, met when all do, never a blocker', () => {
    const partial = assessStudyData(study, [], [fm({ component_asset_id: 'c1' })], breakdown);
    const item = partial.items.find(i => i.id === 'coverage')!;
    expect(item.met).toBe(false);
    expect(item.severity).toBe('recommended');
    expect(item.label).toBe('Components covered · 1/2');
    expect(item.hint).toContain('GT-301-BRG1');
    expect(partial.blockers.some(b => b.id === 'coverage')).toBe(false);
    expect(partial.requiredMet).toBe(true);

    const full = assessStudyData(study, [], [fm({ component_asset_id: 'c1' }), fm({ component_asset_id: 'c2' })], breakdown);
    expect(full.items.find(i => i.id === 'coverage')!.met).toBe(true);
    expect(full.score).toBeGreaterThan(partial.score);
  });
});
