/**
 * WhereItSits — the selected asset's own chain in the register, site down to
 * the asset, each level with its health where one exists.
 *
 * Replaces the plant-wide "Systems & units" list on the asset view: that list
 * showed the six weakest systems anywhere, the same on every asset, and read
 * as if it were this asset's location. The plant-wide list stays on the
 * chooser, titled "Weakest systems".
 */
import React from 'react';
import { MapPin } from 'lucide-react';
import type { RollupNode } from '../../lib/predict/rollup';
import type { FleetAssetHealth } from '../../types/intelligence';

export interface LineageNode {
    id: string;
    tag: string;
    /** Blank when the register has no name — shown as "<tag> · no name in register". */
    name: string;
    /** ISO 14224 level, lower-case: site, unit, system, equipment, subunit, component… */
    level: string;
    health: number | null;
    current: boolean;
}

interface RegisterRow {
    id: string;
    tag?: string | null;
    name?: string | null;
    parent_id?: string | null;
    parentId?: string | null;
    taxonomy_level?: string | null;
    hierarchyLevel?: string | null;
    register_level?: string | null;
}

/** Walk parent links from the asset to the top. Health: roll-up for structural levels, twin/fleet for equipment. */
export function buildLineage(
    assetId: string,
    register: RegisterRow[],
    rollups: RollupNode[],
    fleet: FleetAssetHealth[],
    currentHealth: number | null,
): LineageNode[] {
    if (!assetId) return [];
    const byId = new Map(register.map(a => [a.id, a]));
    const roll = new Map(rollups.map(r => [r.id, r.health]));
    const fleetHi = new Map(fleet.map(f => [f.asset_id, f.health_index]));
    const chain: LineageNode[] = [];
    const seen = new Set<string>();
    let cur = byId.get(assetId);
    while (cur && !seen.has(cur.id) && chain.length < 12) {
        seen.add(cur.id);
        const isCurrent = cur.id === assetId;
        chain.unshift({
            id: cur.id,
            tag: cur.tag || '',
            name: (cur.name || '').trim(),
            level: String(cur.register_level ?? cur.hierarchyLevel ?? cur.taxonomy_level ?? '').toLowerCase(),
            health: isCurrent && currentHealth != null ? currentHealth : (roll.get(cur.id) ?? fleetHi.get(cur.id) ?? null),
            current: isCurrent,
        });
        const parent = cur.parent_id ?? cur.parentId;
        cur = parent ? byId.get(parent) : undefined;
    }
    return chain;
}

/** The nearest system (else unit) above the asset, and its weakest monitored item when that is not the asset itself. */
export function weakestNearby(lineage: LineageNode[], rollups: RollupNode[]) {
    const above = lineage.filter(n => !n.current).reverse();
    const scope = above.find(n => n.level === 'system') ?? above.find(n => n.level === 'unit');
    if (!scope) return null;
    const node = rollups.find(r => r.id === scope.id);
    const current = lineage.find(n => n.current);
    if (!node?.worst || node.worst.id === current?.id) return null;
    return { scope: displayName(scope), id: node.worst.id, name: node.worst.name, health: node.worst.health };
}

const displayName = (n: LineageNode) => n.name || (n.tag ? `${n.tag} · no name in register` : `${n.level || 'item'} · no name in register`);
const STUDYABLE = new Set(['equipment', 'subunit', 'component', 'maintainable_item', 'part']);
const tone = (h: number) => (h >= 80 ? 'text-emerald-600' : h >= 60 ? 'text-amber-500' : 'text-red-500');
const dot = (h: number | null) => (h == null ? 'bg-slate-200' : h >= 80 ? 'bg-emerald-500' : h >= 60 ? 'bg-amber-400' : 'bg-red-500');

export const WhereItSits: React.FC<{
    lineage: LineageNode[];
    rollups: RollupNode[];
    onSelectAsset: (id: string) => void;
    /** 'rail' = the side panel card; 'inline' = a Now-tab section on narrower pages. */
    variant?: 'rail' | 'inline';
}> = ({ lineage, rollups, onSelectAsset, variant = 'rail' }) => {
    if (lineage.length < 2) return null;
    const weakest = weakestNearby(lineage, rollups);
    return (
        <div className={`bg-white border border-slate-200 rounded-xl shadow-sm p-4 ${variant === 'inline' ? 'max-w-xl' : ''}`}>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                <MapPin size={11} /> Where it sits
            </p>
            <ol className="relative">
                {lineage.map((n, i) => {
                    const blank = !n.name;
                    const clickable = !n.current && STUDYABLE.has(n.level);
                    const label = (
                        <span className="flex flex-col min-w-0 leading-tight">
                            <span className={`text-[12px] truncate ${n.current ? 'font-semibold text-slate-800' : blank ? 'italic text-amber-700' : 'text-slate-700'}`}>
                                {n.current && n.tag && n.name ? `${n.name}` : displayName(n)}
                            </span>
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">
                                {n.level || 'item'}{n.current ? ' · you are here' : ''}
                            </span>
                        </span>
                    );
                    return (
                        <li key={n.id} className={`relative grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 py-1.5 ${n.current ? 'bg-emerald-50 -mx-2 px-2 rounded-lg' : ''}`}>
                            {/* connector line */}
                            <span aria-hidden className={`absolute w-0.5 bg-slate-200 ${n.current ? 'left-[15px]' : 'left-[7px]'} ${i === 0 ? 'top-1/2 bottom-0' : i === lineage.length - 1 ? 'top-0 bottom-1/2' : 'top-0 bottom-0'}`} />
                            <span className={`relative z-10 w-4 h-4 rounded-full border-2 bg-white flex items-center justify-center ${n.current ? 'border-emerald-500' : 'border-slate-200'}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${dot(n.health)}`} />
                            </span>
                            {clickable ? (
                                <button onClick={() => onSelectAsset(n.id)} className="text-left min-w-0 hover:underline decoration-slate-300" title={`Study ${n.tag || n.name}`}>{label}</button>
                            ) : label}
                            <span className={`text-[12px] font-bold tabular-nums w-7 text-right ${n.health == null ? 'text-slate-300' : tone(n.health)}`}>
                                {n.health == null ? '·' : Math.round(n.health)}
                            </span>
                        </li>
                    );
                })}
            </ol>
            {weakest && (
                <button onClick={() => onSelectAsset(weakest.id)} className="mt-2 text-[11px] font-semibold text-primary-600 hover:text-primary-500 text-left">
                    Weakest in {weakest.scope}: {weakest.name} ({Math.round(weakest.health)}) →
                </button>
            )}
            <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
                From the register's parent links. Systems and units are rolled up from their monitored equipment; a dot means no health yet.
            </p>
        </div>
    );
};
