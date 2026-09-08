/**
 * woTimeline — where a work order sits in its life, in plain words.
 *
 * The status pill says "WIP"; a technician wants "In progress since Tuesday,
 * assigned by J. Supervisor on 3 Sep". The events already exist: every status
 * and assignment change is auto-journaled as a SYSTEM entry ("Status changed:
 * OPEN → SCHED") and mirrored into journal_entries (0285). This module turns
 * those rows plus the record's own stamps (created_at, closed_at) into a
 * stepper and a one-line sentence. Pure functions — no fetching, no React.
 *
 * Lifecycle (wo_status enum): OPEN → PLAN → SCHED → WIP → TECO → CLOSED.
 * WAIT is a side state (work paused), CANC/CANCELLED a terminal exit. The
 * bucket meaning of each code is owned by lib/woState.ts; this file only
 * adds ordering, labels and timestamps.
 */
import { classifyWoStatus, normalizeStatus } from '../../lib/woState';

export const LIFECYCLE: readonly LifecycleCode[] = ['OPEN', 'PLAN', 'SCHED', 'WIP', 'TECO', 'CLOSED'] as const;
export type LifecycleCode = 'OPEN' | 'PLAN' | 'SCHED' | 'WIP' | 'TECO' | 'CLOSED';

/** Plain-English labels for the native enum plus the codes imports bring in. */
export const STATUS_LABEL: Record<string, string> = {
    OPEN: 'Created',
    PLAN: 'Planned',
    SCHED: 'Scheduled',
    WIP: 'In progress',
    WAIT: 'Waiting',
    TECO: 'Work complete',
    CLOSED: 'Closed',
    CANC: 'Cancelled',
    CANCELLED: 'Cancelled',
    COMPLETED: 'Work complete',
};

export const statusLabel = (status: string | null | undefined): string => {
    const s = normalizeStatus(status);
    return STATUS_LABEL[s] || (s ? s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase()) : 'Unknown');
};

export interface JournalLike {
    entry?: string | null;
    createdAt?: string | null;
    createdBy?: string | null;
    isSystem?: boolean | null;
}

export interface StatusEvent { at: string; from: string; to: string; by?: string }
export interface AssignmentEvent { at: string; from: string; to: string; by?: string }

const STATUS_RE = /^Status changed:\s*([A-Za-z_\-]+|—)\s*(?:→|->)\s*([A-Za-z_\-]+)/;
const ASSIGN_RE = /^Assignment changed:\s*(.+?)\s*(?:→|->)\s*(.+?)\s*$/;

const validIso = (s?: string | null): s is string => !!s && Number.isFinite(Date.parse(s));

