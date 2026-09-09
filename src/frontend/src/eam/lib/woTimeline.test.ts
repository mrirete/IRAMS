import { describe, it, expect } from 'vitest';
import {
    buildTimeline, parseStatusEvents, parseAssignmentEvents, statusSentence,
    groupByMonth, completionDateOf, formatWhen, statusLabel,
} from './woTimeline';

const j = (entry: string, createdAt: string, createdBy = 'sys') => ({ entry, createdAt, createdBy, isSystem: true });
const NOW = new Date('2026-09-07T12:00:00Z');

describe('woTimeline — events from system journals', () => {
    it('parses status changes (both arrow spellings) oldest first and ignores notes', () => {
        const ev = parseStatusEvents([
            j('Status changed: SCHED → WIP', '2026-09-03T08:00:00Z'),
            j('Status changed: OPEN -> SCHED', '2026-09-01T08:00:00Z'),
            { entry: 'Found a leak', createdAt: '2026-09-02T08:00:00Z', isSystem: false },
            j('Status changed: WIP → TECO', 'not a date'),
        ]);
        expect(ev.map(e => e.to)).toEqual(['SCHED', 'WIP']);
        expect(ev[0].from).toBe('OPEN');
    });

    it('parses assignment changes keeping the actor', () => {
        const ev = parseAssignmentEvents([j('Assignment changed: unassigned → c-123', '2026-09-01T08:00:00Z', 'J.Supervisor')]);
        expect(ev).toHaveLength(1);
        expect(ev[0].to).toBe('c-123');
        expect(ev[0].by).toBe('J.Supervisor');
    });
});

describe('woTimeline — the rail', () => {
    const journals = [
        j('Status changed: OPEN → SCHED', '2026-09-01T08:00:00Z'),
        j('Status changed: SCHED → WIP', '2026-09-03T08:00:00Z'),
    ];

    it('stamps reached steps, marks the current one and leaves the rest todo', () => {
        const t = buildTimeline({ status: 'WIP', createdAt: '2026-08-30T08:00:00Z' }, journals);
        const byCode = Object.fromEntries(t.steps.map(s => [s.code, s]));
        expect(byCode.OPEN.state).toBe('done');
        expect(byCode.OPEN.reachedAt).toBe('2026-08-30T08:00:00Z');
        expect(byCode.PLAN.state).toBe('done');        // passed without a stamp
        expect(byCode.PLAN.reachedAt).toBeUndefined();
        expect(byCode.SCHED.reachedAt).toBe('2026-09-01T08:00:00Z');
        expect(byCode.WIP.state).toBe('current');
        expect(byCode.TECO.state).toBe('todo');
        expect(t.currentSince).toBe('2026-09-03T08:00:00Z');
        expect(t.side).toBeUndefined();
    });

    it('treats WAIT as a side state sitting at In progress', () => {
        const t = buildTimeline({ status: 'WAIT' }, [...journals, j('Status changed: WIP → WAIT', '2026-09-04T08:00:00Z')]);
        expect(t.side?.code).toBe('WAIT');
        expect(t.side?.since).toBe('2026-09-04T08:00:00Z');
        expect(t.steps.find(s => s.code === 'WIP')?.state).toBe('done');
        expect(t.steps.find(s => s.code === 'TECO')?.state).toBe('todo');
    });

    it('marks a cancelled job as done up to where it got and skipped after', () => {
        const t = buildTimeline({ status: 'CANC' }, [journals[0], j('Status changed: SCHED → CANC', '2026-09-02T08:00:00Z')]);
        expect(t.side?.code).toBe('CANC');
        expect(t.steps.map(s => s.state)).toEqual(['done', 'done', 'done', 'skipped', 'skipped', 'skipped']);
    });

    it('falls back to closed_at when the journal is silent (imported records)', () => {
        const t = buildTimeline({ status: 'CLOSED', createdAt: '2026-01-01T00:00:00Z', closedAt: '2026-02-01T00:00:00Z' }, []);
        expect(t.steps.find(s => s.code === 'TECO')?.reachedAt).toBe('2026-02-01T00:00:00Z');
        expect(t.steps.find(s => s.code === 'CLOSED')?.state).toBe('current');
        expect(t.steps.every(s => s.state !== 'todo')).toBe(true);
    });

    it('survives an unknown status by parking the rail at Created', () => {
        const t = buildTimeline({ status: 'WAPPR' }, []);
        expect(t.steps[0].state).toBe('current');
    });
});

