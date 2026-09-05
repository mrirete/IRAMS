/**
 * rcmPlan — the pure logic between an RCM decision and the PM it becomes.
 *
 * Why this exists: the Strategy tab, the Specialist's recommendation and the
 * PM generator each had their own idea of what an "interval" was. The
 * Specialist wrote prose ("Every 12-24 months or per manufacturer…"), the
 * wizard parsed the first number it found, and the generator silently fell
 * back to 30 days — so the PM that reached Work Management carried a cadence
 * nobody had chosen. Everything that turns a decision into a schedulable
 * record now goes through here, and it is testable without React or Supabase.
 */
import type { PMStrategyInput } from '../lib/pmStrategy';

// ── Interval ────────────────────────────────────────────────────────────────

export const INTERVAL_UNITS = ['Hours', 'Days', 'Weeks', 'Months', 'Years'] as const;
export type IntervalUnit = typeof INTERVAL_UNITS[number];

/** Calendar units the 0304 Autopilot can serve; Hours is a running-meter cadence. */
export const CALENDAR_UNITS: ReadonlySet<IntervalUnit> = new Set(['Days', 'Weeks', 'Months', 'Years']);

const UNIT_RE = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h\b|days?|d\b|weeks?|wks?|w\b|months?|mos?|years?|yrs?|y\b)/i;

export function unitFromWord(word: string | null | undefined): IntervalUnit | null {
  const u = String(word || '').trim().toLowerCase();
  if (!u) return null;
  if (u.startsWith('h')) return 'Hours';
  if (u.startsWith('d')) return 'Days';
  if (u.startsWith('w')) return 'Weeks';
  if (u.startsWith('y')) return 'Years';
  if (u.startsWith('m')) return 'Months';
  return null;
}

/**
 * Parse the forms the app itself produces ("6 Months", "1,700 h", "90 days").
 * Free text that carries no "<number> <unit>" pair parses to n = null — the
 * caller must surface that, never default it.
 */
export function parseIntervalText(text: string | null | undefined): { n: number | null; unit: IntervalUnit; raw: string } {
  const raw = String(text ?? '').trim();
  const cleaned = raw.replace(/,/g, '');
  // A range ("12-24 months", "3 to 5 years") is not a cadence — picking either
  // bound would be a guess presented as a decision.
  if (/\d+(?:\.\d+)?\s*(?:-|–|to)\s*\d+(?:\.\d+)?\s*(?:hours?|hrs?|h\b|days?|d\b|weeks?|wks?|w\b|months?|mos?|years?|yrs?|y\b)/i.test(cleaned)) {
    return { n: null, unit: 'Months', raw };
  }
  const m = cleaned.match(UNIT_RE);
  if (!m) return { n: null, unit: 'Months', raw };
  return { n: Math.max(1, Math.round(parseFloat(m[1]))), unit: unitFromWord(m[2]) ?? 'Months', raw };
}

/** The one string shape stored on task_interval: "<n> <Unit>". */
export function canonicalInterval(n: number | null | undefined, unit: IntervalUnit | null | undefined): string | null {
  if (!n || !Number.isFinite(n) || n <= 0) return null;
  return `${Math.max(1, Math.round(n))} ${unit && INTERVAL_UNITS.includes(unit) ? unit : 'Months'}`;
}

/** First due date for a calendar cadence, from a start date. Meter cadences have none. */
export function nextDueFrom(n: number, unit: IntervalUnit, from: Date = new Date()): string | null {
  if (!CALENDAR_UNITS.has(unit)) return null;
  const d = new Date(from.getTime());
  if (unit === 'Days') d.setDate(d.getDate() + n);
  else if (unit === 'Weeks') d.setDate(d.getDate() + n * 7);
  else if (unit === 'Months') d.setMonth(d.getMonth() + n);
  else d.setFullYear(d.getFullYear() + n);
  return d.toISOString();
}

// ── Strategy vocabulary ─────────────────────────────────────────────────────

export const STRATEGY_CODES = ['PM_TIME', 'PM_CONDITION', 'PM_PREDICTIVE', 'RTF', 'REDESIGN', 'COMBINATION'] as const;
export type StrategyCode = typeof STRATEGY_CODES[number];

export function isStrategyCode(v: unknown): v is StrategyCode {
  return typeof v === 'string' && (STRATEGY_CODES as readonly string[]).includes(v);
}

