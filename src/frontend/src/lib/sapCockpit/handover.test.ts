import { describe, it, expect } from 'vitest';
import { scheduleChange, revisionText } from './handover';
import type { SrcSchedule } from '../sapLoad/build';

const base: SrcSchedule = {
    id: 'pm-1', code: '1000/0010', title: 'Fan service', frequency_interval: 3, frequency_unit: 'Months',
    origin: { source: 'sap_pm', plan: '1000', item: '0010', task_list: '30009001/01' },
};
const rev = (overrides: Record<string, unknown>) => ({
    proposal_id: 'p1', recommendation_type: 'extend_interval', from_interval: 1, from_unit: 'Months',
    to_days: 90, basis: 'Weibull B10 at 92 days', applied_at: '2026-09-20T10:00:00Z', applied_by: 'j.reliability', ...overrides,
});

describe('what IREAMS changed on a SAP schedule', () => {
    it('is unchanged, and in sync, when nothing was revised', () => {
        const c = scheduleChange(base);
        expect(c.state).toBe('unchanged');
        expect(c.inSync).toBe(true);
        expect(c.sapCadence).toEqual({ interval: 3, unit: 'Months' });
        expect(c.sap).toEqual({ plan: '1000', item: '0010', taskList: '30009001/01' });
    });

    it('reads SAP’s cadence as the value before the first revision', () => {
        const c = scheduleChange({ ...base, origin: { ...base.origin, interval_revisions: [rev({})] } });
        expect(c.state).toBe('changed');
        expect(c.inSync).toBe(false);
        expect(c.sapCadence).toEqual({ interval: 1, unit: 'Months' });   // what SAP still has
        expect(c.cadence).toEqual({ interval: 3, unit: 'Months' });      // what IREAMS has now
        expect(revisionText(c.revisions[0])).toBe('1 Months → 90 days (extend interval, Weibull B10 at 92 days) on 2026-09-20');
    });

    it('is sent once a file carried it after the last change, and confirmed once a planner said so', () => {
        const changed = { ...base, origin: { ...base.origin, interval_revisions: [rev({})] } };
        const sent = scheduleChange({ ...changed, origin: { ...changed.origin, sap_sync: { sent_at: '2026-09-21T08:00:00Z', sent_in: 'x.zip' } } });
        expect(sent.state).toBe('sent');
        expect(sent.inSync).toBe(false);
        const confirmed = scheduleChange({ ...changed, origin: { ...changed.origin, sap_sync: { sent_at: '2026-09-21T08:00:00Z', confirmed_at: '2026-09-21T09:00:00Z', confirmed_by: 'planner' } } });
        expect(confirmed.state).toBe('confirmed');
        expect(confirmed.inSync).toBe(true);
    });

    it('a change after the confirmation reopens it', () => {
        const c = scheduleChange({ ...base, origin: { ...base.origin,
            interval_revisions: [rev({}), rev({ proposal_id: 'p2', applied_at: '2026-09-22T10:00:00Z', from_interval: 3, to_days: 120 })],
            sap_sync: { sent_at: '2026-09-21T08:00:00Z', confirmed_at: '2026-09-21T09:00:00Z' } } });
        expect(c.state).toBe('changed');
        expect(c.revisions.map(r => r.proposalId)).toEqual(['p1', 'p2']);
        expect(c.sapCadence).toEqual({ interval: 1, unit: 'Months' });  // still what SAP had before IREAMS touched it
    });

    it('names the study that produced the schedule', () => {
        const c = scheduleChange({ ...base, origin: { ...base.origin, source: 'rcm', study_id: 'st-1', study_title: 'K-601 RCM' } });
        expect(c.study).toEqual({ id: 'st-1', title: 'K-601 RCM' });
    });
});
