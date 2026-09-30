import { describe, it, expect } from 'vitest';
import { monthlyExpense, projectAnnual } from './depreciation';

const sum = (rows: { depreciationExpense: number }[]) => Math.round(rows.reduce((s, r) => s + r.depreciationExpense, 0) * 100) / 100;

describe('depreciation engine', () => {
    it('straight-line: pro-rata first year, sums to cost − salvage, ends at salvage', () => {
        const rows = projectAnnual({ method: 'STRAIGHT_LINE', cost: 120000, salvage: 12000, lifeMonths: 60, startDate: '2026-10-01' });
        expect(rows[0].fiscalYear).toBe(2026);
        expect(rows[0].months).toBe(3);                    // Oct, Nov, Dec
        expect(rows[0].depreciationExpense).toBe(5400);    // 3 × 1800
        expect(rows[1].depreciationExpense).toBe(21600);   // a full year
        expect(sum(rows)).toBe(108000);
        expect(rows[rows.length - 1].closingBookValue).toBe(12000);
        expect(rows[rows.length - 1].fiscalYear).toBe(2031);
    });

    it('a fractional life is exact, not rounded up to whole years', () => {
        const rows = projectAnnual({ method: 'STRAIGHT_LINE', cost: 30000, salvage: 0, lifeMonths: 30, startDate: '2026-01-01' });
        expect(rows.map(r => r.months)).toEqual([12, 12, 6]);
        expect(sum(rows)).toBe(30000);
    });

    it('double-declining switches to straight-line and reaches salvage by end of life', () => {
        const rows = projectAnnual({ method: 'DECLINING_BALANCE', cost: 100000, salvage: 10000, lifeMonths: 60, startDate: '2026-01-01' });
        expect(rows[0].depreciationExpense).toBeGreaterThan(rows[1].depreciationExpense); // accelerated
        expect(rows[rows.length - 1].closingBookValue).toBe(10000);
        expect(rows[rows.length - 1].fiscalYear).toBe(2030);                             // not asymptotic
        expect(sum(rows)).toBe(90000);
    });

    it('sum-of-years-digits front-loads and totals the depreciable amount', () => {
        const rows = projectAnnual({ method: 'SUM_OF_YEARS_DIGITS', cost: 50000, salvage: 5000, lifeMonths: 36, startDate: '2026-01-01' });
        expect(rows[0].depreciationExpense).toBeGreaterThan(rows[2].depreciationExpense);
        expect(sum(rows)).toBe(45000);
    });

    it('after postings, projects the carrying value over the REMAINING life (capital event)', () => {
        // 60-month SL asset, 24 months posted at 1500/month, then a capital event lifts the carrying value
        const rows = projectAnnual({
            method: 'STRAIGHT_LINE', cost: 130000, salvage: 10000, lifeMonths: 60, startDate: '2024-01-01',
            posted: { bookValue: 130000 - 36000, accumulated: 36000, lastFiscalYear: 2025, lastPeriod: 12 },
        });
        expect(rows[0].fiscalYear).toBe(2026);
        expect(rows[0].openingBookValue).toBe(94000);
        // 84 000 depreciable over the 36 months left = 2 333.33/month at cent
        // rounding (27 999.96 a year); the final month absorbs the remainder.
        expect(Math.abs(rows[0].depreciationExpense - 28000)).toBeLessThan(0.1);
        expect(rows[rows.length - 1].closingBookValue).toBe(10000);
        expect(rows[rows.length - 1].accumulatedDepreciation).toBe(120000);
    });

    it('never depreciates below salvage in a single month', () => {
        expect(monthlyExpense({ method: 'DECLINING_BALANCE', bookValue: 10500, salvage: 10000, lifeMonths: 12, remainingMonths: 1 })).toBe(500);
        expect(monthlyExpense({ method: 'STRAIGHT_LINE', bookValue: 10000, salvage: 10000, lifeMonths: 12, remainingMonths: 6 })).toBe(0);
    });
});
