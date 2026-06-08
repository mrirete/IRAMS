/**
 * VisionHistoryPanel — Displays the full Vision inspection history
 * for a given asset within the Asset Module detail slide-out.
 *
 * Surfaces all vision results (corrosion, thermal, condition, tagging)
 * along with drone surveys linked to this asset.
 */

import React, { useEffect, useState } from 'react';
import { Eye, Camera, Plane, AlertTriangle, CheckCircle2, ChevronRight, Wrench } from 'lucide-react';
import { visionService } from '../../eam/services/VisionService';
import { agentService } from '../../eam/services/AgentService';
import type { VisionResult, DroneSurvey, VisionSeverity } from '../../types/strategy';

interface VisionHistoryPanelProps {
    assetId: string;
    assetName: string;
    assetTag?: string;
    assetCriticality?: string;
}

const SEVERITY_STYLES: Record<VisionSeverity, { bg: string; text: string }> = {
    critical: { bg: 'bg-red-100 border-red-200', text: 'text-red-700' },
    severe: { bg: 'bg-orange-100 border-orange-200', text: 'text-orange-700' },
    moderate: { bg: 'bg-yellow-100 border-yellow-200', text: 'text-yellow-700' },
    minor: { bg: 'bg-slate-100 border-slate-200', text: 'text-slate-600' },
};

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
    corrosion: { label: 'Corrosion', color: 'bg-orange-50 text-orange-700 border-orange-200' },
    thermal: { label: 'Thermal', color: 'bg-red-50 text-red-700 border-red-200' },
    condition: { label: 'Condition', color: 'bg-blue-50 text-blue-700 border-blue-200' },
    tagging: { label: 'Tagging', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};

export const VisionHistoryPanel: React.FC<VisionHistoryPanelProps> = ({
    assetId, assetName, assetTag, assetCriticality,
}) => {
    const [results, setResults] = useState<VisionResult[]>([]);
    const [drones, setDrones] = useState<DroneSurvey[]>([]);
    const [loading, setLoading] = useState(true);
    const [draftingId, setDraftingId] = useState<string | null>(null);
    const [draftMessage, setDraftMessage] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const [vr, ds] = await Promise.all([
                    visionService.getResultsByAsset(assetId),
                    visionService.getDroneSurveysByAsset(assetId),
                ]);
                setResults(vr);
                setDrones(ds);
            } catch { /* fallback empty */ }
            setLoading(false);
        })();
    }, [assetId]);

    const handleDraftWR = async (finding: VisionResult) => {
        setDraftingId(finding.id);
        setDraftMessage(null);
        try {
            const result = await agentService.draftWorkOrderFromVisionFinding(finding, {
                assetName,
                assetTag,
                assetCriticality,
            });
            setDraftMessage(result.message);
        } catch {
            setDraftMessage('Failed to draft WR.');
        }
        setTimeout(() => setDraftingId(null), 500);
    };

    if (loading) {
        return (
            <div className="flex items-center gap-2 text-xs text-slate-400 py-6 justify-center">
                <div className="w-4 h-4 border-2 border-cyan-300 border-t-transparent rounded-full animate-spin" />
                Loading vision history...
            </div>
        );
    }

    const hasData = results.length > 0 || drones.length > 0;

    if (!hasData) {
        return (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-6 text-center">
                <Eye size={28} className="mx-auto text-slate-300 mb-2" />
                <p className="text-sm text-slate-500 font-medium">No Vision Inspections</p>
                <p className="text-xs text-slate-400 mt-1">No visual inspections have been conducted for this asset.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Vision Results */}
            {results.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                        <Camera size={16} className="text-cyan-600" />
                        <h4 className="text-sm font-semibold text-slate-800">Inspection Results</h4>
                        <span className="ml-auto text-[10px] bg-cyan-50 text-cyan-700 px-2 py-0.5 rounded-full font-medium border border-cyan-200">
                            {results.length}
                        </span>
                    </div>
                    <div className="divide-y divide-slate-50">
                        {results.map(r => {
                            const sev = SEVERITY_STYLES[r.max_severity];
                            const typeInfo = TYPE_LABELS[r.analysis_type] || TYPE_LABELS.condition;
                            const isEligible = visionService.isWRDraftEligible(r.max_severity);
                            const isDrafting = draftingId === r.id;

                            return (
                                <div key={r.id} className="px-4 py-3 hover:bg-slate-50 transition-colors">
                                    <div className="flex items-start gap-3">
                                        <div className="mt-0.5">
                                            {isEligible
                                                ? <AlertTriangle size={14} className="text-orange-500" />
                                                : <CheckCircle2 size={14} className="text-slate-400" />
                                            }
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap mb-1">
                                                <span className="text-xs font-medium text-slate-700">{r.image_name}</span>
                                                <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded border ${typeInfo.color}`}>
                                                    {typeInfo.label}
                                                </span>
                                                <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded border ${sev.bg} ${sev.text}`}>
                                                    {r.max_severity.toUpperCase()}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-3 text-[10px] text-slate-400">
                                                <span>{r.detected_items} anomal{r.detected_items === 1 ? 'y' : 'ies'}</span>
                                                <span>{new Date(r.timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                                {!r.reviewed && <span className="text-amber-500 font-medium">Unreviewed</span>}
                                            </div>
                                        </div>
                                        {isEligible && (
                                            <button
                                                onClick={() => handleDraftWR(r)}
                                                disabled={isDrafting}
                                                className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-violet-700 bg-violet-50 border border-violet-200 rounded hover:bg-violet-100 transition-colors shrink-0 disabled:opacity-50"
                                                title="Draft a Work Request from this Vision finding (HITL)"
                                            >
                                                {isDrafting
                                                    ? <div className="w-3 h-3 border-2 border-violet-300 border-t-transparent rounded-full animate-spin" />
                                                    : <Wrench size={10} />
                                                }
                                                Draft WR
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Draft Message */}
            {draftMessage && (
                <div className="bg-violet-50 border border-violet-200 rounded-lg px-4 py-2 text-xs text-violet-700">
                    <span className="font-medium">Agent Response:</span> {draftMessage}
                </div>
            )}

            {/* Drone Surveys */}
            {drones.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                        <Plane size={16} className="text-slate-500" />
                        <h4 className="text-sm font-semibold text-slate-800">Drone Surveys</h4>
                        <span className="ml-auto text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium border border-slate-200">
                            {drones.length}
                        </span>
                    </div>
                    <div className="divide-y divide-slate-50">
                        {drones.map(d => (
                            <div key={d.id} className="px-4 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors">
                                <Plane size={14} className="text-slate-400 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-slate-700">{d.survey_name}</p>
                                    <div className="flex items-center gap-3 text-[10px] text-slate-400 mt-0.5">
                                        <span>{new Date(d.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                        <span>{d.area_covered_sqm.toLocaleString()} m²</span>
                                        <span>{d.anomalies_found} anomalies</span>
                                        {d.site && <span className="text-cyan-500">📍 {d.site}</span>}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1">
                                    {d.reviewed
                                        ? <CheckCircle2 size={14} className="text-emerald-500" />
                                        : <span className="text-[10px] text-amber-500 font-medium">Pending</span>
                                    }
                                    <ChevronRight size={14} className="text-slate-300" />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
