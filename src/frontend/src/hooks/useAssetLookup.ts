import { useMemo } from 'react';
import { useAssets } from './useAssets';
import { useAssetContext } from '../contexts/AssetContext';
import type { CriticalityRank } from '../types/assets';

// ═══════════════════════════════════════════════════════════════════════
//  Shared Asset Lookup — single source of truth for all modules
//
//  Priority: AssetContext (real Supabase UUIDs) → useAssets (mock fallback)
// ═══════════════════════════════════════════════════════════════════════

export interface AssetOption {
    id: string;
    tag: string;
    name: string;
    criticality: CriticalityRank;
    site: string;
    system: string;
}

/**
 * Lightweight hook that provides asset options for dropdowns and
 * a name-lookup function. Prefers real Supabase data from AssetContext;
 * falls back to mock data from useAssets when context is empty.
 */
export function useAssetLookup() {
    const { assets: supabaseAssets, assetMap, loading } = useAssetContext();
    const { allAssets: mockAssets } = useAssets();

    // While AssetContext is loading, return empty — don't fall back to mocks yet
    // Once loaded, prefer Supabase; only fall back to mocks if Supabase is empty
    const allAssets = loading ? [] : (supabaseAssets.length > 0 ? supabaseAssets : mockAssets);

    /** Only maintainable items (equipment + subunit + component) shown in dropdowns */
    const assetOptions: AssetOption[] = useMemo(
        () => allAssets
            .filter(a => a.taxonomy_level === 'equipment' || a.taxonomy_level === 'subunit' || a.taxonomy_level === 'component')
            .map(a => ({
                id: a.id,
                tag: a.tag,
                name: a.name,
                criticality: a.criticality,
                site: a.site,
                system: a.system,
            }))
            .sort((a, b) => a.tag.localeCompare(b.tag)),
        [allAssets],
    );

    /** Quick name resolver — returns tag + name or raw ID */
    const getAssetName = useMemo(
        () => (id: string): string => {
            // O(1) lookup via AssetContext map first
            const fromMap = assetMap.get(id);
            if (fromMap) return `${fromMap.tag} — ${fromMap.name}`;
            // Fallback to linear search
            const a = allAssets.find(a => a.id === id);
            return a ? `${a.tag} — ${a.name}` : id;
        },
        [allAssets, assetMap],
    );

    /** Get full asset by ID */
    const getAssetById = useMemo(
        () => (id: string) => assetMap.get(id) ?? allAssets.find(a => a.id === id) ?? null,
        [allAssets, assetMap],
    );

    return { assetOptions, getAssetName, getAssetById, loading };
}
