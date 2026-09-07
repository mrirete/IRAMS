/**
 * RCAMethodGate.tsx — Step 3 method commitment.
 *
 * Step 3 used to be a toolbox: four method buttons you could click freely, each
 * swapping the editor without touching the nodes the previous one had written. The
 * tools then re-interpreted each other's work (a fishbone's 6M category rows became
 * fault-tree gate events), and on the Analyze tab two editors rendered at once.
 *
 * It is a GATE now. You commit to one method, you get one editor, and changing your
 * mind is a deliberate, confirmed act rather than a stray click.
 *
 * Picking a card IS the commit, and it opens the workspace in the same motion —
 * there is no second "Start" button and no third "Open workspace" click. The one
 * pause kept is switching away from a method that already holds recorded causes.
 *
 * The choice deliberately lives at step 3, not step 1 — you pick a method BECAUSE of
 * what the evidence shows, and at step 1 you haven't looked yet.
 *
 * A rule-based suggestion (lib/rcaMethodSuggest) reads the facts already on the
 * record and pre-highlights a card with its reasons. Ask AI is a second opinion.
 */
import React, { useState } from 'react';
import { Check, Lock, AlertTriangle, Repeat, X, Sparkles } from 'lucide-react';
import analyzeService, {
    RCA_METHODS, rcaMethodLabel, rcaMethodColor, scopeNodesToMethod,
    type RCAInvestigation, type RCAMethod, type RCANode,
} from '../../eam/services/AnalyzeService';
import { METHOD_QUESTIONS, type MethodSuggestion } from '../../lib/rcaMethodSuggest';

interface Props {
    investigation: RCAInvestigation;
    /** All nodes for the investigation, unscoped — used to warn about work left behind. */
    nodes: RCANode[];
    onCommitted: (updated: RCAInvestigation) => void;
    /** Called right after a commit so the workspace can open in the same motion. */
    onOpenWorkspace?: () => void;
    /** Credit-free suggestion computed by the page from the record's own facts. */
    suggestion?: MethodSuggestion | null;
    /** Optional AI method-advisor UI, rendered inside the chooser header. */
    advisorSlot?: React.ReactNode;
    /** Viewer: show the choice, allow none of it. */
    readOnly?: boolean;
}

