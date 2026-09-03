/**
 * woState — THE canonical definition of what a work order's status means.
 *
 * Before this file, "open work order" was defined independently in four
 * places (Dashboard: OPEN+WIP; Reports: not COMP/TECO/CLOSED; the digest
 * tool: OPEN/WIP/PLAN; the mission engine: not CLOSED/TECO/CANCELLED/
 * COMPLETED). They agreed only because the seeded data happened to use four
 * status codes. The first real CMMS import brings foreign codes — the import
 * pipeline already flags `unmapped_status` — and the same fact would then be
 * reported differently on three screens. That is how a reliability product
 * loses trust, so the definition lives here and nowhere else.
 *
 * Mirrored server-side by migration 0233 (public.ers_wo_state + the
 * sem_work_orders view). Change both together; the tests pin the buckets.
 *
 * Vocabulary covered: the native enum (OPEN/WIP/CLOSED/TECO/CANCELLED),
 * SAP PM (CRTD/REL/TECO/CLSD), Maximo (WAPPR/APPR/INPRG/COMP/CLOSE/CAN) and
 * the plain-English shapes MaintainX-style exports produce.
 */

/**
 * Buckets follow EN 13306 completion semantics: 'done' = the maintenance
 * action is complete (technically complete TECO/COMP, or business-closed
 * CLOSED/CLSD); 'void' = cancelled before execution; 'open' = anything still
 * in the work-management flow (created, planned, scheduled, in progress,
 * waiting). "Open work order" everywhere in IREAMS means isOpenWo(status).
 */
export type WoState = 'open' | 'done' | 'void' | 'unknown';

/** Uppercase, trim, and fold separators so "In Progress" == "IN_PROGRESS". */
export const normalizeStatus = (status: string | null | undefined): string =>
    String(status ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');

/** Work still owed to the plant. */
const OPEN_CODES = new Set([
    'OPEN', 'WIP', 'PLAN', 'PLANNED', 'PLANNING', 'REL', 'RELEASED', 'CRTD', 'CREATED',
    'NEW', 'SCHED', 'SCHEDULED', 'INPRG', 'IN_PROGRESS', 'INPROGRESS', 'STARTED',
    'ACTIVE', 'HOLD', 'ON_HOLD', 'WAITING', 'WAPPR', 'APPR', 'APPROVED', 'ASSIGNED',
    'DISPATCHED', 'PENDING',
]);

/** Work that actually happened and is finished. */
const DONE_CODES = new Set([
    'CLOSED', 'CLSD', 'CLOSE', 'TECO', 'COMP', 'COMPLETE', 'COMPLETED', 'FINISHED',
    'DONE', 'SETTLED', 'HISTORICAL',
]);

/** Work that will never happen — excluded from BOTH backlog and completion. */
const VOID_CODES = new Set([
    'CANCELLED', 'CANCELED', 'CANC', 'CAN', 'CNCL', 'VOID', 'VOIDED', 'REJECTED',
    'DELETED', 'DUPLICATE',
]);

export function classifyWoStatus(status: string | null | undefined): WoState {
    const s = normalizeStatus(status);
    if (!s) return 'unknown';
    if (DONE_CODES.has(s)) return 'done';
    if (VOID_CODES.has(s)) return 'void';
    if (OPEN_CODES.has(s)) return 'open';
    return 'unknown';
}

/**
 * Counted as backlog. An UNRECOGNISED status counts as open on purpose:
 * work that cannot be proven finished is still someone's problem, and
 * hiding it would make an import silently shrink the backlog. Surface the
 * unknowns with summarizeWoStates() so the honesty is visible, not implied.
 */
export const isOpenWo = (status: string | null | undefined): boolean => {
    const state = classifyWoStatus(status);
    return state === 'open' || state === 'unknown';
};

export const isDoneWo = (status: string | null | undefined): boolean => classifyWoStatus(status) === 'done';
export const isVoidWo = (status: string | null | undefined): boolean => classifyWoStatus(status) === 'void';

export interface WoStateSummary {
    open: number;
    done: number;
    void: number;
    unknown: number;
    /** Distinct statuses that fell through — the mapping work to do. */
    unknownStatuses: string[];
}

export function summarizeWoStates(rows: { status: string | null }[]): WoStateSummary {
    const out: WoStateSummary = { open: 0, done: 0, void: 0, unknown: 0, unknownStatuses: [] };
    const seen = new Set<string>();
    for (const r of rows) {
        const state = classifyWoStatus(r.status);
        out[state] += 1;
        if (state === 'unknown') {
            const s = normalizeStatus(r.status);
            if (s && !seen.has(s)) { seen.add(s); out.unknownStatuses.push(s); }
        }
    }
    out.unknownStatuses.sort();
    return out;
}
