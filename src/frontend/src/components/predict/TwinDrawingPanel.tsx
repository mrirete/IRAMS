/**
 * TwinDrawingPanel — the twin's picture: the stored P&ID that shows this
 * asset (or its components), every drawn component resolved to the register
 * and coloured by its health snapshot.
 *
 * WHY
 * Predict computed health, RUL and alerts but never showed the asset. The
 * site's drawings already exist as typed graphs (ers_pid_configurations) and
 * PIDViewer already draws a health badge per node — nothing ever fed it.
 * This panel closes that: drawing in, register join, twin states on top.
 *
 * WHAT IT DOES NOT DO
 * It never writes. A node is resolved to a register asset by its stored
 * assetId first, then by its drawn tag/label matching a register tag (the
 * same rule the permit's isolation proposals use) — the resolution is shown,
 * not persisted; linking for real happens in Reliability Modelling.
 */
import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Map as MapIcon, ExternalLink, Box, Tag } from 'lucide-react';

/** three is ~600 kB — only the 3D toggle pays for it. */
const PlantScene3D = React.lazy(() => import('./PlantScene3D'));
import PIDViewer, { type PIDEquipment, type PIDConnection } from '../analyze/PIDViewer';
import { DatabaseService } from '../../eam/services/DatabaseService';
import predictionService from '../../eam/services/PredictionService';
import { supabase } from '../../eam/lib/supabase';
import type { PidDrawing } from '../../lib/pidIsolation';
import { collectSubtree } from '../../lib/assetSubtree';
import { useAssetContext } from '../../contexts/AssetContext';
import { STALE_DAYS } from '../../config/predict';
import type { TwinState } from '../../types/intelligence';

interface Props {
    assetId: string;
    assetTag: string | null | undefined;
    assetName: string;
    /** The selected asset's own snapshot — kept in sync with the page even if the fleet fetch lags. */
    twinHealth: TwinState | null;
    /** Clicking a drawn component that resolves to another register asset studies that asset. */
    onSelectAsset?: (assetId: string) => void;
}

const norm = (s: unknown): string => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

type TwinLite = { health_index: number; updated_at: string | null };

interface ResolvedDrawing {
    drawing: PidDrawing;
    equipment: PIDEquipment[];
    connections: PIDConnection[];
    /** id of the node that stands for the selected asset, if drawn */
    selectedNodeId: string | null;
    linked: number;
    withTwin: number;
    stale: number;
}

const ageDays = (iso: string | null | undefined): number | null => {
    if (!iso) return null;
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    return Number.isFinite(d) ? d : null;
};

