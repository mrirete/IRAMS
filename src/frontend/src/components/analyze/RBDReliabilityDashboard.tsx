/**
 * RBDReliabilityDashboard — System Reliability R(t) panels
 * Shows mission-time R(t), R(t) curve, sensitivity, requirements solver
 */
import React, { useState } from 'react';
import {
    Target, BarChart3, TrendingUp, Shield, AlertTriangle,
    Calculator, Clock, ChevronDown, ChevronUp,
} from 'lucide-react';

// ── Types ──
export interface BlockRValue {
    id: string; name: string; r: number; mtbf: number;
    mttr: number; lambda: number; assetTag?: string;
}
export interface SensItem {
    id: string; name: string; assetTag?: string;
    importance: number; rPerfect: number; rFailed: number; currentR: number;
}
export interface ReqGap {
    id: string; name: string; assetTag?: string;
    currentR: number; requiredR: number; currentMTBF: number;
    requiredMTBF: number; mtbfGap: number; meetsTarget: boolean; importance: number;
}
export interface KofNInfo {
    group: { id: string; type: string; label: string; k?: number };
    blocks: { id: string; name: string }[];
    avgR: number; groupR: number;
    kVariants: { k: number; r: number }[];
}

interface Props {
    blocks: number; // count
    systemR: number;
    systemF: number;
    topoMTBF: number;
    expectedFailures: number;
    missionTime: number;
    onMissionTimeChange: (t: number) => void;
    targetReliability: number;
    onTargetChange: (t: number) => void;
    blockRValues: BlockRValue[];
    sensitivityData: SensItem[];
    requirementGaps: ReqGap[];
    kofnGroups: KofNInfo[];
    reliabilityCurve: { t: number; r: number }[];
}

function aoColor(v: number): string {
    if (v >= 0.95) return '#16a34a';
    if (v >= 0.90) return '#d97706';
    return '#dc2626';
}

