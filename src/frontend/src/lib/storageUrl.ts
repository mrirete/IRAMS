// Signed-URL resolution for private storage buckets (0235).
//
// The buckets went private, so there is no longer any such thing as a stable
// URL for an object: `createSignedUrl` mints a token that expires. That means
// a signed URL must NEVER be written back to a column — what gets persisted is
// the `bucket/path` reference, and the URL is minted at render time.
//
// Columns still hold a mix of forms, because 0235 only rewrote scalar columns
// and left URLs embedded in JSONB and text[] (jsa_assessments.signoffs,
// audit_findings.evidence_attachments, job_tasks procedure media) to be
// normalised here instead. So every entry point tolerates:
//
//   assets/asset_123_ab.jpg                      → the post-0235 form; sign it
//   https://<ref>.supabase.co/.../public/assets/x → legacy; strip, then sign
//   https://<ref>.supabase.co/.../sign/assets/x   → already signed; pass through
//   data:image/png;base64,...                     → inline; pass through
//   https://example.com/logo.png                  → third-party; pass through
//
// Anything unrecognised passes through unchanged rather than throwing, so a
// stray value can never blank out a page.

import { supabase } from '../eam/lib/supabase';

/** Buckets this app owns. A leading segment outside this set is not a ref. */
export const STORAGE_BUCKETS = ['avatars', 'assets', 'pid-diagrams', 'work-order-docs'] as const;
export type StorageBucket = (typeof STORAGE_BUCKETS)[number];

/** Signed-URL lifetime requested from Supabase. */
const SIGN_TTL_SECONDS = 60 * 60;

/**
 * How long we reuse a minted URL. Deliberately shorter than SIGN_TTL_SECONDS:
 * a URL handed out at the very end of the window would expire mid-render
 * (or mid-print, for a report), so we re-sign with five minutes to spare.
 */
const CACHE_TTL_MS = (SIGN_TTL_SECONDS - 300) * 1000;

const cache = new Map<string, { url: string; expiresAt: number }>();

/** Requests already in flight, so a list of 50 rows signs each path once. */
const inflight = new Map<string, Promise<string | null>>();

export interface StorageRef {
    bucket: StorageBucket;
    path: string;
}

/**
 * The caller's tenant, read from the access token's app_metadata claim — the
 * same value `public.caller_company()` sees server-side (0258).
 *
 * Objects are keyed `<company_id>/<file>` because storage is shared across
 * tenants; 0281's INSERT policy REFUSES a write to the bucket root, so a
 * missing claim must fail loudly here rather than produce an object only the
 * origin tenant can read.
 */
export async function callerCompanyId(): Promise<string> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('Not signed in — cannot upload.');
    try {
        const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        const company = payload?.app_metadata?.company_id;
        if (company) return String(company);
    } catch {
        /* fall through to the explicit error below */
    }
    // Claim absent: the custom_access_token_hook did not run, or the user row
    // carries no company. Uploading anyway would 403 at the storage policy.
    throw new Error('No tenant on this session — sign out and back in, then retry the upload.');
}

/**
 * Reduce any stored value to a {bucket, path} pair, or null when the value is
 * not something we should sign (data URI, external link, already-signed URL,
 * empty).
 */
