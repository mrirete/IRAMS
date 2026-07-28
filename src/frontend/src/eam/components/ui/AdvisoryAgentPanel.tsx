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
import SpecialistProse from '../../../components/specialist/SpecialistProse';

type Accent = 'primary' | 'teal' | 'violet' | 'indigo' | 'amber' | 'blue' | 'emerald';

/**
 * Accents tint the icon chip and the quote bar only — the run button is flat in
 * every variant. Gradient buttons were the loudest thing on these panels and
 * read as marketing chrome next to real analysis output.
 *
 * Every cool accent (teal / violet / indigo / blue) now resolves to the one
 * primary ramp: an agent panel is an agent panel, and giving each its own hue
 * made the app look assembled from four different products. Only amber and
 * emerald stay distinct, because there they carry meaning — caution and money.
 * The names survive so existing callers keep compiling.
 */
const PRIMARY = {
    icon: 'bg-primary-50 text-primary-600',
    btn: 'bg-primary-600 hover:bg-primary-700 active:bg-primary-800',
    bar: 'border-primary-300',
    ring: 'focus:ring-primary-500/15 focus:border-primary-500',
};
const ACCENT: Record<Accent, { icon: string; btn: string; bar: string; ring: string }> = {
    primary: PRIMARY,
    teal:    PRIMARY,
    violet:  PRIMARY,
    indigo:  PRIMARY,
    blue:    PRIMARY,
    amber:   { icon: 'bg-amber-50 text-amber-600',      btn: 'bg-amber-600 hover:bg-amber-700',     bar: 'border-amber-300',   ring: 'focus:ring-amber-500/15 focus:border-amber-500' },
    emerald: { icon: 'bg-emerald-50 text-emerald-600',  btn: 'bg-emerald-600 hover:bg-emerald-700', bar: 'border-emerald-300', ring: 'focus:ring-emerald-500/15 focus:border-emerald-500' },
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
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-slate-100">
                <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`flex items-center justify-center w-8 h-8 rounded-lg shrink-0 ${a.icon}`}>{icon}</span>
                    <div className="min-w-0">
                        <h4 className="text-[13px] font-semibold text-slate-900">{title}</h4>
                        <p className="text-[11px] text-slate-400 truncate">{subtitle}</p>
                    </div>
                </div>
                <div className="flex gap-2 sm:items-center shrink-0">
                    {inputPlaceholder && (
                        <input
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && !loading) void run(); }}
                            placeholder={inputPlaceholder}
                            className={`flex-1 sm:w-44 h-10 sm:h-9 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 ${a.ring}`}
                        />
                    )}
                    <button
                        onClick={run}
                        disabled={loading}
                        className={`shrink-0 inline-flex items-center justify-center gap-1.5 px-3.5 h-10 sm:h-9 rounded-lg text-[13px] font-semibold text-white transition-colors ${a.btn} disabled:opacity-50 disabled:pointer-events-none`}
                    >
                        {loading ? <Loader2 size={14} className="animate-spin" /> : null}
                        <span>{loading ? 'Working…' : runLabel}</span>
                    </button>
                </div>
            </div>

            <div className="p-4 sm:p-5 space-y-3">
                {error && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-[13px] text-red-700">
                        <AlertTriangle size={15} className="mt-0.5 shrink-0" /><span>{error}</span>
                    </div>
                )}
                {!res && !error && !loading && (
                    <p className="text-[12.5px] text-slate-400">{subtitle}. Results appear here; anything approvable is drafted into the proposals queue.</p>
                )}
                {res && (
                    <>
                        <div className={`text-[13.5px] text-slate-700 leading-[1.7] border-l-2 ${a.bar} pl-3`}>
                            <SpecialistProse text={res.answer} />
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
                            <span className="px-2 py-0.5 rounded bg-slate-100 font-medium">Tier {res.tier_used} · advisory</span>
                            <span className="px-2 py-0.5 rounded bg-slate-100 font-medium">{res.sources.length} sources</span>
                            <span className="px-2 py-0.5 rounded bg-slate-100 font-medium tabular-nums">{res.tokens_used} tokens · {res.duration_ms} ms</span>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default AdvisoryAgentPanel;
