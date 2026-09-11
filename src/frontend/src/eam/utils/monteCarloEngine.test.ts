import { describe, it, expect } from 'vitest';
import { runMonteCarloSimulation, fitWeibullFromTTFs } from './monteCarloEngine';

const gamma15 = 0.886226925; // Γ(1.5) — mean of Weibull(β=2, η=1) is η·Γ(1+1/β)
const base = { beta: 2, eta: 1000, muR: 2.3, sigmaR: 0.6, numRuns: 3000, costPerFailure: 1000, pmCost: 100, pmInterval: 0, pmDuration: 8 };

describe('monteCarloEngine (audit M-11)', () => {
  it('simulated MTBF follows the mission time, not a hard-coded year', () => {
    const one = runMonteCarloSimulation({ ...base, missionTime: 8760 });
    const two = runMonteCarloSimulation({ ...base, missionTime: 17520 });
    const theoretical = 1000 * gamma15;
    // Both within ~15 % of the theoretical mean TTF (renewal + repair time keep it a little above)
    expect(Math.abs(one.rtfPercentiles.mtbfSim - theoretical) / theoretical).toBeLessThan(0.15);
    expect(Math.abs(two.rtfPercentiles.mtbfSim - theoretical) / theoretical).toBeLessThan(0.15);
  });
  it('the simulated survival curve tracks the theoretical Weibull', () => {
    const out = runMonteCarloSimulation({ ...base, missionTime: 8760 });
    for (const p of out.survivalCurve.filter(p => p.t > 0 && p.theoretical > 5 && p.theoretical < 95)) {
      expect(Math.abs(p.simulated - p.theoretical)).toBeLessThan(4); // percentage points, 3000 runs
    }
  });
  it('convergence is not trivially true: 50 runs are not converged, 5000 are', () => {
    const few = runMonteCarloSimulation({ ...base, numRuns: 50, missionTime: 8760 });
    const many = runMonteCarloSimulation({ ...base, numRuns: 5000, missionTime: 8760 });
    expect(few.converged).toBe(false);
    expect(many.converged).toBe(true);
  });
  it('the TTF fitter carries suspensions through (Weibull tab parity, audit M-10)', () => {
    const f = fitWeibullFromTTFs([478, 835, 1453, 1723, 1106, 549, 674, 935, 1047], [5599])!;
    const naive = fitWeibullFromTTFs([478, 835, 1453, 1723, 1106, 549, 674, 935, 1047])!;
    expect(f.nSuspensions).toBe(1);
    expect(f.eta).toBeGreaterThan(naive.eta);
  });
});
