import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
    Plus, FileText, Clock, CheckCircle, XCircle, AlertTriangle, Eye,
    ChevronDown, ChevronRight, Loader2, RefreshCw, Search, Filter,
    ArrowRight, Shield, Settings
} from 'lucide-react';
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
    SET_POINT: { label: 'Set-Point Change', icon: <Settings size={14} />, color: 'bg-purple-100 text-purple-700' },
    DICTIONARY: { label: 'Dictionary Change', icon: <FileText size={14} />, color: 'bg-amber-100 text-amber-700' },
    ASSET_STRATEGY: { label: 'Asset Strategy', icon: <Shield size={14} />, color: 'bg-emerald-100 text-emerald-700' },
    SAFETY_PARAMETER: { label: 'Safety Parameter', icon: <AlertTriangle size={14} />, color: 'bg-red-100 text-red-700' },
    OPERATING_PROCEDURE: { label: 'Operating Procedure', icon: <FileText size={14} />, color: 'bg-indigo-100 text-indigo-700' },
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
    // ═══ RBAC Permission Extraction (ISO 27001 / NIST CSF) ═══
    const canCreate = permissions?.moc?.create === true;
    const canEdit = permissions?.moc?.edit === true;
    const canApprove = permissions?.moc?.approve === true;
    const [requests, setRequests] = useState<MocRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [selectedMoc, setSelectedMoc] = useState<MocRequest | null>(null);
    const [filterStatus, setFilterStatus] = useState<string>('ALL');
    const [searchTerm, setSearchTerm] = useState('');

    const fetchRequests = useCallback(async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('moc_requests')
                .select('*')
                .order('created_at', { ascending: false });
            if (error) throw error;
            setRequests((data || []) as MocRequest[]);
        } catch (err) {
            console.error('Failed to fetch MoC requests:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchRequests();
    }, [fetchRequests]);

    const filteredRequests = requests.filter(r => {
        if (filterStatus !== 'ALL' && r.status !== filterStatus) return false;
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            return (
                r.moc_number.toLowerCase().includes(term) ||
                r.title.toLowerCase().includes(term) ||
                r.change_type.toLowerCase().includes(term)
            );
        }
        return true;
    });

    const handleStatusChange = async (moc: MocRequest, newStatus: string) => {
        // ═══ RBAC Layer 2: Submit-level guard (ISO 27001 / NIST CSF) ═══
        const isApprovalAction = ['APPROVED', 'REJECTED', 'UNDER_REVIEW'].includes(newStatus);
        if (isApprovalAction && !canApprove) {
            console.warn('[RBAC-AUDIT] BLOCKED: moc.approve attempt by unauthorized user', profile?.username);
            alert('⛔ Access Denied: You do not have permission to approve/reject MoC requests.');
            return;
        }
        if (!isApprovalAction && !canEdit) {
            console.warn('[RBAC-AUDIT] BLOCKED: moc.statusChange attempt by unauthorized user', profile?.username);
            alert('⛔ Access Denied: You do not have permission to update MoC status.');
            return;
        }
        try {
            const updates: any = { status: newStatus, updated_at: new Date().toISOString() };

            if (newStatus === 'SUBMITTED') updates.submitted_at = new Date().toISOString();
            if (newStatus === 'UNDER_REVIEW') updates.reviewed_by = profile?.id;
            if (newStatus === 'APPROVED') {
                updates.approved_by = profile?.id;
                updates.approved_at = new Date().toISOString();
            }
            if (newStatus === 'IMPLEMENTED') updates.implemented_at = new Date().toISOString();
            if (newStatus === 'CLOSED') updates.closed_at = new Date().toISOString();

            const { error } = await supabase
                .from('moc_requests')
                .update(updates)
                .eq('id', moc.id);

            if (error) throw error;
            await fetchRequests();
            setSelectedMoc(null);
        } catch (err) {
            console.error('Failed to update MoC status:', err);
            alert('Failed to update status. See console for details.');
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-96">
                <Loader2 size={32} className="animate-spin text-blue-600" />
                <span className="ml-3 text-slate-500">Loading Management of Change...</span>
            </div>
        );
    }

    return (
        <div className="space-y-6">
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
                    <button
                        onClick={() => setShowCreateModal(true)}
                        disabled={!canCreate}
                        className={`px-4 py-2 bg-relantern-500 text-white rounded-lg text-sm font-medium transition flex items-center gap-2 ${!canCreate ? 'opacity-50 cursor-not-allowed' : 'hover:bg-relantern-600'}`}
                        title={!canCreate ? 'Insufficient permissions' : 'Create new MoC request'}
                    >
                        <Plus size={16} /> New MoC Request
                    </button>
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
                <span className="text-xs text-slate-400">{filteredRequests.length} requests</span>
            </div>

            {/* Status Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                {['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'IMPLEMENTED', 'CLOSED'].map(status => {
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
                    {filteredRequests.length === 0 ? (
                        <div className="p-12 text-center">
                            <FileText size={40} className="text-slate-300 mx-auto mb-3" />
                            <p className="text-slate-500">No MoC requests found</p>
                            <p className="text-xs text-slate-400 mt-1">Create a new request to track changes to PM intervals, set-points, or configurations.</p>
                        </div>
                    ) : (
                        filteredRequests.map(moc => {
                            const changeInfo = CHANGE_TYPES[moc.change_type] || CHANGE_TYPES.OTHER;
                            const statusStyle = STATUS_STYLES[moc.status] || STATUS_STYLES.DRAFT;

                            return (
                                <div
                                    key={moc.id}
                                    onClick={() => setSelectedMoc(moc)}
                                    className="p-4 flex items-center gap-4 hover:bg-slate-50 transition cursor-pointer"
                                >
                                    <div className={`p-2 rounded-lg ${changeInfo.color}`}>
                                        {changeInfo.icon}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-0.5">
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
                    onClose={() => setSelectedMoc(null)}
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
const MocDetailDrawer: React.FC<{
    moc: MocRequest;
    onClose: () => void;
    onStatusChange: (moc: MocRequest, newStatus: string) => void;
}> = ({ moc, onClose, onStatusChange }) => {
    const changeInfo = CHANGE_TYPES[moc.change_type] || CHANGE_TYPES.OTHER;
    const statusStyle = STATUS_STYLES[moc.status] || STATUS_STYLES.DRAFT;

    const nextStatus = (() => {
        const idx = STATUS_FLOW.indexOf(moc.status);
        return idx >= 0 && idx < STATUS_FLOW.length - 1 ? STATUS_FLOW[idx + 1] : null;
    })();

    return (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
            <div className="absolute inset-0 bg-black/30" />
            <div
                className="relative w-full max-w-lg bg-white shadow-xl overflow-y-auto"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex justify-between items-start z-10">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-mono text-slate-400">{moc.moc_number}</span>
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusStyle.bg} ${statusStyle.text}`}>
                                {moc.status.replace(/_/g, ' ')}
                            </span>
                        </div>
                        <h2 className="text-lg font-bold text-slate-900">{moc.title}</h2>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
                </div>

                <div className="px-6 py-4 space-y-6">
                    {/* Workflow Progress */}
                    <div>
                        <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Workflow Progress</h4>
                        <div className="flex items-center gap-1">
                            {STATUS_FLOW.map((step, i) => {
                                const isActive = step === moc.status;
                                const isPast = STATUS_FLOW.indexOf(moc.status) > i;
                                return (
                                    <React.Fragment key={step}>
                                        <div className={`px-2 py-1 rounded text-xs font-medium ${isActive ? 'bg-relantern-500 text-white' :
                                            isPast ? 'bg-green-100 text-green-700' :
                                                'bg-slate-100 text-slate-400'
                                            }`}>
                                            {step.replace(/_/g, ' ').slice(0, 8)}
                                        </div>
                                        {i < STATUS_FLOW.length - 1 && (
                                            <ArrowRight size={12} className={isPast ? 'text-green-400' : 'text-slate-300'} />
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </div>
                    </div>

                    {/* Change Details */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs text-slate-500">Change Type</label>
                            <div className={`mt-1 inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded ${changeInfo.color}`}>
                                {changeInfo.icon} {changeInfo.label}
                            </div>
                        </div>
                        <div>
                            <label className="text-xs text-slate-500">Created</label>
                            <p className="text-sm text-slate-900">{new Date(moc.created_at).toLocaleDateString()}</p>
                        </div>
                    </div>

                    {/* Values */}
                    {(moc.current_value || moc.proposed_value) && (
                        <div className="bg-slate-50 rounded-lg p-4 space-y-3">
                            {moc.current_value && (
                                <div>
                                    <label className="text-xs text-slate-500">Current Value</label>
                                    <p className="text-sm text-red-700 font-mono bg-red-50 px-2 py-1 rounded mt-0.5">{moc.current_value}</p>
                                </div>
                            )}
                            {moc.proposed_value && (
                                <div>
                                    <label className="text-xs text-slate-500">Proposed Value</label>
                                    <p className="text-sm text-green-700 font-mono bg-green-50 px-2 py-1 rounded mt-0.5">{moc.proposed_value}</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Justification */}
                    <div>
                        <label className="text-xs text-slate-500">Justification</label>
                        <p className="text-sm text-slate-700 mt-1">{moc.justification}</p>
                    </div>

                    {moc.risk_assessment && (
                        <div>
                            <label className="text-xs text-slate-500">Risk Assessment</label>
                            <p className="text-sm text-slate-700 mt-1">{moc.risk_assessment}</p>
                        </div>
                    )}

                    {moc.review_notes && (
                        <div>
                            <label className="text-xs text-slate-500">Review Notes</label>
                            <p className="text-sm text-slate-700 mt-1">{moc.review_notes}</p>
                        </div>
                    )}

                    {moc.rejection_reason && (
                        <div className="bg-red-50 rounded-lg p-3">
                            <label className="text-xs text-red-600 font-semibold">Rejection Reason</label>
                            <p className="text-sm text-red-700 mt-1">{moc.rejection_reason}</p>
                        </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 pt-4 border-t border-slate-100">
                        {nextStatus && (
                            <button
                                onClick={() => onStatusChange(moc, nextStatus)}
                                className="flex-1 px-4 py-2 bg-relantern-500 text-white rounded-lg text-sm font-medium hover:bg-relantern-600 transition flex items-center justify-center gap-2"
                            >
                                <ArrowRight size={16} />
                                Advance to {nextStatus.replace(/_/g, ' ')}
                            </button>
                        )}
                        {moc.status !== 'REJECTED' && moc.status !== 'CANCELLED' && moc.status !== 'CLOSED' && (
                            <button
                                onClick={() => onStatusChange(moc, 'REJECTED')}
                                className="px-4 py-2 border border-red-300 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition"
                            >
                                Reject
                            </button>
                        )}
                    </div>
                </div>
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
            alert('⛔ Access Denied: You do not have permission to create MoC requests.');
            return;
        }

        setSaving(true);
        try {
            const { error } = await supabase.from('moc_requests').insert({
                ...form,
                moc_number: '', // auto-generated by trigger
                status: 'DRAFT',
                requested_by: profile?.id || null,
            });
            if (error) throw error;
            onCreated();
        } catch (err) {
            console.error('Failed to create MoC:', err);
            alert('Failed to create. See console.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
            <div className="absolute inset-0 bg-black/40" />
            <div
                className="relative bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
                onClick={e => e.stopPropagation()}
            >
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
                    <h2 className="text-lg font-bold text-slate-900">New Management of Change Request</h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
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

                    <div className="grid grid-cols-2 gap-3">
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
                            className="flex-1 px-4 py-2 bg-relantern-500 text-white rounded-lg text-sm font-medium hover:bg-relantern-600 transition disabled:opacity-50 flex items-center justify-center gap-2"
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
