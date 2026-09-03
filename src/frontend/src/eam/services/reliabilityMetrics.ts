// ─────────────────────────────────────────────────────────────────────────────
// Reliability Metrics spine (SMRP-aligned) — single source of truth for the
// reliability KPIs that both people and the AI agents read, so decisions are
// grounded in the same, defensible numbers.
//
// This first slice computes ASSET-level equipment-reliability metrics from work
// order + failure history (ISO 14224 failure modes). Modelling and Analyze should
// draw from here rather than recomputing MTBF/MTTR independently.
// ─────────────────────────────────────────────────────────────────────────────

import { isPreventiveWork } from './workReadiness';
import { computePmCompliance as computeCanonicalPmCompliance } from '../../lib/reliabilityKpis';

/**
 * The mean metrics follow SMRP Best Practices, 7th Edition (Guideline 4.0 and
 * metrics 3.5.1–3.5.4, Guideline 6.0 for the two availabilities):
 *
 *   MTBF (3.5.1) = operating time ÷ failures. Operating time is the analysis
 *                  window in calendar hours less recorded downtime — the
 *                  calendar-hour approximation every surface states.
 *   MDT  (3.5.4) = total downtime ÷ downtime events: failure to back-in-service,
 *                  delays included. Basis: actual_downtime_hrs (the malfunction
 *                  window, 0283).
 *   MTTR (3.5.2) = repair/replace time ÷ repair events: repair start to repair
 *                  complete. Basis: actual_duration_hrs (order-level actual
 *                  hours). When no failure carries repair hours the downtime
 *                  chain stands in and mttrBasis says so — before the 7th-ed
 *                  pass the engine silently reported MDT under the name MTTR.
 *   MTBM (3.5.3) = operating time ÷ maintenance actions that interrupted the
 *                  function (failures + PM/PdM work carrying downtime).
 *   MTTF (3.5.5) = operating time ÷ non-repairable items run to failure. No
 *                  per-component repairable flag exists, so the honest proxy
 *                  is the recorded remedy: a failure closed with REPLACED
 *                  ended an item's life; one closed with REPAIRED did not.
 *   Ai (G6.0)    = MTBF ÷ (MTBF + MTTR)   — inherent, design-driven.
 *   Ao (G6.0)    = MTBM ÷ (MTBM + MDT)    — operational, what the plant lived.
 *
 * `availabilityPct` remains the Ai alias so RBD, Predict and the dossier keep
 * reading one field; `aiPct`/`aoPct` are the named 7th-edition pair.
 */
export interface AssetReliability {
  failures12mo: number;        // primary failures inside the analysis window
  totalFailures: number;       // primary failures on record
  lastFailureDate?: string;    // ISO date of the most recent failure
  mtbfDays?: number;           // SMRP 3.5.1 Mean Time Between Failures (days)
  mtbfBasis?: 'stored' | 'operating-window' | 'lifetime-interarrival';
  mttrHours?: number;          // SMRP 3.5.2 Mean Time To Repair or Replace (hours)
  mttrBasis?: 'stored' | 'repair' | 'downtime-proxy';
  mdtHours?: number;           // SMRP 3.5.4 Mean Downtime (hours) — failure → back in service
  mtbmDays?: number;           // SMRP 3.5.3 Mean Time Between Maintenance (days)
  maintenanceActions12mo: number; // failures + function-interrupting PM/PdM actions in window
  mttfDays?: number;           // SMRP 3.5.5 Mean Time To Failure (days) — replacement-closed failures only
  replacements12mo: number;    // window failures whose remedy was REPLACED (the MTTF denominator)
  aiPct?: number;             // Guideline 6.0 inherent availability = MTBF/(MTBF+MTTR)
  aoPct?: number;              // Guideline 6.0 operational availability = MTBM/(MTBM+MDT)
  availabilityPct?: number;    // alias of aiPct (legacy consumers)
  scheduledDowntimeHrs12mo: number;   // SMRP 3.3 — downtime on preventive/scheduled work in window
  unscheduledDowntimeHrs12mo: number; // SMRP 3.4 — downtime on failures in window
  operatingHrs12mo: number;    // window hours less all recorded downtime (the MTBF/MTBM numerator)
  downtimeCoveragePct: number; // share of window failures carrying a downtime figure — the trust caveat
  collateral12mo: number;      // failures marked as collateral of ANOTHER failure (0289) — shown, never counted against this asset
  recurringModes: { mode: string; count: number }[]; // failure modes seen >=2× (12mo)
  recurringParts: { part: string; count: number }[]; // failed components seen >=2× (12mo, 0287 BOM link)
  repeatFailure: boolean;      // a mode recurred, or >=3 failures in 12 months
  recommendRCA: boolean;       // data-driven RCA trigger
  rcaReason?: string;          // why an RCA is recommended
}

