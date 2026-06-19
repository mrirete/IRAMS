/**
 * BadActorHunterPanel — UI for the Phase-0 flagship reliability agent.
 *
 * Runs the Bad Actor Hunter via the `agent-run` Edge Function, shows its cited
 * narrative, and renders its drafted Defect-Elimination tasks as review cards.
 * Approving a card creates a real DE task through the normal create path
 * (human-in-the-loop — the agent never writes on its own).
 */
import React, { useState } from 'react';
import { Sparkles, Loader2, CheckCircle2, X, AlertTriangle } from 'lucide-react';
import { runBadActorHunter, type AgentRunResponse, type AgentProposal } from '../../eam/services/agentRunClient';
import type { DefectEliminationTask } from './DefectEliminationPanel';

interface BadActorHunterPanelProps {
    onApprove: (task: Omit<DefectEliminationTask, 'id' | 'createdAt'>) => void;
}

function proposalToTask(p: AgentProposal): Omit<DefectEliminationTask, 'id' | 'createdAt'> {
    const d = p.draft_payload as Record<string, any>;
    return {
        assetId: d.asset_id ?? '',
        assetName: d.asset_name ?? 'Unknown asset',
        title: d.title ?? 'Defect elimination',
        status: d.status ?? 'identified',
        priority: d.priority ?? 'medium',
        annualCost: Number(d.annual_cost) || 0,
        estimatedSavings: Number(d.estimated_savings) || 0,
        implementationCost: Number(d.implementation_cost) || 0,
        paybackMonths: Number(d.payback_months) || 0,
        rootCauseSummary: d.root_cause_summary ?? '',
        proposedSolution: d.proposed_solution ?? '',
    };
}

function priorityCls(p: string): string {
    switch (p) {
        case 'critical': return 'bg-red-100 text-red-700';
        case 'high': return 'bg-orange-100 text-orange-700';
        case 'low': return 'bg-slate-100 text-slate-500';
        default: return 'bg-amber-100 text-amber-700';
    }
}

export const BadActorHunterPanel: React.FC<BadActorHunterPanelProps> = ({ onApprove }) => {
    const [loading, setLoading] = useState(false);
    const [res, setRes] = useState<AgentRunResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [approved, setApproved] = useState<Set<number>>(new Set());
    const [dismissed, setDismissed] = useState<Set<number>>(new Set());

    const run = async () => {
        setLoading(true); setError(null); setRes(null);
        setApproved(new Set()); setDismissed(new Set());
        try {
            setRes(await runBadActorHunter());
        } catch (e: any) {
            setError(e?.message || 'Failed to run the agent. Is the agent-run function deployed and GEMINI_API_KEY set?');
        } finally {
            setLoading(false);
        }
    };

    const approve = (i: number, p: AgentProposal) => {
        onApprove(proposalToTask(p));
        setApproved(prev => new Set(prev).add(i));
    };

    return (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-slate-100 bg-gradient-to-r from-amber-50 via-white to-white">
                <div className="flex items-center gap-2.5 min-w-0">
                    <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber-100 text-amber-600 shrink-0"><Sparkles size={16} /></span>
                    <div className="min-w-0">
                        <h4 className="text-sm font-bold text-slate-800">Bad Actor Hunter</h4>
                        <p className="text-[11px] text-slate-400 truncate">AI ranks your worst assets &amp; drafts elimination tasks</p>
                    </div>
                </div>
                <button
                    onClick={run}
                    disabled={loading}
                    className="shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-amber-500 to-amber-600 shadow-sm hover:shadow disabled:opacity-60"
                >
                    {loading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                    <span className="hidden sm:inline">{loading ? 'Analysing…' : 'Run Hunter'}</span>
                </button>
            </div>

            <div className="p-4 sm:p-5 space-y-4">
                {error && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                        <AlertTriangle size={15} className="mt-0.5 shrink-0" /><span>{error}</span>
                    </div>
                )}
                {!res && !error && !loading && (
                    <p className="text-sm text-slate-400">
                        Run the Hunter to rank maintenance bad actors over the last 12 months (by work-order cost) and
                        get drafted defect-elimination tasks to review and approve.
                    </p>
                )}

                {res && (
                    <>
                        <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{res.answer}</div>

                        <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
                            <span className="px-2 py-0.5 rounded-full bg-slate-100">Tier {res.tier_used} · human-approved</span>
                            <span className="px-2 py-0.5 rounded-full bg-slate-100">{res.sources.length} sources</span>
                            <span className="px-2 py-0.5 rounded-full bg-slate-100">{res.tokens_used} tokens · {res.duration_ms} ms</span>
                        </div>

                        {res.proposals.length > 0 && (
                            <div className="space-y-2.5">
                                <h5 className="text-xs font-bold text-slate-500 uppercase tracking-wide">Drafted DE tasks — review &amp; approve</h5>
                                {res.proposals.map((p, i) => {
                                    if (dismissed.has(i)) return null;
                                    const d = p.draft_payload as Record<string, any>;
                                    const isApproved = approved.has(i);
                                    return (
                                        <div key={i} className="rounded-xl border border-slate-200 p-3.5">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="text-sm font-semibold text-slate-800">{d.title}</span>
                                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${priorityCls(String(d.priority))}`}>{d.priority}</span>
                                                    </div>
                                                    <p className="text-[11px] text-slate-400 mt-0.5">{d.asset_name}</p>
                                                </div>
                                                {!isApproved ? (
                                                    <div className="flex items-center gap-1.5 shrink-0">
                                                        <button onClick={() => approve(i, p)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700"><CheckCircle2 size={13} /> Approve</button>
                                                        <button onClick={() => setDismissed(prev => new Set(prev).add(i))} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><X size={15} /></button>
                                                    </div>
                                                ) : (
                                                    <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600 shrink-0"><CheckCircle2 size={14} /> Created</span>
                                                )}
                                            </div>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 mt-2.5 text-[11px]">
                                                {d.root_cause_summary && <div><span className="text-slate-400">Root cause: </span><span className="text-slate-600">{d.root_cause_summary}</span></div>}
                                                {d.proposed_solution && <div><span className="text-slate-400">Solution: </span><span className="text-slate-600">{d.proposed_solution}</span></div>}
                                            </div>
                                            {(Number(d.annual_cost) > 0 || Number(d.estimated_savings) > 0) && (
                                                <div className="flex flex-wrap gap-3 mt-2 text-[11px] text-slate-500">
                                                    {Number(d.annual_cost) > 0 && <span>Annual cost: <strong>${Number(d.annual_cost).toLocaleString()}</strong></span>}
                                                    {Number(d.estimated_savings) > 0 && <span>Est. savings: <strong className="text-emerald-600">${Number(d.estimated_savings).toLocaleString()}</strong></span>}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default BadActorHunterPanel;
