// ─────────────────────────────────────────────────────────────────────────────
// RCM Study readiness — when has the team given the Reliability Specialist
// enough to work with?
//
// The Specialist is a role, not a button: it drafts and completes an RCM
// worksheet on the team's behalf. But an RCM answer is only as good as the
// operating context it is grounded in — asked about an asset with no register
// link and no duty description, the model invents a generic pump study that the
// facilitator then has to unpick. So every Specialist action is gated on the
// minimum data that makes its answer specific to *this* asset.
//
// Deliberately NOT gated: the things the Specialist is there to supply. Drafting
// is gated on asset + context, never on "you must already have failure modes";
// completing a row is gated on the mode being named, never on the effects the
// Specialist is being asked to write.
//
// Pure functions — no I/O, no React. The UI reads {ok, missing, reason} and
// teaches with it.
// ─────────────────────────────────────────────────────────────────────────────
import type { RCMStudy, RCMFunction, RCMFailureMode, RCMDecision } from './RCMService';
import type { ActionGate } from './workReadiness';

export type { ActionGate };

export type RCMReadinessSeverity = 'required' | 'recommended';

export interface RCMReadinessItem {
  id: string;
  label: string;
  met: boolean;
  severity: RCMReadinessSeverity;
  hint: string;
}

export interface RCMReadinessResult {
  score: number;              // 0–100, weighted (required 2×, recommended 1×)
  requiredMet: boolean;       // the Specialist may act
  items: RCMReadinessItem[];
  blockers: RCMReadinessItem[];
}

/** An operating context shorter than this is a label, not a context. */
export const MIN_CONTEXT_CHARS = 40;

const text = (v: string | null | undefined): string => String(v || '').trim();
const described = (v: string | null | undefined, min = 3): boolean => text(v).length >= min;

const gate = (missing: string[], readyReason: string, blockedPrefix: string): ActionGate => ({
  ok: missing.length === 0,
  missing,
  reason: missing.length === 0 ? readyReason : `${blockedPrefix}: ${missing.join(', ')}.`,
});

// ── Study-level data readiness ───────────────────────────────────────────────

/**
 * What the Specialist needs before it can draft this study, plus the softer
 * items that make its draft sharper. Drives the readiness chips on the
 * Specialist bar so the team can see exactly what to fill.
 */
export function assessStudyData(
  study: RCMStudy,
  functions: RCMFunction[] = [],
  failureModes: RCMFailureMode[] = [],
): RCMReadinessResult {
  const context = text(study.operating_context);

  const items: RCMReadinessItem[] = [
    {
      id: 'asset',
      label: 'Asset linked',
      met: !!study.asset_id,
      severity: 'required',
      hint: 'Link the study to the asset in the register — the Specialist reads its type, criticality, make and model.',
    },
    {
      id: 'context',
      label: 'Operating context',
      met: context.length >= MIN_CONTEXT_CHARS,
      severity: 'required',
      hint: `Describe duty cycle, environment, load profile and redundancy (at least ${MIN_CONTEXT_CHARS} characters). This is what makes the failure modes specific to your plant rather than generic.`,
    },
    {
      id: 'title',
      label: 'Study named',
      met: described(study.title, 4),
      severity: 'required',
      hint: 'Give the study a title that names the asset and its service.',
    },
    {
      id: 'functions',
      label: 'Functions drafted',
      met: functions.some(f => described(f.function_description)),
      severity: 'recommended',
      hint: 'One described function is enough to steer the draft. The Specialist can write these for you.',
    },
    {
      id: 'modes',
      label: 'Failure modes',
      met: failureModes.some(fm => described(fm.failure_mode_description)),
      severity: 'recommended',
      hint: 'Known failure modes from history keep the study grounded. The Specialist can propose the rest.',
    },
  ];

  const weight = (it: RCMReadinessItem) => (it.severity === 'required' ? 2 : 1);
  const totalW = items.reduce((s, it) => s + weight(it), 0);
  const metW = items.reduce((s, it) => s + (it.met ? weight(it) : 0), 0);
  const blockers = items.filter(it => it.severity === 'required' && !it.met);

  return {
    score: totalW === 0 ? 0 : Math.round((metW / totalW) * 100),
    requiredMet: blockers.length === 0,
    items,
    blockers,
  };
}

// ── Action gates ─────────────────────────────────────────────────────────────

/**
 * Draft the worksheet — functions, functional failures, failure modes and
 * effects for the whole asset. The most expensive call in the module, and the
 * one most damaged by thin input: with no asset and no context it returns a
 * textbook study for an unnamed machine.
 */
export function canSpecialistDraft(readiness: RCMReadinessResult): ActionGate {
  return gate(
    readiness.blockers.map(b => b.label),
    'Have the Reliability Specialist draft functions, failure modes and effects for this asset',
    'The Specialist needs the asset and its operating context before it can draft this study. Still missing',
  );
}

/**
 * Propose the failure modes for one function. Needs the function and the way it
 * fails — the mode list hangs off the functional failure, so without it the
 * Specialist is guessing at what "failed" means here.
 */
export function canSpecialistExpandFunction(fn: RCMFunction): ActionGate {
  const missing: string[] = [];
  if (!described(fn.function_description, 8)) missing.push('Function described');
  if (!described(fn.functional_failure, 5)) missing.push('Functional failure described');
  return gate(
    missing,
    'Have the Specialist propose the failure modes for this function',
    'Describe this function and how it fails first. Still missing',
  );
}

/**
 * Complete one worksheet row — cause, the three effect levels, severity,
 * occurrence and the consequence class. Gated only on the row being named:
 * everything else is precisely what this call is for.
 */
export function canSpecialistCompleteRow(fn: RCMFunction | undefined, fm: RCMFailureMode): ActionGate {
  const missing: string[] = [];
  if (!fn || !described(fn.function_description, 8)) missing.push('Function described');
  if (!described(fm.failure_mode_description, 5)) missing.push('Failure mode named');
  return gate(
    missing,
    'Have the Specialist complete this row — cause, effects, severity and consequence',
    'Name the failure mode first, then the Specialist can complete the row. Still missing',
  );
}

// ── Row completeness — what still needs finishing ────────────────────────────

/** A worksheet row is complete when every FMEA column is filled and classified. */
export function isRowComplete(fm: RCMFailureMode, decision?: RCMDecision): boolean {
  return (
    described(fm.failure_mode_description) &&
    described(fm.failure_cause_description) &&
    described(fm.failure_effect_local) &&
    described(fm.failure_effect_system) &&
    described(fm.end_effect || fm.failure_effect_plant) &&
    !!fm.severity && !!fm.occurrence &&
    !!text(decision?.consequence_code)
  );
}

/** Rows the Specialist could finish right now — named, but not yet complete. */
export function completableRows(
  functions: RCMFunction[],
  failureModes: RCMFailureMode[],
  decisions: Map<string, RCMDecision>,
): RCMFailureMode[] {
  const fnById = new Map(functions.map(f => [f.id, f]));
  return failureModes.filter(fm =>
    !isRowComplete(fm, decisions.get(fm.id)) &&
    canSpecialistCompleteRow(fnById.get(fm.function_id), fm).ok
  );
}
