/**
 * SpecialistWorkspacePage — the Specialist's desk (Specialist Phase 1,
 * strategy §5.2: identity + briefing + proposals queue + conversation +
 * work log, consolidating the previously scattered agent panels).
 *
 * Reads: ers_ai_audit_log (admin SELECT, 0219) for the last briefing + work
 * log; ers_agent_actions for pending proposals. Writes: none except a human
 * dismissing a proposal — every apply stays in its owning module.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Sparkles, Send, Loader2, ClipboardList, ScrollText, UploadCloud,
    BarChart2, RefreshCw, ChevronRight, X, BrainCircuit, Activity, BadgeDollarSign,
} from 'lucide-react';
import { supabase } from '../../eam/lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useSettings } from '../../contexts/SettingsContext';
import AdvisoryAgentPanel from '../../eam/components/ui/AdvisoryAgentPanel';
import { runSpecialist, runReliabilityDigest, runWeibullAnalyst, type AgentTurn } from '../../eam/services/agentRunClient';
import { predictionService, type AgentAction } from '../../eam/services/PredictionService';

interface AuditRow {
    id: string; module: string; context_type: string; query_text: string;
    response_text: string; created_at: string; duration_ms: number | null;
}

/** Where a proposal type gets applied — the workspace links, never applies. */
const PROPOSAL_HOMES: Record<string, { label: string; path: string }> = {
    bad_actor_hunter: { label: 'Defect Elimination', path: '/analyze' },
    threshold_adapter: { label: 'Predict — Agent Review', path: '/predict' },
    alert_to_wo: { label: 'Predict — Agent Review', path: '/predict' },
};

