/**
 * ReliabilityBlockDiagram — Interactive RBD with drag-and-drop
 *
 * Light theme, click-to-edit popover, group management, drag blocks
 * on SVG canvas, snap-to-grid, JSON+PNG export.
 * Topology-aware connection lines (series/parallel).
 * Insert-in-series / insert-in-parallel relative to any block.
 */
import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
    Plus, Layers, X, Trash2, Download, Image, Settings, GripVertical,
    ArrowRight, GitBranch, ZoomIn, ZoomOut, RotateCcw, Database, Info, Move, Search, Link2, Unlink,
    Target, BarChart3, TrendingUp, Shield, AlertTriangle, Calculator, Clock, ChevronDown, ChevronUp,
    ExternalLink,
} from 'lucide-react';
import { supabase } from '../../eam/lib/supabase';
import RBDReliabilityDashboard from './RBDReliabilityDashboard';

// ── Types ────────────────────────────────────────────────────
export interface RBDBlock {
    id: string;
    name: string;
    failureRate: number;   // λ per year
    mtbf: number;          // hours
    mttr: number;          // hours
    config: 'series' | 'parallel' | 'standby';
    groupId?: string;
    x?: number;
    y?: number;
    assetId?: string;      // Linked asset ID from Asset Register
    assetTag?: string;     // Linked asset tag (e.g., "P-101")
}

export interface RBDGroup {
    id: string;
    type: 'series' | 'parallel' | 'standby' | 'k-of-n';
    label: string;
    blocks: string[];
    k?: number;
}

interface Props {
    blocks: RBDBlock[];
    groups: RBDGroup[];
    onAddBlock: (groupId?: string) => void;
    onRemoveBlock: (blockId: string) => void;
    onUpdateBlock: (blockId: string, updates: Partial<RBDBlock>) => void;
    onMoveBlock?: (blockId: string, x: number, y: number) => void;
    onAddGroup: (type: RBDGroup['type'], label: string, k?: number) => void;
    onRemoveGroup: (groupId: string) => void;
    onAssignBlockToGroup: (blockId: string, groupId: string | undefined) => void;
    onInsertBlock?: (referenceBlockId: string, placement: 'series' | 'parallel') => void;
    /** Topology-aware reorder: move blockId to a new group/position */
    onReorderBlock?: (blockId: string, targetGroupId: string | null, position: number) => void;
    /** Link a block to an asset from the Asset Register — triggers WO data auto-populate */
    onLinkAsset?: (blockId: string, asset: { id: string; tag: string; name: string } | null) => void;
}

// ── Helpers ──────────────────────────────────────────────────
const GRID = 20;
const snap = (v: number) => Math.round(v / GRID) * GRID;
const SVG_W = 1200;
const SVG_H = 600;
const BLOCK_W = 160;
const BLOCK_H = 90;
const GAP_X = 40;
const GAP_Y = BLOCK_H + 30;

function blockAvailability(b: RBDBlock): number {
    return b.mtbf / (b.mtbf + b.mttr);
}

function groupColor(type: string): string {
    switch (type) {
        case 'series': return '#0891b2';
        case 'parallel': return '#7c3aed';
        case 'standby': return '#0d9488';
        case 'k-of-n': return '#c2410c';
        default: return '#64748b';
    }
}

function aoColor(ao: number): string {
    if (ao >= 0.99) return '#16a34a';
    if (ao >= 0.95) return '#d97706';
    return '#dc2626';
}

