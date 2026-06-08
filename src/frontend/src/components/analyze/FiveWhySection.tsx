import React, { useState } from 'react';
import {
    Edit3, Trash2, X, Check, Plus, Target, Search,
    AlertCircle, RefreshCw,
} from 'lucide-react';
import analyzeService from '../../eam/services/AnalyzeService';
import type { RCANode } from '../../eam/services/AnalyzeService';

// ── Validate Chain – "Therefore" Reverse Test ───────────────
const ValidateChainPanel: React.FC<{ nodes: RCANode[] }> = ({ nodes }) => {
    const [expanded, setExpanded] = useState(false);

    // Build the forward chain: Problem → Whys → Root Cause
    const orderedNodes = [
        ...nodes.filter(n => n.node_type === 'problem'),
        ...nodes.filter(n => n.node_type === 'why').sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0)),
        ...nodes.filter(n => n.is_root_cause || n.node_type === 'root_cause'),
    ];
    // Reverse for "therefore" test
    const reversed = [...orderedNodes].reverse();

    if (reversed.length < 2) return null;

    return (
        <div style={{
            marginTop: 14, borderRadius: 8,
            border: `1px solid ${expanded ? '#c7d2fe' : '#e2e8f0'}`,
            background: expanded ? '#eef2ff' : '#f8fafc',
            overflow: 'hidden',
        }}>
            <button
                onClick={() => setExpanded(!expanded)}
                style={{
                    width: '100%', padding: '10px 12px',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 8,
                    fontSize: 12, fontWeight: 600, color: '#4338ca',
                }}
            >
                <RefreshCw size={14} />
                Validate Chain ("Therefore" Reverse Test)
                <span style={{ marginLeft: 'auto', fontSize: 10, color: '#6366f1' }}>
                    {expanded ? '▲ Hide' : '▼ Show'}
                </span>
            </button>

            {expanded && (
                <div style={{ padding: '0 12px 14px', borderTop: '1px solid #c7d2fe' }}>
                    <div style={{ fontSize: 11, color: '#6366f1', marginTop: 10, marginBottom: 12, fontStyle: 'italic' }}>
                        Read top-to-bottom: does each "therefore" connection make logical sense?
                    </div>
                    {reversed.map((node, idx) => {
                        const label = node.is_root_cause || node.node_type === 'root_cause' ? '★ ROOT CAUSE'
                            : node.node_type === 'problem' ? 'PROBLEM'
                            : `WHY ${orderedNodes.indexOf(node)}`;
                        return (
                            <React.Fragment key={node.id}>
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    padding: '8px 10px', borderRadius: 6,
                                    background: node.is_root_cause ? '#fef2f2' : node.node_type === 'problem' ? '#ecfeff' : '#fff',
                                    border: `1px solid ${node.is_root_cause ? '#fecaca' : node.node_type === 'problem' ? '#a5f3fc' : '#e2e8f0'}`,
                                }}>
                                    <span style={{
                                        fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                                        color: node.is_root_cause ? '#dc2626' : node.node_type === 'problem' ? '#0891b2' : '#6366f1',
                                        minWidth: 70,
                                    }}>
                                        {label}
                                    </span>
                                    <span style={{ fontSize: 12, color: '#334155', lineHeight: 1.4 }}>
                                        {node.description}
                                    </span>
                                </div>
                                {idx < reversed.length - 1 && (
                                    <div style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        padding: '4px 0', color: '#a78bfa', fontSize: 11, fontWeight: 600,
                                        gap: 4,
                                    }}>
                                        ↓ <span style={{ fontStyle: 'italic' }}>therefore</span> ↓
                                    </div>
                                )}
                            </React.Fragment>
                        );
                    })}

                    <div style={{
                        marginTop: 12, padding: '8px 10px', borderRadius: 6,
                        background: '#f0fdf4', border: '1px solid #bbf7d0',
                        fontSize: 11, color: '#166534', display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                        <Check size={14} color="#16a34a" />
                        If each step reads logically, the root cause chain is validated.
                    </div>
                </div>
            )}
        </div>
    );
};

