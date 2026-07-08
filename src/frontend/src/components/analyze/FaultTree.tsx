/**
 * FaultTree — Boolean logic fault tree with AND/OR gates
 * 
 * Models top-event probability from basic event failure rates.
 * Designed for Criticality A safety-critical assets.
 * Light theme variant aligned with ERS design system.
 */
import React, { useState, useMemo } from 'react';
import { Plus, Trash2, Calculator, Edit3 } from 'lucide-react';

export interface FaultTreeEvent {
    id: string;
    label: string;
    type: 'top' | 'intermediate' | 'basic';
    probability?: number; // 0–1 for basic events
    gateType?: 'AND' | 'OR';
    parentId?: string | null;
}

interface FaultTreeProps {
    events: FaultTreeEvent[];
    onAddEvent?: (parentId: string, type: 'intermediate' | 'basic', gateType?: 'AND' | 'OR') => Promise<string | null>;
    onRemoveEvent?: (id: string) => void;
    onUpdateProbability?: (id: string, probability: number) => void;
    onUpdateLabel?: (id: string, label: string) => void;
    readOnly?: boolean;
}

// ─── Probability Calculations ───────────────────────────────

function calculateProbability(event: FaultTreeEvent, allEvents: FaultTreeEvent[], visited: Set<string> = new Set()): number {
    // Cycle guard — malformed parent chains must never hang the tab.
    if (visited.has(event.id)) return 0;
    visited.add(event.id);
    if (event.type === 'basic') return event.probability ?? 0;

    const children = allEvents.filter(e => e.parentId === event.id && e.id !== event.id);
    if (children.length === 0) return event.probability ?? 0;

    const childProbs = children.map(c => calculateProbability(c, allEvents, visited));

    if (event.gateType === 'AND') {
        return childProbs.reduce((a, b) => a * b, 1);
    } else {
        // OR gate: P(A ∪ B) = 1 - (1-P(A)) * (1-P(B))
        return 1 - childProbs.reduce((a, b) => a * (1 - b), 1);
    }
}

// ─── Gate Symbol SVG ────────────────────────────────────────

const GateSymbol: React.FC<{ type: 'AND' | 'OR'; x: number; y: number; size?: number }> = ({
    type, x, y, size = 30
}) => {
    const half = size / 2;
    if (type === 'AND') {
        return (
            <g>
                <path
                    d={`M ${x - half} ${y + half} L ${x - half} ${y - half / 2} Q ${x - half} ${y - half} ${x} ${y - half} Q ${x + half} ${y - half} ${x + half} ${y - half / 2} L ${x + half} ${y + half} Z`}
                    fill="rgba(59, 130, 246, 0.1)" stroke="#3b82f6" strokeWidth={1.5}
                />
                <text x={x} y={y + 4} fill="#2563eb" fontSize={10} fontWeight={700} textAnchor="middle">AND</text>
            </g>
        );
    }
    return (
        <g>
            <path
                d={`M ${x - half} ${y + half} Q ${x - half} ${y} ${x} ${y - half} Q ${x + half} ${y} ${x + half} ${y + half} Q ${x} ${y + half / 2} ${x - half} ${y + half} Z`}
                fill="rgba(168, 85, 247, 0.1)" stroke="#a855f7" strokeWidth={1.5}
            />
            <text x={x} y={y + 4} fill="#7c3aed" fontSize={10} fontWeight={700} textAnchor="middle">OR</text>
        </g>
    );
};

// ─── Event Node ─────────────────────────────────────────────

