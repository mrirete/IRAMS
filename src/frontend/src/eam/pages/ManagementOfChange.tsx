import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import {
    Plus, FileText, Clock, CheckCircle, XCircle, AlertTriangle, Eye,
    ChevronDown, ChevronRight, Loader2, RefreshCw, Search, Filter,
    ArrowRight, Shield, Settings, X, Link2, UserCheck, UserPen
} from 'lucide-react';
import { DatabaseService } from '../services/DatabaseService';
import { AskRelanternButton } from '../components/AskRelanternButton';
import { aiContextService } from '../services/AIContextService';

// --- Types ---
interface MocRequest {
    id: string;
    moc_number: string;
    title: string;
    description: string | null;
    change_type: string;
    entity_type: string | null;
    entity_id: string | null;
    current_value: string | null;
    proposed_value: string | null;
    justification: string;
    risk_assessment: string | null;
    status: string;
    requested_by: string | null;
    reviewed_by: string | null;
    approved_by: string | null;
    submitted_at: string | null;
    reviewed_at: string | null;
    approved_at: string | null;
    implemented_at: string | null;
    review_notes: string | null;
    rejection_reason: string | null;
    approval_conditions: string | null;
    created_at: string;
    updated_at: string;
}

// --- Constants ---
const CHANGE_TYPES: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
    PM_INTERVAL: { label: 'PM Interval Change', icon: <Clock size={14} />, color: 'bg-blue-100 text-blue-700' },
    SET_POINT: { label: 'Set-Point Change', icon: <Settings size={14} />, color: 'bg-blue-100 text-blue-700' },
    DICTIONARY: { label: 'Dictionary Change', icon: <FileText size={14} />, color: 'bg-amber-100 text-amber-700' },
    ASSET_STRATEGY: { label: 'Asset Strategy', icon: <Shield size={14} />, color: 'bg-emerald-100 text-emerald-700' },
    SAFETY_PARAMETER: { label: 'Safety Parameter', icon: <AlertTriangle size={14} />, color: 'bg-red-100 text-red-700' },
    OPERATING_PROCEDURE: { label: 'Operating Procedure', icon: <FileText size={14} />, color: 'bg-blue-100 text-blue-700' },
    OTHER: { label: 'Other', icon: <FileText size={14} />, color: 'bg-slate-100 text-slate-700' },
};

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
    DRAFT: { bg: 'bg-slate-100', text: 'text-slate-700' },
    SUBMITTED: { bg: 'bg-blue-100', text: 'text-blue-700' },
    UNDER_REVIEW: { bg: 'bg-amber-100', text: 'text-amber-700' },
    APPROVED: { bg: 'bg-green-100', text: 'text-green-700' },
    REJECTED: { bg: 'bg-red-100', text: 'text-red-700' },
    IMPLEMENTED: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
    CLOSED: { bg: 'bg-slate-200', text: 'text-slate-600' },
    CANCELLED: { bg: 'bg-slate-200', text: 'text-slate-500' },
};

const STATUS_FLOW = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'IMPLEMENTED', 'CLOSED'];

