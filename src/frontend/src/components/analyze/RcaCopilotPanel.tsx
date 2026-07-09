/**
 * RcaCopilotPanel — the agentic heart of the Analyze module.
 *
 * A multi-turn AI facilitator embedded in a live RCA investigation. It grounds
 * itself in the investigation + asset health + failure history (server-side
 * tools), converses with the team — asking one focused question at a time —
 * and drives the cause chain past physical symptoms to latent/systemic causes.
 *
 * Governance: the agent is Tier-1 advisory. Its concrete suggestions arrive as
 * structured ```rca-proposal``` blocks rendered as cards; ONLY a human Apply
 * click writes them to the investigation (via analyzeService, under RLS).
 */
import React, { useState, useRef, useEffect } from 'react';
import { Bot, Send, Loader2, AlertTriangle, Check, Plus, X, Sparkles } from 'lucide-react';
import { runRcaCopilot, type AgentTurn } from '../../eam/services/agentRunClient';
import { friendlyAIError } from '../../eam/lib/aiError';
import { analyzeService, type RCAInvestigation, type RCANode } from '../../eam/services/AnalyzeService';

// ── Proposal shapes the agent may emit ─────────────────────────
interface WhyChainProposal {
    type: 'why_chain';
    nodes: { description: string; category: 'physical' | 'human' | 'latent'; is_root_cause?: boolean }[];
}
interface ActionsProposal {
    type: 'corrective_actions';
    actions: { description: string; cause_category: 'physical' | 'human' | 'latent'; action_type: 'immediate' | 'short_term' | 'long_term' }[];
}
interface ProblemProposal { type: 'problem_statement'; text: string; }
type Proposal = WhyChainProposal | ActionsProposal | ProblemProposal;

interface ChatMsg {
    role: 'user' | 'model';
    text: string;           // prose with the proposal block stripped
    proposal?: Proposal;
    applied?: boolean;
    sources?: number;
}

/** Split a model answer into prose + (optionally) one rca-proposal block. */
function parseAnswer(raw: string): { text: string; proposal?: Proposal } {
    const m = raw.match(/```rca-proposal\s*([\s\S]*?)```/);
    if (!m) return { text: raw.trim() };
    let proposal: Proposal | undefined;
    try {
        const p = JSON.parse(m[1].trim());
        if (p && (p.type === 'why_chain' || p.type === 'corrective_actions' || p.type === 'problem_statement')) {
            proposal = p as Proposal;
        }
    } catch { /* malformed block — show prose only */ }
    return { text: raw.replace(m[0], '').trim(), proposal };
}

interface Props {
    inv: RCAInvestigation;
    nodes: RCANode[];
    /** Called after any Apply writes, so the page refetches its state. */
    onApplied: () => void;
    onClose: () => void;
}

const CAT_STYLE: Record<string, string> = {
    physical: 'bg-red-50 border-red-200 text-red-700',
    human: 'bg-amber-50 border-amber-200 text-amber-700',
    latent: 'bg-primary-50 border-primary-200 text-primary-700',
};

