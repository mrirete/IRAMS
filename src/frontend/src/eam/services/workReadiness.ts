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

export type ReadinessGate = 'PLAN' | 'CLOSE';
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

// Placeholder step names that don't represent a real plan (empty / default-added).
const PLACEHOLDER_TASK_NAMES = new Set(['', 'new task step', 'new task', 'untitled step', 'untitled']);

// A job plan exists only if at least one task is actually *set*: either a real
// (non-placeholder) step name OR a non-empty instruction. An empty "Untitled step"
// with a blank instruction box does NOT count.
export const hasJobPlan = (wo: WorkOrder): boolean =>
  (wo.tasks || []).some(t => {
    const name = String(t.description || '').trim().toLowerCase();
    const named = name.length > 0 && !PLACEHOLDER_TASK_NAMES.has(name);
    const hasInstruction = (t.instructions || []).some(b => String((b as { label?: string }).label || '').trim().length > 0);
    return named || hasInstruction;
  });

export const hasJSA = (wo: WorkOrder): boolean =>
  !!(wo.jsa && wo.jsa.hazards && wo.jsa.hazards.length > 0);

/**
 * Lightweight Planned-vs-Reactive classification — no item scoring. Use this for
 * list rows / KPI rollups where only the classification is needed.
 */
export const hasLabour = (wo: WorkOrder): boolean => (wo.labor || []).length > 0;

export function classifyWork(wo: WorkOrder): WorkClassification {
  // A job is properly planned only with task steps + an effort estimate + labour
  // resourced. (No tasks / no duration / no resources = not a plan.)
  const isPlanned = hasJobPlan(wo) && estimatedHours(wo) > 0 && hasLabour(wo);
  if (isPreventiveWork(wo) || isPlanned) return 'PROACTIVE';
  if (EXECUTION_STATES.includes(String(wo.status))) return 'REACTIVE';
  return 'UNCLASSIFIED';
}

export interface AssessOptions {
  /** Criticality of the linked asset (A/B = high), used to flag mandatory items. */
  criticality?: 'A' | 'B' | 'C' | 'D' | string | null;
}

export function assessReadiness(wo: WorkOrder, opts: AssessOptions = {}): ReadinessResult {
  const crit = String(opts.criticality || '').toUpperCase();
  const isHighCriticality = crit === 'A' || crit === 'B';

  const planned = hasJobPlan(wo);
  const est = estimatedHours(wo);
  const labourSet = hasLabour(wo);
  const partsSet = (wo.inventory || []).length > 0;
  const preventive = isPreventiveWork(wo);

  const items: ReadinessItem[] = [
    { id: 'asset', label: 'Asset linked', met: !!wo.assetId, severity: 'required', hint: 'Link the work order to the asset it is performed on.' },
    { id: 'scope', label: 'Scope described', met: !!(wo.description && wo.description.trim()), severity: 'required', hint: 'State what is to be done and why.' },
    { id: 'steps', label: 'Task steps', met: planned, severity: 'required', hint: 'Define the procedure — at least one real task step.' },
    { id: 'estimate', label: 'Effort estimated', met: est > 0, severity: 'required', hint: 'Estimate labour hours — ideally on each step.' },
    { id: 'labour', label: 'Labour', met: labourSet, severity: 'required', hint: 'Assign at least one labour craft/person to do the work.' },
    // Parts are job-dependent — an inspection/PM legitimately needs none, so this
    // is recommended (and auto-satisfied for preventive work) rather than required.
    { id: 'parts', label: 'Parts', met: partsSet || preventive, severity: 'recommended', hint: 'Identify spare parts/materials to kit. Often none for inspections/PMs.' },
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
  const classification = classifyWork(wo);

  return { gate: 'PLAN', score, requiredMet, items, blockers, classification, isHighCriticality };
}

// ─────────────────────────────────────────────────────────────────────────────
// Gate 2: CLOSEOUT QUALITY — is the work being closed to a trustworthy record?
// "Quality reporting / close-out" — work that skips it is reactive even if it was
// well planned. ISO 14224 failure coding for corrective work; documented findings;
// completed steps; actuals for future planning.
// ─────────────────────────────────────────────────────────────────────────────
export interface CloseoutOptions {
  /** Preventive/inspection work skips mandatory failure coding (code only if a defect was found). */
  isPreventive?: boolean;
}

export function assessCloseout(wo: WorkOrder, opts: CloseoutOptions = {}): ReadinessResult {
  const preventive = opts.isPreventive ?? isPreventiveWork(wo);
  const tasks = wo.tasks || [];
  // If there are no steps, that's a planning gap — don't double-penalise it here.
  const tasksDone = tasks.length === 0 ? true : tasks.every(t => String(t.status).toUpperCase() === 'COMPLETED');
  const documented = (wo.journals || []).length > 0;
  const hasMode = !!wo.failureData?.failureMode;
  const hasCause = !!wo.failureData?.failureCause;
  const actuals = (!!wo.actualDuration && wo.actualDuration > 0) || (wo.labor || []).some(l => (l.actualDuration || 0) > 0);

  const items: ReadinessItem[] = [
    { id: 'tasks-done', label: 'Tasks completed', met: tasksDone, severity: 'required', hint: 'Mark every task step complete before closing.' },
    { id: 'documented', label: 'Work documented', met: documented, severity: 'required', hint: 'Record what was found and what was done (findings/journal).' },
    { id: 'failure-mode', label: 'Failure mode', met: preventive ? true : hasMode, severity: preventive ? 'recommended' : 'required', hint: preventive ? 'PM — only code a failure if a defect was found.' : 'ISO 14224: record the failure mode (damage code).' },
    { id: 'failure-cause', label: 'Cause coded', met: preventive ? true : hasCause, severity: 'recommended', hint: 'ISO 14224: record the failure cause/mechanism so analytics can learn from it.' },
    { id: 'actuals', label: 'Actuals recorded', met: actuals, severity: 'recommended', hint: 'Capture actual labour hours vs estimate to sharpen future planning.' },
  ];

  const weight = (it: ReadinessItem) => (it.severity === 'required' ? 2 : 1);
  const totalW = items.reduce((s, it) => s + weight(it), 0);
  const metW = items.reduce((s, it) => s + (it.met ? weight(it) : 0), 0);
  const score = totalW === 0 ? 0 : Math.round((metW / totalW) * 100);
  const blockers = items.filter(it => it.severity === 'required' && !it.met);
  const requiredMet = blockers.length === 0;

  return { gate: 'CLOSE', score, requiredMet, items, blockers, classification: 'UNCLASSIFIED', isHighCriticality: false };
}
