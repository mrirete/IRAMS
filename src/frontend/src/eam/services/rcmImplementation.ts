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

/** The steps that implement a decision, in order, with what is already done. */
export function implementationSteps(d: ImplDecisionLike, opts: { sparesNamed?: boolean } = {}): ImplStep[] {
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
    if (readsBySensor(tech)) {
      steps.push({ kind: 'SENSOR', module: 'predict', label: 'Connect the sensor in Predict', hint: `${tech} feeds the point; an alert on its band raises the work order.`, done: false });
    } else {
      steps.push({ kind: 'PM', module: 'work', label: 'Create the inspection PM', hint: 'The round that reads the point at the interval and acts on the P-F warning.', done: pmDone });
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

export type ImplState = 'undecided' | 'ready' | 'partial' | 'done';
export function implementationState(steps: ImplStep[], decided: boolean): ImplState {
  if (!decided || steps.length === 0) return 'undecided';
  const done = steps.filter(s => s.done).length;
  if (done === 0) return 'ready';
  return done === steps.length ? 'done' : 'partial';
}
