/**
 * Cockpit strategy objects -> schedules and job plans.
 *
 * Every sheet is built on the real header from structures.ts, so the tests
 * break if SAP's field list moves.
 */
import { describe, it, expect } from 'vitest';
import { toStrategyRows, taskListRef, workHours } from './strategy';
import { readCockpitSet, type CockpitFile } from './inbound';
import { renderCsv } from './dialect';
import { structureSpec, fileNameOf, type CockpitObjectKey } from './structures';

const FOLDER: Record<CockpitObjectKey, string> = {
    measuringPoint: 'PM - Measuring point',
    measurementDocument: 'PM - Measurement document',
    generalTaskList: 'PM - General maintenance task list',
    maintenanceItem: 'PM - Maintenance item',
    maintenancePlan: 'PM - Maintenance plan',
};

/** A sheet of the real shape, rows given by field name. */
const file = (object: CockpitObjectKey, structure: string, rows: Record<string, string>[]): CockpitFile => {
    const spec = structureSpec(object, structure)!;
    const names = spec.header.split(',').map(c => c.replace(/\(.*\)$/, ''));
    return {
        name: `Source data for ${FOLDER[object]}/${fileNameOf(spec)}`,
        text: [spec.header, ...rows.map(r => renderCsv([names.map(n => r[n] ?? '')]))].join('\r\n'),
    };
};

const set = (...files: CockpitFile[]) => readCockpitSet(files);

// A monthly single-cycle plan with one item on a pump, and the task list it
// points at: two operations, one of them with a planned part.
const PLAN = file('maintenancePlan', 'S_MPLA', [
    { WARPL: '1000', MPTYP: '1', WPTXT: 'Pump monthly service', ZYKL1: '1', ZEIEH: 'MON', STADT: '01.02.2026' },
]);
const ITEM = file('maintenancePlan', 'S_MPOS', [
    { WARPL: '1000', WPPOS: '0010', PSTXT: 'Monthly service — P-101A', EQUNR: '000000000010004711', IWERK: '102A', ILART: '002', PRIOK: '2', GEWRK: 'MNMEC-PP', AUART: 'PM01', PLNNR: '30009001', PLNAL: '01' },
]);
const TASKLIST = file('generalTaskList', 'S_TASKLIST_HDR', [
    { PLNNR: '30009001', PLNAL: '01', KTEXT: 'Centrifugal pump service', WERKS: '102A', ARBPL: 'MNMEC-PP', STRAT: 'MONWOH' },
]);
const OPS = file('generalTaskList', 'S_OPERATIONS', [
    { PLNNR: '30009001', PLNAL: '01', VORNR: '0010', LTXA1: 'Check bearing temperature', ARBPL: 'MNMEC-PP', STEUS: 'INT', ARBEI: '30', ARBEH: 'MIN', ANZZL: '1' },
    { PLNNR: '30009001', PLNAL: '01', VORNR: '0020', LTXA1: 'Replace mechanical seal', STEUS: 'EXT', ARBEI: '4', ARBEH: 'STD', ANZZL: '2', TDLINE: 'Isolate and drain first' },
]);

describe('the pieces', () => {
    it('names a task list by group and counter', () => {
        expect(taskListRef('30009001', '01')).toBe('30009001/01');
        expect(taskListRef('30009001', '1')).toBe('30009001/01');
        expect(taskListRef('30009001', '')).toBe('30009001/01');
    });

    it('turns SAP work into hours', () => {
        expect(workHours('30', 'MIN')).toBe('0.5');
        expect(workHours('4', 'STD')).toBe('4');
        expect(workHours('1', 'TAG')).toBe('8');        // a day is eight hours
        expect(workHours('1,5', 'STD')).toBe('1.5');    // decimal comma
        expect(workHours('', 'STD')).toBe('');
    });
});

