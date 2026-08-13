/**
 * FishboneDiagram.tsx — Interactive Ishikawa (Fishbone) with Integrated Side‑Panel
 *
 * Layout:  SVG fishbone (left) + scrollable cause‑entry panel (right)
 *
 * Clicking a category bone highlights it and scrolls the side panel.
 * Causes entered in the panel appear on the SVG instantly.
 */
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Plus, Trash2, Target, Check, X, Edit3, AlertCircle } from 'lucide-react';
import analyzeService from '../../eam/services/AnalyzeService';
import type { RCANode, RCAEvidence, RCANodeEvidenceLink } from '../../eam/services/AnalyzeService';
import NodeEvidenceChip from './NodeEvidenceChip';

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

// A <select> can only show its selected option's text, so the label has to be short —
// the closed control used to spell out all six categories and swamped the header, which
// is redundant anyway when the bones are labelled right there on the diagram. The full
// category list lives in the tooltip.
const FRAMEWORK_LABELS: Record<FishboneFramework, string> = {
    '6Ms': '6Ms', '4Ms': '4Ms', '4Ps': '4Ps', '4Ss': '4Ss',
};

/** Node types that represent an actual cause hanging off a category bone. */
const CAUSE_TYPES = new Set(['why', 'root_cause', 'contributing_factor']);

const FRAMEWORK_DESCRIPTIONS: Record<FishboneFramework, string> = {
    '6Ms': 'Man, Machine, Material, Method, Environment, Measurement',
    '4Ms': 'Man, Machine, Material, Method',
    '4Ps': 'Policies, Procedures, People, Plant',
    '4Ss': 'Surroundings, Suppliers, Systems, Skills',
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
    /** Which pane(s) to show. The full-screen workspace flips between 'diagram' and
     *  'causes' with a toggle so each gets the whole screen; the inline/desktop case
     *  keeps 'both'. In 'causes' the entry list is full-width with larger text. */
    view?: 'both' | 'diagram' | 'causes';
    /** Evidence pool + citations (0217). When present, each cause row gets an
     *  evidence chip; absent, the list renders as before. */
    evidence?: RCAEvidence[];
    setEvidence?: React.Dispatch<React.SetStateAction<RCAEvidence[]>>;
    links?: RCANodeEvidenceLink[];
    setLinks?: React.Dispatch<React.SetStateAction<RCANodeEvidenceLink[]>>;
}

// ── Layout constants ────────────────────────────────────────
const VB_W = 1200;
const VB_H = 700;
const SPINE_Y = VB_H / 2;
// Cause labels hang to the LEFT of each sub-bone (text-anchor: end), so the leftmost
// bone needs ~260px of gutter before the spine starts or its causes clip off-canvas.
const SPINE_LEFT = 300;
const SPINE_RIGHT = 960;
const HEAD_W = 200;
const BONE_LEN = 180;
const SUB_BONE_LEN = 90;

