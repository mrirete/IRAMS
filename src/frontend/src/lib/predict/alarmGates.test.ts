/**
 * alarmGates — the B-301 cases that showed the old arithmetic was wrong.
 */
import { describe, it, expect } from 'vitest';
import { alarmGates } from './alarmGates';

describe('alarmGates', () => {
    it('two limits: the deadband is a share of the band width', () => {
        // Outlet steam temperature, paper band 525–550 °C, engine default 10 %.
        const g = alarmGates(525, 550, null);
        expect(g.basis).toBe('band-width');
        expect(g.margin).toBe(2.5);
        expect(g.hiGate).toBe(547.5);   // old rule: 495 — so 535 °C "approached" 550
        expect(g.loGate).toBe(527.5);
    });

    it('a per-point deadband (0205) is honoured and clamped', () => {
        expect(alarmGates(525, 550, 1).margin).toBe(0.25);
        expect(alarmGates(525, 550, 80).margin).toBe(12.5);   // clamped to 50 %
        expect(alarmGates(525, 550, -5).margin).toBe(0);
    });

    it('negative band: gates move INTO the band, not away from it', () => {
        // Furnace draught −200 … −100 Pa. Old rule: loGate = −200 × 1.1 = −220 (unreachable).
        const g = alarmGates(-200, -100, 10);
        expect(g.hiGate).toBe(-110);
        expect(g.loGate).toBe(-190);
    });

    it('single limit falls back to the limit magnitude and says so', () => {
        const hi = alarmGates(null, 550, null);
        expect(hi.basis).toBe('limit-magnitude');
        expect(hi.hiGate).toBe(495);
        expect(hi.loGate).toBeNull();
        const lo = alarmGates(-140, null, 10);
        expect(lo.loGate).toBe(-126);   // old rule: −154, the wrong side of −140
        expect(lo.hiGate).toBeNull();
    });

    it('no limits → no gates', () => {
        expect(alarmGates(null, null)).toEqual({ hiGate: null, loGate: null, basis: 'none', margin: 0 });
        expect(alarmGates(NaN, undefined).basis).toBe('none');
    });

    it('an inverted pair (high ≤ low) is treated as single-limit, not a negative width', () => {
        const g = alarmGates(550, 525, 10);
        expect(g.basis).toBe('limit-magnitude');
        expect(g.hiGate).toBe(525 - 52.5);
    });
});