/**
 * Which strategies become a recurring PM. Run-to-Failure schedules nothing by
 * definition; Redesign is a one-off change (a project or MOC), not a cadence.
 */
export function strategyProducesPM(code: string | null | undefined): boolean {
  return code === 'PM_TIME' || code === 'PM_CONDITION' || code === 'PM_PREDICTIVE' || code === 'COMBINATION';
}

/** Live recurring_work vocabulary is 'PM' (Work Management reads job_type into its own type map). */
export function strategyToJobType(_code: string | null | undefined): string {
  return 'PM';
}

/**
 * Consequence class → PM priority in the live P1..P4 vocabulary (the old
 * mapping wrote bare '1'/'2'/'3', which no Work Management surface recognises).
 */
export function consequenceToPriority(consequence: string | null | undefined): 'P1' | 'P2' | 'P3' {
  const rank: Record<string, number> = {
    SAFETY_ENV: 1, HIDDEN_SAFETY: 1,
    OPERATIONAL: 2, REPUTATION: 2,
    HIDDEN_NON_SAFETY: 3, REPAIR_COST: 3, NON_OPERATIONAL: 3,
  };
  let best = 3;
  for (const c of String(consequence || '').split(',').map(s => s.trim()).filter(Boolean)) {
    best = Math.min(best, rank[c] ?? 3);
  }
  return `P${best}` as 'P1' | 'P2' | 'P3';
}

// ── Specialist recommendation ───────────────────────────────────────────────

/** What the Specialist returns for Q6–Q7, normalised. Older rows carry only the first five fields. */
export interface AIRecommendation {
  strategy: string;
  reasoning: string;
  confidence: number;
  suggested_interval?: string;
  suggested_technology?: string;
  /** Imperative task statement — what the technician does. Never the reasoning. */
  task_description?: string | null;
  interval_value?: number | null;
  interval_unit?: IntervalUnit | null;
  task_owner_craft?: string | null;
  /** 2–4 sentence cost-benefit rationale for the decision record. */
  justification?: string | null;
  /** Stamped when the recommendation was applied to the decision. */
  accepted_at?: string | null;
}

const clean = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * Accept whatever shape the model (or an old row) produced and return one the
 * UI can rely on. Interval is canonicalised; an unparseable one becomes null
 * so the field asks for it instead of guessing.
 */
export function normalizeRecommendation(raw: unknown): AIRecommendation | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const strategy = clean(r.strategy).toUpperCase();
  const reasoning = String(r.reasoning ?? '').trim();
  if (!strategy && !reasoning) return null;

  const conf = Number(r.confidence);
  const confidence = Number.isFinite(conf) ? Math.min(1, Math.max(0, conf > 1 ? conf / 100 : conf)) : 0;

  let intervalValue: number | null = null;
  let intervalUnit: IntervalUnit | null = null;
  const iv = Number(r.interval_value);
  const iu = unitFromWord(typeof r.interval_unit === 'string' ? r.interval_unit : null);
  if (Number.isFinite(iv) && iv > 0 && iu) {
    intervalValue = Math.max(1, Math.round(iv));
    intervalUnit = iu;
  } else {
    const p = parseIntervalText(typeof r.suggested_interval === 'string' ? r.suggested_interval : '');
    if (p.n !== null) { intervalValue = p.n; intervalUnit = p.unit; }
  }

  const task = clean(r.task_description);
  const justification = String(r.justification ?? '').trim();

  return {
    strategy: isStrategyCode(strategy) ? strategy : strategy,
    reasoning,
    confidence,
    suggested_interval: typeof r.suggested_interval === 'string' ? r.suggested_interval : undefined,
    suggested_technology: typeof r.suggested_technology === 'string' ? r.suggested_technology : undefined,
    task_description: task ? task.slice(0, 200) : null,
    interval_value: intervalValue,
    interval_unit: intervalUnit,
    task_owner_craft: clean(r.task_owner_craft) || null,
    justification: justification || null,
    accepted_at: typeof r.accepted_at === 'string' ? r.accepted_at : null,
  };
}

