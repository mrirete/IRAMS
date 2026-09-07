import { describe, it, expect } from 'vitest';
import { suggestRcaMethod } from './rcaMethodSuggest';

describe('suggestRcaMethod', () => {
    it('defaults to 5-Why when nothing fires', () => {
        const r = suggestRcaMethod({ problemText: 'Seal leaked on startup.' });
        expect(r.method).toBe('five_why');
        expect(r.rule).toBe(4);
        expect(r.reasons).toEqual([]);
    });

    it('safety outranks everything', () => {
        const r = suggestRcaMethod({ safetyTier: 'tier_2', priorRcaCount: 3, evidenceTypes: ['photo', 'note', 'interview'] });
        expect(r.method).toBe('fault_tree');
        expect(r.reasons[0]).toMatch(/TIER 2/);
    });

    it('criticality A alone is a safety signal; first aid is not', () => {
        expect(suggestRcaMethod({ criticality: 'a' }).method).toBe('fault_tree');
        expect(suggestRcaMethod({ safetyTier: 'first_aid' }).method).toBe('five_why');
    });

    it('a repeat failure goes to Logic Tree', () => {
        expect(suggestRcaMethod({ priorRcaCount: 1 }).method).toBe('logic_tree');
        expect(suggestRcaMethod({ triggerType: 'pareto' }).method).toBe('logic_tree');
        expect(suggestRcaMethod({ cmCount12mo: 3 }).method).toBe('logic_tree');
        expect(suggestRcaMethod({ cmCount12mo: 2 }).method).toBe('five_why');
    });

    it('a wide cause space goes to Fishbone', () => {
        expect(suggestRcaMethod({ evidenceTypes: ['photo', 'note', 'sensor_data'] }).method).toBe('fishbone');
        expect(suggestRcaMethod({ evidenceTypes: ['photo', 'photo', 'note'] }).method).toBe('five_why');
        expect(suggestRcaMethod({ category: 'process' }).method).toBe('fishbone');
        const r = suggestRcaMethod({ problemText: 'Intermittent trips, cause unknown.' });
        expect(r.method).toBe('fishbone');
        expect(r.reasons[0]).toContain('"intermittent"');
    });
});
