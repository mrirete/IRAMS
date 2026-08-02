import { describe, it, expect } from 'vitest';
import { movementTypeFor, expenseSign, MOVEMENT_TYPES } from './movementType';

describe('movementTypeFor', () => {
    it('distinguishes a PO receipt (101) from a receipt with no order behind it (501)', () => {
        expect(movementTypeFor({ transactionType: 'RECEIPT', poId: 'po-1' })).toBe('101');
        expect(movementTypeFor({ transactionType: 'RECEIPT' })).toBe('501');
    });

    it('distinguishes an issue to an order (261) from an issue to a cost center (201)', () => {
        expect(movementTypeFor({ transactionType: 'ISSUE', woId: 'wo-1' })).toBe('261');
        expect(movementTypeFor({ transactionType: 'ISSUE' })).toBe('201');
    });

    it('splits an adjustment into a count gain or a count loss by the sign of the delta', () => {
        expect(movementTypeFor({ transactionType: 'ADJUSTMENT', delta: 5 })).toBe('701');
        expect(movementTypeFor({ transactionType: 'ADJUSTMENT', delta: -5 })).toBe('702');
        expect(movementTypeFor({ transactionType: 'STOCKTAKE', delta: -1 })).toBe('702');
    });

    it('never reads an ambiguous adjustment as a loss', () => {
        // A loss asserts stock went missing. Absent evidence, do not assert it.
        expect(movementTypeFor({ transactionType: 'ADJUSTMENT' })).toBe('701');
        expect(movementTypeFor({ transactionType: 'ADJUSTMENT', delta: 0 })).toBe('701');
    });

    it('lets the reference win over the label — a PO receipt is never a 501', () => {
        expect(movementTypeFor({ transactionType: 'RECEIPT', poId: 'po-1', woId: 'wo-1' })).toBe('101');
    });

    it('only ever returns a type the 0245 catalog seeds', () => {
        const cases: Parameters<typeof movementTypeFor>[0][] = [
            { transactionType: 'RECEIPT', poId: 'p' }, { transactionType: 'RECEIPT' },
            { transactionType: 'ISSUE', woId: 'w' }, { transactionType: 'ISSUE' },
            { transactionType: 'ADJUSTMENT', delta: 1 }, { transactionType: 'ADJUSTMENT', delta: -1 },
            { transactionType: 'STOCKTAKE', delta: 0 },
        ];
        for (const c of cases) {
            expect(MOVEMENT_TYPES[movementTypeFor(c)]).toBeDefined();
        }
    });
});

describe('expenseSign', () => {
    it('charges stock that leaves and credits stock that returns', () => {
        expect(expenseSign('261')).toBe(1);   // issue to order — a cost
        expect(expenseSign('262')).toBe(-1);  // returned to stores — a credit
        expect(expenseSign('702')).toBe(1);   // count loss — a cost
        expect(expenseSign('701')).toBe(-1);  // count gain — a credit
    });

    it('values a transfer at nothing — the stock moved, the money did not', () => {
        expect(expenseSign('311')).toBe(0);
    });

    it('treats an unknown type as valueless rather than guessing a direction', () => {
        expect(expenseSign('999')).toBe(0);
    });

    it('pairs every reversal with the opposite sign of what it reverses', () => {
        const pairs: [string, string][] = [['201', '202'], ['261', '262'], ['551', '552']];
        for (const [original, reversal] of pairs) {
            expect(expenseSign(original)).toBe(-expenseSign(reversal));
        }
    });
});
