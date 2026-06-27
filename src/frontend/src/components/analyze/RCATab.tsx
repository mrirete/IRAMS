import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    GitMerge, Plus, Edit3, Trash2, X, Check, Info,
    AlertCircle, AlertTriangle, Wrench, Target, Zap, Search, Shield,
    BarChart3, Clock, ArrowRight, ArrowLeft, Maximize2, Minimize2, Filter, Hash,
    Database, Server, Loader2, CheckCircle,
    ChevronUp, ChevronDown, Users, MapPin, ChevronRight, FileText, Link2, Unlink,
} from 'lucide-react';
import analyzeService from '../../eam/services/AnalyzeService';
import { useAuth } from '../../eam/contexts/AuthContext';
import { aiEngine } from '../../eam/services/AIAnalysisEngine';
import type { RCAMethodRecommendation } from '../../eam/services/AIAnalysisEngine';
import type { RCANode, RCACorrectiveAction, RCAEvidence, ParetoResult, MaintenanceDataSummary, StudyCollaborator, EAMAssetDetail, EAMWorkOrder, EAMFailureTrends, RCAInvestigation } from '../../eam/services/AnalyzeService';
import { TeamPanel, AvatarStack } from './CollaboratorPicker';
import EAMContextPanel from './EAMContextPanel';
import WOPickerModal from './WOPickerModal';
import type { WOPickerResult } from './WOPickerModal';
import { useAssetContext } from '../../contexts/AssetContext';
import { useConnectors } from '../../hooks/useConnectors';
import ParetoAnalysisTab from './ParetoAnalysisTab';
import AssetDrillDrawer from './AssetDrillDrawer';
import CauseAnalysisSection from './CauseAnalysisSection';
import FiveWhySection from './FiveWhySection';
import RCAStepIndicator, { type StepCompletionData } from './RCAStepIndicator';
import RCAStepGuide from './RCAStepGuide';
import RCAEvidencePanel from './RCAEvidencePanel';
import RCASolutionsPanel from './RCASolutionsPanel';
import RCAEffectivenessPanel from './RCAEffectivenessPanel';

const TAXONOMY_BADGES: Record<string, { label: string; color: string }> = {
    site:      { label: 'SITE',    color: '#a855f7' },
    unit:      { label: 'UNIT',    color: '#3b82f6' },
    system:    { label: 'SYSTEM',  color: '#6366f1' },
    equipment: { label: 'EQUIP',   color: '#06b6d4' },
    subunit:   { label: 'SUBUNIT', color: '#14b8a6' },
    component: { label: 'COMP',    color: '#10b981' },
    location:  { label: 'LOC',     color: '#f59e0b' },
};

// â”€â”€ Props â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export interface IncomingWOPayload {
    asset_id: string;
    wo_id: string;
    wo_number: string;
    title: string;
    description: string;
    failure_mode?: string | null;
    failure_cause?: string | null;
    event_date: string;
    cost?: number;
}

interface RCATabProps {
    rcas: any[];
    expandedRca: string | null;
    onToggleExpand: (id: string | null) => void;
    onNewAssessment: () => void;
    onRefresh?: () => void;
    onDETaskCreated?: () => void;
    paretoData?: ParetoResult[];
    paretoCriteria?: 'cost' | 'downtime' | 'wo_frequency';
    onParetoDataChange?: (data: ParetoResult[], criteria: 'cost' | 'downtime' | 'wo_frequency') => void;
    onInitiateRCA?: (asset: ParetoResult) => void;
    onCreateFMEA?: (asset: ParetoResult) => void;
    incomingWO?: IncomingWOPayload | null;
}

const METHODS: Record<string, { label: string; color: string }> = {
    five_why: { label: '5-Why', color: '#22d3ee' },
    fishbone: { label: 'Fishbone', color: '#f59e0b' },
    fault_tree: { label: 'Fault Tree', color: '#a855f7' },
    logic_tree: { label: 'Logic Tree', color: '#8b5cf6' },
    taproot: { label: 'TapRooTÂ®', color: '#ef4444' },
    apollo: { label: 'Apollo', color: '#3b82f6' },
};