// \bEM\b: emergency work orders are stored with the bare type code 'EM' in
// several flows — 'EMERG' alone missed them, so EM breakdowns without a coded
// failure mode silently dropped out of MTBF/bad-actor math.
const CORRECTIVE_RE = /CORRECT|BREAK|EMERG|REPAIR|\bCM\b|\bEM\b/;

const failureMode = (r: any): string | undefined => {
  const fd = Array.isArray(r.wo_failure_data) ? r.wo_failure_data[0] : r.wo_failure_data;
  const code = fd?.failure_mode_code || fd?.failureMode || undefined;
  // 'UNKNOWN' was the import chain's NOT-NULL pad (pre-0298), not a catalog
  // code — it must not count as "coded failure evidence" for isFailure, nor
  // group as a recurring mode. 0298 converts stored pads to NULL; this guard
  // covers tenants whose data predates that apply.
  return code && code.toUpperCase() !== 'UNKNOWN' ? code : undefined;
};

// The failed component (ISO 14224 level 8/9): the object_part description
// snapshot, coded from the asset BOM since 0287.
const failedPart = (r: any): string | undefined => {
  const fd = Array.isArray(r.wo_failure_data) ? r.wo_failure_data[0] : r.wo_failure_data;
  return fd?.object_part || fd?.objectPart || undefined;
};

// Collateral damage (0289): the failure was CAUSED by another failure. It is
// still an event on this asset (repairs, cost) but it is not the asset's own
// reliability — MTBF/failure counts use primaries; collateral is counted
// separately and always shown.
export const isSecondaryFailure = (r: any): boolean => {
  const fd = Array.isArray(r.wo_failure_data) ? r.wo_failure_data[0] : r.wo_failure_data;
  return fd?.secondary_failure === true || fd?.secondaryFailure === true;
};

// SMRP 3.5.5 MTTF is defined for NON-repairable items — the life that ends
// with a replacement. There is no per-component repairable flag, so the
// recorded remedy decides: 'RPL' (Replaced) in the REMEDY_CODE dictionary, or
// any code spelling out replacement, marks the failure as an item run to
// failure. A failure fixed by repair belongs to MTBF, not MTTF.
export const isReplacement = (r: any): boolean => {
  const fd = Array.isArray(r.wo_failure_data) ? r.wo_failure_data[0] : r.wo_failure_data;
  const code = String(fd?.remedy_code || fd?.remedyCode || '').toUpperCase().trim();
  return code === 'RPL' || /REPLAC/.test(code);
};

// Failure event time, best basis first: the recorded malfunction start (0283 —
// the actual equipment event, SAP AUSVN), then closure, then creation as the
// last paperwork proxy. Exported so no caller re-derives event dates from
// created_at alone.
export const eventDate = (r: any): string | undefined =>
  r.malfunction_start || r.malfunctionStart || r.closed_at || r.created_at || r.createdAt;

/**
 * THE canonical failure predicate (M1 — engine unification; breakdown-aware
 * since the KPI-unification pass). Precedence:
 *
 *   1. A RECORDED breakdown indicator wins over any type heuristic (0283 /
 *      SAP MSAUS — the field MCJB counts failures by): true = the equipment
 *      lost its function (a breakdown found during PM work IS a failure);
 *      false = explicitly recorded as non-failure work, however it was typed
 *      (a minor defect with a damage code is an event, not a failure).
 *   2. Not recorded (null/undefined — legacy rows, thin imports): fall back
 *      to the type heuristic — corrective/breakdown-typed OR carrying a coded
 *      failure mode; preventive/inspection work is not a failure.
 *
 * Every surface that counts, ranks, or models failures (Metrics scoreboard,
 * Modelling calculators, bad-actor rankings, agents) must use this — never a
 * local WO-type list. sem_asset_reliability (0295) mirrors this exactly.
 * rpc_pareto_analysis deliberately does NOT — its counts are driven by the
 * caller's explicit p_wo_types selection, a different contract.
 */
