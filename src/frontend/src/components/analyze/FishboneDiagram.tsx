/**
 * FishboneDiagram.tsx — Interactive Ishikawa (Fishbone) with Integrated Side‑Panel
 *
 * Layout:  SVG fishbone (left) + scrollable cause‑entry panel (right)
 *
 * Clicking a category bone highlights it and scrolls the side panel.
 * Causes entered in the panel appear on the SVG instantly.
 */
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Plus, Trash2, Target, Check, X, Edit3, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import analyzeService from '../../eam/services/AnalyzeService';
import type { RCANode } from '../../eam/services/AnalyzeService';

// ── Fishbone Framework Definitions ──────────────────────────
type FishboneFramework = '6Ms' | '4Ms' | '4Ps' | '4Ss';

interface CatDef { key: string; label: string; subtitle: string; color: string; position: string }

const FISHBONE_FRAMEWORKS: Record<FishboneFramework, CatDef[]> = {
    '6Ms': [
        { key: 'Man', label: 'Man', subtitle: 'Personnel', color: '#6366f1', position: 'top' },
        { key: 'Machine', label: 'Machine', subtitle: 'Equipment', color: '#0891b2', position: 'top' },
        { key: 'Material', label: 'Material', subtitle: 'Materials', color: '#059669', position: 'top' },
        { key: 'Method', label: 'Method', subtitle: 'Procedures', color: '#d97706', position: 'bottom' },
        { key: 'Mother Nature', label: 'Environment', subtitle: 'Mother Nature', color: '#dc2626', position: 'bottom' },
        { key: 'Measurement', label: 'Measurement', subtitle: 'Instrumentation', color: '#7c3aed', position: 'bottom' },
    ],
    '4Ms': [
        { key: 'Man', label: 'Man', subtitle: 'Personnel', color: '#6366f1', position: 'top' },
        { key: 'Machine', label: 'Machine', subtitle: 'Equipment', color: '#0891b2', position: 'top' },
        { key: 'Material', label: 'Material', subtitle: 'Materials', color: '#059669', position: 'bottom' },
        { key: 'Method', label: 'Method', subtitle: 'Procedures', color: '#d97706', position: 'bottom' },
    ],
    '4Ps': [
        { key: 'Policies', label: 'Policies', subtitle: 'Rules & Standards', color: '#6366f1', position: 'top' },
        { key: 'Procedures', label: 'Procedures', subtitle: 'Work Methods', color: '#0891b2', position: 'top' },
        { key: 'People', label: 'People', subtitle: 'Personnel & Skills', color: '#059669', position: 'bottom' },
        { key: 'Plant', label: 'Plant', subtitle: 'Equipment & Infra', color: '#d97706', position: 'bottom' },
    ],
    '4Ss': [
        { key: 'Surroundings', label: 'Surroundings', subtitle: 'Environment', color: '#6366f1', position: 'top' },
        { key: 'Suppliers', label: 'Suppliers', subtitle: 'External', color: '#0891b2', position: 'top' },
        { key: 'Systems', label: 'Systems', subtitle: 'Processes', color: '#059669', position: 'bottom' },
        { key: 'Skills', label: 'Skills', subtitle: 'Competencies', color: '#d97706', position: 'bottom' },
    ],
};

const FRAMEWORK_LABELS: Record<FishboneFramework, string> = {
    '6Ms': '6Ms — Man, Machine, Material, Method, Environment, Measurement',
    '4Ms': '4Ms — Man, Machine, Material, Method',
    '4Ps': '4Ps — Policies, Procedures, People, Plant',
    '4Ss': '4Ss — Surroundings, Suppliers, Systems, Skills',
};

/**
 * Bridge from the fishbone's category axis to the PROACT cause layer.
 *
 * Fishbone categories and the Physical → Human → Latent ladder are different axes, and
 * the fishbone used to write `cause_category: null`. A fishbone investigation therefore
 * produced ZERO cause-layer data: its root cause was invisible to the physical/human/latent
 * rollup and silently defaulted into the "Physical" bucket on the solutions step.
 *
 * A category implies a default layer — Man is a human cause, Method is a systemic one —
 * so we seed it here. It is only a default: the cause layer stays editable downstream,
 * which matters because "the physical cause is never the root" only holds if the layer
 * is a judgement, not a lookup.
 */
