import { describe, it, expect } from 'vitest';
import {
    captureAlertDraft, openAlertPoints, alertPointOf, captureTrend, trendVerdict,
    pickRepairCaptures, repairCheck, type CaptureFeatures,
} from './vibrationCaptures';
import { analyzeWaveform, demoBearingSignal } from './spectral';

const match = { race: 'BPFO', raceLabel: 'outer race (BPFO)', designation: '6205-2RS', position: 'NDE', basis: 'datasheet', harmonic: 1, expectedHz: 87.1, peakHz: 86.88, peakAmplitude: 0.19, deviationFrac: 0.0025 } as any;
const investigate = (extra: Partial<CaptureFeatures> = {}): CaptureFeatures => ({
    time: { rms: 0.41, crest: 7.8, kurtosis: 13.7 },
    envPeaks: [{ freqHz: 86.88, amplitude: 0.19, order: 3.52 }],
    diagnosis: { severity: 'investigate', findings: [] },
    ...extra,
});
const at = (d: number) => new Date(Date.UTC(2026, 8, 1) + d * 86_400_000).toISOString();

describe('captureAlertDraft', () => {
    it('ok and watch captures do not alert', () => {
        expect(captureAlertDraft({ diagnosis: { severity: 'ok' } }, 'VIB-NDE')).toBeNull();
        expect(captureAlertDraft({ diagnosis: { severity: 'watch' } }, 'VIB-NDE')).toBeNull();
        expect(captureAlertDraft(investigate(), '  ')).toBeNull();
    });

    it('a named bearing match is high and names the race, bearing and point', () => {
        const d = captureAlertDraft(investigate({ bearingMatches: [match] }), 'VIB-NDE')!;
        expect(d.severity).toBe('high');
        expect(d.title).toBe('Bearing outer race (BPFO) defect — 6205-2RS NDE: VIB-NDE');
        expect(alertPointOf(d.title)).toBe('VIB-NDE');
        expect(d.description).toContain('86.88 Hz');
        expect(d.description).toContain('kurtosis 13.7');
    });

    it('impacting with an unnamed tone is medium and says how to name it', () => {
        const d = captureAlertDraft(investigate(), 'VIB-NDE')!;
        expect(d.severity).toBe('medium');
        expect(d.title).toBe('Bearing defect candidate: VIB-NDE');
        expect(d.description).toContain('Monitoring setup');
    });

    it('an approximate (ball-count) match does not count as named', () => {
        const d = captureAlertDraft(investigate({ bearingMatches: [{ ...match, basis: 'approximate' }] }), 'VIB-NDE')!;
        expect(d.severity).toBe('medium');
    });

    it('the synthetic demo bearing signal screens as an alert', () => {
        const a = analyzeWaveform(demoBearingSignal({ rpm: 1480 }), 5120, 1480);
        expect(captureAlertDraft(a as any, 'VIB-NDE')?.severity).toBe('medium');
    });
});

describe('openAlertPoints', () => {
    it('open = not closed; points compare case-insensitively', () => {
        const pts = openAlertPoints([
            { title: 'Bearing defect candidate: VIB-NDE', status: 'acknowledged' },
            { title: 'Alert: TT-101', status: 'closed' },
            { title: 'Alert: PT-7', acknowledged: false },
        ]);
        expect([...pts].sort()).toEqual(['pt-7', 'vib-nde']);
    });
});

describe('captureTrend', () => {
    it('needs three captures on the point before it calls a trend', () => {
        expect(trendVerdict([3, 4])).toBeNull();
        expect(trendVerdict([3, 3.1, 3.2])).toBe('steady');
        expect(trendVerdict([3, 3.2, 6])).toBe('growing');
        expect(trendVerdict([8, 8, 4])).toBe('falling');
    });

    it('filters to the point, orders oldest first, and trends each metric', () => {
        const caps = [
            { tag: 'VIB-NDE', captured_at: at(10), features: investigate() },
            { tag: 'vib-nde', captured_at: at(0), features: { time: { rms: 0.2, kurtosis: 3.1 }, envPeaks: [] } },
            { tag: 'VIB-DE', captured_at: at(5), features: { time: { rms: 9, kurtosis: 9 } } },
            { tag: 'VIB-NDE', captured_at: at(5), features: { time: { rms: 0.25, kurtosis: 3.4 }, envPeaks: [{ freqHz: 86.9, amplitude: 0.05 }] } },
        ];
        const t = captureTrend(caps, 'VIB-NDE');
        expect(t.points.map(p => p.kurtosis)).toEqual([3.1, 3.4, 13.7]);
        expect(t.verdicts.kurtosis).toBe('growing');
        expect(t.verdicts.rms).toBe('growing');
        expect(t.verdicts.toneAmp).toBeUndefined();   // only two captures carry a tone
    });
});

describe('repair check', () => {
    const caps = [
        { tag: 'VIB-NDE', captured_at: at(0), features: investigate({ bearingMatches: [match] }) },
        { tag: 'VIB-NDE', captured_at: at(9), features: { time: { rms: 0.2, crest: 3.2, kurtosis: 3.0 }, diagnosis: { severity: 'ok' } } as CaptureFeatures },
    ];

    it('before = up to the alert, after = once the work was done', () => {
        const alertAt = new Date(new Date(at(0)).getTime() + 2000).toISOString();
        const r = pickRepairCaptures(caps, 'vib-nde', alertAt, at(7));
        expect(r.before?.captured_at).toBe(at(0));
        expect(r.after?.captured_at).toBe(at(9));
        expect(pickRepairCaptures(caps, 'VIB-NDE', alertAt, at(10)).after).toBeNull();
    });

    it('cleared when the impacting and the tone are gone', () => {
        const v = repairCheck(caps[0].features, caps[1].features);
        expect(v.verdict).toBe('cleared');
        expect(v.summary).toContain('kurtosis 3 (was 13.7)');
    });

    it('not cleared while the tone still matches, and asks for a capture when there is none', () => {
        expect(repairCheck(null, investigate({ bearingMatches: [match] })).verdict).toBe('not_cleared');
        expect(repairCheck(caps[0].features, null).verdict).toBe('no_after');
    });
});