export const isFailure = (r: any): boolean => {
  const bd = r.breakdown;
  if (bd === true) return true;
  if (bd === false) return false;
  const t = String(r.type || '').toUpperCase();
  if (/PREVENT|PREDICT|INSPECT|SCHEDUL|\bPM\b|\bPDM\b/.test(t)) return false;
  return CORRECTIVE_RE.test(t) || !!failureMode(r);
};

/**
 * Column list a query must select for the engine to classify records.
 * KEEP THIS MATCHED TO THE LIVE work_orders SCHEMA: PostgREST rejects the
 * ENTIRE select when any column is unknown (42703), which silently blanked
 * every caller (Modelling auto-populate, toolkit, KPI outlook) while this
 * listed `actual_duration`/`actual_hours` — neither exists on work_orders
 * (actual_hours lives on job_tasks; actual_duration never shipped in any
 * migration). repairHoursOf still reads those names defensively for callers
 * that pass richer client-side records.
 */
export const FAILURE_QUERY_COLUMNS =
  'id, type, status, created_at, closed_at, actual_downtime_hrs, actual_duration_hrs, est_downtime_hrs, malfunction_start, breakdown, wo_failure_data!wo_id(failure_mode_code, remedy_code, object_part, secondary_failure, caused_by_wo_id)';

/**
 * One derivation of the numbers the Modelling calculators auto-populate from an
 * asset's WO history — failures, MTBF (hours) and the repair-time series — so
 * RAM / Availability / Spares / pooled views all reconcile with the Metrics
 * scoreboard by construction.
 */
export interface FailureBasis {
  failures: number;          // failures in the fetched window
  mtbfHours?: number;        // SMRP 3.5.1 operating-time MTBF × 24 (lifetime inter-arrival fallback when the window is quiet)
  totalHours: number;        // operating-time basis st. totalHours/failures === MTBF (8760 fallback)
  repairHours: number[];     // per-failure downtime series (MDT basis — the outage the calculators model)
}

export function assetFailureBasis(records: any[]): FailureBasis {
  const rel = computeAssetReliability(records || []);
  const failures = rel.failures12mo || rel.totalFailures;
  const mtbfHours = rel.mtbfDays != null ? rel.mtbfDays * 24 : undefined;
  return {
    failures,
    mtbfHours,
    totalHours: mtbfHours != null && failures > 0 ? Math.round(mtbfHours * failures) : 8760,
    repairHours: failureRepairHours(records || []),
  };
}

export interface ReliabilityOptions {
  /** Authoritative MTBF/MTTR from the asset record, if available (preferred). */
  mtbfDays?: number | null;
  mttrHours?: number | null;
  /** Recency window (days) for the "recent failures" count & recurring modes. Default 365. */
  windowDays?: number;
}

