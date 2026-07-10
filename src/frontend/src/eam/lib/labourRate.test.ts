import { describe, it, expect } from 'vitest';
import { resolveLabourRate, DEFAULT_LABOUR_RATE } from './labourRate';

const contacts = [
    { id: 'c-sarah', hourlyRate: 95 },
    { id: 'c-joe', hourlyRate: 0 },        // 0 = unset, must not win
    { id: 'c-amy', hourlyRate: undefined },
];

const dictionaries = [
    { type: 'CONTACT_TYPE', code: 'REL_ENG', active: true, hourlyRate: 80 },
    { type: 'CONTACT_TYPE', code: 'WELDER', active: true, hourlyRate: 0 },
    { type: 'CONTACT_TYPE', code: 'RIGGER', active: false, hourlyRate: 60 }, // inactive, must not win
];

describe('resolveLabourRate — cascade order', () => {
    it('person override beats role and work-center rates', () => {
        expect(resolveLabourRate({ contactId: 'c-sarah', roleCode: 'REL_ENG', contacts, dictionaries, workCenterRate: 70 }))
            .toEqual({ rate: 95, source: 'person' });
    });

    it('role rate wins when the person has no rate of their own', () => {
        expect(resolveLabourRate({ contactId: 'c-amy', roleCode: 'REL_ENG', contacts, dictionaries, workCenterRate: 70 }))
            .toEqual({ rate: 80, source: 'role' });
    });

    it('falls back to the work-center rate when neither person nor role has a rate', () => {
        expect(resolveLabourRate({ contactId: 'c-joe', roleCode: 'WELDER', contacts, dictionaries, workCenterRate: 70 }))
            .toEqual({ rate: 70, source: 'work-center' });
    });

    it('falls back to the default when nothing is configured', () => {
        expect(resolveLabourRate({ contacts, dictionaries }))
            .toEqual({ rate: DEFAULT_LABOUR_RATE, source: 'default' });
    });
});

describe('resolveLabourRate — edge cases', () => {
    it('ignores zero/unset person rates instead of costing at $0', () => {
        const r = resolveLabourRate({ contactId: 'c-joe', roleCode: 'REL_ENG', contacts, dictionaries, workCenterRate: 70 });
        expect(r).toEqual({ rate: 80, source: 'role' });
    });

    it('ignores inactive dictionary roles', () => {
        expect(resolveLabourRate({ roleCode: 'RIGGER', contacts, dictionaries, workCenterRate: 70 }))
            .toEqual({ rate: 70, source: 'work-center' });
    });

    it('unknown contact or role falls through the cascade', () => {
        expect(resolveLabourRate({ contactId: 'ghost', roleCode: 'NOPE', contacts, dictionaries, workCenterRate: 70 }))
            .toEqual({ rate: 70, source: 'work-center' });
    });

    it('coerces string rates from loosely-typed rows', () => {
        const r = resolveLabourRate({
            contactId: 'c-str',
            contacts: [{ id: 'c-str', hourlyRate: '88.5' }],
            dictionaries,
        });
        expect(r).toEqual({ rate: 88.5, source: 'person' });
    });

    it('zero work-center rate does not shadow the default', () => {
        expect(resolveLabourRate({ contacts, dictionaries, workCenterRate: 0 }))
            .toEqual({ rate: DEFAULT_LABOUR_RATE, source: 'default' });
    });
});
