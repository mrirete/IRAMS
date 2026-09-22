import { describe, it, expect } from 'vitest';
import { buildZip, readZip, crc32 } from './zip';

describe('the hand-written ZIP', () => {
    it('computes the CRC-32 the world agrees on', () => {
        // "123456789" is the reference vector: 0xCBF43926.
        expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xCBF43926);
        expect(crc32(new Uint8Array(0))).toBe(0);
    });

    it('starts with a local file header and ends with the end-of-central-directory record', () => {
        const z = buildZip([{ name: 'a.csv', text: 'A,B\r\n1,2' }]);
        expect([...z.subarray(0, 4)]).toEqual([0x50, 0x4B, 0x03, 0x04]);
        expect([...z.subarray(z.length - 22, z.length - 18)]).toEqual([0x50, 0x4B, 0x05, 0x06]);
    });

    it('round-trips folders, UTF-8 and awkward text', () => {
        const entries = [
            { name: 'Source data for PM - Maintenance plan/S_MPLA#FreeText_Mandatory.csv', text: 'WARPL(k/*),WPTXT\r\n1000,"Pump, monthly — 1 MON"' },
            { name: 'Hand-over (not loaded)/notes.csv', text: 'NOTE\r\n°C and µm/s' },
            { name: 'empty.csv', text: '' },
        ];
        const back = readZip(buildZip(entries, new Date('2026-09-22T10:00:00')));
        expect(back).toEqual(entries);
    });

    it('refuses something that is not a ZIP', () => {
        expect(() => readZip(new TextEncoder().encode('not a zip at all'))).toThrow(/not a ZIP/);
    });
});
