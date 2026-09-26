import { describe, it, expect } from 'vitest';
import { buildVerdict } from './verdict';

const now = new Date('2026-09-26T00:00:00Z');
const pmp411 = { health: 91, readingAgeDays: 211, fitted: { rulDays: 13, band50: { lower: 5, upper: 19 }, nFailures: 2 }, breaches: 0, openAlerts: 1, windowDays: 30, now };

describe('buildVerdict', () => {
    it('PMP-411: condition unknown, history says due → take a reading, then plan', () => {
        const v = buildVerdict(pmp411);
        expect(v.tone).toBe('act');
        expect(v.action).toBe('take_reading');
        expect(v.text).toContain('Condition unknown (last reading 211 days ago)');
        expect(v.text).toContain('expected failure in ~13 days');
        expect(v.text).toContain('half the odds within 5–19 days');
        expect(v.text).toMatch(/Take a reading this week, then plan the work before/);
    });

    it('fresh readings and a near failure → plan the work', () => {
        const v = buildVerdict({ ...pmp411, readingAgeDays: 0.5 });
        expect(v.action).toBe('plan_work');
        expect(v.text).toContain('Condition fine today, health 91');
    });

    it('fresh, no fit, a breach → work the breach', () => {
        const v = buildVerdict({ ...pmp411, readingAgeDays: 1, fitted: null, breaches: 2, openAlerts: 0 });
        expect(v.tone).toBe('watch');
        expect(v.text).toContain('2 points breaching a band');
        expect(v.text).toContain('Work the 2 breaches in Forecast');
    });

    it('fresh, a distant fit, nothing open → ok', () => {
        const v = buildVerdict({ ...pmp411, readingAgeDays: 1, fitted: { rulDays: 400, nFailures: 5 }, openAlerts: 0 });
        expect(v.tone).toBe('ok');
        expect(v.text).toContain('~400 days of expected life (5 recorded failures)');
    });

    it('stale, no fit, nothing open → bring it up to date; nothing at all → set up', () => {
        expect(buildVerdict({ ...pmp411, fitted: null, openAlerts: 0 }).action).toBe('take_reading');
        expect(buildVerdict({ health: null, readingAgeDays: null, fitted: null, breaches: 0, openAlerts: 0, windowDays: 14 }).action).toBe('set_up');
    });
});
