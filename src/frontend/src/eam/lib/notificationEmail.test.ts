import { describe, it, expect } from 'vitest';
import { buildEmailOutboxRows } from './notificationEmail';

const USER_A = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const USER_B = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';

const content = {
    title: 'Critical Reading Breach',
    message: 'Vibration exceeded the critical band.',
    severity: 'CRITICAL',
    module: 'readings',
    entityNumber: 'P-101',
    actionLink: '/readings?asset=1',
};

describe('buildEmailOutboxRows', () => {
    it('builds one snake_case row per recipient with a subject carrying the entity number', () => {
        const rows = buildEmailOutboxRows([USER_A, USER_B], content);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual({
            recipient_user_id: USER_A,
            subject: '[P-101] Critical Reading Breach',
            message: 'Vibration exceeded the critical band.',
            severity: 'CRITICAL',
            module: 'readings',
            entity_number: 'P-101',
            action_link: '/readings?asset=1',
        });
    });

    it('uses the bare title when there is no entity number and defaults severity to INFO', () => {
        const [row] = buildEmailOutboxRows([USER_A], { title: 'Heads up', message: 'm' });
        expect(row.subject).toBe('Heads up');
        expect(row.severity).toBe('INFO');
        expect(row.module).toBeNull();
        expect(row.entity_number).toBeNull();
        expect(row.action_link).toBeNull();
    });

    it('dedups repeat recipients (role + dynamic resolution can overlap)', () => {
        expect(buildEmailOutboxRows([USER_A, USER_A, USER_B], content)).toHaveLength(2);
    });

    it('drops mailbox-less ids: SYSTEM, usernames, empty', () => {
        expect(buildEmailOutboxRows(['SYSTEM', 'j.test1', '', USER_A], content).map(r => r.recipient_user_id))
            .toEqual([USER_A]);
    });
});
