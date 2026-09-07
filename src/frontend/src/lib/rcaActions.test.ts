import { describe, it, expect } from 'vitest';
import { actionsSettled, mocGate, resolveAssignee, isAssigned, fmeaSeverity, fmeaOccurrence, type Person } from './rcaActions';

describe('actionsSettled', () => {
    it('needs at least one action, all completed or cancelled', () => {
        expect(actionsSettled([])).toBe(false);
        expect(actionsSettled([{ status: 'completed' }, { status: 'cancelled' }])).toBe(true);
        expect(actionsSettled([{ status: 'completed' }, { status: 'in_progress' }])).toBe(false);
    });
});

describe('mocGate', () => {
    it('lets ordinary actions raise work', () => {
        expect(mocGate({ status: 'open' }).canRaiseWork).toBe(true);
    });
    it('blocks a change-controlled action until its MOC is approved', () => {
        expect(mocGate({ status: 'open', requires_moc: true }).canRaiseWork).toBe(false);
        expect(mocGate({ status: 'open', requires_moc: true, moc_request_id: 'm1' }, 'DRAFT').canRaiseWork).toBe(false);
        expect(mocGate({ status: 'open', requires_moc: true, moc_request_id: 'm1' }, 'UNDER_REVIEW').reason).toMatch(/Waiting/);
        expect(mocGate({ status: 'open', requires_moc: true, moc_request_id: 'm1' }, 'APPROVED').canRaiseWork).toBe(true);
        expect(mocGate({ status: 'open', requires_moc: true, moc_request_id: 'm1' }, 'implemented').canRaiseWork).toBe(true);
    });
});

describe('resolveAssignee', () => {
    const people: Person[] = [
        { id: 'c1', name: 'Bea Okafor', kind: 'contact' },
        { id: 'u1', name: 'k.syrus', kind: 'user' },
    ];
    it('resolves picker values and typed names, and nothing else', () => {
        expect(resolveAssignee('contact:c1', people)?.name).toBe('Bea Okafor');
        expect(resolveAssignee('user:u1', people)?.id).toBe('u1');
        expect(resolveAssignee('bea okafor', people)?.id).toBe('c1');
        expect(resolveAssignee('user:c1', people)).toBeNull();
        expect(resolveAssignee('  ', people)).toBeNull();
        expect(resolveAssignee('nobody', people)).toBeNull();
    });
    it('isAssigned accepts the id or the legacy name', () => {
        expect(isAssigned({ status: 'open' })).toBe(false);
        expect(isAssigned({ status: 'open', assigned_to: ' ' })).toBe(false);
        expect(isAssigned({ status: 'open', assigned_to: 'Bea' })).toBe(true);
        expect(isAssigned({ status: 'open', assignee_id: 'u1' })).toBe(true);
    });
});

describe('FMEA scoring', () => {
    it('severity follows harm first, then criticality', () => {
        expect(fmeaSeverity({ safetyTier: 'lti', criticality: 'C' })).toBe(9);
        expect(fmeaSeverity({ envImpact: 'major' })).toBe(8);
        expect(fmeaSeverity({ criticality: 'a' })).toBe(8);
        expect(fmeaSeverity({ safetyTier: 'first_aid' })).toBe(6);
        expect(fmeaSeverity({ criticality: 'B' })).toBe(6);
        expect(fmeaSeverity({})).toBe(4);
    });
    it('occurrence follows the repeat-failure record', () => {
        expect(fmeaOccurrence({})).toBe(3);
        expect(fmeaOccurrence({ cmCount12mo: 1 })).toBe(5);
        expect(fmeaOccurrence({ priorRcaCount: 1 })).toBe(5);
        expect(fmeaOccurrence({ cmCount12mo: 3 })).toBe(7);
        expect(fmeaOccurrence({ priorRcaCount: 2 })).toBe(7);
        expect(fmeaOccurrence({ cmCount12mo: 6 })).toBe(8);
    });
});
