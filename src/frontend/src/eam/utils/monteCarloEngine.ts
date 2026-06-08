/**
 * Monte Carlo Simulation Engine
 * Weibull TTF + Lognormal TTR + optional PM strategy
 * ISO 14224 / OREDA compliant
 */

// ─── Types ───────────────────────────────────────────────────
export interface MCInputs {
  beta: number;        // Weibull shape
  eta: number;         // Weibull scale (hours)
  muR: number;         // Lognormal repair mean (log-space)
  sigmaR: number;      // Lognormal repair std (log-space)
  missionTime: number; // hours (default 8760 = 1 year)
  numRuns: number;     // simulation count
  costPerFailure: number;
  pmCost: number;
  pmInterval: number;  // 0 = disabled (RTF only)
  pmDuration: number;  // hours per PM event
}

export interface MCRunResult {
  failures: number;
  downtime: number;
  availability: number;
  totalCost: number;
}

export interface MCOutput {
  rtfRuns: MCRunResult[];
  pmRuns: MCRunResult[];
  rtfPercentiles: MCPercentiles;
  pmPercentiles: MCPercentiles | null;
  survivalCurve: { t: number; simulated: number; theoretical: number }[];
  convergence: { run: number; aoAvg: number; aoUpper: number; aoLower: number }[];
  histogramAo: { bin: string; rtf: number; pm: number }[];
  histogramCost: { bin: string; rtf: number; pm: number }[];
  converged: boolean;
  elapsedMs: number;
}

export interface MCPercentiles {
  ao: { p10: number; p25: number; p50: number; p75: number; p90: number };
  failures: { p10: number; p25: number; p50: number; p75: number; p90: number };
  cost: { p10: number; p25: number; p50: number; p75: number; p90: number };
  downtime: { p10: number; p25: number; p50: number; p75: number; p90: number };
  mtbfSim: number;
}

// ─── Random generators ──────────────────────────────────────
function weibullRandom(beta: number, eta: number): number {
  return eta * Math.pow(-Math.log(Math.random()), 1 / beta);
}

