import { describe, it, expect } from 'vitest';
import {
    toMeasuringPointDoc, fromMeasuringPoint, pointDiff, newPointFromMeasuringPoint,
    isLoggedReading, readingGoesOut, toMeasurementDocumentDoc, fromMeasurementDocument, pointOwner,
    type LinkPoint, type LinkReading,
} from './condition';

const point = (over: Partial<LinkPoint> = {}): LinkPoint => ({
    id: 'p1', asset_id: 'a1', reading_type_code: 'VIB_DE_H', name: 'Vibration DE horizontal', unit: 'mm/s', category: 'VIBRATION',
    min_critical: null, min_warning: null, max_warning: 7.1, max_critical: 11, is_active: true,
    source_system: null, source_ref: null, updated_at: '2026-09-01T00:00:00.000Z', ...over,
});
const reading = (over: Partial<LinkReading> = {}): LinkReading => ({
    id: 'r1', definition_id: 'p1', asset_id: 'a1', reading_type_code: 'VIB_DE_H', reading_date: '2026-09-22', reading_time: '08:15',
    reading_value: 4.2, entered_by: 'j.tech', comments: 'After alignment', valuation_code: null, source_system: null, source_ref: null,
    created_at: '2026-09-22T08:16:00.000Z', ...over,
});

describe('measuring points', () => {
    it('hangs the point on the technical object and sends the critical limits as the range', () => {
        expect(toMeasuringPointDoc(point(), null, { type: 'EQUI', key: '10000001' })).toEqual({
            MeasuringPointDescription: 'Vibration DE horizontal', MeasuringPointIsCounter: false, MeasuringPointIsInactive: false,
            MeasuringPointText: 'VIB_DE_H', MeasuringPointObject: '10000001', MeasuringPointObjectType: 'EQUI',
            MeasurementRangeUnit: 'mm/s', MeasuringPointUpperLimit: 11,
        });
    });
    it('carries the mapped number, marks inactive points, clips the description to 40', () => {
        const d = toMeasuringPointDoc(point({ is_active: false, name: 'N'.repeat(60), unit: null, max_critical: null, min_critical: -1 }), '1234', null);
        expect(d.MeasuringPoint).toBe('1234');
        expect(d.MeasuringPointIsInactive).toBe(true);
        expect(d.MeasuringPointDescription).toHaveLength(40);
        expect(d.MeasurementRangeUnit).toBeUndefined();
        expect(d.MeasuringPointUpperLimit).toBeUndefined();
        expect(d.MeasuringPointLowerLimit).toBe(-1);
    });
    it('reads a point back, blank unit as cleared, numeric strings as numbers', () => {
        expect(fromMeasuringPoint({ MeasuringPointDescription: 'Renamed', MeasurementRangeUnit: '', MeasuringPointUpperLimit: '12.5' as unknown as number, MeasuringPointIsInactive: true }))
            .toEqual({ name: 'Renamed', unit: null, max_critical: 12.5, is_active: false });
    });
    it('diffs only what changed', () => {
        expect(pointDiff(point(), { name: 'Vibration DE horizontal', unit: 'mm/s', max_critical: 11 })).toEqual({});
        expect(pointDiff(point(), { unit: 'in/s', is_active: false })).toEqual({ unit: 'in/s', is_active: false });
    });
    it('creates a point first seen in SAP with SAP\'s number as identity and its text as the type code', () => {
        expect(newPointFromMeasuringPoint({ MeasuringPoint: '5001', MeasuringPointDescription: 'Bearing temp', MeasurementRangeUnit: 'C', MeasuringPointText: 'temp de' }, 'a9'))
            .toEqual({ asset_id: 'a9', reading_type_code: 'TEMP_DE', name: 'Bearing temp', unit: 'C', min_critical: null, max_critical: null, is_active: true, source_system: 'sap_pm', source_ref: '5001' });
        expect(newPointFromMeasuringPoint({ MeasuringPoint: '5002' }, 'a9').reading_type_code).toBe('MP_5002');
        expect(newPointFromMeasuringPoint({ MeasuringPoint: '5002' }, 'a9').name).toBe('5002');
    });
    it('defaults the condition owner to IREAMS', () => {
        expect(pointOwner(undefined)).toBe('ireams');
        expect(pointOwner('sap')).toBe('sap');
    });
});

describe('measurement documents', () => {
    it('knows a logged reading from a machine\'s', () => {
        expect(isLoggedReading('j.tech')).toBe(true);
        expect(isLoggedReading(null)).toBe(true);
        for (const m of ['connector:opc', 'Collector:Edge-1', 'sensor:abc', 'predict:twin']) expect(isLoggedReading(m)).toBe(false);
    });
    it('sends logged readings, never SAP\'s own documents back', () => {
        expect(readingGoesOut(reading())).toBe(true);
        expect(readingGoesOut(reading({ source_system: 'sap_pm' }))).toBe(false);
        expect(readingGoesOut(reading({ source_system: 'SAP' }))).toBe(false);
        expect(readingGoesOut(reading({ entered_by: 'sensor:x' }))).toBe(false);
        expect(readingGoesOut(reading({ source_system: 'maximo' }))).toBe(true);
    });
    it('renders a document with date, time, value, unit, text and user', () => {
        expect(toMeasurementDocumentDoc(reading(), '1234', 'mm/s')).toEqual({
            MeasuringPoint: '1234', MsmtRdngDate: '2026-09-22', MsmtRdngTime: '08:15:00', MeasurementReadingInEntryUoM: 4.2,
            MsmtRdngEntryUoM: 'mm/s', MeasurementDocumentText: 'After alignment', MeasurementReadingByUser: 'j.tech',
        });
        const d = toMeasurementDocumentDoc(reading({ reading_time: null, comments: 'x'.repeat(50), valuation_code: 'OK', entered_by: 'averyveryverylongname' }), '1', null);
        expect(d.MsmtRdngTime).toBe('00:00:00');
        expect(d.MeasurementDocumentText).toHaveLength(40);
        expect(d.MsmtValuationCode).toBe('OK');
        expect(d.MeasurementReadingByUser).toBe('averyveryver');
        expect(d.MsmtRdngEntryUoM).toBeUndefined();
    });
    it('turns a SAP document into a reading with SAP\'s number as its identity', () => {
        const p = { id: 'p1', asset_id: 'a1', reading_type_code: 'VIB_DE_H' };
        expect(fromMeasurementDocument({ MeasurementDocument: '777', MsmtRdngDate: '2026-09-22T00:00:00Z', MsmtRdngTime: '09:30:15', MeasurementReadingInEntryUoM: '5.1' as unknown as number, MeasurementReadingByUser: 'PLANNER', MsmtValuationCode: '' }, p))
            .toEqual({ definition_id: 'p1', asset_id: 'a1', reading_type_code: 'VIB_DE_H', reading_date: '2026-09-22', reading_time: '09:30:15', reading_value: 5.1, entered_by: 'sap:PLANNER', comments: null, valuation_code: null, source_system: 'sap_pm', source_ref: '777' });
        expect(fromMeasurementDocument({ MeasurementDocument: '778', MsmtRdngDate: '2026-09-22' }, p)).toBeNull();
        expect(fromMeasurementDocument({ MeasurementDocument: '779', MeasurementReadingInEntryUoM: 1 }, p)).toBeNull();
        expect(fromMeasurementDocument({ MeasurementDocument: '780', MsmtRdngDate: '2026-09-22', MeasurementReadingInEntryUoM: 1 }, p)?.entered_by).toBe('sap:780');
    });
});
