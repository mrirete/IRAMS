/**
 * careRoutes — operator-care (TPM autonomous maintenance) route planning
 * (Phase F1). Groups the assets that WANT eyes on them — condition-based
 * strategy verdicts and assets with banded measurement points — by their
 * hierarchy parent, into walkable clean-inspect-lubricate route candidates.
 * The planner proposes; a human approves; the route becomes a recurring
 * programme like any other. Honest empty state until points exist.
 */
import type { StrategyVerdict } from './strategySelect';

export interface CareAssetRow {
    id: string;
    tag: string;
    name: string;
    parent_id: string | null;
    criticality: string | null;
}

export interface RouteCandidate {
    areaId: string;
    areaTag: string;
    areaName: string;
    assets: { id: string; tag: string; criticality: string | null; pointCount: number; cbmVerdict: boolean }[];
    pointCount: number;
    /** Weekly for routes containing criticality-A assets, else fortnightly. */
    suggestedIntervalDays: number;
}

export function planCareRoutes(
    assets: CareAssetRow[],
    verdicts: Pick<StrategyVerdict, 'assetId' | 'recommended'>[],
    pointCountByAsset: Map<string, number>,
): RouteCandidate[] {
    const byId = new Map(assets.map((a) => [a.id, a]));
    const cbmAssets = new Set(verdicts.filter((v) => v.recommended === 'condition_based').map((v) => v.assetId));

    // An asset belongs on a route if it is monitored or its strategy says it
    // should be watched.
    const routeAssets = assets.filter((a) => (pointCountByAsset.get(a.id) ?? 0) > 0 || cbmAssets.has(a.id));
    if (routeAssets.length === 0) return [];

    const byArea = new Map<string, CareAssetRow[]>();
    for (const a of routeAssets) {
        const areaId = a.parent_id && byId.has(a.parent_id) ? a.parent_id : '(unassigned)';
        (byArea.get(areaId) ?? byArea.set(areaId, []).get(areaId)!).push(a);
    }

    const routes: RouteCandidate[] = [];
    for (const [areaId, members] of byArea) {
        const area = byId.get(areaId);
        const rows = members
            .map((m) => ({
                id: m.id, tag: m.tag, criticality: m.criticality,
                pointCount: pointCountByAsset.get(m.id) ?? 0,
                cbmVerdict: cbmAssets.has(m.id),
            }))
            .sort((x, y) => ((x.criticality === 'A' ? 0 : 1) - (y.criticality === 'A' ? 0 : 1)) || x.tag.localeCompare(y.tag));
        const hasA = rows.some((r) => r.criticality === 'A');
        routes.push({
            areaId,
            areaTag: area?.tag ?? '(no parent)',
            areaName: area?.name ?? 'Assets without a hierarchy parent',
            assets: rows,
            pointCount: rows.reduce((s, r) => s + r.pointCount, 0),
            suggestedIntervalDays: hasA ? 7 : 14,
        });
    }
    routes.sort((a, b) => b.assets.length - a.assets.length);
    return routes;
}
