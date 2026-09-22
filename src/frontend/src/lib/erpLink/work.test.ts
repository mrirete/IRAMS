import { describe, it, expect } from 'vitest';
import {
    requestGoesOut, priorityFromRisk, toNotificationDoc, woStatusFromSap, woTypeFromSap, priorityFromSap,
    objectRefOf, newWorkOrderFromOrder, orderPatch, workOrderDiff, type LinkRequest,
} from './work';

const request = (over: Partial<LinkRequest> = {}): LinkRequest => ({
    id: 'r1', request_number: 'SR-2026-0001', status: 'NEW', description: 'Pump P-101-A leaking at the seal, oil on the floor', asset_id: 'a1',
    requester_id: 'u1', risk_score: 12, is_breakdown: false, category: 'MECH', created_at: '2026-09-22T06:00:00.000Z', updated_at: '2026-09-22T06:00:00.000Z', ...over,
});

describe('notifications', () => {
    it('sends requests being worked or converted, not rejected or failed ones', () => {
        for (const s of ['NEW', 'REVIEW', 'AUTHORIZED', 'APPROVED', 'CONVERTED', 'new']) expect(requestGoesOut({ status: s })).toBe(true);
        for (const s of ['REJECTED', 'PENDING', 'ERROR', 'SUCCESS', '']) expect(requestGoesOut({ status: s })).toBe(false);
    });
    it('derives SAP priority from breakdown and risk', () => {
        expect(priorityFromRisk(3, true)).toBe('1');
        expect(priorityFromRisk(16, false)).toBe('1');
        expect(priorityFromRisk(12, false)).toBe('2');
        expect(priorityFromRisk(6, false)).toBe('3');
        expect(priorityFromRisk(1, false)).toBe('4');
        expect(priorityFromRisk(null, false)).toBe('3');
    });
    it('renders an M1 with the object, long text when the text overflows 40, and the reporter', () => {
        const d = toNotificationDoc(request(), null, { type: 'EQUI', key: '10000001' }, 'j.tech');
        expect(d).toEqual({
            NotificationText: 'Pump P-101-A leaking at the seal, oil on', NotificationType: 'M1', MaintPriority: '2',
            TechnicalObject: '10000001', TechObjIsEquipOrFuncnlLoc: 'EAMS_EQUI',
            NotificationLongText: 'Pump P-101-A leaking at the seal, oil on the floor', ReportedByUser: 'j.tech',
        });
    });
    it('renders an M2 with the malfunction start and the mapped number, on a functional location', () => {
        const d = toNotificationDoc(request({ is_breakdown: true, description: 'Tripped' }), '10000009', { type: 'IFLOT', key: 'PLANT-U1' }, null);
        expect(d.NotificationType).toBe('M2');
        expect(d.MaintPriority).toBe('1');
        expect(d.MaintenanceNotification).toBe('10000009');
        expect(d.TechObjIsEquipOrFuncnlLoc).toBe('EAMS_FL');
        expect(d.MalfunctionStartDateTime).toBe('2026-09-22T06:00:00.000Z');
        expect(d.NotificationLongText).toBeUndefined();
        expect(d.ReportedByUser).toBeUndefined();
    });
});

describe('orders', () => {
    it('maps SAP system status to the native buckets, unknown as open', () => {
        expect(['CRTD', 'REL', 'PCNF', 'CNF', 'TECO', 'CLSD', 'DLFL', 'weird', ''].map(woStatusFromSap))
            .toEqual(['OPEN', 'SCHED', 'WIP', 'WIP', 'TECO', 'CLOSED', 'CANCELLED', 'OPEN', 'OPEN']);
    });
    it('maps order type and priority', () => {
        expect(['PM01', 'PM02', 'PM03', 'ZZ', undefined].map(woTypeFromSap)).toEqual(['CM', 'PM', 'BM', 'CM', 'CM']);
        expect(['1', '2', '3', '4', '', undefined].map(priorityFromSap)).toEqual(['P1', 'P2', 'P3', 'P4', 'P3', 'P3']);
    });
    it('reads the technical object as a map lookup', () => {
        expect(objectRefOf({ TechnicalObject: '10000001', TechObjIsEquipOrFuncnlLoc: 'EAMS_EQUI' })).toEqual({ type: 'EQUI', key: '10000001' });
        expect(objectRefOf({ TechnicalObject: 'PLANT-U1', TechObjIsEquipOrFuncnlLoc: 'EAMS_FL' })).toEqual({ type: 'IFLOT', key: 'PLANT-U1' });
        expect(objectRefOf({ TechnicalObject: '10000001' })).toEqual({ type: 'EQUI', key: '10000001' });
        expect(objectRefOf({})).toBeNull();
    });
    it('creates a work order from a released SAP order, linked to its request, with SAP\'s identity kept', () => {
        const row = newWorkOrderFromOrder({
            MaintenanceOrder: '4000001', MaintenanceOrderDesc: 'Replace seal', MaintenanceOrderType: 'PM01', MaintenanceOrderStatus: 'REL',
            MaintPriority: '2', BasicStartDate: '2026-09-23T00:00:00Z', BasicEndDate: '2026-09-25', MainWorkCenter: 'MECH',
        }, 'WO-2026-01234', 'a1', 'r1');
        expect(row).toEqual({
            wo_number: 'WO-2026-01234', title: 'Replace seal', description: 'Replace seal', type: 'CM', status: 'SCHED', asset_id: 'a1',
            priority_code: 'P2', request_id: 'r1', due_date: '2026-09-25', date_due_start: '2026-09-23',
            properties: { source: 'sap_pm', sap_order: '4000001', sap_status: 'REL', sap_order_type: 'PM01', sap_work_center: 'MECH' },
        });
        const bare = newWorkOrderFromOrder({ MaintenanceOrder: '4000002' }, 'WO-1', 'a1', null);
        expect(bare.title).toBe('SAP order 4000002');
        expect(bare.status).toBe('OPEN');
        expect(bare.request_id).toBeUndefined();
        expect(newWorkOrderFromOrder({ MaintenanceOrder: '1', MaintenanceOrderDesc: 'X'.repeat(100) }, 'W', 'a', null).title).toHaveLength(80);
    });
    it('patches only what SAP sent, and diffs status case-insensitively', () => {
        expect(orderPatch({ MaintenanceOrderStatus: 'TECO' })).toEqual({ status: 'TECO' });
        expect(orderPatch({ MaintenanceOrderDesc: '  ', MaintPriority: '1' })).toEqual({ priority_code: 'P1' });
        expect(workOrderDiff({ title: 'A', status: 'teco', priority_code: 'P2' }, { title: 'A', status: 'TECO', priority_code: 'P1' })).toEqual({ priority_code: 'P1' });
        expect(workOrderDiff({ status: 'SCHED' }, { status: 'TECO', due_date: '2026-09-25' })).toEqual({ status: 'TECO', due_date: '2026-09-25' });
    });
});
