/**
 * SwissCheeseModel — Reason's Swiss Cheese Model for LOPA
 *
 * Animated SVG: Initiating Event → [Cheese slices with holes] → Consequence
 * Each slice = an IPL with its PFD shown as hole size.
 * Based on Prof. James Reason's model (1990) / CCPS LOPA methodology.
 */
import React from 'react';
import type { LOPAScenario } from '../../../types/safety';

interface SwissCheeseProps {
    scenario: LOPAScenario;
}

const SLICE_COLORS = [
    { fill: '#DBEAFE', stroke: '#3B82F6', text: '#1E40AF', hole: '#93C5FD' }, // blue
    { fill: '#D1FAE5', stroke: '#10B981', text: '#065F46', hole: '#6EE7B7' }, // green
    { fill: '#FEF3C7', stroke: '#F59E0B', text: '#92400E', hole: '#FCD34D' }, // amber
    { fill: '#E0E7FF', stroke: '#6366F1', text: '#3730A3', hole: '#A5B4FC' }, // indigo
    { fill: '#FCE7F3', stroke: '#EC4899', text: '#9D174D', hole: '#F9A8D4' }, // pink
    { fill: '#F0FDFA', stroke: '#14B8A6', text: '#115E59', hole: '#5EEAD4' }, // teal
];

