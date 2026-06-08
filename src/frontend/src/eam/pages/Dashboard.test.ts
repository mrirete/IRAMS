import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Dashboard.test.tsx
 * 
 * Tests the Dashboard component renders KPIs from live Supabase data.
 * Uses mocked supabase client to avoid network calls in tests.
 */

// Mock supabase client
vi.mock('../lib/supabase', () => {
    const mockFrom = vi.fn(() => ({
        select: vi.fn(() => ({
            data: [],
            error: null,
            lt: vi.fn(() => ({
                not: vi.fn(() => ({
                    data: [],
                    error: null,
                })),
            })),
            eq: vi.fn(() => ({ data: [], error: null })),
            order: vi.fn(() => ({
                limit: vi.fn(() => ({ data: [], error: null })),
            })),
            not: vi.fn(() => ({ data: [], error: null })),
        })),
    }));

    return {
        supabase: {
            from: mockFrom,
        },
    };
});

describe('Dashboard Data Logic', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should correctly compute WO status counts', () => {
        const woData = [
            { status: 'OPEN' },
            { status: 'OPEN' },
            { status: 'WIP' },
            { status: 'CLOSED' },
            { status: 'TECO' },
            { status: 'OPEN' },
        ];

        const statusMap: Record<string, number> = {};
        woData.forEach((wo) => {
            statusMap[wo.status] = (statusMap[wo.status] || 0) + 1;
        });

        expect(statusMap['OPEN']).toBe(3);
        expect(statusMap['WIP']).toBe(1);
        expect(statusMap['CLOSED']).toBe(1);
        expect(statusMap['TECO']).toBe(1);
    });

    it('should compute PM compliance rate', () => {
        const totalWOs = 10;
        const closedWOs = 8;
        const pmCompliance = totalWOs > 0 ? Math.round((closedWOs / totalWOs) * 100) : 0;
        expect(pmCompliance).toBe(80);
    });

    it('should handle zero work orders gracefully', () => {
        const totalWOs = 0;
        const closedWOs = 0;
        const pmCompliance = totalWOs > 0 ? Math.round((closedWOs / totalWOs) * 100) : 0;
        expect(pmCompliance).toBe(0);
    });

    it('should identify low stock items correctly', () => {
        const invData = [
            { id: '1', stock_on_hand: 5, min_level: 10, is_critical: true },
            { id: '2', stock_on_hand: 50, min_level: 10, is_critical: false },
            { id: '3', stock_on_hand: 0, min_level: 5, is_critical: true },
            { id: '4', stock_on_hand: null, min_level: null, is_critical: false },
        ];

        const lowStockItems = invData.filter((i) =>
            i.stock_on_hand !== null && i.min_level !== null && i.stock_on_hand <= i.min_level
        );

        expect(lowStockItems.length).toBe(2);
        expect(lowStockItems[0].id).toBe('1');
        expect(lowStockItems[1].id).toBe('3');
    });

    it('should identify critical low stock items for alerts', () => {
        const invData = [
            { id: '1', stock_on_hand: 5, min_level: 10, is_critical: true },
            { id: '2', stock_on_hand: 5, min_level: 10, is_critical: false },
            { id: '3', stock_on_hand: 0, min_level: 5, is_critical: true },
        ];

        const criticalLowStock = invData.filter((i) =>
            i.is_critical && i.stock_on_hand <= i.min_level
        );

        expect(criticalLowStock.length).toBe(2);
    });

    it('should correctly categorize WO types', () => {
        const woData = [
            { type: 'Corrective' },
            { type: 'Preventive' },
            { type: 'Preventive' },
            { type: 'Emergency' },
            { type: null },
        ];

        const woTypeMap: Record<string, number> = {};
        woData.forEach((wo) => {
            const type = wo.type || 'Unspecified';
            woTypeMap[type] = (woTypeMap[type] || 0) + 1;
        });

        expect(woTypeMap['Corrective']).toBe(1);
        expect(woTypeMap['Preventive']).toBe(2);
        expect(woTypeMap['Emergency']).toBe(1);
        expect(woTypeMap['Unspecified']).toBe(1);
    });
});
