import { describe, it, expect } from 'vitest';
import {
    sapCycleOf, cycleEquals, cycleText, sapKeysOf, sentCycleOf, latestRevisionText, decide, toMaintenancePlanDoc, sentStamp,
    type LinkSchedule,
} from './reliability';

const sch = (over: Partial<LinkSchedule> = {}): LinkSchedule => ({
    id: 'pm1', code: 'PM-P101-R01', title: 'Seal inspection', description: null, frequency_interval: 1, frequency_unit: 'Months',
    schedule_type: 'TIME', active: true, origin: { plan: '100001', item: '1', source: 'sap_pm' }, updated_at: '2026-09-22T00:00:00.000Z', ...over,
});

describe('cycles', () => {
    it('maps cadence units to SAP cycle units and refuses meters', () => {
        expect(sapCycleOf(1, 'Months')).toEqual({ MaintPlanCycle: 1, MaintPlanCycleUnit: 'MON' });
        expect(sapCycleOf(90, 'days')).toEqual({ MaintPlanCycle: 90, MaintPlanCycleUnit: 'TAG' });
        expect(sapCycleOf(2, 'WCH')).toEqual({ MaintPlanCycle: 2, MaintPlanCycleUnit: 'WCH' });
        expect(sapCycleOf(1, 'Years')).toEqual({ MaintPlanCycle: 1, MaintPlanCycleUnit: 'JHR' });
        expect(sapCycleOf(500, 'Hours')).toBeNull();
        expect(sapCycleOf(0, 'Days')).toBeNull();
        expect(sapCycleOf(null, 'Days')).toBeNull();
    });
    it('compares and words cycles', () => {
        expect(cycleEquals({ MaintPlanCycle: 1, MaintPlanCycleUnit: 'MON' }, sapCycleOf(1, 'Months'))).toBe(true);
        expect(cycleEquals({ MaintPlanCycle: 1, MaintPlanCycleUnit: 'MON' }, sapCycleOf(30, 'Days'))).toBe(false);
        expect(cycleEquals(null, sapCycleOf(1, 'Months'))).toBe(false);
        expect(cycleText({ MaintPlanCycle: 90, MaintPlanCycleUnit: 'TAG' })).toBe('90 days');
        expect(cycleText(null)).toBe('—');
    });
});

describe('what to queue', () => {
    it('queues a cycle change on a SAP single-cycle plan, with the study\'s words and an approval note', () => {
        const d = decide(sch({ frequency_interval: 90, frequency_unit: 'Days', origin: { plan: '100001', sap_sync: { sent_cycle: { MaintPlanCycle: 1, MaintPlanCycleUnit: 'MON' } }, interval_revisions: [{ recommendation_type: 'extend_interval', basis: 'Weibull B10', applied_at: '2026-09-20T10:00:00Z' }] } }));
        expect(d.kind).toBe('send');
        if (d.kind === 'send') {
            expect(d.plan).toBe('100001');
            expect(d.cycle).toEqual({ MaintPlanCycle: 90, MaintPlanCycleUnit: 'TAG' });
            expect(d.reason).toBe('Cycle 1 months → 90 days on SAP plan 100001 — extend interval, Weibull B10 on 2026-09-20. Needs a person\'s approval before it is sent.');
        }
    });
    it('queues a plan never told anything as "(as imported)"', () => {
        const d = decide(sch());
        expect(d.kind === 'send' && d.reason.startsWith('Cycle (as imported) → 1 months on SAP plan 100001.')).toBe(true);
    });
    it('is in sync when the cycle SAP was last told is the current one', () => {
        expect(decide(sch({ origin: { plan: '100001', sap_sync: { sent_cycle: { MaintPlanCycle: 1, MaintPlanCycleUnit: 'MON' } } } })).kind).toBe('in_sync');
    });
    it('skips, with the reason, what it cannot carry', () => {
        expect(decide(sch({ origin: { source: 'rcm' } }))).toMatchObject({ kind: 'skip', stat: 'out_not_from_sap' });
        expect(decide(sch({ origin: { plan: '100001', strategy: 'A' } }))).toMatchObject({ kind: 'skip', stat: 'out_strategy_plan_skipped', reason: expect.stringContaining('IP11') });
        expect(decide(sch({ frequency_unit: 'Hours', frequency_interval: 500 }))).toMatchObject({ kind: 'skip', stat: 'out_meter_cycle_skipped' });
        expect(decide(sch({ active: false }))).toMatchObject({ kind: 'skip', stat: 'out_inactive' });
    });
    it('reads keys, the sent cycle and the latest revision defensively', () => {
        expect(sapKeysOf(sch({ origin: null }))).toEqual({ plan: '', item: '', strategy: '' });
        expect(sentCycleOf(sch({ origin: { plan: '1', sap_sync: { sent_cycle: { MaintPlanCycle: '3' } } } }))).toBeNull();
        expect(latestRevisionText(sch())).toBe('');
        expect(latestRevisionText(sch({ origin: { interval_revisions: [{ recommendation_type: 'reduce_interval', applied_at: '2026-09-01' }, { recommendation_type: 'extend_interval', basis: 'B10', applied_at: '2026-09-21' }] } }))).toBe('extend interval, B10 on 2026-09-21');
    });
});

describe('the document and the stamp', () => {
    it('renders the plan with its cycle and 40 characters of text', () => {
        expect(toMaintenancePlanDoc(sch({ title: 'T'.repeat(50) }), '100001', { MaintPlanCycle: 90, MaintPlanCycleUnit: 'TAG' }))
            .toEqual({ MaintenancePlan: '100001', MaintPlanCycle: 90, MaintPlanCycleUnit: 'TAG', MaintenancePlanText: 'T'.repeat(40) });
        expect(toMaintenancePlanDoc(sch({ title: null, code: null }), '1', { MaintPlanCycle: 1, MaintPlanCycleUnit: 'MON' }).MaintenancePlanText).toBeUndefined();
    });
    it('stamps sap_sync without disturbing the rest of origin', () => {
        const o = sentStamp({ plan: '100001', interval_revisions: [1], sap_sync: { confirmed_at: 'x' } }, { MaintPlanCycle: 90, MaintPlanCycleUnit: 'TAG' }, 'live link', '2026-09-22T12:00:00.000Z');
        expect(o).toEqual({ plan: '100001', interval_revisions: [1], sap_sync: { confirmed_at: 'x', sent_at: '2026-09-22T12:00:00.000Z', sent_in: 'live link', sent_cycle: { MaintPlanCycle: 90, MaintPlanCycleUnit: 'TAG' } } });
        expect(sentStamp(null, { MaintPlanCycle: 1, MaintPlanCycleUnit: 'MON' }, 'live link', 'now').sap_sync).toBeTruthy();
    });
});