/** Compute asset reliability KPIs from its work-order history (raw DB records). */
export function computeAssetReliability(records: any[], opts: ReliabilityOptions = {}): AssetReliability {
  const yearAgo = Date.now() - (opts.windowDays ?? 365) * 86400000;
  const inWindow = (r: any) => {
    const d = eventDate(r);
    return d ? new Date(d).getTime() >= yearAgo : false;
  };
  // 0289: PRIMARY failures drive every aggregate below — collateral events
  // (caused by another failure) are the initiator's account, not this asset's.
  // They are counted separately and always shown, never silently dropped.
  const allFailures = (records || []).filter(isFailure);
  const failures = allFailures.filter(r => !isSecondaryFailure(r));
  const collateral12mo = allFailures.filter(r => isSecondaryFailure(r) && inWindow(r)).length;
  const failures12 = failures.filter(inWindow);

  // Recurring failure modes within the last 12 months.
  const modeCounts: Record<string, number> = {};
  for (const r of failures12) {
    const m = failureMode(r);
    if (m) modeCounts[m] = (modeCounts[m] || 0) + 1;
  }
  const recurringModes = Object.entries(modeCounts)
    .filter(([, c]) => c >= 2)
    .map(([mode, count]) => ({ mode, count }))
    .sort((a, b) => b.count - a.count);

  // Recurring failed components within the same window (0287) — "what part of
  // this asset keeps failing", the spares/bad-actor angle recurringModes can't see.
  const partCounts: Record<string, number> = {};
  for (const r of failures12) {
    const p = failedPart(r);
    if (p) partCounts[p] = (partCounts[p] || 0) + 1;
  }
  const recurringParts = Object.entries(partCounts)
    .filter(([, c]) => c >= 2)
    .map(([part, count]) => ({ part, count }))
    .sort((a, b) => b.count - a.count);

  const windowDays = opts.windowDays ?? 365;
  const mean1 = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, d) => s + d, 0) / xs.length) * 10) / 10 : undefined);

  // ── SMRP 3.5.4 MDT — failure to back-in-service (the malfunction window) ──
  // Window failures only: the window is the observation period every other
  // number here is expressed over. Falls back to all recorded failures when
  // the window is quiet (imported-history tenants, 0298).
  const mdtPool = failures12.length ? failures12 : failures;
  const downs = mdtPool.map(repairHoursOf).filter(d => d > 0);
  const mdtHours = mean1(downs);

  // ── SMRP 3.5.2 MTTR — repair start to repair complete ─────────────────────
  // Repair hours (actual_duration_hrs) when any failure carries them; else the
  // downtime chain stands in, and the basis says so. A stored asset value wins.
  const repairs = mdtPool.map(repairLaborHoursOf).filter(d => d > 0);
  let mttrHours: number | undefined;
  let mttrBasis: AssetReliability['mttrBasis'];
  if ((opts.mttrHours ?? null) != null) { mttrHours = Number(opts.mttrHours); mttrBasis = 'stored'; }
  else if (repairs.length) { mttrHours = mean1(repairs); mttrBasis = 'repair'; }
  else if (downs.length) { mttrHours = mdtHours; mttrBasis = 'downtime-proxy'; }

  // ── Downtime split (SMRP 3.3 / 3.4) and the operating-time basis ──────────
  const unscheduledDowntimeHrs12mo = Math.round(failures12.map(repairHoursOf).reduce((s, d) => s + d, 0) * 10) / 10;
  const interruptingPm = (records || []).filter(r => !isFailure(r) && isPreventiveType(r) && inWindow(r) && pmDowntimeOf(r) > 0);
  const scheduledDowntimeHrs12mo = Math.round(interruptingPm.map(pmDowntimeOf).reduce((s, d) => s + d, 0) * 10) / 10;
  const windowHours = windowDays * 24;
  const operatingHrs12mo = Math.max(0, Math.round(windowHours - unscheduledDowntimeHrs12mo - scheduledDowntimeHrs12mo));

  // ── SMRP 3.5.1 MTBF = operating time ÷ failures ───────────────────────────
  // Operating time is the window less recorded downtime (calendar-hour
  // approximation — no run-hour meters). A stored asset value wins. When the
  // window has no failures but history does, the lifetime inter-arrival span
  // is the fallback (matches sem_asset_reliability.mtbf_hours_lifetime).
  let mtbfDays: number | undefined;
  let mtbfBasis: AssetReliability['mtbfBasis'];
  if ((opts.mtbfDays ?? null) != null) { mtbfDays = Number(opts.mtbfDays); mtbfBasis = 'stored'; }
  else if (failures12.length > 0) {
    mtbfDays = Math.round((operatingHrs12mo / failures12.length) / 24 * 10) / 10;
    mtbfBasis = 'operating-window';
  } else if (failures.length >= 2) {
    const times = failures.map(eventDate).filter(Boolean).map(d => new Date(d as string).getTime()).sort((a, b) => a - b);
    const spanDays = (times[times.length - 1] - times[0]) / 86400000;
    if (spanDays > 0) { mtbfDays = Math.round(spanDays / (times.length - 1) * 10) / 10; mtbfBasis = 'lifetime-interarrival'; }
  }

  // ── SMRP 3.5.3 MTBM = operating time ÷ function-interrupting actions ──────
  const maintenanceActions12mo = failures12.length + interruptingPm.length;
  const mtbmDays = maintenanceActions12mo > 0
    ? Math.round((operatingHrs12mo / maintenanceActions12mo) / 24 * 10) / 10
    : undefined;

  // ── SMRP 3.5.5 MTTF = operating time ÷ items run to failure and replaced ──
  // Same operating-time numerator as MTBF; the denominator is only the window
  // failures the technician closed as REPLACED. Undefined when nothing was
  // replaced — never zero, never a repair-based number under this name.
  const replacements12mo = failures12.filter(isReplacement).length;
  const mttfDays = replacements12mo > 0
    ? Math.round((operatingHrs12mo / replacements12mo) / 24 * 10) / 10
    : undefined;

  // ── Guideline 6.0: Ai = MTBF/(MTBF+MTTR); Ao = MTBM/(MTBM+MDT) ────────────
  const availOf = (upDays?: number, downHours?: number): number | undefined => {
    if (upDays == null || downHours == null) return undefined;
    const denom = upDays + downHours / 24;
    return denom > 0 ? Math.round((upDays / denom) * 1000) / 10 : undefined;
  };
  const aiPct = availOf(mtbfDays, mttrHours);
  const aoPct = availOf(mtbmDays, mdtHours);
  const availabilityPct = aiPct;
  const downtimeCoveragePct = failures12.length
    ? Math.round((failures12.filter(r => repairHoursOf(r) > 0).length / failures12.length) * 100)
    : 0;

  const lastFailureDate = failures.length
    ? failures.map(eventDate).filter(Boolean).sort((a, b) => new Date(b as string).getTime() - new Date(a as string).getTime())[0]
    : undefined;

  const repeatFailure = recurringModes.length > 0 || failures12.length >= 3;
  let recommendRCA = false;
  let rcaReason: string | undefined;
  if (recurringModes.length > 0) {
    recommendRCA = true;
    rcaReason = `Failure mode "${recurringModes[0].mode}" recurred ${recurringModes[0].count}× in the analysis window.`;
  } else if (failures12.length >= 3) {
    recommendRCA = true;
    rcaReason = `${failures12.length} failures on this asset in the analysis window.`;
  }

  return {
    failures12mo: failures12.length,
    totalFailures: failures.length,
    lastFailureDate,
    mtbfDays,
    mtbfBasis,
    mttrHours,
    mttrBasis,
    mdtHours,
    mtbmDays,
    maintenanceActions12mo,
    mttfDays,
    replacements12mo,
    aiPct,
    aoPct,
    availabilityPct,
    scheduledDowntimeHrs12mo,
    unscheduledDowntimeHrs12mo,
    operatingHrs12mo,
    downtimeCoveragePct,
    collateral12mo,
    recurringModes,
    recurringParts,
    repeatFailure,
    recommendRCA,
    rcaReason,
  };
}

