import { describe, it, expect } from 'vitest';
import { studyReadiness, type ReadinessCounts } from './studyReadiness';

const empty: ReadinessCounts = { assets: 0, workOrders: 0, workOrdersWithCost: 0, breakdowns: 0, readings: 0, readingPoints: 0, pms: 0, codes: 0 };
const full: ReadinessCounts = { assets: 99, workOrders: 66, workOrdersWithCost: 46, breakdowns: 12, readings: 400, readingPoints: 35, pms: 27, codes: 40 };
const byKey = (r: ReturnType<typeof studyReadiness>) => Object.fromEntries(r.ingredients.map(i => [i.key, i]));

describe('ready for a study?', () => {
    it('with nothing loaded, everything waits on the register', () => {
        const r = studyReadiness(empty);
        expect(r.verdict).toMatch(/Start with the asset register/);
        expect(r.canRun).toEqual([]);
        expect(r.ingredients.every(i => i.status === 'missing')).toBe(true);
    });

    it('with only the register, names failure history as the next thing', () => {
        const r = studyReadiness({ ...empty, assets: 99 });
        expect(byKey(r).register.status).toBe('ready');
        expect(r.canRun).toEqual([]);
        expect(r.verdict).toMatch(/Failure history is the next thing/);
        expect(r.blocked.map(b => b.needs)).toContain('failure history');
    });

    it('with everything, everything runs', () => {
        const r = studyReadiness(full);
        expect(r.blocked).toEqual([]);
        expect(r.canRun).toEqual(['Weibull and MTBF', 'PM optimisation', 'Predict and condition-based RCM', 'Money-ranked findings', 'Failure-mode Pareto']);
        expect(r.verdict).toBe('Everything a study needs is here.');
    });

    it('judges by what each tool reads, not by whether something landed', () => {
        // Condition data but no failures: Predict runs, Weibull does not.
        const r = studyReadiness({ ...empty, assets: 10, readings: 50, readingPoints: 5 });
        expect(r.canRun).toEqual(['Predict and condition-based RCM']);
        expect(r.blocked.find(b => b.study === 'Weibull and MTBF')!.needs).toBe('failure history');
    });

    it('calls a handful of failures partial, and says why', () => {
        const r = studyReadiness({ ...empty, assets: 10, workOrders: 4 });
        const f = byKey(r).failures;
        expect(f.status).toBe('partial');
        expect(f.because).toMatch(/confidence bounds will be wide/);
        expect(r.canRun).toContain('Weibull and MTBF');   // runs, with the caveat stated
    });

    it('cost coverage below half is partial, with the SAP columns named', () => {
        const r = studyReadiness({ ...empty, assets: 10, workOrders: 66, workOrdersWithCost: 20 });
        const c = byKey(r).cost;
        expect(c.status).toBe('partial');
        expect(c.have).toBe('20 of 66 orders carry cost');
        expect(c.because).toMatch(/actual costs on the order/);
        expect(r.blocked.find(b => b.study === 'Money-ranked findings')!.needs).toBe('cost on work orders');
    });

    it('no breakdown flag is ready but says MTBF is inferred', () => {
        const r = studyReadiness({ ...full, breakdowns: 0 });
        expect(byKey(r).failures.status).toBe('ready');
        expect(byKey(r).failures.because).toMatch(/breakdown indicator with the history \(SAP PM: MSAUS; Maximo: failure class\)/);
    });

    it('points without readings are partial', () => {
        const r = studyReadiness({ ...empty, assets: 10, readingPoints: 35 });
        expect(byKey(r).condition.status).toBe('partial');
        expect(byKey(r).condition.have).toBe('35 reading points, 0 readings');
    });

    it('routes are the page’s to decide', () => {
        const r = studyReadiness(empty, { failures: '/somewhere/else' });
        expect(byKey(r).failures.action.to).toBe('/somewhere/else');
        expect(byKey(r).register.action.to).toBe('/admin/migration#register');
    });
});
