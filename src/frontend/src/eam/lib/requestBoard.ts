/**
 * Requests board — the pure rules behind the triage queue: which step a
 * request is waiting on, whose action that is, how late it is, which open
 * requests point at the same asset, and the filter / sort the board and the
 * list both read. No React here so it can be tested on its own.
 */
import { RequestStatus, type ServiceRequest } from '../types';

export const CLOSED_STATUSES: RequestStatus[] = [RequestStatus.CONVERTED, RequestStatus.REJECTED];
export const isClosed = (r: Pick<ServiceRequest, 'status'>) => CLOSED_STATUSES.includes(r.status);

export const STATUS_LABEL: Record<RequestStatus, string> = {
    [RequestStatus.NEW]: 'New',
    [RequestStatus.REVIEW]: 'Under review',
    [RequestStatus.AUTHORIZED]: 'Authorized',
    [RequestStatus.APPROVED]: 'Approved',
    [RequestStatus.REJECTED]: 'Rejected',
    [RequestStatus.CONVERTED]: 'Converted',
};

export interface RequestPerms {
    edit?: boolean;
    authorize?: boolean;
    approve?: boolean;
}

export type NextStep = 'REVIEW' | 'AUTHORIZE' | 'APPROVE';

/** The forward step a request is waiting on, regardless of who may take it. */
export function nextStep(status: RequestStatus): NextStep | null {
    switch (status) {
        case RequestStatus.NEW: return 'REVIEW';
        case RequestStatus.REVIEW: return 'AUTHORIZE';
        case RequestStatus.AUTHORIZED: return 'APPROVE';
        default: return null;
    }
}

/** True when the caller holds the permission for the step this request waits on. */
export function needsMyAction(r: Pick<ServiceRequest, 'status'>, perms: RequestPerms | undefined | null): boolean {
    const step = nextStep(r.status);
    if (!step || !perms) return false;
    if (step === 'REVIEW') return perms.edit === true;
    if (step === 'AUTHORIZE') return perms.authorize === true;
    return perms.approve === true;
}

/** id → number of OTHER open requests raised against the same asset. */
export function duplicateCounts(requests: ServiceRequest[]): Map<string, number> {
    const byAsset = new Map<string, string[]>();
    for (const r of requests) {
        if (!r.assetId || isClosed(r)) continue;
        const ids = byAsset.get(r.assetId) || [];
        ids.push(r.id);
        byAsset.set(r.assetId, ids);
    }
    const out = new Map<string, number>();
    for (const ids of byAsset.values()) {
        if (ids.length < 2) continue;
        for (const id of ids) out.set(id, ids.length - 1);
    }
    return out;
}

export type DueKind = 'overdue' | 'soon' | 'ok';

/** Time left on an open request's response target; null once it is closed. */
export function dueState(r: Pick<ServiceRequest, 'status' | 'slaDeadline'>, now = Date.now()): { kind: DueKind; label: string } | null {
    if (isClosed(r)) return null;
    const hours = (new Date(r.slaDeadline).getTime() - now) / 3600000;
    if (!Number.isFinite(hours)) return null;
    if (hours < 0) return { kind: 'overdue', label: `${formatSpan(-hours)} over` };
    if (hours < 4) return { kind: 'soon', label: `${formatSpan(hours)} left` };
    return { kind: 'ok', label: `${formatSpan(hours)} left` };
}

/** "45m", "5h", "3d", "6w" — one unit, rounded so it never reads as 0. */
export function formatSpan(hours: number): string {
    if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
    if (hours < 48) return `${Math.round(hours)}h`;
    const days = hours / 24;
    if (days < 14) return `${Math.round(days)}d`;
    return `${Math.round(days / 7)}w`;
}

export const ageLabel = (createdAt: string, now = Date.now()) =>
    formatSpan(Math.max(0, (now - new Date(createdAt).getTime()) / 3600000));

/** Plant = first segment of the " > "-joined location path built by DataMapper. */
export const plantOf = (r: Pick<ServiceRequest, 'location'>) => {
    const first = (r.location || '').split(' > ')[0].trim();
    // DataMapper writes 'Unknown' when the asset is not in the register.
    return first && first !== 'Unknown' ? first : 'Unassigned';
};

// ── Filters ──────────────────────────────────────────────────────────────────