// ── Block Edit Popover ──────────────────────────────────────
const EditPopover: React.FC<{
    block: RBDBlock;
    groups: RBDGroup[];
    onUpdate: (u: Partial<RBDBlock>) => void;
    onAssign: (groupId: string | undefined) => void;
    onRemove: () => void;
    onClose: () => void;
    onInsertSeries?: () => void;
    onInsertParallel?: () => void;
    onLinkAsset?: (asset: { id: string; tag: string; name: string } | null) => void;
}> = ({ block, groups, onUpdate, onAssign, onRemove, onClose, onInsertSeries, onInsertParallel, onLinkAsset }) => {
    const [name, setName] = useState(block.name);
    const [mtbf, setMtbf] = useState(String(block.mtbf));
    const [mttr, setMttr] = useState(String(block.mttr));
    const [fr, setFr] = useState(String(block.failureRate));
    const [cfg, setCfg] = useState(block.config);
    const [gId, setGId] = useState(block.groupId || '');

    // ── Asset search state ──
    const [assetQuery, setAssetQuery] = useState('');
    const [assetResults, setAssetResults] = useState<{ id: string; name: string; tag: string }[]>([]);
    const [assetOpen, setAssetOpen] = useState(false);
    const [searchingAsset, setSearchingAsset] = useState(false);

    // ★ FIX: Reset local state when block prop changes
    useEffect(() => {
        setName(block.name);
        setMtbf(String(block.mtbf));
        setMttr(String(block.mttr));
        setFr(String(block.failureRate));
        setCfg(block.config);
        setGId(block.groupId || '');
    }, [block.id, block.name, block.mtbf, block.mttr, block.failureRate, block.config, block.groupId]);

    // ── Asset search debounced query ──
    useEffect(() => {
        if (!assetQuery || assetQuery.length < 2) { setAssetResults([]); return; }
        setSearchingAsset(true);
        const timer = setTimeout(async () => {
            const { data } = await supabase.from('assets')
                .select('id, name, tag')
                .or(`name.ilike.%${assetQuery}%,tag.ilike.%${assetQuery}%`)
                .order('name').limit(10);
            setAssetResults(data || []);
            setSearchingAsset(false);
        }, 300);
        return () => clearTimeout(timer);
    }, [assetQuery]);

    const save = () => {
        onUpdate({ name, mtbf: +mtbf || 8760, mttr: +mttr || 24, failureRate: +fr || 0.5, config: cfg });
        onAssign(gId || undefined);
        onClose();
    };

    return (
        <div className="absolute z-50 bg-white rounded-xl shadow-xl border border-slate-200 p-4 w-80"
            style={{ top: 16, right: 16 }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    <Settings size={14} className="text-cyan-500" /> Edit Block
                </h4>
                <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded"><X size={14} /></button>
            </div>

            {/* ★ Relationship Context Info */}
            {(() => {
                const grp = groups.find(g => g.blocks.includes(block.id));
                const siblingCount = grp ? grp.blocks.length - 1 : 0;
                const arrangement = grp ? grp.type : 'standalone';
                const arrangementLabel = arrangement === 'parallel' ? '⇅ Parallel (redundant)' :
                    arrangement === 'series' ? '→ Series (sequential)' :
                        arrangement === 'standby' ? '⏸ Standby (hot spare)' :
                            arrangement === 'k-of-n' ? `# k-of-n voting` : '○ Standalone';
                const desc = arrangement === 'parallel'
                    ? `This block operates in parallel with ${siblingCount} other block(s). If this block fails, the system continues via the redundant path(s).`
                    : arrangement === 'series'
                        ? `This block is in series with ${siblingCount} other block(s). If this block fails, the entire group fails.`
                        : arrangement === 'standby'
                            ? `This block is in a standby configuration. It activates only when the primary fails.`
                            : `This block is not assigned to any group. It operates as an independent series element.`;
                return (
                    <div className="mb-3 p-2.5 rounded-lg bg-gradient-to-r from-slate-50 to-cyan-50/30 border border-slate-100">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-bold text-cyan-600 uppercase tracking-wider">Arrangement</span>
                            <span className="text-[10px] font-semibold text-slate-700 px-1.5 py-0.5 bg-white rounded border border-slate-200">{arrangementLabel}</span>
                        </div>
                        {grp && <p className="text-[10px] text-slate-500 mb-1">Group: <strong className="text-slate-700">{grp.label}</strong> · {siblingCount} sibling(s)</p>}
                        <p className="text-[9px] text-slate-400 leading-snug">{desc}</p>
                    </div>
                );
            })()}

            <div className="space-y-2">
                <div>
                    <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Name</label>
                    <input value={name} onChange={e => setName(e.target.value)}
                        className="w-full mt-0.5 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-cyan-200 outline-none" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">MTBF (h)</label>
                        <input type="number" value={mtbf} onChange={e => setMtbf(e.target.value)}
                            className="w-full mt-0.5 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 outline-none" />
                    </div>
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">MTTR (h)</label>
                        <input type="number" value={mttr} onChange={e => setMttr(e.target.value)}
                            className="w-full mt-0.5 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 outline-none" />
                    </div>
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">λ /yr</label>
                        <input type="number" step="0.01" value={fr} onChange={e => setFr(e.target.value)}
                            className="w-full mt-0.5 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 outline-none" />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Configuration</label>
                        <select value={cfg} onChange={e => setCfg(e.target.value as RBDBlock['config'])}
                            className="w-full mt-0.5 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 outline-none">
                            <option value="series">Series</option>
                            <option value="parallel">Parallel</option>
                            <option value="standby">Standby</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Group</label>
                        <select value={gId} onChange={e => setGId(e.target.value)}
                            className="w-full mt-0.5 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 outline-none">
                            <option value="">— Unassigned —</option>
                            {groups.map(g => <option key={g.id} value={g.id}>{g.label} ({g.type})</option>)}
                        </select>
                    </div>
                </div>

                {/* ★ ASSET LINKING — connect block to Asset Register (P2.3) */}
                {onLinkAsset && (
                    <div className="pt-2 border-t border-slate-100">
                        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                            <Link2 size={10} /> Link to Asset Register
                        </label>
                        {block.assetId ? (
                            <div className="space-y-1.5">
                                <div className="flex items-center gap-2 p-2 bg-emerald-50 border border-emerald-200 rounded-lg">
                                    <div className="flex-1 min-w-0">
                                        <span className="text-[11px] font-bold text-emerald-700 font-mono">{block.assetTag || block.assetId}</span>
                                        <p className="text-[9px] text-emerald-600 truncate">MTBF/MTTR auto-populated from WO history</p>
                                    </div>
                                    <button onClick={() => onLinkAsset(null)}
                                        className="p-1 text-emerald-500 hover:text-red-500 hover:bg-red-50 rounded transition-colors" title="Unlink asset">
                                        <Unlink size={12} />
                                    </button>
                                </div>
                                <button
                                    onClick={() => { window.location.href = `/assets?select=${block.assetId}`; }}
                                    className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold text-cyan-700 bg-cyan-50 border border-cyan-200 rounded-lg hover:bg-cyan-100 transition-colors"
                                >
                                    <ExternalLink size={10} /> Open in Asset Register
                                </button>
                            </div>
                        ) : (
                            <div className="relative">
                                <div className="flex items-center gap-2 border border-slate-200 rounded-lg px-2.5 py-1.5 bg-slate-50">
                                    <Search size={12} className="text-slate-400 shrink-0" />
                                    <input
                                        type="text"
                                        value={assetQuery}
                                        onChange={e => { setAssetQuery(e.target.value); setAssetOpen(true); }}
                                        onFocus={() => setAssetOpen(true)}
                                        placeholder="Search asset by name or tag..."
                                        className="w-full text-[11px] outline-none bg-transparent text-slate-700"
                                    />
                                    {searchingAsset && <span className="text-[9px] text-slate-400 animate-pulse">...</span>}
                                </div>
                                {assetOpen && assetResults.length > 0 && (
                                    <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-xl max-h-32 overflow-y-auto">
                                        {assetResults.map(a => (
                                            <button key={a.id} onClick={() => { onLinkAsset(a); setAssetOpen(false); setAssetQuery(''); }}
                                                className="w-full px-2.5 py-1.5 text-left text-[11px] hover:bg-cyan-50 flex justify-between items-center border-b border-slate-50 last:border-0">
                                                <span className="text-slate-700 truncate">{a.name}</span>
                                                <span className="text-[9px] text-slate-400 font-mono shrink-0 ml-2">{a.tag}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* ★ INSERT ACTIONS — insert series/parallel relative to this block */}
                {(onInsertSeries || onInsertParallel) && (
                    <div className="pt-2 border-t border-slate-100">
                        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">Insert Relative To This Block</label>
                        <div className="flex gap-2">
                            {onInsertSeries && (
                                <button onClick={onInsertSeries}
                                    className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-2 text-[11px] font-semibold text-cyan-700 bg-cyan-50 border border-cyan-200 rounded-lg hover:bg-cyan-100 transition-colors">
                                    <ArrowRight size={13} /> + Series After
                                </button>
                            )}
                            {onInsertParallel && (
                                <button onClick={onInsertParallel}
                                    className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-2 text-[11px] font-semibold text-violet-700 bg-violet-50 border border-violet-200 rounded-lg hover:bg-violet-100 transition-colors">
                                    <GitBranch size={13} /> + Parallel
                                </button>
                            )}
                        </div>
                    </div>
                )}

                <div className="flex justify-between pt-2 border-t border-slate-100">
                    <button onClick={onRemove}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                        <Trash2 size={12} /> Remove
                    </button>
                    <div className="flex gap-2">
                        <button onClick={onClose} className="px-3 py-1 text-xs text-slate-500 hover:bg-slate-100 rounded-lg">Cancel</button>
                        <button onClick={save}
                            className="px-3 py-1 text-xs bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 font-medium">Save</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ── Add Group Modal ─────────────────────────────────────────
const AddGroupModal: React.FC<{
    onAdd: (type: RBDGroup['type'], label: string, k?: number) => void;
    onClose: () => void;
}> = ({ onAdd, onClose }) => {
    const [type, setType] = useState<RBDGroup['type']>('series');
    const [label, setLabel] = useState('');
    const [k, setK] = useState('2');

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-2xl border border-slate-200 p-5 w-96" onClick={e => e.stopPropagation()}>
                <h4 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                    <Layers size={14} className="text-cyan-500" /> Create Group
                </h4>
                <div className="space-y-3">
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Label</label>
                        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Cooling Redundancy"
                            className="w-full mt-0.5 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 outline-none" />
                    </div>
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Configuration Type</label>
                        <div className="flex gap-2 mt-1">
                            {(['series', 'parallel', 'standby', 'k-of-n'] as const).map(t => (
                                <button key={t} onClick={() => setType(t)}
                                    className={`px-3 py-1 text-xs rounded-md border font-medium transition-colors ${type === t
                                        ? 'text-white border-transparent' : 'bg-white text-slate-600 border-slate-200'
                                        }`}
                                    style={type === t ? { backgroundColor: groupColor(t) } : undefined}>
                                    {t}
                                </button>
                            ))}
                        </div>
                    </div>
                    {type === 'k-of-n' && (
                        <div>
                            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Minimum k out of n</label>
                            <input type="number" min={1} value={k} onChange={e => setK(e.target.value)}
                                className="w-full mt-0.5 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 outline-none" />
                        </div>
                    )}
                </div>
                <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
                    <button onClick={onClose} className="px-4 py-1.5 text-xs text-slate-500 hover:bg-slate-100 rounded-lg">Cancel</button>
                    <button
                        onClick={() => { if (label.trim()) { onAdd(type, label.trim(), type === 'k-of-n' ? +k : undefined); onClose(); } }}
                        className="px-4 py-1.5 text-xs bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 font-medium">Create</button>
                </div>
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════════════════

const ReliabilityBlockDiagram: React.FC<Props> = ({
    blocks, groups,
    onAddBlock, onRemoveBlock, onUpdateBlock, onMoveBlock,
    onAddGroup, onRemoveGroup, onAssignBlockToGroup,
    onInsertBlock, onReorderBlock, onLinkAsset,
}) => {
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [multiSelect, setMultiSelect] = useState<Set<string>>(new Set());
    const [showGroupModal, setShowGroupModal] = useState(false);
    const [showLegend, setShowLegend] = useState(false);
    // Topology-aware drag state: tracks which block is being dragged and which drop zone is hovered
    const [topoDrag, setTopoDrag] = useState<{ blockId: string; startX: number; startY: number } | null>(null);
    const [dropTarget, setDropTarget] = useState<{ groupId: string | null; position: number; label: string } | null>(null);
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // ── Zoom state ──
    const [zoom, setZoom] = useState(1);
    const zoomIn = useCallback(() => setZoom(z => Math.min(z + 0.2, 3)), []);
    const zoomOut = useCallback(() => setZoom(z => Math.max(z - 0.2, 0.3)), []);
    const zoomReset = useCallback(() => setZoom(1), []);

    // Scroll-wheel zoom
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const handler = (e: WheelEvent) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                setZoom(z => Math.min(3, Math.max(0.3, z + (e.deltaY < 0 ? 0.1 : -0.1))));
            }
        };
        el.addEventListener('wheel', handler, { passive: false });
        return () => el.removeEventListener('wheel', handler);
    }, []);

    // ── Auto-layout — always topology-driven ──
    // RBD positions are computed from the series/parallel model, never free-form
    const computeAutoLayout = useCallback((): (RBDBlock & { x: number; y: number })[] => {
        const positioned: (RBDBlock & { x: number; y: number })[] = [];
        const placed = new Set<string>();

        let cursorX = 60;
        const baseY = 80;

        // First: lay out groups in order
        groups.forEach(g => {
            const gBlocks = blocks.filter(b => g.blocks.includes(b.id));
            if (gBlocks.length === 0) return;

            if (g.type === 'parallel' || g.type === 'standby' || g.type === 'k-of-n') {
                const startY = baseY;
                gBlocks.forEach((b, i) => {
                    positioned.push({ ...b, x: cursorX, y: startY + i * GAP_Y });
                    placed.add(b.id);
                });
                cursorX += BLOCK_W + GAP_X;
            } else {
                gBlocks.forEach(b => {
                    positioned.push({ ...b, x: cursorX, y: baseY });
                    placed.add(b.id);
                    cursorX += BLOCK_W + GAP_X;
                });
            }
        });

        // Then: ungrouped blocks in series
        blocks.filter(b => !placed.has(b.id)).forEach(b => {
            positioned.push({ ...b, x: cursorX, y: baseY });
            cursorX += BLOCK_W + GAP_X;
        });

        return positioned;
    }, [blocks, groups]);

    // Layout is always topology-driven — no manual pixel overrides
    const positionedBlocks = useMemo(() => computeAutoLayout(), [computeAutoLayout]);

    // ── Drop Zones for Topology-Aware Drag ──
    // Computed from the current layout to show where a dragged block can land
    const dropZones = useMemo(() => {
        if (!topoDrag) return [];
        const zones: { id: string; groupId: string | null; position: number; x: number; y: number; w: number; h: number; label: string }[] = [];
        const dragBlockId = topoDrag.blockId;

        // Zone: "Move to series (ungrouped)" — at the end of the chain
        const maxX = positionedBlocks.length > 0
            ? Math.max(...positionedBlocks.filter(b => b.id !== dragBlockId).map(b => b.x + BLOCK_W)) + GAP_X
            : 60;
        zones.push({
            id: 'series-end', groupId: null, position: -1,
            x: maxX, y: 60, w: BLOCK_W, h: BLOCK_H,
            label: '→ Move to Series (end)',
        });

        // Zone: for each group, add "Move into this group"
        groups.forEach(g => {
            const gBlocks = positionedBlocks.filter(b => g.blocks.includes(b.id) && b.id !== dragBlockId);
            if (gBlocks.length === 0) {
                // Empty group after removing dragged block — show drop zone at group origin
                const groupIdx = groups.indexOf(g);
                const approxX = 60 + groupIdx * (BLOCK_W + GAP_X);
                zones.push({
                    id: `group-${g.id}`, groupId: g.id, position: 0,
                    x: approxX, y: 80, w: BLOCK_W, h: BLOCK_H,
                    label: `⇅ Move to ${g.label}`,
                });
            } else {
                // Show a drop zone below/after the last block in the group
                if (g.type === 'parallel' || g.type === 'standby' || g.type === 'k-of-n') {
                    const lastY = Math.max(...gBlocks.map(b => b.y + BLOCK_H));
                    const x = gBlocks[0].x;
                    zones.push({
                        id: `group-${g.id}`, groupId: g.id, position: gBlocks.length,
                        x, y: lastY + 10, w: BLOCK_W, h: BLOCK_H / 2,
                        label: `⇅ Add to ${g.label}`,
                    });
                } else {
                    // Series group: drop zone after last block
                    const lastBlock = gBlocks.reduce((a, b) => a.x > b.x ? a : b);
                    zones.push({
                        id: `group-${g.id}`, groupId: g.id, position: gBlocks.length,
                        x: lastBlock.x + BLOCK_W + 10, y: lastBlock.y, w: BLOCK_W / 2, h: BLOCK_H,
                        label: `→ Add to ${g.label}`,
                    });
                }
            }
        });

        return zones;
    }, [topoDrag, positionedBlocks, groups]);

    // ── System Metrics ──
    const systemAo = useMemo(() => {
        if (blocks.length === 0) return 0;
        const ungrouped = blocks.filter(b => !b.groupId);
        let seriesProduct = 1;
        ungrouped.forEach(b => { seriesProduct *= blockAvailability(b); });
        groups.forEach(g => {
            const gBlocks = blocks.filter(b => g.blocks.includes(b.id));
            if (gBlocks.length === 0) return;
            let gAo: number;
            if (g.type === 'parallel') {
                gAo = 1 - gBlocks.reduce((p, b) => p * (1 - blockAvailability(b)), 1);
            } else if (g.type === 'standby') {
                const primary = gBlocks[0];
                const standbyUnits = gBlocks.slice(1);
                gAo = blockAvailability(primary);
                standbyUnits.forEach(sb => { gAo = 1 - (1 - gAo) * (1 - blockAvailability(sb)); });
            } else if (g.type === 'k-of-n' && g.k) {
                const n = gBlocks.length;
                const kk = g.k;
                let sum = 0;
                for (let i = kk; i <= n; i++) {
                    const comb = factorial(n) / (factorial(i) * factorial(n - i));
                    const avgA = gBlocks.reduce((s, b) => s + blockAvailability(b), 0) / n;
                    sum += comb * Math.pow(avgA, i) * Math.pow(1 - avgA, n - i);
                }
                gAo = sum;
            } else {
                gAo = gBlocks.reduce((p, b) => p * blockAvailability(b), 1);
            }
            seriesProduct *= gAo;
        });
        return seriesProduct;
    }, [blocks, groups]);

    const systemMTBF = useMemo(() => {
        if (blocks.length === 0) return 0;
        const totalLambda = blocks.reduce((s, b) => s + b.failureRate, 0);
        return totalLambda > 0 ? 8760 / totalLambda : 0;
    }, [blocks]);

    // ═══════════════════════════════════════════════════════════
    //  SYSTEM RELIABILITY R(t) ENGINE
    // ═══════════════════════════════════════════════════════════
    const [missionTime, setMissionTime] = useState(8760); // Default 1 year (hours)
    const [targetReliability, setTargetReliability] = useState(0.95);
    const [showReliabilityPanel, setShowReliabilityPanel] = useState(true);
    const [showSensitivity, setShowSensitivity] = useState(false);
    const [showRequirements, setShowRequirements] = useState(false);

    /** Per-block R(t) = e^(-t/MTBF) = e^(-λt) where λ = failureRate/8760 per hour */
    const blockReliability = useCallback((b: RBDBlock, t: number): number => {
        if (b.mtbf <= 0) return 0;
        const lambdaPerHour = 1 / b.mtbf;
        return Math.exp(-lambdaPerHour * t);
    }, []);

    /** Group reliability based on topology */
    const groupReliability = useCallback((g: RBDGroup, gBlocks: RBDBlock[], t: number): number => {
        if (gBlocks.length === 0) return 1;
        if (g.type === 'series') {
            return gBlocks.reduce((p, b) => p * blockReliability(b, t), 1);
        }
        if (g.type === 'parallel') {
            // R = 1 - Π(1 - Ri(t))
            return 1 - gBlocks.reduce((p, b) => p * (1 - blockReliability(b, t)), 1);
        }
        if (g.type === 'k-of-n' && g.k) {
            // Binomial: R = Σ[C(n,i) × R^i × (1-R)^(n-i)] for i = k to n
            const n = gBlocks.length;
            const kk = Math.min(g.k, n);
            // Use average R for simplification when components differ
            const avgR = gBlocks.reduce((s, b) => s + blockReliability(b, t), 0) / n;
            let sum = 0;
            for (let i = kk; i <= n; i++) {
                const comb = factorial(n) / (factorial(i) * factorial(n - i));
                sum += comb * Math.pow(avgR, i) * Math.pow(1 - avgR, n - i);
            }
            return sum;
        }
        if (g.type === 'standby') {
            // Cold standby: R(t) = e^(-λt) × Σ[(λt)^i / i!] for i = 0 to (n-1)
            // Using average λ across standby units
            const avgLambda = gBlocks.reduce((s, b) => s + (1 / b.mtbf), 0) / gBlocks.length;
            const lt = avgLambda * t;
            let poissonSum = 0;
            for (let i = 0; i < gBlocks.length; i++) {
                poissonSum += Math.pow(lt, i) / factorial(i);
            }
            return Math.exp(-lt) * poissonSum;
        }
        return gBlocks.reduce((p, b) => p * blockReliability(b, t), 1);
    }, [blockReliability]);

    /** System R(t) — topology-aware composition */
    const computeSystemR = useCallback((t: number): number => {
        if (blocks.length === 0) return 0;
        const ungrouped = blocks.filter(b => !b.groupId);
        let seriesProduct = 1;
        ungrouped.forEach(b => { seriesProduct *= blockReliability(b, t); });
        groups.forEach(g => {
            const gBlocks = blocks.filter(b => g.blocks.includes(b.id));
            if (gBlocks.length === 0) return;
            seriesProduct *= groupReliability(g, gBlocks, t);
        });
        return seriesProduct;
    }, [blocks, groups, blockReliability, groupReliability]);

    const systemR = useMemo(() => computeSystemR(missionTime), [computeSystemR, missionTime]);
    const systemF = 1 - systemR; // Failure probability
    const expectedFailures = useMemo(() => {
        if (systemMTBF <= 0) return 0;
        return missionTime / systemMTBF;
    }, [missionTime, systemMTBF]);

    /** Topology-aware system MTBF */
    const topoMTBF = useMemo(() => {
        if (blocks.length === 0) return 0;
        // Numerical integration of R(t) from 0 to a large horizon
        const horizon = 200000; // hours
        const steps = 500;
        const dt = horizon / steps;
        let integral = 0;
        for (let i = 0; i < steps; i++) {
            const t = i * dt;
            integral += computeSystemR(t) * dt;
        }
        return integral;
    }, [blocks, computeSystemR]);

    /** R(t) curve data — 50 points from 0 to 2× mission time */
    const reliabilityCurve = useMemo(() => {
        if (blocks.length === 0) return [];
        const maxT = missionTime * 2;
        const points: { t: number; r: number }[] = [];
        for (let i = 0; i <= 50; i++) {
            const t = (i / 50) * maxT;
            points.push({ t, r: computeSystemR(t) });
        }
        return points;
    }, [blocks, missionTime, computeSystemR]);

    /** Per-block reliability at mission time (for dashboard) */
    const blockRValues = useMemo(() => {
        return blocks.map(b => ({
            id: b.id,
            name: b.name,
            r: blockReliability(b, missionTime),
            mtbf: b.mtbf,
            mttr: b.mttr,
            lambda: b.failureRate,
            assetTag: b.assetTag,
        }));
    }, [blocks, missionTime, blockReliability]);

    /** Birnbaum Sensitivity Analysis: ∂R_sys/∂Ri ≈ [R_sys(Ri=1) - R_sys(Ri=0)] */
    const sensitivityData = useMemo(() => {
        if (blocks.length < 2) return [];
        return blocks.map(b => {
            // R_sys when block b is perfect (R=1, i.e., MTBF → ∞)
            const origMtbf = b.mtbf;
            b.mtbf = 1e12; // Effectively perfect
            const rPerfect = computeSystemR(missionTime);
            b.mtbf = origMtbf;

            // R_sys when block b is failed (R=0, i.e., MTBF → 0)
            b.mtbf = 0.001; // Effectively failed
            const rFailed = computeSystemR(missionTime);
            b.mtbf = origMtbf;

            const importance = rPerfect - rFailed;
            return {
                id: b.id,
                name: b.name,
                assetTag: b.assetTag,
                importance,
                rPerfect,
                rFailed,
                currentR: blockReliability(b, missionTime),
            };
        }).sort((a, b) => b.importance - a.importance);
    }, [blocks, missionTime, computeSystemR, blockReliability]);

    /** Minimum Requirements Solver: find minimum per-block R needed to hit target */
    const requirementGaps = useMemo(() => {
        if (blocks.length === 0) return [];
        const currentSysR = systemR;
        const target = targetReliability;
        const gap = target - currentSysR;

        return blocks.map(b => {
            const currentR = blockReliability(b, missionTime);
            // Estimate: how much does this block need to improve to close the gap?
            // Using Birnbaum: ΔR_sys ≈ importance × ΔRi
            const sens = sensitivityData.find(s => s.id === b.id);
            const importance = sens?.importance || 0;
            const requiredDeltaRi = importance > 0.001 ? gap / importance : 0;
            const requiredR = Math.min(1, Math.max(0, currentR + requiredDeltaRi));
            // Convert required R to required MTBF: R = e^(-t/MTBF) → MTBF = -t / ln(R)
            const requiredMTBF = requiredR > 0 && requiredR < 1 ? -missionTime / Math.log(requiredR) : (requiredR >= 1 ? Infinity : 0);
            const currentMTBF = b.mtbf;
            const mtbfGap = requiredMTBF - currentMTBF;
            const meetsTarget = currentR >= requiredR || gap <= 0;

            return {
                id: b.id,
                name: b.name,
                assetTag: b.assetTag,
                currentR,
                requiredR,
                currentMTBF,
                requiredMTBF: isFinite(requiredMTBF) ? requiredMTBF : currentMTBF,
                mtbfGap: isFinite(mtbfGap) ? mtbfGap : 0,
                meetsTarget,
                importance: importance,
            };
        }).sort((a, b) => b.importance - a.importance);
    }, [blocks, systemR, targetReliability, missionTime, blockReliability, sensitivityData]);

    /** K-of-N groups for dedicated display */
    const kofnGroups = useMemo(() => {
        return groups.filter(g => g.type === 'k-of-n' || g.type === 'parallel' || g.type === 'standby')
            .map(g => {
                const gBlocks = blocks.filter(b => g.blocks.includes(b.id));
                const avgR = gBlocks.length > 0
                    ? gBlocks.reduce((s, b) => s + blockReliability(b, missionTime), 0) / gBlocks.length
                    : 0;
                const gR = groupReliability(g, gBlocks, missionTime);
                // For K-of-N: compute R for all possible K values
                const kVariants: { k: number; r: number }[] = [];
                if (g.type === 'k-of-n' && gBlocks.length > 0) {
                    for (let kk = 1; kk <= gBlocks.length; kk++) {
                        const n = gBlocks.length;
                        let sum = 0;
                        for (let i = kk; i <= n; i++) {
                            const comb = factorial(n) / (factorial(i) * factorial(n - i));
                            sum += comb * Math.pow(avgR, i) * Math.pow(1 - avgR, n - i);
                        }
                        kVariants.push({ k: kk, r: sum });
                    }
                }
                return { group: g, blocks: gBlocks, avgR, groupR: gR, kVariants };
            });
    }, [groups, blocks, missionTime, blockReliability, groupReliability]);

    // ── Topology-Aware Connection Lines ──
    const connectionLines = useMemo(() => {
        const lines: { x1: number; y1: number; x2: number; y2: number; color: string; dashed?: boolean }[] = [];
        if (positionedBlocks.length === 0) return lines;

        // Build an ordered list of "stages" — each stage is either a single series block or a parallel group
        type Stage = { type: 'single'; block: typeof positionedBlocks[0] } |
        { type: 'group'; group: RBDGroup; blocks: typeof positionedBlocks };
        const stages: Stage[] = [];
        const assignedToGroup = new Set<string>();

        // Collect groups in order of their first block's x position
        const groupOrder = groups
            .map(g => {
                const gbs = positionedBlocks.filter(b => g.blocks.includes(b.id));
                return { group: g, blocks: gbs, minX: gbs.length > 0 ? Math.min(...gbs.map(b => b.x)) : Infinity };
            })
            .filter(g => g.blocks.length > 0)
            .sort((a, b) => a.minX - b.minX);

        // Mark all grouped block IDs
        groupOrder.forEach(go => go.blocks.forEach(b => assignedToGroup.add(b.id)));

        // Build stages: merge ungrouped (series) blocks and groups by x-position order
        const ungrouped = positionedBlocks
            .filter(b => !assignedToGroup.has(b.id))
            .sort((a, b) => a.x - b.x);

        let gi = 0;
        let ui = 0;
        while (gi < groupOrder.length || ui < ungrouped.length) {
            const gx = gi < groupOrder.length ? groupOrder[gi].minX : Infinity;
            const ux = ui < ungrouped.length ? ungrouped[ui].x : Infinity;
            if (ux <= gx) {
                stages.push({ type: 'single', block: ungrouped[ui] });
                ui++;
            } else {
                stages.push({ type: 'group', group: groupOrder[gi].group, blocks: groupOrder[gi].blocks });
                gi++;
            }
        }

        // Draw connections between consecutive stages
        for (let i = 0; i < stages.length - 1; i++) {
            const from = stages[i];
            const to = stages[i + 1];

            // Get right-side exit points of "from" stage
            const fromExits: { x: number; y: number }[] = [];
            if (from.type === 'single') {
                fromExits.push({ x: from.block.x + BLOCK_W, y: from.block.y + BLOCK_H / 2 });
            } else {
                from.blocks.forEach(b => fromExits.push({ x: b.x + BLOCK_W, y: b.y + BLOCK_H / 2 }));
            }

            // Get left-side entry points of "to" stage
            const toEntries: { x: number; y: number }[] = [];
            if (to.type === 'single') {
                toEntries.push({ x: to.block.x, y: to.block.y + BLOCK_H / 2 });
            } else {
                to.blocks.forEach(b => toEntries.push({ x: b.x, y: b.y + BLOCK_H / 2 }));
            }

            // For series→series: single line
            if (fromExits.length === 1 && toEntries.length === 1) {
                lines.push({ x1: fromExits[0].x, y1: fromExits[0].y, x2: toEntries[0].x, y2: toEntries[0].y, color: '#94a3b8' });
            }
            // For single→parallel (fan-out): one exit to multiple entries
            else if (fromExits.length === 1 && toEntries.length > 1) {
                const midX = (fromExits[0].x + toEntries[0].x) / 2;
                // Horizontal from exit to midpoint
                lines.push({ x1: fromExits[0].x, y1: fromExits[0].y, x2: midX, y2: fromExits[0].y, color: '#94a3b8' });
                // Vertical spine
                const minY = Math.min(...toEntries.map(e => e.y));
                const maxY = Math.max(...toEntries.map(e => e.y));
                lines.push({ x1: midX, y1: minY, x2: midX, y2: maxY, color: '#94a3b8' });
                // Horizontal from spine to each entry
                toEntries.forEach(e => {
                    lines.push({ x1: midX, y1: e.y, x2: e.x, y2: e.y, color: '#94a3b8' });
                });
            }
            // For parallel→single (fan-in): multiple exits to one entry
            else if (fromExits.length > 1 && toEntries.length === 1) {
                const midX = (Math.max(...fromExits.map(e => e.x)) + toEntries[0].x) / 2;
                // Horizontal from each exit to midpoint
                fromExits.forEach(e => {
                    lines.push({ x1: e.x, y1: e.y, x2: midX, y2: e.y, color: '#94a3b8' });
                });
                // Vertical spine
                const minY = Math.min(...fromExits.map(e => e.y));
                const maxY = Math.max(...fromExits.map(e => e.y));
                lines.push({ x1: midX, y1: minY, x2: midX, y2: maxY, color: '#94a3b8' });
                // Horizontal from spine to entry
                lines.push({ x1: midX, y1: toEntries[0].y, x2: toEntries[0].x, y2: toEntries[0].y, color: '#94a3b8' });
            }
            // For parallel→parallel: each exit to corresponding entry, or cross-connect
            else {
                fromExits.forEach(fe => {
                    toEntries.forEach(te => {
                        lines.push({ x1: fe.x, y1: fe.y, x2: te.x, y2: te.y, color: '#cbd5e1', dashed: true });
                    });
                });
            }
        }

        // Intra-group connections for series groups
        groups.forEach(g => {
            if (g.type !== 'series') return;
            const gbs = positionedBlocks.filter(b => g.blocks.includes(b.id)).sort((a, b) => a.x - b.x);
            for (let i = 0; i < gbs.length - 1; i++) {
                lines.push({
                    x1: gbs[i].x + BLOCK_W, y1: gbs[i].y + BLOCK_H / 2,
                    x2: gbs[i + 1].x, y2: gbs[i + 1].y + BLOCK_H / 2,
                    color: groupColor('series'),
                });
            }
        });

        return lines;
    }, [positionedBlocks, groups]);

    // ── Dynamic viewBox (zoom-aware) ──
    const viewBox = useMemo(() => {
        if (positionedBlocks.length === 0) return `0 0 ${SVG_W} ${SVG_H}`;
        const maxX = Math.max(SVG_W, ...positionedBlocks.map(b => b.x + BLOCK_W + 80));
        const maxY = Math.max(SVG_H, ...positionedBlocks.map(b => b.y + BLOCK_H + 80));
        // Zoom: divide dimensions by zoom to make content appear larger
        return `0 0 ${maxX / zoom} ${maxY / zoom}`;
    }, [positionedBlocks, zoom]);

    // ── Topology-Aware Drag Handlers ──
    const toSVG = useCallback((clientX: number, clientY: number) => {
        if (!svgRef.current) return { x: 0, y: 0 };
        const rect = svgRef.current.getBoundingClientRect();
        const vb = svgRef.current.viewBox.baseVal;
        const scaleX = vb.width / rect.width;
        const scaleY = vb.height / rect.height;
        return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
    }, []);

    const onMouseDown = useCallback((blockId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        if (!onReorderBlock) return; // topology drag requires onReorderBlock
        const pt = toSVG(e.clientX, e.clientY);
        setTopoDrag({ blockId, startX: pt.x, startY: pt.y });
    }, [toSVG, onReorderBlock]);

    const onMouseMove = useCallback((e: React.MouseEvent) => {
        if (!topoDrag) return;
        const pt = toSVG(e.clientX, e.clientY);
        // Check which drop zone the cursor is over
        let found: typeof dropTarget = null;
        for (const zone of dropZones) {
            if (pt.x >= zone.x && pt.x <= zone.x + zone.w &&
                pt.y >= zone.y && pt.y <= zone.y + zone.h) {
                found = { groupId: zone.groupId, position: zone.position, label: zone.label };
                break;
            }
        }
        setDropTarget(found);
    }, [topoDrag, toSVG, dropZones]);

    const onMouseUp = useCallback(() => {
        if (topoDrag && dropTarget && onReorderBlock) {
            onReorderBlock(topoDrag.blockId, dropTarget.groupId, dropTarget.position);
        }
        setTopoDrag(null);
        setDropTarget(null);
    }, [topoDrag, dropTarget, onReorderBlock]);

    // ── Export ──
    const handleExportJSON = useCallback(() => {
        const data = JSON.stringify({ blocks: positionedBlocks, groups }, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url;
        a.download = `rbd_${new Date().toISOString().slice(0, 10)}.json`;
        a.click(); URL.revokeObjectURL(url);
    }, [positionedBlocks, groups]);

    const handleExportPNG = useCallback(() => {
        if (!svgRef.current) return;
        const svgData = new XMLSerializer().serializeToString(svgRef.current);
        const canvas = document.createElement('canvas');
        const vb = svgRef.current.viewBox.baseVal;
        canvas.width = vb.width * 2; canvas.height = vb.height * 2;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const img = new window.Image();
        img.onload = () => {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(blob => {
                if (!blob) return;
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url;
                a.download = `rbd_${new Date().toISOString().slice(0, 10)}.png`;
                a.click(); URL.revokeObjectURL(url);
            });
        };
        img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgData)))}`;
    }, []);

    const selectedBlock = positionedBlocks.find(b => b.id === selectedId);

    return (
        <div className="relative">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-wrap gap-2">
                    <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-slate-800">Block Diagram</span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 font-semibold">
                            {blocks.length} blocks · {groups.length} groups
                        </span>
                        {blocks.length > 0 && (
                            <>
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded-md font-semibold"
                                    style={{ backgroundColor: `${aoColor(systemAo)}15`, color: aoColor(systemAo) }}>
                                    Ao: {(systemAo * 100).toFixed(2)}%
                                </span>
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded-md font-semibold"
                                    style={{ backgroundColor: `${aoColor(systemR)}15`, color: aoColor(systemR) }}>
                                    R(t): {(systemR * 100).toFixed(2)}%
                                </span>
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-blue-50 text-blue-600 font-semibold">
                                    MTBF: {topoMTBF.toFixed(0)}h
                                </span>
                            </>
                        )}
                    </div>
                    <div className="flex items-center gap-1.5">
                        <button onClick={() => onAddBlock()}
                            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-cyan-700 bg-cyan-50 border border-cyan-200 rounded-lg hover:bg-cyan-100 transition-colors">
                            <Plus size={12} /> Add Block
                        </button>
                        <button onClick={() => setShowGroupModal(true)}
                            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-violet-700 bg-violet-50 border border-violet-200 rounded-lg hover:bg-violet-100 transition-colors">
                            <Layers size={12} /> Add Group
                        </button>
                        <div className="w-px h-5 bg-slate-200"></div>
                        <button onClick={handleExportJSON}
                            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-500 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100">
                            <Download size={12} /> JSON
                        </button>
                        <button onClick={handleExportPNG}
                            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-500 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100">
                            <Image size={12} /> PNG
                        </button>
                        <button onClick={() => setShowLegend(v => !v)}
                            className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-lg border transition-colors ${showLegend ? 'text-cyan-700 bg-cyan-50 border-cyan-200' : 'text-slate-500 bg-slate-50 border-slate-200 hover:bg-slate-100'}`}>
                            <Info size={12} /> Legend
                        </button>
                    </div>
                </div>

                {/* Drag hint + Backend status */}
                {blocks.length > 0 && (
                    <div className="px-4 py-1.5 border-b border-slate-50 bg-slate-50/50 flex items-center justify-between text-[10px] text-slate-400">
                        <span className="flex items-center gap-2">
                            <GripVertical size={10} /> {topoDrag ? '> Drag to a highlighted drop zone to change arrangement (series ↔ parallel)' : '* Drag blocks to rearrange topology · Click to edit · Ctrl+Scroll to zoom'}
                        </span>
                        <span className="flex items-center gap-1.5 text-emerald-500">
                            <Database size={10} /> Saves to Supabase via toolbar
                        </span>
                    </div>
                )}

                {/* SVG Canvas */}
                <div ref={containerRef} className="overflow-auto p-2 relative" style={{ maxHeight: 600 }}>
                    {/* Zoom Controls */}
                    <div className="absolute top-4 left-4 z-10 flex flex-col gap-1 bg-white/90 backdrop-blur-sm rounded-lg border border-slate-200 shadow-sm p-1">
                        <button onClick={zoomIn} title="Zoom In" className="p-1.5 hover:bg-slate-100 rounded transition-colors">
                            <ZoomIn size={14} className="text-slate-600" />
                        </button>
                        <button onClick={zoomReset} title={`Reset (${Math.round(zoom * 100)}%)`} className="px-1.5 py-0.5 hover:bg-slate-100 rounded transition-colors text-center">
                            <span className="text-[9px] font-mono font-semibold text-slate-500">{Math.round(zoom * 100)}%</span>
                        </button>
                        <button onClick={zoomOut} title="Zoom Out" className="p-1.5 hover:bg-slate-100 rounded transition-colors">
                            <ZoomOut size={14} className="text-slate-600" />
                        </button>
                        <div className="w-full h-px bg-slate-200"></div>
                        <button onClick={zoomReset} title="Reset Zoom" className="p-1.5 hover:bg-slate-100 rounded transition-colors">
                            <RotateCcw size={12} className="text-slate-400" />
                        </button>
                    </div>
                    <svg ref={svgRef}
                        viewBox={viewBox}
                        style={{
                            width: '100%', height: 'auto', minHeight: 450,
                            background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0',
                            cursor: topoDrag ? 'grabbing' : 'default',
                        }}
                        onMouseMove={onMouseMove}
                        onMouseUp={onMouseUp}
                        onMouseLeave={onMouseUp}
                        onClick={() => setSelectedId(null)}
                    >
                        {/* Grid pattern */}
                        <defs>
                            <pattern id="rbd-grid" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
                                <path d={`M ${GRID} 0 L 0 0 0 ${GRID}`} fill="none" stroke="#e2e8f0" strokeWidth={0.5} />
                            </pattern>
                            <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                                <polygon points="0 0, 8 3, 0 6" fill="#94a3b8" />
                            </marker>
                        </defs>
                        <rect width="100%" height="100%" fill="url(#rbd-grid)" />

                        {/* Group containers */}
                        {groups.map(g => {
                            const gbs = positionedBlocks.filter(b => g.blocks.includes(b.id));
                            if (gbs.length === 0) return null;
                            const minX = Math.min(...gbs.map(b => b.x)) - 14;
                            const minY = Math.min(...gbs.map(b => b.y)) - 28;
                            const maxX = Math.max(...gbs.map(b => b.x + BLOCK_W)) + 14;
                            const maxY = Math.max(...gbs.map(b => b.y + BLOCK_H)) + 14;
                            const color = groupColor(g.type);

                            return (
                                <g key={g.id}>
                                    <rect x={minX} y={minY} width={maxX - minX} height={maxY - minY}
                                        rx={10} fill={`${color}08`} stroke={color} strokeWidth={1.5} strokeDasharray="6,3" />
                                    <text x={minX + 8} y={minY + 14} fill={color} fontSize={10} fontWeight={700}>
                                        {g.label} ({g.type}{g.k ? ` k=${g.k}` : ''})
                                    </text>
                                    {/* Group remove button */}
                                    <g style={{ cursor: 'pointer' }}
                                        onClick={e => { e.stopPropagation(); onRemoveGroup(g.id); }}>
                                        <circle cx={maxX - 6} cy={minY + 6} r={7} fill="#fef2f2" stroke="#fca5a5" strokeWidth={1} />
                                        <text x={maxX - 6} y={minY + 9} fill="#ef4444" fontSize={8} textAnchor="middle">✕</text>
                                    </g>
                                </g>
                            );
                        })}

                        {/* ★ Topology-aware connection lines */}
                        {connectionLines.map((l, i) => (
                            <line key={`conn-${i}`}
                                x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                                stroke={l.color} strokeWidth={1.5}
                                strokeDasharray={l.dashed ? '4,2' : undefined}
                                markerEnd={!l.dashed ? 'url(#arrowhead)' : undefined} />
                        ))}

                        {/* System IN/OUT markers */}
                        {positionedBlocks.length > 0 && (
                            <>
                                {/* IN marker */}
                                {(() => {
                                    const firstBlocks = positionedBlocks.filter(b => {
                                        // Blocks that aren't the target of any connection line
                                        return !connectionLines.some(l => Math.abs(l.x2 - b.x) < 5 && Math.abs(l.y2 - (b.y + BLOCK_H / 2)) < 5);
                                    });
                                    const first = firstBlocks.length > 0
                                        ? firstBlocks.reduce((a, b) => a.x < b.x ? a : b)
                                        : positionedBlocks.reduce((a, b) => a.x < b.x ? a : b);
                                    return (
                                        <g>
                                            <line x1={0} y1={first.y + BLOCK_H / 2}
                                                x2={first.x} y2={first.y + BLOCK_H / 2}
                                                stroke="#94a3b8" strokeWidth={2} />
                                            <circle cx={10} cy={first.y + BLOCK_H / 2} r={8} fill="#e2e8f0" stroke="#94a3b8" />
                                            <text x={10} y={first.y + BLOCK_H / 2 + 3.5}
                                                fill="#475569" fontSize={7} fontWeight={700} textAnchor="middle">IN</text>
                                        </g>
                                    );
                                })()}
                                {/* OUT marker */}
                                {(() => {
                                    const last = positionedBlocks.reduce((a, b) => a.x > b.x ? a : b);
                                    const vb = svgRef.current?.viewBox.baseVal;
                                    const outX = vb ? vb.width - 10 : Math.max(SVG_W, last.x + BLOCK_W + 60);
                                    return (
                                        <g>
                                            <line x1={last.x + BLOCK_W} y1={last.y + BLOCK_H / 2}
                                                x2={outX} y2={last.y + BLOCK_H / 2}
                                                stroke="#94a3b8" strokeWidth={2} />
                                            <circle cx={outX - 2} cy={last.y + BLOCK_H / 2} r={8} fill="#e2e8f0" stroke="#94a3b8" />
                                            <text x={outX - 2} y={last.y + BLOCK_H / 2 + 3.5}
                                                fill="#475569" fontSize={7} fontWeight={700} textAnchor="middle">OUT</text>
                                        </g>
                                    );
                                })()}
                            </>
                        )}

                        {/* Blocks */}
                        {positionedBlocks.map(b => {
                            const ao = blockAvailability(b);
                            const color = aoColor(ao);
                            const isSelected = b.id === selectedId;
                            const isDragging = topoDrag?.blockId === b.id;

                            return (
                                <g key={b.id}
                                    style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
                                    onMouseDown={e => onMouseDown(b.id, e)}
                                    onClick={e => {
                                        e.stopPropagation();
                                        if (e.ctrlKey || e.metaKey) {
                                            setMultiSelect(prev => {
                                                const next = new Set(prev);
                                                if (next.has(b.id)) next.delete(b.id); else next.add(b.id);
                                                return next;
                                            });
                                        } else {
                                            setSelectedId(b.id);
                                            setMultiSelect(new Set());
                                        }
                                    }}
                                >
                                    {/* Selection ring */}
                                    {(isSelected || multiSelect.has(b.id)) && (
                                        <rect x={b.x - 3} y={b.y - 3} width={BLOCK_W + 6} height={BLOCK_H + 6}
                                            rx={10} fill="none"
                                            stroke={multiSelect.has(b.id) ? '#8b5cf6' : '#06b6d4'}
                                            strokeWidth={2} strokeDasharray="4,2">
                                            <animate attributeName="stroke-dashoffset" values="0;12" dur="1s" repeatCount="indefinite" />
                                        </rect>
                                    )}

                                    {/* Block rectangle */}
                                    <rect x={b.x} y={b.y} width={BLOCK_W} height={BLOCK_H}
                                        rx={8} fill="white" stroke={isSelected ? '#06b6d4' : '#e2e8f0'} strokeWidth={isSelected ? 2 : 1.5}
                                        filter={isDragging ? 'drop-shadow(0 4px 6px rgba(0,0,0,0.12))' : undefined} />

                                    {/* Availability indicator stripe */}
                                    <rect x={b.x} y={b.y} width={4} height={BLOCK_H} rx={2} fill={color} />

                                    {/* Name */}
                                    <text x={b.x + 14} y={b.y + 18} fill="#1e293b" fontSize={11} fontWeight={700}>
                                        {b.name.length > 18 ? b.name.slice(0, 18) + '…' : b.name}
                                    </text>

                                    {/* Asset tag badge — shown when linked to Asset Register */}
                                    {b.assetTag && (
                                        <g>
                                            <rect x={b.x + BLOCK_W - 60} y={b.y + 6} width={50} height={16} rx={4}
                                                fill="#f0fdfa" stroke="#99f6e4" strokeWidth={0.8} />
                                            <text x={b.x + BLOCK_W - 35} y={b.y + 17} fill="#0d9488" fontSize={8}
                                                fontWeight={700} textAnchor="middle" fontFamily="monospace">
                                                {b.assetTag.length > 8 ? b.assetTag.slice(0, 8) : b.assetTag}
                                            </text>
                                        </g>
                                    )}

                                    {/* Metrics row */}
                                    <text x={b.x + 14} y={b.y + 34} fill="#64748b" fontSize={9}>
                                        MTBF: {b.mtbf.toLocaleString()}h · MTTR: {b.mttr}h
                                    </text>
                                    <text x={b.x + 14} y={b.y + 48} fill="#64748b" fontSize={9}>
                                        λ: {b.failureRate}/yr · {b.config}
                                    </text>

                                    {/* Availability badge */}
                                    <rect x={b.x + 14} y={b.y + 58} width={64} height={20} rx={5}
                                        fill={`${color}15`} />
                                    <text x={b.x + 46} y={b.y + 72} fill={color} fontSize={10} fontWeight={700} textAnchor="middle">
                                        Ao: {(ao * 100).toFixed(2)}%
                                    </text>

                                    {/* Connection ports */}
                                    <circle cx={b.x} cy={b.y + BLOCK_H / 2} r={5} fill="white" stroke="#94a3b8" strokeWidth={1.5} />
                                    <circle cx={b.x + BLOCK_W} cy={b.y + BLOCK_H / 2} r={5} fill="white" stroke="#94a3b8" strokeWidth={1.5} />

                                    {/* Drag handle icon */}
                                    <g opacity={0.3}>
                                        <rect x={b.x + BLOCK_W - 18} y={b.y + 4} width={12} height={12} rx={2} fill="none" />
                                        {[0, 4, 8].map(dy => (
                                            <g key={dy}>
                                                <circle cx={b.x + BLOCK_W - 14} cy={b.y + 7 + dy} r={1.2} fill="#94a3b8" />
                                                <circle cx={b.x + BLOCK_W - 9} cy={b.y + 7 + dy} r={1.2} fill="#94a3b8" />
                                            </g>
                                        ))}
                                    </g>
                                </g>
                            );
                        })}

                        {/* ★ Topology Drop Zones — shown when dragging a block */}
                        {topoDrag && dropZones.map(zone => {
                            const isHovered = dropTarget?.groupId === zone.groupId && dropTarget?.position === zone.position;
                            return (
                                <g key={zone.id}>
                                    <rect
                                        x={zone.x} y={zone.y}
                                        width={zone.w} height={zone.h}
                                        rx={8}
                                        fill={isHovered ? '#06b6d420' : '#f1f5f910'}
                                        stroke={isHovered ? '#06b6d4' : '#94a3b8'}
                                        strokeWidth={isHovered ? 2.5 : 1.5}
                                        strokeDasharray={isHovered ? undefined : '6,3'}
                                    >
                                        {isHovered && (
                                            <animate attributeName="stroke-dashoffset" values="0;12" dur="0.5s" repeatCount="indefinite" />
                                        )}
                                    </rect>
                                    <text
                                        x={zone.x + zone.w / 2}
                                        y={zone.y + zone.h / 2 + 4}
                                        fill={isHovered ? '#0891b2' : '#94a3b8'}
                                        fontSize={10}
                                        fontWeight={isHovered ? 700 : 500}
                                        textAnchor="middle"
                                    >
                                        {zone.label}
                                    </text>
                                </g>
                            );
                        })}

                        {/* Empty state */}
                        {blocks.length === 0 && (
                            <text x={SVG_W / 2} y={SVG_H / 2} fill="#94a3b8" fontSize={13}
                                textAnchor="middle" fontWeight={500}>
                                Click "Add Block" to start building your RBD
                            </text>
                        )}
                    </svg>

                    {/* Legend panel */}
                    {showLegend && (
                        <div className="absolute bottom-4 right-4 z-10 bg-white/95 backdrop-blur-sm rounded-lg border border-slate-200 shadow-sm p-3 w-56">
                            <h5 className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-2">Legend</h5>
                            <div className="space-y-1.5 text-[10px] text-slate-600">
                                <div className="flex items-center gap-2">
                                    <svg width="24" height="8"><line x1="0" y1="4" x2="24" y2="4" stroke="#94a3b8" strokeWidth="2" /></svg>
                                    <span>Series connection (solid)</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <svg width="24" height="8"><line x1="0" y1="4" x2="24" y2="4" stroke="#cbd5e1" strokeWidth="1.5" strokeDasharray="4,2" /></svg>
                                    <span>Cross-connection (dashed)</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <svg width="24" height="14"><rect x="0" y="0" width="24" height="14" rx="3" fill="none" stroke="#06b6d4" strokeWidth="1.5" strokeDasharray="4,2" /></svg>
                                    <span>Dashed border = Group boundary</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-1 h-4 rounded-sm bg-emerald-500"></div>
                                    <span>Green stripe = Ao ≥ 99%</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-1 h-4 rounded-sm bg-amber-500"></div>
                                    <span>Amber stripe = Ao 95-99%</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-1 h-4 rounded-sm bg-red-500"></div>
                                    <span>Red stripe = Ao &lt; 95%</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <svg width="14" height="14"><circle cx="7" cy="7" r="5" fill="white" stroke="#94a3b8" strokeWidth="1.5" /></svg>
                                    <span>Connection port (input/output)</span>
                                </div>
                                <p className="text-[9px] text-slate-400 pt-1 border-t border-slate-100">Ctrl+click blocks for multi-select</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Group Summary Table */}
                {groups.length > 0 && (
                    <div className="px-4 py-3 border-t border-slate-100">
                        <h4 className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-2">Group Summary</h4>
                        <div className="overflow-x-auto">
                            <table className="w-full text-[11px]">
                                <thead>
                                    <tr className="text-slate-500 border-b border-slate-100">
                                        <th className="py-1 text-left font-semibold">Group</th>
                                        <th className="py-1 text-left font-semibold">Config</th>
                                        <th className="py-1 text-center font-semibold">Blocks</th>
                                        <th className="py-1 text-center font-semibold">Group Ao</th>
                                        <th className="py-1 text-center font-semibold">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {groups.map(g => {
                                        const gbs = blocks.filter(b => g.blocks.includes(b.id));
                                        let gAo = 0;
                                        if (gbs.length > 0) {
                                            if (g.type === 'parallel') {
                                                gAo = 1 - gbs.reduce((p, b) => p * (1 - blockAvailability(b)), 1);
                                            } else if (g.type === 'series') {
                                                gAo = gbs.reduce((p, b) => p * blockAvailability(b), 1);
                                            } else {
                                                gAo = gbs.reduce((s, b) => s + blockAvailability(b), 0) / gbs.length;
                                            }
                                        }
                                        return (
                                            <tr key={g.id} className="border-b border-slate-50 hover:bg-slate-50">
                                                <td className="py-1.5 font-medium text-slate-700">{g.label}</td>
                                                <td className="py-1.5">
                                                    <span className="px-1.5 py-0.5 rounded text-white text-[10px] font-semibold"
                                                        style={{ backgroundColor: groupColor(g.type) }}>{g.type}</span>
                                                </td>
                                                <td className="py-1.5 text-center text-slate-600">{gbs.length}</td>
                                                <td className="py-1.5 text-center font-mono font-semibold"
                                                    style={{ color: aoColor(gAo) }}>
                                                    {gbs.length > 0 ? `${(gAo * 100).toFixed(2)}%` : '—'}
                                                </td>
                                                <td className="py-1.5 text-center">
                                                    <button onClick={() => onRemoveGroup(g.id)}
                                                        className="text-red-400 hover:text-red-600 transition-colors">
                                                        <Trash2 size={12} />
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* ═══ SYSTEM RELIABILITY ENGINE PANELS ═══ */}
                {blocks.length > 0 && (
                    <RBDReliabilityDashboard
                        blocks={blocks.length}
                        systemR={systemR}
                        systemF={systemF}
                        topoMTBF={topoMTBF}
                        expectedFailures={expectedFailures}
                        missionTime={missionTime}
                        onMissionTimeChange={setMissionTime}
                        targetReliability={targetReliability}
                        onTargetChange={setTargetReliability}
                        blockRValues={blockRValues}
                        sensitivityData={sensitivityData}
                        requirementGaps={requirementGaps}
                        kofnGroups={kofnGroups}
                        reliabilityCurve={reliabilityCurve}
                    />
                )}
            </div>

            {/* Edit Popover — ★ key={selectedBlock.id} forces remount to reset local state */}
            {selectedBlock && (
                <EditPopover
                    key={selectedBlock.id}
                    block={selectedBlock}
                    groups={groups}
                    onUpdate={u => onUpdateBlock(selectedBlock.id, u)}
                    onAssign={gId => onAssignBlockToGroup(selectedBlock.id, gId)}
                    onRemove={() => { onRemoveBlock(selectedBlock.id); setSelectedId(null); }}
                    onClose={() => setSelectedId(null)}
                    onInsertSeries={onInsertBlock ? () => { onInsertBlock(selectedBlock.id, 'series'); setSelectedId(null); } : undefined}
                    onInsertParallel={onInsertBlock ? () => { onInsertBlock(selectedBlock.id, 'parallel'); setSelectedId(null); } : undefined}
                    onLinkAsset={onLinkAsset ? (asset) => { onLinkAsset(selectedBlock.id, asset); } : undefined}
                />
            )}

            {/* Group Modal */}
            {showGroupModal && (
                <AddGroupModal onAdd={onAddGroup} onClose={() => setShowGroupModal(false)} />
            )}
        </div>
    );
};

// Factorial helper for k-of-n
function factorial(n: number): number {
    if (n <= 1) return 1;
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
}

export default ReliabilityBlockDiagram;