export function parseStorageRef(value: string | null | undefined): StorageRef | null {
    if (!value) return null;
    const raw = value.trim();
    if (!raw) return null;

    // Inline payloads and already-signed URLs are final — never re-sign.
    if (raw.startsWith('data:') || raw.startsWith('blob:')) return null;
    if (/\/storage\/v1\/object\/sign\//.test(raw)) return null;

    // Legacy public URL → keep only what follows `/public/`.
    const publicMatch = raw.match(/\/storage\/v1\/object\/public\/(.+)$/);
    const candidate = publicMatch ? publicMatch[1] : raw;

    // Any other absolute URL belongs to somebody else.
    if (/^https?:\/\//i.test(candidate)) return null;

    const clean = candidate.replace(/^\/+/, '').split('?')[0];
    const slash = clean.indexOf('/');
    if (slash <= 0) return null;

    const bucket = clean.slice(0, slash);
    const path = clean.slice(slash + 1);
    if (!path) return null;
    if (!(STORAGE_BUCKETS as readonly string[]).includes(bucket)) return null;

    return { bucket: bucket as StorageBucket, path: decodeURIComponent(path) };
}

function cacheKey(ref: StorageRef): string {
    return `${ref.bucket}/${ref.path}`;
}

function readCache(key: string): string | null {
    const hit = cache.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
        cache.delete(key);
        return null;
    }
    return hit.url;
}

/**
 * Resolve one stored value to something an <img src> can use.
 *
 * Returns the input unchanged when it is not a storage reference (data URI,
 * external URL), null when the value is empty, and a freshly signed URL
 * otherwise. Never throws — a signing failure resolves to null so the caller
 * can fall back to a placeholder.
 */
export async function resolveStorageUrl(value: string | null | undefined): Promise<string | null> {
    if (!value) return null;
    const ref = parseStorageRef(value);
    if (!ref) return value; // data:, blob:, external, or already signed

    const key = cacheKey(ref);
    const cached = readCache(key);
    if (cached) return cached;

    const existing = inflight.get(key);
    if (existing) return existing;

    const pending = (async () => {
        try {
            const { data, error } = await supabase.storage
                .from(ref.bucket)
                .createSignedUrl(ref.path, SIGN_TTL_SECONDS);
            if (error || !data?.signedUrl) {
                console.warn('[storageUrl] failed to sign', key, error?.message);
                return null;
            }
            cache.set(key, { url: data.signedUrl, expiresAt: Date.now() + CACHE_TTL_MS });
            return data.signedUrl;
        } catch (err) {
            console.warn('[storageUrl] failed to sign', key, err);
            return null;
        } finally {
            inflight.delete(key);
        }
    })();

    inflight.set(key, pending);
    return pending;
}

/**
 * Batch form. A 50-row asset table must not fire 50 signing round-trips, so
 * paths are grouped per bucket and signed with one call each.
 *
 * Returns a map keyed by the ORIGINAL input value, so callers can look up
 * whatever string they already hold without re-parsing.
 */
export async function resolveStorageUrls(
    values: (string | null | undefined)[],
): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const byBucket = new Map<StorageBucket, Map<string, string[]>>(); // bucket → path → original values

    for (const value of values) {
        if (!value) continue;
        const ref = parseStorageRef(value);
        if (!ref) {
            out.set(value, value); // pass-through values resolve to themselves
            continue;
        }
        const key = cacheKey(ref);
        const cached = readCache(key);
        if (cached) {
            out.set(value, cached);
            continue;
        }
        let paths = byBucket.get(ref.bucket);
        if (!paths) {
            paths = new Map();
            byBucket.set(ref.bucket, paths);
        }
        const originals = paths.get(ref.path) ?? [];
        originals.push(value);
        paths.set(ref.path, originals);
    }

    await Promise.all(
        [...byBucket.entries()].map(async ([bucket, paths]) => {
            const list = [...paths.keys()];
            if (!list.length) return;
            try {
                const { data, error } = await supabase.storage
                    .from(bucket)
                    .createSignedUrls(list, SIGN_TTL_SECONDS);
                if (error || !data) {
                    console.warn('[storageUrl] batch sign failed', bucket, error?.message);
                    return;
                }
                for (const entry of data) {
                    // `path` echoes back what we asked for; signedUrl is null per-row on failure.
                    if (!entry?.path || !entry.signedUrl) continue;
                    cache.set(`${bucket}/${entry.path}`, {
                        url: entry.signedUrl,
                        expiresAt: Date.now() + CACHE_TTL_MS,
                    });
                    for (const original of paths.get(entry.path) ?? []) {
                        out.set(original, entry.signedUrl);
                    }
                }
            } catch (err) {
                console.warn('[storageUrl] batch sign failed', bucket, err);
            }
        }),
    );

    return out;
}

/**
 * Open a stored object in a new tab (download / view links).
 *
 * Signing is async, so the popup blocker is the real constraint here: opening
 * the window AFTER an await counts as a non-user-gesture open and gets
 * blocked. We therefore open a blank tab synchronously on the click and only
 * then point it at the signed URL.
 */
export async function openStorageRef(value: string | null | undefined): Promise<void> {
    if (!value) return;
    const win = window.open('', '_blank', 'noopener,noreferrer');
    const url = await resolveStorageUrl(value);
    if (!url) {
        win?.close();
        console.warn('[storageUrl] could not open', value);
        return;
    }
    if (win) {
        win.location.href = url;
    } else {
        // Popup blocked anyway — fall back to same-tab navigation.
        window.location.href = url;
    }
}

/**
 * Drop a cached URL — call after replacing the object behind a path, so the
 * stale image does not linger for the rest of the hour.
 */
export function invalidateStorageUrl(value: string | null | undefined): void {
    const ref = parseStorageRef(value);
    if (ref) cache.delete(cacheKey(ref));
}