export const RcaCopilotPanel: React.FC<Props> = ({ inv, nodes, onApplied, onClose }) => {
    const [msgs, setMsgs] = useState<ChatMsg[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [applying, setApplying] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const startedRef = useRef(false);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [msgs, loading]);

    const send = async (text: string) => {
        if (!text.trim() || loading) return;
        setError(null);
        const history: AgentTurn[] = msgs.map(m => ({ role: m.role, text: m.text }));
        setMsgs(prev => [...prev, { role: 'user', text: text.trim() }]);
        setInput('');
        setLoading(true);
        try {
            const res = await runRcaCopilot(inv.id, text.trim(), history);
            const { text: prose, proposal } = parseAnswer(res.answer || '');
            setMsgs(prev => [...prev, { role: 'model', text: prose, proposal, sources: res.sources?.length || 0 }]);
        } catch (e) {
            console.error('[RcaCopilot]', e);
            setError(friendlyAIError(e));
        } finally {
            setLoading(false);
        }
    };

    // Kick off the session automatically: the copilot grounds itself and opens.
    useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        send('Start the session: review this investigation and the asset’s history, brief the team on where the investigation stands, and ask your first question.');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Apply handlers (the ONLY writes — human-initiated) ─────
    const applyProposal = async (msgIdx: number, p: Proposal) => {
        setApplying(true);
        try {
            if (p.type === 'problem_statement') {
                await analyzeService.updateRCAInvestigation(inv.id, { problem_statement: p.text } as any);
            } else if (p.type === 'why_chain') {
                // Chain under the problem node (create it if the tree is empty).
                let parentId: string | null = null;
                let depth = 1;
                const problem = nodes.find(n => n.node_type === 'problem');
                if (problem) {
                    parentId = problem.id;
                } else {
                    const created = await analyzeService.createRCANode({
                        investigation_id: inv.id, parent_id: null, node_type: 'problem',
                        description: inv.problem_statement || inv.title || 'Problem',
                        depth: 0, is_root_cause: false,
                        cause_category: null as any, cause_code: null, evidence_notes: null,
                    });
                    parentId = created?.id ?? null;
                }
                for (const n of p.nodes) {
                    const created = await analyzeService.createRCANode({
                        investigation_id: inv.id, parent_id: parentId,
                        node_type: n.is_root_cause ? 'root_cause' : 'why',
                        description: n.description, depth,
                        is_root_cause: !!n.is_root_cause,
                        cause_category: (n.category || null) as any,
                        cause_code: null, evidence_notes: null,
                    });
                    parentId = created?.id ?? parentId;
                    depth++;
                }
            } else if (p.type === 'corrective_actions') {
                for (const a of p.actions) {
                    await analyzeService.addRCACorrectiveAction({
                        investigation_id: inv.id, cause_node_id: null,
                        cause_category: (a.cause_category || 'latent') as any,
                        action_description: a.description,
                        action_type: (a.action_type || 'short_term') as any,
                        assigned_to: null, due_date: null, status: 'open',
                        requires_moc: false, completion_date: null,
                        completion_notes: null, risk_of_not_acting: null,
                        work_order_id: null,
                    });
                }
            }
            setMsgs(prev => prev.map((m, i) => i === msgIdx ? { ...m, applied: true } : m));
            onApplied();
        } catch (e) {
            console.error('[RcaCopilot] apply failed', e);
            setError('Could not apply the proposal — check the console and retry.');
        } finally {
            setApplying(false);
        }
    };

    const renderProposal = (m: ChatMsg, idx: number) => {
        if (!m.proposal) return null;
        const p = m.proposal;
        return (
            <div className="mt-2 border border-primary-200 bg-primary-50/40 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-primary-500 flex items-center gap-1">
                        <Sparkles size={11} />
                        {p.type === 'why_chain' ? 'Proposed cause chain' : p.type === 'corrective_actions' ? 'Proposed corrective actions' : 'Proposed problem statement'}
                    </span>
                    {m.applied ? (
                        <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-1"><Check size={11} /> Applied</span>
                    ) : (
                        <button
                            onClick={() => applyProposal(idx, p)}
                            disabled={applying}
                            className="px-2.5 py-1 text-[10px] font-extrabold rounded-md bg-primary-600 text-white hover:bg-primary-500 disabled:opacity-60 flex items-center gap-1"
                        >
                            {applying ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />} Apply to investigation
                        </button>
                    )}
                </div>
                {p.type === 'why_chain' && (
                    <ol className="space-y-1">
                        {p.nodes.map((n, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-slate-700">
                                <span className={`shrink-0 text-[9px] font-extrabold px-1.5 py-0.5 rounded border uppercase ${CAT_STYLE[n.category] || 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                                    {n.category}
                                </span>
                                <span>{n.description}{n.is_root_cause && <strong className="text-primary-700"> ← root cause</strong>}</span>
                            </li>
                        ))}
                    </ol>
                )}
                {p.type === 'corrective_actions' && (
                    <ul className="space-y-1">
                        {p.actions.map((a, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-slate-700">
                                <span className={`shrink-0 text-[9px] font-extrabold px-1.5 py-0.5 rounded border uppercase ${CAT_STYLE[a.cause_category] || 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                                    {a.action_type?.replace('_', '-')}
                                </span>
                                <span>{a.description}</span>
                            </li>
                        ))}
                    </ul>
                )}
                {p.type === 'problem_statement' && (
                    <p className="text-xs text-slate-700 italic">“{p.text}”</p>
                )}
            </div>
        );
    };

    return (
        <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[440px] bg-white border-l border-slate-200 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-primary-50 via-white to-white shrink-0">
                <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary-100 text-primary-600 shrink-0"><Bot size={16} /></span>
                <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-bold text-slate-800">Reliability Specialist</h4>
                    <p className="text-[10px] text-slate-400 truncate">Facilitating “{inv.title}” · advisory only — you approve every change</p>
                </div>
                <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1"><X size={16} /></button>
            </div>

            {/* Conversation */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                {msgs.map((m, i) => (
                    <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                        <div className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                            m.role === 'user'
                                ? 'bg-primary-600 text-white rounded-br-sm'
                                : 'bg-slate-50 border border-slate-200 text-slate-800 rounded-bl-sm'
                        }`}>
                            {m.text}
                            {m.role === 'model' && renderProposal(m, i)}
                            {m.role === 'model' && (m.sources ?? 0) > 0 && (
                                <div className="mt-1.5 text-[9px] text-slate-400">{m.sources} data source{(m.sources ?? 0) > 1 ? 's' : ''} consulted</div>
                            )}
                        </div>
                    </div>
                ))}
                {loading && (
                    <div className="flex items-center gap-2 text-xs text-primary-500 font-semibold px-1">
                        <Loader2 size={13} className="animate-spin" /> analyzing…
                    </div>
                )}
                {error && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                        <AlertTriangle size={13} className="mt-0.5 shrink-0" /><span>{error}</span>
                    </div>
                )}
            </div>

            {/* Composer */}
            <div className="border-t border-slate-100 p-3 shrink-0">
                <div className="flex gap-2">
                    <textarea
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
                        placeholder="Answer the copilot, add observations, or ask it anything…"
                        rows={2}
                        className="flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-400"
                    />
                    <button
                        onClick={() => send(input)}
                        disabled={loading || !input.trim()}
                        className="shrink-0 self-end flex items-center justify-center w-10 h-10 rounded-xl bg-primary-600 text-white hover:bg-primary-500 disabled:opacity-50"
                    >
                        <Send size={15} />
                    </button>
                </div>
                <p className="text-[9px] text-slate-300 mt-1.5 text-center">Answers are grounded in your data · proposals only change the investigation when you Apply them</p>
            </div>
        </div>
    );
};

export default RcaCopilotPanel;
