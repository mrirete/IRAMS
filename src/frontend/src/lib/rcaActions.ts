/**
 * rcaActions.ts — the pure rules behind an RCA corrective action.
 *
 * Kept out of the page so they can be unit-tested and reused by the report and
 * the DE tab: when an action counts as settled, whether a change-controlled
 * action may raise work yet, how a named owner resolves to a person, and how an
 * investigation's facts map onto FMEA severity / occurrence.
 */

export interface ActionLike {
    status: string | null;
    requires_moc?: boolean | null;
    moc_request_id?: string | null;
    assigned_to?: string | null;
    assignee_id?: string | null;
}

/** MOC statuses under which a change may be executed. Mirrors the MOC page's STATUS_FLOW. */
export const MOC_EXECUTABLE = new Set(['APPROVED', 'IMPLEMENTED', 'CLOSED']);

/** Every action is finished (done or dropped). Effectiveness can only be judged after this. */
export const actionsSettled = (actions: ActionLike[]): boolean =>
    actions.length > 0 && actions.every(a => a.status === 'completed' || a.status === 'cancelled');

/**
 * A change-controlled action may not raise work until its MOC is approved —
 * you do not execute a change before the change is authorised.
 */
export function mocGate(action: ActionLike, mocStatus?: string | null): { canRaiseWork: boolean; reason: string | null } {
    if (!action.requires_moc) return { canRaiseWork: true, reason: null };
    if (!action.moc_request_id) return { canRaiseWork: false, reason: 'Raise the MOC first — this action changes the asset or how it is run.' };
    if (mocStatus && MOC_EXECUTABLE.has(mocStatus.toUpperCase())) return { canRaiseWork: true, reason: null };
    return { canRaiseWork: false, reason: `Waiting for MOC approval (${mocStatus || 'draft'}).` };
}

export interface Person { id: string; name: string; kind: 'contact' | 'user' }

/** Turn a picker value ("contact:<id>" / "user:<id>") or a typed name into a person. */
export function resolveAssignee(value: string, people: Person[]): Person | null {
    const v = value.trim();
    if (!v) return null;
    const m = v.match(/^(contact|user):(.+)$/);
    if (m) return people.find(p => p.kind === m[1] && p.id === m[2]) ?? null;
    const lower = v.toLowerCase();
    return people.find(p => p.name.toLowerCase() === lower) ?? null;
}

/** An action has an owner when either the id or the legacy name is present. */
export const isAssigned = (a: ActionLike): boolean => !!(a.assignee_id || (a.assigned_to && a.assigned_to.trim()));

// ── FMEA scoring from investigation facts (AIAG 1–10 scales) ────────────────

const SERIOUS_SAFETY = new Set(['tier_1', 'tier_2', 'lti']);

/** Severity: what the failure did, or could do. */
export function fmeaSeverity(s: { safetyTier?: string | null; criticality?: string | null; envImpact?: string | null }): number {
    if (s.safetyTier && SERIOUS_SAFETY.has(s.safetyTier)) return 9;
    if (s.envImpact === 'major') return 8;
    const c = (s.criticality || '').toUpperCase();
    if (c === 'A') return 8;
    if (s.safetyTier === 'first_aid' || s.envImpact === 'minor' || s.envImpact === 'permit_deviation') return 6;
    if (c === 'B') return 6;
    return 4;
}

/** Occurrence: how often this asset actually fails. */
export function fmeaOccurrence(s: { priorRcaCount?: number; cmCount12mo?: number | null }): number {
    const cm = s.cmCount12mo ?? 0;
    const prior = s.priorRcaCount ?? 0;
    if (cm >= 6) return 8;
    if (cm >= 3 || prior >= 2) return 7;
    if (prior === 1 || cm >= 1) return 5;
    return 3;
}

/**
 * Detection: how likely the failure is caught before it matters, from what
 * actually watches the asset. Condition monitoring beats a scheduled PM beats
 * nothing. Returns the score and the "current controls" text that justifies it.
 */
export function fmeaDetection(s: { readingPoints?: number | null; activePms?: number | null }): { detection: number; controls: string } {
    const rp = s.readingPoints ?? 0;
    const pm = s.activePms ?? 0;
    if (rp > 0 && pm > 0) return { detection: 3, controls: `Condition monitoring (${rp} reading point${rp === 1 ? '' : 's'}) + ${pm} scheduled PM${pm === 1 ? '' : 's'}` };
    if (rp > 0) return { detection: 4, controls: `Condition monitoring (${rp} reading point${rp === 1 ? '' : 's'})` };
    if (pm > 0) return { detection: 6, controls: `${pm} scheduled PM${pm === 1 ? '' : 's'}; no condition monitoring` };
    return { detection: 8, controls: 'No detection controls recorded on the register' };
}
