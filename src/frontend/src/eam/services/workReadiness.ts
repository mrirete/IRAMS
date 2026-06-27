// ─────────────────────────────────────────────────────────────────────────────
// Work Maturity / Readiness engine — Gate 1: PLANNING
//
// Pure, side-effect-free assessment of whether a work order has been *planned*
// to best practice (Doc Palmer / SMRP planning & scheduling discipline) before it
// is scheduled or executed. Drives the advisory Readiness strip on the WO, the
// Planned-vs-Reactive classification, and (later) enforced gates by criticality.
//
// "Any job that skips planning, resourcing and quality close-out is reactive
// work." This file makes that measurable.
// ─────────────────────────────────────────────────────────────────────────────
import { WorkOrder, WorkOrderStatus } from '../types';

export type ReadinessGate = 'PLAN';
export type ReadinessSeverity = 'required' | 'recommended';
export type WorkClassification = 'PROACTIVE' | 'REACTIVE' | 'UNCLASSIFIED';

export interface ReadinessItem {
  id: string;
  label: string;
  met: boolean;
  severity: ReadinessSeverity;
  hint: string;
}

export interface ReadinessResult {
  gate: ReadinessGate;
  score: number;            // 0–100, weighted (required counts 2×, recommended 1×)
  requiredMet: boolean;     // all 'required' items satisfied
  items: ReadinessItem[];
  blockers: ReadinessItem[]; // unmet 'required' items — what to fix next
  classification: WorkClassification;
  isHighCriticality: boolean;
}

// Preventive / proactive work types are inherently planned. Matches both
// dictionary codes (PM, PdM) and human values (Preventive, Predictive, …).
const PREVENTIVE_KEYWORDS = ['PM', 'PREVENTIVE', 'PREVENTATIVE', 'PDM', 'PREDICTIVE', 'SCHEDULED', 'INSPECTION', 'ROUTINE'];
export const isPreventiveWork = (wo: Pick<WorkOrder, 'type'>): boolean => {
  const t = String(wo.type || '').toUpperCase();
  return PREVENTIVE_KEYWORDS.some(k => t.includes(k));
};

const EXECUTION_STATES: string[] = [
  WorkOrderStatus.WIP, WorkOrderStatus.WAIT, WorkOrderStatus.TECO, WorkOrderStatus.CLOSED,
];

export const estimatedHours = (wo: WorkOrder): number => {
  if (wo.estDuration && wo.estDuration > 0) return wo.estDuration;
  return (wo.tasks || []).reduce((s, t) => s + (t.estHours || 0), 0);
};

export const hasJobPlan = (wo: WorkOrder): boolean =>
  (wo.tasks || []).some(t => (t.instructions || []).length > 0);

export const hasJSA = (wo: WorkOrder): boolean =>
  !!(wo.jsa && wo.jsa.hazards && wo.jsa.hazards.length > 0);

export interface AssessOptions {
  /** Criticality of the linked asset (A/B = high), used to flag mandatory items. */
  criticality?: 'A' | 'B' | 'C' | 'D' | string | null;
}

export function assessReadiness(wo: WorkOrder, opts: AssessOptions = {}): ReadinessResult {
  const crit = String(opts.criticality || '').toUpperCase();
  const isHighCriticality = crit === 'A' || crit === 'B';

  const planned = hasJobPlan(wo);
  const est = estimatedHours(wo);

  const items: ReadinessItem[] = [
    { id: 'asset', label: 'Asset linked', met: !!wo.assetId, severity: 'required', hint: 'Link the work order to the asset it is performed on.' },
    { id: 'scope', label: 'Scope described', met: !!(wo.description && wo.description.trim()), severity: 'required', hint: 'State what is to be done and why.' },
    { id: 'plan', label: 'Job plan', met: planned, severity: 'required', hint: 'Add at least one task step with instructions.' },
    { id: 'estimate', label: 'Effort estimated', met: est > 0, severity: 'required', hint: 'Estimate duration (hrs) so the job can be scheduled.' },
    { id: 'safety', label: 'Safety (JSA)', met: hasJSA(wo), severity: isHighCriticality ? 'required' : 'recommended', hint: isHighCriticality ? 'Criticality A/B work requires a hazard assessment.' : 'Assess hazards for this task.' },
  ];

  const weight = (it: ReadinessItem) => (it.severity === 'required' ? 2 : 1);
  const totalW = items.reduce((s, it) => s + weight(it), 0);
  const metW = items.reduce((s, it) => s + (it.met ? weight(it) : 0), 0);
  const score = totalW === 0 ? 0 : Math.round((metW / totalW) * 100);

  const blockers = items.filter(it => it.severity === 'required' && !it.met);
  const requiredMet = blockers.length === 0;

  // Planned vs Reactive: preventive work and fully-planned corrective work are
  // proactive; corrective work that reached execution without a plan is reactive;
  // corrective work still being planned is unclassified (in flight).
  const isPlanned = planned && est > 0;
  const reachedExecution = EXECUTION_STATES.includes(String(wo.status));
  let classification: WorkClassification;
  if (isPreventiveWork(wo) || isPlanned) classification = 'PROACTIVE';
  else if (reachedExecution) classification = 'REACTIVE';
  else classification = 'UNCLASSIFIED';

  return { gate: 'PLAN', score, requiredMet, items, blockers, classification, isHighCriticality };
}
