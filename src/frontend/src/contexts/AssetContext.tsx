/**
 * AssetProvider — Shared React context supplying real Supabase assets
 * to both EAM and ERS modules.
 *
 * Fetches from DatabaseService.getAssets() on mount, caches the list,
 * and exposes a lookup map + refresh trigger. All hooks (useAssets,
 * useAssetLookup, useIntelligence, useIntegrity, useStrategy) can
 * consume this instead of importing MOCK_ASSETS.
 */
import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { DatabaseService } from '../eam/services/DatabaseService';
import type { Asset } from '../types/assets';

// ─── Supabase → ERS Asset mapper ─────────────────────────────
// DatabaseService.getAssets() returns camelCase objects; we map to the
// strongly-typed Asset shape expected by all ERS hooks.
function mapDbRowToAsset(row: any): Asset {
    return {
        id: row.id,
        tag: row.tag ?? '',
        name: row.name ?? '',
        description: row.description ?? '',
        parent_id: row.parentId ?? null,

        // Location & hierarchy
        site: '',
        unit: '',
        system: '',
        functional_location: '',

        // Classification — ISO 14224
        taxonomy_level: mapHierarchyLevel(row.category),
        equipment_type: 'mechanical',
        equipment_class: mapEquipmentClass(row.model),
        equipment_category: row.model ?? '',
        criticality: row.criticality ?? 'C',
        criticality_method: 'manual',
        status: mapStatus(row.status),
        maintenance_strategy: 'not_assigned',

        // Condition & Performance
        condition_rating: 3,
        health_index: row.healthScore ?? 85,
        rul_days: null,
        risk_priority: { rpn: 0, consequence: 1, probability: 1, detectability: 1 },

        // Operational
        running_hours: 0,
        mtbf_days: null,
        mttr_hours: null,
        failure_count_ytd: 0,
        wo_count_ytd: 0,
        cost_ytd: 0,

        // Dates
        install_date: '',
        warranty_expiry: null,
        last_overhaul: null,

        // Metadata
        manufacturer: row.manufacturer ?? '',
        model: row.model ?? '',
        serial_number: row.serialNumber ?? '',

        // Children
        children_count: 0,
    };
}

function mapHierarchyLevel(category: string | undefined): Asset['taxonomy_level'] {
    if (!category) return 'equipment';
    const lower = category.toLowerCase();
    if (lower === 'site') return 'site';
    if (lower === 'unit' || lower === 'area') return 'unit';
    if (lower === 'system') return 'system';
    if (lower === 'subunit' || lower === 'component') return 'subunit';
    return 'equipment';
}

function mapEquipmentClass(model: string | undefined): Asset['equipment_class'] {
    if (!model) return 'rotating';
    const lower = model.toLowerCase();
    if (lower.includes('pump') || lower.includes('compressor') || lower.includes('turbine') || lower.includes('motor') || lower.includes('fan')) return 'rotating';
    if (lower.includes('vessel') || lower.includes('tank') || lower.includes('exchanger') || lower.includes('column') || lower.includes('drum') || lower.includes('separator')) return 'static_pressure';
    if (lower.includes('valve') || lower.includes('pipe') || lower.includes('flange')) return 'piping';
    if (lower.includes('instrument') || lower.includes('sensor') || lower.includes('transmitter') || lower.includes('analyzer')) return 'instrument';
    if (lower.includes('switch') || lower.includes('transformer') || lower.includes('breaker') || lower.includes('generator')) return 'electrical';
    if (lower.includes('safety') || lower.includes('psd') || lower.includes('esdv')) return 'safety';
    return 'rotating';
}

function mapStatus(status: string | undefined): Asset['status'] {
    if (!status) return 'operating';
    const lower = status.toLowerCase();
    if (lower.includes('maint')) return 'under_maintenance';
    if (lower.includes('standby')) return 'standby';
    if (lower.includes('decom') || lower.includes('retired')) return 'decommissioned';
    if (lower.includes('moth')) return 'mothballed';
    return 'operating';
}

// ─── Context Type ────────────────────────────────────────────
interface AssetContextType {
    /** All assets loaded from Supabase */
    assets: Asset[];
    /** Map of asset ID → Asset for O(1) lookup */
    assetMap: Map<string, Asset>;
    /** Whether initial load is in progress */
    loading: boolean;
    /** Any error from the fetch */
    error: string | null;
    /** Force re-fetch from Supabase */
    refresh: () => Promise<void>;
}

const AssetContext = createContext<AssetContextType>({
    assets: [],
    assetMap: new Map(),
    loading: true,
    error: null,
    refresh: async () => { },
});

export const useAssetContext = () => useContext(AssetContext);

// ─── Provider ────────────────────────────────────────────────
export function AssetProvider({ children }: { children: React.ReactNode }) {
    const [assets, setAssets] = useState<Asset[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchAssets = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const db = DatabaseService.getInstance();
            const rows = await db.getAssets();
            const mapped = rows.map(mapDbRowToAsset);

            // ── Enrich with hierarchy context (site / unit / system) ──
            // Build a quick lookup map by ID
            const byId = new Map<string, Asset>();
            for (const a of mapped) byId.set(a.id, a);

            // Walk each asset's parent chain to populate site, unit, system
            for (const asset of mapped) {
                let cursor: Asset | undefined = asset;
                const visited = new Set<string>();
                while (cursor?.parent_id && !visited.has(cursor.parent_id)) {
                    visited.add(cursor.parent_id);
                    const parent = byId.get(cursor.parent_id);
                    if (!parent) break;
                    if (parent.taxonomy_level === 'site' && !asset.site) {
                        asset.site = parent.name;
                    } else if (parent.taxonomy_level === 'unit' && !asset.unit) {
                        asset.unit = parent.name;
                    } else if (parent.taxonomy_level === 'system' && !asset.system) {
                        asset.system = parent.name;
                    }
                    cursor = parent;
                }
            }

            console.log(`[AssetProvider] Loaded ${mapped.length} assets from Supabase`);
            setAssets(mapped);
        } catch (e: any) {
            console.error('[AssetProvider] Failed to load assets:', e);
            setError(e?.message || 'Failed to load assets');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchAssets();
    }, [fetchAssets]);

    const assetMap = useMemo(() => {
        const m = new Map<string, Asset>();
        for (const a of assets) m.set(a.id, a);
        return m;
    }, [assets]);

    const value = useMemo(
        () => ({ assets, assetMap, loading, error, refresh: fetchAssets }),
        [assets, assetMap, loading, error, fetchAssets],
    );

    return <AssetContext.Provider value={value}>{children}</AssetContext.Provider>;
}