describe('task lists become job plans', () => {
    it('maps an operation to a step of its list', () => {
        const { jobplan } = toStrategyRows(set(TASKLIST, OPS));
        expect(jobplan).toHaveLength(2);
        expect(jobplan[0]).toMatchObject({
            pmcode: '30009001/01', operationno: '0010', description: 'Check bearing temperature',
            workcentre: 'MNMEC-PP', controlkey: 'PM01', esthours: '0.5', numpersons: '1',
        });
        expect(jobplan[1]).toMatchObject({
            operationno: '0020', controlkey: 'PM02', esthours: '4', longtext: 'Isolate and drain first',
        });
    });

    it('falls back to the list’s work centre when a step names none', () => {
        const ops = file('generalTaskList', 'S_OPERATIONS', [
            { PLNNR: '30009001', PLNAL: '01', VORNR: '0010', LTXA1: 'Visual check' },
        ]);
        expect(toStrategyRows(set(TASKLIST, ops)).jobplan[0].workcentre).toBe('MNMEC-PP');
    });

    it('drops a step with no short text, and says why', () => {
        const ops = file('generalTaskList', 'S_OPERATIONS', [
            { PLNNR: '30009001', PLNAL: '01', VORNR: '0010', LTXA1: '' },
        ]);
        const { jobplan, skipped, issues } = toStrategyRows(set(TASKLIST, ops));
        expect(jobplan).toHaveLength(0);
        expect(skipped).toBe(1);
        expect(issues.some(i => /no short text \(LTXA1\)/.test(i.message))).toBe(true);
    });

    it('carries planned parts onto the step', () => {
        const comps = file('generalTaskList', 'S_COMPONENTS', [
            { PLNNR: '30009001', PLNAL: '01', VORNR: '0020', IDNRK: 'SEAL-2201', MENGE: '2', MEINS: 'EA' },
        ]);
        const { jobplan } = toStrategyRows(set(TASKLIST, OPS, comps));
        expect(JSON.parse(jobplan[1].materials)).toEqual([{ code: 'SEAL-2201', qty: '2', uom: 'EA' }]);
        expect(jobplan[0].materials).toBeUndefined();
    });

    it('records the package but never invents its cadence', () => {
        const packs = file('generalTaskList', 'S_MPACK', [
            { PLNNR: '30009001', PLNAL: '01', VORNR: '0020', STRAT: 'MONWOH', PAKET: '3' },
        ]);
        const { jobplan, issues } = toStrategyRows(set(TASKLIST, OPS, packs));
        expect(jobplan[1]).toMatchObject({ package: '3', strategy: 'MONWOH' });
        // S_MPACK has no cycle and no package text — the interval is in MMPT,
        // which no PM migration object carries.
        expect(jobplan[1].frequencyinterval).toBeUndefined();
        expect(issues.some(i => i.level === 'warn' && /taken from the Maintenance Strategy object/.test(i.message))).toBe(true);
    });

    it('warns when steps arrive with no schedules to attach to', () => {
        const { issues } = toStrategyRows(set(TASKLIST, OPS));
        expect(issues.some(i => /no schedules to attach to/.test(i.message))).toBe(true);
    });
});

