import React, { useState, useEffect, useCallback } from 'react';
import {
    Bot, Wrench, Search, BarChart3, CheckCircle2, XCircle,
    ChevronDown, ChevronRight, Clock, AlertTriangle, Loader2, Sparkles, Eye
} from 'lucide-react';
import { predictionService } from '../../eam/services/PredictionService';
import type { AgentAction, AgentActionStatus } from '../../eam/services/PredictionService';

// ─── Props ───────────────────────────────────────────────────

interface AgentReviewPanelProps {
    assetId?: string;
    /** Current user for audit trail */
    currentUser?: string;
    /** Callback when an action is approved (parent can refresh data) */
    onActionApproved?: (action: AgentAction) => void;
    /** Callback when an action is rejected */
    onActionRejected?: (action: AgentAction) => void;
}

// ─── Tab Configuration ───────────────────────────────────────

const TABS = [
    { key: 'all', label: 'All Drafts', icon: Bot },
    { key: 'alert_to_wo', label: 'WO Drafts', icon: Wrench },
    { key: 'vision_to_wo', label: 'Vision WO', icon: Eye },
    { key: 'bad_actor_rca', label: 'RCA Drafts', icon: Search },
    { key: 'threshold_adapter', label: 'Thresholds', icon: BarChart3 },
] as const;

type TabKey = typeof TABS[number]['key'];

