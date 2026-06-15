import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Wrench, Plus, Filter, ShieldAlert, Pencil, Trash2,
    Clock, CheckCircle, AlertTriangle, AlertCircle, XCircle, FileText, Target
} from 'lucide-react';
import { useWork } from '../hooks/useWork';
import { useAssetLookup } from '../hooks/useAssetLookup';
import type { WorkOrder, WorkRequest } from '../types/work';
import { NewWOModal } from '../components/work/NewWOModal';
import { EditWOModal } from '../components/work/EditWOModal';

// ═══════════════════════════════════════════════════════════════════════
//  PAGE COMPONENT
// ═══════════════════════════════════════════════════════════════════════

export const WorkPage: React.FC = () => {
    const {
        wos, wrs, summary, tecoWorkOrder, createWorkRequest, rejectWorkRequest,
        approveWorkRequest, createWorkOrder, updateWorkOrder, deleteWorkOrder,
        deleteWorkRequest,
    } = useWork();

    const [activeTab, setActiveTab] = useState<'orders' | 'requests'>('orders');

    // Slide-out and Modal State
    const [selectedWO, setSelectedWO] = useState<WorkOrder | null>(null);
    const [selectedWR, setSelectedWR] = useState<WorkRequest | null>(null);
    const [isNewWRModalOpen, setIsNewWRModalOpen] = useState(false);
    const [isNewWOModalOpen, setIsNewWOModalOpen] = useState(false);
    const [editingWO, setEditingWO] = useState<WorkOrder | null>(null);

    return (
        <div className="space-y-6 pb-20">
            {/* 1. Page Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Work Execution</h1>
                    <p className="text-slate-500 text-sm mt-1">Manage Work Orders and Requests across all sites</p>
                </div>
                <div className="flex space-x-3">
                    <button className="btn-secondary">
                        <Filter size={18} className="mr-2" />
                        Filters
                    </button>
                    <button onClick={() => setIsNewWRModalOpen(true)} className="btn-secondary">
                        <Plus size={18} className="mr-2" />
                        New Work Request
                    </button>
                    <button onClick={() => setIsNewWOModalOpen(true)} className="btn-primary">
                        <Plus size={18} className="mr-2" />
                        New Work Order
                    </button>
                </div>
            </div>

            {/* 2. KPI Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                <KpiCard label="Open WOs" value={summary.open_wos} icon={Wrench} trend="stable" />
                <KpiCard label="Overdue WOs" value={summary.overdue_wos} icon={AlertCircle} color="text-red-400" bg="bg-red-500/10" />
                <KpiCard label="Emergency WOs" value={summary.emergency_wos} icon={AlertTriangle} color="text-yellow-500" bg="bg-yellow-500/10" />
                <KpiCard label="Pending WRs" value={summary.pending_wra} icon={FileText} trend="up" />
                <KpiCard label="Backlog (Hrs)" value={summary.backlog_hours} icon={Clock} />
            </div>

            {/* 3. Tabs */}
            <div className="flex border-b border-slate-200">
                <button
                    onClick={() => setActiveTab('orders')}
                    className={`px-6 py-3 font-medium text-sm transition-colors border-b-2 ${activeTab === 'orders' ? 'border-primary-600 text-primary-600' : 'border-transparent text-slate-400 hover:text-slate-800 hover:border-slate-300'}`}
                >
                    Work Orders ({wos.length})
                </button>
                <button
                    onClick={() => setActiveTab('requests')}
                    className={`px-6 py-3 font-medium text-sm transition-colors border-b-2 ${activeTab === 'requests' ? 'border-primary-600 text-primary-600' : 'border-transparent text-slate-400 hover:text-slate-800 hover:border-slate-300'}`}
                >
                    Work Requests ({wrs.length})
                </button>
            </div>

            {/* 4. Tab Content */}
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                {activeTab === 'orders' ? (
                    <WorkOrderTable wos={wos} onRowClick={setSelectedWO} />
                ) : (
                    <WorkRequestTable wrs={wrs} onRowClick={setSelectedWR} />
                )}
            </div>

            {/* Slide-out Panels */}
            {selectedWO && (
                <WODetailPanel
                    wo={selectedWO}
                    onClose={() => setSelectedWO(null)}
                    onTeco={(fc) => tecoWorkOrder(selectedWO.id, fc)}
                    onEdit={() => { setEditingWO(selectedWO); setSelectedWO(null); }}
                    onDelete={() => { deleteWorkOrder(selectedWO.id); setSelectedWO(null); }}
                />
            )}
            {selectedWR && (
                <WRDetailPanel
                    wr={selectedWR}
                    onClose={() => setSelectedWR(null)}
                    onApprove={() => approveWorkRequest(selectedWR.id)}
                    onReject={(r, s) => rejectWorkRequest(selectedWR.id, r, s)}
                    onDelete={() => { deleteWorkRequest(selectedWR.id); setSelectedWR(null); }}
                />
            )}

            {/* Modals */}
            {isNewWRModalOpen && <NewWRModal onClose={() => setIsNewWRModalOpen(false)} onSubmit={(title, desc, asset_id, sev, pri) => { createWorkRequest(title, desc, asset_id, sev, pri); setIsNewWRModalOpen(false); }} />}
            {isNewWOModalOpen && <NewWOModal onClose={() => setIsNewWOModalOpen(false)} onSubmit={createWorkOrder} />}
            {editingWO && <EditWOModal wo={editingWO} onClose={() => setEditingWO(null)} onSave={updateWorkOrder} />}
        </div>
    );
};