// --- Main Page ---
export const ManagementOfChange: React.FC = () => {
    const { profile, permissions } = useAuth();
    const { showToast } = useToast();
    // ═══ RBAC Permission Extraction (ISO 27001 / NIST CSF) ═══
    const canCreate = permissions?.moc?.create === true;
    const canEdit = permissions?.moc?.edit === true;
    const canApprove = permissions?.moc?.approve === true;
    const [requests, setRequests] = useState<MocRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    // The open request follows the URL (/management-of-change/:id), so refresh,
    // Back and a copied link all land on it. Opening one used to rewrite the URL
    // to the list straight away.
    const [searchParams] = useSearchParams();
    const { id: mocIdParam } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [extraMoc, setExtraMoc] = useState<MocRequest | null>(null);
    const [filterStatus, setFilterStatus] = useState<string>('ALL');
    const [chip, setChip] = useState<'MINE' | 'RAISED' | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [userNames, setUserNames] = useState<Record<string, string>>({});
    const me = profile?.id || null;

    const fetchRequests = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const { data, error } = await supabase
                .from('moc_requests')
                .select('*')
                .order('created_at', { ascending: false });
            if (error) throw error;
            setRequests((data || []) as MocRequest[]);
        } catch (err: any) {
            console.error('Failed to fetch MoC requests:', err);
            setLoadError(err?.message || 'Requests could not be loaded.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchRequests();
        DatabaseService.getInstance().getUsers()
            .then((us: any[]) => setUserNames(Object.fromEntries(us.map(u => [u.id, u.fullName || u.full_name || u.username || u.email || 'User']))))
            .catch(() => { /* names are a nicety */ });
    }, [fetchRequests]);

    // Legacy ?moc=<id> links become the route.
    useEffect(() => {
        const legacy = searchParams.get('moc');
        if (legacy && !mocIdParam) navigate(`/management-of-change/${legacy}`, { replace: true });
    }, [searchParams, mocIdParam, navigate]);

    const selectedMoc = useMemo(
        () => (mocIdParam ? requests.find(r => r.id === mocIdParam) || (extraMoc?.id === mocIdParam ? extraMoc : null) : null),
        [mocIdParam, requests, extraMoc],
    );

    // A link to a request not in the list: fetch it on its own; say so if it is gone.
    useEffect(() => {
        if (!mocIdParam || loading || requests.some(r => r.id === mocIdParam) || extraMoc?.id === mocIdParam) return;
        supabase.from('moc_requests').select('*').eq('id', mocIdParam).maybeSingle().then(({ data }) => {
            if (data) setExtraMoc(data as MocRequest);
            else {
                showToast('That change request does not exist or is not visible to you.', 'warning');
                navigate('/management-of-change', { replace: true });
            }
        });
    }, [mocIdParam, loading, requests, extraMoc, navigate, showToast]);

    const openMoc = (m: MocRequest) => navigate(`/management-of-change/${m.id}`);
    const closeMoc = () => navigate('/management-of-change');

    // What this person can move on next (role- and four-eyes-aware).
    const needsMe = (m: MocRequest) =>
        (canApprove && (m.status === 'SUBMITTED' || (m.status === 'UNDER_REVIEW' && m.requested_by !== me)))
        || (canEdit && m.requested_by === me && ['DRAFT', 'REJECTED', 'APPROVED', 'IMPLEMENTED'].includes(m.status));

    const filteredRequests = requests.filter(r => {
        if (filterStatus !== 'ALL' && r.status !== filterStatus) return false;
        if (chip === 'MINE' && !needsMe(r)) return false;
        if (chip === 'RAISED' && r.requested_by !== me) return false;
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            return [r.moc_number, r.title, r.change_type, r.justification, r.description, userNames[r.requested_by || '']]
                .some(v => (v || '').toLowerCase().includes(term));
        }
        return true;
    });

    const APPROVER_STEPS = ['UNDER_REVIEW', 'APPROVED', 'REJECTED'];

    /** Moves a request on. Resolves true when it moved; the drawer stays open on the fresh row. */
    const handleStatusChange = async (moc: MocRequest, newStatus: string, extra: Partial<MocRequest> = {}): Promise<boolean> => {
        // ═══ RBAC Layer 2 (the database enforces the same rules from 0399) ═══
        const isApprovalAction = APPROVER_STEPS.includes(newStatus);
        if (isApprovalAction && !canApprove) {
            showToast('Reviewing, approving or rejecting a change needs Management of Change · Approve.', 'error');
            return false;
        }
        if (!isApprovalAction && !canEdit) {
            showToast('Moving a change on needs Management of Change · Edit.', 'error');
            return false;
        }
        if (newStatus === 'APPROVED' && moc.requested_by && moc.requested_by === me) {
            showToast('You raised this change; someone else must approve it.', 'error');
            return false;
        }
        if (newStatus === 'REJECTED' && !String(extra.rejection_reason || '').trim()) {
            showToast('Give a reason for the rejection.', 'warning');
            return false;
        }
        try {
            const now = new Date().toISOString();
            // Stamps are also set by the database trigger (0399), which wins.
            const updates: any = { ...extra, status: newStatus, updated_at: now };
            if (newStatus === 'SUBMITTED') updates.submitted_at = now;
            if (newStatus === 'UNDER_REVIEW') { updates.reviewed_by = me; updates.reviewed_at = now; }
            if (newStatus === 'APPROVED') { updates.approved_by = me; updates.approved_at = now; }
            if (newStatus === 'IMPLEMENTED') updates.implemented_at = now;
            if (newStatus === 'CLOSED') updates.closed_at = now;

            const { data, error } = await supabase.from('moc_requests').update(updates).eq('id', moc.id).select('id');
            if (error) throw error;
            if (!data || data.length === 0) throw new Error('Not changed: no permission, or the request no longer exists.');
            await fetchRequests();
            showToast(`${moc.moc_number} is now ${newStatus.replace(/_/g, ' ').toLowerCase()}.`, 'success');
            return true;
        } catch (err: any) {
            console.error('Failed to update MoC status:', err);
            showToast(err?.message || 'Failed to update status.', 'error');
            return false;
        }
    };

    return (
        <div className="ers-page-wide space-y-6">
            {/* Header */}
            <div className="flex justify-between items-end flex-wrap gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Management of Change (eMoC)</h1>
                    <p className="text-slate-500 text-sm">ISO 31000 • Change control for PM strategies, set-points, and configurations</p>
                </div>
                <div className="flex items-center gap-2">
                    <AskRelanternButton
                        contextType="moc"
                        contextSummary={aiContextService.buildMoCContext({
                            mocId: selectedMoc?.moc_number,
                            title: selectedMoc?.title,
                            status: selectedMoc?.status,
                            changeType: selectedMoc?.change_type,
                            riskLevel: selectedMoc?.risk_assessment ? 'Assessed' : 'Not Assessed',
                            description: selectedMoc?.description || selectedMoc?.justification,
                        })}
                    />
                    {canCreate ? (
                        <button
                            onClick={() => setShowCreateModal(true)}
                            className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium transition flex items-center gap-2 hover:bg-primary-500"
                        >
                            <Plus size={16} /> New MoC Request
                        </button>
                    ) : (
                        <span className="text-xs text-slate-500">Ask a planner or engineer to raise a change.</span>
                    )}
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3 items-center">
                <div className="relative flex-1 max-w-xs">
                    <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search MoC requests..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                </div>
                <select
                    value={filterStatus}
                    onChange={e => setFilterStatus(e.target.value)}
                    className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                    <option value="ALL">All Statuses</option>
                    {Object.keys(STATUS_STYLES).map(s => (
                        <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                    ))}
                </select>
                <button onClick={fetchRequests} className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition">
                    <RefreshCw size={16} />
                </button>
                {(canEdit || canApprove) && (
                    <button
                        onClick={() => setChip(chip === 'MINE' ? null : 'MINE')}
                        aria-pressed={chip === 'MINE'}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium ${chip === 'MINE' ? 'bg-slate-800 border-slate-800 text-white' : 'bg-primary-50 border-primary-200 text-primary-700 hover:bg-primary-100'}`}
                    >
                        <UserCheck size={13} /> Needs my action <span className="font-bold">{requests.filter(needsMe).length}</span>
                    </button>
                )}
                <button
                    onClick={() => setChip(chip === 'RAISED' ? null : 'RAISED')}
                    aria-pressed={chip === 'RAISED'}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium ${chip === 'RAISED' ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}
                >
                    <UserPen size={13} /> Raised by me <span className="font-bold">{requests.filter(r => r.requested_by === me).length}</span>
                </button>
                <span className="text-xs text-slate-400">{filteredRequests.length} requests</span>
            </div>

            {loadError && (
                <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-800 flex items-center justify-between gap-3">
                    <span>Change requests could not be loaded: {loadError}</span>
                    <button onClick={fetchRequests} className="px-3 py-1 rounded-md bg-white border border-red-300 text-red-700 text-xs font-semibold hover:bg-red-100">Retry</button>
                </div>
            )}

            {/* Status Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                {['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'IMPLEMENTED', 'CLOSED', 'REJECTED', 'CANCELLED'].map(status => {
                    const count = requests.filter(r => r.status === status).length;
                    const style = STATUS_STYLES[status];
                    return (
                        <button
                            key={status}
                            onClick={() => setFilterStatus(filterStatus === status ? 'ALL' : status)}
                            className={`p-3 rounded-lg border transition text-left ${filterStatus === status ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-200 hover:border-slate-300'
                                }`}
                        >
                            <p className="text-lg font-bold text-slate-900">{count}</p>
                            <p className="text-xs text-slate-500">{status.replace(/_/g, ' ')}</p>
                        </button>
                    );
                })}
            </div>

            {/* Request List */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="divide-y divide-slate-100">
                    {loading && requests.length === 0 ? (
                        <div className="p-12 flex items-center justify-center text-slate-500 text-sm">
                            <Loader2 size={20} className="animate-spin text-blue-600 mr-2" /> Loading change requests...
                        </div>
                    ) : loadError && requests.length === 0 ? null : filteredRequests.length === 0 ? (
                        <div className="p-12 text-center">
                            <FileText size={40} className="text-slate-300 mx-auto mb-3" />
                            <p className="text-slate-500">{requests.length === 0 ? 'No change requests yet' : 'No change requests match these filters'}</p>
                            {requests.length === 0 && <p className="text-xs text-slate-400 mt-1">Raise a request to track changes to PM intervals, set-points, or configurations.</p>}
                        </div>
                    ) : (
                        filteredRequests.map(moc => {
                            const changeInfo = CHANGE_TYPES[moc.change_type] || CHANGE_TYPES.OTHER;
                            const statusStyle = STATUS_STYLES[moc.status] || STATUS_STYLES.DRAFT;

                            return (
                                <div
                                    key={moc.id}
                                    onClick={() => openMoc(moc)}
                                    className="p-4 flex items-center gap-4 hover:bg-slate-50 transition cursor-pointer"
                                >
                                    <div className={`p-2 rounded-lg ${changeInfo.color}`}>
                                        {changeInfo.icon}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-0.5">
                                            <span className="text-xs font-mono text-slate-400">{moc.moc_number}</span>
                                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusStyle.bg} ${statusStyle.text}`}>
                                                {moc.status.replace(/_/g, ' ')}
                                            </span>
                                            <span className={`text-xs px-2 py-0.5 rounded ${changeInfo.color}`}>
                                                {changeInfo.label}
                                            </span>
                                        </div>
                                        <h4 className="text-sm font-semibold text-slate-900 truncate">{moc.title}</h4>
                                        <p className="text-xs text-slate-500 truncate mt-0.5">{moc.justification}</p>
                                    </div>
                                    <span className="text-xs text-slate-400 whitespace-nowrap">
                                        {new Date(moc.created_at).toLocaleDateString()}
                                    </span>
                                    <ChevronRight size={16} className="text-slate-300" />
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Detail Drawer */}
            {selectedMoc && (
                <MocDetailDrawer
                    moc={selectedMoc}
                    me={me}
                    userNames={userNames}
                    canEdit={canEdit}
                    canApprove={canApprove}
                    onClose={closeMoc}
                    onStatusChange={handleStatusChange}
                />
            )}

            {/* Create Modal */}
            {showCreateModal && (
                <CreateMocModal
                    onClose={() => setShowCreateModal(false)}
                    onCreated={() => {
                        setShowCreateModal(false);
                        fetchRequests();
                    }}
                />
            )}
        </div>
    );
};

