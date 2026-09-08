/**
 * WoStatusTimeline — one quiet row that says where a work order is in its life.
 *
 * Created ── Planned ── Scheduled ── In progress ── Work complete ── Closed
 * Each reached step carries the date it was entered (from the system journal,
 * see lib/woTimeline.ts). Waiting and Cancelled show as a side chip because
 * they are not stops on the rail. No controls: status is changed elsewhere.
 */
import React, { useMemo } from 'react';
import { Check, PauseCircle, XCircle } from 'lucide-react';
import { buildTimeline, formatWhen, type JournalLike, type WoStamps } from '../lib/woTimeline';

interface Props extends WoStamps {
    journals?: JournalLike[] | null;
    className?: string;
    /** Phone width: shorter labels, no dates under the dots (the side chip keeps its date). */
    compact?: boolean;
}

const SHORT_LABEL: Record<string, string> = { TECO: 'Complete' };

export const WoStatusTimeline: React.FC<Props> = ({ status, createdAt, closedAt, journals, className = '', compact = false }) => {
    const t = useMemo(() => buildTimeline({ status, createdAt, closedAt }, journals), [status, createdAt, closedAt, journals]);

    return (
        <div className={`flex items-center gap-2 min-w-0 ${className}`} aria-label="Work order progress">
            <ol className="flex items-start min-w-0 overflow-x-auto flex-1 m-0 p-0 list-none">
                {t.steps.map((s, i) => {
                    const done = s.state === 'done';
                    const current = s.state === 'current';
                    const skipped = s.state === 'skipped';
                    const dot = done ? 'bg-emerald-500 border-emerald-500 text-white'
                        : current ? 'bg-white border-primary-600 ring-2 ring-primary-100'
                            : skipped ? 'bg-slate-50 border-slate-200 border-dashed'
                                : 'bg-white border-slate-300';
                    const when = formatWhen(s.reachedAt);
                    return (
                        <li key={s.code} className={`flex items-start ${i < t.steps.length - 1 ? 'flex-1' : ''} min-w-0`}>
                            <div className="flex flex-col items-center gap-0.5 px-1">
                                <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${dot}`} title={when ? `${s.label} · ${when}` : s.label}>
                                    {done && <Check size={10} strokeWidth={3} />}
                                    {current && <span className="w-1.5 h-1.5 rounded-full bg-primary-600" />}
                                </span>
                                <span className={`${compact ? 'text-[9px]' : 'text-[10px]'} leading-tight whitespace-nowrap ${current ? 'font-bold text-slate-800' : skipped ? 'text-slate-300 line-through' : done ? 'text-slate-600' : 'text-slate-400'}`}>
                                    {compact ? (SHORT_LABEL[s.code] || s.label) : s.label}
                                </span>
                                {when && !skipped && !compact && <span className="text-[9px] leading-tight text-slate-400 whitespace-nowrap">{when}</span>}
                            </div>
                            {i < t.steps.length - 1 && <span className={`h-px flex-1 min-w-[10px] mt-2 ${t.steps[i + 1].state === 'done' || t.steps[i + 1].state === 'current' ? 'bg-emerald-400' : 'bg-slate-200'}`} />}
                        </li>
                    );
                })}
            </ol>
            {t.side && (
                <span
                    className={`flex-shrink-0 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full border ${t.side.code === 'WAIT' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-red-50 text-red-700 border-red-200'}`}
                    title={t.side.since ? `${t.side.label} since ${new Date(t.side.since).toLocaleString()}` : t.side.label}
                >
                    {t.side.code === 'WAIT' ? <PauseCircle size={11} /> : <XCircle size={11} />}
                    {t.side.label}{t.side.since ? ` · ${formatWhen(t.side.since)}` : ''}
                </span>
            )}
        </div>
    );
};

export default WoStatusTimeline;
