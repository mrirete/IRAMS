import { describe, it, expect } from 'vitest';
import { suggestPointsForAsset, ratedPowerKw } from './limitLibrary';

const ctx = (parameters: Array<{ key: string; design?: number | string | null }>) => ({ parameters });

describe('suggestPointsForAsset (class-aware limits from the operating context)', () => {
  it('a 355 kW motor with FLA and class F insulation gets ISO 20816 Group 1 vibration, current and winding bands', () => {
    const pts = suggestPointsForAsset({ assetClass: 'ELECTRIC_MOTOR', operatingContext: ctx([
      { key: 'rated_power', design: 355 }, { key: 'current', design: 38 }, { key: 'insulation_class', design: 'F' },
    ]) });
    const vib = pts.find(p => p.name.startsWith('Bearing vibration'))!;
    expect(vib.bands.source).toBe('iso20816-large-rigid');
    expect(vib.bands.maxWarning).toBe(4.5); expect(vib.bands.maxCritical).toBe(7.1);
    expect(vib.bands.label).toContain('355 kW rated');
    const cur = pts.find(p => p.name === 'Stator current')!;
    expect(cur.bands.maxWarning).toBe(38); expect(cur.bands.maxCritical).toBe(41.8);
    const wdg = pts.find(p => p.name === 'Winding temperature')!;
    expect(wdg.bands.maxWarning).toBe(120); expect(wdg.bands.maxCritical).toBe(140);   // class F hotspot 155
    expect(wdg.derivedFrom).toBe('insulation_class = F');
    expect(pts.some(p => p.category === 'METER')).toBe(true);
  });
  it('a 75 kW pump with a design pressure gets Group 2 vibration and a discharge-pressure band', () => {
    const pts = suggestPointsForAsset({ assetClass: 'PUMP', operatingContext: ctx([{ key: 'rated_power', design: 75 }, { key: 'design_pressure', design: 25 }]) });
    expect(pts.find(p => p.name.startsWith('Bearing vibration'))!.bands.source).toBe('iso20816-medium-rigid');
    const dp = pts.find(p => p.name === 'Discharge pressure')!;
    expect(dp.bands.maxWarning).toBe(22.5); expect(dp.bands.maxCritical).toBe(25);
  });
  it('without a rated power it still proposes vibration, medium assumed, and says so', () => {
    const vib = suggestPointsForAsset({ assetClass: 'PUMP', operatingContext: null }).find(p => p.name.startsWith('Bearing vibration'))!;
    expect(vib.bands.source).toBe('iso20816-medium-rigid');
    expect(vib.bands.label).toContain('power unknown');
  });
  it('turbine MW and generator MVA both resolve to kW', () => {
    expect(ratedPowerKw(ctx([{ key: 'power', design: 24.5 }]))).toBe(24500);
    expect(ratedPowerKw(ctx([{ key: 'rating', design: 2.5 }]))).toBe(2500);
    expect(ratedPowerKw(null)).toBeNull();
  });
  it('static classes and unknown assets propose nothing rotating', () => {
    expect(suggestPointsForAsset({ assetClass: 'STORAGE_TANK' })).toEqual([]);
    expect(suggestPointsForAsset(null)).toEqual([]);
    expect(suggestPointsForAsset({ assetClass: 'TRANSFORMER', operatingContext: ctx([{ key: 'rating', design: 10 }]) }).map(p => p.name)).toEqual(['Top-oil temperature', 'Load', 'Running hours']);
  });
});