const CATEGORY_CAUSE_LAYER: Record<string, 'physical' | 'human' | 'latent'> = {
    // Physical — tangible component / condition
    Machine: 'physical', Material: 'physical', 'Mother Nature': 'physical',
    Plant: 'physical', Surroundings: 'physical',
    // Human — an action or omission
    Man: 'human', People: 'human', Skills: 'human',
    // Latent — a management-system deficiency
    Method: 'latent', Measurement: 'latent', Policies: 'latent',
    Procedures: 'latent', Systems: 'latent', Suppliers: 'latent',
};

interface FishboneDiagramProps {
    investigationId: string;
    problemStatement: string;
    nodes: RCANode[];
    setNodes: React.Dispatch<React.SetStateAction<RCANode[]>>;
    saving?: boolean;
}

// ── Layout constants ────────────────────────────────────────
const VB_W = 1200;
const VB_H = 700;
const SPINE_Y = VB_H / 2;
const SPINE_LEFT = 80;
const SPINE_RIGHT = 960;
const HEAD_W = 200;
const BONE_LEN = 180;
const SUB_BONE_LEN = 90;

// ── Component ────────────────────────────────────────────────
const FishboneDiagram: React.FC<FishboneDiagramProps> = ({
    investigationId, problemStatement, nodes, setNodes, saving: _saving = false,
}) => {
    const [addingTo, setAddingTo] = useState<string | null>(null);
    const [newCauseText, setNewCauseText] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editText, setEditText] = useState('');
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [busyOp, setBusyOp] = useState(false);
    const [framework, setFramework] = useState<FishboneFramework>('6Ms');
    const [activeCat, setActiveCat] = useState<string | null>(null);

    const panelRef = useRef<HTMLDivElement>(null);
    const catRefs = useRef<Record<string, HTMLDivElement | null>>({});

    const CATS = FISHBONE_FRAMEWORKS[framework];

    // ── Organize nodes ──────────────────────────────────────
    // A category can have more than one spine node: older builds seeded them from an
    // effect that raced its own StrictMode double-invoke, so real investigations out
    // there hold duplicates. Keep the first as the write target but gather causes from
    // ALL of them — last-wins used to make causes hanging off the older duplicate
    // silently vanish from the diagram.
    const categoryMap = useMemo(() => {
        const map: Record<string, { catNode: RCANode; causes: RCANode[] }> = {};
        const catIds: Record<string, string[]> = {};
        nodes.filter(n => n.node_type === 'category').forEach(cn => {
            (catIds[cn.description] ??= []).push(cn.id);
            if (!map[cn.description]) map[cn.description] = { catNode: cn, causes: [] };
        });
        Object.keys(map).forEach(key => {
            const ids = new Set(catIds[key]);
            map[key].causes = nodes.filter(n =>
                n.parent_id && ids.has(n.parent_id) &&
                (n.node_type === 'why' || n.node_type === 'root_cause' || n.node_type === 'contributing_factor')
            );
        });
        return map;
    }, [nodes]);

    const rootCauseNode = useMemo(() => nodes.find(n => n.is_root_cause), [nodes]);

    /**
     * Resolve a category's spine node, creating it if this investigation has never
     * used it. Adding a cause used to bail out silently when the category node was
     * missing from local state, which is exactly what happened whenever the parent's
     * async node fetch resolved after the seeding effect had appended its rows and
     * overwrote them: the "+ Add" button then did nothing, forever, with no error.
     * Creating on demand means a cause can always be recorded regardless of that race.
     */
    const catNodeIdRef = useRef<Record<string, string>>({});
    // Memoize the in-flight insert, not just the finished id. Two callers can ask for the
    // same category before either has returned — StrictMode double-invokes the seeding
    // effect in dev, and a fast "+ Add" click can overtake it in any environment. Sharing
    // one promise per key is what stops that becoming a duplicate spine node.
    const inflightRef = useRef<Record<string, Promise<string | null>>>({});

    const ensureCategoryNode = useCallback((categoryKey: string): Promise<string | null> => {
        const known = categoryMap[categoryKey]?.catNode.id ?? catNodeIdRef.current[categoryKey];
        if (known) return Promise.resolve(known);
        const pending = inflightRef.current[categoryKey] as Promise<string | null> | undefined;
        if (pending) return pending;

        const p = (async () => {
            const node = await analyzeService.createRCANode({
                investigation_id: investigationId, parent_id: null,
                node_type: 'category', description: categoryKey,
                depth: 0, is_root_cause: false,
                cause_category: null, cause_code: null, evidence_notes: null,
                method: 'fishbone',
            });
            if (!node) { delete inflightRef.current[categoryKey]; return null; }
            catNodeIdRef.current[categoryKey] = node.id;
            setNodes(prev => prev.some(n => n.id === node.id) ? prev : [...prev, node]);
            return node.id;
        })();
        inflightRef.current[categoryKey] = p;
        return p;
    }, [categoryMap, investigationId, setNodes]);

    // ── Seed the category spine so the bones render before any cause exists ──
    useEffect(() => {
        let cancelled = false;
        (async () => {
            for (const cat of CATS) {
                if (cancelled) return;
                await ensureCategoryNode(cat.key);
            }
        })();
        return () => { cancelled = true; };
        // Intentionally not keyed on `nodes` — ensureCategoryNode already dedupes via
        // categoryMap and catNodeIdRef, and re-running this on every keystroke would
        // hammer the DB. Keyed on the framework because 4Ps/4Ss need their own spine.
    }, [investigationId, framework]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── CRUD handlers ───────────────────────────────────────
    const handleAddCause = useCallback(async (categoryKey: string) => {
        const text = newCauseText.trim();
        if (!text || busyOp) return;
        setBusyOp(true);
        try {
            const parentId = await ensureCategoryNode(categoryKey);
            if (!parentId) return; // createRCANode already surfaced the error
            const node = await analyzeService.createRCANode({
                investigation_id: investigationId, parent_id: parentId,
                node_type: 'why', description: text,
                depth: 1, is_root_cause: false,
                cause_category: CATEGORY_CAUSE_LAYER[categoryKey] ?? null,
                cause_code: null, evidence_notes: null,
                method: 'fishbone',
            });
            if (node) setNodes(prev => [...prev, node]);
            setNewCauseText(''); setAddingTo(null);
        } finally { setBusyOp(false); }
    }, [newCauseText, busyOp, ensureCategoryNode, investigationId, setNodes]);

    const handleSaveEdit = useCallback(async (nodeId: string) => {
        if (!editText.trim() || busyOp) return;
        setBusyOp(true);
        try {
            const updated = await analyzeService.updateRCANode(nodeId, { description: editText.trim() });
            if (updated) setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, description: editText.trim() } : n));
            setEditingId(null); setEditText('');
        } finally { setBusyOp(false); }
    }, [editText, busyOp, setNodes]);

    const handleDelete = useCallback(async (nodeId: string) => {
        setBusyOp(true);
        try {
            await analyzeService.deleteRCANode(nodeId);
            setNodes(prev => prev.filter(n => n.id !== nodeId));
            setDeletingId(null);
        } finally { setBusyOp(false); }
    }, [setNodes]);

    const handleToggleRoot = useCallback(async (node: RCANode) => {
        setBusyOp(true);
        try {
            if (node.is_root_cause) {
                const updated = await analyzeService.updateRCANode(node.id, { is_root_cause: false, node_type: 'why' });
                if (updated) {
                    setNodes(prev => prev.map(n => n.id === node.id ? { ...n, is_root_cause: false, node_type: 'why' } : n));
                    await analyzeService.updateRCAInvestigation(investigationId, { root_cause_summary: null });
                }
            } else {
                const existingRoot = nodes.find(n => n.is_root_cause);
                if (existingRoot) await analyzeService.updateRCANode(existingRoot.id, { is_root_cause: false, node_type: 'why' });
                const updated = await analyzeService.updateRCANode(node.id, { is_root_cause: true, node_type: 'root_cause' });
                if (updated) {
                    setNodes(prev => prev.map(n => {
                        if (n.id === node.id) return { ...n, is_root_cause: true, node_type: 'root_cause' };
                        if (n.is_root_cause) return { ...n, is_root_cause: false, node_type: 'why' };
                        return n;
                    }));
                    await analyzeService.updateRCAInvestigation(investigationId, {
                        root_cause_summary: node.description, status: 'in_progress',
                    });
                }
            }
        } finally { setBusyOp(false); }
    }, [nodes, investigationId, setNodes]);

    // ── Bone positions ──────────────────────────────────────
    const topCats = CATS.filter(c => c.position === 'top');
    const botCats = CATS.filter(c => c.position === 'bottom');
    const spineSpan = SPINE_RIGHT - SPINE_LEFT;

    const getBoneX = (index: number, count: number) => {
        if (count === 1) return SPINE_LEFT + spineSpan * 0.5;
        const pad = spineSpan * 0.1;
        const usable = spineSpan - pad * 2;
        return SPINE_LEFT + pad + (usable / (count - 1)) * index;
    };

    // ── Click bone → highlight + scroll side panel ──────────
    const handleCatClick = useCallback((key: string) => {
        setActiveCat(prev => prev === key ? null : key);
        const el = catRefs.current[key];
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, []);

    // ═══════════════════════════════════════════════════════════
    //  RENDER
    // ═══════════════════════════════════════════════════════════
    return (
        <div style={{ marginBottom: 16 }}>
            {/* Header bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    🐟 Fishbone Diagram
                </div>
                <div style={{ flex: 1, height: 1, background: '#e2e8f0', minWidth: 40 }} />
                <select value={framework}
                    onChange={(e) => setFramework(e.target.value as FishboneFramework)}
                    style={{ padding: '3px 8px', fontSize: 11, fontWeight: 600, color: '#4338ca', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 6, cursor: 'pointer', outline: 'none' }}
                    title="Select analysis framework">
                    {(Object.keys(FRAMEWORK_LABELS) as FishboneFramework[]).map(fw => (
                        <option key={fw} value={fw}>{FRAMEWORK_LABELS[fw]}</option>
                    ))}
                </select>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>
                    {nodes.filter(n => n.node_type !== 'category').length} causes
                </span>
            </div>

            {/* Root cause callout */}
            {rootCauseNode && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', marginBottom: 12, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8 }}>
                    <Target size={14} color="#ef4444" />
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#dc2626' }}>Root Cause:</span>
                    <span style={{ fontSize: 12, color: '#991b1b' }}>{rootCauseNode.description}</span>
                </div>
            )}

            {/* ═══ MAIN LAYOUT: SVG (left) + Side Panel (right) ═══ */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 380px',
                gap: 0,
                border: '1px solid #e2e8f0',
                borderRadius: 14,
                overflow: 'hidden',
                background: '#fff',
                minHeight: 420,
            }}>
                {/* ─── LEFT: SVG Fishbone ─── */}
                <div style={{
                    background: '#f8fafc',
                    overflowX: 'auto',
                    borderRight: '1px solid #e2e8f0',
                    position: 'relative',
                }}>
                    <svg viewBox={`0 0 ${VB_W} ${VB_H}`}
                        style={{ width: '100%', minWidth: 600, height: 'auto', display: 'block' }}
                        xmlns="http://www.w3.org/2000/svg">

                        {/* ─── Fish Tail (left) ─── */}
                        <path d={`M${SPINE_LEFT},${SPINE_Y} L${SPINE_LEFT - 50},${SPINE_Y - 55} Q${SPINE_LEFT - 20},${SPINE_Y} ${SPINE_LEFT - 50},${SPINE_Y + 55} Z`}
                            fill="#e2e8f0" stroke="#94a3b8" strokeWidth="2" />
                        <line x1={SPINE_LEFT - 30} y1={SPINE_Y - 30} x2={SPINE_LEFT - 10} y2={SPINE_Y}
                            stroke="#cbd5e1" strokeWidth="1.5" />
                        <line x1={SPINE_LEFT - 30} y1={SPINE_Y + 30} x2={SPINE_LEFT - 10} y2={SPINE_Y}
                            stroke="#cbd5e1" strokeWidth="1.5" />

                        {/* ─── Central Spine ─── */}
                        <line x1={SPINE_LEFT} y1={SPINE_Y} x2={SPINE_RIGHT} y2={SPINE_Y}
                            stroke="#334155" strokeWidth="4" strokeLinecap="round" />

                        {/* ─── Fish Head (right arrow with problem text) ─── */}
                        <polygon
                            points={`${SPINE_RIGHT},${SPINE_Y - 60} ${SPINE_RIGHT + HEAD_W},${SPINE_Y} ${SPINE_RIGHT},${SPINE_Y + 60}`}
                            fill="#fef3c7" stroke="#f59e0b" strokeWidth="2.5" />
                        <text x={SPINE_RIGHT + 60} y={SPINE_Y - 12} textAnchor="middle"
                            fill="#92400e" fontSize="11" fontWeight="700" letterSpacing="0.05em">EFFECT</text>
                        <text x={SPINE_RIGHT + 60} y={SPINE_Y + 6} textAnchor="middle"
                            fill="#78350f" fontSize="13" fontWeight="600">
                            {(problemStatement || 'Problem not set').slice(0, 30)}
                        </text>
                        {(problemStatement || '').length > 30 && (
                            <text x={SPINE_RIGHT + 60} y={SPINE_Y + 22} textAnchor="middle"
                                fill="#78350f" fontSize="12" fontWeight="500">
                                {problemStatement.slice(30, 60)}{problemStatement.length > 60 ? '…' : ''}
                            </text>
                        )}

                        {/* ─── TOP Bones ─── */}
                        {topCats.map((cat, i) => {
                            const bx = getBoneX(i, topCats.length);
                            const tipX = bx - BONE_LEN * Math.cos(Math.PI / 4);
                            const tipY = SPINE_Y - BONE_LEN * Math.sin(Math.PI / 4);
                            const data = categoryMap[cat.key];
                            const causes = data?.causes ?? [];
                            const isActive = activeCat === cat.key;

                            return (
                                <g key={cat.key} style={{ cursor: 'pointer' }}
                                    onClick={() => handleCatClick(cat.key)}>
                                    {/* Active highlight glow */}
                                    {isActive && (
                                        <circle cx={bx} cy={SPINE_Y} r="16"
                                            fill="none" stroke={cat.color} strokeWidth="2"
                                            opacity="0.35" strokeDasharray="4 3">
                                            <animate attributeName="r" values="12;18;12" dur="2s" repeatCount="indefinite" />
                                        </circle>
                                    )}
                                    {/* Diagonal bone */}
                                    <line x1={bx} y1={SPINE_Y} x2={tipX} y2={tipY}
                                        stroke={cat.color} strokeWidth={isActive ? 3.5 : 2.5} strokeLinecap="round" />
                                    {/* Joint circle */}
                                    <circle cx={bx} cy={SPINE_Y} r={isActive ? 7 : 5} fill={cat.color} />

                                    {/* Category label at tip */}
                                    <text x={tipX} y={tipY - 22} textAnchor="middle"
                                        fill={cat.color} fontSize="16" fontWeight="700">{cat.label}</text>
                                    <text x={tipX} y={tipY - 8} textAnchor="middle"
                                        fill="#94a3b8" fontSize="11">{cat.subtitle}</text>

                                    {/* Cause count badge */}
                                    <circle cx={tipX + 40} cy={tipY - 26} r="10"
                                        fill={causes.length > 0 ? cat.color : '#e2e8f0'} />
                                    <text x={tipX + 40} y={tipY - 22} textAnchor="middle"
                                        fill={causes.length > 0 ? '#fff' : '#94a3b8'}
                                        fontSize="11" fontWeight="700">{causes.length}</text>

                                    {/* Sub-bones (causes) */}
                                    {causes.map((cause, ci) => {
                                        const t = (ci + 1) / (causes.length + 1);
                                        const cx = bx + (tipX - bx) * t;
                                        const cy = SPINE_Y + (tipY - SPINE_Y) * t;
                                        const sbEndX = cx - SUB_BONE_LEN;
                                        const isRoot = cause.is_root_cause;

                                        return (
                                            <g key={cause.id}>
                                                <line x1={cx} y1={cy} x2={sbEndX} y2={cy}
                                                    stroke={isRoot ? '#ef4444' : cat.color}
                                                    strokeWidth={isRoot ? 2.5 : 1.5}
                                                    opacity={isRoot ? 1 : 0.7} />
                                                <circle cx={cx} cy={cy} r={isRoot ? 4 : 2.5}
                                                    fill={isRoot ? '#ef4444' : cat.color} />
                                                <text x={sbEndX - 4} y={cy + 4} textAnchor="end"
                                                    fill={isRoot ? '#dc2626' : '#475569'}
                                                    fontSize="12" fontWeight={isRoot ? 700 : 500}>
                                                    {isRoot ? '★ ' : ''}{cause.description.slice(0, 22)}{cause.description.length > 22 ? '…' : ''}
                                                </text>
                                            </g>
                                        );
                                    })}
                                </g>
                            );
                        })}

                        {/* ─── BOTTOM Bones ─── */}
                        {botCats.map((cat, i) => {
                            const bx = getBoneX(i, botCats.length);
                            const tipX = bx - BONE_LEN * Math.cos(Math.PI / 4);
                            const tipY = SPINE_Y + BONE_LEN * Math.sin(Math.PI / 4);
                            const data = categoryMap[cat.key];
                            const causes = data?.causes ?? [];
                            const isActive = activeCat === cat.key;

                            return (
                                <g key={cat.key} style={{ cursor: 'pointer' }}
                                    onClick={() => handleCatClick(cat.key)}>
                                    {isActive && (
                                        <circle cx={bx} cy={SPINE_Y} r="16"
                                            fill="none" stroke={cat.color} strokeWidth="2"
                                            opacity="0.35" strokeDasharray="4 3">
                                            <animate attributeName="r" values="12;18;12" dur="2s" repeatCount="indefinite" />
                                        </circle>
                                    )}
                                    <line x1={bx} y1={SPINE_Y} x2={tipX} y2={tipY}
                                        stroke={cat.color} strokeWidth={isActive ? 3.5 : 2.5} strokeLinecap="round" />
                                    <circle cx={bx} cy={SPINE_Y} r={isActive ? 7 : 5} fill={cat.color} />

                                    <text x={tipX} y={tipY + 20} textAnchor="middle"
                                        fill={cat.color} fontSize="16" fontWeight="700">{cat.label}</text>
                                    <text x={tipX} y={tipY + 34} textAnchor="middle"
                                        fill="#94a3b8" fontSize="11">{cat.subtitle}</text>

                                    <circle cx={tipX + 40} cy={tipY + 14} r="10"
                                        fill={causes.length > 0 ? cat.color : '#e2e8f0'} />
                                    <text x={tipX + 40} y={tipY + 18} textAnchor="middle"
                                        fill={causes.length > 0 ? '#fff' : '#94a3b8'}
                                        fontSize="11" fontWeight="700">{causes.length}</text>

                                    {causes.map((cause, ci) => {
                                        const t = (ci + 1) / (causes.length + 1);
                                        const cx = bx + (tipX - bx) * t;
                                        const cy = SPINE_Y + (tipY - SPINE_Y) * t;
                                        const sbEndX = cx - SUB_BONE_LEN;
                                        const isRoot = cause.is_root_cause;

                                        return (
                                            <g key={cause.id}>
                                                <line x1={cx} y1={cy} x2={sbEndX} y2={cy}
                                                    stroke={isRoot ? '#ef4444' : cat.color}
                                                    strokeWidth={isRoot ? 2.5 : 1.5}
                                                    opacity={isRoot ? 1 : 0.7} />
                                                <circle cx={cx} cy={cy} r={isRoot ? 4 : 2.5}
                                                    fill={isRoot ? '#ef4444' : cat.color} />
                                                <text x={sbEndX - 4} y={cy + 4} textAnchor="end"
                                                    fill={isRoot ? '#dc2626' : '#475569'}
                                                    fontSize="12" fontWeight={isRoot ? 700 : 500}>
                                                    {isRoot ? '★ ' : ''}{cause.description.slice(0, 22)}{cause.description.length > 22 ? '…' : ''}
                                                </text>
                                            </g>
                                        );
                                    })}
                                </g>
                            );
                        })}
                    </svg>

                    {/* Click hint overlay */}
                    {!activeCat && (
                        <div style={{
                            position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)',
                            background: 'rgba(15,23,42,0.75)', color: '#e2e8f0',
                            padding: '5px 14px', borderRadius: 20, fontSize: 11, fontWeight: 500,
                            backdropFilter: 'blur(4px)', pointerEvents: 'none',
                            animation: 'fadeInUp 0.5s ease',
                        }}>
                            Click a category bone to add causes →
                        </div>
                    )}
                </div>

                {/* ─── RIGHT: Cause Entry Side Panel ─── */}
                <div ref={panelRef} style={{
                    overflowY: 'auto',
                    maxHeight: 520,
                    background: '#fff',
                }}>
                    {/* Panel header */}
                    <div style={{
                        position: 'sticky', top: 0, zIndex: 5,
                        padding: '12px 16px',
                        background: 'linear-gradient(135deg, #f8fafc, #eef2ff)',
                        borderBottom: '1px solid #e2e8f0',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>
                            Cause Entry
                        </span>
                        <span style={{ fontSize: 11, color: '#94a3b8' }}>
                            {nodes.filter(n => n.node_type !== 'category').length} total causes
                        </span>
                    </div>

                    {/* Category sections */}
                    {CATS.map(cat => {
                        const data = categoryMap[cat.key];
                        const causes = data?.causes ?? [];
                        const isAdding = addingTo === cat.key;
                        const isActive = activeCat === cat.key;

                        return (
                            <div
                                key={cat.key}
                                ref={el => { catRefs.current[cat.key] = el; }}
                                style={{
                                    borderBottom: '1px solid #f1f5f9',
                                    background: isActive ? `${cat.color}06` : 'transparent',
                                    transition: 'background 0.2s',
                                }}
                            >
                                {/* Category header row */}
                                <div
                                    onClick={() => handleCatClick(cat.key)}
                                    style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                        padding: '10px 16px', cursor: 'pointer',
                                        borderLeft: `4px solid ${isActive ? cat.color : 'transparent'}`,
                                        transition: 'all 0.15s',
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        {/* Color dot */}
                                        <div style={{
                                            width: 10, height: 10, borderRadius: '50%',
                                            background: cat.color,
                                            boxShadow: isActive ? `0 0 0 3px ${cat.color}30` : 'none',
                                            transition: 'box-shadow 0.15s',
                                        }} />
                                        <div>
                                            <div style={{ fontSize: 13, fontWeight: 700, color: cat.color }}>{cat.label}</div>
                                            <div style={{ fontSize: 10, color: '#94a3b8' }}>
                                                {cat.subtitle} · {causes.length} cause{causes.length !== 1 ? 's' : ''}
                                            </div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setAddingTo(isAdding ? null : cat.key);
                                            setNewCauseText('');
                                            if (!isActive) setActiveCat(cat.key);
                                        }}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 4,
                                            padding: '5px 12px', fontSize: 11, fontWeight: 700,
                                            background: isAdding ? '#f1f5f9' : `${cat.color}12`,
                                            color: isAdding ? '#64748b' : cat.color,
                                            border: `1px solid ${isAdding ? '#e2e8f0' : cat.color + '30'}`,
                                            borderRadius: 6, cursor: 'pointer',
                                            transition: 'all 0.15s',
                                        }}>
                                        {isAdding ? <><X size={11} /> Cancel</> : <><Plus size={11} /> Add</>}
                                    </button>
                                </div>

                                {/* Inline add form */}
                                {isAdding && (
                                    <div style={{
                                        padding: '0 16px 12px 30px',
                                    }}>
                                        <div style={{ display: 'flex', gap: 8 }}>
                                            <input
                                                value={newCauseText}
                                                onChange={e => setNewCauseText(e.target.value)}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter' && newCauseText.trim()) handleAddCause(cat.key);
                                                    if (e.key === 'Escape') { setAddingTo(null); setNewCauseText(''); }
                                                }}
                                                placeholder={`Describe a ${cat.label.toLowerCase()} cause…`}
                                                autoFocus
                                                style={{
                                                    flex: 1, padding: '8px 12px', fontSize: 13,
                                                    border: `2px solid ${cat.color}60`, borderRadius: 8,
                                                    outline: 'none', background: '#fff', color: '#1e293b',
                                                }}
                                            />
                                            <button
                                                onClick={() => handleAddCause(cat.key)}
                                                disabled={!newCauseText.trim() || busyOp}
                                                style={{
                                                    padding: '8px 14px', background: cat.color, color: '#fff',
                                                    border: 'none', borderRadius: 8, cursor: 'pointer',
                                                    fontWeight: 700, fontSize: 12,
                                                    opacity: !newCauseText.trim() ? 0.5 : 1,
                                                    display: 'flex', alignItems: 'center', gap: 4,
                                                    transition: 'opacity 0.15s',
                                                }}>
                                                <Check size={14} /> Add
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Cause list */}
                                {causes.length > 0 && (
                                    <div style={{ padding: '0 8px 8px 26px' }}>
                                        {causes.map(cause => {
                                            const isEditing = editingId === cause.id;
                                            const isDeleting = deletingId === cause.id;
                                            const isRoot = cause.is_root_cause;

                                            return (
                                                <div key={cause.id} style={{
                                                    display: 'flex', alignItems: 'center', gap: 8,
                                                    padding: '7px 10px', margin: '1px 0',
                                                    borderRadius: 8, transition: 'all 0.15s',
                                                    background: isRoot ? `${cat.color}10` : 'transparent',
                                                    borderLeft: `3px solid ${isRoot ? cat.color : 'transparent'}`,
                                                }}>
                                                    {/* Dot indicator */}
                                                    <div style={{
                                                        width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                                                        background: isRoot ? cat.color : `${cat.color}40`,
                                                    }} />

                                                    {/* Content */}
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        {isEditing ? (
                                                            <div style={{ display: 'flex', gap: 6 }}>
                                                                <input
                                                                    value={editText}
                                                                    onChange={e => setEditText(e.target.value)}
                                                                    onKeyDown={e => {
                                                                        if (e.key === 'Enter') handleSaveEdit(cause.id);
                                                                        if (e.key === 'Escape') { setEditingId(null); setEditText(''); }
                                                                    }}
                                                                    autoFocus
                                                                    style={{
                                                                        flex: 1, padding: '5px 10px', fontSize: 12,
                                                                        border: `2px solid ${cat.color}`, borderRadius: 6,
                                                                        outline: 'none', color: '#1e293b', minWidth: 0,
                                                                    }}
                                                                />
                                                                <button onClick={() => handleSaveEdit(cause.id)} disabled={busyOp}
                                                                    style={{ padding: '5px 8px', background: cat.color, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 3 }}>
                                                                    <Check size={11} />
                                                                </button>
                                                                <button onClick={() => { setEditingId(null); setEditText(''); }}
                                                                    style={{ padding: '5px 8px', background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer', fontSize: 10 }}>
                                                                    <X size={11} />
                                                                </button>
                                                            </div>
                                                        ) : isDeleting ? (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                                                                <AlertCircle size={13} color="#dc2626" />
                                                                <span style={{ color: '#991b1b', fontWeight: 600, flex: 1 }}>Delete?</span>
                                                                <button onClick={() => handleDelete(cause.id)} disabled={busyOp}
                                                                    style={{ padding: '3px 10px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>
                                                                    Yes
                                                                </button>
                                                                <button onClick={() => setDeletingId(null)}
                                                                    style={{ padding: '3px 10px', background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 10, cursor: 'pointer' }}>
                                                                    No
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <span
                                                                onClick={() => { setEditingId(cause.id); setEditText(cause.description); }}
                                                                style={{
                                                                    fontSize: 12, color: isRoot ? cat.color : '#334155',
                                                                    fontWeight: isRoot ? 700 : 500,
                                                                    cursor: 'pointer', display: 'block',
                                                                    lineHeight: 1.5,
                                                                }}
                                                                title="Click to edit">
                                                                {isRoot && <span style={{ marginRight: 4 }}>★</span>}
                                                                {cause.description}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* Action buttons */}
                                                    {!isEditing && !isDeleting && (
                                                        <div style={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                                                            <button onClick={() => handleToggleRoot(cause)} disabled={busyOp}
                                                                style={{ background: 'none', border: 'none', padding: 3, cursor: 'pointer', color: isRoot ? cat.color : '#d4d4d8', display: 'flex', borderRadius: 4 }}
                                                                title={isRoot ? 'Unmark Root Cause' : 'Mark as Root Cause'}>
                                                                <Target size={13} />
                                                            </button>
                                                            <button onClick={() => { setEditingId(cause.id); setEditText(cause.description); }}
                                                                style={{ background: 'none', border: 'none', padding: 3, cursor: 'pointer', color: '#cbd5e1', display: 'flex', borderRadius: 4 }}
                                                                title="Edit">
                                                                <Edit3 size={12} />
                                                            </button>
                                                            <button onClick={() => setDeletingId(cause.id)}
                                                                style={{ background: 'none', border: 'none', padding: 3, cursor: 'pointer', color: '#cbd5e1', display: 'flex', borderRadius: 4 }}
                                                                title="Delete">
                                                                <Trash2 size={12} />
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                {/* Empty state */}
                                {causes.length === 0 && !isAdding && (
                                    <div style={{ padding: '6px 16px 10px 30px', fontSize: 11, color: '#cbd5e1', fontStyle: 'italic' }}>
                                        No causes — click <span style={{ fontWeight: 700, color: cat.color }}>+ Add</span>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default FishboneDiagram;
