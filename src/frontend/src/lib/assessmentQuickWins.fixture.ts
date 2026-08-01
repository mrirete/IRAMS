/**
 * A synthetic assessment that trips EVERY quick-win branch.
 *
 * Shared by assessmentQuickWins.test.ts (does each branch say the right thing?)
 * and handoffContract.test.ts (does every path it emits resolve to a real route
 * that reads the params it carries?). Test-only — nothing imports it at runtime.
 */
import type { QuickWinSource } from './assessmentQuickWins';

export const QUICK_WIN_FIXTURE: QuickWinSource = {
    assetIndex: [
        { id: 'uuid-k601', tag: 'K-601', name: 'Gas Compressor', criticality: 'A' },
        { id: 'uuid-pmp411', tag: 'PMP-411', name: 'Boiler Feed Pump B', criticality: 'A' },
        { id: 'uuid-p101a', tag: 'P-101-A', name: 'Primary Feed Pump A', criticality: 'B' },
        { id: 'uuid-v220', tag: 'V-220', name: 'Separator', criticality: 'C' },
    ],
    badActors: [
        { tag: 'K-601', name: 'Gas Compressor', criticality: 'A', cost12mo: 65400, woCount12mo: 12, cmCount12mo: 9, downtime12mo: 40, cumulativePct: 51 },
        { tag: 'PMP-411', name: 'Boiler Feed Pump B', criticality: 'A', cost12mo: 21500, woCount12mo: 6, cmCount12mo: 2, downtime12mo: 10, cumulativePct: 69 },
        { tag: 'V-220', name: 'Separator', criticality: 'C', cost12mo: 900, woCount12mo: 1, cmCount12mo: 0, downtime12mo: 0, cumulativePct: 99 },
    ],
    weibull: [
        { assetId: 'uuid-pmp411', tag: 'PMP-411', name: 'Boiler Feed Pump B', nFailures: 5, nSuspensions: 1, beta: 2.4, eta: 300, b10Days: 149, r2: 0.94, interpretation: 'wear-out' },
        { assetId: 'uuid-p101a', tag: 'P-101-A', name: 'Primary Feed Pump A', nFailures: 8, nSuspensions: 0, beta: 0.7, eta: 90, b10Days: 13, r2: 0.88, interpretation: 'infant mortality' },
        { assetId: 'uuid-k601', tag: 'K-601', name: 'Gas Compressor', nFailures: 9, nSuspensions: 2, beta: 1.05, eta: 60, b10Days: 20, r2: 0.9, interpretation: 'random' },
    ],
    warranty: {
        total: 8200,
        items: [
            { woNumber: 'WO-1001', tag: 'K-601', date: '2026-03-04', recoverable: 6000 },
            { woNumber: 'WO-1044', tag: 'PMP-411', date: '2026-04-19', recoverable: 2200 },
        ],
    },
    pmWaste: [
        { code: 'PM-65320', title: 'Pump Inspection', tag: 'P-101-A', category: 'ineffective', annualEvents: 12, failures12mo: 5 },
        { code: 'PM-70110', title: 'Compressor Check', tag: 'K-601', category: 'over_maintenance', annualEvents: 52, failures12mo: 1 },
        { code: 'PM-70111', title: 'Duplicate Check', tag: 'K-601', category: 'redundant', annualEvents: 12, failures12mo: 0 },
        { code: 'PM-88000', title: 'Annual Service', tag: 'PMP-411', category: 'under_maintenance', annualEvents: 1, failures12mo: 4 },
    ],
    strategy: {
        verdicts: [],
        criticalTotal: 10,
        criticalCovered: 4,
        coveragePct: 40,
        gaps: [
            { assetId: 'uuid-k601', tag: 'K-601', name: 'Gas Compressor', criticality: 'A', recommended: 'condition_based', basis: 'Random failure pattern on a critical machine.', recommendedIntervalDays: null, weibull: null, cmCost12mo: 65400, hasActivePm: false, isMonitored: false, aligned: false, smeaTop: null },
            { assetId: 'uuid-pmp411', tag: 'PMP-411', name: 'Boiler Feed Pump B', criticality: 'A', recommended: 'fixed_interval', basis: 'Clear wear-out; B10 supports an interval.', recommendedIntervalDays: 149, weibull: null, cmCost12mo: 21500, hasActivePm: false, isMonitored: false, aligned: false, smeaTop: null },
            { assetId: 'uuid-p101a', tag: 'P-101-A', name: 'Primary Feed Pump A', criticality: 'B', recommended: 'defect_elimination', basis: 'Infant mortality — fix quality, not frequency.', recommendedIntervalDays: null, weibull: null, cmCost12mo: 17950, hasActivePm: true, isMonitored: false, aligned: false, smeaTop: null },
        ],
    },
    success: {
        assetsWithBands: 3,
        assetsMeasured: 3,
        fleetSuccessRate: 61,
        meanTimeInSpotPct: 58,
        zoneCounts: { inSpot: 1, drift: 1, critical: 1, unknown: 0 },
        worst: [
            { assetId: 'uuid-k601', tag: 'K-601', name: 'Gas Compressor', zoneNow: 'CRITICAL_DEPARTURE', successRate: 40, percentTimeInSpot: 32, mtopHours: 100, mttrgHours: 20, currentDepartureHours: 14 },
            { assetId: 'uuid-p101a', tag: 'P-101-A', name: 'Primary Feed Pump A', zoneNow: 'SUB_OPTIMAL_DRIFT', successRate: 70, percentTimeInSpot: 61, mtopHours: 200, mttrgHours: 30, currentDepartureHours: null },
        ],
        targets: { srTarget: 85, srWorldClass: 95 },
    },
    spares: {
        exposures: [
            { itemId: 'item-1', label: 'Mechanical seal 2in', consumedQty12mo: 3, uses: 3, onHand: 0, minLevel: 2, assets: ['K-601'], severity: 'stockout' },
            { itemId: null, label: 'Coupling insert', consumedQty12mo: 2, uses: 2, onHand: null, minLevel: null, assets: ['PMP-411'], severity: 'unknown_stock' },
        ],
        criticalPartsTracked: 5,
        stockRowsSeen: 40,
    },
    skills: {
        areas: [
            { key: 'condition_monitoring', label: 'Condition monitoring', demand: 6, qualifiedPeople: 0, gap: true, exampleQuals: [] },
            { key: 'pm_execution', label: 'PM execution', demand: 9, qualifiedPeople: 4, gap: false, exampleQuals: ['Mech Tech L2'] },
        ],
        totalQualifications: 7,
        expiringSoon: 1,
    },
    register: {
        assetCount: 69,
        healthPct: 44,
        structuredPct: 38,
        criticalitySpreadPct: 12,
        nameplatePct: 32,
        woLinkedPct: 91,
        woUnlinkedCount: 18,
        tagCollisionCount: 2,
        tagCollisionExamples: [['P-101-A', 'P101A']],
        dominantCriticality: { value: 'C', pct: 88 },
    },
    coverage: { cost_pct: 65, failure_code_pct: 48, downtime_pct: 65 },
};