// ═══════════════════════════════════════════════════════════════════════
//  SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════════

function KpiCard({ label, value, icon: Icon, color = 'text-accent-blue', bg = 'bg-accent-blue/10', trend }: any) {
    return (
        <div className="bg-white border border-slate-200 rounded-lg p-5 flex items-center shadow-sm">
            <div className={`p-3 rounded-md ${bg} ${color} mr-4`}>
                <Icon size={24} />
            </div>
            <div>
                <p className="text-slate-400 text-xs uppercase tracking-wider font-semibold mb-1">{label}</p>
                <div className="flex items-baseline space-x-2">
                    <h3 className="text-2xl font-bold text-brand-50 font-sans tracking-tight">{value}</h3>
                    {trend === 'up' && <span className="text-xs text-red-400">↑</span>}
                    {trend === 'down' && <span className="text-xs text-green-400">↓</span>}
                </div>
            </div>
        </div>
    );
}

// ── Tables ─────────────────────────────────────────────────────────────

function WorkOrderTable({ wos, onRowClick }: { wos: WorkOrder[], onRowClick: (w: WorkOrder) => void }) {
    if (wos.length === 0) return <div className="p-8 text-center text-slate-400">No work orders found.</div>;
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                    <tr>
                        <th className="px-6 py-4 font-semibold tracking-wider">WO Number</th>
                        <th className="px-6 py-4 font-semibold tracking-wider">Type</th>
                        <th className="px-6 py-4 font-semibold tracking-wider">Title</th>
                        <th className="px-6 py-4 font-semibold tracking-wider">Asset</th>
                        <th className="px-6 py-4 font-semibold tracking-wider">Status</th>
                        <th className="px-6 py-4 font-semibold tracking-wider">Priority</th>
                        <th className="px-6 py-4 font-semibold tracking-wider text-right">Est. Hrs</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-brand-700/50">
                    {wos.map((wo) => (
                        <tr key={wo.id} onClick={() => onRowClick(wo)} className="hover:bg-slate-100/30 cursor-pointer transition-colors group">
                            <td className="px-6 py-4 font-mono text-slate-800 group-hover:text-primary-600">{wo.wo_number}</td>
                            <td className="px-6 py-4"><TypeBadge type={wo.type} /></td>
                            <td className="px-6 py-4 text-slate-800 font-medium truncate max-w-[250px]">{wo.title}</td>
                            <td className="px-6 py-4 text-slate-500 font-mono text-xs">{wo.asset_id.replace('ast-', '').toUpperCase()}</td>
                            <td className="px-6 py-4"><WOStatusBadge status={wo.status} /></td>
                            <td className="px-6 py-4"><PriorityBadge priority={wo.priority} /></td>
                            <td className="px-6 py-4 text-right text-brand-300">{wo.estimated_hours}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function WorkRequestTable({ wrs, onRowClick }: { wrs: WorkRequest[], onRowClick: (w: WorkRequest) => void }) {
    if (wrs.length === 0) return <div className="p-8 text-center text-slate-400">No work requests found.</div>;
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-500 uppercase bg-brand-800/50 border-b border-slate-200">
                    <tr>
                        <th className="px-6 py-4 font-semibold tracking-wider">WR Number</th>
                        <th className="px-6 py-4 font-semibold tracking-wider">Title</th>
                        <th className="px-6 py-4 font-semibold tracking-wider">Asset</th>
                        <th className="px-6 py-4 font-semibold tracking-wider">RPN</th>
                        <th className="px-6 py-4 font-semibold tracking-wider">Status</th>
                        <th className="px-6 py-4 font-semibold tracking-wider">Priority</th>
                        <th className="px-6 py-4 font-semibold tracking-wider text-right">Created</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-brand-700/50">
                    {wrs.map((wr) => (
                        <tr key={wr.id} onClick={() => onRowClick(wr)} className="hover:bg-slate-100/30 cursor-pointer transition-colors group">
                            <td className="px-6 py-4 font-mono text-slate-800 group-hover:text-primary-600">{wr.wr_number}</td>
                            <td className="px-6 py-4 text-slate-800 font-medium truncate max-w-[250px]">{wr.title}</td>
                            <td className="px-6 py-4 text-slate-500 font-mono text-xs">{wr.asset_id.replace('ast-', '').toUpperCase()}</td>
                            <td className="px-6 py-4"><RPNBadge rpn={wr.rpn} /></td>
                            <td className="px-6 py-4"><WRStatusBadge status={wr.status} /></td>
                            <td className="px-6 py-4"><PriorityBadge priority={wr.priority} /></td>
                            <td className="px-6 py-4 text-right text-slate-500 text-xs">{new Date(wr.created_at).toLocaleDateString()}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// ── Badges ─────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: string }) {
    const map: Record<string, string> = {
        'PM': 'bg-blue-500/10 text-blue-400 border-blue-500/20',
        'CM': 'bg-orange-500/10 text-orange-400 border-orange-500/20',
        'EM': 'bg-red-500/10 text-red-400 border-red-500/20',
        'PdM': 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    };
    return <span className={`px-2 py-1 text-xs font-semibold rounded border ${map[type] || 'bg-slate-100 text-brand-300'}`}>{type}</span>;
}

function PriorityBadge({ priority }: { priority: string }) {
    const map: Record<string, string> = {
        'emergency': 'text-red-400 bg-red-400/10',
        'urgent': 'text-orange-400 bg-orange-400/10',
        'routine': 'text-brand-300 bg-slate-100',
    };
    return <span className={`px-2 py-1 text-xs font-medium rounded-full capitalize ${map[priority] || 'bg-slate-100 text-brand-300'}`}>{priority}</span>;
}

function RPNBadge({ rpn }: { rpn: number }) {
    let color = 'text-green-400 bg-green-400/10';
    if (rpn >= 15) color = 'text-red-400 bg-red-400/10';
    else if (rpn >= 8) color = 'text-yellow-400 bg-yellow-400/10';
    return <span className={`px-2 py-1 text-xs font-bold rounded-md ${color}`}>{rpn}</span>;
}

function WOStatusBadge({ status }: { status: string }) {
    const map: Record<string, string> = {
        'planning': 'text-slate-500', 'scheduled': 'text-blue-400', 'in_progress': 'text-accent-cyan',
        'on_hold': 'text-yellow-500', 'teco': 'text-blue-400', 'closed': 'text-green-400'
    };
    return <span className={`flex items-center space-x-1.5 text-xs font-medium uppercase tracking-wider ${map[status] || 'text-brand-300'}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-current" />
        <span>{status.replace('_', ' ')}</span>
    </span>;
}

function WRStatusBadge({ status }: { status: string }) {
    const map: Record<string, string> = {
        'draft': 'text-slate-400', 'pending_review': 'text-yellow-400', 'approved': 'text-green-400',
        'rejected': 'text-red-400', 'wo_generated': 'text-accent-cyan'
    };
    return <span className={`flex items-center space-x-1.5 text-xs font-medium uppercase tracking-wider ${map[status] || 'text-brand-300'}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-current" />
        <span>{status.replace('_', ' ')}</span>
    </span>;
}

// ── Detail Panels (Slide-outs) ─────────────────────────────────────────

function WODetailPanel({ wo, onClose, onTeco, onEdit, onDelete }: { wo: WorkOrder, onClose: () => void, onTeco: (fc: any) => void, onEdit: () => void, onDelete: () => void }) {
    const [isFailureCoding, setIsFailureCoding] = useState(false);
    const [fcMode, setFcMode] = useState('');
    const [fcCause, setFcCause] = useState('bearing_wear');
    const [fcRemedy, setFcRemedy] = useState('');
    const navigate = useNavigate();
    const deTaskId = (wo as any).properties?.de_task_id;

    return (
        <div className="fixed inset-y-0 right-0 w-full md:w-[600px] bg-white shadow-2xl border-l border-slate-200 z-50 flex flex-col transform transition-transform duration-300">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-slate-200 bg-white">
                <div>
                    <div className="flex items-center space-x-3 mb-1">
                        <TypeBadge type={wo.type} />
                        <h2 className="text-xl font-bold text-slate-900 font-mono tracking-tight">{wo.wo_number}</h2>
                    </div>
                    <p className="text-slate-500 text-sm truncate max-w-[400px]">{wo.title}</p>
                </div>
                <div className="flex items-center gap-2">
                    {wo.status === 'draft' && (
                        <button onClick={onDelete} className="p-2 text-red-400 hover:text-red-300 rounded-md hover:bg-red-500/10 transition-colors" title="Delete Draft WO">
                            <Trash2 size={18} />
                        </button>
                    )}
                    <button onClick={onEdit} className="p-2 text-slate-500 hover:text-primary-600 rounded-md hover:bg-primary-50 transition-colors" title="Edit WO">
                        <Pencil size={18} />
                    </button>
                    <button onClick={onClose} className="p-2 text-slate-500 hover:text-slate-800 rounded-md hover:bg-slate-100 transition-colors">
                        <XCircle size={24} />
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-8">
                {/* Meta Grid */}
                <div className="grid grid-cols-2 gap-6 bg-slate-50 p-5 rounded-lg border border-slate-200/30">
                    <div><p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Status</p><WOStatusBadge status={wo.status} /></div>
                    <div><p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Asset</p><a href={`/assets?id=${wo.asset_id}`} className="text-primary-600 hover:underline font-mono font-medium cursor-pointer">{wo.asset_id.toUpperCase()}</a></div>
                    <div><p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Priority</p><PriorityBadge priority={wo.priority} /></div>
                    <div><p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Crew</p><p className="text-slate-800">{wo.assigned_crew || 'Unassigned'}</p></div>
                </div>

                {/* Status Stepper */}
                <StatusStepper currentStatus={wo.status} />

                {/* DE Task Backlink */}
                {deTaskId && (
                    <button
                        onClick={() => { onClose(); navigate(`/analyze?division=defect_elimination&task=${deTaskId}`); }}
                        className="w-full flex items-center gap-3 p-4 rounded-lg bg-blue-50 border border-blue-200/60 hover:bg-blue-100 hover:border-blue-300 transition-all text-left group"
                    >
                        <div className="p-2 rounded-lg bg-blue-100">
                            <Target size={16} className="text-blue-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <span className="text-xs font-bold text-blue-700 uppercase tracking-wide">Defect Elimination Origin</span>
                            <p className="text-[11px] text-blue-600/80 mt-0.5">This WO was generated from a DE task. Click to view the reliability initiative.</p>
                        </div>
                        <span className="text-blue-400 group-hover:text-blue-600 group-hover:translate-x-0.5 transition-all">→</span>
                    </button>
                )}

                {/* Description */}
                <div>
                    <h3 className="text-sm font-semibold text-brand-300 uppercase tracking-wider mb-3">Job Plan & Description</h3>
                    <p className="text-slate-800 text-sm leading-relaxed">{wo.description}</p>
                </div>

                {/* Failure Coding Display (If TECO) */}
                {wo.failure_coding && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-5">
                        <h3 className="text-sm font-semibold text-red-400 uppercase tracking-wider mb-3 flex items-center">
                            <AlertTriangle size={16} className="mr-2" /> Failure Coding Record
                        </h3>
                        <div className="grid grid-cols-2 gap-4">
                            <div><p className="text-xs text-slate-400 uppercase">Mode</p><p className="text-slate-800 text-sm">{wo.failure_coding.failure_mode}</p></div>
                            <div><p className="text-xs text-slate-400 uppercase">Cause</p><p className="text-slate-800 text-sm capitalize">{wo.failure_coding.failure_cause.replace('_', ' ')}</p></div>
                            <div className="col-span-2"><p className="text-xs text-slate-400 uppercase">Remedy</p><p className="text-slate-800 text-sm">{wo.failure_coding.remedy}</p></div>
                        </div>
                    </div>
                )}

                {/* Costs */}
                <div>
                    <h3 className="text-sm font-semibold text-brand-300 uppercase tracking-wider mb-3">Cost Snapshot (USD)</h3>
                    <div className="grid grid-cols-4 gap-4 text-center">
                        <CostBox label="Labor" val={wo.costs.labor} />
                        <CostBox label="Material" val={wo.costs.material} />
                        <CostBox label="Services" val={wo.costs.services} />
                        <CostBox label="Total" val={wo.costs.total} highlight />
                    </div>
                </div>
            </div>

            {/* Footer Action */}
            <div className="p-6 border-t border-slate-200 bg-white">
                {wo.status === 'in_progress' && !isFailureCoding && (
                    <button onClick={() => setIsFailureCoding(true)} className="w-full btn-blue py-3 shadow-lg">
                        <CheckCircle size={18} className="mr-2" /> Mark Technically Complete (TECO)
                    </button>
                )}

                {isFailureCoding && (
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-5 animate-in fade-in slide-in-from-bottom-4">
                        <h4 className="text-slate-800 font-medium mb-4 flex items-center"><ShieldAlert size={16} className="text-yellow-500 mr-2" /> Mandatory Failure Coding</h4>
                        <div className="space-y-4">
                            <div><label className="block text-xs text-slate-500 mb-1">Failure Mode</label><input type="text" className="input-field py-2" value={fcMode} onChange={e => setFcMode(e.target.value)} placeholder="e.g. Seal Blowout" /></div>
                            <div>
                                <label className="block text-xs text-slate-500 mb-1">Root Cause</label>
                                <select className="input-field py-2" value={fcCause} onChange={e => setFcCause(e.target.value)}>
                                    <option value="bearing_wear">Bearing Wear</option><option value="seal_leak">Seal Leak</option>
                                    <option value="vibration">Vibration</option><option value="lubrication">Lubrication Issue</option>
                                </select>
                            </div>
                            <div><label className="block text-xs text-slate-500 mb-1">Remedy Applied</label><textarea className="input-field py-2 h-20" value={fcRemedy} onChange={e => setFcRemedy(e.target.value)} placeholder="Describe exact fix..." /></div>
                            <div className="flex space-x-3 pt-2">
                                <button onClick={() => setIsFailureCoding(false)} className="btn-secondary flex-1">Cancel</button>
                                <button
                                    onClick={() => onTeco({ failure_mode: fcMode, failure_cause: fcCause, remedy: fcRemedy, downtime_hours: 8 })}
                                    disabled={!fcMode || !fcRemedy}
                                    className="btn-primary flex-1 disabled:opacity-50"
                                >
                                    Confirm TECO
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function CostBox({ label, val, highlight }: { label: string, val: number, highlight?: boolean }) {
    return (
        <div className={`p-3 rounded-md border ${highlight ? 'bg-accent-cyan/10 border-accent-cyan/30 text-accent-cyan' : 'bg-slate-50 border-slate-200/50 text-brand-300'}`}>
            <p className="text-[10px] uppercase tracking-wider font-semibold opacity-70 mb-1">{label}</p>
            <p className={`font-mono ${highlight ? 'text-lg font-bold' : 'text-sm'}`}>${val.toLocaleString()}</p>
        </div>
    );
}

function WRDetailPanel({ wr, onClose, onApprove, onReject, onDelete }: { wr: WorkRequest, onClose: () => void, onApprove: () => void, onReject: (r: string, s: string) => void, onDelete: () => void }) {
    const isCritA = wr.criticality === 'A';
    const [isRejecting, setIsRejecting] = useState(false);
    const [rejReason, setRejReason] = useState('');
    const [signoff, setSignoff] = useState('');

    return (
        <div className="fixed inset-y-0 right-0 w-full md:w-[500px] bg-white shadow-2xl border-l border-slate-200 z-50 flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-slate-200 bg-white">
                <div>
                    <h2 className="text-xl font-bold text-slate-900 font-mono tracking-tight mb-1">{wr.wr_number}</h2>
                    <WRStatusBadge status={wr.status} />
                </div>
                <div className="flex items-center gap-2">
                    {wr.status === 'draft' && (
                        <button onClick={onDelete} className="p-2 text-red-400 hover:text-red-300 rounded-md hover:bg-red-500/10 transition-colors" title="Delete Draft WR">
                            <Trash2 size={18} />
                        </button>
                    )}
                    <button onClick={onClose} className="p-2 text-slate-500 hover:text-white"><XCircle size={24} /></button>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <div>
                    <h3 className="text-lg font-medium text-slate-800 mb-2">{wr.title}</h3>
                    <p className="text-slate-500 text-sm bg-slate-50 p-4 rounded-md border border-slate-200/30">{wr.description}</p>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                    <div><span className="block text-slate-400 text-xs uppercase mb-1">Asset</span><a href={`/assets?id=${wr.asset_id}`} className="text-primary-600 hover:underline font-mono cursor-pointer">{wr.asset_id.toUpperCase()}</a></div>
                    <div><span className="block text-slate-400 text-xs uppercase mb-1">Criticality</span><span className="text-slate-800">Class {wr.criticality}</span></div>
                    <div><span className="block text-slate-400 text-xs uppercase mb-1">Requester</span><span className="text-slate-800">{wr.requester}</span></div>
                    <div><span className="block text-slate-400 text-xs uppercase mb-1">Priority</span><PriorityBadge priority={wr.priority} /></div>
                    <div className="col-span-2 pt-2"><span className="block text-slate-400 text-xs uppercase mb-1">Risk Priority Number (RPN)</span><RPNBadge rpn={wr.rpn} /></div>
                </div>

                {wr.status === 'rejected' && (
                    <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-md space-y-2 mt-4">
                        <h4 className="text-red-400 font-semibold text-sm uppercase tracking-wider">Gatekeeper Rejection</h4>
                        <p className="text-slate-800 text-sm">Reason: {wr.rejection_reason}</p>
                        <p className="text-slate-400 text-xs font-mono">Signoff: {wr.gatekeeper_signoff}</p>
                    </div>
                )}
            </div>

            {wr.status === 'pending_review' && (
                <div className="p-6 border-t border-slate-200 bg-white">
                    {!isRejecting ? (
                        <div className="flex space-x-3">
                            <button onClick={() => setIsRejecting(true)} className="btn-secondary flex-1 border-red-900/50 text-red-400 hover:bg-red-500/10 hover:border-red-500/30">Reject</button>
                            <button onClick={onApprove} className="btn-primary flex-1 bg-green-600 hover:bg-green-500 border-none">Approve to WO</button>
                        </div>
                    ) : (
                        <div className="space-y-4 animate-in fade-in">
                            {isCritA && (
                                <div className="bg-red-500/10 border border-red-500/30 p-3 rounded text-sm text-red-200 flex items-start">
                                    <ShieldAlert size={16} className="text-red-400 mr-2 mt-0.5 shrink-0" />
                                    <span><strong>Gatekeeper Protocol:</strong> Rejecting a Criticality A request requires mandatory reasoning and signoff.</span>
                                </div>
                            )}
                            <textarea className="input-field py-2 h-20 w-full text-sm" placeholder="Reason for rejection..." value={rejReason} onChange={e => setRejReason(e.target.value)} />
                            {isCritA && <input type="text" className="input-field py-2 w-full text-sm" placeholder="Digital Signoff (Username)" value={signoff} onChange={e => setSignoff(e.target.value)} />}
                            <div className="flex space-x-3">
                                <button onClick={() => setIsRejecting(false)} className="btn-secondary px-4">Cancel</button>
                                <button
                                    onClick={() => onReject(rejReason, signoff)}
                                    disabled={!rejReason || (isCritA && !signoff)}
                                    className="btn-primary flex-1 bg-red-600 hover:bg-red-500 border-none disabled:opacity-50"
                                >
                                    Confirm Rejection
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Status Stepper ─────────────────────────────────────────────────────

const WO_STATUS_FLOW = ['draft', 'planning', 'scheduled', 'in_progress', 'teco', 'closed'] as const;
const STATUS_LABELS: Record<string, string> = {
    draft: 'Draft', planning: 'Planning', scheduled: 'Scheduled',
    in_progress: 'In Progress', on_hold: 'On Hold', teco: 'TECO', closed: 'Closed',
};

function StatusStepper({ currentStatus }: { currentStatus: string }) {
    const currentIdx = WO_STATUS_FLOW.indexOf(currentStatus as any);

    return (
        <div>
            <h3 className="text-sm font-semibold text-brand-300 uppercase tracking-wider mb-3">Workflow Progress</h3>
            <div className="flex items-center">
                {WO_STATUS_FLOW.map((step, i) => {
                    const isCompleted = i < currentIdx;
                    const isCurrent = step === currentStatus;
                    const isLast = i === WO_STATUS_FLOW.length - 1;

                    return (
                        <React.Fragment key={step}>
                            {/* Step circle + label */}
                            <div className="flex flex-col items-center min-w-0 flex-1">
                                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold border-2 transition-all ${isCurrent
                                    ? 'border-primary-600 bg-primary-50 text-primary-600 shadow-[0_0_8px_rgba(36,108,255,0.2)]'
                                    : isCompleted
                                        ? 'border-green-500 bg-green-500/20 text-green-400'
                                        : 'border-slate-300 bg-white text-slate-400'
                                    }`}>
                                    {isCompleted ? '✓' : i + 1}
                                </div>
                                <span className={`mt-1.5 text-[9px] uppercase tracking-wider font-semibold truncate max-w-[60px] text-center ${isCurrent ? 'text-primary-600' : isCompleted ? 'text-green-400' : 'text-slate-400'
                                    }`}>
                                    {STATUS_LABELS[step]}
                                </span>
                            </div>
                            {/* Connector line */}
                            {!isLast && (
                                <div className={`h-0.5 flex-1 -mt-4 mx-0.5 rounded-full ${i < currentIdx ? 'bg-green-500/60' : 'bg-slate-100'
                                    }`} />
                            )}
                        </React.Fragment>
                    );
                })}
            </div>
        </div>
    );
}

// ── Modals ─────────────────────────────────────────────────────────────

function NewWRModal({ onClose, onSubmit }: { onClose: () => void, onSubmit: (t: string, d: string, a: string, s: number, p: any) => void }) {
    const [title, setTitle] = useState('');
    const [desc, setDesc] = useState('');
    const [assetId, setAssetId] = useState('');
    const [sev, setSev] = useState(1);
    const [pri, setPri] = useState('routine');

    const { assetOptions, getAssetById } = useAssetLookup();

    const selectedAsset = getAssetById(assetId);

    return (
        <div className="fixed inset-0 bg-brand-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white border border-slate-200/50 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
                <div className="px-6 py-5 border-b border-slate-200/50 flex justify-between items-center bg-brand-800/80 sticky top-0">
                    <h2 className="text-lg font-semibold text-slate-800">Raise Work Request</h2>
                    <button onClick={onClose} className="text-slate-500 hover:text-white"><XCircle size={20} /></button>
                </div>

                <div className="p-6 space-y-5 overflow-y-auto">
                    <div><label className="block text-sm font-medium text-brand-300 mb-1.5">Asset</label>
                        <select className="input-field py-2.5 w-full text-sm font-mono" value={assetId} onChange={e => setAssetId(e.target.value)}>
                            <option value="">Select Asset...</option>
                            {assetOptions.map(a => <option key={a.id} value={a.id}>{a.tag} — {a.name}</option>)}
                        </select>
                    </div>

                    {selectedAsset && selectedAsset.criticality === 'A' && (
                        <div className="bg-red-500/10 border border-red-500/20 p-3 rounded flex items-start">
                            <AlertTriangle size={16} className="text-red-400 mr-2 mt-0.5 shrink-0" />
                            <p className="text-xs text-slate-800"><strong>Safety Critical Asset (Class A).</strong> WRs raised here automatically bypass Level 1 planning and require Reliability Engineer signoff.</p>
                        </div>
                    )}

                    <div><label className="block text-sm font-medium text-brand-300 mb-1.5">Defect / Issue Title</label><input type="text" className="input-field py-2.5 w-full text-sm" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Pump leaking out of seal" /></div>
                    <div><label className="block text-sm font-medium text-brand-300 mb-1.5">Detailed Description</label><textarea className="input-field py-2.5 w-full h-24 text-sm" value={desc} onChange={e => setDesc(e.target.value)} /></div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-brand-300 mb-1.5">Severity (1-5)</label>
                            <input type="number" min="1" max="5" className="input-field py-2.5 w-full text-center" value={sev} onChange={e => setSev(parseInt(e.target.value) || 1)} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-brand-300 mb-1.5">Priority</label>
                            <select className="input-field py-2.5 w-full text-sm capitalize" value={pri} onChange={e => setPri(e.target.value)}>
                                <option value="routine">Routine</option>
                                <option value="urgent">Urgent</option>
                                <option value="emergency">Emergency</option>
                            </select>
                        </div>
                    </div>
                </div>

                <div className="p-6 border-t border-slate-200 bg-slate-50 flex justify-end space-x-3">
                    <button onClick={onClose} className="btn-secondary">Cancel</button>
                    <button onClick={() => onSubmit(title, desc, assetId, sev, pri)} disabled={!assetId || !title} className="btn-primary disabled:opacity-50">Submit Request</button>
                </div>
            </div>
        </div>
    );
}