// --- Detail Drawer ---
const STEP_LABEL: Record<string, string> = {
    DRAFT: 'Draft', SUBMITTED: 'Submitted', UNDER_REVIEW: 'Under review', APPROVED: 'Approved',
    IMPLEMENTED: 'Implemented', CLOSED: 'Closed', REJECTED: 'Rejected', CANCELLED: 'Cancelled',
};
const fmtWhen = (d: string | null) => (d ? new Date(d).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : null);

const MocDetailDrawer: React.FC<{
    moc: MocRequest;
    me: string | null;
    userNames: Record<string, string>;
    canEdit: boolean;
    canApprove: boolean;
    onClose: () => void;
    onStatusChange: (moc: MocRequest, newStatus: string, extra?: Partial<MocRequest>) => Promise<boolean>;
}> = ({ moc, me, userNames, canEdit, canApprove, onClose, onStatusChange }) => {
    const changeInfo = CHANGE_TYPES[moc.change_type] || CHANGE_TYPES.OTHER;
    const statusStyle = STATUS_STYLES[moc.status] || STATUS_STYLES.DRAFT;
    const [busy, setBusy] = useState(false);
    const [rejecting, setRejecting] = useState(false);
    const [reason, setReason] = useState('');
    const [conditions, setConditions] = useState('');
    const isMine = !!me && moc.requested_by === me;
    const who = (id: string | null) => (id ? (id === me ? 'you' : userNames[id] || 'a colleague') : null);

    useEffect(() => { setRejecting(false); setReason(''); setConditions(''); }, [moc.id, moc.status]);
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose, busy]);

    const go = async (status: string, extra?: Partial<MocRequest>) => {
        setBusy(true);
        try { await onStatusChange(moc, status, extra); } finally { setBusy(false); }
    };

    // The one forward step and who may take it (the database enforces the same, 0399).
    const forward: { to: string; label: string; allowed: boolean; why?: string } | null = (() => {
        switch (moc.status) {
            case 'DRAFT': return { to: 'SUBMITTED', label: 'Submit for review', allowed: canEdit };
            case 'SUBMITTED': return { to: 'UNDER_REVIEW', label: 'Start review', allowed: canApprove };
            case 'UNDER_REVIEW': return isMine
                ? { to: 'APPROVED', label: 'Approve', allowed: false, why: 'You raised this change; someone else must approve it.' }
                : { to: 'APPROVED', label: 'Approve', allowed: canApprove };
            case 'APPROVED': return { to: 'IMPLEMENTED', label: 'Mark implemented', allowed: canEdit };
            case 'IMPLEMENTED': return { to: 'CLOSED', label: 'Close', allowed: canEdit };
            default: return null;
        }
    })();
    const canReject = canApprove && ['SUBMITTED', 'UNDER_REVIEW'].includes(moc.status);
    const canReturn = canEdit && ['SUBMITTED', 'REJECTED'].includes(moc.status);
    const canCancel = canEdit && ['DRAFT', 'SUBMITTED', 'REJECTED', 'APPROVED'].includes(moc.status);

    const flowIdx = STATUS_FLOW.indexOf(moc.status);
    const ended = moc.status === 'REJECTED' || moc.status === 'CANCELLED';

    const timeline = [
        { label: 'Raised', by: who(moc.requested_by), at: fmtWhen(moc.created_at) },
        { label: 'Submitted', by: null, at: fmtWhen(moc.submitted_at) },
        { label: 'Reviewed', by: who(moc.reviewed_by), at: fmtWhen(moc.reviewed_at) },
        { label: 'Approved', by: who(moc.approved_by), at: fmtWhen(moc.approved_at) },
        { label: 'Implemented', by: null, at: fmtWhen(moc.implemented_at) },
    ].filter(t => t.at);

    return (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => !busy && onClose()}>
            <div className="absolute inset-0 bg-black/30" />
            <div
                role="dialog"
                aria-modal="true"
                className="relative w-full max-w-lg bg-white shadow-xl overflow-y-auto flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-4 flex justify-between items-start gap-3 z-10">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                            <span className="text-xs font-mono text-slate-400">{moc.moc_number}</span>
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusStyle.bg} ${statusStyle.text}`}>
                                {STEP_LABEL[moc.status] || moc.status}
                            </span>
                        </div>
                        <h2 className="text-lg font-bold text-slate-900 break-words">{moc.title}</h2>
                    </div>
                    <button onClick={onClose} className="p-2 -mr-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100" aria-label="Close">
                        <X size={20} />
                    </button>
                </div>

                <div className="px-5 py-4 space-y-5 flex-1">
                    {/* Where it is — wraps on a phone; a rejected or cancelled change says so */}
                    {ended ? (
                        <div className={`rounded-lg p-3 ${moc.status === 'REJECTED' ? 'bg-red-50' : 'bg-slate-100'}`}>
                            <p className={`text-sm font-semibold ${moc.status === 'REJECTED' ? 'text-red-800' : 'text-slate-700'}`}>{STEP_LABEL[moc.status]}</p>
                            {moc.rejection_reason && <p className="text-sm text-red-700 mt-1 break-words">{moc.rejection_reason}</p>}
                        </div>
                    ) : (
                        <div>
                            <p className="text-xs text-slate-500 mb-2">Step {flowIdx + 1} of {STATUS_FLOW.length}</p>
                            <ol className="flex flex-wrap gap-1.5">
                                {STATUS_FLOW.map((step, i) => (
                                    <li key={step} className={`px-2 py-1 rounded text-xs font-medium ${i === flowIdx ? 'bg-primary-600 text-white' : i < flowIdx ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400'}`}>
                                        {STEP_LABEL[step]}
                                    </li>
                                ))}
                            </ol>
                        </div>
                    )}

                    {moc.description && (
                        <div>
                            <label className="text-xs text-slate-500">What changes</label>
                            <p className="text-sm text-slate-800 mt-1 whitespace-pre-wrap break-words">{moc.description}</p>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs text-slate-500">Change type</label>
                            <div className={`mt-1 inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded ${changeInfo.color}`}>
                                {changeInfo.icon} {changeInfo.label}
                            </div>
                        </div>
                        {moc.entity_type && (
                            <div>
                                <label className="text-xs text-slate-500">Linked to</label>
                                <p className="mt-1 text-sm text-slate-800 flex items-center gap-1">
                                    <Link2 size={13} className="text-slate-400" />
                                    {moc.entity_type === 'rca_corrective_action' ? 'RCA corrective action' : moc.entity_type.replace(/_/g, ' ')}
                                </p>
                            </div>
                        )}
                    </div>

                    {(moc.current_value || moc.proposed_value) && (
                        <div className="bg-slate-50 rounded-lg p-4 space-y-3">
                            {moc.current_value && (
                                <div>
                                    <label className="text-xs text-slate-500">Current value</label>
                                    <p className="text-sm text-red-700 font-mono bg-red-50 px-2 py-1 rounded mt-0.5 break-words">{moc.current_value}</p>
                                </div>
                            )}
                            {moc.proposed_value && (
                                <div>
                                    <label className="text-xs text-slate-500">Proposed value</label>
                                    <p className="text-sm text-green-700 font-mono bg-green-50 px-2 py-1 rounded mt-0.5 break-words">{moc.proposed_value}</p>
                                </div>
                            )}
                        </div>
                    )}

                    <div>
                        <label className="text-xs text-slate-500">Justification</label>
                        <p className="text-sm text-slate-700 mt-1 whitespace-pre-wrap break-words">{moc.justification}</p>
                    </div>

                    {moc.risk_assessment && (
                        <div>
                            <label className="text-xs text-slate-500">Risk assessment</label>
                            <p className="text-sm text-slate-700 mt-1 whitespace-pre-wrap break-words">{moc.risk_assessment}</p>
                        </div>
                    )}
                    {moc.approval_conditions && (
                        <div className="bg-amber-50 rounded-lg p-3">
                            <label className="text-xs text-amber-700 font-semibold">Approval conditions</label>
                            <p className="text-sm text-amber-900 mt-1 whitespace-pre-wrap break-words">{moc.approval_conditions}</p>
                        </div>
                    )}
                    {moc.review_notes && (
                        <div>
                            <label className="text-xs text-slate-500">Review notes</label>
                            <p className="text-sm text-slate-700 mt-1 whitespace-pre-wrap break-words">{moc.review_notes}</p>
                        </div>
                    )}

                    {/* Who and when */}
                    {timeline.length > 0 && (
                        <div>
                            <label className="text-xs text-slate-500">History</label>
                            <ol className="mt-1 space-y-1">
                                {timeline.map(t => (
                                    <li key={t.label} className="text-xs text-slate-600">
                                        <span className="font-semibold text-slate-800">{t.label}</span>{t.by ? ` by ${t.by}` : ''} · {t.at}
                                    </li>
                                ))}
                            </ol>
                        </div>
                    )}
                </div>

                {/* Actions — only what this role may do at this step */}
                {(forward || canReject || canReturn || canCancel) && (
                    <div className="sticky bottom-0 bg-white border-t border-slate-100 px-5 py-3 space-y-3">
                        {rejecting ? (
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-slate-600">Why is this change rejected? (the requester sees this)</label>
                                <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} autoFocus
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-200" />
                                <div className="flex gap-2 justify-end">
                                    <button onClick={() => { setRejecting(false); setReason(''); }} className="px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Back</button>
                                    <button onClick={() => go('REJECTED', { rejection_reason: reason.trim() })} disabled={busy || !reason.trim()}
                                        className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                                        {busy ? 'Rejecting...' : 'Reject change'}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <>
                                {forward?.to === 'APPROVED' && forward.allowed && (
                                    <textarea value={conditions} onChange={e => setConditions(e.target.value)} rows={2}
                                        placeholder="Conditions of approval (optional) — e.g. revert if vibration exceeds 7 mm/s"
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                                )}
                                {forward && !forward.allowed && forward.why && <p className="text-xs text-amber-700">{forward.why}</p>}
                                <div className="flex flex-wrap gap-2">
                                    {forward && forward.allowed && (
                                        <button
                                            onClick={() => go(forward.to, forward.to === 'APPROVED' && conditions.trim() ? { approval_conditions: conditions.trim() } : undefined)}
                                            disabled={busy}
                                            className="flex-1 min-w-[10rem] px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-500 transition flex items-center justify-center gap-2 disabled:opacity-50"
                                        >
                                            <ArrowRight size={16} /> {busy ? 'Working...' : forward.label}
                                        </button>
                                    )}
                                    {canReject && (
                                        <button onClick={() => setRejecting(true)} disabled={busy}
                                            className="px-4 py-2 border border-red-300 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition">
                                            Reject
                                        </button>
                                    )}
                                    {canReturn && (
                                        <button onClick={() => go('DRAFT')} disabled={busy}
                                            className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition">
                                            Return to draft
                                        </button>
                                    )}
                                    {canCancel && (
                                        <button onClick={() => { if (window.confirm(`Cancel ${moc.moc_number}? This cannot be undone.`)) go('CANCELLED'); }} disabled={busy}
                                            className="px-4 py-2 text-slate-500 rounded-lg text-sm font-medium hover:bg-slate-100 transition">
                                            Cancel request
                                        </button>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

// --- Create Modal ---
const CreateMocModal: React.FC<{
    onClose: () => void;
    onCreated: () => void;
}> = ({ onClose, onCreated }) => {
    const { profile, permissions } = useAuth();
    // ═══ RBAC Permission Extraction (ISO 27001 / NIST CSF) ═══
    const canCreate = permissions?.moc?.create === true;
    const { showToast } = useToast();
    const [form, setForm] = useState({
        title: '',
        change_type: 'PM_INTERVAL',
        justification: '',
        current_value: '',
        proposed_value: '',
        risk_assessment: '',
        description: '',
    });
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.title.trim() || !form.justification.trim()) return;

        // ═══ RBAC Layer 2: Submit-level guard (defense-in-depth) ═══
        if (!canCreate) {
            console.warn('[RBAC-AUDIT] BLOCKED: moc.create attempt by unauthorized user', profile?.username);
            showToast('Access Denied: You do not have permission to create MoC requests.', 'error');
            return;
        }

        setSaving(true);
        try {
            const { error } = await supabase.from('moc_requests').insert({
                ...form,
                moc_number: '', // stamped MOC-YYMM-NNNN by trg_moc_requests_number (0330)
                status: 'DRAFT',
                requested_by: profile?.id || null,
            });
            if (error) throw error;
            onCreated();
        } catch (err) {
            console.error('Failed to create MoC:', err);
            showToast('Failed to create MoC: ' + ((err as any)?.message || 'unknown error'), 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            onClick={() => {
                // A tap outside used to throw away a half-filled form.
                const filled = Object.entries(form).some(([k, v]) => k !== 'change_type' && String(v).trim());
                if (!filled || window.confirm('Discard this change request?')) onClose();
            }}
        >
            <div className="absolute inset-0 bg-black/40" />
            <div
                className="relative bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
                onClick={e => e.stopPropagation()}
            >
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
                    <h2 className="text-lg font-bold text-slate-900">New Management of Change Request</h2>
                    <button type="button" onClick={onClose} className="p-2 -mr-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100" aria-label="Close"><X size={20} /></button>
                </div>

                <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
                    <div>
                        <label className="text-sm font-medium text-slate-700">Title *</label>
                        <input
                            type="text"
                            value={form.title}
                            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                            className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                            placeholder="e.g., Extend PM interval for P-101-A from 3 to 6 months"
                            required
                        />
                    </div>

                    <div>
                        <label className="text-sm font-medium text-slate-700">Change Type *</label>
                        <select
                            value={form.change_type}
                            onChange={e => setForm(f => ({ ...f, change_type: e.target.value }))}
                            className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                        >
                            {Object.entries(CHANGE_TYPES).map(([key, info]) => (
                                <option key={key} value={key}>{info.label}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="text-sm font-medium text-slate-700">What changes</label>
                        <textarea
                            value={form.description}
                            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                            className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 h-20"
                            placeholder="Describe the change: which asset, PM or parameter, and how."
                        />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label className="text-sm font-medium text-slate-700">Current Value</label>
                            <input
                                type="text"
                                value={form.current_value}
                                onChange={e => setForm(f => ({ ...f, current_value: e.target.value }))}
                                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                                placeholder="e.g., 90 days"
                            />
                        </div>
                        <div>
                            <label className="text-sm font-medium text-slate-700">Proposed Value</label>
                            <input
                                type="text"
                                value={form.proposed_value}
                                onChange={e => setForm(f => ({ ...f, proposed_value: e.target.value }))}
                                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                                placeholder="e.g., 180 days"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="text-sm font-medium text-slate-700">Justification *</label>
                        <textarea
                            value={form.justification}
                            onChange={e => setForm(f => ({ ...f, justification: e.target.value }))}
                            className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 h-20"
                            placeholder="Why is this change necessary? Include supporting data."
                            required
                        />
                    </div>

                    <div>
                        <label className="text-sm font-medium text-slate-700">Risk Assessment</label>
                        <textarea
                            value={form.risk_assessment}
                            onChange={e => setForm(f => ({ ...f, risk_assessment: e.target.value }))}
                            className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 h-16"
                            placeholder="What are the risks of this change? Mitigation steps?"
                        />
                    </div>

                    <div className="flex gap-2 pt-2">
                        <button
                            type="submit"
                            disabled={saving}
                            className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-500 transition disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                            {saving ? 'Creating...' : 'Create MoC Request'}
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition"
                        >
                            Cancel
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
