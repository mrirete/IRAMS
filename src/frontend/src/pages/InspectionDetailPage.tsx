import React, { useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ArrowLeft, Play, CheckCircle2, Clock, Calendar, AlertTriangle,
    Plus, MapPin, Shield, Eye, Users, FileText, Wrench, Link2,
    Pause, Ban, ChevronDown, Cloud
} from 'lucide-react';
import { useIntegrity } from '../hooks/useIntegrity';
import { InspectionFindingCard } from '../components/integrity/InspectionFindingCard';
import { InspectionNotesPanel } from '../components/integrity/InspectionNotesPanel';
import { InspectionTeamPanel } from '../components/integrity/InspectionTeamPanel';
import { InspectionFormRenderer } from '../components/integrity/InspectionFormRenderer';
import { VisionCorrosionPanel } from '../components/integrity/VisionCorrosionPanel';
import { getTemplateByCode } from '../eam/constants/inspectionTemplates';
import { DatabaseService } from '../eam/services/DatabaseService';
import { buildWorkOrder } from '../eam/lib/workOrder';
import { useToast } from '../eam/contexts/ToastContext';
import type {
    InspectionFinding, InspectionNote,
    InspectionTeamMember, InspectionTeamRole, FindingSeverity,
    InspectionType, InspectionEventStatus
} from '../types/integrity';

