/**
 * PM hierarchy (0366) — a shorter-cycle PM whose scope is included in a
 * longer-cycle PM on the same asset (the 3-monthly inside the 6-monthly).
 *
 * When both fall due together the child raises nothing; the parent's work
 * order carries the child's steps and parts, tagged with the child's code,
 * and the child is rolled forward. "Together" means within the child's
 * lead-time window (0365 call horizon), not an exact date match — one day of
 * catch-up drift must not produce two orders.
 *
 * The same rule serves 0292 strategy packages (longer package, exact
 * multiple, same strategy) and the explicit `parent_pm_id` link a planner
 * sets on any schedule. The SQL sweep (0366) mirrors every function here.
 */
import { cadenceDays, sensibleLeadTimeDays, toDateOnly } from './pmCadence';

export interface CadenceLike {
    frequencyInterval: number;
    frequencyUnit: string;
    leadTimeDays?: number;
}

/** Days either side of the child's due date within which a parent's due date absorbs it. */
export function absorptionWindowDays(child: CadenceLike): number {
    return sensibleLeadTimeDays(child.leadTimeDays ?? 0, child.frequencyInterval, child.frequencyUnit);
}

/** Whole days from a to b (b - a), on the calendar day. */
function dayDiff(a: string | Date, b: string | Date): number {
    const [ya, ma, da] = toDateOnly(a).split('-').map(Number);
    const [yb, mb, db] = toDateOnly(b).split('-').map(Number);
    return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86400000);
}

/** Does a parent due `parentDue` absorb a child due `childDue`? */
export function isAbsorbedBy(childDue: string | Date, parentDue: string | Date, windowDays: number): boolean {
    return Math.abs(dayDiff(childDue, parentDue)) <= Math.max(0, Math.floor(windowDays || 0));
}

/**
 * May `candidate` be the parent of `child`? Same asset, strictly longer cadence,
 * not itself, and not already a child of `child` (one level, no cycles).
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
    dueDate: string;          // YYYY-MM-DD the child was due
    title?: string;
}

/**
 * Append the children's steps and parts to the parent's plan. Steps keep the
 * parent's numbering and continue after it in steps of 10; each child's step
 * is prefixed with its code and cadence so the technician sees which service
 * a step belongs to. Nothing in the parent's own plan is touched.
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
        included.push(c.scope);
    }
    return { tasks, inventory, included };
}

/** Title suffix for an order that carries other scopes: " (incl. PM-1 · 3 Months)". */
export function includedScopesSuffix(included: IncludedScope[]): string {
    if (!included.length) return '';
    return ` (incl. ${included.map(s => `${s.code} · ${s.cadence}`).join(', ')})`;
}
