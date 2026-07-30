import { describe, it, expect } from 'vitest';
import { buildAssessmentSheets, assessmentFilename, sheetsToCsv } from './assessmentExport';
import type { Assessment } from '../eam/services/assessmentEngine';

/** A minimal but structurally real assessment; sections vary per test. */
const base = (over: Partial<Assessment> = {}): Assessment => ({
    windowMonths: 12,
    totalSpend12mo: 127950,
    woCount12mo: 24,
    assetCount: 69,
    badActors: [],
    paretoShare: { topN: 3, pct: 78.4 },
    weibull: [],
    warranty: { total: 0, items: [] },
    pmWaste: [],
    coverage: { cost_pct: 84, failure_code_pct: 44, downtime_pct: 63 },
    register: {
        assetCount: 69, structuredPct: 91.3, criticalitySpreadPct: 42,
        dominantCriticality: { value: 'C', pct: 58 }, nameplatePct: 22,
        tagCollisionCount: 2, tagCollisionExamples: [['P-101', 'p101']],
        woLinkedPct: 96, woUnlinkedCount: 1, healthPct: 61.5,
    } as Assessment['register'],
    strategy: { verdicts: [], criticalTotal: 12, criticalCovered: 5, coveragePct: 41.7, gaps: [] },
    success: {
        assetsWithBands: 4, assetsMeasured: 0, fleetSuccessRate: null, meanTimeInSpotPct: null,
        zoneCounts: { inSpot: 0, drift: 0, critical: 0, unknown: 4 }, worst: [],
        targets: { srTarget: 85, srWorldClass: 95 },
    },
    skills: { areas: [], totalQualifications: 0, expiringSoon: 0 },
    spares: { exposures: [], criticalPartsTracked: 0, stockRowsSeen: 0 },
    frontOfLife: [],
    pointCountByAsset: {},
    parentByAsset: {},
    assetIndex: [],
    dataFrom: '2025-07-30T00:00:00.000Z',
    dataTo: '2026-07-30T00:00:00.000Z',
    scope: null,
    ...over,
});

describe('buildAssessmentSheets', () => {
    it('always emits Summary and Register quality, even with an empty fleet', () => {
        const names = buildAssessmentSheets(base()).map((s) => s.name);
        expect(names).toContain('Summary');
        expect(names).toContain('Register quality');
    });

    it('omits a sheet entirely rather than shipping an empty one', () => {
        const names = buildAssessmentSheets(base()).map((s) => s.name);
        expect(names).not.toContain('Bad actors');
        expect(names).not.toContain('Failure behaviour');
        expect(names).not.toContain('Spares exposure');
    });

    it('writes an absent measure as an em dash, never as zero', () => {
        const summary = buildAssessmentSheets(base()).find((s) => s.name === 'Summary')!;
        const sr = summary.rows.find((r) => r.metric === 'Fleet success rate')!;
        expect(sr.value).toBe('—');
        expect(sr.basis).toMatch(/no banded measurement points/i);
    });

    it('exports percentages as numbers so the recipient can chart them', () => {
        const summary = buildAssessmentSheets(base()).find((s) => s.name === 'Summary')!;
        expect(summary.rows.find((r) => r.metric === 'Register health')!.value).toBe(61.5);
        expect(summary.rows.find((r) => r.metric === 'Strategy coverage')!.value).toBe(41.7);
    });

    it('states the window and scope on the summary sheet', () => {
        const fleet = buildAssessmentSheets(base())[0];
        expect(fleet.note).toContain('Whole fleet');
        expect(fleet.note).toContain('2025-07-30 → 2026-07-30');
        // The 12-month figures must never be stamped with the history span.
        expect(fleet.note).toContain('trailing 12 months');
        expect(fleet.note).toContain('(12 months)');
        expect(fleet.rows.find((r) => r.metric === 'Work orders')!.basis).toBe('trailing 12 months');

        const scoped = buildAssessmentSheets(base({
            scope: { rootId: 'x', rootTag: 'U-200', rootName: 'Crude Unit' },
        }))[0];
        expect(scoped.note).toContain('U-200');
    });

    it('carries bad actors with cumulative share and criticality', () => {
        const sheets = buildAssessmentSheets(base({
            badActors: [{
                tag: 'K-601', name: 'Gas Compressor', criticality: 'A',
                cost12mo: 65400.4, woCount12mo: 8, cmCount12mo: 4,
                downtime12mo: 180.2, cumulativePct: 51.13,
            }],
        }));
        const rows = sheets.find((s) => s.name === 'Bad actors')!.rows;
        expect(rows[0]).toMatchObject({ tag: 'K-601', cost: 65400, cumPct: 51.1, criticality: 'A' });
    });

    it('labels strategy regimes in words rather than enum keys', () => {
        const sheets = buildAssessmentSheets(base({
            strategy: {
                criticalTotal: 1, criticalCovered: 0, coveragePct: 0, gaps: [],
                verdicts: [{
                    assetId: 'a', tag: 'P-101-A', name: 'Feed Pump', criticality: 'A',
                    recommended: 'condition_based', basis: 'random failures',
                    recommendedIntervalDays: null, weibull: null, cmCost12mo: 1200,
                    hasActivePm: false, isMonitored: false, aligned: false,
                } as Assessment['strategy']['verdicts'][number]],
            },
        }));
        const row = sheets.find((s) => s.name === 'Strategy')!.rows[0];
        expect(row.regime).toBe('Condition based');
        expect(row.interval).toBe('—');
        expect(row.aligned).toBe('No');
    });

    it('keeps every sheet name inside Excel’s 31-character limit and unique', () => {
        const names = buildAssessmentSheets(base({
            badActors: [{ tag: 'K', name: 'K', criticality: 'A', cost12mo: 1, woCount12mo: 1, cmCount12mo: 1, downtime12mo: 1, cumulativePct: 100 }],
            weibull: [{ assetId: 'a', tag: 'K', name: 'K', nFailures: 5, nSuspensions: 1, beta: 1.8, eta: 300, b10Days: 90, r2: 0.94, interpretation: 'wear-out' }],
            pmWaste: [{ code: 'PM1', title: 'Monthly', tag: 'K', category: 'over_maintenance', annualEvents: 12, failures12mo: 0 }],
        })).map((s) => s.name);
        expect(new Set(names).size).toBe(names.length);
        for (const n of names) expect(n.length).toBeLessThanOrEqual(31);
    });
});

describe('assessmentFilename', () => {
    it('stamps the date and names the scope', () => {
        expect(assessmentFilename(base(), '2026-07-30T10:00:00.000Z')).toBe('IRAMS_Assessment_Fleet_2026-07-30');
    });

    it('strips characters a filesystem would reject', () => {
        const name = assessmentFilename(base({ scope: { rootId: 'x', rootTag: 'U 200/A', rootName: 'n' } }), '2026-07-30T00:00:00Z');
        expect(name).toBe('IRAMS_Assessment_U_200_A_2026-07-30');
    });
});

describe('sheetsToCsv fallback', () => {
    it('annotates each sheet and escapes embedded quotes', () => {
        const csv = sheetsToCsv([{
            name: 'S', note: 'note here', columns: [{ key: 'a', label: 'A' }],
            rows: [{ a: 'say "hi"' }],
        }]);
        expect(csv).toContain('# S');
        expect(csv).toContain('# note here');
        expect(csv).toContain('"say ""hi"""');
    });
});
