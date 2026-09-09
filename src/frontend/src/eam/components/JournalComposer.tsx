/**
 * JournalComposer — the one way a person writes into a work order's journal.
 *
 * Used by Analysis & History (free type: Note / Observation / Handover /
 * Safety / Close-out, plus the Follow-up action) and by the Complete modal
 * (type fixed to Close-out, submitted with the completion). Same look, same
 * author line, same types, so "close-out note" and "journal" are one thing.
 */
import React from 'react';
import { ArrowRight, GitPullRequest } from 'lucide-react';

/** Entry types a person can pick. Follow-up is an action, SYSTEM is written by the app. */
export const JOURNAL_TYPES = ['Note', 'Observation', 'Handover', 'Closeout', 'Safety'] as const;
export type JournalType = typeof JOURNAL_TYPES[number];

export const JOURNAL_TYPE_LABEL: Record<string, string> = {
    Note: 'Note', Observation: 'Observation', Handover: 'Handover', Closeout: 'Close-out', Safety: 'Safety', 'Follow-up': 'Follow-up', SYSTEM: 'System',
};

export const JOURNAL_TYPE_COLORS: Record<string, string> = {
    'Note': 'bg-blue-100 text-blue-700',
    'Observation': 'bg-emerald-100 text-emerald-700',
    'Handover': 'bg-blue-100 text-blue-700',
    'Closeout': 'bg-violet-100 text-violet-700',
    'Follow-up': 'bg-amber-100 text-amber-700',
    'Safety': 'bg-red-100 text-red-700',
    'SYSTEM': 'bg-slate-200 text-slate-600',
};

export const JOURNAL_PLACEHOLDER: Record<string, string> = {
    Closeout: 'What was done, what was found, and how the equipment was left — the note the next planner reads.',
    Handover: 'What the next shift needs to know…',
    Observation: 'What you saw — readings, condition, anything unusual…',
    Safety: 'Hazard, near miss, or safety condition…',
    Note: 'Add a note…',
};

interface Props {
    value: string;
    onChange: (v: string) => void;
    /** Current type; ignored when `fixedType` is set. */
    type?: string;
    onTypeChange?: (t: string) => void;
    /** Lock the type (the Complete modal writes Close-out). */
    fixedType?: string;
    author?: string;
    /** Adds the entry now. Omit when a parent action submits it (the Complete button). */
    onSubmit?: () => void;
    /** Adds the same text as a Follow-up entry — an action, shown beside the composer. */
    onFollowUp?: () => void;
    required?: boolean;
    hint?: string;
    className?: string;
}

export const JournalComposer: React.FC<Props> = ({ value, onChange, type = 'Note', onTypeChange, fixedType, author, onSubmit, onFollowUp, required, hint, className = '' }) => {
    const t = fixedType || type;
    return (
        <div className={className}>
            <div className="flex items-center gap-2 mb-1.5">
                {fixedType ? (
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${JOURNAL_TYPE_COLORS[fixedType] || JOURNAL_TYPE_COLORS.Note}`}>
                        {JOURNAL_TYPE_LABEL[fixedType] || fixedType}{required ? ' *' : ''}
                    </span>
                ) : (
                    <select
                        value={t}
                        onChange={(e) => onTypeChange?.(e.target.value)}
                        className="text-[10px] font-bold border border-slate-200 rounded px-1.5 py-1 bg-slate-50 text-slate-600 uppercase"
                    >
                        {JOURNAL_TYPES.map(k => <option key={k} value={k}>{JOURNAL_TYPE_LABEL[k]}</option>)}
                    </select>
                )}
                <span className="text-[10px] text-slate-400">as {author || 'Unknown'}</span>
            </div>
            <div className="relative">
                <textarea
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className={`w-full border border-slate-300 rounded-lg p-2 md:p-3 text-xs ${fixedType ? 'h-24' : 'h-16'} focus:ring-1 focus:ring-primary-500 ${onSubmit ? 'pr-12' : ''} resize-none`}
                    placeholder={JOURNAL_PLACEHOLDER[t] || `Add ${String(t).toLowerCase()} entry...`}
                    onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey && onSubmit) onSubmit(); }}
                />
                {onSubmit && (
                    <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
                        {onFollowUp && (
                            <button
                                type="button"
                                onClick={onFollowUp}
                                disabled={!value.trim()}
                                className="px-2 py-1.5 bg-amber-100 border border-amber-300 text-amber-800 rounded-lg hover:bg-amber-200 disabled:opacity-50 disabled:hover:bg-amber-100 transition min-h-[32px] sm:min-h-0 flex items-center gap-1 text-[10px] font-bold"
                                title="Add as Follow-up — arms Complete & Raise Follow-Up and seeds the corrective WO"
                            >
                                <GitPullRequest size={12} /> Follow-up
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={onSubmit}
                            disabled={!value.trim()}
                            className="p-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-500 disabled:opacity-50 disabled:hover:bg-primary-600 transition min-w-[32px] min-h-[32px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
                            title="Add entry (Ctrl+Enter)"
                        >
                            <ArrowRight size={14} />
                        </button>
                    </div>
                )}
            </div>
            {hint && <p className="text-[9px] text-slate-400 mt-0.5">{hint}</p>}
        </div>
    );
};

/** A few recent human entries, for context above a composer. */
export const JournalRecent: React.FC<{ journals: any[]; limit?: number; emptyText?: string }> = ({ journals, limit = 3, emptyText = 'Nothing written on this job yet.' }) => {
    const human = (journals || []).filter(j => !j?.isSystem && String(j?.type || '').toUpperCase() !== 'SYSTEM').slice(0, limit);
    if (human.length === 0) return <p className="text-[10px] text-slate-400 italic">{emptyText}</p>;
    return (
        <div className="flex flex-col gap-1.5">
            {human.map(j => (
                <div key={j.id} className="text-[11px] text-slate-600 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
                    <span className={`text-[9px] font-bold uppercase px-1 py-0.5 rounded mr-1.5 ${JOURNAL_TYPE_COLORS[j.type] || JOURNAL_TYPE_COLORS.Note}`}>{JOURNAL_TYPE_LABEL[j.type] || j.type}</span>
                    <span className="text-slate-400 mr-1.5">{j.createdBy}</span>
                    <span className="whitespace-pre-wrap">{String(j.entry || '').slice(0, 160)}{String(j.entry || '').length > 160 ? '…' : ''}</span>
                </div>
            ))}
        </div>
    );
};

export default JournalComposer;
