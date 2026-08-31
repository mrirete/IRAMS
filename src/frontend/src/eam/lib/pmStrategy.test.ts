import { describe, it, expect } from 'vitest';
import { buildPMStrategy } from './pmStrategy';

const base = { title: 'T', assetId: 'a1', frequencyInterval: 30 };

describe('buildPMStrategy — 0305 cadence contract', () => {
    it('accepts calendar units on TIME schedules (case-insensitive)', () => {
        for (const unit of ['Days', 'weeks', 'MONTHS', 'Years']) {
            const row = buildPMStrategy({ ...base, frequencyUnit: unit });
            expect(row.schedule_type).toBe('TIME');
            expect(row.frequency_unit).toBe(unit);
        }
    });

    it('rejects a meter unit on a TIME schedule with a readable error', () => {
        // The PM-31048 shape: TIME + Hours = a schedule no calendar generator
        // (manual or 0304 Autopilot) can ever serve.
        expect(() => buildPMStrategy({ ...base, frequencyUnit: 'Hours' }))
            .toThrow(/calendar frequency unit/i);
        expect(() => buildPMStrategy({ ...base, scheduleType: 'TIME', frequencyUnit: 'KM' }))
            .toThrow(/READING/);
    });

    it('leaves READING schedules free to use meter units', () => {
        const row = buildPMStrategy({ ...base, scheduleType: 'READING', frequencyUnit: 'Hours' });
        expect(row.schedule_type).toBe('READING');
        expect(row.frequency_unit).toBe('Hours');
    });
});
