import { describe, it, expect } from 'vitest';
import {
    normalizeProposal, buildPackage, toCsv,
    type ApprovedProposal, type AssetRef,
} from './writebackPackage';

const ASSETS: AssetRef[] = [
    { id: 'a-1', tag: 'P-101', name: 'Feed Pump' },
    { id: 'a-2', tag: 'M-201', name: 'Drive Motor' },
];
const BY_ID = new Map(ASSETS.map((a) => [a.id, a]));

const deTask: ApprovedProposal = {
    id: 'p-1',
    agent_type: 'bad_actor_hunter',
    action_type: 'draft_de_task',
    asset_id: 'a-1',
    draft_payload: {
        title: 'Eliminate repeat seal failures on the feed pump',
        priority: 'critical',
        root_cause_summary: 'Misalignment after overhaul',
        proposed_solution: 'Laser-align on reassembly, add alignment to the task list',
        annual_cost: 250000,
        estimated_savings: 180000,
    },
    created_at: '2026-07-25T10:00:00.000Z',
};

const pmInterval: ApprovedProposal = {
    id: 'p-2',
    agent_type: 'weibull_analyst',
    action_type: 'draft_pm_interval',
    asset_id: 'a-2',
    draft_payload: {
        recommendation_type: 'set_interval',
        recommended_interval_days: 180,
        basis: 'beta 2.4 (wear-out), eta 410d, B10 = 182d',
        current_pm_code: 'PM-0042',
    },
    created_at: '2026-07-25T11:00:00.000Z',
};

describe('normalizeProposal', () => {
    it('turns a DE task into a corrective work order', () => {
        const r = normalizeProposal(deTask, BY_ID);
        expect('action' in r).toBe(true);
        if (!('action' in r)) return;
        expect(r.action.kind).toBe('work_order');
        expect(r.action.work_type).toBe('CM');
        expect(r.action.priority).toBe('EMERGENCY'); // "critical" maps to EMERGENCY
        expect(r.action.asset_tag).toBe('P-101');
        expect(r.action.estimated_value).toBe(180000); // savings preferred over annual cost
        expect(r.action.description).toContain('Laser-align');
        expect(r.action.description).toContain('approved by a human reviewer');
    });

    it('turns a PM-interval recommendation into a PM change', () => {
        const r = normalizeProposal(pmInterval, BY_ID);
        if (!('action' in r)) throw new Error('expected an action');
        expect(r.action.kind).toBe('pm_change');
        expect(r.action.work_type).toBe('PM');
        expect(r.action.interval_days).toBe(180);
        expect(r.action.title).toContain('180 days');
        expect(r.action.description).toContain('PM-0042');
    });

    it('reads condition-monitoring and quality-review recommendations', () => {
        const cm = normalizeProposal({
            ...pmInterval, id: 'p-3',
            draft_payload: { recommendation_type: 'condition_monitoring', basis: 'beta ~1.0' },
        }, BY_ID);
        if (!('action' in cm)) throw new Error('expected an action');
        expect(cm.action.title).toContain('condition monitoring');
        expect(cm.action.interval_days).toBeNull();

        const qr = normalizeProposal({
            ...pmInterval, id: 'p-4',
            draft_payload: { recommendation_type: 'quality_review', basis: 'beta 0.7' },
        }, BY_ID);
        if (!('action' in qr)) throw new Error('expected an action');
        expect(qr.action.work_type).toBe('INSPECTION');
        expect(qr.action.description).toContain('make this worse');
    });

    it('accepts an asset tag the workspace does not know (connected mode)', () => {
        const r = normalizeProposal({
            ...deTask, id: 'p-5', asset_id: null,
            draft_payload: { ...deTask.draft_payload, asset_tag: 'FOREIGN-99' },
        }, BY_ID);
        if (!('action' in r)) throw new Error('expected an action');
        expect(r.action.asset_tag).toBe('FOREIGN-99');
    });

    it('skips a proposal with no asset at all', () => {
        const r = normalizeProposal({ ...deTask, id: 'p-6', asset_id: null, draft_payload: { title: 'x' } }, BY_ID);
        expect('skipped' in r).toBe(true);
        if (!('skipped' in r)) return;
        expect(r.skipped.reason).toMatch(/no asset/i);
    });

    it('exports an unknown proposal type when it carries a title, else skips it', () => {
        const kept = normalizeProposal({
            ...deTask, id: 'p-7', action_type: 'draft_something_new',
            draft_payload: { title: 'Investigate vibration alarm', priority: 'high' },
        }, BY_ID);
        if (!('action' in kept)) throw new Error('expected an action');
        expect(kept.action.title).toBe('Investigate vibration alarm');
        expect(kept.action.priority).toBe('HIGH');

        const dropped = normalizeProposal({
            ...deTask, id: 'p-8', action_type: 'draft_something_new', draft_payload: {},
        }, BY_ID);
        expect('skipped' in dropped).toBe(true);
    });

    it('defaults an unrecognised priority to MEDIUM', () => {
        const r = normalizeProposal({
            ...deTask, id: 'p-9', draft_payload: { ...deTask.draft_payload, priority: 'whenever' },
        }, BY_ID);
        if (!('action' in r)) throw new Error('expected an action');
        expect(r.action.priority).toBe('MEDIUM');
    });
});

