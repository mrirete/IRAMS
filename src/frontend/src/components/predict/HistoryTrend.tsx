/**
 * HistoryTrend — a saved series (0392 ers_health_history) drawn to scale.
 * One component for the Now tab's health trend and the Forecast tab's
 * "How this estimate changed". Below two points it says the trend is starting
 * rather than drawing a line through one value.
 */
import React from 'react';
import type { HistoryPoint } from '../../lib/predict/healthTrend';

interface Props {
    points: HistoryPoint[];
    /** Fixed domain (health 0–100); omitted = the series' own range, padded. */
    domain?: [number, number];
    unit?: string;
    color?: string;
    /** Horizontal guide lines, e.g. the health bands. */
    guides?: { value: number; label: string }[];
    height?: number;
}

const W = 600;

export const HistoryTrend: React.FC<Props> = ({ points, domain, unit = '', color = '#0ea5e9', guides = [], height = 120 }) => {
    const pts = points
        .map(p => ({ t: new Date(p.at).getTime(), v: Number(p.value) }))
        .filter(p => Number.isFinite(p.t) && Number.isFinite(p.v))
        .sort((a, b) => a.t - b.t);

    if (pts.length < 2) {
        return (
            <p className="text-[12px] text-slate-400 py-3">
                {pts.length === 1
                    ? `One saved point so far (${fmt(pts[0].v)}${unit}). Every update adds one — at most one an hour.`
                    : 'No saved points yet. Every update adds one — at most one an hour.'}
            </p>
        );
    }

    const H = height, padL = 34, padR = 8, padT = 8, padB = 20;
    const vs = pts.map(p => p.v);
    let [lo, hi] = domain ?? [Math.min(...vs), Math.max(...vs)];
    if (!domain) { const pad = Math.max(1, (hi - lo) * 0.15); lo -= pad; hi += pad; }
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    const x = (t: number) => padL + ((t - t0) / Math.max(1, t1 - t0)) * (W - padL - padR);
    const y = (v: number) => padT + (1 - (v - lo) / Math.max(1e-9, hi - lo)) * (H - padT - padB);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const area = `${line} L${x(t1).toFixed(1)},${(H - padB).toFixed(1)} L${x(t0).toFixed(1)},${(H - padB).toFixed(1)} Z`;
    const last = pts[pts.length - 1];
    const dateLabel = (t: number) => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' });

    return (
        <div className="w-full overflow-hidden">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} role="img"
                aria-label={`${pts.length} saved values from ${dateLabel(t0)} to ${dateLabel(t1)}, latest ${fmt(last.v)}${unit}`}>
                {[lo, hi].map((v, i) => (
                    <text key={i} x={padL - 4} y={y(v) + 3} textAnchor="end" className="fill-slate-400" fontSize="10">{fmt(v)}</text>
                ))}
                {guides.filter(g => g.value > lo && g.value < hi).map(g => (
                    <g key={g.label}>
                        <line x1={padL} x2={W - padR} y1={y(g.value)} y2={y(g.value)} stroke="#cbd5e1" strokeDasharray="3 3" strokeWidth="1" />
                        <text x={W - padR} y={y(g.value) - 2} textAnchor="end" className="fill-slate-400" fontSize="9">{g.label}</text>
                    </g>
                ))}
                <path d={area} fill={color} fillOpacity="0.08" />
                <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                {pts.map((p, i) => <circle key={i} cx={x(p.t)} cy={y(p.v)} r={pts.length > 40 ? 1.5 : 2.5} fill={color} />)}
                <circle cx={x(last.t)} cy={y(last.v)} r="4" fill="white" stroke={color} strokeWidth="2" />
                <text x={padL} y={H - 5} className="fill-slate-400" fontSize="10">{dateLabel(t0)}</text>
                <text x={W - padR} y={H - 5} textAnchor="end" className="fill-slate-400" fontSize="10">{dateLabel(t1)}</text>
            </svg>
        </div>
    );
};

const fmt = (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toString() : (Math.round(v * 10) / 10).toString());

export default HistoryTrend;
