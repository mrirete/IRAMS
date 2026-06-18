import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    Plus, Search, Filter, Clock, CheckCircle,
    X, User, Camera, Zap, Trash2, Save,
    MoreHorizontal, QrCode, ChevronLeft, Bot, ShieldCheck, FileText, AlertOctagon, ChevronDown, ChevronRight, Mic, Package, MapPin, Edit3, Check
} from 'lucide-react';
import { ServiceRequest, RequestStatus, Asset, JobFile, WorkOrderStatus, WorkOrderType } from '../types';

import { DatabaseService } from '../services/DatabaseService';
import { ImageGallery } from '../components/ui/ImageGallery';
import { ImageCapture } from '../components/ui/ImageCapture';
import { DataMapper } from '../services/DataMapper';
import { SearchableDropdown } from '../components/ui/SearchableDropdown';
import { ConfirmationModal } from '../components/modals/ConfirmationModal';
import { NotificationService } from '../services/NotificationService';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { AskRelanternButton } from '../components/AskRelanternButton';
import { UnifiedDetailHeader } from '../components/ui/UnifiedDetailHeader';
import { PriorityPill } from '../components/ui';
import { ScanAssetModal } from '../components/modals/ScanAssetModal';
import { ReportRequestForm } from '../components/ReportRequestForm';
import { FunctionalFailureSelector } from '../components/FunctionalFailureSelector';