const STATUS_STYLES: Record<AgentActionStatus, { bg: string; text: string; label: string }> = {
    pending_review: { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700', label: 'Pending Review' },
    approved: { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', label: 'Approved' },
    rejected: { bg: 'bg-red-50 border-red-200', text: 'text-red-600', label: 'Rejected' },
    expired: { bg: 'bg-slate-50 border-slate-200', text: 'text-slate-500', label: 'Expired' },
};

const AGENT_BADGES: Record<string, { icon: typeof Bot; color: string; label: string }> = {
    alert_to_wo: { icon: Wrench, color: 'text-blue-600 bg-blue-50 border-blue-200', label: 'WO Agent' },
    vision_to_wo: { icon: Eye, color: 'text-primary-600 bg-primary-50 border-primary-200', label: 'Vision Agent' },
    bad_actor_rca: { icon: Search, color: 'text-blue-600 bg-blue-50 border-blue-200', label: 'RCA Agent' },
    threshold_adapter: { icon: BarChart3, color: 'text-primary-600 bg-primary-50 border-primary-200', label: 'Threshold Agent' },
};

// ─── Component ───────────────────────────────────────────────

export const AgentReviewPanel: React.FC<AgentReviewPanelProps> = ({
    assetId, currentUser = 'system', onActionApproved, onActionRejected,
}) => {
    const [actions, setActions] = useState<AgentAction[]>([]);
    const [loading, setLoading] = useState(false);
    const [activeTab, setActiveTab] = useState<TabKey>('all');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [rejectNotes, setRejectNotes] = useState<Record<string, string>>({});

    const fetchActions = useCallback(async () => {
        setLoading(true);
        try {
            const agentType = activeTab === 'all' ? undefined : activeTab as any;
            const data = await predictionService.getAgentActions(assetId, undefined, agentType);
            setActions(data);
        } finally { setLoading(false); }
    }, [assetId, activeTab]);

    useEffect(() => { fetchActions(); }, [fetchActions]);

    const handleApprove = async (action: AgentAction) => {
        setProcessingId(action.id);
        try {
            const ok = await predictionService.updateAgentActionStatus(action.id, 'approved', currentUser);
            if (ok) {
                // Threshold proposals: approval APPLIES the bands (1.5.4 write-back)
                // — sensor rows + matching reading definitions (provenance 'learned').
                if (action.agent_type === 'threshold_adapter') {
                    const proposals = (action.draft_payload as any)?.proposals || [];
                    const { applied } = await predictionService.applyApprovedThresholds(action.asset_id, proposals);
                    console.info(`[AgentReviewPanel] threshold approval applied ${applied} band update(s)`);
                }
                onActionApproved?.(action);
                await fetchActions();
            }
        } finally { setProcessingId(null); }
    };

    const handleReject = async (action: AgentAction) => {
        setProcessingId(action.id);
        try {
            const notes = rejectNotes[action.id] || '';
            const ok = await predictionService.updateAgentActionStatus(action.id, 'rejected', currentUser, notes);
            if (ok) {
                onActionRejected?.(action);
                await fetchActions();
            }
        } finally { setProcessingId(null); }
    };

    const pendingCount = actions.filter(a => a.status === 'pending_review').length;

    const filteredActions = activeTab === 'all'
        ? actions
        : actions.filter(a => a.agent_type === activeTab);

    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-gradient-to-br from-blue-100 to-blue-100">
                    <Sparkles size={18} className="text-blue-600" />
                </div>
                <div className="flex-1">
                    <h3 className="text-base font-semibold text-slate-800">Agent Intelligence Review</h3>
                    <p className="text-xs text-slate-400">HITL Governance — All drafts require human approval</p>
                </div>
                {pendingCount > 0 && (
                    <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-amber-100 text-amber-700 animate-pulse">
                        {pendingCount} pending
                    </span>
                )}
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-100 px-2 overflow-x-auto">
                {TABS.map(tab => {
                    const Icon = tab.icon;
                    const count = tab.key === 'all' ? actions.length : actions.filter(a => a.agent_type === tab.key).length;
                    return (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                                activeTab === tab.key
                                    ? 'border-blue-500 text-blue-700'
                                    : 'border-transparent text-slate-400 hover:text-slate-600'
                            }`}
                        >
                            <Icon size={13} />
                            {tab.label}
                            {count > 0 && (
                                <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] ${
                                    activeTab === tab.key ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'
                                }`}>{count}</span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Actions List */}
            <div className="divide-y divide-slate-50 max-h-[520px] overflow-y-auto">
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 size={20} className="animate-spin text-blue-400" />
                        <span className="ml-2 text-sm text-slate-400">Loading agent actions...</span>
                    </div>
                ) : filteredActions.length === 0 ? (
                    <div className="text-center py-12">
                        <Bot size={32} className="mx-auto text-slate-200 mb-3" />
                        <p className="text-sm text-slate-400">No agent actions found.</p>
                        <p className="text-xs text-slate-300 mt-1">Agents will create drafts when prediction alerts trigger workflows.</p>
                    </div>
                ) : (
                    filteredActions.map(action => {
                        const isExpanded = expandedId === action.id;
                        const isProcessing = processingId === action.id;
                        const badge = AGENT_BADGES[action.agent_type] || AGENT_BADGES.alert_to_wo;
                        const BadgeIcon = badge.icon;
                        const statusStyle = STATUS_STYLES[action.status];
                        const payload = action.draft_payload || {};

                        return (
                            <div key={action.id} className={`px-5 py-3 transition-colors ${action.status === 'pending_review' ? 'bg-amber-50/30' : ''}`}>
                                {/* Summary Row */}
                                <button
                                    onClick={() => setExpandedId(isExpanded ? null : action.id)}
                                    className="w-full flex items-start gap-3 text-left"
                                >
                                    <div className="mt-0.5">
                                        {isExpanded ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded border ${badge.color}`}>
                                                <BadgeIcon size={10} /> {badge.label}
                                            </span>
                                            <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded border ${statusStyle.bg} ${statusStyle.text}`}>
                                                {statusStyle.label}
                                            </span>
                                        </div>
                                        <p className="text-sm font-medium text-slate-700 truncate">
                                            {payload.title || payload.problem_statement || `${action.action_type} for ${action.trigger_id}`}
                                        </p>
                                        <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400">
                                            <Clock size={10} />
                                            {new Date(action.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                        </div>
                                    </div>
                                </button>

                                {/* Expanded Detail */}
                                {isExpanded && (
                                    <div className="mt-3 ml-7 space-y-3 animate-in slide-in-from-top-2 duration-200">
                                        {/* Draft Preview */}
                                        <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                                            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Draft Preview</p>
                                            {action.action_type === 'wr_draft' && (
                                                <div className="space-y-2 text-xs text-slate-600">
                                                    <div className="flex justify-between"><span className="text-slate-400">Title:</span> <span className="font-medium">{payload.title}</span></div>
                                                    <div className="flex justify-between"><span className="text-slate-400">Work Type:</span> <span className="font-mono">{payload.work_type}</span></div>
                                                    <div className="flex justify-between"><span className="text-slate-400">Priority:</span> <span className={`font-semibold ${payload.priority === 'emergency' ? 'text-red-500' : payload.priority === 'urgent' ? 'text-amber-500' : 'text-slate-600'}`}>{payload.priority?.toUpperCase()}</span></div>
                                                    <div className="flex justify-between"><span className="text-slate-400">RPN:</span> <span className="font-bold">{payload.rpn}</span></div>
                                                    <div className="flex justify-between"><span className="text-slate-400">Craft:</span> <span>{payload.recommended_craft}</span></div>
                                                    <div className="flex justify-between"><span className="text-slate-400">Est. Hours:</span> <span>{payload.estimated_hours}h</span></div>
                                                    {payload.suggested_failure_mode && <div className="flex justify-between"><span className="text-slate-400">Failure Mode:</span> <span className="font-mono text-[10px]">{payload.suggested_failure_mode}</span></div>}
                                                    <p className="text-xs text-slate-500 mt-2 bg-white p-2 rounded border border-slate-100 leading-relaxed">{payload.description}</p>
                                                </div>
                                            )}
                                            {action.action_type === 'rca_draft' && (
                                                <div className="space-y-2 text-xs text-slate-600">
                                                    <p className="font-medium">{payload.problem_statement}</p>
                                                    {payload.why_branches?.length > 0 && (
                                                        <div>
                                                            <p className="text-[10px] font-semibold text-slate-400 mb-1">Initial Why-Branches:</p>
                                                            <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                                                                {payload.why_branches.map((w: string, i: number) => <li key={i}>{w}</li>)}
                                                            </ul>
                                                        </div>
                                                    )}
                                                    <div className="flex justify-between"><span className="text-slate-400">Priority:</span> <span className="font-semibold">{payload.priority?.toUpperCase()}</span></div>
                                                    <div className="flex justify-between"><span className="text-slate-400">Dominant Failure:</span> <span>{payload.dominant_failure_mode}</span></div>
                                                </div>
                                            )}
                                            {action.action_type === 'threshold_proposal' && (
                                                <div className="space-y-2 text-xs text-slate-600">
                                                    <div className="flex justify-between"><span className="text-slate-400">Precision:</span> <span className="font-bold">{((payload.precision || 0) * 100).toFixed(0)}%</span></div>
                                                    <div className="flex justify-between"><span className="text-slate-400">Sample Size:</span> <span>{payload.sample_size} feedback records</span></div>
                                                    {payload.proposals?.map((p: any, i: number) => (
                                                        <div key={i} className="bg-white p-2 rounded border border-slate-100">
                                                            <p className="font-mono text-[10px] font-semibold">{p.tag}</p>
                                                            <p className={`text-[10px] font-medium ${p.direction === 'widen' ? 'text-amber-600' : p.direction === 'tighten' ? 'text-emerald-600' : 'text-slate-500'}`}>
                                                                {p.direction === 'widen' ? '↔ Widen' : p.direction === 'tighten' ? '↕ Tighten' : '— No Change'}
                                                            </p>
                                                            <p className="text-[10px] text-slate-400 mt-0.5">{p.rationale}</p>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        {/* Review Actions */}
                                        {action.status === 'pending_review' && (
                                            <div className="space-y-2">
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => handleApprove(action)}
                                                        disabled={isProcessing}
                                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50 shadow-sm"
                                                    >
                                                        {isProcessing ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                                                        Approve & Create
                                                    </button>
                                                    <button
                                                        onClick={() => handleReject(action)}
                                                        disabled={isProcessing}
                                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-white text-red-600 border border-red-200 hover:bg-red-50 transition-colors disabled:opacity-50"
                                                    >
                                                        {isProcessing ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                                                        Reject
                                                    </button>
                                                </div>
                                                <input
                                                    type="text"
                                                    placeholder="Rejection reason (required for Criticality A)..."
                                                    value={rejectNotes[action.id] || ''}
                                                    onChange={e => setRejectNotes(prev => ({ ...prev, [action.id]: e.target.value }))}
                                                    className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-300 bg-slate-50"
                                                />
                                            </div>
                                        )}

                                        {/* Already reviewed info */}
                                        {action.status !== 'pending_review' && action.reviewed_by && (
                                            <div className="flex items-center gap-2 text-[10px] text-slate-400">
                                                <span>Reviewed by <strong>{action.reviewed_by}</strong></span>
                                                {action.reviewed_at && <span>on {new Date(action.reviewed_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
                                                {action.review_notes && <span className="italic">— "{action.review_notes}"</span>}
                                            </div>
                                        )}

                                        {/* HITL Governance Notice */}
                                        <div className="flex items-start gap-2 text-[10px] text-slate-400 bg-amber-50/50 rounded p-2 border border-amber-100/50">
                                            <AlertTriangle size={12} className="text-amber-400 shrink-0 mt-0.5" />
                                            <span>HITL: This draft was generated by an AI agent. Review all fields before approving. Approval will create the record in the production database.</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};
