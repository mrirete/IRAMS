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
 * The choice deliberately lives at step 3, not step 1 — you pick a method BECAUSE of
 * what the evidence shows, and at step 1 you haven't looked yet. Step 1 captures a
 * non-binding `proposed_method` instead, which pre-selects the gate and tells step 2
 * what evidence is worth collecting.
 */
import React, { useState } from 'react';
import { Check, Lock, AlertTriangle, ArrowRight, Repeat, X } from 'lucide-react';
import analyzeService, {
    RCA_METHODS, rcaMethodLabel, rcaMethodColor, scopeNodesToMethod,
    type RCAInvestigation, type RCAMethod, type RCANode,
} from '../../eam/services/AnalyzeService';

interface Props {
    investigation: RCAInvestigation;
    /** All nodes for the investigation, unscoped — used to warn about work left behind. */
    nodes: RCANode[];
    onCommitted: (updated: RCAInvestigation) => void;
    /** Optional AI method-advisor UI, rendered inside the chooser header. */
    advisorSlot?: React.ReactNode;
}

const RCAMethodGate: React.FC<Props> = ({ investigation, nodes, onCommitted, advisorSlot }) => {
    const committed = !!investigation.method_locked_at && !!investigation.method;

    const [picked, setPicked] = useState<RCAMethod | null>(
        investigation.method ?? investigation.proposed_method ?? null,
    );
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
            }
        } finally { setBusy(false); }
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
                <button
                    onClick={() => setSwitching(true)}
                    className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
                >
                    <Repeat size={12} /> Change method
                </button>
            </div>
        );
    }

    // ── Chooser (first commit, or an explicit change) ────────
    const changing = committed && switching;

    return (
        <div className="rounded-xl border border-blue-200/60 bg-gradient-to-br from-blue-50/50 to-indigo-50/40 p-5 shadow-sm md:p-6">
            <div className="mb-1 flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-extrabold text-blue-900 sm:text-base">
                    <AlertTriangle size={16} className="text-blue-600" />
                    {changing ? 'Change the analysis method' : 'Choose one analysis method'}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                    {advisorSlot}
                    {changing && (
                        <button
                            onClick={() => { setSwitching(false); setPendingSwitch(null); setPicked(investigation.method ?? null); }}
                            className="text-slate-300 transition-colors hover:text-slate-500"
                            title="Keep current method"
                        >
                            <X size={15} />
                        </button>
                    )}
                </div>
            </div>

            <p className="mb-4 text-xs leading-relaxed text-slate-600">
                One investigation, one method. Running several tools over the same evidence pulls the
                analysis in different directions and leaves you with a record nobody can defend at a review.
                {investigation.proposed_method && !committed && (
                    <> Step 1 suggested <strong>{rcaMethodLabel(investigation.proposed_method)}</strong> — confirm or override it now that you have the evidence.</>
                )}
            </p>

            <div className="flex flex-wrap gap-2">
                {RCA_METHODS.map(m => {
                    const isPicked = picked === m.value;
                    const isCurrent = investigation.method === m.value;
                    return (
                        <button
                            key={m.value}
                            title={`${m.label} — best for ${m.bestFor}. ${m.why}`}
                            onClick={() => { setPicked(m.value); setPendingSwitch(null); }}
                            className={`min-w-[150px] flex-1 cursor-pointer rounded-lg bg-white px-3 py-2.5 text-left transition-all ${
                                isPicked ? 'border-2 shadow-sm ring-2' : 'border border-slate-200 hover:border-slate-300'
                            }`}
                            style={isPicked ? { borderColor: m.color, color: m.color, boxShadow: `0 0 0 3px ${m.color}20` } : undefined}
                        >
                            <div className="flex items-center gap-1.5 text-xs font-extrabold">
                                {isPicked && <Check size={12} />}{m.label}
                                {isCurrent && !isPicked && <span className="text-[9px] font-bold text-slate-400">(current)</span>}
                            </div>
                            <div className="truncate text-[10px] font-medium text-slate-400">Best for: {m.bestFor}</div>
                        </button>
                    );
                })}
            </div>

            {picked && (
                <p className="mt-3 text-xs leading-relaxed text-slate-600">
                    <strong style={{ color: rcaMethodColor(picked) }}>{rcaMethodLabel(picked)}</strong>{' '}
                    {RCA_METHODS.find(m => m.value === picked)?.why}
                </p>
            )}

            {/* Switching away from a method that already holds work */}
            {(() => {
                if (!picked || picked === investigation.method) return null;
                const orphaned = scopeNodesToMethod(nodes, investigation.method)
                    .filter(n => n.node_type !== 'category').length;
                const confirmNeeded = committed && orphaned > 0;

                if (confirmNeeded && pendingSwitch !== picked) {
                    return (
                        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                            <div className="mb-2 flex items-center gap-2 text-xs font-bold text-amber-900">
                                <AlertTriangle size={13} />
                                {orphaned} cause{orphaned === 1 ? '' : 's'} recorded under {rcaMethodLabel(investigation.method)}
                            </div>
                            <p className="mb-3 text-xs leading-relaxed text-amber-800">
                                That work stays saved against {rcaMethodLabel(investigation.method)} and is not deleted — but it
                                will not appear in the {rcaMethodLabel(picked)} editor, and it no longer feeds this
                                investigation's root cause. Switch back at any time to see it again.
                            </p>
                            <button
                                onClick={() => setPendingSwitch(picked)}
                                className="rounded-lg bg-amber-600 px-3 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-amber-700"
                            >
                                I understand — continue
                            </button>
                        </div>
                    );
                }

                return (
                    <button
                        onClick={() => commit(picked)}
                        disabled={busy}
                        className="mt-4 flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-extrabold text-white shadow-sm transition-opacity disabled:opacity-60"
                        style={{ background: rcaMethodColor(picked) }}
                    >
                        {changing ? 'Switch to' : 'Start'} {rcaMethodLabel(picked)} analysis <ArrowRight size={13} />
                    </button>
                );
            })()}
        </div>
    );
};

export default RCAMethodGate;