const STATUS_STYLES: Record<string, { bg: string; text: string; border: string }> = {
    draft: { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-300' },
    in_progress: { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-300' },
    review: { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-300' },
    closed: { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-300' },
};

export const RCATab: React.FC<RCATabProps> = ({
    rcas,
    expandedRca: _expandedRca,
    onToggleExpand: _onToggleExpand,
    onNewAssessment,
    onRefresh,
    onDETaskCreated,
    paretoData = [],
    paretoCriteria = 'cost',
    onParetoDataChange,
    onInitiateRCA,
    onCreateFMEA,
}) => {
    const navigate = useNavigate();
    const { assets: allHierarchyAssets } = useAssetContext();

    // â”€â”€ Selection & inline detail state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [currentStep, setCurrentStep] = useState(1);
    const [nodes, setNodes] = useState<RCANode[]>([]);
    const [actions, setActions] = useState<RCACorrectiveAction[]>([]);
    const [evidence, setEvidence] = useState<RCAEvidence[]>([]);
    const [detailLoading, setDetailLoading] = useState(false);
    const [drillAsset, setDrillAsset] = useState<ParetoResult | null>(null);
    const [paretoCollapsed, setParetoCollapsed] = useState(rcas.length > 0);
    const [expandedMode, setExpandedMode] = useState(false);
    const [rcaScope, setRcaScope] = useState<'all' | 'mine'>('all');

    // â”€â”€ Current user context (for scoping) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const { user: authUser, profile: authProfile, role: authRole } = useAuth();
    const currentContactId = authProfile?.contactId || null;
    const currentUsername = authProfile?.username || authUser?.email || '';
    const currentRole = authRole || '';

    // Determine if user has admin/manager-level visibility (full portfolio access)
    const isFullAccessRole = useMemo(() => {
        const fullAccessRoles = ['SYS_ADMIN', 'MANAGER', 'EXECUTIVE', 'PLANNER', 'SUPERVISOR'];
        return fullAccessRoles.includes(currentRole);
    }, [currentRole]);

    // â”€â”€ Helper: check if a user is a collaborator on an RCA â”€â”€â”€
    const isUserCollaborator = useCallback((rca: any): boolean => {
        const collabs = rca.collaborators || [];
        if (!currentContactId && !currentUsername) return false;
        return collabs.some((c: any) =>
            (currentContactId && c.ref_id === currentContactId) ||
            (c.name && c.name.toLowerCase() === currentUsername.toLowerCase())
        );
    }, [currentContactId, currentUsername]);

    // â”€â”€ Helper: check if user is involved in an RCA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const isUserInvolved = useCallback((rca: any): boolean => {
        return (
            rca.lead_investigator === currentUsername ||
            rca.created_by === currentUsername ||
            isUserCollaborator(rca)
        );
    }, [currentUsername, isUserCollaborator]);

    // â”€â”€ Filtered RCA list â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Full-access roles see all RCAs; scoped roles only see their own.
    // "My RCAs" always filters to personal involvement regardless of role.
    const displayedRcas = useMemo(() => {
        if (rcaScope === 'mine') {
            return rcas.filter(rca => isUserInvolved(rca));
        }
        // 'all' scope â€” admins see everything, others see only their own
        if (isFullAccessRole) return rcas;
        return rcas.filter(rca => isUserInvolved(rca));
    }, [rcas, rcaScope, isFullAccessRole, isUserInvolved]);

    // â”€â”€ Edit / Delete â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [editStatus, setEditStatus] = useState('');
    const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
    const [saving, setSaving] = useState(false);

    // â”€â”€ Collaboration state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const [showTeamPanel, setShowTeamPanel] = useState(false);
    const [rcaCollaborators, setRcaCollaborators] = useState<StudyCollaborator[]>([]);

    // â”€â”€ EAM Context Panel state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const [showEAMPanel, setShowEAMPanel] = useState(false);
    const [eamAsset, setEamAsset] = useState<EAMAssetDetail | null>(null);
    const [eamWorkOrders, setEamWorkOrders] = useState<EAMWorkOrder[]>([]);
    const [eamFailureTrends, setEamFailureTrends] = useState<EAMFailureTrends>({ modes: [], timeline: [], totalCM: 0, totalPM: 0, totalCost: 0 });
    const [eamRelatedRCAs, setEamRelatedRCAs] = useState<RCAInvestigation[]>([]);
    const [eamLoading, setEamLoading] = useState(false);
    // Map asset_id â†’ tag+criticality for the portfolio table
    const [assetTagMap, setAssetTagMap] = useState<Record<string, { tag: string; criticality: string; name: string }>>({});

    // â”€â”€ DE Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const [showDEModal, setShowDEModal] = useState(false);
    const [deCreating, setDeCreating] = useState(false);
    const [deCreated, setDeCreated] = useState(false);
    const [deDraft, setDeDraft] = useState({
        title: '', rootCauseSummary: '', proposedSolution: '',
        annualCost: 0, estimatedSavings: 0, implementationCost: 0,
        priority: 'high' as 'critical' | 'high' | 'medium' | 'low',
    });

    const selectedRca = rcas.find(r => r.id === selectedId) || null;

    // â”€â”€ Load detail data when selection changes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    useEffect(() => {
        if (!selectedId) { setNodes([]); setActions([]); setEvidence([]); return; }

        let cancelled = false;
        setDetailLoading(true);
        Promise.all([
            analyzeService.getRCANodes(selectedId),
            analyzeService.getRCACorrectiveActions(selectedId),
            analyzeService.getRCAEvidence(selectedId),
        ]).then(([n, a, e]) => {
            if (cancelled) return;
            setNodes(n); setActions(a); setEvidence(e);
            // Load collaborators from RCA record
            const rcaRecord = rcas.find(r => r.id === selectedId);
            setRcaCollaborators((rcaRecord as any)?.collaborators || []);
        }).catch(err => console.error('Error loading RCA detail:', err))
          .finally(() => { if (!cancelled) setDetailLoading(false); });
        return () => { cancelled = true; };
    }, [selectedId]);

    // â”€â”€ Load EAM context data when investigation is selected â”€â”€
    useEffect(() => {
        if (!selectedId || !selectedRca?.asset_id) {
            setEamAsset(null); setEamWorkOrders([]); setEamRelatedRCAs([]);
            setEamFailureTrends({ modes: [], timeline: [], totalCM: 0, totalPM: 0, totalCost: 0 });
            return;
        }
        const assetId = selectedRca.asset_id;
        let cancelled = false;
        setEamLoading(true);
        Promise.all([
            analyzeService.getAssetDetail(assetId),
            analyzeService.getAssetWorkOrders(assetId),
            analyzeService.getFailureTrends(assetId),
            analyzeService.getRelatedRCAs(assetId),
        ]).then(([asset, wos, trends, related]) => {
            if (cancelled) return;
            setEamAsset(asset);
            setEamWorkOrders(wos);
            setEamFailureTrends(trends);
            // Exclude current investigation from related list
            setEamRelatedRCAs(related.filter(r => r.id !== selectedId));
        }).catch(err => console.error('Error loading EAM context:', err))
          .finally(() => { if (!cancelled) setEamLoading(false); });
        return () => { cancelled = true; };
    }, [selectedId, selectedRca?.asset_id]);

    // â”€â”€ Batch lookup asset tags for portfolio table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    useEffect(() => {
        const ids = rcas.map(r => r.asset_id).filter(Boolean);
        const unique = [...new Set(ids)].filter(id => !assetTagMap[id]);
        if (unique.length === 0) return;
        // Use hierarchy assets first (already loaded)
        const newMap: Record<string, { tag: string; criticality: string; name: string }> = { ...assetTagMap };
        for (const id of unique) {
            const ha = allHierarchyAssets.find(a => a.id === id);
            if (ha) {
                newMap[id] = { tag: ha.tag || '', criticality: (ha as any).criticality || 'C', name: ha.name || '' };
            }
        }
        setAssetTagMap(newMap);
    }, [rcas, allHierarchyAssets]);

    // â”€â”€ Edit handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const handleEdit = (rca: any, e: React.MouseEvent) => {
        e.stopPropagation(); setEditingId(rca.id);
        setEditTitle(rca.title || ''); setEditStatus(rca.status || 'draft');
    };
    const handleSaveEdit = async (e: React.MouseEvent) => {
        e.stopPropagation(); if (!editingId) return;
        setSaving(true);
        try {
            await analyzeService.updateRCAInvestigation(editingId, { title: editTitle, status: editStatus as any });
            onRefresh?.();
        } catch (err) { console.error('Error updating RCA:', err); }
        setSaving(false); setEditingId(null);
    };
    const handleCancelEdit = (e: React.MouseEvent) => { e.stopPropagation(); setEditingId(null); };
    const handleDelete = async () => {
        if (!deleteTarget) return; setSaving(true);
        try {
            await analyzeService.deleteRCAInvestigation(deleteTarget.id);
            if (selectedId === deleteTarget.id) { setSelectedId(null); setViewMode('portfolio'); }
            onRefresh?.();
        } catch (err) { console.error('Error deleting RCA:', err); }
        setSaving(false); setDeleteTarget(null);
    };

    // â”€â”€ Collaboration handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const handleAddRcaCollaborator = async (collab: StudyCollaborator) => {
        const updated = [...rcaCollaborators, collab];
        setRcaCollaborators(updated);
        if (selectedId) {
            await analyzeService.updateRCAInvestigation(selectedId, { collaborators: updated } as any);
        }
    };
    const handleRemoveRcaCollaborator = async (id: string) => {
        const updated = rcaCollaborators.filter(c => c.id !== id);
        setRcaCollaborators(updated);
        if (selectedId) {
            await analyzeService.updateRCAInvestigation(selectedId, { collaborators: updated } as any);
        }
    };
    const handleUpdateRcaCollabRole = async (id: string, role: StudyCollaborator['role']) => {
        const updated = rcaCollaborators.map(c => c.id === id ? { ...c, role } : c);
        setRcaCollaborators(updated);
        if (selectedId) {
            await analyzeService.updateRCAInvestigation(selectedId, { collaborators: updated } as any);
        }
    };

    // â”€â”€ EAM Context handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const handleLinkTriggerWO = async (woId: string) => {
        if (!selectedId) return;
        try {
            await analyzeService.updateRCAInvestigation(selectedId, { work_order_id: woId });
            onRefresh?.();
        } catch (err) { console.error('Error linking trigger WO:', err); }
    };
    const handleUnlinkTriggerWO = async () => {
        if (!selectedId) return;
        try {
            await analyzeService.updateRCAInvestigation(selectedId, { work_order_id: null });
            onRefresh?.();
        } catch (err) { console.error('Error unlinking trigger WO:', err); }
    };

    // â”€â”€ DE Task creation from RCA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const openDEModal = useCallback(() => {
        if (!selectedRca) return;
        const rootCauseNodes = nodes.filter(n => n.is_root_cause || n.node_type === 'root_cause');
        const whyNodes = nodes.filter(n => n.node_type === 'why').sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0));
        const allCauseNodes = rootCauseNodes.length > 0 ? rootCauseNodes : whyNodes;
        const methodLabel = METHODS[selectedRca.method]?.label || 'RCA';

        const rootCauseSummary = allCauseNodes.length > 0
            ? `${methodLabel}: ${allCauseNodes.map(n => n.description).join(' â†’ ')}`
            : selectedRca.root_cause_summary || selectedRca.problem_statement || '';

        const proposedSolution = actions.length > 0
            ? actions.map((a, i) => `${i + 1}. ${a.action_description}${a.assigned_to ? ` (${a.assigned_to})` : ''}`).join('\n')
            : '';

        const howMuch = (selectedRca.event_how_much as any) || {};
        const annualCost = Number(howMuch?.cost || 0);

        setDeDraft({
            title: `Defect Elimination: ${selectedRca.title}`,
            rootCauseSummary, proposedSolution, annualCost,
            estimatedSavings: Math.round(annualCost * 0.75),
            implementationCost: 0,
            priority: annualCost > 100000 ? 'critical' : annualCost > 50000 ? 'high' : 'medium',
        });
        setShowDEModal(true);
    }, [selectedRca, nodes, actions]);

    const handleCreateDETask = useCallback(async () => {
        if (!selectedRca) return;
        setDeCreating(true);
        try {
            const payback = deDraft.estimatedSavings > 0 && deDraft.implementationCost > 0
                ? Math.ceil(deDraft.implementationCost / (deDraft.estimatedSavings / 12)) : 0;
            await analyzeService.createDETask({
                asset_id: selectedRca.asset_id || null,
                asset_name: selectedRca.title?.split('â€”')[1]?.trim() || selectedRca.title || 'Unknown',
                title: deDraft.title, status: 'identified', priority: deDraft.priority,
                annual_cost: deDraft.annualCost, estimated_savings: deDraft.estimatedSavings,
                implementation_cost: deDraft.implementationCost, payback_months: payback,
                root_cause_summary: deDraft.rootCauseSummary,
                proposed_solution: deDraft.proposedSolution,
                rca_id: selectedRca.id, created_by: null,
            });
            setDeCreated(true);
            onDETaskCreated?.();
            setTimeout(() => { setShowDEModal(false); setDeCreated(false); }, 2000);
        } catch (e) { console.error('Failed to create DE task:', e); }
        setDeCreating(false);
    }, [selectedRca, deDraft]);

    // â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const daysAgo = (d: string) => {
        const diff = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
        return diff === 0 ? 'Today' : diff === 1 ? '1d ago' : `${diff}d ago`;
    };

    // â”€â”€ Investigate from Pareto â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const handleInvestigateFromPareto = useCallback((asset: ParetoResult) => {
        const criteriaLabel = paretoCriteria === 'cost' ? 'Total Cost' : paretoCriteria === 'downtime' ? 'Downtime' : 'WO Frequency';
        const problem_statement = `${asset.asset_name} (${asset.asset_tag}) ranked #${asset.rank} in Pareto analysis. ${criteriaLabel}: ${asset.metric_unit === '$' ? '$' : ''}${asset.metric_value.toLocaleString()}${asset.metric_unit !== '$' ? ` ${asset.metric_unit}` : ''} across ${asset.event_count} work orders. Criticality: ${asset.criticality}.`;
        navigate('/analyze/rca/new', {
            state: {
                title: `RCA: ${asset.asset_name} â€” Bad Actor Analysis`,
                asset_id: asset.asset_id || '',
                description: problem_statement,
                maintenanceData: {
                    source: 'pareto',
                    targetLevel: asset.hierarchy_level || 'equipment',
                    totalWorkOrders: asset.event_count,
                    failureWorkOrders: asset.event_count,
                    lastWODate: null,
                    mtbfHours: null,
                    mttrHours: paretoCriteria === 'downtime' ? asset.metric_value : null,
                    topFailureModes: [],
                    workOrderSamples: [],
                }
            }
        });
    }, [paretoCriteria, navigate]);

    const handleDrillInitiateRCA = useCallback((asset: ParetoResult) => {
        setDrillAsset(null);
        onInitiateRCA?.(asset);
    }, [onInitiateRCA]);

    const handleDrillCreateFMEA = useCallback((asset: ParetoResult) => {
        setDrillAsset(null);
        onCreateFMEA?.(asset);
    }, [onCreateFMEA]);

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    //  PORTFOLIO VIEW STATE
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const [viewMode, setViewMode] = useState<'portfolio' | 'workspace'>('portfolio');
    const [portfolioSearch, setPortfolioSearch] = useState('');
    const [portfolioSort, setPortfolioSort] = useState<{ field: string; dir: 'asc' | 'desc' }>({ field: 'created_at', dir: 'desc' });
    const [portfolioFilter, setPortfolioFilter] = useState<string>('all'); // 'all' | 'draft' | 'in_progress' | 'review' | 'closed'

    // New investigation form was moved to /analyze/rca/new route
    const showNewForm = false;



    // Filtered + sorted list for portfolio table
    const portfolioList = useMemo(() => {
        let list = [...displayedRcas];
        if (portfolioFilter !== 'all') list = list.filter(r => r.status === portfolioFilter);
        if (portfolioSearch.trim()) {
            const q = portfolioSearch.toLowerCase();
            list = list.filter(r =>
                (r.title || '').toLowerCase().includes(q) ||
                (r.problem_statement || '').toLowerCase().includes(q) ||
                (r.asset_name || '').toLowerCase().includes(q)
            );
        }
        list.sort((a, b) => {
            const aVal = a[portfolioSort.field] || '';
            const bVal = b[portfolioSort.field] || '';
            const cmp = String(aVal).localeCompare(String(bVal));
            return portfolioSort.dir === 'asc' ? cmp : -cmp;
        });
        return list;
    }, [displayedRcas, portfolioSearch, portfolioSort, portfolioFilter]);

    // Helpers for portfolio â†’ workspace transitions
    const openWorkspace = useCallback((rcaId: string) => {
        setSelectedId(rcaId);
        setExpandedMode(true);
        setViewMode('workspace');
    }, []);

    const backToPortfolio = useCallback(() => {
        setViewMode('portfolio');
        setSelectedId(null);
        setExpandedMode(false);
    }, []);

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    //  PRE-RENDER HELPERS (extracted from IIFEs for esbuild compat)
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const show3W2HSummary = selectedRca && (
        (selectedRca.event_what && selectedRca.event_what !== selectedRca.problem_statement)
        || selectedRca.event_how
        || selectedRca.event_location
    );

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    //  RENDER
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    return (
        <div className="space-y-6">

            {/* RCA Challenger moved INTO the investigation workspace (step 3) so it
                stress-tests the actual cause analysis against the asset's evidence. */}

            {/* â•â•â•â•â•â•â• PORTFOLIO LANDING VIEW â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
            {viewMode === 'portfolio' && (
                <>


                    {/* â”€â”€ Investigation Table Card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
                    <div style={{
                        background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0',
                        overflow: 'hidden', boxShadow: '0 2px 16px rgba(0,0,0,0.06)',
                    }}>
                        {/* Table Header Bar — responsive: stacks on mobile, side-by-side on sm+ */}
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3"
                            style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                            {/* Left: icon + label + count + scope toggle */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <div style={{
                                    width: 28, height: 28, borderRadius: 8,
                                    background: 'linear-gradient(135deg, #eef2ff, #e0e7ff)', border: '1px solid #c7d2fe',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                }}>
                                    <GitMerge size={14} color="#6366f1" />
                                </div>
                                <span style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>Investigations</span>
                                <span style={{
                                    background: '#eff6ff', color: '#2563eb', fontSize: 12, fontWeight: 700,
                                    padding: '3px 10px', borderRadius: 12, border: '1px solid #bfdbfe', flexShrink: 0,
                                }}>{portfolioList.length}{rcaScope === 'mine' ? `/${rcas.length}` : ''}</span>
                                {/* Scope toggle */}
                                <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: 6, padding: 2 }}>
                                    <button
                                        onClick={() => setRcaScope('all')}
                                        style={{
                                            padding: '3px 10px', fontSize: 11, fontWeight: 600, borderRadius: 4, border: 'none', cursor: 'pointer',
                                            background: rcaScope === 'all' ? '#fff' : 'transparent',
                                            color: rcaScope === 'all' ? '#1e293b' : '#94a3b8',
                                            boxShadow: rcaScope === 'all' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                                            transition: 'all 0.15s',
                                        }}
                                    >All</button>
                                    <button
                                        onClick={() => setRcaScope('mine')}
                                        style={{
                                            padding: '3px 10px', fontSize: 11, fontWeight: 600, borderRadius: 4, border: 'none', cursor: 'pointer',
                                            background: rcaScope === 'mine' ? '#fff' : 'transparent',
                                            color: rcaScope === 'mine' ? '#7c3aed' : '#94a3b8',
                                            boxShadow: rcaScope === 'mine' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                                            transition: 'all 0.15s',
                                        }}
                                    >My RCAs</button>
                                </div>
                            </div>
                            {/* Right: search + filter + new button — full width on mobile */}
                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                {/* Search — flex-1 so it fills available space */}
                                <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
                                    <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                                    <input
                                        value={portfolioSearch}
                                        onChange={e => setPortfolioSearch(e.target.value)}
                                        placeholder="Search investigations..."
                                        style={{
                                            padding: '7px 12px 7px 32px', fontSize: 13, border: '1px solid #e2e8f0',
                                            borderRadius: 8, width: '100%', outline: 'none', background: '#fff', color: '#1e293b',
                                        }}
                                    />
                                </div>
                                {/* Status filter */}
                                <select
                                    value={portfolioFilter}
                                    onChange={e => setPortfolioFilter(e.target.value)}
                                    style={{
                                        padding: '7px 10px', fontSize: 13, border: '1px solid #e2e8f0',
                                        borderRadius: 8, background: '#fff', color: '#1e293b', cursor: 'pointer', outline: 'none', flexShrink: 0,
                                    }}
                                >
                                    <option value="all">All Statuses</option>
                                    <option value="draft">Draft</option>
                                    <option value="in_progress">In Progress</option>
                                    <option value="review">Review</option>
                                    <option value="closed">Closed</option>
                                </select>
                                {/* New Investigation — shorter label on mobile */}
                                <button
                                    onClick={onNewAssessment}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
                                        background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8,
                                        fontSize: 13, fontWeight: 600, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
                                    }}
                                >
                                    <Plus size={14} />
                                    <span className="hidden sm:inline">New Investigation</span>
                                    <span className="sm:hidden">New</span>
                                </button>
                            </div>
                        </div>

                        {/* Table */}
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                    <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                                        {[
                                            { key: 'title', label: 'Investigation' },
                                            { key: 'asset_id', label: 'Asset' },
                                            { key: 'method', label: 'Method' },
                                            { key: 'status', label: 'Status' },
                                            { key: 'rca_category', label: 'Category' },
                                            { key: 'created_at', label: 'Created' },
                                        ].map(col => (
                                            <th key={col.key}
                                                onClick={() => setPortfolioSort(prev => ({
                                                    field: col.key,
                                                    dir: prev.field === col.key && prev.dir === 'asc' ? 'desc' : 'asc',
                                                }))}
                                                style={{
                                                    textAlign: 'left', padding: '10px 16px', fontWeight: 600,
                                                    color: '#64748b', cursor: 'pointer', fontSize: 12,
                                                    letterSpacing: '0.03em', userSelect: 'none',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                {col.label}
                                                {portfolioSort.field === col.key && (
                                                    <span style={{ marginLeft: 4, fontSize: 10 }}>
                                                        {portfolioSort.dir === 'asc' ? 'â–²' : 'â–¼'}
                                                    </span>
                                                )}
                                            </th>
                                        ))}
                                        <th style={{ textAlign: 'right', padding: '10px 16px', fontWeight: 600, color: '#64748b', fontSize: 12 }}>
                                            Actions
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {portfolioList.length === 0 ? (
                                        <tr>
                                            <td colSpan={7} style={{ textAlign: 'center', padding: '48px 24px', color: '#94a3b8' }}>
                                                <div style={{
                                                    width: 56, height: 56, borderRadius: '50%', background: '#f1f5f9',
                                                    margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                }}>
                                                    <GitMerge size={24} color="#94a3b8" />
                                                </div>
                                                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6, color: '#64748b' }}>No investigations yet</div>
                                                <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                                                    Run a Pareto analysis below to identify bad actors,<br />then create an RCA investigation.
                                                </div>
                                            </td>
                                        </tr>
                                    ) : portfolioList.map(rca => {
                                        const method = METHODS[rca.method] || { label: rca.method || 'RCA', color: '#64748b' };
                                        const statusLabel = rca.status === 'in_progress' ? 'In Progress'
                                            : rca.status === 'draft' ? 'Draft'
                                            : rca.status === 'review' ? 'Review'
                                            : rca.status === 'closed' ? 'Closed' : rca.status || 'â€”';
                                        const statusColor = rca.status === 'in_progress' ? '#2563eb'
                                            : rca.status === 'draft' ? '#64748b'
                                            : rca.status === 'review' ? '#d97706'
                                            : rca.status === 'closed' ? '#059669' : '#94a3b8';
                                        const statusBg = rca.status === 'in_progress' ? '#eff6ff'
                                            : rca.status === 'draft' ? '#f1f5f9'
                                            : rca.status === 'review' ? '#fffbeb'
                                            : rca.status === 'closed' ? '#ecfdf5' : '#f8fafc';
                                        return (
                                            <tr key={rca.id}
                                                onClick={() => navigate(`/analyze/rca/${rca.id}`)}
                                                style={{
                                                    cursor: 'pointer', borderBottom: '1px solid #f1f5f9',
                                                    transition: 'background .15s',
                                                }}
                                                onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                                                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                            >
                                                <td style={{ padding: '14px 16px', maxWidth: 320 }}>
                                                    <div style={{ fontWeight: 600, color: '#1e293b', lineHeight: 1.4, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                                                        {rca.title || 'Untitled Investigation'}
                                                        {isUserCollaborator(rca) && (
                                                            <span style={{
                                                                fontSize: 9, fontWeight: 800, textTransform: 'uppercase' as const,
                                                                padding: '2px 7px', borderRadius: 4, letterSpacing: '0.05em',
                                                                background: '#ede9fe', color: '#7c3aed', border: '1px solid #c4b5fd',
                                                                flexShrink: 0,
                                                            }}>INVITED</span>
                                                        )}
                                                    </div>
                                                    {rca.problem_statement && (
                                                        <div style={{
                                                            fontSize: 12, color: '#94a3b8', lineHeight: 1.4,
                                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300,
                                                        }}>
                                                            {rca.problem_statement}
                                                        </div>
                                                    )}
                                                    {(rca as any).collaborators?.length > 0 && (
                                                        <div style={{ marginTop: 4 }}>
                                                            <AvatarStack collaborators={(rca as any).collaborators} max={3} size="sm" />
                                                        </div>
                                                    )}
                                                </td>
                                                {/* Asset column */}
                                                <td style={{ padding: '14px 12px', whiteSpace: 'nowrap' }}>
                                                    {(() => {
                                                        const ai = assetTagMap[rca.asset_id];
                                                        if (!ai) {
                                                            if (!rca.event_what) return <span style={{ color: '#cbd5e1', fontSize: 11 }}>â€”</span>;
                                                            return (
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                    <span style={{ display: 'inline-flex', padding: '2px 6px', borderRadius: 6, background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', fontSize: 10, fontWeight: 800 }}>MANUAL</span>
                                                                    <span style={{ fontSize: 12, color: '#475569', fontWeight: 500 }}>{rca.event_what}</span>
                                                                </div>
                                                            );
                                                        }
                                                        const cc = ai.criticality?.toUpperCase();
                                                        const bg = cc === 'A' ? '#fef2f2' : cc === 'B' ? '#fffbeb' : cc === 'C' ? '#eff6ff' : '#f8fafc';
                                                        const tc = cc === 'A' ? '#dc2626' : cc === 'B' ? '#d97706' : cc === 'C' ? '#2563eb' : '#64748b';
                                                        const bc = cc === 'A' ? '#fecaca' : cc === 'B' ? '#fde68a' : cc === 'C' ? '#bfdbfe' : '#e2e8f0';
                                                        return (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                <span style={{
                                                                    display: 'inline-flex', padding: '2px 6px', borderRadius: 6,
                                                                    background: bg, color: tc, border: `1px solid ${bc}`,
                                                                    fontSize: 10, fontWeight: 800, letterSpacing: '0.03em',
                                                                }}>{cc}</span>
                                                                <span style={{ fontSize: 12, color: '#334155', fontWeight: 500 }}>
                                                                    {ai.tag || ai.name}
                                                                </span>
                                                            </div>
                                                        );
                                                    })()}
                                                </td>
                                                <td style={{ padding: '14px 16px' }}>
                                                    <span style={{
                                                        display: 'inline-flex', alignItems: 'center', gap: 5,
                                                        padding: '4px 12px', borderRadius: 10, fontSize: 11, fontWeight: 700,
                                                        background: `${method.color}12`, color: method.color,
                                                        border: `1px solid ${method.color}30`,
                                                    }}>
                                                        {method.label}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '14px 16px' }}>
                                                    <span style={{
                                                        display: 'inline-flex', alignItems: 'center', gap: 5,
                                                        padding: '4px 12px', borderRadius: 10, fontSize: 11, fontWeight: 700,
                                                        background: statusBg, color: statusColor,
                                                        border: `1px solid ${statusColor}30`,
                                                    }}>
                                                        {statusLabel}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '14px 16px', color: '#475569', fontSize: 12, textTransform: 'capitalize' }}>
                                                    {(rca.rca_category || 'â€”').replace('_', ' ')}
                                                </td>
                                                <td style={{ padding: '14px 16px', color: '#64748b', fontSize: 12, whiteSpace: 'nowrap' }}>
                                                    {rca.created_at ? new Date(rca.created_at).toLocaleDateString() : 'â€”'}
                                                </td>
                                                <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                                                    <button
                                                        onClick={e => { e.stopPropagation(); navigate(`/analyze/rca/${rca.id}`); }}
                                                        style={{
                                                            display: 'inline-flex', alignItems: 'center', gap: 5,
                                                            padding: '5px 12px', background: '#eff6ff', color: '#2563eb',
                                                            border: '1px solid #bfdbfe', borderRadius: 8, fontSize: 12,
                                                            fontWeight: 600, cursor: 'pointer',
                                                        }}
                                                    >
                                                        <ArrowRight size={12} /> Open
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* â”€â”€ Pareto Bad Actor Section (portfolio level) â”€â”€ */}
                    {onParetoDataChange && (
                        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
                            <button
                                onClick={() => setParetoCollapsed(c => !c)}
                                style={{
                                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                    padding: '14px 20px', background: paretoCollapsed ? '#fff' : '#fafbfc',
                                    border: 'none', cursor: 'pointer', borderBottom: paretoCollapsed ? 'none' : '1px solid #e2e8f0',
                                    transition: 'background .2s',
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <div style={{
                                        width: 28, height: 28, borderRadius: 8,
                                        background: 'linear-gradient(135deg, #fef2f2, #fee2e2)', border: '1px solid #fecaca',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }}>
                                        <BarChart3 size={14} color="#ef4444" />
                                    </div>
                                    <div style={{ textAlign: 'left' }}>
                                        <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
                                            Bad Actor Identification
                                            <span style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', background: '#f1f5f9', padding: '2px 8px', borderRadius: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                Pareto 80/20
                                            </span>
                                        </div>
                                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                                            Which assets are driving 80% of your maintenance cost, downtime, or failures?
                                        </div>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    {paretoData.length > 0 && (
                                        <span style={{ fontSize: 11, fontWeight: 600, color: '#ef4444', background: '#fef2f2', padding: '3px 10px', borderRadius: 10, border: '1px solid #fecaca' }}>
                                            {paretoData.length} assets
                                        </span>
                                    )}
                                    {paretoCollapsed ? <ChevronDown size={16} color="#94a3b8" /> : <ChevronUp size={16} color="#94a3b8" />}
                                </div>
                            </button>
                            {!paretoCollapsed && (
                                <div style={{ padding: '16px 20px 20px' }}>
                                    <ParetoAnalysisTab
                                        onDrillDown={setDrillAsset}
                                        onParetoDataChange={onParetoDataChange}
                                        onInvestigate={handleInvestigateFromPareto}
                                    />
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}

            {/* â•â•â•â•â•â•â• WORKSPACE VIEW (investigation detail) â•â•â•â•â•â•â•â•â• */}
            {viewMode === 'workspace' && (
                <>
                    {/* Back to portfolio breadcrumb */}
                    <button
                        onClick={backToPortfolio}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '6px 0', background: 'none', border: 'none',
                            color: '#0891b2', cursor: 'pointer', fontSize: 13, fontWeight: 500,
                        }}
                    >
                        <ArrowLeft size={15} /> Back to Portfolio
                    </button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
                        {rcaCollaborators.length > 0 && <AvatarStack collaborators={rcaCollaborators} max={3} size="sm" />}
                        {/* EAM Data button */}
                        <button
                            onClick={() => setShowEAMPanel(true)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 7,
                                padding: '8px 16px',
                                background: 'linear-gradient(135deg, #0891b2, #0284c7)',
                                color: '#fff', border: 'none', borderRadius: 12,
                                fontSize: 12, fontWeight: 700, cursor: 'pointer',
                                boxShadow: '0 4px 14px rgba(8,145,178,0.35)',
                                transition: 'all 0.2s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.03)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(8,145,178,0.45)'; }}
                            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 14px rgba(8,145,178,0.35)'; }}
                            title="View asset details, work order history, failure trends, and related investigations"
                        >
                            <Database size={14} />
                            <span>EAM Data{eamWorkOrders.length > 0 ? ` (${eamWorkOrders.length})` : ''}</span>
                        </button>
                        {/* Invite Team button */}
                        <button
                            onClick={() => setShowTeamPanel(true)}
                            style={{
                                position: 'relative',
                                display: 'flex', alignItems: 'center', gap: 7,
                                padding: '8px 16px',
                                background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                                color: '#fff', border: 'none', borderRadius: 12,
                                fontSize: 12, fontWeight: 700, cursor: 'pointer',
                                boxShadow: '0 4px 14px rgba(99,102,241,0.35)',
                                transition: 'all 0.2s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.03)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(99,102,241,0.45)'; }}
                            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 14px rgba(99,102,241,0.35)'; }}
                            title="Invite people, teams, or departments to collaborate on this investigation"
                        >
                            {rcaCollaborators.length === 0 && (
                                <span style={{ position: 'absolute', top: -4, right: -4, width: 12, height: 12 }}>
                                    <span className="invite-ping" style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#fbbf24', opacity: 0.75 }} />
                                    <span style={{ position: 'relative', display: 'block', width: 12, height: 12, borderRadius: '50%', background: '#fbbf24' }} />
                                </span>
                            )}
                            <Users size={14} />
                            <span>{rcaCollaborators.length > 0 ? `Team (${rcaCollaborators.length})` : 'Invite Team'}</span>
                        </button>
                    </div>


            {/* â•â•â•â•â•â•â• INVESTIGATION WORKSPACE â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 2px' }}>
                <div style={{
                    width: 28, height: 28, borderRadius: 8,
                    background: 'linear-gradient(135deg, #eff6ff, #dbeafe)',
                    border: '1px solid #bfdbfe',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <GitMerge size={14} color="#3b82f6" />
                </div>
                <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>Step 2: Root Cause Investigations</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>Formal failure investigations â€” select a bad actor above or create manually</div>
                </div>
            </div>
            <div id="rca-investigations-section" style={{ display: 'flex', gap: 0, minHeight: expandedMode ? 700 : 520, background: '#fff', borderRadius: expandedMode ? 16 : 14, border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: expandedMode ? '0 8px 40px rgba(0,0,0,0.08)' : '0 4px 24px rgba(0,0,0,0.06)', transition: 'all .3s ease' }}>


            {/* â•â•â•â•â•â•â• LEFT: Investigation List â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
            <div style={{
                width: (selectedId || showNewForm) ? 380 : '100%', minWidth: 320,
                borderRight: (selectedId || showNewForm) ? '1px solid #e2e8f0' : 'none',
                display: (expandedMode && (selectedId || showNewForm)) ? 'none' : 'flex',
                flexDirection: 'column', transition: 'all .3s ease',
            }}>
                {/* List header */}
                <div style={{
                    padding: '16px 20px', borderBottom: '1px solid #e2e8f0',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <GitMerge size={18} color="#ef4444" />
                        <span style={{ fontWeight: 700, fontSize: 15, color: '#1e293b' }}>Root Cause Investigations</span>
                        <span style={{ fontSize: 11, color: '#94a3b8', background: '#f1f5f9', padding: '2px 8px', borderRadius: 20 }}>{displayedRcas.length}{rcaScope === 'mine' ? `/${rcas.length}` : ''}</span>
                        {/* Scope toggle */}
                        <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: 6, padding: 2, marginLeft: 4 }}>
                            <button
                                onClick={() => setRcaScope('all')}
                                style={{
                                    padding: '3px 8px', fontSize: 10, fontWeight: 600, borderRadius: 4, border: 'none', cursor: 'pointer',
                                    background: rcaScope === 'all' ? '#fff' : 'transparent',
                                    color: rcaScope === 'all' ? '#1e293b' : '#94a3b8',
                                    boxShadow: rcaScope === 'all' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                                    transition: 'all 0.15s',
                                }}
                            >All</button>
                            <button
                                onClick={() => setRcaScope('mine')}
                                style={{
                                    padding: '3px 8px', fontSize: 10, fontWeight: 600, borderRadius: 4, border: 'none', cursor: 'pointer',
                                    background: rcaScope === 'mine' ? '#fff' : 'transparent',
                                    color: rcaScope === 'mine' ? '#7c3aed' : '#94a3b8',
                                    boxShadow: rcaScope === 'mine' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                                    transition: 'all 0.15s',
                                }}
                            >My RCAs</button>
                        </div>
                    </div>
                    <button
                        onClick={() => navigate('/analyze/rca/new')}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px',
                            background: showNewForm ? 'rgba(34,211,238,0.15)' : 'rgba(34,211,238,0.08)',
                            color: '#0891b2', border: '1px solid rgba(34,211,238,0.2)',
                            borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        }}
                    >
                        <Plus size={13} /> New
                    </button>
                </div>

                {/* List body */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
                    {displayedRcas.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>
                            <GitMerge size={28} style={{ margin: '0 auto 10px', opacity: 0.4, display: 'block' }} />
                            <p style={{ fontSize: 13 }}>{rcaScope === 'mine' ? 'No investigations assigned to you.' : 'No investigations yet.'}</p>
                            {rcaScope === 'mine' && rcas.length > 0 && (
                                <button onClick={() => setRcaScope('all')} style={{ marginTop: 8, fontSize: 12, color: '#7c3aed', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Show all investigations â†’</button>
                            )}
                        </div>
                    ) : displayedRcas.map(rca => {
                        const isSelected = selectedId === rca.id;
                        const isEditing = editingId === rca.id;
                        const method = METHODS[rca.method] || { label: 'RCA', color: '#94a3b8' };
                        const sts = STATUS_STYLES[rca.status] || STATUS_STYLES.draft;

                        if (isEditing) {
                            return (
                                <div key={rca.id} style={{ padding: '10px 12px', background: '#f0fdfa', borderRadius: 10, border: '1px solid #99f6e4', marginBottom: 4 }}>
                                    <input type="text" value={editTitle} onChange={e => setEditTitle(e.target.value)}
                                        style={{ width: '100%', padding: '6px 10px', border: '1px solid #5eead4', borderRadius: 6, fontSize: 13, marginBottom: 6, boxSizing: 'border-box' }}
                                        placeholder="Investigation Title" autoFocus />
                                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                        <select value={editStatus} onChange={e => setEditStatus(e.target.value)}
                                            style={{ flex: 1, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12 }}>
                                            <option value="draft">Draft</option>
                                            <option value="in_progress">In Progress</option>
                                            <option value="review">Review</option>
                                            <option value="closed">Closed</option>
                                        </select>
                                        <button onClick={handleSaveEdit} disabled={saving} style={{ padding: 4, color: '#0d9488', background: 'none', border: 'none', cursor: 'pointer' }}><Check size={16} /></button>
                                        <button onClick={handleCancelEdit} style={{ padding: 4, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer' }}><X size={16} /></button>
                                    </div>
                                </div>
                            );
                        }

                        return (
                            <div key={rca.id}
                                onClick={() => { setSelectedId(isSelected ? null : rca.id); }}
                                style={{
                                    padding: '12px 14px', borderRadius: 10, marginBottom: 4, cursor: 'pointer',
                                    background: isSelected ? '#f0fdfa' : '#fff',
                                    border: isSelected ? '1px solid #99f6e4' : '1px solid transparent',
                                    transition: 'all .15s',
                                    borderLeft: `3px solid ${rca.status === 'review' ? '#f59e0b' : rca.status === 'in_progress' ? '#3b82f6' : rca.status === 'closed' ? '#22c55e' : '#cbd5e1'}`,
                                }}
                                onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = '#f8fafc'; }}
                                onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = '#fff'; }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 4 }}>
                                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                        <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', lineHeight: 1.3 }}>{rca.title}</span>
                                        {isUserCollaborator(rca) && (
                                            <span style={{
                                                fontSize: 8, fontWeight: 800, textTransform: 'uppercase' as const,
                                                padding: '2px 6px', borderRadius: 4, letterSpacing: '0.06em',
                                                background: '#ede9fe', color: '#7c3aed', border: '1px solid #c4b5fd',
                                            }}>INVITED</span>
                                        )}
                                    </div>
                                    <span style={{
                                        fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                                        padding: '2px 7px', borderRadius: 4, letterSpacing: '0.04em',
                                        background: sts.bg.replace('bg-', ''), color: sts.text.replace('text-', ''),
                                        border: `1px solid ${rca.status === 'review' ? '#fbbf2480' : rca.status === 'in_progress' ? '#3b82f680' : rca.status === 'closed' ? '#22c55e80' : '#cbd5e180'}`,
                                    }}>
                                        {(rca.status || 'draft').replace('_', ' ')}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, color: '#94a3b8' }}>
                                    <span style={{
                                        padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 700,
                                        background: method.color + '18', color: method.color,
                                    }}>{method.label}</span>
                                    <span>{daysAgo(rca.created_at)}</span>
                                    {/* Edit and Delete */}
                                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
                                        <button onClick={e => handleEdit(rca, e)}
                                            style={{ padding: 3, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 4 }}
                                            title="Edit"><Edit3 size={12} /></button>
                                        <button onClick={e => { e.stopPropagation(); setDeleteTarget({ id: rca.id, title: rca.title || 'Untitled' }); }}
                                            style={{ padding: 3, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 4 }}
                                            title="Delete"><Trash2 size={12} /></button>
                                    </span>
                                </div>
                                {rca.problem_statement && (
                                    <p style={{ fontSize: 12, color: '#64748b', marginTop: 6, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any, overflow: 'hidden' }}>
                                        {rca.problem_statement}
                                    </p>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* New Investigation Form is now at /analyze/rca/new */}



            {/* â•â•â•â•â•â•â• RIGHT: Investigation Detail â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
            {selectedId && selectedRca && (
                <div style={{ flex: 1, overflowY: 'auto', background: '#f8fafc' }}>
                    {detailLoading ? (
                        <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading investigationâ€¦</div>
                    ) : (
                        <div style={{ padding: expandedMode ? '24px 32px' : '20px 24px', maxWidth: expandedMode ? 1100 : undefined, margin: expandedMode ? '0 auto' : undefined }}>
                            {/* Expanded mode breadcrumb */}
                            {expandedMode && (
                                <button
                                    onClick={() => setExpandedMode(false)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 6,
                                        padding: '6px 0', marginBottom: 12, background: 'none',
                                        border: 'none', color: '#0891b2', cursor: 'pointer',
                                        fontSize: 13, fontWeight: 500,
                                    }}
                                >
                                    <ArrowLeft size={15} /> Back to Investigations
                                </button>
                            )}
                            {/* Detail header */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 16 }}>
                                <div>
                                    <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', margin: 0, lineHeight: 1.3 }}>
                                        {selectedRca.title}
                                    </h2>
                                    {selectedRca.problem_statement && (
                                        <p style={{ fontSize: 13, color: '#475569', margin: '6px 0 0', lineHeight: 1.5 }}>
                                            {selectedRca.problem_statement}
                                        </p>
                                    )}
                                    <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                                        Method: <span style={{ fontWeight: 600, color: METHODS[selectedRca.method]?.color }}>{METHODS[selectedRca.method]?.label || 'RCA'}</span>
                                        {' Â· '}Created: {new Date(selectedRca.created_at).toLocaleDateString()}
                                        {selectedRca.rca_category && <> Â· Category: <span style={{ textTransform: 'capitalize' }}>{selectedRca.rca_category.replace('_', ' ')}</span></>}
                                    </p>
                                </div>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                    <button onClick={openDEModal}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px',
                                            background: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0',
                                            borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 12,
                                        }}>
                                        <Target size={13} /> Create DE Task
                                    </button>
                                    <button onClick={() => setExpandedMode(!expandedMode)}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px',
                                            background: expandedMode ? '#fef3c7' : '#eff6ff',
                                            color: expandedMode ? '#d97706' : '#2563eb',
                                            border: `1px solid ${expandedMode ? '#fde68a' : '#bfdbfe'}`,
                                            borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 12,
                                            transition: 'all .2s ease',
                                        }}>
                                        {expandedMode ? <><Minimize2 size={13} /> Compact</> : <><Maximize2 size={13} /> Expand</>}
                                    </button>
                                </div>
                            </div>

                            {/* â•â•â•â•â•â•â• 6-STEP INVESTIGATION WORKFLOW â•â•â•â•â•â•â• */}
                            <RCAStepIndicator
                                currentStep={currentStep}
                                onStepClick={setCurrentStep}
                                completionData={{
                                    hasProblemStatement: !!selectedRca.problem_statement,
                                    has5W2H: !!(selectedRca.event_what || selectedRca.event_how || selectedRca.event_location),
                                    evidenceCount: evidence.length,
                                    hasRootCause: nodes.some(n => n.is_root_cause),
                                    actionCount: actions.length,
                                    allActionsAssigned: actions.length > 0 && actions.every(a => a.assigned_to),
                                    effectivenessReviewed: selectedRca.effectiveness_status === 'effective',
                                }}
                            />

                            {/* â”€â”€ Contextual Step Guide â”€â”€ */}
                            <RCAStepGuide activeStep={currentStep - 1} />

                            {/* â”€â”€ Step content panels â”€â”€ */}
                            <div style={{ marginTop: 16 }}>
                                {/* STEP 1: Define the Problem */}
                                {currentStep === 1 && (() => {
                                    /* â”€â”€ Inline-edit state management for Step 1 â”€â”€ */
                                    const InlineDefinePanel: React.FC<{ rca: typeof selectedRca }> = ({ rca }) => {
                                        const [draft, setDraft] = React.useState({
                                            problem_statement: rca?.problem_statement || '',
                                            event_what: rca?.event_what || '',
                                            event_location: rca?.event_location || '',
                                            event_how: rca?.event_how || '',
                                            event_date: rca?.event_date ? new Date(rca.event_date).toISOString().split('T')[0] : '',
                                            event_how_much: rca?.event_how_much as any || { cost: 0, downtime_hrs: 0 },
                                        });
                                        const [inlineSaving, setInlineSaving] = React.useState(false);
                                        const [saved, setSaved] = React.useState(false);
                                        const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

                                        const doSave = React.useCallback(async (d = draft) => {
                                            if (!rca) return;
                                            setInlineSaving(true); setSaved(false);
                                            try {
                                                await analyzeService.updateRCAInvestigation(rca.id, {
                                                    problem_statement: d.problem_statement || null,
                                                    event_what: d.event_what || null,
                                                    event_location: d.event_location || null,
                                                    event_how: d.event_how || null,
                                                    event_date: d.event_date ? new Date(d.event_date).toISOString() : null,
                                                    event_how_much: (d.event_how_much?.cost || d.event_how_much?.downtime_hrs)
                                                        ? d.event_how_much : null,
                                                } as any);
                                                onRefresh?.();
                                                setSaved(true);
                                                setTimeout(() => setSaved(false), 2000);
                                            } catch (e) { console.error('[InlineDefine] save error:', e); }
                                            setInlineSaving(false);
                                        }, [rca, draft]);

                                        const handleChange = (field: string, value: any) => {
                                            setDraft(prev => {
                                                const next = { ...prev, [field]: value };
                                                // Debounce auto-save (800ms)
                                                if (timerRef.current) clearTimeout(timerRef.current);
                                                timerRef.current = setTimeout(() => doSave(next), 800);
                                                return next;
                                            });
                                        };

                                        const inputStyle: React.CSSProperties = {
                                            width: '100%', padding: '8px 12px', background: '#f8fafc',
                                            border: '1px solid #e2e8f0', borderRadius: 8, color: '#1e293b',
                                            fontSize: 13, boxSizing: 'border-box' as const,
                                        };
                                        const labelStyle: React.CSSProperties = {
                                            fontSize: 10, fontWeight: 700, color: '#64748b',
                                            textTransform: 'uppercase' as const, letterSpacing: '0.05em',
                                            display: 'block', marginBottom: 4,
                                        };

                                        return (
                                            <div>
                                                {/* Problem Statement */}
                                                <div style={{ marginBottom: 14 }}>
                                                    <label style={labelStyle}>Problem Statement</label>
                                                    <textarea
                                                        value={draft.problem_statement}
                                                        onChange={e => handleChange('problem_statement', e.target.value)}
                                                        placeholder="Clearly describe the failure event (e.g., 'Pump P-101A seized during normal operation')..."
                                                        rows={3}
                                                        style={{ ...inputStyle, resize: 'vertical' as const, minHeight: 60 }}
                                                    />
                                                </div>

                                                {/* 3W2H Grid */}
                                                <div style={{
                                                    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
                                                    marginBottom: 14,
                                                }}>
                                                    <div>
                                                        <label style={labelStyle}>What happened?</label>
                                                        <input value={draft.event_what} onChange={e => handleChange('event_what', e.target.value)}
                                                            placeholder="Describe the event" style={inputStyle} />
                                                    </div>
                                                    <div>
                                                        <label style={labelStyle}>Where?</label>
                                                        <input value={draft.event_location} onChange={e => handleChange('event_location', e.target.value)}
                                                            placeholder="Location / functional unit" style={inputStyle} />
                                                    </div>
                                                    <div>
                                                        <label style={labelStyle}>When?</label>
                                                        <input type="date" value={draft.event_date} onChange={e => handleChange('event_date', e.target.value)}
                                                            style={inputStyle} />
                                                    </div>
                                                    <div>
                                                        <label style={labelStyle}>How?</label>
                                                        <input value={draft.event_how} onChange={e => handleChange('event_how', e.target.value)}
                                                            placeholder="Failure mechanism" style={inputStyle} />
                                                    </div>
                                                </div>

                                                {/* How Much Row */}
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                                                    <div>
                                                        <label style={{ ...labelStyle, color: '#dc2626' }}>Est. Cost ($)</label>
                                                        <input type="number" value={draft.event_how_much?.cost || ''} onChange={e => handleChange('event_how_much', { ...draft.event_how_much, cost: Number(e.target.value) })}
                                                            placeholder="0" style={inputStyle} />
                                                    </div>
                                                    <div>
                                                        <label style={{ ...labelStyle, color: '#d97706' }}>Downtime (hrs)</label>
                                                        <input type="number" value={draft.event_how_much?.downtime_hrs || ''} onChange={e => handleChange('event_how_much', { ...draft.event_how_much, downtime_hrs: Number(e.target.value) })}
                                                            placeholder="0" style={inputStyle} />
                                                    </div>
                                                </div>

                                                {/* Save status bar */}
                                                <div style={{
                                                    display: 'flex', alignItems: 'center', gap: 8,
                                                    padding: '8px 12px', background: saved ? '#ecfdf5' : '#f8fafc',
                                                    borderRadius: 8, border: `1px solid ${saved ? '#a7f3d0' : '#e2e8f0'}`,
                                                    transition: 'all 0.3s ease',
                                                }}>
                                                    {inlineSaving ? (
                                                        <>
                                                            <Loader2 size={13} color="#0891b2" className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} />
                                                            <span style={{ fontSize: 11, color: '#0891b2', fontWeight: 600 }}>Savingâ€¦</span>
                                                        </>
                                                    ) : saved ? (
                                                        <>
                                                            <CheckCircle size={13} color="#059669" />
                                                            <span style={{ fontSize: 11, color: '#059669', fontWeight: 600 }}>Changes saved</span>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Info size={13} color="#64748b" />
                                                            <span style={{ fontSize: 11, color: '#64748b' }}>Auto-saves after typing</span>
                                                        </>
                                                    )}
                                                    <button
                                                        onClick={() => doSave()}
                                                        disabled={inlineSaving}
                                                        style={{
                                                            marginLeft: 'auto', padding: '5px 14px',
                                                            border: 'none', borderRadius: 6,
                                                            background: inlineSaving ? '#94a3b8' : '#0891b2',
                                                            color: '#fff', fontSize: 11, fontWeight: 600,
                                                            cursor: inlineSaving ? 'not-allowed' : 'pointer',
                                                            display: 'flex', alignItems: 'center', gap: 4,
                                                        }}
                                                    >
                                                        <Check size={12} /> Save Now
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    };
                                    return <InlineDefinePanel rca={selectedRca} />;
                                })()}

                                {/* STEP 2: Collect Data/Evidence */}
                                {currentStep === 2 && (
                                    <RCAEvidencePanel
                                        investigationId={selectedRca.id}
                                        evidence={evidence}
                                        setEvidence={setEvidence}
                                    />
                                )}

                                {/* STEP 3: Identify Causal Factors */}
                                {currentStep === 3 && (
                                    <div>
                                        <CauseAnalysisSection method={selectedRca.method} investigationId={selectedRca.id} problemStatement={selectedRca.problem_statement || ''} nodes={nodes} setNodes={setNodes} saving={saving} />
                                        <FiveWhySection
                                            selectedRca={selectedRca}
                                            nodes={nodes}
                                            setNodes={setNodes}
                                        />
                                    </div>
                                )}

                                {/* STEP 4: Develop Solutions */}
                                {currentStep === 4 && (
                                    <RCASolutionsPanel
                                        investigationId={selectedRca.id}
                                        actions={actions}
                                        setActions={setActions}
                                    />
                                )}

                                {/* STEP 5: Implement Recommendations */}
                                {currentStep === 5 && (
                                    <div>
                                        <div style={{
                                            display: 'flex', gap: 10, padding: '10px 14px', marginBottom: 16,
                                            background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8,
                                        }}>
                                            <Target size={14} color="#16a34a" style={{ flexShrink: 0, marginTop: 2 }} />
                                            <div style={{ fontSize: 12, color: '#166534', lineHeight: 1.6 }}>
                                                <strong>Step 5 â€” Implement:</strong> Assign corrective actions from Step 4, create work orders,
                                                and ensure each recommendation has an owner and a due date.
                                            </div>
                                        </div>

                                        {/* Actions implementation status */}
                                        <div style={{
                                            background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0',
                                            padding: 16, marginBottom: 16,
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                                                <Wrench size={14} color="#059669" />
                                                <span style={{ fontSize: 11, fontWeight: 700, color: '#065f46', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Implementation Status</span>
                                                <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto' }}>
                                                    {actions.filter(a => a.status === 'completed').length}/{actions.length} complete
                                                </span>
                                            </div>
                                            {actions.length === 0 ? (
                                                <p style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>
                                                    No corrective actions defined yet. Go to Step 4 to develop solutions.
                                                </p>
                                            ) : (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                    {actions.map(act => (
                                                        <div key={act.id} style={{
                                                            display: 'flex', gap: 8, alignItems: 'start', padding: '8px 10px',
                                                            background: act.status === 'completed' ? '#f0fdf4' : '#fefce8',
                                                            borderRadius: 6, border: `1px solid ${act.status === 'completed' ? '#dcfce7' : '#fef9c3'}`,
                                                        }}>
                                                            <div style={{
                                                                width: 18, height: 18, borderRadius: 4, flexShrink: 0, marginTop: 1,
                                                                background: act.status === 'completed' ? '#22c55e' : '#fbbf24',
                                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                            }}>
                                                                {act.status === 'completed'
                                                                    ? <Check size={12} color="#fff" />
                                                                    : <Clock size={10} color="#fff" />}
                                                            </div>
                                                            <div style={{ flex: 1 }}>
                                                                <div style={{ fontSize: 12, color: '#1e293b', fontWeight: 500 }}>{act.action_description}</div>
                                                                <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
                                                                    {act.action_type?.replace('_', ' ')}
                                                                    {act.assigned_to && ` Â· ${act.assigned_to}`}
                                                                    {act.due_date && ` Â· Due: ${new Date(act.due_date).toLocaleDateString()}`}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        {/* DE Task Creation CTA */}
                                        <div style={{
                                            background: 'linear-gradient(135deg, #ecfdf5 0%, #f0fdfa 100%)',
                                            borderRadius: 10, border: '1px solid #a7f3d0', padding: 16,
                                            display: 'flex', alignItems: 'center', gap: 14,
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <div style={{ padding: 6, background: '#ef444420', borderRadius: 6 }}>
                                                    <Search size={14} color="#ef4444" />
                                                </div>
                                                <span style={{ fontSize: 12, fontWeight: 600, color: '#991b1b' }}>RCA</span>
                                            </div>
                                            <ArrowRight size={16} color="#059669" />
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <div style={{ padding: 6, background: '#22c55e20', borderRadius: 6 }}>
                                                    <Target size={14} color="#22c55e" />
                                                </div>
                                                <span style={{ fontSize: 12, fontWeight: 600, color: '#065f46' }}>Defect Elimination</span>
                                            </div>
                                            <button onClick={openDEModal}
                                                style={{
                                                    marginLeft: 'auto', padding: '6px 14px', background: '#059669', color: '#fff',
                                                    border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600,
                                                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
                                                }}>
                                                <Target size={12} /> Create Task <ArrowRight size={12} />
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* STEP 6: Track Effectiveness */}
                                {currentStep === 6 && (
                                    <RCAEffectivenessPanel
                                        investigationId={selectedRca.id}
                                        rca={selectedRca}
                                        onRefresh={() => onRefresh?.()}
                                        onCreateFollowUp={() => {
                                            navigate('/analyze/rca/new', {
                                                state: {
                                                    title: `Follow-up to RCA: ${selectedRca.title}`,
                                                    asset_id: selectedRca.asset_id,
                                                    previous_rca_id: selectedRca.id,
                                                    description: `Follow-up investigation initiated from prior RCA: ${selectedRca.title}`
                                                }
                                            });
                                        }}
                                    />
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}
            </div>
                </>
            )}

            {/* â•â•â•â•â•â•â• DE TASK CREATION MODAL â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
            {showDEModal && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
                }}>
                    <div style={{
                        background: '#fff', borderRadius: 16, padding: 28,
                        maxWidth: 580, width: '95%', border: '1px solid #d1fae5',
                        maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
                    }}>
                        {deCreated ? (
                            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                                <div style={{
                                    width: 56, height: 56, borderRadius: '50%', margin: '0 auto 16px',
                                    background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                    <Check size={28} color="#16a34a" />
                                </div>
                                <div style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>DE Task Created!</div>
                                <div style={{ fontSize: 13, color: '#64748b' }}>Switch to the Defect Elimination tab to track progress</div>
                            </div>
                        ) : (
                            <>
                                {/* Modal header */}
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <div style={{ width: 36, height: 36, borderRadius: 10, background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <Target size={18} color="#059669" />
                                        </div>
                                        <div>
                                            <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b' }}>Create Defect Elimination Task</div>
                                            <div style={{ fontSize: 11, color: '#94a3b8' }}>Auto-populated from RCA: {selectedRca?.title}</div>
                                        </div>
                                    </div>
                                    <button onClick={() => setShowDEModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 4 }}><X size={18} /></button>
                                </div>

                                {/* Source badge */}
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                                    background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, marginBottom: 16, fontSize: 12,
                                }}>
                                    <Zap size={13} color="#2563eb" />
                                    <span style={{ color: '#64748b' }}>Source:</span>
                                    <span style={{ fontWeight: 600, color: '#1d4ed8' }}>{selectedRca?.title}</span>
                                    <span style={{ marginLeft: 'auto', padding: '1px 6px', borderRadius: 4, background: '#dbeafe', color: '#2563eb', fontSize: 10, fontWeight: 700 }}>
                                        {METHODS[selectedRca?.method]?.label || 'RCA'}
                                    </span>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                                    <div>
                                        <label style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Task Title</label>
                                        <input value={deDraft.title} onChange={e => setDeDraft(d => ({ ...d, title: e.target.value }))}
                                            style={{ width: '100%', padding: '9px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, color: '#1e293b', fontSize: 13, marginTop: 4, boxSizing: 'border-box' }} />
                                    </div>
                                    <div>
                                        <label style={{ fontSize: 11, color: '#dc2626', fontWeight: 600, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <AlertTriangle size={11} /> Root Cause Summary
                                        </label>
                                        <textarea value={deDraft.rootCauseSummary} onChange={e => setDeDraft(d => ({ ...d, rootCauseSummary: e.target.value }))} rows={3}
                                            style={{ width: '100%', padding: '9px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#1e293b', fontSize: 13, marginTop: 4, resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.6 }} />
                                    </div>
                                    <div>
                                        <label style={{ fontSize: 11, color: '#059669', fontWeight: 600, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <Wrench size={11} /> Proposed Solution
                                        </label>
                                        <textarea value={deDraft.proposedSolution} onChange={e => setDeDraft(d => ({ ...d, proposedSolution: e.target.value }))} rows={3}
                                            style={{ width: '100%', padding: '9px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, color: '#1e293b', fontSize: 13, marginTop: 4, resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.6 }} />
                                    </div>
                                    <div>
                                        <label style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Priority</label>
                                        <select value={deDraft.priority} onChange={e => setDeDraft(d => ({ ...d, priority: e.target.value as any }))}
                                            style={{ width: '100%', padding: '9px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, color: '#1e293b', fontSize: 13, marginTop: 4 }}>
                                            <option value="critical">Critical</option>
                                            <option value="high">High</option>
                                            <option value="medium">Medium</option>
                                            <option value="low">Low</option>
                                        </select>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                                        <div>
                                            <label style={{ fontSize: 10, color: '#dc2626', fontWeight: 700 }}>ANNUAL COST ($)</label>
                                            <input type="number" value={deDraft.annualCost} onChange={e => setDeDraft(d => ({ ...d, annualCost: Number(e.target.value) }))}
                                                style={{ width: '100%', padding: '7px 10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, color: '#1e293b', fontSize: 13, marginTop: 4, boxSizing: 'border-box' }} />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: 10, color: '#059669', fontWeight: 700 }}>EST. SAVINGS ($)</label>
                                            <input type="number" value={deDraft.estimatedSavings} onChange={e => setDeDraft(d => ({ ...d, estimatedSavings: Number(e.target.value) }))}
                                                style={{ width: '100%', padding: '7px 10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, color: '#1e293b', fontSize: 13, marginTop: 4, boxSizing: 'border-box' }} />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: 10, color: '#d97706', fontWeight: 700 }}>IMPL. COST ($)</label>
                                            <input type="number" value={deDraft.implementationCost} onChange={e => setDeDraft(d => ({ ...d, implementationCost: Number(e.target.value) }))}
                                                style={{ width: '100%', padding: '7px 10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, color: '#1e293b', fontSize: 13, marginTop: 4, boxSizing: 'border-box' }} />
                                        </div>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: 10, marginTop: 22, justifyContent: 'flex-end' }}>
                                    <button onClick={() => setShowDEModal(false)}
                                        style={{ padding: '9px 18px', background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#64748b', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>Cancel</button>
                                    <button onClick={handleCreateDETask} disabled={deCreating || !deDraft.title.trim()}
                                        style={{
                                            padding: '9px 20px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                                            background: '#059669', border: 'none', color: '#fff', display: 'flex', alignItems: 'center', gap: 5,
                                            opacity: deCreating || !deDraft.title.trim() ? 0.6 : 1,
                                        }}>
                                        <Target size={13} /> {deCreating ? 'Creatingâ€¦' : 'Create DE Task'}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {deleteTarget && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}>
                    <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.15)', maxWidth: 380, width: '95%', padding: 24 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                            <div style={{ width: 38, height: 38, borderRadius: '50%', background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <AlertCircle size={18} color="#dc2626" />
                            </div>
                            <div>
                                <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>Delete Investigation</div>
                                <div style={{ fontSize: 11, color: '#94a3b8' }}>This will also delete nodes and evidence</div>
                            </div>
                        </div>
                        <p style={{ fontSize: 13, color: '#475569', marginBottom: 18 }}>
                            Delete <strong>"{deleteTarget.title}"</strong>?
                        </p>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                            <button onClick={() => setDeleteTarget(null)} style={{ padding: '8px 16px', fontSize: 13, color: '#64748b', background: '#f1f5f9', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Cancel</button>
                            <button onClick={handleDelete} disabled={saving} style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, color: '#fff', background: '#dc2626', border: 'none', borderRadius: 8, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
                                {saving ? 'Deleting...' : 'Delete'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Asset Drill-Down Drawer (from Pareto bar click) */}
            {drillAsset && (
                <AssetDrillDrawer
                    asset={drillAsset}
                    criteria={paretoCriteria}
                    onClose={() => setDrillAsset(null)}
                    onInitiateRCA={handleDrillInitiateRCA}
                    onCreateFMEA={handleDrillCreateFMEA}
                />
            )}

            {/* Team Panel */}
            {showTeamPanel && (
                <TeamPanel
                    collaborators={rcaCollaborators}
                    onAdd={handleAddRcaCollaborator}
                    onRemove={handleRemoveRcaCollaborator}
                    onUpdateRole={handleUpdateRcaCollabRole}
                    onClose={() => setShowTeamPanel(false)}
                    accentColor="violet"
                />
            )}

            {/* EAM Context Panel â€” Asset, WO History, Failure Trends, Related RCAs */}
            {showEAMPanel && (
                <EAMContextPanel
                    asset={eamAsset}
                    workOrders={eamWorkOrders}
                    failureTrends={eamFailureTrends}
                    relatedRCAs={eamRelatedRCAs}
                    triggerWOId={selectedRca?.work_order_id || null}
                    onLinkTriggerWO={handleLinkTriggerWO}
                    onUnlinkTriggerWO={handleUnlinkTriggerWO}
                    onClose={() => setShowEAMPanel(false)}
                    loading={eamLoading}
                />
            )}

            {/* Pareto section moved to Step 1 above */}
        </div>
    );
};

export default RCATab;
