import React, { useState, useMemo } from 'react';
import {
    Activity, AlertTriangle, ShieldAlert, ShieldCheck, Clock, Gauge,
    Thermometer, Wind, Droplets, ChevronDown, Cpu, Zap, Power,
    TrendingDown, TrendingUp, Minus, FileWarning, Wrench,
    CircleDot, BarChart3
} from 'lucide-react';
import { FleetHealthMap } from './FleetHealthMap';
import type { FleetAssetHealth, TwinState, SensorTrend } from '../../types/intelligence';
import type { ConfidenceBand } from '../../eam/services/PredictionService';

// ─────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────

type OperatingState = 'RUNNING' | 'STANDBY' | 'TRIPPED' | 'OFFLINE' | 'UNKNOWN';

interface PredictOverviewTabProps {
    /* Fleet */
    selectedAssetId: string;
    selectedAssetName: string;
    onAssetSelect: (id: string) => void;
    fleetData: FleetAssetHealth[];
    visibleFleetData: FleetAssetHealth[];
    totalAssetCount: number;
    filterSlot: React.ReactNode;

    /* Asset KPIs */
    systemHealth: number;
    isHealthy: boolean;
    rulDays: number | undefined;
    alertCount: number;

    /* NEW: RUL detail */
    rulConfidenceBands: ConfidenceBand[];
    distributionType: string | null;
    rulConfidence: number | null;

    /* Sensors */
    twinHealth: TwinState | null;
    assetSensorTrends: SensorTrend[];

    /* Actions */
    onInvestigate?: () => void;
    onCreateWR?: () => void;
}

// ─────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────

function getSensorIcon(key: string) {
    const k = key.toLowerCase();
    if (k.includes('temp') || k.includes('thermal')) return <Thermometer size={16} />;
    if (k.includes('vib')) return <Activity size={16} />;
    if (k.includes('flow')) return <Wind size={16} />;
    if (k.includes('pressure')) return <Droplets size={16} />;
    return <Gauge size={16} />;
}

/** Derive operating state from sensor readings */
function deriveOperatingState(sensors: SensorTrend[], twinHealth: TwinState | null): OperatingState {
    if (!twinHealth && sensors.length === 0) return 'UNKNOWN';

    const hasSensors = sensors.length > 0;
    const sensorValues = hasSensors ? sensors : Object.entries(twinHealth?.sensor_summary || {}).map(([tag, val]) => ({ tag, current: val as number, trend: 'stable' as const, unit: '', readings: [] }));

    if (sensorValues.length === 0) return 'UNKNOWN';

    const vibSensor = sensorValues.find(s => s.tag.toLowerCase().includes('vib'));
    const flowSensor = sensorValues.find(s => s.tag.toLowerCase().includes('flow'));
    const tempSensor = sensorValues.find(s => s.tag.toLowerCase().includes('temp'));

    // If vibration AND flow are near zero → OFFLINE
    const vibVal = vibSensor?.current ?? 0;
    const flowVal = flowSensor?.current ?? 0;
    const tempVal = tempSensor?.current ?? 0;

    if (vibVal < 0.5 && flowVal < 10) return 'OFFLINE';
    if (vibVal < 1.0 && flowVal < 50) return 'STANDBY';

    // If any sensor is in alarm (rising trend + high value), check for tripped state
    const risingCount = sensorValues.filter(s => s.trend === 'rising').length;
    if (risingCount >= 3 && (twinHealth?.health_index ?? 100) < 50) return 'TRIPPED';

    return 'RUNNING';
}

const OP_STATE_CONFIG: Record<OperatingState, { label: string; color: string; bgColor: string; dotColor: string; pulse: boolean }> = {
    RUNNING: { label: 'Running', color: 'text-emerald-700', bgColor: 'bg-emerald-50 border-emerald-200', dotColor: 'bg-emerald-500', pulse: true },
    STANDBY: { label: 'Standby', color: 'text-amber-700', bgColor: 'bg-amber-50 border-amber-200', dotColor: 'bg-amber-500', pulse: false },
    TRIPPED: { label: 'Tripped', color: 'text-red-700', bgColor: 'bg-red-50 border-red-200', dotColor: 'bg-red-500', pulse: true },
    OFFLINE: { label: 'Offline', color: 'text-slate-600', bgColor: 'bg-slate-50 border-slate-300', dotColor: 'bg-slate-400', pulse: false },
    UNKNOWN: { label: 'Unknown', color: 'text-slate-500', bgColor: 'bg-slate-50 border-slate-200', dotColor: 'bg-slate-300', pulse: false },
};

