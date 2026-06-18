/**
 * LifecycleAnalysis — Data-Driven Hazard Rate h(t) Visualization
 *
 * Plots the ACTUAL Weibull hazard rate function:
 *   h(t) = (β/η) × (t/η)^(β−1)
 *
 * NOTE: This is the single-Weibull hazard rate (monotonic — falling, flat,
 * or rising with β), NOT a literal bathtub curve (a superposition of all
 * three phases). The three-zone bathtub context is overlaid as a classifier
 * so you can see which lifecycle phase the fitted β falls in.
 *
 * The curve shape is entirely data-driven from the fitted Weibull
 * parameters (β, η) — not a generic textbook illustration.
 *
 * Zone classification, root cause analysis, and PM interval
 * recommendations are derived from the calculated β value.
 *
 * Standards: ISO 14224 · OREDA 6th Ed · MIL-HDBK-338B
 */
import React, { useMemo, useState } from 'react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { AlertTriangle, Shield, TrendingUp, Wrench, Info, ChevronDown, ChevronUp, Zap, Clock } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────
interface LifecycleAnalysisProps {
    beta: number;
    eta: number;
    r2?: number;
    assetTag?: string;
    /** Optional callback to open the PM creation modal from the Weibull tab */
    onCreatePM?: () => void;
}

// ─── Zone Classification ──────────────────────────────────────
interface ZoneInfo {
    zone: 1 | 2 | 3;
    label: string;
    shortLabel: string;
    color: string;
    bgColor: string;
    borderColor: string;
    textColor: string;
    iconColor: string;
    icon: React.ReactNode;
    betaRange: string;
    failurePattern: string;
    curveShape: string;
    rootCauses: string[];
    strategy: string[];
    pmEffectiveness: string;
    pmColor: string;
}

function classifyZone(beta: number): ZoneInfo {
    if (beta < 1) {
        return {
            zone: 1, label: 'Infant Mortality', shortLabel: 'Infant',
            color: '#f59e0b', bgColor: 'bg-amber-50', borderColor: 'border-amber-200',
            textColor: 'text-amber-700', iconColor: 'text-amber-500',
            icon: <AlertTriangle size={16} />,
            betaRange: 'β < 1.0',
            failurePattern: 'Decreasing failure rate — failures decline with operating age',
            curveShape: 'Your hazard rate is falling — this asset fails less as it ages. Early-life issues dominate.',
            rootCauses: [
                'Manufacturing defects or poor quality control',
                'Installation errors or commissioning issues',
                'Incorrect assembly or alignment',
                'Material defects (casting voids, inclusions)',
                'Burn-in / break-in period failures',
            ],
            strategy: [
                'Implement rigorous QA/QC inspection protocols',
                'Extend commissioning verification periods',
                'Apply burn-in testing before field deployment',
                'Review vendor qualification and acceptance criteria',
            ],
            pmEffectiveness: 'Time-based PM is NOT effective — will cause unnecessary replacements',
            pmColor: 'text-red-600',
        };
    }
    if (beta <= 1.5) {
        return {
            zone: 2, label: 'Useful Life (Random)', shortLabel: 'Random',
            color: '#3b82f6', bgColor: 'bg-blue-50', borderColor: 'border-blue-200',
            textColor: 'text-blue-700', iconColor: 'text-blue-500',
            icon: <Shield size={16} />,
            betaRange: '1.0 ≤ β ≤ 1.5',
            failurePattern: 'Approximately constant failure rate — random, age-independent failures',
            curveShape: 'Your hazard rate is nearly flat — failures are random and not related to age.',
            rootCauses: [
                'External stress events (overload, surge, impact)',
                'Human error during operations',
                'Foreign object damage (FOD)',
                'Random environmental factors',
                'Maintenance-induced failures',
            ],
            strategy: [
                'Condition-based maintenance (CBM) is optimal',
                'Implement real-time monitoring (vibration, temperature)',
                'Focus on operational procedure improvements',
                'Ensure adequate spares holding (Poisson model)',
            ],
            pmEffectiveness: 'Time-based PM has LIMITED value — use condition monitoring instead',
            pmColor: 'text-amber-600',
        };
    }
    return {
        zone: 3, label: 'Wear-Out', shortLabel: 'Wear-Out',
        color: '#ef4444', bgColor: 'bg-red-50', borderColor: 'border-red-200',
        textColor: 'text-red-700', iconColor: 'text-red-500',
        icon: <TrendingUp size={16} />,
        betaRange: 'β > 1.5',
        failurePattern: 'Increasing failure rate — failures accelerate with operating age',
        curveShape: 'Your hazard rate is rising — this asset degrades with age. PM replacement is effective.',
        rootCauses: [
            'Fatigue cracking and material degradation',
            'Corrosion / erosion mechanisms',
            'Bearing wear and surface degradation',
            'Seal deterioration and leakage progression',
            beta > 3 ? 'Severe end-of-life degradation' : 'Progressive mechanical wear',
        ],
        strategy: [
            `Schedule PM replacement at ~${beta > 3 ? '70' : '80'}% of characteristic life (η)`,
            'Use B10 life for safety-critical replacement intervals',
            beta > 3 ? 'Evaluate CAPEX replacement if repair costs > 60% of new unit' : 'Optimize PM interval using cost-risk trade-off',
            'Track degradation trends via inspection and CBM data',
        ],
        pmEffectiveness: beta > 3
            ? 'Time-based PM is HIGHLY effective — strong age-reliability relationship'
            : 'Time-based PM is EFFECTIVE — age-related degradation detected',
        pmColor: 'text-green-600',
    };
}