// ── Component ────────────────────────────────────────────────
const FishboneDiagram: React.FC<FishboneDiagramProps> = ({
    investigationId, problemStatement, nodes, setNodes, saving: _saving = false,
    view = 'both',
    evidence, setEvidence, links, setLinks,
}) => {
    // In the full-screen "Causes" view the entry list owns the whole screen, so the
    // text steps up to comfortable reading/tap sizes. `both` (inline) keeps compact.
    const big = view === 'causes';
    const sz = {
        catLabel: big ? 16 : 13,
        catSub: big ? 12 : 10,
        cause: big ? 15 : 12,
        input: big ? 15 : 13,
        addBtn: big ? 13 : 11,
        pad: big ? '14px 18px' : '10px 16px',
    };
    const [addingTo, setAddingTo] = useState<string | null>(null);
    const [newCauseText, setNewCauseText] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editText, setEditText] = useState('');
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [busyOp, setBusyOp] = useState(false);
    const [framework, setFramework] = useState<FishboneFramework>('6Ms');
    // A framework switch that would hide recorded causes parks here until confirmed.
    const [pendingFw, setPendingFw] = useState<FishboneFramework | null>(null);
    const [activeCat, setActiveCat] = useState<string | null>(null);

    const panelRef = useRef<HTMLDivElement>(null);
    const catRefs = useRef<Record<string, HTMLDivElement | null>>({});
    // Only one add-form is open at a time, so a single ref is enough to restore
    // focus after a button-click add (Enter-adds never lose focus).
    const addInputRef = useRef<HTMLInputElement>(null);

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

    // ── Framework ↔ data awareness ──────────────────────────
    // Causes live under category nodes keyed by name; a framework only renders ITS
    // categories, so causes recorded under another framework's categories are
    // invisible (still in the DB). Everything below exists to make that visible.
    const catDescById = useMemo(() => {
        const m = new Map<string, string>();
        nodes.forEach(n => { if (n.node_type === 'category') m.set(n.id, n.description); });
        return m;
    }, [nodes]);

    /** Causes that framework `fw` would NOT display. */
    const orphansFor = useCallback((fw: FishboneFramework) => {
        const keys = new Set(FISHBONE_FRAMEWORKS[fw].map(c => c.key));
        return nodes.filter(n => CAUSE_TYPES.has(n.node_type) && n.parent_id &&
            catDescById.has(n.parent_id) && !keys.has(catDescById.get(n.parent_id)!));
    }, [nodes, catDescById]);

    /** The framework that displays the most of this investigation's causes. */
    const bestFramework = useCallback((): FishboneFramework => {
        let best: FishboneFramework = '6Ms', bestVisible = -1;
        (Object.keys(FISHBONE_FRAMEWORKS) as FishboneFramework[]).forEach(fw => {
            const keys = new Set(FISHBONE_FRAMEWORKS[fw].map(c => c.key));
            const visible = nodes.filter(n => CAUSE_TYPES.has(n.node_type) && n.parent_id &&
                keys.has(catDescById.get(n.parent_id) ?? '')).length;
            if (visible > bestVisible) { best = fw; bestVisible = visible; }
        });
        return best;
    }, [nodes, catDescById]);

    // The framework is view state and resets to 6Ms on every load — a 4Ps/4Ss
    // investigation reopened tomorrow would show zero causes with no hint why.
    // Once the nodes arrive, snap to whichever framework its data actually uses
    // (unless the user has already picked one this session).
    const userPickedFwRef = useRef(false);
    const autoDetectedFwRef = useRef(false);
    useEffect(() => {
        if (autoDetectedFwRef.current || userPickedFwRef.current) return;
        if (!nodes.some(n => CAUSE_TYPES.has(n.node_type) && n.parent_id && catDescById.has(n.parent_id))) return;
        autoDetectedFwRef.current = true;
        const best = bestFramework();
        if (best !== framework) setFramework(best);
    }, [nodes, catDescById, bestFramework, framework]);

    const applyFramework = useCallback((fw: FishboneFramework) => {
        setFramework(fw);
        setPendingFw(null);
        // The open form / highlight may point at a category the new framework lacks.
        setActiveCat(null);
        setAddingTo(null);
    }, []);

    const handleFrameworkPick = useCallback((fw: FishboneFramework) => {
        userPickedFwRef.current = true;
        if (fw === framework) { setPendingFw(null); return; }
        if (orphansFor(fw).length > 0) setPendingFw(fw);
        else applyFramework(fw);
    }, [framework, orphansFor, applyFramework]);

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
            // Stay in add mode: causes come in bursts during a brainstorm, and closing
            // the form after every entry forces a +Add round-trip per cause. Escape or
            // Cancel closes it.
            setNewCauseText('');
            addInputRef.current?.focus();
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
    const hiddenNow = orphansFor(framework);
    const orphanCatNames = (list: RCANode[]) =>
        [...new Set(list.map(n => catDescById.get(n.parent_id!) ?? ''))].filter(Boolean).join(', ');

    return (
        // In the full-screen Causes view an unconstrained list stretches edge-to-edge on a
        // wide monitor, pinning the category label to the far left and the +Add button to the
        // far right with a screen of dead space between — cap and center it at reading width.
        <div style={{ marginBottom: 16, ...(big ? { maxWidth: 920, marginLeft: 'auto', marginRight: 'auto' } : {}) }}>
            {/* Header bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    🐟 Fishbone Diagram
                </div>
                <div style={{ flex: 1, height: 1, background: '#e2e8f0', minWidth: 40 }} />
                <select value={framework}
                    onChange={(e) => handleFrameworkPick(e.target.value as FishboneFramework)}
                    style={{ padding: '3px 8px', fontSize: 11, fontWeight: 600, color: '#4338ca', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 6, cursor: 'pointer', outline: 'none' }}
                    title={`Analysis framework — ${FRAMEWORK_DESCRIPTIONS[framework]}`}>
                    {(Object.keys(FRAMEWORK_LABELS) as FishboneFramework[]).map(fw => (
                        <option key={fw} value={fw} title={FRAMEWORK_DESCRIPTIONS[fw]}>
                            {FRAMEWORK_LABELS[fw]}
                        </option>
                    ))}
                </select>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>
                    {nodes.filter(n => n.node_type !== 'category').length} causes
                </span>
            </div>

            {/* Framework switch guard — the pick hides recorded causes; confirm first */}
            {pendingFw && (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                    padding: '8px 14px', marginBottom: 12,
                    background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8,
                    fontSize: big ? 13 : 12, color: '#92400e',
                }}>
                    <AlertCircle size={14} color="#d97706" style={{ flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 200 }}>
                        Switch to <b>{pendingFw}</b>? {orphansFor(pendingFw).length} cause{orphansFor(pendingFw).length !== 1 ? 's' : ''} under{' '}
                        <b>{orphanCatNames(orphansFor(pendingFw))}</b> will be hidden — not deleted; switching back shows them again.
                    </span>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <button onClick={() => applyFramework(pendingFw)}
                            style={{ padding: '4px 12px', background: '#d97706', color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                            Switch anyway
                        </button>
                        <button onClick={() => setPendingFw(null)}
                            style={{ padding: '4px 12px', background: '#fff', color: '#92400e', border: '1px solid #fde68a', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                            Stay on {framework}
                        </button>
                    </div>
                </div>
            )}

            {/* Standing notice — this framework is hiding causes recorded under another one */}
            {!pendingFw && hiddenNow.length > 0 && (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                    padding: '8px 14px', marginBottom: 12,
                    background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8,
                    fontSize: big ? 13 : 12, color: '#64748b',
                }}>
                    <AlertCircle size={14} color="#94a3b8" style={{ flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 200 }}>
                        {hiddenNow.length} cause{hiddenNow.length !== 1 ? 's' : ''} recorded under{' '}
                        <b>{orphanCatNames(hiddenNow)}</b> {hiddenNow.length !== 1 ? 'are' : 'is'} not shown in {framework}.
                    </span>
                    {bestFramework() !== framework && (
                        <button onClick={() => { userPickedFwRef.current = true; applyFramework(bestFramework()); }}
                            style={{ padding: '4px 12px', background: '#eef2ff', color: '#4338ca', border: '1px solid #c7d2fe', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
                            Show in {bestFramework()}
                        </button>
                    )}
                </div>
            )}

            {/* Root cause callout */}
            {rootCauseNode && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', marginBottom: 12, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8 }}>
                    <Target size={14} color="#ef4444" />
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#dc2626' }}>Root Cause:</span>
                    <span style={{ fontSize: 12, color: '#991b1b' }}>{rootCauseNode.description}</span>
                </div>
            )}

            {/* ═══ MAIN LAYOUT: SVG (top/left) + Side Panel (bottom/right) ═══
                Was a hard `1fr 380px` grid with a 600px-min SVG — ~980px of layout
                inside a 360px phone, which squeezed the side panel (where you actually
                TYPE the causes) down to nothing. Now: stacked on mobile, side-by-side
                from lg. The diagram scrolls sideways in its own box; the page doesn't. */}
            <div
                className={view === 'both' ? 'grid grid-cols-1 lg:grid-cols-[1fr_380px]' : 'block'}
                style={{
                    gap: 0,
                    border: '1px solid #e2e8f0',
                    borderRadius: 14,
                    overflow: 'hidden',
                    background: '#fff',
                    minHeight: 420,
                }}
            >
                {/* ─── LEFT: SVG Fishbone ─── */}
                {view !== 'causes' && (
                <div className="border-b lg:border-b-0 lg:border-r border-slate-200" style={{
                    background: '#f8fafc',
                    overflowX: 'auto',
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

                                    {/* Cause count badge — offset past the widest label ("Measurement") so it
                                        never sits on top of the category name */}
                                    <circle cx={tipX + 72} cy={tipY - 26} r="10"
                                        fill={causes.length > 0 ? cat.color : '#e2e8f0'} />
                                    <text x={tipX + 72} y={tipY - 22} textAnchor="middle"
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

                                    <circle cx={tipX + 72} cy={tipY + 14} r="10"
                                        fill={causes.length > 0 ? cat.color : '#e2e8f0'} />
                                    <text x={tipX + 72} y={tipY + 18} textAnchor="middle"
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
                )}

                {/* ─── RIGHT: Cause Entry Side Panel ─── */}
                {view !== 'diagram' && (
                <div ref={panelRef} style={{
                    overflowY: 'auto',
                    maxHeight: view === 'causes' ? undefined : 520,
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
                                        padding: sz.pad, cursor: 'pointer',
                                        borderLeft: `4px solid ${isActive ? cat.color : 'transparent'}`,
                                        transition: 'all 0.15s',
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        {/* Color dot */}
                                        <div style={{
                                            width: big ? 12 : 10, height: big ? 12 : 10, borderRadius: '50%',
                                            background: cat.color,
                                            boxShadow: isActive ? `0 0 0 3px ${cat.color}30` : 'none',
                                            transition: 'box-shadow 0.15s', flexShrink: 0,
                                        }} />
                                        <div>
                                            <div style={{ fontSize: sz.catLabel, fontWeight: 700, color: cat.color }}>{cat.label}</div>
                                            <div style={{ fontSize: sz.catSub, color: '#94a3b8' }}>
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
                                            padding: big ? '8px 16px' : '5px 12px', fontSize: sz.addBtn, fontWeight: 700,
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
                                                placeholder={`Describe ${/^[aeiou]/i.test(cat.label) ? 'an' : 'a'} ${cat.label.toLowerCase()} cause… (Enter to add, Esc to close)`}
                                                autoFocus
                                                ref={addInputRef}
                                                style={{
                                                    flex: 1, padding: big ? '11px 14px' : '8px 12px', fontSize: sz.input,
                                                    border: `2px solid ${cat.color}60`, borderRadius: 8,
                                                    outline: 'none', background: '#fff', color: '#1e293b',
                                                }}
                                            />
                                            <button
                                                onClick={() => handleAddCause(cat.key)}
                                                disabled={!newCauseText.trim() || busyOp}
                                                style={{
                                                    padding: big ? '11px 18px' : '8px 14px', background: cat.color, color: '#fff',
                                                    border: 'none', borderRadius: 8, cursor: 'pointer',
                                                    fontWeight: 700, fontSize: sz.addBtn,
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
                                                <div key={cause.id}
                                                    // Hover tint comes from the class so the inline background
                                                    // (which would always win) is only set for the root cause.
                                                    className={isRoot ? undefined : 'hover:bg-slate-50'}
                                                    style={{
                                                        display: 'flex', alignItems: 'center', gap: 8,
                                                        padding: big ? '10px 12px' : '7px 10px', margin: '1px 0',
                                                        borderRadius: 8, transition: 'all 0.15s',
                                                        ...(isRoot ? { background: `${cat.color}10` } : {}),
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
                                                                        flex: 1, padding: big ? '8px 12px' : '5px 10px', fontSize: big ? sz.input : 12,
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
                                                                    fontSize: sz.cause, color: isRoot ? cat.color : '#334155',
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
                                                        <div style={{ display: 'flex', gap: 3, alignItems: 'center', flexShrink: 0 }}>
                                                            {evidence && links && setLinks && setEvidence && (
                                                                <NodeEvidenceChip
                                                                    investigationId={investigationId}
                                                                    nodeId={cause.id}
                                                                    evidence={evidence}
                                                                    links={links}
                                                                    setLinks={setLinks}
                                                                    setEvidence={setEvidence}
                                                                />
                                                            )}
                                                            <button onClick={() => handleToggleRoot(cause)} disabled={busyOp}
                                                                style={{ background: 'none', border: 'none', padding: big ? 5 : 3, cursor: 'pointer', color: isRoot ? cat.color : '#94a3b8', display: 'flex', borderRadius: 4 }}
                                                                title={isRoot ? 'Unmark Root Cause' : 'Mark as Root Cause'}>
                                                                <Target size={big ? 16 : 13} />
                                                            </button>
                                                            <button onClick={() => { setEditingId(cause.id); setEditText(cause.description); }}
                                                                style={{ background: 'none', border: 'none', padding: big ? 5 : 3, cursor: 'pointer', color: '#94a3b8', display: 'flex', borderRadius: 4 }}
                                                                title="Edit">
                                                                <Edit3 size={big ? 15 : 12} />
                                                            </button>
                                                            <button onClick={() => setDeletingId(cause.id)}
                                                                style={{ background: 'none', border: 'none', padding: big ? 5 : 3, cursor: 'pointer', color: '#94a3b8', display: 'flex', borderRadius: 4 }}
                                                                title="Delete">
                                                                <Trash2 size={big ? 15 : 12} />
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                {/* Empty state — a real click target, not just text telling you where to click */}
                                {causes.length === 0 && !isAdding && (
                                    <div
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setAddingTo(cat.key);
                                            setNewCauseText('');
                                            setActiveCat(cat.key);
                                        }}
                                        style={{
                                            padding: big ? '8px 18px 14px 40px' : '6px 16px 10px 30px',
                                            fontSize: big ? 13 : 11, color: '#94a3b8', fontStyle: 'italic',
                                            cursor: 'pointer',
                                        }}>
                                        No causes yet — <span style={{ fontWeight: 700, color: cat.color, fontStyle: 'normal' }}>+ add one</span>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
                )}
            </div>
        </div>
    );
};

export default FishboneDiagram;
