import { describe, it, expect } from 'vitest';
import { recommendMonitoringCadence, cadenceLabel } from './monitoringCadence';

describe('recommendMonitoringCadence', () => {
    it('falls back to criticality defaults with no P-F interval', () => {
        expect(recommendMonitoringCadence({ criticality: 'A' }).intervalDays).toBe(7);
        expect(recommendMonitoringCadence({ criticality: 'B' }).intervalDays).toBe(30);
        expect(recommendMonitoringCadence({ criticality: 'C' }).intervalDays).toBe(90);
    });

    it('defaults unknown/blank criticality to B', () => {
        expect(recommendMonitoringCadence({ criticality: null }).intervalDays).toBe(30);
        expect(recommendMonitoringCadence({ criticality: 'x' }).intervalDays).toBe(30);
        expect(recommendMonitoringCadence({}).pfDriven).toBe(false);
    });

    it('uses half the P-F interval when it is tighter than the criticality cap', () => {
        // C default = 90d; P-F 40d → half = 20d, which is tighter → 20d, pf-driven.
        const r = recommendMonitoringCadence({ criticality: 'C', pfIntervalDays: 40 });
        expect(r.intervalDays).toBe(20);
        expect(r.pfDriven).toBe(true);
        expect(r.basis).toMatch(/P-F interval/);
    });

    it('caps the P-F-derived interval by criticality for a critical asset', () => {
        // A default = 7d; P-F 60d → half = 30d, but A caps at 7d.
        const r = recommendMonitoringCadence({ criticality: 'A', pfIntervalDays: 60 });
        expect(r.intervalDays).toBe(7);
        expect(r.pfDriven).toBe(true);
        expect(r.basis).toMatch(/caps/);
    });

    it('never returns a zero/negative interval', () => {
        expect(recommendMonitoringCadence({ criticality: 'A', pfIntervalDays: 1 }).intervalDays).toBeGreaterThanOrEqual(1);
    });
});

describe('cadenceLabel', () => {
    it('maps common cadences to friendly labels', () => {
        expect(cadenceLabel(1)).toBe('Daily');
        expect(cadenceLabel(7)).toBe('Weekly');
        expect(cadenceLabel(30)).toBe('Monthly');
        expect(cadenceLabel(90)).toBe('Quarterly');
        expect(cadenceLabel(45)).toBe('Every 45 days');
    });
});