describe('maintenance items become schedules', () => {
    it('maps a single-cycle plan item to a monthly schedule', () => {
        const { recurring, skipped } = toStrategyRows(set(PLAN, ITEM));
        expect(skipped).toBe(0);
        expect(recurring).toHaveLength(1);
        expect(recurring[0]).toMatchObject({
            code: '1000/0010',
            description: 'Monthly service — P-101A',
            assettag: '10004711',                     // unpadded EQUNR
            frequencyinterval: '1',
            frequencyunit: 'Months',
            scheduletype: 'TIME',
            jobtype: 'PM',                            // ILART 002
            priority: 'HIGH',                         // PRIOK 2
            workcentre: 'MNMEC-PP',
            tasklist: '30009001/01',
            plan: '1000',
            nextduedate: '2026-03-01',                // start + one month
        });
    });

    it('keeps plan-bound item numbers apart, since every plan has an 0010', () => {
        const plans = file('maintenancePlan', 'S_MPLA', [
            { WARPL: '1000', MPTYP: '1', WPTXT: 'A', ZYKL1: '1', ZEIEH: 'MON' },
            { WARPL: '2000', MPTYP: '1', WPTXT: 'B', ZYKL1: '3', ZEIEH: 'MON' },
        ]);
        const items = file('maintenancePlan', 'S_MPOS', [
            { WARPL: '1000', WPPOS: '0010', PSTXT: 'Service A', EQUNR: '4711', IWERK: '102A' },
            { WARPL: '2000', WPPOS: '0010', PSTXT: 'Service B', EQUNR: '4712', IWERK: '102A' },
        ]);
        const { recurring } = toStrategyRows(set(plans, items));
        expect(recurring.map(r => r.code)).toEqual(['1000/0010', '2000/0010']);
        expect(recurring[1].frequencyunit).toBe('Months');
        expect(recurring[1].frequencyinterval).toBe('3');
    });

    it('refuses to guess a strategy plan’s cadence', () => {
        const plan = file('maintenancePlan', 'S_MPLA', [
            { WARPL: '1000', MPTYP: '2', WPTXT: 'Pump strategy plan', STRAT: 'MONWOH' },
        ]);
        const { recurring, skipped, issues } = toStrategyRows(set(plan, ITEM));
        expect(recurring).toHaveLength(0);
        expect(skipped).toBe(1);
        expect(issues.some(i => i.level === 'error' && /strategy MONWOH/.test(i.message) && /no PM migration object/.test(i.message))).toBe(true);
    });

    it('reports an item whose plan is missing from the set', () => {
        const { recurring, skipped, issues } = toStrategyRows(set(ITEM));
        expect(recurring).toHaveLength(0);
        expect(skipped).toBe(1);
        expect(issues.some(i => /not in this set/.test(i.message))).toBe(true);
    });

    it('drops an item with no object to schedule against', () => {
        const items = file('maintenancePlan', 'S_MPOS', [
            { WARPL: '1000', WPPOS: '0010', PSTXT: 'Service', IWERK: '102A' },
        ]);
        const { recurring, skipped, issues } = toStrategyRows(set(PLAN, items));
        expect(recurring).toHaveLength(0);
        expect(skipped).toBe(1);
        expect(issues.some(i => /EQUNR and TPLNR are both blank/.test(i.message))).toBe(true);
    });

    it('takes a standalone item, keyed on WAPOS, with its own strategy', () => {
        const standalone = file('maintenanceItem', 'S_ITEM', [
            { WAPOS: '90001', PSTXT: 'Quarterly inspection', EQUNR: '4711', IWERK: '102A', ILART: '001', WSTRA: 'MONWOH' },
        ]);
        const { recurring, skipped, issues } = toStrategyRows(set(standalone));
        // No plan means no cycle — a standalone item cannot say how often.
        expect(recurring).toHaveLength(0);
        expect(skipped).toBe(1);
        expect(issues.some(i => /strategy MONWOH/.test(i.message))).toBe(true);
    });

    it('says when an object list covers more equipment than one schedule can', () => {
        const objs = file('maintenancePlan', 'S_OBJ_LIST', [
            { WARPL: '1000', WPPOS: '0010', EAMS_OBKNR: '1', EQUNR: '4712' },
            { WARPL: '1000', WPPOS: '0010', EAMS_OBKNR: '2', EQUNR: '4713' },
        ]);
        const { recurring, issues } = toStrategyRows(set(PLAN, ITEM, objs));
        expect(recurring).toHaveLength(1);
        expect(issues.some(i => /Assets tab/.test(i.message) && /2 object/.test(i.message))).toBe(true);
    });

    it('flags a task list the schedule needs but the set does not have', () => {
        const { issues } = toStrategyRows(set(PLAN, ITEM));
        expect(issues.some(i => /task list 30009001\/01, which is not in this set/.test(i.message))).toBe(true);
    });
});

