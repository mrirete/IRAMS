import { describe, it, expect } from 'vitest';
import { evaluateReading } from './readingAlarm';

const def = { name: 'Bearing temp', unit: '°C', minCritical: 0, minWarning: 10, maxWarning: 80, maxCritical: 90 };

describe('evaluateReading', () => {
    it('is OK inside the bands', () => {
        expect(evaluateReading(50, def).level).toBe('OK');
    });
    it('flags WARNING above the warning max', () => {
        const r = evaluateReading(85, def);
        expect(r.level).toBe('WARNING');
        expect(r.detail).toContain('warning max 80');
    });
    it('flags CRITICAL above the critical max (critical wins)', () => {
        expect(evaluateReading(95, def).level).toBe('CRITICAL');
    });
    it('flags WARNING below the warning min', () => {
        expect(evaluateReading(5, def).level).toBe('WARNING');
    });
    it('honours a legitimate 0 critical-min (not treated as absent)', () => {
        // value below 0 → critical; the old truthy check (minCritical && …) missed this.
        expect(evaluateReading(-1, def).level).toBe('CRITICAL');
        expect(evaluateReading(0, def).level).toBe('WARNING'); // 0 is not < 0, but < warning-min 10
    });
    it('treats missing bands as no alarm', () => {
        expect(evaluateReading(9999, { name: 'x' }).level).toBe('OK');
    });
});