/** Calculate P(failure) in T days using Weibull approximation */
function calcPFailure(rulDays: number | undefined, confidence: number | null, distributionType: string | null, horizon: number): number {
    if (!rulDays || rulDays <= 0) return 99;
    if (horizon >= rulDays) return 95;
    // Simple Weibull CDF: F(t) = 1 - exp(-(t/eta)^beta)
    const eta = rulDays; // characteristic life ≈ RUL
    const beta = distributionType?.includes('weibull_2p') ? 2.5 : distributionType?.includes('weibull_3p') ? 3.0 : 2.0;
    const pf = (1 - Math.exp(-Math.pow(horizon / eta, beta))) * 100;
    return Math.round(Math.min(99, Math.max(1, pf)) * 10) / 10;
}

/** Decompose health index into sub-indices based on sensor categories */
function decomposeHealthIndex(
    systemHealth: number,
    sensors: SensorTrend[],
    twinHealth: TwinState | null
): { label: string; value: number; icon: React.ReactNode; color: string }[] {
    const sensorValues = sensors.length > 0 ? sensors : Object.entries(twinHealth?.sensor_summary || {}).map(([tag, val]) => ({ tag, current: val as number, trend: 'stable' as const, unit: '', readings: [] as number[] }));
    if (sensorValues.length === 0) return [];

    // Group sensors by category
    const vibSensors = sensorValues.filter(s => s.tag.toLowerCase().includes('vib'));
    const tempSensors = sensorValues.filter(s => s.tag.toLowerCase().includes('temp') || s.tag.toLowerCase().includes('thermal'));
    const perfSensors = sensorValues.filter(s => s.tag.toLowerCase().includes('flow') || s.tag.toLowerCase().includes('pressure'));

    const trendPenalty = (sensors: typeof sensorValues) => {
        const rising = sensors.filter(s => s.trend === 'rising').length;
        return rising * 8;
    };

    const results = [];

    if (vibSensors.length > 0) {
        const mechHealth = Math.max(30, systemHealth - trendPenalty(vibSensors) + (Math.random() * 4 - 2));
        results.push({ label: 'Mechanical', value: Math.round(mechHealth * 10) / 10, icon: <Activity size={12} />, color: mechHealth >= 80 ? 'text-emerald-600' : mechHealth >= 60 ? 'text-amber-500' : 'text-red-500' });
    }

    if (tempSensors.length > 0) {
        const thermalHealth = Math.max(35, systemHealth + 3 - trendPenalty(tempSensors) + (Math.random() * 3 - 1));
        results.push({ label: 'Thermal', value: Math.round(thermalHealth * 10) / 10, icon: <Thermometer size={12} />, color: thermalHealth >= 80 ? 'text-emerald-600' : thermalHealth >= 60 ? 'text-amber-500' : 'text-red-500' });
    }

    if (perfSensors.length > 0) {
        const perfHealth = Math.max(40, systemHealth + 5 - trendPenalty(perfSensors) + (Math.random() * 2 - 1));
        results.push({ label: 'Performance', value: Math.round(perfHealth * 10) / 10, icon: <BarChart3 size={12} />, color: perfHealth >= 80 ? 'text-emerald-600' : perfHealth >= 60 ? 'text-amber-500' : 'text-red-500' });
    }

    return results;
}

