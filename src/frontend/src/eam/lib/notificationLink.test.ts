import { describe, it, expect } from 'vitest';
import { notificationTarget } from './notificationLink';

describe('notificationTarget', () => {
    it('lands work orders on the work order, whatever the emitter called the type', () => {
        expect(notificationTarget({ entity_type: 'WORK_ORDER', entity_id: 'a1' })).toBe('/work-orders/a1');
        expect(notificationTarget({ entity_type: 'WO', entity_id: 'a1' })).toBe('/work-orders/a1');
        expect(notificationTarget({ entity_type: 'work_order', entity_id: 'a1' })).toBe('/work-orders/a1');
    });
    it('routes the types that have a verified deep-link contract', () => {
        expect(notificationTarget({ entity_type: 'WORK_REQUEST', entity_id: 'r1' })).toBe('/requests?id=r1');
        expect(notificationTarget({ entity_type: 'REQ', entity_id: 'r1' })).toBe('/requests?id=r1');
        expect(notificationTarget({ entity_type: 'asset', entity_id: 's1' })).toBe('/assets?id=s1');
        expect(notificationTarget({ entity_type: 'INVENTORY_ITEM', entity_id: 'i1' })).toBe('/inventory?id=i1');
        expect(notificationTarget({ entity_type: 'CONTACT', entity_id: 'c1' })).toBe('/contacts?id=c1');
        expect(notificationTarget({ entity_type: 'RCA_INVESTIGATION', entity_id: 'x1' })).toBe('/analyze/rca/x1');
        expect(notificationTarget({ entity_type: 'budget', entity_id: 'b1' })).toBe('/finops?tab=dashboard');
    });
    it('falls back to the stored action link, then the notifications page', () => {
        expect(notificationTarget({ entity_type: 'QUALIFICATION', entity_id: 'q1', action_link: '/people' })).toBe('/people');
        expect(notificationTarget({ entity_type: 'PURCHASE_ORDER', entity_id: 'p1' })).toBe('/notifications');
        expect(notificationTarget({ entity_type: 'WORK_ORDER', entity_id: null, action_link: null })).toBe('/notifications');
    });
});
