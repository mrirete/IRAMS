import React from 'react';
import { Activity, AlertTriangle, ShieldAlert, ShieldCheck, Clock, Gauge, Thermometer, Wind, Droplets, TrendingDown, TrendingUp } from 'lucide-react';
import { FleetHealthMap } from './FleetHealthMap';
import type { FleetAssetHealth, TwinState, SensorTrend } from '../../types/intelligence';

interface PredictOverviewTabProps {
    /* Fleet */
    selectedAssetId: string;
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
    calibrationQuality: number;

    /* Sensors */
    twinHealth: TwinState | null;
    assetSensorTrends: SensorTrend[];
}

function getSensorIcon(key: string) {
    const k = key.toLowerCase();
    if (k.includes('temp')) return <Thermometer size={16} />;
    if (k.includes('vib')) return <Activity size={16} />;
    if (k.includes('flow')) return <Wind size={16} />;
    if (k.includes('pressure')) return <Droplets size={16} />;
    return <Gauge size={16} />;
}

export const PredictOverviewTab: React.FC<PredictOverviewTabProps> = ({
    selectedAssetId, onAssetSelect, fleetData, visibleFleetData, totalAssetCount, filterSlot,
    systemHealth, isHealthy, rulDays, alertCount, calibrationQuality,
    twinHealth, assetSensorTrends,
}) => {
    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* ═══ Fleet Health Heatmap ═══ */}
            <FleetHealthMap
                selectedAssetId={selectedAssetId}
                onAssetSelect={onAssetSelect}
                fleetData={visibleFleetData}
                totalAssetCount={totalAssetCount}
                filterSlot={filterSlot}
            />

            {/* ═══ LIVE SENSOR READINGS (moved above KPIs) ═══ */}
            {twinHealth?.sensor_summary && (
                <div>
                    <p className="text-xs text-slate-400 uppercase tracking-wider font-bold mb-3 flex items-center gap-2">
                        <Gauge size={14} />
                        Live Sensor Readings
                        <span className="font-normal normal-case">— Real-time field instrument values feeding the health model</span>
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {(() => {
                            const rawSensors = assetSensorTrends.length > 0
                                ? assetSensorTrends
                                : Object.entries(twinHealth.sensor_summary).map(([key, value]) => ({ tag: key, current: value as number, unit: '', readings: [] as number[], trend: 'stable' as const }));
                            // Deduplicate by tag name — keep only the first occurrence
                            const seen = new Set<string>();
                            const uniqueSensors = rawSensors.filter(s => {
                                const key = s.tag.toLowerCase();
                                if (seen.has(key)) return false;
                                seen.add(key);
                                return true;
                            });
                            return uniqueSensors;
                        })().map((sensor, idx) => {
                            const trendColor = sensor.trend === 'rising' ? 'text-red-400' : sensor.trend === 'falling' ? 'text-yellow-500' : 'text-slate-500';
                            const strokeColor = sensor.trend === 'rising' ? '#f87171' : sensor.trend === 'falling' ? '#eab308' : '#06b6d4';
                            const hasSparkline = sensor.readings && sensor.readings.length > 0;
                            const gradientId = `sparkGrad-${idx}`;

                            let sparklinePath = '';
                            let fillPath = '';
                            let alarmHighY: number | null = null;
                            let alarmLowY: number | null = null;
                            const w = 120;
                            const h = 32;
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
                                // @ts-expect-error alarm_high exists on SensorTrend
                                if (sensor.alarm_high != null) alarmHighY = h - ((sensor.alarm_high - min) / range) * h;
                                // @ts-expect-error alarm_low exists on SensorTrend
                                if (sensor.alarm_low != null) alarmLowY = h - ((sensor.alarm_low - min) / range) * h;
                            }

                            const updatedAt = twinHealth?.updated_at;
                            let timeAgo = '';
                            if (updatedAt) {
                                const diffMs = Date.now() - new Date(updatedAt).getTime();
                                const diffMin = Math.floor(diffMs / 60000);
                                if (diffMin < 1) timeAgo = 'just now';
                                else if (diffMin < 60) timeAgo = `${diffMin}m ago`;
                                else if (diffMin < 1440) timeAgo = `${Math.floor(diffMin / 60)}h ago`;
                                else timeAgo = `${Math.floor(diffMin / 1440)}d ago`;
                            }

                            return (
                                <div key={`${sensor.tag}-${idx}`} className="bg-white border border-slate-200/50 rounded-lg px-4 py-3 hover:border-slate-300 hover:shadow-sm transition-all">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-slate-50 rounded-lg text-slate-500">
                                            {getSensorIcon(sensor.tag)}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[11px] text-slate-400 uppercase tracking-wide truncate">{sensor.tag}</p>
                                            <div className="flex items-center gap-2">
                                                <p className="text-lg font-bold text-slate-800 font-mono">{typeof sensor.current === 'number' ? sensor.current.toLocaleString() : sensor.current}</p>
                                                {sensor.unit && <span className="text-[10px] text-slate-400 font-medium">{sensor.unit}</span>}
                                                <span className={`text-[10px] font-bold uppercase ${trendColor}`}>
                                                    {sensor.trend === 'rising' ? '↑' : sensor.trend === 'falling' ? '↓' : '→'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    {hasSparkline && (
                                        <div className="mt-2 pt-1">
                                            <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-8" preserveAspectRatio="none">
                                                <defs>
                                                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="0%" stopColor={strokeColor} stopOpacity="0.25" />
                                                        <stop offset="100%" stopColor={strokeColor} stopOpacity="0.02" />
                                                    </linearGradient>
                                                </defs>
                                                <path d={fillPath} fill={`url(#${gradientId})`} />
                                                {alarmHighY !== null && (
                                                    <line x1="0" y1={alarmHighY} x2={w} y2={alarmHighY} stroke="#ef4444" strokeWidth="0.6" strokeDasharray="3,2" opacity="0.6" />
                                                )}
                                                {alarmLowY !== null && (
                                                    <line x1="0" y1={alarmLowY} x2={w} y2={alarmLowY} stroke="#f59e0b" strokeWidth="0.6" strokeDasharray="3,2" opacity="0.6" />
                                                )}
                                                <path d={sparklinePath} fill="none" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                            </svg>
                                        </div>
                                    )}
                                    <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-slate-100">
                                        <span className="text-[9px] text-slate-300 font-medium">Last 24h</span>
                                        {timeAgo && <span className="text-[9px] text-slate-300">{timeAgo}</span>}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ═══ COMPACT KPIs — color-coded ═══ */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {/* Health Index — Cyan accent */}
                <div className="bg-gradient-to-br from-cyan-50 to-white border border-cyan-200/60 rounded-xl px-4 py-3.5 hover:shadow-md hover:border-cyan-300 transition-all cursor-default group">
                    <div className="flex items-center justify-between mb-1">
                        <p className="text-[10px] font-bold text-cyan-600/70 uppercase tracking-wider">Health Index</p>
                        <div className={`p-1.5 rounded-lg ${isHealthy ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
                            {isHealthy ? <ShieldCheck size={14} /> : <AlertTriangle size={14} />}
                        </div>
                    </div>
                    <div className="flex items-baseline gap-1.5">
                        <h2 className={`text-2xl font-bold ${isHealthy ? 'text-emerald-600' : systemHealth >= 60 ? 'text-amber-500' : 'text-red-500'}`}>{systemHealth.toFixed(1)}</h2>
                        <span className="text-xs text-slate-400">/ 100</span>
                    </div>
                    <div className="mt-1.5 w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${isHealthy ? 'bg-emerald-500' : systemHealth >= 60 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${systemHealth}%` }} />
                    </div>
                </div>

                {/* Active Alerts — Red accent */}
                <div className="bg-gradient-to-br from-red-50 to-white border border-red-200/60 rounded-xl px-4 py-3.5 hover:shadow-md hover:border-red-300 transition-all cursor-default">
                    <div className="flex items-center justify-between mb-1">
                        <p className="text-[10px] font-bold text-red-500/70 uppercase tracking-wider">Risk Alerts</p>
                        <div className="p-1.5 rounded-lg bg-red-100 text-red-500">
                            <ShieldAlert size={14} />
                        </div>
                    </div>
                    <h2 className={`text-2xl font-bold ${alertCount > 0 ? 'text-red-500' : 'text-slate-700'}`}>{alertCount}</h2>
                    <p className="text-[9px] text-slate-400 mt-1">
                        {alertCount === 0 ? 'No active alerts' : `${alertCount} threshold breach${alertCount > 1 ? 'es' : ''}`}
                    </p>
                </div>

                {/* RUL — Amber/Orange accent */}
                <div className="bg-gradient-to-br from-amber-50 to-white border border-amber-200/60 rounded-xl px-4 py-3.5 hover:shadow-md hover:border-amber-300 transition-all cursor-default">
                    <div className="flex items-center justify-between mb-1">
                        <p className="text-[10px] font-bold text-amber-600/70 uppercase tracking-wider">Remaining Life</p>
                        <div className="p-1.5 rounded-lg bg-amber-100 text-amber-600">
                            <Clock size={14} />
                        </div>
                    </div>
                    <div className="flex items-baseline gap-1.5">
                        <h2 className={`text-2xl font-bold ${(rulDays || 0) < 90 ? 'text-red-500' : 'text-slate-800'}`}>{rulDays?.toFixed(0) || '--'}</h2>
                        <span className="text-xs text-slate-400">days</span>
                    </div>
                    <p className="text-[9px] text-slate-400 mt-1">Weibull RUL forecast</p>
                </div>

                {/* Calibration — Violet accent */}
                <div className="bg-gradient-to-br from-violet-50 to-white border border-violet-200/60 rounded-xl px-4 py-3.5 hover:shadow-md hover:border-violet-300 transition-all cursor-default">
                    <div className="flex items-center justify-between mb-1">
                        <p className="text-[10px] font-bold text-violet-500/70 uppercase tracking-wider">Calibration</p>
                        <div className="p-1.5 rounded-lg bg-violet-100 text-violet-600">
                            <Activity size={14} />
                        </div>
                    </div>
                    <h2 className="text-2xl font-bold text-slate-800">{calibrationQuality}%</h2>
                    <div className="mt-1.5 w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${calibrationQuality}%` }} />
                    </div>
                </div>
            </div>
        </div>
    );
};
