import { describe, it, expect } from 'vitest';
import { RequestStatus, type ServiceRequest } from '../types';
import { requestDueAt } from './requestPriority';
import {
    needsMyAction, duplicateCounts, dueState, formatSpan, matchesFilters, matchesChip,
    sortRequests, EMPTY_FILTERS, type FilterContext,
} from './requestBoard';

const NOW = Date.parse('2026-10-01T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3600000).toISOString();

const req = (over: Partial<ServiceRequest> = {}): ServiceRequest => {
    const priority = over.priority ?? 'MEDIUM';
    const createdAt = over.createdAt ?? hoursAgo(1);
    return {
        id: over.id ?? 'r1', requestNumber: 'REQ-1', title: 't', description: 'Pump leaking',
        status: RequestStatus.NEW, priority, category: 'GENERAL', requesterId: 'u1', requesterName: 'Bea',
        createdAt, slaDeadline: requestDueAt(priority, createdAt), ...over,
    };
};

const ctx = (over: Partial<FilterContext> = {}): FilterContext => ({
    perms: { edit: true }, userIds: ['u1'], dupes: new Map(), typeOf: () => 'Pump', now: NOW, ...over,
});

describe('response target by priority', () => {
    it('gives an emergency 4 h and a low 7 days', () => {
        expect(dueState(req({ priority: 'EMERGENCY', createdAt: hoursAgo(5) }), NOW)?.kind).toBe('overdue');
        expect(dueState(req({ priority: 'LOW', createdAt: hoursAgo(5) }), NOW)?.kind).toBe('ok');
    });
    it('a day-old medium request is not overdue (it was, at a flat 24 h)', () => {
        expect(dueState(req({ priority: 'MEDIUM', createdAt: hoursAgo(30) }), NOW)?.kind).toBe('ok');
    });
    it('has no clock once converted or rejected', () => {
        expect(dueState(req({ status: RequestStatus.CONVERTED, createdAt: hoursAgo(500) }), NOW)).toBeNull();
        expect(dueState(req({ status: RequestStatus.REJECTED, createdAt: hoursAgo(500) }), NOW)).toBeNull();
    });
});

describe('formatSpan', () => {
    it('picks one unit', () => {
        expect(formatSpan(0.2)).toBe('12m');
        expect(formatSpan(5)).toBe('5h');
        expect(formatSpan(72)).toBe('3d');
        expect(formatSpan(24 * 30)).toBe('4w');
    });
});

describe('needsMyAction', () => {
    it('matches the step to the permission that takes it', () => {
        expect(needsMyAction({ status: RequestStatus.NEW }, { edit: true })).toBe(true);
        expect(needsMyAction({ status: RequestStatus.REVIEW }, { edit: true })).toBe(false);
        expect(needsMyAction({ status: RequestStatus.REVIEW }, { authorize: true })).toBe(true);
        expect(needsMyAction({ status: RequestStatus.AUTHORIZED }, { approve: true })).toBe(true);
        expect(needsMyAction({ status: RequestStatus.CONVERTED }, { edit: true, authorize: true, approve: true })).toBe(false);
    });
});

describe('duplicateCounts', () => {
    it('counts other OPEN requests on the same asset only', () => {
        const m = duplicateCounts([
            req({ id: 'a', assetId: 'P1' }),
            req({ id: 'b', assetId: 'P1' }),
            req({ id: 'c', assetId: 'P1', status: RequestStatus.CONVERTED }),
            req({ id: 'd', assetId: 'P2' }),
        ]);
        expect(m.get('a')).toBe(1);
        expect(m.get('b')).toBe(1);
        expect(m.has('c')).toBe(false);
        expect(m.has('d')).toBe(false);
    });
});

describe('filters', () => {
    it('folds legacy APPROVED into Converted', () => {
        const f = { ...EMPTY_FILTERS, statuses: [RequestStatus.CONVERTED] };
        expect(matchesFilters(req({ status: RequestStatus.APPROVED }), f, ctx())).toBe(true);
        expect(matchesFilters(req({ status: RequestStatus.NEW }), f, ctx())).toBe(false);
    });
    it('searches the WO number of a converted request', () => {
        const f = { ...EMPTY_FILTERS, q: 'wo-2026-01003' };
        expect(matchesFilters(req({ linkedWONumber: 'WO-2026-01003' }), f, ctx())).toBe(true);
    });
    it('raised-within excludes older requests', () => {
        const f = { ...EMPTY_FILTERS, raised: '24H' as const };
        expect(matchesFilters(req({ createdAt: hoursAgo(30) }), f, ctx())).toBe(false);
        expect(matchesFilters(req({ createdAt: hoursAgo(3) }), f, ctx())).toBe(true);
    });
    it('raised-by-me reads the requester id', () => {
        expect(matchesChip(req({ requesterId: 'u1' }), 'RAISED_BY_ME', ctx())).toBe(true);
        expect(matchesChip(req({ requesterId: 'u9' }), 'RAISED_BY_ME', ctx())).toBe(false);
    });
});

describe('sortRequests by time left', () => {
    it('puts the most overdue open request first and closed ones last', () => {
        const out = sortRequests([
            req({ id: 'closed', status: RequestStatus.CONVERTED, createdAt: hoursAgo(900) }),
            req({ id: 'low', priority: 'LOW', createdAt: hoursAgo(10) }),
            req({ id: 'emerg', priority: 'EMERGENCY', createdAt: hoursAgo(10) }),
        ], 'sla', () => '');
        expect(out.map(r => r.id)).toEqual(['emerg', 'low', 'closed']);
    });
    it('orders closed requests most recently closed first', () => {
        const out = sortRequests([
            req({ id: 'old', status: RequestStatus.CONVERTED, createdAt: hoursAgo(900), updatedAt: hoursAgo(800) }),
            req({ id: 'recent', status: RequestStatus.REJECTED, createdAt: hoursAgo(950), updatedAt: hoursAgo(2) }),
        ], 'sla', () => '');
        expect(out.map(r => r.id)).toEqual(['recent', 'old']);
    });
});
