/**
 * DigitalThreadViewer — Asset Lifecycle Traceability Graph (Phase 5, Cap 7)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Traces: Failure → WO → SR → PM → RCA → FMEA → Design Basis
 *
 * Renders an interactive directed graph showing the complete "digital thread"
 * of an asset — connecting all related records into a coherent visual narrative.
 *
 * Features:
 *   - Mermaid-based directed graph with colour-coded node types
 *   - Clickable nodes that navigate to source records
 *   - AI-generated narrative panel alongside the graph
 *   - Recommendations for reliability improvement
 *
 * HITL: Informational — no mutations. Aids root cause analysis and lifecycle review.
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { aiEngine } from '../../services/AIAnalysisEngine';
import type { DigitalThreadTrace, DigitalThreadNode } from '../../services/AIAnalysisEngine';

// ── Node Type Config ────────────────────────────────────────

const NODE_CONFIG: Record<string, { icon: string; color: string; bg: string; label: string }> = {
    failure_event:   { icon: '💥', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.12)', label: 'Failure' },
    work_order:      { icon: '🔧', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.12)', label: 'Work Order' },
    service_request: { icon: '📋', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.12)', label: 'Service Request' },
    pm_program:      { icon: '🔄', color: '#10b981', bg: 'rgba(16, 185, 129, 0.12)', label: 'PM Program' },
    design_basis:    { icon: '📐', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)', label: 'Design Basis' },
    oem_bulletin:    { icon: '📰', color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.12)', label: 'OEM Bulletin' },
    moc:             { icon: '📝', color: '#ec4899', bg: 'rgba(236, 72, 153, 0.12)', label: 'MoC' },
    rca:             { icon: '🔍', color: '#f97316', bg: 'rgba(249, 115, 22, 0.12)', label: 'RCA' },
    fmea:            { icon: '⚡', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.12)', label: 'FMEA' },
};

// ── Styles ──────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
    container: {
        borderRadius: 16, overflow: 'hidden',
        background: 'rgba(15, 15, 30, 0.95)',
        border: '1px solid rgba(139, 92, 246, 0.15)',
        fontFamily: '"Inter", "Segoe UI", system-ui, sans-serif',
    },
    header: {
        padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 10,
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
    },
    title: { fontSize: 15, fontWeight: 700, color: '#e2e8f0' },
    badge: {
        fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
        background: 'rgba(139, 92, 246, 0.15)', color: '#a78bfa',
        textTransform: 'uppercase' as const, letterSpacing: 0.5,
    },
    body: {
        display: 'grid', gridTemplateColumns: '1fr 340px',
        minHeight: 400,
    },
    graphPanel: {
        padding: 20, overflowY: 'auto' as const,
        borderRight: '1px solid rgba(255, 255, 255, 0.06)',
    },
    narrativePanel: {
        padding: 20, overflowY: 'auto' as const, maxHeight: 500,
    },
    generateBtn: {
        width: '100%', padding: '12px 20px', borderRadius: 10, border: 'none',
        background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
        color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        marginBottom: 16,
    },
    nodeCard: {
        padding: '10px 14px', borderRadius: 10, marginBottom: 8,
        cursor: 'pointer', transition: 'all 0.2s',
        display: 'flex', alignItems: 'flex-start', gap: 10,
    },
    nodeIcon: { fontSize: 18, lineHeight: 1, marginTop: 2 },
    nodeTitle: { fontSize: 12, fontWeight: 600, color: '#e2e8f0', marginBottom: 2 },
    nodeDate: { fontSize: 10, color: '#64748b' },
    nodeSummary: { fontSize: 11, color: '#94a3b8', lineHeight: 1.5, marginTop: 4 },
    nodeType: { fontSize: 9, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
    connectionLine: {
        width: 2, height: 16, marginLeft: 24,
        background: 'linear-gradient(to bottom, rgba(139, 92, 246, 0.3), transparent)',
    },
    narrativeTitle: {
        fontSize: 13, fontWeight: 700, color: '#c4b5fd', marginBottom: 12,
        display: 'flex', alignItems: 'center', gap: 8,
    },
    narrativeText: {
        fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.7, marginBottom: 16,
    },
    recSection: { marginTop: 16 },
    recTitle: {
        fontSize: 11, fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase' as const,
        letterSpacing: 0.5, marginBottom: 8,
    },
    recItem: {
        padding: '8px 12px', borderRadius: 8, marginBottom: 6,
        background: 'rgba(251, 191, 36, 0.06)', border: '1px solid rgba(251, 191, 36, 0.12)',
        fontSize: 12, color: '#fde68a', lineHeight: 1.5,
    },
    legend: {
        display: 'flex', flexWrap: 'wrap' as const, gap: 8, padding: '12px 20px',
        borderTop: '1px solid rgba(255, 255, 255, 0.06)',
    },
    legendItem: {
        display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#64748b',
    },
    legendDot: {
        width: 8, height: 8, borderRadius: '50%',
    },
    emptyState: {
        padding: 40, textAlign: 'center' as const, color: '#64748b', fontSize: 13,
    },
    loading: {
        padding: 40, textAlign: 'center' as const,
    },
};

// ── Component ───────────────────────────────────────────────

interface DigitalThreadViewerProps {
    assetId: string;
    assetName: string;
    workOrders?: { id: string; title: string; type: string; date: string; failureMode?: string; status?: string }[];
    serviceRequests?: { id: string; title: string; date: string; status?: string }[];
    pmPrograms?: { id: string; title: string; interval: string; status?: string }[];
    rcaInvestigations?: { id: string; title: string; rootCause?: string; date?: string }[];
    fmeaItems?: { id: string; failureMode: string; rpn: number }[];
    onNodeClick?: (nodeType: string, nodeId: string) => void;
}

const DigitalThreadViewer: React.FC<DigitalThreadViewerProps> = ({
    assetId,
    assetName,
    workOrders = [],
    serviceRequests = [],
    pmPrograms = [],
    rcaInvestigations = [],
    fmeaItems = [],
    onNodeClick,
}) => {
    const [isLoading, setIsLoading] = useState(false);
    const [trace, setTrace] = useState<DigitalThreadTrace | null>(null);
    const [selectedNode, setSelectedNode] = useState<string | null>(null);

    const hasData = workOrders.length > 0 || serviceRequests.length > 0 ||
                    pmPrograms.length > 0 || rcaInvestigations.length > 0 || fmeaItems.length > 0;

    const handleGenerate = useCallback(async () => {
        setIsLoading(true);
        try {
            const startPoint = workOrders[0]
                ? { type: 'work_order', id: workOrders[0].id, title: workOrders[0].title }
                : { type: 'asset', id: assetId, title: assetName };

            const result = await aiEngine.traceDigitalThread({
                assetId,
                assetName,
                startingPoint: startPoint,
                workOrders,
                serviceRequests,
                pmPrograms,
                rcaInvestigations,
                fmeaItems,
            });
            setTrace(result);
        } catch (error) {
            console.error('[DigitalThreadViewer] Trace failed:', error);
        } finally {
            setIsLoading(false);
        }
    }, [assetId, assetName, workOrders, serviceRequests, pmPrograms, rcaInvestigations, fmeaItems]);

    const handleNodeClick = useCallback((node: DigitalThreadNode) => {
        setSelectedNode(node.nodeId);
        if (onNodeClick) {
            onNodeClick(node.nodeType, node.nodeId);
        }
    }, [onNodeClick]);

    // Sort nodes chronologically
    const sortedNodes = useMemo(() => {
        if (!trace) return [];
        return [...trace.traceNodes].sort((a, b) =>
            new Date(a.date || '1900-01-01').getTime() - new Date(b.date || '1900-01-01').getTime()
        );
    }, [trace]);

    return (
        <div style={S.container}>
            {/* Header */}
            <div style={S.header}>
                <span style={{ fontSize: 18 }}>🔗</span>
                <span style={S.title}>Digital Thread — {assetName}</span>
                <span style={S.badge}>Lifecycle Trace</span>
            </div>

            {!trace ? (
                /* ── Pre-generation ────────────────── */
                <div style={{ padding: 24 }}>
                    {!hasData ? (
                        <div style={S.emptyState}>
                            <div style={{ fontSize: 36, marginBottom: 12 }}>📭</div>
                            <p>No maintenance records found for this asset.</p>
                            <p style={{ fontSize: 11, marginTop: 4 }}>Work orders, service requests, and PM programs will appear here once created.</p>
                        </div>
                    ) : (
                        <>
                            <p style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.6, marginBottom: 16 }}>
                                Trace the complete maintenance lifecycle for <strong style={{ color: '#e2e8f0' }}>{assetName}</strong>.
                                AI will connect {workOrders.length} WO{workOrders.length !== 1 ? 's' : ''}, {serviceRequests.length} SR{serviceRequests.length !== 1 ? 's' : ''},
                                {' '}{pmPrograms.length} PM program{pmPrograms.length !== 1 ? 's' : ''}, and {rcaInvestigations.length + fmeaItems.length} reliability items
                                into a coherent narrative.
                            </p>
                            <button
                                style={{ ...S.generateBtn, ...(isLoading ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}
                                onClick={handleGenerate}
                                disabled={isLoading}
                            >
                                {isLoading ? (
                                    <><span>⏳</span> Tracing Digital Thread…</>
                                ) : (
                                    <><span>🔗</span> Generate Digital Thread</>
                                )}
                            </button>
                        </>
                    )}
                </div>
            ) : (
                /* ── Trace View ────────────────────── */
                <>
                    <div style={S.body}>
                        {/* Graph Panel */}
                        <div style={S.graphPanel}>
                            {sortedNodes.map((node, i) => {
                                const config = NODE_CONFIG[node.nodeType] || NODE_CONFIG.work_order;
                                const isSelected = selectedNode === node.nodeId;
                                return (
                                    <React.Fragment key={node.nodeId}>
                                        <div
                                            style={{
                                                ...S.nodeCard,
                                                background: isSelected ? config.bg : 'rgba(255, 255, 255, 0.02)',
                                                border: `1px solid ${isSelected ? config.color + '44' : 'rgba(255, 255, 255, 0.06)'}`,
                                            }}
                                            onClick={() => handleNodeClick(node)}
                                        >
                                            <div style={S.nodeIcon}>{config.icon}</div>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <span style={{ ...S.nodeType, color: config.color }}>{config.label}</span>
                                                    <span style={S.nodeDate}>{node.date || 'N/A'}</span>
                                                </div>
                                                <div style={S.nodeTitle}>{node.title}</div>
                                                <div style={S.nodeSummary}>{node.summary}</div>
                                                {node.linkedNodes.length > 0 && (
                                                    <div style={{ marginTop: 4, fontSize: 10, color: '#64748b' }}>
                                                        🔗 {node.linkedNodes.length} connection{node.linkedNodes.length !== 1 ? 's' : ''}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        {i < sortedNodes.length - 1 && <div style={S.connectionLine} />}
                                    </React.Fragment>
                                );
                            })}
                        </div>

                        {/* Narrative Panel */}
                        <div style={S.narrativePanel}>
                            <div style={S.narrativeTitle}>
                                <span>📖</span> AI Narrative
                            </div>
                            <div style={S.narrativeText}>
                                {trace.narrative}
                            </div>

                            {trace.recommendations.length > 0 && (
                                <div style={S.recSection}>
                                    <div style={S.recTitle}>💡 Recommendations</div>
                                    {trace.recommendations.map((rec, i) => (
                                        <div key={i} style={S.recItem}>
                                            {i + 1}. {rec}
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div style={{ marginTop: 16, fontSize: 10, color: '#475569' }}>
                                AI Confidence: {(trace.aiConfidence * 100).toFixed(0)}% • {sortedNodes.length} nodes traced
                            </div>
                        </div>
                    </div>

                    {/* Legend */}
                    <div style={S.legend}>
                        {Object.entries(NODE_CONFIG).map(([key, cfg]) => (
                            <div key={key} style={S.legendItem}>
                                <div style={{ ...S.legendDot, background: cfg.color }} />
                                <span>{cfg.label}</span>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

export default DigitalThreadViewer;