const EventNode: React.FC<{
    event: FaultTreeEvent;
    x: number;
    y: number;
    prob: number;
    allEvents: FaultTreeEvent[];
    onAddEvent?: FaultTreeProps['onAddEvent'];
    onRemoveEvent?: FaultTreeProps['onRemoveEvent'];
    onUpdateProbability?: FaultTreeProps['onUpdateProbability'];
    readOnly: boolean;
    isSelected: boolean;
    onClick: () => void;
}> = ({ event, x, y, prob, allEvents, onAddEvent, onRemoveEvent, onUpdateProbability, readOnly, isSelected, onClick }) => {
    const isTop = event.type === 'top';
    const isBasic = event.type === 'basic';
    const children = allEvents.filter(e => e.parentId === event.id);

    const probColor = prob >= 0.1 ? '#dc2626' : prob >= 0.01 ? '#d97706' : '#16a34a';
    const nodeWidth = isTop ? 140 : 120;
    const nodeHeight = isTop ? 50 : 40;

    return (
        <g onClick={onClick} className="cursor-pointer select-none">
            {/* Event shape */}
            {isBasic ? (
                <circle cx={x} cy={y} r={22}
                    fill="#f8fafc" stroke={isSelected ? '#8b5cf6' : '#94a3b8'} strokeWidth={isSelected ? 3 : 1.5}
                    style={{ filter: isSelected ? 'drop-shadow(0px 0px 5px rgba(139, 92, 246, 0.5))' : 'none' }}
                />
            ) : (
                <rect
                    x={x - nodeWidth / 2} y={y - nodeHeight / 2}
                    width={nodeWidth} height={nodeHeight}
                    rx={isTop ? 8 : 6}
                    fill={isTop ? '#fef2f2' : '#f8fafc'}
                    stroke={isSelected ? '#8b5cf6' : isTop ? '#ef4444' : '#cbd5e1'} strokeWidth={isSelected ? 3 : isTop ? 2 : 1.5}
                    style={{ filter: isSelected ? 'drop-shadow(0px 0px 5px rgba(139, 92, 246, 0.5))' : 'none' }}
                />
            )}

            {/* Label */}
            <foreignObject
                x={isBasic ? x - 18 : x - nodeWidth / 2 + 4}
                y={isBasic ? y - 12 : y - nodeHeight / 2 + 4}
                width={isBasic ? 36 : nodeWidth - 8}
                height={isBasic ? 24 : nodeHeight / 2}
            >
                <div style={{
                    fontSize: isBasic ? 7 : 9, color: isTop ? '#991b1b' : '#334155', textAlign: 'center',
                    overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: isTop ? 700 : 500,
                }}>
                    {event.label}
                </div>
            </foreignObject>

            {/* Probability badge */}
            <rect
                x={x - 22} y={isBasic ? y + 14 : y + nodeHeight / 2 - 16}
                width={44} height={14} rx={3}
                fill={`${probColor}15`} stroke={`${probColor}30`} strokeWidth={0.5}
            />
            <text
                x={x} y={isBasic ? y + 24 : y + nodeHeight / 2 - 6}
                fill={probColor} fontSize={8} fontWeight={600} textAnchor="middle"
            >
                P={prob.toExponential(1)}
            </text>

            {/* Gate symbol for non-basic events */}
            {event.gateType && children.length > 0 && (
                <g>
                    <line
                        x1={x} y1={isTop ? y + nodeHeight / 2 : y + (isBasic ? 22 : nodeHeight / 2)}
                        x2={x} y2={y + (isTop ? 80 : 70)}
                        stroke="#94a3b8" strokeWidth={1.5}
                    />
                    <GateSymbol type={event.gateType} x={x} y={y + (isTop ? 82 : 72)} />
                </g>
            )}
        </g>
    );
};

// ─── Main Component ─────────────────────────────────────────

interface HistoryItem {
    type: 'add' | 'delete' | 'update_label' | 'update_prob';
    nodeId: string;
    parentId?: string | null;
    nodeType?: 'top' | 'intermediate' | 'basic';
    gateType?: 'AND' | 'OR';
    label?: string;
    probability?: number;
}

