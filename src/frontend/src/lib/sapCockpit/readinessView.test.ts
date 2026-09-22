import { describe, it, expect } from 'vitest';
import { readinessView, label } from './readinessView';

describe('readiness for people', () => {
    it('folds nine "longer than" lines into one item that keeps every field', () => {
        const v = readinessView([
            { level: 'warn', message: "S_HEADER.PTTXT longer than SAP's 40 characters — clipped; check the clipped values read sensibly", count: 24 },
            { level: 'warn', message: "S_HEADER.ATNAM longer than SAP's 30 characters — clipped; check the clipped values read sensibly", count: 5 },
            { level: 'warn', message: "S_MPLA.WARPL longer than SAP's 12 characters — clipped; check the clipped values read sensibly", count: 4 },
        ], 100);
        expect(v.check).toHaveLength(1);
        expect(v.check[0].title).toMatch(/longer than SAP allows/);
        expect(v.check[0].rows).toBe(33);
        expect(v.check[0].details).toEqual([
            'Point description (PTTXT) on measuring points: over 40 characters, 24 row(s)',
            'Characteristic name (ATNAM) on measuring points: over 30 characters, 5 row(s)',
            'Plan number (WARPL) on maintenance plans: over 12 characters, 4 row(s)',
        ]);
        expect(v.verdict).toBe('attention');
    });

    it('folds fields whose names carry digits, which is most of SAP', () => {
        // LTXA1 escaped the fold on the live page and landed raw — the field class lacked digits.
        const v = readinessView([
            { level: 'warn', message: "S_OPERATIONS.LTXA1 longer than SAP's 40 characters — clipped; check the clipped values read sensibly", count: 4 },
            { level: 'warn', message: "S_MPLA.WPTXT longer than SAP's 40 characters — clipped; check the clipped values read sensibly", count: 3 },
            { level: 'error', message: 'S_MPLA.ZYKL1 is mandatory and is blank — SAP will reject the row', count: 2 },
        ], 30);
        expect(v.check).toHaveLength(1);
        expect(v.check[0].details).toEqual([
            'Step description (LTXA1) on task-list steps: over 40 characters, 4 row(s)',
            'Plan description (WPTXT) on maintenance plans: over 40 characters, 3 row(s)',
        ]);
        expect(v.mustFix[0].code).toBe('ZYKL1');
    });

    it('keeps catalogue-code clips apart, because the fix is a mapping, not a shorter name', () => {
        const v = readinessView([
            { level: 'warn', message: "D_CODE longer than SAP's 4 characters — clipped; define 4-character catalog codes in QS41 and map the IREAMS codes to them in the cockpit's value mapping (the full codes are on the Order History sheet)", count: 2, object: 'openNotification' },
            { level: 'warn', message: "KTEXT longer than SAP's 40 characters — clipped; check the clipped values read sensibly", count: 21, object: 'orderHistory' },
        ], 50);
        expect(v.check).toHaveLength(2);
        expect(v.check.find(i => /Catalogue codes/.test(i.title))!.action).toMatch(/QS41/);
        expect(v.check.find(i => /Some text/.test(i.title))!.details![0]).toBe('Task list description (KTEXT) on order history (hand-over): over 40 characters, 21 row(s)');
    });

    it('turns a blank mandatory field into a must-fix with a plain name and what to do', () => {
        const v = readinessView([
            { level: 'error', message: 'S_HEADER.MEASUREMENT_POINT_TYPE is mandatory and is blank — SAP will reject the row', count: 35 },
            { level: 'error', message: 'S_OPERATIONS.VORNR is a key field and is blank on 1 row(s) — SAP will reject them' },
        ], 40);
        expect(v.mustFix).toHaveLength(2);
        expect(v.mustFix[0]).toMatchObject({ title: 'Measuring-point category is missing on measuring points — SAP will reject those rows', code: 'MEASUREMENT_POINT_TYPE', rows: 35 });
        // SAP configuration IREAMS has no field for: the action says where it is set, not "fill it in IREAMS".
        expect(v.mustFix[0].action).toMatch(/once under SAP values/);
        expect(v.mustFix[1].action).toMatch(/how SAP tells the rows apart/);
        expect(v.mustFix[1]).toMatchObject({ rows: 1, code: 'VORNR' });
        expect(v.verdict).toBe('blocked');
    });

    it('passes everything else through to its group, untouched', () => {
        const v = readinessView([
            { level: 'info', message: 'Plans are exported as single-cycle plans.' },
            { level: 'warn', message: '7 equipment row(s) have no functional location above them', object: 'equipment' },
        ], 10);
        expect(v.notes[0].title).toBe('Plans are exported as single-cycle plans.');
        expect(v.check[0]).toMatchObject({ title: '7 equipment row(s) have no functional location above them', code: 'Equipment' });
        expect(v.mustFix).toHaveLength(0);
    });

    it('reads the verdict off the groups', () => {
        expect(readinessView([], 0).verdict).toBe('empty');
        expect(readinessView([], 5).verdict).toBe('ready');
        expect(readinessView([{ level: 'info', message: 'x' }], 5).verdict).toBe('ready');
    });

    it('names fields a planner would recognise', () => {
        expect(label('PTTXT')).toBe('Point description');
        expect(label('IWERK')).toBe('Planning plant');
        expect(label('ZZUNKNOWN')).toBe('ZZUNKNOWN');
    });
});
