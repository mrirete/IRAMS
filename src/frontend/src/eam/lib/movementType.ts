/**
 * Movement types (IN-3, migration 0245).
 *
 * SAP posts every stock movement under a movement type (BWART) that decides
 * both the stock direction and the account assignment. The same physical act
 * is a different movement depending on what it references: taking a part out
 * of stores is a 261 against a work order and a 201 against a cost center,
 * and those settle to different receivers.
 *
 * The choice is pure — it depends only on the reference and the sign — so it
 * lives here and is tested, rather than being re-derived at each call site.
 * The DB trigger `ers_movement_defaults` mirrors this exactly for callers
 * that supply nothing; change both together.
 */

export type MovementDirection = 'IN' | 'OUT' | 'TRANSFER';

export interface MovementTypeInput {
    /** What the caller thinks it is doing. */
    transactionType: 'ISSUE' | 'RECEIPT' | 'ADJUSTMENT' | 'STOCKTAKE';
    /** Present when the movement is against a purchase order. */
    poId?: string;
    /** Present when the movement is against a work order. */
    woId?: string;
    /** Signed stock change. Only its sign matters, and only for adjustments. */
    delta?: number;
}

/** The seeded catalog — mirrors the rows inserted by 0245. */
export const MOVEMENT_TYPES: Record<string, { name: string; direction: MovementDirection }> = {
    '101': { name: 'Goods receipt for purchase order', direction: 'IN' },
    '102': { name: 'Reversal of goods receipt', direction: 'OUT' },
    '201': { name: 'Goods issue to cost center', direction: 'OUT' },
    '202': { name: 'Reversal of issue to cost center', direction: 'IN' },
    '261': { name: 'Goods issue to order', direction: 'OUT' },
    '262': { name: 'Reversal of issue to order', direction: 'IN' },
    '311': { name: 'Transfer between storage locations', direction: 'TRANSFER' },
    '501': { name: 'Receipt without purchase order', direction: 'IN' },
    '551': { name: 'Goods issue for scrapping', direction: 'OUT' },
    '552': { name: 'Reversal of scrapping', direction: 'IN' },
    '561': { name: 'Initial stock entry', direction: 'IN' },
    '701': { name: 'Inventory count gain', direction: 'IN' },
    '702': { name: 'Inventory count loss', direction: 'OUT' },
};

/**
 * Pick the movement type for a stock change.
 *
 * A zero or absent delta on an adjustment resolves to 701 rather than 702: a
 * "loss" is a claim that stock went missing, and that should never be the
 * default reading of an ambiguous row.
 */
export function movementTypeFor(input: MovementTypeInput): string {
    const { transactionType, poId, woId, delta } = input;

    if (transactionType === 'RECEIPT') return poId ? '101' : '501';
    if (transactionType === 'ISSUE') return woId ? '261' : '201';
    return (delta ?? 0) < 0 ? '702' : '701';
}

/**
 * Expense sign: stock leaving the store is a cost, stock coming back is a
 * credit, a transfer is neither. Multiplied by quantity x unit cost to value
 * the movement the same way `ers_movement_defaults` does server-side.
 */
export function expenseSign(movementType: string): 1 | -1 | 0 {
    const direction = MOVEMENT_TYPES[movementType]?.direction;
    if (direction === 'OUT') return 1;
    if (direction === 'IN') return -1;
    return 0;
}