const RBDReliabilityDashboard: React.FC<Props> = ({
    blocks, systemR, systemF, topoMTBF, expectedFailures,
    missionTime, onMissionTimeChange, targetReliability, onTargetChange,
    blockRValues, sensitivityData, requirementGaps, kofnGroups, reliabilityCurve,
}) => {
    const [showSens, setShowSens] = useState(false);
    const [showReqs, setShowReqs] = useState(false);

    if (blocks === 0) return null;

    const meetsTarget = systemR >= targetReliability;
    const rColor = aoColor(systemR);

    // R(t) Curve rendering
    const CW = 480, CH = 160, PAD = 40;
    const maxT = reliabilityCurve.length > 0 ? reliabilityCurve[reliabilityCurve.length - 1].t : missionTime * 2;
    const xScale = (t: number) => PAD + ((t / maxT) * (CW - PAD * 2));
    const yScale = (r: number) => PAD + ((1 - r) * (CH - PAD * 2));
    const curvePath = reliabilityCurve.map((p, i) =>
        `${i === 0 ? 'M' : 'L'}${xScale(p.t).toFixed(1)},${yScale(p.r).toFixed(1)}`
    ).join(' ');

    return (
        <div className="space-y-3 mt-3">
            {/* ═══ SYSTEM RELIABILITY DASHBOARD ═══ */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-primary-50/30">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                            <Shield size={14} className="text-primary-500" /> System Reliability R(t)
                        </h3>
                        <div className="flex items-center gap-3 text-[11px]">
                            <label className="flex items-center gap-1.5 text-slate-600 font-medium">
                                <Clock size={12} /> Mission Time
                                <input type="number" value={missionTime} min={100} step={1000}
                                    onChange={e => onMissionTimeChange(+e.target.value || 8760)}
                                    className="w-20 px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 outline-none font-mono" />
                                <span className="text-slate-400">hrs</span>
                            </label>
                            <label className="flex items-center gap-1.5 text-slate-600 font-medium">
                                <Target size={12} /> Target
                                <input type="number" value={(targetReliability * 100).toFixed(1)} min={50} max={100} step={0.5}
                                    onChange={e => onTargetChange(Math.min(1, Math.max(0, (+e.target.value || 95) / 100)))}
                                    className="w-16 px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 outline-none font-mono" />
                                <span className="text-slate-400">%</span>
                            </label>
                        </div>
                    </div>
                </div>

                {/* KPI Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4">
                    <div className="p-3 rounded-xl bg-gradient-to-br from-slate-50 to-slate-100 border border-slate-200">
                        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">System R(t)</div>
                        <div className="text-xl font-black font-mono" style={{ color: rColor }}>
                            {(systemR * 100).toFixed(2)}%
                        </div>
                        <div className="text-[9px] text-slate-400 mt-0.5">at t = {missionTime.toLocaleString()}h</div>
                    </div>
                    <div className="p-3 rounded-xl bg-gradient-to-br from-slate-50 to-slate-100 border border-slate-200">
                        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Failure Prob F(t)</div>
                        <div className="text-xl font-black font-mono text-red-500">
                            {(systemF * 100).toFixed(2)}%
                        </div>
                        <div className="text-[9px] text-slate-400 mt-0.5">1 − R(t)</div>
                    </div>
                    <div className="p-3 rounded-xl bg-gradient-to-br from-slate-50 to-slate-100 border border-slate-200">
                        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">System MTBF</div>
                        <div className="text-xl font-black font-mono text-primary-600">
                            {topoMTBF > 100000 ? `${(topoMTBF / 1000).toFixed(0)}k` : topoMTBF.toFixed(0)}
                        </div>
                        <div className="text-[9px] text-slate-400 mt-0.5">hours (topology-aware)</div>
                    </div>
                    <div className="p-3 rounded-xl bg-gradient-to-br from-slate-50 to-slate-100 border border-slate-200">
                        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Expected Failures</div>
                        <div className="text-xl font-black font-mono text-amber-600">
                            {expectedFailures.toFixed(2)}
                        </div>
                        <div className="text-[9px] text-slate-400 mt-0.5">in mission window</div>
                    </div>
                </div>

                {/* Target status */}
                <div className={`mx-4 mb-3 px-3 py-2 rounded-lg text-[11px] font-medium flex items-center gap-2 ${meetsTarget
                    ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                    : 'bg-red-50 border border-red-200 text-red-700'
                    }`}>
                    {meetsTarget
                        ? <><Shield size={13} /> System MEETS reliability target of {(targetReliability * 100).toFixed(1)}%</>
                        : <><AlertTriangle size={13} /> System BELOW target — {(targetReliability * 100).toFixed(1)}% required, currently {(systemR * 100).toFixed(2)}% (gap: {((targetReliability - systemR) * 100).toFixed(2)}%)</>
                    }
                </div>

                {/* R(t) Curve */}
                {reliabilityCurve.length > 0 && (
                    <div className="px-4 pb-4">
                        <h4 className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                            <TrendingUp size={11} /> R(t) vs Time
                        </h4>
                        <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full" style={{ maxHeight: 200, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                            {/* Grid lines */}
                            {[0.25, 0.5, 0.75, 1.0].map(r => (
                                <g key={r}>
                                    <line x1={PAD} y1={yScale(r)} x2={CW - PAD} y2={yScale(r)} stroke="#e2e8f0" strokeWidth={0.5} />
                                    <text x={PAD - 4} y={yScale(r) + 3} fill="#94a3b8" fontSize={7} textAnchor="end">{(r * 100).toFixed(0)}%</text>
                                </g>
                            ))}
                            {/* X-axis labels */}
                            {[0, 0.25, 0.5, 0.75, 1].map(f => (
                                <text key={f} x={xScale(f * maxT)} y={CH - 8} fill="#94a3b8" fontSize={7} textAnchor="middle">
                                    {(f * maxT / 1000).toFixed(0)}kh
                                </text>
                            ))}
                            {/* Target line */}
                            <line x1={PAD} y1={yScale(targetReliability)} x2={CW - PAD} y2={yScale(targetReliability)}
                                stroke="#ef4444" strokeWidth={1} strokeDasharray="4,3" />
                            <text x={CW - PAD + 3} y={yScale(targetReliability) + 3} fill="#ef4444" fontSize={7}>Target</text>
                            {/* Mission time vertical */}
                            <line x1={xScale(missionTime)} y1={PAD} x2={xScale(missionTime)} y2={CH - PAD}
                                stroke="#06b6d4" strokeWidth={1} strokeDasharray="3,3" />
                            <text x={xScale(missionTime)} y={PAD - 4} fill="#06b6d4" fontSize={7} textAnchor="middle">t={missionTime}h</text>
                            {/* R(t) curve */}
                            <path d={curvePath} fill="none" stroke="#0891b2" strokeWidth={2} />
                            {/* R at mission time dot */}
                            <circle cx={xScale(missionTime)} cy={yScale(systemR)} r={4} fill="#0891b2" stroke="white" strokeWidth={1.5} />
                        </svg>
                    </div>
                )}

                {/* Per-block R table */}
                <div className="px-4 pb-3">
                    <h4 className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">Block Reliability at t={missionTime.toLocaleString()}h</h4>
                    <div className="overflow-x-auto max-h-40">
                        <table className="w-full text-[10px]">
                            <thead><tr className="text-slate-500 border-b border-slate-100">
                                <th className="py-1 text-left font-semibold">Block</th>
                                <th className="py-1 text-center font-semibold">Tag</th>
                                <th className="py-1 text-center font-semibold">MTBF</th>
                                <th className="py-1 text-center font-semibold">λ/yr</th>
                                <th className="py-1 text-center font-semibold">R(t)</th>
                            </tr></thead>
                            <tbody>{blockRValues.map(b => (
                                <tr key={b.id} className="border-b border-slate-50 hover:bg-slate-50">
                                    <td className="py-1 text-slate-700 font-medium">{b.name}</td>
                                    <td className="py-1 text-center text-slate-400 font-mono text-[9px]">{b.assetTag || '—'}</td>
                                    <td className="py-1 text-center text-slate-600 font-mono">{b.mtbf.toLocaleString()}h</td>
                                    <td className="py-1 text-center text-slate-600 font-mono">{b.lambda.toFixed(2)}</td>
                                    <td className="py-1 text-center font-mono font-bold" style={{ color: aoColor(b.r) }}>
                                        {(b.r * 100).toFixed(2)}%
                                    </td>
                                </tr>
                            ))}</tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* ═══ K-of-N VOTING DISPLAY ═══ */}
            {kofnGroups.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                    <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-3">
                        <Calculator size={14} className="text-primary-500" /> Redundancy & Voting Configuration
                    </h3>
                    <div className="space-y-3">
                        {kofnGroups.map(kg => (
                            <div key={kg.group.id} className="p-3 rounded-lg border border-slate-100 bg-slate-50/50">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[11px] font-bold text-slate-700">{kg.group.label}</span>
                                    <span className="text-[10px] px-2 py-0.5 rounded-md font-semibold text-white"
                                        style={{ backgroundColor: kg.group.type === 'parallel' ? '#7c3aed' : kg.group.type === 'standby' ? '#0d9488' : '#c2410c' }}>
                                        {kg.group.type}{kg.group.k ? ` (k=${kg.group.k})` : ''}
                                    </span>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px] mb-2">
                                    <div><span className="text-slate-500">Blocks:</span> <strong>{kg.blocks.length}</strong></div>
                                    <div><span className="text-slate-500">Avg R:</span> <strong className="font-mono">{(kg.avgR * 100).toFixed(2)}%</strong></div>
                                    <div><span className="text-slate-500">Group R:</span> <strong className="font-mono" style={{ color: aoColor(kg.groupR) }}>{(kg.groupR * 100).toFixed(2)}%</strong></div>
                                </div>
                                {/* Binomial equation display */}
                                {kg.group.type === 'k-of-n' && (
                                    <div className="p-2 bg-white rounded-lg border border-slate-200 mb-2">
                                        <div className="text-[9px] text-slate-500 font-mono mb-1">
                                            R = Σ C(n,i) × R<sup>i</sup> × (1-R)<sup>(n-i)</sup> for i = k to n
                                        </div>
                                        <div className="text-[9px] text-slate-600 font-mono">
                                            n={kg.blocks.length}, k={kg.group.k}, R_component={((kg.avgR) * 100).toFixed(1)}%
                                        </div>
                                    </div>
                                )}
                                {/* K variants comparison */}
                                {kg.kVariants.length > 0 && (
                                    <div className="space-y-1">
                                        <div className="text-[9px] font-semibold text-slate-500 uppercase">K-value comparison:</div>
                                        <div className="flex flex-wrap gap-1.5">
                                            {kg.kVariants.map(kv => (
                                                <span key={kv.k} className={`px-2 py-1 rounded text-[10px] font-mono font-semibold border ${kv.k === kg.group.k
                                                    ? 'bg-primary-50 border-primary-300 text-primary-700'
                                                    : 'bg-white border-slate-200 text-slate-600'}`}>
                                                    {kv.k}-of-{kg.blocks.length}: {(kv.r * 100).toFixed(2)}%
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ═══ SENSITIVITY ANALYSIS ═══ */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <button onClick={() => setShowSens(!showSens)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
                    <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                        <BarChart3 size={14} className="text-amber-500" /> Birnbaum Sensitivity Analysis
                    </h3>
                    {showSens ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                </button>
                {showSens && sensitivityData.length > 0 && (
                    <div className="px-4 pb-4 space-y-2">
                        <p className="text-[10px] text-slate-500 mb-2">
                            Birnbaum Importance: ΔR = R_sys(block perfect) − R_sys(block failed). Higher = more critical.
                        </p>
                        {sensitivityData.map((s, i) => {
                            const maxImp = sensitivityData[0]?.importance || 1;
                            const barW = maxImp > 0 ? (s.importance / maxImp) * 100 : 0;
                            return (
                                <div key={s.id} className="flex items-center gap-2">
                                    <span className="w-5 text-[10px] text-slate-400 font-mono text-right">{i + 1}.</span>
                                    <span className="w-28 text-[11px] text-slate-700 font-medium truncate">{s.name}</span>
                                    <div className="flex-1 h-5 bg-slate-100 rounded-full overflow-hidden relative">
                                        <div className="h-full rounded-full transition-all"
                                            style={{ width: `${barW}%`, background: `linear-gradient(90deg, #f59e0b, ${s.importance > 0.5 ? '#ef4444' : '#f59e0b'})` }} />
                                        <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-slate-700">
                                            ΔR = {(s.importance * 100).toFixed(2)}%
                                        </span>
                                    </div>
                                    <span className="text-[9px] text-slate-400 font-mono w-16 text-right">
                                        R={((s.currentR) * 100).toFixed(1)}%
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ═══ MINIMUM REQUIREMENTS SOLVER ═══ */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <button onClick={() => setShowReqs(!showReqs)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
                    <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                        <Target size={14} className="text-emerald-500" /> Minimum Requirements Solver
                    </h3>
                    {showReqs ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                </button>
                {showReqs && requirementGaps.length > 0 && (
                    <div className="px-4 pb-4">
                        <p className="text-[10px] text-slate-500 mb-2">
                            Required per-block improvements to achieve R_sys ≥ {(targetReliability * 100).toFixed(1)}% at t={missionTime.toLocaleString()}h
                        </p>
                        <div className="overflow-x-auto">
                            <table className="w-full text-[10px]">
                                <thead><tr className="text-slate-500 border-b border-slate-100">
                                    <th className="py-1 text-left font-semibold">Block</th>
                                    <th className="py-1 text-center font-semibold">Current R</th>
                                    <th className="py-1 text-center font-semibold">Required R</th>
                                    <th className="py-1 text-center font-semibold">Current MTBF</th>
                                    <th className="py-1 text-center font-semibold">Required MTBF</th>
                                    <th className="py-1 text-center font-semibold">Gap</th>
                                    <th className="py-1 text-center font-semibold">Status</th>
                                </tr></thead>
                                <tbody>{requirementGaps.map(rg => (
                                    <tr key={rg.id} className={`border-b border-slate-50 ${!rg.meetsTarget ? 'bg-red-50/30' : ''}`}>
                                        <td className="py-1.5 text-slate-700 font-medium">{rg.name}</td>
                                        <td className="py-1.5 text-center font-mono" style={{ color: aoColor(rg.currentR) }}>{(rg.currentR * 100).toFixed(2)}%</td>
                                        <td className="py-1.5 text-center font-mono text-slate-600">{(rg.requiredR * 100).toFixed(2)}%</td>
                                        <td className="py-1.5 text-center font-mono text-slate-600">{rg.currentMTBF.toLocaleString()}h</td>
                                        <td className="py-1.5 text-center font-mono text-slate-600">{rg.requiredMTBF.toLocaleString()}h</td>
                                        <td className="py-1.5 text-center font-mono font-semibold" style={{ color: rg.mtbfGap > 0 ? '#dc2626' : '#16a34a' }}>
                                            {rg.mtbfGap > 0 ? `+${rg.mtbfGap.toLocaleString()}h` : '✓'}
                                        </td>
                                        <td className="py-1.5 text-center">
                                            {rg.meetsTarget
                                                ? <span className="text-emerald-500 text-[9px] font-bold">PASS</span>
                                                : <span className="text-red-500 text-[9px] font-bold">IMPROVE</span>
                                            }
                                        </td>
                                    </tr>
                                ))}</tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default RBDReliabilityDashboard;
