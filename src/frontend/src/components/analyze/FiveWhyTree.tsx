/**
 * FiveWhyTree — Interactive vertical tree diagram for 5-Why analysis
 * 
 * Renders cause chain as a top-down tree with AI "Suggest Next Why" capability.
 */
import React, { useMemo, useState } from 'react';
import type { RCANode } from '../../eam/services/AnalyzeService';
import { Sparkles, Plus, ChevronDown, ChevronRight, Tag } from 'lucide-react';

interface FiveWhyTreeProps {
    problemStatement: string;
    nodes: RCANode[];
    onAddWhy?: (parentId: string) => void;
    onAISuggest?: (parentId: string, currentDescription: string) => void;
    onRemoveNode?: (nodeId: string) => void;
    readOnly?: boolean;
    aiLoading?: boolean;
}

const DEPTH_COLORS = ['#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#f43f5e', '#ef4444'];
const PROACT_BADGES: Record<string, { color: string; label: string }> = {
    physical: { color: '#3b82f6', label: 'PHY' },
    human: { color: '#f59e0b', label: 'HUM' },
    latent: { color: '#ef4444', label: 'LAT' },
};

interface TreeNode {
    node: RCANode;
    children: TreeNode[];
}

function buildTree(nodes: RCANode[]): TreeNode[] {
    const map = new Map<string, TreeNode>();
    const roots: TreeNode[] = [];

    nodes.forEach(n => map.set(n.id, { node: n, children: [] }));

    nodes.forEach(n => {
        const treeNode = map.get(n.id)!;
        if (n.parent_id && map.has(n.parent_id)) {
            map.get(n.parent_id)!.children.push(treeNode);
        } else {
            roots.push(treeNode);
        }
    });

    return roots;
}

