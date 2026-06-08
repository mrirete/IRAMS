/**
 * BowTieVisual — SVG-based Bow-Tie Diagram Illustration
 *
 * Classic visual: Threats → Prevention Barriers → TOP EVENT → Mitigation Barriers → Consequences
 * Rendered as an interactive SVG with animated connections.
 */
import React from 'react';
import type { BowTieElement } from '../../../types/safety';

interface BowTieVisualProps {
    topEvent: BowTieElement | undefined;
    threats: BowTieElement[];
    consequences: BowTieElement[];
    preventionBarriers: BowTieElement[];
    mitigationBarriers: BowTieElement[];
    escalationFactors: BowTieElement[];
}

const COLORS = {
    threat: { fill: '#FFF7ED', stroke: '#FB923C', text: '#9A3412' },
    prevention: { fill: '#EFF6FF', stroke: '#3B82F6', text: '#1E40AF' },
    topEvent: { fill: '#FEF2F2', stroke: '#EF4444', text: '#991B1B', glow: '#FCA5A5' },
    mitigation: { fill: '#F0FDFA', stroke: '#14B8A6', text: '#115E59' },
    consequence: { fill: '#FAF5FF', stroke: '#A855F7', text: '#6B21A8' },
    escalation: { fill: '#FFFBEB', stroke: '#F59E0B', text: '#92400E' },
    line: '#CBD5E1',
    lineDanger: '#FCA5A5',
};