/** The decision fields a recommendation fills — only what it actually carries. */
export function recommendationToDecisionUpdates(rec: AIRecommendation): {
  recommended_strategy_code?: string;
  task_description?: string;
  task_interval?: string;
  task_owner_craft?: string;
  justification?: string;
} {
  const out: ReturnType<typeof recommendationToDecisionUpdates> = {};
  if (isStrategyCode(rec.strategy)) out.recommended_strategy_code = rec.strategy;
  if (rec.task_description) out.task_description = rec.task_description;
  const interval = canonicalInterval(rec.interval_value, rec.interval_unit);
  if (interval) out.task_interval = interval;
  if (rec.task_owner_craft) out.task_owner_craft = rec.task_owner_craft;
  const just = rec.justification || rec.reasoning;
  if (just) out.justification = just;
  return out;
}

// ── Decision → PM row ───────────────────────────────────────────────────────

export interface DecisionForPM {
  id: string;
  recommended_strategy_code: string | null;
  task_description: string | null;
  task_interval: string | null;
  task_owner_craft: string | null;
  justification: string | null;
  consequence_code: string | null;
  recurring_work_id: string | null;
}

export interface StudyForPM { id: string; title: string; asset_id: string | null }

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PMBuildResult =
  | { ok: true; input: PMStrategyInput; meterCadence: boolean }
  | { ok: false; reason: string };

/** Deterministic, idempotent PM code — the same decision always maps to the same PM. */
export function pmCodeFor(studyId: string, decisionId: string): string {
  return `RCM-${studyId.slice(0, 8)}-${decisionId.slice(0, 8)}`;
}

/**
 * Build the PM input for one decision, or say exactly why it can't be built.
 * Reasons are written for the person reading the toast, not the log.
 */
export function buildPMFromDecision(
  study: StudyForPM,
  d: DecisionForPM,
  failureModeDescription: string,
  now: Date = new Date(),
): PMBuildResult {
  if (!study.asset_id || !UUID_RE.test(study.asset_id)) {
    return { ok: false, reason: 'the study is not linked to an asset in the register' };
  }
  if (d.recurring_work_id) return { ok: false, reason: `already generated as ${d.recurring_work_id}` };
  if (!strategyProducesPM(d.recommended_strategy_code)) {
    return {
      ok: false,
      reason: d.recommended_strategy_code === 'RTF'
        ? 'Run-to-Failure schedules no task'
        : d.recommended_strategy_code === 'REDESIGN'
          ? 'Redesign is a one-off change — raise a work order or MOC, not a PM'
          : 'no proactive strategy chosen',
    };
  }
  const task = String(d.task_description || '').trim();
  if (task.length < 3) return { ok: false, reason: 'no task description' };
  const iv = parseIntervalText(d.task_interval);
  if (iv.n === null) return { ok: false, reason: 'interval needs a value and unit' };

  const title = task.length > 120 ? `${task.slice(0, 117).trimEnd()}…` : task;
  const meterCadence = !CALENDAR_UNITS.has(iv.unit);
  const scheduleType = (meterCadence || d.recommended_strategy_code === 'PM_CONDITION') ? 'READING' : 'TIME';
  const consequence = d.consequence_code || 'unclassified';
  const description = [
    `RCM study "${study.title}" · Failure mode: ${failureModeDescription}`,
    `Strategy: ${d.recommended_strategy_code} · Consequence: ${consequence}${d.task_owner_craft ? ` · Craft: ${d.task_owner_craft}` : ''}`,
    d.justification ? `\n${d.justification}` : '',
  ].join('\n').trim();

  const nextDue = scheduleType === 'TIME' ? nextDueFrom(iv.n, iv.unit, now) : null;

  return {
    ok: true,
    meterCadence,
    input: {
      code: pmCodeFor(study.id, d.id),
      title,
      description,
      assetId: study.asset_id,
      scheduleType,
      frequencyInterval: iv.n,
      frequencyUnit: iv.unit,
      jobType: strategyToJobType(d.recommended_strategy_code),
      priorityCode: consequenceToPriority(d.consequence_code),
      leadTimeDays: 7,
      ...(nextDue ? { nextDueDate: nextDue } : {}),
      origin: {
        source: 'rcm',
        study_id: study.id,
        decision_id: d.id,
        strategy_code: d.recommended_strategy_code,
        consequence_code: d.consequence_code ?? null,
        task_owner_craft: d.task_owner_craft ?? null,
        created_at: now.toISOString(),
      },
    },
  };
}
