import { describe, it, expect } from 'vitest';
import {
    sinceFilter, setUrl, keyUrl, parseKeyPath, parseFilter, matchesFilter,
    etagOf, etagMatches, bodyEtag, odataTimestamp,
} from './odata';

describe('URLs', () => {
    it('builds a collection URL with only the options that are set', () => {
        expect(setUrl('https://sim/t/co/', 'A_Equipment', { $filter: 'LastChangeDateTime gt 2026-01-01T00:00:00.000Z', $top: 500, $skip: undefined }))
            .toBe("https://sim/t/co/A_Equipment?%24filter=LastChangeDateTime%20gt%202026-01-01T00%3A00%3A00.000Z&%24top=500");
        expect(setUrl('https://sim', 'A_FunctionalLocation')).toBe('https://sim/A_FunctionalLocation');
    });
    it("quotes the key and doubles a quote inside it", () => {
        expect(keyUrl('https://sim', 'A_Equipment', '10000001')).toBe("https://sim/A_Equipment('10000001')");
        expect(keyUrl('https://sim', 'A_FunctionalLocation', "P-1'A")).toBe("https://sim/A_FunctionalLocation('P-1''A')");
    });
    it('parses a key path back, including a doubled quote and an encoded segment', () => {
        expect(parseKeyPath("A_Equipment('10000001')")).toEqual({ set: 'A_Equipment', key: '10000001' });
        expect(parseKeyPath("A_FunctionalLocation('P-1''A')")).toEqual({ set: 'A_FunctionalLocation', key: "P-1'A" });
        expect(parseKeyPath('A_Equipment')).toEqual({ set: 'A_Equipment', key: null });
        expect(parseKeyPath("A_Equipment(%2710000001%27)")).toEqual({ set: 'A_Equipment', key: '10000001' });
        expect(parseKeyPath("A_Nothing('1')")).toBeNull();
        expect(parseKeyPath('__reset')).toBeNull();
    });
});

describe('$filter', () => {
    it('renders the watermark filter and nothing when there is no watermark', () => {
        expect(sinceFilter('LastChangeDateTime', '2026-09-22T10:00:00Z')).toBe('LastChangeDateTime gt 2026-09-22T10:00:00.000Z');
        expect(sinceFilter('LastChangeDateTime', null)).toBeUndefined();
    });
    it('parses the subset the link uses and refuses the rest', () => {
        expect(parseFilter("LastChangeDateTime gt 2026-01-01T00:00:00.000Z and Equipment eq '10000001'")).toEqual([
            { field: 'LastChangeDateTime', op: 'gt', value: '2026-01-01T00:00:00.000Z' },
            { field: 'Equipment', op: 'eq', value: '10000001' },
        ]);
        expect(parseFilter('')).toEqual([]);
        expect(parseFilter("contains(EquipmentName,'pump')")).toBeNull();
        expect(parseFilter("Equipment eq '1' or Equipment eq '2'")).toBeNull();
    });
    it('compares timestamps as instants and strings as strings', () => {
        const e = { LastChangeDateTime: '2026-05-01T00:00:00.000Z', Equipment: '10000002' };
        expect(matchesFilter(e, parseFilter('LastChangeDateTime gt 2026-04-30T23:59:59.000Z')!)).toBe(true);
        expect(matchesFilter(e, parseFilter('LastChangeDateTime gt 2026-05-01T00:00:00.000Z')!)).toBe(false);
        expect(matchesFilter(e, parseFilter("Equipment eq '10000002' and LastChangeDateTime ge 2026-05-01T00:00:00Z")!)).toBe(true);
        expect(matchesFilter(e, parseFilter("Missing ne 'x'")!)).toBe(true);
        expect(matchesFilter(e, parseFilter("Missing eq 'x'")!)).toBe(false);
    });
});

describe('ETags', () => {
    it('issues weak ETags and matches them with or without the weak marker', () => {
        expect(etagOf(3)).toBe('W/"3"');
        expect(etagMatches('W/"3"', etagOf(3))).toBe(true);
        expect(etagMatches('"3"', etagOf(3))).toBe(true);
        expect(etagMatches('W/"2"', etagOf(3))).toBe(false);
        expect(etagMatches('*', etagOf(3))).toBe(true);
        expect(etagMatches(null, etagOf(3))).toBe(false);
        expect(etagMatches('W/"1", W/"3"', etagOf(3))).toBe(true);
    });
    it('reads the ETag a V4 body carries', () => {
        expect(bodyEtag({ '@odata.etag': 'W/"7"', Equipment: '1' })).toBe('W/"7"');
        expect(bodyEtag({ Equipment: '1' })).toBeNull();
        expect(bodyEtag(null)).toBeNull();
    });
    it('renders timestamps as ISO instants', () => {
        expect(odataTimestamp('2026-09-22T10:00:00+02:00')).toBe('2026-09-22T08:00:00.000Z');
    });
});
