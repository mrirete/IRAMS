import { describe, it, expect } from 'vitest';
import {
    timeFeatures, amplitudeSpectrum, envelopeSpectrum, findPeaks,
    analyzeWaveform, parseWaveformText, demoBearingSignal,
} from './spectral';

const FS = 4096;
const sine = (freq: number, amp = 1, n = 4096, fs = FS) =>
    Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * freq * (i / fs)));

describe('timeFeatures', () => {
    it('sine: rms = amp/√2, crest ≈ √2, kurtosis ≈ 1.5', () => {
        const f = timeFeatures(sine(50, 2));
        expect(f.rms).toBeCloseTo(2 / Math.SQRT2, 2);
        expect(f.crest).toBeCloseTo(Math.SQRT2, 1);
        expect(f.kurtosis).toBeCloseTo(1.5, 1);
    });

    it('impulsive signal has high kurtosis', () => {
        const x = new Array(4096).fill(0.01);
        for (let i = 0; i < 4096; i += 512) x[i] = 5;      // sparse impacts
        expect(timeFeatures(x).kurtosis).toBeGreaterThan(10);
    });
});

describe('amplitudeSpectrum', () => {
    it('recovers a pure tone at the right frequency and amplitude', () => {
        const spec = amplitudeSpectrum(sine(50, 3), FS);
        const peak = findPeaks(spec)[0];
        expect(peak.freqHz).toBeCloseTo(50, 0);
        expect(peak.amplitude).toBeGreaterThan(2.6);       // Hann leakage keeps it near 3
        expect(peak.amplitude).toBeLessThanOrEqual(3.1);
    });

    it('separates two tones', () => {
        const x = sine(50, 2).map((v, i) => v + sine(120, 1)[i]);
        const peaks = findPeaks(amplitudeSpectrum(x, FS));
        const freqs = peaks.map(p => p.freqHz).sort((a, b) => a - b);
        expect(freqs.some(f => Math.abs(f - 50) < 2)).toBe(true);
        expect(freqs.some(f => Math.abs(f - 120) < 2)).toBe(true);
    });
});

describe('envelopeSpectrum', () => {
    it('exposes the modulation frequency of an AM signal', () => {
        // 800 Hz carrier amplitude-modulated at 60 Hz
        const x = Array.from({ length: 8192 }, (_, i) => {
            const t = i / FS;
            return (1 + 0.8 * Math.sin(2 * Math.PI * 60 * t)) * Math.sin(2 * Math.PI * 800 * t);
        });
        const env = envelopeSpectrum(x, FS);
        const top = findPeaks(env, { minFreqHz: 1 })[0];
        expect(top.freqHz).toBeCloseTo(60, 0);
    });
});

describe('analyzeWaveform + diagnose', () => {
    it('flags the demo bearing signal as a bearing-defect candidate at the impact rate', () => {
        const rpm = 1480;
        const a = analyzeWaveform(demoBearingSignal({ rpm, impactHz: 87 }), 5120, rpm);
        expect(a.time.kurtosis).toBeGreaterThan(4);
        expect(a.envPeaks.some(p => Math.abs(p.freqHz - 87) < 3)).toBe(true);
        expect(a.diagnosis.severity).toBe('investigate');
        expect(a.diagnosis.findings.some(f => f.label.includes('bearing'))).toBe(true);
    });

    it('clean 1x-dominant signal reads as imbalance watch, not bearing', () => {
        const rpm = 3000; // 50 Hz
        const a = analyzeWaveform(sine(50, 2, 8192), FS, rpm);
        expect(a.diagnosis.severity).toBe('watch');
        expect(a.diagnosis.findings[0].label).toContain('imbalance');
        expect(a.diagnosis.findings.some(f => f.label.includes('bearing'))).toBe(false);
    });

    it('rejects too-short captures', () => {
        expect(() => analyzeWaveform([1, 2, 3], FS)).toThrow(/64 samples/);
    });
});

describe('parseWaveformText', () => {
    it('parses bare numbers, CSV pairs, and skips headers', () => {
        expect(parseWaveformText('1.5\n-2.5\n3')).toEqual([1.5, -2.5, 3]);
        expect(parseWaveformText('time,value\n0.001, 0.42\n0.002, -0.13')).toEqual([0.42, -0.13]);
        expect(parseWaveformText('# comment\n0.1 0.2 0.9')).toEqual([0.9]);
    });
});