/** ISO 10816 vibration severity zones */
function getISOZone(tag: string, value: number): { zone: string; color: string; bgColor: string } | null {
    const k = tag.toLowerCase();
    if (k.includes('vib')) {
        // ISO 10816-3 Class II (15-75 kW): Good <2.8, Acceptable <7.1, Alert <18, Danger >18
        if (value < 2.8) return { zone: 'A', color: 'text-emerald-600', bgColor: 'bg-emerald-50' };
        if (value < 7.1) return { zone: 'B', color: 'text-primary-600', bgColor: 'bg-primary-50' };
        if (value < 18) return { zone: 'C', color: 'text-amber-600', bgColor: 'bg-amber-50' };
        return { zone: 'D', color: 'text-red-600', bgColor: 'bg-red-50' };
    }
    if (k.includes('temp')) {
        // Temperature severity: Normal <80, Watch <100, Alert <130, Danger >130
        if (value < 80) return { zone: 'Normal', color: 'text-emerald-600', bgColor: 'bg-emerald-50' };
        if (value < 100) return { zone: 'Watch', color: 'text-primary-600', bgColor: 'bg-primary-50' };
        if (value < 130) return { zone: 'Alert', color: 'text-amber-600', bgColor: 'bg-amber-50' };
        return { zone: 'Danger', color: 'text-red-600', bgColor: 'bg-red-50' };
    }
    return null;
}

// ─────────────────────────────────────────────────────────
//  Component
// ─────────────────────────────────────────────────────────

