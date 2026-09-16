/**
 * Nested PM intervals (0366) — a shorter-interval preventive task whose
 * scope sits inside a longer-interval task on the same asset (the 3-monthly
 * inside the 6-monthly).
 *
 * Grounding (vendor-neutral): RCM task packaging (IEC 60300-3-11 / SAE
 * JA1012) groups tasks with harmonic intervals into work packages, and a
 * longer-interval package may supersede a shorter one on coincident dates;
 * ISO 14224 wants the maintenance record to carry every interval an order
 * satisfied; ISO 55001 §7.5 wants the rule and the outcome documented.
 *
 * When both fall due together the nested task raises no order of its own —
 * it waits, and the longer-interval order satisfies it. Two modes:
 *   SUPERSEDES — the longer task's plan already contains this scope: the
 *                order carries the longer plan only; the nested occurrence is
 *                recorded on the order and rolled forward.
 *   COMBINES   — distinct scope done on the same visit: the nested task's
 *                steps and parts are appended, tagged with its code.
 * "Together" means within the nested task's lead-time window (0365), not an
 * exact date match — one day of catch-up drift must not yield two orders.
 *
 * The same rule serves 0292 strategy packages (longer package, exact
 * multiple, same strategy — always SUPERSEDES) and the explicit
 * `parent_pm_id` link a planner sets on any schedule. The SQL sweep (0366)
 * mirrors every function here.
 */
import { cadenceDays, sensibleLeadTimeDays, toDateOnly } from './pmCadence';

export type NestingMode = 'SUPERSEDES' | 'COMBINES';
export const NESTING_MODES: NestingMode[] = ['SUPERSEDES', 'COMBINES'];

export interface CadenceLike {
    frequencyInterval: number;
    frequencyUnit: string;
    leadTimeDays?: number;
}

/** Days either side of the nested task's due date within which the longer task's due date satisfies it. */
export function absorptionWindowDays(child: CadenceLike): number {
    return sensibleLeadTimeDays(child.leadTimeDays ?? 0, child.frequencyInterval, child.frequencyUnit);
}

/** Whole days from a to b (b - a), on the calendar day. */
function dayDiff(a: string | Date, b: string | Date): number {
    const [ya, ma, da] = toDateOnly(a).split('-').map(Number);
    const [yb, mb, db] = toDateOnly(b).split('-').map(Number);
    return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86400000);
}

/** Does a longer task due `parentDue` satisfy a nested task due `childDue`? */
export function isAbsorbedBy(childDue: string | Date, parentDue: string | Date, windowDays: number): boolean {
    return Math.abs(dayDiff(childDue, parentDue)) <= Math.max(0, Math.floor(windowDays || 0));
}

/**
 * Harmonic intervals (RCM task packaging): the longer interval is a whole
 * multiple of the shorter, so the two coincide on every longer occurrence.
 * 3 M inside 6 M — yes. 4 M inside 6 M — only every 12 M; the planner is warned.
 */
export function isHarmonic(child: CadenceLike, parent: CadenceLike): boolean {
    const mine = cadenceDays(child.frequencyInterval, child.frequencyUnit);
    const theirs = cadenceDays(parent.frequencyInterval, parent.frequencyUnit);
    return mine > 0 && theirs > mine && theirs % mine === 0;
}

/**
 * May `candidate` be the longer-interval task of `child`? Same asset,
 * strictly longer calendar interval, not itself, and not already nested in
 * `child` (one level, no cycles).
 */
export function canBeParentOf(
    child: { id: string; assetId?: string | null } & CadenceLike,
    candidate: { id: string; assetId?: string | null; parentId?: string | null; scheduleType?: string } & CadenceLike,
): boolean {
    if (!candidate || candidate.id === child.id) return false;
    if ((candidate.scheduleType || 'TIME').toUpperCase() !== 'TIME') return false;
    if (candidate.parentId && candidate.parentId === child.id) return false;
    if (child.assetId && candidate.assetId && child.assetId !== candidate.assetId) return false;
    const mine = cadenceDays(child.frequencyInterval, child.frequencyUnit);
    const theirs = cadenceDays(candidate.frequencyInterval, candidate.frequencyUnit);
    return theirs > mine && mine > 0;
}

export interface IncludedScope {
    pmId: string;
    code: string;
    cadence: string;          // "3 Months"
    dueDate: string;          // YYYY-MM-DD the nested task was due
    mode: NestingMode;
    title?: string;
}

/**
 * Build the order's plan from the longer task's plan plus, for COMBINES
 * children only, the nested task's steps and parts. Steps keep the parent's
 * numbering and continue after it in steps of 10; each appended step is
 * prefixed with the nested task's code and interval so the technician sees
 * which task a step belongs to. SUPERSEDES children add nothing — the parent
 * plan already covers them — but are still listed in `included`, which is
 * what the order record, arming and PM compliance read.
 */
export function mergeIncludedScopes(
    parent: { tasks?: any[]; inventory?: any[] },
    children: { scope: IncludedScope; templates?: { tasks?: any[]; inventory?: any[] } | null }[],
): { tasks: any[]; inventory: any[]; included: IncludedScope[] } {
    const tasks: any[] = [...(parent.tasks || [])];
    const inventory: any[] = [...(parent.inventory || [])];
    let seq = tasks.reduce((m, t, i) => Math.max(m, Number(t?.sequence) || (i + 1) * 10), 0);
    const included: IncludedScope[] = [];
    for (const c of children) {
        included.push(c.scope);
        if (c.scope.mode !== 'COMBINES') continue;
        const tag = `[${c.scope.code} · ${c.scope.cadence}]`;
        for (const t of c.templates?.tasks || []) {
            seq += 10;
            tasks.push({
                ...t,
                sequence: seq,
                operationNo: String(seq).padStart(4, '0'),
                description: `${tag} ${t?.description || ''}`.trim(),
            });
        }
        for (const p of c.templates?.inventory || []) {
            inventory.push({ ...p, description: `${tag} ${p?.description || ''}`.trim() });
        }
    }
    return { tasks, inventory, included };
}

/** Title suffix for an order that satisfies nested tasks: " (also satisfies PM-1 · 3 Months)". */
export function includedScopesSuffix(included: IncludedScope[]): string {
    if (!included.length) return '';
    return ` (also satisfies ${included.map(s => `${s.code} · ${s.cadence}`).join(', ')})`;
}
