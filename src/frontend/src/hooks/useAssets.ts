import { useState, useMemo, useCallback } from 'react';
import type { Asset, AssetRegisterSummary, AssetTreeNode, CriticalityRank, AssetStatus, EquipmentClass, HierarchyNode, FailureEvent, ReliabilityKPI } from '../types/assets';
import { MOCK_ASSETS, INITIAL_HIERARCHY, MOCK_FAILURE_EVENTS } from '../mockData/assets';

// ═══════════════════════════════════════════════════════════════════════
//  SMRP KPI CALCULATORS
// ═══════════════════════════════════════════════════════════════════════

function calcReliabilityKPIs(assetId: string, events: FailureEvent[], runningHours: number): ReliabilityKPI[] {
    const assetEvents = events.filter(e => e.asset_id === assetId && !e.is_planned);
    const failures = assetEvents.length;
    const totalDowntime = assetEvents.reduce((s, e) => s + e.downtime_hours, 0);
    const totalCost = assetEvents.reduce((s, e) => s + e.cost, 0);

    // MTBF = Operating Hours / Number of Failures (SMRP 5.1.2)
    const mtbf = failures > 0 ? runningHours / failures : runningHours;
    // MTTR = Total Repair Time / Number of Failures (SMRP 5.1.3)
    const mttr = failures > 0 ? totalDowntime / failures : 0;
    // Availability = MTBF / (MTBF + MTTR) (SMRP 5.1.1)
    const availability = mtbf > 0 ? (mtbf / (mtbf + mttr)) * 100 : 100;
    // Planned Maintenance % (SMRP 5.5.4)
    const allEvents = events.filter(e => e.asset_id === assetId);
    const planned = allEvents.filter(e => e.is_planned).length;
    const pmp = allEvents.length > 0 ? (planned / allEvents.length) * 100 : 100;
    // Failure rate λ = 1/MTBF (per 1000 hours)
    const failureRate = mtbf > 0 ? (1000 / mtbf) : 0;

    const kpiStatus = (val: number, good: number, warn: number, higher: boolean): 'good' | 'warning' | 'critical' =>
        higher ? (val >= good ? 'good' : val >= warn ? 'warning' : 'critical') : (val <= good ? 'good' : val <= warn ? 'warning' : 'critical');

    return [
        { code: '5.1.1', name: 'Availability', value: Number(availability.toFixed(1)), target: 95, unit: '%', trend: availability >= 95 ? 'up' : 'down', status: kpiStatus(availability, 95, 85, true) },
        { code: '5.1.2', name: 'MTBF', value: Number((mtbf / 24).toFixed(0)), target: 180, unit: 'days', trend: mtbf / 24 >= 180 ? 'up' : 'down', status: kpiStatus(mtbf / 24, 180, 90, true) },
        { code: '5.1.3', name: 'MTTR', value: Number(mttr.toFixed(1)), target: 24, unit: 'hrs', trend: mttr <= 24 ? 'up' : 'down', status: kpiStatus(mttr, 24, 48, false) },
        { code: '5.5.4', name: 'Planned Maint. %', value: Number(pmp.toFixed(0)), target: 80, unit: '%', trend: pmp >= 80 ? 'up' : 'flat', status: kpiStatus(pmp, 80, 60, true) },
        { code: '5.3.1', name: 'Failure Rate', value: Number(failureRate.toFixed(2)), target: 1.0, unit: '/1000h', trend: failureRate <= 1.0 ? 'up' : 'down', status: kpiStatus(failureRate, 1.0, 3.0, false) },
        { code: '5.7.1', name: 'Maint. Cost', value: totalCost, target: 50000, unit: '$', trend: totalCost <= 50000 ? 'up' : 'down', status: kpiStatus(totalCost, 50000, 100000, false) },
    ];
}

// ═══════════════════════════════════════════════════════════════════════
//  COMPUTED SUMMARIES
// ═══════════════════════════════════════════════════════════════════════

function computeSummary(assets: Asset[]): AssetRegisterSummary {
    const equipmentLevel = assets.filter(a => a.taxonomy_level === 'equipment');
    return {
        total_assets: equipmentLevel.length,
        operating_count: equipmentLevel.filter(a => a.status === 'operating').length,
        maintenance_count: equipmentLevel.filter(a => a.status === 'under_maintenance').length,
        crit_a_count: equipmentLevel.filter(a => a.criticality === 'A').length,
        crit_b_count: equipmentLevel.filter(a => a.criticality === 'B').length,
        crit_c_count: equipmentLevel.filter(a => a.criticality === 'C').length,
        crit_d_count: equipmentLevel.filter(a => a.criticality === 'D').length,
        crit_e_count: equipmentLevel.filter(a => a.criticality === 'E').length,
        avg_health: +(equipmentLevel.reduce((s, a) => s + a.health_index, 0) / (equipmentLevel.length || 1)).toFixed(1),
        overdue_pm_count: 3,
        total_replacement_value: 48_500_000,
    };
}

// ═══════════════════════════════════════════════════════════════════════
//  HIERARCHY TREE BUILDER
// ═══════════════════════════════════════════════════════════════════════

function buildTree(assets: Asset[]): AssetTreeNode[] {
    const children = assets.filter(a => a.parent_id?.startsWith('ast-'));
    const roots = assets.filter(a => !a.parent_id?.startsWith('ast-'));
    const toNode = (a: Asset): AssetTreeNode => ({
        id: a.id, tag: a.tag, name: a.name, taxonomy_level: a.taxonomy_level,
        criticality: a.criticality, status: a.status, health_index: a.health_index,
        children: children.filter(c => c.parent_id === a.id).map(toNode),
    });
    return roots.map(toNode);
}

