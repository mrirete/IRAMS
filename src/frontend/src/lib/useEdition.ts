/**
 * useEdition — the tenant's product edition (packaging ruling, strategy §5.2):
 *   'platform'   — full IREAMS (EAM + Reliability suite + Specialist)
 *   'specialist' — Specialist-only: EAM navigation hidden, workspace is home.
 *
 * Single-tenant deployment model (0173): the edition lives on the first active
 * company row (companies.edition, 0219). Cached at module level — one query
 * per session; defaults to 'platform' before load or if the column is absent,
 * so the app degrades gracefully pre-migration.
 */
import { useEffect, useState } from 'react';
import { supabase } from '../eam/lib/supabase';

export type Edition = 'platform' | 'specialist';

let cached: Edition | null = null;
let inflight: Promise<Edition> | null = null;

async function fetchEdition(): Promise<Edition> {
    try {
        const { data, error } = await supabase
            .from('companies')
            .select('edition')
            .eq('active', true)
            .order('created_at', { ascending: true })
            .limit(1);
        if (error) return 'platform';
        const e = data?.[0]?.edition;
        return e === 'specialist' ? 'specialist' : 'platform';
    } catch {
        return 'platform';
    }
}

export function useEdition(): { edition: Edition; loaded: boolean } {
    const [edition, setEdition] = useState<Edition>(cached ?? 'platform');
    const [loaded, setLoaded] = useState(cached !== null);

    useEffect(() => {
        if (cached !== null) return;
        inflight = inflight ?? fetchEdition();
        let alive = true;
        void inflight.then((e) => {
            cached = e;
            if (alive) { setEdition(e); setLoaded(true); }
        });
        return () => { alive = false; };
    }, []);

    return { edition, loaded };
}

/** Test/admin hook: clear the cache after changing the edition. */
export function resetEditionCache(): void {
    cached = null;
    inflight = null;
}
