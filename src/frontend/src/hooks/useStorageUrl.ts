// React bindings for signed storage URLs (0235).
//
// DEPENDENCY DISCIPLINE: every effect below keys off a JOINED STRING, never an
// array or object identity. A caller that passes `items.map(i => i.image)`
// hands us a fresh array on every render, so an array-identity dep would
// re-run the effect forever — the same unstable-deps loop that once starved
// Suspense retries and hung the app on a spinner. Keep the string keys.

import { useEffect, useRef, useState } from 'react';
import { resolveStorageUrl, resolveStorageUrls } from '../lib/storageUrl';

/**
 * Resolve a single stored value to a displayable URL.
 *
 * `loading` is true only while a signature is genuinely in flight; values that
 * need no signing (data URIs, external links) resolve synchronously on the
 * first render so they never flash.
 */
export function useStorageUrl(value: string | null | undefined): {
    url: string | null;
    loading: boolean;
} {
    const [url, setUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState<boolean>(!!value);

    useEffect(() => {
        let cancelled = false;
        if (!value) {
            setUrl(null);
            setLoading(false);
            return;
        }
        setLoading(true);
        resolveStorageUrl(value)
            .then(resolved => {
                if (cancelled) return;
                setUrl(resolved);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [value]);

    return { url, loading };
}

/**
 * Batch form for lists. Pass every stored value on the page; get back a lookup
 * keyed by the ORIGINAL value, so a row renders with
 * `urls.get(row.image) ?? undefined`.
 *
 * One signing round-trip per bucket, not per row.
 */
export function useStorageUrls(values: (string | null | undefined)[]): {
    urls: Map<string, string>;
    loading: boolean;
} {
    // Recomputed every render on purpose: it is cheap, and the RESULT is a
    // primitive, so the effect below re-runs only when the set of values
    // actually changes — not when the caller hands us a new array identity.
    // Memoising on [values] would defeat that. See the note at the top.
    const key = values.filter(Boolean).sort().join('|');
    const [urls, setUrls] = useState<Map<string, string>>(() => new Map());
    const [loading, setLoading] = useState(false);
    const latest = useRef(0);

    useEffect(() => {
        if (!key) {
            setUrls(new Map());
            setLoading(false);
            return;
        }
        const token = ++latest.current;
        setLoading(true);
        resolveStorageUrls(key.split('|'))
            .then(resolved => {
                // Ignore a slow response that a newer request has superseded.
                if (token !== latest.current) return;
                setUrls(resolved);
            })
            .finally(() => {
                if (token === latest.current) setLoading(false);
            });
    }, [key]);

    return { urls, loading };
}