export const TwinDrawingPanel: React.FC<Props> = ({ assetId, assetTag, assetName, twinHealth, onSelectAsset }) => {
    const { assets: register } = useAssetContext();
    const [drawings, setDrawings] = useState<PidDrawing[] | null>(null);
    const [twins, setTwins] = useState<Map<string, TwinLite>>(new Map());
    const [openWos, setOpenWos] = useState<Map<string, number>>(new Map());
    const [active, setActive] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [view, setView] = useState<'2d' | '3d'>(() => {
        try { return localStorage.getItem('predict.drawingView') === '3d' ? '3d' : '2d'; } catch { return '2d'; }
    });
    const [labels3d, setLabels3d] = useState(false);
    const pickView = (v: '2d' | '3d') => { setView(v); try { localStorage.setItem('predict.drawingView', v); } catch { /* ignore */ } };

    // Register indexes: by id, by normalised tag, and the selected asset's subtree
    // (a boiler's drawing shows its fans and economisers, not one "boiler" box).
    const byId = useMemo(() => new Map(register.map((a) => [a.id, a])), [register]);
    const byTag = useMemo(() => {
        const m = new Map<string, typeof register[number]>();
        for (const a of register) { const t = norm(a.tag); if (t && !m.has(t)) m.set(t, a); }
        return m;
    }, [register]);
    const subtree = useMemo(
        () => (assetId ? collectSubtree(register.map((a) => ({ id: a.id, parent_id: a.parent_id ?? null })), assetId) : new Set<string>()),
        [register, assetId],
    );

    useEffect(() => {
        let cancelled = false;
        setDrawings(null); setError(null); setActive(0);
        (async () => {
            try {
                const [all, twinRows] = await Promise.all([
                    DatabaseService.getInstance().getPidDrawings(),
                    predictionService.getTwinStates(),
                ]);
                if (cancelled) return;
                setDrawings(all);
                setTwins(new Map(twinRows.map((t) => [t.asset_id, { health_index: Number(t.health_index), updated_at: t.updated_at ?? null }])));
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : String(e));
            }
        })();
        return () => { cancelled = true; };
    }, [assetId]);

    const resolveNode = (n: PIDEquipment) => {
        if (n.assetId && byId.has(n.assetId)) return byId.get(n.assetId)!;
        return byTag.get(norm(n.assetTag)) ?? byTag.get(norm(n.label)) ?? null;
    };

    const resolved: ResolvedDrawing[] = useMemo(() => {
        if (!drawings) return [];
        const out: ResolvedDrawing[] = [];
        for (const d of drawings) {
            const nodes = (Array.isArray(d.equipment) ? d.equipment : []).filter(
                (n): n is PIDEquipment => !!n && typeof n === 'object' && typeof (n as PIDEquipment).id === 'string',
            );
            const edges = (Array.isArray(d.connections) ? d.connections : []).filter(
                (e): e is PIDConnection => !!e && typeof e === 'object' && typeof (e as PIDConnection).fromId === 'string',
            );
            let selectedNodeId: string | null = null;
            let touchesSubtree = !!d.asset_id && subtree.has(d.asset_id);
            let linked = 0, withTwin = 0, stale = 0;
            const equipment = nodes.map((n) => {
                const a = resolveNode(n);
                if (!a) return { ...n, healthIndex: undefined, woCount: openWos.get(n.assetId ?? '') };
                linked += 1;
                if (subtree.has(a.id)) touchesSubtree = true;
                if (a.id === assetId) selectedNodeId = n.id;
                const twin = a.id === assetId && twinHealth ? { health_index: Number(twinHealth.health_index), updated_at: twinHealth.updated_at } : twins.get(a.id);
                let healthIndex: number | undefined;
                if (twin && Number.isFinite(twin.health_index)) {
                    withTwin += 1;
                    const age = ageDays(twin.updated_at);
                    if (age != null && age > STALE_DAYS) stale += 1;
                    healthIndex = Math.round(twin.health_index);
                }
                return { ...n, assetId: a.id, assetTag: a.tag, criticality: n.criticality ?? (a.criticality as string | undefined), healthIndex, woCount: openWos.get(a.id) };
            });
            if (!touchesSubtree) continue;
            out.push({ drawing: d, equipment, connections: edges, selectedNodeId, linked, withTwin, stale });
        }
        // The drawing that shows the asset itself first, then the most-linked.
        return out.sort((a, b) => Number(!!b.selectedNodeId) - Number(!!a.selectedNodeId) || b.linked - a.linked);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [drawings, twins, openWos, byId, byTag, subtree, assetId, twinHealth]);

    // Open work orders per drawn asset (heat-map toggle) — best effort, from the semantic layer.
    useEffect(() => {
        const ids = Array.from(new Set(resolved.flatMap((r) => r.equipment.map((e) => e.assetId).filter((x): x is string => !!x))));
        if (!ids.length) return;
        let cancelled = false;
        (async () => {
            const { data, error: err } = await supabase.from('sem_asset_health').select('asset_id, open_wo_count').in('asset_id', ids);
            if (cancelled || err || !data) return;
            const m = new Map<string, number>();
            for (const r of data as { asset_id: string; open_wo_count: number | null }[]) m.set(r.asset_id, Number(r.open_wo_count ?? 0));
            setOpenWos((prev) => {
                if (prev.size === m.size && Array.from(m).every(([k, v]) => prev.get(k) === v)) return prev;
                return m;
            });
        })();
        return () => { cancelled = true; };
        // keyed on the id set, not the resolved objects, so a fresh map doesn't refetch
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resolved.map((r) => r.drawing.id).join('|'), resolved.reduce((n, r) => n + r.linked, 0)]);

    const current = resolved[Math.min(active, Math.max(0, resolved.length - 1))];

    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
            <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
                <h3 className="text-base font-semibold text-slate-800 flex items-center gap-2">
                    <MapIcon size={18} className="text-blue-500" />
                    Drawing — where {assetTag || assetName} sits
                </h3>
                <Link to="/reliability-modelling" className="text-[11px] font-medium text-primary-600 hover:text-primary-500 flex items-center gap-1">
                    Open in Reliability Modelling <ExternalLink size={11} />
                </Link>
            </div>
            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                The stored P&amp;ID with every drawn component resolved to the register and badged with its health
                snapshot. Click a component to study it; the heat-map toggle shows open work orders.
            </p>

            {error && <p className="text-xs text-red-600">Could not load drawings: {error}</p>}

            {!error && drawings === null && (
                <div className="h-40 rounded-lg bg-slate-50 border border-slate-100 animate-pulse" />
            )}

            {!error && drawings !== null && !current && (
                <div className="border border-dashed border-slate-300 rounded-lg p-5 text-center">
                    <p className="text-sm font-medium text-slate-500">No drawing shows {assetTag || assetName} yet</p>
                    <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto leading-relaxed">
                        Draw or import the P&amp;ID in Reliability Modelling and link its components to the register
                        (by tag is enough) — the twin then has a picture, and permits can propose isolation from it.
                    </p>
                </div>
            )}

            {current && (
                <>
                    {resolved.length > 1 && (
                        <div className="flex items-center gap-1.5 flex-wrap mb-3">
                            {resolved.map((r, i) => (
                                <button key={r.drawing.id} onClick={() => setActive(i)}
                                    className={`text-[11px] font-medium px-2.5 py-1 rounded-lg border transition-colors ${i === active ? 'bg-primary-50 text-primary-700 border-primary-200' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'}`}>
                                    {r.drawing.title}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="flex items-center gap-3 flex-wrap text-[11px] text-slate-500 mb-3">
                        <span><strong className="text-slate-700">{current.linked}</strong> of {current.equipment.length} drawn components resolve to the register</span>
                        <span>·</span>
                        <span><strong className="text-slate-700">{current.withTwin}</strong> carry a health snapshot</span>
                        {current.stale > 0 && (
                            <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-medium">
                                {current.stale} stale (&gt; {STALE_DAYS}d)
                            </span>
                        )}
                        <span className="ml-auto flex items-center gap-2">
                            <span className="inline-flex rounded-lg border border-slate-200 overflow-hidden" role="tablist" aria-label="Drawing view">
                                <button onClick={() => pickView('2d')} className={`flex items-center gap-1 px-2 py-1 font-medium ${view === '2d' ? 'bg-primary-50 text-primary-700' : 'bg-white text-slate-500 hover:bg-slate-50'}`} aria-selected={view === '2d'}>
                                    <MapIcon size={11} /> 2D sheet
                                </button>
                                <button onClick={() => pickView('3d')} className={`flex items-center gap-1 px-2 py-1 font-medium border-l border-slate-200 ${view === '3d' ? 'bg-primary-50 text-primary-700' : 'bg-white text-slate-500 hover:bg-slate-50'}`} aria-selected={view === '3d'}>
                                    <Box size={11} /> 3D plant
                                </button>
                            </span>
                            {view === '3d' && (
                                <button onClick={() => setLabels3d((v) => !v)} className={`flex items-center gap-1 px-2 py-1 rounded-lg border font-medium ${labels3d ? 'bg-slate-100 text-slate-700 border-slate-200' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>
                                    <Tag size={11} /> Labels
                                </button>
                            )}
                            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" /> ≥80</span>
                            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> 60–79</span>
                            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" /> &lt;60</span>
                            <span className="text-slate-400">no badge = no snapshot yet</span>
                        </span>
                    </div>
                    {view === '2d' ? (
                        <PIDViewer
                            readOnly
                            title={current.drawing.title}
                            equipment={current.equipment}
                            connections={current.connections}
                            highlightedEquipmentId={current.selectedNodeId ?? undefined}
                            onEquipmentClick={(_id, aId) => { if (aId && aId !== assetId) onSelectAsset?.(aId); }}
                        />
                    ) : (
                        <Suspense fallback={<div className="h-[480px] rounded-lg bg-slate-50 border border-slate-100 animate-pulse" />}>
                            <PlantScene3D
                                equipment={current.equipment}
                                connections={current.connections}
                                selectedNodeId={current.selectedNodeId}
                                showLabels={labels3d}
                                onStudy={(aId) => { if (aId !== assetId) onSelectAsset?.(aId); }}
                            />
                        </Suspense>
                    )}
                </>
            )}
        </div>
    );
};

export default TwinDrawingPanel;