// ── Shared failure-derived series ────────────────────────────────────────────
// One definition of "a failure" (isFailure) and one basis for the repair-time
// and inter-arrival series, so the Metrics scoreboard, the RAM dashboard, and the
// Weibull tab all model the SAME events. This retires the calculators' ad-hoc,
// slightly-different WO extraction (M1 — engine unification).

// Repair-duration basis, in preference order: recorded downtime, order-level
// actual hours (actual_duration_hrs, 0283 — captured in the Complete modal),
// then legacy client-side field names as a last-resort proxy (plants that
// don't capture downtime at closeout would otherwise produce no MTTR at all).
// This ONE chain feeds both the engine MTTR and every calculator series.
// First POSITIVE value wins (not ??): UI-mapped records default the numeric
// fields to 0, and a 0 early in the chain must not mask a real value later.
const repairHoursOf = (r: any): number => {
  for (const v of [r.actual_downtime_hrs, r.actual_duration_hrs, r.actual_duration, r.actualDowntime, r.actualDuration, r.actual_hours]) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
};

// SMRP 3.5.2 repair time proper — the order's actual repair hours, NOT the
// outage window. Only the repair-hour fields count here; when none is set the
// engine falls back to the downtime chain and labels the basis.
const repairLaborHoursOf = (r: any): number => {
  for (const v of [r.actual_duration_hrs, r.actual_duration, r.actualDuration, r.actual_hours]) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
};

