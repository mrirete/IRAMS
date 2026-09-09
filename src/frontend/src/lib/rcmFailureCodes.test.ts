import { describe, it, expect } from 'vitest';
import { matchFailureCode, renderFailureCodesForPrompt, acceptFailureCode } from './rcmFailureCodes';

// the live ROTATING set (reference_codes, category FAILURE_MODE)
const ROTATING = [
  { code: 'BAL', description: 'Imbalance / Out of Balance', category_ref: 'ROTATING' },
  { code: 'BRG', description: 'Bearing Failure', category_ref: 'ROTATING' },
  { code: 'COU', description: 'Coupling Failure', category_ref: 'ROTATING' },
  { code: 'CVT', description: 'Cavitation', category_ref: 'ROTATING' },
  { code: 'FTS', description: 'Fail to Start', category_ref: 'ROTATING' },
  { code: 'IMP', description: 'Impeller / Rotor Damage', category_ref: 'ROTATING' },
  { code: 'LUB', description: 'Lubrication Failure / Oil Contamination', category_ref: 'ROTATING' },
  { code: 'MIS', description: 'Misalignment / Shaft Deflection', category_ref: 'ROTATING' },
  { code: 'SEL', description: 'Seal Failure / Seal Leakage', category_ref: 'ROTATING' },
  { code: 'SRG', description: 'Surge (Compressor)', category_ref: 'ROTATING' },
  { code: 'STP', description: 'Fail to Stop / Overspeed', category_ref: 'ROTATING' },
  { code: 'VIB', description: 'Excessive Vibration / Dynamic Loading', category_ref: null },
  { code: 'BRD', description: 'Breakdown (Complete Loss of Function)', category_ref: null },
  { code: 'LCK', description: 'Leak at Connection / Flange', category_ref: null },
];

describe('matchFailureCode', () => {
  it('codes the K-601 and GT-301 drafted modes the way a coder would', () => {
    expect(matchFailureCode('Dry Gas Seal failure leading to complete gas leakage and loss of compression.', ROTATING)).toBe('SEL');
    expect(matchFailureCode('Radial bearing wear/damage leading to excessive rotor vibration.', ROTATING)).toBe('BRG');
    expect(matchFailureCode('Rotor seizes due to bearing failure.', ROTATING)).toBe('BRG');
    expect(matchFailureCode('Thrust bearing wear/damage leading to excessive axial vibration or rub.', ROTATING)).toBe('BRG');
    expect(matchFailureCode('Compressor surge trip', ROTATING)).toBe('SRG');
    expect(matchFailureCode('HP Turbine blade loss or damage causing rotor imbalance.', ROTATING)).toMatch(/^(IMP|BAL)$/);
    expect(matchFailureCode('Lube oil contamination with water', ROTATING)).toBe('LUB');
    expect(matchFailureCode('Fails to start on demand', ROTATING)).toBe('FTS');
  });
  it('prefers no code to a wrong one', () => {
    expect(matchFailureCode('Combustion liner hot spots or burn-through', ROTATING)).toBeNull();
    expect(matchFailureCode('', ROTATING)).toBeNull();
    expect(matchFailureCode('Seal failure', [])).toBeNull();
  });
  it('renders the offer and accepts only offered codes', () => {
    const p = renderFailureCodesForPrompt(ROTATING);
    expect(p).toContain('- SEL: Seal Failure / Seal Leakage');
    expect(p.indexOf('- BRG')).toBeLessThan(p.indexOf('- VIB')); // scoped before generic
    expect(acceptFailureCode('sel', ROTATING)).toBe('SEL');
    expect(acceptFailureCode('XYZ', ROTATING)).toBeNull();
    expect(acceptFailureCode(null, ROTATING)).toBeNull();
    expect(renderFailureCodesForPrompt([])).toBe('');
  });
});
