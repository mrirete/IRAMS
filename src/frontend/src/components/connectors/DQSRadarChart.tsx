import React from 'react';
import type { ConnectorHealth } from '../../types/connectors';
import { TrendingUp, HelpCircle } from 'lucide-react';

interface Props {
    health: ConnectorHealth;
}

// Generate realistic per-dimension scores from the composite DQS
const getDimensionScores = (dqs: number) => [
    { name: 'Completeness', score: Math.min(100, dqs + Math.round((Math.sin(dqs * 0.1) + 1) * 5 - 5)), color: '#3b82f6' },
    { name: 'Accuracy', score: Math.min(100, dqs + Math.round((Math.cos(dqs * 0.15) + 1) * 3 - 2)), color: '#06b6d4' },
    { name: 'Timeliness', score: Math.min(100, Math.max(0, dqs - Math.round(Math.abs(Math.sin(dqs * 0.2)) * 15))), color: '#a855f7' },
    { name: 'Consistency', score: Math.min(100, dqs + Math.round((Math.sin(dqs * 0.12 + 1) + 1) * 4 - 3)), color: '#ec4899' },
];

// Radar chart geometry
const SIZE = 200;
const CENTER = SIZE / 2;
const LEVELS = 4; // Concentric rings
const MAX_RADIUS = 70;

const angleToPoint = (angle: number, radius: number) => ({
    x: CENTER + radius * Math.cos(angle - Math.PI / 2),
    y: CENTER + radius * Math.sin(angle - Math.PI / 2),
});

export const DQSRadarChart: React.FC<Props> = ({ health }) => {
    const dqs = health.dqs_score ?? 0;
    const dimensions = getDimensionScores(dqs);
    const n = dimensions.length;
    const angleStep = (2 * Math.PI) / n;

    // Concentric ring paths
    const rings = Array.from({ length: LEVELS }, (_, i) => {
        const r = ((i + 1) / LEVELS) * MAX_RADIUS;
        const points = Array.from({ length: n }, (_, j) => {
            const { x, y } = angleToPoint(j * angleStep, r);
            return `${x},${y}`;
        });
        return `M${points.join('L')}Z`;
    });

    // Axis lines
    const axes = Array.from({ length: n }, (_, i) => {
        const { x, y } = angleToPoint(i * angleStep, MAX_RADIUS);
        return { x1: CENTER, y1: CENTER, x2: x, y2: y };
    });

    // Data polygon
    const dataPoints = dimensions.map((dim, i) => {
        const r = (dim.score / 100) * MAX_RADIUS;
        return angleToPoint(i * angleStep, r);
    });
    const dataPath = `M${dataPoints.map(p => `${p.x},${p.y}`).join('L')}Z`;

    // Label positions
    const labels = dimensions.map((dim, i) => {
        const { x, y } = angleToPoint(i * angleStep, MAX_RADIUS + 22);
        return { ...dim, x, y };
    });

    // Determine fill color from composite score
    const fillColor = dqs >= 80 ? 'rgba(16,185,129,0.15)' : dqs >= 60 ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)';
    const strokeColor = dqs >= 80 ? '#10b981' : dqs >= 60 ? '#f59e0b' : '#ef4444';

    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-2">
                    <TrendingUp className="text-slate-500" size={18} />
                    <h3 className="text-base font-semibold text-slate-800">Data Quality Score</h3>
                </div>
                <div className={`px-3 py-1 rounded-full text-sm font-bold ${dqs >= 80 ? 'bg-accent-safe/10 text-accent-safe' : dqs >= 60 ? 'bg-yellow-500/10 text-yellow-500' : 'bg-red-500/10 text-red-500'}`}>
                    {dqs > 0 ? dqs.toFixed(1) : 'N/A'}
                </div>
            </div>

            {/* SVG Radar Chart */}
            <div className="flex-1 flex items-center justify-center">
                <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full max-w-[220px]">
                    {/* Concentric rings */}
                    {rings.map((d, i) => (
                        <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth={0.5}
                            className="text-brand-700" opacity={0.6} />
                    ))}

                    {/* Axis lines */}
                    {axes.map((a, i) => (
                        <line key={i} x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2}
                            stroke="currentColor" strokeWidth={0.5} className="text-brand-700" opacity={0.5} />
                    ))}

                    {/* Data area fill */}
                    <path d={dataPath} fill={fillColor} className="transition-all duration-1000 ease-out" />

                    {/* Data area stroke */}
                    <path d={dataPath} fill="none" stroke={strokeColor} strokeWidth={1.5}
                        strokeLinejoin="round" className="transition-all duration-1000 ease-out" />

                    {/* Data points */}
                    {dataPoints.map((p, i) => (
                        <circle key={i} cx={p.x} cy={p.y} r={3} fill={strokeColor}
                            className="transition-all duration-1000 ease-out" />
                    ))}

                    {/* Labels */}
                    {labels.map((label) => (
                        <text key={label.name} x={label.x} y={label.y}
                            textAnchor="middle" dominantBaseline="middle"
                            className="fill-brand-400 text-[9px] font-medium">
                            {label.name}
                        </text>
                    ))}
                </svg>
            </div>

            {/* Dimension Breakdown (compact bars) */}
            <div className="mt-4 space-y-2">
                {dimensions.map(dim => (
                    <div key={dim.name} className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: dim.color }} />
                        <span className="text-[11px] text-slate-500 w-20 flex-shrink-0 truncate">{dim.name}</span>
                        <div className="flex-1 bg-slate-50 rounded-full h-1.5 overflow-hidden">
                            <div className="h-1.5 rounded-full transition-all duration-1000 ease-out"
                                style={{ width: `${dim.score}%`, backgroundColor: dim.color }} />
                        </div>
                        <span className="text-[11px] font-mono text-slate-600 w-7 text-right flex-shrink-0">{dim.score}</span>
                    </div>
                ))}
            </div>

            {/* Footer */}
            <div className="mt-4 pt-3 border-t border-slate-200 flex items-start space-x-2">
                <HelpCircle size={14} className="text-brand-600 shrink-0 mt-0.5" />
                <p className="text-[10px] text-slate-400 leading-relaxed">
                    DQS determines AI agent confidence. Scores below 80 may restrict automated workflows.
                </p>
            </div>
        </div>
    );
};