// Preventive / scheduled work types (the same class isFailure treats as
// non-failure by type). Used for SMRP 3.3 scheduled downtime and MTBM.
const isPreventiveType = (r: any): boolean =>
  /PREVENT|PREDICT|INSPECT|SCHEDUL|CALIB|\bPM\b|\bPDM\b/.test(String(r.type || '').toUpperCase());

// Downtime a PM/PdM action imposed on the asset: recorded actual downtime
// first, else the planned downtime from the job plan (est_downtime_hrs, 0283).
// A PM with neither did not interrupt the function (SMRP 3.5.3 "maintenance
// actions which require or result in function interruption").
const pmDowntimeOf = (r: any): number => {
  for (const v of [r.actual_downtime_hrs, r.actualDowntime, r.est_downtime_hrs, r.estDowntime]) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
};

/** Per-failure repair/downtime hours (same basis as MTTR) — for maintainability charts.
 *  Primaries only (0289): repairing collateral damage is real work, but it is not
 *  this asset's repair-time distribution. */
export function failureRepairHours(records: any[]): number[] {
  return (records || []).filter(isFailure).filter(r => !isSecondaryFailure(r)).map(repairHoursOf).filter(d => d > 0);
}

/** Inter-arrival times between consecutive failures, in hours — for Weibull life data.
 *  Primaries only (0289): a collateral event is not the asset's own life data and
 *  would corrupt the β fit. */