describe('woTimeline — words', () => {
    it('says since when for work in progress', () => {
        const s = statusSentence({ status: 'WIP' }, [j('Status changed: SCHED → WIP', '2026-09-07T09:30:00Z')], { now: NOW });
        expect(s).toMatch(/^In progress since today/);
    });

    it('says who assigned unstarted work, resolving ids to names', () => {
        const s = statusSentence({ status: 'SCHED' }, [
            j('Assignment changed: unassigned → c-1', '2026-09-03T09:30:00Z', 'u-super'),
        ], { now: NOW, resolveName: (x) => (x === 'u-super' ? 'J. Supervisor' : undefined) });
        expect(s).toBe('Scheduled · assigned Thu by J. Supervisor');
    });

    it('names the waiting reason and prefers the database stamps for timing', () => {
        expect(statusSentence({ status: 'WAIT', waitReason: 'seal kit SL01 from stores.' }, [j('Status changed: WIP → WAIT — seal kit', '2026-09-06T10:00:00Z')], { now: NOW })).toBe('Waiting for seal kit SL01 from stores since yesterday');
        const t = buildTimeline({ status: 'TECO', actualStartAt: '2026-09-01T08:00:00Z', actualFinishAt: '2026-09-02T08:00:00Z' }, []);
        expect(t.steps.find(s => s.code === 'WIP')?.reachedAt).toBe('2026-09-01T08:00:00Z');
        expect(t.steps.find(s => s.code === 'TECO')?.reachedAt).toBe('2026-09-02T08:00:00Z');
    });

    it('reads finished states in the past tense', () => {
        expect(statusSentence({ status: 'TECO', closedAt: '2026-09-05T10:00:00Z' }, [], { now: NOW })).toBe('Work completed Sat');
        expect(statusSentence({ status: 'CANC' }, [], { now: NOW })).toBe('Cancelled');
    });

    it('labels codes in plain English', () => {
        expect(statusLabel('WIP')).toBe('In progress');
        expect(statusLabel('in progress')).toBe('In progress');
        expect(statusLabel('WAPPR')).toBe('Wappr');
    });

    it('formats relative dates', () => {
        expect(formatWhen('2026-09-06T10:00:00Z', NOW)).toBe('yesterday');
        expect(formatWhen('2025-03-02T10:00:00Z', NOW)).toMatch(/2025/);
        expect(formatWhen('garbage', NOW)).toBe('');
    });
});

describe('woTimeline — history', () => {
    it('groups by month newest first with undated rows last', () => {
        const g = groupByMonth([
            { id: 'a', at: '2026-09-02T00:00:00Z' },
            { id: 'b', at: '2026-07-15T00:00:00Z' },
            { id: 'c', at: undefined },
            { id: 'd', at: '2026-09-20T00:00:00Z' },
        ], r => r.at, NOW);
        expect(g.map(x => x.rows.map(r => r.id))).toEqual([['a', 'd'], ['b'], ['c']]);
        expect(g[2].label).toBe('No completion date');
    });

    it('dates a finished job at the TECO event before falling back to closed_at', () => {
        expect(completionDateOf({ closed_at: '2026-09-05T00:00:00Z' }, [j('Status changed: WIP → TECO', '2026-09-04T00:00:00Z')])).toBe('2026-09-04T00:00:00Z');
        expect(completionDateOf({ closed_at: '2026-09-05T00:00:00Z' }, [])).toBe('2026-09-05T00:00:00Z');
        expect(completionDateOf({ updated_at: '2026-09-06T00:00:00Z' }, [])).toBe('2026-09-06T00:00:00Z');
    });
});
