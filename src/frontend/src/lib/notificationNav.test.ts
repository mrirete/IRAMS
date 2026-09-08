import { describe, it, expect } from 'vitest';
import { notificationRoute, isAssessmentInvite } from './notificationNav';

describe('notificationRoute (0338 study + assessment deep links)', () => {
    it('lands an assessment invitation on the assessment, not the list', () => {
        expect(notificationRoute({ entityType: 'ASSESSMENT', entityId: 'abc', actionLink: '/audits' })).toBe('/audits?open=abc');
    });
    it('routes study notifications by record', () => {
        expect(notificationRoute({ entityType: 'RCM_STUDY', entityId: 's1' })).toBe('/rcm/s1');
        expect(notificationRoute({ entityType: 'RCA_INVESTIGATION', entityId: 'r1' })).toBe('/analyze/rca/r1');
    });
    it('still falls back to the stored link for unknown types', () => {
        expect(notificationRoute({ entityType: 'SOMETHING', entityId: 'x', actionLink: '/somewhere' })).toBe('/somewhere');
    });
});

describe('isAssessmentInvite', () => {
    const base = { entityType: 'ASSESSMENT', entityId: 'a1', notificationType: 'ASSIGNMENT', actionRequired: true, isAcknowledged: false };
    it('is true for an unanswered assessment invitation', () => {
        expect(isAssessmentInvite(base)).toBe(true);
    });
    it('is false once answered, or for a status update about the same assessment', () => {
        expect(isAssessmentInvite({ ...base, isAcknowledged: true })).toBe(false);
        expect(isAssessmentInvite({ ...base, notificationType: 'STATUS_CHANGE', actionRequired: false })).toBe(false);
    });
    it('is false for a team add on a study (those need no answer)', () => {
        expect(isAssessmentInvite({ ...base, entityType: 'RCM_STUDY' })).toBe(false);
    });
});
