/**
 * sensorKind — how a point gets its kind, and why the unit matters.
 *
 * The B-301 lesson (docs/Demo-Boiler.md): every one of the boiler's 30 DCS
 * tags is a code (YFJ3_AI, TE_8332A, ZZQBCHLL). Keyword matching on the tag
 * classed them all as 'other', so the fan current's 6.8σ regime residual
 * reached diagnosisRules as nothing a rule could recognise. The unit was 'A'
 * the whole time.
 */
import { describe, it, expect } from 'vitest';
import { sensorKind } from './healthModels';

describe('sensorKind', () => {
    it('words in the tag win, as before', () => {
        expect(sensorKind('Vib Radial (mm/s)')).toBe('vibration');
        expect(sensorKind('Bearing Temp (°C)')).toBe('temperature');
        expect(sensorKind('Discharge Flow (m³/h)')).toBe('flow');
        expect(sensorKind('Motor current')).toBe('current');
        expect(sensorKind('Wall thickness CML-3')).toBe('thickness');
    });

    it('a DCS code with a unit is classified by the unit', () => {
        expect(sensorKind('YFJ3_AI', 'A')).toBe('current');
        expect(sensorKind('YFJ3_ZD1', 'mm/s')).toBe('vibration');
        expect(sensorKind('ZZQBCHLL', 't/h')).toBe('flow');
        expect(sensorKind('SXLTCYZ', 'Pa')).toBe('pressure');
        expect(sensorKind('PTCA_8322A', 'MPa')).toBe('pressure');
        expect(sensorKind('TE_8332A', '°C')).toBe('temperature');
        expect(sensorKind('FT_8301', 'Nm³/h')).toBe('flow');
        expect(sensorKind('CML-7', 'mm')).toBe('thickness');
    });

    it('an ISA loop prefix classifies a code with no unit', () => {
        expect(sensorKind('TE_8319A')).toBe('temperature');
        expect(sensorKind('TT-101')).toBe('temperature');
        expect(sensorKind('PT_8313A')).toBe('pressure');
        expect(sensorKind('PDT-204')).toBe('pressure');
        expect(sensorKind('FT_8306B')).toBe('flow');
        expect(sensorKind('LT-101')).toBe('level');
        expect(sensorKind('VT-2')).toBe('vibration');
        expect(sensorKind('ZD1')).toBe('vibration');
        expect(sensorKind('IT-3')).toBe('current');
    });

    it('does not guess: valves, analysers, percentages and opaque codes stay other', () => {
        expect(sensorKind('TV_8329ZC', '%')).toBe('other');    // a valve position, not a temperature
        expect(sensorKind('AIR_8301A', '%')).toBe('other');    // O₂ analyser
        expect(sensorKind('YJJWSLL')).toBe('other');            // code, no unit
        expect(sensorKind('FV-101')).toBe('other');             // flow VALVE
        expect(sensorKind('', null)).toBe('other');
    });
});
