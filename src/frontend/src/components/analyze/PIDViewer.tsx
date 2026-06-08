/**
 * PIDViewer — Interactive P&ID Viewer with upload, draw-from-scratch, and asset linking
 *
 * ISA 5.1 standard symbols. Upload a P&ID image as background,
 * overlay equipment markers, draw connections, heat map overlay.
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
    Eye, EyeOff, Flame, ZoomIn, ZoomOut, Upload, Plus, Link2, X,
    Trash2, Download, Image, MousePointer, Settings, ExternalLink, Search as SearchIcon, Unlink,
} from 'lucide-react';
import { supabase } from '../../eam/lib/supabase';

export interface PIDEquipment {
    id: string;
    type: 'pump' | 'compressor' | 'vessel' | 'heat_exchanger' | 'valve' |
    'motor' | 'turbine' | 'separator' | 'column' | 'tank' |
    'transmitter' | 'controller' | 'indicator' | 'pipe';
    label: string;
    x: number;
    y: number;
    assetId?: string;
    assetTag?: string;
    criticality?: string;
    healthIndex?: number;
    woCount?: number;
}

export interface PIDConnection {
    id: string;
    fromId: string;
    toId: string;
    type: 'process' | 'instrument' | 'signal' | 'electrical';
}

interface PIDViewerProps {
    equipment: PIDEquipment[];
    connections: PIDConnection[];
    title?: string;
    onEquipmentClick?: (equipId: string, assetId?: string) => void;
    showHeatMap?: boolean;
    highlightedEquipmentId?: string;
    backgroundImage?: string | null;
    onUploadImage?: (file: File) => void;
    onAddEquipment?: (type: PIDEquipment['type'], label: string, x: number, y: number) => void;
    onRemoveEquipment?: (eqId: string) => void;
    onUpdateEquipment?: (eqId: string, updates: Partial<PIDEquipment>) => void;
    onMoveEquipment?: (eqId: string, x: number, y: number) => void;
    onAddConnection?: (fromId: string, toId: string, type: PIDConnection['type']) => void;
    onRemoveConnection?: (connId: string) => void;
}

type DrawMode = 'select' | 'place' | 'connect';
type PlacingType = PIDEquipment['type'] | null;
const GRID = 20;
const snap = (v: number) => Math.round(v / GRID) * GRID;

// ─── Equipment Type labels ──────────────────────────────────
const EQUIPMENT_TYPES: { type: PIDEquipment['type']; label: string; abbr: string }[] = [
    { type: 'pump', label: 'Pump', abbr: 'P' },
    { type: 'compressor', label: 'Compressor', abbr: 'K' },
    { type: 'vessel', label: 'Vessel', abbr: 'V' },
    { type: 'heat_exchanger', label: 'Heat Exchanger', abbr: 'E' },
    { type: 'valve', label: 'Valve', abbr: 'XV' },
    { type: 'motor', label: 'Motor', abbr: 'M' },
    { type: 'turbine', label: 'Turbine', abbr: 'GT' },
    { type: 'separator', label: 'Separator', abbr: 'V' },
    { type: 'column', label: 'Column', abbr: 'C' },
    { type: 'tank', label: 'Tank', abbr: 'TK' },
    { type: 'transmitter', label: 'Transmitter', abbr: 'PT' },
    { type: 'controller', label: 'Controller', abbr: 'FIC' },
    { type: 'indicator', label: 'Indicator', abbr: 'PI' },
];

// ─── ISA 5.1 Symbol Rendering (light theme) ─────────────────
const SYMBOLS: Record<string, (x: number, y: number, color: string) => React.ReactNode> = {
    pump: (x, y, c) => (
        <g>
            <circle cx={x} cy={y} r={18} fill="white" stroke={c} strokeWidth={2} />
            <path d={`M${x - 6} ${y + 8} L${x} ${y - 10} L${x + 6} ${y + 8}`} fill="none" stroke={c} strokeWidth={1.5} />
        </g>
    ),
    compressor: (x, y, c) => (
        <g>
            <circle cx={x} cy={y} r={18} fill="white" stroke={c} strokeWidth={2} />
            <path d={`M${x - 10} ${y} L${x + 10} ${y} M${x} ${y - 10} L${x} ${y + 10}`} stroke={c} strokeWidth={1.5} />
        </g>
    ),
    vessel: (x, y, c) => (
        <g>
            <rect x={x - 14} y={y - 22} width={28} height={44} rx={14} fill="white" stroke={c} strokeWidth={2} />
        </g>
    ),
    heat_exchanger: (x, y, c) => (
        <g>
            <circle cx={x} cy={y} r={18} fill="white" stroke={c} strokeWidth={2} />
            <line x1={x - 12} y1={y} x2={x + 12} y2={y} stroke={c} strokeWidth={1.5} />
        </g>
    ),
    valve: (x, y, c) => (
        <g>
            <path d={`M${x - 10} ${y - 10} L${x + 10} ${y + 10} M${x + 10} ${y - 10} L${x - 10} ${y + 10}`}
                fill="none" stroke={c} strokeWidth={2} />
            <path d={`M${x - 10} ${y - 10} L${x + 10} ${y - 10} L${x} ${y} Z`} fill={`${c}22`} stroke={c} strokeWidth={1} />
            <path d={`M${x - 10} ${y + 10} L${x + 10} ${y + 10} L${x} ${y} Z`} fill={`${c}22`} stroke={c} strokeWidth={1} />
        </g>
    ),
    motor: (x, y, c) => (
        <g>
            <circle cx={x} cy={y} r={16} fill="white" stroke={c} strokeWidth={2} />
            <text x={x} y={y + 4} fill={c} fontSize={12} fontWeight={700} textAnchor="middle">M</text>
        </g>
    ),
    turbine: (x, y, c) => (
        <g>
            <polygon points={`${x - 18},${y + 14} ${x - 6},${y - 14} ${x + 6},${y - 14} ${x + 18},${y + 14}`}
                fill="white" stroke={c} strokeWidth={2} />
        </g>
    ),
    separator: (x, y, c) => (
        <g>
            <rect x={x - 20} y={y - 14} width={40} height={28} rx={4} fill="white" stroke={c} strokeWidth={2} />
            <line x1={x - 14} y1={y} x2={x + 14} y2={y} stroke={c} strokeWidth={1} strokeDasharray="3,2" />
        </g>
    ),
    column: (x, y, c) => (
        <g>
            <rect x={x - 10} y={y - 28} width={20} height={56} rx={10} fill="white" stroke={c} strokeWidth={2} />
            {[0, 1, 2, 3].map(i => (
                <line key={i} x1={x - 6} y1={y - 18 + i * 12} x2={x + 6} y2={y - 18 + i * 12} stroke={c} strokeWidth={0.8} />
            ))}
        </g>
    ),
    tank: (x, y, c) => (
        <g>
            <rect x={x - 16} y={y - 16} width={32} height={32} rx={2} fill="white" stroke={c} strokeWidth={2} />
            <line x1={x - 14} y1={y + 4} x2={x + 14} y2={y + 4} stroke={c} strokeWidth={1} />
        </g>
    ),
    transmitter: (x, y, c) => (
        <g>
            <circle cx={x} cy={y} r={12} fill="white" stroke={c} strokeWidth={1.5} />
            <text x={x} y={y + 3} fill={c} fontSize={8} fontWeight={600} textAnchor="middle">T</text>
        </g>
    ),
    controller: (x, y, c) => (
        <g>
            <rect x={x - 12} y={y - 12} width={24} height={24} rx={2} fill="white" stroke={c} strokeWidth={1.5} />
            <text x={x} y={y + 3} fill={c} fontSize={8} fontWeight={600} textAnchor="middle">C</text>
        </g>
    ),
    indicator: (x, y, c) => (
        <g>
            <circle cx={x} cy={y} r={12} fill="white" stroke={c} strokeWidth={1.5} strokeDasharray="3,2" />
            <text x={x} y={y + 3} fill={c} fontSize={8} fontWeight={600} textAnchor="middle">I</text>
        </g>
    ),
    pipe: (x, y, c) => (
        <g>
            <line x1={x - 16} y1={y} x2={x + 16} y2={y} stroke={c} strokeWidth={3} />
        </g>
    ),
};

function getHeatColor(woCount: number): string {
    if (woCount >= 10) return '#dc2626';
    if (woCount >= 5) return '#d97706';
    if (woCount >= 2) return '#2563eb';
    return '#16a34a';
}

function getCritColor(crit?: string): string {
    if (crit === 'A') return '#dc2626';
    if (crit === 'B') return '#d97706';
    return '#16a34a';
}

// ─── Equipment Edit Popover ─────────────────────────────────

const EquipmentEditPopover: React.FC<{
    eq: PIDEquipment;
    onUpdate: (updates: Partial<PIDEquipment>) => void;
    onRemove: () => void;
    onClose: () => void;
}> = ({ eq, onUpdate, onRemove, onClose }) => {
    const [label, setLabel] = useState(eq.label);
    const [criticality, setCriticality] = useState(eq.criticality || 'C');

    // ── Asset search state (same pattern as RBD EditPopover) ──
    const [assetQuery, setAssetQuery] = useState('');
    const [assetResults, setAssetResults] = useState<{ id: string; name: string; tag: string }[]>([]);
    const [assetOpen, setAssetOpen] = useState(false);
    const [searchingAsset, setSearchingAsset] = useState(false);

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

    const handleLinkAsset = (asset: { id: string; name: string; tag: string }) => {
        onUpdate({ assetId: asset.id, assetTag: asset.tag });
        setAssetOpen(false);
        setAssetQuery('');
    };

    const handleUnlinkAsset = () => {
        onUpdate({ assetId: undefined, assetTag: undefined, healthIndex: undefined, woCount: undefined });
    };

    return (
        <div className="absolute z-50 bg-white rounded-xl shadow-xl border border-slate-200 p-4 w-80 animate-in fade-in zoom-in-95 duration-200"
            style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    <Settings size={14} className="text-cyan-500" /> Edit {eq.type}
                </h4>
                <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded"><X size={14} /></button>
            </div>
            <div className="space-y-2">
                <div>
                    <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Label / Tag</label>
                    <input value={label} onChange={e => setLabel(e.target.value)}
                        className="w-full mt-0.5 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-cyan-200 outline-none" />
                </div>
                <div>
                    <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Criticality</label>
                    <select value={criticality} onChange={e => setCriticality(e.target.value)}
                        className="w-full mt-0.5 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 outline-none">
                        <option value="A">A — Safety Critical</option>
                        <option value="B">B — Production Critical</option>
                        <option value="C">C — General</option>
                    </select>
                </div>

                {/* ★ ASSET LINKING — connect equipment to Asset Register */}
                <div className="pt-2 border-t border-slate-100">
                    <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                        <Link2 size={10} /> Link to Asset Register
                    </label>
                    {eq.assetId ? (
                        <div className="space-y-1.5">
                            <div className="flex items-center gap-2 p-2 bg-emerald-50 border border-emerald-200 rounded-lg">
                                <div className="flex-1 min-w-0">
                                    <span className="text-[11px] font-bold text-emerald-700 font-mono">{eq.assetTag || eq.assetId}</span>
                                    <p className="text-[9px] text-emerald-600 truncate">Linked to Asset Register</p>
                                </div>
                                <button onClick={handleUnlinkAsset}
                                    className="p-1 text-emerald-500 hover:text-red-500 hover:bg-red-50 rounded transition-colors" title="Unlink asset">
                                    <Unlink size={12} />
                                </button>
                            </div>
                            <button
                                onClick={() => { window.location.href = `/assets?select=${eq.assetId}`; }}
                                className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold text-cyan-700 bg-cyan-50 border border-cyan-200 rounded-lg hover:bg-cyan-100 transition-colors"
                            >
                                <ExternalLink size={10} /> Open in Asset Register
                            </button>
                        </div>
                    ) : (
                        <div className="relative">
                            <div className="flex items-center gap-2 border border-slate-200 rounded-lg px-2.5 py-1.5 bg-slate-50">
                                <SearchIcon size={12} className="text-slate-400 shrink-0" />
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
                                        <button key={a.id} onClick={() => handleLinkAsset(a)}
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

                <div className="flex justify-between pt-2 border-t border-slate-100">
                    <button onClick={onRemove}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                        <Trash2 size={12} /> Remove
                    </button>
                    <div className="flex gap-2">
                        <button onClick={onClose} className="px-3 py-1 text-xs text-slate-500 hover:bg-slate-100 rounded-lg">Cancel</button>
                        <button onClick={() => { onUpdate({ label, criticality }); onClose(); }}
                            className="px-3 py-1 text-xs bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 font-medium">Save</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════════════════

const PIDViewer: React.FC<PIDViewerProps> = ({
    equipment,
    connections,
    title = 'P&ID',
    onEquipmentClick,
    showHeatMap = false,
    highlightedEquipmentId,
    backgroundImage,
    onUploadImage,
    onAddEquipment,
    onRemoveEquipment,
    onUpdateEquipment,
    onMoveEquipment,
    onAddConnection,
    onRemoveConnection,
}) => {
    const [zoom, setZoom] = useState(1);
    const [showLabels, setShowLabels] = useState(true);
    const [heatMapOn, setHeatMapOn] = useState(showHeatMap);
    const [drawMode, setDrawMode] = useState<DrawMode>('select');
    const [placingType, setPlacingType] = useState<PlacingType>(null);
    const [connectFrom, setConnectFrom] = useState<string | null>(null);
    const [connectionType, setConnectionType] = useState<PIDConnection['type']>('process');
    const [selectedEqId, setSelectedEqId] = useState<string | null>(null);
    const [showPalette, setShowPalette] = useState(false);
    const [dragging, setDragging] = useState<{ id: string; offX: number; offY: number } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const svgRef = useRef<SVGSVGElement>(null);

    const SVG_WIDTH = 900;
    const SVG_HEIGHT = 500;

    const selectedEq = equipment.find(e => e.id === selectedEqId);

    // ── SVG coordinate conversion ──
    const toSVG = useCallback((clientX: number, clientY: number) => {
        if (!svgRef.current) return { x: 0, y: 0 };
        const rect = svgRef.current.getBoundingClientRect();
        const scaleX = SVG_WIDTH / rect.width;
        const scaleY = SVG_HEIGHT / rect.height;
        return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
    }, [SVG_WIDTH, SVG_HEIGHT]);

    // ── Drag handlers ──
    const onDragStart = useCallback((eqId: string, e: React.MouseEvent) => {
        if (drawMode !== 'select' || !onMoveEquipment) return;
        e.stopPropagation();
        e.preventDefault();
        const eq = equipment.find(eq => eq.id === eqId);
        if (!eq) return;
        const pt = toSVG(e.clientX, e.clientY);
        setDragging({ id: eqId, offX: pt.x - eq.x, offY: pt.y - eq.y });
    }, [drawMode, equipment, toSVG, onMoveEquipment]);

    const onDragMove = useCallback((e: React.MouseEvent) => {
        if (!dragging || !onMoveEquipment) return;
        const pt = toSVG(e.clientX, e.clientY);
        const x = snap(pt.x - dragging.offX);
        const y = snap(pt.y - dragging.offY);
        onMoveEquipment(dragging.id, Math.max(20, Math.min(x, SVG_WIDTH - 20)), Math.max(20, Math.min(y, SVG_HEIGHT - 20)));
    }, [dragging, toSVG, onMoveEquipment, SVG_WIDTH, SVG_HEIGHT]);

    const onDragEnd = useCallback(() => {
        setDragging(null);
    }, []);

    // Handle canvas click
    const handleCanvasClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
        if (drawMode === 'place' && placingType && onAddEquipment) {
            const svg = svgRef.current;
            if (!svg) return;
            const rect = svg.getBoundingClientRect();
            const scaleX = SVG_WIDTH / rect.width;
            const scaleY = SVG_HEIGHT / rect.height;
            const x = Math.round((e.clientX - rect.left) * scaleX);
            const y = Math.round((e.clientY - rect.top) * scaleY);
            const abbr = EQUIPMENT_TYPES.find(t => t.type === placingType)?.abbr || 'EQ';
            const count = equipment.filter(eq => eq.type === placingType).length + 1;
            onAddEquipment(placingType, `${abbr}-${String(count).padStart(3, '0')}`, x, y);
        } else {
            setSelectedEqId(null);
            setConnectFrom(null);
        }
    }, [drawMode, placingType, onAddEquipment, equipment, dragging]);

    // Handle equipment click
    const handleEquipClick = useCallback((eqId: string) => {
        if (drawMode === 'connect') {
            if (!connectFrom) {
                setConnectFrom(eqId);
            } else if (connectFrom !== eqId && onAddConnection) {
                onAddConnection(connectFrom, eqId, connectionType);
                setConnectFrom(null);
            }
        } else if (drawMode === 'select' && !dragging) {
            setSelectedEqId(eqId);
            const eq = equipment.find(e => e.id === eqId);
            onEquipmentClick?.(eqId, eq?.assetId);
        }
    }, [drawMode, connectFrom, onAddConnection, connectionType, equipment, onEquipmentClick, dragging]);

    // Export PNG
    const handleExportPNG = useCallback(() => {
        if (!svgRef.current) return;
        const svgData = new XMLSerializer().serializeToString(svgRef.current);
        const canvas = document.createElement('canvas');
        canvas.width = SVG_WIDTH * 2; canvas.height = SVG_HEIGHT * 2;
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
                const a = document.createElement('a');
                a.href = url; a.download = `pid_${new Date().toISOString().slice(0, 10)}.png`;
                a.click(); URL.revokeObjectURL(url);
            });
        };
        img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgData)))}`;
    }, [SVG_WIDTH, SVG_HEIGHT]);

    // Export JSON
    const handleExportJSON = useCallback(() => {
        const data = JSON.stringify({ equipment, connections }, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `pid_${new Date().toISOString().slice(0, 10)}.json`;
        a.click(); URL.revokeObjectURL(url);
    }, [equipment, connections]);

    return (
        <div className="relative">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
                {/* ── Toolbar ── */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-wrap gap-2">
                    <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-slate-800">{title}</span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 font-semibold">
                            {equipment.length} items · {connections.length} connections
                        </span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                        {/* Drawing mode buttons */}
                        <button onClick={() => { setDrawMode('select'); setPlacingType(null); setConnectFrom(null); }}
                            className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-lg transition-colors border ${drawMode === 'select' ? 'bg-cyan-50 text-cyan-700 border-cyan-200' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'}`}>
                            <MousePointer size={12} /> Select
                        </button>
                        <button onClick={() => { setDrawMode('place'); setShowPalette(!showPalette); setConnectFrom(null); }}
                            className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-lg transition-colors border ${drawMode === 'place' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'}`}>
                            <Plus size={12} /> Place
                        </button>
                        <button onClick={() => { setDrawMode('connect'); setPlacingType(null); }}
                            className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-lg transition-colors border ${drawMode === 'connect' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'}`}>
                            <Link2 size={12} /> Connect
                        </button>

                        <div className="w-px h-5 bg-slate-200 mx-1"></div>

                        {/* View toggles */}
                        <button onClick={() => setHeatMapOn(!heatMapOn)}
                            className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-lg transition-colors border ${heatMapOn ? 'bg-red-50 text-red-600 border-red-200' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'}`}>
                            <Flame size={12} /> Heat Map
                        </button>
                        <button onClick={() => setShowLabels(!showLabels)}
                            className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-lg transition-colors border ${showLabels ? 'bg-slate-100 text-slate-700 border-slate-200' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>
                            {showLabels ? <Eye size={12} /> : <EyeOff size={12} />} Labels
                        </button>
                        <button onClick={() => setZoom(z => Math.min(z + 0.2, 2))}
                            className="p-1.5 bg-slate-50 text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-100">
                            <ZoomIn size={13} />
                        </button>
                        <button onClick={() => setZoom(z => Math.max(z - 0.2, 0.5))}
                            className="p-1.5 bg-slate-50 text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-100">
                            <ZoomOut size={13} />
                        </button>

                        <div className="w-px h-5 bg-slate-200 mx-1"></div>

                        {/* Upload & Export */}
                        {onUploadImage && (
                            <>
                                <input ref={fileInputRef} type="file" accept=".png,.jpg,.jpeg,.svg,.webp,.pdf"
                                    className="hidden" onChange={e => { if (e.target.files?.[0]) onUploadImage(e.target.files[0]); }} />
                                <button onClick={() => fileInputRef.current?.click()}
                                    className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-amber-600 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors">
                                    <Upload size={12} /> Upload P&ID
                                </button>
                            </>
                        )}
                        <button onClick={handleExportJSON}
                            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-500 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100">
                            <Download size={12} /> JSON
                        </button>
                        <button onClick={handleExportPNG}
                            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-500 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100">
                            <Image size={12} /> PNG
                        </button>
                    </div>
                </div>

                {/* ── Equipment Palette (when Place mode active) ── */}
                {drawMode === 'place' && showPalette && (
                    <div className="px-4 py-2 border-b border-slate-100 bg-green-50/50">
                        <p className="text-[10px] text-green-700 font-semibold mb-1.5">
                            Select equipment type, then click on the canvas to place:
                        </p>
                        <div className="flex flex-wrap gap-1">
                            {EQUIPMENT_TYPES.map(t => (
                                <button key={t.type}
                                    onClick={() => setPlacingType(t.type)}
                                    className={`px-2 py-1 text-[10px] font-medium rounded-md border transition-colors ${placingType === t.type
                                        ? 'bg-green-600 text-white border-green-600'
                                        : 'bg-white text-slate-600 border-slate-200 hover:bg-green-50 hover:border-green-300'
                                        }`}
                                >
                                    {t.label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* ── Connect mode info ── */}
                {drawMode === 'connect' && (
                    <div className="px-4 py-2 border-b border-slate-100 bg-indigo-50/50">
                        <div className="flex items-center gap-3">
                            <p className="text-[10px] text-indigo-700 font-semibold">
                                {connectFrom
                                    ? `From: ${equipment.find(e => e.id === connectFrom)?.label || connectFrom} → Click target equipment`
                                    : 'Click source equipment to start connection'}
                            </p>
                            <select value={connectionType} onChange={e => setConnectionType(e.target.value as PIDConnection['type'])}
                                className="text-[10px] px-2 py-0.5 bg-white border border-indigo-200 rounded text-indigo-700 outline-none">
                                <option value="process">Process</option>
                                <option value="instrument">Instrument</option>
                                <option value="signal">Signal</option>
                                <option value="electrical">Electrical</option>
                            </select>
                            {connectFrom && (
                                <button onClick={() => setConnectFrom(null)}
                                    className="text-[10px] text-indigo-500 hover:text-indigo-700 underline">Cancel</button>
                            )}
                        </div>
                    </div>
                )}

                {/* ── SVG Canvas ── */}
                <div className="overflow-auto p-2" style={{ maxHeight: 520 }}>
                    <svg ref={svgRef}
                        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
                        style={{
                            width: `${100 * zoom}%`, height: 'auto',
                            background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0',
                            cursor: dragging ? 'grabbing' : drawMode === 'place' && placingType ? 'crosshair' : drawMode === 'connect' ? 'pointer' : 'default',
                        }}
                        onClick={handleCanvasClick}
                        onMouseMove={onDragMove}
                        onMouseUp={onDragEnd}
                        onMouseLeave={onDragEnd}
                    >
                        {/* Grid */}
                        <defs>
                            <pattern id="pid-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#e2e8f0" strokeWidth={0.5} />
                            </pattern>
                        </defs>
                        <rect width={SVG_WIDTH} height={SVG_HEIGHT} fill="url(#pid-grid)" />

                        {/* Background P&ID image */}
                        {backgroundImage && (
                            <image href={backgroundImage} x={0} y={0} width={SVG_WIDTH} height={SVG_HEIGHT}
                                preserveAspectRatio="xMidYMid meet" opacity={0.6} />
                        )}

                        {/* Connections */}
                        {connections.map(conn => {
                            const from = equipment.find(e => e.id === conn.fromId);
                            const to = equipment.find(e => e.id === conn.toId);
                            if (!from || !to) return null;

                            const lineStyle: Record<string, { color: string; dash: string; width: number }> = {
                                process: { color: '#64748b', dash: '', width: 2.5 },
                                instrument: { color: '#6366f1', dash: '4,3', width: 1.5 },
                                signal: { color: '#a855f7', dash: '2,3', width: 1.5 },
                                electrical: { color: '#d97706', dash: '6,2', width: 1.5 },
                            };
                            const s = lineStyle[conn.type] || lineStyle.process;

                            return (
                                <g key={conn.id}>
                                    <line x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                                        stroke={s.color} strokeWidth={s.width}
                                        strokeDasharray={s.dash || undefined} />
                                    {/* Delete connection button at midpoint */}
                                    {drawMode === 'select' && onRemoveConnection && (
                                        <g style={{ cursor: 'pointer' }}
                                            onClick={e => { e.stopPropagation(); onRemoveConnection(conn.id); }}>
                                            <circle cx={(from.x + to.x) / 2} cy={(from.y + to.y) / 2}
                                                r={6} fill="#fef2f2" stroke="#fca5a5" strokeWidth={1} opacity={0.7} />
                                            <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 + 3}
                                                fill="#ef4444" fontSize={7} textAnchor="middle" opacity={0.7}>✕</text>
                                        </g>
                                    )}
                                </g>
                            );
                        })}

                        {/* Equipment */}
                        {equipment.map(eq => {
                            const color = heatMapOn
                                ? getHeatColor(eq.woCount || 0)
                                : getCritColor(eq.criticality);
                            const isHighlighted = eq.id === highlightedEquipmentId;
                            const isConnectSource = eq.id === connectFrom;
                            const isSelected = eq.id === selectedEqId;
                            const renderer = SYMBOLS[eq.type] || SYMBOLS.pipe;

                            return (
                                <g key={eq.id}
                                    style={{
                                        cursor: dragging?.id === eq.id ? 'grabbing'
                                            : drawMode === 'select' ? 'grab'
                                                : drawMode !== 'place' ? 'pointer' : 'default'
                                    }}
                                    onMouseDown={e => onDragStart(eq.id, e)}
                                    onClick={e => { e.stopPropagation(); handleEquipClick(eq.id); }}
                                >
                                    {/* Selection / highlight ring */}
                                    {(isHighlighted || isConnectSource || isSelected) && (
                                        <circle cx={eq.x} cy={eq.y} r={26}
                                            fill="none"
                                            stroke={isConnectSource ? '#6366f1' : isSelected ? '#06b6d4' : '#dc2626'}
                                            strokeWidth={2.5}
                                            strokeDasharray="4,2">
                                            <animate attributeName="stroke-dashoffset" values="0;12" dur="1s" repeatCount="indefinite" />
                                        </circle>
                                    )}

                                    {/* Heat map glow */}
                                    {heatMapOn && (eq.woCount || 0) > 0 && (
                                        <circle cx={eq.x} cy={eq.y} r={24 + (eq.woCount || 0)}
                                            fill={`${getHeatColor(eq.woCount || 0)}15`} />
                                    )}

                                    {/* Symbol */}
                                    {renderer(eq.x, eq.y, color)}

                                    {/* Label */}
                                    {showLabels && (
                                        <>
                                            <text x={eq.x} y={eq.y + (eq.type === 'column' ? 38 : 30)}
                                                fill="#334155" fontSize={9} fontWeight={600} textAnchor="middle">
                                                {eq.label}
                                            </text>
                                            {eq.assetTag && (
                                                <text x={eq.x} y={eq.y + (eq.type === 'column' ? 48 : 40)}
                                                    fill="#94a3b8" fontSize={7} textAnchor="middle">
                                                    {eq.assetTag}
                                                </text>
                                            )}
                                        </>
                                    )}

                                    {/* Linked asset indicator */}
                                    {eq.assetId && (
                                        <g>
                                            <circle cx={eq.x + 16} cy={eq.y - 16} r={5} fill="#eff6ff" stroke="#93c5fd" strokeWidth={1} />
                                            <text x={eq.x + 16} y={eq.y - 13} fill="#2563eb" fontSize={6} textAnchor="middle">⛓</text>
                                        </g>
                                    )}

                                    {/* Health badge */}
                                    {eq.healthIndex !== undefined && (
                                        <g>
                                            <rect x={eq.x - 14} y={eq.y - 32} width={28} height={12} rx={4}
                                                fill={eq.healthIndex >= 80 ? '#dcfce7' : eq.healthIndex >= 60 ? '#fef3c7' : '#fee2e2'}
                                                stroke={eq.healthIndex >= 80 ? '#86efac' : eq.healthIndex >= 60 ? '#fcd34d' : '#fca5a5'}
                                                strokeWidth={0.5} />
                                            <text x={eq.x} y={eq.y - 23}
                                                fill={eq.healthIndex >= 80 ? '#16a34a' : eq.healthIndex >= 60 ? '#d97706' : '#dc2626'}
                                                fontSize={7} fontWeight={600} textAnchor="middle">
                                                {eq.healthIndex}%
                                            </text>
                                        </g>
                                    )}

                                    {/* WO count badge in heat map mode */}
                                    {heatMapOn && (eq.woCount || 0) > 0 && (
                                        <g>
                                            <circle cx={eq.x + 14} cy={eq.y + 14} r={8}
                                                fill={getHeatColor(eq.woCount || 0)} />
                                            <text x={eq.x + 14} y={eq.y + 17}
                                                fill="white" fontSize={7} fontWeight={700} textAnchor="middle">
                                                {eq.woCount}
                                            </text>
                                        </g>
                                    )}
                                </g>
                            );
                        })}

                        {/* Empty state */}
                        {equipment.length === 0 && !backgroundImage && (
                            <text x={SVG_WIDTH / 2} y={SVG_HEIGHT / 2} fill="#94a3b8" fontSize={13}
                                textAnchor="middle" fontWeight={500}>
                                Upload a P&ID or use "Place" to add equipment
                            </text>
                        )}
                    </svg>
                </div>

                {/* ── Legend ── */}
                <div className="flex items-center gap-4 px-4 py-2 border-t border-slate-100 flex-wrap text-[10px]">
                    <span className="text-slate-500 font-semibold">Lines:</span>
                    {[
                        { label: 'Process', color: '#64748b', dash: '' },
                        { label: 'Instrument', color: '#6366f1', dash: '4,3' },
                        { label: 'Signal', color: '#a855f7', dash: '2,3' },
                        { label: 'Electrical', color: '#d97706', dash: '6,2' },
                    ].map(l => (
                        <span key={l.label} className="flex items-center gap-1" style={{ color: l.color }}>
                            <svg width={18} height={4}>
                                <line x1={0} y1={2} x2={18} y2={2} stroke={l.color} strokeWidth={2}
                                    strokeDasharray={l.dash || undefined} />
                            </svg>
                            {l.label}
                        </span>
                    ))}
                    <div className="w-px h-4 bg-slate-200"></div>
                    <span className="text-slate-500 font-semibold">Criticality:</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500"></span> A</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500"></span> B</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500"></span> C</span>
                </div>
            </div>

            {/* ── Equipment Edit Popover ── */}
            {selectedEq && onUpdateEquipment && drawMode === 'select' && (
                <EquipmentEditPopover
                    eq={selectedEq}
                    onUpdate={updates => onUpdateEquipment(selectedEq.id, updates)}
                    onRemove={() => { onRemoveEquipment?.(selectedEq.id); setSelectedEqId(null); }}
                    onClose={() => setSelectedEqId(null)}
                />
            )}
        </div>
    );
};

export default PIDViewer;
