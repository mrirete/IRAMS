/**
 * CorrosionSentinelPanel — UI for the Corrosion Sentinel agent.
 *
 * Scans thickness readings (API 510/570/653) and reports CMLs at risk —
 * near end-of-life, below t-min, or with accelerating corrosion — with
 * recommended inspections. Advisory only; it creates nothing.
 */
import React, { useState } from 'react';
import { Radar, Loader2, AlertTriangle } from 'lucide-react';
import { runCorrosionSentinel, type AgentRunResponse } from '../../eam/services/agentRunClient';

interface CorrosionSentinelPanelProps {
    /** Pre-fill an asset tag to scope the scan. */
    assetTag?: string;
}

export const CorrosionSentinelPanel: React.FC<CorrosionSentinelPanelProps> = ({ assetTag }) => {
    const [tag, setTag] = useState(assetTag || '');
    const [loading, setLoading] = useState(false);
    const [res, setRes] = useState<AgentRunResponse | null>(null);
    const [error, setError] = useState<string | null>(null);

    const run = async () => {
        setLoading(true); setError(null); setRes(null);
        try {
            setRes(await runCorrosionSentinel(tag.trim() || undefined));
        } catch (e: any) {
            setError(e?.message || 'Failed to run the agent. Is agent-run deployed and GEMINI_API_KEY set?');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-slate-100 bg-gradient-to-r from-teal-50 via-white to-white">
                <div className="flex items-center gap-2.5 min-w-0">
                    <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-teal-100 text-teal-600 shrink-0"><Radar size={16} /></span>
                    <div className="min-w-0">
                        <h4 className="text-sm font-bold text-slate-800">Corrosion Sentinel</h4>
                        <p className="text-[11px] text-slate-400 truncate">AI flags CMLs near end-of-life from thickness data · API 510/570/653</p>
                    </div>
                </div>
                <div className="flex gap-2 sm:items-center shrink-0">
                    <input
                        value={tag}
                        onChange={(e) => setTag(e.target.value)}
                        placeholder="Asset tag (optional)"
                        className="flex-1 sm:w-40 min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-300 focus:border-teal-400"
                    />
                    <button
                        onClick={run}
                        disabled={loading}
                        className="shrink-0 flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-teal-500 to-teal-600 shadow-sm hover:shadow disabled:opacity-60"
                    >
                        {loading ? <Loader2 size={15} className="animate-spin" /> : <Radar size={15} />}
                        <span className="hidden sm:inline">{loading ? 'Scanning…' : 'Scan'}</span>
                    </button>
                </div>
            </div>

            <div className="p-4 sm:p-5 space-y-3">
                {error && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                        <AlertTriangle size={15} className="mt-0.5 shrink-0" /><span>{error}</span>
                    </div>
                )}
                {!res && !error && !loading && (
                    <p className="text-sm text-slate-400">
                        Scan to assess corrosion rate &amp; remaining life per CML and surface the equipment nearest its
                        minimum allowable thickness, with recommended inspection dates.
                    </p>
                )}
                {res && (
                    <>
                        <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed border-l-2 border-teal-200 pl-3">{res.answer}</div>
                        <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
                            <span className="px-2 py-0.5 rounded-full bg-slate-100">Tier {res.tier_used} · advisory</span>
                            <span className="px-2 py-0.5 rounded-full bg-slate-100">{res.sources.length} sources</span>
                            <span className="px-2 py-0.5 rounded-full bg-slate-100">{res.tokens_used} tokens · {res.duration_ms} ms</span>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default CorrosionSentinelPanel;
