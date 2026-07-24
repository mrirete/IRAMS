/**
 * RcaChallengerPanel — UI for the RCA Challenger agent.
 *
 * Paste a proposed root cause / 5-Why (and optionally an asset tag); the agent
 * stress-tests it (evidence gaps, logical leaps, alternative hypotheses,
 * verification tests) via the agent-run Edge Function. Advisory only — it
 * creates nothing.
 */
import React, { useState } from 'react';
import { ShieldQuestion, Loader2, AlertTriangle } from 'lucide-react';
import { runRcaChallenger, type AgentRunResponse } from '../../eam/services/agentRunClient';
import { friendlyAIError } from '../../eam/lib/aiError';

interface RcaChallengerPanelProps {
    /** Pre-fill the analysis text (e.g. the current RCA summary). */
    initialText?: string;
    /** Pre-fill the asset tag for evidence-grounded critique. */
    assetTag?: string;
    /** When set, the agent reads the live investigation — cause chain with
     *  evidenced/assumed status, evidence pool with quality grades, citations —
     *  instead of judging pasted text alone. */
    investigationId?: string;
}

export const RcaChallengerPanel: React.FC<RcaChallengerPanelProps> = ({ initialText = '', assetTag, investigationId }) => {
    const [text, setText] = useState(initialText);
    const [tag, setTag] = useState(assetTag || '');
    const [loading, setLoading] = useState(false);
    const [res, setRes] = useState<AgentRunResponse | null>(null);
    const [error, setError] = useState<string | null>(null);

    const run = async () => {
        if (!text.trim()) return;
        setLoading(true); setError(null); setRes(null);
        try {
            const payload = investigationId
                ? `Investigation id: ${investigationId}\n\n${text.trim()}`
                : text.trim();
            setRes(await runRcaChallenger(payload, tag.trim() || undefined));
        } catch (e: any) {
            console.error('[RcaChallenger]', e);
            setError(friendlyAIError(e));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="flex items-center gap-2.5 px-4 sm:px-5 py-3.5 border-b border-slate-100 bg-gradient-to-r from-violet-50 via-white to-white">
                <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-violet-100 text-violet-600 shrink-0"><ShieldQuestion size={16} /></span>
                <div className="min-w-0">
                    <h4 className="text-sm font-bold text-slate-800">RCA Challenger</h4>
                    <p className="text-[11px] text-slate-400 truncate">AI stress-tests a proposed root cause against the evidence</p>
                </div>
            </div>

            <div className="p-4 sm:p-5 space-y-3">
                <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Paste the proposed root cause / 5-Why / problem statement to challenge…"
                    className="w-full min-h-[96px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400 resize-y"
                />
                <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <input
                        value={tag}
                        onChange={(e) => setTag(e.target.value)}
                        placeholder="Asset tag (optional, e.g. P-101)"
                        className="flex-1 min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400"
                    />
                    <button
                        onClick={run}
                        disabled={loading || !text.trim()}
                        className="shrink-0 flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-violet-500 to-violet-600 shadow-sm hover:shadow disabled:opacity-50"
                    >
                        {loading ? <Loader2 size={15} className="animate-spin" /> : <ShieldQuestion size={15} />}
                        {loading ? 'Challenging…' : 'Challenge'}
                    </button>
                </div>

                {error && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                        <AlertTriangle size={15} className="mt-0.5 shrink-0" /><span>{error}</span>
                    </div>
                )}

                {res && (
                    <div className="space-y-2.5 pt-1">
                        <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed border-l-2 border-violet-200 pl-3">{res.answer}</div>
                        <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
                            <span className="px-2 py-0.5 rounded-full bg-slate-100">Tier {res.tier_used} · advisory</span>
                            <span className="px-2 py-0.5 rounded-full bg-slate-100">{res.sources.length} sources</span>
                            <span className="px-2 py-0.5 rounded-full bg-slate-100">{res.tokens_used} tokens · {res.duration_ms} ms</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default RcaChallengerPanel;