// ── Props ─────────────────────────────────────────────────────
interface FiveWhySectionProps {
    selectedRca: {
        id: string;
        method: string;
        root_cause_summary?: string | null;
    };
    nodes: RCANode[];
    setNodes: React.Dispatch<React.SetStateAction<RCANode[]>>;
}

// ── Component ─────────────────────────────────────────────────
const FiveWhySection: React.FC<FiveWhySectionProps> = ({
    selectedRca,
    nodes,
    setNodes,
}) => {
    // Local editing / input state
    const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
    const [editingNodeText, setEditingNodeText] = useState('');
    const [deletingNodeId, setDeletingNodeId] = useState<string | null>(null);
    const [whyInput, setWhyInput] = useState('');

    // ── Pre-compute ─────────────────────────────────────────
    const whyNodes = nodes.filter(n => n.node_type === 'why' || n.node_type === 'root_cause');
    const lastWhyNodeId = whyNodes.length > 0 ? whyNodes[whyNodes.length - 1].id : null;
    const whyCount = whyNodes.length;
    const hasRootCause = nodes.some(n => n.is_root_cause);
    const hasProblem = nodes.some(n => n.node_type === 'problem');
    const nextDepth = whyCount + 1;

    const guidedPrompts: Record<number, string> = {
        0: 'Start by stating the problem as observed...',
        1: 'Why did this happen? (immediate / direct cause)',
        2: 'Why did that happen? (contributing factor)',
        3: 'Why? (dig deeper into the systemic cause)',
        4: 'Why? (organizational / process-level cause)',
        5: 'Why? (this is typically the root cause)',
    };
    const placeholder = !hasProblem
        ? guidedPrompts[0]
        : hasRootCause
        ? 'Root cause identified — add corrective actions'
        : guidedPrompts[Math.min(nextDepth, 5)] || `Why ${nextDepth}? Continue drilling down...`;

    // ── Render ───────────────────────────────────────────────
    return (
        <div style={{
            background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0',
            padding: 16, marginBottom: 16,
            display: selectedRca.method === 'fishbone' ? 'none' : 'block',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
                <Search size={14} color="#3b82f6" />
                <span style={{ fontSize: 11, fontWeight: 700, color: '#1e40af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {selectedRca.method === 'five_why' ? '5-Why Analysis Chain' : 'Cause Analysis'}
                </span>
                <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto' }}>{nodes.length} nodes</span>
            </div>

            {/* ── Existing nodes — timeline ── */}
            {nodes.length > 0 && (
                <div style={{ paddingLeft: 8, marginBottom: 12 }}>
                    {renderNodes()}
                </div>
            )}

            {/* ── Interactive Why input ── */}
            <div style={{
                background: hasRootCause ? '#f0fdf4' : '#f8fafc',
                border: `1px solid ${hasRootCause ? '#bbf7d0' : '#e2e8f0'}`,
                borderRadius: 8, padding: 12,
            }}>
                {/* Guided depth indicator */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <div style={{
                        fontSize: 10, fontWeight: 700, color: hasRootCause ? '#16a34a' : '#6366f1',
                        textTransform: 'uppercase', letterSpacing: '0.05em',
                    }}>
                        {!hasProblem ? '① Define the Problem' :
                         hasRootCause ? '✓ Analysis Complete' :
                         `② Why ${nextDepth} of 5`}
                    </div>
                    {!hasRootCause && nextDepth >= 3 && (
                        <span style={{ fontSize: 10, color: '#f59e0b', fontWeight: 600 }}>
                            💡 Consider if you've reached the root cause
                        </span>
                    )}
                </div>

                {!hasRootCause && (
                    <>
                        <input
                            value={whyInput}
                            onChange={(e) => setWhyInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && whyInput.trim()) {
                                    e.preventDefault();
                                    const wrapper = (e.target as HTMLElement).parentElement;
                                    const btn = wrapper?.querySelector('div > button') as HTMLButtonElement;
                                    btn?.click();
                                }
                            }}
                            placeholder={placeholder}
                            style={{
                                width: '100%', padding: '9px 12px', background: '#fff',
                                border: '1px solid #e2e8f0', borderRadius: 8, color: '#1e293b',
                                fontSize: 13, boxSizing: 'border-box', marginBottom: 8,
                            }}
                        />
                        <div style={{ display: 'flex', gap: 6 }}>
                            <button
                                onClick={async () => {
                                    if (!whyInput.trim()) return;
                                    const desc = whyInput.trim();
                                    const isFirst = !hasProblem;
                                    const node = await analyzeService.createRCANode({
                                        investigation_id: selectedRca.id,
                                        parent_id: null,
                                        node_type: isFirst ? 'problem' : 'why',
                                        description: desc,
                                        depth: isFirst ? 0 : nextDepth,
                                        is_root_cause: false,
                                        cause_category: null as any,
                                        cause_code: null,
                                        evidence_notes: null,
                                    });
                                    if (node) {
                                        setNodes(n => [...n, node]);
                                        setWhyInput('');
                                    }
                                }}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 4, padding: '6px 14px',
                                    background: '#6366f1', color: '#fff', border: 'none',
                                    borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 12,
                                }}
                            >
                                <Plus size={13} />
                                {!hasProblem ? 'Define Problem' : `Add Why ${nextDepth}`}
                            </button>

                            {hasProblem && whyCount >= 1 && (
                                <button
                                    onClick={async () => {
                                        if (!whyInput.trim()) return;
                                        const desc = whyInput.trim();
                                        const node = await analyzeService.createRCANode({
                                            investigation_id: selectedRca.id,
                                            parent_id: null,
                                            node_type: 'root_cause',
                                            description: desc,
                                            depth: nextDepth,
                                            is_root_cause: true,
                                            cause_category: null as any,
                                            cause_code: null,
                                            evidence_notes: null,
                                        });
                                        if (node) {
                                            setNodes(n => [...n, node]);
                                            setWhyInput('');
                                            await analyzeService.updateRCAInvestigation(selectedRca.id, {
                                                root_cause_summary: desc,
                                                status: 'in_progress',
                                            });
                                        }
                                    }}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 4, padding: '6px 14px',
                                        background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca',
                                        borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 12,
                                    }}
                                >
                                    <Target size={13} />
                                    Mark as Root Cause
                                </button>
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* ── Root Cause Summary ── */}
            {selectedRca.root_cause_summary && (
                <div style={{
                    marginTop: 14, padding: 12, borderRadius: 8,
                    background: '#fef2f2', border: '1px solid #fecaca',
                }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#dc2626', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Root Cause Summary</div>
                    <p style={{ fontSize: 13, color: '#7f1d1d', margin: 0, lineHeight: 1.5 }}>{selectedRca.root_cause_summary}</p>
                </div>
            )}

            {/* ── Validate Chain (Therefore Reverse Test) ── */}
            {hasRootCause && nodes.length >= 2 && (
                <ValidateChainPanel nodes={nodes} />
            )}

            {/* ── Escalation hint — offer to switch to Fishbone/FTA ── */}
            {!hasRootCause && whyCount >= 5 && (
                <div style={{
                    marginTop: 14, padding: 12, borderRadius: 8,
                    background: '#fffbeb', border: '1px solid #fde68a',
                    display: 'flex', alignItems: 'center', gap: 10,
                }}>
                    <AlertCircle size={16} color="#d97706" />
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#92400e' }}>
                            5-Why may not be sufficient
                        </div>
                        <div style={{ fontSize: 11, color: '#78350f', marginTop: 2 }}>
                            If a single linear chain can't pinpoint the root cause, consider escalating to a <strong>Fishbone (Ishikawa)</strong> diagram
                            for multi-category analysis, or a <strong>Fault Tree Analysis</strong> for complex systems with redundancy.
                        </div>
                    </div>
                </div>
            )}
        </div>
    );

    // ── Inner helper: render nodes timeline ──────────────────
    function renderNodes() {
        let whyIdx = 0;
        return nodes.map((node, idx) => {
            const isWhy = node.node_type === 'why' || node.node_type === 'root_cause';
            if (isWhy) whyIdx++;
            const displayLabel = node.node_type === 'problem' ? 'PROBLEM'
                : node.is_root_cause ? '★ ROOT CAUSE'
                : `WHY ${whyIdx}`;
            const isEditing = editingNodeId === node.id;
            const isDeleting = deletingNodeId === node.id;

            return (
                <div key={node.id} style={{ display: 'flex', gap: 10, marginBottom: idx === nodes.length - 1 ? 0 : 4 }}>
                    {/* Timeline dot + line */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 16 }}>
                        <div style={{
                            width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                            background: node.is_root_cause ? '#ef4444' : node.node_type === 'problem' ? '#22d3ee' : '#fff',
                            border: `2px solid ${node.is_root_cause ? '#ef4444' : node.node_type === 'problem' ? '#22d3ee' : '#6366f1'}`,
                            boxShadow: node.is_root_cause ? '0 0 8px rgba(239,68,68,0.4)' : 'none',
                        }} />
                        {idx < nodes.length - 1 && (
                            <div style={{ width: 2, flex: 1, background: '#e2e8f0', marginTop: 2 }} />
                        )}
                    </div>
                    {/* Content */}
                    <div style={{ paddingBottom: 12, flex: 1 }}>
                        <span style={{
                            fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                            color: node.is_root_cause ? '#ef4444' : node.node_type === 'problem' ? '#0891b2' : '#94a3b8',
                        }}>
                            {displayLabel}
                        </span>

                        {isEditing ? (
                            /* ── Inline edit mode ── */
                            <div style={{ marginTop: 4 }}>
                                <textarea
                                    value={editingNodeText}
                                    onChange={(e) => setEditingNodeText(e.target.value)}
                                    rows={2}
                                    style={{
                                        width: '100%', padding: '6px 10px', fontSize: 13,
                                        border: '1px solid #6366f1', borderRadius: 6, color: '#1e293b',
                                        background: '#f8fafc', resize: 'vertical', boxSizing: 'border-box',
                                        fontFamily: 'inherit', lineHeight: 1.5,
                                    }}
                                    autoFocus
                                />
                                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                                    <button
                                        onClick={async () => {
                                            if (!editingNodeText.trim()) return;
                                            const updated = await analyzeService.updateRCANode(node.id, {
                                                description: editingNodeText.trim(),
                                            });
                                            if (updated) {
                                                setNodes(ns => ns.map(n => n.id === node.id ? { ...n, description: editingNodeText.trim() } : n));
                                            }
                                            setEditingNodeId(null);
                                            setEditingNodeText('');
                                        }}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 3, padding: '4px 10px',
                                            background: '#6366f1', color: '#fff', border: 'none',
                                            borderRadius: 5, fontWeight: 600, cursor: 'pointer', fontSize: 11,
                                        }}
                                    >
                                        <Check size={12} /> Save
                                    </button>
                                    <button
                                        onClick={() => { setEditingNodeId(null); setEditingNodeText(''); }}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 3, padding: '4px 10px',
                                            background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0',
                                            borderRadius: 5, fontWeight: 600, cursor: 'pointer', fontSize: 11,
                                        }}
                                    >
                                        <X size={12} /> Cancel
                                    </button>
                                </div>
                            </div>
                        ) : isDeleting ? (
                            /* ── Delete confirmation ── */
                            <div style={{
                                marginTop: 4, padding: '6px 10px', background: '#fef2f2',
                                border: '1px solid #fecaca', borderRadius: 6,
                                display: 'flex', alignItems: 'center', gap: 8,
                            }}>
                                <span style={{ fontSize: 12, color: '#991b1b', flex: 1 }}>Delete this node?</span>
                                <button
                                    onClick={async () => {
                                        await analyzeService.deleteRCANode(node.id);
                                        setNodes(ns => ns.filter(x => x.id !== node.id));
                                        setDeletingNodeId(null);
                                    }}
                                    style={{
                                        padding: '3px 10px', background: '#ef4444', color: '#fff',
                                        border: 'none', borderRadius: 4, fontWeight: 600,
                                        cursor: 'pointer', fontSize: 11,
                                    }}
                                >
                                    Delete
                                </button>
                                <button
                                    onClick={() => setDeletingNodeId(null)}
                                    style={{
                                        padding: '3px 10px', background: '#f1f5f9', color: '#64748b',
                                        border: '1px solid #e2e8f0', borderRadius: 4, fontWeight: 600,
                                        cursor: 'pointer', fontSize: 11,
                                    }}
                                >
                                    Cancel
                                </button>
                            </div>
                        ) : (
                            /* ── Normal display mode ── */
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                                <p
                                    onClick={() => {
                                        setEditingNodeId(node.id);
                                        setEditingNodeText(node.description);
                                        setDeletingNodeId(null);
                                    }}
                                    style={{
                                        fontSize: 13, color: node.is_root_cause ? '#dc2626' : '#334155',
                                        fontWeight: node.is_root_cause ? 600 : 400,
                                        margin: '2px 0 0', lineHeight: 1.5, flex: 1,
                                        cursor: 'pointer', borderBottom: '1px dashed transparent',
                                    }}
                                    onMouseEnter={(e) => (e.currentTarget.style.borderBottomColor = '#cbd5e1')}
                                    onMouseLeave={(e) => (e.currentTarget.style.borderBottomColor = 'transparent')}
                                    title="Click to edit"
                                >{node.description}</p>
                                <div style={{ display: 'flex', gap: 2, flexShrink: 0, marginTop: 4 }}>
                                    {/* Mark as Root Cause — only on the last (newest) Why node */}
                                    {isWhy && !node.is_root_cause && !nodes.some(n => n.is_root_cause) && node.id === lastWhyNodeId && (
                                        <button
                                            onClick={async () => {
                                                const updated = await analyzeService.updateRCANode(node.id, {
                                                    is_root_cause: true,
                                                    node_type: 'root_cause',
                                                });
                                                if (updated) {
                                                    setNodes(ns => ns.map(n => n.id === node.id
                                                        ? { ...n, is_root_cause: true, node_type: 'root_cause' }
                                                        : n
                                                    ));
                                                    await analyzeService.updateRCAInvestigation(selectedRca.id, {
                                                        root_cause_summary: node.description,
                                                        status: 'in_progress',
                                                    });
                                                }
                                            }}
                                            style={{
                                                background: 'none', border: 'none', color: '#f59e0b',
                                                cursor: 'pointer', padding: 2,
                                            }}
                                            title="Mark as Root Cause"
                                        >
                                            <Target size={12} />
                                        </button>
                                    )}
                                    {/* Unmark root cause */}
                                    {node.is_root_cause && (
                                        <button
                                            onClick={async () => {
                                                const updated = await analyzeService.updateRCANode(node.id, {
                                                    is_root_cause: false,
                                                    node_type: 'why',
                                                });
                                                if (updated) {
                                                    setNodes(ns => ns.map(n => n.id === node.id
                                                        ? { ...n, is_root_cause: false, node_type: 'why' }
                                                        : n
                                                    ));
                                                    await analyzeService.updateRCAInvestigation(selectedRca.id, {
                                                        root_cause_summary: null,
                                                    });
                                                }
                                            }}
                                            style={{
                                                background: 'none', border: 'none', color: '#ef4444',
                                                cursor: 'pointer', padding: 2,
                                            }}
                                            title="Unmark Root Cause"
                                        >
                                            <Target size={12} />
                                        </button>
                                    )}
                                    <button
                                        onClick={() => {
                                            setEditingNodeId(node.id);
                                            setEditingNodeText(node.description);
                                            setDeletingNodeId(null);
                                        }}
                                        style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', padding: 2 }}
                                        title="Edit"
                                    >
                                        <Edit3 size={12} />
                                    </button>
                                    <button
                                        onClick={() => {
                                            setDeletingNodeId(node.id);
                                            setEditingNodeId(null);
                                        }}
                                        style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', padding: 2 }}
                                        title="Delete"
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            );
        });
    }
};

export default FiveWhySection;
