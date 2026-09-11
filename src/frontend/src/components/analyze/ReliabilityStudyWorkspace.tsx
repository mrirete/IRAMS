/**
 * Study workspace — a study, opened.
 *
 * The launcher answers "where do I start". This answers the two questions that
 * follow: *what do I do next in this study*, and *how does any of it become
 * work*. A study declares the decision it exists to make (its objective), and
 * that decision produces a short plan: the analyses it needs, then the step
 * where the answer leaves as a PM program, a stock level, an RCM strategy or
 * an investigation.
 *
 * Steps tick themselves from real records — a saved analysis of the right type,
 * or a recorded outcome (0357). Nothing here is a checkbox someone ticks by
 * hand, so the progress cannot lie about what was actually done.
 */
import React, { useMemo, useState } from 'react';
import {
    ArrowLeft, ArrowRight, Check, Circle, Wrench, Package, ClipboardList,
    Search, FileText, ExternalLink, Layers, Clock, AlertTriangle,
} from 'lucide-react';
import type {
    ReliabilityAnalysis, ReliabilityStudy, ReliabilityStudyOutcome, ReliabilityStudyStatus,
} from '../../eam/services/AnalyzeService';
import { objectiveDef, OUTCOME_META, type OutcomeKind, type ToolId } from './studyObjectives';

