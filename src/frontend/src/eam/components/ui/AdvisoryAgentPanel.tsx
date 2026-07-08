/**
 * AdvisoryAgentPanel — reusable card for Tier-1 (advisory) reliability agents.
 *
 * One "run" button (optionally with a text input), then renders the agent's
 * cited narrative + run metadata. Used by PM Optimizer, Reliability Digest, etc.
 * Agents that produce approvable proposals (e.g. Bad Actor Hunter) use their own
 * bespoke panels instead.
 */
import React, { useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import type { AgentRunResponse } from '../../services/agentRunClient';
import { friendlyAIError } from '../../lib/aiError';

type Accent = 'teal' | 'violet' | 'indigo' | 'amber' | 'blue' | 'emerald';

const ACCENT: Record<Accent, { head: string; icon: string; btn: string; bar: string; ring: string }> = {
    teal:    { head: 'from-primary-50',    icon: 'bg-primary-100 text-primary-600',       btn: 'from-primary-500 to-primary-600',       bar: 'border-primary-200',    ring: 'focus:ring-primary-300 focus:border-primary-400' },
    violet:  { head: 'from-violet-50',  icon: 'bg-violet-100 text-violet-600',   btn: 'from-violet-500 to-violet-600',   bar: 'border-violet-200',  ring: 'focus:ring-violet-300 focus:border-violet-400' },
    indigo:  { head: 'from-indigo-50',  icon: 'bg-indigo-100 text-indigo-600',   btn: 'from-indigo-500 to-indigo-600',   bar: 'border-indigo-200',  ring: 'focus:ring-indigo-300 focus:border-indigo-400' },
    amber:   { head: 'from-amber-50',   icon: 'bg-amber-100 text-amber-600',     btn: 'from-amber-500 to-amber-600',     bar: 'border-amber-200',   ring: 'focus:ring-amber-300 focus:border-amber-400' },
    blue:    { head: 'from-blue-50',    icon: 'bg-blue-100 text-blue-600',       btn: 'from-blue-500 to-blue-600',       bar: 'border-blue-200',    ring: 'focus:ring-blue-300 focus:border-blue-400' },
    emerald: { head: 'from-emerald-50', icon: 'bg-emerald-100 text-emerald-600', btn: 'from-emerald-500 to-emerald-600', bar: 'border-emerald-200', ring: 'focus:ring-emerald-300 focus:border-emerald-400' },
};

export interface AdvisoryAgentPanelProps {
    title: string;
    subtitle: string;
    icon: React.ReactNode;
    accent: Accent;
    runLabel: string;
    onRun: (input: string) => Promise<AgentRunResponse>;
    /** If set, show a text input whose value is passed to onRun. */
    inputPlaceholder?: string;
}

export const AdvisoryAgentPanel: React.FC<AdvisoryAgentPanelProps> = ({
    title, subtitle, icon, accent, runLabel, onRun, inputPlaceholder,
}) => {
    const a = ACCENT[accent];
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [res, setRes] = useState<AgentRunResponse | null>(null);
    const [error, setError] = useState<string | null>(null);

    const run = async () => {
        setLoading(true); setError(null); setRes(null);
        try {
            setRes(await onRun(input.trim()));
        } catch (e: any) {
            console.error('[AgentPanel]', e);
            setError(friendlyAIError(e));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-slate-100 bg-gradient-to-r ${a.head} via-white to-white`}>
                <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`flex items-center justify-center w-8 h-8 rounded-lg shrink-0 ${a.icon}`}>{icon}</span>
                    <div className="min-w-0">
                        <h4 className="text-sm font-bold text-slate-800">{title}</h4>
                        <p className="text-[11px] text-slate-400 truncate">{subtitle}</p>
                    </div>
                </div>
                <div className="flex gap-2 sm:items-center shrink-0">
                    {inputPlaceholder && (
                        <input
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder={inputPlaceholder}
                            className={`flex-1 sm:w-44 min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 ${a.ring}`}
                        />
                    )}
                    <button
                        onClick={run}
                        disabled={loading}
                        className={`shrink-0 flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-r ${a.btn} shadow-sm hover:shadow disabled:opacity-60`}
                    >
                        {loading ? <Loader2 size={15} className="animate-spin" /> : null}
                        <span className={inputPlaceholder ? 'hidden sm:inline' : ''}>{loading ? 'Working…' : runLabel}</span>
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
                    <p className="text-sm text-slate-400">{subtitle}.</p>
                )}
                {res && (
                    <>
                        <div className={`text-sm text-slate-700 whitespace-pre-wrap leading-relaxed border-l-2 ${a.bar} pl-3`}>{res.answer}</div>
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

export default AdvisoryAgentPanel;
