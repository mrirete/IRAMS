/**
 * VisionThermalFeed — Surfaces Vision thermal anomaly findings
 * within the Predict Digital Twin tab for sensor-to-image correlation.
 *
 * Displays thermal hotspot detections alongside the Digital Twin trajectory,
 * giving engineers a visual telemetry overlay for predictive decisions.
 */

import React, { useEffect, useState } from 'react';
import { Flame, AlertTriangle, Eye, CheckCircle2 } from 'lucide-react';
import { visionService } from '../../eam/services/VisionService';
import type { VisionResult } from '../../types/strategy';

interface VisionThermalFeedProps {
    assetId: string;
    assetName?: string;
}

const SEVERITY_COLORS: Record<string, string> = {
    critical: 'text-red-500',
    severe: 'text-orange-500',
    moderate: 'text-yellow-500',
    minor: 'text-slate-400',
};

const SEVERITY_BAR: Record<string, string> = {
    critical: 'bg-gradient-to-r from-orange-500 to-red-500',
    severe: 'bg-gradient-to-r from-yellow-500 to-orange-500',
    moderate: 'bg-yellow-400',
    minor: 'bg-slate-300',
};

export const VisionThermalFeed: React.FC<VisionThermalFeedProps> = ({ assetId, assetName }) => {
    const [findings, setFindings] = useState<VisionResult[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const data = await visionService.getThermalFindings(assetId);
                setFindings(data);
            } catch { /* fallback empty */ }
            setLoading(false);
        })();
    }, [assetId]);

    if (loading) {
        return (
            <div className="flex items-center gap-2 text-xs text-slate-400 py-4">
                <div className="w-4 h-4 border-2 border-orange-300 border-t-transparent rounded-full animate-spin" />
                Loading thermal vision data...
            </div>
        );
    }

    if (findings.length === 0) {
        return (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-center">
                <Flame size={24} className="mx-auto text-slate-300 mb-2" />
                <p className="text-xs text-slate-400">No thermal vision findings for this asset.</p>
                <p className="text-[10px] text-slate-300 mt-1">Run a thermal analysis in the Vision module to detect hotspots.</p>
            </div>
        );
    }

    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-gradient-to-br from-orange-100 to-red-100">
                    <Flame size={14} className="text-orange-600" />
                </div>
                <h4 className="text-sm font-semibold text-slate-800">Vision — Thermal Anomalies</h4>
                <span className="ml-auto text-[10px] bg-orange-50 text-orange-700 px-2 py-0.5 rounded-full font-medium border border-orange-200">
                    {findings.length} hotspot{findings.length !== 1 ? 's' : ''}
                </span>
            </div>
            <div className="p-4 space-y-3">
                {findings.map(f => {
                    const sevColor = SEVERITY_COLORS[f.max_severity] || SEVERITY_COLORS.minor;
                    const barColor = SEVERITY_BAR[f.max_severity] || SEVERITY_BAR.minor;
                    const intensityPct = f.max_severity === 'critical' ? 95 : f.max_severity === 'severe' ? 70 : f.max_severity === 'moderate' ? 45 : 20;

                    return (
                        <div key={f.id} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                            <div className="flex items-start justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    {f.max_severity === 'critical' || f.max_severity === 'severe'
                                        ? <AlertTriangle size={13} className={sevColor} />
                                        : <CheckCircle2 size={13} className="text-slate-400" />
                                    }
                                    <span className="text-xs font-medium text-slate-700">{f.image_name}</span>
                                </div>
                                <span className={`text-[10px] font-bold uppercase ${sevColor}`}>
                                    {f.max_severity}
                                </span>
                            </div>
                            <div className="flex items-center gap-2 mb-2">
                                <div className="flex-1 bg-slate-200 rounded-full h-1.5">
                                    <div
                                        className={`h-1.5 rounded-full transition-all duration-500 ${barColor}`}
                                        style={{ width: `${intensityPct}%` }}
                                    />
                                </div>
                                <span className="text-[10px] text-slate-400 font-mono">{intensityPct}%</span>
                            </div>
                            <div className="flex items-center justify-between text-[10px] text-slate-400">
                                <span>{f.detected_items} thermal anomal{f.detected_items === 1 ? 'y' : 'ies'}</span>
                                <span>{new Date(f.timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                            </div>
                            {!f.reviewed && (
                                <div className="flex items-center gap-1 mt-2 text-[10px] text-amber-500">
                                    <Eye size={10} />
                                    <span className="font-medium">Unreviewed — field verification recommended</span>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