// ─── Weibull Hazard Rate Function ─────────────────────────────
// h(t) = (β/η) × (t/η)^(β−1)
function weibullHazard(t: number, beta: number, eta: number): number {
    if (t <= 0) return beta < 1 ? Infinity : 0;
    return (beta / eta) * Math.pow(t / eta, beta - 1);
}

// ─── B-Life calculation ───────────────────────────────────────
function weibullBLife(beta: number, eta: number, pct: number): number {
    return eta * Math.pow(-Math.log(1 - pct / 100), 1 / beta);
}

// ─── Generate Data-Driven Hazard Curve ────────────────────────
function generateHazardData(beta: number, eta: number, points: number = 150) {
    const data: { t: number; hazard: number; tLabel: string }[] = [];

    // Plot from near-zero to 1.5× eta to capture the full behavior
    const tMax = Math.max(eta * 1.5, 100);
    const tStart = Math.max(tMax * 0.005, 0.5); // avoid t=0 singularity for β<1

    for (let i = 0; i <= points; i++) {
        const t = tStart + (i / points) * (tMax - tStart);
        let h = weibullHazard(t, beta, eta);

        // Clamp extremely high values for visual sanity (β < 1 near t=0)
        const maxH = beta < 1 ? weibullHazard(tStart, beta, eta) * 1.2 : Infinity;
        h = Math.min(h, maxH);

        data.push({
            t: Math.round(t),
            hazard: Math.round(h * 1e6) / 1e6, // 6 decimal precision
            tLabel: `${Math.round(t)} hrs`,
        });
    }
    return data;
}

// ─── Custom Tooltip ───────────────────────────────────────────
const HazardTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
        <div className="bg-white/95 backdrop-blur-sm border border-slate-200 p-3 rounded-xl shadow-xl">
            <div className="flex items-center gap-2 mb-1.5">
                <Clock size={12} className="text-slate-400" />
                <span className="text-xs font-bold text-slate-700">{d.t.toLocaleString()} hrs</span>
            </div>
            <p className="text-[11px] text-slate-500">
                h(t) = <span className="font-bold text-slate-800">{d.hazard < 0.001 ? d.hazard.toExponential(3) : d.hazard.toFixed(4)}</span>
                <span className="text-slate-400 ml-1">failures/hr</span>
            </p>
        </div>
    );
};

