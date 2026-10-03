import React, { useEffect, useMemo, useState } from 'react';
import { AlertOctagon, Ban, Check, ChevronLeft, ChevronRight, Clock, Copy, ExternalLink, MapPin, Trash2, User } from 'lucide-react';
import { RequestStatus, type ServiceRequest } from '../../types';
import { Drawer, Modal, ConfirmDialog, cn } from '../ui';
import { ImageGallery } from '../ui/ImageGallery';
import { FunctionalFailureSelector } from '../FunctionalFailureSelector';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { REQUEST_RESPONSE_HOURS, type RequestPriority } from '../../lib/requestPriority';
import { ageLabel, nextStep, plantOf, STATUS_LABEL } from '../../lib/requestBoard';
import { statusLabel as woStatusLabel } from '../../lib/woTimeline';
import { DueLabel } from './RequestCard';

export interface RequestEdits {
    description: string;
    isBreakdown: boolean;
    functionalFailureType?: string;
    priority: RequestPriority;
    workCenterId?: string;
}

export interface RequestDetailDrawerProps {
    request: ServiceRequest | null;
    dupCount: number;
    position: { index: number; total: number } | null;
    assetClassCode?: string;
    /** Departments (work centres) a reviewer may route the request to. */
    workCenters?: { id: string; code: string; name: string }[];
    onClose: () => void;
    onStep: (delta: 1 | -1) => void;
    /** Moves the request on; resolves with the WO number when it converts. */
    onTransition: (id: string, to: RequestStatus, extra?: Record<string, unknown>) => Promise<string | void>;
    onSave: (request: ServiceRequest, edits: RequestEdits) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
    onOpenWO: (woId: string) => void;
    onShowDuplicates: (r: ServiceRequest) => void;
}

const PRIORITIES: RequestPriority[] = ['EMERGENCY', 'HIGH', 'MEDIUM', 'LOW'];
const PRIORITY_ON: Record<RequestPriority, string> = {
    EMERGENCY: 'bg-red-600 border-red-600 text-white',
    HIGH: 'bg-amber-500 border-amber-500 text-white',
    MEDIUM: 'bg-primary-600 border-primary-600 text-white',
    LOW: 'bg-slate-600 border-slate-600 text-white',
};
const hoursLabel = (h: number) => (h < 48 ? `${h} h` : `${Math.round(h / 24)} days`);

const STEPS: { status: RequestStatus; label: string }[] = [
    { status: RequestStatus.NEW, label: 'New' },
    { status: RequestStatus.REVIEW, label: 'Review' },
    { status: RequestStatus.AUTHORIZED, label: 'Authorized' },
    { status: RequestStatus.CONVERTED, label: 'Work order' },
];

const editsOf = (r: ServiceRequest): RequestEdits => ({
    description: r.description || '',
    isBreakdown: !!r.isBreakdown,
    functionalFailureType: r.functionalFailureType,
    priority: r.priority,
    workCenterId: r.workCenterId,
});

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">{children}</div>
);

