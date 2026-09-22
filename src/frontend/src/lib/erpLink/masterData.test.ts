import { describe, it, expect } from 'vitest';
import {
    objectTypeOf, levelRank, childLevelOf, sendOrder, toEquipmentDoc, toFunctionalLocationDoc,
    fromEquipment, fromFunctionalLocation, patchDiff, newAssetFromEquipment, newAssetFromFunctionalLocation,
    resolveInbound, resolveStaleSend, changedFields, advanceWatermark, settleWatermark, backoffMinutes,
    watermarkOf, withWatermark, flows, DEFAULT_FAMILIES, type LinkAsset,
} from './masterData';

const asset = (over: Partial<LinkAsset> = {}): LinkAsset => ({
    id: 'a1', tag: 'P-101-A', name: 'Feed pump A', hierarchy_level: 'EQUIPMENT', parent_id: 'u1',
    equipment_number: 'EQ-000020', manufacturer: 'Sulzer', model: 'ZE 100', serial_number: 'SN-1',
    criticality: 'A', status_code: 'ACTIVE', updated_at: '2026-09-01T00:00:00.000Z', ...over,
});

describe('what an asset is in SAP terms', () => {
    it('equipment and components are EQUI; every level above is IFLOT', () => {
        expect(objectTypeOf('EQUIPMENT')).toBe('EQUI');
        expect(objectTypeOf('component')).toBe('EQUI');
        for (const l of ['SITE', 'AREA', 'UNIT', 'SYSTEM', 'SUBSYSTEM']) expect(objectTypeOf(l)).toBe('IFLOT');
    });
    it('sends parents before children, oldest change first within a level', () => {
        const rows = [
            asset({ id: 'c', hierarchy_level: 'COMPONENT', updated_at: '2026-01-01T00:00:00Z' }),
            asset({ id: 'e2', hierarchy_level: 'EQUIPMENT', updated_at: '2026-01-03T00:00:00Z' }),
            asset({ id: 'e1', hierarchy_level: 'EQUIPMENT', updated_at: '2026-01-02T00:00:00Z' }),
            asset({ id: 's', hierarchy_level: 'SITE', updated_at: '2026-01-09T00:00:00Z' }),
            asset({ id: 'x', hierarchy_level: 'WEIRD', updated_at: '2026-01-01T00:00:00Z' }),
        ];
        expect(sendOrder(rows).map((r) => r.id)).toEqual(['s', 'e1', 'e2', 'c', 'x']);
        expect(levelRank('SITE')).toBe(0);
        expect(levelRank('nope')).toBe(7);
    });
    it('gives a functional location from SAP the level under its parent, SITE at the top', () => {
        expect(childLevelOf(null)).toBe('SITE');
        expect(childLevelOf('SITE')).toBe('AREA');
        expect(childLevelOf('SUBSYSTEM')).toBe('SUBSYSTEM');
        expect(childLevelOf('EQUIPMENT')).toBe('SUBSYSTEM');
    });
});

describe('field mapping', () => {
    it('renders an equipment with its parent as a functional location and D criticality blank', () => {
        expect(toEquipmentDoc(asset({ criticality: 'D' }), null, { type: 'IFLOT', key: 'PLANT-U1' })).toEqual({
            EquipmentName: 'Feed pump A', EquipmentCategory: 'M', ABCIndicator: '',
            ManufacturerName: 'Sulzer', ManufacturerPartNmbr: 'ZE 100', ManufacturerSerialNumber: 'SN-1',
            FunctionalLocation: 'PLANT-U1',
        });
    });
    it('carries the mapped number and a superordinate equipment for a component', () => {
        const doc = toEquipmentDoc(asset({ hierarchy_level: 'COMPONENT', manufacturer: '  ' }), '10000001', { type: 'EQUI', key: '10000000' });
        expect(doc.Equipment).toBe('10000001');
        expect(doc.SuperordinateEquipment).toBe('10000000');
        expect(doc.FunctionalLocation).toBeUndefined();
        expect(doc.ManufacturerName).toBeUndefined();
        expect(doc.ABCIndicator).toBe('A');
    });
    it('clips names to 40 and labels to 30, and keeps the mapped label over a renamed tag', () => {
        const long = asset({ hierarchy_level: 'UNIT', tag: 'U-' + 'X'.repeat(40), name: 'N'.repeat(50) });
        const doc = toFunctionalLocationDoc(long, null, { type: 'IFLOT', key: 'PLANT' });
        expect(doc.FunctionalLocation).toHaveLength(30);
        expect(doc.FunctionalLocationName).toHaveLength(40);
        expect(doc.SuperiorFunctionalLocation).toBe('PLANT');
        expect(toFunctionalLocationDoc(asset({ hierarchy_level: 'UNIT', tag: 'NEW-TAG' }), 'OLD-LABEL', null).FunctionalLocation).toBe('OLD-LABEL');
    });
    it('reads an equipment back, treating blank manufacturer fields as cleared and unknown ABC as none', () => {
        expect(fromEquipment({ EquipmentName: 'Renamed', ManufacturerName: '', ABCIndicator: 'Z' }))
            .toEqual({ name: 'Renamed', manufacturer: null, criticality: null });
        expect(fromEquipment({ ManufacturerPartNmbr: 'M2' })).toEqual({ model: 'M2' });
        expect(fromFunctionalLocation({ FunctionalLocationName: 'Unit 1', ABCIndicator: 'B' })).toEqual({ name: 'Unit 1', criticality: 'B' });
    });
    it('applies only what differs, so an echo of our own send touches nothing', () => {
        const cur = asset();
        expect(patchDiff(cur, { name: 'Feed pump A', manufacturer: 'Sulzer', criticality: 'A' })).toEqual({});
        expect(patchDiff(cur, { name: 'Feed pump A (spare)', serial_number: null })).toEqual({ name: 'Feed pump A (spare)', serial_number: null });
    });
    it('creates an asset from an equipment or functional location first seen in SAP', () => {
        expect(newAssetFromEquipment({ Equipment: '10000009', EquipmentName: 'Motor', SuperordinateEquipment: '10000001', ABCIndicator: 'C' }, { id: 'p', level: 'EQUIPMENT' }))
            .toEqual({ tag: '10000009', name: 'Motor', hierarchy_level: 'COMPONENT', parent_id: 'p', status_code: 'ACTIVE', criticality: 'C' });
        expect(newAssetFromEquipment({ Equipment: '10000010' }, null))
            .toEqual({ tag: '10000010', name: '10000010', hierarchy_level: 'EQUIPMENT', parent_id: null, status_code: 'ACTIVE' });
        expect(newAssetFromFunctionalLocation({ FunctionalLocation: 'PLANT-A1', FunctionalLocationName: 'Area 1' }, { id: 's', level: 'SITE' }))
            .toEqual({ tag: 'PLANT-A1', name: 'Area 1', hierarchy_level: 'AREA', parent_id: 's', status_code: 'ACTIVE' });
    });
});

