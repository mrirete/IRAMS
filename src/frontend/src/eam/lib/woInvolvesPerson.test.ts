import { describe, it, expect } from 'vitest';
import { woInvolvesPerson } from './workOrder';

const CONTACT = 'c8980be6-1d45-4485-95f3-b984fac17469';
const USER = 'e0cf9101-c344-44cb-af94-d0ba4f97b0b3';
const me = [CONTACT, USER, 'J.tech', 'j.tech@cainergy.com'];

describe('woInvolvesPerson — the one "is this my job" rule', () => {
    it('matches the order-level assignee (a contacts.id)', () => {
        expect(woInvolvesPerson({ assignedTo: CONTACT }, me)).toBe(true);
        expect(woInvolvesPerson({ assignedTo: 'someone-else' }, me)).toBe(false);
    });

    it('matches a task-step assignee (a users.id) when the order itself is unassigned', () => {
        // WO-2026-01000, 2026-09-08: assigned_to null, J.tech ticked on five task rows.
        const wo = { assignedTo: null, tasks: [{ assignedUserIds: ['other'] }, { assignedUserIds: [USER, 'other'] }] };
        expect(woInvolvesPerson(wo, me)).toBe(true);
    });

    it('matches a labour line under either id', () => {
        expect(woInvolvesPerson({ labor: [{ contactId: USER }] }, me)).toBe(true);
        expect(woInvolvesPerson({ labor: [{ contactId: CONTACT }] }, me)).toBe(true);
    });

    it('is false with no ids, with empty ids, or with no links at all', () => {
        expect(woInvolvesPerson({ assignedTo: CONTACT }, [])).toBe(false);
        expect(woInvolvesPerson({ assignedTo: CONTACT }, [null, undefined, ''])).toBe(false);
        expect(woInvolvesPerson({ tasks: [{ assignedUserIds: null }], labor: [] }, me)).toBe(false);
    });
});
