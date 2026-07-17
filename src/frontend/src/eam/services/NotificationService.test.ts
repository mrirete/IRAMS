import { describe, it, expect, vi, beforeEach } from 'vitest';

// The bell query and RLS match notifications on recipient_id = auth user id,
// so notify() must map contact ids (e.g. work_orders.assigned_to) to user ids.
// These tests pin the resolution order: users.contact_id → contacts.user_id → passthrough.

const fromMock = vi.fn();
const invokeMock = vi.fn().mockResolvedValue({ data: {}, error: null });

vi.mock('../lib/supabase', () => ({
    supabase: {
        from: (table: string) => fromMock(table),
        functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
    },
}));

const createNotification = vi.fn().mockResolvedValue({});
const getNotificationChannels = vi.fn().mockResolvedValue([]);
vi.mock('./DatabaseService', () => ({
    DatabaseService: { getInstance: () => ({ createNotification, getNotificationChannels }) },
}));

import { NotificationService } from './NotificationService';

/** Builds a from() result whose select().eq().maybeSingle() resolves to `data`. */
const tableReturning = (data: unknown) => ({
    select: () => ({
        eq: () => ({
            maybeSingle: () => Promise.resolve({ data, error: null }),
        }),
    }),
});

const CONTACT_ID = '11111111-2222-3333-4444-555555555555';
const CONTACT_ID_2 = '66666666-7777-8888-9999-aaaaaaaaaaaa';
const USER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const PLAIN_USER_ID = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';

/** Insert mock for the notification_outbox table (0199). */
const outboxInsert = vi.fn();

/** fromMock impl that also answers for notification_outbox. */
const tablesWithOutbox = (resolve: (table: string) => unknown) => (table: string) =>
    table === 'notification_outbox' ? { insert: outboxInsert } : resolve(table);

beforeEach(() => {
    fromMock.mockReset();
    createNotification.mockClear();
    getNotificationChannels.mockClear().mockResolvedValue([]);
    outboxInsert.mockClear().mockResolvedValue({ error: null });
    invokeMock.mockClear();
    // The kill-switch check and outbox kick are cached/debounced statics.
    (NotificationService as any).emailChannelCheck = null;
    (NotificationService as any).lastOutboxKick = 0;
});

describe('NotificationService.resolveRecipientUserId', () => {
    it('maps a contact id to its user via users.contact_id', async () => {
        fromMock.mockImplementation((table: string) =>
            table === 'users' ? tableReturning({ id: USER_ID }) : tableReturning(null));

        expect(await NotificationService.resolveRecipientUserId(CONTACT_ID)).toBe(USER_ID);
        expect(fromMock).toHaveBeenCalledWith('users');
    });

    it('falls back to contacts.user_id when no users row links back', async () => {
        fromMock.mockImplementation((table: string) =>
            table === 'users' ? tableReturning(null) : tableReturning({ user_id: USER_ID }));

        expect(await NotificationService.resolveRecipientUserId(CONTACT_ID_2)).toBe(USER_ID);
    });

    it('passes an id through unchanged when neither direction matches (already a user id)', async () => {
        fromMock.mockImplementation(() => tableReturning(null));

        expect(await NotificationService.resolveRecipientUserId(PLAIN_USER_ID)).toBe(PLAIN_USER_ID);
    });

    it('passes non-UUID ids (SYSTEM, usernames) through without querying', async () => {
        expect(await NotificationService.resolveRecipientUserId('SYSTEM')).toBe('SYSTEM');
        expect(await NotificationService.resolveRecipientUserId('')).toBe('');
        expect(fromMock).not.toHaveBeenCalled();
    });

    it('caches resolutions so repeat lookups do not re-query', async () => {
        fromMock.mockImplementation(() => tableReturning(null));

        await NotificationService.resolveRecipientUserId(PLAIN_USER_ID);
        const calls = fromMock.mock.calls.length;
        await NotificationService.resolveRecipientUserId(PLAIN_USER_ID);
        expect(fromMock.mock.calls.length).toBe(calls);
    });
});

describe('NotificationService.notify', () => {
    it('writes the notification with the resolved user id, not the contact id', async () => {
        const contactId = '99999999-8888-7777-6666-555555555555';
        fromMock.mockImplementation((table: string) =>
            table === 'users' ? tableReturning({ id: USER_ID }) : tableReturning(null));

        await NotificationService.notify({
            recipientId: contactId,
            title: 'New Assignment: WO-1',
            message: 'You have been assigned a work order.',
            severity: 'INFO',
            notificationType: 'ASSIGNMENT',
            module: 'workOrders',
        });

        expect(createNotification).toHaveBeenCalledTimes(1);
        expect(createNotification.mock.calls[0][0].recipientId).toBe(USER_ID);
    });
});