const STATUS_META: Record<ReliabilityStudyStatus, { label: string; cls: string }> = {
    active: { label: 'Active', cls: 'bg-primary-50 text-primary-700 border-primary-200' },
    in_review: { label: 'In review', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    approved: { label: 'Approved', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    archived: { label: 'Archived', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
};

const OUTCOME_ICON: Record<OutcomeKind, React.ReactNode> = {
    pm: <Wrench size={13} />,
    spares: <Package size={13} />,
    rcm: <ClipboardList size={13} />,
    rca: <Search size={13} />,
    wo: <FileText size={13} />,
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

interface Props {
    study: ReliabilityStudy;
    /** Every analysis version belonging to this study, any type. */
    analyses: ReliabilityAnalysis[];
    outcomes: ReliabilityStudyOutcome[];
    onBack: () => void;
    onOpenTool: (tool: ToolId) => void;
    onOpenAnalysis: (a: ReliabilityAnalysis) => void;
    /** Persist the decision text and/or a status transition. */
    onSaveDecision: (updates: { findings: string; status: ReliabilityStudyStatus }) => Promise<boolean>;
    canEdit?: boolean;
    /** Four-eyes (0358): approve / reopen — never the author, unless an administrator. */
    canApprove?: boolean;
}

export const ReliabilityStudyWorkspace: React.FC<Props> = ({
    study, analyses, outcomes, onBack, onOpenTool, onOpenAnalysis, onSaveDecision, canEdit = true, canApprove = false,
}) => {
    const obj = objectiveDef(study.objective);
    const [findings, setFindings] = useState(study.findings || '');
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<string | null>(null);

    // Latest version per lineage — the plan cares about what exists, not how
    // many times it was re-run.
    const latest = useMemo(() => {
        const byRoot = new Map<string, ReliabilityAnalysis>();
        for (const a of analyses) {
            const root = a.root_id || a.id;
            const cur = byRoot.get(root);
            if (!cur || (a.version || 1) > (cur.version || 1)) byRoot.set(root, a);
        }
        return Array.from(byRoot.values()).sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
    }, [analyses]);

    const haveType = (t?: string) => !!t && latest.some(a => a.analysis_type === t);
    const haveOutcome = (k?: OutcomeKind) => !!k && outcomes.some(o => o.kind === k);

    const steps = obj.steps.map(s => ({
        ...s,
        done: s.outcome ? haveOutcome(s.outcome) : haveType(s.satisfiedBy),
    }));
    // The next thing to do = first incomplete required step, else first
    // incomplete optional one.
    const nextIdx = steps.findIndex(s => !s.done && !s.optional);
    const activeIdx = nextIdx >= 0 ? nextIdx : steps.findIndex(s => !s.done);
    const requiredDone = steps.filter(s => !s.optional).every(s => s.done);

    const save = async (status: ReliabilityStudyStatus) => {
        setSaving(true);
        const ok = await onSaveDecision({ findings, status });
        setSaving(false);
        if (ok) {
            setToast(status === study.status ? 'Decision saved ✓' : `Study moved to ${STATUS_META[status].label.toLowerCase()} ✓`);
            setTimeout(() => setToast(null), 3500);
        }
    };

    return (
        <div className="space-y-4">
            {/* ── Study header ─────────────────────────────── */}
            <div className="flex flex-wrap items-start gap-3">
                <button
                    onClick={onBack}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl border bg-white border-slate-200 text-slate-500 text-xs font-semibold hover:border-primary-300 hover:text-primary-600 transition-all shrink-0"
                >
                    <ArrowLeft size={13} /> All studies
                </button>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-bold text-slate-800 truncate">{study.name}</h2>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_META[study.status]?.cls || STATUS_META.active.cls}`}>
                            {STATUS_META[study.status]?.label || study.status}
                        </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                        <span className="font-semibold text-slate-600">{obj.label}</span>
                        {' — '}{obj.question}
                        {study.asset_tag && <> · <span className="font-mono text-slate-500">{study.asset_tag}</span></>}
                    </p>
                </div>
            </div>

            {toast && (
                <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700 font-medium">
                    <Check size={16} /> {toast}
                </div>
            )}

            {/* ── The plan ─────────────────────────────────── */}
            {steps.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 border-b border-slate-100">
                        <h3 className="text-sm font-bold text-slate-800">What this study needs</h3>
                        <span className="text-[11px] text-slate-400">Delivers: {obj.delivers}</span>
                    </div>
                    <ol className="divide-y divide-slate-100">
                        {steps.map((s, i) => {
                            const isNext = i === activeIdx;
                            return (
                                <li key={s.label} className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 py-3 ${isNext ? 'bg-primary-50/40' : ''}`}>
                                    <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold ${
                                        s.done ? 'bg-emerald-100 text-emerald-700'
                                            : isNext ? 'bg-primary-600 text-white'
                                                : 'bg-slate-100 text-slate-400'}`}>
                                        {s.done ? <Check size={13} /> : i + 1}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-semibold text-slate-800">
                                            {s.label}
                                            {s.optional && <span className="ml-2 text-[10px] font-bold text-slate-400 uppercase">optional</span>}
                                            {s.outcome && !s.optional && <span className="ml-2 text-[10px] font-bold text-emerald-600 uppercase">the hand-over</span>}
                                        </p>
                                        <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{s.why}</p>
                                    </div>
                                    <div className="shrink-0">
                                        {s.done ? (
                                            <span className="text-[11px] font-bold text-emerald-600">Done</span>
                                        ) : s.tool ? (
                                            <button
                                                onClick={() => onOpenTool(s.tool!)}
                                                className={`group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                                                    isNext ? 'bg-primary-600 text-white shadow-sm hover:bg-primary-700'
                                                        : 'border border-slate-200 text-slate-600 hover:border-primary-300 hover:text-primary-600'}`}
                                            >
                                                {isNext ? 'Start' : 'Open'}
                                                <ArrowRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
                                            </button>
                                        ) : (
                                            <span className="text-[11px] text-slate-400">
                                                {s.outcome === 'pm' && 'From the Weibull or Monte Carlo result'}
                                                {s.outcome === 'spares' && 'From the Spares result'}
                                                {s.outcome === 'rcm' && 'From the Weibull or Block Diagram result'}
                                            </span>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ol>
                </div>
            )}

            {/* ── What this study produced ─────────────────── */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100">
                    <h3 className="text-sm font-bold text-slate-800">What it produced</h3>
                    <p className="text-[11px] text-slate-400 mt-0.5">The work this study became — recorded when the change was confirmed, not when the button was pressed.</p>
                </div>
                {outcomes.length === 0 ? (
                    <p className="px-4 py-4 text-xs text-slate-400">
                        Nothing yet. A study is finished when its answer has left as work — a PM program, a stock level, an RCM strategy or an investigation.
                    </p>
                ) : (
                    <ul className="divide-y divide-slate-100">
                        {outcomes.map(o => {
                            const meta = OUTCOME_META[o.kind];
                            return (
                                <li key={o.id} className="flex items-center gap-3 px-4 py-2.5">
                                    <span className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                                        {OUTCOME_ICON[o.kind]}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium text-slate-700 truncate">{o.ref_label}</p>
                                        <p className="text-[10px] text-slate-400">
                                            {meta.verb} {meta.label.toLowerCase()} · {fmtDate(o.created_at)}
                                            {o.created_by ? ` · ${o.created_by}` : ''}
                                        </p>
                                    </div>
                                    <a
                                        href={meta.href(o.ref_id)}
                                        className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-primary-600 hover:text-primary-700"
                                    >
                                        Open <ExternalLink size={11} />
                                    </a>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            {/* ── Analyses in this study ───────────────────── */}
            {latest.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                        <Layers size={13} className="text-slate-400" />
                        <h3 className="text-sm font-bold text-slate-800">Analyses in this study</h3>
                        <span className="text-[11px] text-slate-400">({latest.length})</span>
                    </div>
                    <ul className="divide-y divide-slate-100">
                        {latest.map(a => (
                            <li key={a.id}>
                                <button
                                    onClick={() => onOpenAnalysis(a)}
                                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 transition-colors"
                                >
                                    <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 shrink-0">{a.analysis_type}</span>
                                    <span className="text-sm text-slate-700 truncate flex-1">{a.title}</span>
                                    <span className="text-[10px] text-slate-400 shrink-0 hidden sm:inline">
                                        <Clock size={9} className="inline mr-1" />{fmtDate(a.created_at)}
                                        {(a.version || 1) > 1 && ` · v${a.version}`}
                                    </span>
                                    <ArrowRight size={13} className="text-slate-300 shrink-0" />
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* ── The decision ─────────────────────────────── */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100">
                    <h3 className="text-sm font-bold text-slate-800">The decision</h3>
                    <p className="text-[11px] text-slate-400 mt-0.5">{obj.decisionPrompt}</p>
                </div>
                <div className="px-4 py-3 space-y-3">
                    <textarea
                        value={findings}
                        onChange={e => setFindings(e.target.value)}
                        disabled={!canEdit || study.status === 'approved'}
                        rows={4}
                        placeholder={obj.decisionPrompt}
                        className="w-full p-3 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 resize-none disabled:bg-slate-50 disabled:text-slate-500"
                    />

                    {/* Honest gate: warn, never silently approve an empty study */}
                    {study.status !== 'approved' && (!requiredDone || outcomes.length === 0) && (
                        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                            <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
                            <p className="text-[11px] text-amber-800 leading-relaxed">
                                {!requiredDone && 'Some steps of this study are not done yet. '}
                                {outcomes.length === 0 && 'Nothing has left this study as work yet. '}
                                You can still send it for review — the reviewer will see exactly this.
                            </p>
                        </div>
                    )}

                    {(canEdit || canApprove) && (
                        <div className="flex flex-wrap gap-2 items-center">
                            {canEdit && (
                                <button
                                    onClick={() => save(study.status)}
                                    disabled={saving || study.status === 'approved'}
                                    className="px-4 py-2 text-xs font-semibold text-white bg-primary-600 rounded-lg shadow-sm hover:bg-primary-700 disabled:opacity-40 transition-colors"
                                >
                                    {saving ? 'Saving…' : 'Save decision'}
                                </button>
                            )}
                            {canEdit && study.status === 'active' && (
                                <button
                                    onClick={() => save('in_review')}
                                    disabled={saving}
                                    className="px-4 py-2 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 disabled:opacity-40 transition-colors"
                                >
                                    Send for review
                                </button>
                            )}
                            {study.status === 'in_review' && (canApprove ? (
                                <button
                                    onClick={() => save('approved')}
                                    disabled={saving}
                                    className="px-4 py-2 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 disabled:opacity-40 transition-colors"
                                >
                                    Approve
                                </button>
                            ) : (
                                <span className="text-[11px] text-slate-500">
                                    Awaiting approval — by someone with reliability approval rights other than the author (four-eyes), or an administrator.
                                </span>
                            ))}
                            {study.status === 'approved' && canApprove && (
                                <button
                                    onClick={() => save('active')}
                                    disabled={saving}
                                    className="px-4 py-2 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 transition-colors"
                                >
                                    Reopen (new revision)
                                </button>
                            )}
                            {study.status === 'approved' && !canApprove && (
                                <span className="text-[11px] text-slate-500">Approved and frozen — an approver or administrator can reopen it.</span>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Other tools — narrowed, never hidden */}
            {steps.length > 0 && (
                <p className="text-[11px] text-slate-400 px-1">
                    This study asks for the steps above. Every other tool stays available in the rail — a study is guided, not fenced.
                </p>
            )}
        </div>
    );
};

export default ReliabilityStudyWorkspace;
