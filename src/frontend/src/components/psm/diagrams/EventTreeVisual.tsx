/**
 * EventTreeVisual — SVG-based Event Tree branching diagram
 *
 * IEC 62502:2010 visual rendering:
 * Initiating event → binary branching per safety function header →
 * outcome nodes with calculated frequencies.
 */
import React from 'react';
import type { EventTreeBranch, EventTreeOutcome } from '../../../types/safety';

interface EventTreeVisualProps {
    tree: EventTreeBranch;
}

const BRANCH_COLORS = {
    success: { fill: '#D1FAE5', stroke: '#10B981', text: '#065F46' },
    failure: { fill: '#FEE2E2', stroke: '#EF4444', text: '#991B1B' },
    header: { fill: '#EFF6FF', stroke: '#3B82F6', text: '#1E40AF' },
    ie: { fill: '#FEF3C7', stroke: '#F59E0B', text: '#92400E' },
    outcome: { fill: '#F3F4F6', stroke: '#6B7280', text: '#374151' },
    line: '#94A3B8',
};

const EventTreeVisual: React.FC<EventTreeVisualProps> = ({ tree }) => {
    const headers = tree.headers || [];
    const outcomes = (tree.branches || []) as EventTreeOutcome[];
    const headerCount = headers.length;
    const outcomeCount = outcomes.length || Math.pow(2, headerCount);

    if (headerCount === 0) {
        return (
            <div className="bg-white border border-slate-200 rounded-xl p-6 text-center">
                <p className="text-sm text-slate-400">Add safety function headers to generate the event tree diagram</p>
            </div>
        );
    }

    // Layout
    const colW = 120;
    const ieW = 130;
    const outcomeW = 180;
    const rowH = 40;
    const headerH = 50;
    const W = ieW + headerCount * colW + outcomeW + 40;
    const H = headerH + outcomeCount * rowH + 30;

    // Build tree structure recursively
    type TreeNode = { headerIdx: number; isSuccess: boolean; y: number; spanRows: number; children: TreeNode[] };

    const buildNodes = (headerIdx: number, startRow: number, spanRows: number): TreeNode[] => {
        if (headerIdx >= headerCount) return [];
        const halfSpan = spanRows / 2;
        return [
            {
                headerIdx,
                isSuccess: true,
                y: startRow,
                spanRows: halfSpan,
                children: buildNodes(headerIdx + 1, startRow, halfSpan),
            },
            {
                headerIdx,
                isSuccess: false,
                y: startRow + halfSpan,
                spanRows: halfSpan,
                children: buildNodes(headerIdx + 1, startRow + halfSpan, halfSpan),
            },
        ];
    };

    const nodes = buildNodes(0, 0, outcomeCount);

    // Render lines and nodes recursively
    const renderBranches = (nodeList: TreeNode[], parentX: number, parentY: number): React.ReactNode[] => {
        const elements: React.ReactNode[] = [];

        nodeList.forEach((node, i) => {
            const x = ieW + node.headerIdx * colW + colW / 2;
            const yCenter = headerH + (node.y + node.spanRows / 2) * rowH;

            // Horizontal line from parent
            elements.push(
                <line key={`h-${node.headerIdx}-${i}-${node.isSuccess}`}
                    x1={parentX} y1={parentY} x2={parentX} y2={yCenter}
                    stroke={BRANCH_COLORS.line} strokeWidth={1.5} />
            );
            elements.push(
                <line key={`v-${node.headerIdx}-${i}-${node.isSuccess}`}
                    x1={parentX} y1={yCenter} x2={x - 20} y2={yCenter}
                    stroke={BRANCH_COLORS.line} strokeWidth={1.5} />
            );

            // Branch indicator (Yes/No)
            const brColor = node.isSuccess ? BRANCH_COLORS.success : BRANCH_COLORS.failure;
            elements.push(
                <g key={`node-${node.headerIdx}-${i}-${node.isSuccess}`}>
                    <rect x={x - 20} y={yCenter - 10} width={40} height={20} rx={4}
                        fill={brColor.fill} stroke={brColor.stroke} strokeWidth={1} />
                    <text x={x} y={yCenter + 3} textAnchor="middle" fontSize={8}
                        fontWeight={600} fill={brColor.text}>
                        {node.isSuccess ? 'YES' : 'NO'}
                    </text>
                </g>
            );

            // Recurse
            if (node.children.length > 0) {
                elements.push(...renderBranches(node.children, x + 20, yCenter));
            }
        });

        return elements;
    };

    // Get outcome index for a given path position
    const getOutcomeRow = (idx: number): number => headerH + (idx + 0.5) * rowH;

    return (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm overflow-x-auto">
            <div className="flex items-center justify-between mb-3">
                <div>
                    <h3 className="text-sm font-bold text-slate-700">Event Tree Diagram</h3>
                    <p className="text-[10px] text-slate-400">IEC 62502:2010 — {tree.initiating_event}</p>
                </div>
            </div>

            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minHeight: Math.max(200, H) }}>
                <defs>
                    <filter id="etShadow">
                        <feDropShadow dx={0} dy={1} stdDeviation={2} floodOpacity={0.06} />
                    </filter>
                </defs>

                {/* ─── Header row ─── */}
                <g>
                    {/* IE header */}
                    <rect x={5} y={5} width={ieW - 10} height={headerH - 10} rx={8}
                        fill={BRANCH_COLORS.ie.fill} stroke={BRANCH_COLORS.ie.stroke} strokeWidth={1.5}
                        filter="url(#etShadow)" />
                    <text x={ieW / 2} y={22} textAnchor="middle" fontSize={7}
                        fontWeight={700} fill={BRANCH_COLORS.ie.text}
                        style={{ textTransform: 'uppercase' } as React.CSSProperties}>
                        INITIATING EVENT
                    </text>
                    <text x={ieW / 2} y={34} textAnchor="middle" fontSize={8}
                        fontWeight={600} fill={BRANCH_COLORS.ie.text}>
                        {tree.ie_frequency != null ? `f = ${tree.ie_frequency}/yr` : '—'}
                    </text>

                    {/* Safety function headers */}
                    {headers.map((h, i) => {
                        const x = ieW + i * colW;
                        return (
                            <g key={`hdr-${i}`}>
                                <rect x={x + 5} y={5} width={colW - 10} height={headerH - 10} rx={8}
                                    fill={BRANCH_COLORS.header.fill} stroke={BRANCH_COLORS.header.stroke}
                                    strokeWidth={1.5} filter="url(#etShadow)" />
                                <text x={x + colW / 2} y={22} textAnchor="middle" fontSize={8}
                                    fontWeight={600} fill={BRANCH_COLORS.header.text}>
                                    {h.name.length > 14 ? h.name.slice(0, 14) + '…' : h.name}
                                </text>
                                <text x={x + colW / 2} y={34} textAnchor="middle" fontSize={7}
                                    fill={BRANCH_COLORS.header.text} fontFamily="monospace" opacity={0.7}>
                                    P(s) = {h.success_prob}
                                </text>
                            </g>
                        );
                    })}

                    {/* Outcome header */}
                    <rect x={ieW + headerCount * colW + 5} y={5} width={outcomeW - 10} height={headerH - 10} rx={8}
                        fill={BRANCH_COLORS.outcome.fill} stroke={BRANCH_COLORS.outcome.stroke}
                        strokeWidth={1.5} filter="url(#etShadow)" />
                    <text x={ieW + headerCount * colW + outcomeW / 2} y={28} textAnchor="middle"
                        fontSize={8} fontWeight={700} fill={BRANCH_COLORS.outcome.text}>
                        OUTCOME
                    </text>
                </g>

                {/* ─── IE vertical line down ─── */}
                <line x1={ieW / 2} y1={headerH} x2={ieW / 2} y2={H - 10}
                    stroke={BRANCH_COLORS.ie.stroke} strokeWidth={2} opacity={0.3} />

                {/* ─── Branch lines ─── */}
                {renderBranches(nodes, ieW / 2, headerH)}

                {/* ─── Outcome boxes ─── */}
                {outcomes.map((o, idx) => {
                    const y = getOutcomeRow(idx);
                    const lastBranchX = ieW + (headerCount - 1) * colW + colW / 2 + 20;
                    const ox = ieW + headerCount * colW + 10;
                    const isGood = o.path.every(p => p);
                    const isWorst = o.path.every(p => !p);

                    return (
                        <g key={`outcome-${idx}`}>
                            {/* Line from last branch to outcome */}
                            <line x1={lastBranchX} y1={y} x2={ox} y2={y}
                                stroke={BRANCH_COLORS.line} strokeWidth={1} strokeDasharray="4 2" />
                            {/* Outcome box */}
                            <rect x={ox} y={y - 14} width={outcomeW - 20} height={28} rx={5}
                                fill={isGood ? '#D1FAE5' : isWorst ? '#FEE2E2' : '#F3F4F6'}
                                stroke={isGood ? '#10B981' : isWorst ? '#EF4444' : '#9CA3AF'}
                                strokeWidth={1} />
                            <text x={ox + 5} y={y + 1} fontSize={8} fontWeight={600}
                                fill={isGood ? '#065F46' : isWorst ? '#991B1B' : '#374151'}>
                                {o.outcome.length > 14 ? o.outcome.slice(0, 14) + '…' : o.outcome}
                            </text>
                            <text x={ox + outcomeW - 25} y={y + 2} textAnchor="end" fontSize={7}
                                fill="#6B7280" fontFamily="monospace">
                                {o.frequency.toExponential(2)}
                            </text>
                        </g>
                    );
                })}
            </svg>
        </div>
    );
};

export default EventTreeVisual;