function boxMullerNormal(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function lognormalRandom(mu: number, sigma: number): number {
  return Math.exp(mu + sigma * boxMullerNormal());
}

// ─── Single run simulation ──────────────────────────────────
function simulateRun(inputs: MCInputs, usePM: boolean): MCRunResult {
  const { beta, eta, muR, sigmaR, missionTime, costPerFailure, pmCost, pmInterval, pmDuration } = inputs;
  let t = 0, failures = 0, downtime = 0, cost = 0;
  let nextPM = usePM && pmInterval > 0 ? pmInterval : Infinity;

  while (t < missionTime) {
    const ttf = weibullRandom(beta, eta);
    const failureTime = t + ttf;

    if (usePM && failureTime > nextPM && nextPM <= missionTime) {
      // PM event occurs before failure
      cost += pmCost;
      t = nextPM + pmDuration;
      downtime += pmDuration;
      nextPM += pmInterval;
    } else if (failureTime <= missionTime) {
      // Corrective failure
      const ttr = Math.max(0.5, lognormalRandom(muR, sigmaR));
      failures++;
      downtime += ttr;
      cost += costPerFailure;
      t = failureTime + ttr;
      // Reset PM clock after repair
      if (usePM && pmInterval > 0) nextPM = t + pmInterval;
    } else {
      break; // survived to end
    }
  }

  const availability = Math.max(0, (missionTime - downtime) / missionTime) * 100;
  return { failures, downtime: Math.round(downtime * 10) / 10, availability: Math.round(availability * 100) / 100, totalCost: Math.round(cost) };
}

// ─── Percentile helper ──────────────────────────────────────
function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function calcPercentiles(runs: MCRunResult[]): MCPercentiles {
  const aos = runs.map(r => r.availability);
  const fails = runs.map(r => r.failures);
  const costs = runs.map(r => r.totalCost);
  const downs = runs.map(r => r.downtime);
  const totalFailures = fails.reduce((s, v) => s + v, 0);
  const totalDown = downs.reduce((s, v) => s + v, 0);
  const totalUp = runs.length * (runs[0] ? 8760 : 0) - totalDown;
  const mtbfSim = totalFailures > 0 ? Math.round(totalUp / totalFailures) : Infinity;

  const pct = (arr: number[]) => ({
    p10: Math.round(percentile(arr, 10) * 100) / 100,
    p25: Math.round(percentile(arr, 25) * 100) / 100,
    p50: Math.round(percentile(arr, 50) * 100) / 100,
    p75: Math.round(percentile(arr, 75) * 100) / 100,
    p90: Math.round(percentile(arr, 90) * 100) / 100,
  });

  return { ao: pct(aos), failures: pct(fails), cost: pct(costs), downtime: pct(downs), mtbfSim };
}

// ─── Histogram binning ──────────────────────────────────────
function buildHistogram(rtfVals: number[], pmVals: number[], binCount = 20): { bin: string; rtf: number; pm: number }[] {
  const all = [...rtfVals, ...pmVals];
  if (all.length === 0) return [];
  const min = Math.min(...all), max = Math.max(...all);
  const range = max - min || 1;
  const binWidth = range / binCount;

  const bins = Array.from({ length: binCount }, (_, i) => ({
    bin: `${(min + i * binWidth).toFixed(1)}`,
    rtf: 0, pm: 0,
  }));

  for (const v of rtfVals) {
    const idx = Math.min(binCount - 1, Math.floor((v - min) / binWidth));
    bins[idx].rtf++;
  }
  for (const v of pmVals) {
    const idx = Math.min(binCount - 1, Math.floor((v - min) / binWidth));
    bins[idx].pm++;
  }
  return bins;
}

// ─── Main simulation ────────────────────────────────────────
export function runMonteCarloSimulation(inputs: MCInputs): MCOutput {
  const start = performance.now();
  const { beta, eta, numRuns, missionTime, pmInterval } = inputs;
  const hasPM = pmInterval > 0;

  const rtfRuns: MCRunResult[] = [];
  const pmRuns: MCRunResult[] = [];
  const convergencePoints: MCOutput['convergence'] = [];

  let aoSum = 0, aoSumSq = 0;

  for (let i = 0; i < numRuns; i++) {
    const rtf = simulateRun(inputs, false);
    rtfRuns.push(rtf);

    if (hasPM) pmRuns.push(simulateRun(inputs, true));

    // Convergence tracking (every 200 runs)
    aoSum += rtf.availability;
    aoSumSq += rtf.availability ** 2;
    if ((i + 1) % 200 === 0 || i === numRuns - 1) {
      const n = i + 1;
      const avg = aoSum / n;
      const variance = (aoSumSq / n) - (avg ** 2);
      const std = Math.sqrt(Math.max(0, variance));
      convergencePoints.push({
        run: n,
        aoAvg: Math.round(avg * 100) / 100,
        aoUpper: Math.round((avg + std) * 100) / 100,
        aoLower: Math.round((avg - std) * 100) / 100,
      });
    }
  }

  // Convergence check: CV < 2%
  const finalAvg = aoSum / numRuns;
  const finalVar = (aoSumSq / numRuns) - (finalAvg ** 2);
  const cv = finalAvg > 0 ? Math.sqrt(Math.max(0, finalVar)) / finalAvg : 1;
  const converged = cv < 0.02;

  // Survival curve from theoretical Weibull
  const survivalCurve: MCOutput['survivalCurve'] = [];
  const maxT = eta * 2.5;
  const step = maxT / 50;
  // Pool all simulated TTFs for empirical survival (approximate from failure counts)
  for (let t = 0; t <= maxT; t += step) {
    const theoretical = Math.exp(-Math.pow(t / eta, beta)) * 100;
    // Approximate empirical: fraction of runs where avg TTF > t
    const empirical = (rtfRuns.filter(r => {
      const avgTTF = r.failures > 0 ? missionTime / r.failures : missionTime;
      return avgTTF > t;
    }).length / rtfRuns.length) * 100;
    survivalCurve.push({
      t: Math.round(t),
      simulated: Math.round(empirical * 10) / 10,
      theoretical: Math.round(theoretical * 10) / 10,
    });
  }

  const rtfPercentiles = calcPercentiles(rtfRuns);
  const pmPercentiles = hasPM ? calcPercentiles(pmRuns) : null;

  const histogramAo = buildHistogram(
    rtfRuns.map(r => r.availability),
    pmRuns.map(r => r.availability)
  );
  const histogramCost = buildHistogram(
    rtfRuns.map(r => r.totalCost),
    pmRuns.map(r => r.totalCost)
  );

  return {
    rtfRuns, pmRuns,
    rtfPercentiles, pmPercentiles,
    survivalCurve, convergence: convergencePoints,
    histogramAo, histogramCost,
    converged,
    elapsedMs: Math.round(performance.now() - start),
  };
}

// ─── Weibull MRR fit for auto-populate ──────────────────────
export function fitWeibullFromTTFs(times: number[]): { beta: number; eta: number; r2: number } | null {
  const n = times.length;
  if (n < 2) return null;
  const sorted = [...times].sort((a, b) => a - b);
  const ranks = sorted.map((t, i) => {
    const F = (i + 1 - 0.3) / (n + 0.4);
    return { x: Math.log(t), y: Math.log(Math.log(1 / (1 - F))) };
  });
  const xMean = ranks.reduce((s, r) => s + r.x, 0) / n;
  const yMean = ranks.reduce((s, r) => s + r.y, 0) / n;
  const sxy = ranks.reduce((s, r) => s + (r.x - xMean) * (r.y - yMean), 0);
  const sxx = ranks.reduce((s, r) => s + (r.x - xMean) ** 2, 0);
  if (sxx === 0) return null;
  const beta = Math.round((sxy / sxx) * 100) / 100;
  const eta = Math.round(Math.exp(-((yMean - beta * xMean) / beta)));
  const ssRes = ranks.reduce((s, r) => s + (r.y - (beta * r.x + (yMean - beta * xMean))) ** 2, 0);
  const ssTot = ranks.reduce((s, r) => s + (r.y - yMean) ** 2, 0);
  const r2 = Math.round((1 - ssRes / ssTot) * 1000) / 1000;
  return { beta: Math.max(0.1, beta), eta: Math.max(1, eta), r2 };
}

// ─── Lognormal fit for repair times ─────────────────────────
export function fitLognormalFromRepairs(repairs: number[]): { mu: number; sigma: number; mttr: number } | null {
  if (repairs.length < 2) return null;
  const logs = repairs.filter(r => r > 0).map(r => Math.log(r));
  if (logs.length < 2) return null;
  const mu = Math.round((logs.reduce((s, v) => s + v, 0) / logs.length) * 100) / 100;
  const sigma = Math.round(Math.sqrt(logs.reduce((s, v) => s + (v - mu) ** 2, 0) / logs.length) * 100) / 100;
  const mttr = Math.round(Math.exp(mu + (sigma ** 2) / 2) * 10) / 10;
  return { mu, sigma: Math.max(0.1, sigma), mttr };
}

// ─── CSV parser ─────────────────────────────────────────────
export function parseCSVData(text: string): { ttfs: number[]; repairs: number[]; costs: number[] } {
  const lines = text.trim().split(/\r?\n/);
  const ttfs: number[] = [], repairs: number[] = [], costs: number[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const cols = lines[i].split(/[,\t;]+/).map(s => s.trim());
    // Skip header row
    if (i === 0 && isNaN(Number(cols[0]))) continue;
    if (cols[0] && !isNaN(Number(cols[0])) && Number(cols[0]) > 0) ttfs.push(Number(cols[0]));
    if (cols[1] && !isNaN(Number(cols[1])) && Number(cols[1]) > 0) repairs.push(Number(cols[1]));
    if (cols[2] && !isNaN(Number(cols[2])) && Number(cols[2]) > 0) costs.push(Number(cols[2]));
  }
  return { ttfs, repairs, costs };
}

export function generateCSVTemplate(): string {
  return `failure_time_hours,repair_time_hours,cost_usd\n720,8.5,15000\n1440,12.2,18500\n2100,6.8,12000\n3200,14.5,22000\n4800,9.1,16500`;
}
