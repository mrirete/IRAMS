import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    Cell,
    ReferenceLine,
} from 'recharts';
import { HeartPulse, AlertTriangle, TrendingDown, TrendingUp, Minus } from 'lucide-react';

// ─────────────────────────────────────────────────────────
//  Mock Data — Top assets sorted by lowest health
// ─────────────────────────────────────────────────────────

interface FleetAsset {
    asset_id: string;
    name: string;
    health: number;
    rul_days: number;
    criticality: 'A' | 'B' | 'C';
    trend: 'improving' | 'stable' | 'degrading';
}

const FLEET_DATA: FleetAsset[] = [
    { asset_id: 'ast-tk005', name: 'Slop Oil Tank TK-005', health: 56.0, rul_days: 45, criticality: 'C', trend: 'degrading' },
    { asset_id: 'ast-p102', name: 'Booster Pump P-102', health: 64.2, rul_days: 89, criticality: 'B', trend: 'degrading' },
    { asset_id: 'ast-hx201', name: 'Heat Exchanger HX-201', health: 71.5, rul_days: 132, criticality: 'B', trend: 'degrading' },
    { asset_id: 'ast-p101', name: 'Centrifugal Pump P-101A', health: 74.8, rul_days: 156, criticality: 'A', trend: 'degrading' },
    { asset_id: 'ast-k601', name: 'Gas Compressor K-601', health: 82.5, rul_days: 245, criticality: 'A', trend: 'stable' },
];

function getBarColor(health: number): string {
    if (health >= 85) return '#22c55e';
    if (health >= 70) return '#eab308';
    if (health >= 55) return '#f97316';
    return '#ef4444';
}

// ─────────────────────────────────────────────────────────
//  Component
// ─────────────────────────────────────────────────────────

export const FleetHealthBar: React.FC = () => {
    const navigate = useNavigate();
    const criticalCount = FLEET_DATA.filter(a => a.health < 70).length;

    const CustomTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            const d = payload[0].payload as FleetAsset;
            return (
                <div className="bg-slate-50 border border-slate-200 p-3 rounded-lg shadow-xl min-w-[180px]">
                    <p className="text-slate-700 text-sm font-medium mb-2 border-b border-slate-200 pb-1">{d.name}</p>
                    <div className="space-y-1 text-xs">
                        <div className="flex justify-between"><span className="text-slate-500">Health:</span><span className="font-bold" style={{ color: getBarColor(d.health) }}>{d.health.toFixed(1)}%</span></div>
                        <div className="flex justify-between"><span className="text-slate-500">RUL:</span><span className={`font-bold ${d.rul_days < 90 ? 'text-red-400' : 'text-slate-700'}`}>{d.rul_days} days</span></div>
                        <div className="flex justify-between"><span className="text-slate-500">Criticality:</span><span className="font-bold text-slate-700">{d.criticality}</span></div>
                        <div className="flex justify-between">
                            <span className="text-slate-500">Trend:</span>
                            <span className={`font-bold capitalize ${d.trend === 'degrading' ? 'text-red-400' : d.trend === 'improving' ? 'text-accent-safe' : 'text-slate-600'}`}>
                                {d.trend}
                            </span>
                        </div>
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-yellow-500/10 rounded-lg text-yellow-500">
                        <HeartPulse size={20} />
                    </div>
                    <div>
                        <h3 className="text-base font-semibold text-slate-800">Fleet Health — Bottom 5</h3>
                        <p className="text-xs text-slate-400">Assets with lowest health index</p>
                    </div>
                </div>
                {criticalCount > 0 && (
                    <div className="flex items-center gap-1 px-2 py-1 bg-red-500/10 border border-red-500/30 rounded-full text-xs text-red-400 font-bold">
                        <AlertTriangle size={12} /> {criticalCount} below 70%
                    </div>
                )}
            </div>

            <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={FLEET_DATA} layout="vertical" margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                        <XAxis type="number" domain={[0, 100]} stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
                        <YAxis
                            type="category" dataKey="name" width={140} stroke="#64748b" fontSize={10} tickLine={false} axisLine={false}
                            tickFormatter={(name: string) => {
                                const parts = name.split(' ');
                                return parts.length > 2 ? parts.slice(-2).join(' ') : name;
                            }}
                        />
                        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(51, 65, 85, 0.2)' }} />
                        <ReferenceLine x={70} stroke="#ef4444" strokeDasharray="3 3" opacity={0.5} />
                        <Bar dataKey="health" radius={[0, 4, 4, 0]} maxBarSize={24} isAnimationActive={true}
                            onClick={() => navigate('/predict')}
                            style={{ cursor: 'pointer' }}
                        >
                            {FLEET_DATA.map((entry, i) => (
                                <Cell key={i} fill={getBarColor(entry.health)} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>

            {/* Asset Tags Row */}
            <div className="flex items-center gap-2 mt-3 flex-wrap">
                {FLEET_DATA.map(a => {
                    const TrendIcon = a.trend === 'degrading' ? TrendingDown : a.trend === 'improving' ? TrendingUp : Minus;
                    return (
                        <span key={a.asset_id} className="inline-flex items-center gap-1 text-[10px] bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-full text-slate-500">
                            <span className={`font-bold ${a.criticality === 'A' ? 'text-red-400' : a.criticality === 'B' ? 'text-yellow-500' : 'text-slate-500'}`}>{a.criticality}</span>
                            <span className="text-slate-600">{a.name.split(' ').pop()}</span>
                            <TrendIcon size={8} className={a.trend === 'degrading' ? 'text-red-400' : a.trend === 'improving' ? 'text-accent-safe' : 'text-slate-400'} />
                        </span>
                    );
                })}
            </div>
        </div>
    );
};