describe('the strategy file closes the cadence gap', () => {
    // As IP11 shows the strategy: one row per package, cycle as displayed.
    const IP11 = (): CockpitFile => ({
        name: 'MONWOH strategy packages.csv',
        text: ['STRAT,PAKET,ZYKL1,ZEIEH,KTEX1', 'MONWOH,1,1,MON,1 MONTH', 'MONWOH,2,3,MON,3 MONTH', 'MONWOH,3,12,MON,12 MONTH/ 1 YEAR'].join('\r\n'),
    });
    // As table T351P stores it: ZAEHL for the package, ZYKZT in seconds.
    const T351P = (): CockpitFile => ({
        name: 'T351P.csv',
        text: ['MANDT,STRAT,ZAEHL,ZEIEH,ZYKZT,HIERA', '100,MONWOH,01,MON,2592000,01', '100,MONWOH,02,MON,7776000,02'].join('\r\n'),
    });
    const STRATEGY_PLAN = file('maintenancePlan', 'S_MPLA', [
        { WARPL: '1000', MPTYP: '2', WPTXT: 'Pump strategy plan', STRAT: 'MONWOH', STADT: '01.02.2026' },
    ]);
    const PACKS = file('generalTaskList', 'S_MPACK', [
        { PLNNR: '30009001', PLNAL: '01', VORNR: '0010', STRAT: 'MONWOH', PAKET: '1' },
        { PLNNR: '30009001', PLNAL: '01', VORNR: '0020', STRAT: 'MONWOH', PAKET: '3' },
    ]);

    it('is recognised by its columns, whatever the file is called', () => {
        const s = set(IP11());
        expect(s.strategyPackages).toHaveLength(3);
        expect(s.strategyPackages[2]).toMatchObject({ strat: 'MONWOH', paket: '3', cadence: { interval: 12, unit: 'Months' }, from: 'cycle' });
        expect(s.issues.some(i => /3 strategy package\(s\) read from MONWOH strategy packages\.csv/.test(i.message))).toBe(true);
    });

    it('reads a raw T351P export, in days — never a guessed month', () => {
        const s = set(T351P());
        expect(s.strategyPackages.map(p => [p.paket, p.cadence, p.from])).toEqual([
            ['1', { interval: 30, unit: 'Days' }, 'seconds'],
            ['2', { interval: 90, unit: 'Days' }, 'seconds'],
        ]);
    });

    it('gives every step its package’s cycle', () => {
        const { jobplan, issues } = toStrategyRows(set(TASKLIST, OPS, PACKS, IP11()));
        expect(jobplan[0]).toMatchObject({ package: '1', frequencyinterval: '1', frequencyunit: 'Months' });
        expect(jobplan[1]).toMatchObject({ package: '3', frequencyinterval: '12', frequencyunit: 'Months' });
        expect(issues.some(i => /taken from the Maintenance Strategy object/.test(i.message))).toBe(false);
    });

    it('schedules a strategy plan on the shortest package of its task list', () => {
        const { recurring, skipped, issues } = toStrategyRows(set(STRATEGY_PLAN, ITEM, TASKLIST, OPS, PACKS, IP11()));
        expect(skipped).toBe(0);
        expect(recurring[0]).toMatchObject({ code: '1000/0010', frequencyinterval: '1', frequencyunit: 'Months', strategy: 'MONWOH', nextduedate: '2026-03-01' });
        expect(issues.some(i => /shortest package on task list 30009001\/01/.test(i.message))).toBe(true);
    });

    it('falls back to the shortest package of the strategy when the list is not in the set', () => {
        const { recurring, issues } = toStrategyRows(set(STRATEGY_PLAN, ITEM, IP11()));
        expect(recurring[0]).toMatchObject({ frequencyinterval: '1', frequencyunit: 'Months' });
        expect(issues.some(i => /shortest package of strategy MONWOH/.test(i.message))).toBe(true);
    });

    it('still refuses when the file has nothing for the item’s strategy', () => {
        const other: CockpitFile = { name: 'x.csv', text: 'STRAT,PAKET,ZYKL1,ZEIEH\r\nWEEKLY,1,1,WCH' };
        const { recurring, skipped, issues } = toStrategyRows(set(STRATEGY_PLAN, ITEM, other));
        expect(recurring).toHaveLength(0);
        expect(skipped).toBe(1);
        expect(issues.some(i => /no readable package for it/.test(i.message))).toBe(true);
    });

    it('names a package the steps use that the file does not carry', () => {
        const partial: CockpitFile = { name: 'x.csv', text: 'STRAT,PAKET,ZYKL1,ZEIEH\r\nMONWOH,1,1,MON' };
        const { jobplan, issues } = toStrategyRows(set(TASKLIST, OPS, PACKS, partial));
        expect(jobplan[0].frequencyinterval).toBe('1');
        expect(jobplan[1].frequencyinterval).toBeUndefined();
        expect(issues.some(i => /package 3 of strategy MONWOH, which the strategy file does not carry/.test(i.message))).toBe(true);
    });
});

describe('the whole strategy set together', () => {
    it('produces schedules and steps that meet on the task list', () => {
        const { recurring, jobplan, issues, skipped } = toStrategyRows(set(PLAN, ITEM, TASKLIST, OPS));
        expect(skipped).toBe(0);
        expect(recurring[0].tasklist).toBe('30009001/01');
        expect(jobplan.every(j => j.pmcode === '30009001/01')).toBe(true);
        // Which is what makes the order matter.
        expect(issues.some(i => /1 schedule\(s\) import first, then 2 step\(s\)/.test(i.message))).toBe(true);
        expect(issues.some(i => /not in this set/.test(i.message))).toBe(false);
    });
});
