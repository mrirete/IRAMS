/**
 * CauseAnalysisSection.tsx — Wrapper that conditionally renders
 * the Fishbone diagram, Fault Tree, or nothing (5-Why is handled separately).
 *
 * Routes:
 *   method === 'fishbone'   → FishboneDiagram
 *   method === 'fault_tree' → FaultTree
 *   otherwise               → null (5-Why rendered by FiveWhySection)
 */
import React from 'react';
import type { RCANode, RCAEvidence, RCANodeEvidenceLink } from '../../eam/services/AnalyzeService';
import analyzeService from '../../eam/services/AnalyzeService';
import FishboneDiagram from './FishboneDiagram';
import FaultTree, { type FaultTreeEvent } from './FaultTree';
import LogicTreeDiagram from './LogicTreeDiagram';
import { GitBranch } from 'lucide-react';

interface Props {
    method: string;
    investigationId: string;
    problemStatement: string;
    nodes: RCANode[];
    setNodes: React.Dispatch<React.SetStateAction<RCANode[]>>;
    saving: boolean;
    /** Fishbone only: which pane the full-screen workspace is showing. */
    fishboneView?: 'both' | 'diagram' | 'causes';
    /** Evidence pool + node↔evidence citations (0217) — enables the per-cause
     *  evidence chips in the Fishbone/Logic Tree entry lists. */
    evidence?: RCAEvidence[];
    setEvidence?: React.Dispatch<React.SetStateAction<RCAEvidence[]>>;
    links?: RCANodeEvidenceLink[];
    setLinks?: React.Dispatch<React.SetStateAction<RCANodeEvidenceLink[]>>;
}

