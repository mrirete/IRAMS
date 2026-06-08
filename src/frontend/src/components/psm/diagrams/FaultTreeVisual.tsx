/**
 * FaultTreeVisual — SVG-based Fault Tree Analysis Diagram
 *
 * IEC 61025 visual rendering:
 * Top event → AND/OR gates → intermediate events → basic events
 * With calculated cut sets and probability propagation.
 */
import React from 'react';

interface FaultTreeNode {
    id: string;
    label: string;
    type: 'top_event' | 'intermediate' | 'basic' | 'undeveloped';
    gate?: 'AND' | 'OR';
    probability?: number;
    children?: FaultTreeNode[];
}

interface FaultTreeVisualProps {
    tree: FaultTreeNode;
}

const COLORS = {
    topEvent: { fill: '#FEF2F2', stroke: '#EF4444', text: '#991B1B' },
    intermediate: { fill: '#EFF6FF', stroke: '#3B82F6', text: '#1E40AF' },
    basic: { fill: '#F0FDF4', stroke: '#22C55E', text: '#166534' },
    undeveloped: { fill: '#FFFBEB', stroke: '#F59E0B', text: '#92400E' },
    andGate: { fill: '#E0E7FF', stroke: '#6366F1' },
    orGate: { fill: '#FCE7F3', stroke: '#EC4899' },
    line: '#94A3B8',
};

// Measure subtree width
const subtreeWidth = (node: FaultTreeNode, nodeW: number, gap: number): number => {
    if (!node.children || node.children.length === 0) return nodeW;
    const childWidths = node.children.reduce((sum, c) => sum + subtreeWidth(c, nodeW, gap), 0);
    return Math.max(nodeW, childWidths + (node.children.length - 1) * gap);
};