/** Status-change events, oldest first. Non-system and malformed rows are ignored. */
export function parseStatusEvents(journals: JournalLike[] | null | undefined): StatusEvent[] {
    const out: StatusEvent[] = [];
    for (const j of journals || []) {
        if (!validIso(j.createdAt)) continue;
        const m = STATUS_RE.exec(String(j.entry || '').trim());
        if (!m) continue;
        out.push({ at: j.createdAt, from: normalizeStatus(m[1] === '—' ? '' : m[1]), to: normalizeStatus(m[2]), by: j.createdBy || undefined });
    }
    return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** Assignment events, oldest first. Values are whatever the journal stored (contact id or name). */
export function parseAssignmentEvents(journals: JournalLike[] | null | undefined): AssignmentEvent[] {
    const out: AssignmentEvent[] = [];
    for (const j of journals || []) {
        if (!validIso(j.createdAt)) continue;
        const m = ASSIGN_RE.exec(String(j.entry || '').trim());
        if (!m) continue;
        out.push({ at: j.createdAt, from: m[1], to: m[2], by: j.createdBy || undefined });
    }
    return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

export type StepState = 'done' | 'current' | 'todo' | 'skipped';
export interface TimelineStep { code: LifecycleCode; label: string; state: StepState; reachedAt?: string }
export interface SideState { code: 'WAIT' | 'CANC'; label: string; since?: string }

export interface WoTimeline {
    /** Six lifecycle steps in order. */
    steps: TimelineStep[];
    /** Waiting or Cancelled, when the record is in one. */
    side?: SideState;
    /** Normalised current status code. */
    status: string;
    /** When the current status was entered, if known. */
    currentSince?: string;
}

export interface WoStamps {
    status: string | null | undefined;
    createdAt?: string | null;
    /** closed_at stamps at first TECO (0284) and stays through CLOSED. */
    closedAt?: string | null;
}

/**
 * Position of a lifecycle code, treating WAIT as "at WIP" (paused work is
 * still work in progress) and the cancel codes as off the rail.
 */
function railIndex(code: string): number {
    const s = normalizeStatus(code);
    if (s === 'WAIT') return LIFECYCLE.indexOf('WIP');
    if (s === 'COMPLETED') return LIFECYCLE.indexOf('TECO');
    return LIFECYCLE.indexOf(s as LifecycleCode);
}

export function buildTimeline(wo: WoStamps, journals: JournalLike[] | null | undefined): WoTimeline {
    const status = normalizeStatus(wo.status) || 'OPEN';
    const events = parseStatusEvents(journals);

    // First time each code was entered. OPEN is entered at creation.
    const reached = new Map<string, string>();
    if (validIso(wo.createdAt)) reached.set('OPEN', wo.createdAt);
    for (const e of events) {
        if (!reached.has(e.to)) reached.set(e.to, e.at);
    }
    // Fallbacks when the journal is silent (imports, pre-0283 records).
    if (validIso(wo.closedAt)) {
        if (!reached.has('TECO') && (status === 'TECO' || status === 'CLOSED')) reached.set('TECO', wo.closedAt);
        if (!reached.has('CLOSED') && status === 'CLOSED') reached.set('CLOSED', wo.closedAt);
    }

    const bucket = classifyWoStatus(status);
    const isVoid = bucket === 'void';
    const isWait = status === 'WAIT';
    // Where the rail head sits: the current status, or for a cancelled record
    // the furthest step it actually reached.
    let head = railIndex(status);
    if (isVoid || head < 0) {
        head = -1;
        LIFECYCLE.forEach((c, i) => { if (reached.has(c)) head = Math.max(head, i); });
        if (head < 0) head = 0;
    }

    const steps: TimelineStep[] = LIFECYCLE.map((code, i) => {
        let state: StepState;
        if (isVoid) state = i <= head ? 'done' : 'skipped';
        else if (i < head) state = 'done';
        else if (i === head) state = isWait ? 'done' : 'current';
        else state = 'todo';
        // A step the rail passed without a stamp still reads as done — the
        // record proves it happened, the journal just missed the moment.
        return { code, label: STATUS_LABEL[code], state, reachedAt: reached.get(code) };
    });

    const lastEvent = events.length ? events[events.length - 1] : undefined;
    const currentSince = lastEvent && lastEvent.to === status
        ? lastEvent.at
        : reached.get(status) || (status === 'OPEN' && validIso(wo.createdAt) ? wo.createdAt : undefined);

    let side: SideState | undefined;
    if (isWait) side = { code: 'WAIT', label: STATUS_LABEL.WAIT, since: currentSince };
    else if (isVoid) side = { code: 'CANC', label: STATUS_LABEL.CANC, since: currentSince };

    return { steps, side, status, currentSince };
}

// ── Dates in words ──────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** "today 14:05", "yesterday", "Tue", "3 Sep", "3 Sep 2025" — relative to `now`. */
export function formatWhen(iso: string | null | undefined, now: Date = new Date()): string {
    if (!validIso(iso)) return '';
    const d = new Date(iso);
    const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((startToday.getTime() - new Date(d).setHours(0, 0, 0, 0)) / DAY_MS);
    if (diffDays === 0) return `today ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
    if (diffDays === 1) return 'yesterday';
    if (diffDays > 1 && diffDays < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
    if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * One line for a card: what state the job is in and since when, plus who
 * assigned it for work not yet started. `resolveName` turns the id the
 * assignment journal stored into a display name when the caller has one.
 */
export function statusSentence(
    wo: WoStamps,
    journals: JournalLike[] | null | undefined,
    opts: { now?: Date; resolveName?: (idOrName: string) => string | undefined } = {},
): string {
    const now = opts.now || new Date();
    const t = buildTimeline(wo, journals);
    const when = formatWhen(t.currentSince, now);
    const since = when ? ` since ${when}` : '';
    const on = when ? ` ${when}` : '';

    switch (t.status) {
        case 'WIP': return `In progress${since}`;
        case 'WAIT': return `Waiting${since}`;
        case 'TECO': case 'COMPLETED': return `Work completed${on}`;
        case 'CLOSED': return `Closed${on}`;
        case 'CANC': case 'CANCELLED': return `Cancelled${on}`;
        default: {
            // Not started: say when it landed on the person, and by whom.
            const assigns = parseAssignmentEvents(journals);
            const last = assigns.length ? assigns[assigns.length - 1] : undefined;
            const label = t.status === 'SCHED' ? 'Scheduled' : t.status === 'PLAN' ? 'Planned' : 'Created';
            if (last) {
                const by = last.by && opts.resolveName ? (opts.resolveName(last.by) || last.by) : last.by;
                const at = formatWhen(last.at, now);
                return `${label} · assigned${at ? ` ${at}` : ''}${by ? ` by ${by}` : ''}`;
            }
            return `${label}${on}`;
        }
    }
}

// ── History grouping ────────────────────────────────────────────────────────

export interface MonthGroup<T> { key: string; label: string; rows: T[] }

/** Group rows by calendar month of `dateOf(row)`, newest month first; undated rows last. */
export function groupByMonth<T>(rows: T[], dateOf: (r: T) => string | null | undefined, now: Date = new Date()): MonthGroup<T>[] {
    const map = new Map<string, MonthGroup<T>>();
    for (const r of rows) {
        const iso = dateOf(r);
        const d = validIso(iso) ? new Date(iso) : null;
        const key = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '0000-00';
        let g = map.get(key);
        if (!g) {
            const label = !d ? 'No completion date'
                : d.getFullYear() === now.getFullYear()
                    ? d.toLocaleDateString(undefined, { month: 'long' })
                    : d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
            g = { key, label, rows: [] };
            map.set(key, g);
        }
        g.rows.push(r);
    }
    return [...map.values()].sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
}

/** The date a finished job counts under: when work completed, else closed, else last touched. */
export function completionDateOf(wo: { closed_at?: string | null; updated_at?: string | null; created_at?: string | null }, journals?: JournalLike[] | null): string | undefined {
    const events = parseStatusEvents(journals);
    const teco = events.find(e => e.to === 'TECO' || e.to === 'COMPLETED');
    if (teco) return teco.at;
    if (validIso(wo.closed_at)) return wo.closed_at;
    const done = events.find(e => classifyWoStatus(e.to) !== 'open');
    if (done) return done.at;
    return validIso(wo.updated_at) ? wo.updated_at : validIso(wo.created_at) ? wo.created_at : undefined;
}
