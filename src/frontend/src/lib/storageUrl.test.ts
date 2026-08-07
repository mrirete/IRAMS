/**
 * storageUrl — what may be signed, and what must never be touched.
 *
 * This resolver sits in front of every image and document in the product, so
 * its failure modes are asymmetric:
 *
 *   · treat a signable ref as un-signable → a broken image (visible, annoying)
 *   · treat an EXTERNAL url as signable   → a broken image AND a pointless
 *                                           round-trip against a bucket that
 *                                           does not hold the object
 *   · re-sign an already-signed url       → double-signed garbage
 *
 * Columns hold four shapes at once after 0281 (it only rewrote scalar columns;
 * URLs inside JSONB and text[] normalise here at read time), so the parser is
 * the only thing standing between those shapes and a signing call.
 *
 * Supabase is mocked at the client boundary — these are pure-parsing tests.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../eam/lib/supabase', () => ({
    supabase: {
        storage: { from: () => ({ createSignedUrl: vi.fn(), createSignedUrls: vi.fn() }) },
        auth: { getSession: vi.fn() },
    },
}));

const { parseStorageRef, STORAGE_BUCKETS } = await import('./storageUrl');

describe('parseStorageRef', () => {
    it('reads the post-0281 bucket/company/file form', () => {
        const ref = parseStorageRef('assets/8b1f0c4e-0000-4000-8000-000000000001/asset_1_ab.jpg');
        expect(ref).toEqual({
            bucket: 'assets',
            path: '8b1f0c4e-0000-4000-8000-000000000001/asset_1_ab.jpg',
        });
    });

    it('keeps the whole tenant path, not just the file name', () => {
        // Regression guard: an early version split on the LAST slash, which
        // silently dropped the tenant folder and produced a 404 for every
        // object uploaded after 0281.
        const ref = parseStorageRef('work-order-docs/tenant-a/sub/dir/report.pdf');
        expect(ref?.path).toBe('tenant-a/sub/dir/report.pdf');
    });

    it('strips a legacy public URL down to bucket and path', () => {
        const ref = parseStorageRef(
            'https://hacrebcfvyqdnjvilhqc.supabase.co/storage/v1/object/public/pid-diagrams/pid_17_x.png',
        );
        expect(ref).toEqual({ bucket: 'pid-diagrams', path: 'pid_17_x.png' });
    });

    it('is project-ref agnostic, so every tenant project parses alike', () => {
        const a = parseStorageRef('https://aaaa.supabase.co/storage/v1/object/public/avatars/x.jpg');
        const b = parseStorageRef('https://bbbb.supabase.co/storage/v1/object/public/avatars/x.jpg');
        expect(a).toEqual(b);
    });

    it('refuses to re-sign an already-signed URL', () => {
        expect(
            parseStorageRef('https://x.supabase.co/storage/v1/object/sign/assets/a.jpg?token=abc'),
        ).toBeNull();
    });

    it('passes inline payloads through untouched', () => {
        expect(parseStorageRef('data:image/png;base64,iVBORw0KGgo=')).toBeNull();
        expect(parseStorageRef('blob:http://localhost:5173/9f8e')).toBeNull();
    });

    it('passes third-party URLs through untouched', () => {
        expect(parseStorageRef('https://example.com/logo.png')).toBeNull();
    });

    it('rejects a path whose first segment is not one of our buckets', () => {
        // Otherwise a stray value like "notes/todo.txt" would fire a signing
        // call against a bucket that does not exist.
        expect(parseStorageRef('notes/todo.txt')).toBeNull();
    });

    it('rejects empty, whitespace and bucket-only values', () => {
        expect(parseStorageRef(null)).toBeNull();
        expect(parseStorageRef(undefined)).toBeNull();
        expect(parseStorageRef('')).toBeNull();
        expect(parseStorageRef('   ')).toBeNull();
        expect(parseStorageRef('assets')).toBeNull();
        expect(parseStorageRef('assets/')).toBeNull();
    });

    it('tolerates a leading slash and a query string', () => {
        const ref = parseStorageRef('/assets/tenant-a/photo.jpg?width=64');
        expect(ref).toEqual({ bucket: 'assets', path: 'tenant-a/photo.jpg' });
    });

    it('decodes percent-encoded object names', () => {
        const ref = parseStorageRef('work-order-docs/tenant-a/wo_doc_1_Pump%20Report.pdf');
        expect(ref?.path).toBe('tenant-a/wo_doc_1_Pump Report.pdf');
    });

    it('covers every bucket the app writes to', () => {
        for (const bucket of STORAGE_BUCKETS) {
            expect(parseStorageRef(`${bucket}/tenant-a/f.bin`)?.bucket).toBe(bucket);
        }
    });
});
