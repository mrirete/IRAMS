import React from 'react';
import { AlertOctagon, Clock, FileText, MapPin, User, Copy, Ban } from 'lucide-react';
import { RequestStatus, type ServiceRequest } from '../../types';
import { PriorityPill, cn } from '../ui';
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

/**
 * One request on the board. Line 1 says how urgent and how old, line 2 what is
 * wrong, line 3 where, the footer who raised it and how long is left — or, once
 * closed, what became of it.
 */
export const RequestCard: React.FC<RequestCardProps> = ({ request: r, dupCount = 0, selected, onSelect, onOpenWO, onShowDuplicates, bare }) => {
    const closed = r.status === RequestStatus.CONVERTED || r.status === RequestStatus.APPROVED || r.status === RequestStatus.REJECTED;
    const plant = plantOf(r);
    const body = (
        <>
            <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-mono text-[11px] text-slate-500 truncate" title="Request number">{r.requestNumber}</span>
                {!closed && <PriorityPill priority={r.priority} />}
                {r.isBreakdown && !closed && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-red-700" title="Equipment stopped">
                        <AlertOctagon size={11} /> Stopped
                    </span>
                )}
                <span className="ml-auto text-[11px] text-slate-400 whitespace-nowrap" title={`Raised ${new Date(r.createdAt).toLocaleString()}`}>
                    {ageLabel(r.createdAt)}
                </span>
            </div>

            <p className={cn('mt-1.5 text-sm leading-snug line-clamp-2', closed ? 'text-slate-600' : 'font-medium text-slate-900')}>
                {r.description}
            </p>

            {(r.assetName || plant !== 'Unassigned') && (
                <div className="mt-1.5 flex items-center gap-1 text-xs text-slate-500 min-w-0">
                    <MapPin size={11} className="flex-shrink-0 text-slate-400" />
                    <span className="truncate">
                        {r.assetName && <span className="font-medium text-slate-600">{r.assetName}</span>}
                        {r.assetName && plant !== 'Unassigned' && ' · '}
                        {plant !== 'Unassigned' && plant}
                    </span>
                </div>
            )}

            {dupCount > 0 && !closed && (
                <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onShowDuplicates?.(r); }}
                    className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 hover:underline"
                    title="Other open requests on the same asset — possible duplicates"
                >
                    <Copy size={11} /> +{dupCount} open on this asset
                </button>
            )}

            <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-xs text-slate-500">
                {closed ? (
                    // Once closed, what became of it is the question — not who raised it.
                    <OutcomeLabel request={r} onOpenWO={onOpenWO} />
                ) : (
                    <>
                        <span className="inline-flex items-center gap-1 min-w-0">
                            <User size={12} className="flex-shrink-0" /> <span className="truncate">{r.requesterName}</span>
                        </span>
                        <DueLabel request={r} />
                    </>
                )}
            </div>
        </>
    );

    if (bare) return body;
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => onSelect?.(r)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSelect?.(r); }}
            className={cn(
                'bg-white p-3 rounded-lg border shadow-sm cursor-pointer transition hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
                selected ? 'border-primary-400 ring-1 ring-primary-200' : 'border-slate-200'
            )}
        >
            {body}
        </div>
    );
};
