/**
 * VisionCorrosionPanel — Surfaces Vision corrosion findings
 * within the Integrity/RBI assessment detail view.
 *
 * Provides a manual "Link to CML" action for engineering-driven
 * integration with the Corrosion Monitoring Location model.
 */

import React, { useEffect, useState } from 'react';
import { Eye, ExternalLink, AlertTriangle, CheckCircle2, Camera, MapPin } from 'lucide-react';
import { visionService } from '../../eam/services/VisionService';
import type { VisionResult } from '../../types/strategy';

interface VisionCorrosionPanelProps {
    assetId: string;
    assetName?: string;
    onLinkToCML?: (finding: VisionResult) => void;
}

const SEVERITY_STYLES: Record<string, { bg: string; text: string }> = {
    critical: { bg: 'bg-red-100 border-red-200', text: 'text-red-700' },
    severe: { bg: 'bg-orange-100 border-orange-200', text: 'text-orange-700' },
    moderate: { bg: 'bg-yellow-100 border-yellow-200', text: 'text-yellow-700' },
    minor: { bg: 'bg-slate-100 border-slate-200', text: 'text-slate-600' },
};

export const VisionCorrosionPanel: React.FC<VisionCorrosionPanelProps> = ({
    assetId, assetName, onLinkToCML,
}) => {
    const [findings, setFindings] = useState<VisionResult[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const data = await visionService.getCorrosionFindings(assetId);
                setFindings(data);
            } catch { /* fallback empty */ }
            setLoading(false);
        })();
    }, [assetId]);

    if (loading) {
        return (
            <div className="flex items-center gap-2 text-xs text-slate-400 py-4">
                <div className="w-4 h-4 border-2 border-primary-300 border-t-transparent rounded-full animate-spin" />
                Loading vision corrosion data...
            </div>
        );
    }

    if (findings.length === 0) {
        return (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-center">
                <Camera size={24} className="mx-auto text-slate-300 mb-2" />
                <p className="text-xs text-slate-400">No vision corrosion findings for this asset.</p>
                <p className="text-[10px] text-slate-300 mt-1">Run a Vision analysis to detect surface degradation.</p>
            </div>
        );
    }

    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                <Eye size={16} className="text-primary-600" />
                <h4 className="text-sm font-semibold text-slate-800">Vision — Corrosion Findings</h4>
                <span className="ml-auto text-[10px] bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full font-medium border border-primary-200">
                    {findings.length} finding{findings.length !== 1 ? 's' : ''}
                </span>
            </div>
            <div className="divide-y divide-slate-50">
                {findings.map(f => {
                    const sev = SEVERITY_STYLES[f.max_severity] || SEVERITY_STYLES.minor;
                    return (
                        <div key={f.id} className="px-4 py-3 flex items-start gap-3 hover:bg-slate-50 transition-colors">
                            <div className="mt-0.5">
                                {f.max_severity === 'critical' || f.max_severity === 'severe'
                                    ? <AlertTriangle size={14} className="text-orange-500" />
                                    : <CheckCircle2 size={14} className="text-slate-400" />
                                }
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                    <span className="text-xs font-medium text-slate-700 truncate">{f.image_name}</span>
                                    <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded border ${sev.bg} ${sev.text}`}>
                                        {f.max_severity.toUpperCase()}
                                    </span>
                                </div>
                                <p className="text-[10px] text-slate-400">
                                    {f.detected_items} anomal{f.detected_items === 1 ? 'y' : 'ies'} detected
                                    {!f.reviewed && <span className="ml-2 text-amber-500 font-medium">• Unreviewed</span>}
                                </p>
                                <p className="text-[10px] text-slate-300 mt-0.5">
                                    {new Date(f.timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                </p>
                            </div>
                            {onLinkToCML && (
                                <button
                                    onClick={() => onLinkToCML(f)}
                                    className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-primary-700 bg-primary-50 border border-primary-200 rounded hover:bg-primary-100 transition-colors shrink-0"
                                    title="Link this finding to a Corrosion Monitoring Location"
                                >
                                    <MapPin size={10} />
                                    Link to CML
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