const FaultTree: React.FC<FaultTreeProps> = ({
    events,
    onAddEvent,
    onRemoveEvent,
    onUpdateProbability,
    onUpdateLabel,
    readOnly = false,
}) => {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editLabel, setEditLabel] = useState('');
    const [deletingId, setDeletingId] = useState<string | null>(null);

    // Selected node actions
    const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
    const [editingSelected, setEditingSelected] = useState(false);
    const [editSelectedText, setEditSelectedText] = useState('');

    // Undo history engine
    const [historyStack, setHistoryStack] = useState<HistoryItem[]>([]);

    const pushHistory = (item: HistoryItem) => {
        setHistoryStack(prev => [...prev, item]);
    };

    const handleAddEventWithHistory = async (parentId: string, type: 'intermediate' | 'basic', gateType?: 'AND' | 'OR') => {
        if (!onAddEvent) return;
        const newId = await onAddEvent(parentId, type, gateType);
        if (newId) {
            pushHistory({
                type: 'add',
                nodeId: newId,
            });
            setSelectedEventId(newId); // auto-select newly created node
        }
    };

    const handleRemoveEventWithHistory = async (id: string) => {
        if (!onRemoveEvent) return;
        const ev = events.find(e => e.id === id);
        if (!ev) return;

        await onRemoveEvent(id);
        pushHistory({
            type: 'delete',
            nodeId: id,
            parentId: ev.parentId,
            nodeType: ev.type,
            gateType: ev.gateType,
            label: ev.label,
            probability: ev.probability,
        });

        if (selectedEventId === id) {
            setSelectedEventId(null);
        }
    };

    const handleUpdateLabelWithHistory = async (id: string, newLabel: string) => {
        if (!onUpdateLabel || !newLabel.trim()) return;
        const ev = events.find(e => e.id === id);
        if (!ev || ev.label === newLabel.trim()) return;

        const oldLabel = ev.label;
        await onUpdateLabel(id, newLabel.trim());
        pushHistory({
            type: 'update_label',
            nodeId: id,
            label: oldLabel,
        });
    };

    const handleUpdateProbabilityWithHistory = async (id: string, newProb: number) => {
        if (!onUpdateProbability) return;
        const ev = events.find(e => e.id === id);
        if (!ev || ev.probability === newProb) return;

        const oldProb = ev.probability || 0.01;
        await onUpdateProbability(id, newProb);
        pushHistory({
            type: 'update_prob',
            nodeId: id,
            probability: oldProb,
        });
    };

    const handleUndo = async () => {
        if (historyStack.length === 0) return;
        const lastAction = historyStack[historyStack.length - 1];
        setHistoryStack(prev => prev.slice(0, -1)); // pop

        try {
            if (lastAction.type === 'add') {
                if (onRemoveEvent) {
                    await onRemoveEvent(lastAction.nodeId);
                    if (selectedEventId === lastAction.nodeId) {
                        setSelectedEventId(null);
                    }
                }
            } else if (lastAction.type === 'delete') {
                if (onAddEvent && lastAction.parentId) {
                    const restoredId = await onAddEvent(
                        lastAction.parentId,
                        lastAction.nodeType === 'basic' ? 'basic' : 'intermediate',
                        lastAction.gateType
                    );
                    if (restoredId && lastAction.label && onUpdateLabel) {
                        await onUpdateLabel(restoredId, lastAction.label);
                    }
                    if (restoredId && lastAction.probability !== undefined && onUpdateProbability) {
                        await onUpdateProbability(restoredId, lastAction.probability);
                    }
                }
            } else if (lastAction.type === 'update_label') {
                if (onUpdateLabel && lastAction.label !== undefined) {
                    await onUpdateLabel(lastAction.nodeId, lastAction.label);
                }
            } else if (lastAction.type === 'update_prob') {
                if (onUpdateProbability && lastAction.probability !== undefined) {
                    await onUpdateProbability(lastAction.nodeId, lastAction.probability);
                }
            }
        } catch (e) {
            console.error('Failed to undo action:', e);
        }
    };

    const selectedEvent = useMemo(() => events.find(e => e.id === selectedEventId), [events, selectedEventId]);

    const topEvent = useMemo(() => events.find(e => e.type === 'top'), [events]);
    const topProb = useMemo(() => {
        if (!topEvent) return 0;
        return calculateProbability(topEvent, events);
    }, [topEvent, events]);

    // Build layered layout
    const layers = useMemo(() => {
        const result: FaultTreeEvent[][] = [];
        if (!topEvent) return result;

        // Visited guard: a malformed parent chain (cycle / duplicate ids) must
        // never turn this walk into an infinite loop that hangs the tab.
        const seen = new Set<string>([topEvent.id]);
        let currentLayer = [topEvent];
        while (currentLayer.length > 0) {
            result.push(currentLayer);
            const nextLayer: FaultTreeEvent[] = [];
            currentLayer.forEach(e => {
                events.forEach(c => {
                    if (c.parentId === e.id && !seen.has(c.id)) {
                        seen.add(c.id);
                        nextLayer.push(c);
                    }
                });
            });
            currentLayer = nextLayer;
        }
        return result;
    }, [topEvent, events]);

    const SVG_WIDTH = 900;
    const LAYER_HEIGHT = 130;
    const SVG_HEIGHT = Math.max(400, layers.length * LAYER_HEIGHT + 60);

    return (
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-3 pb-2 border-b border-slate-100 gap-3">
                <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="text-xs font-extrabold text-blue-800 uppercase tracking-wider">Fault Tree Analysis</span>
                    <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${
                        topProb >= 0.1
                            ? 'bg-rose-50 text-rose-700 border-rose-200'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    }`}>
                        <Calculator size={10} className="inline mr-1" />
                        Top Event P = {topProb.toExponential(2)}
                    </span>
                </div>
                <div className="flex items-center gap-3.5 flex-wrap">
                    <div className="flex gap-3 text-[10px] font-semibold text-slate-500">
                        <span><span className="text-blue-500">■</span> AND Gate</span>
                        <span><span className="text-blue-500">■</span> OR Gate</span>
                    </div>
                    {!readOnly && onAddEvent && topEvent && (
                        <div className="flex gap-1.5 items-center">
                            {/* Undo Button */}
                            <button
                                onClick={handleUndo}
                                disabled={historyStack.length === 0}
                                className={`px-2.5 py-1 text-[10px] font-bold rounded-lg border flex items-center gap-1 transition-all ${
                                    historyStack.length > 0
                                        ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100 cursor-pointer shadow-xs'
                                        : 'bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed opacity-60'
                                }`}
                                title="Undo last action"
                            >
                                Undo ({historyStack.length})
                            </button>
                            <span className="h-4 w-px bg-slate-200 mx-1" />
                            {/* Context-aware buttons */}
                            <button
                                onClick={() => handleAddEventWithHistory(selectedEventId || topEvent.id, 'intermediate', 'OR')}
                                className="px-2.5 py-1 text-[10px] font-bold rounded-lg border cursor-pointer flex items-center gap-1 transition-colors bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 shadow-xs"
                                title={selectedEventId ? `Add OR Gate under "${selectedEvent?.label}"` : 'Add OR Gate under top event'}
                            >
                                <Plus size={10} /> OR Gate
                            </button>
                            <button
                                onClick={() => handleAddEventWithHistory(selectedEventId || topEvent.id, 'intermediate', 'AND')}
                                className="px-2.5 py-1 text-[10px] font-bold rounded-lg border cursor-pointer flex items-center gap-1 transition-colors bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 shadow-xs"
                                title={selectedEventId ? `Add AND Gate under "${selectedEvent?.label}"` : 'Add AND Gate under top event'}
                            >
                                <Plus size={10} /> AND Gate
                            </button>
                            <button
                                onClick={() => handleAddEventWithHistory(selectedEventId || topEvent.id, 'basic')}
                                className="px-2.5 py-1 text-[10px] font-bold rounded-lg border cursor-pointer flex items-center gap-1 transition-colors bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 shadow-xs"
                                title={selectedEventId ? `Add Basic Event under "${selectedEvent?.label}"` : 'Add Basic Event under top event'}
                            >
                                <Plus size={10} /> Basic Event
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Selected Event Context Actions Popover */}
            {!readOnly && selectedEvent && (
                <div className="bg-slate-50/70 border border-slate-200/80 rounded-xl p-3 mb-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in slide-in-from-top duration-250">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 shrink-0">Selected node:</span>
                        {editingSelected ? (
                            <div className="flex items-center gap-1.5 flex-1 max-w-md">
                                <input
                                    value={editSelectedText}
                                    onChange={e => setEditSelectedText(e.target.value)}
                                    className="px-2 py-1 text-xs border border-blue-500 rounded-lg outline-none w-full bg-white text-slate-800 shadow-xs"
                                    autoFocus
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && editSelectedText.trim()) {
                                            handleUpdateLabelWithHistory(selectedEvent.id, editSelectedText);
                                            setEditingSelected(false);
                                        }
                                        if (e.key === 'Escape') setEditingSelected(false);
                                    }}
                                />
                                <button
                                    onClick={() => {
                                        if (editSelectedText.trim()) {
                                            handleUpdateLabelWithHistory(selectedEvent.id, editSelectedText);
                                            setEditingSelected(false);
                                        }
                                    }}
                                    className="px-2.5 py-1 bg-primary-600 hover:bg-primary-500 text-white text-[10px] font-bold rounded-md cursor-pointer"
                                >
                                    Save
                                </button>
                                <button
                                    onClick={() => setEditingSelected(false)}
                                    className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-500 text-[10px] font-semibold rounded-md cursor-pointer"
                                >
                                    Cancel
                                </button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-1.5 truncate">
                                <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase ${
                                    selectedEvent.type === 'top' ? 'bg-red-50 text-red-700 border border-red-200' :
                                    selectedEvent.type === 'basic' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                                    'bg-blue-50 text-blue-700 border border-blue-200'
                                }`}>
                                    {selectedEvent.type === 'top' ? 'TOP' : selectedEvent.type === 'basic' ? 'BASIC' : selectedEvent.gateType || 'GATE'}
                                </span>
                                <span className="text-xs font-bold text-slate-800 truncate">{selectedEvent.label}</span>
                                <button
                                    onClick={() => {
                                        setEditingSelected(true);
                                        setEditSelectedText(selectedEvent.label);
                                    }}
                                    className="p-1 hover:bg-slate-200 text-slate-400 hover:text-slate-700 rounded-md transition-colors cursor-pointer"
                                    title="Rename event"
                                >
                                    <Edit3 size={11} />
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-3 shrink-0 flex-wrap">
                        {/* Probability setting for basic events */}
                        {selectedEvent.type === 'basic' && onUpdateProbability && (
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                                <span>P =</span>
                                <input
                                    type="number"
                                    step="0.01" min="0" max="1"
                                    defaultValue={selectedEvent.probability ?? 0.01}
                                    onBlur={e => {
                                        const val = parseFloat(e.target.value);
                                        if (!isNaN(val) && val >= 0 && val <= 1) {
                                            handleUpdateProbabilityWithHistory(selectedEvent.id, val);
                                        }
                                    }}
                                    className="w-16 px-1.5 py-0.5 border border-slate-200 bg-white rounded-md outline-none text-center font-bold text-slate-800 shadow-xs focus:border-blue-500 focus:ring-1 focus:ring-primary-500/20"
                                />
                            </div>
                        )}

                        {/* Add items directly under this selected node */}
                        {selectedEvent.type !== 'basic' && (
                            <div className="flex gap-1">
                                <button
                                    onClick={() => handleAddEventWithHistory(selectedEvent.id, 'intermediate', 'OR')}
                                    className="px-2 py-1 text-[9px] font-black uppercase rounded bg-blue-50 hover:bg-blue-100 border border-blue-100/80 text-blue-700 cursor-pointer shadow-3xs"
                                >
                                    + OR
                                </button>
                                <button
                                    onClick={() => handleAddEventWithHistory(selectedEvent.id, 'intermediate', 'AND')}
                                    className="px-2 py-1 text-[9px] font-black uppercase rounded bg-blue-50 hover:bg-blue-100 border border-blue-100/80 text-blue-700 cursor-pointer shadow-3xs"
                                >
                                    + AND
                                </button>
                                <button
                                    onClick={() => handleAddEventWithHistory(selectedEvent.id, 'basic')}
                                    className="px-2 py-1 text-[9px] font-black uppercase rounded bg-slate-50 hover:bg-slate-100 border border-slate-200/80 text-slate-600 cursor-pointer shadow-3xs"
                                >
                                    + BASIC
                                </button>
                            </div>
                        )}

                        {/* Delete Event Node */}
                        {selectedEvent.type !== 'top' && (
                            <button
                                onClick={() => handleRemoveEventWithHistory(selectedEvent.id)}
                                className="px-2 py-1 text-[9px] font-black uppercase rounded bg-rose-50 hover:bg-rose-100 border border-rose-100/80 text-rose-700 cursor-pointer flex items-center gap-0.5 shadow-3xs"
                            >
                                <Trash2 size={10} /> Delete Node
                            </button>
                        )}

                        <span className="h-4 w-px bg-slate-200" />
                        <button
                            onClick={() => setSelectedEventId(null)}
                            className="text-slate-400 hover:text-slate-600 font-extrabold hover:bg-slate-200 p-1 rounded-md text-xs cursor-pointer"
                        >
                            ✕
                        </button>
                    </div>
                </div>
            )}

            <svg viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} style={{ width: '100%', height: 'auto' }}>
                {/* Background grid */}
                <defs>
                    <pattern id="ftGrid" width="40" height="40" patternUnits="userSpaceOnUse">
                        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#f1f5f9" strokeWidth="0.5" />
                    </pattern>
                </defs>
                <rect width={SVG_WIDTH} height={SVG_HEIGHT} fill="url(#ftGrid)" />

                {/* Connections */}
                {events.filter(e => e.parentId).map(event => {
                    const parent = events.find(e => e.id === event.parentId);
                    if (!parent) return null;

                    const pLayerIdx = layers.findIndex(l => l.includes(parent));
                    const eLayerIdx = layers.findIndex(l => l.includes(event));
                    if (pLayerIdx < 0 || eLayerIdx < 0) return null;

                    const pLayer = layers[pLayerIdx];
                    const eLayer = layers[eLayerIdx];
                    const pIdx = pLayer.indexOf(parent);
                    const eIdx = eLayer.indexOf(event);

                    const pX = SVG_WIDTH / 2 + (pIdx - (pLayer.length - 1) / 2) * 160;
                    const eX = SVG_WIDTH / 2 + (eIdx - (eLayer.length - 1) / 2) * 160;
                    const pY = pLayerIdx * LAYER_HEIGHT + 30;
                    const eY = eLayerIdx * LAYER_HEIGHT + 30;

                    return (
                        <line key={`conn-${event.id}`}
                            x1={pX} y1={pY + 60} x2={eX} y2={eY - 25}
                            stroke="#cbd5e1" strokeWidth={1.5} strokeDasharray="4,3"
                        />
                    );
                })}

                {/* Event nodes */}
                {layers.map((layer, layerIdx) =>
                    layer.map((event, idx) => {
                        const x = SVG_WIDTH / 2 + (idx - (layer.length - 1) / 2) * 160;
                        const y = layerIdx * LAYER_HEIGHT + 30;
                        const prob = calculateProbability(event, events);

                        return (
                            <EventNode
                                key={event.id}
                                event={event}
                                x={x} y={y}
                                prob={prob}
                                allEvents={events}
                                onAddEvent={onAddEvent}
                                onRemoveEvent={onRemoveEvent}
                                onUpdateProbability={onUpdateProbability}
                                readOnly={readOnly}
                                isSelected={selectedEventId === event.id}
                                onClick={() => {
                                    setSelectedEventId(event.id);
                                    setEditingSelected(false);
                                }}
                            />
                        );
                    })
                )}
            </svg>

            {/* Removed bottom controls as they are now in the top header beside the top event context */}

            {/* ═══ Event Management Table ═══ */}
            {!readOnly && events.length > 1 && (
                <div style={{ marginTop: 12, borderTop: '1px solid #f1f5f9', paddingTop: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
                        Event Details
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {events.filter(e => e.type !== 'top').map(event => (
                            <div key={event.id} style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '6px 10px', borderRadius: 8,
                                background: '#f8fafc', border: '1px solid #e2e8f0',
                            }}>
                                {/* Type badge */}
                                <span style={{
                                    fontSize: 9, fontWeight: 700, padding: '2px 6px',
                                    borderRadius: 4, textTransform: 'uppercase',
                                    background: event.type === 'basic' ? '#ecfdf5' : '#eff6ff',
                                    color: event.type === 'basic' ? '#059669' : '#2563eb',
                                    border: `1px solid ${event.type === 'basic' ? '#a7f3d0' : '#bfdbfe'}`,
                                    flexShrink: 0,
                                }}>
                                    {event.type === 'basic' ? 'Basic' : event.gateType || 'Int'}
                                </span>

                                {/* Label - editable */}
                                {editingId === event.id ? (
                                    <div style={{ display: 'flex', gap: 4, flex: 1 }}>
                                        <input
                                            value={editLabel}
                                            onChange={e => setEditLabel(e.target.value)}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter' && editLabel.trim()) {
                                                    handleUpdateLabelWithHistory(event.id, editLabel.trim());
                                                    setEditingId(null); setEditLabel('');
                                                }
                                                if (e.key === 'Escape') { setEditingId(null); setEditLabel(''); }
                                            }}
                                            autoFocus
                                            style={{ flex: 1, padding: '3px 8px', fontSize: 12, border: '1px solid #3b82f6', borderRadius: 4, outline: 'none', minWidth: 0 }}
                                        />
                                        <button onClick={() => { if (editLabel.trim()) { handleUpdateLabelWithHistory(event.id, editLabel.trim()); } setEditingId(null); setEditLabel(''); }}
                                            style={{ padding: '3px 10px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontWeight: 600 }}>
                                            Save
                                        </button>
                                    </div>
                                ) : deletingId === event.id ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, fontSize: 11 }}>
                                        <span style={{ color: '#991b1b', fontWeight: 600 }}>Delete this event?</span>
                                        <button onClick={() => { handleRemoveEventWithHistory(event.id); setDeletingId(null); }}
                                            style={{ padding: '2px 10px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>Yes</button>
                                        <button onClick={() => setDeletingId(null)}
                                            style={{ padding: '2px 10px', background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 10, cursor: 'pointer' }}>No</button>
                                    </div>
                                ) : (
                                    <span
                                        onClick={() => { setEditingId(event.id); setEditLabel(event.label); }}
                                        style={{ flex: 1, fontSize: 12, color: '#334155', cursor: 'pointer', fontWeight: 500 }}
                                        title="Click to edit">
                                        {event.label}
                                    </span>
                                )}

                                {/* Probability input for basic events */}
                                {event.type === 'basic' && onUpdateProbability && editingId !== event.id && deletingId !== event.id && (
                                    <input
                                        type="number"
                                        step="0.001" min="0" max="1"
                                        placeholder="P"
                                        value={event.probability ?? ''}
                                        onChange={e => handleUpdateProbabilityWithHistory(event.id, parseFloat(e.target.value) || 0)}
                                        style={{
                                            width: 70, padding: '3px 6px', fontSize: 10,
                                            border: '1px solid #e2e8f0', borderRadius: 4,
                                            outline: 'none', textAlign: 'center', color: '#334155',
                                        }}
                                        title="Probability (0-1)"
                                    />
                                )}

                                {/* Actions */}
                                {editingId !== event.id && deletingId !== event.id && (
                                    <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                                        <button onClick={() => { setEditingId(event.id); setEditLabel(event.label); }}
                                            style={{ background: 'none', border: 'none', padding: 3, cursor: 'pointer', color: '#cbd5e1', display: 'flex' }}
                                            title="Edit label">
                                            <Edit3 size={11} />
                                        </button>
                                        <button onClick={() => setDeletingId(event.id)}
                                            style={{ background: 'none', border: 'none', padding: 3, cursor: 'pointer', color: '#cbd5e1', display: 'flex' }}
                                            title="Delete">
                                            <Trash2 size={11} />
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default FaultTree;