export const SpecialistWorkspacePage: React.FC = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { formatCurrency } = useSettings();

    // ── briefing ──
    const [briefing, setBriefing] = useState<AuditRow | null>(null);
    const [briefingLive, setBriefingLive] = useState<string | null>(null);
    const [running, setRunning] = useState(false);

    // ── proposals ──
    const [proposals, setProposals] = useState<AgentAction[]>([]);
    const [dismissing, setDismissing] = useState<string | null>(null);

    // ── work log ──
    const [log, setLog] = useState<AuditRow[]>([]);

    // ── value ledger (v1: proposal-based) ──
    const [ledger, setLedger] = useState<{ approved: number; pending: number; valueIdentified: number } | null>(null);

    // ── chat ──
    const [msgs, setMsgs] = useState<AgentTurn[]>([]);
    const [input, setInput] = useState('');
    const [chatBusy, setChatBusy] = useState(false);
    const chatRef = useRef<HTMLDivElement>(null);

    const loadAll = async () => {
        const [logQ, actionsQ] = await Promise.all([
            supabase.from('ers_ai_audit_log')
                .select('id, module, context_type, query_text, response_text, created_at, duration_ms')
                .eq('action_type', 'agent_run')
                .order('created_at', { ascending: false })
                .limit(15),
            predictionService.getAgentActions(),
        ]);
        const rows = (logQ.data ?? []) as AuditRow[];
        setLog(rows);
        setBriefing(rows.find((r) => r.context_type === 'reliability_digest') ?? null);
        setProposals(actionsQ.filter((a) => a.status === 'pending_review'));

        // Value ledger v1: what the Specialist's proposals identified in money.
        // estimated_savings (DE tasks) preferred; annual_cost as the stake proxy.
        const draftValue = (a: AgentAction): number => {
            const p = (a.draft_payload ?? {}) as Record<string, unknown>;
            return Number(p.estimated_savings) || Number(p.annual_cost) || 0;
        };
        setLedger({
            approved: actionsQ.filter((a) => a.status === 'approved').length,
            pending: actionsQ.filter((a) => a.status === 'pending_review').length,
            valueIdentified: actionsQ
                .filter((a) => a.status === 'approved' || a.status === 'pending_review')
                .reduce((s, a) => s + draftValue(a), 0),
        });
    };
    useEffect(() => { void loadAll(); }, []);

    const runBriefing = async () => {
        setRunning(true);
        try {
            const res = await runReliabilityDigest();
            setBriefingLive(res.answer);
            void loadAll();
        } catch (e) {
            setBriefingLive(`The briefing could not be produced right now (${e instanceof Error ? e.message : 'error'}).`);
        } finally {
            setRunning(false);
        }
    };

    const send = async () => {
        const text = input.trim();
        if (!text || chatBusy) return;
        setInput('');
        const history = [...msgs];
        setMsgs((m) => [...m, { role: 'user', text }]);
        setChatBusy(true);
        try {
            const res = await runSpecialist(text, history);
            setMsgs((m) => [...m, { role: 'model', text: res.answer }]);
        } catch (e) {
            setMsgs((m) => [...m, { role: 'model', text: `I hit an error: ${e instanceof Error ? e.message : String(e)}` }]);
        } finally {
            setChatBusy(false);
            setTimeout(() => chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' }), 50);
        }
    };

    const dismiss = async (id: string) => {
        setDismissing(id);
        try {
            await predictionService.updateAgentActionStatus(id, 'rejected', user?.username || user?.id || 'workspace', 'Dismissed from Specialist workspace');
            setProposals((p) => p.filter((x) => x.id !== id));
        } finally {
            setDismissing(null);
        }
    };

    const briefingText = briefingLive ?? briefing?.response_text ?? null;
    const briefingWhen = briefingLive ? 'just now' : briefing ? new Date(briefing.created_at).toLocaleString() : null;

    return (
        <div className="max-w-6xl mx-auto space-y-5 pb-24 animate-in fade-in duration-300">
            {/* ── Identity header ── */}
            <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-600 to-indigo-700 text-white p-6 flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-white/15 border border-white/25 flex items-center justify-center shrink-0">
                    <BrainCircuit size={28} />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-violet-200 text-[11px] font-bold uppercase tracking-widest">IRAMS · by Relantern</p>
                    <h1 className="text-xl md:text-2xl font-bold">Your Reliability Specialist</h1>
                    <p className="text-violet-100 text-xs md:text-sm mt-0.5">
                        Reads your maintenance history · runs the engineering analyses · drafts the work — you approve everything.
                    </p>
                </div>
                <div className="hidden md:flex flex-col gap-2">
                    <button onClick={() => navigate('/specialist/import')}
                        className="flex items-center gap-1.5 rounded-lg bg-white/15 hover:bg-white/25 border border-white/25 text-xs font-semibold px-3 py-2">
                        <UploadCloud size={13} /> Import CMMS data
                    </button>
                    <button onClick={() => navigate('/specialist/assessment')}
                        className="flex items-center gap-1.5 rounded-lg bg-white text-violet-700 hover:bg-violet-50 text-xs font-bold px-3 py-2">
                        <BarChart2 size={13} /> Run assessment
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* ── Left: briefing + proposals ── */}
                <div className="lg:col-span-2 space-y-5">
                    <section className="rounded-2xl border border-slate-200 bg-white p-5">
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                                <Sparkles size={15} className="text-violet-600" /> Briefing
                                {briefingWhen && <span className="text-[11px] font-normal text-slate-400">· {briefingWhen}</span>}
                            </h2>
                            <button onClick={() => void runBriefing()} disabled={running}
                                className="flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold px-3 py-1.5 disabled:opacity-50">
                                {running ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                                {briefingText ? 'Fresh briefing' : 'First briefing'}
                            </button>
                        </div>
                        {briefingText
                            ? <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">{briefingText}</div>
                            : <p className="text-sm text-slate-400 italic">
                                No briefing yet. Run the first one — the Specialist will review the backlog, bad actors and integrity risk and report back with citations.
                            </p>}
                    </section>

                    <section className="rounded-2xl border border-slate-200 bg-white p-5">
                        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800 mb-3">
                            <ClipboardList size={15} className="text-amber-500" /> Proposals awaiting your review
                            {proposals.length > 0 && <span className="text-[10px] font-bold bg-amber-100 text-amber-700 rounded-full px-1.5 py-0.5">{proposals.length}</span>}
                        </h2>
                        {proposals.length === 0
                            ? <p className="text-sm text-slate-400 italic">Nothing pending. Proposals drafted by any agent land here for a human decision.</p>
                            : <div className="divide-y divide-slate-100">
                                {proposals.map((p) => {
                                    const payload = (p.draft_payload ?? {}) as Record<string, unknown>;
                                    const title = String(payload.title ?? payload.action ?? p.action_type ?? 'Proposal');
                                    const home = PROPOSAL_HOMES[String(p.agent_type)] ?? { label: 'owning module', path: '/' };
                                    return (
                                        <div key={p.id} className="py-3 flex items-center gap-3">
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-medium text-slate-700 truncate">{title}</div>
                                                <div className="text-[11px] text-slate-400">
                                                    {String(p.agent_type).replaceAll('_', ' ')} · {new Date(p.created_at).toLocaleDateString()}
                                                </div>
                                            </div>
                                            <button onClick={() => navigate(home.path)}
                                                className="flex items-center gap-1 text-xs font-medium text-violet-600 hover:text-violet-800">
                                                Review in {home.label} <ChevronRight size={13} />
                                            </button>
                                            <button onClick={() => void dismiss(p.id)} disabled={dismissing === p.id}
                                                title="Dismiss proposal" className="text-slate-300 hover:text-rose-500 disabled:opacity-50">
                                                {dismissing === p.id ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>}
                    </section>

                    {/* Weibull Analyst — Tier-2: proposals it drafts land in the queue above */}
                    <AdvisoryAgentPanel
                        title="Weibull Analyst"
                        subtitle="Censored Weibull fit + statistically defensible PM basis for one asset — drafts land in the proposals queue"
                        icon={<Activity size={16} />}
                        accent="violet"
                        runLabel="Analyse asset"
                        inputPlaceholder="Asset tag, e.g. P-101"
                        onRun={(input) => runWeibullAnalyst(input.trim())}
                    />
                </div>

                {/* ── Right: ledger + chat + work log ── */}
                <div className="space-y-5">
                    {/* Value ledger v1 — the Specialist's running performance review */}
                    <section className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4">
                        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800 mb-2">
                            <BadgeDollarSign size={15} className="text-emerald-600" /> Value ledger
                        </h2>
                        <div className="grid grid-cols-3 gap-2 text-center">
                            <div>
                                <div className="text-lg font-bold text-emerald-700">{ledger ? formatCurrency(ledger.valueIdentified) : '—'}</div>
                                <div className="text-[10px] text-slate-500">value identified</div>
                            </div>
                            <div>
                                <div className="text-lg font-bold text-slate-700">{ledger?.approved ?? '—'}</div>
                                <div className="text-[10px] text-slate-500">proposals approved</div>
                            </div>
                            <div>
                                <div className="text-lg font-bold text-slate-700">{ledger?.pending ?? '—'}</div>
                                <div className="text-[10px] text-slate-500">awaiting review</div>
                            </div>
                        </div>
                        <button onClick={() => navigate('/specialist/assessment')}
                            className="mt-3 w-full text-center text-[11px] font-semibold text-emerald-700 hover:text-emerald-900">
                            Full assessment report →
                        </button>
                    </section>

                    <section className="rounded-2xl border border-slate-200 bg-white flex flex-col h-96">
                        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800 p-4 pb-2">
                            <Sparkles size={15} className="text-violet-600" /> Ask the Specialist
                        </h2>
                        <div ref={chatRef} className="flex-1 overflow-y-auto px-4 space-y-3">
                            {msgs.length === 0 && (
                                <p className="text-xs text-slate-400 italic">
                                    Ask anything about your fleet — "which asset is costing us most?", "what's overdue?", "how risky is P-101?"
                                </p>
                            )}
                            {msgs.map((m, i) => (
                                <div key={i} className={`text-sm rounded-xl px-3 py-2 whitespace-pre-wrap leading-relaxed ${m.role === 'user'
                                    ? 'bg-violet-600 text-white ml-8'
                                    : 'bg-slate-50 border border-slate-100 text-slate-700 mr-4'}`}>
                                    {m.text}
                                </div>
                            ))}
                            {chatBusy && <Loader2 size={16} className="animate-spin text-violet-400" />}
                        </div>
                        <div className="p-3 border-t border-slate-100 flex gap-2">
                            <input
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') void send(); }}
                                placeholder="Ask about your assets…"
                                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:border-violet-400"
                            />
                            <button onClick={() => void send()} disabled={chatBusy || !input.trim()}
                                className="rounded-lg bg-violet-600 hover:bg-violet-700 text-white px-3 disabled:opacity-40">
                                <Send size={14} />
                            </button>
                        </div>
                    </section>

                    <section className="rounded-2xl border border-slate-200 bg-white p-4">
                        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800 mb-2">
                            <ScrollText size={15} className="text-slate-400" /> Work log
                        </h2>
                        {log.length === 0
                            ? <p className="text-xs text-slate-400 italic">No agent runs recorded yet (admin access required to view the log).</p>
                            : <div className="divide-y divide-slate-50 max-h-72 overflow-y-auto">
                                {log.map((r) => (
                                    <div key={r.id} className="py-2">
                                        <div className="text-xs font-medium text-slate-600">{r.context_type.replaceAll('_', ' ')}</div>
                                        <div className="text-[11px] text-slate-400 truncate" title={r.query_text}>{r.query_text}</div>
                                        <div className="text-[10px] text-slate-300">{new Date(r.created_at).toLocaleString()}{r.duration_ms ? ` · ${(r.duration_ms / 1000).toFixed(1)}s` : ''}</div>
                                    </div>
                                ))}
                            </div>}
                    </section>
                </div>
            </div>
        </div>
    );
};

export default SpecialistWorkspacePage;
