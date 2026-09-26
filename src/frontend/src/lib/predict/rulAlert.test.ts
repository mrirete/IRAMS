import { describe, it, expect } from 'vitest';
import { rulAlertDraft, rulAlertWindowDays } from './rulAlert';

const base = { assetTag: 'PMP-411', rulDays: 13, band50: { lower: 5, upper: 19 }, beta: 7.46, etaHours: 4989, nFailures: 6, ageDays: 223, now: new Date('2026-09-26T00:00:00Z') };

describe('remaining-life alert', () => {
    it('the window follows criticality', () => {
        expect(rulAlertWindowDays('A')).toBeGreaterThan(rulAlertWindowDays('C'));
        expect(rulAlertWindowDays(null)).toBe(rulAlertWindowDays('zzz'));
    });

    it('outside the window: nothing', () => {
        expect(rulAlertDraft({ ...base, rulDays: 400, criticality: 'A' })).toBeNull();
    });

    it('a criticality-A pump 13 days out: medium, titled on the asset, band and pattern in the text', () => {
        const d = rulAlertDraft({ ...base, criticality: 'A', readingAgeDays: 211 })!;
        expect(d.severity).toBe('medium');
        expect(d.title).toBe('Remaining life 13 days (fitted life model): PMP-411');
        expect(d.description).toContain('223 days since the last failure');
        expect(d.description).toContain('regular wear-out');
        expect(d.description).toContain('between 5 and 19 days');
        expect(d.description).toContain('211 days old');
    });

    it('a week or less is high; fresh readings add no caveat; none at all says so', () => {
        expect(rulAlertDraft({ ...base, rulDays: 6, criticality: 'B', readingAgeDays: 0.2 })!.severity).toBe('high');
        expect(rulAlertDraft({ ...base, criticality: 'A', readingAgeDays: 0.2 })!.description).not.toContain('unknown');
        expect(rulAlertDraft({ ...base, criticality: 'A', readingAgeDays: null })!.description).toContain('no condition readings');
    });
});
