import { describe, it, expect } from 'vitest';
import { parseSensorCsv, aggregateSensors } from './sensorCsv';

describe('parseSensorCsv', () => {
    it('parses a standard export with synonyms and units', () => {
        const csv = [
            'asset,tag,value,unit,timestamp',
            'P-101,Bearing Vibration,4.8,mm/s,2026-07-06T08:00',
            'P-101,Bearing Vibration,5.2,mm/s,2026-07-06T09:00',
        ].join('\n');
        const { rows, errors } = parseSensorCsv(csv);
        expect(errors).toHaveLength(0);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ asset: 'P-101', tag: 'Bearing Vibration', value: 4.8, unit: 'mm/s' });
    });

    it('tolerates header synonyms and semicolon delimiter', () => {
        const csv = 'equipment;sensor;reading;uom\nK-601;Temp;88;degC';
        const { rows, errors } = parseSensorCsv(csv);
        expect(errors).toHaveLength(0);
        expect(rows[0]).toMatchObject({ asset: 'K-601', tag: 'Temp', value: 88, unit: 'degC' });
    });

    it('reports missing required columns', () => {
        const { errors, rows } = parseSensorCsv('asset,unit\nP-101,mm/s');
        expect(rows).toHaveLength(0);
        expect(errors.join(' ')).toMatch(/tag/);
        expect(errors.join(' ')).toMatch(/value/);
    });

    it('skips non-numeric / empty rows with a line-numbered error, keeps the rest', () => {
        const csv = 'tag,value\nVib,4.8\nVib,oops\nVib,5.0';
        const { rows, errors } = parseSensorCsv(csv);
        expect(rows).toHaveLength(2);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/Line 3/);
    });

    it('picks up alarm bands via max/min synonyms', () => {
        const csv = 'tag,value,max,min\nVib,4.8,7.1,0';
        const { rows } = parseSensorCsv(csv);
        expect(rows[0].alarmHigh).toBe(7.1);
        expect(rows[0].alarmLow).toBe(0);
    });
});

describe('aggregateSensors', () => {
    it('collapses to one row per (asset, tag) with latest value + trend + series', () => {
        const { rows } = parseSensorCsv([
            'asset,tag,value,unit,timestamp',
            'P-101,Vib,4.8,mm/s,2026-07-06T08:00',
            'P-101,Vib,5.2,mm/s,2026-07-06T09:00',
            'P-101,Temp,70,degC,2026-07-06T09:00',
        ].join('\n'));
        const agg = aggregateSensors(rows);
        expect(agg).toHaveLength(2);
        const vib = agg.find(a => a.tag === 'Vib')!;
        expect(vib.currentValue).toBe(5.2);   // latest by timestamp
        expect(vib.trend).toBe('rising');
        expect(vib.readings).toEqual([4.8, 5.2]);
        expect(vib.count).toBe(2);
    });

    it('orders by timestamp so the latest wins regardless of file order', () => {
        const { rows } = parseSensorCsv([
            'asset,tag,value,timestamp',
            'A,X,9,2026-07-06T10:00',
            'A,X,3,2026-07-06T08:00',
        ].join('\n'));
        const [agg] = aggregateSensors(rows);
        expect(agg.currentValue).toBe(9); // 10:00 is latest
        expect(agg.trend).toBe('rising'); // 3 → 9
    });
});
