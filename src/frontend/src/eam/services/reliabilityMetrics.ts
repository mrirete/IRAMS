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

export interface AssetReliability {
  failures12mo: number;        // corrective failures in the last 12 months
  totalFailures: number;       // corrective failures on record
  lastFailureDate?: string;    // ISO date of the most recent failure
  mtbfDays?: number;           // SMRP: Mean Time Between Failures (days)
  mttrHours?: number;          // SMRP: Mean Time To Repair (hours)
  availabilityPct?: number;    // SMRP inherent availability Ai = MTBF/(MTBF+MTTR), %
  recurringModes: { mode: string; count: number }[]; // failure modes seen >=2× (12mo)
  repeatFailure: boolean;      // a mode recurred, or >=3 failures in 12 months
  recommendRCA: boolean;       // data-driven RCA trigger
  rcaReason?: string;          // why an RCA is recommended
}

const CORRECTIVE_RE = /CORRECT|BREAK|EMERG|REPAIR|\bCM\b/;

const failureMode = (r: any): string | undefined => {
  const fd = Array.isArray(r.wo_failure_data) ? r.wo_failure_data[0] : r.wo_failure_data;
  return fd?.failure_mode_code || fd?.failureMode || undefined;
};

const eventDate = (r: any): string | undefined => r.closed_at || r.created_at || r.createdAt;

// A work order counts as a "failure" if it's corrective/breakdown work OR carries
// a coded failure mode (ISO 14224). Preventive/inspection work is not a failure.
const isFailure = (r: any): boolean => {
  const t = String(r.type || '').toUpperCase();
  if (/PREVENT|PREDICT|INSPECT|SCHEDUL|\bPM\b|\bPDM\b/.test(t)) return false;
  return CORRECTIVE_RE.test(t) || !!failureMode(r);
};

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
  const failures = (records || []).filter(isFailure);
  const failures12 = failures.filter(r => {
    const d = eventDate(r);
    return d ? new Date(d).getTime() >= yearAgo : false;
  });

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

  // MTTR — prefer the asset's stored value, else mean of actual repair durations.
  const durs = failures.map(r => Number(r.actual_downtime_hrs ?? r.actual_duration ?? r.actualDuration) || 0).filter(d => d > 0);
  const mttrHours = (opts.mttrHours ?? null) != null
    ? Number(opts.mttrHours)
    : (durs.length ? Math.round((durs.reduce((s, d) => s + d, 0) / durs.length) * 10) / 10 : undefined);

  // MTBF — prefer the asset's stored value, else derive from failure-date spans.
  let mtbfDays: number | undefined = (opts.mtbfDays ?? null) != null ? Number(opts.mtbfDays) : undefined;
  if (mtbfDays == null && failures.length >= 2) {
    const times = failures.map(eventDate).filter(Boolean).map(d => new Date(d as string).getTime()).sort((a, b) => a - b);
    if (times.length >= 2) {
      const spanDays = (times[times.length - 1] - times[0]) / 86400000;
      if (spanDays > 0) mtbfDays = Math.round(spanDays / (times.length - 1));
    }
  }

  // SMRP inherent availability Ai = MTBF / (MTBF + MTTR) — driven by repair downtime.
  let availabilityPct: number | undefined;
  if (mtbfDays != null && mttrHours != null) {
    const denom = mtbfDays + mttrHours / 24;
    if (denom > 0) availabilityPct = Math.round((mtbfDays / denom) * 1000) / 10;
  }

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
    mttrHours,
    availabilityPct,
    recurringModes,
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

/** Per-failure repair/downtime hours (same basis as MTTR) — for maintainability charts. */
export function failureRepairHours(records: any[]): number[] {
  return (records || []).filter(isFailure)
    .map(r => Number(r.actual_downtime_hrs ?? r.actual_duration ?? r.actualDuration) || 0)
    .filter(d => d > 0);
}

/** Inter-arrival times between consecutive failures, in hours — for Weibull life data. */
export function failureIntervalsHours(records: any[]): number[] {
  const times = (records || []).filter(isFailure)
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
const _isThisMonth = (d?: string): boolean => {
  if (!d) return false;
  const x = new Date(d), n = new Date();
  return x.getMonth() === n.getMonth() && x.getFullYear() === n.getFullYear();
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

const PM_TYPES = ['PM', 'PREVENTIVE', 'INSPECTION', 'CALIBRATION'];

/** PM Compliance — PMs due this month completed on/before their due date. */
export function computePMCompliance(jobs: any[]): ComplianceResult {
  const now = Date.now();
  const due = (jobs || []).filter(j => PM_TYPES.includes(_type(j)) && _isThisMonth(_due(j)));
  const onTime = due.filter(j => _isClosed(j) && _completedTs(j, now) <= new Date(_due(j) as string).getTime());
  return { numerator: onTime.length, denominator: due.length, pct: due.length ? Math.round((onTime.length / due.length) * 1000) / 10 : null };
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
    value: v,
    display: v == null ? 'N/A' : `${v} wks`,
    unit: 'weeks',
    direction: 'lower-better',
    benchmark: '2–4 weeks',
    definition: 'Estimated labour-hours of ready (planned) backlog ÷ weekly crew capacity. >6 weeks signals under-resourcing or over-planning; <2 risks the crew running out of ready work.',
  };
}

/** Wrap a ComplianceResult as a harmonized KPI (Schedule / PM compliance). */
export function complianceKpi(key: string, label: string, c: ComplianceResult, benchmark = '>= 90%'): ReliabilityKpi {
  return {
    key, label, value: c.pct,
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
    value: v,
    display: v == null ? 'N/A' : `${v}% (${eff.overall.necessary}/${eff.overall.written})`,
    unit: '%',
    direction: 'higher-better',
    benchmark: 'higher = PM/PdM catching real defects',
    definition: 'Necessary ÷ written PM/PdM corrective work orders. Low = PM/PdM generating low-value work.',
  };
}
