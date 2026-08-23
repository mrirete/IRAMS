import { describe, it, expect } from 'vitest';
import { isFailure, isSecondaryFailure } from './reliabilityMetrics';

// The canonical failure predicate — precedence contract (0295 KPI pass).
// sem_asset_reliability mirrors these rules in SQL; change them together.
describe('isFailure precedence', () => {
  it('recorded breakdown=true wins over any type — even preventive', () => {
    expect(isFailure({ type: 'PM', breakdown: true })).toBe(true);
    expect(isFailure({ type: 'INSPECTION', breakdown: true })).toBe(true);
    expect(isFailure({ type: 'CM', breakdown: true })).toBe(true);
  });
  it('recorded breakdown=false wins over any type — even corrective with a coded mode', () => {
    expect(isFailure({ type: 'CM', breakdown: false })).toBe(false);
    expect(isFailure({ type: 'EM', breakdown: false, wo_failure_data: [{ failure_mode_code: 'LEAK' }] })).toBe(false);
  });
  it('unrecorded breakdown falls back to the type heuristic', () => {
    expect(isFailure({ type: 'CM' })).toBe(true);
    expect(isFailure({ type: 'EM', breakdown: null })).toBe(true);
    expect(isFailure({ type: 'PM' })).toBe(false);
    expect(isFailure({ type: 'PDM', breakdown: undefined })).toBe(false);
  });
  it('unrecorded breakdown + coded failure mode counts (heuristic branch)', () => {
    expect(isFailure({ type: 'OTHER', wo_failure_data: [{ failure_mode_code: 'VIB' }] })).toBe(true);
    expect(isFailure({ type: 'OTHER' })).toBe(false);
  });
});

describe('isSecondaryFailure', () => {
  it('reads the 0289 collateral flag in both shapes', () => {
    expect(isSecondaryFailure({ wo_failure_data: [{ secondary_failure: true }] })).toBe(true);
    expect(isSecondaryFailure({ wo_failure_data: { secondaryFailure: true } })).toBe(true);
    expect(isSecondaryFailure({ wo_failure_data: [{ secondary_failure: false }] })).toBe(false);
    expect(isSecondaryFailure({})).toBe(false);
  });
});
