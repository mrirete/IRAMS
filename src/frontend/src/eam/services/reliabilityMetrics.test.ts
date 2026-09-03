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

// ── SMRP 7th Edition mean metrics (G4.0, 3.5.1–3.5.4, G6.0) ──────────────────
import { computeAssetReliability } from './reliabilityMetrics';

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const fail = (daysAgo: number, downtime?: number, repair?: number) => ({
  type: 'CM', status: 'CLOSED', breakdown: true,
  malfunction_start: ago(daysAgo), closed_at: ago(daysAgo),
  actual_downtime_hrs: downtime ?? null, actual_duration_hrs: repair ?? null,
});
const pm = (daysAgo: number, downtime?: number, estDowntime?: number) => ({
  type: 'PM', status: 'CLOSED', breakdown: null, closed_at: ago(daysAgo),
  actual_downtime_hrs: downtime ?? null, est_downtime_hrs: estDowntime ?? null,
});

describe('computeAssetReliability — SMRP 7th Edition mean metrics', () => {
  it('MTBF (3.5.1) = operating time ÷ failures, not first-to-last span', () => {
    // Two failures 10 days apart inside a 365-day window. The old span basis
    // read 10 days; operating time ÷ failures reads (8760 − 24) / 2 hours.
    const r = computeAssetReliability([fail(40, 12), fail(30, 12)], { windowDays: 365 });
    expect(r.mtbfBasis).toBe('operating-window');
    expect(r.operatingHrs12mo).toBe(8760 - 24);
    expect(r.mtbfDays).toBeCloseTo((8760 - 24) / 2 / 24, 1);
  });

  it('MTBF needs only one failure in the window', () => {
    const r = computeAssetReliability([fail(30, 12)], { windowDays: 365 });
    expect(r.mtbfDays).toBeCloseTo((8760 - 12) / 24, 1);
  });

  it('falls back to lifetime inter-arrival MTBF when the window is quiet (imported history)', () => {
    const r = computeAssetReliability([fail(500, 5), fail(600, 5)], { windowDays: 365 });
    expect(r.failures12mo).toBe(0);
    expect(r.totalFailures).toBe(2);
    expect(r.mtbfBasis).toBe('lifetime-interarrival');
    expect(r.mtbfDays).toBe(100);
  });

  it('separates MDT (3.5.4, outage window) from MTTR (3.5.2, repair hours)', () => {
    const r = computeAssetReliability([fail(30, 20, 6), fail(60, 10, 4)]);
    expect(r.mdtHours).toBe(15);        // (20 + 10) / 2
    expect(r.mttrHours).toBe(5);        // (6 + 4) / 2
    expect(r.mttrBasis).toBe('repair');
  });

  it('uses the outage window as an MTTR proxy — and says so — when no repair hours exist', () => {
    const r = computeAssetReliability([fail(30, 20), fail(60, 10)]);
    expect(r.mdtHours).toBe(15);
    expect(r.mttrHours).toBe(15);
    expect(r.mttrBasis).toBe('downtime-proxy');
  });

  it('MTBM (3.5.3) counts failures plus function-interrupting PM/PdM actions', () => {
    // 2 failures + 1 PM with downtime; a PM with no downtime did not interrupt.
    const r = computeAssetReliability([fail(30, 10), fail(60, 10), pm(20, 8), pm(10)], { windowDays: 365 });
    expect(r.maintenanceActions12mo).toBe(3);
    expect(r.scheduledDowntimeHrs12mo).toBe(8);
    expect(r.unscheduledDowntimeHrs12mo).toBe(20);
    expect(r.operatingHrs12mo).toBe(8760 - 28);
    expect(r.mtbmDays).toBeCloseTo((8760 - 28) / 3 / 24, 1);
  });

  it('planned PM downtime (est_downtime_hrs) counts when actual was not recorded', () => {
    const r = computeAssetReliability([fail(30, 10), pm(20, undefined, 4)], { windowDays: 365 });
    expect(r.maintenanceActions12mo).toBe(2);
    expect(r.scheduledDowntimeHrs12mo).toBe(4);
  });

  it('Guideline 6.0: Ai = MTBF/(MTBF+MTTR), Ao = MTBM/(MTBM+MDT), availabilityPct aliases Ai', () => {
    const r = computeAssetReliability([fail(30, 24, 6), pm(20, 24)], { windowDays: 365 });
    const mtbfD = r.mtbfDays!, mtbmD = r.mtbmDays!;
    expect(r.aiPct).toBeCloseTo(Math.round((mtbfD / (mtbfD + 6 / 24)) * 1000) / 10, 1);
    expect(r.aoPct).toBeCloseTo(Math.round((mtbmD / (mtbmD + 24 / 24)) * 1000) / 10, 1);
    expect(r.availabilityPct).toBe(r.aiPct);
    expect(r.aoPct!).toBeLessThan(r.aiPct!);
  });

  it('stored asset values still win over derivation', () => {
    const r = computeAssetReliability([fail(30, 10)], { mtbfDays: 200, mttrHours: 3 });
    expect(r.mtbfDays).toBe(200);
    expect(r.mtbfBasis).toBe('stored');
    expect(r.mttrHours).toBe(3);
    expect(r.mttrBasis).toBe('stored');
  });

  it('reports downtime coverage over window failures', () => {
    const r = computeAssetReliability([fail(10, 5), fail(20), fail(30), fail(40)]);
    expect(r.downtimeCoveragePct).toBe(25);
  });

  it('MTTF (3.5.5) counts only failures closed as REPLACED — repairs stay with MTBF', () => {
    const replaced = (daysAgo: number, code: string) => ({ ...fail(daysAgo, 10), wo_failure_data: [{ remedy_code: code }] });
    const r = computeAssetReliability([
      replaced(20, 'RPL'),      // dictionary code
      replaced(60, 'REPLACED'), // free-spelled import
      replaced(90, 'REP'),      // repaired — not an item run to failure
      fail(120, 10),            // no remedy coded
    ], { windowDays: 365 });
    expect(r.failures12mo).toBe(4);
    expect(r.replacements12mo).toBe(2);
    expect(r.mttfDays).toBeCloseTo(r.operatingHrs12mo / 2 / 24, 1);
    expect(r.mtbfDays).toBeCloseTo(r.operatingHrs12mo / 4 / 24, 1);
  });

  it('MTTF is undefined, not zero, when nothing was replaced', () => {
    const r = computeAssetReliability([fail(20, 10), fail(40, 10)]);
    expect(r.replacements12mo).toBe(0);
    expect(r.mttfDays).toBeUndefined();
  });
});