// ═══════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════
const LifecycleAnalysis: React.FC<LifecycleAnalysisProps> = ({ beta, eta, r2, assetTag, onCreatePM }) => {
    const [showDetails, setShowDetails] = useState(false);
    const zone = useMemo(() => classifyZone(beta), [beta]);
    const data = useMemo(() => generateHazardData(beta, eta), [beta, eta]);

    // Key reference points from the data
    const b10 = useMemo(() => Math.round(weibullBLife(beta, eta, 10)), [beta, eta]);

    // Optimal PM interval recommendation
    const pmInterval = useMemo(() => {
        if (beta <= 1) return null;
        const factor = beta > 3 ? 0.7 : beta > 2 ? 0.75 : 0.8;
        return Math.round(eta * factor);
    }, [beta, eta]);

    // Format the hazard rate value for display
    const formatH = (val: number) => {
        if (val < 0.0001) return val.toExponential(2);
        if (val < 0.01) return val.toFixed(4);
        if (val < 1) return val.toFixed(3);
        return val.toFixed(1);
    };

    // Current h(t) at key points
    const hAtEta = weibullHazard(eta, beta, eta);
    const hAtB10 = weibullHazard(b10, beta, eta);

    return (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
            {/* ── Header ────────────────────────────────── */}
            <div className="px-6 pt-5 pb-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                        <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                            <Zap size={16} className="text-blue-500" />
                            Lifecycle Analysis — Hazard Rate h(t)
                        </h4>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                            h(t) = (β/η) × (t/η)<sup>β−1</sup> · Calculated from your failure data · ISO 14224
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {assetTag && (
                            <span className="text-[10px] font-mono font-bold px-2 py-1 bg-slate-100 text-slate-500 rounded-md border border-slate-200">
                                {assetTag}
                            </span>
                        )}
                        <span className="text-[10px] font-mono font-bold px-2 py-1 rounded-md border"
                            style={{ backgroundColor: `${zone.color}10`, borderColor: `${zone.color}40`, color: zone.color }}>
                            β = {beta} · η = {eta} hrs
                        </span>
                    </div>
                </div>
            </div>

            {/* ── Zone Legend Bar ──────────────────────── */}
            <div className="mx-6 mb-3 flex rounded-xl overflow-hidden border border-slate-200" style={{ height: 36 }}>
                {[
                    { pct: '20%', label: 'Infant Mortality', sub: 'β < 1', bg: 'linear-gradient(135deg, #fef3c7, #fde68a)', color: '#92400e', active: zone.zone === 1 },
                    { pct: '40%', label: 'Useful Life', sub: '1 ≤ β ≤ 1.5', bg: 'linear-gradient(135deg, #dbeafe, #bfdbfe)', color: '#1e40af', active: zone.zone === 2 },
                    { pct: '40%', label: 'Wear-Out', sub: 'β > 1.5', bg: 'linear-gradient(135deg, #fee2e2, #fecaca)', color: '#991b1b', active: zone.zone === 3 },
                ].map((z, i) => (
                    <div key={i} className="flex items-center justify-center gap-1.5 transition-all duration-500"
                        style={{
                            width: z.pct, background: z.bg,
                            outline: z.active ? `2px solid ${z.color}` : 'none',
                            outlineOffset: -2,
                            opacity: z.active ? 1 : 0.5,
                            fontWeight: z.active ? 700 : 400,
                        }}>
                        <span className="text-[10px] hidden sm:inline" style={{ color: z.color }}>{z.label}</span>
                        <span className="text-[9px] font-mono opacity-70" style={{ color: z.color }}>{z.sub}</span>
                    </div>
                ))}
            </div>

            {/* ── Chart ───────────────────────────────── */}
            <div className="px-4 pb-2">
                <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={data} margin={{ top: 15, right: 25, left: 5, bottom: 5 }}>
                        <defs>
                            <linearGradient id="hazardGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={zone.color} stopOpacity={0.3} />
                                <stop offset="100%" stopColor={zone.color} stopOpacity={0.02} />
                            </linearGradient>
                        </defs>

                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />

                        <XAxis
                            dataKey="t"
                            tick={{ fontSize: 10, fill: '#94a3b8' }}
                            axisLine={{ stroke: '#cbd5e1' }}
                            tickLine={{ stroke: '#e2e8f0' }}
                            label={{ value: 'Operating Time (hours)', position: 'insideBottom', offset: -2, fontSize: 11, fill: '#94a3b8' }}
                            tickFormatter={(v: number) => v.toLocaleString()}
                        />
                        <YAxis
                            tick={{ fontSize: 10, fill: '#94a3b8' }}
                            axisLine={false}
                            tickLine={false}
                            label={{ value: 'h(t) Failure Rate', angle: -90, position: 'insideLeft', offset: 15, fontSize: 11, fill: '#94a3b8' }}
                            tickFormatter={(v: number) => v < 0.01 ? v.toExponential(1) : v.toFixed(3)}
                        />

                        <Tooltip content={<HazardTooltip />} />

                        {/* The actual hazard rate curve */}
                        <Area
                            type="monotone"
                            dataKey="hazard"
                            stroke={zone.color}
                            strokeWidth={2.5}
                            fill="url(#hazardGradient)"
                            isAnimationActive={true}
                            animationDuration={1200}
                            animationEasing="ease-out"
                            dot={false}
                        />

                        {/* η reference line (characteristic life) */}
                        <ReferenceLine
                            x={Math.round(eta)}
                            stroke="#8b5cf6"
                            strokeWidth={2}
                            strokeDasharray="6 4"
                            label={{
                                position: 'top',
                                value: `η = ${Math.round(eta)} hrs`,
                                fill: '#7c3aed',
                                fontSize: 11,
                                fontWeight: 700,
                            }}
                        />

                        {/* B10 Life reference line */}
                        <ReferenceLine
                            x={b10}
                            stroke="#059669"
                            strokeWidth={1.5}
                            strokeDasharray="4 3"
                            label={{
                                position: 'top',
                                value: `B10 = ${b10} hrs`,
                                fill: '#059669',
                                fontSize: 10,
                                fontWeight: 600,
                            }}
                        />

                        {/* PM Interval line (if applicable) */}
                        {pmInterval && (
                            <ReferenceLine
                                x={pmInterval}
                                stroke="#0ea5e9"
                                strokeWidth={1.5}
                                strokeDasharray="3 3"
                                label={{
                                    position: 'insideTopRight',
                                    value: `PM @ ${pmInterval} hrs`,
                                    fill: '#0284c7',
                                    fontSize: 10,
                                    fontWeight: 600,
                                }}
                            />
                        )}
                    </AreaChart>
                </ResponsiveContainer>

                {/* Key Stats Row */}
                <div className="flex flex-wrap items-center justify-center gap-4 text-[10px] text-slate-500 mt-1 mb-2 px-2">
                    <span className="flex items-center gap-1.5">
                        <span className="w-3 h-0.5 bg-blue-500 rounded-full inline-block" style={{ borderTop: '2px dashed #8b5cf6' }} />
                        <span>η = {Math.round(eta)} hrs</span>
                        <span className="text-slate-400">(h = {formatH(hAtEta)}/hr)</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="w-3 h-0.5 bg-emerald-500 rounded-full inline-block" style={{ borderTop: '2px dashed #059669' }} />
                        <span>B10 = {b10} hrs</span>
                        <span className="text-slate-400">(h = {formatH(hAtB10)}/hr)</span>
                    </span>
                    {pmInterval && (
                        <span className="flex items-center gap-1.5">
                            <span className="w-3 h-0.5 bg-sky-500 rounded-full inline-block" style={{ borderTop: '2px dashed #0ea5e9' }} />
                            <span>PM @ {pmInterval} hrs</span>
                            <span className="text-slate-400">({Math.round(pmInterval / eta * 100)}% of η)</span>
                        </span>
                    )}
                </div>
            </div>

            {/* ── Active Zone Indicator Card ──────────── */}
            <div className={`mx-6 mb-4 p-4 rounded-xl border-2 ${zone.borderColor} ${zone.bgColor} transition-all duration-300`}>
                <div className="flex items-start gap-3">
                    <div className={`mt-0.5 ${zone.iconColor}`}>{zone.icon}</div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h5 className={`text-sm font-bold ${zone.textColor}`}>
                                Zone {zone.zone}: {zone.label}
                            </h5>
                            <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md border ${zone.borderColor} ${zone.textColor} bg-white/60`}>
                                {zone.betaRange}
                            </span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/80 ${zone.textColor} border ${zone.borderColor}`}>
                                β = {beta}
                            </span>
                        </div>
                        <p className={`text-xs mt-1.5 ${zone.textColor} opacity-80`}>{zone.curveShape}</p>

                        {/* PM Effectiveness indicator */}
                        <div className="mt-2.5 flex items-center gap-1.5">
                            <Wrench size={12} className="text-slate-400" />
                            <span className={`text-[11px] font-semibold ${zone.pmColor}`}>{zone.pmEffectiveness}</span>
                        </div>

                        {pmInterval && (
                            <div className="mt-1.5 flex items-center gap-1.5">
                                <TrendingUp size={12} className="text-slate-400" />
                                <span className="text-[11px] text-slate-600">
                                    Recommended PM interval: <strong className="text-slate-800">{pmInterval.toLocaleString()} hrs</strong>
                                    <span className="text-slate-400 ml-1">({Math.round(pmInterval / eta * 100)}% of η)</span>
                                </span>
                            </div>
                        )}

                        {/* Create PM button (when callback provided and PM is effective) */}
                        {onCreatePM && beta > 1 && (
                            <button
                                onClick={onCreatePM}
                                className="mt-3 flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary-500 to-primary-500 text-white text-xs font-bold rounded-lg shadow-md hover:shadow-lg hover:scale-[1.02] transition-all"
                            >
                                <Wrench size={13} />
                                Create PM Program from Analysis
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* ── Expandable Details ──────────────────── */}
            <div className="border-t border-slate-100">
                <button
                    onClick={() => setShowDetails(!showDetails)}
                    className="w-full flex items-center justify-between px-6 py-3 hover:bg-slate-50/50 transition-colors"
                >
                    <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                        <Info size={13} className="text-slate-400" />
                        Engineering Guidance & Root Cause Analysis
                    </span>
                    {showDetails
                        ? <ChevronUp size={14} className="text-slate-400" />
                        : <ChevronDown size={14} className="text-slate-400" />
                    }
                </button>

                {showDetails && (
                    <div className="px-6 pb-5 grid grid-cols-1 sm:grid-cols-2 gap-4 animate-in slide-in-from-top-2 duration-200">
                        {/* Root Causes */}
                        <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                            <h6 className="text-xs font-bold text-slate-700 mb-2.5 flex items-center gap-1.5">
                                <AlertTriangle size={12} className="text-amber-500" />
                                Probable Root Causes
                            </h6>
                            <ul className="space-y-1.5">
                                {zone.rootCauses.map((cause, i) => (
                                    <li key={i} className="text-[11px] text-slate-600 flex items-start gap-2">
                                        <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0`} style={{ backgroundColor: zone.color }} />
                                        {cause}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Strategy */}
                        <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                            <h6 className="text-xs font-bold text-slate-700 mb-2.5 flex items-center gap-1.5">
                                <Shield size={12} className="text-primary-500" />
                                Recommended Strategy
                            </h6>
                            <ul className="space-y-1.5">
                                {zone.strategy.map((s, i) => (
                                    <li key={i} className="text-[11px] text-slate-600 flex items-start gap-2">
                                        <span className="mt-1 w-1.5 h-1.5 rounded-full bg-primary-400 shrink-0" />
                                        {s}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Quick Reference */}
                        <div className="sm:col-span-2 bg-gradient-to-r from-blue-50 via-blue-50 to-blue-50 rounded-xl p-4 border border-blue-100">
                            <h6 className="text-xs font-bold text-blue-700 mb-2">Quick Reference — Weibull Shape Parameter (β)</h6>
                            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                                {[
                                    { b: '0.5', desc: 'Infant Mortality', col: '#f59e0b' },
                                    { b: '1.0', desc: 'Random (Exponential)', col: '#3b82f6' },
                                    { b: '1.5', desc: 'Early Wear', col: '#8b5cf6' },
                                    { b: '2.0', desc: 'Rayleigh (Bearings)', col: '#ec4899' },
                                    { b: '3.5', desc: 'Normal-like Fatigue', col: '#ef4444' },
                                    { b: '5.0+', desc: 'Severe Wear-Out', col: '#dc2626' },
                                ].map((ref, i) => (
                                    <div key={i} className={`text-center p-2 rounded-lg bg-white/70 border transition-all ${
                                        Math.abs(beta - parseFloat(ref.b)) < 0.5 ? 'border-blue-300 ring-2 ring-blue-200 scale-105' : 'border-slate-200'
                                    }`}>
                                        <p className="text-sm font-bold" style={{ color: ref.col }}>β = {ref.b}</p>
                                        <p className="text-[9px] text-slate-500 mt-0.5 leading-tight">{ref.desc}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default LifecycleAnalysis;