const FaultTreeVisual: React.FC<FaultTreeVisualProps> = ({ tree }) => {
    const nodeW = 110;
    const nodeH = 36;
    const gateSize = 28;
    const levelGap = 80;
    const siblingGap = 16;

    const totalW = subtreeWidth(tree, nodeW, siblingGap) + 40;
    const maxDepth = (n: FaultTreeNode): number =>
        !n.children?.length ? 0 : 1 + Math.max(...n.children.map(maxDepth));
    const depth = maxDepth(tree);
    const totalH = (depth + 1) * levelGap + 80;

    // Render a node and its subtree
    const renderNode = (node: FaultTreeNode, cx: number, y: number, level: number): React.ReactNode[] => {
        const elements: React.ReactNode[] = [];
        const colors = node.type === 'top_event' ? COLORS.topEvent
            : node.type === 'intermediate' ? COLORS.intermediate
            : node.type === 'basic' ? COLORS.basic
            : COLORS.undeveloped;

        // Draw event shape
        if (node.type === 'basic') {
            // Circle for basic events
            elements.push(
                <g key={`node-${node.id}`}>
                    <circle cx={cx} cy={y} r={nodeH / 2 + 2} fill={colors.fill}
                        stroke={colors.stroke} strokeWidth={1.5} />
                    <text x={cx} y={y - 3} textAnchor="middle" fontSize={7}
                        fontWeight={600} fill={colors.text}>
                        {node.label.length > 12 ? node.label.slice(0, 12) + '…' : node.label}
                    </text>
                    {node.probability != null && (
                        <text x={cx} y={y + 9} textAnchor="middle" fontSize={6}
                            fill={colors.text} fontFamily="monospace" opacity={0.7}>
                            P={node.probability.toExponential(1)}
                        </text>
                    )}
                </g>
            );
        } else if (node.type === 'undeveloped') {
            // Diamond for undeveloped events
            const s = nodeH / 2 + 2;
            elements.push(
                <g key={`node-${node.id}`}>
                    <polygon points={`${cx},${y - s} ${cx + s},${y} ${cx},${y + s} ${cx - s},${y}`}
                        fill={colors.fill} stroke={colors.stroke} strokeWidth={1.5} />
                    <text x={cx} y={y + 3} textAnchor="middle" fontSize={7}
                        fontWeight={600} fill={colors.text}>
                        {node.label.length > 10 ? node.label.slice(0, 10) + '…' : node.label}
                    </text>
                </g>
            );
        } else {
            // Rectangle for top/intermediate events
            elements.push(
                <g key={`node-${node.id}`}>
                    <rect x={cx - nodeW / 2} y={y - nodeH / 2} width={nodeW} height={nodeH} rx={6}
                        fill={colors.fill} stroke={colors.stroke} strokeWidth={level === 0 ? 2.5 : 1.5} />
                    <text x={cx} y={y - 3} textAnchor="middle" fontSize={level === 0 ? 9 : 8}
                        fontWeight={700} fill={colors.text}>
                        {node.label.length > 14 ? node.label.slice(0, 14) + '…' : node.label}
                    </text>
                    {node.probability != null && (
                        <text x={cx} y={y + 10} textAnchor="middle" fontSize={6}
                            fill={colors.text} fontFamily="monospace" opacity={0.7}>
                            P={node.probability.toExponential(2)}
                        </text>
                    )}
                </g>
            );
        }

        // Gate + children
        if (node.children && node.children.length > 0 && node.gate) {
            const gateY = y + nodeH / 2 + 18;
            const gateColor = node.gate === 'AND' ? COLORS.andGate : COLORS.orGate;

            // Line from node to gate
            elements.push(
                <line key={`line-to-gate-${node.id}`}
                    x1={cx} y1={y + nodeH / 2} x2={cx} y2={gateY - gateSize / 2}
                    stroke={COLORS.line} strokeWidth={1.5} />
            );

            // Gate symbol
            if (node.gate === 'AND') {
                // Flat-bottom AND gate
                elements.push(
                    <g key={`gate-${node.id}`}>
                        <rect x={cx - gateSize / 2} y={gateY - gateSize / 2} width={gateSize} height={gateSize}
                            rx={gateSize / 2} fill={gateColor.fill} stroke={gateColor.stroke} strokeWidth={1.5} />
                        <text x={cx} y={gateY + 3} textAnchor="middle" fontSize={9}
                            fontWeight={800} fill={gateColor.stroke}>AND</text>
                    </g>
                );
            } else {
                // Curved OR gate
                elements.push(
                    <g key={`gate-${node.id}`}>
                        <ellipse cx={cx} cy={gateY} rx={gateSize / 2} ry={gateSize / 2.5}
                            fill={gateColor.fill} stroke={gateColor.stroke} strokeWidth={1.5} />
                        <text x={cx} y={gateY + 3} textAnchor="middle" fontSize={9}
                            fontWeight={800} fill={gateColor.stroke}>OR</text>
                    </g>
                );
            }

            // Children
            const childrenTotalW = node.children.reduce(
                (sum, c) => sum + subtreeWidth(c, nodeW, siblingGap), 0
            ) + (node.children.length - 1) * siblingGap;
            let childX = cx - childrenTotalW / 2;
            const childY = gateY + gateSize / 2 + levelGap - 18;

            node.children.forEach(child => {
                const cw = subtreeWidth(child, nodeW, siblingGap);
                const ccx = childX + cw / 2;

                // Line from gate to child
                elements.push(
                    <line key={`line-gate-child-${node.id}-${child.id}`}
                        x1={cx} y1={gateY + gateSize / 2} x2={ccx} y2={childY - nodeH / 2}
                        stroke={COLORS.line} strokeWidth={1} />
                );

                elements.push(...renderNode(child, ccx, childY, level + 1));
                childX += cw + siblingGap;
            });
        }

        return elements;
    };

    return (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm overflow-x-auto">
            <div className="flex items-center justify-between mb-3">
                <div>
                    <h3 className="text-sm font-bold text-slate-700">Fault Tree Diagram</h3>
                    <p className="text-[10px] text-slate-400">IEC 61025 — {tree.label}</p>
                </div>
                <div className="flex items-center gap-3 text-[9px]">
                    <span className="flex items-center gap-1">
                        <span className="w-3 h-3 rounded" style={{ backgroundColor: COLORS.andGate.fill, border: `1px solid ${COLORS.andGate.stroke}` }} />
                        AND Gate
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="w-3 h-3 rounded" style={{ backgroundColor: COLORS.orGate.fill, border: `1px solid ${COLORS.orGate.stroke}` }} />
                        OR Gate
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS.basic.fill, border: `1px solid ${COLORS.basic.stroke}` }} />
                        Basic Event
                    </span>
                </div>
            </div>

            <svg viewBox={`0 0 ${totalW} ${totalH}`} className="w-full" style={{ minHeight: Math.max(250, totalH) }}>
                {renderNode(tree, totalW / 2, 30, 0)}
            </svg>
        </div>
    );
};

export { type FaultTreeNode };
export default FaultTreeVisual;