describe('the conflict rule', () => {
    it('applies a remote change when IREAMS did not touch the record', () => {
        expect(resolveInbound('sap', false)).toEqual({ apply: 'remote', queue: null, resend: false, reason: null });
        expect(resolveInbound('ireams', false).apply).toBe('remote');
    });
    it('SAP owns: SAP wins, the IREAMS edit is queued as overridden', () => {
        const d = resolveInbound('sap', true, ['name']);
        expect(d.apply).toBe('remote');
        expect(d.queue).toBe('local_overridden');
        expect(d.resend).toBe(false);
        expect(d.reason).toMatch(/SAP owns master data.*IREAMS's change to name was overridden/);
    });
    it('IREAMS owns: nothing is applied, SAP\'s change is queued and IREAMS re-sends', () => {
        const d = resolveInbound('ireams', true, ['name', 'criticality']);
        expect(d.apply).toBe('none');
        expect(d.queue).toBe('remote_overridden');
        expect(d.resend).toBe(true);
        expect(d.reason).toMatch(/not applied.*name, criticality.*sent back/);
    });
    it('a stale send is forced by the owner and stopped for the non-owner', () => {
        expect(resolveStaleSend('ireams')).toBe('force');
        expect(resolveStaleSend('sap')).toBe('conflict');
    });
    it('names the synced fields that differ', () => {
        expect(changedFields(asset(), asset({ name: 'x', model: null }))).toEqual(['name', 'model']);
        expect(changedFields(asset(), asset({ tag: 'other' }))).toEqual([]);
    });
});

describe('watermarks and retries', () => {
    it('advances to the latest processed timestamp, as the database wrote it, and never backwards', () => {
        // microseconds survive: a Date-rendered value would land 0.2 ms early and re-select the row forever
        expect(advanceWatermark(null, ['2026-01-02T00:00:00.123456+00:00', null, '2026-01-01T00:00:00Z'])).toBe('2026-01-02T00:00:00.123456+00:00');
        expect(advanceWatermark('2026-03-01T00:00:00Z', ['2026-01-02T00:00:00Z'])).toBe('2026-03-01T00:00:00Z');
        expect(advanceWatermark(null, [])).toBeNull();
        expect(advanceWatermark(null, ['garbage'])).toBeNull();
    });
    it('holds the watermark before a row that was held back, and never moves backwards', () => {
        const p = ['2026-01-05T00:00:00.000Z', '2026-01-09T00:00:00.000Z'];
        expect(settleWatermark(null, p, [])).toBe('2026-01-09T00:00:00.000Z');
        expect(settleWatermark(null, p, ['2026-01-07T00:00:00.000Z'])).toBe('2026-01-06T23:59:59.999Z');
        expect(settleWatermark('2026-01-08T00:00:00.000Z', p, ['2026-01-07T00:00:00.000Z'])).toBe('2026-01-08T00:00:00.000Z');
        expect(settleWatermark(null, [], ['2026-01-07T00:00:00.000Z'])).toBeNull();
    });
    it('backs off 1, 5, 15, 60, then 240 minutes', () => {
        expect([0, 1, 2, 3, 4, 9].map(backoffMinutes)).toEqual([1, 5, 15, 60, 240, 240]);
    });
    it('reads and writes per-family per-direction watermarks without losing the others', () => {
        const w = withWatermark(withWatermark(null, 'master_data', 'out', '2026-01-01T00:00:00.000Z'), 'master_data', 'in', '2026-01-02T00:00:00.000Z');
        expect(watermarkOf(w, 'master_data', 'out')).toBe('2026-01-01T00:00:00.000Z');
        expect(watermarkOf(w, 'master_data', 'in')).toBe('2026-01-02T00:00:00.000Z');
        expect(watermarkOf(w, 'finance', 'out')).toBeNull();
        expect(withWatermark(w, 'finance', 'out', '2026-01-03T00:00:00.000Z').master_data).toEqual(w.master_data);
    });
    it('knows which way a family flows', () => {
        expect(flows(DEFAULT_FAMILIES.master_data, 'in')).toBe(true);
        expect(flows(DEFAULT_FAMILIES.condition, 'in')).toBe(false);
        expect(flows(DEFAULT_FAMILIES.condition, 'out')).toBe(true);
        expect(flows(undefined, 'out')).toBe(false);
        expect(flows({ direction: 'off', owner: 'sap' }, 'out')).toBe(false);
    });
});
