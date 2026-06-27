// ─────────────────────────────────────────────────────────────────────────────
// Reliability Metrics spine (SMRP-aligned) — single source of truth for the
// reliability KPIs that both people and the AI agents read, so decisions are
// grounded in the same, defensible numbers.
//
// This first slice computes ASSET-level equipment-reliability metrics from work
// order + failure history (ISO 14224 failure modes). Modelling and Analyze should
// draw from here rather than recomputing MTBF/MTTR independently.
// ─────────────────────────────────────────────────────────────────────────────

export interface AssetReliability {
  failures12mo: number;        // corrective failures in the last 12 months
  totalFailures: number;       // corrective failures on record
  lastFailureDate?: string;    // ISO date of the most recent failure
  mtbfDays?: number;           // SMRP: Mean Time Between Failures (days)
  mttrHours?: number;          // SMRP: Mean Time To Repair (hours)
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
}

/** Compute asset reliability KPIs from its work-order history (raw DB records). */
export function computeAssetReliability(records: any[], opts: ReliabilityOptions = {}): AssetReliability {
  const yearAgo = Date.now() - 365 * 86400000;
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
  const durs = failures.map(r => Number(r.actual_duration ?? r.actualDuration) || 0).filter(d => d > 0);
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

  const lastFailureDate = failures.length
    ? failures.map(eventDate).filter(Boolean).sort((a, b) => new Date(b as string).getTime() - new Date(a as string).getTime())[0]
    : undefined;

  const repeatFailure = recurringModes.length > 0 || failures12.length >= 3;
  let recommendRCA = false;
  let rcaReason: string | undefined;
  if (recurringModes.length > 0) {
    recommendRCA = true;
    rcaReason = `Failure mode "${recurringModes[0].mode}" recurred ${recurringModes[0].count}× in 12 months.`;
  } else if (failures12.length >= 3) {
    recommendRCA = true;
    rcaReason = `${failures12.length} failures on this asset in the last 12 months.`;
  }

  return {
    failures12mo: failures12.length,
    totalFailures: failures.length,
    lastFailureDate,
    mtbfDays,
    mttrHours,
    recurringModes,
    repeatFailure,
    recommendRCA,
    rcaReason,
  };
}
