/**
 * A ZIP file with no compression, written by hand.
 *
 * The Migration Cockpit hands its source data out as one ZIP per object and
 * takes the same back. IREAMS has no ZIP library and this is not a reason to
 * add one: the "stored" method (no compression) is a few dozen lines — local
 * file headers, a central directory, a CRC-32 — and CSVs of a few megabytes
 * are not worth the dependency. Every browser and SAP's uploader read it as
 * an ordinary ZIP.
 *
 * Text files are written as UTF-8. Entry names may carry a folder ("Source
 * data for PM - Maintenance plan/S_MPLA#FreeText_Mandatory.csv"), which is
 * exactly how the cockpit lays a download out.
 */

export interface ZipEntry {
    /** Path inside the archive, forward slashes. */
    name: string;
    /** Text content, written as UTF-8. */
    text: string;
}

const CRC_TABLE: number[] = (() => {
    const t: number[] = [];
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        t.push(c >>> 0);
    }
    return t;
})();

export function crc32(bytes: Uint8Array): number {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

/** MS-DOS date/time pair, as the ZIP format stores it (local time, 2-second resolution). */
function dosDateTime(d: Date): { date: number; time: number } {
    const year = Math.max(1980, d.getFullYear());
    return {
        date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
        time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    };
}

class Writer {
    private parts: Uint8Array[] = [];
    private len = 0;
    get length(): number { return this.len; }
    u16(v: number) { this.parts.push(new Uint8Array([v & 0xFF, (v >>> 8) & 0xFF])); this.len += 2; }
    u32(v: number) { this.parts.push(new Uint8Array([v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF])); this.len += 4; }
    bytes(b: Uint8Array) { this.parts.push(b); this.len += b.length; }
    join(): Uint8Array {
        const out = new Uint8Array(this.len);
        let at = 0;
        for (const p of this.parts) { out.set(p, at); at += p.length; }
        return out;
    }
}

/** Build a stored (uncompressed) ZIP from text entries. */
export function buildZip(entries: ZipEntry[], now: Date = new Date()): Uint8Array {
    const enc = new TextEncoder();
    const { date, time } = dosDateTime(now);
    const w = new Writer();
    const central: { name: Uint8Array; crc: number; size: number; offset: number }[] = [];

    for (const e of entries) {
        const name = enc.encode(e.name.replace(/\\/g, '/'));
        const data = enc.encode(e.text);
        const crc = crc32(data);
        const offset = w.length;
        // Local file header.
        w.u32(0x04034B50);
        w.u16(20);           // version needed: 2.0
        w.u16(0x0800);       // flags: names are UTF-8
        w.u16(0);            // method: stored
        w.u16(time); w.u16(date);
        w.u32(crc); w.u32(data.length); w.u32(data.length);
        w.u16(name.length); w.u16(0);
        w.bytes(name); w.bytes(data);
        central.push({ name, crc, size: data.length, offset });
    }

    const cdStart = w.length;
    for (const c of central) {
        w.u32(0x02014B50);
        w.u16(20); w.u16(20);
        w.u16(0x0800); w.u16(0);
        w.u16(time); w.u16(date);
        w.u32(c.crc); w.u32(c.size); w.u32(c.size);
        w.u16(c.name.length); w.u16(0); w.u16(0);
        w.u16(0); w.u16(0); w.u32(0);
        w.u32(c.offset);
        w.bytes(c.name);
    }
    const cdSize = w.length - cdStart;

    // End of central directory.
    w.u32(0x06054B50);
    w.u16(0); w.u16(0);
    w.u16(central.length); w.u16(central.length);
    w.u32(cdSize); w.u32(cdStart);
    w.u16(0);
    return w.join();
}

/**
 * Read a stored ZIP back — enough to round-trip what buildZip wrote, so a
 * test can prove the archive is well-formed without a library. Compressed
 * entries are refused, not decompressed.
 */
export function readZip(bytes: Uint8Array): ZipEntry[] {
    const dec = new TextDecoder();
    const u16 = (i: number) => bytes[i] | (bytes[i + 1] << 8);
    const u32 = (i: number) => (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) >>> 0;
    // Locate the end-of-central-directory record from the tail.
    let eocd = -1;
    for (let i = bytes.length - 22; i >= 0; i -= 1) { if (u32(i) === 0x06054B50) { eocd = i; break; } }
    if (eocd < 0) throw new Error('not a ZIP: no end-of-central-directory record');
    const count = u16(eocd + 10);
    let at = u32(eocd + 16);
    const out: ZipEntry[] = [];
    for (let n = 0; n < count; n += 1) {
        if (u32(at) !== 0x02014B50) throw new Error('corrupt central directory');
        const method = u16(at + 10);
        const crc = u32(at + 16);
        const size = u32(at + 20);
        const nameLen = u16(at + 28), extraLen = u16(at + 30), commentLen = u16(at + 32);
        const offset = u32(at + 42);
        const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen));
        if (method !== 0) throw new Error(`entry ${name} is compressed; only stored entries are read`);
        // Local header: skip to the data.
        const lNameLen = u16(offset + 26), lExtraLen = u16(offset + 28);
        const dataAt = offset + 30 + lNameLen + lExtraLen;
        const data = bytes.subarray(dataAt, dataAt + size);
        if (crc32(data) !== crc) throw new Error(`entry ${name} fails its CRC`);
        out.push({ name, text: dec.decode(data) });
        at += 46 + nameLen + extraLen + commentLen;
    }
    return out;
}
