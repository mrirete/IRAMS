/**
 * rcmImplementation — what a decision becomes, and in which module.
 *
 * Strategy (Q6–Q7) answers "what should we do"; the Maintenance Plan answers
 * "make it real". That is a different thing per strategy and task type:
 *
 *   Time-Based (restoration / discard)        → a PM in Work Management
 *   Condition-Based, on-condition by a person → a monitoring point, then an inspection PM that reads it
 *   Condition-Based, on-condition by a sensor → a monitoring point, then a sensor feed + alert in Predict
 *   Condition-Based, failure-finding          → a failure-finding test PM
 *   Run-to-Failure                            → nothing scheduled; the spare must be stocked
 *   Redesign                                  → a one-off work order (or MOC)
 *
 * Pure functions — no I/O.
 */
import { canonicalStrategyCode, isLegacyStrategyCode } from './rcmPlan';

export type ImplStepKind = 'PM' | 'POINT' | 'SENSOR' | 'WO' | 'SPARES';
export type ImplModule = 'work' | 'readings' | 'predict' | 'inventory';
export interface ImplStep {
  kind: ImplStepKind;
  module: ImplModule;
  label: string;
  hint: string;
  done: boolean;
}
export interface ImplDecisionLike {
  recommended_strategy_code: string | null;
  task_type_code?: string | null;
  recurring_work_id?: string | null;
  reading_definition_id?: string | null;
  work_order_id?: string | null;
  on_condition_technology?: string | null;
  ai_recommendation?: unknown;
}

/** The monitoring technology a condition-based decision names, from either column. */
export function decisionTechnology(d: ImplDecisionLike): string | null {
  const ai = d.ai_recommendation as { suggested_technology?: string | null } | null | undefined;
  const t = String(d.on_condition_technology || ai?.suggested_technology || '').trim();
  return t || null;
}

/**
 * Is the condition read by an instrument that streams it (Predict), or by a
 * person on a round (an inspection PM)? Route-based PdM — thermography, oil
 * sampling, a handheld vibration meter — is a person with a tool: a round.
 */
export function readsBySensor(technology: string | null | undefined): boolean {
  const t = String(technology || '').toLowerCase();
  if (!t) return false;
  return /\b(online|on-line|continuous|permanent|installed|fixed|wireless|iot|telemetry|scada|dcs|plc|transmitter|sensor|sensors|probe|streaming|real[- ]?time)\b/.test(t);
}

/**
 * Does the technology also name a person's work — a sample, a lab, a
 * handheld tool, a visual check? "Vibration analysis and oil sampling
 * (online sensors …, periodic lab analysis)" is BOTH a sensor and a round;
 * the round half must not be dropped because the sentence says "online".
 */
export function readsByPerson(technology: string | null | undefined): boolean {
  const t = String(technology || '').toLowerCase();
  if (!t) return false;
  return /\b(oil\s+(sampl\w*|analys\w*)|lab(oratory)?\s+analys\w*|sampl(e|es|ing)|thermograph\w*|infrared|handheld|hand-held|portable|visual|inspect\w*|manual(ly)?|round|route|walk-?down|ultrason\w*|borescope|dye\s+penetrant|spot\s+check|gauge\s+read\w*|log\s+the\s+reading)\b/.test(t);
}

export interface ImplOptions {
  sparesNamed?: boolean;
  /**
   * Does the asset actually have a live feed for this point (a sensor tag on
   * the definition, or non-manual readings arriving)? Undefined = unknown.
   * Without a feed a sensor-read decision is a paper task: the plan then
   * also offers the inspection PM that has a person take the reading until
   * the feed is connected.
   */
  hasFeed?: boolean;
}

/** The steps that implement a decision, in order, with what is already done. */
export function implementationSteps(d: ImplDecisionLike, opts: ImplOptions = {}): ImplStep[] {
  const code = canonicalStrategyCode(d.recommended_strategy_code);
  if (!code || isLegacyStrategyCode(code)) return [];
  const pmDone = !!d.recurring_work_id;
  if (code === 'PM_TIME') {
    return [{ kind: 'PM', module: 'work', label: 'Create the PM', hint: 'Scheduled restoration or discard at the interval. Job plan, craft and spares travel with it.', done: pmDone }];
  }
  if (code === 'PM_CONDITION') {
    if (d.task_type_code === 'FAILURE_FINDING') {
      return [{ kind: 'PM', module: 'work', label: 'Create the failure-finding PM', hint: 'A scheduled test that the hidden function still works.', done: pmDone }];
    }
    const pointDone = !!d.reading_definition_id;
    const tech = decisionTechnology(d);
    const steps: ImplStep[] = [
      { kind: 'POINT', module: 'readings', label: 'Create the monitoring point', hint: 'The measured parameter, its unit, alarm bands and P-F interval: what the task actually reads.', done: pointDone },
    ];
    const sensor = readsBySensor(tech);
    const person = readsByPerson(tech);
    if (sensor) {
      steps.push({ kind: 'SENSOR', module: 'predict', label: 'Connect the sensor in Predict', hint: `${tech} feeds the point; an alert on its band raises the work order.`, done: opts.hasFeed === true });
    }
    // A person reads the point when the technology says so, when nothing
    // streams it, or — for a sensor-read decision — while no feed exists yet.
    if (!sensor || person || opts.hasFeed === false) {
      const why = !sensor
        ? 'The round that reads the point at the interval and acts on the P-F warning.'
        : person
          ? 'The sample or inspection half of this task is a person on a round; the sensor covers the rest.'
          : 'No feed reaches this point yet — a person logs the reading at the interval until the sensor is connected.';
      steps.push({ kind: 'PM', module: 'work', label: 'Create the inspection PM', hint: why, done: pmDone });
    }
    return steps;
  }
  if (code === 'RTF') {
    return [{ kind: 'SPARES', module: 'inventory', label: 'Confirm the spare is stocked', hint: 'Run-to-Failure schedules nothing; the repair is only as fast as the spare.', done: !!opts.sparesNamed }];
  }
  if (code === 'REDESIGN') {
    return [{ kind: 'WO', module: 'work', label: 'Raise the redesign work order', hint: 'A one-off change to the design, procedure or operating context. A work order or MOC, not a schedule.', done: !!d.work_order_id }];
  }
  return [];
}

/** Where an open implementation stands against its due date (0336). */
export type DueState = 'overdue' | 'due-soon' | 'scheduled' | 'unscheduled' | null;
export function dueState(dueDate: string | null | undefined, state: ImplState, today: Date = new Date()): DueState {
  if (state === 'done' || state === 'undecided') return null;
  if (!dueDate) return 'unscheduled';
  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return 'unscheduled';
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((due.getTime() - t0.getTime()) / 86400000);
  if (days < 0) return 'overdue';
  if (days <= 7) return 'due-soon';
  return 'scheduled';
}

export type ImplState = 'undecided' | 'ready' | 'partial' | 'done';
export function implementationState(steps: ImplStep[], decided: boolean): ImplState {
  if (!decided || steps.length === 0) return 'undecided';
  const done = steps.filter(s => s.done).length;
  if (done === 0) return 'ready';
  return done === steps.length ? 'done' : 'partial';
}
