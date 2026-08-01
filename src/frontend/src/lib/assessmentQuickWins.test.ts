import { describe, it, expect } from 'vitest';
import { computeQuickWins, type QuickWinSource } from './assessmentQuickWins';
import { QUICK_WIN_FIXTURE } from './assessmentQuickWins.fixture';

const wins = computeQuickWins(QUICK_WIN_FIXTURE);

/** An assessment with nothing in it — the day-one tenant. */
const EMPTY: QuickWinSource = {
    ...QUICK_WIN_FIXTURE,
    badActors: [], weibull: [], pmWaste: [],
    warranty: { total: 0, items: [] },
    strategy: { ...QUICK_WIN_FIXTURE.strategy, gaps: [] },
    success: { ...QUICK_WIN_FIXTURE.success, worst: [] },
    spares: { ...QUICK_WIN_FIXTURE.spares, exposures: [] },
    skills: { ...QUICK_WIN_FIXTURE.skills, areas: [] },
    register: {
        ...QUICK_WIN_FIXTURE.register,
        structuredPct: 100, criticalitySpreadPct: 55, nameplatePct: 90, tagCollisionCount: 0,
    },
    coverage: { cost_pct: 95, failure_code_pct: 90, downtime_pct: 85 },
};

describe('computeQuickWins — no finding, no advice', () => {
    it('emits nothing at all for a clean assessment', () => {
        expect(computeQuickWins(EMPTY)).toEqual({});
    });

    it('caps every section at three so a chart never disappears under its advice', () => {
        for (const [section, list] of Object.entries(wins)) {
            expect(list.length, `${section} emitted ${list.length}`).toBeLessThanOrEqual(3);
            expect(list.length).toBeGreaterThan(0);   // absent, never empty
        }
    });

    it('gives every win a stable id, an action and the evidence behind it', () => {
        const all = Object.values(wins).flat();
        expect(new Set(all.map((w) => w.id)).size).toBe(all.length);
        for (const w of all) {
            expect(w.text.length).toBeGreaterThan(10);
            expect(w.basis.length).toBeGreaterThan(10);
        }
    });
});

describe('bad actors', () => {
    it('takes the vital few, not the whole tail', () => {
        const tags = wins.badActors!.map((w) => w.tags[0]);
        expect(tags).toContain('K-601');
        expect(tags).toContain('PMP-411');
        expect(tags).not.toContain('V-220');    // 99% cumulative — noise
    });

    it('sends the top driver to its own work-order list, carrying the cost', () => {
        const w = wins.badActors!.find((x) => x.id === 'bad-actor:K-601')!;
        expect(w.path).toBe('/work-orders?asset=K-601');
        expect(w.value).toBe(65400);
    });

    it('adds an RCA only for a genuine repeat offender, deep-linked by asset id', () => {
        const rca = wins.badActors!.find((x) => x.id.startsWith('bad-actor-rca'))!;
        expect(rca.path).toBe('/analyze?tab=rca&asset=uuid-k601');
        // PMP-411 has 2 corrective events — below the repeat threshold.
        expect(rca.tags).toEqual(['K-601']);
    });
});

describe('weibull — the shape decides the action', () => {
    const byTag = (tag: string) => wins.weibull!.find((w) => w.tags[0] === tag)!;

    it('β>1.5 → an age-based PM at B10', () => {
        expect(byTag('PMP-411').text).toContain('149 days');
        expect(byTag('PMP-411').path).toBe('/recurring-work');
    });

    it('β<1 → fix quality, and says explicitly not to add PM', () => {
        expect(byTag('P-101-A').text).toMatch(/do not add PM/i);
        expect(byTag('P-101-A').path).toBe('/analyze?tab=defect_elimination&asset=uuid-p101a');
    });

    it('β≈1 → condition monitoring, never an interval', () => {
        expect(byTag('K-601').path).toBe('/readings');
        expect(byTag('K-601').text).not.toMatch(/interval|PM\b/);
    });
});

describe('the rest of the sections', () => {
    it('turns each PM verdict into its own instruction, worst first', () => {
        const texts = wins.pmWaste!.map((w) => w.text);
        expect(texts[0]).toMatch(/^Revise or retire PM-65320/);   // ineffective ranks first
        expect(texts.join(' ')).toMatch(/Retire PM-70111/);
        expect(wins.pmWaste!.every((w) => w.path === '/recurring-work')).toBe(true);
    });

    it('routes each strategy gap to the module that implements its regime', () => {
        const paths = Object.fromEntries(wins.strategy!.map((w) => [w.tags[0], w.path]));
        expect(paths['K-601']).toBe('/readings');                                   // condition_based
        expect(paths['PMP-411']).toBe('/recurring-work');                           // fixed_interval
        expect(paths['P-101-A']).toBe('/analyze?tab=defect_elimination&asset=uuid-p101a');
        expect(wins.strategy!.find((w) => w.tags[0] === 'PMP-411')!.text).toContain('every 149 days');
    });

    it('opens a seeded work order for an asset outside its band', () => {
        const w = wins.success![0];
        expect(w.path).toContain('/work-orders?action=create');
        expect(w.path).toContain('asset=uuid-k601');            // create seeds by ID, not tag
        expect(decodeURIComponent(w.path!)).toContain('title=Restore K-601');
    });

    it('carries the warranty total as money and lands on the largest claim', () => {
        expect(wins.warranty![0].value).toBe(8200);
        expect(wins.warranty![0].path).toBe('/work-orders?asset=K-601');
    });

    it('ranks stockouts above untraceable stock', () => {
        expect(wins.spares!.map((w) => w.text)).toEqual([
            'Replenish Mechanical seal 2in',
            'Add Coupling insert to the stock records',
        ]);
    });

    it('names the register defects in the order an engineer repairs them', () => {
        // Hierarchy, then criticality, then nameplate — the same fix order the
        // section's own prose states. Collisions fall outside the cap of three.
        expect(wins.register!.map((w) => w.id))
            .toEqual(['register-hierarchy', 'register-criticality', 'register-nameplate']);
    });

    it('raises a win only for capability areas with real demand and no cover', () => {
        expect(wins.workforce!.map((w) => w.id)).toEqual(['skill:condition_monitoring']);
    });

    it('lists the data upgrades in value order', () => {
        expect(wins.dataQuality!.map((w) => w.id)).toEqual(['data-cost', 'data-failure-code', 'data-downtime']);
    });
});
