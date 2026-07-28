import { describe, it, expect } from 'vitest';
import { computeBriefingAnalytics, type ChartWoRow } from './briefingCharts';

const NOW = Date.UTC(2026, 6, 28); // 2026-07-28
const DAY_MS = 86_400_000;
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY_MS).toISOString();

const wo = (over: Partial<ChartWoRow>): ChartWoRow => ({
    asset_id: 'a1', type: 'CM', status: 'CLOSED', created_at: iso(10), cost: 0, ...over,
});

const ASSETS = [
    { id: 'a1', tag: 'GT-301', name: 'Gas Turbine' },
    { id: 'a2', tag: 'K-601', name: 'Compressor' },
];

describe('computeBriefingAnalytics', () => {
    it('buckets 12 calendar months oldest-first, empty months included, year on January', () => {
        const r = computeBriefingAnalytics([wo({ cost: 100, created_at: iso(3) })], ASSETS, NOW);
        expect(r.monthly).toHaveLength(12);
        expect(r.monthly[0].key).toBe('2025-08');
        expect(r.monthly[11].key).toBe('2026-07');
        expect(r.monthly[11].cost).toBe(100);
        expect(r.monthly.find((m) => m.key === '2026-01')?.label).toBe('Jan 26');
        expect(r.monthly.filter((m) => m.cost === 0)).toHaveLength(11);
    });

    it('ranks the Pareto with cumulative share of the 12-month total', () => {
        const rows = [
            wo({ asset_id: 'a1', cost: 300 }),
            wo({ asset_id: 'a1', cost: 100 }),
            wo({ asset_id: 'a2', cost: 100 }),
        ];
        const r = computeBriefingAnalytics(rows, ASSETS, NOW);
        expect(r.pareto.map((p) => p.tag)).toEqual(['GT-301', 'K-601']);
        expect(r.pareto[0].cumPct).toBe(80);
        expect(r.pareto[1].cumPct).toBe(100);
        expect(r.spend12mo).toBe(500);
    });

    it('excludes rows older than 12 months from spend but still counts them when open', () => {
        const r = computeBriefingAnalytics([
            wo({ cost: 999, created_at: iso(400), status: 'OPEN' }),
            wo({ cost: 50, status: 'IN_PROGRESS', type: 'CM' }),
            wo({ cost: 25, status: 'TECO' }),
        ], ASSETS, NOW);
        expect(r.spend12mo).toBe(75);
        expect(r.openTotal).toBe(2);
        expect(r.openCm).toBe(2);
    });

    it('is safe on empty input', () => {
        const r = computeBriefingAnalytics([], [], NOW);
        expect(r.monthly).toHaveLength(12);
        expect(r.pareto).toHaveLength(0);
        expect(r.spend12mo).toBe(0);
    });
});
