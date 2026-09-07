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
const RANGE_RE = /\d+(?:\.\d+)?\s*(?:-|–|to)\s*\d+(?:\.\d+)?\s*(?:hours?|hrs?|h\b|days?|d\b|weeks?|wks?|w\b|months?|mos?|years?|yrs?|y\b)/i;

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
 * caller must surface that, never default it. A range ("12-24 months") is
 * not a cadence either: picking a bound would be a guess presented as a decision.
 */
export function parseIntervalText(text: string | null | undefined): { n: number | null; unit: IntervalUnit; raw: string } {
  const raw = String(text ?? '').trim();
  const cleaned = raw.replace(/,/g, '');
  if (RANGE_RE.test(cleaned)) return { n: null, unit: 'Months', raw };
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

/** Calendar days for a strategy package (0292 absorption works on day multiples). */
export function intervalDaysFor(n: number, unit: IntervalUnit): number | null {
  if (!CALENDAR_UNITS.has(unit)) return null;
  const per: Record<string, number> = { Days: 1, Weeks: 7, Months: 30, Years: 365 };
  return n * per[unit];
}

/** Package label in the house style of the strategy catalogue: 1M / 3M / 12M / 2W / 1Y. */
export function packageLabelFor(n: number, unit: IntervalUnit): string {
  const letter: Record<IntervalUnit, string> = { Hours: 'H', Days: 'D', Weeks: 'W', Months: 'M', Years: 'Y' };
  return `${n}${letter[unit]}`;
}

// ── Strategy vocabulary ─────────────────────────────────────────────────────

/**
 * The five JA1012 outcomes the Strategy tab offers. "Combined" was retired on
 * 2026-09-05: it named no task type, so it scheduled nothing specific.
 */
export const STRATEGY_CODES = ['PM_TIME', 'PM_CONDITION', 'PM_PREDICTIVE', 'RTF', 'REDESIGN'] as const;
export type StrategyCode = typeof STRATEGY_CODES[number];
export const LEGACY_STRATEGY_CODES = ['COMBINATION'] as const;

export function isStrategyCode(v: unknown): v is StrategyCode {
  return typeof v === 'string' && (STRATEGY_CODES as readonly string[]).includes(v);
}
export function isLegacyStrategyCode(v: unknown): boolean {
  return typeof v === 'string' && (LEGACY_STRATEGY_CODES as readonly string[]).includes(v);
}

/**
 * Which strategies become a recurring PM. Run-to-Failure schedules nothing by
 * definition; Redesign is a one-off change (a project or MOC), not a cadence.
 */
export function strategyProducesPM(code: string | null | undefined): boolean {
  return code === 'PM_TIME' || code === 'PM_CONDITION' || code === 'PM_PREDICTIVE';
}

/** SAE JA1012 §11 task types — the thing a strategy actually schedules. */
export const TASK_TYPES = ['ON_CONDITION', 'SCHEDULED_RESTORATION', 'SCHEDULED_DISCARD', 'FAILURE_FINDING'] as const;
export type TaskTypeCode = typeof TASK_TYPES[number];
export const TASK_TYPE_LABELS: Record<TaskTypeCode, { label: string; hint: string }> = {
  ON_CONDITION:          { label: 'On-condition',          hint: 'Inspect or measure at an interval shorter than the P-F interval; act on the potential failure' },
  SCHEDULED_RESTORATION: { label: 'Scheduled restoration', hint: 'Rework or overhaul the item at or before a fixed age, whatever its condition' },
  SCHEDULED_DISCARD:     { label: 'Scheduled discard',     hint: 'Replace the item at or before a fixed age, whatever its condition' },
  FAILURE_FINDING:       { label: 'Failure-finding',       hint: 'Check whether a hidden function still works (protective devices)' },
};

/** Task types that make sense for a strategy; the first is the default. */
export function taskTypesFor(strategy: string | null | undefined, hidden = false): TaskTypeCode[] {
  if (strategy === 'PM_TIME') return ['SCHEDULED_RESTORATION', 'SCHEDULED_DISCARD'];
  if (strategy === 'PM_CONDITION') return hidden ? ['FAILURE_FINDING', 'ON_CONDITION'] : ['ON_CONDITION', 'FAILURE_FINDING'];
  if (strategy === 'PM_PREDICTIVE') return ['ON_CONDITION'];
  return [];
}
export function isTaskTypeCode(v: unknown): v is TaskTypeCode {
  return typeof v === 'string' && (TASK_TYPES as readonly string[]).includes(v);
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
  task_type?: TaskTypeCode | null;
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
 * Does this read as an argument rather than an instruction? Markdown bold,
 * a numbered list, an "Applying …" preamble, or several sentences of length.
 */
export function looksLikeReasoning(text: string | null | undefined): boolean {
  const t = String(text ?? '').trim();
  if (!t) return false;
  if (/\*\*/.test(t)) return true;
  if (/^(applying|according to|based on|following)\b/i.test(t)) return true;
  if (/(^|\n)\s*\d+\.\s/.test(t)) return true;
  const sentences = t.split(/[.!?](\s|$)/).filter(s => s.trim().length > 0).length;
  return t.length > 200 && sentences >= 3;
}

/**
 * Accept whatever shape the model (or an old row) produced and return one the
 * UI can rely on. Interval is canonicalised; an unparseable one becomes null
 * so the field asks for it instead of guessing. A legacy "COMBINATION"
 * strategy is dropped — the person picks the one that applies.
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

  // The task line is ONE instruction for the technician. Older drafts put the
  // whole JA1012 argument there ("Applying SAE JA1012 decision logic: 1.
  // **Consequence Analysis:** …"); that is a justification, so file it as one
  // and leave the task blank for the real instruction.
  const rawTask = String(r.task_description ?? '').trim();
  const taskIsReasoning = looksLikeReasoning(rawTask);
  const task = taskIsReasoning ? '' : clean(rawTask);
  const justification = String(r.justification ?? '').trim() || (taskIsReasoning ? rawTask : '');
  const taskType = clean(r.task_type).toUpperCase();

  return {
    strategy: isStrategyCode(strategy) ? strategy : '',
    reasoning,
    confidence,
    suggested_interval: typeof r.suggested_interval === 'string' ? r.suggested_interval : undefined,
    suggested_technology: typeof r.suggested_technology === 'string' ? r.suggested_technology : undefined,
    task_description: task ? task.slice(0, 200) : null,
    task_type: isTaskTypeCode(taskType) ? taskType : null,
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
  task_type_code?: string;
  task_description?: string;
  task_interval?: string;
  task_owner_craft?: string;
  justification?: string;
} {
  const out: ReturnType<typeof recommendationToDecisionUpdates> = {};
  if (isStrategyCode(rec.strategy)) out.recommended_strategy_code = rec.strategy;
  if (rec.task_type && taskTypesFor(rec.strategy).includes(rec.task_type)) out.task_type_code = rec.task_type;
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
  task_type_code?: string | null;
  task_description: string | null;
  task_interval: string | null;
  task_owner_craft: string | null;
  justification: string | null;
  consequence_code: string | null;
  recurring_work_id: string | null;
  spares_requirements?: { part_number: string; description?: string; qty: number }[];
}

export interface StudyForPM { id: string; title: string; asset_id: string | null; revision?: number | null }

/** A Task Library job plan, already resolved by the caller. */
export interface JobPlanForPM {
  id: string;
  code?: string;
  title: string;
  estimatedHours?: number;
  instructions?: unknown[];
  roles?: { contactType: string; headcount?: number; hours?: number }[];
  inventory?: { inventoryId: string; description?: string; qty?: number }[];
}

/** A spare the caller matched to a stock item (so the WO parts line can reserve it). */
export interface SpareMatch { part_number: string; description?: string; qty: number; inventoryId: string | null }

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PMBuildResult =
  | { ok: true; input: PMStrategyInput; meterCadence: boolean; packageLabel: string | null; intervalDays: number | null }
  | { ok: false; reason: string };

/** Deterministic, idempotent PM code — the same decision always maps to the same PM. */
export function pmCodeFor(studyId: string, decisionId: string): string {
  return `RCM-${studyId.slice(0, 8)}-${decisionId.slice(0, 8)}`;
}

/** First sentence(s) of a justification, capped — the PM record is not the place for the essay. */
export function briefJustification(text: string | null | undefined, max = 280): string {
  const t = String(text || '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return (end > 80 ? cut.slice(0, end + 1) : cut.trimEnd() + '…');
}

/**
 * Build the PM input for one decision, or say exactly why it can't be built.
 * Reasons are written for the person reading the toast, not the log.
 *
 * The PM carries a job plan: the decision's task as the first step (or the
 * Task Library plan's steps when one is attached), the craft as a planned
 * labour line, and the named spares as planned parts. That is what turns an
 * RCM decision into work a technician can be handed.
 */
export function buildPMFromDecision(
  study: StudyForPM,
  d: DecisionForPM,
  failureModeDescription: string,
  opts: { now?: Date; jobPlan?: JobPlanForPM | null; spares?: SpareMatch[] } = {},
): PMBuildResult {
  const now = opts.now ?? new Date();
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
          : isLegacyStrategyCode(d.recommended_strategy_code)
            ? '"Combined" is retired — choose the one strategy that applies'
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
  const taskType = isTaskTypeCode(d.task_type_code) ? TASK_TYPE_LABELS[d.task_type_code].label : null;
  const brief = briefJustification(d.justification);
  const description = [
    `RCM study "${study.title}"${study.revision ? ` rev ${study.revision}` : ''} · Failure mode: ${failureModeDescription}`,
    `Strategy: ${d.recommended_strategy_code}${taskType ? ` (${taskType})` : ''} · Consequence: ${consequence}${d.task_owner_craft ? ` · Craft: ${d.task_owner_craft}` : ''}`,
    brief ? `\n${brief}` : '',
  ].join('\n').trim();

  const nextDue = scheduleType === 'TIME' ? nextDueFrom(iv.n, iv.unit, now) : null;

  // ── job plan ──
  const plan = opts.jobPlan ?? null;
  const est = Number(plan?.estimatedHours) || 0;
  const tasks = [{
    sequence: 10,
    description: task,
    estHours: est,
    instructions: plan && Array.isArray(plan.instructions) ? plan.instructions : [],
    controlKey: 'PM01',
  }];
  const labor: { contactType: string; estDuration: number }[] = [];
  if (plan?.roles?.length) {
    for (const r of plan.roles) labor.push({ contactType: r.contactType, estDuration: Number(r.hours) || est || 0 });
  } else if (d.task_owner_craft) {
    labor.push({ contactType: d.task_owner_craft, estDuration: est });
  }
  const inventory: { inventoryId: string | null; description: string; estQty: number }[] = [];
  const seen = new Set<string>();
  for (const s of opts.spares ?? []) {
    const key = s.inventoryId || s.part_number || s.description || '';
    if (!key || seen.has(key)) continue;
    seen.add(key);
    inventory.push({ inventoryId: s.inventoryId, description: [s.part_number, s.description].filter(Boolean).join(' — '), estQty: Math.max(1, Number(s.qty) || 1) });
  }
  for (const i of plan?.inventory ?? []) {
    if (!i.inventoryId || seen.has(i.inventoryId)) continue;
    seen.add(i.inventoryId);
    inventory.push({ inventoryId: i.inventoryId, description: i.description || '', estQty: Math.max(1, Number(i.qty) || 1) });
  }

  return {
    ok: true,
    meterCadence,
    packageLabel: meterCadence ? null : packageLabelFor(iv.n, iv.unit),
    intervalDays: intervalDaysFor(iv.n, iv.unit),
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
      estDuration: est,
      templates: { tasks, labor, inventory, jsa: null },
      ...(nextDue ? { nextDueDate: nextDue } : {}),
      origin: {
        source: 'rcm',
        study_id: study.id,
        study_revision: study.revision ?? 1,
        decision_id: d.id,
        strategy_code: d.recommended_strategy_code,
        task_type_code: d.task_type_code ?? null,
        consequence_code: d.consequence_code ?? null,
        task_owner_craft: d.task_owner_craft ?? null,
        job_plan_id: plan?.id ?? null,
        created_at: now.toISOString(),
      },
    },
  };
}
