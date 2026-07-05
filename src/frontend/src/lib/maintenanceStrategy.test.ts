import { describe, it, expect } from 'vitest';
import { resolveDue, generateSchedule, absorptionSavings, type MaintenanceStrategy } from './maintenanceStrategy';

const P = (label: string, intervalDays: number) => ({ id: label, label, intervalDays });
const STRATEGY: MaintenanceStrategy = { id: 's', name: 'Pump', packages: [P('1M', 30), P('3M', 90), P('6M', 180), P('12M', 360)] };

describe('resolveDue — absorption', () => {
    it('12M absorbs 6M/3M/1M when all due together', () => {
        const { executed, absorbed } = resolveDue(STRATEGY.packages);
        expect(executed.map(p => p.label)).toEqual(['12M']);
        expect(absorbed.map(p => p.label).sort()).toEqual(['1M', '3M', '6M']);
    });
    it('3M absorbs 1M (quarter due)', () => {
        const { executed, absorbed } = resolveDue([P('1M', 30), P('3M', 90)]);
        expect(executed.map(p => p.label)).toEqual(['3M']);
        expect(absorbed.map(p => p.label)).toEqual(['1M']);
    });
    it('non-dividing intervals both execute (45 does not divide 30-multiples cleanly)', () => {
        const { executed } = resolveDue([P('A', 30), P('B', 45)]);
        // 45 % 30 !== 0 and 30 % 45 !== 0 → neither absorbs the other
        expect(executed.map(p => p.label).sort()).toEqual(['A', 'B']);
    });
});

describe('generateSchedule', () => {
    const sched = generateSchedule(STRATEGY, '2026-01-01', 360);
    it('day 30 does the 1M only', () => {
        expect(sched.find(s => s.offsetDays === 30)!.executed.map(p => p.label)).toEqual(['1M']);
    });
    it('day 90 does the 3M and absorbs the 1M', () => {
        const s = sched.find(x => x.offsetDays === 90)!;
        expect(s.executed.map(p => p.label)).toEqual(['3M']);
        expect(s.absorbed.map(p => p.label)).toEqual(['1M']);
    });
    it('day 360 does the 12M only', () => {
        const s = sched.find(x => x.offsetDays === 360)!;
        expect(s.executed.map(p => p.label)).toEqual(['12M']);
        expect(s.absorbed.length).toBe(3);
    });
    it('computes the right ISO date for an offset', () => {
        expect(sched.find(s => s.offsetDays === 30)!.date).toBe('2026-01-31');
    });
});

describe('absorptionSavings', () => {
    it('reports fewer actual visits than naive', () => {
        const sched = generateSchedule(STRATEGY, '2026-01-01', 360);
        const s = absorptionSavings(sched);
        expect(s.naiveVisits).toBeGreaterThan(s.actualVisits);
        expect(s.actualVisits + s.absorbedVisits).toBe(s.naiveVisits);
    });
});