// EMAIL rows are queued in notification_outbox (0199) for the notify-dispatch
// edge function to drain — gated on the global EMAIL channel kill-switch.
describe('NotificationService email outbox', () => {
    const notifyParams = {
        recipientId: PLAIN_USER_ID,
        title: 'New Assignment: WO-7',
        message: 'You have been assigned a work order.',
        severity: 'INFO' as const,
        notificationType: 'ASSIGNMENT',
        module: 'workOrders',
        entityNumber: 'WO-7',
        actionLink: '/work-orders',
    };

    it('does not enqueue when the EMAIL channel is globally off', async () => {
        fromMock.mockImplementation(tablesWithOutbox(() => tableReturning(null)));
        getNotificationChannels.mockResolvedValue([{ type: 'EMAIL', isActive: false }]);

        await NotificationService.notify(notifyParams);

        expect(createNotification).toHaveBeenCalledTimes(1);
        expect(outboxInsert).not.toHaveBeenCalled();
        expect(invokeMock).not.toHaveBeenCalled();
    });

    it('enqueues an outbox row and kicks notify-dispatch when EMAIL is on', async () => {
        fromMock.mockImplementation(tablesWithOutbox(() => tableReturning(null)));
        getNotificationChannels.mockResolvedValue([{ type: 'EMAIL', isActive: true }]);

        await NotificationService.notify(notifyParams);

        expect(outboxInsert).toHaveBeenCalledTimes(1);
        const rows = outboxInsert.mock.calls[0][0];
        expect(rows).toEqual([{
            recipient_user_id: PLAIN_USER_ID,
            subject: '[WO-7] New Assignment: WO-7',
            message: 'You have been assigned a work order.',
            severity: 'INFO',
            module: 'workOrders',
            entity_number: 'WO-7',
            action_link: '/work-orders',
        }]);
        expect(invokeMock).toHaveBeenCalledWith('notify-dispatch', { body: {} });
    });

    it('addresses the email to the resolved user id, not the contact id', async () => {
        fromMock.mockImplementation(tablesWithOutbox((table: string) =>
            table === 'users' ? tableReturning({ id: USER_ID }) : tableReturning(null)));
        getNotificationChannels.mockResolvedValue([{ type: 'EMAIL', isActive: true }]);

        await NotificationService.notify({ ...notifyParams, recipientId: CONTACT_ID });

        expect(outboxInsert.mock.calls[0][0][0].recipient_user_id).toBe(USER_ID);
    });

    it('drops mailbox-less recipients (SYSTEM) instead of enqueueing', async () => {
        fromMock.mockImplementation(tablesWithOutbox(() => tableReturning(null)));
        getNotificationChannels.mockResolvedValue([{ type: 'EMAIL', isActive: true }]);

        await NotificationService.notify({ ...notifyParams, recipientId: 'SYSTEM' });

        expect(createNotification).toHaveBeenCalledTimes(1);
        expect(outboxInsert).not.toHaveBeenCalled();
    });

    it('still creates the in-app notification when enqueue fails (pre-0199 DB)', async () => {
        fromMock.mockImplementation(tablesWithOutbox(() => tableReturning(null)));
        getNotificationChannels.mockResolvedValue([{ type: 'EMAIL', isActive: true }]);
        outboxInsert.mockResolvedValue({ error: { message: 'relation "notification_outbox" does not exist' } });

        await NotificationService.notify(notifyParams);

        expect(createNotification).toHaveBeenCalledTimes(1);
        expect(invokeMock).not.toHaveBeenCalled();
    });
});