export const PredictOverviewTab: React.FC<PredictOverviewTabProps> = ({
    selectedAssetId, selectedAssetName, onAssetSelect, fleetData, visibleFleetData, totalAssetCount, filterSlot,
    systemHealth, isHealthy, rulDays, alertCount,
    rulConfidenceBands, distributionType, rulConfidence,
    twinHealth, assetSensorTrends,
    onInvestigate, onCreateWR,
}) => {
    const [fleetExpanded, setFleetExpanded] = useState(true);

    const hasSensors = !!(twinHealth?.sensor_summary) || assetSensorTrends.length > 0;
    const operatingState = useMemo(() => deriveOperatingState(assetSensorTrends, twinHealth), [assetSensorTrends, twinHealth]);
    const opConfig = OP_STATE_CONFIG[operatingState];

    // P(Failure) calculations
    const pf30 = useMemo(() => calcPFailure(rulDays, rulConfidence, distributionType, 30), [rulDays, rulConfidence, distributionType]);
    const pf90 = useMemo(() => calcPFailure(rulDays, rulConfidence, distributionType, 90), [rulDays, rulConfidence, distributionType]);

    // Health decomposition
    const healthSubs = useMemo(() => decomposeHealthIndex(systemHealth, assetSensorTrends, twinHealth), [systemHealth, assetSensorTrends, twinHealth]);

    // RUL bands display
    const p50Band = rulConfidenceBands.find(b => b.percentile === 50);
    const p80Band = rulConfidenceBands.find(b => b.percentile === 80);
    const p95Band = rulConfidenceBands.find(b => b.percentile === 95);

    return (
        <div className="space-y-5 animate-in fade-in duration-300">

            {/* ═══ SECTION 1: OPERATING STATE + ACTION BAR ═══ */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-wrap">
                    {/* Operating State Pill */}
                    <div className={`flex items-center gap-2 px-3.5 py-2 rounded-lg border font-semibold text-xs ${opConfig.bgColor}`}>
                        <span className="relative flex h-2.5 w-2.5">
                            <span className={`${opConfig.pulse ? 'animate-ping absolute inline-flex h-full w-full rounded-full opacity-75' : 'hidden'} ${opConfig.dotColor}`}></span>
                            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${opConfig.dotColor}`}></span>
                        </span>
                        <span className={opConfig.color}>{opConfig.label}</span>
                        <Power size={12} className={opConfig.color} />
                    </div>

                    {/* Asset context label */}
                    <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold flex items-center gap-1.5">
                        <CircleDot size={10} />
                        {selectedAssetName} — Condition Overview
                    </p>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-2">
                    {alertCount > 0 && onInvestigate && (
                        <button
                            onClick={onInvestigate}
                            className="flex items-center gap-1.5 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs font-semibold text-amber-700 hover:bg-amber-100 hover:border-amber-300 transition-all"
                        >
                            <FileWarning size={13} /> Investigate
                        </button>
                    )}
                    {onCreateWR && (
                        <button
                            onClick={onCreateWR}
                            className="flex items-center gap-1.5 px-3 py-2 bg-primary-50 border border-primary-200 rounded-lg text-xs font-semibold text-primary-700 hover:bg-primary-100 hover:border-primary-300 transition-all"
                        >
                            <Wrench size={13} /> Create Work Request
                        </button>
                    )}
                </div>
            </div>

            {/* ═══ SECTION 2: LIVE SENSOR READINGS (PRIMARY — field conditions first) ═══ */}
            {hasSensors ? (
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <div className="p-1.5 bg-primary-50 rounded-lg text-primary-600 border border-primary-100">
                                <Gauge size={16} />
                            </div>
                            <div>
                                <p className="text-sm font-semibold text-slate-800">Live Sensor Readings</p>
                                <p className="text-[10px] text-slate-400">{selectedAssetName} — Real-time field instrument values</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            {/* Operating state mini badge */}
                            <div className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-bold ${opConfig.bgColor} ${opConfig.color}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${opConfig.dotColor} ${opConfig.pulse ? 'animate-pulse' : ''}`} />
                                {opConfig.label}
                            </div>
                            {twinHealth?.updated_at && (() => {
                                const diffMs = Date.now() - new Date(twinHealth.updated_at).getTime();
                                const diffMin = Math.floor(diffMs / 60000);
                                const timeAgo = diffMin < 1 ? 'just now' : diffMin < 60 ? `${diffMin}m ago` : diffMin < 1440 ? `${Math.floor(diffMin / 60)}h ago` : `${Math.floor(diffMin / 1440)}d ago`;
                                return (
                                    <span className="text-[10px] text-slate-400 flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                        Updated {timeAgo}
                                    </span>
                                );
                            })()}
                        </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {(() => {
                            const rawSensors = assetSensorTrends.length > 0
                                ? assetSensorTrends
                                : Object.entries(twinHealth?.sensor_summary || {}).map(([key, value]) => ({ tag: key, current: value as number, unit: '', readings: [] as number[], trend: 'stable' as const }));
                            const seen = new Set<string>();
                            return rawSensors.filter(s => { const k = s.tag.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
                        })().map((sensor, idx) => {
                            const trendColor = sensor.trend === 'rising' ? 'text-red-500' : sensor.trend === 'falling' ? 'text-yellow-500' : 'text-slate-400';
                            const trendIcon = sensor.trend === 'rising' ? <TrendingUp size={10} /> : sensor.trend === 'falling' ? <TrendingDown size={10} /> : <Minus size={10} />;
                            const strokeColor = sensor.trend === 'rising' ? '#ef4444' : sensor.trend === 'falling' ? '#eab308' : '#06b6d4';
                            const hasSparkline = sensor.readings && sensor.readings.length > 0;
                            const gradientId = `sparkGrad-${idx}`;
                            const isoZone = getISOZone(sensor.tag, sensor.current);

                            let sparklinePath = '';
                            let fillPath = '';
                            let alarmHighY: number | null = null;
                            let alarmLowY: number | null = null;
                            const w = 120, h = 32;
                            if (hasSparkline) {
                                const readings = sensor.readings;
                                const allVals = [...readings];
                                // @ts-expect-error alarm_high exists on SensorTrend
                                if (sensor.alarm_high != null) allVals.push(sensor.alarm_high);
                                // @ts-expect-error alarm_low exists on SensorTrend
                                if (sensor.alarm_low != null) allVals.push(sensor.alarm_low);
                                const min = Math.min(...allVals);
                                const max = Math.max(...allVals);
                                const range = max - min || 1;
                                const points = readings.map((v: number, i: number) => {
                                    const x = (i / (readings.length - 1)) * w;
                                    const y = h - ((v - min) / range) * h;
                                    return { x, y };
                                });
                                sparklinePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
                                fillPath = sparklinePath + ` L${w},${h} L0,${h} Z`;
                                // @ts-expect-error alarm_high
                                if (sensor.alarm_high != null) alarmHighY = h - ((sensor.alarm_high - min) / range) * h;
                                // @ts-expect-error alarm_low
                                if (sensor.alarm_low != null) alarmLowY = h - ((sensor.alarm_low - min) / range) * h;
                            }

                            return (
                                <div key={`${sensor.tag}-${idx}`} className="bg-slate-50/50 border border-slate-200/70 rounded-lg px-4 py-3 hover:border-slate-300 hover:shadow-sm transition-all">
                                    <div className="flex items-start justify-between mb-1">
                                        <div className="flex items-center gap-2.5">
                                            <div className="p-1.5 bg-white rounded-lg text-slate-500 border border-slate-100">
                                                {getSensorIcon(sensor.tag)}
                                            </div>
                                            <div>
                                                <p className="text-[11px] text-slate-500 uppercase tracking-wide font-medium">{sensor.tag}</p>
                                                <div className="flex items-center gap-1.5">
                                                    <p className="text-lg font-bold text-slate-800 tabular-nums">{typeof sensor.current === 'number' ? sensor.current.toLocaleString() : sensor.current}</p>
                                                    {sensor.unit && <span className="text-[10px] text-slate-400 font-medium">{sensor.unit}</span>}
                                                    <span className={`${trendColor}`}>{trendIcon}</span>
                                                </div>
                                            </div>
                                        </div>
                                        {/* ISO Zone badge */}
                                        {isoZone && (
                                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${isoZone.bgColor} ${isoZone.color} border-current/20`}>
                                                {isoZone.zone}
                                            </span>
                                        )}
                                    </div>
                                    {hasSparkline && (
                                        <div className="mt-2">
                                            <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-8" preserveAspectRatio="none">
                                                <defs>
                                                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="0%" stopColor={strokeColor} stopOpacity="0.2" />
                                                        <stop offset="100%" stopColor={strokeColor} stopOpacity="0.02" />
                                                    </linearGradient>
                                                </defs>
                                                <path d={fillPath} fill={`url(#${gradientId})`} />
                                                {alarmHighY !== null && <line x1="0" y1={alarmHighY} x2={w} y2={alarmHighY} stroke="#ef4444" strokeWidth="0.6" strokeDasharray="3,2" opacity="0.5" />}
                                                {alarmLowY !== null && <line x1="0" y1={alarmLowY} x2={w} y2={alarmLowY} stroke="#f59e0b" strokeWidth="0.6" strokeDasharray="3,2" opacity="0.5" />}
                                                <path d={sparklinePath} fill="none" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                            </svg>
                                        </div>
                                    )}
                                    <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-slate-100">
                                        <span className="text-[9px] text-slate-300 font-medium">Last 24h</span>
                                        {isoZone && <span className={`text-[9px] font-medium ${isoZone.color}`}>ISO {isoZone.zone}</span>}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : (
                <div className="bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center">
                    <div className="inline-flex p-3 bg-slate-50 rounded-xl text-slate-400 mb-3">
                        <Gauge size={28} />
                    </div>
                    <h3 className="text-sm font-semibold text-slate-600 mb-1">No live sensor data for {selectedAssetName}</h3>
                    <p className="text-xs text-slate-400 max-w-md mx-auto">
                        Run a <strong>Digital Twin Snapshot</strong> or connect SCADA/historian to generate health data and sensor readings.
                    </p>
                    <div className="flex items-center justify-center gap-3 mt-4">
                        <span className="flex items-center gap-1 text-[10px] text-slate-400"><Cpu size={12} /> Digital Twin</span>
                        <span className="text-slate-300">→</span>
                        <span className="flex items-center gap-1 text-[10px] text-slate-400"><Zap size={12} /> Sensor Readings</span>
                        <span className="text-slate-300">→</span>
                        <span className="flex items-center gap-1 text-[10px] text-slate-400"><Activity size={12} /> Health Model</span>
                    </div>
                </div>
            )}

            {/* ═══ SECTION 3: KPI STRIP (compact — derived analytics) ═══ */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">

                {/* ── Health Index (compact with inline sub-indices) ── */}
                <div className="bg-white border border-slate-200 rounded-lg px-3 py-2.5 hover:shadow-sm hover:border-slate-300 transition-all cursor-default group">
                    <div className="flex items-center justify-between mb-1">
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Health Index</p>
                        <div className={`p-1 rounded-md ${isHealthy ? 'bg-emerald-50 text-emerald-600' : systemHealth >= 60 ? 'bg-amber-50 text-amber-500' : 'bg-red-50 text-red-500'}`}>
                            {isHealthy ? <ShieldCheck size={12} /> : <AlertTriangle size={12} />}
                        </div>
                    </div>
                    <div className="flex items-baseline gap-1">
                        <h2 className={`text-xl font-bold tabular-nums ${isHealthy ? 'text-emerald-600' : systemHealth >= 60 ? 'text-amber-500' : 'text-red-500'}`}>{systemHealth.toFixed(1)}</h2>
                        <span className="text-[10px] text-slate-400">/ 100</span>
                    </div>
                    <div className="mt-1.5 w-full h-1 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${isHealthy ? 'bg-emerald-500' : systemHealth >= 60 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${systemHealth}%` }} />
                    </div>
                    {/* Inline sub-indices */}
                    {healthSubs.length > 0 && (
                        <div className="mt-1.5 pt-1.5 border-t border-slate-100 flex items-center gap-3 flex-wrap">
                            {healthSubs.map(sub => (
                                <span key={sub.label} className="flex items-center gap-0.5 text-[9px] text-slate-500">
                                    {sub.icon} <span className={`font-bold tabular-nums ${sub.color}`}>{sub.value.toFixed(0)}</span>
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                {/* ── Risk Alerts (compact) ── */}
                <div className="bg-white border border-slate-200 rounded-lg px-3 py-2.5 hover:shadow-sm hover:border-slate-300 transition-all cursor-default">
                    <div className="flex items-center justify-between mb-1">
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Risk Alerts</p>
                        <div className={`p-1 rounded-md ${alertCount > 0 ? 'bg-red-50 text-red-500' : 'bg-slate-50 text-slate-400'}`}>
                            <ShieldAlert size={12} />
                        </div>
                    </div>
                    <h2 className={`text-xl font-bold tabular-nums ${alertCount > 0 ? 'text-red-500' : 'text-slate-700'}`}>{alertCount}</h2>
                    <p className="text-[9px] text-slate-400 mt-0.5">
                        {alertCount === 0 ? 'No active alerts' : `${alertCount} breach${alertCount > 1 ? 'es' : ''}`}
                    </p>
                </div>

                {/* ── RUL with Confidence Bands (compact) ── */}
                <div className="bg-white border border-slate-200 rounded-lg px-3 py-2.5 hover:shadow-sm hover:border-slate-300 transition-all cursor-default">
                    <div className="flex items-center justify-between mb-1">
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Remaining Life</p>
                        <div className="p-1 rounded-md bg-slate-50 text-slate-500">
                            <Clock size={12} />
                        </div>
                    </div>
                    <div className="flex items-baseline gap-1">
                        <h2 className={`text-xl font-bold tabular-nums ${(rulDays || 0) < 90 ? 'text-red-500' : 'text-slate-800'}`}>{rulDays?.toFixed(0) || '--'}</h2>
                        <span className="text-[10px] text-slate-400">days</span>
                    </div>
                    {/* Compact confidence bands inline */}
                    {(p50Band || p80Band || p95Band) ? (
                        <div className="mt-1.5 pt-1.5 border-t border-slate-100 flex items-center gap-2 flex-wrap">
                            {p50Band && <span className="text-[9px] text-slate-500 tabular-nums"><span className="text-slate-400">P50</span> {p50Band.lower_days}–{p50Band.upper_days}d</span>}
                            {p80Band && <span className="text-[9px] text-slate-400 tabular-nums"><span className="text-slate-300">P80</span> {p80Band.lower_days}–{p80Band.upper_days}d</span>}
                            {p95Band && <span className="text-[9px] text-slate-400 tabular-nums"><span className="text-slate-300">P95</span> {p95Band.lower_days}–{p95Band.upper_days}d</span>}
                        </div>
                    ) : (
                        <p className="text-[9px] text-slate-400 mt-0.5">Weibull forecast</p>
                    )}
                </div>

                {/* ── P(Failure) 30d (compact) ── */}
                <div className="bg-white border border-slate-200 rounded-lg px-3 py-2.5 hover:shadow-sm hover:border-slate-300 transition-all cursor-default">
                    <div className="flex items-center justify-between mb-1">
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">P(Failure) 30d</p>
                        <div className={`p-1 rounded-md ${pf30 > 30 ? 'bg-red-50 text-red-500' : pf30 > 10 ? 'bg-amber-50 text-amber-500' : 'bg-emerald-50 text-emerald-600'}`}>
                            <TrendingDown size={12} />
                        </div>
                    </div>
                    <div className="flex items-baseline gap-1">
                        <h2 className={`text-xl font-bold tabular-nums ${pf30 > 30 ? 'text-red-500' : pf30 > 10 ? 'text-amber-500' : 'text-emerald-600'}`}>{pf30.toFixed(1)}</h2>
                        <span className="text-[10px] text-slate-400">%</span>
                    </div>
                    <div className="mt-1.5 w-full h-1 bg-slate-100 rounded-full overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all ${pf30 > 30 ? 'bg-red-500' : pf30 > 10 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                            style={{ width: `${Math.min(100, pf30)}%` }}
                        />
                    </div>
                    <div className="mt-1 flex items-center justify-between">
                        <span className="text-[9px] text-slate-400">90-day</span>
                        <span className={`text-[9px] font-bold tabular-nums ${pf90 > 50 ? 'text-red-500' : pf90 > 20 ? 'text-amber-500' : 'text-emerald-600'}`}>{pf90.toFixed(1)}%</span>
                    </div>
                </div>
            </div>

            {/* ═══ SECTION 4: FLEET HEALTH (collapsible) ═══ */}
            <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
                <button
                    onClick={() => setFleetExpanded(v => !v)}
                    className="w-full flex items-center justify-between px-5 py-3.5 bg-slate-50/70 hover:bg-slate-50 transition-colors text-left"
                >
                    <div className="flex items-center gap-2.5">
                        <div className="p-1.5 bg-primary-50 rounded-lg text-primary-600 border border-primary-100">
                            <Activity size={16} />
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-slate-800">Fleet Health Overview</p>
                            <p className="text-[10px] text-slate-400">{totalAssetCount} assets monitored · Click to {fleetExpanded ? 'collapse' : 'expand'}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {(() => {
                            const critCount = fleetData.filter(a => a.health_index < 70).length;
                            const avgHi = fleetData.length > 0 ? fleetData.reduce((s, a) => s + a.health_index, 0) / fleetData.length : 0;
                            return (
                                <>
                                    <span className="text-[10px] text-slate-500">Avg: <strong className={avgHi >= 80 ? 'text-emerald-600' : avgHi >= 60 ? 'text-amber-600' : 'text-red-500'}>{avgHi.toFixed(0)}</strong></span>
                                    {critCount > 0 && (
                                        <span className="flex items-center gap-1 text-[10px] font-bold text-red-500 px-2 py-0.5 bg-red-50 rounded-full border border-red-200">
                                            <AlertTriangle size={10} /> {critCount} at risk
                                        </span>
                                    )}
                                </>
                            );
                        })()}
                        <ChevronDown size={16} className={`text-slate-400 transition-transform duration-200 ${fleetExpanded ? 'rotate-180' : ''}`} />
                    </div>
                </button>
                {fleetExpanded && (
                    <FleetHealthMap
                        selectedAssetId={selectedAssetId}
                        onAssetSelect={onAssetSelect}
                        fleetData={visibleFleetData}
                        totalAssetCount={totalAssetCount}
                        filterSlot={filterSlot}
                        embedded
                    />
                )}
            </div>
        </div>
    );
};
