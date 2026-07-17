import { describe, it, expect } from 'vitest';
import { allocateIssue } from './goodsIssue';

const loc = (id: string, quantity: number) => ({ id, location_id: `L-${id}`, quantity });

describe('allocateIssue', () => {
    it('takes everything from one location when it holds enough', () => {
        const { takes, shortfall } = allocateIssue(3, [loc('a', 10)]);
        expect(takes).toEqual([{ stockRowId: 'a', locationId: 'L-a', take: 3, newQty: 7 }]);
        expect(shortfall).toBe(0);
    });

    it('drains the largest holding first, then spills to the next', () => {
        const { takes, shortfall } = allocateIssue(12, [loc('small', 4), loc('big', 10)]);
        expect(takes).toEqual([
            { stockRowId: 'big', locationId: 'L-big', take: 10, newQty: 0 },
            { stockRowId: 'small', locationId: 'L-small', take: 2, newQty: 2 },
        ]);
        expect(shortfall).toBe(0);
    });

    it('reports the shortfall instead of going negative', () => {
        const { takes, shortfall } = allocateIssue(9, [loc('a', 4), loc('b', 2)]);
        expect(takes.reduce((s, t) => s + t.take, 0)).toBe(6);
        expect(takes.every(t => t.newQty >= 0)).toBe(true);
        expect(shortfall).toBe(3);
    });

    it('skips zero/negative holdings and handles no stock at all', () => {
        expect(allocateIssue(5, [loc('empty', 0), loc('neg', -2)])).toEqual({ takes: [], shortfall: 5 });
        expect(allocateIssue(5, [])).toEqual({ takes: [], shortfall: 5 });
    });
});