const RCAMethodGate: React.FC<Props> = ({ investigation, nodes, onCommitted, onOpenWorkspace, suggestion, advisorSlot, readOnly = false }) => {
    const committed = !!investigation.method_locked_at && !!investigation.method;

    const [switching, setSwitching] = useState(false);
    const [pendingSwitch, setPendingSwitch] = useState<RCAMethod | null>(null);
    const [busy, setBusy] = useState(false);

    const commit = async (method: RCAMethod) => {
        if (busy) return;
        setBusy(true);
        try {
            const updated = await analyzeService.updateRCAInvestigation(investigation.id, {
                method,
                method_locked_at: new Date().toISOString(),
            } as Partial<RCAInvestigation>);
            if (updated) {
                onCommitted(updated);
                setSwitching(false);
                setPendingSwitch(null);
                onOpenWorkspace?.();
            }
        } finally { setBusy(false); }
    };

    /** Card click: commit now, unless we would strand recorded causes — then ask first. */
    const pick = (method: RCAMethod) => {
        if (busy || readOnly) return;
        if (committed && method === investigation.method) { setSwitching(false); onOpenWorkspace?.(); return; }
        const orphaned = committed
            ? scopeNodesToMethod(nodes, investigation.method).filter(n => n.node_type !== 'category').length
            : 0;
        if (orphaned > 0) { setPendingSwitch(method); return; }
        void commit(method);
    };

    // ── Committed: compact banner ────────────────────────────
    if (committed && !switching) {
        const scoped = scopeNodesToMethod(nodes, investigation.method);
        const causeCount = scoped.filter(n => n.node_type !== 'category' && n.node_type !== 'problem').length;
        const color = rcaMethodColor(investigation.method);

        return (
            <div
                className="flex flex-wrap items-center gap-3 rounded-xl border bg-white px-4 py-3 shadow-sm"
                style={{ borderColor: `${color}40` }}
            >
                <span
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-extrabold"
                    style={{ background: `${color}14`, color }}
                >
                    <Lock size={11} /> {rcaMethodLabel(investigation.method)}
                </span>
                <span className="text-xs text-slate-500">
                    Analysis method for this investigation · {causeCount} cause{causeCount === 1 ? '' : 's'} recorded
                </span>
                {!readOnly && (
                    <button
                        onClick={() => setSwitching(true)}
                        className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
                    >
                        <Repeat size={12} /> Change method
                    </button>
                )}
            </div>
        );
    }

    // ── Chooser (first commit, or an explicit change) ────────
    const changing = committed && switching;
    const highlighted: RCAMethod | null = investigation.method ?? suggestion?.method ?? null;

    return (
        <div className="rounded-xl border border-primary-200/60 bg-gradient-to-br from-primary-50/50 to-primary-50/40 p-5 shadow-sm md:p-6">
            <div className="mb-1 flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-extrabold text-primary-900 sm:text-base">
                    <AlertTriangle size={16} className="text-primary-600" />
                    {changing ? 'Change the analysis method' : 'Choose the analysis method'}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                    {advisorSlot}
                    {changing && (
                        <button
                            onClick={() => { setSwitching(false); setPendingSwitch(null); }}
                            className="text-slate-300 transition-colors hover:text-slate-500"
                            title="Keep current method"
                        >
                            <X size={15} />
                        </button>
                    )}
                </div>
            </div>

            <p className="mb-3 text-xs leading-relaxed text-slate-600">
                One investigation, one method. Pick a card and the workspace opens.
            </p>

            {/* Credit-free suggestion: the four questions answered from the record. */}
            {suggestion && (
                <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-white/80 bg-white/70 px-3 py-2 text-xs">
                    <Sparkles size={13} style={{ color: rcaMethodColor(suggestion.method) }} className="shrink-0" />
                    <span className="font-bold text-slate-700">Suggested:</span>
                    <span className="font-extrabold" style={{ color: rcaMethodColor(suggestion.method) }}>
                        {rcaMethodLabel(suggestion.method)}
                    </span>
                    <span className="text-slate-500">
                        {suggestion.reasons.length
                            ? `— ${suggestion.reasons.join('; ')}.`
                            : '— no safety, recurrence or wide-cause signals on the record, so start with the simplest tool.'}
                    </span>
                    <span
                        className="ml-auto cursor-help text-[10px] font-semibold text-slate-400 underline decoration-dotted"
                        title={METHOD_QUESTIONS.map(q => `${q.rule}. ${q.question} → ${rcaMethodLabel(q.method)}`).join('\n')}
                    >
                        how this is decided
                    </span>
                </div>
            )}

            <div className="flex flex-wrap gap-2">
                {RCA_METHODS.map(m => {
                    const isHighlighted = highlighted === m.value;
                    const isCurrent = investigation.method === m.value;
                    const isSuggested = suggestion?.method === m.value;
                    return (
                        <button
                            key={m.value}
                            disabled={busy || readOnly}
                            title={readOnly ? 'View only' : `${m.label} — ${m.bestFor}. ${m.why}`}
                            onClick={() => pick(m.value)}
                            className={`min-w-[150px] flex-1 cursor-pointer rounded-lg bg-white px-3 py-2.5 text-left transition-all disabled:opacity-60 ${
                                isHighlighted ? 'border-2 shadow-sm' : 'border border-slate-200 hover:border-slate-300'
                            }`}
                            style={isHighlighted ? { borderColor: m.color, color: m.color, boxShadow: `0 0 0 3px ${m.color}20` } : undefined}
                        >
                            <div className="flex items-center gap-1.5 text-xs font-extrabold">
                                {isCurrent && <Check size={12} />}{m.label}
                                {isCurrent && <span className="text-[9px] font-bold text-slate-400">(current)</span>}
                                {isSuggested && !isCurrent && <span className="text-[9px] font-bold text-slate-400">(suggested)</span>}
                            </div>
                            <div className="truncate text-[10px] font-medium text-slate-400">{m.bestFor}</div>
                        </button>
                    );
                })}
            </div>

            {/* Switching away from a method that already holds work */}
            {pendingSwitch && pendingSwitch !== investigation.method && (() => {
                const orphaned = scopeNodesToMethod(nodes, investigation.method)
                    .filter(n => n.node_type !== 'category').length;
                return (
                    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                        <div className="mb-2 flex items-center gap-2 text-xs font-bold text-amber-900">
                            <AlertTriangle size={13} />
                            {orphaned} cause{orphaned === 1 ? '' : 's'} recorded under {rcaMethodLabel(investigation.method)}
                        </div>
                        <p className="mb-3 text-xs leading-relaxed text-amber-800">
                            That work stays saved against {rcaMethodLabel(investigation.method)} and is not deleted — but it
                            will not appear in the {rcaMethodLabel(pendingSwitch)} editor, and it no longer feeds this
                            investigation's root cause. Switch back at any time to see it again.
                        </p>
                        <div className="flex flex-wrap gap-2">
                            <button
                                onClick={() => commit(pendingSwitch)}
                                disabled={busy}
                                className="rounded-lg bg-amber-600 px-3 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-amber-700 disabled:opacity-60"
                            >
                                Switch to {rcaMethodLabel(pendingSwitch)}
                            </button>
                            <button
                                onClick={() => setPendingSwitch(null)}
                                className="rounded-lg border border-amber-200 px-3 py-1.5 text-[11px] font-bold text-amber-800 hover:bg-amber-100"
                            >
                                Keep {rcaMethodLabel(investigation.method)}
                            </button>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
};

export default RCAMethodGate;