export type QuickChip = 'MINE' | 'OVERDUE' | 'EMERGENCY' | 'BREAKDOWN' | 'DUPES' | 'RAISED_BY_ME';
export type RaisedWithin = 'ANY' | '24H' | '7D' | '30D';
export type SortKey = 'date' | 'priority' | 'sla' | 'type';

export interface RequestFilters {
    q: string;
    chip: QuickChip | null;
    priorities: string[];
    statuses: RequestStatus[];
    plant: string;      // 'ALL' or a plant
    type: string;       // 'ALL' or an equipment type
    requester: string;  // 'ALL' or a requester id
    raised: RaisedWithin;
}

export const EMPTY_FILTERS: RequestFilters = {
    q: '', chip: null, priorities: [], statuses: [], plant: 'ALL', type: 'ALL', requester: 'ALL', raised: 'ANY',
};

const RAISED_HOURS: Record<Exclude<RaisedWithin, 'ANY'>, number> = { '24H': 24, '7D': 168, '30D': 720 };
export const PRIORITY_RANK: Record<string, number> = { EMERGENCY: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export interface FilterContext {
    perms?: RequestPerms | null;
    userIds: string[];               // ids the caller may appear as (users.id, contact_id)
    dupes: Map<string, number>;
    typeOf: (r: ServiceRequest) => string;
    now?: number;
}

export function matchesChip(r: ServiceRequest, chip: QuickChip, ctx: FilterContext): boolean {
    switch (chip) {
        case 'MINE': return needsMyAction(r, ctx.perms);
        case 'OVERDUE': return dueState(r, ctx.now)?.kind === 'overdue';
        case 'EMERGENCY': return !isClosed(r) && r.priority === 'EMERGENCY';
        case 'BREAKDOWN': return !isClosed(r) && !!r.isBreakdown;
        case 'DUPES': return ctx.dupes.has(r.id);
        case 'RAISED_BY_ME': return ctx.userIds.includes(r.requesterId);
    }
}

/** Every filter except the quick chip — the chip counts are taken over this. */
export function matchesFilters(r: ServiceRequest, f: RequestFilters, ctx: FilterContext): boolean {
    if (f.plant !== 'ALL' && plantOf(r) !== f.plant) return false;
    if (f.type !== 'ALL' && ctx.typeOf(r) !== f.type) return false;
    if (f.requester !== 'ALL' && r.requesterId !== f.requester) return false;
    if (f.priorities.length && !f.priorities.includes(r.priority)) return false;
    if (f.statuses.length) {
        // APPROVED is the legacy step before conversion; it rides with Converted.
        const s = r.status === RequestStatus.APPROVED ? RequestStatus.CONVERTED : r.status;
        if (!f.statuses.includes(s)) return false;
    }
    if (f.raised !== 'ANY') {
        const hours = ((ctx.now ?? Date.now()) - new Date(r.createdAt).getTime()) / 3600000;
        if (hours > RAISED_HOURS[f.raised]) return false;
    }
    const q = f.q.trim().toLowerCase();
    if (q) {
        const hay = [r.requestNumber, r.description, r.assetName, r.location, r.requesterName, ctx.typeOf(r), r.linkedWONumber]
            .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
    }
    return true;
}

export function sortRequests(list: ServiceRequest[], sortBy: SortKey, typeOf: (r: ServiceRequest) => string): ServiceRequest[] {
    const newest = (a: ServiceRequest, b: ServiceRequest) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    return [...list].sort((a, b) => {
        switch (sortBy) {
            case 'priority':
                return ((PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9)) || newest(a, b);
            case 'sla': {
                // Open requests by time left; closed ones have no clock and sink.
                const ca = isClosed(a), cb = isClosed(b);
                if (ca !== cb) return ca ? 1 : -1;
                // Closed requests have no clock — most recently closed first.
                if (ca) return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
                return (new Date(a.slaDeadline).getTime() - new Date(b.slaDeadline).getTime()) || newest(a, b);
            }
            case 'type':
                return typeOf(a).localeCompare(typeOf(b)) || newest(a, b);
            default:
                return newest(a, b);
        }
    });
}

/** Number of non-default filters (the chip and search are shown on their own). */
export function activeFilterCount(f: RequestFilters): number {
    return (f.priorities.length ? 1 : 0) + (f.statuses.length ? 1 : 0)
        + (f.plant !== 'ALL' ? 1 : 0) + (f.type !== 'ALL' ? 1 : 0)
        + (f.requester !== 'ALL' ? 1 : 0) + (f.raised !== 'ANY' ? 1 : 0);
}
