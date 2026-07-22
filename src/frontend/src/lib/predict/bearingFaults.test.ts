import { describe, it, expect } from 'vitest';
import {
    geometryOrders, approxOrders, faultFrequencies, matchEnvelopeTones,
    type BearingSpec,
} from './bearingFaults';
import { analyzeWaveform, demoBearingSignal } from './spectral';

// 6205 deep-groove: the classic textbook bearing (9 × 7.94 mm balls, 39.04 mm pitch)
const B6205: BearingSpec = {
    designation: '6205',
    geometry: { ballCount: 9, ballDiameterMm: 7.94, pitchDiameterMm: 39.04, contactAngleDeg: 0 },
};

describe('geometryOrders', () => {
    it('reproduces the published 6205 fault orders', () => {
        const o = geometryOrders(B6205.geometry!);
        expect(o.bpfo).toBeCloseTo(3.58, 1);   // published ≈ 3.57×
        expect(o.bpfi).toBeCloseTo(5.42, 1);   // published ≈ 5.43×
        expect(o.ftf!).toBeCloseTo(0.40, 1);
        expect(o.bsf!).toBeCloseTo(2.36, 1);   // published ≈ 2.32×
    });

    it('BPFO + BPFI = ball count × shaft order (kinematic identity)', () => {
        const o = geometryOrders(B6205.geometry!);
        expect(o.bpfo + o.bpfi).toBeCloseTo(9, 6);
    });

    it('contact angle reduces the d/D effect', () => {
        const flat = geometryOrders({ ballCount: 9, ballDiameterMm: 7.94, pitchDiameterMm: 39.04, contactAngleDeg: 0 });
        const angled = geometryOrders({ ballCount: 9, ballDiameterMm: 7.94, pitchDiameterMm: 39.04, contactAngleDeg: 40 });
        expect(angled.bpfo).toBeGreaterThan(flat.bpfo);   // cos θ < 1 → ratio shrinks → BPFO rises toward n/2
        expect(angled.bpfi).toBeLessThan(flat.bpfi);
    });
});

describe('faultFrequencies', () => {
    it('geometry basis at 1480 RPM', () => {
        const f = faultFrequencies(B6205, 1480 / 60)!;
        expect(f.basis).toBe('geometry');
        expect(f.hz.bpfo).toBeCloseTo(3.58 * (1480 / 60), 0);
        expect(f.hz.bpfi).toBeCloseTo(5.42 * (1480 / 60), 0);
    });

    it('datasheet orders pass through verbatim', () => {
        const f = faultFrequencies({ designation: 'X', orders: { bpfo: 3.05, bpfi: 4.95 } }, 10)!;
        expect(f.basis).toBe('orders');
        expect(f.hz.bpfo).toBeCloseTo(30.5, 1);
        expect(f.hz.bsf).toBeNull();
    });

    it('ball-count-only falls back to the 0.4/0.6 approximation', () => {
        const f = faultFrequencies({ ballCount: 8 }, 10)!;
        expect(f.basis).toBe('approximate');
        expect(f.orders).toMatchObject({ bpfo: 3.2, bpfi: 4.8 });
        expect(approxOrders(8).bpfo).toBeCloseTo(3.2, 6);
    });

    it('returns null without usable spec or shaft speed', () => {
        expect(faultFrequencies({}, 10)).toBeNull();
        expect(faultFrequencies(B6205, null)).toBeNull();
        expect(faultFrequencies(B6205, 0)).toBeNull();
    });
});

describe('matchEnvelopeTones', () => {
    const shaftHz = 1480 / 60;                       // ≈ 24.67 Hz
    const faults = [faultFrequencies(B6205, shaftHz)!]; // BPFO ≈ 88.2 Hz, BPFI ≈ 133.8 Hz

    it('names the race for a tone at BPFO and its harmonic', () => {
        const peaks = [
            { freqHz: 88.5, amplitude: 1.0 },        // ≈ BPFO fundamental
            { freqHz: 176.8, amplitude: 0.5 },       // ≈ 2×BPFO
            { freqHz: 24.7, amplitude: 0.3 },        // 1× shaft — must not match
        ];
        const m = matchEnvelopeTones(peaks, faults, shaftHz);
        expect(m[0].race).toBe('BPFO');
        expect(m[0].harmonic).toBe(1);
        expect(m.some(x => x.race === 'BPFO' && x.harmonic === 2)).toBe(true);
        expect(m.every(x => x.peakHz !== 24.7)).toBe(true);
    });

    it('flags 1×-shaft sidebands around a BPFI tone', () => {
        const bpfiHz = faults[0].hz.bpfi;
        const peaks = [
            { freqHz: bpfiHz, amplitude: 1.0 },
            { freqHz: bpfiHz + shaftHz, amplitude: 0.4 },
        ];
        const m = matchEnvelopeTones(peaks, faults, shaftHz);
        const bpfi = m.find(x => x.race === 'BPFI')!;
        expect(bpfi.sidebands).toBe(true);
    });

    it('no matches for tones far from any defect frequency', () => {
        // 45 Hz: >20% away from FTF/BSF/BPFO/BPFI and all their 2×/3× harmonics
        expect(matchEnvelopeTones([{ freqHz: 45, amplitude: 1 }], faults, shaftHz)).toEqual([]);
    });
});

describe('analyzeWaveform with bearing specs (end-to-end)', () => {
    it('demo signal at BPFO of the 6205 gets a named outer-race finding', () => {
        const rpm = 1480;
        const bpfoHz = faultFrequencies(B6205, rpm / 60)!.hz.bpfo;   // ≈ 88.2 Hz
        const a = analyzeWaveform(demoBearingSignal({ rpm, impactHz: bpfoHz }), 5120, rpm, [B6205]);
        expect(a.bearingFaults).toHaveLength(1);
        expect(a.bearingMatches.some(m => m.race === 'BPFO')).toBe(true);
        expect(a.diagnosis.severity).toBe('investigate');
        expect(a.diagnosis.findings.some(f => f.label.includes('outer race'))).toBe(true);
    });

    it('without specs, behavior is unchanged: generic bearing candidate', () => {
        const a = analyzeWaveform(demoBearingSignal({ rpm: 1480, impactHz: 87 }), 5120, 1480);
        expect(a.bearingFaults).toEqual([]);
        expect(a.diagnosis.findings.some(f => f.label.includes('bearing defect candidate'))).toBe(true);
    });

    it('approximate (ball-count) basis stays a watch-level hint, not investigate', () => {
        const rpm = 1480;
        const approxBpfoHz = 0.4 * 9 * (rpm / 60);   // 88.8 Hz
        const a = analyzeWaveform(
            demoBearingSignal({ rpm, impactHz: approxBpfoHz }), 5120, rpm,
            [{ designation: 'DG-9', ballCount: 9 }],
        );
        const named = a.diagnosis.findings.find(f => f.label.includes('bearing defect hint'));
        expect(named).toBeDefined();
        expect(named!.tone).toBe('watch');
    });
});
