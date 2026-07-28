/** Tests for the data-ready engines: skillsGap (F5), sparesExposure (B4),
 *  careRoutes (F1), diffStrategyVerdicts (D4). */
import { describe, it, expect } from 'vitest';
import { computeSkillsGap } from './skillsGap';
import { computeSparesExposure } from './sparesExposure';
import { planCareRoutes } from './careRoutes';
import { diffStrategyVerdicts } from './strategySelect';

const NOW = Date.UTC(2026, 6, 28);
const DAY_MS = 86_400_000;

describe('computeSkillsGap (F5)', () => {
    const V = (recommended: string, n: number) => Array.from({ length: n }, () => ({ recommended } as never));

    it('matches qualifications into capability areas and flags demand with no supply', () => {
        const r = computeSkillsGap(
            [...V('condition_based', 4), ...V('fixed_interval', 3), ...V('rcm_study', 5)],
            [
                { contact_id: 'p1', name: 'Vibration Analyst ISO 18436 Cat II', type: 'Certification', status: 'Active', date_expires: null },
                { contact_id: 'p2', name: 'Laser Alignment', type: 'Training', status: 'Active', date_expires: null },
            ],
            NOW,
        );
        const cm = r.areas.find((a) => a.key === 'condition_monitoring')!;
        expect(cm.demand).toBe(4);
        expect(cm.qualifiedPeople).toBe(1);
        expect(cm.gap).toBe(false);
        const rcm = r.areas.find((a) => a.key === 'rcm_facilitation')!;
        expect(rcm.demand).toBe(5);
        expect(rcm.qualifiedPeople).toBe(0);
        expect(rcm.gap).toBe(true);
    });

    it('excludes expired and inactive qualifications and counts expiring-soon', () => {
        const r = computeSkillsGap([], [
            { contact_id: 'p1', name: 'Thermography L1', type: null, status: 'Active', date_expires: new Date(NOW - DAY_MS).toISOString() },
            { contact_id: 'p2', name: 'Thermography L1', type: null, status: 'Expired', date_expires: null },
            { contact_id: 'p3', name: 'Thermography L1', type: null, status: 'Active', date_expires: new Date(NOW + 30 * DAY_MS).toISOString() },
        ], NOW);
        expect(r.totalQualifications).toBe(1);
        expect(r.expiringSoon).toBe(1);
    });
});

describe('computeSparesExposure (B4)', () => {
    const base = {
        woAsset: new Map([['w1', 'a1'], ['w2', 'a2']]),
        assets: new Map([
            ['a1', { tag: 'K-601', criticality: 'A' }],
            ['a2', { tag: 'X-9', criticality: 'C' }],
        ]),
        nowMs: NOW,
    };

    it('flags stockouts of parts consumed on criticals, ignores non-critical consumption', () => {
        const r = computeSparesExposure({
            ...base,
            parts: [
                { wo_id: 'w1', item_id: 'i1', description: 'Mech seal 3196', quantity_act: 2, date_used: new Date(NOW - 30 * DAY_MS).toISOString() },
                { wo_id: 'w2', item_id: 'i2', description: 'Belt', quantity_act: 4, date_used: new Date(NOW - 30 * DAY_MS).toISOString() },
            ],
            stock: [{ item_id: 'i1', quantity: 0, min_level: 2 }, { item_id: 'i2', quantity: 0, min_level: 1 }],
        });
        expect(r.exposures).toHaveLength(1);
        expect(r.exposures[0]).toMatchObject({ label: 'Mech seal 3196', severity: 'stockout', assets: ['K-601'] });
    });

    it('reports unknown stock rather than dropping unmatched items, and skips well-held parts', () => {
        const r = computeSparesExposure({
            ...base,
            parts: [
                { wo_id: 'w1', item_id: 'legacy-99', description: 'Coupling insert', quantity_act: 1, date_used: new Date(NOW - 10 * DAY_MS).toISOString() },
                { wo_id: 'w1', item_id: 'i1', description: 'Gasket', quantity_act: 1, date_used: new Date(NOW - 10 * DAY_MS).toISOString() },
            ],
            stock: [{ item_id: 'i1', quantity: 10, min_level: 2 }],
        });
        expect(r.exposures).toHaveLength(1);
        expect(r.exposures[0].severity).toBe('unknown_stock');
    });

    it('excludes consumption older than 12 months', () => {
        const r = computeSparesExposure({
            ...base,
            parts: [{ wo_id: 'w1', item_id: 'i1', description: 'Seal', quantity_act: 1, date_used: new Date(NOW - 400 * DAY_MS).toISOString() }],
            stock: [],
        });
        expect(r.exposures).toHaveLength(0);
    });
});

describe('planCareRoutes (F1)', () => {
    const ASSETS = [
        { id: 'area1', tag: 'AREA-1', name: 'Compression', parent_id: null, criticality: null },
        { id: 'k1', tag: 'K-601', name: 'Compressor', parent_id: 'area1', criticality: 'A' },
        { id: 'p1', tag: 'P-101', name: 'Pump', parent_id: 'area1', criticality: 'B' },
        { id: 'x1', tag: 'X-1', name: 'Idle thing', parent_id: 'area1', criticality: 'C' },
    ];

    it('groups monitored/CBM assets by parent with weekly cadence when A-assets ride', () => {
        const routes = planCareRoutes(
            ASSETS,
            [{ assetId: 'p1', recommended: 'condition_based' }],
            new Map([['k1', 3]]),
        );
        expect(routes).toHaveLength(1);
        expect(routes[0]).toMatchObject({ areaTag: 'AREA-1', pointCount: 3, suggestedIntervalDays: 7 });
        expect(routes[0].assets.map((a) => a.tag)).toEqual(['K-601', 'P-101']); // A first, X-1 excluded
    });

    it('returns nothing when no asset is monitored or CBM-flagged', () => {
        expect(planCareRoutes(ASSETS, [], new Map())).toHaveLength(0);
    });
});

describe('diffStrategyVerdicts (D4)', () => {
    it('reports regime changes only, tolerating missing baselines', () => {
        const prev = [
            { assetId: 'a', tag: 'K-601', recommended: 'condition_based' as const },
            { assetId: 'b', tag: 'P-101', recommended: 'fixed_interval' as const },
        ];
        const cur = [
            { assetId: 'a', tag: 'K-601', recommended: 'fixed_interval' as const },
            { assetId: 'b', tag: 'P-101', recommended: 'fixed_interval' as const },
            { assetId: 'c', tag: 'NEW-1', recommended: 'rcm_study' as const },
        ];
        expect(diffStrategyVerdicts(prev, cur)).toEqual([
            { tag: 'K-601', from: 'condition_based', to: 'fixed_interval' },
        ]);
        expect(diffStrategyVerdicts(null, cur)).toEqual([]);
        expect(diffStrategyVerdicts([], cur)).toEqual([]);
    });
});