const BowTieVisual: React.FC<BowTieVisualProps> = ({
    topEvent, threats, consequences, preventionBarriers, mitigationBarriers, escalationFactors,
}) => {
    // Layout constants
    const W = 1100;
    const centerX = W / 2;
    const topEventY = 180;
    const threatX = 60;
    const prevBarrierX = 280;
    const mitBarrierX = W - 280;
    const consequenceX = W - 60;
    const rowGap = 52;

    const maxItems = Math.max(threats.length, consequences.length, 2);
    const H = Math.max(400, topEventY + maxItems * rowGap + 80);

    // Vertical positions for items centered around topEventY
    const itemYs = (count: number) => {
        const start = topEventY - ((count - 1) * rowGap) / 2;
        return Array.from({ length: count }, (_, i) => start + i * rowGap);
    };

    const threatYs = itemYs(Math.max(threats.length, 1));
    const consequenceYs = itemYs(Math.max(consequences.length, 1));
    const prevBarrierYs = itemYs(Math.max(preventionBarriers.length, 1));
    const mitBarrierYs = itemYs(Math.max(mitigationBarriers.length, 1));

    // Barrier vertical bar drawing
    const drawBarrierColumn = (
        x: number, items: BowTieElement[], ys: number[],
        colors: typeof COLORS.prevention, label: string
    ) => (
        <g>
            {/* Vertical barrier line */}
            <line x1={x} y1={ys[0] - 20} x2={x} y2={ys[ys.length - 1] + 20}
                stroke={colors.stroke} strokeWidth={3} strokeDasharray="8 4" opacity={0.5} />
            <text x={x} y={ys[0] - 30} textAnchor="middle"
                fontSize={9} fontWeight={700} fill={colors.text} letterSpacing={1}
                style={{ textTransform: 'uppercase' } as React.CSSProperties}>{label}</text>
            {items.map((item, i) => {
                const y = ys[i] || ys[0];
                return (
                    <g key={item.id}>
                        {/* Barrier shield shape */}
                        <rect x={x - 50} y={y - 16} width={100} height={32} rx={6}
                            fill={colors.fill} stroke={colors.stroke} strokeWidth={1.5} />
                        <text x={x} y={y + 1} textAnchor="middle" fontSize={9}
                            fontWeight={600} fill={colors.text}>
                            {item.label.length > 14 ? item.label.slice(0, 14) + '…' : item.label}
                        </text>
                        {item.pfd != null && (
                            <text x={x} y={y + 13} textAnchor="middle" fontSize={7}
                                fill={colors.text} opacity={0.6} fontFamily="monospace">
                                PFD: {item.pfd}
                            </text>
                        )}
                    </g>
                );
            })}
        </g>
    );

    return (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
                <div>
                    <h3 className="text-sm font-bold text-slate-700">Bow-Tie Diagram</h3>
                    <p className="text-[10px] text-slate-400">CCPS / Shell — Barrier Analysis Visualization</p>
                </div>
                <div className="flex items-center gap-3 text-[9px]">
                    {[
                        { color: COLORS.threat.stroke, label: 'Threats' },
                        { color: COLORS.prevention.stroke, label: 'Prevention' },
                        { color: COLORS.topEvent.stroke, label: 'Top Event' },
                        { color: COLORS.mitigation.stroke, label: 'Mitigation' },
                        { color: COLORS.consequence.stroke, label: 'Consequences' },
                    ].map(l => (
                        <span key={l.label} className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: l.color }} />
                            {l.label}
                        </span>
                    ))}
                </div>
            </div>

            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minHeight: 300 }}>
                <defs>
                    <filter id="topEventGlow">
                        <feGaussianBlur stdDeviation="4" result="blur" />
                        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                    <marker id="arrowHead" viewBox="0 0 10 10" refX={8} refY={5}
                        markerWidth={6} markerHeight={6} orient="auto-start-reverse">
                        <path d="M 0 0 L 10 5 L 0 10 z" fill={COLORS.line} />
                    </marker>
                    <marker id="arrowHeadDanger" viewBox="0 0 10 10" refX={8} refY={5}
                        markerWidth={6} markerHeight={6} orient="auto-start-reverse">
                        <path d="M 0 0 L 10 5 L 0 10 z" fill={COLORS.lineDanger} />
                    </marker>
                    {/* Animated dash */}
                    <style>{`
                        @keyframes flowLeft { from { stroke-dashoffset: 40; } to { stroke-dashoffset: 0; } }
                        @keyframes flowRight { from { stroke-dashoffset: 0; } to { stroke-dashoffset: 40; } }
                        .flow-left { animation: flowLeft 2s linear infinite; }
                        .flow-right { animation: flowRight 2s linear infinite; }
                    `}</style>
                </defs>

                {/* ─── Connection Lines: Threats → Prevention barriers → Top Event ─── */}
                {threats.map((t, i) => {
                    const y = threatYs[i];
                    return (
                        <g key={`tl-${t.id}`}>
                            {/* Threat → prevention barrier */}
                            <line x1={threatX + 80} y1={y} x2={prevBarrierX - 55} y2={y}
                                stroke={COLORS.line} strokeWidth={1.5} strokeDasharray="6 3"
                                className="flow-left" markerEnd="url(#arrowHead)" />
                        </g>
                    );
                })}
                {/* Prevention barriers → Top Event */}
                {preventionBarriers.map((_, i) => {
                    const y = prevBarrierYs[i];
                    return (
                        <line key={`pte-${i}`} x1={prevBarrierX + 55} y1={y} x2={centerX - 65} y2={topEventY}
                            stroke={COLORS.lineDanger} strokeWidth={1.5} strokeDasharray="6 3"
                            className="flow-left" markerEnd="url(#arrowHeadDanger)" />
                    );
                })}
                {/* Top Event → Mitigation barriers */}
                {mitigationBarriers.map((_, i) => {
                    const y = mitBarrierYs[i];
                    return (
                        <line key={`tem-${i}`} x1={centerX + 65} y1={topEventY} x2={mitBarrierX - 55} y2={y}
                            stroke={COLORS.lineDanger} strokeWidth={1.5} strokeDasharray="6 3"
                            className="flow-right" markerEnd="url(#arrowHeadDanger)" />
                    );
                })}
                {/* Mitigation barriers → Consequences */}
                {consequences.map((c, i) => {
                    const y = consequenceYs[i];
                    return (
                        <line key={`mc-${c.id}`} x1={mitBarrierX + 55} y1={y} x2={consequenceX - 80} y2={y}
                            stroke={COLORS.line} strokeWidth={1.5} strokeDasharray="6 3"
                            className="flow-right" markerEnd="url(#arrowHead)" />
                    );
                })}

                {/* ─── Threats ─── */}
                {threats.map((t, i) => {
                    const y = threatYs[i];
                    return (
                        <g key={t.id}>
                            <rect x={threatX - 55} y={y - 16} width={130} height={32} rx={8}
                                fill={COLORS.threat.fill} stroke={COLORS.threat.stroke} strokeWidth={1.5} />
                            <text x={threatX + 10} y={y + 1} textAnchor="middle" fontSize={9}
                                fontWeight={600} fill={COLORS.threat.text}>
                                {t.label.length > 18 ? t.label.slice(0, 18) + '…' : t.label}
                            </text>
                        </g>
                    );
                })}

                {/* ─── Prevention Barriers ─── */}
                {drawBarrierColumn(prevBarrierX, preventionBarriers, prevBarrierYs, COLORS.prevention, 'Prevention')}

                {/* ─── TOP EVENT (center) ─── */}
                {topEvent && (
                    <g filter="url(#topEventGlow)">
                        {/* Diamond shape */}
                        <polygon
                            points={`${centerX},${topEventY - 40} ${centerX + 60},${topEventY} ${centerX},${topEventY + 40} ${centerX - 60},${topEventY}`}
                            fill={COLORS.topEvent.fill} stroke={COLORS.topEvent.stroke} strokeWidth={2.5} />
                        <text x={centerX} y={topEventY - 5} textAnchor="middle" fontSize={8}
                            fontWeight={700} fill={COLORS.topEvent.text}
                            style={{ textTransform: 'uppercase' } as React.CSSProperties}>TOP EVENT</text>
                        <text x={centerX} y={topEventY + 10} textAnchor="middle" fontSize={9}
                            fontWeight={600} fill={COLORS.topEvent.text}>
                            {topEvent.label.length > 14 ? topEvent.label.slice(0, 14) + '…' : topEvent.label}
                        </text>
                    </g>
                )}

                {/* ─── Mitigation Barriers ─── */}
                {drawBarrierColumn(mitBarrierX, mitigationBarriers, mitBarrierYs, COLORS.mitigation, 'Mitigation')}

                {/* ─── Consequences ─── */}
                {consequences.map((c, i) => {
                    const y = consequenceYs[i];
                    return (
                        <g key={c.id}>
                            <rect x={consequenceX - 75} y={y - 16} width={130} height={32} rx={8}
                                fill={COLORS.consequence.fill} stroke={COLORS.consequence.stroke} strokeWidth={1.5} />
                            <text x={consequenceX - 10} y={y + 1} textAnchor="middle" fontSize={9}
                                fontWeight={600} fill={COLORS.consequence.text}>
                                {c.label.length > 18 ? c.label.slice(0, 18) + '…' : c.label}
                            </text>
                        </g>
                    );
                })}

                {/* ─── Escalation Factors (below top event) ─── */}
                {escalationFactors.length > 0 && (
                    <g>
                        <line x1={centerX} y1={topEventY + 45} x2={centerX} y2={topEventY + 80}
                            stroke={COLORS.escalation.stroke} strokeWidth={1.5} strokeDasharray="4 3" />
                        {escalationFactors.map((ef, i) => (
                            <g key={ef.id}>
                                <rect x={centerX - 60} y={topEventY + 85 + i * 35} width={120} height={28} rx={6}
                                    fill={COLORS.escalation.fill} stroke={COLORS.escalation.stroke} strokeWidth={1.5} />
                                <text x={centerX} y={topEventY + 103 + i * 35} textAnchor="middle" fontSize={8}
                                    fontWeight={600} fill={COLORS.escalation.text}>
                                    {ef.label.length > 18 ? ef.label.slice(0, 18) + '…' : ef.label}
                                </text>
                            </g>
                        ))}
                    </g>
                )}

                {/* ─── Empty state ─── */}
                {(!topEvent && threats.length === 0 && consequences.length === 0) && (
                    <text x={centerX} y={H / 2} textAnchor="middle" fontSize={12} fill="#94A3B8">
                        Add threats, barriers, and consequences to build the Bow-Tie diagram
                    </text>
                )}
            </svg>
        </div>
    );
};

export default BowTieVisual;