const TreeNodeComponent: React.FC<{
    treeNode: TreeNode;
    onAddWhy?: (parentId: string) => void;
    onAISuggest?: (parentId: string, desc: string) => void;
    onRemoveNode?: (nodeId: string) => void;
    readOnly: boolean;
    aiLoading: boolean;
    isLast?: boolean;
}> = ({ treeNode, onAddWhy, onAISuggest, onRemoveNode, readOnly, aiLoading, isLast }) => {
    const [expanded, setExpanded] = useState(true);
    const { node } = treeNode;
    const depthColor = DEPTH_COLORS[Math.min(node.depth, DEPTH_COLORS.length - 1)];
    const proactBadge = node.cause_category ? PROACT_BADGES[node.cause_category] : null;
    const hasChildren = treeNode.children.length > 0;

    return (
        <div style={{ marginLeft: node.depth > 0 ? 32 : 0, position: 'relative' }}>
            {/* Connector line */}
            {node.depth > 0 && (
                <div style={{
                    position: 'absolute', left: -20, top: 0, bottom: isLast ? '50%' : 0,
                    width: 2, background: `${depthColor}33`,
                }} />
            )}
            {node.depth > 0 && (
                <div style={{
                    position: 'absolute', left: -20, top: '50%', width: 20, height: 2,
                    background: `${depthColor}33`,
                }} />
            )}

            {/* Node card */}
            <div style={{
                background: node.is_root_cause
                    ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(239, 68, 68, 0.05))'
                    : 'rgba(30, 41, 59, 0.8)',
                border: `1px solid ${node.is_root_cause ? '#ef4444' : depthColor}40`,
                borderRadius: 10,
                padding: '10px 14px',
                marginBottom: 8,
                position: 'relative',
                transition: 'all 0.2s ease',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {/* Expand/collapse */}
                    {hasChildren && (
                        <button
                            onClick={() => setExpanded(!expanded)}
                            style={{
                                background: 'none', border: 'none', color: '#94a3b8',
                                cursor: 'pointer', padding: 0, display: 'flex'
                            }}
                        >
                            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                    )}

                    {/* Depth badge */}
                    <span style={{
                        background: depthColor, color: '#fff', fontSize: 10, fontWeight: 700,
                        padding: '2px 6px', borderRadius: 4, minWidth: 20, textAlign: 'center',
                    }}>
                        {node.node_type === 'problem' ? '?' : `W${node.depth}`}
                    </span>

                    {/* Description */}
                    <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: node.is_root_cause ? 700 : 400, flex: 1 }}>
                        {node.description}
                    </span>

                    {/* Root cause indicator */}
                    {node.is_root_cause && (
                        <span style={{
                            background: 'rgba(239, 68, 68, 0.2)', color: '#fca5a5', fontSize: 9,
                            fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                        }}>
                            ROOT CAUSE
                        </span>
                    )}

                    {/* PROACT badge */}
                    {proactBadge && (
                        <span style={{
                            background: `${proactBadge.color}22`, color: proactBadge.color, fontSize: 9,
                            fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                        }}>
                            {proactBadge.label}
                        </span>
                    )}

                    {/* ISO 14224 code */}
                    {node.cause_code && (
                        <span style={{
                            display: 'flex', alignItems: 'center', gap: 2,
                            color: '#94a3b8', fontSize: 9, fontWeight: 600,
                        }}>
                            <Tag size={9} /> {node.cause_code}
                        </span>
                    )}
                </div>

                {/* Action buttons */}
                {!readOnly && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, paddingLeft: hasChildren ? 22 : 0 }}>
                        {onAddWhy && (
                            <button
                                onClick={() => onAddWhy(node.id)}
                                style={{
                                    background: 'rgba(99, 102, 241, 0.1)', border: '1px solid rgba(99, 102, 241, 0.3)',
                                    color: '#818cf8', fontSize: 11, padding: '3px 10px', borderRadius: 6,
                                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                                }}
                            >
                                <Plus size={11} /> Why?
                            </button>
                        )}
                        {onAISuggest && (
                            <button
                                onClick={() => onAISuggest(node.id, node.description)}
                                disabled={aiLoading}
                                style={{
                                    background: aiLoading ? 'rgba(100, 100, 100, 0.1)' : 'rgba(168, 85, 247, 0.1)',
                                    border: `1px solid ${aiLoading ? 'rgba(100, 100, 100, 0.3)' : 'rgba(168, 85, 247, 0.3)'}`,
                                    color: aiLoading ? '#666' : '#c084fc', fontSize: 11, padding: '3px 10px', borderRadius: 6,
                                    cursor: aiLoading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                                }}
                            >
                                <Sparkles size={11} /> {aiLoading ? 'Thinking...' : 'Suggest Why'}
                            </button>
                        )}
                        {onRemoveNode && node.node_type !== 'problem' && (
                            <button
                                onClick={() => onRemoveNode(node.id)}
                                style={{
                                    background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)',
                                    color: '#f87171', fontSize: 11, padding: '3px 8px', borderRadius: 6,
                                    cursor: 'pointer',
                                }}
                            >
                                ✕
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Children */}
            {expanded && treeNode.children.map((child, i) => (
                <TreeNodeComponent
                    key={child.node.id}
                    treeNode={child}
                    onAddWhy={onAddWhy}
                    onAISuggest={onAISuggest}
                    onRemoveNode={onRemoveNode}
                    readOnly={readOnly}
                    aiLoading={aiLoading}
                    isLast={i === treeNode.children.length - 1}
                />
            ))}
        </div>
    );
};

const FiveWhyTree: React.FC<FiveWhyTreeProps> = ({
    problemStatement,
    nodes,
    onAddWhy,
    onAISuggest,
    onRemoveNode,
    readOnly = false,
    aiLoading = false,
}) => {
    const tree = useMemo(() => buildTree(nodes), [nodes]);

    return (
        <div style={{
            background: 'rgba(15, 23, 42, 0.6)', borderRadius: 12,
            border: '1px solid rgba(99, 102, 241, 0.2)', padding: 20,
        }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#e0e7ff' }}>5-Why Analysis Tree</span>
                <span style={{
                    background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8', fontSize: 10,
                    fontWeight: 600, padding: '2px 8px', borderRadius: 8,
                }}>
                    {nodes.filter(n => n.is_root_cause).length} root causes found
                </span>
            </div>

            {/* Tree */}
            {tree.length > 0 ? (
                tree.map(root => (
                    <TreeNodeComponent
                        key={root.node.id}
                        treeNode={root}
                        onAddWhy={onAddWhy}
                        onAISuggest={onAISuggest}
                        onRemoveNode={onRemoveNode}
                        readOnly={readOnly}
                        aiLoading={aiLoading}
                    />
                ))
            ) : (
                <div style={{ textAlign: 'center', color: '#64748b', padding: 40 }}>
                    <p style={{ fontSize: 14 }}>No causes identified yet.</p>
                    <p style={{ fontSize: 12, marginTop: 4 }}>Add the problem statement first, then ask "Why?" to start the analysis.</p>
                </div>
            )}
        </div>
    );
};

export default FiveWhyTree;
