import React from 'react';
import { AlertOctagon, Clock, FileText, Copy, Ban } from 'lucide-react';
import { RequestStatus, type ServiceRequest } from '../../types';
import { cn } from '../ui';
import { ageLabel, dueState, plantOf, type DueKind } from '../../lib/requestBoard';
import { statusLabel as woStatusLabel } from '../../lib/woTimeline';

const DUE_CLASS: Record<DueKind, string> = {
    overdue: 'text-red-600 font-semibold',
    soon: 'text-amber-600 font-semibold',
    ok: 'text-slate-400',
};

export const DueLabel: React.FC<{ request: ServiceRequest; className?: string }> = ({ request, className }) => {
    const due = dueState(request);
    if (!due) return null;
    return (
        <span className={cn('inline-flex items-center gap-1 whitespace-nowrap', DUE_CLASS[due.kind], className)} title={`Response due ${new Date(request.slaDeadline).toLocaleString()}`}>
            <Clock size={12} /> {due.label}
        </span>
    );
};

/** What happened to a closed request: its work order and that order's status, or the rejection. */
export const OutcomeLabel: React.FC<{ request: ServiceRequest; onOpenWO?: (woId: string) => void }> = ({ request, onOpenWO }) => {
    if (request.status === RequestStatus.REJECTED) {
        return (
            <span className="inline-flex items-center gap-1 text-slate-500 min-w-0" title={request.rejectionReason || 'Rejected'}>
                <Ban size={12} className="flex-shrink-0" />
                <span className="truncate">Rejected{request.rejectionReason ? ` · ${request.rejectionReason}` : ''}</span>
            </span>
        );
    }
    if (!request.linkedWOId) return null;
    return (
        <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenWO?.(request.linkedWOId!); }}
            className="inline-flex items-center gap-1 text-primary-700 font-semibold hover:underline whitespace-nowrap min-w-0 truncate"
        >
            <FileText size={12} /> {request.linkedWONumber || 'Work order'}
            {request.linkedWOStatus && <span className="font-normal text-slate-500">· {woStatusLabel(request.linkedWOStatus)}</span>}
        </button>
    );
};

export interface RequestCardProps {
    request: ServiceRequest;
    dupCount?: number;
    selected?: boolean;
    onSelect?: (r: ServiceRequest) => void;
    onOpenWO?: (woId: string) => void;
    onShowDuplicates?: (r: ServiceRequest) => void;
    /** Rendered without its own border/background (the caller supplies the shell). */
    bare?: boolean;
}

const STRIPE: Record<string, string> = {
    EMERGENCY: 'bg-red-500',
    HIGH: 'bg-amber-400',
    MEDIUM: 'bg-primary-400',
    LOW: 'bg-slate-300',
};
const PRIORITY_WORD: Record<string, string> = { EMERGENCY: 'Emergency', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };
const STATUS_WORD = (s: RequestStatus) => (s === RequestStatus.REJECTED ? 'Rejected' : 'Converted');

/**
 * One request on the board, in two lines so a column shows ten or more at a
 * glance (it held four at three-plus lines). The left stripe is the priority;
 * line 1 is what is wrong and how old, line 2 where, who, and how long is left
 * — or, once closed, what became of it. The full text is in the drawer.
 */
export const RequestCard: React.FC<RequestCardProps> = ({ request: r, dupCount = 0, selected, onSelect, onOpenWO, onShowDuplicates, bare }) => {
    const closed = r.status === RequestStatus.CONVERTED || r.status === RequestStatus.APPROVED || r.status === RequestStatus.REJECTED;
    const plant = plantOf(r);
    const where = [r.assetName, plant !== 'Unassigned' ? plant : null].filter(Boolean).join(' · ');
    const stripe = closed
        ? (r.status === RequestStatus.REJECTED ? 'bg-slate-200' : 'bg-green-400')
        : STRIPE[r.priority] || STRIPE.LOW;
    const priorityWord = closed ? STATUS_WORD(r.status) : `${PRIORITY_WORD[r.priority] || 'Low'} priority`;

    const body = (
        <>
            <span className={cn('absolute left-0 inset-y-0 w-1 rounded-l-md', stripe)} aria-hidden />
            <span className="sr-only">{priorityWord}. </span>
            <div className="flex items-baseline gap-2 min-w-0">
                <span className="font-mono text-[10.5px] text-slate-400 flex-shrink-0" title="Request number">{r.requestNumber}</span>
                <span
                    className={cn('flex-1 min-w-0 truncate text-[13px] leading-5', closed ? 'text-slate-600' : 'font-medium text-slate-900')}
                    title={r.description}
                >
                    {r.description}
                </span>
                <span className="flex-shrink-0 text-[11px] text-slate-400 tabular-nums" title={`Raised ${new Date(r.createdAt).toLocaleString()}`}>
                    {ageLabel(r.createdAt)}
                </span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 min-w-0 text-[11.5px] text-slate-500">
                {r.isBreakdown && !closed && (
                    <span className="flex-shrink-0 text-red-600" title="Equipment stopped"><AlertOctagon size={12} /></span>
                )}
                <span className="flex-1 min-w-0 truncate">
                    {where && <span className="text-slate-600">{where}</span>}
                    {!closed && <>{where && ' · '}{r.requesterName}</>}
                </span>
                {dupCount > 0 && !closed && (
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onShowDuplicates?.(r); }}
                        className="flex-shrink-0 inline-flex items-center gap-0.5 px-1 rounded bg-amber-50 text-[10.5px] font-semibold text-amber-700 hover:bg-amber-100"
                        title={`${dupCount} other open request${dupCount > 1 ? 's' : ''} on this asset — possible duplicates`}
                    >
                        <Copy size={10} /> +{dupCount}
                    </button>
                )}
                <span className="flex-shrink-0 min-w-0">
                    {closed ? <OutcomeLabel request={r} onOpenWO={onOpenWO} /> : <DueLabel request={r} />}
                </span>
            </div>
        </>
    );

    if (bare) return <div className="relative pl-3">{body}</div>;
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => onSelect?.(r)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSelect?.(r); }}
            title={`${r.requestNumber} — ${priorityWord}`}
            className={cn(
                'relative bg-white pl-3 pr-2.5 py-2 min-h-[56px] sm:min-h-0 rounded-md border cursor-pointer transition',
                'hover:border-slate-300 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
                selected ? 'border-primary-400 ring-1 ring-primary-200' : 'border-slate-200'
            )}
        >
            {body}
        </div>
    );
};