const CauseAnalysisSection: React.FC<Props> = ({
    method, investigationId, problemStatement, nodes, setNodes, saving, fishboneView = 'both',
    evidence, setEvidence, links, setLinks,
}) => {
    // ── Fishbone ─────────────────────────────────────────────
    if (method === 'fishbone') {
        return (
            <div style={{
                background: '#fff', borderRadius: 10,
                border: '1px solid #e2e8f0',
                padding: fishboneView === 'both' ? 16 : 0,
                marginBottom: 16,
            }}>
                <FishboneDiagram
                    investigationId={investigationId}
                    problemStatement={problemStatement}
                    nodes={nodes}
                    setNodes={setNodes}
                    saving={saving}
                    view={fishboneView}
                    evidence={evidence}
                    setEvidence={setEvidence}
                    links={links}
                    setLinks={setLinks}
                />
            </div>
        );
    }

    // ── Fault Tree ───────────────────────────────────────────
    if (method === 'fault_tree') {
        // Convert RCANodes → FaultTreeEvents for the FaultTree component.
        // A top event must ALWAYS exist: with none (e.g. leftover fishbone
        // nodes after a method switch, no 'problem' node) the canvas rendered
        // blank and the gate buttons vanished. Orphaned nodes (parent deleted
        // or invalid) are re-parented under the top so they stay visible and
        // deletable instead of silently disappearing.
        const problemNode = nodes.find(n => n.node_type === 'problem');
        const knownIds = new Set(nodes.map(n => n.id));
        const topId = problemNode?.id ?? 'top-event';

        const mapped: FaultTreeEvent[] = nodes.map(n => {
            const isTop = n.id === topId;
            const parentValid = !!n.parent_id && n.parent_id !== n.id && knownIds.has(n.parent_id);
            return {
                id: n.id,
                label: n.description,
                type: isTop ? 'top' as const
                    : n.is_root_cause ? 'basic' as const
                    : 'intermediate' as const,
                probability: n.is_root_cause ? (n.cause_code ? parseFloat(n.cause_code) || 0.01 : 0.01) : undefined,
                gateType: isTop ? 'OR' as const : (n.gate_type ?? undefined),
                parentId: isTop ? null : (parentValid ? n.parent_id : topId),
            };
        });

        const faultTreeEvents: FaultTreeEvent[] = problemNode ? mapped : [
            {
                id: 'top-event',
                label: problemStatement || 'Top Event',
                type: 'top' as const,
                probability: undefined,
                gateType: 'OR' as const,
                parentId: null,
            },
            ...mapped,
        ];

        return (
            <div style={{
                background: '#fff', borderRadius: 10,
                border: '1px solid #e2e8f0',
                padding: 16, marginBottom: 16,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
                    <GitBranch size={14} color="#3b82f6" />
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#1e40af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Fault Tree Analysis (FTA)
                    </span>
                    <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto' }}>
                        {faultTreeEvents.length} events
                    </span>
                </div>

                {/* Auto-init hint */}
                {nodes.length === 0 && (
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '10px 14px', marginBottom: 12,
                        background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8,
                        fontSize: 12, color: '#92400e',
                    }}>
                        <span style={{ fontWeight: 600 }}>ℹ️</span>
                        Click "Add OR Gate" or "Add AND Gate" below to begin building the fault tree. 
                        A top event node will be created automatically.
                    </div>
                )}

                <FaultTree
                    events={faultTreeEvents}
                    onAddEvent={async (parentId, type, gateType) => {
                        let actualParentId = parentId;
                        
                        // If parent is the synthetic top-event, create the real problem node first
                        if (parentId === 'top-event') {
                            const topNode = await analyzeService.createRCANode({
                                investigation_id: investigationId,
                                parent_id: null,
                                node_type: 'problem',
                                description: problemStatement || 'Top Event',
                                depth: 0,
                                is_root_cause: false,
                                cause_category: null as any,
                                cause_code: null,
                                evidence_notes: null,
                                gate_type: 'OR',
                            });
                            if (topNode) {
                                setNodes(prev => [...prev, topNode]);
                                actualParentId = topNode.id;
                            } else {
                                return null; // Failed to create
                            }
                        }

                        const node = await analyzeService.createRCANode({
                            investigation_id: investigationId,
                            parent_id: actualParentId,
                            node_type: 'why',
                            description: `New ${type} event`,
                            depth: 1,
                            is_root_cause: type === 'basic',
                            cause_category: null as any,
                            cause_code: type === 'basic' ? '0.01' : null,
                            evidence_notes: null,
                            gate_type: gateType ?? null,
                        });
                        if (node) {
                            setNodes(prev => [...prev, node]);
                            return node.id;
                        }
                        return null;
                    }}
                    onRemoveEvent={async (id) => {
                        await analyzeService.deleteRCANode(id);
                        // The DB FK cascades the delete to all descendants —
                        // mirror that locally, or stale children linger with
                        // dangling parent_ids until the next refetch.
                        setNodes(prev => {
                            const toRemove = new Set([id]);
                            let grew = true;
                            while (grew) {
                                grew = false;
                                for (const n of prev) {
                                    if (n.parent_id && toRemove.has(n.parent_id) && !toRemove.has(n.id)) {
                                        toRemove.add(n.id);
                                        grew = true;
                                    }
                                }
                            }
                            return prev.filter(n => !toRemove.has(n.id));
                        });
                    }}
                    onUpdateLabel={async (id, label) => {
                        await analyzeService.updateRCANode(id, { description: label });
                        setNodes(prev => prev.map(n => n.id === id ? { ...n, description: label } : n));
                    }}
                    onUpdateProbability={async (id, prob) => {
                        await analyzeService.updateRCANode(id, { cause_code: prob.toString() });
                        setNodes(prev => prev.map(n => n.id === id ? { ...n, cause_code: prob.toString() } : n));
                    }}
                    readOnly={false}
                />
            </div>
        );
    }

    // ── Logic Tree ────────────────────────────────────────────
    if (method === 'logic_tree') {
        return (
            <div style={{
                background: '#fff', borderRadius: 10,
                border: '1px solid #e2e8f0',
                padding: 16, marginBottom: 16,
            }}>
                <LogicTreeDiagram
                    investigationId={investigationId}
                    problemStatement={problemStatement}
                    nodes={nodes}
                    setNodes={setNodes}
                    saving={saving}
                    evidence={evidence}
                    setEvidence={setEvidence}
                    links={links}
                    setLinks={setLinks}
                />
            </div>
        );
    }

    // ── 5-Why or other methods — handled by FiveWhySection ──
    return null;
};

export default CauseAnalysisSection;