// ═══════════════════════════════════════════════════════════════════════
//  HOOK
// ═══════════════════════════════════════════════════════════════════════

export type SortField = 'tag' | 'name' | 'criticality' | 'health_index' | 'status' | 'running_hours' | 'cost_ytd' | 'failure_count_ytd';
export type SortDir = 'asc' | 'desc';

export interface AssetFilters {
    search: string;
    criticality: CriticalityRank | 'all';
    status: AssetStatus | 'all';
    equipment_class: EquipmentClass | 'all';
    site: string;
    taxonomyLevel: 'equipment' | 'all';
}

const DEFAULT_FILTERS: AssetFilters = {
    search: '', criticality: 'all', status: 'all', equipment_class: 'all', site: 'all', taxonomyLevel: 'equipment',
};

export function useAssets() {
    const [assets, setAssets] = useState<Asset[]>(MOCK_ASSETS);
    const [hierarchyNodes, setHierarchyNodes] = useState<HierarchyNode[]>(INITIAL_HIERARCHY);
    const [failureEvents, setFailureEvents] = useState<FailureEvent[]>(MOCK_FAILURE_EVENTS);
    const [filters, setFilters] = useState<AssetFilters>(DEFAULT_FILTERS);
    const [sortField, setSortField] = useState<SortField>('tag');
    const [sortDir, setSortDir] = useState<SortDir>('asc');
    const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);

    const summary = useMemo(() => computeSummary(assets), [assets]);
    const tree = useMemo(() => buildTree(assets), [assets]);
    const sites = useMemo(() => [...new Set(assets.map(a => a.site))], [assets]);

    // Dynamic lists derived from hierarchy
    const hierarchySites = useMemo(() => hierarchyNodes.filter(n => n.level === 'site'), [hierarchyNodes]);
    const hierarchyUnits = useMemo(() => hierarchyNodes.filter(n => n.level === 'unit'), [hierarchyNodes]);
    const hierarchySystems = useMemo(() => hierarchyNodes.filter(n => n.level === 'system'), [hierarchyNodes]);

    const filteredAssets = useMemo(() => {
        let list = [...assets];
        const { search, criticality, status, equipment_class, site, taxonomyLevel } = filters;
        if (taxonomyLevel !== 'all') list = list.filter(a => a.taxonomy_level === taxonomyLevel);
        if (search) {
            const q = search.toLowerCase();
            list = list.filter(a => a.tag.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q) || a.manufacturer.toLowerCase().includes(q));
        }
        if (criticality !== 'all') list = list.filter(a => a.criticality === criticality);
        if (status !== 'all') list = list.filter(a => a.status === status);
        if (equipment_class !== 'all') list = list.filter(a => a.equipment_class === equipment_class);
        if (site !== 'all') list = list.filter(a => a.site === site);

        list.sort((a, b) => {
            const av = a[sortField]; const bv = b[sortField];
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
            return sortDir === 'asc' ? cmp : -cmp;
        });
        return list;
    }, [assets, filters, sortField, sortDir]);

    const selectedAsset = useMemo(() => assets.find(a => a.id === selectedAssetId) || null, [assets, selectedAssetId]);

    const toggleSort = useCallback((field: SortField) => {
        if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortField(field); setSortDir('asc'); }
    }, [sortField]);

    const updateFilter = useCallback(<K extends keyof AssetFilters>(key: K, val: AssetFilters[K]) => {
        setFilters(f => ({ ...f, [key]: val }));
    }, []);

    const resetFilters = useCallback(() => setFilters(DEFAULT_FILTERS), []);

    // ── Mutators ──
    const addAsset = useCallback((asset: Asset) => {
        setAssets(prev => [asset, ...prev]);
    }, []);

    const updateAsset = useCallback((id: string, changes: Partial<Asset>) => {
        setAssets(prev => prev.map(a => a.id === id ? { ...a, ...changes } : a));
    }, []);

    const deleteAsset = useCallback((id: string) => {
        setAssets(prev => prev.filter(a => a.id !== id));
        // Clear selection if the deleted asset was selected
        setSelectedAssetId(prev => prev === id ? null : prev);
    }, []);

    const addHierarchyNode = useCallback((node: HierarchyNode) => {
        setHierarchyNodes(prev => [...prev, node]);
    }, []);

    const updateHierarchyNode = useCallback((id: string, changes: Partial<HierarchyNode>) => {
        setHierarchyNodes(prev => prev.map(n => n.id === id ? { ...n, ...changes } : n));
    }, []);

    // ── Failure Event Mutators ──
    const addFailureEvent = useCallback((event: FailureEvent) => {
        setFailureEvents(prev => [event, ...prev]);
    }, []);

    const getAssetFailures = useCallback((assetId: string) => {
        return failureEvents.filter(e => e.asset_id === assetId)
            .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
    }, [failureEvents]);

    const getAssetKPIs = useCallback((assetId: string, runningHours: number): ReliabilityKPI[] => {
        return calcReliabilityKPIs(assetId, failureEvents, runningHours);
    }, [failureEvents]);

    return {
        assets: filteredAssets,
        allAssets: assets,
        summary,
        tree,
        sites,
        hierarchyNodes,
        hierarchySites,
        hierarchyUnits,
        hierarchySystems,
        filters,
        updateFilter,
        resetFilters,
        sortField,
        sortDir,
        toggleSort,
        selectedAsset,
        selectAsset: setSelectedAssetId,
        addAsset,
        updateAsset,
        deleteAsset,
        addHierarchyNode,
        updateHierarchyNode,
        failureEvents,
        addFailureEvent,
        getAssetFailures,
        getAssetKPIs,
    };
}