// ROLE recipients must resolve against contacts.roles (text[]) — there is no
// contacts.contact_type column, so the old ilike('contact_type', …) query
// errored on every call and rules addressed to Planner/Supervisor delivered
// to nobody. These tests pin the array-based, case/format-insensitive match.
describe('NotificationService role resolution (roles array)', () => {
    const svc = NotificationService as any;

    it('roleMatches is case- and separator-insensitive', () => {
        expect(svc.roleMatches('Supervisor', ['SUPERVISOR'])).toBe(true);
        expect(svc.roleMatches('SYS_ADMIN', ['Sys Admin'])).toBe(true);
        expect(svc.roleMatches('PLANNER', ['SUPERVISOR', 'PLANNER'])).toBe(true);
        expect(svc.roleMatches('PLANNER', ['TECHNICIAN'])).toBe(false);
        expect(svc.roleMatches('', ['PLANNER'])).toBe(false);
        expect(svc.roleMatches('PLANNER', null)).toBe(false);
    });

    it('GLOBAL scope matches role holders from the roles array', async () => {
        fromMock.mockImplementation((table: string) => {
            if (table !== 'contacts') throw new Error('unexpected table ' + table);
            return {
                select: () => ({
                    limit: () => Promise.resolve({
                        data: [
                            { id: CONTACT_ID, user_id: USER_ID, roles: ['SUPERVISOR', 'ELEC'] },
                            { id: CONTACT_ID_2, user_id: PLAIN_USER_ID, roles: ['TECHNICIAN'] },
                        ],
                        error: null,
                    }),
                }),
            };
        });

        const ids = await svc.resolveRoleRecipientsScoped('Supervisor', 'GLOBAL');
        expect(ids).toEqual([USER_ID]);
    });

    // Seeded admins (J.test1/2) have contacts.user_id = null but a users row whose
    // contact_id links back — role resolution must map through users.contact_id,
    // not require the legacy contacts.user_id direction.
    it('GLOBAL scope maps user-less contacts through users.contact_id', async () => {
        const roleContact = 'cccccccc-1111-2222-3333-444444444444';
        fromMock.mockImplementation((table: string) => {
            if (table === 'contacts') {
                return {
                    select: () => ({
                        limit: () => Promise.resolve({
                            data: [{ id: roleContact, user_id: null, roles: ['SYS_ADMIN'] }],
                            error: null,
                        }),
                        // resolveRecipientUserId fallback path: contacts.select().eq().maybeSingle()
                        eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
                    }),
                };
            }
            if (table === 'users') return tableReturning({ id: USER_ID });
            throw new Error('unexpected table ' + table);
        });

        const ids = await svc.resolveRoleRecipientsScoped('Sys Admin', 'GLOBAL');
        expect(ids).toEqual([USER_ID]);
    });

    it('GLOBAL scope drops role holders with no login at all', async () => {
        const orphanContact = 'dddddddd-1111-2222-3333-444444444444';
        fromMock.mockImplementation((table: string) => {
            if (table === 'contacts') {
                return {
                    select: () => ({
                        limit: () => Promise.resolve({
                            data: [{ id: orphanContact, user_id: null, roles: ['PLANNER'] }],
                            error: null,
                        }),
                        eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
                    }),
                };
            }
            if (table === 'users') return tableReturning(null);
            throw new Error('unexpected table ' + table);
        });

        expect(await svc.resolveRoleRecipientsScoped('Planner', 'GLOBAL')).toEqual([]);
    });
});

// DYNAMIC workCenterCrew/workCenterSupervisor route a request to the roster of
// its (responsible) work centre — 0191 work_center_members.
describe('NotificationService work-centre crew resolution', () => {
    const svc = NotificationService as any;
    const LEAD_CONTACT = 'lead-contact-id';
    const MEMBER_CONTACT = 'member-contact-id';

    const mockRoster = (members: any[], onContactsIn: (ids: string[]) => any[]) => {
        fromMock.mockImplementation((table: string) => {
            if (table === 'work_center_members') {
                return { select: () => ({ eq: () => Promise.resolve({ data: members, error: null }) }) };
            }
            if (table === 'contacts') {
                return {
                    select: () => ({
                        in: (_col: string, ids: string[]) => Promise.resolve({ data: onContactsIn(ids), error: null }),
                    }),
                };
            }
            throw new Error('unexpected table ' + table);
        });
    };

    it('resolves the whole crew to user ids', async () => {
        mockRoster(
            [{ contact_id: LEAD_CONTACT, role: 'LEAD' }, { contact_id: MEMBER_CONTACT, role: 'MEMBER' }],
            ids => ids.map((id, i) => ({ id, user_id: i === 0 ? USER_ID : PLAIN_USER_ID })),
        );
        expect(await svc.resolveWorkCenterRecipients('wc-1', false)).toEqual([USER_ID, PLAIN_USER_ID]);
    });

    it('supervisor variant prefers LEAD members only', async () => {
        let queriedIds: string[] = [];
        mockRoster(
            [{ contact_id: LEAD_CONTACT, role: 'LEAD' }, { contact_id: MEMBER_CONTACT, role: 'MEMBER' }],
            ids => { queriedIds = ids; return ids.map(id => ({ id, user_id: USER_ID })); },
        );
        expect(await svc.resolveWorkCenterRecipients('wc-1', true)).toEqual([USER_ID]);
        expect(queriedIds).toEqual([LEAD_CONTACT]);
    });

    it('supervisor variant falls back to the whole crew when no LEAD is flagged', async () => {
        let queriedIds: string[] = [];
        mockRoster(
            [{ contact_id: MEMBER_CONTACT, role: 'MEMBER' }],
            ids => { queriedIds = ids; return ids.map(id => ({ id, user_id: PLAIN_USER_ID })); },
        );
        expect(await svc.resolveWorkCenterRecipients('wc-1', true)).toEqual([PLAIN_USER_ID]);
        expect(queriedIds).toEqual([MEMBER_CONTACT]);
    });

    it('returns empty for an unmanned roster', async () => {
        mockRoster([], () => []);
        expect(await svc.resolveWorkCenterRecipients('wc-1', false)).toEqual([]);
    });
});