const SwissCheeseModel: React.FC<SwissCheeseProps> = ({ scenario }) => {
    const ipls = scenario.ipls || [];
    const sliceCount = ipls.length;
    const W = Math.max(700, 160 + sliceCount * 110);
    const H = 280;
    const sliceW = 55;
    const sliceH = 140;
    const startX = 140;
    const sliceGap = Math.min(100, (W - 280) / Math.max(sliceCount, 1));
    const centerY = H / 2;

    // Hole size proportional to PFD (bigger hole = worse protection)
    const holeRadius = (pfd: number) => {
        const minR = 5, maxR = 24;
        // PFD typically 0.001 to 0.1
        const normalized = Math.min(1, Math.max(0, (Math.log10(pfd) + 3) / 2));
        return minR + normalized * (maxR - minR);
    };

    // Random-ish hole Y offset per slice (deterministic from index)
    const holeOffsetY = (idx: number) => {
        const offsets = [-18, 12, -5, 22, -14, 8, -20, 15];
        return offsets[idx % offsets.length];
    };

    return (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
                <div>
                    <h3 className="text-sm font-bold text-slate-700">Swiss Cheese Model</h3>
                    <p className="text-[10px] text-slate-400">
                        Reason's Model — Layers of Protection for: {scenario.description || 'Scenario'}
                    </p>
                </div>
                <div className="flex items-center gap-2 text-[9px] text-slate-400">
                    <span>Hole size ∝ PFD</span>
                    <span className="text-slate-300">|</span>
                    <span>Larger hole = weaker protection</span>
                </div>
            </div>

            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minHeight: 220 }}>
                <defs>
                    <style>{`
                        @keyframes dangerPulse { 0%,100% { opacity: 0.3; } 50% { opacity: 0.8; } }
                        @keyframes arrowFlow { from { stroke-dashoffset: 20; } to { stroke-dashoffset: 0; } }
                        .danger-pulse { animation: dangerPulse 2s ease-in-out infinite; }
                        .arrow-flow { animation: arrowFlow 1.5s linear infinite; }
                    `}</style>
                    <filter id="sliceShadow">
                        <feDropShadow dx={1} dy={2} stdDeviation={2} floodOpacity={0.08} />
                    </filter>
                </defs>

                {/* ─── Initiating Event ─── */}
                <g>
                    <rect x={10} y={centerY - 30} width={110} height={60} rx={10}
                        fill="#FEF2F2" stroke="#EF4444" strokeWidth={2} />
                    <text x={65} y={centerY - 10} textAnchor="middle" fontSize={8}
                        fontWeight={700} fill="#991B1B" style={{ textTransform: 'uppercase' } as React.CSSProperties}>
                        INITIATING
                    </text>
                    <text x={65} y={centerY + 2} textAnchor="middle" fontSize={8}
                        fontWeight={700} fill="#991B1B">EVENT</text>
                    {scenario.ie_frequency != null && (
                        <text x={65} y={centerY + 16} textAnchor="middle" fontSize={7}
                            fill="#B91C1C" fontFamily="monospace">
                            {scenario.ie_frequency.toExponential(1)}/yr
                        </text>
                    )}
                </g>

                {/* ─── Hazard arrow ─── */}
                <line x1={125} y1={centerY} x2={startX - 5} y2={centerY}
                    stroke="#EF4444" strokeWidth={2} strokeDasharray="6 3"
                    className="arrow-flow" />

                {/* ─── IPL Cheese Slices ─── */}
                {ipls.map((ipl, i) => {
                    const x = startX + i * sliceGap;
                    const color = SLICE_COLORS[i % SLICE_COLORS.length];
                    const hr = holeRadius(ipl.pfd);
                    const hy = centerY + holeOffsetY(i);

                    return (
                        <g key={i} filter="url(#sliceShadow)">
                            {/* Slice body (rounded rectangle = "cheese") */}
                            <rect x={x} y={centerY - sliceH / 2} width={sliceW} height={sliceH} rx={12}
                                fill={color.fill} stroke={color.stroke} strokeWidth={1.5} />
                            {/* Hole (circle cut-out) */}
                            <circle cx={x + sliceW / 2} cy={hy} r={hr}
                                fill="white" stroke={color.hole} strokeWidth={1} opacity={0.9} />
                            <circle cx={x + sliceW / 2} cy={hy} r={hr - 2}
                                fill="none" stroke={color.hole} strokeWidth={0.5}
                                strokeDasharray="2 2" opacity={0.4} />
                            {/* Label above */}
                            <text x={x + sliceW / 2} y={centerY - sliceH / 2 - 8} textAnchor="middle"
                                fontSize={7} fontWeight={700} fill={color.text}>
                                {(ipl.name || ipl.type.toUpperCase()).slice(0, 10)}
                            </text>
                            {/* PFD below */}
                            <text x={x + sliceW / 2} y={centerY + sliceH / 2 + 14} textAnchor="middle"
                                fontSize={7} fill={color.text} fontFamily="monospace" opacity={0.7}>
                                PFD: {ipl.pfd}
                            </text>
                            {/* Credit below PFD */}
                            <text x={x + sliceW / 2} y={centerY + sliceH / 2 + 25} textAnchor="middle"
                                fontSize={6} fill={color.text} opacity={0.5}>
                                ×{Math.round(1 / ipl.pfd)} credit
                            </text>

                            {/* Connection line to next slice */}
                            {i < ipls.length - 1 && (
                                <line x1={x + sliceW + 2} y1={centerY} x2={startX + (i + 1) * sliceGap - 2} y2={centerY}
                                    stroke="#CBD5E1" strokeWidth={1.5} strokeDasharray="4 3" className="arrow-flow" />
                            )}
                        </g>
                    );
                })}

                {/* ─── Consequence ─── */}
                <g>
                    {/* Arrow to consequence */}
                    <line x1={startX + (sliceCount > 0 ? (sliceCount - 1) * sliceGap + sliceW + 5 : 0)} y1={centerY}
                        x2={W - 120} y2={centerY}
                        stroke="#A855F7" strokeWidth={2} strokeDasharray="6 3" className="arrow-flow" />
                    <rect x={W - 115} y={centerY - 30} width={105} height={60} rx={10}
                        fill="#FAF5FF" stroke="#A855F7" strokeWidth={2} />
                    <text x={W - 62} y={centerY - 5} textAnchor="middle" fontSize={8}
                        fontWeight={700} fill="#6B21A8" style={{ textTransform: 'uppercase' } as React.CSSProperties}>
                        CONSEQUENCE
                    </text>
                    {scenario.mitigated_frequency != null && (
                        <text x={W - 62} y={centerY + 10} textAnchor="middle" fontSize={7}
                            fill="#7C3AED" fontFamily="monospace">
                            {scenario.mitigated_frequency.toExponential(2)}/yr
                        </text>
                    )}
                </g>

                {/* ─── "Hazard trajectory" line through all holes ─── */}
                {ipls.length > 0 && (
                    <line x1={startX - 5} y1={centerY} x2={W - 120} y2={centerY}
                        stroke="#EF4444" strokeWidth={1} strokeDasharray="3 5"
                        opacity={0.15} className="danger-pulse" />
                )}

                {/* ─── Empty state ─── */}
                {ipls.length === 0 && (
                    <text x={W / 2} y={centerY + 50} textAnchor="middle" fontSize={11} fill="#94A3B8">
                        Add IPLs to the scenario to visualize the Swiss Cheese model
                    </text>
                )}
            </svg>
        </div>
    );
};

export default SwissCheeseModel;
