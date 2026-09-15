import { describe, it, expect } from 'vitest';
import { diagnoseEvidence, type DiagnosisContext } from './diagnosisRules';

const vibHigh = { tag: 'VIB-NDE', kind: 'vibration' as const, direction: 'high' as const, value: 9.2, limit: 7.1, unit: 'mm/s' };
const tempHigh = { tag: 'TEMP-BRG', kind: 'temperature' as const, direction: 'high' as const, value: 92, limit: 80, unit: '°C' };

describe('rotating rules', () => {
    it('named bearing match → BRG deterministic, top-ranked', () => {
        const r = diagnoseEvidence({
            equipmentClass: 'rotating',
            sensors: [vibHigh],
            spectral: {
                impulsive: true,
                bearingMatches: [{
                    race: 'BPFO', raceLabel: 'outer race (BPFO)', designation: '6205', basis: 'geometry',
                    harmonic: 1, expectedHz: 88.2, peakHz: 88.5, peakAmplitude: 1, deviationFrac: 0.003,
                }],
            },
        });
        expect(r.hypotheses[0].failure_mode_code).toBe('BRG');
        expect(r.hypotheses[0].basis).toBe('deterministic-rule');
        expect(r.hypotheses[0].confidence).toBeGreaterThanOrEqual(0.85);
        expect(r.hypotheses[0].evidence.some(e => e.kind === 'spectral' && e.summary.includes('outer race'))).toBe(true);
        expect(r.hypotheses[0].evidence.some(e => e.kind === 'sensor' && e.summary.includes('VIB-NDE'))).toBe(true);
    });

    it('1× dominant → BAL; 2× elevated → MIS; both rank above generic VIB', () => {
        const r = diagnoseEvidence({
            equipmentClass: 'rotating',
            sensors: [vibHigh],
            spectral: { oneTimesDominant: true, twoTimesElevated: true },
        });
        const codes = r.hypotheses.map(h => h.failure_mode_code);
        expect(codes[0]).toBe('BAL');
        expect(codes).toContain('MIS');
        expect(codes).not.toContain('VIB');   // specific signatures suppress the generic
    });

    it('vibration high with no spectral data → generic VIB screening + capture advice', () => {
        const r = diagnoseEvidence({ equipmentClass: 'rotating', sensors: [vibHigh] });
        expect(r.hypotheses[0].failure_mode_code).toBe('VIB');
        expect(r.hypotheses[0].basis).toBe('screening-heuristic');
        expect(r.hypotheses[0].recommended_action).toMatch(/waveform/i);
    });

    it('temp + vib together → LUB outranks solo-temp hypotheses', () => {
        const r = diagnoseEvidence({ equipmentClass: 'rotating', sensors: [vibHigh, tempHigh] });
        expect(r.hypotheses.map(h => h.failure_mode_code)).toContain('LUB');
        const lub = r.hypotheses.find(h => h.failure_mode_code === 'LUB')!;
        expect(lub.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it('suction pressure low + flow low → cavitation candidate', () => {
        const r = diagnoseEvidence({
            equipmentClass: 'rotating',
            sensors: [
                { tag: 'PI-SUC', kind: 'pressure', direction: 'low' },
                { tag: 'FI-DIS', kind: 'flow', direction: 'low' },
            ],
        });
        expect(r.hypotheses.map(h => h.failure_mode_code)).toContain('CVT');
    });
});

describe('static / electrical / instrument rules', () => {
    it('thickness falling → COR deterministic at 0.8', () => {
        const r = diagnoseEvidence({
            equipmentClass: 'static',
            sensors: [{ tag: 'CML-04 wall', kind: 'thickness', direction: 'falling', value: 6.1, limit: 5.0, unit: 'mm' }],
        });
        expect(r.hypotheses[0].failure_mode_code).toBe('COR');
        expect(r.hypotheses[0].basis).toBe('deterministic-rule');
    });

    it('electrical current high → OVL first, WDG as alternative', () => {
        const r = diagnoseEvidence({
            equipmentClass: 'electrical',
            sensors: [{ tag: 'MOTOR AMPS L1', kind: 'current', direction: 'high' }],
        });
        const codes = r.hypotheses.map(h => h.failure_mode_code);
        expect(codes[0]).toBe('OVL');
        expect(codes).toContain('WDG');
        expect(codes).toContain('PHS');   // L1 in the tag → phase-aware hint
    });

    it('instrument drift → DFT + SEN', () => {
        const r = diagnoseEvidence({
            equipmentClass: 'instrument',
            sensors: [{ tag: 'PT-101', kind: 'pressure', direction: 'rising' }],
        });
        expect(r.hypotheses.map(h => h.failure_mode_code).slice(0, 2)).toEqual(['DFT', 'SEN']);
    });
});

describe('regime residuals (class-agnostic)', () => {
    // The B-301 case from docs/Demo-Boiler.md: ID-fan current 8.9 % above the
    // value expected at the current steam flow, on an asset classed as a boiler.
    const fanCurrent = {
        tag: 'YFJ3_AI', kind: 'current' as const, direction: 'high' as const, value: 24.66, limit: null, unit: 'A',
        basis: 'regime-residual' as const, expected: 22.65, z: 6.8, loadTag: 'ZZQBCHLL',
    };
    it('current up at constant load on a non-rotating asset → PLU (build-up) first, OVL as alternative', () => {
        const r = diagnoseEvidence({ equipmentClass: 'static', sensors: [fanCurrent] });
        const codes = r.hypotheses.map(h => h.failure_mode_code);
        expect(codes[0]).toBe('PLU');
        expect(codes).toContain('OVL');
        expect(r.hypotheses[0].basis).toBe('screening-heuristic');
        const ev = r.hypotheses[0].evidence.find(e => e.kind === 'sensor')!;
        expect(ev.summary).toContain('YFJ3_AI: 24.66 A high vs 22.65 A expected at this load (ZZQBCHLL), 6.8σ — inside its band');
    });
    it('the same current as a plain band breach on a static asset names nothing — the residual is what earns the hypothesis', () => {
        const r = diagnoseEvidence({ equipmentClass: 'static', sensors: [{ ...fanCurrent, basis: 'band' as const, limit: 25 }] });
        expect(r.hypotheses).toHaveLength(0);
    });
    it('temperature up at constant load → FOL; flow down at constant load → PLU / LOO', () => {
        const t = diagnoseEvidence({ equipmentClass: 'other', sensors: [{ tag: 'TE-1', kind: 'temperature' as const, direction: 'high' as const, value: 91, unit: '°C', basis: 'regime-residual' as const, expected: 84, z: 4.1 }] });
        expect(t.hypotheses[0].failure_mode_code).toBe('FOL');
        const f = diagnoseEvidence({ equipmentClass: 'other', sensors: [{ tag: 'FT-1', kind: 'flow' as const, direction: 'low' as const, value: 80, unit: 'm³/h', basis: 'regime-residual' as const, expected: 95, z: -3.6 }] });
        expect(f.hypotheses.map(h => h.failure_mode_code)).toEqual(['PLU', 'LOO']);
    });
});

describe('asset priors', () => {
    const base: DiagnosisContext = {
        equipmentClass: 'rotating',
        sensors: [vibHigh, tempHigh],
    };

    it('RCM-documented mode gets boosted above its unboosted rank', () => {
        const without = diagnoseEvidence(base);
        const withPrior = diagnoseEvidence({
            ...base,
            priors: { rcmModes: [{ code: 'LUB', rpn: 180, woCount: 4 }] },
        });
        const lub0 = without.hypotheses.find(h => h.failure_mode_code === 'LUB')!;
        const lub1 = withPrior.hypotheses.find(h => h.failure_mode_code === 'LUB')!;
        expect(lub1.confidence).toBeGreaterThan(lub0.confidence);
        expect(lub1.evidence.some(e => e.kind === 'rcm' && e.summary.includes('RPN 180'))).toBe(true);
    });

    it('failure history adds count-scaled evidence', () => {
        const r = diagnoseEvidence({ ...base, priors: { historyCodes: { LUB: 3 } } });
        const lub = r.hypotheses.find(h => h.failure_mode_code === 'LUB')!;
        expect(lub.evidence.some(e => e.kind === 'history' && e.summary.includes('3×'))).toBe(true);
    });

    it('free-text FMEA mode matches by keyword', () => {
        const r = diagnoseEvidence({ ...base, priors: { fmeaModes: ['Bearing seizure due to lubricant starvation'] } });
        const lub = r.hypotheses.find(h => h.failure_mode_code === 'LUB')!;
        expect(lub.evidence.some(e => e.kind === 'fmea')).toBe(true);
    });

    it('confidence is capped at 0.95', () => {
        const r = diagnoseEvidence({
            equipmentClass: 'static',
            sensors: [{ tag: 'wall', kind: 'thickness', direction: 'falling' }],
            priors: { rcmModes: [{ code: 'COR', rpn: 300 }], historyCodes: { COR: 5 }, fmeaModes: ['internal corrosion'] },
        });
        expect(r.hypotheses[0].confidence).toBeLessThanOrEqual(0.95);
    });
});

describe('shape guarantees', () => {
    it('returns at most 5 ranked hypotheses, sorted by confidence', () => {
        const r = diagnoseEvidence({
            equipmentClass: 'rotating',
            sensors: [
                vibHigh, tempHigh,
                { tag: 'PI-SUC', kind: 'pressure', direction: 'low' },
                { tag: 'FI-DIS', kind: 'flow', direction: 'low' },
                { tag: 'AMPS', kind: 'current', direction: 'high' },
            ],
            spectral: { oneTimesDominant: true, twoTimesElevated: true, impulsive: true },
        });
        expect(r.hypotheses.length).toBeLessThanOrEqual(5);
        const confs = r.hypotheses.map(h => h.confidence);
        expect([...confs].sort((a, b) => b - a)).toEqual(confs);
        expect(r.engine).toBe('diagnosis-rules-v1');
    });

    it('no evidence → no hypotheses', () => {
        expect(diagnoseEvidence({ equipmentClass: 'rotating', sensors: [] }).hypotheses).toEqual([]);
    });
});