describe('buildPackage', () => {
    it('maps to SAP PM upload columns and truncates short text to 40 chars', () => {
        const pkg = buildPackage([deTask, pmInterval], ASSETS, 'sap_pm');
        expect(pkg.columns[0]).toBe('Order Type');
        const [wo, pm] = pkg.rows;
        expect(wo['Order Type']).toBe('PM01');   // corrective
        expect(wo['Equipment']).toBe('P-101');
        expect(wo['Priority']).toBe(1);          // EMERGENCY → SAP 1
        expect(String(wo['Short Text']).length).toBeLessThanOrEqual(40);
        expect(pm['Order Type']).toBe('PM02');   // preventive
        expect(pm['Cycle (days)']).toBe(180);
        expect(pkg.notes.join(' ')).toMatch(/40-character/);
    });

    it('maps to Maximo with blank WONUM and WAPPR status', () => {
        const pkg = buildPackage([deTask], ASSETS, 'maximo');
        expect(pkg.rows[0]['WONUM']).toBe('');
        expect(pkg.rows[0]['STATUS']).toBe('WAPPR');
        expect(pkg.rows[0]['ASSETNUM']).toBe('P-101');
        expect(pkg.rows[0]['WOPRIORITY']).toBe(1);
    });

    it('maps to MaintainX categories', () => {
        const pkg = buildPackage([deTask, pmInterval], ASSETS, 'maintainx');
        expect(pkg.rows[0]['Category']).toBe('Reactive');
        expect(pkg.rows[0]['Priority']).toBe('Critical');
        expect(pkg.rows[1]['Category']).toBe('Preventive');
    });

    it('defaults to the generic shape and reports skips', () => {
        const bad: ApprovedProposal = { ...deTask, id: 'p-bad', asset_id: null, draft_payload: { title: 't' } };
        const pkg = buildPackage([deTask, bad], ASSETS);
        expect(pkg.target).toBe('generic');
        expect(pkg.rows).toHaveLength(1);
        expect(pkg.skipped).toHaveLength(1);
        expect(pkg.notes.join(' ')).toMatch(/could not be expressed/);
    });
});

describe('toCsv', () => {
    it('emits a header row and quotes cells containing commas, quotes or newlines', () => {
        const pkg = buildPackage([deTask], ASSETS, 'generic');
        const csv = toCsv(pkg);
        const [header] = csv.split('\r\n');
        expect(header).toContain('Asset Tag');
        // The description is multi-line, so its cell must be quoted.
        expect(csv).toMatch(/"[^"]*Laser-align[^"]*"/);
    });

    it('doubles embedded quotes', () => {
        const pkg = buildPackage([{
            ...deTask, id: 'p-q',
            draft_payload: { ...deTask.draft_payload, title: 'Replace the "spare" seal' },
        }], ASSETS, 'generic');
        expect(toCsv(pkg)).toContain('""spare""');
    });

    it('renders only the header when there are no rows', () => {
        const pkg = buildPackage([], ASSETS, 'generic');
        expect(toCsv(pkg).split('\r\n')).toHaveLength(1);
    });
});