export const RequestDetailDrawer: React.FC<RequestDetailDrawerProps> = ({
    request, dupCount, position, assetClassCode, workCenters = [], onClose, onStep, onTransition, onSave, onDelete, onOpenWO, onShowDuplicates,
}) => {
    const { user, role, permissions } = useAuth();
    const { showToast } = useToast();
    const canEdit = permissions?.requests?.edit === true;
    const canDelete = permissions?.requests?.delete === true;
    const canAuthorize = permissions?.requests?.authorize === true;
    const canApprove = permissions?.requests?.approve === true;

    const [draft, setDraft] = useState<RequestEdits | null>(request ? editsOf(request) : null);
    const [busy, setBusy] = useState(false);
    const [rejectOpen, setRejectOpen] = useState(false);
    const [reason, setReason] = useState('');
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [pendingLeave, setPendingLeave] = useState<null | (() => void)>(null);

    // A new request (stepping, or a deep link) starts from its stored values.
    // A background refresh of the SAME request leaves the draft alone.
    useEffect(() => {
        setDraft(request ? editsOf(request) : null);
        setRejectOpen(false);
        setReason('');
    }, [request?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const dirty = useMemo(() => {
        if (!request || !draft) return false;
        const base = editsOf(request);
        return base.description !== draft.description || base.isBreakdown !== draft.isBreakdown
            || (base.functionalFailureType || '') !== (draft.functionalFailureType || '') || base.priority !== draft.priority
            || (base.workCenterId || '') !== (draft.workCenterId || '');
    }, [request, draft]);

    const guard = (go: () => void) => (dirty ? setPendingLeave(() => go) : go());
    // Esc reaches the drawer too; a dialog open on top of it gets that key first.
    const close = () => { if (rejectOpen || deleteOpen || pendingLeave) return; guard(onClose); };
    const step = (d: 1 | -1) => guard(() => onStep(d));

    // J / K step through the queue, as in a mail client.
    useEffect(() => {
        if (!request) return;
        const onKey = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement | null;
            if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            if (e.key === 'j' || e.key === 'J') { e.preventDefault(); step(1); }
            if (e.key === 'k' || e.key === 'K') { e.preventDefault(); step(-1); }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    });

    if (!request || !draft) return null;

    const r = request;
    const isApprovedLegacy = r.status === RequestStatus.APPROVED;
    const closed = r.status === RequestStatus.CONVERTED || r.status === RequestStatus.REJECTED || isApprovedLegacy;
    const isEditable = canEdit && (r.status === RequestStatus.NEW || r.status === RequestStatus.REVIEW);
    const stepIdx = STEPS.findIndex(s => s.status === (isApprovedLegacy ? RequestStatus.CONVERTED : r.status));
    const plant = plantOf(r);

    const run = async (fn: () => Promise<void>) => {
        setBusy(true);
        try { await fn(); } catch (e: any) { showToast(e?.message || 'That did not go through.', 'error'); } finally { setBusy(false); }
    };
    const saveIfDirty = async () => { if (dirty) await onSave(r, draft); };

    const save = () => run(async () => { await onSave(r, draft); showToast('Request saved.', 'success'); });
    const advance = (to: RequestStatus, extra?: Record<string, unknown>) => run(async () => {
        await saveIfDirty();
        const wo = await onTransition(r.id, to, extra);
        if (to === RequestStatus.CONVERTED) showToast(`Approved — work order ${wo || ''} created.`, 'success');
    });
    const reject = () => run(async () => {
        if (!reason.trim()) { showToast('Give a reason for the rejection.', 'warning'); return; }
        await saveIfDirty();
        await onTransition(r.id, RequestStatus.REJECTED, { rejection_reason: reason.trim() });
        setRejectOpen(false);
        setReason('');
    });
    const remove = () => run(async () => { await onDelete(r.id); setDeleteOpen(false); });

    // Authorizing a request you raised yourself is a matrix permission
    // (Requests › Authorize own) — on for supervisors by default. Admins are
    // exempt. The database enforces the same rule (0400).
    const isAdmin = ['SUPER_ADMIN', 'SYS_ADMIN'].includes(String(role || '').toUpperCase());
    const ownRequest = !!user?.id && r.requesterId === user.id;
    const blockedOwn = r.status === RequestStatus.REVIEW && canAuthorize && ownRequest
        && permissions?.requests?.authorizeOwn !== true && !isAdmin;
    // An Emergency does not wait in the approval queue: whoever may approve
    // raises the order straight from New or Review and the manager reviews
    // it afterwards. The approver is recorded as the authorizer.
    const fastTrack = r.priority === 'EMERGENCY' && canApprove
        && (r.status === RequestStatus.NEW || r.status === RequestStatus.REVIEW);

    // The one forward step, if this caller may take it.
    const next = nextStep(r.status);
    const primary = fastTrack ? { label: 'Raise emergency work order', go: () => advance(RequestStatus.CONVERTED), cls: 'bg-red-600 hover:bg-red-700' } :
        blockedOwn ? null :
        next === 'REVIEW' && canEdit ? { label: 'Start review', go: () => advance(RequestStatus.REVIEW), cls: 'bg-slate-700 hover:bg-slate-800' } :
        next === 'AUTHORIZE' && canAuthorize ? { label: 'Authorize', go: () => advance(RequestStatus.AUTHORIZED, { authorized_by: user?.id, authorized_at: new Date().toISOString() }), cls: 'bg-primary-600 hover:bg-primary-500' } :
        next === 'APPROVE' && canApprove ? { label: 'Approve & create work order', go: () => advance(RequestStatus.CONVERTED), cls: 'bg-green-600 hover:bg-green-700' } :
        null;
    const waitingOn = blockedOwn ? 'someone else to authorize — your role cannot authorize a request you raised'
        : next && !primary
        ? { REVIEW: 'a reviewer', AUTHORIZE: 'someone who can authorize', APPROVE: 'someone who can approve' }[next]
        : null;
    const canReject = canEdit && (r.status === RequestStatus.REVIEW || r.status === RequestStatus.AUTHORIZED);

    const footer = closed ? null : (
        <div className="flex items-center gap-2 w-full">
            {canDelete && (
                <button type="button" onClick={() => setDeleteOpen(true)} disabled={busy} className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50" aria-label="Delete request" title="Delete request">
                    <Trash2 size={16} />
                </button>
            )}
            {dirty && (
                <button type="button" onClick={save} disabled={busy} className="px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    Save changes
                </button>
            )}
            <span className="flex-1" />
            {canReject && (
                <button type="button" onClick={() => setRejectOpen(true)} disabled={busy} className="px-3 py-2 text-sm font-medium rounded-lg border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50">
                    Reject
                </button>
            )}
            {primary ? (
                <button type="button" onClick={primary.go} disabled={busy} className={cn('px-4 py-2 text-sm font-semibold rounded-lg text-white disabled:opacity-50', primary.cls)}>
                    {busy ? 'Working…' : primary.label}
                </button>
            ) : waitingOn ? (
                <span className="text-xs text-slate-500">Waiting on {waitingOn}</span>
            ) : null}
        </div>
    );

    const headerActions = position && position.total > 1 ? (
        <div className="flex items-center gap-0.5 mr-1 text-xs text-slate-500">
            <button type="button" onClick={() => step(-1)} disabled={position.index <= 0} className="p-1 rounded hover:bg-slate-100 disabled:opacity-30" aria-label="Previous request" title="Previous (K)">
                <ChevronLeft size={18} />
            </button>
            <span className="tabular-nums whitespace-nowrap">{position.index + 1} / {position.total}</span>
            <button type="button" onClick={() => step(1)} disabled={position.index >= position.total - 1} className="p-1 rounded hover:bg-slate-100 disabled:opacity-30" aria-label="Next request" title="Next (J)">
                <ChevronRight size={18} />
            </button>
        </div>
    ) : null;

    return (
        <>
            <Drawer
                open
                onClose={close}
                width="xl"
                title={<span className="font-mono">{r.requestNumber}</span>}
                subtitle={[r.assetName, plant !== 'Unassigned' ? plant : null].filter(Boolean).join(' · ') || undefined}
                headerActions={headerActions}
                footer={footer}
            >
                <div className="p-4 md:p-5 space-y-4">
                    {/* Where it is in the workflow — read-only; the buttons move it. */}
                    {r.status === RequestStatus.REJECTED ? (
                        <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-start gap-3">
                            <Ban size={18} className="text-slate-500 mt-0.5 flex-shrink-0" />
                            <div className="min-w-0">
                                <div className="text-sm font-bold text-slate-800">Rejected</div>
                                <div className="text-sm text-slate-600 mt-0.5 break-words">{r.rejectionReason || 'No reason recorded.'}</div>
                            </div>
                        </div>
                    ) : (
                        <div className="rounded-xl border border-slate-200 bg-white p-3">
                            <ol className="flex items-center gap-1">
                                {STEPS.map((s, i) => {
                                    const done = i < stepIdx || (i === stepIdx && closed);
                                    const current = i === stepIdx && !closed;
                                    return (
                                        <li key={s.status} className="flex-1 flex items-center gap-1 min-w-0">
                                            <span className={cn(
                                                'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0',
                                                done ? 'bg-green-600 text-white' : current ? 'bg-primary-600 text-white' : 'bg-slate-200 text-slate-500'
                                            )}>
                                                {done ? <Check size={12} /> : i + 1}
                                            </span>
                                            <span className={cn('text-xs truncate', current ? 'font-semibold text-slate-900' : 'hidden sm:inline text-slate-500')}>{s.label}</span>
                                            {i < STEPS.length - 1 && <span className="flex-1 h-px bg-slate-200 min-w-[8px]" />}
                                        </li>
                                    );
                                })}
                            </ol>
                            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500">
                                <span className="inline-flex items-center gap-1"><Clock size={12} /> Raised {ageLabel(r.createdAt)} ago</span>
                                {!closed && <DueLabel request={r} />}
                            </div>
                        </div>
                    )}

                    {(r.status === RequestStatus.CONVERTED || isApprovedLegacy) && r.linkedWOId && (
                        <button
                            type="button"
                            onClick={() => onOpenWO(r.linkedWOId!)}
                            className="w-full rounded-xl border border-green-200 bg-green-50 p-4 flex items-center gap-3 text-left hover:bg-green-100 transition"
                        >
                            <span className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0"><Check size={18} className="text-green-700" /></span>
                            <span className="flex-1 min-w-0">
                                <span className="block text-sm font-bold text-green-900">Work order {r.linkedWONumber || ''}</span>
                                <span className="block text-xs text-green-700">{r.linkedWOStatus ? woStatusLabel(r.linkedWOStatus) : 'Created from this request'}</span>
                            </span>
                            <ExternalLink size={16} className="text-green-700" />
                        </button>
                    )}

                    {dupCount > 0 && !closed && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 flex items-center gap-2 text-sm text-amber-900">
                            <Copy size={15} className="flex-shrink-0" />
                            <span className="flex-1">{dupCount} other open request{dupCount > 1 ? 's' : ''} on this asset — possibly the same problem.</span>
                            <button type="button" onClick={() => guard(() => onShowDuplicates(r))} className="text-xs font-semibold underline whitespace-nowrap">Show them</button>
                        </div>
                    )}

                    {/* What is wrong */}
                    <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
                        <div>
                            <Label>What is wrong</Label>
                            {isEditable ? (
                                <textarea
                                    value={draft.description}
                                    onChange={e => setDraft({ ...draft, description: e.target.value })}
                                    rows={4}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm resize-y focus:ring-1 focus:ring-primary-500 focus:outline-none"
                                />
                            ) : (
                                <p className="text-sm text-slate-800 whitespace-pre-wrap break-words">{r.description}</p>
                            )}
                        </div>

                        <label className={cn('flex items-center gap-2 text-sm', isEditable ? 'text-slate-700 cursor-pointer' : 'text-slate-500')}>
                            <input
                                type="checkbox"
                                checked={draft.isBreakdown}
                                disabled={!isEditable}
                                onChange={e => setDraft({ ...draft, isBreakdown: e.target.checked })}
                                className="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500 disabled:opacity-50"
                            />
                            <AlertOctagon size={14} className={draft.isBreakdown ? 'text-red-600' : 'text-slate-400'} />
                            Equipment stopped (breakdown)
                        </label>

                        <div>
                            <Label>Fault type</Label>
                            <FunctionalFailureSelector
                                value={draft.functionalFailureType}
                                onChange={code => setDraft({ ...draft, functionalFailureType: code })}
                                readOnly={!isEditable}
                                assetClassCode={assetClassCode}
                            />
                        </div>
                    </section>

                    {/* Priority */}
                    <section className="rounded-xl border border-slate-200 bg-white p-4">
                        <Label>Priority</Label>
                        <div className="flex flex-wrap gap-2">
                            {PRIORITIES.map(p => {
                                const on = draft.priority === p;
                                return (
                                    <button
                                        key={p}
                                        type="button"
                                        disabled={!isEditable}
                                        onClick={() => setDraft({ ...draft, priority: p })}
                                        aria-pressed={on}
                                        className={cn(
                                            'px-3 py-1.5 rounded-lg border text-xs font-semibold transition',
                                            on ? PRIORITY_ON[p] : 'bg-white border-slate-300 text-slate-600',
                                            isEditable && !on && 'hover:bg-slate-50',
                                            !isEditable && !on && 'opacity-50'
                                        )}
                                    >
                                        {p.charAt(0) + p.slice(1).toLowerCase()}
                                    </button>
                                );
                            })}
                        </div>
                        <p className="mt-2 text-xs text-slate-500">
                            Respond within {hoursLabel(REQUEST_RESPONSE_HOURS[draft.priority])} of raising.
                            {' '}Risk score {r.aiRiskScore ?? 0} (asset criticality × failure severity)
                            {draft.priority !== r.priority && ' — saving moves the score into the chosen band.'}
                        </p>
                    </section>

                    {/* Where and who */}
                    <section className="rounded-xl border border-slate-200 bg-white p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="min-w-0">
                            <Label>Asset</Label>
                            <div className="text-sm font-medium text-slate-800">{r.assetName || '—'}</div>
                            {r.location && r.location !== 'Unknown' && (
                                <div className="mt-0.5 text-xs text-slate-500 flex items-start gap-1"><MapPin size={12} className="mt-0.5 flex-shrink-0" /><span className="break-words">{r.location}</span></div>
                            )}
                        </div>
                        <div className="min-w-0">
                            <Label>Raised by</Label>
                            <div className="text-sm text-slate-800 flex items-center gap-1.5"><User size={13} className="text-slate-400" />{r.requesterName}</div>
                            {r.requesterEmail && <a href={`mailto:${r.requesterEmail}`} className="text-xs text-primary-700 hover:underline break-all">{r.requesterEmail}</a>}
                            <div className="mt-0.5 text-xs text-slate-500">{new Date(r.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</div>
                        </div>
                        {r.authorizedBy && (
                            <div className="min-w-0">
                                <Label>Authorized by</Label>
                                <div className="text-sm text-slate-800">{r.authorizedByName || r.authorizedBy}</div>
                                {r.authorizedAt && <div className="text-xs text-slate-500">{new Date(r.authorizedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</div>}
                            </div>
                        )}
                        <div className="min-w-0">
                            <Label>Status</Label>
                            <div className="text-sm text-slate-800">{STATUS_LABEL[r.status]}</div>
                        </div>
                        {/* Who is told and who plans the work follows this. */}
                        <div className="min-w-0 sm:col-span-2">
                            <Label>Responsible department</Label>
                            {isEditable ? (
                                <select
                                    value={draft.workCenterId || ''}
                                    onChange={e => setDraft({ ...draft, workCenterId: e.target.value || undefined })}
                                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                                >
                                    <option value="">Not set — notices fall back to the org chart</option>
                                    {workCenters.map(w => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
                                </select>
                            ) : (
                                <div className="text-sm text-slate-800">
                                    {(() => { const w = workCenters.find(x => x.id === r.workCenterId); return w ? `${w.code} — ${w.name}` : 'Not set'; })()}
                                </div>
                            )}
                        </div>
                    </section>

                    <section className="rounded-xl border border-slate-200 bg-white p-4">
                        <ImageGallery entityId={r.id} entityType="SERVICE_REQUEST" bucket="assets" prefix="sr_" readonly={closed} />
                    </section>
                </div>
            </Drawer>

            <Modal
                open={rejectOpen}
                onClose={() => { setRejectOpen(false); setReason(''); }}
                title="Reject request"
                footer={
                    <>
                        <button type="button" onClick={() => { setRejectOpen(false); setReason(''); }} className="px-4 py-2 text-sm border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50">Cancel</button>
                        <button type="button" onClick={reject} disabled={busy || !reason.trim()} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
                            {busy ? 'Rejecting…' : 'Reject'}
                        </button>
                    </>
                }
            >
                <p className="text-sm text-slate-600 mb-3">The requester sees this reason. It is kept on the record.</p>
                <textarea
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    autoFocus
                    rows={4}
                    placeholder="e.g. Duplicate of REQ-2026-459238"
                    className="w-full p-3 border border-slate-300 rounded-lg text-sm resize-none focus:ring-2 focus:ring-red-500 focus:border-red-500 focus:outline-none"
                />
            </Modal>

            <ConfirmDialog
                open={deleteOpen}
                onCancel={() => setDeleteOpen(false)}
                onConfirm={remove}
                title="Delete request?"
                message={`${r.requestNumber} will be removed. This cannot be undone.`}
                variant="danger"
                confirmLabel="Delete"
                loading={busy}
            />

            <ConfirmDialog
                open={!!pendingLeave}
                onCancel={() => setPendingLeave(null)}
                onConfirm={() => { const go = pendingLeave; setPendingLeave(null); go?.(); }}
                title="Discard your changes?"
                message="You edited this request and have not saved it."
                variant="warning"
                confirmLabel="Discard"
            />
        </>
    );
};