export function failureIntervalsHours(records: any[]): number[] {
  const times = (records || []).filter(isFailure).filter(r => !isSecondaryFailure(r))
    .map(eventDate).filter(Boolean)
    .map(d => new Date(d as string).getTime())
    .sort((a, b) => a - b);
  const out: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const h = (times[i] - times[i - 1]) / 3600000;
    if (h > 0) out.push(Math.round(h));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Harmonization scaffold — every reliability KPI (now and future) is expressed as
// a uniform ReliabilityKpi so the UI renders them the same way and the Reliability
// Specialist AI advises off a single, consistent serialization. To add a new SMRP
// metric: compute it, then emit a ReliabilityKpi.
// ─────────────────────────────────────────────────────────────────────────────
export type MetricDirection = 'higher-better' | 'lower-better';

export interface ReliabilityKpi {
  key: string;
  label: string;
  smrpRef?: string;          // e.g. 'SMRP 5.4.13'
  value: number | null;      // numeric (null = not enough data)
  display: string;           // formatted for display, e.g. '62%'
  unit?: string;
  direction: MetricDirection;
  benchmark?: string;        // e.g. '>= 80%'
  definition: string;        // plain-English meaning + formula
}

/** Serialize KPIs into a compact block the Reliability Specialist can advise on. */
export function kpisToAIContext(kpis: ReliabilityKpi[]): string {
  return kpis
    .filter(k => k.value !== null)
    .map(k => `${k.label}${k.smrpRef ? ` (${k.smrpRef})` : ''}: ${k.display}` +
      (k.benchmark ? ` [benchmark ${k.benchmark}]` : '') + ` — ${k.definition}`)
    .join('\n');
}

// ─── SMRP 5.4.13 — PM & PdM Effectiveness ───────────────────────────────────
export interface PMEffectiveness {
  overall: { necessary: number; written: number; pct: number | null };
  byPM: Record<string, { necessary: number; written: number; pct: number | null }>;
}

/**
 * SMRP 5.4.13 — PM & PdM Effectiveness = (necessary PM/PdM corrective WOs) ÷
 * (PM/PdM corrective WOs written).
 *  - Written  = corrective work orders raised as a follow-up from a PM/PdM WO
 *               (the follow-up's parent WO was generated by a recurring PM).
 *  - Necessary = of those, the ones that found & corrected a real defect/potential
 *               failure (proxy: a coded ISO 14224 failure mode, not cancelled).
 * Low effectiveness ⇒ PM/PdM is generating low-value corrective work; a PM that
 * generates no corrective work over time is a candidate for frequency reduction
 * or elimination (RCM) — surfaced for the user + AI to judge.
 */
export function computePMEffectiveness(workOrders: any[]): PMEffectiveness {
  // PM execution WO id -> source PM (recurring_work) id.
  const pmWoToPmId: Record<string, string> = {};
  for (const wo of workOrders || []) {
    if (wo?.recurringWorkId && wo?.id) pmWoToPmId[wo.id] = wo.recurringWorkId;
  }
  const isNecessary = (wo: any) =>
    !!(wo?.failureData && wo.failureData.failureMode) && String(wo?.status || '').toUpperCase() !== 'CANC';

  const byPM: Record<string, { necessary: number; written: number }> = {};
  let nec = 0, writ = 0;
  for (const wo of workOrders || []) {
    if (!wo?.parentWoId) continue;
    const pmId = pmWoToPmId[wo.parentWoId];
    if (!pmId) continue;                // parent isn't a PM/PdM-generated WO
    if (isPreventiveWork(wo)) continue; // count only the corrective follow-ups
    writ++;
    const necessary = isNecessary(wo);
    if (necessary) nec++;
    const b = byPM[pmId] || (byPM[pmId] = { necessary: 0, written: 0 });
    b.written++;
    if (necessary) b.necessary++;
  }
  const pct = (n: number, w: number) => (w > 0 ? Math.round((n / w) * 100) : null);
  const byPMOut: PMEffectiveness['byPM'] = {};
  for (const [id, v] of Object.entries(byPM)) byPMOut[id] = { ...v, pct: pct(v.necessary, v.written) };
  return { overall: { necessary: nec, written: writ, pct: pct(nec, writ) }, byPM: byPMOut };
}

// ─────────────────────────────────────────────────────────────────────────────
// Work-execution metrics — Schedule Compliance, PM Compliance, Ready Backlog (in
// crew-weeks). Shared by the Schedule cockpit (ScheduleKPIs) and the Reliability
// Metrics page so both surfaces show identical numbers off one definition.
//
// Field-tolerant: accepts mapped WorkOrder objects (camelCase) OR raw DB rows
// (snake_case), so callers can pass whichever they already have.
// ─────────────────────────────────────────────────────────────────────────────

const _status = (j: any) => String(j.status || '').toUpperCase();
const _type = (j: any) => String(j.type || '').toUpperCase();
const _due = (j: any): string | undefined => j.dateDueStart || j.dueDate || j.date_due_start || j.due_date || undefined;
const _isClosed = (j: any) => _status(j) === 'CLOSED' || _status(j) === 'TECO';
const _completedTs = (j: any, now: number): number => {
  const c = j.dateCompleted || j.dateClosed || j.date_completed || j.closed_at;
  return c ? new Date(c).getTime() : now; // CLOSED/TECO without a date ⇒ treat as now
};
const _estHours = (j: any): number => {
  const e = Number(j.estDuration ?? j.est_duration);
  if (e > 0) return e;
  const tasks = j.tasks || j.job_tasks || [];
  return Array.isArray(tasks) ? tasks.reduce((s: number, t: any) => s + (Number(t.estHours ?? t.est_hours) || 0), 0) : 0;
};

export interface ComplianceResult { pct: number | null; numerator: number; denominator: number; }

/** Schedule Compliance — scheduled work completed on/before its scheduled date. */
export function computeScheduleCompliance(jobs: any[]): ComplianceResult {
  const now = Date.now();
  const scheduled = (jobs || []).filter(j => _due(j));
  const onTime = scheduled.filter(j => _isClosed(j) && _completedTs(j, now) <= new Date(_due(j) as string).getTime());
  return { numerator: onTime.length, denominator: scheduled.length, pct: scheduled.length ? Math.round((onTime.length / scheduled.length) * 1000) / 10 : null };
}

/**
 * PM Compliance — delegates to THE canonical definition in lib/reliabilityKpis
 * (one engine; this file previously carried its own type list and window, so
 * the same plant could show different compliance on two pages). Window here is
 * the current calendar month — this surface's established reporting frame —
 * and the canonical overdue-open clause still applies: a missed PM stays in
 * the denominator however old, leaving only by completion or cancellation.
 */
export function computePMCompliance(jobs: any[]): ComplianceResult {
  const now = Date.now();
  const monthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime();
  const rows = (jobs || []).map(j => {
    const closed = j.dateCompleted || j.dateClosed || j.date_completed || j.closed_at;
    return {
      type: _type(j),
      status: _status(j),
      created_at: j.createdAt || j.created_at || new Date(0).toISOString(),
      // CLOSED/TECO without a completion date ⇒ treat as now (field-tolerant
      // rule this file has always used).
      closed_at: closed ? String(closed) : (_isClosed(j) ? new Date(now).toISOString() : null),
      due_date: _due(j) ?? null,
    };
  });
  const r = computeCanonicalPmCompliance(rows, monthStart, now);
  return { numerator: r.onTime, denominator: r.due, pct: r.compliancePct };
}

export interface BacklogMetrics {
  readyHours: number;          // estimated labour-hours of ready backlog
  weeklyCapacityHours: number; // Σ dailyCapacityHours × workingDays across crew
  backlogWeeks: number | null; // readyHours ÷ weeklyCapacity
}

const READY_STATES = ['OPEN', 'PLAN', 'PLANNED', 'READY'];

/**
 * Ready Backlog in crew-weeks = estimated labour-hours of ready (planned) work ÷
 * weekly crew capacity. Capacity is derived from the resource roster
 * (dailyCapacityHours × number of working days). Benchmark ~2–4 weeks: high =
 * under-resourced or over-planning; very low = risk of crew idling.
 */
export function computeScheduleBacklog(
  jobs: any[],
  resources: any[],
  materialStatusMap?: Record<string, string>,
): BacklogMetrics {
  const ready = (jobs || []).filter(j =>
    READY_STATES.includes(_status(j)) && (!materialStatusMap || materialStatusMap[j.id] !== 'SHORTAGE'));
  const readyHours = ready.reduce((s, j) => s + _estHours(j), 0);
  const weeklyCapacityHours = (resources || []).reduce((s, r) => {
    const daily = Number(r.dailyCapacityHours ?? r.daily_capacity_hours) || 0;
    const days = Array.isArray(r.workingDays) ? r.workingDays.length
      : Array.isArray(r.working_days) ? r.working_days.length : 5;
    return s + daily * days;
  }, 0);
  const backlogWeeks = weeklyCapacityHours > 0 ? Math.round((readyHours / weeklyCapacityHours) * 10) / 10 : null;
  return { readyHours: Math.round(readyHours), weeklyCapacityHours: Math.round(weeklyCapacityHours), backlogWeeks };
}

/** Emit Ready Backlog (weeks) as a harmonized KPI for the cockpit + AI advisor. */
export function backlogWeeksKpi(b: BacklogMetrics): ReliabilityKpi {
  const v = b.backlogWeeks;
  return {
    key: 'ready_backlog_weeks',
    label: 'Ready Backlog',
    smrpRef: 'SMRP 5.4.9',
    value: v,
    display: v == null ? 'N/A' : `${v} wks`,
    unit: 'weeks',
    direction: 'lower-better',
    benchmark: '2–4 weeks',
    definition: 'Estimated labour-hours of ready (planned) backlog ÷ weekly crew capacity. >6 weeks signals under-resourcing or over-planning; <2 risks the crew running out of ready work.',
  };
}

/** Wrap a ComplianceResult as a harmonized KPI (Schedule / PM compliance). */
export function complianceKpi(key: string, label: string, c: ComplianceResult, benchmark = '>= 90%', smrpRef?: string): ReliabilityKpi {
  return {
    key, label, smrpRef, value: c.pct,
    display: c.pct == null ? 'N/A' : `${c.pct}%`,
    unit: '%', direction: 'higher-better', benchmark,
    definition: `${c.numerator} of ${c.denominator} completed on time.`,
  };
}

/** Emit the overall PM & PdM Effectiveness as a harmonized KPI. */
export function pmEffectivenessKpi(eff: PMEffectiveness): ReliabilityKpi {
  const v = eff.overall.pct;
  return {
    key: 'pm_pdm_effectiveness',
    label: 'PM & PdM Effectiveness',
    smrpRef: 'SMRP 5.4.13',
    value: v,
    display: v == null ? 'N/A' : `${v}% (${eff.overall.necessary}/${eff.overall.written})`,
    unit: '%',
    direction: 'higher-better',
    benchmark: 'higher = PM/PdM catching real defects',
    definition: 'Necessary ÷ written PM/PdM corrective work orders. Low = PM/PdM generating low-value work.',
  };
}