export const ServiceRequests: React.FC = () => {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const { user } = useAuth();
    const { showToast } = useToast();
    const [isCreating, setIsCreating] = useState(false);
    const [selectedRequest, setSelectedRequest] = useState<ServiceRequest | null>(null);
    const [requests, setRequests] = useState<ServiceRequest[]>([]);
    const [assets, setAssets] = useState<Asset[]>([]);
    const [users, setUsers] = useState<any[]>([]);
    const [dictionaries, setDictionaries] = useState<any[]>([]);

    // Polling / Real-time updates simulation
    const refreshData = async () => {
        const db = DatabaseService.getInstance();
        const dbRecords = await db.getRequests();
        const assetsData = await db.getAssets();
        const usersData = await db.getUsers();
        const dictionariesData = await db.getDictionaries();

        setAssets(assetsData);
        setUsers(usersData);
        setDictionaries(dictionariesData);

        const uiRecords = dbRecords.map(r => DataMapper.toUIRequest(r, assetsData, usersData));
        // Sort by date desc
        setRequests(uiRecords.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    };


    useEffect(() => {
        refreshData();
    }, []);

    // Auto-open creation form when navigated with ?action=create (from Dashboard quick actions)
    useEffect(() => {
        if (searchParams.get('action') === 'create') {
            setIsCreating(true);
            setSearchParams({}, { replace: true }); // Clean URL to prevent re-trigger on refresh
        }
    }, [searchParams, setSearchParams]);

    const handleStatusChange = async (id: string, newStatus: RequestStatus) => {
        try {
            const db = DatabaseService.getInstance();
            if (newStatus === RequestStatus.CONVERTED) {
                // Trigger Conversion Transaction
                const wo = await db.approveRequestAndConvert(id, user?.id || 'unknown');
            } else {
                // Standard Status Update
                // Need to map UI Status to DB Status
                // Since our mapper logic handles this 1:1, we can cast or map back
                const dbStatus = DataMapper.toDBRequest({ status: newStatus } as any).status;
                await db.updateRequest(id, { status: dbStatus }, user?.id || 'unknown');
            }
            await refreshData();

            // Update selected view if open
            if (selectedRequest && selectedRequest.id === id) {
                // Re-fetch specific item
                const all = await db.getRequests(); // Inefficient but safe for migration
                const updated = all.find(r => r.id === id);
                if (updated) {
                    const uiRequest = DataMapper.toUIRequest(updated, assets, users);
                    setSelectedRequest(uiRequest);
                    // Trigger Rules Engine
                    await NotificationService.checkRules('requests', 'SR_STATUS_CHANGE', uiRequest);
                }
            }
        } catch (e: any) {
            console.error('Action Failed:', e.message);
        }
    };


    const handleRequestUpdate = async (updatedRequest: ServiceRequest) => {
        try {
            // GAP-5 FIX: Persist ALL editable fields, not just functional_failure_id
            const dbRecord = DataMapper.toDBRequest(updatedRequest);
            await DatabaseService.getInstance().updateRequest(updatedRequest.id, {
                functional_failure_id: dbRecord.functional_failure_id,
                description: dbRecord.description,
                is_breakdown: dbRecord.is_breakdown,
                category: dbRecord.category,
            }, user?.id || 'unknown');

            await refreshData();
            setSelectedRequest(updatedRequest); // Optimistic UI update for detail view
        } catch (e: any) {
            console.error('Update failed:', e.message);
        }
    };

    const handleRequestDelete = async (id: string) => {
        try {
            await DatabaseService.getInstance().deleteRequest(id);
            setSelectedRequest(null);
            await refreshData();
        } catch (e: any) {
            console.error('Delete failed:', e.message);
        }
    };

    // Click handler: navigate to WO if converted, otherwise open detail
    const handleRequestClick = (req: ServiceRequest) => {
        if (req.status === RequestStatus.CONVERTED && req.linkedWOId) {
            navigate(`/work-orders?id=${req.linkedWOId}`);
        } else {
            setIsCreating(false);
            setSelectedRequest(req);
        }
    };


    return (
        <div className="flex h-[calc(100vh-6rem)] gap-6">
            {/* Main Board / List View */}
            <div className={`flex-1 flex flex-col transition-all duration-300 ${selectedRequest || isCreating ? 'hidden lg:flex lg:w-1/3 lg:flex-none' : 'w-full'}`}>
                <div className="mb-3 sm:mb-6 flex flex-wrap justify-between items-center gap-3">
                    <div className="hidden sm:block">
                        <h1 className="text-lg md:text-2xl font-bold text-slate-900">Maintenance Requests</h1>
                        <p className="text-xs sm:text-sm text-slate-500">Triage and convert issues to work orders.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <AskRelanternButton
                            contextType="serviceRequest"
                            contextSummary={`Maintenance Request Triage: ${requests.length} total requests. Pending: ${requests.filter(r => (r.status as string) === 'PENDING').length}. In Progress: ${requests.filter(r => (r.status as string) === 'IN_PROGRESS').length}. Approved: ${requests.filter(r => r.status === 'APPROVED').length}. Ask about triage prioritization, auto-classification, risk-based escalation, or converting MRs to work orders.`}
                            compact
                        />
                        <button
                            onClick={() => setIsCreating(true)}
                            className="bg-primary-600 hover:bg-primary-500 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 shadow-sm"
                        >
                            <Plus size={18} /> New Request
                        </button>
                    </div>
                </div>

                {/* Filters */}
                <div className="mb-4 flex gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                        <input
                            type="text"
                            placeholder="Search requests..."
                            className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-1 focus:ring-primary-500 focus:outline-none"
                        />
                    </div>
                    <button className="p-2 border border-slate-300 rounded-lg bg-white text-slate-600 hover:bg-slate-50">
                        <Filter size={18} />
                    </button>
                </div>

                {/* Board */}
                <div className="flex-1 overflow-y-auto pb-4">
                    {selectedRequest || isCreating ? (
                        // Compact List View when Detail is open
                        <div className="space-y-2">
                            {requests.map(req => (
                                <div
                                    key={req.id}
                                    onClick={() => handleRequestClick(req)}
                                    className={`p-3 rounded-lg border cursor-pointer hover:bg-slate-50 transition ${selectedRequest?.id === req.id ? 'bg-blue-50 border-blue-500' : 'bg-white border-slate-200'}`}
                                >
                                    <div className="flex justify-between items-start mb-1">
                                        <div className="flex items-center gap-1.5">
                                            <span className="font-mono text-xs text-slate-500">{req.requestNumber}</span>
                                            {req.isBreakdown && <AlertOctagon size={12} className="text-red-600" />}
                                        </div>
                                        <StatusBadge status={req.status} compact />
                                    </div>
                                    <h3 className="text-sm font-medium text-slate-900 truncate">{req.title}</h3>
                                    <div className="flex items-center gap-2 mt-2 text-xs text-slate-500">
                                        <Clock size={12} /> <span>{new Date(req.createdAt).toLocaleDateString()}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <>
                            {/* ═══ GAP-03: Mobile — Vertical Collapsible Groups ═══ */}
                            <div className="block sm:hidden space-y-2">
                                <MobileRequestGroup
                                    title="New" statuses={[RequestStatus.NEW]} requests={requests}
                                    onSelect={handleRequestClick} color="bg-slate-100" defaultOpen
                                />
                                <MobileRequestGroup
                                    title="Under Review" statuses={[RequestStatus.REVIEW]} requests={requests}
                                    onSelect={handleRequestClick} color="bg-blue-50"
                                />
                                <MobileRequestGroup
                                    title="Authorized" statuses={[RequestStatus.AUTHORIZED]} requests={requests}
                                    onSelect={handleRequestClick} color="bg-blue-50"
                                />
                                <MobileRequestGroup
                                    title="Approved & Converted" statuses={[RequestStatus.APPROVED, RequestStatus.CONVERTED]} requests={requests}
                                    onSelect={handleRequestClick} color="bg-green-50"
                                />
                            </div>

                            {/* Desktop: Full Kanban Board (horizontal columns) */}
                            <div className="hidden sm:flex h-full gap-4 overflow-x-auto">
                                <RequestColumn title="New" statuses={[RequestStatus.NEW]} requests={requests} onSelect={setSelectedRequest} color="bg-slate-100" />
                                <RequestColumn title="Under Review" statuses={[RequestStatus.REVIEW]} requests={requests} onSelect={setSelectedRequest} color="bg-blue-50" />
                                <RequestColumn title="Authorized" statuses={[RequestStatus.AUTHORIZED]} requests={requests} onSelect={setSelectedRequest} color="bg-blue-50" />
                                <RequestColumn title="Approved & Converted" statuses={[RequestStatus.APPROVED, RequestStatus.CONVERTED]} requests={requests} onSelect={setSelectedRequest} color="bg-green-50" />
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Right Panel: Request Details */}
            {selectedRequest && (
                <div className="w-full lg:flex-1 bg-white rounded-xl shadow-lg border border-slate-200 flex flex-col overflow-hidden animate-in slide-in-from-right duration-300">
                    <RequestDetail
                        request={selectedRequest}
                        onClose={() => setSelectedRequest(null)}
                        onStatusChange={handleStatusChange}
                        onUpdate={handleRequestUpdate}
                        onDelete={handleRequestDelete}
                        dictionaries={dictionaries}
                    />
                </div>
            )}

            {/* Unified Report / New Request intake — shared with the mobile Report button */}
            <ReportRequestForm
                open={isCreating}
                onClose={() => setIsCreating(false)}
                onCreated={refreshData}
            />
        </div>
    );
};


// --- Components ---

const RequestColumn: React.FC<{
    title: string;
    statuses: RequestStatus[];
    requests: ServiceRequest[];
    onSelect: (r: ServiceRequest) => void;
    color: string;
}> = ({ title, statuses, requests, onSelect, color }) => {
    const navigate = useNavigate();
    const filtered = requests.filter(r => statuses.includes(r.status));

    return (
        <div className={`flex-1 min-w-[280px] rounded-xl flex flex-col ${color} border border-transparent`}>
            <div className="p-3 font-semibold text-slate-700 flex justify-between items-center">
                {title}
                <span className="bg-white/50 px-2 py-0.5 rounded text-xs text-slate-600">{filtered.length}</span>
            </div>
            <div className="p-2 flex-1 overflow-y-auto space-y-2">
                {filtered.map(req => (
                    <div
                        key={req.id}
                        onClick={() => onSelect(req)}
                        className="bg-white p-3 rounded-lg shadow-sm border border-slate-200 hover:shadow-md transition cursor-pointer group"
                    >
                        <div className="flex justify-between items-start mb-2">
                            <PriorityPill priority={req.priority} />
                            <div className="flex items-center gap-1">
                                {req.isBreakdown && (
                                    <div className="text-[10px] flex items-center gap-1 text-red-700 bg-red-50 font-bold border border-red-100 px-1 py-0.5 rounded" title="Equipment Breakdown">
                                        <AlertOctagon size={10} className="text-red-600" /> Breakdown
                                    </div>
                                )}
                                {req.aiRiskScore && req.aiRiskScore > 80 && (
                                    <div className="text-[10px] flex items-center gap-1 text-red-600 font-bold" title="High Risk Detected by AI">
                                        <Zap size={10} fill="currentColor" /> AI Risk
                                    </div>
                                )}
                            </div>
                        </div>
                        <h4 className="text-sm font-semibold text-slate-900 mb-1 group-hover:text-blue-600 transition-colors">{req.title}</h4>
                        <p className="text-xs text-slate-500 line-clamp-2 mb-3">{req.description}</p>

                        <div className="border-t border-slate-100 pt-2 flex justify-between items-center text-xs text-slate-500">
                            <div className="flex items-center gap-1">
                                <User size={12} /> {req.requesterName.split(' ')[0]}
                            </div>
                            {req.linkedWOId ? (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        navigate(`/work-orders?id=${req.linkedWOId}`);
                                    }}
                                    className="flex items-center gap-1 text-blue-600 font-bold hover:underline"
                                >
                                    <FileText size={12} /> View WO #{req.linkedWONumber || '...'}
                                </button>
                            ) : (
                                <SLAIndicator deadline={req.slaDeadline} />
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ═══ GAP-03: Mobile Vertical Collapsible Group ═══
const MobileRequestGroup: React.FC<{
    title: string;
    statuses: RequestStatus[];
    requests: ServiceRequest[];
    onSelect: (r: ServiceRequest) => void;
    color: string;
    defaultOpen?: boolean;
}> = ({ title, statuses, requests, onSelect, color, defaultOpen = false }) => {
    const navigate = useNavigate();
    const [isOpen, setIsOpen] = useState(defaultOpen);
    const filtered = requests.filter(r => statuses.includes(r.status));

    return (
        <div className={`rounded-xl border border-transparent overflow-hidden ${color}`}>
            {/* Accordion Header */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full p-3 flex items-center justify-between touch-target-mobile"
            >
                <div className="flex items-center gap-2">
                    {isOpen ? <ChevronDown size={16} className="text-slate-500" /> : <ChevronRight size={16} className="text-slate-500" />}
                    <span className="font-semibold text-sm text-slate-700">{title}</span>
                </div>
                <span className="bg-white/60 px-2.5 py-0.5 rounded-full text-xs font-bold text-slate-600 min-w-[24px] text-center">
                    {filtered.length}
                </span>
            </button>

            {/* Accordion Body */}
            {isOpen && (
                <div className="px-2 pb-2 space-y-2">
                    {filtered.length === 0 ? (
                        <div className="text-center py-4 text-xs text-slate-400">No requests</div>
                    ) : (
                        filtered.map(req => (
                            <div
                                key={req.id}
                                onClick={() => onSelect(req)}
                                className="bg-white p-3 rounded-lg shadow-sm border border-slate-200 active:bg-slate-50 transition cursor-pointer"
                            >
                                <div className="flex justify-between items-start mb-1.5">
                                    <PriorityPill priority={req.priority} />
                                    <div className="flex items-center gap-1">
                                        {req.isBreakdown && (
                                            <span className="text-[10px] flex items-center gap-0.5 text-red-700 bg-red-50 font-bold border border-red-100 px-1 py-0.5 rounded">
                                                <AlertOctagon size={10} /> BD
                                            </span>
                                        )}
                                        {req.aiRiskScore && req.aiRiskScore > 80 && (
                                            <span className="text-[10px] flex items-center gap-0.5 text-red-600 font-bold">
                                                <Zap size={10} fill="currentColor" /> AI
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <h4 className="text-sm font-semibold text-slate-900 line-clamp-1 mb-1">{req.title}</h4>
                                <div className="flex justify-between items-center text-xs text-slate-500">
                                    <div className="flex items-center gap-1">
                                        <User size={11} /> {req.requesterName.split(' ')[0]}
                                    </div>
                                    {req.linkedWOId ? (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); navigate(`/work-orders?id=${req.linkedWOId}`); }}
                                            className="flex items-center gap-0.5 text-blue-600 font-bold text-[10px]"
                                        >
                                            <FileText size={10} /> WO #{req.linkedWONumber || '...'}
                                        </button>
                                    ) : (
                                        <SLAIndicator deadline={req.slaDeadline} />
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
};

const SLAIndicator: React.FC<{ deadline: string }> = ({ deadline }) => {
    const hoursLeft = (new Date(deadline).getTime() - Date.now()) / 3600000;

    if (hoursLeft < 0) return <span className="text-red-600 font-bold flex items-center gap-1"><Clock size={12} /> Overdue</span>;
    if (hoursLeft < 4) return <span className="text-amber-600 font-bold flex items-center gap-1"><Clock size={12} /> {Math.ceil(hoursLeft)}h left</span>;

    return <span className="text-slate-400 flex items-center gap-1"><Clock size={12} /> {Math.ceil(hoursLeft / 24)}d left</span>;
};

const StatusBadge: React.FC<{ status: RequestStatus, compact?: boolean }> = ({ status, compact }) => {
    const styles = {
        [RequestStatus.NEW]: 'bg-blue-100 text-blue-700',
        [RequestStatus.REVIEW]: 'bg-blue-100 text-blue-700',
        [RequestStatus.AUTHORIZED]: 'bg-blue-100 text-blue-700',
        [RequestStatus.APPROVED]: 'bg-green-100 text-green-700',
        [RequestStatus.REJECTED]: 'bg-slate-100 text-slate-600',
        [RequestStatus.CONVERTED]: 'bg-slate-800 text-slate-100',
    };

    return (
        <span className={`rounded-full font-bold uppercase tracking-wider ${styles[status]} ${compact ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2.5 py-1'}`}>
            {status}
        </span>
    );
};

// --- Creation Form ---




// --- Request Detail / Triage View ---

const RequestDetail: React.FC<{
    request: ServiceRequest;
    onClose: () => void;
    onStatusChange: (id: string, s: RequestStatus) => void;
    onUpdate: (r: ServiceRequest) => void;
    onDelete: (id: string) => void;
    dictionaries?: any[];
}> = ({ request, onClose, onStatusChange, onUpdate, onDelete, dictionaries = [] }) => {

    // Real Auth Context - use Effective Permission Matrix
    const { user, profile, role, permissions } = useAuth();
    const { showToast } = useToast();

    const currentUser = {
        id: user?.id || '',
        name: profile?.username || user?.email || 'Unknown',
        roles: role ? [role] : []
    };

    // Filter for Service Request statuses only
    const requestStatuses = dictionaries.filter(d => d.type === 'STATUS_CODE' && ['NEW', 'REVIEW', 'AUTHORIZED', 'APPROVED', 'REJECTED', 'CONVERTED'].includes(d.code));

    // Permission checks from Admin Effective Permission Matrix
    const canEdit = permissions?.requests?.edit === true;
    const canDelete = permissions?.requests?.delete === true;
    const canAuthorize = permissions?.requests?.authorize === true;
    const canApprove = permissions?.requests?.approve === true;

    // Rejection modal state
    const [showRejectModal, setShowRejectModal] = useState(false);
    const [rejectionReason, setRejectionReason] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

    // Logic: Editable if status is NEW or REVIEW. 
    // Approved, Rejected, Converted are generally locked for historical integrity.
    const isEditable = [RequestStatus.NEW, RequestStatus.REVIEW].includes(request.status) && canEdit;

    const handleFailureChange = (newCode: string) => {
        onUpdate({ ...request, functionalFailureType: newCode });
    };

    // Rejection handler with reason
    const handleReject = async () => {
        if (!rejectionReason.trim()) {
            showToast('Please provide a reason for rejection.', 'warning');
            return;
        }
        setIsProcessing(true);
        try {
            const db = DatabaseService.getInstance();
            await db.updateRequest(request.id, {
                status: 'REJECTED',
                rejection_reason: rejectionReason
            }, currentUser.id);
            onStatusChange(request.id, RequestStatus.REJECTED);
            setShowRejectModal(false);
            setRejectionReason('');
        } catch (e: any) {
            showToast('Rejection failed: ' + e.message, 'error');
        } finally {
            setIsProcessing(false);
        }
    };

    // Approve handler - auto-converts to Work Order
    const handleApprove = async () => {
        setIsProcessing(true);
        try {
            const db = DatabaseService.getInstance();
            const wo = await db.approveRequestAndConvert(request.id, currentUser.id);
            showToast(`Request approved! Work Order ${wo.wo_number} created.`, 'success');
            onStatusChange(request.id, RequestStatus.CONVERTED);
        } catch (e: any) {
            showToast('Approval failed: ' + e.message, 'error');
        } finally {
            setIsProcessing(false);
        }
    };

    // Delete handler
    const handleDeleteClick = () => {
        setIsDeleteModalOpen(true);
    };

    const handleConfirmDelete = async () => {
        setIsProcessing(true);
        try {
            const db = DatabaseService.getInstance();
            await db.deleteRequest(request.id);
            onDelete(request.id);
        } catch (e: any) {
            showToast('Delete failed: ' + e.message, 'error');
        } finally {
            setIsProcessing(false);
            setIsDeleteModalOpen(false);
        }
    };

    // Save handler - persists current edits to DB
    const handleSave = async () => {
        setIsProcessing(true);
        try {
            const db = DatabaseService.getInstance();
            await db.updateRequest(request.id, {
                description: request.description,
                functional_failure_id: request.functionalFailureType,
                status: request.status as any,
                is_breakdown: request.isBreakdown,
                category: request.category, // GAP-6: Persist category from detail view
            }, currentUser.id);
            showToast('Request saved successfully.', 'success');
        } catch (e: any) {
            showToast('Save failed: ' + e.message, 'error');
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="flex flex-col h-full">
            {/* Header with Status Dropdown */}
            <UnifiedDetailHeader
                title={request.title}
                subtitle={request.requestNumber}
                icon={<FileText size={18} />}
                onClose={onClose}
                badges={
                    <div className="flex items-center gap-2">
                        <label className="text-[10px] font-bold text-slate-500 uppercase">Status</label>
                        <select
                            value={request.status}
                            onChange={(e) => onStatusChange(request.id, e.target.value as RequestStatus)}
                            disabled={!isEditable}
                            className={`text-xs border-slate-300 rounded-md bg-white px-2 py-1 ${!isEditable ? 'opacity-60 cursor-not-allowed' : ''}`}
                        >
                            {requestStatuses.length > 0 ? (
                                requestStatuses.map(s => (
                                    <option key={s.code} value={s.code}>{s.description}</option>
                                ))
                            ) : (
                                <>
                                    <option value="NEW">New / Draft</option>
                                    <option value="REVIEW">Under Review</option>
                                    <option value="AUTHORIZED">Authorized (Budget)</option>
                                    <option value="APPROVED">Approved (Technical)</option>
                                    <option value="REJECTED">Rejected</option>
                                    <option value="CONVERTED">Converted to Work Order</option>
                                </>
                            )}
                        </select>
                    </div>
                }
            />

            {/* Action Buttons — hidden on mobile, visible md+ */}
            {request.status !== RequestStatus.CONVERTED && request.status !== RequestStatus.REJECTED && (
                <div className="hidden md:flex flex-wrap gap-2 p-3 border-b border-slate-200 bg-white items-center">
                    {/* Debug info */}
                    <span className="text-xs text-slate-400">Status: {request.status}</span>

                    {/* Save Button - requires edit permission */}
                    <button
                        onClick={handleSave}
                        disabled={isProcessing || !canEdit || !isEditable}
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg flex items-center gap-1.5 ${canEdit && isEditable
                            ? 'bg-primary-600 text-white hover:bg-primary-500'
                            : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                            } disabled:opacity-50`}
                    >
                        <Save size={14} />
                        Save
                    </button>


                    {/* Delete Button - requires delete permission */}
                    <button
                        onClick={handleDeleteClick}
                        disabled={isProcessing || !canDelete || (request.status as string) === RequestStatus.CONVERTED}
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg flex items-center gap-1.5 border ${canDelete && (request.status as string) !== RequestStatus.CONVERTED
                            ? 'border-red-300 text-red-700 hover:bg-red-50'
                            : 'border-slate-200 text-slate-400 cursor-not-allowed'
                            }`}
                    >
                        <Trash2 size={14} />
                        Delete
                    </button>

                    <span className="ml-auto"></span>

                    {/* Start Review - requires edit permission, only for NEW */}
                    <button
                        onClick={() => onStatusChange(request.id, RequestStatus.REVIEW)}
                        disabled={request.status !== RequestStatus.NEW || !canEdit}
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg ${request.status === RequestStatus.NEW && canEdit
                            ? 'bg-slate-600 text-white hover:bg-slate-700'
                            : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                            }`}
                    >
                        Review
                    </button>

                    {/* Reject - requires edit permission at REVIEW or AUTHORIZED */}
                    <button
                        onClick={() => setShowRejectModal(true)}
                        disabled={![RequestStatus.REVIEW, RequestStatus.AUTHORIZED].includes(request.status as RequestStatus) || isProcessing || !canEdit}
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg border ${[RequestStatus.REVIEW, RequestStatus.AUTHORIZED].includes(request.status as RequestStatus) && canEdit
                            ? 'border-red-300 text-red-700 hover:bg-red-50'
                            : 'border-slate-200 text-slate-400 cursor-not-allowed'
                            }`}
                    >
                        Reject
                    </button>

                    {/* Authorize - requires authorize permission at REVIEW status */}
                    {/* GAP-7 FIX: Writes authorized_by and authorized_at stamps for governance evidence */}
                    <button
                        onClick={async () => {
                            setIsProcessing(true);
                            try {
                                const db = DatabaseService.getInstance();
                                await db.updateRequest(request.id, {
                                    status: 'AUTHORIZED',
                                    authorized_by: currentUser.id,
                                    authorized_at: new Date().toISOString()
                                }, currentUser.id);
                                onStatusChange(request.id, RequestStatus.AUTHORIZED);
                            } catch (e: any) {
                                showToast('Authorization failed: ' + e.message, 'error');
                            } finally {
                                setIsProcessing(false);
                            }
                        }}
                        disabled={request.status !== RequestStatus.REVIEW || isProcessing || !canAuthorize}
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg ${request.status === RequestStatus.REVIEW && canAuthorize
                            ? 'bg-blue-600 text-white hover:bg-primary-500'
                            : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                            }`}
                    >
                        Authorize
                    </button>

                    {/* Approve - requires approve permission at AUTHORIZED status */}
                    <button
                        onClick={handleApprove}
                        disabled={request.status !== RequestStatus.AUTHORIZED || isProcessing || !canApprove}
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg ${request.status === RequestStatus.AUTHORIZED && canApprove
                            ? 'bg-green-600 text-white hover:bg-green-700'
                            : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                            }`}
                    >
                        {isProcessing ? 'Processing...' : 'Approve'}
                    </button>
                </div>
            )}

            {/* ═══ Mobile Sticky Bottom Action Bar (fixed above bottom nav) ═══ */}
            {request.status !== RequestStatus.CONVERTED && request.status !== RequestStatus.REJECTED && (
                <div className="sm:hidden mobile-detail-footer">
                    {canEdit && isEditable && (
                        <button
                            onClick={handleSave}
                            disabled={isProcessing}
                            className="flex-1 flex items-center justify-center gap-2 py-3 bg-primary-600 hover:bg-primary-500 text-white rounded-xl text-sm font-semibold transition-colors shadow-sm disabled:opacity-50"
                        >
                            <Save size={16} />
                            Save
                        </button>
                    )}
                    {request.status === RequestStatus.AUTHORIZED && canApprove && (
                        <button
                            onClick={handleApprove}
                            disabled={isProcessing}
                            className="flex-1 flex items-center justify-center gap-2 py-3 bg-green-600 hover:bg-green-500 text-white rounded-xl text-sm font-semibold transition-colors"
                        >
                            {isProcessing ? 'Processing...' : 'Approve'}
                        </button>
                    )}
                    {request.status === RequestStatus.REVIEW && canAuthorize && (
                        <button
                            onClick={async () => {
                                setIsProcessing(true);
                                try {
                                    const db = DatabaseService.getInstance();
                                    await db.updateRequest(request.id, {
                                        status: 'AUTHORIZED',
                                        authorized_by: currentUser.id,
                                        authorized_at: new Date().toISOString()
                                    }, currentUser.id);
                                    onStatusChange(request.id, RequestStatus.AUTHORIZED);
                                } catch (e: any) {
                                    showToast('Authorization failed: ' + e.message, 'error');
                                } finally {
                                    setIsProcessing(false);
                                }
                            }}
                            disabled={isProcessing}
                            className="flex-1 flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-semibold transition-colors"
                        >
                            Authorize
                        </button>
                    )}
                </div>
            )}

            {/* Rejection Modal */}
            {showRejectModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 m-4">
                        <h3 className="text-lg font-bold text-slate-900 mb-4">Reject Request</h3>
                        <p className="text-sm text-slate-600 mb-4">
                            Please provide a reason for rejecting this request. This will be recorded for audit purposes.
                        </p>
                        <textarea
                            value={rejectionReason}
                            onChange={(e) => setRejectionReason(e.target.value)}
                            placeholder="Enter reason for rejection..."
                            className="w-full p-3 border border-slate-300 rounded-lg text-sm resize-none h-32 focus:ring-2 focus:ring-red-500 focus:border-red-500"
                            autoFocus
                        />
                        <div className="flex justify-end gap-3 mt-4">
                            <button
                                onClick={() => { setShowRejectModal(false); setRejectionReason(''); }}
                                className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleReject}
                                disabled={isProcessing || !rejectionReason.trim()}
                                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isProcessing ? 'Rejecting...' : 'Confirm Rejection'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
                {/* JOB RAISED Badge for Converted Requests */}
                {request.status === RequestStatus.CONVERTED && (
                    <div className="mb-4 bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
                        <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                            <Check size={20} className="text-green-600" />
                        </div>
                        <div>
                            <div className="text-sm font-bold text-green-800">JOB RAISED</div>
                            <div className="text-xs text-green-600">
                                Work Order {request.linkedWONumber || 'created'} generated from this request
                            </div>
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Left Main Form */}
                    <div className="lg:col-span-2 space-y-6">
                        {/* Request Form Card */}
                        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Request Code */}
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Request Code</label>
                                    <input
                                        type="text"
                                        value={request.requestNumber}
                                        readOnly
                                        className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-700 font-mono text-sm"
                                    />
                                </div>

                                {/* Asset */}
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Asset</label>
                                    <input
                                        type="text"
                                        value={request.assetName || ''}
                                        readOnly={!isEditable}
                                        className={`w-full px-3 py-2 border rounded-lg text-sm ${isEditable ? 'border-slate-300 bg-white' : 'border-slate-200 bg-slate-50'}`}
                                    />
                                </div>

                                {/* Current Path (Location) */}
                                <div className="md:col-span-2">
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Current Path</label>
                                    <input
                                        type="text"
                                        value={request.location || 'Location not specified'}
                                        readOnly
                                        className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-600 text-sm"
                                    />
                                </div>

                                {/* Fault Type (Functional Failure) */}
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Fault Type</label>
                                    <FunctionalFailureSelector
                                        value={request.functionalFailureType}
                                        onChange={handleFailureChange}
                                        readOnly={!isEditable}
                                    />
                                    {/* Breakdown Toggle */}
                                    <div className="mt-3 flex items-center gap-2">
                                        <input 
                                            type="checkbox" 
                                            id={`breakdown-${request.id}`}
                                            checked={request.isBreakdown || false}
                                            disabled={!isEditable}
                                            onChange={(e) => onUpdate({ ...request, isBreakdown: e.target.checked })}
                                            className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-primary-500 disabled:opacity-50"
                                        />
                                        <label htmlFor={`breakdown-${request.id}`} className={`text-sm font-medium ${!isEditable ? 'text-slate-400' : 'text-slate-700 cursor-pointer'}`}>
                                            Breakdown (Equipment stopped)
                                        </label>
                                    </div>
                                </div>

                                {/* Priority */}
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Priority</label>
                                    <div className={`inline-flex items-center px-3 py-2 rounded-lg text-sm font-semibold
                                        ${request.priority === 'HIGH' ? 'bg-red-100 text-red-700 border border-red-200' :
                                            request.priority === 'MEDIUM' ? 'bg-amber-100 text-amber-700 border border-amber-200' :
                                                'bg-slate-100 text-slate-700 border border-slate-200'}
                                    `}>
                                        {request.priority}
                                    </div>
                                </div>

                                {/* Description */}
                                <div className="md:col-span-2">
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Description</label>
                                    <textarea
                                        value={request.description}
                                        readOnly={!isEditable}
                                        rows={4}
                                        className={`w-full px-3 py-2 border rounded-lg text-sm resize-none ${isEditable ? 'border-slate-300 bg-white' : 'border-slate-200 bg-slate-50'}`}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Requester Info Card */}
                        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                            <h3 className="font-bold text-slate-900 mb-4 text-sm uppercase tracking-wide">Requester Information</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Contact</label>
                                    <input
                                        type="text"
                                        value={request.requesterName}
                                        readOnly
                                        className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-700 text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Department</label>
                                    <input
                                        type="text"
                                        value={request.requesterDepartment || 'Operations'}
                                        readOnly
                                        className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-700 text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Phone</label>
                                    <input
                                        type="text"
                                        value={request.requesterPhone || 'Not provided'}
                                        readOnly
                                        className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-700 text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Email</label>
                                    <input
                                        type="text"
                                        value={request.requesterEmail || 'Not provided'}
                                        readOnly
                                        className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-700 text-sm"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* AI Triage Card - Only show if aiRiskScore exists */}
                        {request.aiRiskScore !== undefined && request.aiRiskScore > 0 && (
                            <div className="bg-white border border-blue-100 rounded-xl shadow-sm overflow-hidden">
                                <div className="bg-blue-50 px-4 py-3 border-b border-blue-100 flex items-center gap-2">
                                    <Zap size={18} className="text-blue-600" fill="currentColor" />
                                    <h3 className="font-bold text-blue-900 text-sm">Nexus AI Triage Assessment</h3>
                                    <span className="ml-auto text-xs text-blue-600 font-medium">Confidence: {request.aiRiskScore}%</span>
                                </div>
                                <div className="p-4 space-y-3">
                                    <div className="flex items-start gap-3">
                                        <div className="mt-1"><ShieldCheck size={16} className="text-slate-400" /></div>
                                        <div>
                                            <span className="text-xs font-bold text-slate-500 uppercase">Risk Analysis (ISO 31000)</span>
                                            <p className="text-sm text-slate-700 mt-1">
                                                Risk Priority Number calculated based on asset criticality and failure severity.
                                                Score: <strong className={request.aiRiskScore > 70 ? 'text-red-600' : request.aiRiskScore > 40 ? 'text-orange-600' : 'text-green-600'}>{request.aiRiskScore}/100</strong>
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Evidence Photos */}
                        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                            <ImageGallery
                                entityId={request.id}
                                entityType="SERVICE_REQUEST"
                                bucket="assets"
                                prefix="sr_"
                                readonly={request.status === RequestStatus.CONVERTED || request.status === RequestStatus.REJECTED}
                            />
                        </div>
                    </div>

                    {/* Right Sidebar - Audit Trail */}
                    <div className="space-y-6">
                        {/* Audit Info Card */}
                        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                            <h3 className="font-bold text-slate-900 text-sm uppercase tracking-wide">Audit Trail</h3>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Created By</label>
                                <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 bg-slate-200 rounded-full flex items-center justify-center text-[10px] font-bold">
                                        {request.requesterName.charAt(0)}
                                    </div>
                                    <span className="text-sm text-slate-700">{request.requesterName}</span>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Created</label>
                                <div className="text-sm text-slate-700 flex items-center gap-2">
                                    <Clock size={14} className="text-slate-400" />
                                    {new Date(request.createdAt).toLocaleDateString()} {new Date(request.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </div>
                            </div>

                            {request.authorizedBy && (
                                <>
                                    <hr className="border-slate-100" />
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Authorized By</label>
                                        <div className="text-sm text-slate-700">{request.authorizedBy}</div>
                                    </div>
                                    {request.authorizedAt && (
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Authorized</label>
                                            <div className="text-sm text-slate-700 flex items-center gap-2">
                                                <Clock size={14} className="text-slate-400" />
                                                {new Date(request.authorizedAt).toLocaleDateString()}
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}

                            <hr className="border-slate-100" />

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">SLA Deadline</label>
                                <div className="text-sm text-slate-700 flex items-center gap-2">
                                    <Clock size={14} className="text-slate-400" />
                                    {new Date(request.slaDeadline).toLocaleDateString()}
                                </div>
                            </div>
                        </div>

                        {/* Media Grid */}
                        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                            <h3 className="font-bold text-slate-900 mb-4 text-sm uppercase tracking-wide">Attachments</h3>
                            {request.files && request.files.length > 0 ? (
                                <div className="grid grid-cols-2 gap-2">
                                    {request.files.map(f => (
                                        <div key={f.id} className="aspect-square bg-slate-100 rounded-lg overflow-hidden border border-slate-200 relative group cursor-pointer">
                                            <img src={f.url} alt={f.name} className="w-full h-full object-cover" />
                                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white text-xs font-bold">
                                                View
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="p-4 border border-dashed border-slate-200 rounded-lg text-center text-slate-400 text-xs">
                                    No media attached.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