// ── Status Config ──
const STATUS_CONFIG: Record<InspectionEventStatus, { label: string; icon: React.ReactNode; bg: string; text: string; gradient: string }> = {
    scheduled: { label: 'Scheduled', icon: <Calendar size={12} />, bg: 'bg-blue-50 border-blue-200', text: 'text-blue-700', gradient: 'from-blue-500 to-blue-600' },
    in_progress: { label: 'In Progress', icon: <Clock size={12} />, bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700', gradient: 'from-amber-500 to-orange-500' },
    completed: { label: 'Completed', icon: <CheckCircle2 size={12} />, bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', gradient: 'from-emerald-500 to-green-500' },
    overdue: { label: 'Overdue', icon: <AlertTriangle size={12} />, bg: 'bg-red-50 border-red-200', text: 'text-red-700', gradient: 'from-red-500 to-red-600' },
    deferred: { label: 'Deferred', icon: <Pause size={12} />, bg: 'bg-slate-50 border-slate-200', text: 'text-slate-600', gradient: 'from-slate-400 to-slate-500' },
    cancelled: { label: 'Cancelled', icon: <Ban size={12} />, bg: 'bg-slate-50 border-slate-200', text: 'text-slate-500', gradient: 'from-slate-400 to-slate-500' },
};

const TYPE_COLORS: Record<InspectionType, string> = {
    UT: 'bg-blue-50 text-blue-700 border-blue-200',
    PAUT: 'bg-blue-50 text-blue-700 border-blue-200',
    RT: 'bg-amber-50 text-amber-700 border-amber-200',
    VT: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    MT: 'bg-blue-50 text-blue-700 border-blue-200',
    PT: 'bg-rose-50 text-rose-700 border-rose-200',
    MFL: 'bg-primary-50 text-primary-700 border-primary-200',
};

type ActivePanel = 'findings' | 'checklist' | 'notes' | 'team' | 'vision';

const InspectionDetailPage: React.FC = () => {
    const { inspectionId } = useParams<{ inspectionId: string }>();
    const navigate = useNavigate();
    const { inspections, damageMechanisms, cmls, updateInspection } = useIntegrity();
    const { showToast } = useToast();

    // The shared record IS the source of truth — every edit goes through
    // updateInspection (optimistic + persisted + rollback on failure), so
    // nothing entered here is lost on navigation or reload.
    const localInsp = useMemo(() => inspections.find(i => i.id === inspectionId) ?? null, [inspections, inspectionId]);

    const [activePanel, setActivePanel] = useState<ActivePanel>('findings');
    const [showAddFinding, setShowAddFinding] = useState(false);
    const [newFindingDesc, setNewFindingDesc] = useState('');
    const [newFindingSeverity, setNewFindingSeverity] = useState<FindingSeverity>('moderate');

    // Checklist responses — kept local while typing, flushed to the record
    // (and DB) on a short debounce so text fields don't write per keystroke.
    const [checklistResponses, setChecklistResponses] = useState<Record<string, string | number | boolean>>({});
    const [checklistDirty, setChecklistDirty] = useState(false);
    const checklistHydrated = React.useRef(false);
    React.useEffect(() => {
        if (localInsp && !checklistHydrated.current) {
            checklistHydrated.current = true;
            setChecklistResponses(localInsp.checklist_responses || {});
        }
    }, [localInsp]);
    React.useEffect(() => {
        if (!checklistDirty || !localInsp) return;
        const t = setTimeout(() => {
            setChecklistDirty(false);
            updateInspection(localInsp.id, { checklist_responses: checklistResponses });
        }, 800);
        return () => clearTimeout(t);
    }, [checklistDirty, checklistResponses, localInsp, updateInspection]);

    // Get form template
    const template = useMemo(() => getTemplateByCode(localInsp?.governing_code || ''), [localInsp?.governing_code]);

    // Filter CMLs for this asset
    const assetCmls = useMemo(() => {
        if (!localInsp) return [];
        return cmls.filter(c => c.asset_id === localInsp.asset_id);
    }, [cmls, localInsp]);

    // Asset damage mechanisms
    const assetDMs = useMemo(() => {
        if (!localInsp) return damageMechanisms;
        return damageMechanisms.filter(dm => dm.affected_asset_ids.includes(localInsp.asset_id));
    }, [damageMechanisms, localInsp]);

    const isReadonly = localInsp?.status === 'completed' || localInsp?.status === 'cancelled';

    // ── Handlers — every mutation persists via updateInspection ──
    const startInspection = useCallback(() => {
        if (!localInsp) return;
        updateInspection(localInsp.id, {
            status: 'in_progress',
            started_date: new Date().toISOString(),
        });
    }, [localInsp, updateInspection]);

    const completeInspection = useCallback(() => {
        if (!localInsp) return;
        updateInspection(localInsp.id, {
            status: 'completed',
            completed_date: new Date().toISOString(),
            findings_count: localInsp.findings.length,
            checklist_responses: checklistResponses,
        });
    }, [localInsp, updateInspection, checklistResponses]);

    const addFinding = useCallback(() => {
        if (!localInsp || !newFindingDesc.trim()) return;
        const newFinding: InspectionFinding = {
            id: `fnd-${Date.now()}`,
            inspection_id: localInsp.id,
            sequence: localInsp.findings.length + 1,
            description: newFindingDesc.trim(),
            severity: newFindingSeverity,
            status: 'open',
            nde_method: localInsp.inspection_type,
            media_urls: [],
            created_by: localInsp.inspector,
            created_at: new Date().toISOString(),
        };
        updateInspection(localInsp.id, {
            findings: [...localInsp.findings, newFinding],
            findings_count: localInsp.findings.length + 1,
        });
        setNewFindingDesc('');
        setShowAddFinding(false);
    }, [localInsp, newFindingDesc, newFindingSeverity, updateInspection]);

    const updateFinding = useCallback((id: string, updates: Partial<InspectionFinding>) => {
        if (!localInsp) return;
        updateInspection(localInsp.id, {
            findings: localInsp.findings.map(f => f.id === id ? { ...f, ...updates } : f),
        });
    }, [localInsp, updateInspection]);

    const deleteFinding = useCallback((id: string) => {
        if (!localInsp) return;
        const updated = localInsp.findings.filter(f => f.id !== id).map((f, i) => ({ ...f, sequence: i + 1 }));
        updateInspection(localInsp.id, { findings: updated, findings_count: updated.length });
    }, [localInsp, updateInspection]);

    const addNote = useCallback((note: Omit<InspectionNote, 'id' | 'created_at'>) => {
        if (!localInsp) return;
        const newNote: InspectionNote = {
            ...note,
            id: `note-${Date.now()}`,
            created_at: new Date().toISOString(),
        };
        updateInspection(localInsp.id, { notes: [...localInsp.notes, newNote] });
    }, [localInsp, updateInspection]);

    const addTeamMember = useCallback((member: Omit<InspectionTeamMember, 'id' | 'added_at'>) => {
        if (!localInsp) return;
        const newMember: InspectionTeamMember = {
            ...member,
            id: `tm-${Date.now()}`,
            added_at: new Date().toISOString(),
        };
        updateInspection(localInsp.id, { team: [...localInsp.team, newMember] });
    }, [localInsp, updateInspection]);

    const removeTeamMember = useCallback((id: string) => {
        if (!localInsp) return;
        updateInspection(localInsp.id, { team: localInsp.team.filter(m => m.id !== id) });
    }, [localInsp, updateInspection]);

    const updateTeamRole = useCallback((id: string, role: InspectionTeamRole) => {
        if (!localInsp) return;
        updateInspection(localInsp.id, {
            team: localInsp.team.map(m => m.id === id ? { ...m, role } : m),
        });
    }, [localInsp, updateInspection]);

    // ── Raise a REAL corrective work order from a finding ──
    // The WO id is stored on the finding (work_request_id) and the finding is
    // marked actioned in the same persisted update, so traceability survives
    // reload. Failures toast and leave the finding untouched.
    const handleDraftWR = useCallback(async (finding: InspectionFinding) => {
        if (!localInsp) return;
        const priority = finding.severity === 'critical' || finding.severity === 'major' ? 'HIGH'
            : finding.severity === 'moderate' ? 'MEDIUM' : 'LOW';
        try {
            const wo = await DatabaseService.getInstance().createWorkOrder(buildWorkOrder({
                title: `Corrective — ${localInsp.asset_name || localInsp.asset_id}: ${finding.description.slice(0, 60)}`,
                description: `Raised from ${localInsp.inspection_type} inspection finding #${finding.sequence} (${finding.severity})`
                    + `${localInsp.governing_code ? ` under ${localInsp.governing_code}` : ''}.\n\n${finding.description}`
                    + `${finding.recommendation ? `\n\nRecommendation: ${finding.recommendation}` : ''}`
                    + `${finding.cml_number ? `\nCML: ${finding.cml_number}` : ''}`,
                assetId: localInsp.asset_id,
                type: 'CM',
                priorityCode: priority,
                status: 'OPEN',
            }), localInsp.inspector || 'inspection');
            if (!wo?.id) throw new Error('Work order creation returned no id');
            updateInspection(localInsp.id, {
                findings: localInsp.findings.map(f => f.id === finding.id
                    ? { ...f, work_request_id: wo.id as string, status: 'actioned' as const }
                    : f),
            });
            showToast(`Work order ${wo.wo_number || ''} raised from finding #${finding.sequence}.`, 'success');
        } catch (e) {
            console.error('Raise WO from finding failed:', e);
            showToast('Couldn\'t raise the work order — nothing was changed. Check your connection and try again.', 'error', 6000);
            throw e;
        }
    }, [localInsp, updateInspection, showToast]);

    // ── Not Found ──
    if (!localInsp) {
        return (
            <div className="flex items-center justify-center h-96">
                <div className="text-center">
                    <AlertTriangle size={48} className="mx-auto text-slate-300 mb-4" />
                    <h2 className="text-lg font-bold text-slate-600">Inspection Not Found</h2>
                    <p className="text-sm text-slate-400 mt-1">ID: {inspectionId}</p>
                    <button onClick={() => navigate('/comply/inspection-schedule')} className="mt-4 px-4 py-2 text-sm text-white bg-primary-500 rounded-lg hover:bg-primary-600 transition-colors">
                        Back to Schedule
                    </button>
                </div>
            </div>
        );
    }

    const sc = STATUS_CONFIG[localInsp.status];
    const typeColor = TYPE_COLORS[localInsp.inspection_type];

    const panels: { key: ActivePanel; label: string; icon: React.ReactNode; count?: number }[] = [
        { key: 'findings', label: 'Findings', icon: <AlertTriangle size={13} />, count: localInsp.findings.length },
        { key: 'checklist', label: 'Checklist', icon: <FileText size={13} /> },
        { key: 'notes', label: 'Notes', icon: <FileText size={13} />, count: localInsp.notes.length },
        { key: 'team', label: 'Team', icon: <Users size={13} />, count: localInsp.team.length },
        { key: 'vision', label: 'Vision', icon: <Eye size={13} /> },
    ];

    return (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
            {/* ── HEADER ── */}
            <div className="space-y-3">
                <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-primary-600 transition-colors">
                    <ArrowLeft size={14} /> Back
                </button>

                <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 shadow-sm">
                    <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                        {/* Status + Type badges */}
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg border ${sc.bg} ${sc.text}`}>
                                {sc.icon} {sc.label}
                            </span>
                            <span className={`px-2.5 py-1 text-xs font-bold rounded-lg border ${typeColor}`}>
                                {localInsp.inspection_type}
                            </span>
                            {localInsp.governing_code && (
                                <span className="px-2.5 py-1 text-xs font-bold rounded-lg bg-slate-50 border border-slate-200 text-slate-600">
                                    {localInsp.governing_code}
                                </span>
                            )}
                            {localInsp.approval_mode === 'two_step' && (
                                <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-blue-50 border border-blue-200 text-blue-600">
                                    2-Step Approval
                                </span>
                            )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 sm:ml-auto">
                            {(localInsp.status === 'scheduled' || localInsp.status === 'overdue') && (
                                <button onClick={startInspection} className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-gradient-to-r from-primary-500 to-blue-500 rounded-lg hover:from-primary-600 hover:to-blue-600 shadow-sm transition-all">
                                    <Play size={12} /> Start Inspection
                                </button>
                            )}
                            {localInsp.status === 'in_progress' && (
                                <button onClick={completeInspection} className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-gradient-to-r from-emerald-500 to-green-500 rounded-lg hover:from-emerald-600 hover:to-green-600 shadow-sm transition-all">
                                    <CheckCircle2 size={12} /> Complete
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Title & Description */}
                    <div className="mt-4">
                        <h1 className="text-xl font-bold text-slate-900">
                            {localInsp.asset_name || localInsp.asset_id}
                            <span className="text-slate-400 font-normal text-base ml-2">— {localInsp.inspection_type} Inspection</span>
                        </h1>
                        {localInsp.description && (
                            <p className="text-sm text-slate-500 mt-1">{localInsp.description}</p>
                        )}
                    </div>

                    {/* Meta Row */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 text-xs text-slate-500">
                        <span className="inline-flex items-center gap-1"><Calendar size={11} /> {new Date(localInsp.scheduled_date).toLocaleDateString()}</span>
                        <span className="inline-flex items-center gap-1"><Shield size={11} /> {localInsp.inspector}</span>
                        {localInsp.location_description && (
                            <span className="inline-flex items-center gap-1"><MapPin size={11} /> {localInsp.location_description}</span>
                        )}
                        {localInsp.weather_conditions && (
                            <span className="inline-flex items-center gap-1"><Cloud size={11} /> {localInsp.weather_conditions}</span>
                        )}
                        {localInsp.started_date && (
                            <span className="inline-flex items-center gap-1 text-amber-600"><Play size={11} /> Started {new Date(localInsp.started_date).toLocaleString()}</span>
                        )}
                        {localInsp.completed_date && (
                            <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 size={11} /> Completed {new Date(localInsp.completed_date).toLocaleString()}</span>
                        )}
                    </div>
                </div>
            </div>

            {/* ── TAB NAVIGATION ── */}
            <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-thin">
                {panels.map(p => (
                    <button
                        key={p.key}
                        onClick={() => setActivePanel(p.key)}
                        className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg whitespace-nowrap transition-all ${
                            activePanel === p.key
                                ? 'bg-gradient-to-r from-primary-500 to-blue-500 text-white shadow-sm'
                                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                        }`}
                    >
                        {p.icon}
                        {p.label}
                        {p.count !== undefined && p.count > 0 && (
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                                activePanel === p.key ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'
                            }`}>
                                {p.count}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* ── CONTENT PANELS ── */}
            <div className="min-h-[400px]">
                {/* FINDINGS */}
                {activePanel === 'findings' && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <div className="w-1 h-5 rounded-full bg-gradient-to-b from-orange-400 to-red-400" />
                                <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Findings</h2>
                                <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-medium">{localInsp.findings.length}</span>
                            </div>
                            {!isReadonly && (
                                <button
                                    onClick={() => setShowAddFinding(!showAddFinding)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-orange-700 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 transition-colors"
                                >
                                    <Plus size={12} /> Add Finding
                                </button>
                            )}
                        </div>

                        {/* Add Finding Form */}
                        {showAddFinding && !isReadonly && (
                            <div className="bg-white/80 backdrop-blur-sm border border-orange-200/60 rounded-xl p-4 space-y-3 shadow-sm animate-in slide-in-from-top-2">
                                <textarea
                                    value={newFindingDesc}
                                    onChange={e => setNewFindingDesc(e.target.value)}
                                    placeholder="Describe the finding — factual observation of what was detected..."
                                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-300 resize-none transition-all"
                                    rows={3}
                                    autoFocus
                                />
                                <div className="flex items-center gap-3">
                                    <select
                                        value={newFindingSeverity}
                                        onChange={e => setNewFindingSeverity(e.target.value as FindingSeverity)}
                                        className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-orange-300"
                                    >
                                        <option value="observation">Observation</option>
                                        <option value="minor">Minor</option>
                                        <option value="moderate">Moderate</option>
                                        <option value="major">Major</option>
                                        <option value="critical">Critical</option>
                                    </select>
                                    <div className="flex items-center gap-2 ml-auto">
                                        <button onClick={() => setShowAddFinding(false)} className="px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
                                        <button
                                            onClick={addFinding}
                                            disabled={!newFindingDesc.trim()}
                                            className="px-4 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-orange-500 to-red-500 rounded-lg hover:from-orange-600 hover:to-red-600 disabled:opacity-40 transition-all shadow-sm"
                                        >
                                            Add Finding
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Finding Cards */}
                        {localInsp.findings.length === 0 ? (
                            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
                                <AlertTriangle size={32} className="mx-auto text-slate-300 mb-2" />
                                <p className="text-sm text-slate-500 font-medium">No findings recorded</p>
                                <p className="text-xs text-slate-400 mt-1">Add findings as you inspect the asset</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {localInsp.findings.map(f => (
                                    <InspectionFindingCard
                                        key={f.id}
                                        finding={f}
                                        damageMechanisms={assetDMs}
                                        cmls={assetCmls}
                                        onUpdate={updateFinding}
                                        onDelete={deleteFinding}
                                        onDraftWR={handleDraftWR}
                                        readonly={isReadonly}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* CHECKLIST */}
                {activePanel === 'checklist' && template && (
                    <InspectionFormRenderer
                        template={template}
                        responses={checklistResponses}
                        onResponseChange={(fieldId, value) => { setChecklistResponses(prev => ({ ...prev, [fieldId]: value })); setChecklistDirty(true); }}
                        readonly={isReadonly}
                    />
                )}

                {/* NOTES */}
                {activePanel === 'notes' && (
                    <InspectionNotesPanel
                        notes={localInsp.notes}
                        onAdd={addNote}
                        readonly={isReadonly}
                        currentUser={localInsp.inspector}
                        inspectionId={localInsp.id}
                    />
                )}

                {/* TEAM */}
                {activePanel === 'team' && (
                    <InspectionTeamPanel
                        team={localInsp.team}
                        onAdd={addTeamMember}
                        onRemove={removeTeamMember}
                        onUpdateRole={updateTeamRole}
                        readonly={isReadonly}
                    />
                )}

                {/* VISION */}
                {activePanel === 'vision' && (
                    <div className="space-y-4">
                        <div className="flex items-center gap-2">
                            <div className="w-1 h-5 rounded-full bg-gradient-to-b from-primary-400 to-blue-400" />
                            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Vision AI Findings</h2>
                        </div>
                        <VisionCorrosionPanel assetId={localInsp.asset_id} assetName={localInsp.asset_name} />
                    </div>
                )}
            </div>
        </div>
    );
};

export default InspectionDetailPage;
