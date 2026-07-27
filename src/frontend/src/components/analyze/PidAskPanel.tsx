/**
 * PidAskPanel — ask the Reliability Specialist about the P&ID you are looking at.
 *
 * The drawing is already a graph (typed components, typed connections), so the
 * agent answers routing questions by walking it rather than by reading a
 * picture: flow paths, what feeds what, and which valves isolate a component
 * come back deterministically from query_pid. Components linked to the asset
 * register also carry their live reliability history, which is the whole reason
 * to ask here instead of squinting at the drawing.
 *
 * A pop-up rather than another panel on the canvas: the P&ID view is already
 * dense, and asking a question is a process, not a permanent fixture.
 *
 * Advisory only. Isolation answers describe the drawing — never a permit.
 */
import React, { useState, useMemo } from 'react';
import { MessageCircleQuestion, Loader2, AlertTriangle, X, Sparkles, ShieldAlert } from 'lucide-react';
import { runPidQuestion, type AgentRunResponse } from '../../eam/services/agentRunClient';
import { friendlyAIError } from '../../eam/lib/aiError';
import type { PIDEquipment } from './PIDViewer';

interface PidAskPanelProps {
    pidTitle: string;
    equipment: PIDEquipment[];
    onClose: () => void;
}

// Questions worth one click. Each maps onto a query_pid operation, so the
// agent has a deterministic tool answer to narrate rather than a blank page.
const QUICK: { label: string; question: string }[] = [
    {
        label: 'Walk me through it',
        question: 'Summarise this drawing: the process flow from inlet to outlet, the major equipment in order, and the control points.',
    },
    {
        label: 'Worst reliability',
        question: 'Which components on this drawing have the worst reliability history, and what does their position in the process mean for the unit if they fail?',
    },
    {
        label: 'Single points of failure',
        question: 'Which components on this drawing would stop the whole process if they failed — anything with no parallel path around it?',
    },
];

type Scoped = 'isolate' | 'downstream' | 'upstream';

const SCOPED: { key: Scoped; label: string; ask: (c: string) => string }[] = [
    {
        key: 'isolate', label: 'What isolates it?',
        ask: (c) => `Which valves must be closed to isolate ${c} from everything feeding it? Flag any inlet that cannot be isolated.`,
    },
    {
        key: 'downstream', label: "What's downstream?",
        ask: (c) => `What is downstream of ${c} on this drawing, and what is affected if it stops?`,
    },
    {
        key: 'upstream', label: "What's upstream?",
        ask: (c) => `What feeds ${c} on this drawing?`,
    },
];

export const PidAskPanel: React.FC<PidAskPanelProps> = ({ pidTitle, equipment, onClose }) => {
    const [question, setQuestion] = useState('');
    const [component, setComponent] = useState('');
    const [loading, setLoading] = useState(false);
    const [res, setRes] = useState<AgentRunResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [asked, setAsked] = useState<string | null>(null);

    const labels = useMemo(
        () => equipment.map(e => e.label).filter(Boolean).sort((a, b) => a.localeCompare(b)),
        [equipment],
    );

    const ask = async (q: string) => {
        if (!q.trim() || loading) return;
        setLoading(true); setError(null); setRes(null); setAsked(q);
        try {
            setRes(await runPidQuestion(q, pidTitle));
        } catch (e: any) {
            console.error('[PidAsk]', e);
            setError(friendlyAIError(e));
        } finally {
            setLoading(false);
        }
    };

    const isolationShown = asked?.toLowerCase().includes('isolate');

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
            onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[85vh] flex flex-col"
                onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-slate-100 bg-gradient-to-r from-violet-50 via-white to-white rounded-t-2xl">
                    <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-violet-100 text-violet-600 shrink-0">
                        <MessageCircleQuestion size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-bold text-slate-800">Ask about this drawing</h4>
                        <p className="text-[11px] text-slate-400 truncate">
                            {pidTitle} · {equipment.length} components — answered from the graph, not the image
                        </p>
                    </div>
                    <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"><X size={15} /></button>
                </div>

                <div className="p-5 space-y-3 overflow-y-auto">
                    {/* One-click questions */}
                    <div className="flex flex-wrap gap-1.5">
                        {QUICK.map(q => (
                            <button key={q.label} onClick={() => ask(q.question)} disabled={loading}
                                className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-lg border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 disabled:opacity-40 transition-colors">
                                <Sparkles size={11} /> {q.label}
                            </button>
                        ))}
                    </div>

                    {/* Component-scoped questions — no tag typing, no typos */}
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                            Ask about one component
                        </label>
                        <div className="flex flex-col sm:flex-row gap-2">
                            <select value={component} onChange={e => setComponent(e.target.value)}
                                className="flex-1 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 outline-none focus:ring-2 focus:ring-violet-200">
                                <option value="">Select a component…</option>
                                {labels.map(l => <option key={l} value={l}>{l}</option>)}
                            </select>
                            <div className="flex gap-1.5 flex-wrap">
                                {SCOPED.map(s => (
                                    <button key={s.key} onClick={() => ask(s.ask(component))}
                                        disabled={loading || !component}
                                        className="px-2.5 py-1.5 text-[11px] font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 transition-colors">
                                        {s.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Free text */}
                    <div className="flex flex-col sm:flex-row gap-2">
                        <input value={question} onChange={e => setQuestion(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') ask(question); }}
                            placeholder="Or ask anything about this drawing…"
                            className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400" />
                        <button onClick={() => ask(question)} disabled={loading || !question.trim()}
                            className="shrink-0 flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-violet-500 to-violet-600 shadow-sm hover:shadow disabled:opacity-50">
                            {loading ? <Loader2 size={15} className="animate-spin" /> : <MessageCircleQuestion size={15} />}
                            {loading ? 'Asking…' : 'Ask'}
                        </button>
                    </div>

                    {equipment.length === 0 && (
                        <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                            Nothing is drawn yet. Place equipment and connect it, and the Specialist can trace it.
                        </p>
                    )}

                    {error && (
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                            <AlertTriangle size={15} className="mt-0.5 shrink-0" /><span>{error}</span>
                        </div>
                    )}

                    {res && (
                        <div className="space-y-2.5 pt-1">
                            {asked && <p className="text-[11px] text-slate-400 italic">"{asked}"</p>}
                            <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed border-l-2 border-violet-200 pl-3">
                                {res.answer}
                            </div>

                            {/* An isolation answer is drawing-derived advice, never a permit. */}
                            {isolationShown && (
                                <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
                                    <ShieldAlert size={13} className="mt-0.5 shrink-0" />
                                    <span>
                                        Derived from the drawing only. Your site's isolation procedure and a physical
                                        walk-down govern — drain, vent and blind requirements are not modelled here.
                                    </span>
                                </div>
                            )}

                            <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
                                <span className="px-2 py-0.5 rounded-full bg-slate-100">Tier {res.tier_used} · advisory</span>
                                <span className="px-2 py-0.5 rounded-full bg-slate-100">{res.sources.length} sources</span>
                                <span className="px-2 py-0.5 rounded-full bg-slate-100">{res.tokens_used} tokens · {res.duration_ms} ms</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default PidAskPanel;
