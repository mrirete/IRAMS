import { describe, it, expect } from 'vitest';
import { parseBriefing, tokenizeTags, routeForAction, guideForMission, deepLink } from './briefingParse';

// Shape the live reliability_digest actually produced (2026-07-28 run).
const SAMPLE = `**Reliability & Integrity Digest: Fleet Overview**

**Headline**
The fleet shows a moderate maintenance load with a few critical assets driving the majority of costs.

**Maintenance Load**
There are 10 open work orders across the fleet, with 2 PM programs past due.

**Top Bad Actors**
The top 5 bad actors account for 100% of the maintenance costs over the last 365 days.
*   **GT-301** is the primary cost driver at $352,900 (76.2% of total cost).
*   **K-601** follows with $65,400 (90.4% cumulative).

**Integrity Watch**
No CMLs were found to be at risk of corrosion or near end-of-life.

**Act This Week**
1.  **Address high-cost assets:** Investigate the root causes for GT-301 (2 failure events)
and K-601 to reduce recurring costs.
2.  **Clear overdue PMs:** Prioritize the 1 overdue PM and 5 open work orders for P-101-A.
3.  **Review open work orders on K-601:** Address the 3 open work orders.`;

describe('parseBriefing', () => {
    it('splits the live digest into classified sections and drops the doc title', () => {
        const p = parseBriefing(SAMPLE);
        const keys = p.sections.map((s) => s.key);
        expect(keys).toEqual(['headline', 'load', 'badActors', 'integrity', 'act']);
        expect(p.sections.find((s) => s.key === 'load')?.body).toContain('10 open work orders');
    });

    it('extracts numbered act items with wrapped continuation lines', () => {
        const p = parseBriefing(SAMPLE);
        expect(p.actions).toHaveLength(3);
        expect(p.actions[0]).toContain('and K-601 to reduce recurring costs');
        expect(p.actions[1]).toMatch(/^\*\*Clear overdue PMs/);
    });

    it('returns no sections for unstructured text so callers can fall back', () => {
        const p = parseBriefing('The briefing could not be produced right now (error).');
        expect(p.sections).toHaveLength(0);
        expect(p.actions).toHaveLength(0);
    });

    it('keeps prose before any heading as an untitled headline', () => {
        const p = parseBriefing('All quiet this week.\n\n**Act This Week**\n1. Do nothing.');
        expect(p.sections[0].key).toBe('headline');
        expect(p.sections[0].body).toContain('All quiet');
    });
});

describe('tokenizeTags', () => {
    const TAGS = ['GT-301', 'K-601', 'P-101-A', 'P-101', 'PMP-411', '20000001'];

    it('links known tags, longest-first, preserving surrounding text', () => {
        const toks = tokenizeTags('Investigate P-101-A and K-601 today.', TAGS);
        expect(toks).toEqual([
            { kind: 'text', value: 'Investigate ' },
            { kind: 'tag', value: 'P-101-A' },
            { kind: 'text', value: ' and ' },
            { kind: 'tag', value: 'K-601' },
            { kind: 'text', value: ' today.' },
        ]);
    });

    it('respects boundaries — PMP-411 never matches an inner P-411, nor partial numerics', () => {
        const toks = tokenizeTags('PMP-411 and 120000001x', ['P-411', '20000001']);
        expect(toks.every((t) => t.kind === 'text')).toBe(true);
    });

    it('matches case-insensitively but renders the original text', () => {
        const toks = tokenizeTags('see gt-301.', TAGS);
        expect(toks[1]).toEqual({ kind: 'tag', value: 'gt-301' });
    });
});

describe('routeForAction', () => {
    it('routes by module keywords in specificity order, already deep-linked', () => {
        expect(routeForAction('Investigate the root causes for GT-301')?.path).toBe('/analyze?tab=rca');
        expect(routeForAction('Raise a defect elimination task for GT-301')?.path).toBe('/analyze?tab=defect_elimination');
        expect(routeForAction('Clear the 2 overdue PMs on P-101-A')?.path).toBe('/recurring-work?due=overdue');
        expect(routeForAction('Review the 3 open work orders on K-601')?.path).toBe('/work-orders');
        expect(routeForAction('Schedule the CML inspection on V-201')?.path).toBe('/comply/evaluate');
        expect(routeForAction('Revise the "Pump Inspection" PM for P-101-A given 5 failures')?.path).toBe('/recurring-work?due=overdue');
        expect(routeForAction('File the warranty claim')?.path).toBe('/specialist/assessment');
        expect(routeForAction('Celebrate the win')).toBeNull();
    });
});

describe('deepLink', () => {
    const ASSETS = [{ tag: 'K-601', id: 'uuid-k601' }];

    it('scopes the WO list by tag and Analyze by asset id', () => {
        expect(deepLink({ path: '/work-orders', label: 'Work orders' }, ASSETS)).toBe('/work-orders?asset=K-601');
        expect(deepLink({ path: '/analyze?tab=rca', label: 'Analyze' }, ASSETS)).toBe('/analyze?tab=rca&asset=uuid-k601');
    });

    it('leaves routes untouched without entities or without a scoped form', () => {
        expect(deepLink({ path: '/work-orders', label: 'Work orders' }, [])).toBe('/work-orders');
        expect(deepLink({ path: '/comply/evaluate', label: 'Integrity' }, ASSETS)).toBe('/comply/evaluate');
    });
});

describe('guideForMission', () => {
    it('gives every routed destination a concrete, tag-specific playbook', () => {
        for (const path of ['/analyze', '/recurring-work', '/work-orders', '/comply/evaluate', '/specialist/deliver']) {
            const g = guideForMission(path, ['GT-301']);
            expect(g.title.length).toBeGreaterThan(0);
            expect(g.steps.length).toBeGreaterThanOrEqual(2);
        }
        expect(guideForMission('/analyze', ['GT-301']).steps[0]).toContain('GT-301');
        expect(guideForMission('/analyze', ['GT-301', 'K-601']).steps[0]).toContain('GT-301, K-601');
    });

    it('falls back gracefully with no tags and unknown paths', () => {
        expect(guideForMission('/analyze', []).steps[0]).toContain('the flagged asset');
        expect(guideForMission('/somewhere-new', []).steps.length).toBeGreaterThanOrEqual(2);
    });
});
